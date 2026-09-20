/**
 * @file src/services/design-book/errors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Design Book's one error type. Moved here WHOLE from validate.ts, which still
 *   re-exports it, and changed in nothing: the component bench (component.ts) throws it and is
 *   itself called by validate.ts, so the class had to sit below both.
 * @structure DesignBookError
 * @usage throw new DesignBookError('BODY_INVALID', 'why, in words', 422);
 * @version-history
 *   v1.0.0 — 2026-09-20 — Extracted from validate.ts, unchanged.
 */
export class DesignBookError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = 'DesignBookError';
  }
}
