/**
 * @file src/services/organism/write-role.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may write a workspace record space, by the space's `writeRole` in the manifest:
 *   `owner` is the workspace's registered creator or an organism admin (an admin or the organism's
 *   creator), `admin` is an organism admin, and `member` or no value is every member the other rules
 *   admit (membership, the workspace role, consent, the fenced-space rule). The same rule the
 *   workspace's meta namespace uses for `owner`.
 *
 *   Ruled by the developer on 2026-11-21 (decision-writerole-on-memory-record-spaces-who-is-owner-and-how-it-is):
 *   "On every write path into a workspace record space, writeRole owner means the workspace creator or
 *   an organism admin (the same rule the meta. namespace uses), on memory-backed and row-backed spaces
 *   alike."
 *
 *   WHY. Only the row service read writeRole, and there `owner` meant the organism's creator alone.
 *   Every write path of a MEMORY-backed space (the draft write, the publish, the batch publish, the
 *   reopen, the memory write, the extension capability, intake, the deletes and the archive) skipped
 *   it, so a member with a contributor grant wrote a space the manifest kept to its owner or to the
 *   admins (incident mv6pffzu).
 *
 *   WHO DECIDES. The account behind the caller: a person in person, their agents, their hosted app and
 *   their extension act with that person's standing (an agent acts with its owner's rights). A caller
 *   of another node holds no membership here and is refused a space that is not `member`.
 *
 *   WHERE IT RUNS. Memory-backed spaces: spaceWriteRoleRefusal(), which fencedSpaceRefusal
 *   (services/fenced-space.ts) asks after the fence on every write-mode operation it is asked for, so
 *   every code path that asks the fence (checkOrganismNamespaceAccess with a real key, the publish and
 *   reopen routes, the workspace operations, the bulk delete, the archive, the extension capability,
 *   intake) asks this too. Row-backed spaces: the row service's gate (services/workspace-rows/row-service.ts)
 *   asks writeStandingOf() and standingMeets() for the caller's person.
 *
 *   HELD SPACES. A memory space that declared `owner` or `admin` before this rule and that members
 *   already wrote into stays on the earlier behaviour until the operator decides
 *   (services/workspace/write-role-hold.ts). The hold is read only when a write would be refused, so
 *   an allowed write costs nothing more.
 *
 *   COST. A caller who is an organism admin is allowed after one membership read, before the manifest
 *   is read. Anyone else costs the manifest read the fence makes for an agent anyway; the registry is
 *   read only for an `owner` space.
 * @structure
 *   - SpaceWriteRole / spaceWriteRoleOf() — the role a manifest object type declares
 *   - WriteStanding / writeStandingOf() / standingMeets() — the caller's person and what it may write
 *   - writeRoleMessage() / WriteRoleRefusal / writeRoleRefusalFor() — the one refusal
 *   - WRITE_ROLE_HELD_KEY / heldSpaceId() / isHeldSpace() — the spaces on the earlier behaviour
 *   - spaceWriteRoleRefusal() — the rule for a write-mode operation on a workspace's memory spaces
 * @usage
 *   const refusal = await spaceWriteRoleRefusal({ storage, config }, { principal, owner }, orgId, wsId, { key }, manifest);
 *   if (!standingMeets(spaceWriteRoleOf(space), await writeStandingOf(storage, orgId, wsId, owner))) refuse();
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import type { Storage } from '../../storage/interface.js';
import { localAccountOf } from '../../utils/gaii.js';
import { findWorkspaceRegistration, isMemoryBackedSpace, readWorkspaceMetaRecord } from '../workspace/meta-read.js';

/** What a space's writeRole asks of a writer. An unknown or missing value is `member`, the default. */
export type SpaceWriteRole = 'owner' | 'admin' | 'member';

/** The writeRole one manifest object type declares. */
export function spaceWriteRoleOf(ot: { writeRole?: unknown } | null | undefined): SpaceWriteRole {
    const r = ot?.writeRole;
    return r === 'owner' || r === 'admin' ? r : 'member';
}

/** The standing of the person a write is made for, in the terms writeRole decides on. */
export interface WriteStanding {
    /** The person's role in the organism while their membership is active, else null. */
    orgRole: string | null;
    /** The person is the workspace's registered creator. */
    workspaceCreator: boolean;
}

const isOrgManager = (role: string | null): boolean => role === 'creator' || role === 'admin';

/** Does this standing meet this writeRole? `member` asks nothing here: the other rules decide. */
export function standingMeets(role: SpaceWriteRole, standing: WriteStanding): boolean {
    if (role === 'member') return true;
    if (isOrgManager(standing.orgRole)) return true;
    return role === 'owner' && standing.workspaceCreator && standing.orgRole !== null;
}

/**
 * The standing of `owner` (a bare account name, or null for a caller of no account here) in a
 * workspace. `knownRole` skips the membership read when the caller already holds the answer.
 */
export async function writeStandingOf(
    storage: Storage, organismId: string, wsId: string, owner: string | null,
    opts: { knownRole?: string | null; needCreator?: boolean } = {},
): Promise<WriteStanding> {
    if (!owner) return { orgRole: null, workspaceCreator: false };
    let orgRole: string | null;
    if (opts.knownRole !== undefined) orgRole = opts.knownRole;
    else {
        const m = await storage.getMembership(organismId, owner);
        orgRole = m && m.status === 'active' ? m.role : null;
    }
    const workspaceCreator = opts.needCreator === false || orgRole === null || isOrgManager(orgRole)
        ? false
        : (await findWorkspaceRegistration(storage, organismId, wsId))?.creator === owner;
    return { orgRole, workspaceCreator };
}

/** Who a writeRole lets write, in words. */
function whoMayWrite(role: SpaceWriteRole): string {
    return role === 'admin' ? 'an admin or the creator of this organism' : "the workspace's creator or an admin of this organism";
}

/** The one sentence every refusal answers with: the space, its writeRole, who may write it, and what to do. */
export function writeRoleMessage(space: string, role: SpaceWriteRole): string {
    return `Writing to "${space}" is limited to ${whoMayWrite(role)} (writeRole "${role}"). Ask one of them to write it, or to set the space's writeRole to "member".`;
}

export interface WriteRoleRefusal {
    status: 403;
    code: 'ACCESS_DENIED';
    message: string;
    details: { reason: 'WRITE_ROLE'; space: string; namespace: string; writeRole: SpaceWriteRole };
}

export function writeRoleRefusalFor(space: string, namespace: string, role: SpaceWriteRole): WriteRoleRefusal {
    return {
        status: 403, code: 'ACCESS_DENIED', message: writeRoleMessage(space, role),
        details: { reason: 'WRITE_ROLE', space, namespace, writeRole: role },
    };
}

/**
 * The record under `system@<nodeId>` that names the memory spaces held on the earlier behaviour until
 * the operator decides (services/workspace/write-role-hold.ts writes it and removes from it).
 */
export const WRITE_ROLE_HELD_KEY = 'security.workspace-write-role.held';

/** A held space's id: `<organism>/<workspace>/<namespace>`, the incident entry's id too. */
export function heldSpaceId(organismId: string, wsId: string, namespace: string): string {
    return `${organismId}/${wsId}/${namespace}`;
}

/** The value of the held record: the ids, and what the step found for each. */
export interface HeldSpacesValue { spaces: Array<{ id: string } & Record<string, unknown>> }

/** Is this space held on the earlier behaviour? Read only when a write would be refused. */
export async function isHeldSpace(storage: Storage, nodeId: string, organismId: string, wsId: string, namespace: string): Promise<boolean> {
    const rec = await storage.getMemory(`system@${nodeId}`, WRITE_ROLE_HELD_KEY);
    const spaces = (rec?.value as HeldSpacesValue | undefined)?.spaces;
    const id = heldSpaceId(organismId, wsId, namespace);
    return Array.isArray(spaces) && spaces.some(s => s && s.id === id);
}

/** What a write-mode operation touches: the shapes fencedSpaceRefusal takes (services/fenced-space.ts FenceTarget). */
export type WriteRoleTarget = { key: string } | { keys: readonly string[] } | { subtree: string };

/** The namespaces of `namespaces` a target meets. `root` is `organism.<org>.w.<ws>`. */
function namespacesMet(namespaces: readonly string[], root: string, target: WriteRoleTarget): string[] {
    if ('subtree' in target) {
        let end = target.subtree.length;
        while (end > 0 && target.subtree.charCodeAt(end - 1) === 46 /* '.' */) end -= 1;
        const at = target.subtree.slice(0, end);
        return namespaces.filter(ns => {
            const space = `${root}.${ns}`;
            return at === space || at.startsWith(`${space}.`) || space.startsWith(`${at}.`);
        });
    }
    const keys = 'keys' in target ? target.keys : [target.key];
    return namespaces.filter(ns => keys.some(k => k.startsWith(`${root}.${ns}.`)));
}

/** The caller of spaceWriteRoleRefusal: the identity, and the account name when the code path holds it. */
export interface WriteRoleCaller { principal: string; owner?: string }

/**
 * The writeRole rule for a write-mode operation on one workspace: null when allowed, else the
 * refusal. Only memory-backed spaces (a row space is decided in the row service). `manifest` is the
 * manifest value when the code path already read it; undefined reads it here.
 */
export async function spaceWriteRoleRefusal(
    deps: { storage: Storage; config: { nodeId: string } },
    caller: WriteRoleCaller, organismId: string, wsId: string, target: WriteRoleTarget,
    manifest?: unknown,
): Promise<WriteRoleRefusal | null> {
    const { storage, config } = deps;
    const owner = caller.owner || localAccountOf(caller.principal);
    let orgRole: string | null = null;
    if (owner) {
        const m = await storage.getMembership(organismId, owner);
        orgRole = m && m.status === 'active' ? m.role : null;
    }
    // An organism admin meets every writeRole: no manifest is read for them.
    if (isOrgManager(orgRole)) return null;
    const value = manifest !== undefined ? manifest
        : (await readWorkspaceMetaRecord(storage, organismId, wsId, 'meta.manifest', config.nodeId, { archived: 'include' }))?.value;
    const types = Array.isArray((value as { objectTypes?: unknown } | null | undefined)?.objectTypes)
        ? ((value as { objectTypes: unknown[] }).objectTypes).filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o))
        : [];
    const kept = types.filter(ot => typeof ot.namespace === 'string' && ot.namespace && isMemoryBackedSpace(ot) && spaceWriteRoleOf(ot) !== 'member');
    if (kept.length === 0) return null;
    const met = new Set(namespacesMet(kept.map(ot => ot.namespace as string), `organism.${organismId}.w.${wsId}`, target));
    if (met.size === 0) return null;
    let standing: WriteStanding | null = null;
    for (const ot of kept) {
        const namespace = ot.namespace as string;
        if (!met.has(namespace)) continue;
        const role = spaceWriteRoleOf(ot);
        standing ??= await writeStandingOf(storage, organismId, wsId, owner, { knownRole: orgRole, needCreator: kept.some(o => met.has(o.namespace as string) && spaceWriteRoleOf(o) === 'owner') });
        if (standingMeets(role, standing)) continue;
        if (await isHeldSpace(storage, config.nodeId, organismId, wsId, namespace)) continue;
        return writeRoleRefusalFor(typeof ot.name === 'string' && ot.name ? ot.name : namespace, namespace, role);
    }
    return null;
}
