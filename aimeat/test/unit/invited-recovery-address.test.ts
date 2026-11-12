/**
 * @file test/unit/invited-recovery-address.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description services/recovery-address.ts invitedRecoveryAddress and accountsInvitedAt: which
 *   unproven address an account made from an invitation may recover through. The designed use: the
 *   account an accepted invitation made gets its invited address. The refusals: no invitation, an
 *   invitation another account accepted, one accepted before this account existed (a name taken
 *   again after an erasure), one not accepted, a code key, and an address another account holds. The mail paths
 *   themselves are proven in test/e2e-email-delivery.ts.
 * @usage pnpm exec vitest run test/unit/invited-recovery-address.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-12 — Initial (reported from an organisation node on 4.3.0).
 */
import { describe, it, expect } from 'vitest';
import { invitedRecoveryAddress, accountsInvitedAt } from '../../src/services/recovery-address.js';
import { emailHashOf } from '../../src/services/owner-provisioning.js';
import type { GHIIRecord } from '../../src/storage/interface.js';
import type { InvitationRecord } from '../../src/storage/repositories/invitation.repository.js';

const NODE = 'aimeat-invited-recovery-test';
const MADE = '2026-11-03T10:00:00.000Z';

function account(name: string, email: string | undefined, extra: Partial<GHIIRecord> = {}): GHIIRecord {
  return { username: name, ghii: `${name}@${NODE}`, ownerName: name, createdAt: MADE, notificationEmail: email, ...extra } as GHIIRecord;
}

function invitation(email: string, acceptedBy: string | null, acceptedAt: string | null, status: InvitationRecord['status'] = 'accepted', type: InvitationRecord['type'] = 'link'): InvitationRecord {
  return { emailHash: emailHashOf(email), acceptedBy, acceptedAt, status, type } as InvitationRecord;
}

function store(invitations: InvitationRecord[], accounts: GHIIRecord[]) {
  return {
    listInvitationsByEmailHash: async (hash: string, opts?: { status?: InvitationRecord['status'] }) =>
      invitations.filter(i => i.emailHash === hash && (!opts?.status || i.status === opts.status)),
    getGHIIByEmailHash: async (hash: string) => accounts.find(a => a.emailHash === hash) ?? null,
    getGHII: async (ghii: string) => accounts.find(a => a.ghii === ghii) ?? null,
  } as never;
}

const EMAIL = 'carol@example.test';
const LATER = '2026-11-03T10:00:01.000Z';

describe('invitedRecoveryAddress', () => {
  it('names the invited address of the account the accepted invitation made', async () => {
    const carol = account('carol', EMAIL);
    expect(await invitedRecoveryAddress(store([invitation(EMAIL, 'carol', LATER)], [carol]), carol)).toBe(EMAIL);
  });

  it('names nothing for an address no invitation went to', async () => {
    const carol = account('carol', 'elsewhere@example.test');
    expect(await invitedRecoveryAddress(store([invitation(EMAIL, 'carol', LATER)], [carol]), carol)).toBeNull();
  });

  it('names nothing when another account accepted the invitation', async () => {
    const carol = account('carol', EMAIL);
    expect(await invitedRecoveryAddress(store([invitation(EMAIL, 'bob', LATER)], [carol]), carol)).toBeNull();
  });

  it('names nothing for an invitation accepted before this account was made', async () => {
    const carol = account('carol', EMAIL);
    expect(await invitedRecoveryAddress(store([invitation(EMAIL, 'carol', '2026-10-01T00:00:00.000Z')], [carol]), carol)).toBeNull();
  });

  it('names nothing for an invitation that was not accepted', async () => {
    const carol = account('carol', EMAIL);
    expect(await invitedRecoveryAddress(store([invitation(EMAIL, 'carol', LATER, 'cancelled')], [carol]), carol)).toBeNull();
  });

  it('names nothing for a code key, whose minter chose the address and knows the key', async () => {
    const carol = account('carol', EMAIL);
    expect(await invitedRecoveryAddress(store([invitation(EMAIL, 'carol', LATER, 'accepted', 'code')], [carol]), carol)).toBeNull();
  });

  it('names nothing when another account holds the address', async () => {
    const carol = account('carol', EMAIL);
    const alice = account('alice', EMAIL, { emailHash: emailHashOf(EMAIL), emailVerifiedAt: MADE });
    expect(await invitedRecoveryAddress(store([invitation(EMAIL, 'carol', LATER)], [carol, alice]), carol)).toBeNull();
  });
});

describe('accountsInvitedAt', () => {
  it('finds the accounts the invitations to the address made, and only those still naming it', async () => {
    const carol = account('carol', EMAIL);
    const dave = account('dave', 'moved@example.test');
    const found = await accountsInvitedAt(store([invitation(EMAIL, 'carol', LATER), invitation(EMAIL, 'dave', LATER)], [carol, dave]), NODE, EMAIL);
    expect(found.map(a => a.username)).toEqual(['carol']);
  });
});
