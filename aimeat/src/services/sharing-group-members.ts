/**
 * @file src/services/sharing-group-members.ts
 * @description Every write to a sharing group: creating one, and adding or removing a member.
 *
 *   A sharing group IS the boundary of who reads the owner's memory, so the operations that change
 *   it are the operations that decide who can see what. All three were written out twice, once in
 *   routes/sharing-groups.ts and once in mcp/sharing-groups.ts, and the two copies did not agree:
 *
 *     - THE MEMBER'S ADDRESS. The HTTP door turns a bare `bob` into `bob@node-id` before storing it,
 *       because every membership test compares against a full GHII or GAII. The tool stored the bare
 *       string, so a member an agent added matched nothing and read nothing, with no error to show
 *       for it. That is the worst failure a consent boundary has: it reports success and grants
 *       access to no one.
 *     - THE SHAPE. Name 1 to 128 characters, description up to 10 000, at most 100 initial members,
 *       identifier up to 256. The tool declared a bare `z.string()` for all of them, so an empty
 *       name, an unbounded description and a 500-member group all stored over MCP.
 *     - THE GROUP DEFAULT PERMISSIONS. The HTTP door takes `default_permissions` from the caller and
 *       falls back to read-only. The tool wrote that fallback out as a literal of its own, which is
 *       one constant with two homes and only one of them reachable.
 *
 *   The ceiling, the duplicate test and the member row's shape were collapsed here first (August
 *   2026 audit, step 3). The record build, the validation and the storage write follow now, so
 *   neither door computes what goes in the group and the tool no longer touches storage at all.
 *
 *   One capability, one implementation, whatever the interface. CLAUDE.md, Backend.
 * @structure
 *   - MAX_GROUP_MEMBERS, MAX_GROUPS_PER_OWNER: the two ceilings both doors apply
 *   - resolveMemberIdentifier(): a bare name becomes a GHII on this node
 *   - addGroupMember() / removeGroupMember(): pure, a refusal or the new member list
 *   - createSharingGroup() / addSharingGroupMember() / removeSharingGroupMember(): the whole write,
 *     load and ownership included, ending in a refusal or the stored group
 * @usage
 *   const out = await createSharingGroup({ storage, config }, ownerGaii, req.body);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own answer
 * @version-history
 *   v2.0.0 - 2026-08-11 - Create, add-member and remove-member move here whole (audit step 8):
 *     validation, identifier resolution, the record build, the storage write and the `groups`
 *     change event. Both doors kept only their own rendering.
 *   v1.0.0 — 2026-08-11 — Extracted after the copied-logic check found the pair.
 */
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, SharingGroupMember, SharingGroupRecord } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import {
    SharingGroupCreateSchema,
    SharingGroupAddMemberSchema,
} from '../models/sharing-group-schemas.js';

/** How many people one group may hold. Both doors have always applied it; now from one place. */
export const MAX_GROUP_MEMBERS = 100;

/** How many groups one owner may keep. Both doors applied 50 as a literal of their own. */
export const MAX_GROUPS_PER_OWNER = 50;

export interface SharingGroupDeps {
    storage: Storage;
    config: AimeatConfig;
}

/** A refusal, in the shape both doors can render: HTTP has the status and code, MCP the message. */
export interface SharingGroupRefusal {
    ok: false;
    status: number;
    code: string;
    message: string;
}

export type MemberChange =
    | { ok: true; members: SharingGroupMember[]; now: string }
    | { ok: false; status: number; code: 'DUPLICATE' | 'NOT_FOUND' | 'LIMIT_EXCEEDED'; message: string };

/**
 * A member is stored as a full address, because that is what membership is tested against.
 *
 * `alice@node-id` and `claude#alice@node-id` are already addresses and pass through. A bare `bob` is
 * a name on this node, so it becomes `bob@node-id`. Storing the bare name instead is what made a
 * group member invisible to every read check that looked for them.
 */
export function resolveMemberIdentifier(identifier: string, nodeId: string): string {
    if (identifier.includes('@') || identifier.includes('#')) return identifier;
    return `${identifier}@${nodeId}`;
}

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

/** Turn Zod issues into the one-line message both doors have always shown. */
function invalidInput(issues: { message: string }[]): SharingGroupRefusal {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: issues.map(i => i.message).join(', ') };
}

/**
 * Load the group and check that this caller owns it.
 *
 * Both doors resolve their own caller (HTTP through resolveIdentity, MCP from the agent's GAII) and
 * hand the result in; the comparison itself belongs here, where a change to it reaches both.
 */
async function ownedGroup(
    deps: SharingGroupDeps,
    ownerGaii: string,
    groupId: string,
    action: string,
): Promise<{ ok: true; group: SharingGroupRecord } | SharingGroupRefusal> {
    const group = await deps.storage.getSharingGroup(groupId);
    if (!group) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Sharing group not found' };
    if (group.ownerGaii !== ownerGaii) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: `Only the group owner can ${action}` };
    }
    return { ok: true, group };
}

/** Create a sharing group owned by `ownerGaii`, with whatever members the caller named. */
export async function createSharingGroup(
    deps: SharingGroupDeps,
    ownerGaii: string,
    input: unknown,
): Promise<{ ok: true; group: SharingGroupRecord } | SharingGroupRefusal> {
    const parsed = SharingGroupCreateSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error.issues);

    const { name, description, members, default_permissions: defaultPermissions } = parsed.data;

    const existing = await deps.storage.listSharingGroups(ownerGaii);
    if (existing.length >= MAX_GROUPS_PER_OWNER) {
        return {
            ok: false,
            status: 409,
            code: 'LIMIT_REACHED',
            message: `Maximum ${MAX_GROUPS_PER_OWNER} sharing groups per owner`,
        };
    }

    const now = new Date().toISOString();
    const group = await deps.storage.createSharingGroup({
        id: uuidv4(),
        name: name.trim(),
        description: description?.trim(),
        ownerGaii,
        members: members.map(m => ({
            identifier: resolveMemberIdentifier(m.identifier, deps.config.nodeId),
            identifierType: m.identifier_type,
            permissions: m.permissions ?? defaultPermissions,
            addedAt: now,
            addedBy: ownerGaii,
        })),
        defaultPermissions,
        createdAt: now,
        updatedAt: now,
    });

    // Who is in a sharing group decides who reads the owner's memory, so the owner's open browser
    // hears about it whichever door made the change.
    emitChange('groups');
    return { ok: true, group };
}

/** Add one member to a group the caller owns, and store the result. */
export async function addSharingGroupMember(
    deps: SharingGroupDeps,
    ownerGaii: string,
    groupId: string,
    input: unknown,
): Promise<{ ok: true; group: SharingGroupRecord; member: SharingGroupMember } | SharingGroupRefusal> {
    const owned = await ownedGroup(deps, ownerGaii, groupId, 'add members');
    if (!owned.ok) return owned;

    const parsed = SharingGroupAddMemberSchema.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error.issues);

    const added = addGroupMember(owned.group, {
        identifier: resolveMemberIdentifier(parsed.data.identifier, deps.config.nodeId),
        identifierType: parsed.data.identifier_type,
        permissions: parsed.data.permissions,
    }, ownerGaii);
    if (!added.ok) return added;

    const group = await deps.storage.updateSharingGroup(groupId, { members: added.members, updatedAt: added.now });
    if (!group) return { ok: false, status: 500, code: 'INTERNAL', message: 'Failed to add member' };

    emitChange('groups');
    return { ok: true, group, member: added.members[added.members.length - 1] };
}

/** Remove one member from a group the caller owns, and store the result. */
export async function removeSharingGroupMember(
    deps: SharingGroupDeps,
    ownerGaii: string,
    groupId: string,
    identifier: string,
): Promise<{ ok: true; group: SharingGroupRecord; identifier: string } | SharingGroupRefusal> {
    const owned = await ownedGroup(deps, ownerGaii, groupId, 'remove members');
    if (!owned.ok) return owned;

    const removed = removeGroupMember(owned.group, identifier);
    if (!removed.ok) return removed;

    const group = await deps.storage.updateSharingGroup(groupId, { members: removed.members, updatedAt: removed.now });
    if (!group) return { ok: false, status: 500, code: 'INTERNAL', message: 'Failed to remove member' };

    emitChange('groups');
    return { ok: true, group, identifier };
}
