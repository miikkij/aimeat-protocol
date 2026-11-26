/**
 * @file src/services/app/stray-agent-faces.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: the copies of an app's agent face that the served library
 *   aimeat-agentface wrote into the memory of accounts that do not own the app are named to the
 *   operator on the Security page, one incident with one entry per app, and nothing is deleted or
 *   changed until the operator decides.
 *
 *   WHY. An app's agent face is one public memory record, `apps.<filename>.agentface`
 *   (services/agent/face.ts agentFaceKey), and the node serves it from the app owner's record and the
 *   records of the owner's agents and ecosystem apps only. Until 2026-11-26 the library wrote the face
 *   as whoever was signed in, so an app that publishes its face at sign-in left a public copy in the
 *   own memory of every signed-in visitor. Nothing reads such a copy; it shows anyone that the account
 *   opened the app, and it carries whatever the app put into its face. The library is fixed in its own
 *   change. The copies already written are named here, and the operator decides their removal (owner
 *   ruling 2026-11-26; CLAUDE.md, Backend: what a migration cannot decide on evidence goes to the
 *   operator's page).
 *
 *   WHICH RECORDS, ON POSITIVE EVIDENCE ONLY. A public record under `apps.<filename>.agentface` is a
 *   stray copy when an app with that exact filename exists on the node (parked and hidden apps
 *   included) and the account that holds the record owns none of them. The holder is the record's
 *   owner identity, resolved to its account (ownerGhiiOf, then localAccountOf): an agent's or an
 *   ecosystem app's copy counts as its owner's, so a face an agent of the app's owner wrote is not
 *   stray (services/app/agent-face-write.ts: an agent's write lands in its own namespace by design).
 *   An identity of another node owns no app here, so its copy is stray when the app exists. A face
 *   whose filename no app on the node has is not listed and not touched: nothing shows whose it is.
 *   A record whose owner is not an identity (an `ext:` namespace) is not listed either. Archived
 *   records are read too, because an archived copy is still in the account's memory.
 *
 *   SIZE. A node holds thousands of public `apps.*` records and hundreds of apps, so both listings are
 *   read in pages of STRAY_FACES_PAGE_SIZE rows, the memory rows without their values
 *   (listAllMemoryMeta). The incident has ONE ENTRY PER APP, never one per record: one app opened by
 *   a thousand visitors would otherwise make one incident record of a thousand entries, which the
 *   Security page would load whole on every read and the operator would decide one at a time.
 *
 *   WHEN. Once, recorded under `system@<nodeId>` (STRAY_AGENT_FACES_KEY), before the node serves
 *   (server-bootstrap/once-only-keep-steps.ts). A node with none records the run and opens no incident.
 *
 *   WHAT THE OPERATOR CAN DO. Each app's entry offers 'delete' besides 'keep'
 *   (deleteStrayAgentFaceCopies). The decision runs the detection again for that filename, so it acts
 *   on the facts of the day it is made: a copy written since the start step is deleted too, and a
 *   record whose holder has since published an app of that name is not. Each copy goes to its
 *   account's bin (storage.deleteMemory sets deletedAt on both providers; listDeletedMemory shows it,
 *   and the account can take it back until the bin is swept). The owner's own record and the records
 *   of the owner's agents are never touched. The operator decides on the Security page, with POST
 *   /v1/admin/security/incidents/:id/resolve { name, resolution }, with the MCP tool
 *   aimeat_admin_incident_resolve or with its CLI twin. Operator only.
 * @structure STRAY_AGENT_FACES_KEY · STRAY_AGENT_FACES_INCIDENT_TYPE · STRAY_FACES_PAGE_SIZE ·
 *   StrayAgentFaceGroup · strayAgentFaces() · reportStrayAgentFacesOnce() · deleteStrayAgentFaceCopies()
 * @usage await reportStrayAgentFacesOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 -- 2026-11-26 -- Initial (owner ruling 2026-11-26: the node finds the copies, the operator
 *     decides their removal on the Security page).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { ownerGhiiOf, localAccountOf, runAsNode } from '../../utils/gaii.js';
import { agentFaceKey } from '../agent/face.js';
import { claimOnceOnlyStep } from '../once-only-step.js';
import { recordSecurityIncident, type IncidentEntry } from '../security-incident.js';
import { emitChange } from '../event-bus.js';

/** The incident's type, which services/incident-decisions.ts dispatches on. */
export const STRAY_AGENT_FACES_INCIDENT_TYPE = 'stray_agent_faces';

/** The record under `system@<nodeId>` that says this node has run the step. */
export const STRAY_AGENT_FACES_KEY = 'migrations.2026-11-26.stray-agent-faces';

/** Rows per page of both listings the detection reads. */
export const STRAY_FACES_PAGE_SIZE = 500;

/** The entry kind of one app's copies. */
const ENTRY_KIND = 'agent_face_copies';

/** The entry id of an app's copies: `face:<filename>`. */
const ENTRY_PREFIX = 'face:';

/** How many holders the incident's detail names per app before it says how many more. */
const HOLDERS_NAMED = 10;

const FACE_KEY = /^apps\.(.+)\.agentface$/;

/** The stray copies of one app's face: every holder of a public copy who owns no app of that filename. */
export interface StrayAgentFaceGroup {
  filename: string;
  /** The memory key every copy is under. */
  key: string;
  /** The app or apps of that filename, `<ownerName>/<filename>`; two when two accounts have one. */
  apps: string[];
  /** The identities that hold a stray copy, in the order the listing gave them. */
  holders: string[];
  copies: number;
}

/** The storage reads the detection makes, and the delete the decision makes. */
type FaceReads = Pick<Storage, 'listApps' | 'listAllMemoryMeta'>;

/** Every app filename on the node, with the accounts that own one, read in pages. */
async function appOwnersByFilename(storage: FaceReads, pageSize: number): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (let offset = 0; ; offset += pageSize) {
    // adminView: parked and operator-hidden apps are apps too, and without it they are missed.
    const { apps, total } = await storage.listApps({ adminView: true, limit: pageSize, offset });
    for (const a of apps) {
      const owners = out.get(a.filename) ?? new Set<string>();
      owners.add(a.ownerName.toLowerCase());
      out.set(a.filename, owners);
    }
    if (apps.length === 0 || offset + pageSize >= total) return out;
  }
}

/**
 * The account that holds a record, lower case, or null for an identity of another node; undefined
 * for an owner that is not an identity at all (an `ext:` namespace), which the detection leaves alone.
 */
function holderAccount(holder: string, nodeId: string): string | null | undefined {
  if (!holder.includes('@')) return undefined;
  const account = runAsNode(nodeId, () => localAccountOf(ownerGhiiOf(holder)));
  return account === null ? null : account.toLowerCase();
}

/**
 * The stray copies of every app's agent face, one group per filename. Pure reads, in pages, without
 * the records' values. `opts.filename` limits it to one app's key (the decision's second look).
 */
export async function strayAgentFaces(
  storage: FaceReads, nodeId: string, opts: { filename?: string; pageSize?: number } = {},
): Promise<StrayAgentFaceGroup[]> {
  const pageSize = opts.pageSize ?? STRAY_FACES_PAGE_SIZE;
  const owners = await appOwnersByFilename(storage, pageSize);
  const groups = new Map<string, StrayAgentFaceGroup>();
  const prefix = opts.filename ? agentFaceKey(opts.filename) : 'apps.';
  for (let offset = 0; ; offset += pageSize) {
    const { items, total } = await storage.listAllMemoryMeta({
      prefix, visibility: 'public', excludeVersionRows: true, archived: 'include', limit: pageSize, offset,
    });
    for (const row of items) {
      const filename = FACE_KEY.exec(row.key)?.[1];
      if (!filename || (opts.filename && filename !== opts.filename)) continue;
      const appOwners = owners.get(filename);
      if (!appOwners) continue;   // no app of that name here: no evidence either way
      const account = holderAccount(row.ownerGaii, nodeId);
      if (account === undefined) continue;
      if (account !== null && appOwners.has(account)) continue;   // the owner, or the owner's agent or app
      const group = groups.get(filename) ?? {
        filename, key: row.key, apps: [...appOwners].sort().map(o => `${o}/${filename}`), holders: [], copies: 0,
      };
      group.holders.push(row.ownerGaii);
      group.copies++;
      groups.set(filename, group);
    }
    if (items.length === 0 || offset + pageSize >= total) break;
  }
  return [...groups.values()].sort((a, b) => a.filename.localeCompare(b.filename));
}

/** An app's copies as an entry of the incident. */
function entryOf(g: StrayAgentFaceGroup): IncidentEntry {
  return {
    id: `${ENTRY_PREFIX}${g.filename}`, kind: ENTRY_KIND, where: g.key,
    what: `${g.copies} public ${g.copies === 1 ? 'copy' : 'copies'} of the agent face of ${g.apps.join(' and ')} in the memory of accounts that do not own the app`,
    params: { app: g.apps.join(', '), copies: g.copies },
    action: 'delete', status: 'open',
  };
}

/** One line per app for the incident's detail, naming at most HOLDERS_NAMED holders. */
function detailLine(g: StrayAgentFaceGroup, i: number): string {
  const named = g.holders.slice(0, HOLDERS_NAMED).join(', ');
  const more = g.holders.length > HOLDERS_NAMED ? ` and ${g.holders.length - HOLDERS_NAMED} more` : '';
  return `${i + 1}. ${g.apps.join(' and ')}: ${g.copies} ${g.copies === 1 ? 'copy' : 'copies'} under ${g.key} (${named}${more})`;
}

/**
 * Name the stray copies of every app's agent face in one Security page incident, one entry per app,
 * and record the run. Writes nothing else. Throws when a write fails, and then leaves no record, so
 * the next start tries again.
 * @returns the groups named, or null on a node that ran the step before
 */
export async function reportStrayAgentFacesOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<StrayAgentFaceGroup[] | null> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, STRAY_AGENT_FACES_KEY);
  if (!claim) return null;
  try {
    const found = await strayAgentFaces(storage, config.nodeId);
    if (found.length) {
      const copies = found.reduce((n, g) => n + g.copies, 0);
      await recordSecurityIncident(storage, config, {
        type: STRAY_AGENT_FACES_INCIDENT_TYPE,
        code: 'AGENT_FACE_IN_VISITOR_MEMORY',
        actorGhii: `system@${config.nodeId}`,
        actorName: 'node',
        source: 'boot',
        detail: `${copies} public ${copies === 1 ? 'copy' : 'copies'} of the agent face (an app's public description for AI agents) of ${found.length} app(s) `
          + `are in the memory of accounts that do not own the app: ${found.map(detailLine).join('; ')}. `
          + 'Until 2026-11-26 the aimeat-agentface library wrote the face as whoever was signed in, so an app that publishes its face at sign-in '
          + 'left a copy with each signed-in visitor. Nothing reads these copies: the server serves the face from the app owner\'s record. '
          + 'Each copy is public, shows that the account opened the app, and carries what the app put into its face. Nothing here was changed. '
          + 'Decide each app on the Security page, with POST /v1/admin/security/incidents/{id}/resolve '
          + '{ "name": "<entry id>", "resolution": "delete" | "keep" } or with the MCP tool aimeat_admin_incident_resolve. '
          + '"delete" moves every copy that is still stray when you decide to its account\'s bin, and never touches the owner\'s own face. '
          + 'The incident resolves with the last entry.',
        entries: found.map(entryOf),
      });
    }
    await claim.finish({ at: new Date().toISOString(), apps: found.map(g => ({ filename: g.filename, copies: g.copies })) });
    if (found.length) logger.warn(`${found.length} app(s) have copies of their agent face in visitors' memory; see the Security page`);
    return found;
  } catch (err) {
    await claim.release();
    throw err;
  }
}

/**
 * The offered action of one entry of the incident (services/incident-entries.ts EntryActor). Looks
 * again at that app's key, so it acts on today's facts, and moves each copy that is still stray to
 * its account's bin. Returns what it did, in one line.
 */
export async function deleteStrayAgentFaceCopies(storage: Storage, config: AimeatConfig, entry: IncidentEntry): Promise<string> {
  if (entry.kind !== ENTRY_KIND || !entry.id.startsWith(ENTRY_PREFIX)) throw new Error(`An entry of kind "${entry.kind}" has no action here.`);
  const filename = entry.id.slice(ENTRY_PREFIX.length);
  const [group] = await strayAgentFaces(storage, config.nodeId, { filename });
  if (!group) return 'no copy is left in the memory of an account that does not own the app';
  let deleted = 0;
  for (const holder of group.holders) {
    if (await storage.deleteMemory(holder, group.key, `system@${config.nodeId}`)) deleted++;
  }
  if (deleted) emitChange('memory');
  return deleted
    ? `${deleted} ${deleted === 1 ? 'copy was' : 'copies were'} moved to the bin of accounts that do not own the app`
    : 'no copy is left in the memory of an account that does not own the app';
}
