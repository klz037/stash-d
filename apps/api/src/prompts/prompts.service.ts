import { Injectable, Logger } from '@nestjs/common';
import type {
  ComposePromptRequest,
  ComposePromptResponse,
  IfmDiagnosticsDto,
} from '@stashd/shared';

const DEFAULT_MODEL = 'IFM/K2-Horizon-7B';
/** Same cue + school + recipient within this window reuses the composed copy. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 500;

type CacheEntry = { at: number; value: ComposePromptResponse };

@Injectable()
export class PromptsService {
  private readonly logger = new Logger(PromptsService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private lastResult: IfmDiagnosticsDto['lastResult'] = null;
  private lastError: string | undefined;
  private lastLatencyMs: number | undefined;

  get configured(): boolean {
    return Boolean(this.baseUrl() && process.env.IFM_API_KEY);
  }

  diagnostics(): IfmDiagnosticsDto {
    return {
      configured: this.configured,
      model: this.model(),
      lastResult: this.lastResult,
      lastError: this.lastError,
      lastLatencyMs: this.lastLatencyMs,
    };
  }

  async compose(input: ComposePromptRequest): Promise<ComposePromptResponse> {
    const fallback = this.fallback(input);
    if (!this.configured) {
      return { ...fallback, source: 'fallback' };
    }

    const key = this.cacheKey(input);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value;
    }

    const started = Date.now();
    try {
      const composed = await this.callIfm(input);
      this.lastLatencyMs = Date.now() - started;
      if (!composed) {
        this.record('error', 'IFM answered but returned no usable JSON');
        return { ...fallback, source: 'fallback' };
      }
      this.record('ok');
      const value: ComposePromptResponse = {
        title: this.clip(composed.title || fallback.title, 48),
        body: this.clip(composed.body || fallback.body, 140),
        cta: this.clip(composed.cta || fallback.cta, 28),
        source: 'ifm',
      };
      this.remember(key, value);
      return value;
    } catch (err) {
      this.lastLatencyMs = Date.now() - started;
      const message = err instanceof Error ? err.message : 'unknown error';
      this.record('error', message);
      this.logger.warn(`IFM compose error: ${message}`);
      return { ...fallback, source: 'fallback' };
    }
  }

  /**
   * One chat completion against an OpenAI-compatible K2 Horizon endpoint.
   * K2 Horizon is a reasoning model: thinking arrives in `reasoning_content`
   * and the answer in `content`, so we ask for low reasoning effort, leave
   * plenty of room for tokens, and accept JSON from either field.
   */
  private async callIfm(
    input: ComposePromptRequest,
  ): Promise<{ title?: string; body?: string; cta?: string } | null> {
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

    const res = await fetch(`${this.baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.IFM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model(),
        temperature: 1.0,
        top_p: 0.95,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Write a prompt about: ${input.cue}` },
        ],
        chat_template_kwargs: { reasoning_effort: 'low' },
      }),
      signal: AbortSignal.timeout(this.timeoutMs()),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`IFM ${res.status}${detail ? `: ${detail}` : ''}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string | null; reasoning_content?: string | null };
        finish_reason?: string;
      }>;
    };
    const message = data.choices?.[0]?.message;
    const answer = this.stripThinking(message?.content ?? '');
    return (
      this.parseJson(answer) ??
      this.parseJson(message?.reasoning_content ?? '')
    );
  }

  private record(result: 'ok' | 'error', error?: string) {
    this.lastResult = result;
    this.lastError = error;
  }

  private remember(key: string, value: ComposePromptResponse) {
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), value });
  }

  private cacheKey(input: ComposePromptRequest): string {
    return [input.schoolId, input.emotion, input.recipientName ?? '', input.cue].join('|');
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

  private parseJson(
    raw: string,
  ): { title?: string; body?: string; cta?: string } | null {
    // Take the last {...} block so a stray brace in the reasoning doesn't win.
    const end = raw.lastIndexOf('}');
    if (end < 0) return null;
    let depth = 0;
    let start = -1;
    for (let i = end; i >= 0; i -= 1) {
      if (raw[i] === '}') depth += 1;
      if (raw[i] === '{') {
        depth -= 1;
        if (depth === 0) {
          start = i;
          break;
        }
      }
    }
    if (start < 0) return null;
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        title?: unknown;
        body?: unknown;
        cta?: unknown;
      };
      const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
      const out = { title: str(parsed.title), body: str(parsed.body), cta: str(parsed.cta) };
      return out.title || out.body ? out : null;
    } catch {
      return null;
    }
  }

  private clip(value: string, max: number): string {
    const trimmed = value.trim().replace(/\s+/g, ' ');
    if (trimmed.length <= max) return trimmed;
    return `${trimmed.slice(0, max - 1).trimEnd()}…`;
  }
}
