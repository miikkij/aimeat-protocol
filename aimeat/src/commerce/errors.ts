/**
 * @file src/commerce/errors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The commerce core's typed error — carried from resolvers/session service up to the
 *   protocol adapters, which map { code, statusCode, message } straight onto their envelopes.
 *   Extracted from session-service.ts so sellable-resolvers can throw it without a circular import.
 * @usage throw new CommerceError('OFFER_NOT_FOUND', 404, '…');
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from session-service.ts (TARGET-033 phase 4)
 */
export class CommerceError extends Error {
  constructor(public code: string, public statusCode: number, message: string) {
    super(message);
  }
}
