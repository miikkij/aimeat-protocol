/**
 * @file errors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The typed error every AI path throws: a code the caller can act on, the HTTP status
 *   a route answers with, and, when the refusal has more to say than a sentence, `details` a caller
 *   can read without parsing the message (the allowed models, the layer that refused, where to look
 *   next). A leaf, so the gate (services/ai/completion.ts, which re-exports it) and the policy code
 *   under services/ai/ throw the same class without importing each other.
 * @structure PROVIDER_KEY_REFUSED_STATUS · AiCompletionError
 * @version-history
 *   v1.2.0 -- 2026-10-07 -- PROVIDER_KEY_REFUSED_STATUS (424): the one status for a provider's key
 *     refusal, read by every AI route.
 *   v1.1.0 — 2026-09-28 — Moved here from ai/completion.ts, unchanged, and `details` added for the
 *     model policy's refusals (System 2 plan, V2).
 *   v1.0.0 — 2026-06-03 — In ai/completion.ts.
 */

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
