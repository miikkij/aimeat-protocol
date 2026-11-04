/**
 * @file src/services/admin-password.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one check of the node's admin password (AIMEAT_ADMIN_PASSWORD, or the one the node
 *   generated at boot), for every route that takes it: the admin setup pages (routes/admin.ts
 *   /v1/admin/setup/auth, /register, /token), POST /v1/admin/seed-examples, and the fleet service's
 *   operator routes (routes/build-with-you.ts).
 *
 *   WHY ONE. Until 2026-11-04 the password was compared in three places with three limits: the setup
 *   pages at 5 requests a minute, the build-with-you routes with a miss counter of their own, and
 *   seed-examples with only the node's global limit, so a guesser had hundreds of tries a second there
 *   and the doors' budgets added up (codebase analysis 2026-11-03, item A5 of duplication-drift, A12
 *   of the fix list). Now every door compares here and counts its wrong passwords in one count per
 *   address: security.admin_auth_rate_limit_max wrong passwords in security.admin_auth_rate_limit_window_ms
 *   (5 a minute by default). While an address is over the count, every password from it is refused,
 *   the right one too, so a guess gains nothing from the window. A right password is not counted, so
 *   the fleet service reads a place as often as it needs.
 *
 *   PER PROCESS, as every limiter here (services/rate-buckets.ts).
 * @structure AdminPasswordCheck · checkAdminPassword(config, address, input) · adminPasswordLimitedMessage(check) ·
 *   resetAdminPasswordMisses()
 * @usage
 *   const pw = checkAdminPassword(config, req.ip ?? '', req.headers['x-admin-password']);
 *   if (pw.kind === 'limited') { res.setHeader('Retry-After', String(pw.retryAfterSec)); ... 429 }
 *   if (pw.kind !== 'ok') { ... 401 }
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial: the three compares and two counters moved here (codebase analysis
 *     2026-11-03, item A12).
 */
import { timingSafeEqual } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import { getStats } from './stats.js';
import { getPromMetrics } from './prometheus.js';

/** What one check answers. `missing`: no password was sent, which is not counted as a guess. */
export type AdminPasswordCheck =
  | { kind: 'ok' }
  | { kind: 'missing' }
  | { kind: 'wrong' }
  | { kind: 'limited'; retryAfterSec: number; max: number; windowSec: number };

/** Wrong passwords per address, in the current window. */
// process-local: each process counts wrong passwords on its own, so N processes allow N times the limit.
const misses = new Map<string, { count: number; until: number }>();

function matches(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Check `input` against the node's admin password, counting a wrong one against `address`.
 * Only a non-empty password is a guess: a request that sends none is `missing` and counts nothing.
 */
export function checkAdminPassword(
  config: Pick<AimeatConfig, 'adminPassword' | 'adminAuthRateLimitMax' | 'adminAuthRateLimitWindowMs'>,
  address: string,
  input: unknown,
): AdminPasswordCheck {
  if (typeof input !== 'string' || !input) return { kind: 'missing' };
  const now = Date.now();
  const max = config.adminAuthRateLimitMax;
  const windowMs = config.adminAuthRateLimitWindowMs;
  const seen = misses.get(address);
  if (seen && seen.until > now && seen.count >= max) {
    getStats()?.increment('rate_limit_hits_total');
    getPromMetrics()?.rateLimitHitsTotal.inc();
    return { kind: 'limited', retryAfterSec: Math.ceil((seen.until - now) / 1000), max, windowSec: Math.round(windowMs / 1000) };
  }
  if (config.adminPassword && matches(input, config.adminPassword)) return { kind: 'ok' };
  const fresh = !seen || seen.until <= now;
  if (misses.size > 10_000) for (const [k, v] of misses) if (v.until <= now) misses.delete(k);
  misses.set(address, { count: fresh ? 1 : seen.count + 1, until: fresh ? now + windowMs : seen.until });
  return { kind: 'wrong' };
}

/** The refusal sentence for an address over the count: the rule, why, and what to do now. */
export function adminPasswordLimitedMessage(check: { retryAfterSec: number; max: number; windowSec: number }): string {
  return `Too many wrong admin passwords came from this address: the node accepts ${check.max} wrong ones in ${check.windowSec} seconds, `
    + `and until that window ends it refuses every admin password from here, the right one too. Try again in ${check.retryAfterSec} seconds. `
    + 'The operator sets the count in Admin, Config ("Admin auth rate limit (max per window)").';
}

/** Forget every count. For a test that needs a clean start. */
export function resetAdminPasswordMisses(): void {
  misses.clear();
}
