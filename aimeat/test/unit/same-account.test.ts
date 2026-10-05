/**
 * @file test/unit/same-account.test.ts
 * @description isSameAccount (utils/same-account.ts), the one app-owner comparison (secaudit 2026-10,
 *   C8): any principal of the account matches, letter case does not matter, and a visitor from another
 *   node never matches the local account of the same name.
 * @usage pnpm test -- same-account
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C8).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { isSameAccount } from '../../src/utils/same-account.js';

beforeAll(() => setThisNodeId('node-a'));

describe('isSameAccount', () => {
  it('matches every principal of one account, whatever the letter case', () => {
    expect(isSameAccount('alice', 'alice@node-a')).toBe(true);
    expect(isSameAccount('claude#alice@node-a', 'Alice')).toBe(true);
    expect(isSameAccount('eco:news#alice@node-a', 'alice')).toBe(true);
  });

  it('refuses another account, a visitor of the same name, and an empty name', () => {
    expect(isSameAccount('bob', 'alice')).toBe(false);
    expect(isSameAccount('alice@node-b', 'alice')).toBe(false);
    expect(isSameAccount('', 'alice')).toBe(false);
    expect(isSameAccount(undefined, undefined)).toBe(false);
  });
});
