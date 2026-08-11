/**
 * @file src/services/sharing-group-members.ts
 * @description Adding somebody to, and removing somebody from, a sharing group.
 *
 *   A sharing group IS the boundary of who reads the owner's memory, so the two operations that
 *   change it are the two that decide who can see what. Both were written out twice — once in
 *   routes/sharing-groups.ts and once in mcp/sharing-groups.ts — including the ceiling, the
 *   duplicate test and the member record's shape. They agreed. Two copies of a consent boundary
 *   agreeing today is not the same as a consent boundary.
 * @structure
 *   - MAX_GROUP_MEMBERS — the ceiling both doors apply
 *   - addGroupMember() / removeGroupMember() — a refusal, or the new member list
 * @usage
 *   const out = addGroupMember(group, { identifier, identifierType, permissions }, addedBy);
 *   if (!out.ok) return refuse(out.message);
 *   await storage.updateSharingGroup(group.id, { members: out.members, updatedAt: out.now });
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted after the copied-logic check found the pair.
 */
import type { SharingGroupMember, SharingGroupRecord } from '../storage/interface.js';

/** How many people one group may hold. Both doors have always applied it; now from one place. */
export const MAX_GROUP_MEMBERS = 100;

export type MemberChange =
    | { ok: true; members: SharingGroupMember[]; now: string }
    | { ok: false; status: number; code: 'DUPLICATE' | 'NOT_FOUND' | 'LIMIT_EXCEEDED'; message: string };

/**
 * Add one member, if the group has room and does not already hold them.
 *
 * `addedBy` is the principal recorded on the member row — the OWNER's identity on both doors, since
 * a group belongs to the person rather than to whichever of their sessions edited it.
 */
export function addGroupMember(
    group: Pick<SharingGroupRecord, 'members' | 'defaultPermissions'>,
    input: { identifier: string; identifierType: SharingGroupMember['identifierType']; permissions?: SharingGroupMember['permissions'] },
    addedBy: string,
): MemberChange {
    if (group.members.length >= MAX_GROUP_MEMBERS) {
        return { ok: false, status: 400, code: 'LIMIT_EXCEEDED', message: `Maximum ${MAX_GROUP_MEMBERS} members per group` };
    }
    if (group.members.some(m => m.identifier === input.identifier)) {
        return { ok: false, status: 409, code: 'DUPLICATE', message: 'Member already exists in this group' };
    }
    const now = new Date().toISOString();
    const member: SharingGroupMember = {
        identifier: input.identifier,
        identifierType: input.identifierType,
        permissions: input.permissions ?? group.defaultPermissions,
        addedAt: now,
        addedBy,
    };
    return { ok: true, members: [...group.members, member], now };
}

/** Remove one member. Refusing when they are not there is the honest answer, not a silent success. */
export function removeGroupMember(
    group: Pick<SharingGroupRecord, 'members'>,
    identifier: string,
): MemberChange {
    if (!group.members.some(m => m.identifier === identifier)) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Member not found in this group' };
    }
    return {
        ok: true,
        members: group.members.filter(m => m.identifier !== identifier),
        now: new Date().toISOString(),
    };
}
