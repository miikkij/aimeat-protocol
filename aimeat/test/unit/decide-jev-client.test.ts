/**
 * @file test/unit/decide-jev-client.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Jev client against a fake fetch and a fake clock: success, Retry-After honoured,
 *   5xx retried then given up, 422 not retried, per-attempt timeout retried, a malformed answer
 *   refused, and the key absent from every error.
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { callJev, JevError, type JevFetch, type JevRequest } from '../../src/services/decide/jev-client.js';

const KEY = 'ts_live_SECRETKEY_0123456789';
const ENDPOINT ='https://api.typesafe.ai/v1/systemone';
const request: JevRequest = {
  model: 'jev-1',
  state: { from: '[PERSON_1]', body: 'The invoice is twice what we agreed.' },
  questions: {
    urgent: { type: 'noul', instructions: 'Does this need an answer today?' },
    topic: { type: 'choice', instructions: 'Which team?', criteria: { billing: null, support: null } },
    tone: { type: 'score', instructions: 'How upset?', criteria: ['calm', 'annoyed', 'angry'] },
  },
};
const okBody = {
  model: 'jev-1-2026-09-01',
  answers: {
    urgent: { type: 'noul', noul: 0.82 },
    topic: { type: 'choice', choice: 'billing', probabilities: { billing: 0.9, support: 0.1 }, confidence: 0.8 },
    tone: { type: 'score', score: 2, legend: { 1: 'calm', 2: 'annoyed', 3: 'angry' }, probabilities: { 1: 0.2, 2: 0.7, 3: 0.1 }, confidence: 0.6 },
  },
  usage: { input_tokens: 120, output_tokens: 3 },
  request_id: 'req_body',
  evaluation_time_ms: 41,
};
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A fake fetch that answers from a script, one entry per call, and records what it was given. */
function script(steps: Array<Response | 'hang' | Error>) {
  const calls: Array<{ url: string; init: Parameters<JevFetch>[1] }> = [];
  const fetchImpl: JevFetch = (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step === 'hang') {
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
    if (step instanceof Error) return Promise.reject(step);
    return Promise.resolve(step.clone());
  };
  return { calls, fetchImpl };
}
function fakeClock() {
  let t = 1_000_000;
  const slept: number[] = [];
  return { slept, now: () => t, sleep: (ms: number) => { slept.push(ms); t += ms; return Promise.resolve(); } };
}
async function failure(p: Promise<unknown>): Promise<JevError> {
  try { await p; } catch (e) { if (e instanceof JevError) return e; throw e; }
  throw new Error('expected a JevError');
}
function noKey(e: JevError) {
  expect(e.message).not.toContain(KEY);
  expect(JSON.stringify(e.detail) ?? '').not.toContain(KEY);
  expect(String(e)).not.toContain(KEY);
  expect(e.stack ?? '').not.toContain(KEY);
}

describe('callJev', () => {
  it('returns the validated answers and sends the call the SDKs send', async () => {
    const { calls, fetchImpl } = script([json(200, okBody, { 'x-typesafe-request-id': 'req_header' })]);
    const c = fakeClock();
    const res = await callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, ...c });
    expect(res).toMatchObject({ model: 'jev-1-2026-09-01', requestId: 'req_body', evaluationTimeMs: 41, attempts: 1,
      usage: { input_tokens: 120, output_tokens: 3 } });
    expect(res.answers.topic).toEqual(okBody.answers.topic);
    expect(res.answers.urgent.noul).toBe(0.82);
    expect(calls[0].url).toBe(ENDPOINT);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({ authorization: `Bearer ${KEY}`, 'content-type': 'application/json' });
    expect(calls[0].init.sensitiveHeaders).toEqual(['authorization']);
    expect(JSON.parse(calls[0].init.body as string)).toEqual(request);
    expect(c.slept).toEqual([]);
  });

  it('takes the request id from the header when the body has none', async () => {
    const { request_id: _drop, ...noId } = okBody;
    void _drop;
    const { fetchImpl } = script([json(200, noId, { 'x-typesafe-request-id': 'req_header' })]);
    const res = await callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, ...fakeClock() });
    expect(res.requestId).toBe('req_header');
  });

  it('honours retry-after-ms on a 429, then succeeds', async () => {
    const { calls, fetchImpl } = script([json(429, { error: 'slow down' }, { 'retry-after-ms': '1234' }), json(200, okBody)]);
    const c = fakeClock();
    const res = await callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, ...c });
    expect(calls).toHaveLength(2);
    expect(c.slept).toEqual([1234]);
    expect(res.attempts).toBe(2);
  });

  it('honours Retry-After in seconds', async () => {
    const { fetchImpl } = script([json(429, {}, { 'retry-after': '3' }), json(200, okBody)]);
    const c = fakeClock();
    await callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, ...c });
    expect(c.slept).toEqual([3000]);
  });

  it('gives up on 503 after three attempts with JEV_SERVER, backing off 500 then 1000 less jitter', async () => {
    const { calls, fetchImpl } = script([json(503, { error: 'down' }, { 'x-typesafe-request-id': 'req_503' })]);
    const c = fakeClock();
    const e = await failure(callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, random: () => 0.5, ...c }));
    expect(calls).toHaveLength(3);
    expect(e).toMatchObject({ code: 'JEV_SERVER', status: 503, retryable: true, requestId: 'req_503' });
    expect(c.slept).toEqual([500 - 0.5 * 0.25 * 500, 1000 - 0.5 * 0.25 * 1000]);
    noKey(e);
  });

  it('does not retry a 422 and carries the provider detail', async () => {
    const detail = { detail: [{ loc: ['body', 'questions', 'topic', 'criteria'], msg: 'too many options' }] };
    const { calls, fetchImpl } = script([json(422, detail)]);
    const c = fakeClock();
    const e = await failure(callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, ...c }));
    expect(calls).toHaveLength(1);
    expect(e).toMatchObject({ code: 'JEV_INVALID', status: 422, retryable: false });
    expect(e.detail).toEqual(detail);
    expect(c.slept).toEqual([]);
  });

  it('does not retry 400, 401, 403 or 404', async () => {
    for (const [status, code] of [[400, 'JEV_BAD_REQUEST'], [401, 'JEV_UNAUTHORIZED'], [403, 'JEV_FORBIDDEN'], [404, 'JEV_NOT_FOUND']] as const) {
      const { calls, fetchImpl } = script([json(status, { error: 'no' })]);
      const e = await failure(callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, ...fakeClock() }));
      expect(calls).toHaveLength(1);
      expect(e.code).toBe(code);
    }
  });

  it('retries a per-attempt timeout, then succeeds', async () => {
    const { calls, fetchImpl } = script(['hang', json(200, okBody)]);
    const c = fakeClock();
    const res = await callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, policy: { attemptTimeoutMs: 20 }, random: () => 0, ...c });
    expect(calls).toHaveLength(2);
    expect(calls[0].init.signal?.aborted).toBe(true);
    expect(c.slept).toEqual([500]);
    expect(res.attempts).toBe(2);
  });

  it('reports JEV_TIMEOUT when every attempt times out', async () => {
    const { calls, fetchImpl } = script(['hang']);
    const e = await failure(callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, policy: { attemptTimeoutMs: 10, maxRetries: 1 }, ...fakeClock() }));
    expect(calls).toHaveLength(2);
    expect(e).toMatchObject({ code: 'JEV_TIMEOUT', status: null, retryable: true });
  });

  it('retries a connection error and never repeats the key the error carried', async () => {
    const { calls, fetchImpl } = script([new Error(`socket hang up while sending Bearer ${KEY}`)]);
    const e = await failure(callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, ...fakeClock() }));
    expect(calls).toHaveLength(3);
    expect(e.code).toBe('JEV_CONNECTION');
    expect(e.message).toContain('[redacted]');
    noKey(e);
  });

  it('stops before a retry that would outrun the total budget', async () => {
    const { calls, fetchImpl } = script([json(429, {}, { 'retry-after-ms': '25000' }), json(429, {}, { 'retry-after-ms': '25000' })]);
    const c = fakeClock();
    const e = await failure(callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, ...c }));
    expect(calls).toHaveLength(2);
    expect(c.slept).toEqual([25000]);
    expect(e.code).toBe('JEV_RATE_LIMITED');
  });

  it('ignores a Retry-After longer than maxRetryAfterMs and backs off instead', async () => {
    const { fetchImpl } = script([json(429, {}, { 'retry-after-ms': '90000' }), json(200, okBody)]);
    const c = fakeClock();
    await callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, random: () => 0, ...c });
    expect(c.slept).toEqual([500]);
  });

  it('refuses a malformed answer without retrying', async () => {
    const cases: unknown[] = [
      { ...okBody, answers: { urgent: okBody.answers.urgent, topic: okBody.answers.topic } },
      { ...okBody, answers: { ...okBody.answers, tone: { type: 'choice', choice: 'x' } } },
      { ...okBody, usage: {} },
      { ...okBody, model: 7 },
      [],
    ];
    for (const body of cases) {
      const { calls, fetchImpl } = script([json(200, body)]);
      const e = await failure(callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, ...fakeClock() }));
      expect(calls).toHaveLength(1);
      expect(e).toMatchObject({ code: 'JEV_BAD_RESPONSE', retryable: false });
    }
    const { fetchImpl } = script([new Response('<html>oops</html>', { status: 200 })]);
    expect((await failure(callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, ...fakeClock() }))).code).toBe('JEV_BAD_RESPONSE');
  });

  it('never puts the key in an error, even when the provider echoes it', async () => {
    const echo = { error: `invalid key ${KEY}`, [KEY]: [KEY] };
    for (const status of [401, 422, 500, 200]) {
      const { fetchImpl } = script([json(status, echo)]);
      const e = await failure(callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, policy: { maxRetries: 0 }, ...fakeClock() }));
      expect(e).toBeInstanceOf(JevError);
      noKey(e);
    }
  });

  it('stops when the caller cancels', async () => {
    const ctl = new AbortController();
    const { calls, fetchImpl } = script(['hang']);
    const p = failure(callJev({ url: ENDPOINT, key: KEY, request, fetchImpl, signal: ctl.signal, ...fakeClock() }));
    ctl.abort();
    const e = await p;
    expect(calls).toHaveLength(1);
    expect(e).toMatchObject({ code: 'JEV_CONNECTION', retryable: false });
  });
});
