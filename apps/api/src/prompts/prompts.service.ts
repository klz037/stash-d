import { Injectable, Logger } from '@nestjs/common';
import type { ComposePromptRequest, ComposePromptResponse } from '@stashd/shared';

@Injectable()
export class PromptsService {
  private readonly logger = new Logger(PromptsService.name);

  async compose(input: ComposePromptRequest): Promise<ComposePromptResponse> {
    const fallback = this.fallback(input);
    const baseUrl = process.env.IFM_API_URL?.replace(/\/$/, '');
    const apiKey = process.env.IFM_API_KEY;
    const model = process.env.IFM_MODEL || 'IFM/K2-Horizon-7B';

    if (!baseUrl || !apiKey) {
      return { ...fallback, source: 'fallback' };
    }

    try {
      const system = [
        'You write short stash prompts for a sealed polaroid app called stash\'d.',
        'Return ONLY a JSON object: {"title":"...","body":"...","cta":"..."}.',
        'title: max 6 words. body: one sentence, max 110 characters. cta: 2-4 words.',
        'Tone: warm, specific, not spammy. No hashtags, no emojis, no quotes around fields.',
        `School: ${input.schoolName}. Cue: ${input.cue}. Emotion: ${input.emotion}.`,
        input.recipientName
          ? `The stash is for ${input.recipientName} at that school.`
          : 'The stash is for a friend at that school.',
      ].join(' ');

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.7,
          max_tokens: 160,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: `Write a prompt about: ${input.cue}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) {
        this.logger.warn(`IFM compose failed: ${res.status}`);
        return { ...fallback, source: 'fallback' };
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
      const parsed = this.parseJson(raw);
      if (!parsed) {
        return { ...fallback, source: 'fallback' };
      }

      return {
        title: this.clip(parsed.title || fallback.title, 48),
        body: this.clip(parsed.body || fallback.body, 140),
        cta: this.clip(parsed.cta || fallback.cta, 28),
        source: 'ifm',
      };
    } catch (err) {
      this.logger.warn(
        `IFM compose error: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return { ...fallback, source: 'fallback' };
    }
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
        title: input.cue,
        body: `Something soft${who} for ${input.schoolName}'s calendar beat.`,
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
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1)) as {
        title?: string;
        body?: string;
        cta?: string;
      };
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
