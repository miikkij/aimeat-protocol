/**
 * @file src/services/finance/errors.ts
 * @description Typed error for the finance domain, mapped to HTTP by the routes
 *   (same shape as CommerceError / ContactsError so route error handling stays uniform).
 * @usage throw new FinanceError('FISCAL_YEAR_LOCKED', 409, 'Fiscal year 2025 is locked');
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1.
 */

export class FinanceError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'FinanceError';
  }
}
