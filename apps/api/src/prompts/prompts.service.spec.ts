import * as http from 'node:http';
import { PromptsService } from './prompts.service';

/** A stand-in for an OpenAI-compatible K2 Horizon server. */
function mockIfm(
  handler: (body: any) => { status?: number; json?: unknown; text?: string },
): Promise<{ url: string; close: () => Promise<void>; requests: any[] }> {
  const requests: any[] = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        requests.push({ path: req.url, auth: req.headers.authorization, body });
        const out = handler(body);
        res.statusCode = out.status ?? 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(out.text ?? JSON.stringify(out.json ?? {}));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

const input = {
  schoolId: 'pitt',
  schoolName: 'University of Pittsburgh',
  cue: 'Panthers football Saturday',
  emotion: 'athletics' as const,
  recipientName: 'Alex',
};

describe('PromptsService with IFM', () => {
  afterEach(() => {
    delete process.env.IFM_API_URL;
    delete process.env.IFM_API_KEY;
    delete process.env.IFM_MODEL;
  });

  it('sends a K2 Horizon-shaped request and reads the answer from content', async () => {
    const ifm = await mockIfm(() => ({
      json: {
        choices: [
          {
            message: {
              reasoning_content: 'The user wants a warm prompt. I will {mention} the game.',
              content:
                '{"title":"Panthers Saturday","body":"Catch the Heinz Field roar for Alex before kickoff fades.","cta":"Stash the game"}',
            },
            finish_reason: 'stop',
          },
        ],
      },
    }));
    process.env.IFM_API_URL = `${ifm.url}/`;
    process.env.IFM_API_KEY = 'test-key';
    const service = new PromptsService();

    const result = await service.compose(input);
    await ifm.close();

    expect(result.source).toBe('ifm');
    expect(result.title).toBe('Panthers Saturday');
    expect(result.body).toContain('Heinz Field');
    expect(result.cta).toBe('Stash the game');

    expect(ifm.requests).toHaveLength(1);
    const [req] = ifm.requests;
    expect(req.path).toBe('/v1/chat/completions');
    expect(req.auth).toBe('Bearer test-key');
    expect(req.body.model).toBe('IFM/K2-Horizon-7B');
    expect(req.body.chat_template_kwargs).toEqual({ reasoning_effort: 'low' });
    expect(req.body.max_tokens).toBeGreaterThanOrEqual(1024);
    expect(req.body.messages[0].content).toContain('University of Pittsburgh');
    expect(req.body.messages[0].content).toContain('Alex');

    expect(service.diagnostics()).toMatchObject({
      configured: true,
      model: 'IFM/K2-Horizon-7B',
      lastResult: 'ok',
    });
  });

  it('caches identical cues so regenerate does not re-hit IFM', async () => {
    let calls = 0;
    const ifm = await mockIfm(() => {
      calls += 1;
      return {
        json: {
          choices: [{ message: { content: `{"title":"Call ${calls}","body":"b","cta":"c"}` } }],
        },
      };
    });
    process.env.IFM_API_URL = ifm.url;
    process.env.IFM_API_KEY = 'k';
    const service = new PromptsService();

    const first = await service.compose(input);
    const second = await service.compose(input);
    const other = await service.compose({ ...input, recipientName: 'Sam' });
    await ifm.close();

    expect(first.title).toBe('Call 1');
    expect(second.title).toBe('Call 1');
    expect(other.title).toBe('Call 2');
    expect(calls).toBe(2);
  });

  it('copes with inline <think> blocks and JSON that only appears in reasoning', async () => {
    const answers = [
      '<think>let me think {a bit}</think>\n{"title":"Think stripped","body":"b","cta":"c"}',
      '',
    ];
    const reasoning = [
      undefined,
      'Draft: {"title":"From reasoning","body":"b","cta":"c"} — that works.',
    ];
    let i = 0;
    const ifm = await mockIfm(() => {
      const idx = i++;
      return {
        json: {
          choices: [{ message: { content: answers[idx], reasoning_content: reasoning[idx] } }],
        },
      };
    });
    process.env.IFM_API_URL = ifm.url;
    process.env.IFM_API_KEY = 'k';
    const service = new PromptsService();

    const a = await service.compose(input);
    const b = await service.compose({ ...input, cue: 'Homecoming weekend' });
    await ifm.close();

    expect(a).toMatchObject({ source: 'ifm', title: 'Think stripped' });
    expect(b).toMatchObject({ source: 'ifm', title: 'From reasoning' });
  });

  it('falls back and records the error when IFM rejects or returns junk', async () => {
    let n = 0;
    const ifm = await mockIfm(() => {
      n += 1;
      return n === 1
        ? { status: 401, text: '{"error":"bad key"}' }
        : { json: { choices: [{ message: { content: 'sorry, no json here' } }] } };
    });
    process.env.IFM_API_URL = ifm.url;
    process.env.IFM_API_KEY = 'k';
    const service = new PromptsService();

    const rejected = await service.compose(input);
    expect(rejected.source).toBe('fallback');
    expect(rejected.title).toContain('game day');
    expect(service.diagnostics()).toMatchObject({ lastResult: 'error' });
    expect(service.diagnostics().lastError).toContain('401');

    const junk = await service.compose({ ...input, cue: 'Something else' });
    await ifm.close();
    expect(junk.source).toBe('fallback');
    expect(service.diagnostics().lastError).toContain('no usable JSON');
  });

  it('reports not configured when the env is unset', () => {
    const service = new PromptsService();
    expect(service.diagnostics()).toMatchObject({ configured: false, lastResult: null });
  });
});

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
