/**
 * @file src/services/invoke/route-invoke.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Run one route capability (services/invoke/route-capabilities.ts) with the caller's own bearer,
 *   through the node's own route.
 *
 *   THE SAME REQUEST THE CALLER COULD SEND. The request goes to the node's own HTTP server in process
 *   (services/request-injector.ts), so every middleware of the route runs as for a request from
 *   outside: sign-in, scope, readiness, rate limits, the body guard, the audit and the route's own
 *   ownership checks. It carries the caller's bearer and nothing else: no cookie, no admin password,
 *   no service token. The in-process mark (auth/injected-request.ts) lets a REST route take the
 *   caller's MCP-bound token for that one request, as it does for the tool capabilities; it adds no
 *   identity, role or scope. A request the node makes for a caller is never taken for a person at the
 *   node's own machine (auth/loopback-pass.ts fromNodeMachine).
 *
 *   WHAT THE CALLER CONTROLS. The values of the route's own path parameters, which fill the contract's
 *   template one segment each (a value cannot be `.` or `..`, and `/` is encoded), the query values
 *   the contract declares, and the body, sent as given. Never the method, the path or a header. A
 *   path or query name the route does not declare is refused, not dropped.
 *
 *   THE ANSWER IS THE ROUTE'S. Its status, and its own error code and message on a refusal, with the
 *   whole envelope in `details`. A redirect is not followed: its status and Location are the answer.
 *   The answer is read under an 8 MB ceiling; a larger one is refused with 502 ANSWER_TOO_LARGE.
 * @structure invokeRouteCapability(config, cap, input, bearer) → InvokeSuccess | InvokeRefusal
 * @usage const out = await invokeRouteCapability(config, cap, { path: { name } }, bearer);
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial: REST routes reachable through aimeat_invoke.
 */
import type { RouteCapability } from './route-capabilities.js';
import { withInProcessFetch } from '../request-injector.js';
import { logger } from '../../utils/logger.js';
import { readBodyCapped } from '../../utils/read-capped.js';

export interface RouteInvokeRefusal { ok: false; status: number; code: string; message: string; details?: unknown }
export interface RouteInvokeSuccess { ok: true; capability: string; status: number; result: unknown; duration_ms: number }

/** How much of a text answer comes back; a longer one is cut and says so. */
const MAX_TEXT = 256 * 1024;
/** The largest answer invoke reads from a route at all; past it the call answers ANSWER_TOO_LARGE. */
const MAX_BODY = 8 * 1024 * 1024;

const refuse = (code: string, message: string, status = 400): RouteInvokeRefusal => ({ ok: false, status, code, message });

type Scalar = string | number | boolean;
const isScalar = (v: unknown): v is Scalar =>
  typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The request the input describes, or the refusal that names what is wrong with it. */
export function routeRequestOf(cap: RouteCapability, input: unknown): { url: string; body?: string } | RouteInvokeRefusal {
  const given = input === undefined || input === null ? {} : input;
  if (!isRecord(given)) return refuse('INVALID_INPUT', 'The input of a route capability is an object with path, query and body.');
  for (const key of Object.keys(given)) {
    if (!(key in cap.input)) {
      return refuse('INVALID_INPUT', `This route takes no "${key}". It takes: ${Object.keys(cap.input).join(', ') || 'nothing'}.`);
    }
  }

  const pathNames = cap.parameters.filter(p => p.in === 'path').map(p => p.name);
  const pathValues = given.path === undefined ? {} : given.path;
  if (!isRecord(pathValues)) return refuse('INVALID_INPUT', '"path" is an object of the route\'s path values.');
  for (const key of Object.keys(pathValues)) {
    if (!pathNames.includes(key)) return refuse('INVALID_INPUT', `This route has no path value "${key}". It has: ${pathNames.join(', ')}.`);
  }
  let missing: string | undefined;
  let bad: string | undefined;
  const url = cap.path.replace(/\{([^}]+)\}/g, (_whole, name: string) => {
    const v = pathValues[name];
    if (v === undefined || v === null || v === '') { missing ??= name; return ''; }
    if (!isScalar(v) || typeof v === 'boolean') { bad ??= name; return ''; }
    const text = String(v);
    // `.` and `..` would be resolved away by URL parsing and reach another route than the one named.
    if (text === '.' || text === '..') { bad ??= name; return ''; }
    return encodeURIComponent(text);
  });
  if (missing) return refuse('INVALID_INPUT', `The path value "${missing}" is required.`);
  if (bad) return refuse('INVALID_INPUT', `The path value "${bad}" must be a string or a number, and not "." or "..".`);

  const queryNames = cap.parameters.filter(p => p.in === 'query').map(p => p.name);
  const queryValues = given.query === undefined ? {} : given.query;
  if (!isRecord(queryValues)) return refuse('INVALID_INPUT', '"query" is an object of query values by name.');
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(queryValues)) {
    if (!queryNames.includes(key)) return refuse('INVALID_INPUT', `This route declares no query value "${key}". It declares: ${queryNames.join(', ') || 'none'}.`);
    if (value === undefined || value === null) continue;
    const list = Array.isArray(value) ? value : [value];
    if (!list.every(isScalar)) return refuse('INVALID_INPUT', `The query value "${key}" must be a string, a number, a boolean or a list of them.`);
    for (const item of list) search.append(key, String(item));
  }
  const qs = search.toString();

  if (given.body !== undefined && !cap.body) return refuse('INVALID_INPUT', 'This route takes no body.');
  return { url: qs ? `${url}?${qs}` : url, ...(given.body !== undefined ? { body: JSON.stringify(given.body) } : {}) };
}

export async function invokeRouteCapability(
  config: { port: number },
  cap: RouteCapability,
  input: unknown,
  bearer: string,
): Promise<RouteInvokeSuccess | RouteInvokeRefusal> {
  const request = routeRequestOf(cap, input);
  if ('ok' in request) return request;

  return withInProcessFetch(config, { forBearer: bearer }, async (fetchIn) => {
    const started = Date.now();
    const headers: Record<string, string> = { Authorization: `Bearer ${bearer}`, Accept: 'application/json' };
    if (request.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetchIn(request.url, { method: cap.method, headers, body: request.body, redirect: 'manual' });
    const duration = Date.now() - started;
    const type = res.headers.get('content-type') ?? '';

    let payload: unknown;
    if (res.status >= 300 && res.status < 400) {
      payload = { location: res.headers.get('location') };
    } else {
      // The body is read under a ceiling (utils/read-capped.ts): a model cannot use an answer this
      // large, and the process must not hold one whole before measuring it.
      const body = await readBodyCapped(res, MAX_BODY);
      if (body === null) {
        return {
          ok: false, status: 502, code: 'ANSWER_TOO_LARGE',
          message: `The route answered more than ${MAX_BODY / (1024 * 1024)} MB, which invoke does not carry. Narrow the request with the route's own query values.`,
        };
      }
      const text = body.toString('utf8');
      if (/json/i.test(type)) {
        // A route that labels a non-JSON answer as JSON: the caller gets the text as the route sent it.
        try { payload = text ? JSON.parse(text) : null; }
        catch (err) {
          logger.debug('route-invoke: a route answered JSON that does not parse; returning its text', { capability: cap.id, error: String(err) });
          payload = { text: text.slice(0, MAX_TEXT) };
        }
      } else if (/^text\/|yaml|xml|markdown/i.test(type) || !type) {
        payload = { content_type: type || null, text: text.slice(0, MAX_TEXT), ...(text.length > MAX_TEXT ? { truncated: true } : {}) };
      } else {
        payload = { content_type: type, bytes: body.byteLength };
      }
    }

    if (res.status >= 400) {
      const err = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
      return {
        ok: false,
        status: res.status,
        code: typeof err?.code === 'string' ? err.code : `HTTP_${res.status}`,
        message: typeof err?.message === 'string' ? err.message : `The route answered ${res.status}.`,
        details: payload,
      };
    }
    // The AIMEAT envelope's data is the answer, as for a tool capability; anything else comes back whole.
    const result = isRecord(payload) && payload.ok === true && 'data' in payload ? payload.data : payload;
    return { ok: true, capability: cap.id, status: res.status, result, duration_ms: duration };
  });
}
