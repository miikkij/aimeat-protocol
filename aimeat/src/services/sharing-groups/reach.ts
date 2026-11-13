/**
 * @file src/services/sharing-groups/reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which sharing groups a caller sees: the list (GET /v1/groups, aimeat_group_list) and
 *   the one group (GET /v1/groups/:id, aimeat_group_get). Both surfaces ask here, so an agent gets the
 *   same groups from the route and from the tool.
 *
 *   THE RULE (developer ruling 2026-11-13, structure programme 2026-11 unit 7):
 *     - The owner in person: the groups they own and the groups they are a member of.
 *     - An agent (or app grant) holding consent:groups, the word that lets it create the owner's
 *       groups and change their members (routes/sharing-groups.ts, QA audit D2-02): the same groups
 *       its owner sees, plus the groups it is a member of itself.
 *     - Without consent:groups: the groups its own identity is a member of, and a group its own
 *       identity owns. An agent does not ride its owner's groups (.claude/rules/security.md, the
 *       owner-to-agent direction).
 *   Until 2026-11-13 the tool showed every agent its owner's groups and the route showed every agent
 *   only its own, so an agent holding consent:groups could change members of groups it could not
 *   list over REST, and an agent without it listed them over MCP.
 * @structure sharingGroupsFor(storage, caller) · sharingGroupFor(storage, caller, id) · seesOwnersGroups(caller)
 * @usage
 *   const groups = await sharingGroupsFor(storage, callerOf(req, config.nodeId, storage));
 *   const one = await sharingGroupFor(storage, caller(), groupId); if (!one.ok) refuse(one.code);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial (structure programme 2026-11, unit 7).
 */
import type { Storage, SharingGroupRecord } from '../../storage/interface.js';
import type { CallerContext } from '../caller-context.js';

type GroupCaller = Pick<CallerContext, 'principal' | 'ownerGhii' | 'inPerson' | 'has'>;

/** True when this caller sees its owner's groups: the owner in person, or a holder of consent:groups. */
export function seesOwnersGroups(caller: GroupCaller): boolean {
    return caller.inPerson || caller.has('consent:groups');
}

/** The groups this caller sees, owned ones first, each once. */
export async function sharingGroupsFor(storage: Storage, caller: GroupCaller): Promise<SharingGroupRecord[]> {
    const lists: SharingGroupRecord[][] = [];
    if (seesOwnersGroups(caller)) {
        lists.push(await storage.listSharingGroups(caller.ownerGhii));
        lists.push(await storage.listSharingGroupsByMember(caller.ownerGhii));
    }
    if (!caller.inPerson) lists.push(await storage.listSharingGroupsByMember(caller.principal));
    const seen = new Set<string>();
    return lists.flat().filter(g => (seen.has(g.id) ? false : (seen.add(g.id), true)));
}

/** May this caller read this group: as the list above decides, for one group. */
export function sharingGroupReadable(group: SharingGroupRecord, caller: GroupCaller): boolean {
    const memberOf = (identity: string) => group.members.some(m => m.identifier === identity);
    if (group.ownerGaii === caller.principal || memberOf(caller.principal)) return true;
    return seesOwnersGroups(caller) && (group.ownerGaii === caller.ownerGhii || memberOf(caller.ownerGhii));
}

/** One group as this caller may read it, or the refusal both surfaces answer. */
export async function sharingGroupFor(
    storage: Storage, caller: GroupCaller, groupId: string,
): Promise<{ ok: true; group: SharingGroupRecord } | { ok: false; code: 'NOT_FOUND' | 'ACCESS_DENIED' }> {
    const group = await storage.getSharingGroup(groupId);
    if (!group) return { ok: false, code: 'NOT_FOUND' };
    return sharingGroupReadable(group, caller) ? { ok: true, group } : { ok: false, code: 'ACCESS_DENIED' };
}
