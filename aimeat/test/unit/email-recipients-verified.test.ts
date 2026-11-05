/**
 * @file test/unit/email-recipients-verified.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description services/email-recipients.ts emailReach, the list the operator's group mail goes to:
 *   only addresses the account has verified (owner-mail-address.ts provenOwnerAddress), as every other
 *   mail to an account's own address; an address nobody verified, or one changed after the
 *   verification, is skipped and counted, for everyone and for the operators (codebase analysis
 *   2026-11-03, decision 14a of 2026-11-05).
 * @usage pnpm exec vitest run test/unit/email-recipients-verified.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 14a of 2026-11-05).
 */
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { emailReach } from '../../src/services/email-recipients.js';

const hashOf = (a: string) => createHash('sha256').update(a.toLowerCase().trim()).digest('hex');
const at = '2026-11-01T00:00:00.000Z';
const verified = (name: string) => ({ ownerName: name, notificationEmail: `${name}@example.test`, emailVerifiedAt: at, emailHash: hashOf(`${name}@example.test`) });

const storage = {
  listGHIIs: async () => [
    verified('alice'),                                                           // operator, verified
    { ownerName: 'olga', notificationEmail: 'olga@example.test', emailVerifiedAt: null, emailHash: null }, // operator, not verified
    verified('bob'),
    { ownerName: 'carol', notificationEmail: 'carol@example.test', emailVerifiedAt: null, emailHash: null },
    // Verified once, then the address was changed to one nobody verified.
    { ...verified('dave'), notificationEmail: 'someone-else@example.test' },
    { ownerName: 'erin', notificationEmail: null },
  ],
  listOwners: async () => [
    { name: 'alice', roles: ['owner', 'operator'] }, { name: 'olga', roles: ['owner', 'operator'] },
    { name: 'bob', roles: ['owner'] }, { name: 'carol', roles: ['owner'] }, { name: 'dave', roles: ['owner'] }, { name: 'erin', roles: ['owner'] },
  ],
};

describe('who the operator group mail reaches', () => {
  it('lists verified addresses only, and counts the skipped ones', async () => {
    const r = await emailReach(storage as never);
    expect(r.all).toEqual(['alice@example.test', 'bob@example.test']);
    expect(r.operators).toEqual(['alice@example.test']);
    expect(r.unverified).toBe(3);
    expect(r.operatorsUnverified).toBe(1);
    expect(r.accounts).toBe(6);
    expect(r.operatorAccounts).toBe(2);
  });
});
