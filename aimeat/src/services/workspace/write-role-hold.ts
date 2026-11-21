/**
 * @file src/services/workspace/write-role-hold.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The once-per-node boot step for the writeRole of memory-backed workspace record spaces,
 *   and the operator's two decisions on what it finds.
 *
 *   WHY. Since 2026-11-21 a space's writeRole holds on every write path (services/organism/write-role.ts):
 *   `owner` is the workspace's creator or an organism admin, `admin` an organism admin. Before, a
 *   memory-backed space ignored it, so a member with a contributor grant may already be writing a
 *   space marked `owner` or `admin`. The developer's ruling: "a space that declares owner or admin
 *   today and that members already write into is not changed silently; the node finds such spaces
 *   itself and lists them for the operator, and the rule is enforced for the rest at once."
 *
 *   THE EVIDENCE. For every workspace of every organism, the manifest that counts, and in it every
 *   memory-backed object type whose writeRole is `owner` or `admin`. The records under that space's
 *   namespace are read, archived ones too, and each record's owner account is a writer. A writer who is
 *   an active member and whose standing does not meet the writeRole (standingMeets) is positive
 *   evidence that members write the space today. A writer who is no longer an active member could not
 *   write it under either rule, and is not counted.
 *
 *   WHAT IT DOES. A space with such a writer is HELD: it is named in WRITE_ROLE_HELD_KEY under
 *   `system@<nodeId>`, which write-role.ts reads before it refuses, so the space works as before. Every
 *   held space is one entry of ONE Security page incident (type `workspace_write_role`), each with
 *   two decisions on REST (POST /v1/admin/security/incidents/:id/resolve { name, resolution }), MCP
 *   (aimeat_admin_incident_resolve) and the page:
 *     - "enforce": the space leaves the hold, and its writeRole holds from then on;
 *     - "keep": the members keep writing it, and so the space's writeRole is set to "member" in the
 *       manifest, then the space leaves the hold. The manifest says what happens.
 *   Every other space gets the rule at once. Nothing is deleted, and nothing in this file throws on
 *   data: a manifest or a record of any shape is read or passed over. A store that cannot be read
 *   throws, the claim is released, and the next start tries again (services/once-only-step.ts).
 *
 *   RESOLVING OR DELETING THE INCIDENT without deciding keeps every open space held, as an open
 *   entry of any incident is kept (services/incident-entries.ts). The space's creator or an admin can
 *   also set the writeRole to "member" in the manifest, which ends the question for that space.
 * @structure WRITE_ROLE_STEP_KEY · WRITE_ROLE_INCIDENT_TYPE · WRITE_ROLE_ENTRY_KIND · HeldSpace ·
 *   findMemberWrittenSpaces(storage, config) · holdMemberWrittenSpacesOnce(storage, config) ·
 *   enforceHeldSpace() · letMembersWriteHeldSpace()
 * @usage await holdMemberWrittenSpacesOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (ruling decision-writerole-on-memory-record-spaces-who-is-owner-and-how-it-is,
 *     incident mv6pffzu).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { listAllMemoryPages } from '../../storage/memory-pages.js';
import { localAccountOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { claimOnceOnlyStep } from '../once-only-step.js';
import { recordSecurityIncident, type IncidentEntry } from '../security-incident.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { emitWorkspaceChange } from '../event-bus.js';
import {
    WRITE_ROLE_HELD_KEY, heldSpaceId, spaceWriteRoleOf, standingMeets, writeStandingOf,
    type HeldSpacesValue, type SpaceWriteRole,
} from '../organism/write-role.js';
import { isMemoryBackedSpace } from './meta-read.js';
import { listOrganismWorkspaceEntries, readWorkspaceMetaRecord, writeWorkspaceMetaRecord } from './meta.js';

/** The record under `system@<nodeId>` that says the step has run. */
export const WRITE_ROLE_STEP_KEY = 'migrations.writerole2026nov21.member-written-spaces';

/** The incident's type, which services/incident-decisions.ts dispatches on. */
export const WRITE_ROLE_INCIDENT_TYPE = 'workspace_write_role';

/** The kind of each entry, which the Security page words in the reader's language. */
export const WRITE_ROLE_ENTRY_KIND = 'space_write_role';

/** How many organisms one read takes. */
const ORG_PAGE = 100;

/** How many writers an entry names one by one. */
const WRITERS_SHOWN = 10;

/** One space the step holds on the earlier behaviour. */
export interface HeldSpace {
    id: string;
    organismId: string;
    organismName: string;
    wsId: string;
    wsName: string;
    namespace: string;
    space: string;
    writeRole: SpaceWriteRole;
    /** The members who wrote it and would be refused now, by account name. */
    writers: string[];
}

/**
 * Every memory space that declares `owner` or `admin` and holds a record of an active member whose
 * standing does not meet it. Reads only; throws when the store cannot be read.
 */
export async function findMemberWrittenSpaces(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>): Promise<HeldSpace[]> {
    const found: HeldSpace[] = [];
    for (let page = 1; ; page++) {
        const orgs = await storage.listOrganisms({ page, perPage: ORG_PAGE, archived: 'include' });
        for (const org of orgs) {
            for (const entry of await listOrganismWorkspaceEntries(storage, org.id)) {
                const rec = await readWorkspaceMetaRecord(storage, org.id, entry.id, 'meta.manifest', config.nodeId, { archived: 'include' });
                const types = (rec?.value as { objectTypes?: unknown } | null | undefined)?.objectTypes;
                if (!Array.isArray(types)) continue;
                for (const ot of types) {
                    if (!ot || typeof ot !== 'object' || Array.isArray(ot)) continue;
                    const o = ot as Record<string, unknown>;
                    const role = spaceWriteRoleOf(o);
                    if (role === 'member' || typeof o.namespace !== 'string' || !o.namespace || !isMemoryBackedSpace(o)) continue;
                    const writers = await refusedWriters(storage, org.id, entry.id, o.namespace, role);
                    if (!writers.length) continue;
                    found.push({
                        id: heldSpaceId(org.id, entry.id, o.namespace), organismId: org.id, organismName: org.name ?? org.id,
                        wsId: entry.id, wsName: typeof entry.name === 'string' && entry.name ? entry.name : entry.id,
                        namespace: o.namespace, space: typeof o.name === 'string' && o.name ? o.name : o.namespace, writeRole: role, writers,
                    });
                }
            }
        }
        if (orgs.length < ORG_PAGE) break;
    }
    return found;
}

/** The active members who wrote records under the space and whose standing does not meet `role`. */
async function refusedWriters(storage: Storage, organismId: string, wsId: string, namespace: string, role: SpaceWriteRole): Promise<string[]> {
    const { items } = await listAllMemoryPages(storage, { prefix: `organism.${organismId}.w.${wsId}.${namespace}.`, archived: 'include' });
    const accounts = new Set<string>();
    for (const r of items) {
        const name = localAccountOf(r.ownerGaii);
        if (name) accounts.add(name);
    }
    const refused: string[] = [];
    for (const name of [...accounts].sort()) {
        const standing = await writeStandingOf(storage, organismId, wsId, name, { needCreator: role === 'owner' });
        if (standing.orgRole !== null && !standingMeets(role, standing)) refused.push(name);
    }
    return refused;
}

/** Who a writeRole lets write, for an entry's line. */
const whoOf = (role: SpaceWriteRole): string => role === 'admin' ? 'organism admins' : "the workspace's creator and organism admins";

/** One held space as an entry of the incident (services/incident-entries.ts). */
function entryOf(s: HeldSpace): IncidentEntry {
    const shown = s.writers.slice(0, WRITERS_SHOWN).join(', ') + (s.writers.length > WRITERS_SHOWN ? ` and ${s.writers.length - WRITERS_SHOWN} more` : '');
    return {
        id: s.id, kind: WRITE_ROLE_ENTRY_KIND, where: `organism.${s.organismId}.w.${s.wsId}.${s.namespace}`, action: 'enforce', status: 'open',
        what: `the space "${s.space}" of the workspace "${s.wsName}" in "${s.organismName}": its writeRole "${s.writeRole}" lets ${whoOf(s.writeRole)} write it, and ${shown} wrote there as members`,
        params: { space: s.space, workspace: s.wsName, organism: s.organismName, writeRole: s.writeRole, writers: shown },
    };
}

/** Add `spaces` to the held record, keeping what it holds. */
async function holdSpaces(storage: Storage, nodeId: string, spaces: HeldSpace[]): Promise<void> {
    await updateRecord(storage, `system@${nodeId}`, WRITE_ROLE_HELD_KEY,
        v => (Array.isArray((v as HeldSpacesValue | null)?.spaces) ? (v as HeldSpacesValue) : { spaces: [] }),
        cur => {
            const have = new Set(cur.spaces.map(s => s.id));
            const add = spaces.filter(s => !have.has(s.id)).map(s => ({ ...s }));
            return add.length ? { spaces: [...cur.spaces, ...add] } : UNCHANGED;
        },
        { tag: 'security' });
}

/** Take one space out of the held record. Answers whether it was held. */
async function releaseSpace(storage: Storage, nodeId: string, id: string): Promise<boolean> {
    let was = false;
    await updateRecord(storage, `system@${nodeId}`, WRITE_ROLE_HELD_KEY,
        v => (Array.isArray((v as HeldSpacesValue | null)?.spaces) ? (v as HeldSpacesValue) : { spaces: [] }),
        cur => {
            was = cur.spaces.some(s => s.id === id);
            return was ? { spaces: cur.spaces.filter(s => s.id !== id) } : UNCHANGED;
        },
        { tag: 'security' });
    return was;
}

/**
 * Hold the spaces members already write into, and name them in one Security page incident. Once
 * per node. Throws when the store cannot be read or written, and then leaves no record, so the next
 * start tries again.
 * @returns the spaces held, or null on a node that ran the step before
 */
export async function holdMemberWrittenSpacesOnce(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>): Promise<HeldSpace[] | null> {
    const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, WRITE_ROLE_STEP_KEY);
    if (!claim) return null;
    try {
        const found = await findMemberWrittenSpaces(storage, config);
        if (found.length) {
            // The hold first: an incident without its hold would offer a decision on a space the rule
            // already refuses.
            await holdSpaces(storage, config.nodeId, found);
            const r = await recordSecurityIncident(storage, config, {
                type: WRITE_ROLE_INCIDENT_TYPE,
                code: 'WRITE_ROLE_MEMBERS_WROTE',
                actorGhii: `system@${config.nodeId}`,
                actorName: 'node',
                source: 'boot',
                detail: `${found.length} workspace record space(s) declare writeRole "owner" or "admin", and members who do not meet it have written there: `
                    + `${found.map(s => `"${s.space}" (${s.wsName}, ${s.organismName})`).join(', ')}. `
                    + 'From now on writeRole "owner" lets the workspace\'s creator and organism admins write a space, and "admin" lets organism admins write it, on every write path. '
                    + 'These spaces work as before until you decide each one: "enforce" applies the rule, so the members are refused; "keep" sets the space\'s writeRole to "member", so the members keep writing. '
                    + 'POST /v1/admin/security/incidents/{id}/resolve with { "name": <entry id>, "resolution": "enforce" | "keep" }, or the MCP tool aimeat_admin_incident_resolve.',
                params: { count: String(found.length) },
                entries: found.map(entryOf),
            });
            // recordSecurityIncident does not throw; a held space without its incident would never be
            // asked about, so the step is tried again at the next start.
            if (!r.recorded) throw new Error('the writeRole incident was not recorded');
        }
        await claim.finish({ at: new Date().toISOString(), held: found.map(s => s.id) });
        if (found.length) logger.warn(`${found.length} workspace record space(s) keep their members' writes until the operator decides; see the Security page`);
        return found;
    } catch (err) {
        await claim.release();
        throw err;
    }
}

/** The offered action of one entry (services/incident-entries.ts EntryActor): the space's writeRole holds from now on. */
export async function enforceHeldSpace(storage: Storage, config: AimeatConfig, entry: IncidentEntry): Promise<string> {
    const was = await releaseSpace(storage, config.nodeId, entry.id);
    const space = String(entry.params?.space ?? entry.id);
    return was ? `the space "${space}" takes its writeRole now` : `the space "${space}" was not held any more, so its writeRole already held`;
}

/**
 * The 'keep' of one entry: the members keep writing, so the manifest says so. The space's writeRole is
 * set to "member" in the manifest copy that counts, on that copy's version, then the space leaves the
 * hold. A space the manifest no longer declares, or declares as "member" already, only leaves the hold.
 */
export async function letMembersWriteHeldSpace(storage: Storage, config: AimeatConfig, entry: IncidentEntry): Promise<string> {
    const parts = entry.id.split('/');
    const [organismId, wsId] = parts;
    const namespace = parts.slice(2).join('/');
    const space = String(entry.params?.space ?? namespace);
    let changed = false;
    if (organismId && wsId && namespace) {
        const rec = await readWorkspaceMetaRecord(storage, organismId, wsId, 'meta.manifest', config.nodeId, { archived: 'include' });
        const value = rec?.value as { objectTypes?: unknown } | null | undefined;
        if (rec && value && Array.isArray(value.objectTypes)) {
            const objectTypes = value.objectTypes.map(ot => {
                if (!ot || typeof ot !== 'object' || Array.isArray(ot)) return ot;
                const o = ot as Record<string, unknown>;
                if (o.namespace !== namespace || !isMemoryBackedSpace(o) || spaceWriteRoleOf(o) === 'member') return ot;
                changed = true;
                return { ...o, writeRole: 'member' };
            });
            if (changed) {
                await writeWorkspaceMetaRecord(storage, rec.key, rec.ownerGaii, { ...value, objectTypes }, rec, rec.version);
                emitWorkspaceChange(organismId, wsId);
            }
        }
    }
    await releaseSpace(storage, config.nodeId, entry.id);
    return changed ? `the space "${space}" lets every member write it now (writeRole "member")` : `the space "${space}" already let every member write it, or is gone`;
}
