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
 *   2026-10-25 — The scheduled_jobs step deletes every job whose ownerScope is the account, not only
 *     those the person made in person: a job an agent or ecosystem app made carries the maker's
 *     identity as createdBy and survived (secaudit2026oct22).
 *   v1.14.0 — 2026-10-23 — The compliance documents of the person's apps go (step compliance_docs),
 *     and the erasure logs itself as a done data subject request (plan doc-mvlftkh9zmc9, C4.3).
 *   v1.13.0 — 2026-10-22 — The knowledge_links step deletes the person's link rows under the bare
 *     account name too: every link writer stored that form until 2026-10-22, so the step, which asked
 *     for the GHII only, found none (secaudit 2026-10, v79).
 *   v1.12.0 — 2026-10-20 — Organism membership is read under the bare account name as well as the
 *     GHII, and the name goes from every owners/admins/members array; the grants other parties made
 *     TO the account and to each of its agents are cleared (secaudit 2026-10,
 *     eraseOwner:memberships-by-ghii-not-bare-name and agent-delete:gaii-keyed-grants-outlive-agent).
 *   v1.11.0 — 2026-10-16 — Each tolerant step runs in a savepoint, so on PostgreSQL a step the
 *     database rejects no longer aborts the transaction and blocks the erasure (QA audit E6-01).
 *   v1.10.0 — 2026-10-09 — The provider_clients step also deletes the app clients each agent brought
 *     under its own GAII (secrets audit 2026-10-09, F3).
 *   v1.9.0 — 2026-10-09 — Two steps: the account's passkeys, and the extensions the person or their
 *     agents installed. Both survived erasure and passed to the next holder of the released name
 *     (secrets audit 2026-10-09, finding 1.2).
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
import type { Storage, OrganismRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { ERASED_PARTY_PREFIX, erasedPartyPseudonym } from '../storage/erased-party.js';
import { inSavepoint } from './tolerant-step.js';
import { evictAgentTelemetry } from './telemetry-buffer.js';
import { purgeClassificationAudit, flushClassificationAudit } from './classification/audit.js';
import { purgeExceptions } from './classification/exceptions.js';
import { eraseAppMembership } from './app-member-erasure.js';
import { revokeEntitlementsOfAccount } from './entitlement-erasure.js';
import { uninstallExtension } from './extension-lifecycle.js';
import { appendRequest, removeAppDocsOfOwner } from './compliance-docs.js';

export interface OwnerErasureResult {
  agentsDeleted: number;
  deletionLog: string[];
}

/** Run one clean-up step, recording what it cleared and never letting a broken subsystem block the
 *  erasure. A step that throws is logged and skipped; the label stays out of the log so the caller
 *  can see what did NOT happen. */
async function step(label: string, fn: () => Promise<string | null>, log: string[], storage: Storage): Promise<void> {
  try {
    // A savepoint per step: on PostgreSQL a statement the database rejects would otherwise mark the
    // whole transaction failed, and deleteOwner at the end would throw, so one broken step blocked
    // the whole erasure, the opposite of what the header promises (QA audit E6-01).
    const entry = await inSavepoint(storage, fn);
    if (entry) log.push(entry);
  } catch (err) {
    logger.warn('eraseOwner: step failed, continuing', { step: label, error: String(err) });
  }
}

/** What taking the erased account off one organism came to. */
type OrganismOutcome = 'none' | 'removed' | 'handed-on' | 'orphaned';

/**
 * Take the erased account out of one organism's roster: `owners`, `admins` and `members`.
 *
 * THE ARRAYS NAME A PERSON BY THE BARE ACCOUNT NAME, which is released for reuse, so a surviving
 * entry made the next holder of that name an active member, and a manager where this person was
 * creator or admin (secaudit 2026-10). Both spellings are dropped, because a row written by another
 * code path may carry the GHII.
 *
 * THE SOLE OWNER. `owners` is never empty: an organism with no owner is the state nobody can repair
 * from the inside (services/organism-ownership.ts), and the rule for an owner who departs is that
 * somebody else holds it first. An erasure cannot ask, so it hands the organism to the first admin,
 * then to the first member, and that account's membership becomes `creator`. When nobody at all is
 * left, the holder becomes the erasure pseudonym: no account can equal it (erased-party.ts), so the
 * organism is held by nobody rather than by a name somebody can register, and the operator's
 * break-glass (routes/admin-organisms.ts) seats a new owner.
 */
async function removeAccountFromOrganism(
  storage: Storage, organism: OrganismRecord, name: string, ghii: string,
): Promise<OrganismOutcome> {
  const erased = new Set([name, ghii]);
  const admins = organism.admins ?? [];
  const members = organism.members ?? [];
  // The same fallback organismOwners() uses: a record written before ownership went plural named its
  // one owner in the deprecated mirror.
  const owners = organism.owners?.length ? organism.owners : [organism.creatorGhii];
  const heldIt = owners.some(o => erased.has(o));
  if (!heldIt && !admins.some(a => erased.has(a)) && !members.some(m => erased.has(m))) return 'none';

  let outcome: OrganismOutcome = 'removed';
  let nextOwners = owners.filter(o => !erased.has(o));
  if (heldIt && nextOwners.length === 0) {
    const successor = [...admins, ...members].find(c => !erased.has(c) && !c.startsWith(ERASED_PARTY_PREFIX));
    nextOwners = [successor ?? erasedPartyPseudonym()];
    outcome = successor ? 'handed-on' : 'orphaned';
  }

  const kept = (xs: string[]) => xs.filter(x => !erased.has(x));
  // An owner is not also an admin, and every owner is a member: the two rules ownershipFields()
  // keeps. The pseudonym is not a member, because it is nobody.
  const seated = nextOwners.filter(o => !o.startsWith(ERASED_PARTY_PREFIX));
  await storage.updateOrganism(organism.id, {
    owners: nextOwners,
    creatorGhii: nextOwners[0],
    admins: kept(admins).filter(a => !nextOwners.includes(a)),
    members: [...new Set([...kept(members), ...seated])],
    updatedAt: new Date().toISOString(),
  });
  if (outcome === 'handed-on') {
    const membership = await storage.getMembership(organism.id, nextOwners[0]);
    if (membership) await storage.updateMembership(membership.id, { role: 'creator', status: 'active' });
  }
  return outcome;
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
    await step('ghii_memory', async () => { await storage.deleteAllMemory(ghii); return 'ghii_memory'; }, deletionLog, storage);
    // The person's classification exceptions are records of system@<node>, keyed by their GHII.
    await step('classification_exceptions', async () => {
      await purgeExceptions(storage, nodeId, { owner: ghii });
      return 'classification_exceptions';
    }, deletionLog, storage);

    await step('consents', async () => {
      const consents = await storage.listConsents(ghii, {});
      for (const c of consents) await storage.deleteConsent(c.id);
      return consents.length ? `consents:${consents.length}` : null;
    }, deletionLog, storage);

    // Organism membership. The row names a person by the BARE account name on create, on open join
    // and on a direct add (organism-lifecycle.ts, invitations.ts), and this step read it by GHII
    // only: it matched nothing, deleted nothing and left the roster arrays untouched, so the next
    // holder of the released name was an active member of every organism this person belonged to
    // and a manager where they were creator or admin (secaudit 2026-10). The owner EXPORT was fixed
    // to read both spellings on 2026-09-08; the erasure was not. Both are read here, and the arrays
    // are cleared whether or not a row was found, because they are a second record of the same fact.
    await step('memberships', async () => {
      const byGhii = await storage.listMembershipsByGhii(ghii);
      const byName = await storage.listMembershipsByGhii(name);
      const rows = [...byGhii, ...byName.filter(m => !byGhii.some(g => g.id === m.id))];
      const organismIds = new Set(rows.map(m => m.organismId));
      // An array entry can outlive its row, so the organisms are collected by the roster too. The
      // `member` filter reads `members`, which holds every owner and admin as well.
      for (const spelling of [name, ghii]) {
        for (const o of await storage.listOrganisms({ member: spelling })) organismIds.add(o.id);
      }
      for (const m of rows) await storage.deleteMembership(m.id);

      const counts: Record<OrganismOutcome, number> = { none: 0, removed: 0, 'handed-on': 0, orphaned: 0 };
      for (const id of organismIds) {
        const organism = await storage.getOrganism(id);
        if (!organism) continue;
        counts[await removeAccountFromOrganism(storage, organism, name, ghii)]++;
      }
      const touched = counts.removed + counts['handed-on'] + counts.orphaned;
      if (counts.orphaned) {
        logger.warn('eraseOwner: organism left without a live owner', { owner: name, organisms: counts.orphaned });
      }
      const entry = [
        rows.length ? `memberships:${rows.length}` : null,
        touched ? `organism_rosters:${touched}` : null,
        counts['handed-on'] ? `organisms_handed_on:${counts['handed-on']}` : null,
        counts.orphaned ? `organisms_orphaned:${counts.orphaned}` : null,
      ].filter(Boolean).join(',');
      return entry || null;
    }, deletionLog, storage);

    // Grants other parties made TO this account, which no owner column can find: a consent whose
    // recipient is this person (`alice@node`, and the `ghii:alice@node` form a workspace-role grant
    // uses), a sharing group that holds them as a member, a board that lists them. The agents go
    // below, each with its own sweep, because a grant can name the exact GAII.
    await step('grants_to_account', async () => {
      let n = 0;
      for (const identity of [ghii, `ghii:${ghii}`]) {
        const c = await storage.clearGrantsToIdentity(identity);
        n += c.consents + c.organisms + c.boards + c.sharingGroups + c.registrations;
      }
      return n ? `grants_to_account:${n}` : null;
    }, deletionLog, storage);

    // The same sweep per agent. storage.deleteAgent runs it, but the account deletion below takes
    // the agents through deleteOwner's cascade instead, which never calls that method.
    await step('grants_to_agents', async () => {
      let n = 0;
      for (const agent of agents) {
        const c = await storage.clearGrantsToIdentity(agent.gaii);
        n += c.consents + c.organisms + c.boards + c.sharingGroups + c.registrations;
      }
      return n ? `grants_to_agents:${n}` : null;
    }, deletionLog, storage);

    await step('sessions', async () => { await storage.revokeAllSessions(name); return 'sessions'; }, deletionLog, storage);

    await step('capabilities', async () => {
      const caps = await storage.listCapabilitiesByOwner(ghii);
      for (const c of caps) await storage.deleteCapability(c.id);
      return caps.length ? `capabilities:${caps.length}` : null;
    }, deletionLog, storage);

    await step('scheduled_jobs', async () => {
      const jobs = await storage.listScheduledJobs({});
      // Every job that acts in this account, whoever made it: the account's agents and ecosystem apps
      // stamp their own identity as createdBy, and ownerScope names the account (secaudit2026oct22,
      // owner-erasure:agent-made-schedules-survive-and-rebind).
      const ownerJobs = jobs.filter(j => j.createdBy === ghii || j.createdBy === name
        || j.ownerScope === ghii || j.ownerScope === name);
      for (const j of ownerJobs) await storage.deleteScheduledJob(j.id);
      return ownerJobs.length ? `scheduled_jobs:${ownerJobs.length}` : null;
    }, deletionLog, storage);

    await step('device_auth', async () => { await storage.deleteDeviceAuthByOwner(name); return 'device_auth'; }, deletionLog, storage);

    // Agent v2 enrolment grants: an unspent grant names agents under a username that is released for
    // reuse, so a surviving row would let a daemon enrol into the NEXT person to register that name.
    await step('agent_enrolment_grants', async () => {
      const n = await storage.deleteAgentEnrolmentGrantsByOwner(name);
      return n ? `agent_enrolment_grants:${n}` : null;
    }, deletionLog, storage);

    // Agent v2 messaging. The turns are this person's own content, and a delivery target is worse
    // than stale: it holds a URL and a secret this node would keep POSTing to, addressed by a
    // username that is released for reuse.
    await step('agent_v2_messages', async () => {
      const n = await storage.deleteAgentV2MessagesByOwner(name);
      return n ? `agent_v2_messages:${n}` : null;
    }, deletionLog, storage);
    await step('agent_v2_push_configs', async () => {
      const n = await storage.deleteAgentV2PushConfigsByOwner(name);
      return n ? `agent_v2_push_configs:${n}` : null;
    }, deletionLog, storage);
    await step('agent_v2_tasks', async () => {
      const n = await storage.deleteAgentV2TasksByOwner(name);
      return n ? `agent_v2_tasks:${n}` : null;
    }, deletionLog, storage);

    // Outside accounts. Each row holds a SEALED credential to somebody's own Gmail, Outlook or
    // publishing account, addressed by the GHII string, and a deleted username is released for
    // reuse — so a surviving row would hand the next person to register that name the previous
    // person's mailbox. Agents connect their own accounts under their own GAII, so both identities
    // are cleared. The storage call takes the delegations with them.
    await step('connections', async () => {
      let n = await storage.deleteConnectionsByPrincipal(ghii);
      for (const agent of agents) n += await storage.deleteConnectionsByPrincipal(agent.gaii);
      return n ? `connections:${n}` : null;
    }, deletionLog, storage);

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
    }, deletionLog, storage);

    // The client registrations a person brought themselves (their own Entra app, their own X app),
    // and those each of their agents brought under its own GAII. They carry a client secret, so the
    // same argument applies. The agents' were missed until 2026-10-09 (secrets audit 2026-10-09, F3).
    await step('provider_clients', async () => {
      let n = 0;
      for (const principal of [ghii, ...agents.map(a => a.gaii)]) {
        const clients = await storage.listPrincipalProviderClients(principal);
        for (const c of clients) await storage.deletePrincipalProviderClient(c.provider, principal);
        n += clients.length;
      }
      return n ? `provider_clients:${n}` : null;
    }, deletionLog, storage);

    await step('apps', async () => {
      const { apps } = await storage.listApps({ ownerGaii: ghii });
      for (const a of apps) await storage.deleteApp(ghii, a.filename);
      return apps.length ? `apps:${apps.length}` : null;
    }, deletionLog, storage);

    // The compliance documents of this person's apps (registers, requests, breaches, impact
    // assessments; plan doc-mvlftkh9zmc9) are records of system@<node> keyed by the bare account
    // name, which the cascade does not reach and which is released for reuse.
    await step('compliance_docs', async () => {
      const n = await removeAppDocsOfOwner(storage, nodeId, name);
      return n ? `compliance_docs:${n}` : null;
    }, deletionLog, storage);

    // App rosters, right after the apps: the roster of an app goes with the app. The records live in
    // platform namespaces keyed by the bare account name, which the cascade never sees and which is
    // released for reuse, so a surviving row hands the next holder of the name the previous person's
    // memberships, development rights, requests and visits. Reads the app id from each record, so it
    // does not depend on the apps step above having succeeded.
    await step('app_membership', async () => {
      const c = await eraseAppMembership(storage, name);
      const n = c.members + c.requests + c.visits + c.plans + c.blanketGrants + c.invites;
      return n ? `app_membership:${n}` : null;
    }, deletionLog, storage);

    // Exchange contracts and grants (services/entitlement-erasure.ts). Keyed by a hash of the
    // consumer's owner GHII, which a new holder of the name gets back unchanged, so an active record
    // authorises them; on the provider side it bills to or is carried by them. Revoked, not deleted:
    // the other party's spend and earnings history stays readable.
    await step('entitlements', async () => {
      const c = await revokeEntitlementsOfAccount(storage, name, nodeId);
      const n = c.asConsumer + c.asProvider;
      return n ? `entitlements:${n}` : null;
    }, deletionLog, storage);

    // Passkeys. The row is found by credential id and names the account by its bare name, which is
    // released for reuse, so a surviving row signed the previous holder's device in to the next
    // holder's account (secrets audit 2026-10-09, finding 1.2).
    await step('passkeys', async () => {
      const n = await storage.deletePasskeysByOwner(name);
      return n ? `passkeys:${n}` : null;
    }, deletionLog, storage);

    // Extensions this person or their agents installed. The installer is who may upload new code to
    // an extension, and its stored secrets are carried across an update, so a surviving row made the
    // next holder of the name the installer of the previous person's extension, keys included.
    // uninstallExtension takes the extension's memory, its instances' memory and its schedules too.
    await step('extensions', async () => {
      const installers = new Set([ghii, name, ...agents.map(a => a.gaii)]);
      const mine = (await storage.listExtensions({ lean: true })).filter(e => installers.has(e.installedBy));
      for (const e of mine) await uninstallExtension({ storage }, e.name);
      return mine.length ? `extensions:${mine.length}` : null;
    }, deletionLog, storage);

    await step('ext_instances', async () => {
      // Some instances record the bare owner name as createdBy rather than the GHII.
      const count = await storage.deleteExtensionInstancesByOwner(ghii);
      const count2 = await storage.deleteExtensionInstancesByOwner(name);
      return count + count2 ? `ext_instances:${count + count2}` : null;
    }, deletionLog, storage);

    await step('knowledge_links', async () => {
      // The links this person contributed. Written with the GHII since 2026-10-22; a row written
      // before carries the bare account name, the form every link writer stored until then (secaudit
      // 2026-10, v79). The links of their packages go with the per-identity cascade (ownerGaii).
      const count = await storage.deleteLinksByContributor(ghii);
      const count2 = await storage.deleteLinksByContributor(name);
      return count + count2 ? `knowledge_links:${count + count2}` : null;
    }, deletionLog, storage);

    await step('knowledge_reviews', async () => {
      const count = await storage.deleteReviewsByOperator(ghii);
      return count ? `knowledge_reviews:${count}` : null;
    }, deletionLog, storage);

    // 3. The per-identity cascade, agents, GHIIs and the owner record.
    await storage.deleteOwner(name);
  });

  // The erasure is a data subject request the node carried out (GDPR art. 17): it logs itself in the
  // node's request list, so the operator can show it was done and when (plan doc-mvlftkh9zmc9, C4.3).
  // The account name is kept there as the proof of the request, and nothing else about the person.
  const at = new Date().toISOString();
  await appendRequest(storage, nodeId, { kind: 'node' }, {
    kind: 'erasure', subject: name, receivedAt: at, status: 'done', closedAt: at, channel: 'node', auto: true,
  }).catch(err => logger.warn('owner-erasure: the erasure was not logged as a data subject request', { name, error: String(err) }));

  return { agentsDeleted: agents.length, deletionLog };
}
