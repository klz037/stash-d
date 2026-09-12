import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StashAlertKind } from '@stashd/shared';

type CampusSchool = {
  name: string;
  newsQuery: string;
  reddit: string;
  athletics: Array<{ label: string; month: number; day: number }>;
  traditions: string[];
  food: string[];
};

export type SchoolHappening = {
  kind: StashAlertKind;
  cue: string;
  sourceLabel: string;
  sourceUrl?: string;
  emotion: 'athletics' | 'tradition' | 'food' | 'calendar' | 'soft';
};

@Injectable()
export class HappeningsService {
  private readonly logger = new Logger(HappeningsService.name);
  private readonly cache = new Map<
    string,
    { at: number; items: SchoolHappening[] }
  >();
  private readonly schools: Record<string, CampusSchool>;

  constructor() {
    const raw = readFileSync(
      join(__dirname, '..', 'data', 'campus-life.json'),
      'utf8',
    );
    this.schools = (
      JSON.parse(raw) as { schools: Record<string, CampusSchool> }
    ).schools;
  }

  schoolMeta(schoolId?: string): CampusSchool | undefined {
    if (!schoolId) return undefined;
    return this.schools[schoolId];
  }

  async happeningsForSchool(schoolId: string): Promise<SchoolHappening[]> {
    const meta = this.schools[schoolId];
    if (!meta) return [];

    const cached = this.cache.get(schoolId);
    if (cached && Date.now() - cached.at < 1000 * 60 * 90) {
      return cached.items;
    }

    const [news, reddit] = await Promise.all([
      this.fetchGoogleNews(meta),
      this.fetchReddit(meta),
    ]);

    const seeded = this.seedHappenings(schoolId, meta);
    const merged = this.dedupe([...news, ...reddit, ...seeded]).slice(0, 12);
    this.cache.set(schoolId, { at: Date.now(), items: merged });
    return merged;
  }

  private seedHappenings(
    schoolId: string,
    meta: CampusSchool,
  ): SchoolHappening[] {
    const now = new Date();
    const out: SchoolHappening[] = [];
    for (const event of meta.athletics) {
      const delta = this.daysUntil(event.month, event.day, now);
      if (delta === null) continue;
      const when =
        delta === 0
          ? 'today'
          : delta < 0
            ? 'just wrapped'
            : `in ${delta} day${delta === 1 ? '' : 's'}`;
      out.push({
        kind: 'athletics',
        emotion: 'athletics',
        cue: `${event.label} (${when})`,
        sourceLabel: `${meta.name} athletics calendar`,
      });
    }

    const day = now.toISOString().slice(0, 10);
    const trad =
      meta.traditions[
        this.hash(`${schoolId}:trad:${day}`) % meta.traditions.length
      ];
    const food =
      meta.food[this.hash(`${schoolId}:food:${day}`) % meta.food.length];
    out.push({
      kind: 'tradition',
      emotion: 'tradition',
      cue: trad,
      sourceLabel: `${meta.name} campus tradition`,
    });
    out.push({
      kind: 'food',
      emotion: 'food',
      cue: food,
      sourceLabel: `${meta.name} food cue`,
    });
    return out;
  }

  private async fetchGoogleNews(
    meta: CampusSchool,
  ): Promise<SchoolHappening[]> {
    const url =
      'https://news.google.com/rss/search?q=' +
      encodeURIComponent(meta.newsQuery) +
      '&hl=en-US&gl=US&ceid=US:en';
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'stashd-campus-alerts/1.0' },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) return [];
      const xml = await res.text();
      return this.parseRss(xml, meta.name).slice(0, 5);
    } catch (err) {
      this.logger.warn(
        `News fetch failed for ${meta.name}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return [];
    }
  }

  private async fetchReddit(meta: CampusSchool): Promise<SchoolHappening[]> {
    const url = `https://www.reddit.com/r/${meta.reddit}/hot.json?limit=8`;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'stashd-campus-alerts/1.0 (campus stash prompts)',
        },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        data?: {
          children?: Array<{
            data?: {
              title?: string;
              url?: string;
              permalink?: string;
              stickied?: boolean;
            };
          }>;
        };
      };
      const posts = data.data?.children ?? [];
      const out: SchoolHappening[] = [];
      for (const child of posts) {
        const post = child.data;
        if (!post?.title || post.stickied) continue;
        const title = this.decodeEntities(post.title);
        if (!this.isStashable(title)) continue;
        const kind = this.classify(title);
        out.push({
          kind,
          emotion:
            kind === 'athletics'
              ? 'athletics'
              : kind === 'food'
                ? 'food'
                : kind === 'tradition'
                  ? 'tradition'
                  : 'calendar',
          cue: title.slice(0, 140),
          sourceLabel: `r/${meta.reddit}`,
          sourceUrl: post.url?.startsWith('http')
            ? post.url
            : `https://www.reddit.com${post.permalink ?? ''}`,
        });
      }
      return out.slice(0, 5);
    } catch (err) {
      this.logger.warn(
        `Reddit fetch failed for ${meta.reddit}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return [];
    }
  }

  private parseRss(xml: string, schoolName: string): SchoolHappening[] {
    const items: SchoolHappening[] = [];
    const blocks = xml.split('<item>').slice(1);
    for (const block of blocks) {
      const title = this.xmlTag(block, 'title');
      const link = this.xmlTag(block, 'link');
      if (!title) continue;
      const cleaned = this.decodeEntities(
        title.replace(/<!\[CDATA\[|\]\]>/g, ''),
      ).slice(0, 140);
      if (!this.isStashable(cleaned)) continue;
      const kind = this.classify(cleaned);
      items.push({
        kind,
        emotion:
          kind === 'athletics'
            ? 'athletics'
            : kind === 'food'
              ? 'food'
              : kind === 'tradition'
                ? 'tradition'
                : 'calendar',
        cue: cleaned,
        sourceLabel: `${schoolName} news`,
        sourceUrl: link || undefined,
      });
    }
    return items;
  }

  private xmlTag(block: string, tag: string): string | undefined {
    const cdata = new RegExp(
      `<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`,
      'i',
    );
    const plain = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
    const m = block.match(cdata) || block.match(plain);
    const value = (m?.[1] || '').trim();
    return value || undefined;
  }

  classify(text: string): StashAlertKind {
    const t = text.toLowerCase();
    if (
      /(football|basketball|soccer|volleyball|athletics|game day|\bvs\.?\b|rivalry|tournament|intramural|playoff|sweeps?|defeats?|tops|upsets?|beats|wins|kickoff|tip-?off|homecoming game)/.test(
        t,
      )
    ) {
      return 'athletics';
    }
    if (/(dining|pizza|coffee|food truck|brunch|lunch|dinner|eat)/.test(t)) {
      return 'food';
    }
    if (
      /(tradition|carnival|festival|parade|homecoming|commencement|orientation|move-?in|fence|buggy)/.test(
        t,
      )
    ) {
      return 'tradition';
    }
    if (/(concert|lecture|fair|event|panel|meetup|rally)/.test(t)) {
      return 'event';
    }
    return 'news';
  }

  /**
   * A stash alert asks someone to send a warm polaroid. Headlines about
   * controversy or tragedy are real news but the wrong cue for that.
   */
  isStashable(text: string): boolean {
    const t = text.toLowerCase();
    return !/(probe|backlash|lawsuit|sued|scandal|arrest|shooting|death|dies|died|killed|assault|harass|racis|protest|layoff|fired|investigat|controvers|outrage|threat|bomb|fraud|misconduct|suspend|expel|crash|fire\b|overdose|suicide)/.test(
      t,
    );
  }

  private decodeEntities(value: string): string {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
  }

  private daysUntil(month: number, day: number, now: Date): number | null {
    const year = now.getFullYear();
    let when = new Date(year, month - 1, day, 12, 0, 0);
    let delta = Math.floor((when.getTime() - now.getTime()) / 86_400_000);
    if (delta >= -2 && delta <= 10) return delta;
    when = new Date(year + 1, month - 1, day, 12, 0, 0);
    delta = Math.floor((when.getTime() - now.getTime()) / 86_400_000);
    if (delta >= -2 && delta <= 10) return delta;
    return null;
  }

  private hash(value: string): number {
    let h = 0;
    for (let i = 0; i < value.length; i += 1) {
      h = (h * 31 + value.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  private dedupe(items: SchoolHappening[]): SchoolHappening[] {
    const seen = new Set<string>();
    const out: SchoolHappening[] = [];
    for (const item of items) {
      const key = item.cue.toLowerCase().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }
}
