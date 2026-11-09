/**
 * @file test/unit/admin-password.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one check of the node's admin password (services/admin-password.ts): a wrong
 *   password counts against its address, a missing one and a right one do not, and an address over
 *   the count is refused every password, the right one too, until its window ends (codebase analysis
 *   2026-11-03, item A12). The routes that use it are proven in e2e-build-with-you and e2e-admin-doors-2.
 * @usage cd aimeat && pnpm exec vitest run test/unit/admin-password.test.ts
 * @version-history
 *   v1.1.0 -- 2026-11-08 -- checkAdminPasswordOnNode: a burst sent together is compared at most up to the
 *     count, and right passwords are never counted (secaudit2026nov08 round 14).
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item A12).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkAdminPassword, checkAdminPasswordOnNode, adminPasswordLimitedMessage, resetAdminPasswordMisses } from '../../src/services/admin-password.js';

const config = { adminPassword: 'the-right-one', adminAuthRateLimitMax: 5, adminAuthRateLimitWindowMs: 60_000 };

beforeEach(() => resetAdminPasswordMisses());
afterEach(() => vi.useRealTimers());

describe('checkAdminPassword', () => {
  it('lets the right password through as often as it is sent, and counts nothing for it or for none', () => {
    for (let i = 0; i < 20; i++) expect(checkAdminPassword(config, '10.0.0.1', 'the-right-one').kind).toBe('ok');
    for (let i = 0; i < 20; i++) expect(checkAdminPassword(config, '10.0.0.1', '').kind).toBe('missing');
    expect(checkAdminPassword(config, '10.0.0.1', undefined).kind).toBe('missing');
  });

  it('refuses every password from an address after five wrong ones, the right one too, and says when to try again', () => {
    for (let i = 0; i < 5; i++) expect(checkAdminPassword(config, '10.0.0.2', `guess-${i}`).kind).toBe('wrong');
    const right = checkAdminPassword(config, '10.0.0.2', 'the-right-one');
    expect(right.kind).toBe('limited');
    if (right.kind !== 'limited') return;
    expect(right.retryAfterSec).toBeGreaterThan(0);
    expect(adminPasswordLimitedMessage(right)).toContain('Admin, Config');
    // Another address is not touched.
    expect(checkAdminPassword(config, '10.0.0.3', 'the-right-one').kind).toBe('ok');
  });

  it('opens again when the window ends', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) checkAdminPassword(config, '10.0.0.4', `guess-${i}`);
    expect(checkAdminPassword(config, '10.0.0.4', 'the-right-one').kind).toBe('limited');
    vi.advanceTimersByTime(60_001);
    expect(checkAdminPassword(config, '10.0.0.4', 'the-right-one').kind).toBe('ok');
  });

  it('refuses every password on a node with no admin password', () => {
    expect(checkAdminPassword({ ...config, adminPassword: null }, '10.0.0.5', 'anything').kind).toBe('wrong');
  });
});

// secaudit2026nov08 round 14 (services/admin-password.ts:checkAdminPasswordOnNode/read-then-bump): the
// node-wide check read the count, compared, and only then counted, so wrong passwords sent together
// were all compared. The count is reserved before the compare now.
describe('checkAdminPasswordOnNode', () => {
  it('compares at most five of twenty wrong passwords sent together from one address', async () => {
    const answers = await Promise.all(Array.from({ length: 20 }, (_, n) => checkAdminPasswordOnNode(config, '10.0.1.1', `burst-${n}`)));
    expect(answers.filter(a => a.kind === 'wrong').length).toBe(5);
    expect(answers.filter(a => a.kind === 'limited').length).toBe(15);
  });

  it('lets the right password through as often as it is sent, together or one by one, and counts none of them', async () => {
    const together = await Promise.all(Array.from({ length: 20 }, () => checkAdminPasswordOnNode(config, '10.0.1.2', 'the-right-one')));
    expect(together.every(a => a.kind === 'ok')).toBe(true);
    for (let i = 0; i < 20; i++) expect((await checkAdminPasswordOnNode(config, '10.0.1.2', 'the-right-one')).kind).toBe('ok');
    for (let i = 0; i < 4; i++) expect((await checkAdminPasswordOnNode(config, '10.0.1.2', `guess-${i}`)).kind).toBe('wrong');
    expect((await checkAdminPasswordOnNode(config, '10.0.1.2', 'the-right-one')).kind).toBe('ok');
  });

  it('refuses the right password too from an address over the count', async () => {
    for (let i = 0; i < 5; i++) expect((await checkAdminPasswordOnNode(config, '10.0.1.3', `guess-${i}`)).kind).toBe('wrong');
    expect((await checkAdminPasswordOnNode(config, '10.0.1.3', 'the-right-one')).kind).toBe('limited');
    expect((await checkAdminPasswordOnNode(config, '10.0.1.3', '')).kind).toBe('missing');
  });
});
