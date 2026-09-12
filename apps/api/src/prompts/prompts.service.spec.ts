import * as http from 'node:http';
import { PromptsService } from './prompts.service';

const openServers = new Set<http.Server>();
afterEach(async () => {
  // A failed assertion must not leave a mock server holding jest open.
  await Promise.all(
    [...openServers].map(
      (server) =>
        new Promise<void>((r) => {
          server.closeAllConnections?.();
          server.close(() => r());
        }),
    ),
  );
  openServers.clear();
});

/** A stand-in for an OpenAI-compatible K2 Horizon server. */
function mockIfm(
  handler: (body: any) => { status?: number; json?: unknown; text?: string },
  options: { models?: string[] | null } = {},
): Promise<{ url: string; close: () => Promise<void>; requests: any[]; modelCalls: () => number }> {
  const requests: any[] = [];
  let modelCalls = 0;
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET' && req.url?.endsWith('/models')) {
          modelCalls += 1;
          if (options.models === undefined || options.models === null) {
            res.statusCode = 404;
            res.end('{"error":"no such route"}');
            return;
          }
          res.statusCode = 200;
          res.end(JSON.stringify({ object: 'list', data: options.models.map((id) => ({ id })) }));
          return;
        }
        const body = raw ? JSON.parse(raw) : {};
        requests.push({ path: req.url, auth: req.headers.authorization, body });
        const out = handler(body);
        res.statusCode = out.status ?? 200;
        res.end(out.text ?? JSON.stringify(out.json ?? {}));
      });
    });
    openServers.add(server);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        requests,
        modelCalls: () => modelCalls,
        close: () =>
          new Promise((r) => {
            openServers.delete(server);
            server.closeAllConnections?.();
            server.close(() => r());
          }),
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
    expect(service.diagnostics().usage).toEqual({
      callsOk: 0,
      callsFailed: 0,
      cacheHits: 0,
      jobs: { alertCopy: 0, curation: 0, shelfCopy: 0 },
    });
  });

  it('uses the endpoint\u2019s own ID for the K2 model when IFM_MODEL is not served there', async () => {
    const ok = { json: { choices: [{ message: { content: '{"title":"t","body":"b","cta":"c"}' } }] } };

    // Same weights, different naming: prefer the matching tail.
    const tail = await mockIfm(() => ok, { models: ['gpt-4o-mini', 'k2-horizon-7b', 'k2-horizon-32b'] });
    process.env.IFM_API_URL = tail.url;
    process.env.IFM_API_KEY = 'k';
    let service = new PromptsService();
    await service.compose(input);
    expect(tail.requests[0].body.model).toBe('k2-horizon-7b');
    expect(service.diagnostics()).toMatchObject({
      model: 'IFM/K2-Horizon-7B',
      resolvedModel: 'k2-horizon-7b',
      availableModels: ['gpt-4o-mini', 'k2-horizon-7b', 'k2-horizon-32b'],
    });
    expect(service.diagnostics().modelHint).toContain('IFM_MODEL=k2-horizon-7b');
    await service.compose({ ...input, cue: 'another' });
    expect(tail.modelCalls()).toBe(1); // list is cached
    await tail.close();

    // Only other K2 sizes: take the smallest.
    const sizes = await mockIfm(() => ok, { models: ['IFM/K2-Horizon-32B', 'IFM/K2-Horizon-3.7B'] });
    process.env.IFM_API_URL = sizes.url;
    service = new PromptsService();
    await service.compose(input);
    expect(sizes.requests[0].body.model).toBe('IFM/K2-Horizon-3.7B');
    await sizes.close();

    // No K2 at all: keep IFM_MODEL and say what is there.
    const none = await mockIfm(() => ({ status: 400, text: '{"error":{"message":"token model is not configured"}}' }), {
      models: ['llama-3', 'mistral'],
    });
    process.env.IFM_API_URL = none.url;
    service = new PromptsService();
    const result = await service.compose(input);
    expect(result.source).toBe('fallback');
    expect(none.requests[0].body.model).toBe('IFM/K2-Horizon-7B');
    const diag = service.diagnostics();
    expect(diag.modelHint).toContain('no K2 model is listed');
    expect(diag.modelHint).toContain('llama-3');
    expect(diag.lastError).toContain('model "IFM/K2-Horizon-7B"');
    await none.close();

    // Endpoint has no /models route: send IFM_MODEL as-is, no hint.
    const bare = await mockIfm(() => ok);
    process.env.IFM_API_URL = bare.url;
    service = new PromptsService();
    await service.compose(input);
    expect(bare.requests[0].body.model).toBe('IFM/K2-Horizon-7B');
    expect(service.diagnostics().availableModels).toBeUndefined();
    expect(service.diagnostics().modelHint).toBeUndefined();
    await bare.close();
  });

  it('drops chat_template_kwargs for gateways that reject unknown fields, and remembers', async () => {
    const ifm = await mockIfm((body) =>
      body.chat_template_kwargs
        ? { status: 400, text: '{"error":{"message":"unknown field chat_template_kwargs"}}' }
        : { json: { choices: [{ message: { content: '{"title":"Strict ok","body":"b","cta":"c"}' } }] } },
    );
    process.env.IFM_API_URL = ifm.url;
    process.env.IFM_API_KEY = 'k';
    const service = new PromptsService();

    const first = await service.compose(input);
    const second = await service.compose({ ...input, cue: 'second cue' });
    await ifm.close();

    expect(first).toMatchObject({ source: 'ifm', title: 'Strict ok' });
    expect(second.source).toBe('ifm');
    expect(ifm.requests.map((r) => Boolean(r.body.chat_template_kwargs))).toEqual([true, false, false]);
    expect(service.diagnostics().usage).toMatchObject({ callsOk: 2, callsFailed: 0 });
  });

  it('curates a batch of headlines in one call and validates the verdicts', async () => {
    const ifm = await mockIfm(() => ({
      json: {
        choices: [
          {
            message: {
              reasoning_content: 'Item 0 is admin news [not fun].',
              content:
                '[{"i":0,"kind":"news","stashable":false,"score":1},' +
                '{"i":1,"kind":"athletics","stashable":true,"score":9},' +
                '{"i":2,"kind":"made-up","stashable":true,"score":99},' +
                '{"i":7,"kind":"food","stashable":true,"score":5},' +
                '{"i":1,"kind":"food","stashable":true,"score":2}]',
            },
          },
        ],
      },
    }));
    process.env.IFM_API_URL = ifm.url;
    process.env.IFM_API_KEY = 'k';
    const service = new PromptsService();

    const items = [
      { cue: 'University announces new provost', sourceLabel: 'news' },
      { cue: 'Pitt tops Backyard Brawl', sourceLabel: 'news' },
      { cue: 'Late-night dumpling run', sourceLabel: 'r/nyu' },
    ];
    const verdicts = await service.curate('University of Pittsburgh', items);
    const again = await service.curate('University of Pittsburgh', items);
    await ifm.close();

    expect(verdicts).toEqual([
      { index: 0, kind: 'news', stashable: false, score: 1 },
      { index: 1, kind: 'athletics', stashable: true, score: 9 },
      { index: 2, kind: 'news', stashable: true, score: 10 },
    ]);
    expect(again).toEqual(verdicts);
    expect(ifm.requests).toHaveLength(1);
    expect(ifm.requests[0].body.messages[1].content).toContain('0. [news] University announces new provost');
    expect(service.diagnostics().usage).toMatchObject({
      callsOk: 1,
      cacheHits: 1,
      jobs: { curation: 1 },
    });
  });

  it('keeps the rules when K2 curates too few items or is unset', async () => {
    const ifm = await mockIfm(() => ({
      json: { choices: [{ message: { content: '[{"i":0,"kind":"news","stashable":true,"score":3}]' } }] },
    }));
    process.env.IFM_API_URL = ifm.url;
    process.env.IFM_API_KEY = 'k';
    const service = new PromptsService();
    const items = [1, 2, 3, 4].map((n) => ({ cue: `headline ${n}`, sourceLabel: 'news' }));
    expect(await service.curate('X', items)).toBeNull();
    await ifm.close();

    delete process.env.IFM_API_URL;
    expect(await new PromptsService().curate('X', items)).toBeNull();
  });

  it('rewrites shelf cards, keeps ids, and leaves cards untouched when unset or unusable', async () => {
    const cards = [
      {
        id: 'sky-wet-1',
        kind: 'tier1' as const,
        emotion: 'weather' as const,
        friendName: 'Maya',
        title: 'Rainy in Pittsburgh',
        body: "54° and rainy on Maya. It's clear here. Take a picture of your sky and send it over.",
      },
      {
        id: 'fschool-1',
        kind: 'tier1' as const,
        emotion: 'stress' as const,
        friendName: 'Maya',
        title: 'Maya: Finals in 3 days',
        body: "University of Pittsburgh. Stash something Maya opens when it's over.",
      },
      {
        id: 'ritual-1',
        kind: 'tier0' as const,
        emotion: 'milestone' as const,
        title: 'Sunday dinner',
        body: 'After Sunday dinner, stash something for Maya.',
      },
    ];

    const unset = await new PromptsService().shelfCopy(cards);
    expect(unset.map((c) => c.source)).toEqual(['fallback', 'fallback', 'fallback']);
    expect(unset[0]).toMatchObject({ id: 'sky-wet-1', title: 'Rainy in Pittsburgh' });

    const ifm = await mockIfm((body) => {
      const draft: string = body.messages[1].content;
      if (draft.includes('Sunday dinner')) {
        return { json: { choices: [{ message: { content: 'no json for you' } }] } };
      }
      const title = draft.includes('Rainy') ? 'Maya is under 54° of rain' : "Three days to Maya's finals";
      return {
        json: {
          choices: [{ message: { content: JSON.stringify({ title, body: `Rewritten: ${title}.` }) } }],
        },
      };
    });
    process.env.IFM_API_URL = ifm.url;
    process.env.IFM_API_KEY = 'k';
    const service = new PromptsService();

    const out = await service.shelfCopy(cards);
    const cached = await service.shelfCopy(cards);
    await ifm.close();

    expect(out.map((c) => c.id)).toEqual(['sky-wet-1', 'fschool-1', 'ritual-1']);
    expect(out[0]).toMatchObject({ source: 'ifm', title: 'Maya is under 54° of rain' });
    expect(out[1]).toMatchObject({ source: 'ifm', title: "Three days to Maya's finals" });
    expect(out[2]).toMatchObject({ source: 'fallback', title: 'Sunday dinner' });
    expect(cached.slice(0, 2)).toEqual(out.slice(0, 2));

    const systems = ifm.requests.map((r) => r.body.messages[0].content as string);
    expect(systems.some((s) => s.includes('weather, daylight or the time of day'))).toBe(true);
    expect(systems.some((s) => s.includes('stressful stretch'))).toBe(true);
    expect(systems.every((s) => s.includes('Keep every fact'))).toBe(true);
    expect(service.diagnostics().usage.jobs.shelfCopy).toBe(2);
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
