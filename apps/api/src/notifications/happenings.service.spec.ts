import { HappeningsService } from './happenings.service';

describe('HappeningsService', () => {
  const service = new HappeningsService();

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
  });
});
