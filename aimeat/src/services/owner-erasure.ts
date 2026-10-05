/**
 * @file src/services/owner-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Erasing an owner, as ONE operation. This is the whole of `DELETE /v1/owners/:name`
 *   below the HTTP layer: clear the GHII-level data the storage cascade does not reach, then hand off
 *   to `storage.deleteOwner()` for the work, the per-identity cascade and the owner record.
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
 *   v1.8.0 — 2026-10-05 — The classification audit rows still waiting are written before the cascade,
 *     so the rows where the person read someone else's content take the erasure's pseudonym there
 *     (secaudit 2026-10, STO-1).
 *   v1.7.0 — 2026-10-01 — Exchange contracts and grants the account is a party to, as consumer or as
 *     provider, are revoked (services/entitlement-erasure.ts). Their keys hash the owner GHII, which
 *     a reused name reproduces, so the next holder of the name was authorised on them.
 *   v1.6.0 — 2026-10-01 — App rosters are erased (services/app-member-erasure.ts): the account's own
 *     member rows, requests, visits and blanket development rights on every app, and the whole roster,
 *     carry plan and given blanket rights of the apps it owned. Keyed by the reusable account name, so
 *     the next holder of the name inherited them.
 *   v1.5.0 — 2026-09-30 — The person's classification exceptions (records of system@<node>) are erased.
 *   v1.4.0 — 2026-09-30 — Unflushed classification audit rows of the owner are purged first.
 *   v1.3.0 — 2026-09-26 — Work is settled inside storage.deleteOwner() on both backends, for every
 *     door that deletes an account: open work cancelled, the held morsels back with a ledger line,
 *     finished work kept for the other side under the erasure's pseudonym (secaudit 2026-09: A8-4, N6).
 *   v1.2.0 — 2026-09-16 — Remote MCP servers are erased. Added by hand rather than caught by a
 *     gate: check-storage-parity keys on `ownerGaii` and this table's owner column is `ownerGhii`,
 *     which that gate deliberately does not look at yet.
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
import { purgeClassificationAudit, flushClassificationAudit } from './classification/audit.js';
import { purgeExceptions } from './classification/exceptions.js';
import { eraseAppMembership } from './app-member-erasure.js';
import { revokeEntitlementsOfAccount } from './entitlement-erasure.js';

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
  // Classification audit rows still in memory would be written after the cascade and bring the
  // erased owner back into the log (TARGET-082 review).
  purgeClassificationAudit({ owner: ghii });
  // What stays waiting is other people's content, some of it read by this person: written now, so the
  // cascade below gives those rows the erasure's pseudonym as it does the stored ones (secaudit
  // 2026-10, STO-1). Written after the cascade, they would carry the name.
  await flushClassificationAudit();

  await storage.transaction(async () => {
    // 1. The agents' cached telemetry. Their work is settled inside storage.deleteOwner(), on every
    // door that deletes an account: open work is cancelled and the requester's held morsels go back
    // with a ledger line, for the person's own identity as well as their agents', and finished work
    // stays for the other side under the erasure's pseudonym.
    for (const agent of agents) evictAgentTelemetry(agent.gaii);

    // 2. GHII-level data the per-identity cascade does not reach.
    await step('ghii_memory', async () => { await storage.deleteAllMemory(ghii); return 'ghii_memory'; }, deletionLog);
    // The person's classification exceptions are records of system@<node>, keyed by their GHII.
    await step('classification_exceptions', async () => {
      await purgeExceptions(storage, nodeId, { owner: ghii });
      return 'classification_exceptions';
    }, deletionLog);

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
    await step('agent_v2_tasks', async () => {
      const n = await storage.deleteAgentV2TasksByOwner(name);
      return n ? `agent_v2_tasks:${n}` : null;
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

    // Remote MCP servers. Same argument as connections, and it has to be made separately because
    // check-storage-parity cannot see this table: its owner column is `ownerGhii`, which is
    // deliberately outside that gate's OWNER_COLUMNS list (see the note there — eighteen tables
    // are waiting on one triage). So nothing automated would have caught a miss here. Each row
    // holds a sealed credential to somebody's issue tracker or wiki, addressed by the GHII string.
    // Only the owner's own servers go: a node-wide server has a NULL ownerGhii and belongs to the
    // operator, and an organism's belongs to the organism, so neither is this person's to erase.
    await step('mcp_servers', async () => {
      const n = await storage.deleteMcpServersByOwner(ghii);
      return n ? `mcp_servers:${n}` : null;
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

    // App rosters, right after the apps: the roster of an app goes with the app. The records live in
    // platform namespaces keyed by the bare account name, which the cascade never sees and which is
    // released for reuse, so a surviving row hands the next holder of the name the previous person's
    // memberships, development rights, requests and visits. Reads the app id from each record, so it
    // does not depend on the apps step above having succeeded.
    await step('app_membership', async () => {
      const c = await eraseAppMembership(storage, name);
      const n = c.members + c.requests + c.visits + c.plans + c.blanketGrants + c.invites;
      return n ? `app_membership:${n}` : null;
    }, deletionLog);

    // Exchange contracts and grants (services/entitlement-erasure.ts). Keyed by a hash of the
    // consumer's owner GHII, which a new holder of the name gets back unchanged, so an active record
    // authorises them; on the provider side it bills to or is carried by them. Revoked, not deleted:
    // the other party's spend and earnings history stays readable.
    await step('entitlements', async () => {
      const c = await revokeEntitlementsOfAccount(storage, name, nodeId);
      const n = c.asConsumer + c.asProvider;
      return n ? `entitlements:${n}` : null;
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
