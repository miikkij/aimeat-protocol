/**
 * @file src/services/capability-visibility-words.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: a stored capability whose visibility is a word the node does not
 *   know is set to private, and its owner gets one notice that names it and says where to choose who
 *   may see it.
 *
 *   WHY. Until 2026-10-26 POST and PUT /v1/capabilities stored any visibility word they were given.
 *   Such a word means nothing to the node: the list showed the capability to its owner only, and the
 *   read and the invoke by id hid only 'private', so they served it to anyone with the id. Writes now
 *   take only private, owner or public (services/capability-record.ts), and a capability with any
 *   other word is closed to everyone but its owner's side and the operator
 *   (services/capability-reach.ts; secaudit2026oct22, developer decision 2026-10-26).
 *
 *   WHY THE OWNER AND NOT THE OPERATOR. Only the owner knows whom the word was meant for. The first
 *   version of this step asked the operator on the Security page to make each one private or keep the
 *   word, and both answers left the capability closed to the same people, so the question changed
 *   nothing and nobody could answer it (developer decision 2026-10-27). Setting the word to private
 *   changes no reach: capability-reach.ts already closes an unknown word exactly as it closes private.
 *
 *   WHEN. Once, recorded under `system@<nodeId>` (CAPABILITY_VISIBILITY_WORDS_KEY) with each capability's
 *   id, owner and former word, before the node serves (server-bootstrap/once-only-keep-steps.ts). A
 *   node with none records the run and changes nothing; a later start does nothing.
 *
 *   WHAT THE OWNER CAN DO. Choose the visibility on the Capabilities page (/v1/profile?tab=capabilities),
 *   with PUT /v1/capabilities/:id, or with the MCP tool aimeat_capabilities_update and its CLI twin.
 * @structure CAPABILITY_VISIBILITY_WORDS_KEY · unknownVisibilityCapabilities() · settleUnknownCapabilityVisibilityOnce()
 * @usage await settleUnknownCapabilityVisibilityOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v2.0.0 — 2026-10-27 — The step sets an unknown word to private and tells the owner, in place of the
 *     Security page incident that asked the operator (developer decision 2026-10-27).
 *   v1.0.0 — 2026-10-26 — Initial (secaudit2026oct22; developer decision 2026-10-26).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import { CAPABILITY_VISIBILITIES } from './capability-reach.js';
import { notify } from './notify.js';

/** The record under `system@<nodeId>` that says this node has run the step. */
export const CAPABILITY_VISIBILITY_WORDS_KEY = 'migrations.secaudit2026oct22.capability-visibility-words';

/** A page size larger than any node's capability table, so one read returns every row. */
const ALL_ROWS = 10_000_000;

/** One capability the step set to private, as the run record keeps it. */
export interface SettledCapability { id: string; name: string; owner: string; word: string }

/** Every stored capability whose visibility is not a word the node knows, in id order. */
export async function unknownVisibilityCapabilities(storage: Storage): Promise<CapabilityRecord[]> {
    const known = new Set<string>(CAPABILITY_VISIBILITIES);
    // One read of every row: offset pages over updatedAt are not stable where two rows share a time,
    // and the step runs once per node.
    const { capabilities } = await storage.listCapabilities({ page: 1, perPage: ALL_ROWS });
    return capabilities.filter(cap => !known.has(String(cap.visibility))).sort((a, b) => a.id.localeCompare(b.id));
}

/** The owner hears which of their capabilities are private now and where to choose. Never throws. */
async function tellOwner(storage: Storage, owner: string, caps: SettledCapability[]): Promise<void> {
    const names = caps.map(c => `"${c.name}"`).join(', ');
    await notify(storage, owner, {
        type: 'capability_visibility_private',
        title: `Now only you and your agents can use these capabilities: ${names}`,
        body: 'A capability is a service that you or your agents offer to others. Their visibility setting had a value this server does not know, '
            + 'so the server limited them to you and your agents. If other people should use a capability too, choose on the Capabilities page who can see it.',
        link: '/v1/profile?tab=capabilities',
        i18n: { key: 'capability_visibility_private', vars: { names, count: caps.length } },
    }).catch(err => logger.warn('capability-visibility-words: the owner could not be told', { owner, error: String(err) }));
}

/**
 * Set each capability with an unknown visibility word to private, tell each owner once, and record the
 * run with the former words. Throws when a write fails, and then leaves no record, so the next start
 * tries again; a capability set to private before the failure is not found again.
 * @returns the capabilities set to private, or null on a node that ran the step before
 */
export async function settleUnknownCapabilityVisibilityOnce(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<SettledCapability[] | null> {
    const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, CAPABILITY_VISIBILITY_WORDS_KEY);
    if (!claim) return null;
    try {
        const settled: SettledCapability[] = [];
        for (const cap of await unknownVisibilityCapabilities(storage)) {
            await storage.updateCapability(cap.id, { visibility: 'private', updatedAt: new Date().toISOString() });
            settled.push({ id: cap.id, name: cap.name || cap.id, owner: cap.ownerGhii, word: String(cap.visibility) });
        }
        const byOwner = new Map<string, SettledCapability[]>();
        for (const s of settled) byOwner.set(s.owner, [...(byOwner.get(s.owner) ?? []), s]);
        for (const [owner, caps] of byOwner) await tellOwner(storage, owner, caps);
        if (settled.length) logger.info(`${settled.length} capability record(s) with an unknown visibility word are private now; their owners were told`);
        await claim.finish({ at: new Date().toISOString(), capabilities: settled });
        return settled;
    } catch (err) {
        await claim.release();
        throw err;
    }
}
