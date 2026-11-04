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
 *   ACROSS PROCESSES. The routes ask checkAdminPasswordOnNode, which keeps the count in the node's
 *   storage (services/ephemeral-claims.ts), so N processes allow the count once, not N times. The
 *   synchronous checkAdminPassword gives the same answers from this process's memory.
 * @structure AdminPasswordCheck · checkAdminPassword(config, address, input) ·
 *   checkAdminPasswordOnNode(config, address, input) · adminPasswordLimitedMessage(check) ·
 *   resetAdminPasswordMisses()
 * @usage
 *   const pw = await checkAdminPasswordOnNode(config, req.ip ?? '', req.headers['x-admin-password']);
 *   if (pw.kind === 'limited') { res.setHeader('Retry-After', String(pw.retryAfterSec)); ... 429 }
 *   if (pw.kind !== 'ok') { ... 401 }
 * @version-history
 *   v1.1.0 — 2026-11-04 — checkAdminPasswordOnNode: the count in the node's storage, and the routes ask
 *     it (codebase analysis 2026-11-03, HA stage 2).
 *   v1.0.0 — 2026-11-04 — Initial: the three compares and two counters moved here (codebase analysis
 *     2026-11-03, item A12).
 */
import { timingSafeEqual } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import { getStats } from './stats.js';
import { getPromMetrics } from './prometheus.js';
import { windowCounter } from './ephemeral-claims.js';
import type { EphemeralCount } from '../storage/repositories/ephemeral-claim.repository.js';

/** What one check answers. `missing`: no password was sent, which is not counted as a guess. */
export type AdminPasswordCheck =
  | { kind: 'ok' }
  | { kind: 'missing' }
  | { kind: 'wrong' }
  | { kind: 'limited'; retryAfterSec: number; max: number; windowSec: number };

/**
 * Wrong passwords per address, in the current window: a window counter (services/ephemeral-claims.ts)
 * that every process of the node shares through checkAdminPasswordOnNode. The synchronous
 * checkAdminPassword counts in this process's memory only.
 */
const misses = windowCounter('admin-password-miss');

type AdminPasswordConfig = Pick<AimeatConfig, 'adminPassword' | 'adminAuthRateLimitMax' | 'adminAuthRateLimitWindowMs'>;

function matches(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The answer before a wrong password is counted: missing, limited, ok, or null for a wrong one. */
function decide(config: AdminPasswordConfig, input: unknown, seen: EphemeralCount | null, now: number): AdminPasswordCheck | null {
  if (typeof input !== 'string' || !input) return { kind: 'missing' };
  const max = config.adminAuthRateLimitMax;
  if (seen && seen.expiresAt > now && seen.count >= max) {
    getStats()?.increment('rate_limit_hits_total');
    getPromMetrics()?.rateLimitHitsTotal.inc();
    return { kind: 'limited', retryAfterSec: Math.ceil((seen.expiresAt - now) / 1000), max, windowSec: Math.round(config.adminAuthRateLimitWindowMs / 1000) };
  }
  if (config.adminPassword && matches(input, config.adminPassword)) return { kind: 'ok' };
  return null;
}

/**
 * How a wrong password is counted: a window that ended at or before now starts again at 1 and ends
 * windowMs from now; otherwise the count rises and the window keeps its end.
 */
const missCount = (config: AdminPasswordConfig, now: number) => ({ now, windowMs: config.adminAuthRateLimitWindowMs, staleBefore: now + 1 });

/**
 * Check `input` against the node's admin password, counting a wrong one against `address` in this
 * process only. Only a non-empty password is a guess: a request that sends none is `missing` and
 * counts nothing. The routes ask checkAdminPasswordOnNode.
 */
export function checkAdminPassword(config: AdminPasswordConfig, address: string, input: unknown): AdminPasswordCheck {
  const now = Date.now();
  const answer = decide(config, input, typeof input === 'string' && input ? misses.here.read(address) : null, now);
  if (answer) return answer;
  misses.here.bump(address, missCount(config, now));
  return { kind: 'wrong' };
}

/** checkAdminPassword counted across every process of the node: the same count, limit and answers. */
export async function checkAdminPasswordOnNode(config: AdminPasswordConfig, address: string, input: unknown): Promise<AdminPasswordCheck> {
  if (typeof input !== 'string' || !input) return { kind: 'missing' };
  const now = Date.now();
  const answer = decide(config, input, await misses.read(address), now);
  if (answer) return answer;
  await misses.bump(address, missCount(config, now));
  return { kind: 'wrong' };
}

/** The refusal sentence for an address over the count: the rule, why, and what to do now. */
export function adminPasswordLimitedMessage(check: { retryAfterSec: number; max: number; windowSec: number }): string {
  return `Too many wrong admin passwords came from this address: the node accepts ${check.max} wrong ones in ${check.windowSec} seconds, `
    + `and until that window ends it refuses every admin password from here, the right one too. Try again in ${check.retryAfterSec} seconds. `
    + 'The operator sets the count in Admin, Config ("Admin auth rate limit (max per window)").';
}

/** Forget every count this process holds. For a test that needs a clean start. */
export function resetAdminPasswordMisses(): void {
  misses.here.clearAll();
}
