/**
 * @file test/unit/openrouter-empty-content.test.ts
 * @description An answer with no content is a failed call, not an answer. `complete()` asks again a
 *   bounded number of times and then throws with the provider's finish_reason; `reasoning` is sent
 *   to the provider exactly as given and not at all when unset.
 *
 *   Before 2026-09-09 an empty answer came back as '' with a console warning, and every caller took
 *   it as the answer: a workflow ai step wrote the empty string to its key and went green. A partner
 *   measured the cause on a reasoning model behind a 700-token cap: the cap was spent on hidden
 *   thinking, `content` came back null, the status was 200. These tests fail on the old code.
 * @usage pnpm test -- openrouter-empty-content
 * @version-history
 *   v1.0.0 — 2026-09-09 — Written with the empty-answer retry and the reasoning pass-through.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { complete, DEFAULT_EMPTY_RETRIES } from '../../src/services/openrouter.js';

let server: Server;
let port = 0;
/** Every request body the stub saw, in order. */
let seen: Array<Record<string, unknown>> = [];
/** What the stub answers next, consumed in order; the last entry repeats. */
let script: Array<{ content: string | null; finish: string }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push(JSON.parse(body) as Record<string, unknown>);
      const step = script.length > 1 ? script.shift()! : script[0];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: 'stub/empty-test',
        choices: [{ message: { content: step.content }, finish_reason: step.finish }],
        usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
      }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()));
});

beforeEach(() => { seen = []; script = []; });

// Read at call time: the port exists only once the stub is listening.
const base = () => `http://127.0.0.1:${port}/v1`;

describe('complete() on an answer with no content', () => {
  it('asks again and returns the answer that eventually came', async () => {
    script = [{ content: null, finish: 'length' }, { content: '', finish: 'stop' }, { content: 'here it is', finish: 'stop' }];
    const r = await complete(undefined, 'stub/empty-test', 'hello', undefined, base());
    expect(r.content).toBe('here it is');
    expect(r.finish_reason).toBe('stop');
    expect(seen.length).toBe(3);
  });

  it('throws after the retries are spent, naming the finish_reason and the attempts', async () => {
    script = [{ content: null, finish: 'length' }];
    await expect(complete(undefined, 'stub/empty-test', 'hello', undefined, base(), { retries: 1 }))
      .rejects.toMatchObject({ empty: true, status: 502, finish_reason: 'length', attempts: 2 });
    expect(seen.length).toBe(2);
  });

  it('the message says what a length stop on an empty answer means', async () => {
    script = [{ content: null, finish: 'length' }];
    await expect(complete(undefined, 'stub/empty-test', 'hello', undefined, base(), { retries: 0 }))
      .rejects.toThrow(/finish_reason=length.*reasoning\.enabled=false/);
    expect(seen.length).toBe(1);
  });

  it('retries defaults to DEFAULT_EMPTY_RETRIES when the caller says nothing', async () => {
    script = [{ content: '   ', finish: 'stop' }];
    await expect(complete(undefined, 'stub/empty-test', 'hello', undefined, base())).rejects.toMatchObject({ empty: true });
    expect(seen.length).toBe(DEFAULT_EMPTY_RETRIES + 1);
  });

  it('a normal answer is untouched: one request, content as it came', async () => {
    script = [{ content: 'fine', finish: 'stop' }];
    const r = await complete(undefined, 'stub/empty-test', 'hello', undefined, base());
    expect(r.content).toBe('fine');
    expect(seen.length).toBe(1);
  });
});

describe('complete() reasoning pass-through', () => {
  it('sends the reasoning object exactly as given', async () => {
    script = [{ content: 'ok', finish: 'stop' }];
    await complete(undefined, 'stub/empty-test', 'hello', undefined, base(), { reasoning: { enabled: false } });
    expect(seen[0].reasoning).toEqual({ enabled: false });
  });

  it('sends nothing about reasoning when the caller set nothing', async () => {
    script = [{ content: 'ok', finish: 'stop' }];
    await complete(undefined, 'stub/empty-test', 'hello', undefined, base(), { temperature: 0.2 });
    expect('reasoning' in seen[0]).toBe(false);
    expect(seen[0].temperature).toBe(0.2);
  });
});
