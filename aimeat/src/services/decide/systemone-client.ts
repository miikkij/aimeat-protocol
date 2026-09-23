/**
 * @file src/services/decide/systemone-client.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One call to a System One decision model (`POST /v1/systemone`), with the retry
 *   behaviour of TypeSafe's own SDKs. TypeSafe's Jev is one provider of this wire format; Laya, von,
 *   jeff and others serve it too (services/decide/providers.ts).
 *
 *   A provider takes a state and a map of typed questions and answers each with a value and its
 *   probabilities. This module sends one request and returns the validated answers, or throws a
 *   SystemOneError whose code says what went wrong and whether a retry could help. The codes keep
 *   their JEV_ names: they were the contract before there was more than one provider.
 *
 *   A PROVIDER THAT DEVIATES GETS AN ADAPTER, and the adapter is the only place the difference is
 *   visible. The request is the same for every provider; an adapter may only reshape the answer
 *   into the common form before it is checked. Measured on 2026-09-23: Laya names itself
 *   `laya-rl-agent` whatever checkpoint answered and puts the checkpoint in `routing.model`.
 *
 *   A LOCAL PROVIDER HAS NO KEY: `key` is null and no authorization header is sent.
 *
 *   THE RETRY LOOP IS TYPESAFE'S, NOT OURS. Retry on 408, 429, 5xx, a connection error and a
 *   per-attempt timeout; never on 400/401/403/404/422. Delay n is min(backoffMax, backoffInitial *
 *   2^n) less up to `jitter` of itself; a Retry-After (retry-after-ms, or Retry-After in seconds or
 *   as an HTTP date) within maxRetryAfterMs is waited exactly. A retry whose delay would reach the
 *   remaining total budget is not started, and the last error is thrown.
 *
 *   THE KEY LEAVES THIS PROCESS, so: safeFetch (SSRF-validated on every redirect hop), with
 *   `authorization` named as sensitive so a redirect off the origin drops it. The key is never put
 *   in an error message or detail: every string that reaches a SystemOneError is passed through a
 *   redactor that replaces it, in case a provider echoes it back.
 *
 *   A 2xx body is validated before it is returned: every requested question must be answered with
 *   its own type and a value of the right kind. A malformed answer is JEV_BAD_RESPONSE and is not
 *   retried, because the same request would get the same answer.
 * @structure
 *   - SystemOneRequest, SystemOneAnswer, SystemOneResponse: the wire shapes
 *   - SystemOneRetryPolicy, DEFAULT_SYSTEMONE_RETRY: the retry numbers (TypeSafe SDK defaults)
 *   - SystemOneError: code, provider status, request id, retryable, parsed detail
 *   - SYSTEMONE_ADAPTERS: the answer reshapers, by name
 *   - callSystemOne(args): one decision, retried per policy
 *   - internals: statusCode, retryAfterMs, backoffMs, redact, parseBody, validateAnswers
 * @usage
 *   import { callSystemOne } from './systemone-client.js';
 *   const res = await callSystemOne({ url: 'https://api.typesafe.ai/v1/systemone', key, request, providerName: 'TypeSafe' });
 *   res.answers.topic.choice; // 'billing'
 * @version-history
 *   v2.0.0 — 2026-09-23 — The generic System One client (was jev-client.ts): any provider, a null key
 *     for a local one, the provider's name in every message, and an adapter hook for the answer.
 *   v1.0.0 — 2026-09-19 — Initial: the Jev client for AIMEAT.decide (TARGET-080).
 */
import { safeFetch } from '../../utils/url-validator.js';
import type { JevQuestion, JevQuestionType } from './limits.js';

/** What is sent to Jev. */
export interface SystemOneRequest {
  model: string;
  state: unknown;
  questions: Record<string, JevQuestion>;
}

/** One answer. `noul` for noul, `choice` + probabilities + confidence for choice, `score` + legend for score. */
export interface SystemOneAnswer {
  type: JevQuestionType;
  noul?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
  legend?: Record<string, unknown>;
}

/** What callSystemOne returns. `attempts` counts every HTTP attempt, the successful one included. */
export interface SystemOneResponse {
  model: string;
  answers: Record<string, SystemOneAnswer>;
  usage: { input_tokens: number; output_tokens: number };
  requestId: string | null;
  evaluationTimeMs: number | null;
  attempts: number;
}

/** Retry numbers. All times in milliseconds; `jitter` is a fraction 0..1 of the delay. */
export interface SystemOneRetryPolicy {
  maxRetries: number;
  backoffInitialMs: number;
  backoffMaxMs: number;
  jitter: number;
  maxRetryAfterMs: number;
  attemptTimeoutMs: number;
  totalBudgetMs: number;
}

/** TypeSafe SDK defaults. */
export const DEFAULT_SYSTEMONE_RETRY: SystemOneRetryPolicy = Object.freeze({
  maxRetries: 2,
  backoffInitialMs: 500,
  backoffMaxMs: 5000,
  jitter: 0.25,
  maxRetryAfterMs: 60000,
  attemptTimeoutMs: 10000,
  totalBudgetMs: 30000,
});

/** Error codes a SystemOneError carries. */
export type SystemOneErrorCode =
  | 'JEV_BAD_REQUEST' | 'JEV_UNAUTHORIZED' | 'JEV_FORBIDDEN' | 'JEV_NOT_FOUND' | 'JEV_TIMEOUT'
  | 'JEV_INVALID' | 'JEV_RATE_LIMITED' | 'JEV_SERVER' | 'JEV_CONNECTION' | 'JEV_BAD_RESPONSE';

/** A failed Jev call. Never carries the key. */
export class SystemOneError extends Error {
  code: SystemOneErrorCode;
  /** Provider HTTP status; null for a connection error or a timeout. */
  status: number | null;
  requestId: string | null;
  retryable: boolean;
  /** Parsed error body when any (a 422 names the field). */
  detail: unknown;
  /** Retry-After the provider asked for, in ms, when it asked. Internal to the retry loop. */
  retryAfterMs: number | null;

  /**
   * @param {{code: SystemOneErrorCode, message: string, status?: number|null, requestId?: string|null,
   *   retryable: boolean, detail?: unknown, retryAfterMs?: number|null}} f
   */
  constructor(f: {
    code: SystemOneErrorCode; message: string; status?: number | null; requestId?: string | null;
    retryable: boolean; detail?: unknown; retryAfterMs?: number | null;
  }) {
    super(f.message);
    this.name = 'SystemOneError';
    this.code = f.code;
    this.status = f.status ?? null;
    this.requestId = f.requestId ?? null;
    this.retryable = f.retryable;
    this.detail = f.detail;
    this.retryAfterMs = f.retryAfterMs ?? null;
  }
}

/** The fetch seam: safeFetch's signature, narrowed to what this module passes. */
export type SystemOneFetch = (url: string, init: RequestInit & { sensitiveHeaders?: string[] }) => Promise<Response>;

/** Arguments to callSystemOne. */
export interface CallSystemOneArgs {
  url: string;
  /** The bearer key, or null for a provider that takes none (a local one). */
  key: string | null;
  request: SystemOneRequest;
  /** Who is being asked, in the provider's own name, for every message a person may read. */
  providerName?: string;
  /** The name of an entry in SYSTEMONE_ADAPTERS, for a provider whose answer deviates. */
  adapter?: string;
  policy?: Partial<SystemOneRetryPolicy>;
  signal?: AbortSignal;
  /** Injection seams for tests. Default: safeFetch from ../../utils/url-validator.js and a real sleep/random/now. */
  fetchImpl?: SystemOneFetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

const STATUS_CODES: Record<number, { code: SystemOneErrorCode; retryable: boolean; what: string }> = {
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
 * @returns {{code: SystemOneErrorCode, retryable: boolean, what: string}}
 */
function statusCode(status: number): { code: SystemOneErrorCode; retryable: boolean; what: string } {
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
 * @param {SystemOneRetryPolicy} p
 * @param {() => number} random
 * @returns {number}
 */
function backoffMs(n: number, p: SystemOneRetryPolicy, random: () => number): number {
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
function redact(v: unknown, key: string | null): unknown {
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
function toAnswer(a: Record<string, unknown>): SystemOneAnswer {
  const out: SystemOneAnswer = { type: a.type as JevQuestionType };
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
 * The answer reshapers. Each takes the parsed 2xx body and returns it in the common form; it never
 * sees the request, so no provider gets a request of its own.
 */
export const SYSTEMONE_ADAPTERS: Readonly<Record<string, (body: Record<string, unknown>) => Record<string, unknown>>> = Object.freeze({
  // Laya 0.3.7 answers `model: "laya-rl-agent"` for every checkpoint and names the one that answered
  // in `routing.model`. The record pins the model that answered, so that is the one it must name.
  laya: (body) => {
    const routed = isObj(body.routing) && typeof body.routing.model === 'string' ? body.routing.model : null;
    return routed ? { ...body, model: routed } : body;
  },
});

/**
 * One HTTP attempt. Resolves with the response, or throws a SystemOneError.
 * @returns {Promise<SystemOneResponse>}
 */
async function attempt(a: {
  url: string; key: string | null; body: string; request: SystemOneRequest; timeoutMs: number; name: string;
  adapter?: (body: Record<string, unknown>) => Record<string, unknown>;
  signal?: AbortSignal; fetchImpl: SystemOneFetch; now: () => number; attempts: number;
}): Promise<SystemOneResponse> {
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
      headers: a.key
        ? { authorization: `Bearer ${a.key}`, 'content-type': 'application/json' }
        : { 'content-type': 'application/json' },
      body: a.body,
      signal: ctl.signal,
      sensitiveHeaders: ['authorization'],
    });
    text = await res.text();
  } catch (err) {
    if (a.signal?.aborted) {
      throw new SystemOneError({ code: 'JEV_CONNECTION', message: 'The caller cancelled the decision request.', retryable: false });
    }
    if (timedOut) {
      throw new SystemOneError({ code: 'JEV_TIMEOUT', retryable: true,
        message: `${a.name} did not answer within ${a.timeoutMs} ms.` });
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new SystemOneError({ code: 'JEV_CONNECTION', retryable: true,
      message: `Could not reach ${a.name}: ${redact(reason, a.key) as string}` });
  } finally {
    clearTimeout(timer);
    a.signal?.removeEventListener('abort', onOuter);
  }

  const raw = parseBody(text);
  // The adapter reshapes a 2xx answer only; an error body is read as the provider sent it.
  const parsed = a.adapter && res.status >= 200 && res.status < 300 && isObj(raw.json)
    ? { json: a.adapter(raw.json) as unknown, ok: raw.ok } : raw;
  const bodyObj = isObj(parsed.json) ? parsed.json : null;
  const requestId = (typeof bodyObj?.request_id === 'string' ? bodyObj.request_id : null)
    ?? res.headers.get('x-typesafe-request-id') ?? null;

  if (res.status < 200 || res.status >= 300) {
    const m = statusCode(res.status);
    throw new SystemOneError({
      code: m.code, status: res.status, requestId, retryable: m.retryable,
      detail: redact(parsed.json, a.key),
      retryAfterMs: retryAfterMs(res.headers, a.now()),
      message: `${a.name} ${m.what} (HTTP ${res.status}).`,
    });
  }

  const problem = parsed.ok ? validateAnswers(parsed.json, a.request.questions) : 'the body is not JSON';
  if (problem !== null || !bodyObj) {
    throw new SystemOneError({
      code: 'JEV_BAD_RESPONSE', status: res.status, requestId, retryable: false,
      detail: redact(parsed.json, a.key),
      message: `${a.name} answered, but ${problem ?? 'the body is not a JSON object'}.`,
    });
  }
  const answersIn = bodyObj.answers as Record<string, Record<string, unknown>>;
  const answers: Record<string, SystemOneAnswer> = {};
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
 * Send one decision request to a System One provider, retrying per policy.
 * @param {CallSystemOneArgs} args
 * @returns {Promise<SystemOneResponse>}
 * @throws {SystemOneError}
 */
export async function callSystemOne(args: CallSystemOneArgs): Promise<SystemOneResponse> {
  const policy: SystemOneRetryPolicy = { ...DEFAULT_SYSTEMONE_RETRY, ...args.policy };
  const fetchImpl: SystemOneFetch = args.fetchImpl ?? ((u, init) => safeFetch(u, init));
  const sleep = args.sleep ?? realSleep;
  const random = args.random ?? Math.random;
  const now = args.now ?? Date.now;
  const body = JSON.stringify(args.request);
  const started = now();
  const name = args.providerName ?? 'The decision provider';
  const adapter = args.adapter ? SYSTEMONE_ADAPTERS[args.adapter] : undefined;
  let attempts = 0;

  for (let retry = 0; ; retry++) {
    attempts++;
    try {
      return await attempt({
        url: args.url, key: args.key, body, request: args.request, timeoutMs: policy.attemptTimeoutMs,
        name, ...(adapter ? { adapter } : {}), signal: args.signal, fetchImpl, now, attempts,
      });
    } catch (err) {
      if (!(err instanceof SystemOneError)) throw err;
      if (!err.retryable || retry >= policy.maxRetries) throw err;
      const asked = err.retryAfterMs;
      const delay = asked !== null && asked <= policy.maxRetryAfterMs ? asked : backoffMs(retry, policy, random);
      const remaining = policy.totalBudgetMs - (now() - started);
      if (delay >= remaining) throw err;
      await sleep(delay);
      if (args.signal?.aborted) {
        throw new SystemOneError({ code: 'JEV_CONNECTION', message: 'The caller cancelled the decision request.', retryable: false });
      }
    }
  }
}
