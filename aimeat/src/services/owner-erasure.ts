/**
 * @file src/services/owner-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Erasing an owner, as ONE operation. This is the whole of `DELETE /v1/owners/:name`
 *   below the HTTP layer: cancel in-flight work and return escrow, clear the GHII-level data the
 *   storage cascade does not reach, then hand off to `storage.deleteOwner()` for the per-identity
 *   cascade and the owner record.
 *
 *   WHY IT LEFT THE ROUTE. It ran as ~90 lines inside the handler, which meant two things. It could
 *   not be reached from any other door — an agent asking to close its owner's account over MCP would
 *   have had to re-implement it — and it had no transaction boundary, because a route cannot own one
 *   sensibly: `storage.transaction()` belongs to whoever owns the whole operation, and that is this
 *   function. GAP-001 has described exactly this since 2026-05-21.
 *
 *   PER-STEP TOLERANCE IS DELIBERATE and unchanged. Each clean-up step keeps its own try/catch: a
 *   subsystem that is broken must not make the account impossible to delete, and what did not clear
 *   is reported back in `deletionLog` rather than hidden. The transaction is for the other failure —
 *   a throw or a crash between steps, which used to leave the account half-erased.
 *
 *   NOT COVERED BY THE ROLLBACK: `evictAgentTelemetry` drops an in-process cache. If the transaction
 *   rolls back, that cache stays dropped; it refills from storage, so the cost is a cold read.
 *
 * @structure eraseOwner(storage, nodeId, name) → { agentsDeleted, deletionLog }
 * @usage const { deletionLog } = await eraseOwner(storage, config.nodeId, name);
 * @version-history
 *   v1.1.0 — 2026-08-29 — Outside connections and the client registrations a person brought
 *     themselves are erased. Neither backend's cascade touched `Connection`, and that is worse than
 *     a retention miss: the row holds a sealed refresh token for somebody's own mailbox, it is
 *     addressed by the GHII string, ownership is a string comparison, and a deleted username is
 *     released for reuse (owner-cascade.ts) — so registering a freed name would have inherited the
 *     previous person's inbox. The gate that finds missing deletions could not see the table:
 *     check-storage-parity.ts knew six owner column names and `principal` was not one, which is
 *     fixed in the same change.
 *   v1.0.0 — 2026-08-11 — Extracted from routes/owners.ts by pure move, then wrapped in one
 *     storage.transaction() (GAP-001's route half).
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { evictAgentTelemetry } from './telemetry-buffer.js';

export interface OwnerErasureResult {
  agentsDeleted: number;
  deletionLog: string[];
}

/** Run one clean-up step, recording what it cleared and never letting a broken subsystem block the
 *  erasure. A step that throws is logged and skipped; the label stays out of the log so the caller
 *  can see what did NOT happen. */
async function step(label: string, fn: () => Promise<string | null>, log: string[]): Promise<void> {
  try {
    const entry = await fn();
    if (entry) log.push(entry);
  } catch (err) {
    logger.warn('eraseOwner: step failed, continuing', { step: label, error: String(err) });
  }
}

/**
 * Erase an owner: everything the storage cascade cannot see, then the cascade itself, in one
 * transaction. Returns what was cleared so the caller can report it.
 */
export async function eraseOwner(storage: Storage, nodeId: string, name: string): Promise<OwnerErasureResult> {
  const agents = await storage.getAgentsByOwner(name);
  const ghii = `${name}@${nodeId}`;
  const deletionLog: string[] = [];

  await storage.transaction(async () => {
    // 1. Cancel in-flight work and return escrow for every agent.
    for (const agent of agents) {
      evictAgentTelemetry(agent.gaii);
      const providerWork = await storage.listWorkByProvider(agent.gaii);
      const requesterWork = await storage.listWorkByRequester(agent.gaii);
      for (const w of [...providerWork, ...requesterWork]) {
        if (['pending', 'accepted', 'in_progress'].includes(w.status)) {
          await storage.updateWork(w.trackingCode, { status: 'cancelled', updatedAt: new Date().toISOString() });
          if (w.cost.inEscrow > 0) {
            await storage.creditBalance(w.requesterGaii, w.cost.total);
          }
        }
      }
    }

    // 2. GHII-level data the per-identity cascade does not reach.
    await step('ghii_memory', async () => { await storage.deleteAllMemory(ghii); return 'ghii_memory'; }, deletionLog);

    await step('consents', async () => {
      const consents = await storage.listConsents(ghii, {});
      for (const c of consents) await storage.deleteConsent(c.id);
      return consents.length ? `consents:${consents.length}` : null;
    }, deletionLog);

    await step('memberships', async () => {
      const memberships = await storage.listMembershipsByGhii(ghii);
      for (const m of memberships) await storage.deleteMembership(m.id);
      return memberships.length ? `memberships:${memberships.length}` : null;
    }, deletionLog);

    await step('sessions', async () => { await storage.revokeAllSessions(name); return 'sessions'; }, deletionLog);

    await step('capabilities', async () => {
      const caps = await storage.listCapabilitiesByOwner(ghii);
      for (const c of caps) await storage.deleteCapability(c.id);
      return caps.length ? `capabilities:${caps.length}` : null;
    }, deletionLog);

    await step('scheduled_jobs', async () => {
      const jobs = await storage.listScheduledJobs({});
      const ownerJobs = jobs.filter(j => j.createdBy === ghii || j.createdBy === name);
      for (const j of ownerJobs) await storage.deleteScheduledJob(j.id);
      return ownerJobs.length ? `scheduled_jobs:${ownerJobs.length}` : null;
    }, deletionLog);

    await step('device_auth', async () => { await storage.deleteDeviceAuthByOwner(name); return 'device_auth'; }, deletionLog);

    // Agent v2 enrolment grants: an unspent grant names agents under a username that is released for
    // reuse, so a surviving row would let a daemon enrol into the NEXT person to register that name.
    await step('agent_enrolment_grants', async () => {
      const n = await storage.deleteAgentEnrolmentGrantsByOwner(name);
      return n ? `agent_enrolment_grants:${n}` : null;
    }, deletionLog);

    // Agent v2 messaging. The turns are this person's own content, and a delivery target is worse
    // than stale: it holds a URL and a secret this node would keep POSTing to, addressed by a
    // username that is released for reuse.
    await step('agent_v2_messages', async () => {
      const n = await storage.deleteAgentV2MessagesByOwner(name);
      return n ? `agent_v2_messages:${n}` : null;
    }, deletionLog);
    await step('agent_v2_push_configs', async () => {
      const n = await storage.deleteAgentV2PushConfigsByOwner(name);
      return n ? `agent_v2_push_configs:${n}` : null;
    }, deletionLog);

    // Outside accounts. Each row holds a SEALED credential to somebody's own Gmail, Outlook or
    // publishing account, addressed by the GHII string, and a deleted username is released for
    // reuse — so a surviving row would hand the next person to register that name the previous
    // person's mailbox. Agents connect their own accounts under their own GAII, so both identities
    // are cleared. The storage call takes the delegations with them.
    await step('connections', async () => {
      let n = await storage.deleteConnectionsByPrincipal(ghii);
      for (const agent of agents) n += await storage.deleteConnectionsByPrincipal(agent.gaii);
      return n ? `connections:${n}` : null;
    }, deletionLog);

    // The client registrations a person brought themselves (their own Entra app, their own X app).
    // They carry a client secret, so the same argument applies.
    await step('provider_clients', async () => {
      const clients = await storage.listPrincipalProviderClients(ghii);
      for (const c of clients) await storage.deletePrincipalProviderClient(c.provider, ghii);
      return clients.length ? `provider_clients:${clients.length}` : null;
    }, deletionLog);

    await step('apps', async () => {
      const { apps } = await storage.listApps({ ownerGaii: ghii });
      for (const a of apps) await storage.deleteApp(ghii, a.filename);
      return apps.length ? `apps:${apps.length}` : null;
    }, deletionLog);

    await step('ext_instances', async () => {
      // Some instances record the bare owner name as createdBy rather than the GHII.
      const count = await storage.deleteExtensionInstancesByOwner(ghii);
      const count2 = await storage.deleteExtensionInstancesByOwner(name);
      return count + count2 ? `ext_instances:${count + count2}` : null;
    }, deletionLog);

    await step('knowledge_links', async () => {
      const count = await storage.deleteLinksByContributor(ghii);
      return count ? `knowledge_links:${count}` : null;
    }, deletionLog);

    await step('knowledge_reviews', async () => {
      const count = await storage.deleteReviewsByOperator(ghii);
      return count ? `knowledge_reviews:${count}` : null;
    }, deletionLog);

    // 3. The per-identity cascade, agents, GHIIs and the owner record.
    await storage.deleteOwner(name);
  });

  return { agentsDeleted: agents.length, deletionLog };
}
