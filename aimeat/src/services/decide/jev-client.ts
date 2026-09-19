/**
 * @file src/services/decide/jev-client.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One call to TypeSafe's Jev decision model, with the retry behaviour of TypeSafe's
 *   own SDKs.
 *
 *   Jev takes a state and a map of typed questions and answers each with a value and its
 *   probabilities. This module sends one request and returns the validated answers, or throws a
 *   JevError whose code says what went wrong and whether a retry could help.
 *
 *   THE RETRY LOOP IS TYPESAFE'S, NOT OURS. Retry on 408, 429, 5xx, a connection error and a
 *   per-attempt timeout; never on 400/401/403/404/422. Delay n is min(backoffMax, backoffInitial *
 *   2^n) less up to `jitter` of itself; a Retry-After (retry-after-ms, or Retry-After in seconds or
 *   as an HTTP date) within maxRetryAfterMs is waited exactly. A retry whose delay would reach the
 *   remaining total budget is not started, and the last error is thrown.
 *
 *   THE KEY LEAVES THIS PROCESS, so: safeFetch (SSRF-validated on every redirect hop), with
 *   `authorization` named as sensitive so a redirect off the origin drops it. The key is never put
 *   in an error message or detail: every string that reaches a JevError is passed through a
 *   redactor that replaces it, in case a provider echoes it back.
 *
 *   A 2xx body is validated before it is returned: every requested question must be answered with
 *   its own type and a value of the right kind. A malformed answer is JEV_BAD_RESPONSE and is not
 *   retried, because the same request would get the same answer.
 * @structure
 *   - JevRequest, JevAnswer, JevResponse: the wire shapes
 *   - JevRetryPolicy, DEFAULT_JEV_RETRY: the retry numbers (TypeSafe SDK defaults)
 *   - JevError: code, provider status, request id, retryable, parsed detail
 *   - callJev(args): one decision, retried per policy
 *   - internals: statusCode, retryAfterMs, backoffMs, redact, parseBody, validateAnswers
 * @usage
 *   import { callJev } from './jev-client.js';
 *   const res = await callJev({ url: 'https://api.typesafe.ai/v1/systemone', key, request });
 *   res.answers.topic.choice; // 'billing'
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial: the Jev client for AIMEAT.decide (TARGET-080).
 */
import { safeFetch } from '../../utils/url-validator.js';
import type { JevQuestion, JevQuestionType } from './limits.js';

/** What is sent to Jev. */
export interface JevRequest {
  model: string;
  state: unknown;
  questions: Record<string, JevQuestion>;
}

/** One answer. `noul` for noul, `choice` + probabilities + confidence for choice, `score` + legend for score. */
export interface JevAnswer {
  type: JevQuestionType;
  noul?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
  legend?: Record<string, unknown>;
}

/** What callJev returns. `attempts` counts every HTTP attempt, the successful one included. */
export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
  requestId: string | null;
  evaluationTimeMs: number | null;
  attempts: number;
}

/** Retry numbers. All times in milliseconds; `jitter` is a fraction 0..1 of the delay. */
export interface JevRetryPolicy {
  maxRetries: number;
  backoffInitialMs: number;
  backoffMaxMs: number;
  jitter: number;
  maxRetryAfterMs: number;
  attemptTimeoutMs: number;
  totalBudgetMs: number;
}

/** TypeSafe SDK defaults. */
export const DEFAULT_JEV_RETRY: JevRetryPolicy = Object.freeze({
  maxRetries: 2,
  backoffInitialMs: 500,
  backoffMaxMs: 5000,
  jitter: 0.25,
  maxRetryAfterMs: 60000,
  attemptTimeoutMs: 10000,
  totalBudgetMs: 30000,
});

/** Error codes a JevError carries. */
export type JevErrorCode =
  | 'JEV_BAD_REQUEST' | 'JEV_UNAUTHORIZED' | 'JEV_FORBIDDEN' | 'JEV_NOT_FOUND' | 'JEV_TIMEOUT'
  | 'JEV_INVALID' | 'JEV_RATE_LIMITED' | 'JEV_SERVER' | 'JEV_CONNECTION' | 'JEV_BAD_RESPONSE';

/** A failed Jev call. Never carries the key. */
export class JevError extends Error {
  code: JevErrorCode;
  /** Provider HTTP status; null for a connection error or a timeout. */
  status: number | null;
  requestId: string | null;
  retryable: boolean;
  /** Parsed error body when any (a 422 names the field). */
  detail: unknown;
  /** Retry-After the provider asked for, in ms, when it asked. Internal to the retry loop. */
  retryAfterMs: number | null;

  /**
   * @param {{code: JevErrorCode, message: string, status?: number|null, requestId?: string|null,
   *   retryable: boolean, detail?: unknown, retryAfterMs?: number|null}} f
   */
  constructor(f: {
    code: JevErrorCode; message: string; status?: number | null; requestId?: string | null;
    retryable: boolean; detail?: unknown; retryAfterMs?: number | null;
  }) {
    super(f.message);
    this.name = 'JevError';
    this.code = f.code;
    this.status = f.status ?? null;
    this.requestId = f.requestId ?? null;
    this.retryable = f.retryable;
    this.detail = f.detail;
    this.retryAfterMs = f.retryAfterMs ?? null;
  }
}

/** The fetch seam: safeFetch's signature, narrowed to what this module passes. */
export type JevFetch = (url: string, init: RequestInit & { sensitiveHeaders?: string[] }) => Promise<Response>;

/** Arguments to callJev. */
export interface CallJevArgs {
  url: string;
  key: string;
  request: JevRequest;
  policy?: Partial<JevRetryPolicy>;
  signal?: AbortSignal;
  /** Injection seams for tests. Default: safeFetch from ../../utils/url-validator.js and a real sleep/random/now. */
  fetchImpl?: JevFetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

const STATUS_CODES: Record<number, { code: JevErrorCode; retryable: boolean; what: string }> = {
  400: { code: 'JEV_BAD_REQUEST', retryable: false, what: 'refused the request as malformed' },
  401: { code: 'JEV_UNAUTHORIZED', retryable: false, what: 'did not accept the API key' },
  403: { code: 'JEV_FORBIDDEN', retryable: false, what: 'does not allow this key to use this model' },
  404: { code: 'JEV_NOT_FOUND', retryable: false, what: 'does not know this address or model' },
  408: { code: 'JEV_TIMEOUT', retryable: true, what: 'timed out on its side' },
  422: { code: 'JEV_INVALID', retryable: false, what: 'refused a field of the request (see detail)' },
  429: { code: 'JEV_RATE_LIMITED', retryable: true, what: 'is rate limiting this key' },
};

/**
 * Map an HTTP status to a code. 5xx is JEV_SERVER (retryable); any other 4xx is JEV_BAD_REQUEST.
 * @param {number} status
 * @returns {{code: JevErrorCode, retryable: boolean, what: string}}
 */
function statusCode(status: number): { code: JevErrorCode; retryable: boolean; what: string } {
  const known = STATUS_CODES[status];
  if (known) return known;
  if (status >= 500) return { code: 'JEV_SERVER', retryable: true, what: 'had a server error' };
  return { code: 'JEV_BAD_REQUEST', retryable: false, what: 'refused the request' };
}

/**
 * Retry-After the provider asked for, in ms: `retry-after-ms` first, then `Retry-After` as seconds
 * or an HTTP date. Null when absent, unreadable or negative.
 * @param {Headers} h
 * @param {number} nowMs
 * @returns {number|null}
 */
function retryAfterMs(h: Headers, nowMs: number): number | null {
  const ms = h.get('retry-after-ms');
  if (ms !== null && ms.trim() !== '') {
    const n = Number(ms);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const ra = h.get('retry-after');
  if (ra === null || ra.trim() === '') return null;
  const secs = Number(ra);
  if (Number.isFinite(secs)) return secs >= 0 ? secs * 1000 : null;
  const at = Date.parse(ra);
  if (Number.isNaN(at)) return null;
  const d = at - nowMs;
  return d >= 0 ? d : 0;
}

/**
 * Delay before retry n (0 = first retry), with jitter taken off the top.
 * @param {number} n
 * @param {JevRetryPolicy} p
 * @param {() => number} random
 * @returns {number}
 */
function backoffMs(n: number, p: JevRetryPolicy, random: () => number): number {
  const base = Math.min(p.backoffMaxMs, p.backoffInitialMs * 2 ** n);
  return base - random() * p.jitter * base;
}

/**
 * Deep-copy a value with every occurrence of the key replaced. Strings, arrays and plain objects
 * are walked; anything else is returned as is.
 * @param {unknown} v
 * @param {string} key
 * @returns {unknown}
 */
function redact(v: unknown, key: string): unknown {
  if (!key) return v;
  if (typeof v === 'string') return v.split(key).join('[redacted]');
  if (Array.isArray(v)) return v.map(x => redact(x, key));
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[redact(k, key) as string] = redact(x, key);
    return out;
  }
  return v;
}

/** JSON when it parses, the text (capped) when it does not, undefined when empty. */
function parseBody(text: string): { json: unknown; ok: boolean } {
  if (text.trim() === '') return { json: undefined, ok: false };
  try {
    return { json: JSON.parse(text) as unknown, ok: true };
  } catch {
    return { json: text.slice(0, 2000), ok: false };
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Check a 2xx body. Returns a reason string when it is not a usable answer, else null.
 * @param {unknown} body
 * @param {Record<string, JevQuestion>} questions
 * @returns {string|null}
 */
function validateAnswers(body: unknown, questions: Record<string, JevQuestion>): string | null {
  if (!isObj(body)) return 'the body is not a JSON object';
  if (typeof body.model !== 'string') return "the body has no 'model' string";
  if (!isObj(body.answers)) return "the body has no 'answers' object";
  if (!isObj(body.usage) || typeof body.usage.input_tokens !== 'number') return "the body has no 'usage.input_tokens' number";
  for (const [id, q] of Object.entries(questions)) {
    const a = body.answers[id];
    if (!isObj(a)) return `question '${id}' has no answer`;
    if (a.type !== q.type) return `question '${id}' was asked as ${q.type} and answered as ${String(a.type)}`;
    if (q.type === 'noul' && typeof a.noul !== 'number') return `question '${id}' has no numeric noul`;
    if (q.type === 'choice' && typeof a.choice !== 'string') return `question '${id}' has no choice`;
    if (q.type === 'score' && typeof a.score !== 'number') return `question '${id}' has no numeric score`;
  }
  return null;
}

/** Copy the documented fields of one answer; drops anything else the provider added. */
function toAnswer(a: Record<string, unknown>): JevAnswer {
  const out: JevAnswer = { type: a.type as JevQuestionType };
  if (typeof a.noul === 'number') out.noul = a.noul;
  if (typeof a.choice === 'string') out.choice = a.choice;
  if (typeof a.score === 'number') out.score = a.score;
  if (isObj(a.probabilities)) out.probabilities = a.probabilities as Record<string, number>;
  if (typeof a.confidence === 'number') out.confidence = a.confidence;
  if (isObj(a.legend)) out.legend = a.legend;
  return out;
}

const realSleep = (ms: number): Promise<void> => new Promise(r => { setTimeout(r, ms); });

/**
 * One HTTP attempt. Resolves with the response, or throws a JevError.
 * @returns {Promise<JevResponse>}
 */
async function attempt(a: {
  url: string; key: string; body: string; request: JevRequest; timeoutMs: number;
  signal?: AbortSignal; fetchImpl: JevFetch; now: () => number; attempts: number;
}): Promise<JevResponse> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, a.timeoutMs);
  const onOuter = (): void => ctl.abort();
  a.signal?.addEventListener('abort', onOuter, { once: true });
  let res: Response;
  let text: string;
  try {
    res = await a.fetchImpl(a.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${a.key}`, 'content-type': 'application/json' },
      body: a.body,
      signal: ctl.signal,
      sensitiveHeaders: ['authorization'],
    });
    text = await res.text();
  } catch (err) {
    if (a.signal?.aborted) {
      throw new JevError({ code: 'JEV_CONNECTION', message: 'The caller cancelled the decision request.', retryable: false });
    }
    if (timedOut) {
      throw new JevError({ code: 'JEV_TIMEOUT', retryable: true,
        message: `TypeSafe did not answer within ${a.timeoutMs} ms.` });
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new JevError({ code: 'JEV_CONNECTION', retryable: true,
      message: `Could not reach TypeSafe: ${redact(reason, a.key) as string}` });
  } finally {
    clearTimeout(timer);
    a.signal?.removeEventListener('abort', onOuter);
  }

  const parsed = parseBody(text);
  const bodyObj = isObj(parsed.json) ? parsed.json : null;
  const requestId = (typeof bodyObj?.request_id === 'string' ? bodyObj.request_id : null)
    ?? res.headers.get('x-typesafe-request-id') ?? null;

  if (res.status < 200 || res.status >= 300) {
    const m = statusCode(res.status);
    throw new JevError({
      code: m.code, status: res.status, requestId, retryable: m.retryable,
      detail: redact(parsed.json, a.key),
      retryAfterMs: retryAfterMs(res.headers, a.now()),
      message: `TypeSafe ${m.what} (HTTP ${res.status}).`,
    });
  }

  const problem = parsed.ok ? validateAnswers(parsed.json, a.request.questions) : 'the body is not JSON';
  if (problem !== null || !bodyObj) {
    throw new JevError({
      code: 'JEV_BAD_RESPONSE', status: res.status, requestId, retryable: false,
      detail: redact(parsed.json, a.key),
      message: `TypeSafe answered, but ${problem ?? 'the body is not a JSON object'}.`,
    });
  }
  const answersIn = bodyObj.answers as Record<string, Record<string, unknown>>;
  const answers: Record<string, JevAnswer> = {};
  for (const [id, ans] of Object.entries(answersIn)) if (isObj(ans)) answers[id] = toAnswer(ans);
  const usage = bodyObj.usage as Record<string, unknown>;
  return {
    model: bodyObj.model as string,
    answers,
    usage: {
      input_tokens: usage.input_tokens as number,
      output_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
    },
    requestId,
    evaluationTimeMs: typeof bodyObj.evaluation_time_ms === 'number' ? bodyObj.evaluation_time_ms : null,
    attempts: a.attempts,
  };
}

/**
 * Send one decision request to Jev, retrying per policy.
 * @param {CallJevArgs} args
 * @returns {Promise<JevResponse>}
 * @throws {JevError}
 */
export async function callJev(args: CallJevArgs): Promise<JevResponse> {
  const policy: JevRetryPolicy = { ...DEFAULT_JEV_RETRY, ...args.policy };
  const fetchImpl: JevFetch = args.fetchImpl ?? ((u, init) => safeFetch(u, init));
  const sleep = args.sleep ?? realSleep;
  const random = args.random ?? Math.random;
  const now = args.now ?? Date.now;
  const body = JSON.stringify(args.request);
  const started = now();
  let attempts = 0;

  for (let retry = 0; ; retry++) {
    attempts++;
    try {
      return await attempt({
        url: args.url, key: args.key, body, request: args.request, timeoutMs: policy.attemptTimeoutMs,
        signal: args.signal, fetchImpl, now, attempts,
      });
    } catch (err) {
      if (!(err instanceof JevError)) throw err;
      if (!err.retryable || retry >= policy.maxRetries) throw err;
      const asked = err.retryAfterMs;
      const delay = asked !== null && asked <= policy.maxRetryAfterMs ? asked : backoffMs(retry, policy, random);
      const remaining = policy.totalBudgetMs - (now() - started);
      if (delay >= remaining) throw err;
      await sleep(delay);
      if (args.signal?.aborted) {
        throw new JevError({ code: 'JEV_CONNECTION', message: 'The caller cancelled the decision request.', retryable: false });
      }
    }
  }
}
