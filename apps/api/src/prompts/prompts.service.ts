import { Injectable, Logger } from '@nestjs/common';
import type {
  ComposePromptRequest,
  ComposePromptResponse,
  IfmDiagnosticsDto,
  ShelfCopyItem,
  ShelfCopyResult,
  StashAlertKind,
} from '@stashd/shared';

const DEFAULT_MODEL = 'IFM/K2-Horizon-7B';
/** Same cue + school + recipient within this window reuses the composed copy. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 1000;
const SHELF_CONCURRENCY = 4;
const MODELS_TTL_MS = 10 * 60 * 1000;

const ALERT_KINDS: StashAlertKind[] = ['athletics', 'tradition', 'food', 'event', 'news'];

type Job = keyof IfmDiagnosticsDto['usage']['jobs'];
type CacheEntry<T> = { at: number; value: T };

/** What K2 decides about one scraped headline. */
export type CurationVerdict = {
  index: number;
  kind: StashAlertKind;
  /** False for controversy, tragedy, admin noise — anything that is the wrong cue for a warm polaroid. */
  stashable: boolean;
  /** 0–10: how much a friend would enjoy getting a stash about this. */
  score: number;
};

@Injectable()
export class PromptsService {
  private readonly logger = new Logger(PromptsService.name);
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private lastResult: IfmDiagnosticsDto['lastResult'] = null;
  private lastError: string | undefined;
  private lastLatencyMs: number | undefined;
  private readonly usage: IfmDiagnosticsDto['usage'] = {
    callsOk: 0,
    callsFailed: 0,
    cacheHits: 0,
    jobs: { alertCopy: 0, curation: 0, shelfCopy: 0 },
  };
  /** GET /models result, refreshed every 10 minutes; null when the endpoint doesn't offer it. */
  private models: { at: number; ids: string[] | null; forBase: string } | null = null;
  private modelHint: string | undefined;
  /** Set after a gateway rejects the K2-specific extra field; we then omit it. */
  private strictParams = false;

  get configured(): boolean {
    return Boolean(this.baseUrl() && process.env.IFM_API_KEY);
  }

  diagnostics(): IfmDiagnosticsDto {
    const ids =
      this.models && this.models.forBase === this.baseUrl() ? this.models.ids : null;
    return {
      configured: this.configured,
      model: this.model(),
      resolvedModel: ids ? this.pickModel(ids) : undefined,
      availableModels: ids ? ids.slice(0, 40) : undefined,
      modelHint: this.modelHint,
      lastResult: this.lastResult,
      lastError: this.lastError,
      lastLatencyMs: this.lastLatencyMs,
      usage: {
        ...this.usage,
        jobs: { ...this.usage.jobs },
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Which model ID this endpoint actually serves
  // ---------------------------------------------------------------------------

  /**
   * Hosts name the same weights differently (`IFM/K2-Horizon-7B`,
   * `k2-horizon-7b`, a partner alias). Ask the endpoint what it lists and use
   * IFM_MODEL only if it is there; otherwise take the closest K2 model. Also
   * exposed as diagnostics so a wrong IFM_MODEL is a one-line fix, not a mystery.
   */
  async resolveModel(): Promise<string> {
    const ids = await this.listModels();
    return ids ? this.pickModel(ids) : this.model();
  }

  async listModels(force = false): Promise<string[] | null> {
    const base = this.baseUrl();
    if (!base || !this.configured) return null;
    if (
      !force &&
      this.models &&
      this.models.forBase === base &&
      Date.now() - this.models.at < MODELS_TTL_MS
    ) {
      return this.models.ids;
    }
    let ids: string[] | null = null;
    try {
      const res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${process.env.IFM_API_KEY}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id?: unknown }>; models?: Array<{ id?: unknown; name?: unknown }> };
        const rows = data.data ?? data.models ?? [];
        ids = rows
          .map((row) => (typeof row.id === 'string' ? row.id : typeof (row as { name?: unknown }).name === 'string' ? String((row as { name?: unknown }).name) : ''))
          .filter(Boolean);
      }
    } catch (err) {
      this.logger.warn(`IFM /models failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    this.models = { at: Date.now(), ids, forBase: base };
    this.refreshHint(ids);
    return ids;
  }

  private pickModel(ids: string[]): string {
    const wanted = this.model();
    if (ids.includes(wanted)) return wanted;
    const lower = wanted.toLowerCase();
    const exactCi = ids.find((id) => id.toLowerCase() === lower);
    if (exactCi) return exactCi;
    // Same family and size, different prefix or casing: `k2-horizon-7b` for `IFM/K2-Horizon-7B`.
    const tail = lower.split('/').pop() ?? lower;
    const sameTail = ids.find((id) => id.toLowerCase().endsWith(tail));
    if (sameTail) return sameTail;
    const k2 = ids.filter((id) => /k2|horizon/i.test(id));
    if (k2.length > 0) {
      // Prefer the smallest K2 Horizon size for latency; this is short copy, not research.
      const size = (id: string) => Number(/(\d+(?:\.\d+)?)\s*b/i.exec(id)?.[1] ?? 999);
      return [...k2].sort((a, b) => size(a) - size(b))[0];
    }
    return wanted;
  }

  private refreshHint(ids: string[] | null) {
    const wanted = this.model();
    if (!ids) {
      this.modelHint = undefined;
      return;
    }
    if (ids.length === 0) {
      this.modelHint = 'The endpoint lists no models for this key.';
      return;
    }
    if (ids.includes(wanted)) {
      this.modelHint = undefined;
      return;
    }
    const picked = this.pickModel(ids);
    if (picked !== wanted) {
      this.modelHint = `IFM_MODEL "${wanted}" is not served here; using "${picked}". Set IFM_MODEL=${picked} to make that explicit.`;
    } else {
      this.modelHint = `IFM_MODEL "${wanted}" is not served here and no K2 model is listed. Available: ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? ', …' : ''}.`;
    }
  }

  // ---------------------------------------------------------------------------
  // Job 1: the words of a device alert
  // ---------------------------------------------------------------------------

  async compose(input: ComposePromptRequest): Promise<ComposePromptResponse> {
    const fallback = this.fallback(input);
    if (!this.configured) {
      return { ...fallback, source: 'fallback' };
    }

    const key = ['alert', input.schoolId, input.emotion, input.recipientName ?? '', input.cue].join('|');
    const cached = this.fromCache<ComposePromptResponse>(key);
    if (cached) return cached;

    const system = [
      "You write short stash prompts for a sealed polaroid app called stash'd.",
      'Respond with ONLY a JSON object: {"title":"...","body":"...","cta":"..."}.',
      'title: max 6 words. body: one sentence, max 110 characters. cta: 2-4 words.',
      'Tone: warm, specific, not spammy. No hashtags, no emojis, no markdown.',
      `School: ${input.schoolName}. Cue: ${input.cue}. Emotion: ${input.emotion}.`,
      input.recipientName
        ? `The stash is for ${input.recipientName} at that school.`
        : 'The stash is for a friend at that school.',
    ].join(' ');

    const parsed = await this.ask<{ title?: unknown; body?: unknown; cta?: unknown }>(
      'alertCopy',
      system,
      `Write a prompt about: ${input.cue}`,
      (raw) => this.parseObject(raw),
    );
    if (!parsed) return { ...fallback, source: 'fallback' };

    const value: ComposePromptResponse = {
      title: this.clip(this.str(parsed.title) || fallback.title, 48),
      body: this.clip(this.str(parsed.body) || fallback.body, 140),
      cta: this.clip(this.str(parsed.cta) || fallback.cta, 28),
      source: 'ifm',
    };
    this.remember(key, value);
    return value;
  }

  // ---------------------------------------------------------------------------
  // Job 2: deciding which campus happenings deserve an alert at all
  // ---------------------------------------------------------------------------

  /**
   * One call per school batch. K2 classifies each headline, drops the ones
   * that would make a bad cue for a warm polaroid, and scores the rest.
   * Returns null when IFM is unset or the call failed, so callers keep their
   * rule-based verdicts.
   */
  async curate(
    schoolName: string,
    items: Array<{ cue: string; sourceLabel: string }>,
  ): Promise<CurationVerdict[] | null> {
    if (!this.configured || items.length === 0) return null;

    const key = ['curate', schoolName, ...items.map((i) => i.cue)].join('|');
    const cached = this.fromCache<CurationVerdict[]>(key);
    if (cached) return cached;

    const system = [
      "You curate campus happenings for stash'd, an app where friends leave each other sealed polaroids.",
      `Campus: ${schoolName}.`,
      'For each numbered item decide: kind (one of athletics, tradition, food, event, news),',
      'stashable (true only if a friend would enjoy being nudged to send a warm photo about it;',
      'false for controversy, tragedy, crime, layoffs, lawsuits, politics, admin notices, ads),',
      'and score 0-10 for how fun and specific a stash cue it makes (games, traditions, food, campus life score high; generic press releases score low).',
      'Respond with ONLY a JSON array of objects: [{"i":0,"kind":"athletics","stashable":true,"score":8}, ...]. Include every item exactly once.',
    ].join(' ');
    const user = items
      .map((item, i) => `${i}. [${item.sourceLabel}] ${item.cue.replace(/\s+/g, ' ').slice(0, 160)}`)
      .join('\n');

    const parsed = await this.ask<unknown[]>('curation', system, user, (raw) =>
      this.parseArray(raw),
    );
    if (!parsed) return null;

    const verdicts: CurationVerdict[] = [];
    const seen = new Set<number>();
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const r = row as { i?: unknown; kind?: unknown; stashable?: unknown; score?: unknown };
      const index = typeof r.i === 'number' ? r.i : Number(r.i);
      if (!Number.isInteger(index) || index < 0 || index >= items.length || seen.has(index)) continue;
      seen.add(index);
      const kind = ALERT_KINDS.includes(r.kind as StashAlertKind)
        ? (r.kind as StashAlertKind)
        : 'news';
      const score = Math.max(0, Math.min(10, Number(r.score) || 0));
      verdicts.push({ index, kind, stashable: r.stashable !== false, score });
    }
    // Anything K2 skipped keeps flowing through the rules path rather than vanishing.
    if (verdicts.length < Math.ceil(items.length / 2)) {
      this.logger.warn(`IFM curated only ${verdicts.length}/${items.length} items for ${schoolName}; keeping rules`);
      return null;
    }
    this.remember(key, verdicts);
    return verdicts;
  }

  // ---------------------------------------------------------------------------
  // Job 3: the words of the shelf cards (timing, weather, calendars)
  // ---------------------------------------------------------------------------

  /**
   * Rewrites shelf cards in K2's voice while keeping every fact the client
   * worked out (times, temperatures, cities, names). Cards K2 can't improve
   * come back untouched with `source: 'fallback'`.
   */
  async shelfCopy(items: ShelfCopyItem[]): Promise<ShelfCopyResult[]> {
    const untouched = (item: ShelfCopyItem): ShelfCopyResult => ({
      id: item.id,
      title: item.title,
      body: item.body,
      source: 'fallback',
    });
    if (!this.configured || items.length === 0) return items.map(untouched);

    const results: ShelfCopyResult[] = new Array(items.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await this.rewriteShelfItem(items[i]).catch(() => untouched(items[i]));
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(SHELF_CONCURRENCY, items.length) }, () => worker()),
    );
    return results;
  }

  private async rewriteShelfItem(item: ShelfCopyItem): Promise<ShelfCopyResult> {
    const key = ['shelf', item.kind, item.emotion ?? '', item.friendName ?? '', item.title, item.body].join('|');
    const cached = this.fromCache<ShelfCopyResult>(key);
    if (cached) return { ...cached, id: item.id };

    const angle =
      item.emotion === 'weather'
        ? 'This card is about weather, daylight or the time of day where a friend is.'
        : item.emotion === 'stress'
          ? 'This card is about a stressful stretch on a campus calendar (exams, deadlines).'
          : item.emotion === 'lull'
            ? 'This card is about a quiet stretch on a campus calendar (a break, a slow week).'
            : item.emotion === 'milestone'
              ? 'This card is about a dated moment: a game, a calendar event, a ritual.'
              : item.emotion === 'waiting' || item.emotion === 'reciprocity'
                ? 'This card is about the rhythm between two friends (who sent last, what is still sealed).'
                : 'This card is a small reason to send a friend a sealed polaroid.';

    const system = [
      "You rewrite short shelf cards for stash'd, an app where friends leave each other sealed polaroids that open later.",
      angle,
      'Keep every fact from the draft exactly: names, cities, temperatures, times, day counts, event names. Do not invent new facts.',
      'Make it warmer and more specific, in plain spoken English. title: max 7 words. body: one or two sentences, max 120 characters.',
      'No hashtags, no emojis, no markdown, no exclamation marks in the title.',
      'Respond with ONLY a JSON object: {"title":"...","body":"..."}.',
    ].join(' ');
    const user = `Draft title: ${item.title}\nDraft body: ${item.body}${
      item.friendName ? `\nFriend: ${item.friendName}` : ''
    }`;

    const parsed = await this.ask<{ title?: unknown; body?: unknown }>(
      'shelfCopy',
      system,
      user,
      (raw) => this.parseObject(raw),
    );
    const title = this.str(parsed?.title);
    const body = this.str(parsed?.body);
    if (!parsed || !title || !body) {
      return { id: item.id, title: item.title, body: item.body, source: 'fallback' };
    }
    const value: ShelfCopyResult = {
      id: item.id,
      title: this.clip(title, 60),
      body: this.clip(body, 150),
      source: 'ifm',
    };
    this.remember(key, value);
    return value;
  }

  // ---------------------------------------------------------------------------
  // The one place that talks to K2
  // ---------------------------------------------------------------------------

  /**
   * One chat completion against an OpenAI-compatible K2 Horizon endpoint.
   * K2 Horizon is a reasoning model: thinking arrives in `reasoning_content`
   * and the answer in `content`, so we ask for low reasoning effort, leave
   * plenty of room for tokens, and accept JSON from either field.
   */
  private async ask<T>(
    job: Job,
    system: string,
    user: string,
    parse: (raw: string) => T | null,
  ): Promise<T | null> {
    const started = Date.now();
    try {
      const model = await this.resolveModel();
      let res = await this.completion(model, system, user, !this.strictParams);
      if (res.status === 400 && !this.strictParams) {
        // Strict OpenAI-compatible gateways reject fields they don't know.
        // Try once without the K2-specific reasoning knob and remember the answer.
        const retry = await this.completion(model, system, user, false);
        if (retry.ok) {
          this.strictParams = true;
          this.logger.log('IFM endpoint rejects chat_template_kwargs; omitting it from now on');
        }
        res = retry.ok ? retry : res;
      }
      this.lastLatencyMs = Date.now() - started;

      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        if (res.status === 400 || res.status === 404) {
          // Most likely a model-name mismatch: refresh the list so the hint is current.
          await this.listModels(true);
        }
        throw new Error(`IFM ${res.status}${detail ? `: ${detail}` : ''} (model "${model}")`);
      }

      const data = (await res.json()) as {
        choices?: Array<{
          message?: { content?: string | null; reasoning_content?: string | null };
        }>;
      };
      const message = data.choices?.[0]?.message;
      const answer = this.stripThinking(message?.content ?? '');
      const parsed = parse(answer) ?? parse(message?.reasoning_content ?? '');
      if (parsed === null) {
        this.record('error', 'IFM answered but returned no usable JSON');
        return null;
      }
      this.record('ok', undefined, job);
      return parsed;
    } catch (err) {
      this.lastLatencyMs = Date.now() - started;
      const message = err instanceof Error ? err.message : 'unknown error';
      this.record('error', message);
      this.logger.warn(`IFM ${job} error: ${message}`);
      return null;
    }
  }

  private completion(model: string, system: string, user: string, withK2Kwargs: boolean) {
    return fetch(`${this.baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.IFM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 1.0,
        top_p: 0.95,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        ...(withK2Kwargs ? { chat_template_kwargs: { reasoning_effort: 'low' } } : {}),
      }),
      signal: AbortSignal.timeout(this.timeoutMs()),
    });
  }

  private record(result: 'ok' | 'error', error?: string, job?: Job) {
    this.lastResult = result;
    this.lastError = error;
    if (result === 'ok') {
      this.usage.callsOk += 1;
      if (job) this.usage.jobs[job] += 1;
    } else {
      this.usage.callsFailed += 1;
    }
  }

  private fromCache<T>(key: string): T | null {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at >= CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    this.usage.cacheHits += 1;
    return hit.value as T;
  }

  private remember(key: string, value: unknown) {
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), value });
  }

  private baseUrl(): string | undefined {
    return process.env.IFM_API_URL?.trim().replace(/\/$/, '') || undefined;
  }

  private model(): string {
    return process.env.IFM_MODEL || DEFAULT_MODEL;
  }

  private timeoutMs(): number {
    const parsed = Number(process.env.IFM_TIMEOUT_MS);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 20_000;
  }

  /** Servers without the k2_horizon reasoning parser inline the thinking as <think>…</think>. */
  private stripThinking(raw: string): string {
    return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  private fallback(input: ComposePromptRequest): ComposePromptResponse {
    const who = input.recipientName ? ` for ${input.recipientName}` : '';
    const templates: Record<
      ComposePromptRequest['emotion'],
      ComposePromptResponse
    > = {
      athletics: {
        title: `${input.schoolName} game day`,
        body: `Stash the vibe of ${input.cue}${who} — sealed until unlock.`,
        cta: 'Stash the game',
        source: 'fallback',
      },
      tradition: {
        title: `${input.schoolName} tradition`,
        body: `Capture ${input.cue}${who} before the moment fades.`,
        cta: 'Stash tradition',
        source: 'fallback',
      },
      food: {
        title: 'What did you eat?',
        body: `Send a food polaroid${who} — ${input.cue} energy.`,
        cta: 'Stash lunch',
        source: 'fallback',
      },
      calendar: {
        title: `Happening at ${input.schoolName}`,
        body: `${this.clip(input.cue, 90)} — stash something${who} to open after.`,
        cta: 'Stash a note',
        source: 'fallback',
      },
      weather: {
        title: `${input.schoolName} sky`,
        body: `${input.cue}${who} — stash the weather mood.`,
        cta: 'Stash the sky',
        source: 'fallback',
      },
      place: {
        title: 'Drop a place',
        body: `Pin ${input.cue}${who} while you're thinking of them.`,
        cta: 'Stash a place',
        source: 'fallback',
      },
      soft: {
        title: 'Soft stash',
        body: `${input.cue}${who}.`,
        cta: 'Open capture',
        source: 'fallback',
      },
    };
    return templates[input.emotion] ?? templates.soft;
  }

  /** The last balanced {...} block, so a stray brace in the reasoning doesn't win. */
  private parseObject(raw: string): Record<string, unknown> | null {
    const slice = this.lastBalanced(raw, '{', '}');
    if (!slice) return null;
    try {
      const parsed = JSON.parse(slice) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const obj = parsed as Record<string, unknown>;
      return Object.keys(obj).length > 0 ? obj : null;
    } catch {
      return null;
    }
  }

  private parseArray(raw: string): unknown[] | null {
    const slice = this.lastBalanced(raw, '[', ']');
    if (!slice) return null;
    try {
      const parsed = JSON.parse(slice) as unknown;
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private lastBalanced(raw: string, open: string, close: string): string | null {
    const end = raw.lastIndexOf(close);
    if (end < 0) return null;
    let depth = 0;
    for (let i = end; i >= 0; i -= 1) {
      if (raw[i] === close) depth += 1;
      if (raw[i] === open) {
        depth -= 1;
        if (depth === 0) return raw.slice(i, end + 1);
      }
    }
    return null;
  }

  private str(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
  }

  private clip(value: string, max: number): string {
    const trimmed = value.trim().replace(/\s+/g, ' ');
    if (trimmed.length <= max) return trimmed;
    return `${trimmed.slice(0, max - 1).trimEnd()}…`;
  }
}
