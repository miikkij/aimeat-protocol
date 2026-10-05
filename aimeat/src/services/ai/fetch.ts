/**
 * @file fetch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one outbound transport the AI SDK is given. Every AI SDK provider factory takes a
 *   `fetch` parameter, and this is the only value it receives: `safeFetch`, so every model call
 *   passes the same SSRF validation, redirect policy and credential stripping as the rest of the
 *   node, whatever package built the request.
 * @structure
 *   - aiFetch() — a fetch-compatible function over safeFetch
 *   - normaliseErrorBody() — a 200 answer that carries an `error` object becomes the error it is
 * @usage
 *   createOpenAICompatible({ name, baseURL, apiKey, fetch: aiFetch() })
 * @version-history
 *   v1.0.1 — 2026-10-05 — A JSON answer is read under a 64 MB ceiling (secaudit 2026-10, C6).
 *   v1.0.0 — 2026-09-28 — Initial, with the gateway (V1 of the System 2 plan).
 */
import { safeFetch } from '../../utils/url-validator.js';
import { logger } from '../../utils/logger.js';
import { readText } from '../../utils/read-capped.js';

/** The most of one JSON answer this wrapper reads to normalise it (secaudit 2026-10, C6). */
const AI_ANSWER_MAX_BYTES = 64 * 1024 * 1024;

/** Options a provider may need on its transport. V3 fills `allowOrigins` for an operator's local server. */
export interface AiFetchOptions {
  /** Exact origins an operator named for a node or builtin `local` provider. Never an owner's. */
  allowOrigins?: readonly string[];
}

/** The URL of a fetch input, whatever form the caller passed it in. */
function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * A 200 whose JSON body is an `error` object and nothing else becomes a response with the error's
 * own status (its `code` when that is an HTTP status, 502 otherwise).
 *
 * OpenRouter answers some failures this way (a vendor that rejects a parameter, a rate limit met
 * upstream), and the node has treated it as the failure it is since 2026-03. The AI SDK packages
 * disagree about it: the OpenRouter package raises an error with status 200 and the
 * OpenAI-compatible one fails its response schema, so both would lose the status. Normalising here,
 * once, gives every package the same answer. A body that also carries `choices` or `data` is a
 * result and passes untouched, and so does a stream.
 */
async function normaliseErrorBody(resp: Response): Promise<Response> {
  if (!resp.ok || !(resp.headers.get('content-type') ?? '').includes('application/json')) return resp;
  // Read under a ceiling: the provider does not decide how much memory one answer takes (C6).
  const text = await readText(resp, AI_ANSWER_MAX_BYTES);
  const headers = new Headers(resp.headers);
  // The body below is the decoded text, so the transfer headers of the original no longer describe it.
  headers.delete('content-encoding');
  headers.delete('content-length');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // Not JSON after all: the model package reports it with its own parse error, which names the body.
    logger.debug('[ai] a JSON-typed provider answer did not parse; passed on as it came', { error: String(err) });
    return new Response(text, { status: resp.status, statusText: resp.statusText, headers });
  }
  const body = parsed as { error?: unknown; choices?: unknown; data?: unknown };
  if (body && typeof body === 'object' && body.error && typeof body.error === 'object'
    && body.choices === undefined && body.data === undefined) {
    const code = Number((body.error as { code?: unknown }).code);
    const status = Number.isInteger(code) && code >= 400 && code <= 599 ? code : 502;
    return new Response(text, { status, statusText: 'Provider error in a 200 response', headers });
  }
  return new Response(text, { status: resp.status, statusText: resp.statusText, headers });
}

/**
 * A `fetch` for the AI SDK that goes through safeFetch.
 *
 * safeFetch takes a string URL and a plain init; the AI SDK passes a string today, and a `URL` or a
 * `Request` is converted rather than trusted to stay that way.
 */
export function aiFetch(opts: AiFetchOptions = {}): typeof fetch {
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : undefined;
    // A Request's body is a stream, which fetch would need `duplex` to resend; read it whole instead,
    // since safeFetch may have to resend it on a same-host redirect anyway.
    const merged: RequestInit = request
      ? {
        method: request.method,
        headers: request.headers,
        ...(request.method !== 'GET' && request.method !== 'HEAD' ? { body: await request.arrayBuffer() } : {}),
        signal: request.signal,
        ...init,
      }
      : { ...init };
    const resp = await safeFetch(urlOf(input), {
      ...merged,
      ...(opts.allowOrigins ? { allowOrigins: opts.allowOrigins } : {}),
    });
    return normaliseErrorBody(resp);
  };
  return fn as typeof fetch;
}
