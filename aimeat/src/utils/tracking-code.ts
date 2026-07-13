/**
 * @file src/utils/tracking-code.ts
 * @description Small helpers that mint unique, human-readable identifiers using crypto random bytes —
 *   tracking codes for work/disputes and short request IDs.
 *
 * @structure
 *   - generateTrackingCode(): "tc-{unix_ms}-{8hex}"
 *   - generateRequestId(): "req-{8hex}"
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { randomBytes } from 'node:crypto';

/**
 * Generate a tracking code: tc-{unix_ms}-{8char_random}
 */
export function generateTrackingCode(): string {
  const timestamp = Date.now();
  const random = randomBytes(4).toString('hex');
  return `tc-${timestamp}-${random}`;
}

/**
 * Generate a request ID: req-{8char_random}
 */
export function generateRequestId(): string {
  return `req-${randomBytes(4).toString('hex')}`;
}
