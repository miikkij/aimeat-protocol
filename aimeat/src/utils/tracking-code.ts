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
