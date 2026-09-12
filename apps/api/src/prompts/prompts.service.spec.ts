import { PromptsService } from './prompts.service';

describe('PromptsService', () => {
  const service = new PromptsService();

  it('falls back to school-specific templates when IFM is unset', async () => {
    delete process.env.IFM_API_URL;
    delete process.env.IFM_API_KEY;

    const result = await service.compose({
      schoolId: 'pitt',
      schoolName: 'University of Pittsburgh',
      cue: 'Panthers football Saturday',
      emotion: 'athletics',
      recipientName: 'Alex',
    });

    expect(result.source).toBe('fallback');
    expect(result.title.toLowerCase()).toContain('pittsburgh');
    expect(result.body.toLowerCase()).toContain('panthers');
    expect(result.cta.length).toBeGreaterThan(0);
  });

  it('returns food fallback without recipient', async () => {
    delete process.env.IFM_API_URL;
    delete process.env.IFM_API_KEY;

    const result = await service.compose({
      schoolId: 'cmu',
      schoolName: 'Carnegie Mellon',
      cue: 'Schatz dining',
      emotion: 'food',
    });

    expect(result.source).toBe('fallback');
    expect(result.title.toLowerCase()).toContain('eat');
  });
});
