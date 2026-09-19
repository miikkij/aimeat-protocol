/**
 * @file src/services/decide/errors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one error the decision service throws, so every door (REST, MCP, a bulk run)
 *   maps it to the same status and the same code. `details` carries structured reasons a builder can
 *   act on, such as the list of limit violations, and never a key or a state.
 * @structure DecideError
 * @usage throw new DecideError('DECIDE_DISABLED', 503, 'The operator has turned decisions off.');
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial (TARGET-080).
 */
export class DecideError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'DecideError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}
