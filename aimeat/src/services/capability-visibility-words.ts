/**
 * @file src/services/capability-visibility-words.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: the stored capabilities whose visibility is a word the node does
 *   not know are named to the operator on the Security page, one incident with one entry per
 *   capability (its owner and its word), and nothing is deleted or changed.
 *
 *   WHY. Until 2026-10-26 POST and PUT /v1/capabilities stored any visibility word they were given.
 *   Such a word means nothing to the node: the list showed the capability to its owner only, and the
 *   read and the invoke by id hid only 'private', so they served it to anyone with the id. Writes now
 *   take only private, owner or public (services/capability-record.ts), and a capability with any
 *   other word is closed to everyone but its owner's side and the operator
 *   (services/capability-reach.ts; secaudit2026oct22, developer decision 2026-10-26). Nobody can tell
 *   from the word whom its writer meant, so the operator decides; until then the record stays as it
 *   is and is treated as private.
 *
 *   WHEN. Once, recorded under `system@<nodeId>` (CAPABILITY_VISIBILITY_WORDS_KEY), before the node
 *   serves (server-bootstrap/once-only-keep-steps.ts). A node with none records the run and opens no
 *   incident; a later start opens none.
 *
 *   WHAT THE OPERATOR CAN DO. Each capability is an entry of the incident (services/incident-entries.ts)
 *   with 'clear', which sets its visibility to private, or 'keep', which leaves the word, and the
 *   capability stays private to others. On the Security page, with POST
 *   /v1/admin/security/incidents/:id/resolve { name: <capability id>, resolution }, with the MCP tool
 *   aimeat_admin_incident_resolve or with its CLI twin. Operator only. The owner can also set a known
 *   word with PUT /v1/capabilities/:id.
 * @structure CAPABILITY_VISIBILITY_WORDS_KEY · CAPABILITY_VISIBILITY_INCIDENT_TYPE · unknownVisibilityCapabilities() ·
 *   reportUnknownCapabilityVisibilityOnce() · clearUnknownCapabilityVisibility()
 * @usage await reportUnknownCapabilityVisibilityOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (secaudit2026oct22; developer decision 2026-10-26).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import { recordSecurityIncident, type IncidentEntry } from './security-incident.js';
import { CAPABILITY_VISIBILITIES } from './capability-reach.js';

/** The record under `system@<nodeId>` that says this node has run the step. */
export const CAPABILITY_VISIBILITY_WORDS_KEY = 'migrations.secaudit2026oct22.capability-visibility-words';

/** The incident's type, which services/incident-decisions.ts dispatches on. */
export const CAPABILITY_VISIBILITY_INCIDENT_TYPE = 'capability_visibility_words';

/** A page size larger than any node's capability table, so one read returns every row. */
const ALL_ROWS = 10_000_000;

/** One capability with an unknown visibility word, as an entry of the incident. */
function entryOf(cap: CapabilityRecord): IncidentEntry {
    const word = String(cap.visibility);
    return {
        id: cap.id, kind: 'capability_visibility', where: `capability ${cap.id}`, action: 'clear', status: 'open',
        what: `the capability "${cap.name}" (${cap.id}) of ${cap.ownerGhii}, ${cap.status}, has the visibility word "${word}"`,
        params: { name: cap.name || cap.id, owner: cap.ownerGhii, word },
    };
}

/** Every stored capability whose visibility is not a word the node knows, in id order. */
export async function unknownVisibilityCapabilities(storage: Storage): Promise<CapabilityRecord[]> {
    const known = new Set<string>(CAPABILITY_VISIBILITIES);
    // One read of every row: offset pages over updatedAt are not stable where two rows share a time,
    // and the step runs once per node.
    const { capabilities } = await storage.listCapabilities({ page: 1, perPage: ALL_ROWS });
    return capabilities.filter(cap => !known.has(String(cap.visibility))).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Name the capabilities with an unknown visibility word in one Security page incident, one entry per
 * capability, and record the run. Writes nothing else. Throws when a write fails, and then leaves no
 * record, so the next start tries again.
 * @returns the entries named, or null on a node that ran the step before
 */
export async function reportUnknownCapabilityVisibilityOnce(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<IncidentEntry[] | null> {
    const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, CAPABILITY_VISIBILITY_WORDS_KEY);
    if (!claim) return null;
    try {
        const found = (await unknownVisibilityCapabilities(storage)).map(entryOf);
        if (found.length) {
            await recordSecurityIncident(storage, config, {
                type: CAPABILITY_VISIBILITY_INCIDENT_TYPE,
                code: 'CAPABILITY_VISIBILITY_UNKNOWN',
                actorGhii: `system@${config.nodeId}`,
                actorName: 'node',
                source: 'boot',
                detail: `${found.length} capability record(s) have a visibility word this node does not know: `
                    + `${found.map((e, i) => `${i + 1}. ${e.what}`).join('; ')}. `
                    + `Until 2026-10-26 a write stored any word; from then only ${CAPABILITY_VISIBILITIES.join(', ')}. `
                    + 'Until you decide, each of these is treated as private: only its owner, the owner\'s agents and the operator can read or invoke it. '
                    + 'Nothing was changed. Clear sets the word to private; keep leaves the word, and the capability stays private to others. '
                    + 'On the Security page, or with POST /v1/admin/security/incidents/{id}/resolve '
                    + '{ "name": "<capability id>", "resolution": "clear" | "keep" }. The incident resolves with the last one.',
                entries: found,
            });
            logger.warn(`${found.length} capability record(s) with an unknown visibility word need the operator's review; see the Security page`);
        }
        await claim.finish({ at: new Date().toISOString(), capabilities: found.map(e => e.id) });
        return found;
    } catch (err) {
        await claim.release();
        throw err;
    }
}

/** The offered action of one entry (services/incident-entries.ts EntryActor): set the visibility to private. */
export async function clearUnknownCapabilityVisibility(storage: Storage, _config: AimeatConfig, entry: IncidentEntry): Promise<string> {
    const cap = await storage.getCapability(entry.id);
    if (!cap) return 'the capability was gone already';
    if ((CAPABILITY_VISIBILITIES as readonly string[]).includes(String(cap.visibility))) {
        return `the capability "${cap.name}" has the visibility ${cap.visibility} already; nothing was changed`;
    }
    await storage.updateCapability(cap.id, { visibility: 'private', updatedAt: new Date().toISOString() });
    return `the capability "${cap.name}" is private now`;
}
