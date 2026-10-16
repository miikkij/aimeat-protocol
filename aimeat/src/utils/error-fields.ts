/**
 * @file src/utils/error-fields.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fields a log line carries for a caught value: `error` (the message) and `stack`.
 *   A leaf module, so the logger and every call site import it without a cycle, and a test that
 *   replaces the logger module still has it.
 *
 *   WHY. JSON writes an Error as `{}`, because its message and stack are not enumerable fields, so
 *   log calls that passed the caught value as a field recorded that something failed and not what
 *   (QA audit E1-04). `pnpm lint` refuses that form (aimeat/no-error-object-log-field).
 * @structure errorFields(err)
 * @usage logger.error('Failed to seed', { ...errorFields(err), key });
 * @version-history
 *   2026-10-16 — Initial (QA audit E1-04, E1-06).
 */

/** `error` is the message (or the text of a non-Error), `stack` the stack when there is one. */
export function errorFields(err: unknown): { error: string; stack?: string } {
  if (err instanceof Error) return err.stack ? { error: err.message, stack: err.stack } : { error: err.message };
  return { error: String(err) };
}
