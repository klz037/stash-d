import { PromptsService } from '../prompts/prompts.service';
import { HappeningsService } from './happenings.service';

describe('HappeningsService', () => {
  const service = new HappeningsService(new PromptsService());

  beforeEach(() => {
    delete process.env.IFM_API_URL;
    delete process.env.IFM_API_KEY;
  });

  it('loads recipient-school seeds from campus-life.json', () => {
    expect(service.schoolMeta('cmu')?.name).toBe('Carnegie Mellon');
    expect(service.schoolMeta('pitt')?.reddit).toBe('pitt');
    expect(service.schoolMeta('nowhere')).toBeUndefined();
  });

  it('classifies headlines into stash-able kinds', () => {
    expect(service.classify('Pitt football tops Backyard Brawl')).toBe('athletics');
    expect(service.classify('New dining hall opens on campus')).toBe('food');
    expect(service.classify('Spring Carnival build week begins')).toBe('tradition');
    expect(service.classify('Free concert in Washington Square')).toBe('event');
    expect(service.classify('University announces new provost')).toBe('news');
  });

  it('never turns controversy into a stash cue', () => {
    expect(service.isStashable('Carnegie Mellon probes professor amid backlash')).toBe(false);
    expect(service.isStashable('Student dies after campus shooting')).toBe(false);
    expect(service.isStashable('No. 2 Pitt sweeps No. 17 Tennessee')).toBe(true);
    expect(service.classify('No. 2 Pitt sweeps No. 17 Tennessee')).toBe('athletics');
  });

  it('always yields tradition and food cues even when the internet is down', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('offline'));
    const items = await service.happeningsForSchool('nyu');
    fetchSpy.mockRestore();

    expect(items.some((item) => item.kind === 'tradition')).toBe(true);
    expect(items.some((item) => item.kind === 'food')).toBe(true);
    expect(items.every((item) => item.sourceLabel.includes('New York University'))).toBe(true);
    expect(items.every((item) => item.curatedBy === 'rules')).toBe(true);
  });

  it('lets K2 re-judge scraped headlines: reclassify, drop, and rank', async () => {
    const prompts = new PromptsService();
    const curate = jest.spyOn(prompts, 'curate').mockImplementation(async (_school, items) =>
      items.map((item, index) => {
        if (/provost/i.test(item.cue)) return { index, kind: 'news' as const, stashable: false, score: 1 };
        if (/dumpling/i.test(item.cue)) return { index, kind: 'food' as const, stashable: true, score: 9 };
        return { index, kind: 'event' as const, stashable: true, score: 4 };
      }),
    );
    const svc = new HappeningsService(prompts);

    const rss =
      '<rss><channel>' +
      '<item><title>University announces new provost - Daily</title><link>https://x/1</link></item>' +
      '<item><title>Late-night dumpling crawl returns to Chinatown - Post</title><link>https://x/2</link></item>' +
      '<item><title>Free concert in Washington Square - Post</title><link>https://x/3</link></item>' +
      '</channel></rss>';
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('news.google.com')) {
        return new Response(rss, { status: 200 });
      }
      return new Response('', { status: 403 });
    });

    const items = await svc.happeningsForSchool('nyu');
    fetchSpy.mockRestore();

    expect(curate).toHaveBeenCalledTimes(1);
    expect(items.some((i) => /provost/i.test(i.cue))).toBe(false);
    const dumpling = items.find((i) => /dumpling/i.test(i.cue));
    expect(dumpling).toMatchObject({ kind: 'food', emotion: 'food', curatedBy: 'ifm', score: 9 });
    expect(items[0]).toBe(dumpling);
    // Hand-curated seeds keep their kind but pick up K2's score and stamp.
    const seedFood = items.find((i) => i.sourceLabel.endsWith('food cue'));
    expect(seedFood).toMatchObject({ kind: 'food', curatedBy: 'ifm' });
  });
});
