/**
 * @file errors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The typed error every AI path throws: a code the caller can act on, the HTTP status
 *   a route answers with, and, when the refusal has more to say than a sentence, `details` a caller
 *   can read without parsing the message (the allowed models, the layer that refused, where to look
 *   next). A leaf, so the gate (services/ai/completion.ts, which re-exports it) and the policy code
 *   under services/ai/ throw the same class without importing each other.
 * @structure AiCompletionError
 * @version-history
 *   v1.1.0 — 2026-09-28 — Moved here from ai/completion.ts, unchanged, and `details` added for the
 *     model policy's refusals (System 2 plan, V2).
 *   v1.0.0 — 2026-06-03 — In ai/completion.ts.
 */

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
