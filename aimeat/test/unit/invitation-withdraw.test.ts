/**
 * @file invitation-withdraw.test.ts
 * @description A pending invitation the owner can SEE must be one the owner can WITHDRAW.
 *
 *   Memberships are keyed by the bare owner name, and every lookup uses that form. Rows written
 *   before that was settled carry the full GHII (`kkk@node`), and the AIMEAT VIP Exclusive organism
 *   on the production node still holds one from 2026-07-11. The invitations list reads it (it scans
 *   by organism + status), so the row appears under PENDING INVITATIONS with a Withdraw button, but
 *   the withdraw itself looked the row up by exact name, missed it, and answered "No pending
 *   invitation for that owner". The invitation was visible, unwithdrawable, and permanent.
 *
 *   These tests hold the two halves: the legacy row is found and deleted, and the notification goes
 *   to `kkk@node` rather than the `kkk@node@node` that pasting a node id onto a stored GHII makes.
 * @usage cd aimeat && pnpm exec vitest run test/unit/invitation-withdraw.test.ts
 * @version-history
 *   v1.0.0 -- 2026-08-25 -- Initial, with services/invitation-lookup.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { cancelNameInvitation, updateNameInvitation } from '../../src/services/invitations.js';
import type { OrganismMembershipRecord, OrganismRecord } from '../../src/storage/interface.js';

const config = { nodeId: 'node-1' } as never as import('../../src/config.js').AimeatConfig;

const organism = {
    id: 'org-1', name: 'VIP', members: ['owner-1'], admins: [], agentGaiis: [],
} as never as OrganismRecord;

function invitedRow(ghii: string): OrganismMembershipRecord {
    return {
        id: 'm-legacy', organismId: 'org-1', ghii, role: 'member', status: 'invited',
        joinedAt: '2026-07-11T08:24:18.302Z', invitedBy: 'owner-1',
    } as never as OrganismMembershipRecord;
}

/** Only what the invitation surfaces read: an exact-match getMembership plus the invited-row scan. */
function fakeStorage(rows: OrganismMembershipRecord[]) {
    const deleteMembership = vi.fn(async () => true);
    const updateMembership = vi.fn(async (id: string, patch: Record<string, unknown>) => ({ ...rows.find(r => r.id === id), ...patch }));
    const setMemory = vi.fn(async () => undefined);
    return {
        deleteMembership, updateMembership, setMemory,
        getMembership: async (_orgId: string, ghii: string) => rows.find(r => r.ghii === ghii) ?? null,
        listMembers: async (_orgId: string, opts?: { status?: string }) =>
            rows.filter(r => !opts?.status || r.status === opts.status),
        updateOrganism: async () => null,
    } as never as import('../../src/storage/interface.js').Storage & {
        deleteMembership: typeof deleteMembership; updateMembership: typeof updateMembership; setMemory: typeof setMemory;
    };
}

describe('withdrawing a pending invitation', () => {
    it('deletes a row stored under the bare owner name', async () => {
        const storage = fakeStorage([invitedRow('kkk')]);
        await cancelNameInvitation(storage, config, { organism, cancellerGhii: 'owner-1', inviteeRaw: 'kkk' });
        expect(storage.deleteMembership).toHaveBeenCalledWith('m-legacy');
    });

    it('deletes a legacy row stored under the full GHII, which the exact lookup never finds', async () => {
        const storage = fakeStorage([invitedRow('kkk@node-1')]);
        await cancelNameInvitation(storage, config, { organism, cancellerGhii: 'owner-1', inviteeRaw: 'kkk' });
        expect(storage.deleteMembership).toHaveBeenCalledWith('m-legacy');
    });

    it('notifies the owner once, not at a node id pasted onto a stored GHII', async () => {
        const storage = fakeStorage([invitedRow('kkk@node-1')]);
        await cancelNameInvitation(storage, config, { organism, cancellerGhii: 'owner-1', inviteeRaw: 'kkk' });
        const recipients = storage.setMemory.mock.calls.map(c => (c[0] as { ownerGaii: string }).ownerGaii);
        expect(recipients).toEqual(['kkk@node-1']);
    });

    it('still refuses when the owner has no pending invitation at all', async () => {
        const storage = fakeStorage([]);
        await expect(cancelNameInvitation(storage, config, { organism, cancellerGhii: 'owner-1', inviteeRaw: 'kkk' }))
            .rejects.toMatchObject({ code: 'NO_INVITATION' });
        expect(storage.deleteMembership).not.toHaveBeenCalled();
    });

    it('does not treat an ACTIVE membership as a pending invitation', async () => {
        const active = { ...invitedRow('kkk'), status: 'active' } as OrganismMembershipRecord;
        const storage = fakeStorage([active]);
        await expect(cancelNameInvitation(storage, config, { organism, cancellerGhii: 'owner-1', inviteeRaw: 'kkk' }))
            .rejects.toMatchObject({ code: 'NO_INVITATION' });
    });
});

describe('editing a pending invitation', () => {
    it('reaches a legacy row too, so its rights stay editable before it is accepted', async () => {
        const storage = fakeStorage([invitedRow('kkk@node-1')]);
        await updateNameInvitation(storage, config, { organism, inviteeRaw: 'kkk', role: 'admin' });
        expect(storage.updateMembership).toHaveBeenCalledWith('m-legacy', { role: 'admin' });
    });
});
