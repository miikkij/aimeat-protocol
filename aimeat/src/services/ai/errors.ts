/**
 * @file errors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The typed error every AI path throws: a code the caller can act on, the HTTP status
 *   a route answers with, and, when the refusal has more to say than a sentence, `details` a caller
 *   can read without parsing the message (the allowed models, the layer that refused, where to look
 *   next). A leaf among the AI services (it imports only the logger and the capped reader), so the
 *   gate (services/ai/completion.ts, which re-exports it) and the policy code under services/ai/
 *   throw the same class without importing each other.
 *
 *   A PROVIDER'S REFUSAL IS MAPPED HERE, ONCE. Every AI path (completion, image, transcription,
 *   embeddings, speech, the voice reply, the chat proxy, the legacy settings routes) turns a provider's
 *   HTTP status into the node's code with providerStatusError, and reads the provider's reason with
 *   providerReason / providerReasonFromText, so the status table and the redaction policy exist once.
 *   Until 2026-10-08 each path had its own copy, and six of seven answered a permanent 4xx (a model that
 *   does not make mp3, a voice it does not have) as 502 PROVIDER_ERROR "try again shortly", so a
 *   caller repeated a call that could never work (aiprov plan, A1-A3).
 * @structure PROVIDER_KEY_REFUSED_STATUS · AiCompletionError · CONTENT_REFUSAL · redactKeyShaped ·
 *   providerReasonFromText · providerReason · retryAfterHeader · providerStatusError · providerFailureOf ·
 *   nodeFailureOf
 * @version-history
 *   v1.3.0 -- 2026-10-08 -- providerStatusError, providerFailureOf, providerReason(FromText) and
 *     CONTENT_REFUSAL (moved from route-run.ts): one status table and one reason policy for every AI
 *     path. A permanent 4xx is 422 PROVIDER_REJECTED with details.provider_status and
 *     provider_message; 402 is PROVIDER_NO_CREDIT; a moderation refusal is 422 CONTENT_REFUSED; 429 is
 *     RATE_LIMITED with the provider's Retry-After (aiprov plan, A1-A3). nodeFailureOf: a failure
 *     that is not a provider's is the node's 500 INTERNAL_ERROR on every AI route (A8).
 *   v1.2.0 -- 2026-10-07 -- PROVIDER_KEY_REFUSED_STATUS (424): the one status for a provider's key
 *     refusal, read by every AI route.
 *   v1.1.0 — 2026-09-28 — Moved here from ai/completion.ts, unchanged, and `details` added for the
 *     model policy's refusals (System 2 plan, V2).
 *   v1.0.0 — 2026-06-03 — In ai/completion.ts.
 */
import { logger } from '../../utils/logger.js';
import { readBodyPrefix } from '../../utils/read-capped.js';

/**
 * The status every AI route answers when the PROVIDER refuses the key that pays (code INVALID_API_KEY):
 * 424 Failed Dependency. Ruled by Jouni on 2026-10-07.
 *
 * Not 401: that says the CALLER'S own credential failed. The connector tunnel detached a healthy crm
 * agent on it (aimeat-commercial, 2026-10-07), and the browser SDK refreshes the session and repeats
 * the call on a 401. Not 502: the OpenAI client crews use on the node road retries any 5xx twice, and
 * crewaimeat's REST transport retries 5xx too, so a refused key would be sent three times. Neither
 * retries a 424.
 */
export const PROVIDER_KEY_REFUSED_STATUS = 424;

/** Typed error so the HTTP route can map to a status/code and the scheduler can log it. */
export class AiCompletionError extends Error {
  code: string;
  status: number;
  /** Structured facts about the refusal, passed through as `error.details` on the REST answer. */
  details?: Record<string, unknown>;
  constructor(code: string, status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AiCompletionError';
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

/** The words a provider uses when it refuses the CONTENT rather than the request or the key. */
export const CONTENT_REFUSAL = /moderation|flagged|content[ _-]?policy|content_filter|safety system|responsible ai/i;

/** How much of a provider's reason reaches a message, a log line or `details.provider_message`. */
export const PROVIDER_REASON_MAX_CHARS = 300;
/** How much of a provider's error body is read to find the reason. */
const PROVIDER_REASON_READ_BYTES = 4096;

/**
 * Replace anything shaped like a credential with `[redacted]`. A provider's error body can echo the
 * request, a header or the key it refused, and the reason is shown to the caller and logged.
 */
export function redactKeyShaped(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(api[_-]?key|access[_-]?token|token|secret|password|authorization)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1$2[redacted]')
    .replace(/\b(?:sk|pk|rk|ak|xai|gsk)-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]');
}

/** JSON.parse that answers undefined for text that is not JSON, which a provider's error body often is not. */
function parseOrUndefined(text: string): unknown {
  // eslint-disable-next-line aimeat/no-silent-catch -- text that is not JSON is an answer here, not a failure: the caller keeps the text as the reason
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

/** The human part of a provider's JSON error, in the shapes OpenAI, OpenRouter and Anthropic use. */
function reasonOfJson(v: unknown, depth: number): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.length ? reasonOfJson(v[0], depth) : undefined;
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  let message: string | undefined;
  if (typeof o.error === 'string') message = o.error;
  else if (o.error && typeof o.error === 'object') {
    const e = o.error as Record<string, unknown>;
    if (typeof e.message === 'string') message = e.message;
    // OpenRouter wraps the upstream provider's own answer as a string in error.metadata.raw, and its
    // own message is then the generic "Provider returned error": the real reason is the inner one.
    const raw = (e.metadata as { raw?: unknown } | undefined)?.raw;
    if (typeof raw === 'string' && raw.trim() && depth < 2) {
      const parsed = parseOrUndefined(raw);
      const inner = (parsed === undefined ? undefined : reasonOfJson(parsed, depth + 1)) ?? raw.trim();
      if (inner && inner !== message) message = message ? `${message}: ${inner}` : inner;
    }
  }
  if (!message && typeof o.message === 'string') message = o.message;
  if (!message && typeof o.detail === 'string') message = o.detail;
  return message;
}

/**
 * A provider's reason from its error body: the JSON error's message when there is one, otherwise the
 * text; whitespace collapsed, key-shaped strings redacted, at most PROVIDER_REASON_MAX_CHARS.
 */
export function providerReasonFromText(text: string): string {
  const raw = (text ?? '').trim();
  let reason = raw;
  if (raw.startsWith('{') || raw.startsWith('[')) {
    // Not JSON, or cut short at the read ceiling: the text as it came is the reason.
    const parsed = parseOrUndefined(raw);
    if (parsed !== undefined) reason = reasonOfJson(parsed, 0) ?? raw;
  }
  const clean = redactKeyShaped(reason.replace(/\s+/g, ' ').trim());
  return clean.length > PROVIDER_REASON_MAX_CHARS ? clean.slice(0, PROVIDER_REASON_MAX_CHARS - 1) + '…' : clean;
}

/** The reason in a provider's non-OK response: at most PROVIDER_REASON_READ_BYTES of its body are read. */
export async function providerReason(response: Response): Promise<string> {
  // The body only enriches a refusal already being reported: an unreadable one is logged and the
  // refusal goes on with no reason, never a made-up one.
  try {
    return providerReasonFromText((await readBodyPrefix(response, PROVIDER_REASON_READ_BYTES)).toString('utf8'));
  } catch (err) {
    logger.warn(`[ai] the provider's HTTP ${response.status} body could not be read`, { error: String(err) });
    return '';
  }
}

/** Seconds from a Retry-After header (seconds or an HTTP date), kept between 1 and 3600; undefined when absent. */
export function retryAfterHeader(headers: Headers | Record<string, string | undefined> | undefined): number | undefined {
  if (!headers) return undefined;
  const value = headers instanceof Headers ? headers.get('retry-after')
    : headers['retry-after'] ?? headers['Retry-After'];
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value.trim()) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.min(3600, Math.max(1, seconds)) : undefined;
}

/** What a caller can add to a provider's refusal: the Retry-After it sent, and a call-specific hint. */
export interface ProviderStatusOptions {
  retryAfter?: number;
  /** One sentence that says what to change, for a refusal this call can foresee (speech in mp3). */
  hint?: string;
}

/**
 * A provider's HTTP status as the node's refusal. The one table every AI path uses:
 *   401, and 403 without moderation words → INVALID_API_KEY at 424 (PROVIDER_KEY_REFUSED_STATUS)
 *   any 4xx with moderation words          → CONTENT_REFUSED 422
 *   402                                    → PROVIDER_NO_CREDIT 402
 *   429                                    → RATE_LIMITED 429, details.retry_after_sec from the provider
 *   other 4xx (400, 404, 413, 415, 422...) → PROVIDER_REJECTED 422: the same call fails again
 *   408, 5xx and anything else             → PROVIDER_ERROR 502
 * `details` always carries provider_status, and provider_message when the provider gave a reason.
 */
export function providerStatusError(status: number, reason: string, opts: ProviderStatusOptions = {}): AiCompletionError {
  const details: Record<string, unknown> = { provider_status: status, ...(reason ? { provider_message: reason } : {}) };
  const said = reason ? `: ${reason}` : '.';
  const end = said.endsWith('.') || said.endsWith('…') ? '' : '.';
  let e: AiCompletionError;
  const clientSide = status >= 400 && status < 500;
  if (clientSide && status !== 402 && status !== 408 && status !== 429 && CONTENT_REFUSAL.test(reason)) {
    e = new AiCompletionError('CONTENT_REFUSED', 422, `The provider refused the content (HTTP ${status})${said}${end}`, details);
  } else if (status === 401 || status === 403) {
    e = new AiCompletionError('INVALID_API_KEY', PROVIDER_KEY_REFUSED_STATUS, `The provider refused the key (HTTP ${status})${said}${end}`, details);
  } else if (status === 402) {
    e = new AiCompletionError('PROVIDER_NO_CREDIT', 402, `The provider says the key that pays has no credit left (HTTP 402)${said}${end}`, details);
  } else if (status === 429) {
    if (opts.retryAfter !== undefined) details.retry_after_sec = opts.retryAfter;
    e = new AiCompletionError('RATE_LIMITED', 429, `The provider is limiting requests right now (HTTP 429)${said}${end}`, details);
  } else if (clientSide && status !== 408) {
    if (opts.hint) details.hint = opts.hint;
    e = new AiCompletionError('PROVIDER_REJECTED', 422,
      `The provider refused the request (HTTP ${status})${said}${end} The same call fails again as it is.${opts.hint ? ' ' + opts.hint : ''}`, details);
  } else {
    e = new AiCompletionError('PROVIDER_ERROR', 502, `The provider answered HTTP ${status}${said}${end}`, details);
  }
  logger.warn(`[ai] provider answered HTTP ${status}: ${e.code}`, { reason });
  return e;
}

/**
 * Any failure of a provider call as the node's refusal. A refusal the node already named
 * (AiCompletionError: a missing key, a provider that does not serve the operation) passes as it is;
 * an error carrying a provider status goes through providerStatusError, with the reason the
 * transport read (`providerMessage`) and the Retry-After it saw (`retryAfter`); anything else that
 * went wrong on the way to the provider (a timeout, a refused connection, an answer that does not
 * parse) is 502 PROVIDER_ERROR.
 */
export function providerFailureOf(e: unknown, opts: ProviderStatusOptions = {}): AiCompletionError {
  if (e instanceof AiCompletionError) return e;
  const err = (e ?? {}) as { status?: unknown; providerMessage?: unknown; retryAfter?: unknown };
  const text = e instanceof Error ? e.message : String(e);
  const reason = typeof err.providerMessage === 'string' ? err.providerMessage : providerReasonFromText(text);
  if (typeof err.status === 'number' && err.status >= 400 && err.status <= 599) {
    return providerStatusError(err.status, reason, {
      ...opts, ...(typeof err.retryAfter === 'number' ? { retryAfter: err.retryAfter } : {}),
    });
  }
  return new AiCompletionError('PROVIDER_ERROR', 502, reason || 'The provider did not answer.');
}

/**
 * What an AI route answers for a failure, once the service has had its say. The services turn every
 * provider failure into an AiCompletionError (providerFailureOf), so anything else that reaches a
 * route is the node's own: 500 INTERNAL_ERROR, logged with its stack, its text kept out of the
 * answer. Until 2026-10-08 the routes answered such a failure (a TypeError, a storage error) as 502
 * PROVIDER_ERROR, which blamed the provider and told the caller to try again (aiprov plan, A8).
 */
export function nodeFailureOf(e: unknown, where: string): AiCompletionError {
  if (e instanceof AiCompletionError) return e;
  logger.error(`[ai] ${where}: the node failed`, { error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
  return new AiCompletionError('INTERNAL_ERROR', 500, 'The node failed while handling this AI call. The operator can see it in the log.');
}
