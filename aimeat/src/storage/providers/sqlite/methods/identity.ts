/**
 * @file src/storage/providers/sqlite/methods/identity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/identity.ts (identityMethods), so a
 *   fix in one provider finds its twin by file name. Bodies moved verbatim from the files named in the
 *   version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure identityMethods
 * @usage Object.assign(SqliteStorage.prototype, identityMethods) in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-10-10 — deleteOwner also deletes the OTK rows stored under the bare account name
 *     (secaudit 2026-10-10 C0).
 *   v1.0.0 — 2026-10-05 — createOwner, getOwner, listOwners, updateOwner, deleteOwner, deserializeOwner moved
 *     here from owner.ts; 9 methods (createAgent, getAgent, getAgentsByOwner, …) moved here from agents.ts;
 *     10 methods (createGHII, getGHII, getGHIIByOwner, …) moved here from identity-nodes.ts; revokeToken,
 *     revokeTokenIfAbsent, isTokenRevoked, cleanExpiredRevocations moved here from apps.ts so the file
 *     mirrors postgres-kysely/methods/identity.ts (secaudit 2026-10, M8).
 */
import type { OwnerRecord, AgentRecord, GHIIRecord, GHIIPatch } from '../../../interface.js';
import { pseudonymiseWriter } from '../repos/memory-tally.js';
import { pseudonymisePurchaseParties } from '../repos/app-purchase-erasure.js';
import { pseudonymiseProvenanceOwner } from '../repos/ai-provenance-erasure.js';
import { settleErasedPartyWork, settleDeletedAgentWork } from '../repos/work-erasure.js';
import { pseudonymiseLedgerParty } from '../repos/ledger-erasure.js';
import { deleteInstalledCortexes } from '../repos/cortex-erasure.js';
import { deleteEcosystemApps } from '../repos/eco-app-erasure.js';
import { deleteAccountCredentials } from '../repos/credential-erasure.js';
import { erasedPartyPseudonym, erasedAccountParty } from '../../../erased-party.js';
import type { SqliteStorage } from '../index.js';
import { logger } from '../../../../utils/logger.js';
import { resolveGhiiIn } from '../repos/ghii-resolve.js';

export const identityMethods = {
  // ══════════════════════════════════════════════════════════
  // ── Owners ──
  // ══════════════════════════════════════════════════════════

  async createOwner(this: SqliteStorage, owner: OwnerRecord): Promise<OwnerRecord> {
    try {
      this.db.prepare(
        `INSERT INTO owners (name, displayName, publicKey, roles, createdAt)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        owner.name,
        owner.displayName ?? null,
        owner.publicKey,
        JSON.stringify(owner.roles),
        owner.createdAt,
      );
      return owner;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('NAME_TAKEN', { cause: err });
      throw err;
    }
  },

  async getOwner(this: SqliteStorage, name: string): Promise<OwnerRecord | null> {
    const row = this.db.prepare('SELECT * FROM owners WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeOwner(row) : null;
  },

  async listOwners(this: SqliteStorage): Promise<OwnerRecord[]> {
    const rows = this.db.prepare('SELECT * FROM owners').all() as Record<string, unknown>[];
    return rows.map(r => this.deserializeOwner(r));
  },

  async updateOwner(this: SqliteStorage, name: string, updates: Partial<OwnerRecord>): Promise<OwnerRecord | null> {
    const existing = await this.getOwner(name);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE owners SET displayName = ?, publicKey = ?, roles = ?, createdAt = ?,
         disabledAt = ?, disabledBy = ?, managedBy = ? WHERE name = ?`
    ).run(
      updated.displayName ?? null,
      updated.publicKey,
      JSON.stringify(updated.roles),
      updated.createdAt,
      updated.disabledAt ?? null,
      updated.disabledBy ?? null,
      updated.managedBy ?? null,
      name,
    );
    return updated;
  },

  async deleteOwner(this: SqliteStorage, name: string): Promise<boolean> {
    const txn = this.db.transaction(() => {
      // 0. The work this person is a party to, settled before the per-identity passes below delete
      // what they find: open work is cancelled and the requester's held morsels go back, finished
      // work stays for the other side under the erasure's pseudonym (repos/work-erasure.ts). One
      // pseudonym for the whole erasure, so the other side's books still see one party. The agents
      // are named too, for an account whose agents no GHII pattern would find.
      const ghiiRows = this.db.prepare('SELECT ghii FROM ghiis WHERE ownerName = ?').all(name) as { ghii: string }[];
      const agentRows = this.db.prepare('SELECT gaii FROM agents WHERE owner = ?').all(name) as { gaii: string }[];
      const agentGaiis = agentRows.map(r => r.gaii);
      // The ecosystem apps the person connected act for them under `eco:<app>#<name>@<node>`, as agents do.
      const ecoGeais = (this.db.prepare('SELECT geai FROM ecosystem_apps WHERE owner = ?').all(name) as { geai: string }[]).map(r => r.geai);
      const actors = [...agentGaiis, ...ecoGeais];
      const pseudonym = erasedPartyPseudonym();
      settleErasedPartyWork(this.db, name, ghiiRows.map(r => r.ghii), pseudonym, id => this.resolveGhii(id), {}, actors);
      // The classification audit of OTHER people's content, where this person was the reader: the row
      // is the content owner's record and stays, under the erasure's pseudonym (secaudit 2026-10,
      // STO-1). One value per identity, so two of them cannot meet on the audit's unique address.
      [...ghiiRows.map(r => r.ghii), ...actors].forEach((id, i) => {
        this.db.prepare('UPDATE classification_audit SET reader = ? WHERE reader = ?').run(i ? `${pseudonym}.${i}` : pseudonym, id);
      });

      // 1-2. Cascade delete all agent-related data for each agent
      for (const gaii of agentGaiis) {
        this.cascadeDeleteAgentData(gaii);
      }

      // 3. Delete all agents for this owner
      this.db.prepare('DELETE FROM agents WHERE owner = ?').run(name);

      // 3a. An ecosystem app goes as an agent does: what it holds, then its record with the key pinned
      // at its first connection, and the automation recipes the person set for it. Every credential of
      // the app stops with its record (auth/middleware.ts ecosystemAppGone). repos/eco-app-erasure.ts,
      // which the start step and the operator's decision on a held name call too.
      deleteEcosystemApps(this.db, name, ecoGeais, geai => this.cascadeDeleteAgentData(geai), { everyRecipe: true });

      // 3b. Data owned by the GHII itself, not by an agent. cascadeDeleteAgentData above runs per
      // AGENT gaii, so everything written under the person's own identity — which is most of what a
      // person has, because owner sessions and app grants both resolve to the GHII — survived the
      // delete. Found by test/unit/storage-conformance.test.ts on the day it was written: Postgres
      // clears these and SQLite did not, the mirror image of the audit's H-30 in the other provider.
      for (const row of ghiiRows) {
        this.cascadeDeleteAgentData(row.ghii);
      }

      // 3c. An action the owner published in person. It is stored under the bare account name (the
      // owner session's raw `sub`), which neither pass above walks, and the name is released for
      // reuse, so the next holder of the name could change or delete it.
      this.db.prepare('DELETE FROM actions WHERE providerGaii = ?').run(name);
      // 3d. The person's own ledger lines from before 2026-08-16, which were filed under the bare
      // account name. They are theirs, so they go with the account, like the lines under the GHII.
      this.db.prepare('DELETE FROM wallet_transactions WHERE gaii = ?').run(name);
      // Connectivity keys minted before 2026-10-10, stored under the bare account name (the owner
      // session's raw `sub`). The per-identity pass above deletes the ones under the GHII. A key that
      // survived here was redeemed by POST /v1/agents/connect into an agent under whoever registered
      // the name next (secaudit 2026-10-10 C0).
      this.db.prepare('DELETE FROM otks WHERE ownerGaii = ?').run(name);

      // 3d. The cortexes this person installed, now that the actions under their own identities are
      // gone: each record, with what its activation made and what is keyed by its name
      // (repos/cortex-erasure.ts, the rule in ../../../erased-cortex.ts).
      deleteInstalledCortexes(this.db, name, ghiiRows.map(r => r.ghii));

      // What this person WROTE into somebody else's namespace is that other owner's record of who
      // touched their data, so it is pseudonymised rather than deleted — removing it would silently
      // turn their "four hands" into three. The node id comes from a GHII, so this runs while one is
      // still readable.
      const tallyNodeId = ghiiRows[0]?.ghii.split('@')[1] ?? '';
      if (tallyNodeId) pseudonymiseWriter(this.db, name, tallyNodeId);

      // The purchase receipts this person is a party to stay, because each one is also the other
      // side's book entry. The name leaves them: it is released for reuse, and every purchase read
      // keys on it. The pseudonym is the one the work above took.
      pseudonymisePurchaseParties(this.db, name, ghiiRows.map(r => r.ghii), pseudonym);
      // The AI provenance records stay too, for the content that outlives the account. The name
      // leaves the two columns every owner read keys on, under the same pseudonym.
      pseudonymiseProvenanceOwner(this.db, name, ghiiRows.map(r => r.ghii), pseudonym);
      // So do the other side's ledger lines: the person's own went with the passes above, and the
      // lines in other people's ledgers name them by the same pseudonym (repos/ledger-erasure.ts).
      pseudonymiseLedgerParty(this.db, erasedAccountParty(name, ghiiRows.map(r => r.ghii), pseudonym, actors));

      // 4. Delete GHII records for this owner
      this.db.prepare('DELETE FROM ghiis WHERE ownerName = ?').run(name);

      // 5. Delete personal nodes and their mailbox items & push subscriptions
      const nodeRows = this.db.prepare('SELECT nodeId FROM personal_nodes WHERE ownerName = ?').all(name) as { nodeId: string }[];
      for (const node of nodeRows) {
        this.db.prepare('DELETE FROM mailbox_items WHERE personalNodeId = ?').run(node.nodeId);
        this.db.prepare('DELETE FROM personal_push_subscriptions WHERE personalNodeId = ?').run(node.nodeId);
        this.db.prepare('DELETE FROM notification_preferences WHERE personalNodeId = ?').run(node.nodeId);
      }
      this.db.prepare('DELETE FROM personal_nodes WHERE ownerName = ?').run(name);

      // 6. Delete push subscriptions for this owner
      this.db.prepare('DELETE FROM push_subscriptions WHERE ownerName = ?').run(name);
      this.db.prepare('DELETE FROM personal_push_subscriptions WHERE ownerName = ?').run(name);

      // 7. Delete listings for this owner
      this.db.prepare('DELETE FROM listings WHERE ownerName = ?').run(name);

      // 8. Delete purchases for this owner (as buyer or seller)
      this.db.prepare('DELETE FROM purchases WHERE buyerOwner = ? OR sellerOwner = ?').run(name, name);

      // 9. Delete chat instances for this owner
      this.db.prepare('DELETE FROM chat_instances WHERE ownerName = ?').run(name);

      // 10. Delete email verifications for this owner
      this.db.prepare('DELETE FROM email_verifications WHERE ownerName = ?').run(name);

      // 10b. Ecosystem-app device handshakes. Keyed on the bare owner name, like the push
      // subscriptions above, because the handshake happens before the app has an identity of its
      // own. A pending row is a live invitation to bind an app to this account, and the name is
      // released for reuse, so leaving one hands the next registrant somebody else's handshake.
      this.db.prepare('DELETE FROM eco_auth WHERE ownerName = ?').run(name);

      // 10c. The apps the person granted access to, the personal access tokens they made and the
      // session rows. They are credentials issued in the account name, which is released for reuse, so
      // they go with the account and the next holder of the name starts with none, as on Postgres.
      // repos/credential-erasure.ts, which the start step and the operator's decision call too.
      deleteAccountCredentials(this.db, name, { sessions: true });

      // 11. Delete the owner record itself
      const result = this.db.prepare('DELETE FROM owners WHERE name = ?').run(name);
      return result.changes > 0;
    });
    return txn();
  },


  deserializeOwner(this: SqliteStorage, row: Record<string, unknown>): OwnerRecord {
    return {
      name: row.name as string,
      displayName: (row.displayName as string) ?? undefined,
      publicKey: row.publicKey as string,
      roles: JSON.parse(row.roles as string) as string[],
      createdAt: row.createdAt as string,
      disabledAt: (row.disabledAt as string) ?? null,
      disabledBy: (row.disabledBy as string) ?? null,
      managedBy: (row.managedBy as string) ?? null,
    };
  },

  async createAgent(this: SqliteStorage, agent: AgentRecord): Promise<AgentRecord> {
    try {
      this.db.prepare(
        `INSERT INTO agents (gaii, name, owner, displayName, description, capabilities, publicKey, trustScore, morselBalance, createdAt, lastSeen, semantic, allowedOrigins, defaultScopes, federate,
         webhookUrl, webhookSecret, webhookEnabled, webhookLastSuccess, webhookLastFailure, webhookFailCount, platform, platformVersion, platformDetectedBy, model, modelDetectedBy, tags, mode, maxConcurrentTasks, consoleUrl, registeredBy,
         runMode, runtimeSource, identityVersion, cardJws, cardIssuedAt, enrolledAt, mcpClient, mcpLastSeen, taskStart)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        agent.gaii, agent.name, agent.owner,
        agent.displayName ?? null, agent.description ?? null,
        JSON.stringify(agent.capabilities), agent.publicKey,
        agent.trustScore, agent.morselBalance,
        agent.createdAt, agent.lastSeen,
        agent.semantic ? JSON.stringify(agent.semantic) : null,
        agent.allowedOrigins ? JSON.stringify(agent.allowedOrigins) : null,
        agent.defaultScopes ? JSON.stringify(agent.defaultScopes) : null,
        agent.federate ? 1 : 0,
        agent.webhookUrl ?? null, agent.webhookSecret ?? null, agent.webhookEnabled ? 1 : 0,
        agent.webhookLastSuccess ?? null, agent.webhookLastFailure ?? null, agent.webhookFailCount ?? 0,
        agent.platform ?? null, agent.platformVersion ?? null, agent.platformDetectedBy ?? null,
        agent.model ?? null, agent.modelDetectedBy ?? null,
        agent.tags ? JSON.stringify(agent.tags) : null,
        agent.mode ?? 'interactive',
        agent.maxConcurrentTasks ?? 1,
        agent.consoleUrl ?? null,
        agent.registeredBy ?? null,
        agent.runMode ?? null,
        agent.runtimeSource ? JSON.stringify(agent.runtimeSource) : null,
        agent.identityVersion ?? null,
        agent.cardJws ?? null,
        agent.cardIssuedAt ?? null,
        agent.enrolledAt ?? null,
        agent.mcpClient ?? null,
        agent.mcpLastSeen ?? null,
        agent.taskStart ?? null,
      );
      return agent;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('NAME_TAKEN', { cause: err });
      throw err;
    }
  },

  async getAgent(this: SqliteStorage, gaii: string): Promise<AgentRecord | null> {
    const row = this.db.prepare('SELECT * FROM agents WHERE gaii = ?').get(gaii) as Record<string, unknown> | undefined;
    return row ? this.deserializeAgent(row) : null;
  },

  // Ordered on purpose — see the note on the Postgres implementation. The two providers must agree
  // about which agent is agents[0], because a caller treats it as "the" agent.
  async getAgentsByOwner(this: SqliteStorage, owner: string): Promise<AgentRecord[]> {
    const rows = this.db.prepare('SELECT * FROM agents WHERE owner = ? ORDER BY createdAt ASC, gaii ASC').all(owner) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAgent(r));
  },

  async getAgentsByOwners(this: SqliteStorage, owners: string[]): Promise<Record<string, AgentRecord[]>> {
    const out: Record<string, AgentRecord[]> = {};
    if (owners.length === 0) return out;
    for (const o of owners) out[o] = [];
    const p = owners.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM agents WHERE owner IN (${p}) ORDER BY createdAt ASC, gaii ASC`).all(...owners) as Record<string, unknown>[];
    for (const r of rows) { const a = this.deserializeAgent(r); (out[a.owner] ??= []).push(a); }
    return out;
  },

  async updateAgent(this: SqliteStorage, gaii: string, updates: Partial<AgentRecord>): Promise<AgentRecord | null> {
    const existing = await this.getAgent(gaii);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE agents SET name = ?, owner = ?, displayName = ?, description = ?, capabilities = ?,
       publicKey = ?, trustScore = ?, morselBalance = ?, createdAt = ?, lastSeen = ?, semantic = ?,
       allowedOrigins = ?, defaultScopes = ?, federate = ?,
       technicalCapabilities = ?, domainCapabilities = ?, activityStats = ?,
       modulesLoaded = ?, agentLimitations = ?, languages = ?,
       webhookUrl = ?, webhookSecret = ?, webhookEnabled = ?, webhookLastSuccess = ?, webhookLastFailure = ?, webhookFailCount = ?,
       platform = ?, platformVersion = ?, platformDetectedBy = ?, model = ?, modelDetectedBy = ?, tags = ?, mode = ?, maxConcurrentTasks = ?,
       dailySpendLimit = ?, scheduleConstraintDefaults = ?, consoleUrl = ?, registeredBy = ?,
       runMode = ?, runtimeSource = ?, identityVersion = ?, cardJws = ?, cardIssuedAt = ?, enrolledAt = ?,
       mcpClient = ?, mcpLastSeen = ?, taskStart = ?
       WHERE gaii = ?`
    ).run(
      updated.name, updated.owner,
      updated.displayName ?? null, updated.description ?? null,
      JSON.stringify(updated.capabilities), updated.publicKey,
      updated.trustScore, updated.morselBalance,
      updated.createdAt, updated.lastSeen,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      updated.allowedOrigins ? JSON.stringify(updated.allowedOrigins) : null,
      updated.defaultScopes ? JSON.stringify(updated.defaultScopes) : null,
      updated.federate ? 1 : 0,
      JSON.stringify(updated.technicalCapabilities ?? []),
      JSON.stringify(updated.domainCapabilities ?? []),
      JSON.stringify(updated.activityStats ?? {}),
      JSON.stringify(updated.modulesLoaded ?? []),
      JSON.stringify(updated.agentLimitations ?? []),
      JSON.stringify(updated.languages ?? []),
      updated.webhookUrl ?? null, updated.webhookSecret ?? null, updated.webhookEnabled ? 1 : 0,
      updated.webhookLastSuccess ?? null, updated.webhookLastFailure ?? null, updated.webhookFailCount ?? 0,
      updated.platform ?? null, updated.platformVersion ?? null, updated.platformDetectedBy ?? null,
      updated.model ?? null, updated.modelDetectedBy ?? null,
      updated.tags ? JSON.stringify(updated.tags) : null,
      updated.mode ?? 'interactive',
      updated.maxConcurrentTasks ?? 1,
      updated.dailySpendLimit ?? null,
      updated.scheduleConstraintDefaults ? JSON.stringify(updated.scheduleConstraintDefaults) : null,
      updated.consoleUrl ?? null,
      // Carried through rather than fixed here: the write-once rule lives where the value is SET
      // (only createAgent writes it), so both providers behave the same way. Postgres passes any
      // key through generically, and a column one backend silently refuses is a worse trap than a
      // rule stated in one place.
      updated.registeredBy ?? null,
      updated.runMode ?? null,
      updated.runtimeSource ? JSON.stringify(updated.runtimeSource) : null,
      updated.identityVersion ?? null,
      updated.cardJws ?? null,
      updated.cardIssuedAt ?? null,
      updated.enrolledAt ?? null,
      updated.mcpClient ?? null,
      updated.mcpLastSeen ?? null,
      updated.taskStart ?? null,
      gaii,
    );
    return updated;
  },

  async deleteAgent(this: SqliteStorage, gaii: string): Promise<boolean> {
    const txn = this.db.transaction(() => {
      // The agent's work first, by the rule an erasure follows (repos/work-erasure.ts): open work is
      // cancelled and what was held for it goes back, to the requester or to this agent's owner, and
      // what stays keeps the agent's identity, because its owner is still here.
      settleDeletedAgentWork(this.db, gaii, id => this.resolveGhii(id));
      // Cascade delete all agent-related data
      this.cascadeDeleteAgentData(gaii);
      // Delete the agent record itself
      const result = this.db.prepare('DELETE FROM agents WHERE gaii = ?').run(gaii);
      return result.changes > 0;
    });
    return txn();
  },

  async listAgents(this: SqliteStorage): Promise<AgentRecord[]> {
    const rows = this.db.prepare('SELECT * FROM agents').all() as Record<string, unknown>[];
    return rows.map(r => this.deserializeAgent(r));
  },

  /**
   * Resolve any identity (GAII, GHII, bare owner) to the owner's GHII identifier.
   * All balance operations go through GHII — agents don't have their own balance.
   * The body is repos/ghii-resolve.ts, which the boot migration calls before an instance exists.
   */
  resolveGhii(this: SqliteStorage, identity: string): string | null {
    return resolveGhiiIn(this.db, identity);
  },

  deserializeAgent(this: SqliteStorage, row: Record<string, unknown>): AgentRecord {
    const record: AgentRecord = {
      gaii: row.gaii as string,
      name: row.name as string,
      owner: row.owner as string,
      capabilities: JSON.parse(row.capabilities as string) as string[],
      publicKey: row.publicKey as string,
      trustScore: row.trustScore as number,
      morselBalance: row.morselBalance as number,
      createdAt: row.createdAt as string,
      lastSeen: row.lastSeen as string,
    };
    if (row.displayName) record.displayName = row.displayName as string;
    if (row.description) record.description = row.description as string;
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    if (row.allowedOrigins) record.allowedOrigins = JSON.parse(row.allowedOrigins as string);
    if (row.defaultScopes) record.defaultScopes = JSON.parse(row.defaultScopes as string);
    record.federate = row.federate === 1;
    if (row.technicalCapabilities) record.technicalCapabilities = JSON.parse(row.technicalCapabilities as string);
    if (row.domainCapabilities) record.domainCapabilities = JSON.parse(row.domainCapabilities as string);
    if (row.activityStats) record.activityStats = JSON.parse(row.activityStats as string);
    if (row.modulesLoaded) record.modulesLoaded = JSON.parse(row.modulesLoaded as string);
    if (row.agentLimitations) record.agentLimitations = JSON.parse(row.agentLimitations as string);
    if (row.languages) record.languages = JSON.parse(row.languages as string);
    if (row.webhookUrl) record.webhookUrl = row.webhookUrl as string;
    if (row.webhookSecret) record.webhookSecret = row.webhookSecret as string;
    record.webhookEnabled = row.webhookEnabled === 1;
    if (row.webhookLastSuccess) record.webhookLastSuccess = row.webhookLastSuccess as string;
    if (row.webhookLastFailure) record.webhookLastFailure = row.webhookLastFailure as string;
    record.webhookFailCount = (row.webhookFailCount as number) ?? 0;
    if (row.platform) record.platform = row.platform as string;
    if (row.platformVersion) record.platformVersion = row.platformVersion as string;
    if (row.platformDetectedBy) record.platformDetectedBy = row.platformDetectedBy as 'auto' | 'self_report' | 'message_reply';
    if (row.model) record.model = row.model as string;
    if (row.modelDetectedBy) record.modelDetectedBy = row.modelDetectedBy as 'self_report';
    if (row.tags) record.tags = JSON.parse(row.tags as string);
    if (row.mode) record.mode = row.mode as 'autonomous' | 'interactive' | 'task-runner' | 'coordinator' | 'workstation';
    if (row.maxConcurrentTasks != null) record.maxConcurrentTasks = row.maxConcurrentTasks as number;
    if (row.dailySpendLimit != null) record.dailySpendLimit = row.dailySpendLimit as number;
    if (row.scheduleConstraintDefaults) record.scheduleConstraintDefaults = JSON.parse(row.scheduleConstraintDefaults as string);
    if (row.consoleUrl) record.consoleUrl = row.consoleUrl as string;
    if (row.registeredBy) record.registeredBy = row.registeredBy as string;
    if (row.runMode) record.runMode = row.runMode as AgentRecord['runMode'];
    if (row.runtimeSource) {
      // A row written before this column, or by a build that stored something else, must not stop
      // an agent loading: the field is a report about someone else's disk, not a load-bearing one.
      try { record.runtimeSource = JSON.parse(row.runtimeSource as string); }
      catch (err) { logger.warn('agents: unreadable runtimeSource, ignoring', { gaii: record.gaii, error: String(err) }); }
    }
    if (row.identityVersion != null) record.identityVersion = row.identityVersion as 1 | 2;
    if (row.cardJws) record.cardJws = row.cardJws as string;
    if (row.cardIssuedAt) record.cardIssuedAt = row.cardIssuedAt as string;
    if (row.enrolledAt) record.enrolledAt = row.enrolledAt as string;
    if (row.mcpClient) record.mcpClient = row.mcpClient as string;
    if (row.mcpLastSeen) record.mcpLastSeen = row.mcpLastSeen as string;
    if (row.taskStart === 'automatic' || row.taskStart === 'confirm') record.taskStart = row.taskStart;
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── GHII (Global Human Identity Identifier) ──
  // ══════════════════════════════════════════════════════════

  async createGHII(this: SqliteStorage, record: GHIIRecord): Promise<GHIIRecord> {
    try {
      this.db.prepare(
        `INSERT INTO ghiis (ghii, username, nodeId, displayName, bio, avatar, locale, region, timezone, passwordHash,
         verificationLevel, ownerName, createdAt, updatedAt, totpSecret, totpEnabled, totpBackupCodes,
         totpLastUsedAt, totpLastUsedCode, totpFailedAttempts, totpLockedUntil, semantic, emailHash,
         emailVerifiedAt, verificationMethod, magicLinkEnabled, notificationEmail, lastLoginAt,
         loginCount, verifiedAttributes, verificationIssuer, verificationCredentialHash, ftnVerified,
         googleSub, externalIdentities, trustScore, morselBalance, allowedOrigins)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.ghii, record.username, record.nodeId, record.displayName,
        record.bio ?? null, record.avatar ?? null, record.locale ?? null,
        record.region ?? null, record.timezone ?? null,
        record.passwordHash ?? null, record.verificationLevel, record.ownerName,
        record.createdAt, record.updatedAt,
        record.totpSecret ?? null, record.totpEnabled ? 1 : 0,
        record.totpBackupCodes ? JSON.stringify(record.totpBackupCodes) : null,
        record.totpLastUsedAt ?? null, record.totpLastUsedCode ?? null,
        record.totpFailedAttempts ?? 0, record.totpLockedUntil ?? null,
        record.semantic ? JSON.stringify(record.semantic) : null,
        record.emailHash ?? null, record.emailVerifiedAt ?? null,
        record.verificationMethod ?? null, record.magicLinkEnabled ? 1 : 0,
        record.notificationEmail ?? null, record.lastLoginAt ?? null,
        record.loginCount ?? 0,
        record.verifiedAttributes ? JSON.stringify(record.verifiedAttributes) : null,
        record.verificationIssuer ?? null, record.verificationCredentialHash ?? null,
        record.ftnVerified ? 1 : 0,
        record.googleSub ?? null,
        record.externalIdentities ? JSON.stringify(record.externalIdentities) : null,
        record.trustScore ?? null, record.morselBalance ?? null,
        record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('GHII_TAKEN', { cause: err });
      throw err;
    }
  },

  async getGHII(this: SqliteStorage, ghii: string): Promise<GHIIRecord | null> {
    const row = this.db.prepare('SELECT * FROM ghiis WHERE ghii = ?').get(ghii) as Record<string, unknown> | undefined;
    return row ? this.deserializeGHII(row) : null;
  },

  async getGHIIByOwner(this: SqliteStorage, ownerName: string): Promise<GHIIRecord | null> {
    const row = this.db.prepare('SELECT * FROM ghiis WHERE ownerName = ?').get(ownerName) as Record<string, unknown> | undefined;
    return row ? this.deserializeGHII(row) : null;
  },

  async getGHIIByEmailHash(this: SqliteStorage, emailHash: string): Promise<GHIIRecord | null> {
    const row = this.db.prepare('SELECT * FROM ghiis WHERE emailHash = ?').get(emailHash) as Record<string, unknown> | undefined;
    return row ? this.deserializeGHII(row) : null;
  },

  async getGHIIsByEmailHash(this: SqliteStorage, emailHash: string): Promise<GHIIRecord[]> {
    const rows = this.db.prepare('SELECT * FROM ghiis WHERE emailHash = ?').all(emailHash) as Record<string, unknown>[];
    return rows.map(r => this.deserializeGHII(r));
  },

  async getGHIIByExternalId(this: SqliteStorage, provider: string, sub: string): Promise<GHIIRecord | null> {
    // Google keeps its indexed mirror column for a fast path; all providers also live in the
    // generic externalIdentities JSON map, matched with json_extract (JSON1, built into better-sqlite3).
    if (provider === 'google') {
      const byMirror = this.db.prepare('SELECT * FROM ghiis WHERE googleSub = ?').get(sub) as Record<string, unknown> | undefined;
      if (byMirror) return this.deserializeGHII(byMirror);
    }
    const row = this.db.prepare("SELECT * FROM ghiis WHERE json_extract(externalIdentities, '$.' || ?) = ?")
      .get(provider, sub) as Record<string, unknown> | undefined;
    return row ? this.deserializeGHII(row) : null;
  },

  async updateGHII(this: SqliteStorage, ghii: string, updates: GHIIPatch): Promise<GHIIRecord | null> {
    const existing = await this.getGHII(ghii);
    if (!existing) return null;
    // Match PostgreSQL's patch contract. Null clears an optional field and reads as absent;
    // undefined is not an instruction to clear a value already stored on the account.
    const patch = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, value === null ? undefined : value])) as Partial<GHIIRecord>;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare(
      `UPDATE ghiis SET username = ?, nodeId = ?, displayName = ?, bio = ?, avatar = ?, locale = ?, region = ?, timezone = ?,
       passwordHash = ?, verificationLevel = ?, ownerName = ?, createdAt = ?, updatedAt = ?,
       totpSecret = ?, totpEnabled = ?, totpBackupCodes = ?, totpLastUsedAt = ?,
       totpLastUsedCode = ?, totpFailedAttempts = ?, totpLockedUntil = ?,
       passwordFailedAttempts = ?, passwordLockedUntil = ?, semantic = ?,
       emailHash = ?, emailVerifiedAt = ?, verificationMethod = ?, magicLinkEnabled = ?,
       notificationEmail = ?, lastLoginAt = ?, loginCount = ?, verifiedAttributes = ?,
       verificationIssuer = ?, verificationCredentialHash = ?, ftnVerified = ?,
       googleSub = ?, externalIdentities = ?, trustScore = ?, morselBalance = ?, allowedOrigins = ?
       WHERE ghii = ?`
    ).run(
      updated.username, updated.nodeId, updated.displayName,
      updated.bio ?? null, updated.avatar ?? null, updated.locale ?? null,
      updated.region ?? null, updated.timezone ?? null,
      updated.passwordHash ?? null, updated.verificationLevel, updated.ownerName,
      updated.createdAt, updated.updatedAt,
      updated.totpSecret ?? null, updated.totpEnabled ? 1 : 0,
      updated.totpBackupCodes ? JSON.stringify(updated.totpBackupCodes) : null,
      updated.totpLastUsedAt ?? null, updated.totpLastUsedCode ?? null,
      updated.totpFailedAttempts ?? 0, updated.totpLockedUntil ?? null,
      updated.passwordFailedAttempts ?? 0, updated.passwordLockedUntil ?? null,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      updated.emailHash ?? null, updated.emailVerifiedAt ?? null,
      updated.verificationMethod ?? null, updated.magicLinkEnabled ? 1 : 0,
      updated.notificationEmail ?? null, updated.lastLoginAt ?? null,
      updated.loginCount ?? 0,
      updated.verifiedAttributes ? JSON.stringify(updated.verifiedAttributes) : null,
      updated.verificationIssuer ?? null, updated.verificationCredentialHash ?? null,
      updated.ftnVerified ? 1 : 0,
      updated.googleSub ?? null,
      updated.externalIdentities ? JSON.stringify(updated.externalIdentities) : null,
      updated.trustScore ?? null, updated.morselBalance ?? null,
      updated.allowedOrigins ? JSON.stringify(updated.allowedOrigins) : null,
      ghii,
    );
    return updated;
  },

  async listGHIIs(this: SqliteStorage, opts?: { q?: string; level?: number }): Promise<GHIIRecord[]> {
    const rows = this.db.prepare('SELECT * FROM ghiis').all() as Record<string, unknown>[];
    let results = rows.map(r => this.deserializeGHII(r));
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      results = results.filter(r =>
        r.username.toLowerCase().includes(q) ||
        r.displayName.toLowerCase().includes(q) ||
        (r.bio?.toLowerCase().includes(q) ?? false)
      );
    }
    if (opts?.level !== undefined) {
      results = results.filter(r => r.verificationLevel >= opts.level!);
    }
    return results;
  },

  async deleteGHII(this: SqliteStorage, ghii: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM ghiis WHERE ghii = ?').run(ghii);
    return result.changes > 0;
  },

  deserializeGHII(this: SqliteStorage, row: Record<string, unknown>): GHIIRecord {
    const record: GHIIRecord = {
      username: row.username as string,
      nodeId: row.nodeId as string,
      ghii: row.ghii as string,
      displayName: row.displayName as string,
      verificationLevel: row.verificationLevel as 0 | 1 | 2 | 3,
      ownerName: row.ownerName as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
      totpEnabled: (row.totpEnabled as number) === 1,
    };
    if (row.bio) record.bio = row.bio as string;
    if (row.avatar) record.avatar = row.avatar as string;
    if (row.locale) record.locale = row.locale as string;
    if (row.region) record.region = row.region as string;
    if (row.timezone) record.timezone = row.timezone as string;
    if (row.passwordHash) record.passwordHash = row.passwordHash as string;
    if (row.totpSecret) record.totpSecret = row.totpSecret as string;
    if (row.totpBackupCodes) record.totpBackupCodes = JSON.parse(row.totpBackupCodes as string);
    if (row.totpLastUsedAt) record.totpLastUsedAt = row.totpLastUsedAt as string;
    if (row.totpLastUsedCode) record.totpLastUsedCode = row.totpLastUsedCode as string;
    if (row.totpFailedAttempts) record.totpFailedAttempts = row.totpFailedAttempts as number;
    if (row.totpLockedUntil) record.totpLockedUntil = row.totpLockedUntil as string;
    // Password lockout state — the columns existed but no provider read or wrote them, so
    // config.passwordLockoutAttempts could never engage (every wrong password read back 0 attempts).
    if (row.passwordFailedAttempts) record.passwordFailedAttempts = row.passwordFailedAttempts as number;
    if (row.passwordLockedUntil) record.passwordLockedUntil = row.passwordLockedUntil as string;
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    if (row.emailHash) record.emailHash = row.emailHash as string;
    if (row.emailVerifiedAt) record.emailVerifiedAt = row.emailVerifiedAt as string;
    if (row.verificationMethod) record.verificationMethod = row.verificationMethod as GHIIRecord['verificationMethod'];
    if (row.magicLinkEnabled) record.magicLinkEnabled = (row.magicLinkEnabled as number) === 1;
    if (row.notificationEmail) record.notificationEmail = row.notificationEmail as string;
    if (row.lastLoginAt) record.lastLoginAt = row.lastLoginAt as string;
    if (row.loginCount) record.loginCount = row.loginCount as number;
    if (row.verifiedAttributes) record.verifiedAttributes = JSON.parse(row.verifiedAttributes as string);
    if (row.verificationIssuer) record.verificationIssuer = row.verificationIssuer as string;
    if (row.verificationCredentialHash) record.verificationCredentialHash = row.verificationCredentialHash as string;
    if (row.ftnVerified) record.ftnVerified = (row.ftnVerified as number) === 1;
    if (row.googleSub) record.googleSub = row.googleSub as string;
    if (row.externalIdentities) record.externalIdentities = JSON.parse(row.externalIdentities as string);
    if (row.trustScore !== null && row.trustScore !== undefined) record.trustScore = row.trustScore as number;
    if (row.morselBalance !== null && row.morselBalance !== undefined) record.morselBalance = row.morselBalance as number;
    if (row.allowedOrigins) record.allowedOrigins = JSON.parse(row.allowedOrigins as string);
    return record;
  },
  // ── Token Revocation ──
  // ══════════════════════════════════════════════════════════

  async revokeToken(this: SqliteStorage, tokenHash: string, expiresAt: number): Promise<void> {
    this.db.prepare(
      'INSERT OR REPLACE INTO revoked_tokens (token_hash, expires_at) VALUES (?, ?)'
    ).run(tokenHash, expiresAt);
  },

  /** One statement: INSERT OR IGNORE files the hash only when it is absent, and `changes` says whether it did. */
  async revokeTokenIfAbsent(this: SqliteStorage, tokenHash: string, expiresAt: number): Promise<boolean> {
    return this.db.prepare(
      'INSERT OR IGNORE INTO revoked_tokens (token_hash, expires_at) VALUES (?, ?)'
    ).run(tokenHash, expiresAt).changes === 1;
  },

  async isTokenRevoked(this: SqliteStorage, tokenHash: string): Promise<boolean> {
    const row = this.db.prepare('SELECT 1 FROM revoked_tokens WHERE token_hash = ?').get(tokenHash);
    return !!row;
  },

  async cleanExpiredRevocations(this: SqliteStorage): Promise<number> {
    const result = this.db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(Math.floor(Date.now() / 1000));
    return result.changes;
  },
};
