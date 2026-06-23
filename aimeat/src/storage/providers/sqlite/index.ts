/**
 * @file sqlite/index.ts
 * @description SQLite Storage implementation (better-sqlite3) of the full Storage
 *   interface. Synchronous prepared statements; schema created/migrated on
 *   construction via initializeSchema(). Backs `:memory:`, dev, and personal nodes.
 * @structure SqliteStorage class — one method group per domain (owners, agents,
 *   memory, apps, wallet, federation, …), each delegating to a dedicated table.
 * @usage new SqliteStorage(dbPath) — dbPath may be ':memory:' or a file path.
 * @version-history
 *   v1.0.0 — pre-2026-06 — Initial SQLite storage implementation
 *   v1.1.0 — 2026-06-05 — Add normalizeAppOwnerNames() to strip the legacy
 *     `@node` suffix from app ownerName values (bare-name normalization).
 *   v1.2.0 — 2026-06-09 — Add mergeForkedAppBuckets() to consolidate ownerGaii
 *     buckets forked across an owner's identity forms into one canonical bucket.
 *   v1.3.0 — 2026-06-12 — Add subdomain_sites CRUD (operator-managed
 *     subdomain → published-app/redirect mappings).
 *   v1.3.1 — 2026-06-19 — Security (CR-1): reject negative/non-finite amounts in
 *     debitBalance/creditBalance/creditBalanceCapped/transferBalance to prevent
 *     negative-amount morsel minting (0 still allowed — free/0-cost work escrow).
 *   v1.4.0 — 2026-06-20 — Add app_grants CRUD (owner-issued app authorizations →
 *     agent tokens; refresh-hash lookup, list-by-owner, rotate/revoke).
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  Storage, OwnerRecord, AgentRecord, MemoryRecord,
  EcosystemAppRecord, EcoAuthorizationRecord, EcoAutomationRecipe,
  ActionRecord, WorkRecord, WalletTransaction,
  BoardRecord, BoardPostRecord, OtkRecord,
  DisputeRecord, DisputeAuditEntry, MicroMemoryRecord,
  StorageFileRecord, PeeringRequestRecord, ChunkedUploadRecord,
  GHIIRecord, PersonalNodeRecord, MailboxItemRecord, MaintenanceState,
  SchemaRecord, ConsentRecord, ConsentAuditEntry, CsmRecord, MsmRecord,
  EmailVerificationRecord, FlagRecord, FlagSummary, MatchRecord,
  OrganismRecord, OrganismMembershipRecord, JoinRequestRecord, PendingApprovalRecord,
  AppealRecord, ListingRecord, PurchaseRecord,
  PushSubscriptionRecord, TrustedIssuerRecord, VerificationNonceRecord,
  GenesisPeerRecord, OrganismReputationRecord,
  ChatInstanceRecord, RealtimeRoomRecord, SiteChangeLogEntry,
  ExtensionRecord, EscrowHoldRecord, BoardSubscriptionRecord,
  CortexExtensionRecord,
  PersonalPushSubscriptionRecord, NotificationPreferences,
  AppRecord, AppListOptions, AppPurchaseRecord,
  SubdomainSiteRecord,
  AppGrantRecord,
  NotificationTemplateRecord,
  MemoryLinkRecord, OperatorReviewRecord,
  ScheduledJobRecord,
  ExtensionInstanceRecord,
  FederationPeerRecord,
  ReplicationQueueEntry,
  DeviceAuthorizationRecord,
  OAuthClientRecord,
  OAuthRefreshTokenRecord,
  OAuthApprovalRecord,
  SystemPromptRecord,
  SystemPromptVersionRecord,
  ExecutionLogEntry,
  PackageRecord, PackageComponent, PackageFilter, PackageComponentType,
  TemplateListingRecord, TemplateReview, TemplateDiscussion, TemplateFilter,
  PackageInstanceRecord, InstalledComponent, InstanceFilter,
  CapabilityRecord, CapabilityLogEntry, CapabilityStats,
  AgentTaskRecord, AgentTaskEventRecord,
  AgentDirectivesRecord, OwnerAgentDefaults,
  SharingGroupRecord,
  AgentActivityRecord,
  AgentMessageRecord,
  DirectMessageRecord,
  ContactConsentRecord,
  MessageDeliveryLog,
  MessageDeliveryStats,
  TelemetryEvent,
  WebhookDeliveryLog,
  AgentOnboardingRecord,
} from '../../interface.js';
import { initializeSchema } from './schema.js';

import { matchWildcardPattern, consentMatchPattern } from '../../pattern-utils.js';
import { matchesRecipient } from '../../../services/consent.js';
import { parseGaiiLoose } from '../../../utils/gaii.js';

import * as agentTaskRepo from './repos/agent-task.js';
import * as sharingGroupRepo from './repos/sharing-group.js';
import * as agentDirectivesRepo from './repos/agent-directives.js';
import * as agentActivityRepo from './repos/agent-activity.js';
import * as agentMessageRepo from './repos/agent-message.js';
import * as directMessageRepo from './repos/direct-message.js';
import * as ecosystemAppRepo from './repos/ecosystem-app.js';
import { searchTextMemory, countMemory as countMemoryRepo } from './repos/memory.js';
import type { MemoryTextHit, MemoryTextSearchOpts, MemoryVersionRecord } from '../../repositories/memory.repository.js';

export class SqliteStorage implements Storage {
  private db: Database.Database;
  private chunkedUploads = new Map<string, ChunkedUploadRecord>();

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    initializeSchema(this.db);
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }

  // ══════════════════════════════════════════════════════════
  // ── Owners ──
  // ══════════════════════════════════════════════════════════

  async createOwner(owner: OwnerRecord): Promise<OwnerRecord> {
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
  }

  async getOwner(name: string): Promise<OwnerRecord | null> {
    const row = this.db.prepare('SELECT * FROM owners WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeOwner(row) : null;
  }

  async listOwners(): Promise<OwnerRecord[]> {
    const rows = this.db.prepare('SELECT * FROM owners').all() as Record<string, unknown>[];
    return rows.map(r => this.deserializeOwner(r));
  }

  async updateOwner(name: string, updates: Partial<OwnerRecord>): Promise<OwnerRecord | null> {
    const existing = await this.getOwner(name);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE owners SET displayName = ?, publicKey = ?, roles = ?, createdAt = ? WHERE name = ?`
    ).run(
      updated.displayName ?? null,
      updated.publicKey,
      JSON.stringify(updated.roles),
      updated.createdAt,
      name,
    );
    return updated;
  }

  async deleteOwner(name: string): Promise<boolean> {
    const txn = this.db.transaction(() => {
      // 1. Get all agents belonging to this owner
      const agentRows = this.db.prepare('SELECT gaii FROM agents WHERE owner = ?').all(name) as { gaii: string }[];
      const agentGaiis = agentRows.map(r => r.gaii);

      // 2. Cascade delete all agent-related data for each agent
      for (const gaii of agentGaiis) {
        this.cascadeDeleteAgentData(gaii);
      }

      // 3. Delete all agents for this owner
      this.db.prepare('DELETE FROM agents WHERE owner = ?').run(name);

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

      // 11. Delete the owner record itself
      const result = this.db.prepare('DELETE FROM owners WHERE name = ?').run(name);
      return result.changes > 0;
    });
    return txn();
  }

  /**
   * Cascade-delete all data associated with a single agent GAII.
   * Called inside a transaction by both deleteOwner and deleteAgent.
   */
  private cascadeDeleteAgentData(gaii: string): void {
    // Memory
    this.db.prepare('DELETE FROM memory WHERE ownerGaii = ?').run(gaii);
    // Micro-memory
    this.db.prepare('DELETE FROM micro_memory WHERE gaii = ?').run(gaii);
    // Actions
    this.db.prepare('DELETE FROM actions WHERE providerGaii = ?').run(gaii);
    // Work (as provider or requester) — also clean up related disputes
    const workRows = this.db.prepare(
      'SELECT trackingCode FROM work WHERE providerGaii = ? OR requesterGaii = ?'
    ).all(gaii, gaii) as { trackingCode: string }[];
    for (const w of workRows) {
      this.db.prepare('DELETE FROM dispute_audit WHERE disputeId IN (SELECT id FROM disputes WHERE trackingCode = ?)').run(w.trackingCode);
      this.db.prepare('DELETE FROM disputes WHERE trackingCode = ?').run(w.trackingCode);
    }
    this.db.prepare('DELETE FROM work WHERE providerGaii = ? OR requesterGaii = ?').run(gaii, gaii);
    // Wallet transactions
    this.db.prepare('DELETE FROM wallet_transactions WHERE gaii = ?').run(gaii);
    // Board posts authored by this agent
    this.db.prepare('DELETE FROM board_posts WHERE authorGaii = ?').run(gaii);
    // Board subscriptions
    this.db.prepare('DELETE FROM board_subscriptions WHERE gaii = ?').run(gaii);
    // Boards owned by this agent — also delete their posts and subscriptions
    const boardRows = this.db.prepare('SELECT id FROM boards WHERE ownerGaii = ?').all(gaii) as { id: string }[];
    for (const b of boardRows) {
      this.db.prepare('DELETE FROM board_posts WHERE boardId = ?').run(b.id);
      this.db.prepare('DELETE FROM board_subscriptions WHERE boardId = ?').run(b.id);
    }
    this.db.prepare('DELETE FROM boards WHERE ownerGaii = ?').run(gaii);
    // Consents and consent audit
    this.db.prepare('DELETE FROM consent_audit WHERE ownerGaii = ?').run(gaii);
    this.db.prepare('DELETE FROM consents WHERE ownerGaii = ?').run(gaii);
    // Storage files
    this.db.prepare('DELETE FROM storage_files WHERE ownerGaii = ?').run(gaii);
    // Matches (as profileA or profileB)
    this.db.prepare('DELETE FROM matches WHERE profileA = ? OR profileB = ?').run(gaii, gaii);
    // Flags raised by this agent
    this.db.prepare('DELETE FROM flags WHERE flaggedBy = ?').run(gaii);
    // Escrow holds
    this.db.prepare('DELETE FROM escrow_holds WHERE fromGaii = ?').run(gaii);
    // OTKs (one-time keys)
    this.db.prepare('DELETE FROM otks WHERE ownerGaii = ?').run(gaii);
    // OAuth refresh tokens and approvals for this agent
    this.db.prepare('DELETE FROM oauth_refresh_tokens WHERE gaii = ?').run(gaii);
    this.db.prepare('DELETE FROM oauth_approvals WHERE gaii = ?').run(gaii);
    // Agent tasks and events
    const taskRows = this.db.prepare('SELECT id FROM agent_tasks WHERE agentGaii = ?').all(gaii) as { id: string }[];
    for (const t of taskRows) {
      this.db.prepare('DELETE FROM agent_task_events WHERE taskId = ?').run(t.id);
    }
    this.db.prepare('DELETE FROM agent_tasks WHERE agentGaii = ?').run(gaii);
    // Agent directives
    this.db.prepare('DELETE FROM agent_directives WHERE agentGaii = ?').run(gaii);
    // Agent activity
    this.db.prepare('DELETE FROM agent_activity WHERE agentGaii = ?').run(gaii);
    // Agent messages
    this.db.prepare('DELETE FROM agent_messages WHERE agentGaii = ?').run(gaii);
    // Telemetry events
    this.db.prepare('DELETE FROM telemetry_events WHERE agentGaii = ?').run(gaii);
    // Webhook delivery logs
    this.db.prepare('DELETE FROM webhook_delivery_log WHERE agentGaii = ?').run(gaii);
    // Onboarding record
    this.db.prepare('DELETE FROM agent_onboarding WHERE agentGaii = ?').run(gaii);
    // Sharing groups
    this.db.prepare('DELETE FROM sharing_groups WHERE ownerGaii = ?').run(gaii);
  }

  private deserializeOwner(row: Record<string, unknown>): OwnerRecord {
    return {
      name: row.name as string,
      displayName: (row.displayName as string) ?? undefined,
      publicKey: row.publicKey as string,
      roles: JSON.parse(row.roles as string) as string[],
      createdAt: row.createdAt as string,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Agents ──
  // ══════════════════════════════════════════════════════════

  async createAgent(agent: AgentRecord): Promise<AgentRecord> {
    try {
      this.db.prepare(
        `INSERT INTO agents (gaii, name, owner, displayName, description, capabilities, publicKey, trustScore, morselBalance, createdAt, lastSeen, semantic, allowedOrigins, defaultScopes, federate,
         webhookUrl, webhookSecret, webhookEnabled, webhookLastSuccess, webhookLastFailure, webhookFailCount, platform, platformVersion, platformDetectedBy, tags, mode, maxConcurrentTasks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        agent.tags ? JSON.stringify(agent.tags) : null,
        agent.mode ?? 'interactive',
        agent.maxConcurrentTasks ?? 1,
      );
      return agent;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('NAME_TAKEN', { cause: err });
      throw err;
    }
  }

  async getAgent(gaii: string): Promise<AgentRecord | null> {
    const row = this.db.prepare('SELECT * FROM agents WHERE gaii = ?').get(gaii) as Record<string, unknown> | undefined;
    return row ? this.deserializeAgent(row) : null;
  }

  async getAgentByName(name: string, _nodeId: string): Promise<AgentRecord | null> {
    const row = this.db.prepare('SELECT * FROM agents WHERE name = ? LIMIT 1').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeAgent(row) : null;
  }

  async getAgentsByOwner(owner: string): Promise<AgentRecord[]> {
    const rows = this.db.prepare('SELECT * FROM agents WHERE owner = ?').all(owner) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAgent(r));
  }

  async updateAgent(gaii: string, updates: Partial<AgentRecord>): Promise<AgentRecord | null> {
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
       platform = ?, platformVersion = ?, platformDetectedBy = ?, tags = ?, mode = ?, maxConcurrentTasks = ?,
       dailySpendLimit = ?, scheduleConstraintDefaults = ?
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
      updated.tags ? JSON.stringify(updated.tags) : null,
      updated.mode ?? 'interactive',
      updated.maxConcurrentTasks ?? 1,
      updated.dailySpendLimit ?? null,
      updated.scheduleConstraintDefaults ? JSON.stringify(updated.scheduleConstraintDefaults) : null,
      gaii,
    );
    return updated;
  }

  async deleteAgent(gaii: string): Promise<boolean> {
    const txn = this.db.transaction(() => {
      // Cascade delete all agent-related data
      this.cascadeDeleteAgentData(gaii);
      // Delete the agent record itself
      const result = this.db.prepare('DELETE FROM agents WHERE gaii = ?').run(gaii);
      return result.changes > 0;
    });
    return txn();
  }

  async listAgents(): Promise<AgentRecord[]> {
    const rows = this.db.prepare('SELECT * FROM agents').all() as Record<string, unknown>[];
    return rows.map(r => this.deserializeAgent(r));
  }

  /**
   * Resolve any identity (GAII, GHII, bare owner) to the owner's GHII identifier.
   * All balance operations go through GHII — agents don't have their own balance.
   */
  private resolveGhii(identity: string): string | null {
    // GHII format: owner@node (no #)
    if (!identity.includes('#') && identity.includes('@')) return identity;
    // GAII format: agent#owner@node → extract owner → lookup GHII
    if (identity.includes('#')) {
      const hashIdx = identity.indexOf('#');
      const atIdx = identity.lastIndexOf('@');
      if (atIdx > hashIdx) {
        const owner = identity.slice(hashIdx + 1, atIdx);
        const row = this.db.prepare('SELECT ghii FROM ghiis WHERE username = ?').get(owner) as { ghii: string } | undefined;
        return row?.ghii ?? null;
      }
    }
    // Bare owner name → lookup GHII
    const row = this.db.prepare('SELECT ghii FROM ghiis WHERE username = ?').get(identity) as { ghii: string } | undefined;
    return row?.ghii ?? null;
  }

  async debitBalance(gaii: string, amount: number): Promise<boolean> {
    // SECURITY: reject negative/non-finite amounts. A negative amount would INVERT the
    // subtraction (balance - (-n) = balance + n) and mint morsels. 0 is allowed (no-op;
    // free/0-cost work escrow relies on it).
    if (!Number.isFinite(amount) || amount < 0) return false;
    const ghii = this.resolveGhii(gaii);
    if (!ghii) return false;
    const result = this.db.prepare(
      `UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) - ? WHERE ghii = ? AND COALESCE(morselBalance, 0) >= ?`
    ).run(amount, ghii, amount);
    return result.changes > 0;
  }

  async creditBalance(gaii: string, amount: number): Promise<boolean> {
    // SECURITY: reject negative/non-finite amounts (a negative credit would silently debit); 0 is a no-op.
    if (!Number.isFinite(amount) || amount < 0) return false;
    const ghii = this.resolveGhii(gaii);
    if (!ghii) return false;
    const result = this.db.prepare(
      `UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) + ? WHERE ghii = ?`
    ).run(amount, ghii);
    return result.changes > 0;
  }

  async creditBalanceCapped(gaii: string, amount: number, cap: number): Promise<number> {
    // SECURITY: reject negative/non-finite amounts (NaN would slip past the actualCredit<=0 guard below).
    if (!Number.isFinite(amount) || amount < 0) return 0;
    const ghii = this.resolveGhii(gaii);
    if (!ghii) return 0;
    const txn = this.db.transaction(() => {
      const row = this.db.prepare('SELECT morselBalance FROM ghiis WHERE ghii = ?').get(ghii) as { morselBalance: number | null } | undefined;
      if (!row) return 0;
      const oldBalance = row.morselBalance ?? 0;
      if (oldBalance >= cap) return 0;
      const actualCredit = Math.min(amount, cap - oldBalance);
      if (actualCredit <= 0) return 0;
      this.db.prepare('UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) + ? WHERE ghii = ?').run(actualCredit, ghii);
      return actualCredit;
    });
    return txn();
  }

  async transferBalance(fromGaii: string, toGaii: string, amount: number): Promise<boolean> {
    // SECURITY: reject negative/non-finite amounts (a negative transfer would drain the recipient); 0 is a no-op.
    if (!Number.isFinite(amount) || amount < 0) return false;
    const fromGhii = this.resolveGhii(fromGaii);
    const toGhii = this.resolveGhii(toGaii);
    if (!fromGhii || !toGhii) return false;
    if (fromGhii === toGhii) return true; // Same owner — no-op
    const txn = this.db.transaction(() => {
      const debit = this.db.prepare(
        `UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) - ? WHERE ghii = ? AND COALESCE(morselBalance, 0) >= ?`
      ).run(amount, fromGhii, amount);
      if (debit.changes === 0) return false;
      this.db.prepare(
        `UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) + ? WHERE ghii = ?`
      ).run(amount, toGhii);
      return true;
    });
    return txn();
  }

  private deserializeAgent(row: Record<string, unknown>): AgentRecord {
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
    record.federate = (row as any).federate === 1;
    if (row.technicalCapabilities) record.technicalCapabilities = JSON.parse(row.technicalCapabilities as string);
    if (row.domainCapabilities) record.domainCapabilities = JSON.parse(row.domainCapabilities as string);
    if (row.activityStats) record.activityStats = JSON.parse(row.activityStats as string);
    if (row.modulesLoaded) record.modulesLoaded = JSON.parse(row.modulesLoaded as string);
    if (row.agentLimitations) record.agentLimitations = JSON.parse(row.agentLimitations as string);
    if (row.languages) record.languages = JSON.parse(row.languages as string);
    if (row.webhookUrl) record.webhookUrl = row.webhookUrl as string;
    if (row.webhookSecret) record.webhookSecret = row.webhookSecret as string;
    record.webhookEnabled = (row as any).webhookEnabled === 1;
    if (row.webhookLastSuccess) record.webhookLastSuccess = row.webhookLastSuccess as string;
    if (row.webhookLastFailure) record.webhookLastFailure = row.webhookLastFailure as string;
    record.webhookFailCount = (row.webhookFailCount as number) ?? 0;
    if (row.platform) record.platform = row.platform as string;
    if (row.platformVersion) record.platformVersion = row.platformVersion as string;
    if (row.platformDetectedBy) record.platformDetectedBy = row.platformDetectedBy as 'auto' | 'self_report' | 'message_reply';
    if (row.tags) record.tags = JSON.parse(row.tags as string);
    if (row.mode) record.mode = row.mode as 'autonomous' | 'interactive' | 'task-runner' | 'coordinator' | 'workstation';
    if (row.maxConcurrentTasks != null) record.maxConcurrentTasks = row.maxConcurrentTasks as number;
    if (row.dailySpendLimit != null) record.dailySpendLimit = row.dailySpendLimit as number;
    if (row.scheduleConstraintDefaults) record.scheduleConstraintDefaults = JSON.parse(row.scheduleConstraintDefaults as string);
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Memory ──
  // ══════════════════════════════════════════════════════════

  async setMemory(record: MemoryRecord): Promise<MemoryRecord> {
    const existing = await this.getMemory(record.ownerGaii, record.key);
    // Trackable is a property of the key: inherit the existing setting if the writer didn't specify, so
    // a generic rewrite never silently turns tracking off. Archiving keeps the PREVIOUS version.
    const trackable = record.trackable ?? existing?.trackable ?? false;
    record.trackable = trackable || undefined;
    if (existing) {
      if (existing.trackable) {
        // Archive the about-to-be-overwritten version into the separate history table (append-only).
        this.db.prepare(
          `INSERT OR IGNORE INTO memory_history (ownerGaii, key, version, value, actor, event, recordedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          existing.ownerGaii, existing.key, existing.version,
          JSON.stringify(existing.value),
          this.memoryAnnotation(existing.value, '_actor'), this.memoryAnnotation(existing.value, '_event'),
          existing.updatedAt,
        );
      }
      record.version = existing.version + 1;
      this.db.prepare(
        `UPDATE memory SET value = ?, visibility = ?, tags = ?, ttlHours = ?, version = ?,
         createdAt = ?, updatedAt = ?, flagCount = ?, allowedOrigins = ?, trackable = ? WHERE ownerGaii = ? AND key = ?`
      ).run(
        JSON.stringify(record.value), record.visibility,
        JSON.stringify(record.tags), record.ttlHours,
        record.version, record.createdAt, record.updatedAt,
        record.flagCount ?? 0,
        record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
        trackable ? 1 : 0,
        record.ownerGaii, record.key,
      );
    } else {
      this.db.prepare(
        `INSERT INTO memory (ownerGaii, key, value, visibility, tags, ttlHours, version, createdAt, updatedAt, flagCount, allowedOrigins, trackable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.ownerGaii, record.key,
        JSON.stringify(record.value), record.visibility,
        JSON.stringify(record.tags), record.ttlHours,
        record.version, record.createdAt, record.updatedAt,
        record.flagCount ?? 0,
        record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
        trackable ? 1 : 0,
      );
    }
    return record;
  }

  async listMemoryHistory(ownerGaii: string, key: string, opts?: { limit?: number }): Promise<MemoryVersionRecord[]> {
    const limit = opts?.limit ?? 200;
    const rows = this.db.prepare(
      'SELECT * FROM memory_history WHERE ownerGaii = ? AND key = ? ORDER BY version DESC LIMIT ?'
    ).all(ownerGaii, key, limit) as Record<string, unknown>[];
    return rows.map(r => ({
      ownerGaii: r.ownerGaii as string,
      key: r.key as string,
      version: r.version as number,
      value: JSON.parse(r.value as string),
      actor: (r.actor as string | null) ?? null,
      event: (r.event as string | null) ?? null,
      recordedAt: r.recordedAt as string,
    }));
  }

  async setMemoryIfVersion(record: MemoryRecord, expectedVersion: number): Promise<MemoryRecord | null> {
    const result = this.db.prepare(
      `UPDATE memory SET value = ?, visibility = ?, tags = ?, ttlHours = ?, version = ?,
       updatedAt = ?, flagCount = ?, allowedOrigins = ? WHERE ownerGaii = ? AND key = ? AND version = ?`
    ).run(
      JSON.stringify(record.value), record.visibility,
      JSON.stringify(record.tags), record.ttlHours,
      record.version, record.updatedAt,
      record.flagCount ?? 0,
      record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
      record.ownerGaii, record.key, expectedVersion,
    );
    if (result.changes === 0) return null; // version conflict
    return record;
  }

  private isMemoryExpired(record: MemoryRecord): boolean {
    if (!record.ttlHours) return false;
    const createdMs = new Date(record.createdAt).getTime();
    return Date.now() > createdMs + record.ttlHours * 3_600_000;
  }

  async getMemory(ownerGaii: string, key: string): Promise<MemoryRecord | null> {
    const row = this.db.prepare('SELECT * FROM memory WHERE ownerGaii = ? AND key = ?').get(ownerGaii, key) as Record<string, unknown> | undefined;
    if (!row) return null;
    const record = this.deserializeMemory(row);
    if (this.isMemoryExpired(record)) {
      this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(ownerGaii, key);
      return null;
    }
    return record;
  }

  async listMemory(ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number }): Promise<MemoryRecord[]> {
    let sql = 'SELECT * FROM memory WHERE ownerGaii = ?';
    const params: unknown[] = [ownerGaii];

    if (opts?.prefix) {
      sql += ' AND key LIKE ?';
      params.push(opts.prefix + '%');
    }
    if (opts?.visibility) {
      sql += ' AND visibility = ?';
      params.push(opts.visibility);
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const results: MemoryRecord[] = [];
    for (const row of rows) {
      const record = this.deserializeMemory(row);
      if (this.isMemoryExpired(record)) {
        this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(record.ownerGaii, record.key);
        continue;
      }
      if (opts?.tags?.length) {
        const hasTags = opts.tags.every(t => record.tags.includes(t));
        if (!hasTags) continue;
      }
      if (opts?.maxFlags !== undefined && (record.flagCount ?? 0) > opts.maxFlags) continue;
      results.push(record);
    }
    return results;
  }

  async countMemory(ownerGaiis: string[], opts?: { prefix?: string; visibility?: string }): Promise<number> {
    return countMemoryRepo(this.db, ownerGaiis, opts);
  }

  async listAllMemory(opts?: { prefix?: string; ownerPrefix?: string; visibility?: string; limit?: number; offset?: number }): Promise<{ items: MemoryRecord[]; total: number }> {
    let whereClauses = '';
    const params: unknown[] = [];

    if (opts?.ownerPrefix) {
      whereClauses += ' AND ownerGaii LIKE ?';
      params.push(opts.ownerPrefix + '%');
    }
    if (opts?.prefix) {
      whereClauses += ' AND key LIKE ?';
      params.push(opts.prefix + '%');
    }
    if (opts?.visibility) {
      whereClauses += ' AND visibility = ?';
      params.push(opts.visibility);
    }

    const whereStr = whereClauses ? ' WHERE ' + whereClauses.slice(5) : '';

    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM memory' + whereStr).get(...params) as { cnt: number };
    const total = countRow.cnt;

    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    const rows = this.db.prepare('SELECT * FROM memory' + whereStr + ' ORDER BY updatedAt DESC LIMIT ? OFFSET ?').all(...params, limit, offset) as Record<string, unknown>[];

    const items: MemoryRecord[] = [];
    for (const row of rows) {
      const record = this.deserializeMemory(row);
      if (this.isMemoryExpired(record)) {
        this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(record.ownerGaii, record.key);
        continue;
      }
      items.push(record);
    }
    return { items, total };
  }

  async deleteMemory(ownerGaii: string, key: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(ownerGaii, key);
    return result.changes > 0;
  }

  async deleteAllMemory(ownerGaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM memory WHERE ownerGaii = ?').run(ownerGaii);
    return result.changes;
  }

  async incrementMemoryFlagCount(ownerGaii: string, key: string): Promise<void> {
    this.db.prepare(
      'UPDATE memory SET flagCount = COALESCE(flagCount, 0) + 1 WHERE ownerGaii = ? AND key = ?'
    ).run(ownerGaii, key);
  }

  async searchMemory(ownerGaii: string, query: string, opts?: { visibility?: string; maxFlags?: number; prefix?: string }): Promise<MemoryRecord[]> {
    const q = query.toLowerCase();
    let sql = 'SELECT * FROM memory WHERE ownerGaii = ?';
    const params: unknown[] = [ownerGaii];

    if (opts?.visibility) {
      sql += ' AND visibility = ?';
      params.push(opts.visibility);
    }

    if (opts?.prefix) {
      sql += ' AND key LIKE ?';
      params.push(opts.prefix + '%');
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const results: MemoryRecord[] = [];
    for (const row of rows) {
      const record = this.deserializeMemory(row);
      if (this.isMemoryExpired(record)) {
        this.db.prepare('DELETE FROM memory WHERE ownerGaii = ? AND key = ?').run(record.ownerGaii, record.key);
        continue;
      }
      if (opts?.maxFlags !== undefined && (record.flagCount ?? 0) > opts.maxFlags) continue;
      const valStr = typeof record.value === 'string' ? record.value : JSON.stringify(record.value);
      if (
        record.key.toLowerCase().includes(q) ||
        valStr.toLowerCase().includes(q) ||
        record.tags.some(t => t.toLowerCase().includes(q))
      ) {
        results.push(record);
      }
    }
    return results;
  }

  async searchText(query: string, opts?: MemoryTextSearchOpts): Promise<MemoryTextHit[]> {
    return searchTextMemory(this.db, query, opts);
  }

  private deserializeMemory(row: Record<string, unknown>): MemoryRecord {
    const record: MemoryRecord = {
      key: row.key as string,
      ownerGaii: row.ownerGaii as string,
      value: JSON.parse(row.value as string),
      visibility: row.visibility as MemoryRecord['visibility'],
      tags: JSON.parse(row.tags as string) as string[],
      ttlHours: row.ttlHours as number | null,
      version: row.version as number,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.flagCount !== null && row.flagCount !== undefined) {
      record.flagCount = row.flagCount as number;
    }
    if (row.allowedOrigins) record.allowedOrigins = JSON.parse(row.allowedOrigins as string);
    if (row.groupId) record.groupId = row.groupId as string;
    if (row.trackable) record.trackable = true;
    return record;
  }

  /** Read an optional `_actor` / `_event` annotation off a record value (the convention the structure
   *  timeline uses) so archived history rows carry who/why. Best-effort. */
  private memoryAnnotation(value: unknown, field: '_actor' | '_event'): string | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const v = (value as Record<string, unknown>)[field];
      if (typeof v === 'string' && v) return v;
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════
  // ── Actions ──
  // ══════════════════════════════════════════════════════════

  async createAction(action: ActionRecord): Promise<ActionRecord> {
    try {
      this.db.prepare(
        `INSERT INTO actions (providerGaii, id, displayName, description, category, inputSchema, outputSchema, pricing, estimatedTimeSeconds, maxInputSizeBytes, tags, webhookUrl, createdAt, updatedAt, semantic, federate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        action.providerGaii, action.id, action.displayName, action.description,
        action.category ?? null,
        JSON.stringify(action.inputSchema), JSON.stringify(action.outputSchema),
        JSON.stringify(action.pricing),
        action.estimatedTimeSeconds ?? null, action.maxInputSizeBytes ?? null,
        JSON.stringify(action.tags), action.webhookUrl ?? null,
        action.createdAt, action.updatedAt,
        action.semantic ? JSON.stringify(action.semantic) : null,
        action.federate ? 1 : 0,
      );
      return action;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('ACTION_EXISTS', { cause: err });
      throw err;
    }
  }

  async getAction(id: string, providerGaii: string): Promise<ActionRecord | null> {
    const row = this.db.prepare('SELECT * FROM actions WHERE providerGaii = ? AND id = ?').get(providerGaii, id) as Record<string, unknown> | undefined;
    return row ? this.deserializeAction(row) : null;
  }

  async listActions(opts?: { search?: string; category?: string }): Promise<ActionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM actions').all() as Record<string, unknown>[];
    let results = rows.map(r => this.deserializeAction(r));
    if (opts?.category) {
      results = results.filter(a => a.category === opts.category);
    }
    if (opts?.search) {
      const q = opts.search.toLowerCase();
      results = results.filter(a =>
        a.displayName.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    return results;
  }

  async deleteAction(id: string, providerGaii: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM actions WHERE providerGaii = ? AND id = ?').run(providerGaii, id);
    return result.changes > 0;
  }

  async deleteActionsByProvider(gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM actions WHERE providerGaii = ?').run(gaii);
    return result.changes;
  }

  async listActionsByProvider(gaii: string): Promise<ActionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM actions WHERE providerGaii = ?').all(gaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAction(r));
  }

  async updateAction(id: string, providerGaii: string, updates: Partial<ActionRecord>): Promise<ActionRecord | null> {
    const existing = await this.getAction(id, providerGaii);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE actions SET displayName = ?, description = ?, category = ?, inputSchema = ?,
       outputSchema = ?, pricing = ?, estimatedTimeSeconds = ?, maxInputSizeBytes = ?,
       tags = ?, webhookUrl = ?, createdAt = ?, updatedAt = ?, semantic = ?, federate = ?
       WHERE providerGaii = ? AND id = ?`
    ).run(
      updated.displayName, updated.description, updated.category ?? null,
      JSON.stringify(updated.inputSchema), JSON.stringify(updated.outputSchema),
      JSON.stringify(updated.pricing),
      updated.estimatedTimeSeconds ?? null, updated.maxInputSizeBytes ?? null,
      JSON.stringify(updated.tags), updated.webhookUrl ?? null,
      updated.createdAt, updated.updatedAt,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      updated.federate ? 1 : 0,
      providerGaii, id,
    );
    return updated;
  }

  private deserializeAction(row: Record<string, unknown>): ActionRecord {
    const record: ActionRecord = {
      id: row.id as string,
      providerGaii: row.providerGaii as string,
      displayName: row.displayName as string,
      description: row.description as string,
      inputSchema: JSON.parse(row.inputSchema as string),
      outputSchema: JSON.parse(row.outputSchema as string),
      pricing: JSON.parse(row.pricing as string),
      tags: JSON.parse(row.tags as string) as string[],
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.category) record.category = row.category as string;
    if (row.estimatedTimeSeconds !== null) record.estimatedTimeSeconds = row.estimatedTimeSeconds as number;
    if (row.maxInputSizeBytes !== null) record.maxInputSizeBytes = row.maxInputSizeBytes as number;
    if (row.webhookUrl) record.webhookUrl = row.webhookUrl as string;
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    record.federate = (row as any).federate === 1;
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Work ──
  // ══════════════════════════════════════════════════════════

  async createWork(work: WorkRecord): Promise<WorkRecord> {
    this.db.prepare(
      `INSERT INTO work (trackingCode, status, actionId, providerGaii, requesterGaii, input, output, cost, ttlExpiresAt, callbackUrl, rating, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      work.trackingCode, work.status, work.actionId,
      work.providerGaii, work.requesterGaii,
      JSON.stringify(work.input), work.output ? JSON.stringify(work.output) : null,
      JSON.stringify(work.cost), work.ttlExpiresAt,
      work.callbackUrl ?? null,
      work.rating ? JSON.stringify(work.rating) : null,
      work.createdAt, work.updatedAt,
    );
    return work;
  }

  async getWork(trackingCode: string): Promise<WorkRecord | null> {
    const row = this.db.prepare('SELECT * FROM work WHERE trackingCode = ?').get(trackingCode) as Record<string, unknown> | undefined;
    return row ? this.deserializeWork(row) : null;
  }

  async updateWork(trackingCode: string, updates: Partial<WorkRecord>): Promise<WorkRecord | null> {
    const existing = await this.getWork(trackingCode);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE work SET status = ?, actionId = ?, providerGaii = ?, requesterGaii = ?,
       input = ?, output = ?, cost = ?, ttlExpiresAt = ?, callbackUrl = ?, rating = ?,
       createdAt = ?, updatedAt = ? WHERE trackingCode = ?`
    ).run(
      updated.status, updated.actionId, updated.providerGaii, updated.requesterGaii,
      JSON.stringify(updated.input), updated.output ? JSON.stringify(updated.output) : null,
      JSON.stringify(updated.cost), updated.ttlExpiresAt,
      updated.callbackUrl ?? null,
      updated.rating ? JSON.stringify(updated.rating) : null,
      updated.createdAt, updated.updatedAt,
      trackingCode,
    );
    return updated;
  }

  async listWorkByProvider(gaii: string): Promise<WorkRecord[]> {
    const rows = this.db.prepare('SELECT * FROM work WHERE providerGaii = ?').all(gaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeWork(r));
  }

  async listWorkByRequester(gaii: string): Promise<WorkRecord[]> {
    const rows = this.db.prepare('SELECT * FROM work WHERE requesterGaii = ?').all(gaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeWork(r));
  }

  async listAllWork(limit = 10000): Promise<WorkRecord[]> {
    const rows = this.db.prepare('SELECT * FROM work ORDER BY createdAt DESC LIMIT ?').all(Math.min(limit, 10000)) as Record<string, unknown>[];
    return rows.map(r => this.deserializeWork(r));
  }

  private deserializeWork(row: Record<string, unknown>): WorkRecord {
    const record: WorkRecord = {
      trackingCode: row.trackingCode as string,
      status: row.status as string,
      actionId: row.actionId as string,
      providerGaii: row.providerGaii as string,
      requesterGaii: row.requesterGaii as string,
      input: JSON.parse(row.input as string),
      cost: JSON.parse(row.cost as string),
      ttlExpiresAt: row.ttlExpiresAt as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.output) record.output = JSON.parse(row.output as string);
    if (row.callbackUrl) record.callbackUrl = row.callbackUrl as string;
    if (row.rating) record.rating = JSON.parse(row.rating as string);
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Wallet Transactions ──
  // ══════════════════════════════════════════════════════════

  async addTransaction(tx: WalletTransaction): Promise<WalletTransaction> {
    this.db.prepare(
      `INSERT INTO wallet_transactions (id, gaii, type, amount, counterpartyGaii, trackingCode, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      tx.id, tx.gaii, tx.type, tx.amount,
      tx.counterpartyGaii ?? null, tx.trackingCode ?? null, tx.timestamp,
    );
    return tx;
  }

  async getTransactions(gaii: string, limit = 50): Promise<WalletTransaction[]> {
    const rows = this.db.prepare(
      'SELECT * FROM wallet_transactions WHERE gaii = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(gaii, limit) as Record<string, unknown>[];
    return rows.reverse().map(r => this.deserializeTransaction(r));
  }

  async listAllTransactions(limit = 10000): Promise<WalletTransaction[]> {
    const rows = this.db.prepare('SELECT * FROM wallet_transactions ORDER BY timestamp DESC LIMIT ?').all(Math.min(limit, 10000)) as Record<string, unknown>[];
    return rows.map(r => this.deserializeTransaction(r));
  }

  async deleteTransactions(gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM wallet_transactions WHERE gaii = ?').run(gaii);
    return result.changes;
  }

  private deserializeTransaction(row: Record<string, unknown>): WalletTransaction {
    const record: WalletTransaction = {
      id: row.id as string,
      gaii: row.gaii as string,
      type: row.type as string,
      amount: row.amount as number,
      timestamp: row.timestamp as string,
    };
    if (row.counterpartyGaii) record.counterpartyGaii = row.counterpartyGaii as string;
    if (row.trackingCode) record.trackingCode = row.trackingCode as string;
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Boards ──
  // ══════════════════════════════════════════════════════════

  async createBoard(board: BoardRecord): Promise<BoardRecord> {
    this.db.prepare(
      `INSERT INTO boards (id, name, description, visibility, ownerGaii, allowedGaiis, createdAt, semantic, federate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      board.id, board.name, board.description ?? null,
      board.visibility, board.ownerGaii,
      JSON.stringify(board.allowedGaiis), board.createdAt,
      board.semantic ? JSON.stringify(board.semantic) : null,
      board.federate ? 1 : 0,
    );
    return board;
  }

  async getBoard(id: string): Promise<BoardRecord | null> {
    const row = this.db.prepare('SELECT * FROM boards WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeBoard(row) : null;
  }

  async listBoards(opts?: { visibility?: string; ownerGaii?: string }): Promise<BoardRecord[]> {
    let sql = 'SELECT * FROM boards WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.visibility) { sql += ' AND visibility = ?'; params.push(opts.visibility); }
    if (opts?.ownerGaii) { sql += ' AND ownerGaii = ?'; params.push(opts.ownerGaii); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeBoard(r));
  }

  async updateBoardVisibility(id: string, visibility: string, federate?: boolean): Promise<BoardRecord | null> {
    if (federate !== undefined) {
      const result = this.db.prepare('UPDATE boards SET visibility = ?, federate = ? WHERE id = ?').run(visibility, federate ? 1 : 0, id);
      if (result.changes === 0) return null;
    } else {
      const result = this.db.prepare('UPDATE boards SET visibility = ? WHERE id = ?').run(visibility, id);
      if (result.changes === 0) return null;
    }
    return this.getBoard(id);
  }

  async updateBoardMembers(id: string, allowedGaiis: string[]): Promise<BoardRecord | null> {
    const result = this.db.prepare('UPDATE boards SET allowedGaiis = ? WHERE id = ?').run(JSON.stringify(allowedGaiis), id);
    if (result.changes === 0) return null;
    return this.getBoard(id);
  }

  async deleteBoard(id: string): Promise<boolean> {
    // Delete all posts in the board
    this.db.prepare('DELETE FROM board_posts WHERE boardId = ?').run(id);
    const result = this.db.prepare('DELETE FROM boards WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async createPost(post: BoardPostRecord): Promise<BoardPostRecord> {
    this.db.prepare(
      `INSERT INTO board_posts (boardId, id, authorGaii, title, body, category, tags, ttlExpiresAt, reactions, replyTo, createdAt, semantic)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      post.boardId, post.id, post.authorGaii,
      post.title, post.body, post.category ?? null,
      JSON.stringify(post.tags), post.ttlExpiresAt ?? null,
      JSON.stringify(post.reactions), post.replyTo ?? null,
      post.createdAt,
      post.semantic ? JSON.stringify(post.semantic) : null,
    );
    return post;
  }

  async getPost(boardId: string, postId: string): Promise<BoardPostRecord | null> {
    const row = this.db.prepare('SELECT * FROM board_posts WHERE boardId = ? AND id = ?').get(boardId, postId) as Record<string, unknown> | undefined;
    return row ? this.deserializePost(row) : null;
  }

  async listPosts(boardId: string, opts?: { category?: string; cursor?: string; limit?: number }): Promise<BoardPostRecord[]> {
    const limit = opts?.limit ?? 20;
    const now = Date.now();

    let sql = 'SELECT * FROM board_posts WHERE boardId = ? AND replyTo IS NULL';
    const params: unknown[] = [boardId];
    if (opts?.category) { sql += ' AND category = ?'; params.push(opts.category); }
    sql += ' ORDER BY createdAt DESC';

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    let results: BoardPostRecord[] = [];
    for (const row of rows) {
      const post = this.deserializePost(row);
      if (post.ttlExpiresAt && new Date(post.ttlExpiresAt).getTime() < now) {
        this.db.prepare('DELETE FROM board_posts WHERE boardId = ? AND id = ?').run(post.boardId, post.id);
        continue;
      }
      results.push(post);
    }

    if (opts?.cursor) {
      const idx = results.findIndex(p => p.id === opts.cursor);
      if (idx >= 0) results = results.slice(idx + 1);
    }
    return results.slice(0, limit);
  }

  async deletePost(boardId: string, postId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM board_posts WHERE boardId = ? AND id = ?').run(boardId, postId);
    return result.changes > 0;
  }

  async addReaction(boardId: string, postId: string, emoji: string, gaii: string): Promise<boolean> {
    const row = this.db.prepare('SELECT reactions FROM board_posts WHERE boardId = ? AND id = ?').get(boardId, postId) as Record<string, unknown> | undefined;
    if (!row) return false;
    const reactions = JSON.parse(row.reactions as string) as Record<string, string[]>;
    if (!reactions[emoji]) reactions[emoji] = [];
    if (!reactions[emoji].includes(gaii)) reactions[emoji].push(gaii);
    this.db.prepare('UPDATE board_posts SET reactions = ? WHERE boardId = ? AND id = ?').run(
      JSON.stringify(reactions), boardId, postId,
    );
    return true;
  }

  private deserializeBoard(row: Record<string, unknown>): BoardRecord {
    const record: BoardRecord = {
      id: row.id as string,
      name: row.name as string,
      visibility: row.visibility as BoardRecord['visibility'],
      ownerGaii: row.ownerGaii as string,
      allowedGaiis: JSON.parse(row.allowedGaiis as string) as string[],
      createdAt: row.createdAt as string,
    };
    if (row.description) record.description = row.description as string;
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    record.federate = (row as any).federate === 1;
    return record;
  }

  private deserializePost(row: Record<string, unknown>): BoardPostRecord {
    const record: BoardPostRecord = {
      id: row.id as string,
      boardId: row.boardId as string,
      authorGaii: row.authorGaii as string,
      title: row.title as string,
      body: row.body as string,
      tags: JSON.parse(row.tags as string) as string[],
      reactions: JSON.parse(row.reactions as string) as Record<string, string[]>,
      createdAt: row.createdAt as string,
    };
    if (row.category) record.category = row.category as string;
    if (row.ttlExpiresAt) record.ttlExpiresAt = row.ttlExpiresAt as string;
    if (row.replyTo) record.replyTo = row.replyTo as string;
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Board Subscriptions ──
  // ══════════════════════════════════════════════════════════

  async createBoardSubscription(sub: BoardSubscriptionRecord): Promise<BoardSubscriptionRecord> {
    this.db.prepare(
      `INSERT OR REPLACE INTO board_subscriptions (id, boardId, gaii, callbackUrl, filters, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      sub.id, sub.boardId, sub.gaii,
      sub.callbackUrl ?? null,
      sub.filters ? JSON.stringify(sub.filters) : null,
      sub.createdAt,
    );
    return sub;
  }

  async getBoardSubscription(boardId: string, gaii: string): Promise<BoardSubscriptionRecord | null> {
    const row = this.db.prepare('SELECT * FROM board_subscriptions WHERE boardId = ? AND gaii = ?').get(boardId, gaii) as Record<string, unknown> | undefined;
    return row ? this.deserializeBoardSubscription(row) : null;
  }

  async listBoardSubscriptions(boardId: string): Promise<BoardSubscriptionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM board_subscriptions WHERE boardId = ?').all(boardId) as Record<string, unknown>[];
    return rows.map(r => this.deserializeBoardSubscription(r));
  }

  async listSubscriptionsByAgent(gaii: string): Promise<BoardSubscriptionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM board_subscriptions WHERE gaii = ?').all(gaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeBoardSubscription(r));
  }

  async deleteBoardSubscription(boardId: string, gaii: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM board_subscriptions WHERE boardId = ? AND gaii = ?').run(boardId, gaii);
    return result.changes > 0;
  }

  private deserializeBoardSubscription(row: Record<string, unknown>): BoardSubscriptionRecord {
    const record: BoardSubscriptionRecord = {
      id: row.id as string,
      boardId: row.boardId as string,
      gaii: row.gaii as string,
      createdAt: row.createdAt as string,
    };
    if (row.callbackUrl) record.callbackUrl = row.callbackUrl as string;
    if (row.filters) record.filters = JSON.parse(row.filters as string);
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── OTK (One-Time Keys) ──
  // ══════════════════════════════════════════════════════════

  async createOtk(otk: OtkRecord): Promise<OtkRecord> {
    this.db.prepare(
      `INSERT INTO otks (key, ownerGaii, action, params, expiresAt, initial, used, usedAt, sessionId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      otk.key, otk.ownerGaii, otk.action,
      JSON.stringify(otk.params), otk.expiresAt,
      otk.initial ? 1 : 0, otk.used ? 1 : 0,
      otk.usedAt, otk.sessionId, otk.createdAt,
    );
    return otk;
  }

  async getOtk(key: string): Promise<OtkRecord | null> {
    const row = this.db.prepare('SELECT * FROM otks WHERE key = ?').get(key) as Record<string, unknown> | undefined;
    return row ? this.deserializeOtk(row) : null;
  }

  async consumeOtk(key: string, graceMs: number = 60_000): Promise<OtkRecord | null> {
    const otk = await this.getOtk(key);
    if (!otk) return null;

    // Initial OTK: timer hasn't started yet -- activate on first use
    if (otk.initial && !otk.used) {
      otk.used = true;
      otk.usedAt = new Date().toISOString();
      otk.expiresAt = new Date(Date.now() + graceMs).toISOString();
      this.db.prepare('UPDATE otks SET used = 1, usedAt = ?, expiresAt = ? WHERE key = ?').run(otk.usedAt, otk.expiresAt, key);
      return otk;
    }

    if (new Date(otk.expiresAt) < new Date()) {
      this.db.prepare('DELETE FROM otks WHERE key = ?').run(key);
      return null;
    }

    // Configurable post-use window: allow re-use within graceMs of first use
    if (otk.used && otk.usedAt) {
      const usedAt = new Date(otk.usedAt).getTime();
      if (Date.now() - usedAt > graceMs) {
        this.db.prepare('DELETE FROM otks WHERE key = ?').run(key);
        return null;
      }
      return otk; // still within grace window
    }

    otk.used = true;
    otk.usedAt = new Date().toISOString();
    this.db.prepare('UPDATE otks SET used = 1, usedAt = ? WHERE key = ?').run(otk.usedAt, key);
    return otk;
  }

  async listOtksBySession(sessionId: string): Promise<OtkRecord[]> {
    const rows = this.db.prepare('SELECT * FROM otks WHERE sessionId = ?').all(sessionId) as Record<string, unknown>[];
    return rows.map(r => this.deserializeOtk(r));
  }

  async expireSessionOtks(sessionId: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM otks WHERE sessionId = ?').run(sessionId);
    return result.changes;
  }

  private deserializeOtk(row: Record<string, unknown>): OtkRecord {
    return {
      key: row.key as string,
      ownerGaii: row.ownerGaii as string,
      action: row.action as string,
      params: JSON.parse(row.params as string),
      expiresAt: row.expiresAt as string,
      initial: (row.initial as number) === 1,
      used: (row.used as number) === 1,
      usedAt: (row.usedAt as string) ?? null,
      sessionId: (row.sessionId as string) ?? null,
      createdAt: row.createdAt as string,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Node Key ──
  // ══════════════════════════════════════════════════════════

  async setNodeKey(publicKey: string, privateKey: string): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO node_key (id, publicKey, privateKey) VALUES (1, ?, ?)`
    ).run(publicKey, privateKey);
  }

  async getNodeKey(): Promise<{ publicKey: string; privateKey: string } | null> {
    const row = this.db.prepare('SELECT * FROM node_key WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (!row) return null;
    return { publicKey: row.publicKey as string, privateKey: row.privateKey as string };
  }

  // ══════════════════════════════════════════════════════════
  // ── Disputes ──
  // ══════════════════════════════════════════════════════════

  async createDispute(dispute: DisputeRecord): Promise<DisputeRecord> {
    this.db.prepare(
      `INSERT INTO disputes (id, trackingCode, status, openedBy, reason, ruling, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      dispute.id, dispute.trackingCode, dispute.status,
      dispute.openedBy, dispute.reason,
      dispute.ruling ? JSON.stringify(dispute.ruling) : null,
      dispute.createdAt, dispute.updatedAt,
    );
    return dispute;
  }

  async getDispute(id: string): Promise<DisputeRecord | null> {
    const row = this.db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeDispute(row) : null;
  }

  async getDisputeByTrackingCode(tc: string): Promise<DisputeRecord | null> {
    const row = this.db.prepare('SELECT * FROM disputes WHERE trackingCode = ?').get(tc) as Record<string, unknown> | undefined;
    return row ? this.deserializeDispute(row) : null;
  }

  async updateDispute(id: string, updates: Partial<DisputeRecord>): Promise<DisputeRecord | null> {
    const existing = await this.getDispute(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE disputes SET trackingCode = ?, status = ?, openedBy = ?, reason = ?, ruling = ?,
       createdAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      updated.trackingCode, updated.status, updated.openedBy, updated.reason,
      updated.ruling ? JSON.stringify(updated.ruling) : null,
      updated.createdAt, updated.updatedAt, id,
    );
    return updated;
  }

  async addDisputeAuditEntry(disputeId: string, entry: DisputeAuditEntry): Promise<DisputeAuditEntry> {
    this.db.prepare(
      `INSERT INTO dispute_audit (disputeId, sequence, event, actor, timestamp, data, hash, previousHash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      disputeId, entry.sequence, entry.event, entry.actor,
      entry.timestamp, JSON.stringify(entry.data),
      entry.hash, entry.previousHash,
    );
    return entry;
  }

  async getDisputeAuditLog(disputeId: string): Promise<DisputeAuditEntry[]> {
    const rows = this.db.prepare('SELECT * FROM dispute_audit WHERE disputeId = ? ORDER BY sequence ASC').all(disputeId) as Record<string, unknown>[];
    return rows.map(r => ({
      sequence: r.sequence as number,
      event: r.event as string,
      actor: r.actor as string,
      timestamp: r.timestamp as string,
      data: JSON.parse(r.data as string),
      hash: r.hash as string,
      previousHash: r.previousHash as string,
    }));
  }

  async listDisputesByProvider(gaii: string): Promise<DisputeRecord[]> {
    // Need to join with work to find by provider
    const rows = this.db.prepare(
      `SELECT d.* FROM disputes d
       INNER JOIN work w ON d.trackingCode = w.trackingCode
       WHERE w.providerGaii = ?`
    ).all(gaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeDispute(r));
  }

  async listAllDisputes(limit = 10000): Promise<DisputeRecord[]> {
    const rows = this.db.prepare('SELECT * FROM disputes ORDER BY createdAt DESC LIMIT ?').all(Math.min(limit, 10000)) as Record<string, unknown>[];
    return rows.map(r => this.deserializeDispute(r));
  }

  private deserializeDispute(row: Record<string, unknown>): DisputeRecord {
    const record: DisputeRecord = {
      id: row.id as string,
      trackingCode: row.trackingCode as string,
      status: row.status as DisputeRecord['status'],
      openedBy: row.openedBy as string,
      reason: row.reason as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.ruling) record.ruling = JSON.parse(row.ruling as string);
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Micro-Memory ──
  // ══════════════════════════════════════════════════════════

  async setMicroMemory(record: MicroMemoryRecord): Promise<MicroMemoryRecord> {
    this.db.prepare(
      `INSERT OR REPLACE INTO micro_memory (gaii, setName, entries, visibility, accessCode, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      record.gaii, record.set,
      JSON.stringify(record.entries), record.visibility,
      record.accessCode ?? null, record.updatedAt,
    );
    return record;
  }

  async getMicroMemory(gaii: string, set: string): Promise<MicroMemoryRecord | null> {
    const row = this.db.prepare('SELECT * FROM micro_memory WHERE gaii = ? AND setName = ?').get(gaii, set) as Record<string, unknown> | undefined;
    return row ? this.deserializeMicroMemory(row) : null;
  }

  async listMicroMemorySets(gaii: string): Promise<MicroMemoryRecord[]> {
    const rows = this.db.prepare('SELECT * FROM micro_memory WHERE gaii = ?').all(gaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMicroMemory(r));
  }

  async deleteMicroMemory(gaii: string, set: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM micro_memory WHERE gaii = ? AND setName = ?').run(gaii, set);
    return result.changes > 0;
  }

  async deleteMicroMemoryEntry(gaii: string, set: string, key: string): Promise<boolean> {
    const record = await this.getMicroMemory(gaii, set);
    if (!record || !(key in record.entries)) return false;
    delete record.entries[key];
    this.db.prepare('UPDATE micro_memory SET entries = ? WHERE gaii = ? AND setName = ?').run(
      JSON.stringify(record.entries), gaii, set,
    );
    return true;
  }

  async findMicroMemoryByAccessCode(set: string, accessCode: string): Promise<MicroMemoryRecord | null> {
    const row = this.db.prepare(
      `SELECT * FROM micro_memory WHERE setName = ? AND accessCode = ? AND (visibility = 'shared_read' OR visibility = 'shared_write')`
    ).get(set, accessCode) as Record<string, unknown> | undefined;
    return row ? this.deserializeMicroMemory(row) : null;
  }

  private deserializeMicroMemory(row: Record<string, unknown>): MicroMemoryRecord {
    const record: MicroMemoryRecord = {
      gaii: row.gaii as string,
      set: row.setName as string,
      entries: JSON.parse(row.entries as string),
      visibility: row.visibility as MicroMemoryRecord['visibility'],
      updatedAt: row.updatedAt as string,
    };
    if (row.accessCode) record.accessCode = row.accessCode as string;
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Storage (Binary Files) ──
  // ══════════════════════════════════════════════════════════

  async createStorageFile(file: StorageFileRecord): Promise<StorageFileRecord> {
    this.db.prepare(
      `INSERT OR REPLACE INTO storage_files (ownerGaii, key, visibility, groupId, mimeType, size, data, accessCode, tags, createdAt, federate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      file.ownerGaii, file.key, file.visibility, file.groupId ?? null,
      file.mimeType, file.size, file.data,
      file.accessCode ?? null, JSON.stringify(file.tags || []), file.createdAt,
      file.federate ? 1 : 0,
    );
    return file;
  }

  async getStorageFile(ownerGaii: string, key: string): Promise<StorageFileRecord | null> {
    const row = this.db.prepare('SELECT * FROM storage_files WHERE ownerGaii = ? AND key = ?').get(ownerGaii, key) as Record<string, unknown> | undefined;
    if (!row) return null;
    const record: StorageFileRecord = {
      key: row.key as string,
      ownerGaii: row.ownerGaii as string,
      visibility: row.visibility as StorageFileRecord['visibility'],
      mimeType: row.mimeType as string,
      size: row.size as number,
      data: row.data as Buffer,
      tags: row.tags ? JSON.parse(row.tags as string) : [],
      createdAt: row.createdAt as string,
    };
    if (row.accessCode) record.accessCode = row.accessCode as string;
    if (row.groupId) record.groupId = row.groupId as string;
    record.federate = (row as any).federate === 1;
    return record;
  }

  async listStorageFiles(ownerGaii: string): Promise<StorageFileRecord[]> {
    const rows = this.db.prepare('SELECT * FROM storage_files WHERE ownerGaii = ?').all(ownerGaii) as Record<string, unknown>[];
    return rows.map(r => {
      const record: StorageFileRecord = {
        key: r.key as string,
        ownerGaii: r.ownerGaii as string,
        visibility: r.visibility as StorageFileRecord['visibility'],
        mimeType: r.mimeType as string,
        size: r.size as number,
        data: r.data as Buffer,
        tags: r.tags ? JSON.parse(r.tags as string) : [],
        createdAt: r.createdAt as string,
      };
      if (r.accessCode) record.accessCode = r.accessCode as string;
      if (r.groupId) record.groupId = r.groupId as string;
      record.federate = (r as any).federate === 1;
      return record;
    });
  }

  async deleteStorageFile(ownerGaii: string, key: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM storage_files WHERE ownerGaii = ? AND key = ?').run(ownerGaii, key);
    return result.changes > 0;
  }

  async updateFileTagsByKey(ownerGaii: string, key: string, tags: string[]): Promise<StorageFileRecord | null> {
    const result = this.db.prepare(
      'UPDATE storage_files SET tags = ? WHERE ownerGaii = ? AND key = ?'
    ).run(JSON.stringify(tags), ownerGaii, key);
    if (result.changes === 0) return null;
    return this.getStorageFile(ownerGaii, key);
  }

  async updateFileVisibility(ownerGaii: string, key: string, visibility: StorageFileRecord['visibility']): Promise<StorageFileRecord | null> {
    const result = this.db.prepare(
      'UPDATE storage_files SET visibility = ? WHERE ownerGaii = ? AND key = ?'
    ).run(visibility, ownerGaii, key);
    if (result.changes === 0) return null;
    return this.getStorageFile(ownerGaii, key);
  }

  // ══════════════════════════════════════════════════════════
  // ── Peering Requests ──
  // ══════════════════════════════════════════════════════════

  async createPeeringRequest(req: PeeringRequestRecord): Promise<PeeringRequestRecord> {
    this.db.prepare(
      `INSERT INTO peering_requests (id, fromNodeUrl, fromNodeId, toNodeId, targetUrl, publicKey, message, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.id, req.fromNodeUrl, req.fromNodeId ?? null,
      req.toNodeId ?? null, req.targetUrl ?? null,
      req.publicKey ?? null, req.message ?? null,
      req.status, req.createdAt, req.updatedAt,
    );
    return req;
  }

  async getPeeringRequest(id: string): Promise<PeeringRequestRecord | null> {
    const row = this.db.prepare('SELECT * FROM peering_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializePeeringRequest(row) : null;
  }

  async listPeeringRequests(status?: string): Promise<PeeringRequestRecord[]> {
    let sql = 'SELECT * FROM peering_requests';
    const params: unknown[] = [];
    if (status) { sql += ' WHERE status = ?'; params.push(status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializePeeringRequest(r));
  }

  async updatePeeringRequest(id: string, updates: Partial<PeeringRequestRecord>): Promise<PeeringRequestRecord | null> {
    const existing = await this.getPeeringRequest(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE peering_requests SET fromNodeUrl = ?, fromNodeId = ?, toNodeId = ?, targetUrl = ?,
       publicKey = ?, message = ?, status = ?, createdAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      updated.fromNodeUrl, updated.fromNodeId ?? null,
      updated.toNodeId ?? null, updated.targetUrl ?? null,
      updated.publicKey ?? null, updated.message ?? null,
      updated.status, updated.createdAt, updated.updatedAt, id,
    );
    return updated;
  }

  async deletePeeringRequest(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM peering_requests WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private deserializePeeringRequest(row: Record<string, unknown>): PeeringRequestRecord {
    const record: PeeringRequestRecord = {
      id: row.id as string,
      fromNodeUrl: row.fromNodeUrl as string,
      status: row.status as PeeringRequestRecord['status'],
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.fromNodeId) record.fromNodeId = row.fromNodeId as string;
    if (row.toNodeId) record.toNodeId = row.toNodeId as string;
    if (row.targetUrl) record.targetUrl = row.targetUrl as string;
    if (row.publicKey) record.publicKey = row.publicKey as string;
    if (row.message) record.message = row.message as string;
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Chunked Uploads (in-memory, same as MongoDB adapter) ──
  // ══════════════════════════════════════════════════════════

  async createChunkedUpload(record: ChunkedUploadRecord): Promise<ChunkedUploadRecord> {
    this.chunkedUploads.set(record.uploadId, record);
    return record;
  }

  async getChunkedUpload(uploadId: string): Promise<ChunkedUploadRecord | null> {
    const record = this.chunkedUploads.get(uploadId) ?? null;
    if (record && new Date(record.expiresAt).getTime() < Date.now()) {
      this.chunkedUploads.delete(uploadId);
      return null;
    }
    return record;
  }

  async addChunk(uploadId: string, chunkIndex: number, data: Buffer): Promise<boolean> {
    const record = this.chunkedUploads.get(uploadId);
    if (!record) return false;
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      this.chunkedUploads.delete(uploadId);
      return false;
    }
    record.receivedChunks.set(chunkIndex, data);
    return true;
  }

  async deleteChunkedUpload(uploadId: string): Promise<boolean> {
    return this.chunkedUploads.delete(uploadId);
  }

  // ══════════════════════════════════════════════════════════
  // ── GHII (Global Human Identity Identifier) ──
  // ══════════════════════════════════════════════════════════

  async createGHII(record: GHIIRecord): Promise<GHIIRecord> {
    try {
      this.db.prepare(
        `INSERT INTO ghiis (ghii, username, nodeId, displayName, bio, avatar, locale, passwordHash,
         verificationLevel, ownerName, createdAt, updatedAt, totpSecret, totpEnabled, totpBackupCodes,
         totpLastUsedAt, totpLastUsedCode, totpFailedAttempts, totpLockedUntil, semantic, emailHash,
         emailVerifiedAt, verificationMethod, magicLinkEnabled, notificationEmail, lastLoginAt,
         loginCount, verifiedAttributes, verificationIssuer, verificationCredentialHash, ftnVerified,
         googleSub, trustScore, morselBalance, allowedOrigins)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.ghii, record.username, record.nodeId, record.displayName,
        record.bio ?? null, record.avatar ?? null, record.locale ?? null,
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
        record.trustScore ?? null, record.morselBalance ?? null,
        record.allowedOrigins ? JSON.stringify(record.allowedOrigins) : null,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('GHII_TAKEN', { cause: err });
      throw err;
    }
  }

  async getGHII(ghii: string): Promise<GHIIRecord | null> {
    const row = this.db.prepare('SELECT * FROM ghiis WHERE ghii = ?').get(ghii) as Record<string, unknown> | undefined;
    return row ? this.deserializeGHII(row) : null;
  }

  async getGHIIByOwner(ownerName: string): Promise<GHIIRecord | null> {
    const row = this.db.prepare('SELECT * FROM ghiis WHERE ownerName = ?').get(ownerName) as Record<string, unknown> | undefined;
    return row ? this.deserializeGHII(row) : null;
  }

  async getGHIIByEmailHash(emailHash: string): Promise<GHIIRecord | null> {
    const row = this.db.prepare('SELECT * FROM ghiis WHERE emailHash = ?').get(emailHash) as Record<string, unknown> | undefined;
    return row ? this.deserializeGHII(row) : null;
  }

  async getGHIIByGoogleSub(googleSub: string): Promise<GHIIRecord | null> {
    const row = this.db.prepare('SELECT * FROM ghiis WHERE googleSub = ?').get(googleSub) as Record<string, unknown> | undefined;
    return row ? this.deserializeGHII(row) : null;
  }

  async updateGHII(ghii: string, updates: Partial<GHIIRecord>): Promise<GHIIRecord | null> {
    const existing = await this.getGHII(ghii);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.db.prepare(
      `UPDATE ghiis SET username = ?, nodeId = ?, displayName = ?, bio = ?, avatar = ?, locale = ?,
       passwordHash = ?, verificationLevel = ?, ownerName = ?, createdAt = ?, updatedAt = ?,
       totpSecret = ?, totpEnabled = ?, totpBackupCodes = ?, totpLastUsedAt = ?,
       totpLastUsedCode = ?, totpFailedAttempts = ?, totpLockedUntil = ?, semantic = ?,
       emailHash = ?, emailVerifiedAt = ?, verificationMethod = ?, magicLinkEnabled = ?,
       notificationEmail = ?, lastLoginAt = ?, loginCount = ?, verifiedAttributes = ?,
       verificationIssuer = ?, verificationCredentialHash = ?, ftnVerified = ?,
       googleSub = ?, trustScore = ?, morselBalance = ?, allowedOrigins = ?
       WHERE ghii = ?`
    ).run(
      updated.username, updated.nodeId, updated.displayName,
      updated.bio ?? null, updated.avatar ?? null, updated.locale ?? null,
      updated.passwordHash ?? null, updated.verificationLevel, updated.ownerName,
      updated.createdAt, updated.updatedAt,
      updated.totpSecret ?? null, updated.totpEnabled ? 1 : 0,
      updated.totpBackupCodes ? JSON.stringify(updated.totpBackupCodes) : null,
      updated.totpLastUsedAt ?? null, updated.totpLastUsedCode ?? null,
      updated.totpFailedAttempts ?? 0, updated.totpLockedUntil ?? null,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      updated.emailHash ?? null, updated.emailVerifiedAt ?? null,
      updated.verificationMethod ?? null, updated.magicLinkEnabled ? 1 : 0,
      updated.notificationEmail ?? null, updated.lastLoginAt ?? null,
      updated.loginCount ?? 0,
      updated.verifiedAttributes ? JSON.stringify(updated.verifiedAttributes) : null,
      updated.verificationIssuer ?? null, updated.verificationCredentialHash ?? null,
      updated.ftnVerified ? 1 : 0,
      updated.googleSub ?? null,
      updated.trustScore ?? null, updated.morselBalance ?? null,
      updated.allowedOrigins ? JSON.stringify(updated.allowedOrigins) : null,
      ghii,
    );
    return updated;
  }

  async listGHIIs(opts?: { q?: string; level?: number }): Promise<GHIIRecord[]> {
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
  }

  async deleteGHII(ghii: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM ghiis WHERE ghii = ?').run(ghii);
    return result.changes > 0;
  }

  private deserializeGHII(row: Record<string, unknown>): GHIIRecord {
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
    if (row.passwordHash) record.passwordHash = row.passwordHash as string;
    if (row.totpSecret) record.totpSecret = row.totpSecret as string;
    if (row.totpBackupCodes) record.totpBackupCodes = JSON.parse(row.totpBackupCodes as string);
    if (row.totpLastUsedAt) record.totpLastUsedAt = row.totpLastUsedAt as string;
    if (row.totpLastUsedCode) record.totpLastUsedCode = row.totpLastUsedCode as string;
    if (row.totpFailedAttempts) record.totpFailedAttempts = row.totpFailedAttempts as number;
    if (row.totpLockedUntil) record.totpLockedUntil = row.totpLockedUntil as string;
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
    if (row.trustScore !== null && row.trustScore !== undefined) record.trustScore = row.trustScore as number;
    if (row.morselBalance !== null && row.morselBalance !== undefined) record.morselBalance = row.morselBalance as number;
    if (row.allowedOrigins) record.allowedOrigins = JSON.parse(row.allowedOrigins as string);
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Chat Instances ──
  // ══════════════════════════════════════════════════════════

  async createChatInstance(record: ChatInstanceRecord): Promise<ChatInstanceRecord> {
    try {
      this.db.prepare(
        `INSERT INTO chat_instances (id, platform, appName, ownerName, ghii, nodeId, isAnonymous, createdAt, lastSeen, agentGaii, mcpClientId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id, record.platform, record.appName, record.ownerName,
        record.ghii, record.nodeId, record.isAnonymous ? 1 : 0,
        record.createdAt, record.lastSeen,
        record.agentGaii ?? null, record.mcpClientId ?? null,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('CHAT_INSTANCE_EXISTS', { cause: err });
      throw err;
    }
  }

  async getChatInstance(id: string): Promise<ChatInstanceRecord | null> {
    const row = this.db.prepare('SELECT * FROM chat_instances WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeChatInstance(row) : null;
  }

  async listChatInstances(opts?: { ownerName?: string; platform?: string; ghii?: string }): Promise<ChatInstanceRecord[]> {
    let sql = 'SELECT * FROM chat_instances WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.ownerName) { sql += ' AND ownerName = ?'; params.push(opts.ownerName); }
    if (opts?.platform) { sql += ' AND platform = ?'; params.push(opts.platform); }
    if (opts?.ghii) { sql += ' AND ghii = ?'; params.push(opts.ghii); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeChatInstance(r));
  }

  async updateChatInstance(id: string, updates: Partial<ChatInstanceRecord>): Promise<ChatInstanceRecord | null> {
    const existing = await this.getChatInstance(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE chat_instances SET platform = ?, appName = ?, ownerName = ?, ghii = ?,
       nodeId = ?, isAnonymous = ?, createdAt = ?, lastSeen = ?, agentGaii = ?, mcpClientId = ? WHERE id = ?`
    ).run(
      updated.platform, updated.appName, updated.ownerName, updated.ghii,
      updated.nodeId, updated.isAnonymous ? 1 : 0,
      updated.createdAt, updated.lastSeen,
      updated.agentGaii ?? null, updated.mcpClientId ?? null, id,
    );
    return updated;
  }

  async deleteChatInstance(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM chat_instances WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private deserializeChatInstance(row: Record<string, unknown>): ChatInstanceRecord {
    return {
      id: row.id as string,
      platform: row.platform as string,
      appName: row.appName as string,
      ownerName: row.ownerName as string,
      ghii: row.ghii as string,
      nodeId: row.nodeId as string,
      isAnonymous: (row.isAnonymous as number) === 1,
      createdAt: row.createdAt as string,
      lastSeen: row.lastSeen as string,
      agentGaii: (row.agentGaii as string) || undefined,
      mcpClientId: (row.mcpClientId as string) || undefined,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Email Verifications ──
  // ══════════════════════════════════════════════════════════

  async createEmailVerification(record: EmailVerificationRecord): Promise<EmailVerificationRecord> {
    this.db.prepare(
      `INSERT INTO email_verifications (id, ownerName, emailHash, code, purpose, status, attempts, expiresAt, createdAt, verifiedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.ownerName, record.emailHash, record.code,
      record.purpose, record.status, record.attempts,
      record.expiresAt, record.createdAt, record.verifiedAt,
    );
    return record;
  }

  async getEmailVerification(id: string): Promise<EmailVerificationRecord | null> {
    const row = this.db.prepare('SELECT * FROM email_verifications WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeEmailVerification(row) : null;
  }

  async getActiveEmailVerification(ownerName: string, purpose: string): Promise<EmailVerificationRecord | null> {
    const now = new Date().toISOString();
    const row = this.db.prepare(
      `SELECT * FROM email_verifications WHERE ownerName = ? AND purpose = ? AND status = 'pending' AND expiresAt > ? LIMIT 1`
    ).get(ownerName, purpose, now) as Record<string, unknown> | undefined;
    return row ? this.deserializeEmailVerification(row) : null;
  }

  async updateEmailVerification(id: string, updates: Partial<EmailVerificationRecord>): Promise<EmailVerificationRecord | null> {
    const existing = await this.getEmailVerification(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE email_verifications SET ownerName = ?, emailHash = ?, code = ?, purpose = ?,
       status = ?, attempts = ?, expiresAt = ?, createdAt = ?, verifiedAt = ? WHERE id = ?`
    ).run(
      updated.ownerName, updated.emailHash, updated.code, updated.purpose,
      updated.status, updated.attempts, updated.expiresAt,
      updated.createdAt, updated.verifiedAt, id,
    );
    return updated;
  }

  async getEmailVerificationsByOwner(ownerName: string): Promise<EmailVerificationRecord[]> {
    const rows = this.db.prepare('SELECT * FROM email_verifications WHERE ownerName = ?').all(ownerName) as Record<string, unknown>[];
    return rows.map(r => this.deserializeEmailVerification(r));
  }

  async deleteExpiredEmailVerifications(): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      `DELETE FROM email_verifications WHERE status = 'pending' AND expiresAt < ?`
    ).run(now);
    return result.changes;
  }

  private deserializeEmailVerification(row: Record<string, unknown>): EmailVerificationRecord {
    return {
      id: row.id as string,
      ownerName: row.ownerName as string,
      emailHash: row.emailHash as string,
      code: row.code as string,
      purpose: row.purpose as EmailVerificationRecord['purpose'],
      status: row.status as EmailVerificationRecord['status'],
      attempts: row.attempts as number,
      expiresAt: row.expiresAt as string,
      createdAt: row.createdAt as string,
      verifiedAt: (row.verifiedAt as string) ?? null,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Personal Nodes ──
  // ══════════════════════════════════════════════════════════

  async createPersonalNode(node: PersonalNodeRecord): Promise<PersonalNodeRecord> {
    this.db.prepare(
      `INSERT INTO personal_nodes (nodeId, ownerName, anchorNodeId, publicKey, status, agentGaiis,
       lastSeen, mailboxQuotaBytes, mailboxUsedBytes, visibility, createdAt, updatedAt, semantic)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      node.nodeId, node.ownerName, node.anchorNodeId, node.publicKey,
      node.status, JSON.stringify(node.agentGaiis), node.lastSeen,
      node.mailboxQuotaBytes, node.mailboxUsedBytes, node.visibility,
      node.createdAt, node.updatedAt,
      node.semantic ? JSON.stringify(node.semantic) : null,
    );
    return { ...node };
  }

  async getPersonalNode(nodeId: string): Promise<PersonalNodeRecord | null> {
    const row = this.db.prepare('SELECT * FROM personal_nodes WHERE nodeId = ?').get(nodeId) as Record<string, unknown> | undefined;
    return row ? this.deserializePersonalNode(row) : null;
  }

  async getPersonalNodeByOwner(ownerName: string): Promise<PersonalNodeRecord | null> {
    const row = this.db.prepare('SELECT * FROM personal_nodes WHERE ownerName = ?').get(ownerName) as Record<string, unknown> | undefined;
    return row ? this.deserializePersonalNode(row) : null;
  }

  async listPersonalNodes(opts?: { status?: string }): Promise<PersonalNodeRecord[]> {
    let sql = 'SELECT * FROM personal_nodes';
    const params: unknown[] = [];
    if (opts?.status) { sql += ' WHERE status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializePersonalNode(r));
  }

  async updatePersonalNode(nodeId: string, updates: Partial<PersonalNodeRecord>): Promise<PersonalNodeRecord | null> {
    const existing = await this.getPersonalNode(nodeId);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.db.prepare(
      `UPDATE personal_nodes SET ownerName = ?, anchorNodeId = ?, publicKey = ?, status = ?,
       agentGaiis = ?, lastSeen = ?, mailboxQuotaBytes = ?, mailboxUsedBytes = ?,
       visibility = ?, createdAt = ?, updatedAt = ?, semantic = ? WHERE nodeId = ?`
    ).run(
      updated.ownerName, updated.anchorNodeId, updated.publicKey, updated.status,
      JSON.stringify(updated.agentGaiis), updated.lastSeen,
      updated.mailboxQuotaBytes, updated.mailboxUsedBytes,
      updated.visibility, updated.createdAt, updated.updatedAt,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      nodeId,
    );
    return { ...updated };
  }

  async deletePersonalNode(nodeId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM personal_nodes WHERE nodeId = ?').run(nodeId);
    return result.changes > 0;
  }

  private deserializePersonalNode(row: Record<string, unknown>): PersonalNodeRecord {
    const record: PersonalNodeRecord = {
      nodeId: row.nodeId as string,
      ownerName: row.ownerName as string,
      anchorNodeId: row.anchorNodeId as string,
      publicKey: row.publicKey as string,
      status: row.status as PersonalNodeRecord['status'],
      agentGaiis: JSON.parse(row.agentGaiis as string) as string[],
      lastSeen: row.lastSeen as string,
      mailboxQuotaBytes: row.mailboxQuotaBytes as number,
      mailboxUsedBytes: row.mailboxUsedBytes as number,
      visibility: row.visibility as PersonalNodeRecord['visibility'],
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Mailbox ──
  // ══════════════════════════════════════════════════════════

  async createMailboxItem(item: MailboxItemRecord): Promise<MailboxItemRecord> {
    this.db.prepare(
      `INSERT INTO mailbox_items (id, personalNodeId, type, fromGaii, toGaii, payload, sizeBytes, retentionDays, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      item.id, item.personalNodeId, item.type, item.fromGaii, item.toGaii,
      item.payload, item.sizeBytes, item.retentionDays, item.expiresAt, item.createdAt,
    );
    // Update the personal node's mailbox usage
    this.db.prepare(
      'UPDATE personal_nodes SET mailboxUsedBytes = mailboxUsedBytes + ? WHERE nodeId = ?'
    ).run(item.sizeBytes, item.personalNodeId);
    return { ...item };
  }

  async getMailboxItem(id: string): Promise<MailboxItemRecord | null> {
    const row = this.db.prepare('SELECT * FROM mailbox_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeMailboxItem(row) : null;
  }

  async listMailboxItems(personalNodeId: string, opts?: { type?: string; limit?: number }): Promise<MailboxItemRecord[]> {
    let sql = 'SELECT * FROM mailbox_items WHERE personalNodeId = ?';
    const params: unknown[] = [personalNodeId];
    if (opts?.type) { sql += ' AND type = ?'; params.push(opts.type); }
    sql += ' ORDER BY createdAt ASC';
    if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMailboxItem(r));
  }

  async deleteMailboxItem(id: string): Promise<boolean> {
    const item = await this.getMailboxItem(id);
    if (!item) return false;
    // Update the personal node's mailbox usage
    this.db.prepare(
      'UPDATE personal_nodes SET mailboxUsedBytes = MAX(0, mailboxUsedBytes - ?) WHERE nodeId = ?'
    ).run(item.sizeBytes, item.personalNodeId);
    const result = this.db.prepare('DELETE FROM mailbox_items WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async deleteMailboxItemsByNode(personalNodeId: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM mailbox_items WHERE personalNodeId = ?').run(personalNodeId);
    this.db.prepare(
      'UPDATE personal_nodes SET mailboxUsedBytes = 0 WHERE nodeId = ?'
    ).run(personalNodeId);
    return result.changes;
  }

  async getMailboxStats(personalNodeId: string): Promise<{ count: number; totalBytes: number }> {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count, COALESCE(SUM(sizeBytes), 0) as totalBytes FROM mailbox_items WHERE personalNodeId = ?'
    ).get(personalNodeId) as Record<string, unknown>;
    return {
      count: row.count as number,
      totalBytes: row.totalBytes as number,
    };
  }

  async cleanExpiredMailboxItems(): Promise<number> {
    const now = new Date().toISOString();
    // Get expired items to update personal node usage
    const expiredItems = this.db.prepare(
      'SELECT personalNodeId, sizeBytes FROM mailbox_items WHERE expiresAt < ?'
    ).all(now) as Record<string, unknown>[];

    // Aggregate by personalNodeId
    const bytesPerNode = new Map<string, number>();
    for (const item of expiredItems) {
      const nodeId = item.personalNodeId as string;
      bytesPerNode.set(nodeId, (bytesPerNode.get(nodeId) ?? 0) + (item.sizeBytes as number));
    }

    // Delete expired items
    const result = this.db.prepare('DELETE FROM mailbox_items WHERE expiresAt < ?').run(now);

    // Update personal node usage
    for (const [nodeId, bytes] of bytesPerNode) {
      this.db.prepare(
        'UPDATE personal_nodes SET mailboxUsedBytes = MAX(0, mailboxUsedBytes - ?) WHERE nodeId = ?'
      ).run(bytes, nodeId);
    }

    return result.changes;
  }

  private deserializeMailboxItem(row: Record<string, unknown>): MailboxItemRecord {
    return {
      id: row.id as string,
      personalNodeId: row.personalNodeId as string,
      type: row.type as MailboxItemRecord['type'],
      fromGaii: row.fromGaii as string,
      toGaii: row.toGaii as string,
      payload: row.payload as string,
      sizeBytes: row.sizeBytes as number,
      retentionDays: row.retentionDays as number,
      expiresAt: row.expiresAt as string,
      createdAt: row.createdAt as string,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Maintenance Mode ──
  // ══════════════════════════════════════════════════════════

  async getMaintenanceMode(): Promise<MaintenanceState> {
    const row = this.db.prepare('SELECT * FROM maintenance WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (!row) {
      return { enabled: false, message: '', enabledAt: null, enabledBy: null };
    }
    return {
      enabled: (row.enabled as number) === 1,
      message: row.message as string,
      enabledAt: (row.enabledAt as string) ?? null,
      enabledBy: (row.enabledBy as string) ?? null,
    };
  }

  async setMaintenanceMode(state: MaintenanceState): Promise<MaintenanceState> {
    this.db.prepare(
      `INSERT OR REPLACE INTO maintenance (id, enabled, message, enabledAt, enabledBy) VALUES (1, ?, ?, ?, ?)`
    ).run(
      state.enabled ? 1 : 0, state.message,
      state.enabledAt, state.enabledBy,
    );
    return state;
  }

  // ══════════════════════════════════════════════════════════
  // ── Consent Layer ──
  // ══════════════════════════════════════════════════════════

  async createConsent(record: ConsentRecord): Promise<ConsentRecord> {
    this.db.prepare(
      `INSERT INTO consents (id, ownerGaii, dataPattern, recipient, purpose, scope, expires, status, grantedAt, revokedAt, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.ownerGaii, record.dataPattern, record.recipient,
      record.purpose, record.scope, record.expires,
      record.status, record.grantedAt, record.revokedAt,
      record.metadata ? JSON.stringify(record.metadata) : null,
    );
    return record;
  }

  async getConsent(id: string): Promise<ConsentRecord | null> {
    const row = this.db.prepare('SELECT * FROM consents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeConsent(row) : null;
  }

  async listConsents(ownerGaii: string, opts?: {
    status?: 'active' | 'revoked' | 'expired';
    recipient?: string;
  }): Promise<ConsentRecord[]> {
    let sql = 'SELECT * FROM consents WHERE ownerGaii = ?';
    const params: unknown[] = [ownerGaii];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    if (opts?.recipient) { sql += ' AND recipient = ?'; params.push(opts.recipient); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeConsent(r));
  }

  async updateConsent(id: string, updates: Partial<ConsentRecord>): Promise<ConsentRecord | null> {
    const existing = await this.getConsent(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE consents SET ownerGaii = ?, dataPattern = ?, recipient = ?, purpose = ?,
       scope = ?, expires = ?, status = ?, grantedAt = ?, revokedAt = ?, metadata = ? WHERE id = ?`
    ).run(
      updated.ownerGaii, updated.dataPattern, updated.recipient, updated.purpose,
      updated.scope, updated.expires, updated.status,
      updated.grantedAt, updated.revokedAt,
      updated.metadata ? JSON.stringify(updated.metadata) : null,
      id,
    );
    return updated;
  }

  async deleteConsent(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM consents WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async findMatchingConsents(ownerGaii: string, memoryKey: string, accessorGaii: string): Promise<ConsentRecord[]> {
    const now = new Date().toISOString();
    const rows = this.db.prepare(
      `SELECT * FROM consents WHERE ownerGaii = ? AND status = 'active'`
    ).all(ownerGaii) as Record<string, unknown>[];

    const results: ConsentRecord[] = [];
    for (const row of rows) {
      const consent = this.deserializeConsent(row);
      // Check expiration
      if (consent.expires && consent.expires < now) {
        this.db.prepare('UPDATE consents SET status = ? WHERE id = ?').run('expired', consent.id);
        continue;
      }
      // Check recipient (supports *, exact GAII, ghii:, domain:, node:)
      const accessor = parseGaiiLoose(accessorGaii);
      if (!matchesRecipient(consent.recipient, accessorGaii, accessor.owner, accessor.node)) continue;
      // Check data_pattern (glob match)
      if (!consentMatchPattern(consent.dataPattern, memoryKey)) continue;
      results.push(consent);
    }
    return results;
  }

  async expireStaleConsents(before: string): Promise<number> {
    const result = this.db.prepare(
      `UPDATE consents SET status = 'expired' WHERE status = 'active' AND expires IS NOT NULL AND expires < ?`
    ).run(before);
    return result.changes;
  }

  // Consent Audit
  async addConsentAuditEntry(entry: ConsentAuditEntry): Promise<ConsentAuditEntry> {
    this.db.prepare(
      `INSERT INTO consent_audit (id, consentId, ownerGaii, accessorGaii, memoryKey, action, timestamp, allowed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.id, entry.consentId, entry.ownerGaii, entry.accessorGaii,
      entry.memoryKey, entry.action, entry.timestamp,
      entry.allowed ? 1 : 0,
    );
    return entry;
  }

  async pruneConsentAudit(beforeIso: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM consent_audit WHERE timestamp < ?').run(beforeIso);
    return result.changes;
  }

  async listConsentAudit(ownerGaii: string, opts?: {
    days?: number;
    consentId?: string;
    accessorGaii?: string;
  }): Promise<ConsentAuditEntry[]> {
    let sql = 'SELECT * FROM consent_audit WHERE ownerGaii = ?';
    const params: unknown[] = [ownerGaii];

    if (opts?.days) {
      const cutoff = new Date(Date.now() - opts.days * 86400000).toISOString();
      sql += ' AND timestamp >= ?';
      params.push(cutoff);
    }
    if (opts?.consentId) { sql += ' AND consentId = ?'; params.push(opts.consentId); }
    if (opts?.accessorGaii) { sql += ' AND accessorGaii = ?'; params.push(opts.accessorGaii); }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      consentId: r.consentId as string,
      ownerGaii: r.ownerGaii as string,
      accessorGaii: r.accessorGaii as string,
      memoryKey: r.memoryKey as string,
      action: r.action as ConsentAuditEntry['action'],
      timestamp: r.timestamp as string,
      allowed: (r.allowed as number) === 1,
    }));
  }

  private deserializeConsent(row: Record<string, unknown>): ConsentRecord {
    const record: ConsentRecord = {
      id: row.id as string,
      ownerGaii: row.ownerGaii as string,
      dataPattern: row.dataPattern as string,
      recipient: row.recipient as string,
      purpose: row.purpose as string,
      scope: row.scope as ConsentRecord['scope'],
      expires: (row.expires as string) ?? null,
      status: row.status as ConsentRecord['status'],
      grantedAt: row.grantedAt as string,
      revokedAt: (row.revokedAt as string) ?? null,
    };
    if (row.metadata) record.metadata = JSON.parse(row.metadata as string);
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Schema Locking ──
  // ══════════════════════════════════════════════════════════

  async setSchema(record: SchemaRecord): Promise<SchemaRecord> {
    this.db.prepare(
      `INSERT OR REPLACE INTO schemas (keyPattern, applyTo, schemaJson, schemaMode, lockedBy, setAt, updatedAt, semanticContext)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.keyPattern, record.applyTo,
      JSON.stringify(record.schemaJson), record.schemaMode,
      record.lockedBy, record.setAt, record.updatedAt,
      record.semanticContext ? JSON.stringify(record.semanticContext) : null,
    );
    return record;
  }

  async getSchema(keyPattern: string, applyTo?: 'exact' | 'prefix'): Promise<SchemaRecord | null> {
    if (applyTo) {
      const row = this.db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(keyPattern, applyTo) as Record<string, unknown> | undefined;
      return row ? this.deserializeSchema(row) : null;
    }
    // Try exact first, then prefix
    const exactRow = this.db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(keyPattern, 'exact') as Record<string, unknown> | undefined;
    if (exactRow) return this.deserializeSchema(exactRow);
    const prefixRow = this.db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(keyPattern, 'prefix') as Record<string, unknown> | undefined;
    return prefixRow ? this.deserializeSchema(prefixRow) : null;
  }

  async deleteSchema(keyPattern: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM schemas WHERE keyPattern = ?').run(keyPattern);
    return result.changes > 0;
  }

  async listSchemas(prefix?: string): Promise<SchemaRecord[]> {
    let sql = 'SELECT * FROM schemas';
    const params: unknown[] = [];
    if (prefix) { sql += ' WHERE keyPattern LIKE ?'; params.push(prefix + '%'); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeSchema(r));
  }

  async findApplicableSchema(memoryKey: string): Promise<SchemaRecord | null> {
    // 1. Exact match -- highest priority
    const exactRow = this.db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(memoryKey, 'exact') as Record<string, unknown> | undefined;
    if (exactRow) return this.deserializeSchema(exactRow);

    // 2. Wildcard pattern match -- supports profile.*.interests style
    const prefixSchemas = this.db.prepare('SELECT * FROM schemas WHERE applyTo = ?').all('prefix') as Record<string, unknown>[];
    let bestWildcard: SchemaRecord | null = null;
    let bestSegments = 0;
    for (const row of prefixSchemas) {
      const record = this.deserializeSchema(row);
      if (!record.keyPattern.includes('*')) continue;
      if (matchWildcardPattern(record.keyPattern, memoryKey)) {
        const segments = record.keyPattern.split('.').length;
        if (segments > bestSegments) {
          bestWildcard = record;
          bestSegments = segments;
        }
      }
    }
    if (bestWildcard) return bestWildcard;

    // 3. Simple prefix match -- longest prefix wins
    const parts = memoryKey.split('.');
    for (let i = parts.length - 1; i >= 1; i--) {
      const prefix = parts.slice(0, i).join('.');
      const prefixRow = this.db.prepare('SELECT * FROM schemas WHERE keyPattern = ? AND applyTo = ?').get(prefix, 'prefix') as Record<string, unknown> | undefined;
      if (prefixRow) return this.deserializeSchema(prefixRow);
    }

    return null;
  }

  private deserializeSchema(row: Record<string, unknown>): SchemaRecord {
    const record: SchemaRecord = {
      keyPattern: row.keyPattern as string,
      applyTo: row.applyTo as SchemaRecord['applyTo'],
      schemaJson: JSON.parse(row.schemaJson as string),
      schemaMode: row.schemaMode as SchemaRecord['schemaMode'],
      lockedBy: row.lockedBy as string,
      setAt: row.setAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.semanticContext) record.semanticContext = JSON.parse(row.semanticContext as string);
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── CSM (Community Service Manifest) ──
  // ══════════════════════════════════════════════════════════

  async createCsm(record: CsmRecord): Promise<CsmRecord> {
    try {
      this.db.prepare(
        `INSERT INTO csms (name, definition, jsonSchemaKey, serviceType, registeredBy, registeredAt, updatedAt, semantic, federate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.name, JSON.stringify(record.definition), record.jsonSchemaKey,
        record.serviceType, record.registeredBy, record.registeredAt, record.updatedAt,
        record.semantic ? JSON.stringify(record.semantic) : null,
        record.federate ? 1 : 0,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('CSM_NAME_TAKEN', { cause: err });
      throw err;
    }
  }

  async getCsm(name: string): Promise<CsmRecord | null> {
    const row = this.db.prepare('SELECT * FROM csms WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeCsm(row) : null;
  }

  async listCsms(opts?: { serviceType?: string }): Promise<CsmRecord[]> {
    let sql = 'SELECT * FROM csms';
    const params: unknown[] = [];
    if (opts?.serviceType) { sql += ' WHERE serviceType = ?'; params.push(opts.serviceType); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeCsm(r));
  }

  async updateCsm(name: string, updates: Partial<CsmRecord>): Promise<CsmRecord | null> {
    const existing = await this.getCsm(name);
    if (!existing) return null;
    const updated = { ...existing, ...updates, name: existing.name };
    this.db.prepare(
      `UPDATE csms SET definition = ?, jsonSchemaKey = ?, serviceType = ?, registeredBy = ?,
       registeredAt = ?, updatedAt = ?, semantic = ?, federate = ? WHERE name = ?`
    ).run(
      JSON.stringify(updated.definition), updated.jsonSchemaKey,
      updated.serviceType, updated.registeredBy,
      updated.registeredAt, updated.updatedAt,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      updated.federate ? 1 : 0,
      name,
    );
    return updated;
  }

  async deleteCsm(name: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM csms WHERE name = ?').run(name);
    return result.changes > 0;
  }

  private deserializeCsm(row: Record<string, unknown>): CsmRecord {
    const record: CsmRecord = {
      name: row.name as string,
      definition: JSON.parse(row.definition as string),
      jsonSchemaKey: row.jsonSchemaKey as string,
      serviceType: row.serviceType as string,
      registeredBy: row.registeredBy as string,
      registeredAt: row.registeredAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    if (row.federate) record.federate = (row.federate as number) === 1;
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── MSM (Machine Service Manifest) ──
  // ══════════════════════════════════════════════════════════

  async createMsm(record: MsmRecord): Promise<MsmRecord> {
    try {
      this.db.prepare(
        `INSERT INTO msms (name, definition, category, authType, actionsCount, registeredBy, registeredAt, updatedAt, federate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.name, JSON.stringify(record.definition), record.category,
        record.authType, record.actionsCount, record.registeredBy,
        record.registeredAt, record.updatedAt,
        record.federate ? 1 : 0,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('MSM_NAME_TAKEN', { cause: err });
      throw err;
    }
  }

  async getMsm(name: string): Promise<MsmRecord | null> {
    const row = this.db.prepare('SELECT * FROM msms WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeMsm(row) : null;
  }

  async listMsms(opts?: { category?: string }): Promise<MsmRecord[]> {
    let sql = 'SELECT * FROM msms';
    const params: unknown[] = [];
    if (opts?.category) { sql += ' WHERE category = ?'; params.push(opts.category); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMsm(r));
  }

  async updateMsm(name: string, updates: Partial<MsmRecord>): Promise<MsmRecord | null> {
    const existing = await this.getMsm(name);
    if (!existing) return null;
    const updated = { ...existing, ...updates, name: existing.name, updatedAt: new Date().toISOString() };
    this.db.prepare(
      `UPDATE msms SET definition = ?, category = ?, authType = ?, actionsCount = ?,
       registeredBy = ?, registeredAt = ?, updatedAt = ?, federate = ? WHERE name = ?`
    ).run(
      JSON.stringify(updated.definition), updated.category, updated.authType,
      updated.actionsCount, updated.registeredBy,
      updated.registeredAt, updated.updatedAt,
      updated.federate ? 1 : 0,
      name,
    );
    return updated;
  }

  async deleteMsm(name: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM msms WHERE name = ?').run(name);
    return result.changes > 0;
  }

  private deserializeMsm(row: Record<string, unknown>): MsmRecord {
    const record: MsmRecord = {
      name: row.name as string,
      definition: JSON.parse(row.definition as string),
      category: row.category as string,
      authType: row.authType as string,
      actionsCount: row.actionsCount as number,
      registeredBy: row.registeredBy as string,
      registeredAt: row.registeredAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.federate) record.federate = (row.federate as number) === 1;
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Flags (Moderation) ──
  // ══════════════════════════════════════════════════════════

  async createFlag(record: FlagRecord): Promise<FlagRecord> {
    this.db.prepare(
      `INSERT INTO flags (id, targetType, targetId, flaggedBy, reason, description, status, reviewedBy, reviewedAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.targetType, record.targetId, record.flaggedBy,
      record.reason, record.description ?? null, record.status,
      record.reviewedBy ?? null, record.reviewedAt ?? null, record.createdAt,
    );
    return record;
  }

  async getFlag(id: string): Promise<FlagRecord | null> {
    const row = this.db.prepare('SELECT * FROM flags WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeFlag(row) : null;
  }

  async getFlagsByTarget(targetType: string, targetId: string): Promise<FlagRecord[]> {
    const rows = this.db.prepare('SELECT * FROM flags WHERE targetType = ? AND targetId = ?').all(targetType, targetId) as Record<string, unknown>[];
    return rows.map(r => this.deserializeFlag(r));
  }

  async getFlagByUser(targetType: string, targetId: string, flaggedBy: string): Promise<FlagRecord | null> {
    const row = this.db.prepare('SELECT * FROM flags WHERE targetType = ? AND targetId = ? AND flaggedBy = ?').get(targetType, targetId, flaggedBy) as Record<string, unknown> | undefined;
    return row ? this.deserializeFlag(row) : null;
  }

  async getFlagSummary(targetType: string, targetId: string): Promise<FlagSummary | null> {
    const rows = this.db.prepare('SELECT * FROM flags WHERE targetType = ? AND targetId = ?').all(targetType, targetId) as Record<string, unknown>[];
    if (rows.length === 0) return null;

    const byReason: Record<string, number> = {};
    let latestFlag = '';
    for (const r of rows) {
      const reason = r.reason as string;
      byReason[reason] = (byReason[reason] ?? 0) + 1;
      if ((r.createdAt as string) > latestFlag) latestFlag = r.createdAt as string;
    }

    return {
      targetType,
      targetId,
      totalFlags: rows.length,
      byReason,
      latestFlag,
    };
  }

  async updateFlag(id: string, updates: Partial<FlagRecord>): Promise<FlagRecord | null> {
    const existing = await this.getFlag(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE flags SET targetType = ?, targetId = ?, flaggedBy = ?, reason = ?,
       description = ?, status = ?, reviewedBy = ?, reviewedAt = ?, createdAt = ? WHERE id = ?`
    ).run(
      updated.targetType, updated.targetId, updated.flaggedBy, updated.reason,
      updated.description ?? null, updated.status,
      updated.reviewedBy ?? null, updated.reviewedAt ?? null, updated.createdAt, id,
    );
    return updated;
  }

  async listFlags(opts?: { status?: string; targetType?: string; page?: number; perPage?: number }): Promise<FlagRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    let sql = 'SELECT * FROM flags WHERE 1=1';
    const params: unknown[] = [];

    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    if (opts?.targetType) { sql += ' AND targetType = ?'; params.push(opts.targetType); }

    sql += ' ORDER BY createdAt DESC';
    sql += ' LIMIT ? OFFSET ?';
    params.push(perPage, (page - 1) * perPage);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeFlag(r));
  }

  private deserializeFlag(row: Record<string, unknown>): FlagRecord {
    const record: FlagRecord = {
      id: row.id as string,
      targetType: row.targetType as FlagRecord['targetType'],
      targetId: row.targetId as string,
      flaggedBy: row.flaggedBy as string,
      reason: row.reason as FlagRecord['reason'],
      status: row.status as FlagRecord['status'],
      createdAt: row.createdAt as string,
    };
    if (row.description) record.description = row.description as string;
    if (row.reviewedBy) record.reviewedBy = row.reviewedBy as string;
    if (row.reviewedAt) record.reviewedAt = row.reviewedAt as string;
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Matches ──
  // ══════════════════════════════════════════════════════════

  async createMatch(record: MatchRecord): Promise<MatchRecord> {
    this.db.prepare(
      `INSERT INTO matches (id, profileA, profileB, score, breakdown, status, notifiedAt, respondedAt, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.profileA, record.profileB, record.score,
      JSON.stringify(record.breakdown), record.status,
      record.notifiedAt, record.respondedAt,
      record.expiresAt, record.createdAt,
    );
    return record;
  }

  async getMatch(id: string): Promise<MatchRecord | null> {
    const row = this.db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeMatch(row) : null;
  }

  async getMatchByPair(profileA: string, profileB: string): Promise<MatchRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM matches WHERE (profileA = ? AND profileB = ?) OR (profileA = ? AND profileB = ?)'
    ).get(profileA, profileB, profileB, profileA) as Record<string, unknown> | undefined;
    return row ? this.deserializeMatch(row) : null;
  }

  async listMatchesByProfile(profile: string, opts?: { status?: string; page?: number; perPage?: number }): Promise<MatchRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 10;
    let sql = 'SELECT * FROM matches WHERE (profileA = ? OR profileB = ?)';
    const params: unknown[] = [profile, profile];

    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }

    sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(perPage, (page - 1) * perPage);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMatch(r));
  }

  async updateMatch(id: string, updates: Partial<MatchRecord>): Promise<MatchRecord | null> {
    const existing = await this.getMatch(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE matches SET profileA = ?, profileB = ?, score = ?, breakdown = ?,
       status = ?, notifiedAt = ?, respondedAt = ?, expiresAt = ?, createdAt = ? WHERE id = ?`
    ).run(
      updated.profileA, updated.profileB, updated.score,
      JSON.stringify(updated.breakdown), updated.status,
      updated.notifiedAt, updated.respondedAt,
      updated.expiresAt, updated.createdAt, id,
    );
    return updated;
  }

  async deleteExpiredMatches(): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      `DELETE FROM matches WHERE expiresAt < ? AND status != 'accepted'`
    ).run(now);
    return result.changes;
  }

  async deleteMatchesByProfile(profile: string): Promise<number> {
    const result = this.db.prepare(
      `DELETE FROM matches WHERE profileA = ? OR profileB = ?`
    ).run(profile, profile);
    return result.changes;
  }

  async listAllMatches(limit = 10000): Promise<MatchRecord[]> {
    const rows = this.db.prepare('SELECT * FROM matches ORDER BY createdAt DESC LIMIT ?').all(Math.min(limit, 10000)) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMatch(r));
  }

  private deserializeMatch(row: Record<string, unknown>): MatchRecord {
    return {
      id: row.id as string,
      profileA: row.profileA as string,
      profileB: row.profileB as string,
      score: row.score as number,
      breakdown: JSON.parse(row.breakdown as string),
      status: row.status as MatchRecord['status'],
      notifiedAt: (row.notifiedAt as string) ?? null,
      respondedAt: (row.respondedAt as string) ?? null,
      expiresAt: row.expiresAt as string,
      createdAt: row.createdAt as string,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Organisms ──
  // ══════════════════════════════════════════════════════════

  async createOrganism(record: OrganismRecord): Promise<OrganismRecord> {
    this.db.prepare(
      `INSERT INTO organisms (id, name, description, type, location, interests, creatorGhii, admins,
       members, agentGaiis, boardId, joinPolicy, maxMembers, visibility, moderationConfig,
       memoryNamespace, semantic, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.name, record.description, record.type,
      record.location ? JSON.stringify(record.location) : null,
      JSON.stringify(record.interests), record.creatorGhii,
      JSON.stringify(record.admins), JSON.stringify(record.members),
      JSON.stringify(record.agentGaiis), record.boardId,
      record.joinPolicy, record.maxMembers, record.visibility,
      JSON.stringify(record.moderationConfig), record.memoryNamespace,
      record.semantic ? JSON.stringify(record.semantic) : null,
      record.createdAt, record.updatedAt,
    );
    return record;
  }

  async getOrganism(id: string): Promise<OrganismRecord | null> {
    const row = this.db.prepare('SELECT * FROM organisms WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeOrganism(row) : null;
  }

  async listOrganisms(opts?: { type?: string; city?: string; interest?: string; visibility?: string; member?: string; page?: number; perPage?: number }): Promise<OrganismRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;

    const rows = this.db.prepare('SELECT * FROM organisms ORDER BY createdAt DESC').all() as Record<string, unknown>[];
    let results = rows.map(r => this.deserializeOrganism(r));

    if (opts?.type) results = results.filter(o => o.type === opts.type);
    if (opts?.city) results = results.filter(o => o.location?.city?.toLowerCase() === opts.city!.toLowerCase());
    if (opts?.interest) results = results.filter(o => o.interests.some(i => i.toLowerCase() === opts.interest!.toLowerCase()));
    if (opts?.member) results = results.filter(o => o.members.includes(opts.member!));
    if (opts?.visibility) results = results.filter(o => o.visibility === opts.visibility);

    const start = (page - 1) * perPage;
    return results.slice(start, start + perPage);
  }

  async updateOrganism(id: string, updates: Partial<OrganismRecord>): Promise<OrganismRecord | null> {
    const existing = await this.getOrganism(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE organisms SET name = ?, description = ?, type = ?, location = ?, interests = ?,
       creatorGhii = ?, admins = ?, members = ?, agentGaiis = ?, boardId = ?,
       joinPolicy = ?, maxMembers = ?, visibility = ?, moderationConfig = ?,
       memoryNamespace = ?, semantic = ?, createdAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      updated.name, updated.description, updated.type,
      updated.location ? JSON.stringify(updated.location) : null,
      JSON.stringify(updated.interests), updated.creatorGhii,
      JSON.stringify(updated.admins), JSON.stringify(updated.members),
      JSON.stringify(updated.agentGaiis), updated.boardId,
      updated.joinPolicy, updated.maxMembers, updated.visibility,
      JSON.stringify(updated.moderationConfig), updated.memoryNamespace,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      updated.createdAt, updated.updatedAt, id,
    );
    return updated;
  }

  async deleteOrganism(id: string): Promise<boolean> {
    const txn = this.db.transaction(() => {
      // Get the organism to find its boardId and memoryNamespace
      const org = this.db.prepare('SELECT boardId, memoryNamespace FROM organisms WHERE id = ?').get(id) as { boardId: string; memoryNamespace: string } | undefined;

      // Cascade: delete memberships and join requests
      this.db.prepare('DELETE FROM organism_memberships WHERE organismId = ?').run(id);
      this.db.prepare('DELETE FROM join_requests WHERE organismId = ?').run(id);

      // Cascade: delete organism reputation
      this.db.prepare('DELETE FROM organism_reputations WHERE organismId = ?').run(id);

      if (org) {
        // Cascade: delete the organism's board and its posts/subscriptions
        this.db.prepare('DELETE FROM board_posts WHERE boardId = ?').run(org.boardId);
        this.db.prepare('DELETE FROM board_subscriptions WHERE boardId = ?').run(org.boardId);
        this.db.prepare('DELETE FROM boards WHERE id = ?').run(org.boardId);

        // Cascade: delete ALL content under the organism's key namespace, across every owner. The
        // workspace records/documents/meta are keyed `organism.{id}.…` but OWNED by the member who
        // wrote them (creator GHII, a contributor's GAII), NOT by `memoryNamespace` — so a
        // delete-by-ownerGaii left them orphaned (and still searchable via the FTS index). Delete by
        // key prefix instead; the memory_fts AFTER DELETE trigger clears the search index in step.
        const orgKey = `organism.${id}`;
        const orgPrefix = `organism.${id}.%`;
        this.db.prepare('DELETE FROM memory WHERE key = ? OR key LIKE ?').run(orgKey, orgPrefix);
        this.db.prepare('DELETE FROM memory_history WHERE key = ? OR key LIKE ?').run(orgKey, orgPrefix);
        this.db.prepare('DELETE FROM schemas WHERE keyPattern = ? OR keyPattern LIKE ?').run(orgKey, orgPrefix);
      }

      const result = this.db.prepare('DELETE FROM organisms WHERE id = ?').run(id);
      return result.changes > 0;
    });
    return txn();
  }

  private deserializeOrganism(row: Record<string, unknown>): OrganismRecord {
    const record: OrganismRecord = {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      type: row.type as OrganismRecord['type'],
      interests: JSON.parse(row.interests as string) as string[],
      creatorGhii: row.creatorGhii as string,
      admins: JSON.parse(row.admins as string) as string[],
      members: JSON.parse(row.members as string) as string[],
      agentGaiis: JSON.parse(row.agentGaiis as string) as string[],
      boardId: row.boardId as string,
      joinPolicy: row.joinPolicy as OrganismRecord['joinPolicy'],
      maxMembers: row.maxMembers as number,
      visibility: row.visibility as OrganismRecord['visibility'],
      moderationConfig: JSON.parse(row.moderationConfig as string),
      memoryNamespace: row.memoryNamespace as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.location) record.location = JSON.parse(row.location as string);
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Memberships ──
  // ══════════════════════════════════════════════════════════

  async createMembership(record: OrganismMembershipRecord): Promise<OrganismMembershipRecord> {
    this.db.prepare(
      `INSERT INTO organism_memberships (id, organismId, ghii, role, status, joinedAt, invitedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.organismId, record.ghii, record.role,
      record.status, record.joinedAt, record.invitedBy ?? null,
    );
    return record;
  }

  async getMembership(organismId: string, ghii: string): Promise<OrganismMembershipRecord | null> {
    const row = this.db.prepare('SELECT * FROM organism_memberships WHERE organismId = ? AND ghii = ?').get(organismId, ghii) as Record<string, unknown> | undefined;
    return row ? this.deserializeMembership(row) : null;
  }

  async listMembers(organismId: string, opts?: { role?: string; status?: string }): Promise<OrganismMembershipRecord[]> {
    let sql = 'SELECT * FROM organism_memberships WHERE organismId = ?';
    const params: unknown[] = [organismId];
    if (opts?.role) { sql += ' AND role = ?'; params.push(opts.role); }
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMembership(r));
  }

  async listMembershipsByGhii(ghii: string): Promise<OrganismMembershipRecord[]> {
    const rows = this.db.prepare('SELECT * FROM organism_memberships WHERE ghii = ?').all(ghii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeMembership(r));
  }

  async updateMembership(id: string, updates: Partial<OrganismMembershipRecord>): Promise<OrganismMembershipRecord | null> {
    const row = this.db.prepare('SELECT * FROM organism_memberships WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const existing = this.deserializeMembership(row);
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE organism_memberships SET organismId = ?, ghii = ?, role = ?, status = ?, joinedAt = ?, invitedBy = ? WHERE id = ?`
    ).run(
      updated.organismId, updated.ghii, updated.role, updated.status,
      updated.joinedAt, updated.invitedBy ?? null, id,
    );
    return updated;
  }

  async deleteMembership(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM organism_memberships WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private deserializeMembership(row: Record<string, unknown>): OrganismMembershipRecord {
    const record: OrganismMembershipRecord = {
      id: row.id as string,
      organismId: row.organismId as string,
      ghii: row.ghii as string,
      role: row.role as OrganismMembershipRecord['role'],
      status: row.status as OrganismMembershipRecord['status'],
      joinedAt: row.joinedAt as string,
    };
    if (row.invitedBy) record.invitedBy = row.invitedBy as string;
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Join Requests ──
  // ══════════════════════════════════════════════════════════

  async createJoinRequest(record: JoinRequestRecord): Promise<JoinRequestRecord> {
    this.db.prepare(
      `INSERT INTO join_requests (id, organismId, ghii, message, status, reviewedBy, createdAt, reviewedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.organismId, record.ghii, record.message ?? null,
      record.status, record.reviewedBy ?? null, record.createdAt, record.reviewedAt ?? null,
    );
    return record;
  }

  async getJoinRequest(id: string): Promise<JoinRequestRecord | null> {
    const row = this.db.prepare('SELECT * FROM join_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeJoinRequest(row) : null;
  }

  async listJoinRequests(organismId: string, opts?: { status?: string }): Promise<JoinRequestRecord[]> {
    let sql = 'SELECT * FROM join_requests WHERE organismId = ?';
    const params: unknown[] = [organismId];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeJoinRequest(r));
  }

  async updateJoinRequest(id: string, updates: Partial<JoinRequestRecord>): Promise<JoinRequestRecord | null> {
    const existing = await this.getJoinRequest(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE join_requests SET organismId = ?, ghii = ?, message = ?, status = ?,
       reviewedBy = ?, createdAt = ?, reviewedAt = ? WHERE id = ?`
    ).run(
      updated.organismId, updated.ghii, updated.message ?? null,
      updated.status, updated.reviewedBy ?? null,
      updated.createdAt, updated.reviewedAt ?? null, id,
    );
    return updated;
  }

  private deserializeJoinRequest(row: Record<string, unknown>): JoinRequestRecord {
    const record: JoinRequestRecord = {
      id: row.id as string,
      organismId: row.organismId as string,
      ghii: row.ghii as string,
      status: row.status as JoinRequestRecord['status'],
      createdAt: row.createdAt as string,
    };
    if (row.message) record.message = row.message as string;
    if (row.reviewedBy) record.reviewedBy = row.reviewedBy as string;
    if (row.reviewedAt) record.reviewedAt = row.reviewedAt as string;
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Pending Approvals (Phase 4 — Gate primitive) ──
  // ══════════════════════════════════════════════════════════

  async createPendingApproval(record: PendingApprovalRecord): Promise<PendingApprovalRecord> {
    this.db.prepare(
      `INSERT INTO pending_approvals (id, organismId, flowGateId, stageId, actor, action, arguments,
         risk, approverRole, prompt, status, decidedBy, decidedAt, resolutionNote, deadline, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.organismId, record.flowGateId ?? null, record.stageId ?? null,
      record.actor, record.action, record.arguments !== undefined ? JSON.stringify(record.arguments) : null,
      record.risk, record.approverRole, record.prompt ?? null, record.status,
      record.decidedBy ?? null, record.decidedAt ?? null, record.resolutionNote ?? null,
      record.deadline ?? null, record.createdAt, record.updatedAt,
    );
    return record;
  }

  async getPendingApproval(id: string): Promise<PendingApprovalRecord | null> {
    const row = this.db.prepare('SELECT * FROM pending_approvals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializePendingApproval(row) : null;
  }

  async listPendingApprovals(organismId: string, opts?: { status?: string }): Promise<PendingApprovalRecord[]> {
    let sql = 'SELECT * FROM pending_approvals WHERE organismId = ?';
    const params: unknown[] = [organismId];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    sql += ' ORDER BY createdAt DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializePendingApproval(r));
  }

  async updatePendingApproval(id: string, updates: Partial<PendingApprovalRecord>): Promise<PendingApprovalRecord | null> {
    const existing = await this.getPendingApproval(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE pending_approvals SET organismId = ?, flowGateId = ?, stageId = ?, actor = ?, action = ?,
         arguments = ?, risk = ?, approverRole = ?, prompt = ?, status = ?, decidedBy = ?, decidedAt = ?,
         resolutionNote = ?, deadline = ?, createdAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      updated.organismId, updated.flowGateId ?? null, updated.stageId ?? null, updated.actor, updated.action,
      updated.arguments !== undefined ? JSON.stringify(updated.arguments) : null, updated.risk, updated.approverRole,
      updated.prompt ?? null, updated.status, updated.decidedBy ?? null, updated.decidedAt ?? null,
      updated.resolutionNote ?? null, updated.deadline ?? null, updated.createdAt, updated.updatedAt, id,
    );
    return updated;
  }

  async listOverduePendingApprovals(nowIso: string): Promise<PendingApprovalRecord[]> {
    const rows = this.db.prepare(
      `SELECT * FROM pending_approvals WHERE status = 'pending' AND deadline IS NOT NULL AND deadline < ?`
    ).all(nowIso) as Record<string, unknown>[];
    return rows.map(r => this.deserializePendingApproval(r));
  }

  private deserializePendingApproval(row: Record<string, unknown>): PendingApprovalRecord {
    const record: PendingApprovalRecord = {
      id: row.id as string,
      organismId: row.organismId as string,
      actor: row.actor as string,
      action: row.action as string,
      risk: row.risk as PendingApprovalRecord['risk'],
      approverRole: row.approverRole as PendingApprovalRecord['approverRole'],
      status: row.status as PendingApprovalRecord['status'],
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.flowGateId) record.flowGateId = row.flowGateId as string;
    if (row.stageId) record.stageId = row.stageId as string;
    if (row.arguments) record.arguments = JSON.parse(row.arguments as string);
    if (row.prompt) record.prompt = row.prompt as string;
    if (row.decidedBy) record.decidedBy = row.decidedBy as string;
    if (row.decidedAt) record.decidedAt = row.decidedAt as string;
    if (row.resolutionNote) record.resolutionNote = row.resolutionNote as string;
    if (row.deadline) record.deadline = row.deadline as string;
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Appeals ──
  // ══════════════════════════════════════════════════════════

  async createAppeal(record: AppealRecord): Promise<AppealRecord> {
    this.db.prepare(
      `INSERT INTO appeals (id, flagId, appealedBy, reason, status, reviewedBy, reviewNote, createdAt, reviewedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.flagId, record.appealedBy, record.reason,
      record.status, record.reviewedBy ?? null,
      record.reviewNote ?? null, record.createdAt, record.reviewedAt ?? null,
    );
    return record;
  }

  async getAppeal(id: string): Promise<AppealRecord | null> {
    const row = this.db.prepare('SELECT * FROM appeals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppeal(row) : null;
  }

  async getAppealByFlagId(flagId: string): Promise<AppealRecord | null> {
    const row = this.db.prepare('SELECT * FROM appeals WHERE flagId = ?').get(flagId) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppeal(row) : null;
  }

  async listAppeals(opts?: { status?: string; page?: number; perPage?: number }): Promise<AppealRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    let sql = 'SELECT * FROM appeals WHERE 1=1';
    const params: unknown[] = [];

    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }

    sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(perPage, (page - 1) * perPage);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAppeal(r));
  }

  async updateAppeal(id: string, updates: Partial<AppealRecord>): Promise<AppealRecord | null> {
    const existing = await this.getAppeal(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE appeals SET flagId = ?, appealedBy = ?, reason = ?, status = ?,
       reviewedBy = ?, reviewNote = ?, createdAt = ?, reviewedAt = ? WHERE id = ?`
    ).run(
      updated.flagId, updated.appealedBy, updated.reason, updated.status,
      updated.reviewedBy ?? null, updated.reviewNote ?? null,
      updated.createdAt, updated.reviewedAt ?? null, id,
    );
    return updated;
  }

  private deserializeAppeal(row: Record<string, unknown>): AppealRecord {
    const record: AppealRecord = {
      id: row.id as string,
      flagId: row.flagId as string,
      appealedBy: row.appealedBy as string,
      reason: row.reason as string,
      status: row.status as AppealRecord['status'],
      createdAt: row.createdAt as string,
    };
    if (row.reviewedBy) record.reviewedBy = row.reviewedBy as string;
    if (row.reviewNote) record.reviewNote = row.reviewNote as string;
    if (row.reviewedAt) record.reviewedAt = row.reviewedAt as string;
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Marketplace ──
  // ══════════════════════════════════════════════════════════

  async createListing(record: ListingRecord): Promise<ListingRecord> {
    this.db.prepare(
      `INSERT INTO listings (id, ownerName, sellerGhii, title, description, category, priceMorsels,
       condition, availability, location, tags, images, status, memoryKey, flagCount, createdAt, updatedAt, semantic)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.ownerName, record.sellerGhii, record.title, record.description,
      record.category, record.priceMorsels,
      record.condition ?? null, record.availability ?? null,
      record.location ? JSON.stringify(record.location) : null,
      record.tags ? JSON.stringify(record.tags) : null,
      record.images ? JSON.stringify(record.images) : null,
      record.status, record.memoryKey, record.flagCount,
      record.createdAt, record.updatedAt,
      record.semantic ? JSON.stringify(record.semantic) : null,
    );
    return record;
  }

  async getListing(id: string): Promise<ListingRecord | null> {
    const row = this.db.prepare('SELECT * FROM listings WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeListing(row) : null;
  }

  async listListings(opts?: { category?: string; city?: string; minPrice?: number; maxPrice?: number; status?: string; sellerOwner?: string; page?: number; perPage?: number }): Promise<ListingRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;

    const rows = this.db.prepare('SELECT * FROM listings ORDER BY createdAt DESC').all() as Record<string, unknown>[];
    let results = rows.map(r => this.deserializeListing(r));

    if (opts?.category) results = results.filter(l => l.category === opts.category);
    if (opts?.city) results = results.filter(l => l.location?.city?.toLowerCase() === opts.city!.toLowerCase());
    if (opts?.minPrice !== undefined) results = results.filter(l => l.priceMorsels >= opts.minPrice!);
    if (opts?.maxPrice !== undefined) results = results.filter(l => l.priceMorsels <= opts.maxPrice!);
    if (opts?.status) results = results.filter(l => l.status === opts.status);
    if (opts?.sellerOwner) results = results.filter(l => l.ownerName === opts.sellerOwner);

    const start = (page - 1) * perPage;
    return results.slice(start, start + perPage);
  }

  async updateListing(id: string, updates: Partial<ListingRecord>): Promise<ListingRecord | null> {
    const existing = await this.getListing(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE listings SET ownerName = ?, sellerGhii = ?, title = ?, description = ?,
       category = ?, priceMorsels = ?, condition = ?, availability = ?, location = ?,
       tags = ?, images = ?, status = ?, memoryKey = ?, flagCount = ?,
       createdAt = ?, updatedAt = ?, semantic = ? WHERE id = ?`
    ).run(
      updated.ownerName, updated.sellerGhii, updated.title, updated.description,
      updated.category, updated.priceMorsels,
      updated.condition ?? null, updated.availability ?? null,
      updated.location ? JSON.stringify(updated.location) : null,
      updated.tags ? JSON.stringify(updated.tags) : null,
      updated.images ? JSON.stringify(updated.images) : null,
      updated.status, updated.memoryKey, updated.flagCount,
      updated.createdAt, updated.updatedAt,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      id,
    );
    return updated;
  }

  async deleteListing(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM listings WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async createPurchase(record: PurchaseRecord): Promise<PurchaseRecord> {
    this.db.prepare(
      `INSERT INTO purchases (id, listingId, buyerOwner, sellerOwner, priceMorsels,
       transactionFeeMorsels, totalCostMorsels, status, rating, trackingCode, createdAt, completedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.listingId, record.buyerOwner, record.sellerOwner,
      record.priceMorsels, record.transactionFeeMorsels, record.totalCostMorsels,
      record.status, record.rating ? JSON.stringify(record.rating) : null,
      record.trackingCode, record.createdAt, record.completedAt ?? null,
    );
    return record;
  }

  async getPurchase(id: string): Promise<PurchaseRecord | null> {
    const row = this.db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializePurchase(row) : null;
  }

  async listPurchasesByBuyer(buyerOwner: string): Promise<PurchaseRecord[]> {
    const rows = this.db.prepare('SELECT * FROM purchases WHERE buyerOwner = ? ORDER BY createdAt DESC').all(buyerOwner) as Record<string, unknown>[];
    return rows.map(r => this.deserializePurchase(r));
  }

  async listPurchasesBySeller(sellerOwner: string): Promise<PurchaseRecord[]> {
    const rows = this.db.prepare('SELECT * FROM purchases WHERE sellerOwner = ? ORDER BY createdAt DESC').all(sellerOwner) as Record<string, unknown>[];
    return rows.map(r => this.deserializePurchase(r));
  }

  async updatePurchase(id: string, updates: Partial<PurchaseRecord>): Promise<PurchaseRecord | null> {
    const existing = await this.getPurchase(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.db.prepare(
      `UPDATE purchases SET listingId = ?, buyerOwner = ?, sellerOwner = ?, priceMorsels = ?,
       transactionFeeMorsels = ?, totalCostMorsels = ?, status = ?, rating = ?,
       trackingCode = ?, createdAt = ?, completedAt = ? WHERE id = ?`
    ).run(
      updated.listingId, updated.buyerOwner, updated.sellerOwner,
      updated.priceMorsels, updated.transactionFeeMorsels, updated.totalCostMorsels,
      updated.status, updated.rating ? JSON.stringify(updated.rating) : null,
      updated.trackingCode, updated.createdAt, updated.completedAt ?? null, id,
    );
    return updated;
  }

  private deserializeListing(row: Record<string, unknown>): ListingRecord {
    const record: ListingRecord = {
      id: row.id as string,
      ownerName: row.ownerName as string,
      sellerGhii: row.sellerGhii as string,
      title: row.title as string,
      description: row.description as string,
      category: row.category as ListingRecord['category'],
      priceMorsels: row.priceMorsels as number,
      status: row.status as ListingRecord['status'],
      memoryKey: row.memoryKey as string,
      flagCount: row.flagCount as number,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.condition) record.condition = row.condition as ListingRecord['condition'];
    if (row.availability) record.availability = row.availability as ListingRecord['availability'];
    if (row.location) record.location = JSON.parse(row.location as string);
    if (row.tags) record.tags = JSON.parse(row.tags as string);
    if (row.images) record.images = JSON.parse(row.images as string);
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    return record;
  }

  private deserializePurchase(row: Record<string, unknown>): PurchaseRecord {
    const record: PurchaseRecord = {
      id: row.id as string,
      listingId: row.listingId as string,
      buyerOwner: row.buyerOwner as string,
      sellerOwner: row.sellerOwner as string,
      priceMorsels: row.priceMorsels as number,
      transactionFeeMorsels: row.transactionFeeMorsels as number,
      totalCostMorsels: row.totalCostMorsels as number,
      status: row.status as PurchaseRecord['status'],
      trackingCode: row.trackingCode as string,
      createdAt: row.createdAt as string,
    };
    if (row.rating) record.rating = JSON.parse(row.rating as string);
    if (row.completedAt) record.completedAt = row.completedAt as string;
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Push Subscriptions ──
  // ══════════════════════════════════════════════════════════

  async createPushSubscription(record: PushSubscriptionRecord): Promise<PushSubscriptionRecord> {
    this.db.prepare(
      `INSERT OR REPLACE INTO push_subscriptions (ownerName, endpoint, keys, createdAt, lastUsedAt)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      record.ownerName, record.endpoint,
      JSON.stringify(record.keys), record.createdAt, record.lastUsedAt,
    );
    return record;
  }

  async getPushSubscription(ownerName: string): Promise<PushSubscriptionRecord | null> {
    const row = this.db.prepare('SELECT * FROM push_subscriptions WHERE ownerName = ?').get(ownerName) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      ownerName: row.ownerName as string,
      endpoint: row.endpoint as string,
      keys: JSON.parse(row.keys as string),
      createdAt: row.createdAt as string,
      lastUsedAt: row.lastUsedAt as string,
    };
  }

  async deletePushSubscription(ownerName: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM push_subscriptions WHERE ownerName = ?').run(ownerName);
    return result.changes > 0;
  }

  async listPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM push_subscriptions').all() as Record<string, unknown>[];
    return rows.map(r => ({
      ownerName: r.ownerName as string,
      endpoint: r.endpoint as string,
      keys: JSON.parse(r.keys as string),
      createdAt: r.createdAt as string,
      lastUsedAt: r.lastUsedAt as string,
    }));
  }

  // ══════════════════════════════════════════════════════════
  // ── Trusted Issuers ──
  // ══════════════════════════════════════════════════════════

  async createTrustedIssuer(record: TrustedIssuerRecord): Promise<TrustedIssuerRecord> {
    this.db.prepare(
      `INSERT INTO trusted_issuers (id, name, url, publicKey, type, trusted, addedBy, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.name, record.url, record.publicKey,
      record.type, record.trusted ? 1 : 0, record.addedBy, record.createdAt,
    );
    return record;
  }

  async getTrustedIssuer(id: string): Promise<TrustedIssuerRecord | null> {
    const row = this.db.prepare('SELECT * FROM trusted_issuers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeTrustedIssuer(row) : null;
  }

  async getTrustedIssuerByUrl(url: string): Promise<TrustedIssuerRecord | null> {
    const row = this.db.prepare('SELECT * FROM trusted_issuers WHERE url = ?').get(url) as Record<string, unknown> | undefined;
    return row ? this.deserializeTrustedIssuer(row) : null;
  }

  async listTrustedIssuers(opts?: { type?: string }): Promise<TrustedIssuerRecord[]> {
    let sql = 'SELECT * FROM trusted_issuers';
    const params: unknown[] = [];
    if (opts?.type) { sql += ' WHERE type = ?'; params.push(opts.type); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeTrustedIssuer(r));
  }

  async deleteTrustedIssuer(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM trusted_issuers WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private deserializeTrustedIssuer(row: Record<string, unknown>): TrustedIssuerRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      url: row.url as string,
      publicKey: row.publicKey as string,
      type: row.type as TrustedIssuerRecord['type'],
      trusted: (row.trusted as number) === 1,
      addedBy: row.addedBy as string,
      createdAt: row.createdAt as string,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Verification Nonces ──
  // ══════════════════════════════════════════════════════════

  async createVerificationNonce(record: VerificationNonceRecord): Promise<VerificationNonceRecord> {
    this.db.prepare(
      'INSERT INTO verification_nonces (id, owner, type, state, nonce, redirectUri, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(record.id, record.owner, record.type, record.state, record.nonce, record.redirectUri ?? '', record.createdAt, record.expiresAt);
    return record;
  }

  async getVerificationNonce(state: string): Promise<VerificationNonceRecord | null> {
    const row = this.db.prepare('SELECT * FROM verification_nonces WHERE state = ?').get(state) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      owner: row.owner as string,
      type: row.type as 'eudiw' | 'ftn' | 'google_login',
      state: row.state as string,
      nonce: row.nonce as string,
      redirectUri: row.redirectUri as string,
      createdAt: row.createdAt as string,
      expiresAt: row.expiresAt as string,
    };
  }

  async deleteVerificationNonce(state: string): Promise<void> {
    this.db.prepare('DELETE FROM verification_nonces WHERE state = ?').run(state);
  }

  async cleanExpiredNonces(): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db.prepare('DELETE FROM verification_nonces WHERE expiresAt < ?').run(now);
    return result.changes;
  }

  // ══════════════════════════════════════════════════════════
  // ── Genesis Peers ──
  // ══════════════════════════════════════════════════════════

  async createGenesisPeer(record: GenesisPeerRecord): Promise<GenesisPeerRecord> {
    this.db.prepare(
      `INSERT INTO genesis_peers (id, genesisNodeId, genesisUrl, publicKey, status, lastSyncAt, catalogueHash, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.genesisNodeId, record.genesisUrl, record.publicKey,
      record.status, record.lastSyncAt, record.catalogueHash,
      record.createdAt, record.updatedAt,
    );
    return record;
  }

  async getGenesisPeer(id: string): Promise<GenesisPeerRecord | null> {
    const row = this.db.prepare('SELECT * FROM genesis_peers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeGenesisPeer(row) : null;
  }

  async getGenesisPeerByNodeId(nodeId: string): Promise<GenesisPeerRecord | null> {
    const row = this.db.prepare('SELECT * FROM genesis_peers WHERE genesisNodeId = ?').get(nodeId) as Record<string, unknown> | undefined;
    return row ? this.deserializeGenesisPeer(row) : null;
  }

  async listGenesisPeers(opts?: { status?: string }): Promise<GenesisPeerRecord[]> {
    let sql = 'SELECT * FROM genesis_peers';
    const params: unknown[] = [];
    if (opts?.status) { sql += ' WHERE status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeGenesisPeer(r));
  }

  async updateGenesisPeer(id: string, updates: Partial<GenesisPeerRecord>): Promise<GenesisPeerRecord | null> {
    const existing = await this.getGenesisPeer(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE genesis_peers SET genesisNodeId = ?, genesisUrl = ?, publicKey = ?, status = ?,
       lastSyncAt = ?, catalogueHash = ?, createdAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      updated.genesisNodeId, updated.genesisUrl, updated.publicKey, updated.status,
      updated.lastSyncAt, updated.catalogueHash, updated.createdAt, updated.updatedAt, id,
    );
    return updated;
  }

  async deleteGenesisPeer(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM genesis_peers WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private deserializeGenesisPeer(row: Record<string, unknown>): GenesisPeerRecord {
    return {
      id: row.id as string,
      genesisNodeId: row.genesisNodeId as string,
      genesisUrl: row.genesisUrl as string,
      publicKey: row.publicKey as string,
      status: row.status as GenesisPeerRecord['status'],
      lastSyncAt: row.lastSyncAt as string,
      catalogueHash: row.catalogueHash as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Organism Reputation ──
  // ══════════════════════════════════════════════════════════

  async setOrganismReputation(record: OrganismReputationRecord): Promise<OrganismReputationRecord> {
    this.db.prepare(
      `INSERT OR REPLACE INTO organism_reputations (organismId, score, breakdown, calculatedAt)
       VALUES (?, ?, ?, ?)`
    ).run(
      record.organismId, record.score,
      JSON.stringify(record.breakdown), record.calculatedAt,
    );
    return record;
  }

  async getOrganismReputation(organismId: string): Promise<OrganismReputationRecord | null> {
    const row = this.db.prepare('SELECT * FROM organism_reputations WHERE organismId = ?').get(organismId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      organismId: row.organismId as string,
      score: row.score as number,
      breakdown: JSON.parse(row.breakdown as string),
      calculatedAt: row.calculatedAt as string,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Realtime Rooms ──
  // ══════════════════════════════════════════════════════════

  async createRealtimeRoom(room: RealtimeRoomRecord): Promise<RealtimeRoomRecord> {
    this.db.prepare(
      `INSERT INTO realtime_rooms (id, appType, name, createdBy, maxPeers, isPublic, tags, peerCount, createdAt, lastActivityAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      room.id, room.appType, room.name, room.createdBy,
      room.maxPeers, room.isPublic ? 1 : 0,
      JSON.stringify(room.tags), room.peerCount,
      room.createdAt, room.lastActivityAt,
    );
    return room;
  }

  async getRealtimeRoom(id: string): Promise<RealtimeRoomRecord | null> {
    const row = this.db.prepare('SELECT * FROM realtime_rooms WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeRealtimeRoom(row) : null;
  }

  async listRealtimeRooms(filter?: { appType?: string; isPublic?: boolean }): Promise<RealtimeRoomRecord[]> {
    let sql = 'SELECT * FROM realtime_rooms WHERE 1=1';
    const params: unknown[] = [];
    if (filter?.appType) { sql += ' AND appType = ?'; params.push(filter.appType); }
    if (filter?.isPublic !== undefined) { sql += ' AND isPublic = ?'; params.push(filter.isPublic ? 1 : 0); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeRealtimeRoom(r));
  }

  async updateRealtimeRoom(id: string, updates: Partial<RealtimeRoomRecord>): Promise<RealtimeRoomRecord | null> {
    const existing = await this.getRealtimeRoom(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE realtime_rooms SET appType = ?, name = ?, createdBy = ?, maxPeers = ?,
       isPublic = ?, tags = ?, peerCount = ?, createdAt = ?, lastActivityAt = ? WHERE id = ?`
    ).run(
      updated.appType, updated.name, updated.createdBy, updated.maxPeers,
      updated.isPublic ? 1 : 0, JSON.stringify(updated.tags),
      updated.peerCount, updated.createdAt, updated.lastActivityAt, id,
    );
    return updated;
  }

  async deleteRealtimeRoom(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM realtime_rooms WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private deserializeRealtimeRoom(row: Record<string, unknown>): RealtimeRoomRecord {
    return {
      id: row.id as string,
      appType: row.appType as string,
      name: row.name as string,
      createdBy: row.createdBy as string,
      maxPeers: row.maxPeers as number,
      isPublic: (row.isPublic as number) === 1,
      tags: JSON.parse(row.tags as string) as string[],
      peerCount: row.peerCount as number,
      createdAt: row.createdAt as string,
      lastActivityAt: row.lastActivityAt as string,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Site Change Log ──
  // ══════════════════════════════════════════════════════════

  async addSiteChangeLog(entry: SiteChangeLogEntry): Promise<SiteChangeLogEntry> {
    this.db.prepare(
      `INSERT INTO site_changelog (id, action, summary, changedBy, changedAt) VALUES (?, ?, ?, ?, ?)`
    ).run(entry.id, entry.action, entry.summary, entry.changedBy, entry.changedAt);

    // Keep at most 200 entries (delete oldest beyond 200)
    this.db.prepare(
      `DELETE FROM site_changelog WHERE id NOT IN (SELECT id FROM site_changelog ORDER BY changedAt DESC LIMIT 200)`
    ).run();

    return entry;
  }

  async listSiteChangeLog(limit: number, cursor?: string): Promise<SiteChangeLogEntry[]> {
    const sql = 'SELECT * FROM site_changelog ORDER BY changedAt DESC';
    const params: unknown[] = [];

    const allRows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    let entries = allRows.map(r => ({
      id: r.id as string,
      action: r.action as SiteChangeLogEntry['action'],
      summary: r.summary as string,
      changedBy: r.changedBy as string,
      changedAt: r.changedAt as string,
    }));

    if (cursor) {
      const idx = entries.findIndex(e => e.id === cursor);
      if (idx >= 0) entries = entries.slice(idx + 1);
    }
    return entries.slice(0, limit);
  }

  // ══════════════════════════════════════════════════════════
  // ── Extensions ──
  // ══════════════════════════════════════════════════════════

  async createExtension(record: ExtensionRecord): Promise<ExtensionRecord> {
    try {
      this.db.prepare(
        `INSERT INTO extensions (name, version, description, author, status, requiredApis,
         actions, config, limits, federation, instances, installedBy, installedAt, activatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.name, record.version, record.description, record.author,
        record.status, JSON.stringify(record.requiredApis),
        JSON.stringify(record.actions), JSON.stringify(record.config),
        JSON.stringify(record.limits), JSON.stringify(record.federation),
        record.instances ? JSON.stringify(record.instances) : null,
        record.installedBy, record.installedAt, record.activatedAt ?? null,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) {
        throw new Error(`Extension "${record.name}" already exists`, { cause: err });
      }
      throw err;
    }
  }

  async getExtension(name: string): Promise<ExtensionRecord | null> {
    const row = this.db.prepare('SELECT * FROM extensions WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeExtension(row) : null;
  }

  async listExtensions(opts?: { status?: string }): Promise<ExtensionRecord[]> {
    let sql = 'SELECT * FROM extensions';
    const params: unknown[] = [];
    if (opts?.status) { sql += ' WHERE status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeExtension(r));
  }

  async updateExtension(name: string, updates: Partial<ExtensionRecord>): Promise<ExtensionRecord | null> {
    const existing = await this.getExtension(name);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE extensions SET version = ?, description = ?, author = ?, status = ?,
       requiredApis = ?, actions = ?, config = ?, limits = ?, federation = ?,
       instances = ?, installedBy = ?, installedAt = ?, activatedAt = ? WHERE name = ?`
    ).run(
      updated.version, updated.description, updated.author, updated.status,
      JSON.stringify(updated.requiredApis), JSON.stringify(updated.actions),
      JSON.stringify(updated.config), JSON.stringify(updated.limits),
      JSON.stringify(updated.federation),
      updated.instances ? JSON.stringify(updated.instances) : null,
      updated.installedBy, updated.installedAt, updated.activatedAt ?? null, name,
    );
    return updated;
  }

  async deleteExtension(name: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM extensions WHERE name = ?').run(name);
    return result.changes > 0;
  }

  private deserializeExtension(row: Record<string, unknown>): ExtensionRecord {
    const record: ExtensionRecord = {
      name: row.name as string,
      version: row.version as string,
      description: row.description as string,
      author: row.author as string,
      status: row.status as ExtensionRecord['status'],
      requiredApis: JSON.parse(row.requiredApis as string),
      actions: JSON.parse(row.actions as string),
      config: JSON.parse(row.config as string),
      limits: JSON.parse(row.limits as string),
      federation: JSON.parse(row.federation as string),
      installedBy: row.installedBy as string,
      installedAt: row.installedAt as string,
    };
    if (row.activatedAt) record.activatedAt = row.activatedAt as string;
    if (row.instances) record.instances = JSON.parse(row.instances as string);
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Escrow Holds ──
  // ══════════════════════════════════════════════════════════

  async createEscrowHold(record: EscrowHoldRecord): Promise<EscrowHoldRecord> {
    this.db.prepare(
      `INSERT INTO escrow_holds (holdId, fromGaii, amount, reason, status, extensionName, createdAt, releasedAt, releasedTo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.holdId, record.fromGaii, record.amount, record.reason,
      record.status, record.extensionName, record.createdAt,
      record.releasedAt ?? null, record.releasedTo ?? null,
    );
    return record;
  }

  async getEscrowHold(holdId: string): Promise<EscrowHoldRecord | null> {
    const row = this.db.prepare('SELECT * FROM escrow_holds WHERE holdId = ?').get(holdId) as Record<string, unknown> | undefined;
    return row ? this.deserializeEscrowHold(row) : null;
  }

  async listEscrowHolds(fromGaii: string, opts?: { status?: string }): Promise<EscrowHoldRecord[]> {
    let sql = 'SELECT * FROM escrow_holds WHERE fromGaii = ?';
    const params: unknown[] = [fromGaii];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeEscrowHold(r));
  }

  async releaseEscrowHold(holdId: string, toGaii: string): Promise<EscrowHoldRecord | null> {
    const hold = await this.getEscrowHold(holdId);
    if (!hold) return null;
    if (hold.status !== 'held') return null;
    const updated: EscrowHoldRecord = {
      ...hold,
      status: 'released',
      releasedTo: toGaii,
      releasedAt: new Date().toISOString(),
    };
    this.db.prepare(
      'UPDATE escrow_holds SET status = ?, releasedTo = ?, releasedAt = ? WHERE holdId = ?'
    ).run(updated.status, updated.releasedTo, updated.releasedAt, holdId);
    return updated;
  }

  async refundEscrowHold(holdId: string): Promise<EscrowHoldRecord | null> {
    const hold = await this.getEscrowHold(holdId);
    if (!hold) return null;
    if (hold.status !== 'held') return null;
    const updated: EscrowHoldRecord = {
      ...hold,
      status: 'refunded',
      releasedAt: new Date().toISOString(),
    };
    this.db.prepare(
      'UPDATE escrow_holds SET status = ?, releasedAt = ? WHERE holdId = ?'
    ).run(updated.status, updated.releasedAt, holdId);
    return updated;
  }

  private deserializeEscrowHold(row: Record<string, unknown>): EscrowHoldRecord {
    const record: EscrowHoldRecord = {
      holdId: row.holdId as string,
      fromGaii: row.fromGaii as string,
      amount: row.amount as number,
      reason: row.reason as string,
      status: row.status as EscrowHoldRecord['status'],
      extensionName: row.extensionName as string,
      createdAt: row.createdAt as string,
    };
    if (row.releasedAt) record.releasedAt = row.releasedAt as string;
    if (row.releasedTo) record.releasedTo = row.releasedTo as string;
    return record;
  }

  // ── Cortex Extensions ──────────────────────────────────────────

  async createCortexExtension(record: CortexExtensionRecord): Promise<CortexExtensionRecord> {
    const existing = this.db.prepare('SELECT name FROM cortex_extensions WHERE name = ?').get(record.name);
    if (existing) throw new Error(`Cortex extension "${record.name}" already exists`);
    this.db.prepare(`INSERT INTO cortex_extensions (name, namespace, shortName, apiVersion, version, description, author, license, tags, labels, aimeatCompat, status, visibility, installedAt, activatedAt, installedBy, manifest, components, activationArtifacts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      record.name, record.namespace, record.shortName, record.apiVersion, record.version,
      record.description, record.author, record.license ?? null,
      JSON.stringify(record.tags), JSON.stringify(record.labels),
      record.aimeatCompat ?? null, record.status, record.visibility ?? 'private', record.installedAt, record.activatedAt ?? null,
      record.installedBy, record.manifest,
      JSON.stringify(record.components), JSON.stringify(record.activationArtifacts),
    );
    return record;
  }

  async getCortexExtension(name: string): Promise<CortexExtensionRecord | null> {
    const row = this.db.prepare('SELECT * FROM cortex_extensions WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeCortexExtension(row) : null;
  }

  async listCortexExtensions(opts?: { status?: string; namespace?: string; visibility?: string; installedBy?: string }): Promise<CortexExtensionRecord[]> {
    let sql = 'SELECT * FROM cortex_extensions WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    if (opts?.namespace) { sql += ' AND namespace = ?'; params.push(opts.namespace); }
    if (opts?.visibility) { sql += ' AND visibility = ?'; params.push(opts.visibility); }
    if (opts?.installedBy) { sql += ' AND installedBy = ?'; params.push(opts.installedBy); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeCortexExtension(r));
  }

  async updateCortexExtension(name: string, updates: Partial<CortexExtensionRecord>): Promise<CortexExtensionRecord | null> {
    const existing = await this.getCortexExtension(name);
    if (!existing) return null;
    const merged = { ...existing, ...updates };
    this.db.prepare(`UPDATE cortex_extensions SET namespace=?, shortName=?, apiVersion=?, version=?, description=?, author=?, license=?, tags=?, labels=?, aimeatCompat=?, status=?, visibility=?, installedAt=?, activatedAt=?, installedBy=?, manifest=?, components=?, activationArtifacts=? WHERE name=?`).run(
      merged.namespace, merged.shortName, merged.apiVersion, merged.version,
      merged.description, merged.author, merged.license ?? null,
      JSON.stringify(merged.tags), JSON.stringify(merged.labels),
      merged.aimeatCompat ?? null, merged.status, merged.visibility ?? 'private', merged.installedAt, merged.activatedAt ?? null,
      merged.installedBy, merged.manifest,
      JSON.stringify(merged.components), JSON.stringify(merged.activationArtifacts), name,
    );
    return merged;
  }

  async deleteCortexExtension(name: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM cortex_extensions WHERE name = ?').run(name);
    if (result.changes > 0) {
      this.db.prepare('DELETE FROM cortex_lib_files WHERE extName = ?').run(name);
    }
    return result.changes > 0;
  }

  async setCortexLibFile(extName: string, libName: string, content: string): Promise<void> {
    this.db.prepare('INSERT OR REPLACE INTO cortex_lib_files (extName, libName, content) VALUES (?, ?, ?)').run(extName, libName, content);
  }

  async getCortexLibFile(extName: string, libName: string): Promise<string | null> {
    const row = this.db.prepare('SELECT content FROM cortex_lib_files WHERE extName = ? AND libName = ?').get(extName, libName) as { content: string } | undefined;
    return row?.content ?? null;
  }

  async deleteCortexLibFile(extName: string, libName: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM cortex_lib_files WHERE extName = ? AND libName = ?').run(extName, libName);
    return result.changes > 0;
  }

  private deserializeCortexExtension(row: Record<string, unknown>): CortexExtensionRecord {
    return {
      name: row.name as string,
      namespace: row.namespace as string,
      shortName: row.shortName as string,
      apiVersion: row.apiVersion as string,
      version: row.version as string,
      description: row.description as string,
      author: row.author as string,
      license: row.license as string | undefined,
      tags: JSON.parse(row.tags as string || '[]'),
      labels: JSON.parse(row.labels as string || '{}'),
      aimeatCompat: row.aimeatCompat as string | undefined,
      status: row.status as 'inactive' | 'active',
      visibility: (row.visibility as string) === 'public' ? 'public' : 'private',
      installedAt: row.installedAt as string,
      activatedAt: row.activatedAt as string | undefined,
      installedBy: row.installedBy as string,
      manifest: row.manifest as string,
      components: JSON.parse(row.components as string || '[]'),
      activationArtifacts: JSON.parse(row.activationArtifacts as string || '{}'),
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Personal Push Subscriptions (REQ-007) ──
  // ══════════════════════════════════════════════════════════

  async createPersonalPushSubscription(record: PersonalPushSubscriptionRecord): Promise<PersonalPushSubscriptionRecord> {
    this.db.prepare(
      `INSERT INTO personal_push_subscriptions (id, personalNodeId, ownerName, endpoint, keys, failureCount, createdAt, lastUsedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.personalNodeId,
      record.ownerName,
      record.endpoint,
      JSON.stringify(record.keys),
      record.failureCount,
      record.createdAt,
      record.lastUsedAt,
    );
    return record;
  }

  async getPersonalPushSubscription(id: string): Promise<PersonalPushSubscriptionRecord | null> {
    const row = this.db.prepare('SELECT * FROM personal_push_subscriptions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializePersonalPushSubscription(row) : null;
  }

  async listPersonalPushSubscriptions(personalNodeId: string): Promise<PersonalPushSubscriptionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM personal_push_subscriptions WHERE personalNodeId = ?').all(personalNodeId) as Record<string, unknown>[];
    return rows.map(r => this.deserializePersonalPushSubscription(r));
  }

  async updatePersonalPushSubscription(id: string, updates: Partial<PersonalPushSubscriptionRecord>): Promise<boolean> {
    const existing = await this.getPersonalPushSubscription(id);
    if (!existing) return false;
    const merged = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE personal_push_subscriptions
       SET personalNodeId = ?, ownerName = ?, endpoint = ?, keys = ?, failureCount = ?, createdAt = ?, lastUsedAt = ?
       WHERE id = ?`
    ).run(
      merged.personalNodeId,
      merged.ownerName,
      merged.endpoint,
      JSON.stringify(merged.keys),
      merged.failureCount,
      merged.createdAt,
      merged.lastUsedAt,
      id,
    );
    return true;
  }

  async deletePersonalPushSubscription(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM personal_push_subscriptions WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async deletePersonalPushSubscriptionsByNode(personalNodeId: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM personal_push_subscriptions WHERE personalNodeId = ?').run(personalNodeId);
    return result.changes;
  }

  async countPersonalPushSubscriptions(personalNodeId: string): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM personal_push_subscriptions WHERE personalNodeId = ?').get(personalNodeId) as Record<string, unknown>;
    return (row.cnt as number) ?? 0;
  }

  private deserializePersonalPushSubscription(row: Record<string, unknown>): PersonalPushSubscriptionRecord {
    return {
      id: row.id as string,
      personalNodeId: row.personalNodeId as string,
      ownerName: row.ownerName as string,
      endpoint: row.endpoint as string,
      keys: JSON.parse(row.keys as string),
      failureCount: row.failureCount as number,
      createdAt: row.createdAt as string,
      lastUsedAt: (row.lastUsedAt as string) ?? null,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Notification Preferences (REQ-007) ──
  // ══════════════════════════════════════════════════════════

  async getNotificationPreferences(personalNodeId: string): Promise<NotificationPreferences | null> {
    const row = this.db.prepare('SELECT * FROM notification_preferences WHERE personalNodeId = ?').get(personalNodeId) as Record<string, unknown> | undefined;
    return row ? this.deserializeNotificationPreferences(row) : null;
  }

  async upsertNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences> {
    this.db.prepare(
      `INSERT INTO notification_preferences (personalNodeId, enabled, channels, notifyTypes, cooldownMinutes, quietHoursUtc, email)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(personalNodeId) DO UPDATE SET
         enabled = excluded.enabled,
         channels = excluded.channels,
         notifyTypes = excluded.notifyTypes,
         cooldownMinutes = excluded.cooldownMinutes,
         quietHoursUtc = excluded.quietHoursUtc,
         email = excluded.email`
    ).run(
      prefs.personalNodeId,
      prefs.enabled ? 1 : 0,
      JSON.stringify(prefs.channels),
      JSON.stringify(prefs.notifyTypes),
      prefs.cooldownMinutes,
      prefs.quietHoursUtc ? JSON.stringify(prefs.quietHoursUtc) : null,
      prefs.email,
    );
    return prefs;
  }

  async deleteNotificationPreferences(personalNodeId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM notification_preferences WHERE personalNodeId = ?').run(personalNodeId);
    return result.changes > 0;
  }

  private deserializeNotificationPreferences(row: Record<string, unknown>): NotificationPreferences {
    return {
      personalNodeId: row.personalNodeId as string,
      enabled: (row.enabled as number) === 1,
      channels: JSON.parse(row.channels as string),
      notifyTypes: JSON.parse(row.notifyTypes as string),
      cooldownMinutes: row.cooldownMinutes as number,
      quietHoursUtc: row.quietHoursUtc ? JSON.parse(row.quietHoursUtc as string) : null,
      email: (row.email as string) ?? null,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Notification Templates (Phase 3.2) ──
  // ══════════════════════════════════════════════════════════

  async getNotificationTemplate(id: string, locale: string): Promise<NotificationTemplateRecord | null> {
    const row = this.db.prepare('SELECT * FROM notification_templates WHERE id = ? AND locale = ?').get(id, locale) as Record<string, unknown> | undefined;
    return row ? this.deserializeNotificationTemplate(row) : null;
  }

  async upsertNotificationTemplate(record: NotificationTemplateRecord): Promise<NotificationTemplateRecord> {
    this.db.prepare(`
      INSERT INTO notification_templates (id, locale, fields, placeholders, updatedAt, updatedBy)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id, locale) DO UPDATE SET fields = excluded.fields, placeholders = excluded.placeholders, updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy
    `).run(record.id, record.locale, JSON.stringify(record.fields), JSON.stringify(record.placeholders), record.updatedAt, record.updatedBy);
    return record;
  }

  async listNotificationTemplates(): Promise<NotificationTemplateRecord[]> {
    const rows = this.db.prepare('SELECT * FROM notification_templates ORDER BY id, locale').all() as Record<string, unknown>[];
    return rows.map(r => this.deserializeNotificationTemplate(r));
  }

  async deleteAllNotificationTemplates(): Promise<void> {
    this.db.prepare('DELETE FROM notification_templates').run();
  }

  private deserializeNotificationTemplate(row: Record<string, unknown>): NotificationTemplateRecord {
    return {
      id: row.id as string,
      locale: row.locale as string,
      fields: JSON.parse(row.fields as string),
      placeholders: JSON.parse(row.placeholders as string),
      updatedAt: row.updatedAt as string,
      updatedBy: row.updatedBy as string,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Sessions (P3-7: Server-Side Session Tracking) ──
  // ══════════════════════════════════════════════════════════

  private mapSessionRow(row: Record<string, unknown>): import('../../../storage/repositories/session.repository.js').SessionRecord {
    return {
      sessionId: row.sessionId as string,
      gaii: row.gaii as string,
      owner: row.owner as string,
      issuedAt: row.issuedAt as string,
      expiresAt: row.expiresAt as string,
      revoked: row.revoked === 1 || row.revoked === true,
      refreshTokenHash: (row.refreshTokenHash as string | null) ?? null,
      prevTokenHash: (row.prevTokenHash as string | null) ?? null,
      prevValidUntil: (row.prevValidUntil as string | null) ?? null,
      lastUsedAt: (row.lastUsedAt as string | null) ?? null,
      idleExpiresAt: (row.idleExpiresAt as string | null) ?? null,
      absoluteExpiresAt: (row.absoluteExpiresAt as string | null) ?? null,
      deviceLabel: (row.deviceLabel as string | null) ?? null,
      userAgent: (row.userAgent as string | null) ?? null,
    };
  }

  async createSession(session: { sessionId: string; gaii: string; owner: string; issuedAt: string; expiresAt: string }): Promise<void> {
    this.db.prepare(
      'INSERT INTO sessions (sessionId, gaii, owner, issuedAt, expiresAt, revoked) VALUES (?, ?, ?, ?, ?, 0)'
    ).run(session.sessionId, session.gaii, session.owner, session.issuedAt, session.expiresAt);
  }

  async createOwnerSession(session: {
    sessionId: string; gaii: string; owner: string; issuedAt: string;
    refreshTokenHash: string; idleExpiresAt: string; absoluteExpiresAt: string;
    lastUsedAt: string; deviceLabel?: string | null; userAgent?: string | null;
  }): Promise<void> {
    // expiresAt mirrors the idle window so listActiveSessions reflects refresh-token life.
    this.db.prepare(
      `INSERT INTO sessions
         (sessionId, gaii, owner, issuedAt, expiresAt, revoked,
          refreshTokenHash, idleExpiresAt, absoluteExpiresAt, lastUsedAt, deviceLabel, userAgent)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
    ).run(
      session.sessionId, session.gaii, session.owner, session.issuedAt, session.idleExpiresAt,
      session.refreshTokenHash, session.idleExpiresAt, session.absoluteExpiresAt, session.lastUsedAt,
      session.deviceLabel ?? null, session.userAgent ?? null,
    );
  }

  async listActiveSessions(owner: string): Promise<import('../../../storage/repositories/session.repository.js').SessionRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM sessions WHERE owner = ? AND revoked = 0 ORDER BY issuedAt DESC'
    ).all(owner) as Record<string, unknown>[];
    return rows.map((r) => this.mapSessionRow(r));
  }

  async getSessionByRefreshHash(tokenHash: string): Promise<import('../../../storage/repositories/session.repository.js').SessionRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM sessions WHERE refreshTokenHash = ? OR prevTokenHash = ? LIMIT 1'
    ).get(tokenHash, tokenHash) as Record<string, unknown> | undefined;
    return row ? this.mapSessionRow(row) : null;
  }

  async rotateSessionRefresh(sessionId: string, update: {
    refreshTokenHash: string; prevTokenHash: string | null; prevValidUntil: string | null;
    idleExpiresAt: string; expiresAt: string; lastUsedAt: string;
  }): Promise<void> {
    this.db.prepare(
      `UPDATE sessions SET refreshTokenHash = ?, prevTokenHash = ?, prevValidUntil = ?,
         idleExpiresAt = ?, expiresAt = ?, lastUsedAt = ? WHERE sessionId = ?`
    ).run(
      update.refreshTokenHash, update.prevTokenHash, update.prevValidUntil,
      update.idleExpiresAt, update.expiresAt, update.lastUsedAt, sessionId,
    );
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    const result = this.db.prepare('UPDATE sessions SET revoked = 1 WHERE sessionId = ? AND revoked = 0').run(sessionId);
    return result.changes > 0;
  }

  async revokeAllSessions(owner: string): Promise<number> {
    const result = this.db.prepare('UPDATE sessions SET revoked = 1 WHERE owner = ? AND revoked = 0').run(owner);
    return result.changes;
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    const row = this.db.prepare('SELECT revoked FROM sessions WHERE sessionId = ?').get(sessionId) as { revoked: number } | undefined;
    if (!row) return false; // session not tracked = not revoked
    return row.revoked === 1;
  }

  async pruneExpiredSessions(nowIso: string): Promise<number> {
    // Remove fully-dead rows: past their expiry (legacy JWT exp / owner idle window)
    // or past the absolute cap. Revoked-but-unexpired rows are kept so isSessionRevoked
    // still rejects their (short-lived) access tokens.
    const result = this.db.prepare(
      `DELETE FROM sessions
        WHERE expiresAt < ?
           OR (absoluteExpiresAt IS NOT NULL AND absoluteExpiresAt < ?)`
    ).run(nowIso, nowIso);
    return result.changes;
  }

  // ══════════════════════════════════════════════════════════
  // ── Personal Access Tokens ──
  // ══════════════════════════════════════════════════════════

  private mapPatRow(row: Record<string, unknown>): import('../../../storage/repositories/pat.repository.js').PatRecord {
    return {
      id: row.id as string,
      tokenHash: row.tokenHash as string,
      label: row.label as string,
      owner: row.owner as string,
      scopes: row.scopes ? JSON.parse(row.scopes as string) : [],
      grantOwner: row.grantOwner === 1 || row.grantOwner === true,
      grantOperator: row.grantOperator === 1 || row.grantOperator === true,
      readOwnerData: row.readOwnerData === 1 || row.readOwnerData === true,
      gaii: row.gaii as string,
      createdAt: row.createdAt as string,
      expiresAt: (row.expiresAt as string | null) ?? null,
      lastUsedAt: (row.lastUsedAt as string | null) ?? null,
      revoked: row.revoked === 1 || row.revoked === true,
    };
  }

  async createPat(pat: import('../../../storage/repositories/pat.repository.js').PatRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO personal_access_tokens
         (id, tokenHash, label, owner, scopes, grantOwner, grantOperator, readOwnerData, gaii, createdAt, expiresAt, lastUsedAt, revoked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      pat.id, pat.tokenHash, pat.label, pat.owner, JSON.stringify(pat.scopes ?? []),
      pat.grantOwner ? 1 : 0, pat.grantOperator ? 1 : 0, pat.readOwnerData ? 1 : 0,
      pat.gaii, pat.createdAt, pat.expiresAt ?? null, pat.lastUsedAt ?? null,
    );
  }

  async getPatByHash(tokenHash: string): Promise<import('../../../storage/repositories/pat.repository.js').PatRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM personal_access_tokens WHERE tokenHash = ? AND revoked = 0 LIMIT 1'
    ).get(tokenHash) as Record<string, unknown> | undefined;
    return row ? this.mapPatRow(row) : null;
  }

  async listPats(owner: string): Promise<import('../../../storage/repositories/pat.repository.js').PatRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM personal_access_tokens WHERE owner = ? AND revoked = 0 ORDER BY createdAt DESC'
    ).all(owner) as Record<string, unknown>[];
    return rows.map((r) => this.mapPatRow(r));
  }

  async revokePat(id: string, owner: string): Promise<boolean> {
    const result = this.db.prepare(
      'UPDATE personal_access_tokens SET revoked = 1 WHERE id = ? AND owner = ? AND revoked = 0'
    ).run(id, owner);
    return result.changes > 0;
  }

  async touchPat(id: string, usedAtIso: string): Promise<void> {
    this.db.prepare('UPDATE personal_access_tokens SET lastUsedAt = ? WHERE id = ?').run(usedAtIso, id);
  }

  // ══════════════════════════════════════════════════════════
  // ── Token Revocation ──
  // ══════════════════════════════════════════════════════════

  async revokeToken(tokenHash: string, expiresAt: number): Promise<void> {
    this.db.prepare(
      'INSERT OR REPLACE INTO revoked_tokens (token_hash, expires_at) VALUES (?, ?)'
    ).run(tokenHash, expiresAt);
  }

  async isTokenRevoked(tokenHash: string): Promise<boolean> {
    const row = this.db.prepare('SELECT 1 FROM revoked_tokens WHERE token_hash = ?').get(tokenHash);
    return !!row;
  }

  async cleanExpiredRevocations(): Promise<number> {
    const result = this.db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(Math.floor(Date.now() / 1000));
    return result.changes;
  }

  // ══════════════════════════════════════════════════════════
  // ── App Catalog ──
  // ══════════════════════════════════════════════════════════

  async createApp(record: AppRecord): Promise<AppRecord> {
    this.db.prepare(
      `INSERT INTO apps (ownerGaii, ownerName, filename, versionNumber, manifest, mimeType, size, data, accessCode, parked, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.ownerGaii, record.ownerName, record.filename, record.versionNumber,
      JSON.stringify(record.manifest), record.mimeType, record.size, record.data,
      record.accessCode ?? null, record.parked ? 1 : 0, record.createdAt,
    );
    return record;
  }

  async getApp(ownerGaii: string, filename: string, version?: number): Promise<AppRecord | null> {
    let row: Record<string, unknown> | undefined;
    if (version !== undefined) {
      row = this.db.prepare('SELECT * FROM apps WHERE ownerGaii = ? AND filename = ? AND versionNumber = ?')
        .get(ownerGaii, filename, version) as Record<string, unknown> | undefined;
    } else {
      row = this.db.prepare('SELECT * FROM apps WHERE ownerGaii = ? AND filename = ? ORDER BY versionNumber DESC LIMIT 1')
        .get(ownerGaii, filename) as Record<string, unknown> | undefined;
    }
    return row ? this.deserializeApp(row) : null;
  }

  async getAppByOwnerName(ownerName: string, filename: string, version?: number): Promise<AppRecord | null> {
    let row: Record<string, unknown> | undefined;
    if (version !== undefined) {
      row = this.db.prepare('SELECT * FROM apps WHERE ownerName = ? AND filename = ? AND versionNumber = ?')
        .get(ownerName, filename, version) as Record<string, unknown> | undefined;
    } else {
      row = this.db.prepare('SELECT * FROM apps WHERE ownerName = ? AND filename = ? ORDER BY versionNumber DESC LIMIT 1')
        .get(ownerName, filename) as Record<string, unknown> | undefined;
    }
    return row ? this.deserializeApp(row) : null;
  }

  async listApps(opts?: AppListOptions): Promise<{ apps: AppRecord[]; total: number }> {
    // Get latest version of each app
    let query = `SELECT a.* FROM apps a
      INNER JOIN (SELECT ownerGaii, filename, MAX(versionNumber) as maxVer FROM apps GROUP BY ownerGaii, filename) latest
      ON a.ownerGaii = latest.ownerGaii AND a.filename = latest.filename AND a.versionNumber = latest.maxVer`;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.ownerGaii) {
      conditions.push(`a.ownerGaii = ?`);
      params.push(opts.ownerGaii);
    }
    if (opts?.category) {
      conditions.push(`json_extract(a.manifest, '$.category') = ?`);
      params.push(opts.category);
    }
    if (opts?.tag) {
      conditions.push(`a.manifest LIKE ?`);
      params.push(`%"${opts.tag}"%`);
    }
    if (opts?.q) {
      conditions.push(`(a.filename LIKE ? OR json_extract(a.manifest, '$.name') LIKE ? OR json_extract(a.manifest, '$.description') LIKE ?)`);
      const like = `%${opts.q}%`;
      params.push(like, like, like);
    }
    if (opts?.freeOnly) {
      conditions.push(`(json_extract(a.manifest, '$.priceMorsels') IS NULL OR json_extract(a.manifest, '$.priceMorsels') = 0)`);
    }
    // Parked apps are hidden from everyone EXCEPT their owner (viewerGhii). An
    // explicit ownerGaii filter already scopes to one owner, so skip the clause
    // there (the owner's "my apps" view must include their own parked apps).
    if (!opts?.ownerGaii) {
      if (opts?.viewerGhii) {
        conditions.push(`(a.parked = 0 OR a.ownerGaii = ?)`);
        params.push(opts.viewerGhii);
      } else {
        conditions.push(`a.parked = 0`);
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    // Count total before pagination
    const countQuery = query.replace('SELECT a.*', 'SELECT COUNT(*) as cnt');
    const countRow = this.db.prepare(countQuery).get(...params) as { cnt: number };
    const total = countRow.cnt;

    // Sort
    if (opts?.sort === 'popular') {
      query += ` ORDER BY (SELECT COALESCE(d.downloads, 0) FROM app_downloads d WHERE d.ownerGaii = a.ownerGaii AND d.filename = a.filename) DESC, a.createdAt DESC`;
    } else {
      query += ' ORDER BY a.createdAt DESC';
    }

    // Pagination
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return { apps: rows.map(r => this.deserializeApp(r)), total };
  }

  async listAppVersions(ownerGaii: string, filename: string): Promise<AppRecord[]> {
    const rows = this.db.prepare('SELECT * FROM apps WHERE ownerGaii = ? AND filename = ? ORDER BY versionNumber DESC')
      .all(ownerGaii, filename) as Record<string, unknown>[];
    return rows.map(r => this.deserializeApp(r));
  }

  async getLatestVersionNumber(ownerGaii: string, filename: string): Promise<number> {
    const row = this.db.prepare('SELECT MAX(versionNumber) as maxVer FROM apps WHERE ownerGaii = ? AND filename = ?')
      .get(ownerGaii, filename) as { maxVer: number | null } | undefined;
    return row?.maxVer ?? 0;
  }

  async deleteApp(ownerGaii: string, filename: string, version?: number): Promise<boolean> {
    if (version !== undefined) {
      const result = this.db.prepare('DELETE FROM apps WHERE ownerGaii = ? AND filename = ? AND versionNumber = ?')
        .run(ownerGaii, filename, version);
      return result.changes > 0;
    }
    // Delete all versions
    const result = this.db.prepare('DELETE FROM apps WHERE ownerGaii = ? AND filename = ?')
      .run(ownerGaii, filename);
    // Also delete download counter
    this.db.prepare('DELETE FROM app_downloads WHERE ownerGaii = ? AND filename = ?')
      .run(ownerGaii, filename);
    return result.changes > 0;
  }

  async updateAppAccessCode(ownerGaii: string, filename: string, accessCode?: string): Promise<boolean> {
    // Update access code on all versions
    const result = this.db.prepare('UPDATE apps SET accessCode = ? WHERE ownerGaii = ? AND filename = ?')
      .run(accessCode ?? null, ownerGaii, filename);
    return result.changes > 0;
  }

  async setAppParked(ownerGaii: string, filename: string, parked: boolean): Promise<boolean> {
    // Park/unpark applies to the whole app — flag every version row.
    const result = this.db.prepare('UPDATE apps SET parked = ? WHERE ownerGaii = ? AND filename = ?')
      .run(parked ? 1 : 0, ownerGaii, filename);
    return result.changes > 0;
  }

  async getAppDownloads(ownerGaii: string, filename: string): Promise<number> {
    const row = this.db.prepare('SELECT downloads FROM app_downloads WHERE ownerGaii = ? AND filename = ?')
      .get(ownerGaii, filename) as { downloads: number } | undefined;
    return row?.downloads ?? 0;
  }

  async incrementAppDownloads(ownerGaii: string, filename: string): Promise<void> {
    this.db.prepare(
      `INSERT INTO app_downloads (ownerGaii, filename, downloads) VALUES (?, ?, 1)
       ON CONFLICT(ownerGaii, filename) DO UPDATE SET downloads = downloads + 1`
    ).run(ownerGaii, filename);
  }

  // ── Subdomain sites (operator-managed subdomain → app/redirect mappings) ──

  async createSubdomainSite(site: SubdomainSiteRecord): Promise<SubdomainSiteRecord> {
    this.db.prepare(
      `INSERT INTO subdomain_sites (subdomain, kind, target, enabled, createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      site.subdomain, site.kind, site.target, site.enabled ? 1 : 0,
      site.createdBy, site.createdAt, site.updatedAt,
    );
    return site;
  }

  async getSubdomainSite(subdomain: string): Promise<SubdomainSiteRecord | null> {
    const row = this.db.prepare('SELECT * FROM subdomain_sites WHERE subdomain = ?')
      .get(subdomain) as Record<string, unknown> | undefined;
    return row ? this.deserializeSubdomainSite(row) : null;
  }

  async listSubdomainSites(): Promise<SubdomainSiteRecord[]> {
    const rows = this.db.prepare('SELECT * FROM subdomain_sites ORDER BY subdomain')
      .all() as Record<string, unknown>[];
    return rows.map(r => this.deserializeSubdomainSite(r));
  }

  async updateSubdomainSite(
    subdomain: string,
    updates: Partial<Pick<SubdomainSiteRecord, 'kind' | 'target' | 'enabled' | 'updatedAt'>>,
  ): Promise<SubdomainSiteRecord | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.kind !== undefined) { sets.push('kind = ?'); params.push(updates.kind); }
    if (updates.target !== undefined) { sets.push('target = ?'); params.push(updates.target); }
    if (updates.enabled !== undefined) { sets.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }
    sets.push('updatedAt = ?');
    params.push(updates.updatedAt ?? new Date().toISOString());
    params.push(subdomain);
    const result = this.db.prepare(`UPDATE subdomain_sites SET ${sets.join(', ')} WHERE subdomain = ?`)
      .run(...params);
    if (result.changes === 0) return null;
    return this.getSubdomainSite(subdomain);
  }

  async deleteSubdomainSite(subdomain: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM subdomain_sites WHERE subdomain = ?').run(subdomain);
    return result.changes > 0;
  }

  private deserializeSubdomainSite(row: Record<string, unknown>): SubdomainSiteRecord {
    return {
      subdomain: row.subdomain as string,
      kind: row.kind as SubdomainSiteRecord['kind'],
      target: row.target as string,
      enabled: (row.enabled as number) === 1,
      createdBy: row.createdBy as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  }

  // ── App grants (owner-issued app authorizations → agent tokens) ──

  async createAppGrant(grant: AppGrantRecord): Promise<AppGrantRecord> {
    this.db.prepare(
      `INSERT INTO app_grants (grantId, app, appName, appOrigin, owner, gaii, scopes, refreshTokenHash, createdAt, lastUsedAt, revoked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      grant.grantId, grant.app, grant.appName, grant.appOrigin, grant.owner, grant.gaii,
      JSON.stringify(grant.scopes), grant.refreshTokenHash, grant.createdAt, grant.lastUsedAt,
      grant.revoked ? 1 : 0,
    );
    return grant;
  }

  async getAppGrant(grantId: string): Promise<AppGrantRecord | null> {
    const row = this.db.prepare('SELECT * FROM app_grants WHERE grantId = ?')
      .get(grantId) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppGrant(row) : null;
  }

  async getAppGrantByRefreshHash(tokenHash: string): Promise<AppGrantRecord | null> {
    const row = this.db.prepare('SELECT * FROM app_grants WHERE refreshTokenHash = ?')
      .get(tokenHash) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppGrant(row) : null;
  }

  async listAppGrantsByOwner(owner: string): Promise<AppGrantRecord[]> {
    const rows = this.db.prepare('SELECT * FROM app_grants WHERE owner = ? ORDER BY createdAt DESC')
      .all(owner) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAppGrant(r));
  }

  async updateAppGrant(
    grantId: string,
    updates: Partial<Pick<AppGrantRecord, 'refreshTokenHash' | 'lastUsedAt' | 'revoked' | 'scopes'>>,
  ): Promise<AppGrantRecord | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.refreshTokenHash !== undefined) { sets.push('refreshTokenHash = ?'); params.push(updates.refreshTokenHash); }
    if (updates.lastUsedAt !== undefined) { sets.push('lastUsedAt = ?'); params.push(updates.lastUsedAt); }
    if (updates.revoked !== undefined) { sets.push('revoked = ?'); params.push(updates.revoked ? 1 : 0); }
    if (updates.scopes !== undefined) { sets.push('scopes = ?'); params.push(JSON.stringify(updates.scopes)); }
    if (sets.length === 0) return this.getAppGrant(grantId);
    params.push(grantId);
    const result = this.db.prepare(`UPDATE app_grants SET ${sets.join(', ')} WHERE grantId = ?`)
      .run(...params);
    if (result.changes === 0) return null;
    return this.getAppGrant(grantId);
  }

  async deleteAppGrant(grantId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM app_grants WHERE grantId = ?').run(grantId);
    return result.changes > 0;
  }

  private deserializeAppGrant(row: Record<string, unknown>): AppGrantRecord {
    return {
      grantId: row.grantId as string,
      app: row.app as string,
      appName: row.appName as string,
      appOrigin: row.appOrigin as string,
      owner: row.owner as string,
      gaii: row.gaii as string,
      scopes: JSON.parse(row.scopes as string) as string[],
      refreshTokenHash: (row.refreshTokenHash as string | null) ?? null,
      createdAt: row.createdAt as string,
      lastUsedAt: (row.lastUsedAt as string | null) ?? null,
      revoked: (row.revoked as number) === 1,
    };
  }

  async normalizeAppOwnerNames(): Promise<number> {
    // Strip the `@node` suffix from any ownerName stored as a full GHII. Owner
    // names never contain '@', so `instr` finds only the GHII separator.
    const result = this.db.prepare(
      `UPDATE apps SET ownerName = substr(ownerName, 1, instr(ownerName, '@') - 1)
       WHERE ownerName LIKE '%@%'`
    ).run();
    return result.changes;
  }

  async mergeForkedAppBuckets(): Promise<number> {
    // Consolidate ownerGaii buckets forked across an owner's identity forms into
    // the owner's canonical GHII bucket. Run AFTER normalizeAppOwnerNames() so
    // grouping by the bare ownerName is reliable. See the AppRepository contract
    // for the full rationale. Wrapped in a transaction — partial merges would
    // leave inconsistent version lines.
    let reKeyed = 0;
    const tx = this.db.transaction(() => {
      // Owners we can canonicalize: those with a GHII record. Map bare
      // ownerName -> canonical GHII bucket key.
      const owners = this.db.prepare(
        `SELECT DISTINCT a.ownerName AS ownerName, g.ghii AS ghii
           FROM apps a JOIN ghiis g ON g.ownerName = a.ownerName`
      ).all() as { ownerName: string; ghii: string }[];

      const updRow = this.db.prepare('UPDATE apps SET ownerGaii = ?, versionNumber = ? WHERE rowid = ?');

      for (const { ownerName, ghii } of owners) {
        // Filenames that have at least one row OUTSIDE the canonical bucket.
        const filenames = this.db.prepare(
          'SELECT DISTINCT filename FROM apps WHERE ownerName = ? AND ownerGaii != ?'
        ).all(ownerName, ghii) as { filename: string }[];

        for (const { filename } of filenames) {
          // Stray rows ordered oldest-first so the newest stray gets the highest
          // new version number and therefore becomes the served "latest".
          const strays = this.db.prepare(
            `SELECT rowid AS rid, ownerGaii FROM apps
              WHERE ownerName = ? AND filename = ? AND ownerGaii != ?
              ORDER BY createdAt ASC, versionNumber ASC`
          ).all(ownerName, filename, ghii) as { rid: number; ownerGaii: string }[];
          if (strays.length === 0) continue;

          let maxV = (this.db.prepare(
            'SELECT COALESCE(MAX(versionNumber), 0) AS m FROM apps WHERE ownerGaii = ? AND filename = ?'
          ).get(ghii, filename) as { m: number }).m;

          for (const s of strays) {
            maxV += 1;
            updRow.run(ghii, maxV, s.rid);
            reKeyed += 1;
          }

          const strayBuckets = [...new Set(strays.map(s => s.ownerGaii))];
          const ssKey = `apps/screenshots/${filename}`;

          // Move one stray screenshot into the canonical bucket if it has none,
          // then drop any remaining stray screenshots for this app.
          const canonHasSs = this.db.prepare(
            'SELECT 1 FROM storage_files WHERE ownerGaii = ? AND key = ?'
          ).get(ghii, ssKey);
          if (!canonHasSs) {
            for (const b of strayBuckets) {
              const moved = this.db.prepare(
                'UPDATE storage_files SET ownerGaii = ? WHERE ownerGaii = ? AND key = ?'
              ).run(ghii, b, ssKey);
              if (moved.changes > 0) break;
            }
          }
          for (const b of strayBuckets) {
            this.db.prepare('DELETE FROM storage_files WHERE ownerGaii = ? AND key = ?').run(b, ssKey);
          }

          // Fold stray download counters into the canonical row, then remove them.
          for (const b of strayBuckets) {
            const d = this.db.prepare(
              'SELECT downloads FROM app_downloads WHERE ownerGaii = ? AND filename = ?'
            ).get(b, filename) as { downloads: number } | undefined;
            if (d && d.downloads > 0) {
              this.db.prepare(
                `INSERT INTO app_downloads (ownerGaii, filename, downloads) VALUES (?, ?, ?)
                 ON CONFLICT(ownerGaii, filename) DO UPDATE SET downloads = downloads + excluded.downloads`
              ).run(ghii, filename, d.downloads);
            }
            this.db.prepare('DELETE FROM app_downloads WHERE ownerGaii = ? AND filename = ?').run(b, filename);
          }
        }
      }
    });
    tx();
    return reKeyed;
  }

  private deserializeApp(row: Record<string, unknown>): AppRecord {
    const record: AppRecord = {
      ownerGaii: row.ownerGaii as string,
      ownerName: row.ownerName as string,
      filename: row.filename as string,
      versionNumber: row.versionNumber as number,
      manifest: JSON.parse((row.manifest as string) || '{}'),
      mimeType: row.mimeType as string,
      size: row.size as number,
      data: row.data as Buffer,
      createdAt: row.createdAt as string,
    };
    if (row.accessCode) record.accessCode = row.accessCode as string;
    if (row.parked) record.parked = true;
    return record;
  }

  // ── App Marketplace (purchase receipts) ──

  async createAppPurchase(record: AppPurchaseRecord): Promise<AppPurchaseRecord> {
    this.db.prepare(`INSERT INTO app_purchases (transactionId, buyerGaii, buyerOwner, sellerGaii, sellerOwner, appFilename, appName, appVersionNumber, licenseType, priceMorsels, transactionFeeMorsels, purchasedAt, appContent, appManifest, appScreenshot, signature, nodeId, nodePublicKey) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      record.transactionId, record.buyerGaii, record.buyerOwner,
      record.sellerGaii, record.sellerOwner, record.appFilename,
      record.appName, record.appVersionNumber, record.licenseType,
      record.priceMorsels, record.transactionFeeMorsels, record.purchasedAt,
      record.appContent, JSON.stringify(record.appManifest),
      record.appScreenshot ?? null, record.signature,
      record.nodeId, record.nodePublicKey,
    );
    return record;
  }

  async getAppPurchase(transactionId: string): Promise<AppPurchaseRecord | null> {
    const row = this.db.prepare('SELECT * FROM app_purchases WHERE transactionId = ?').get(transactionId) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppPurchase(row) : null;
  }

  async listAppPurchasesByBuyer(buyerGaii: string): Promise<AppPurchaseRecord[]> {
    const rows = this.db.prepare('SELECT * FROM app_purchases WHERE buyerGaii = ? ORDER BY purchasedAt DESC').all(buyerGaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAppPurchase(r));
  }

  async listAppPurchasesBySeller(sellerGaii: string): Promise<AppPurchaseRecord[]> {
    const rows = this.db.prepare('SELECT * FROM app_purchases WHERE sellerGaii = ? ORDER BY purchasedAt DESC').all(sellerGaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAppPurchase(r));
  }

  async hasValidLicense(buyerGaii: string, sellerGaii: string, filename: string, licenseType?: 'single' | 'lifetime'): Promise<boolean> {
    // Lifetime license: any purchase of this app grants access to all versions
    const lifetime = this.db.prepare('SELECT 1 FROM app_purchases WHERE buyerGaii = ? AND sellerGaii = ? AND appFilename = ? AND licenseType = ? LIMIT 1').get(buyerGaii, sellerGaii, filename, 'lifetime') as Record<string, unknown> | undefined;
    if (lifetime) return true;
    // Single license: buyer has at least one purchase of this app (version-specific check done at download)
    if (!licenseType || licenseType === 'single') {
      const single = this.db.prepare('SELECT 1 FROM app_purchases WHERE buyerGaii = ? AND sellerGaii = ? AND appFilename = ? LIMIT 1').get(buyerGaii, sellerGaii, filename) as Record<string, unknown> | undefined;
      return !!single;
    }
    return false;
  }

  private deserializeAppPurchase(row: Record<string, unknown>): AppPurchaseRecord {
    const record: AppPurchaseRecord = {
      transactionId: row.transactionId as string,
      buyerGaii: row.buyerGaii as string,
      buyerOwner: row.buyerOwner as string,
      sellerGaii: row.sellerGaii as string,
      sellerOwner: row.sellerOwner as string,
      appFilename: row.appFilename as string,
      appName: row.appName as string,
      appVersionNumber: row.appVersionNumber as number,
      licenseType: row.licenseType as 'single' | 'lifetime',
      priceMorsels: row.priceMorsels as number,
      transactionFeeMorsels: row.transactionFeeMorsels as number,
      purchasedAt: row.purchasedAt as string,
      appContent: row.appContent as string,
      appManifest: JSON.parse((row.appManifest as string) || '{}'),
      signature: row.signature as string,
      nodeId: row.nodeId as string,
      nodePublicKey: row.nodePublicKey as string,
    };
    if (row.appScreenshot) record.appScreenshot = row.appScreenshot as string;
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Config Persistence ──
  // ══════════════════════════════════════════════════════════

  supportsConfigPersistence(): boolean {
    // In-memory SQLite (:memory:) does not persist across restarts
    return this.db.name !== ':memory:';
  }

  async getConfigValue(key: string): Promise<string | null> {
    const row = this.db.prepare('SELECT value FROM system_settings WHERE key = ?').get(`config:${key}`) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async setConfigValue(key: string, value: string): Promise<void> {
    this.db.prepare(`
      INSERT INTO system_settings (key, value, updatedAt) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = datetime('now')
    `).run(`config:${key}`, value);
  }

  async deleteConfigValue(key: string): Promise<void> {
    this.db.prepare('DELETE FROM system_settings WHERE key = ?').run(`config:${key}`);
  }

  async getAllConfigValues(): Promise<Record<string, string>> {
    const rows = this.db.prepare("SELECT key, value FROM system_settings WHERE key LIKE 'config:%'").all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const r of rows) result[r.key.replace('config:', '')] = r.value;
    return result;
  }

  // ══════════════════════════════════════════════════════════
  // ── Knowledge: Memory Links ──
  // ══════════════════════════════════════════════════════════

  async createLink(record: MemoryLinkRecord): Promise<MemoryLinkRecord> {
    this.db.prepare(`
      INSERT INTO knowledge_links (source, target, relation, description, linked_at, linked_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, target) DO UPDATE SET
        relation = excluded.relation, description = excluded.description,
        linked_at = excluded.linked_at, linked_by = excluded.linked_by
    `).run(record.source, record.target, record.relation, record.description, record.linked_at, record.linked_by);
    return record;
  }

  async getLink(source: string, target: string): Promise<MemoryLinkRecord | null> {
    const row = this.db.prepare('SELECT * FROM knowledge_links WHERE source = ? AND target = ?').get(source, target) as any;
    return row ?? null;
  }

  async listLinks(key: string, opts?: { direction?: 'outgoing' | 'incoming' | 'both'; relation?: string }): Promise<MemoryLinkRecord[]> {
    const dir = opts?.direction ?? 'both';
    let sql: string;
    const params: string[] = [];

    if (dir === 'outgoing') {
      sql = 'SELECT * FROM knowledge_links WHERE source = ?';
      params.push(key);
    } else if (dir === 'incoming') {
      sql = 'SELECT * FROM knowledge_links WHERE target = ?';
      params.push(key);
    } else {
      sql = 'SELECT * FROM knowledge_links WHERE source = ? OR target = ?';
      params.push(key, key);
    }

    if (opts?.relation) {
      sql += ' AND relation = ?';
      params.push(opts.relation);
    }

    return this.db.prepare(sql).all(...params) as MemoryLinkRecord[];
  }

  async deleteLink(source: string, target: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM knowledge_links WHERE source = ? AND target = ?').run(source, target);
    return result.changes > 0;
  }

  async findBrokenLinks(ownerGaii: string): Promise<MemoryLinkRecord[]> {
    const links = this.db.prepare('SELECT * FROM knowledge_links WHERE linked_by = ?').all(ownerGaii) as MemoryLinkRecord[];
    const broken: MemoryLinkRecord[] = [];
    for (const link of links) {
      const sourceExists = await this.getMemory(ownerGaii, link.source);
      const targetExists = await this.getMemory(ownerGaii, link.target);
      if (!sourceExists || !targetExists) broken.push(link);
    }
    return broken;
  }

  async deleteLinksByContributor(gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM knowledge_links WHERE linked_by = ?').run(gaii);
    return result.changes;
  }

  // ══════════════════════════════════════════════════════════
  // ── Knowledge: Operator Reviews ──
  // ══════════════════════════════════════════════════════════

  async createReview(record: OperatorReviewRecord): Promise<OperatorReviewRecord> {
    this.db.prepare(`
      INSERT INTO knowledge_reviews (id, packageId, operatorGaii, reason, customText, action, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.packageId, record.operatorGaii, record.reason, record.customText ?? null, record.action, record.timestamp);
    return record;
  }

  async listReviews(packageId: string): Promise<OperatorReviewRecord[]> {
    return this.db.prepare('SELECT * FROM knowledge_reviews WHERE packageId = ? ORDER BY timestamp ASC').all(packageId) as OperatorReviewRecord[];
  }

  async listAllReviews(opts?: { page?: number; perPage?: number }): Promise<OperatorReviewRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    const offset = (page - 1) * perPage;
    return this.db.prepare('SELECT * FROM knowledge_reviews ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(perPage, offset) as OperatorReviewRecord[];
  }

  async deleteReviewsByOperator(gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM knowledge_reviews WHERE operatorGaii = ?').run(gaii);
    return result.changes;
  }

  // ══════════════════════════════════════════════════════════
  // ── Scheduled Jobs ──
  // ══════════════════════════════════════════════════════════

  async createScheduledJob(record: ScheduledJobRecord): Promise<ScheduledJobRecord> {
    try {
      this.db.prepare(
        `INSERT INTO scheduled_jobs (id, name, type, extensionName, instanceId, actionId,
         coreHandler, cron, enabled, input, lastRunAt, lastRunResult, lastRunError,
         lastRunDurationMs, nextRunAt, createdBy, createdAt, updatedAt,
         ownerScope, agentName, agentGaii, createdByAgent, displayName, description,
         purpose, timezone, constraints, runCount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id, record.name, record.type,
        record.extensionName ?? null, record.instanceId ?? null, record.actionId ?? null,
        record.coreHandler ?? null, record.cron, record.enabled ? 1 : 0,
        record.input ? JSON.stringify(record.input) : null,
        record.lastRunAt ?? null, record.lastRunResult ?? null, record.lastRunError ?? null,
        record.lastRunDurationMs ?? null, record.nextRunAt ?? null,
        record.createdBy, record.createdAt, record.updatedAt,
        record.ownerScope ?? null, record.agentName ?? null, record.agentGaii ?? null,
        record.createdByAgent ? 1 : 0, record.displayName ?? null, record.description ?? null,
        record.purpose ?? null, record.timezone ?? null,
        record.constraints ? JSON.stringify(record.constraints) : null,
        record.runCount ?? 0,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) {
        throw new Error(`Scheduled job "${record.id}" already exists`, { cause: err });
      }
      throw err;
    }
  }

  async getScheduledJob(id: string): Promise<ScheduledJobRecord | null> {
    const row = this.db.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeScheduledJob(row) : null;
  }

  async listScheduledJobs(filter?: { type?: string; extensionName?: string; enabled?: boolean; ownerScope?: string; agentGaii?: string }): Promise<ScheduledJobRecord[]> {
    let sql = 'SELECT * FROM scheduled_jobs';
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.type) { conditions.push('type = ?'); params.push(filter.type); }
    if (filter?.extensionName) { conditions.push('extensionName = ?'); params.push(filter.extensionName); }
    if (filter?.enabled !== undefined) { conditions.push('enabled = ?'); params.push(filter.enabled ? 1 : 0); }
    if (filter?.ownerScope) { conditions.push('ownerScope = ?'); params.push(filter.ownerScope); }
    if (filter?.agentGaii) { conditions.push('agentGaii = ?'); params.push(filter.agentGaii); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeScheduledJob(r));
  }

  async updateScheduledJob(id: string, updates: Partial<ScheduledJobRecord>): Promise<ScheduledJobRecord | null> {
    const existing = await this.getScheduledJob(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE scheduled_jobs SET name = ?, type = ?, extensionName = ?, instanceId = ?,
       actionId = ?, coreHandler = ?, cron = ?, enabled = ?, input = ?,
       lastRunAt = ?, lastRunResult = ?, lastRunError = ?, lastRunDurationMs = ?,
       nextRunAt = ?, createdBy = ?, createdAt = ?, updatedAt = ?,
       ownerScope = ?, agentName = ?, agentGaii = ?, createdByAgent = ?,
       displayName = ?, description = ?, purpose = ?, timezone = ?,
       constraints = ?, runCount = ? WHERE id = ?`
    ).run(
      updated.name, updated.type,
      updated.extensionName ?? null, updated.instanceId ?? null, updated.actionId ?? null,
      updated.coreHandler ?? null, updated.cron, updated.enabled ? 1 : 0,
      updated.input ? JSON.stringify(updated.input) : null,
      updated.lastRunAt ?? null, updated.lastRunResult ?? null, updated.lastRunError ?? null,
      updated.lastRunDurationMs ?? null, updated.nextRunAt ?? null,
      updated.createdBy, updated.createdAt, updated.updatedAt,
      updated.ownerScope ?? null, updated.agentName ?? null, updated.agentGaii ?? null,
      updated.createdByAgent ? 1 : 0, updated.displayName ?? null, updated.description ?? null,
      updated.purpose ?? null, updated.timezone ?? null,
      updated.constraints ? JSON.stringify(updated.constraints) : null,
      updated.runCount ?? 0, id,
    );
    return updated;
  }

  async deleteScheduledJob(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private deserializeScheduledJob(row: Record<string, unknown>): ScheduledJobRecord {
    const record: ScheduledJobRecord = {
      id: row.id as string,
      name: row.name as string,
      type: row.type as ScheduledJobRecord['type'],
      cron: row.cron as string,
      enabled: (row.enabled as number) === 1,
      createdBy: row.createdBy as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.extensionName) record.extensionName = row.extensionName as string;
    if (row.instanceId) record.instanceId = row.instanceId as string;
    if (row.actionId) record.actionId = row.actionId as string;
    if (row.coreHandler) record.coreHandler = row.coreHandler as string;
    if (row.input) record.input = JSON.parse(row.input as string);
    if (row.lastRunAt) record.lastRunAt = row.lastRunAt as string;
    if (row.lastRunResult) record.lastRunResult = row.lastRunResult as ScheduledJobRecord['lastRunResult'];
    if (row.lastRunError) record.lastRunError = row.lastRunError as string;
    if (row.lastRunDurationMs !== null && row.lastRunDurationMs !== undefined) record.lastRunDurationMs = row.lastRunDurationMs as number;
    if (row.nextRunAt) record.nextRunAt = row.nextRunAt as string;
    if (row.ownerScope) record.ownerScope = row.ownerScope as string;
    if (row.agentName) record.agentName = row.agentName as string;
    if (row.agentGaii) record.agentGaii = row.agentGaii as string;
    if ((row.createdByAgent as number) === 1) record.createdByAgent = true;
    if (row.displayName) record.displayName = row.displayName as string;
    if (row.description) record.description = row.description as string;
    if (row.purpose) record.purpose = row.purpose as string;
    if (row.timezone) record.timezone = row.timezone as string;
    if (row.constraints) record.constraints = JSON.parse(row.constraints as string);
    if (row.runCount !== null && row.runCount !== undefined) record.runCount = row.runCount as number;
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Execution Log ──
  // ══════════════════════════════════════════════════════════

  async createExecutionLog(entry: ExecutionLogEntry): Promise<ExecutionLogEntry> {
    this.db.prepare(
      `INSERT INTO execution_log (id, jobId, jobName, type, extensionName, actionId,
       "trigger", result, errorMessage, durationMs, memoryReads, memoryWrites, taskId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.id, entry.jobId, entry.jobName, entry.type,
      entry.extensionName ?? null, entry.actionId ?? null,
      entry.trigger, entry.result, entry.errorMessage ?? null,
      entry.durationMs,
      JSON.stringify(entry.memoryReads),
      JSON.stringify(entry.memoryWrites),
      entry.taskId ?? null,
      entry.createdAt,
    );
    return entry;
  }

  async listExecutionLogs(filter?: {
    jobId?: string; extensionName?: string; trigger?: string; result?: string;
    limit?: number; offset?: number;
  }): Promise<ExecutionLogEntry[]> {
    let sql = 'SELECT * FROM execution_log';
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.jobId) { conditions.push('jobId = ?'); params.push(filter.jobId); }
    if (filter?.extensionName) { conditions.push('extensionName = ?'); params.push(filter.extensionName); }
    if (filter?.trigger) { conditions.push('"trigger" = ?'); params.push(filter.trigger); }
    if (filter?.result) { conditions.push('result = ?'); params.push(filter.result); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY createdAt DESC';
    if (filter?.limit) { sql += ' LIMIT ?'; params.push(filter.limit); }
    if (filter?.offset) { sql += ' OFFSET ?'; params.push(filter.offset); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeExecutionLog(r));
  }

  async countExecutionLogs(filter?: {
    jobId?: string; extensionName?: string; trigger?: string; result?: string;
  }): Promise<number> {
    let sql = 'SELECT COUNT(*) as cnt FROM execution_log';
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.jobId) { conditions.push('jobId = ?'); params.push(filter.jobId); }
    if (filter?.extensionName) { conditions.push('extensionName = ?'); params.push(filter.extensionName); }
    if (filter?.trigger) { conditions.push('"trigger" = ?'); params.push(filter.trigger); }
    if (filter?.result) { conditions.push('result = ?'); params.push(filter.result); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    const row = this.db.prepare(sql).get(...params) as Record<string, unknown>;
    return (row.cnt as number) ?? 0;
  }

  async pruneExecutionLogs(beforeDate: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM execution_log WHERE createdAt < ?').run(beforeDate);
    return result.changes;
  }

  private deserializeExecutionLog(row: Record<string, unknown>): ExecutionLogEntry {
    return {
      id: row.id as string,
      jobId: row.jobId as string,
      jobName: row.jobName as string,
      type: row.type as ExecutionLogEntry['type'],
      extensionName: (row.extensionName as string) || undefined,
      actionId: (row.actionId as string) || undefined,
      trigger: row.trigger as ExecutionLogEntry['trigger'],
      result: row.result as ExecutionLogEntry['result'],
      errorMessage: (row.errorMessage as string) || undefined,
      durationMs: row.durationMs as number,
      memoryReads: JSON.parse(row.memoryReads as string || '[]'),
      memoryWrites: JSON.parse(row.memoryWrites as string || '[]'),
      taskId: (row.taskId as string) || undefined,
      createdAt: row.createdAt as string,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Extension Instances ──
  // ══════════════════════════════════════════════════════════

  async createExtensionInstance(record: ExtensionInstanceRecord): Promise<ExtensionInstanceRecord> {
    try {
      this.db.prepare(
        `INSERT INTO extension_instances (id, extensionName, config, status, createdBy, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id, record.extensionName, JSON.stringify(record.config),
        record.status, record.createdBy, record.createdAt, record.updatedAt,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) {
        throw new Error(`Extension instance "${record.id}" already exists for "${record.extensionName}"`, { cause: err });
      }
      throw err;
    }
  }

  async getExtensionInstance(extensionName: string, instanceId: string): Promise<ExtensionInstanceRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM extension_instances WHERE extensionName = ? AND id = ?'
    ).get(extensionName, instanceId) as Record<string, unknown> | undefined;
    return row ? this.deserializeExtensionInstance(row) : null;
  }

  async listExtensionInstances(extensionName: string): Promise<ExtensionInstanceRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM extension_instances WHERE extensionName = ?'
    ).all(extensionName) as Record<string, unknown>[];
    return rows.map(r => this.deserializeExtensionInstance(r));
  }

  async updateExtensionInstance(extensionName: string, instanceId: string, updates: Partial<ExtensionInstanceRecord>): Promise<ExtensionInstanceRecord | null> {
    const existing = await this.getExtensionInstance(extensionName, instanceId);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE extension_instances SET config = ?, status = ?, createdBy = ?, createdAt = ?, updatedAt = ?
       WHERE extensionName = ? AND id = ?`
    ).run(
      JSON.stringify(updated.config), updated.status,
      updated.createdBy, updated.createdAt, updated.updatedAt,
      extensionName, instanceId,
    );
    return updated;
  }

  async deleteExtensionInstance(extensionName: string, instanceId: string): Promise<boolean> {
    const result = this.db.prepare(
      'DELETE FROM extension_instances WHERE extensionName = ? AND id = ?'
    ).run(extensionName, instanceId);
    return result.changes > 0;
  }

  async deleteExtensionInstancesByOwner(ownerIdentity: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM extension_instances WHERE createdBy = ?').run(ownerIdentity);
    return result.changes;
  }

  private deserializeExtensionInstance(row: Record<string, unknown>): ExtensionInstanceRecord {
    const record: ExtensionInstanceRecord = {
      id: row.id as string,
      extensionName: row.extensionName as string,
      config: JSON.parse(row.config as string),
      status: row.status as ExtensionInstanceRecord['status'],
      createdBy: row.createdBy as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.createdByAgent) record.createdByAgent = row.createdByAgent as string;
    if (row.translations) record.translations = JSON.parse(row.translations as string);
    return record;
  }

  // ══════════════════════════════════════════════════════════
  // ── Federation Peers (persisted active peer connections) ──
  // ══════════════════════════════════════════════════════════

  async saveFederationPeer(peer: FederationPeerRecord): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO federation_peers (nodeId, url, publicKey, status, addedAt, lastSeen, shareCatalogue, replicateMemory, allowRouting, peerMode, allowFederatedAuth, federationAuthScopes, tier, availability, expiresAt, heartbeatOk, heartbeatTotal, availabilityWindow, availabilityPct, softwareVersion, nodeCardHash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(peer.nodeId, peer.url, peer.publicKey, peer.status, peer.addedAt, peer.lastSeen,
      peer.shareCatalogue ? 1 : 0, peer.replicateMemory ? 1 : 0, peer.allowRouting ? 1 : 0,
      peer.peerMode || 'federation', peer.allowFederatedAuth ? 1 : 0,
      (peer.federationAuthScopes ?? []).join(','),
      peer.tier ?? 'member', peer.availability ?? null, peer.expiresAt ?? null,
      peer.heartbeatOk ?? 0, peer.heartbeatTotal ?? 0, peer.availabilityWindow ?? null, peer.availabilityPct ?? null,
      peer.softwareVersion ?? null, peer.nodeCardHash ?? null);
  }

  async listFederationPeers(): Promise<FederationPeerRecord[]> {
    const rows = this.db.prepare('SELECT * FROM federation_peers').all() as Record<string, unknown>[];
    return rows.map(r => ({
      nodeId: r.nodeId as string,
      url: r.url as string,
      publicKey: r.publicKey as string,
      status: r.status as string,
      addedAt: r.addedAt as string,
      lastSeen: r.lastSeen as string,
      shareCatalogue: r.shareCatalogue === 1,
      replicateMemory: r.replicateMemory === 1,
      allowRouting: r.allowRouting === 1,
      peerMode: (r.peerMode as FederationPeerRecord['peerMode']) || 'federation',
      allowFederatedAuth: r.allowFederatedAuth === 1,
      federationAuthScopes: ((r.federationAuthScopes as string) || '').split(',').filter(Boolean),
      tier: (r.tier as FederationPeerRecord['tier']) || 'member',
      availability: (r.availability as FederationPeerRecord['availability']) ?? null,
      expiresAt: (r.expiresAt as string) ?? null,
      heartbeatOk: (r.heartbeatOk as number) ?? 0,
      heartbeatTotal: (r.heartbeatTotal as number) ?? 0,
      availabilityWindow: (r.availabilityWindow as string) ?? null,
      availabilityPct: r.availabilityPct == null ? null : (r.availabilityPct as number),
      softwareVersion: (r.softwareVersion as string) ?? null,
      nodeCardHash: (r.nodeCardHash as string) ?? null,
    }));
  }

  async deleteFederationPeer(nodeId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM federation_peers WHERE nodeId = ?').run(nodeId);
    return result.changes > 0;
  }

  // ══════════════════════════════════════════════════════════
  // ── Replication Queue (B.1) ──
  // ══════════════════════════════════════════════════════════

  async enqueueReplication(entry: Omit<ReplicationQueueEntry, 'id' | 'attempts' | 'lastAttemptAt' | 'status'>): Promise<string> {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO replication_queue (id, type, targetPeers, payload, createdAt, attempts, lastAttemptAt, status)
       VALUES (?, ?, ?, ?, ?, 0, NULL, 'pending')`
    ).run(
      id,
      entry.type,
      JSON.stringify(entry.targetPeers),
      JSON.stringify(entry.payload),
      entry.createdAt,
    );
    return id;
  }

  async dequeueReplication(peerId: string, limit: number): Promise<ReplicationQueueEntry[]> {
    // Fetch all pending entries ordered by creation time
    const rows = this.db.prepare(
      `SELECT * FROM replication_queue WHERE status = 'pending' ORDER BY createdAt ASC`
    ).all() as Record<string, unknown>[];
    const results: ReplicationQueueEntry[] = [];
    for (const row of rows) {
      const peers = JSON.parse(row.targetPeers as string) as string[];
      if (peers.includes(peerId)) {
        results.push(this.deserializeReplicationEntry(row));
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  async markReplicationSent(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE replication_queue SET status = 'sent' WHERE id IN (${placeholders})`
    ).run(...ids);
  }

  async markReplicationFailed(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `UPDATE replication_queue SET status = 'failed', attempts = attempts + 1, lastAttemptAt = ? WHERE id = ?`
    );
    for (const id of ids) {
      stmt.run(now, id);
    }
  }

  async pruneReplicationQueue(maxAge: Date): Promise<number> {
    const maxAgeIso = maxAge.toISOString();
    const result = this.db.prepare(
      `DELETE FROM replication_queue WHERE createdAt < ? OR status = 'sent'`
    ).run(maxAgeIso);
    return result.changes;
  }

  async replicationQueueSize(): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM replication_queue').get() as { cnt: number };
    return row.cnt;
  }

  private deserializeReplicationEntry(row: Record<string, unknown>): ReplicationQueueEntry {
    return {
      id: row.id as string,
      type: row.type as ReplicationQueueEntry['type'],
      targetPeers: JSON.parse(row.targetPeers as string),
      payload: row.payload ? JSON.parse(row.payload as string) : null,
      createdAt: row.createdAt as string,
      attempts: row.attempts as number,
      lastAttemptAt: (row.lastAttemptAt as string) || null,
      status: row.status as ReplicationQueueEntry['status'],
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── Device Authorization (RFC 8628) ──
  // ══════════════════════════════════════════════════════════

  async createDeviceAuth(req: DeviceAuthorizationRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO device_auth (deviceCode, userCode, ownerName, agentName, displayName, description, status, scopes, createdAt, expiresAt, lastPolledAt, pollInterval, approvedBy, agentCredentials, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.deviceCode, req.userCode, req.ownerName, req.agentName,
      req.displayName ?? null, req.description ?? null,
      req.status, req.scopes ? JSON.stringify(req.scopes) : null,
      req.createdAt, req.expiresAt, req.lastPolledAt ?? null,
      req.pollInterval, req.approvedBy ?? null,
      req.agentCredentials ? JSON.stringify(req.agentCredentials) : null,
      req.mode ?? 'interactive',
    );
  }

  async getDeviceAuthByDeviceCode(deviceCode: string): Promise<DeviceAuthorizationRecord | null> {
    const row = this.db.prepare('SELECT * FROM device_auth WHERE deviceCode = ?').get(deviceCode) as Record<string, unknown> | undefined;
    return row ? this.deserializeDeviceAuth(row) : null;
  }

  async getDeviceAuthByUserCode(userCode: string): Promise<DeviceAuthorizationRecord | null> {
    const row = this.db.prepare('SELECT * FROM device_auth WHERE userCode = ?').get(userCode) as Record<string, unknown> | undefined;
    return row ? this.deserializeDeviceAuth(row) : null;
  }

  async updateDeviceAuth(deviceCode: string, updates: Partial<DeviceAuthorizationRecord>): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.scopes !== undefined) { fields.push('scopes = ?'); values.push(JSON.stringify(updates.scopes)); }
    if (updates.lastPolledAt !== undefined) { fields.push('lastPolledAt = ?'); values.push(updates.lastPolledAt); }
    if (updates.pollInterval !== undefined) { fields.push('pollInterval = ?'); values.push(updates.pollInterval); }
    if (updates.approvedBy !== undefined) { fields.push('approvedBy = ?'); values.push(updates.approvedBy); }
    if ('agentCredentials' in updates) { fields.push('agentCredentials = ?'); values.push(updates.agentCredentials ? JSON.stringify(updates.agentCredentials) : null); }
    if (fields.length === 0) return;
    values.push(deviceCode);
    this.db.prepare(`UPDATE device_auth SET ${fields.join(', ')} WHERE deviceCode = ?`).run(...values);
  }

  async countPendingDeviceAuthByOwner(ownerName: string): Promise<number> {
    const row = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM device_auth WHERE ownerName = ? AND status = 'pending' AND expiresAt > ?`
    ).get(ownerName, new Date().toISOString()) as { cnt: number };
    return row.cnt;
  }

  async listPendingDeviceAuthByOwner(ownerName: string): Promise<DeviceAuthorizationRecord[]> {
    const rows = this.db.prepare(
      `SELECT * FROM device_auth WHERE ownerName = ? AND status = 'pending' AND expiresAt > ? ORDER BY createdAt DESC`
    ).all(ownerName, new Date().toISOString()) as Record<string, unknown>[];
    return rows.map(row => this.deserializeDeviceAuth(row));
  }

  async cleanupExpiredDeviceAuth(): Promise<number> {
    const result = this.db.prepare(
      `DELETE FROM device_auth WHERE status = 'pending' AND expiresAt <= ?`
    ).run(new Date().toISOString());
    return result.changes;
  }

  async deleteDeviceAuthByOwner(ownerName: string): Promise<number> {
    const result = this.db.prepare(`DELETE FROM device_auth WHERE ownerName = ?`).run(ownerName);
    return result.changes;
  }

  // ── Ecosystem Applications (GEAI) + hello-integration handshake ──
  async createEcosystemApp(app: EcosystemAppRecord): Promise<EcosystemAppRecord> {
    return ecosystemAppRepo.createEcosystemApp(this.db, app);
  }
  async getEcosystemApp(geai: string): Promise<EcosystemAppRecord | null> {
    return ecosystemAppRepo.getEcosystemApp(this.db, geai);
  }
  async getEcosystemAppByOwnerAndApp(owner: string, app: string): Promise<EcosystemAppRecord | null> {
    return ecosystemAppRepo.getEcosystemAppByOwnerAndApp(this.db, owner, app);
  }
  async getEcosystemAppsByOwner(owner: string): Promise<EcosystemAppRecord[]> {
    return ecosystemAppRepo.getEcosystemAppsByOwner(this.db, owner);
  }
  async updateEcosystemApp(geai: string, updates: Partial<EcosystemAppRecord>): Promise<EcosystemAppRecord | null> {
    return ecosystemAppRepo.updateEcosystemApp(this.db, geai, updates);
  }
  async deleteEcosystemApp(geai: string): Promise<boolean> {
    return ecosystemAppRepo.deleteEcosystemApp(this.db, geai);
  }
  async createEcoAuth(req: EcoAuthorizationRecord): Promise<void> {
    return ecosystemAppRepo.createEcoAuth(this.db, req);
  }
  async getEcoAuthByDeviceCode(deviceCode: string): Promise<EcoAuthorizationRecord | null> {
    return ecosystemAppRepo.getEcoAuthByDeviceCode(this.db, deviceCode);
  }
  async getEcoAuthByUserCode(userCode: string): Promise<EcoAuthorizationRecord | null> {
    return ecosystemAppRepo.getEcoAuthByUserCode(this.db, userCode);
  }
  async updateEcoAuth(deviceCode: string, updates: Partial<EcoAuthorizationRecord>): Promise<void> {
    return ecosystemAppRepo.updateEcoAuth(this.db, deviceCode, updates);
  }
  async countPendingEcoAuthByOwner(ownerName: string): Promise<number> {
    return ecosystemAppRepo.countPendingEcoAuthByOwner(this.db, ownerName);
  }
  async listPendingEcoAuthByOwner(ownerName: string): Promise<EcoAuthorizationRecord[]> {
    return ecosystemAppRepo.listPendingEcoAuthByOwner(this.db, ownerName);
  }
  async cleanupExpiredEcoAuth(): Promise<number> {
    return ecosystemAppRepo.cleanupExpiredEcoAuth(this.db);
  }
  async getAutomationRecipe(owner: string, app: string): Promise<EcoAutomationRecipe | null> {
    return ecosystemAppRepo.getAutomationRecipe(this.db, owner, app);
  }
  async upsertAutomationRecipe(recipe: EcoAutomationRecipe): Promise<EcoAutomationRecipe> {
    return ecosystemAppRepo.upsertAutomationRecipe(this.db, recipe);
  }
  async deleteAutomationRecipe(owner: string, app: string): Promise<boolean> {
    return ecosystemAppRepo.deleteAutomationRecipe(this.db, owner, app);
  }
  async listAutomationRecipesByOwner(owner: string): Promise<EcoAutomationRecipe[]> {
    return ecosystemAppRepo.listAutomationRecipesByOwner(this.db, owner);
  }

  private deserializeDeviceAuth(row: Record<string, unknown>): DeviceAuthorizationRecord {
    return {
      deviceCode: row.deviceCode as string,
      userCode: row.userCode as string,
      ownerName: row.ownerName as string,
      agentName: row.agentName as string,
      displayName: row.displayName as string | undefined,
      description: row.description as string | undefined,
      status: row.status as DeviceAuthorizationRecord['status'],
      scopes: row.scopes ? JSON.parse(row.scopes as string) : undefined,
      createdAt: row.createdAt as string,
      expiresAt: row.expiresAt as string,
      lastPolledAt: row.lastPolledAt as string | undefined,
      pollInterval: row.pollInterval as number,
      approvedBy: row.approvedBy as string | undefined,
      agentCredentials: row.agentCredentials ? JSON.parse(row.agentCredentials as string) : undefined,
      mode: row.mode ? (row.mode as DeviceAuthorizationRecord['mode']) : undefined,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ── OAuth 2.1 Persistent State ──
  // ══════════════════════════════════════════════════════════

  // ── Clients ──

  async createOAuthClient(client: OAuthClientRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO oauth_clients (clientId, clientSecret, clientName, redirectUris, createdAt)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      client.clientId, client.clientSecret, client.clientName,
      JSON.stringify(client.redirectUris), client.createdAt,
    );
  }

  async getOAuthClient(clientId: string): Promise<OAuthClientRecord | null> {
    const row = this.db.prepare('SELECT * FROM oauth_clients WHERE clientId = ?').get(clientId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      clientId: row.clientId as string,
      clientSecret: row.clientSecret as string,
      clientName: row.clientName as string,
      redirectUris: JSON.parse(row.redirectUris as string),
      createdAt: row.createdAt as string,
    };
  }

  async deleteOAuthClient(clientId: string): Promise<boolean> {
    const txn = this.db.transaction(() => {
      this.db.prepare('DELETE FROM oauth_refresh_tokens WHERE clientId = ?').run(clientId);
      this.db.prepare('DELETE FROM oauth_approvals WHERE clientId = ?').run(clientId);
      const result = this.db.prepare('DELETE FROM oauth_clients WHERE clientId = ?').run(clientId);
      return result.changes > 0;
    });
    return txn();
  }

  async listOAuthClients(): Promise<OAuthClientRecord[]> {
    const rows = this.db.prepare('SELECT * FROM oauth_clients ORDER BY createdAt DESC').all() as Record<string, unknown>[];
    return rows.map(row => ({
      clientId: row.clientId as string,
      clientSecret: row.clientSecret as string,
      clientName: row.clientName as string,
      redirectUris: JSON.parse(row.redirectUris as string),
      createdAt: row.createdAt as string,
    }));
  }

  // ── Refresh Tokens ──

  async createOAuthRefreshToken(token: OAuthRefreshTokenRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO oauth_refresh_tokens (tokenHash, clientId, gaii, owner, roles, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      token.tokenHash, token.clientId, token.gaii, token.owner,
      JSON.stringify(token.roles), token.createdAt,
    );
  }

  async getOAuthRefreshToken(tokenHash: string): Promise<OAuthRefreshTokenRecord | null> {
    const row = this.db.prepare('SELECT * FROM oauth_refresh_tokens WHERE tokenHash = ?').get(tokenHash) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      tokenHash: row.tokenHash as string,
      clientId: row.clientId as string,
      gaii: row.gaii as string,
      owner: row.owner as string,
      roles: JSON.parse(row.roles as string),
      createdAt: row.createdAt as string,
    };
  }

  async deleteOAuthRefreshToken(tokenHash: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM oauth_refresh_tokens WHERE tokenHash = ?').run(tokenHash);
    return result.changes > 0;
  }

  async deleteOAuthRefreshTokensByClient(clientId: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM oauth_refresh_tokens WHERE clientId = ?').run(clientId);
    return result.changes;
  }

  async deleteOAuthRefreshTokensByGaii(gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM oauth_refresh_tokens WHERE gaii = ?').run(gaii);
    return result.changes;
  }

  // ── Approvals ──

  async createOAuthApproval(approval: OAuthApprovalRecord): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO oauth_approvals (clientId, gaii, owner, scope, approvedAt)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      approval.clientId, approval.gaii, approval.owner,
      approval.scope, approval.approvedAt,
    );
  }

  async getOAuthApproval(clientId: string, gaii: string): Promise<OAuthApprovalRecord | null> {
    const row = this.db.prepare('SELECT * FROM oauth_approvals WHERE clientId = ? AND gaii = ?').get(clientId, gaii) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      clientId: row.clientId as string,
      gaii: row.gaii as string,
      owner: row.owner as string,
      scope: row.scope as string,
      approvedAt: row.approvedAt as string,
    };
  }

  async deleteOAuthApproval(clientId: string, gaii: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM oauth_approvals WHERE clientId = ? AND gaii = ?').run(clientId, gaii);
    return result.changes > 0;
  }

  async deleteOAuthApprovalsByClient(clientId: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM oauth_approvals WHERE clientId = ?').run(clientId);
    return result.changes;
  }

  async deleteOAuthApprovalsByGaii(gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM oauth_approvals WHERE gaii = ?').run(gaii);
    return result.changes;
  }

  async listOAuthApprovalsByOwner(owner: string): Promise<OAuthApprovalRecord[]> {
    const rows = this.db.prepare('SELECT * FROM oauth_approvals WHERE owner = ? ORDER BY approvedAt DESC').all(owner) as Record<string, unknown>[];
    return rows.map(row => ({
      clientId: row.clientId as string,
      gaii: row.gaii as string,
      owner: row.owner as string,
      scope: row.scope as string,
      approvedAt: row.approvedAt as string,
    }));
  }

  // ── System Prompts ────────────────────────────────────────────────

  private deserializeSystemPrompt(row: Record<string, unknown>): SystemPromptRecord {
    return {
      id: row.id as string,
      group: row.grp as string,
      name: row.name as string,
      description: row.description as string,
      content: row.content as string,
      locales: row.locales ? JSON.parse(row.locales as string) : undefined,
      active: row.active === 1,
      variables: JSON.parse(row.variables as string),
      usedIn: JSON.parse(row.usedIn as string),
      version: row.version as number,
      updatedAt: row.updatedAt as string,
      updatedBy: row.updatedBy as string,
    };
  }

  private deserializeSystemPromptVersion(row: Record<string, unknown>): SystemPromptVersionRecord {
    return {
      promptId: row.promptId as string,
      version: row.version as number,
      content: row.content as string,
      locales: row.locales ? JSON.parse(row.locales as string) : undefined,
      changedBy: row.changedBy as string,
      changedAt: row.changedAt as string,
      changeNote: row.changeNote as string | undefined,
    };
  }

  async listSystemPrompts(opts?: { group?: string }): Promise<SystemPromptRecord[]> {
    const sql = opts?.group
      ? 'SELECT * FROM system_prompts WHERE grp = ? ORDER BY grp, name'
      : 'SELECT * FROM system_prompts ORDER BY grp, name';
    const rows = (opts?.group
      ? this.db.prepare(sql).all(opts.group)
      : this.db.prepare(sql).all()) as Record<string, unknown>[];
    return rows.map(r => this.deserializeSystemPrompt(r));
  }

  async getSystemPrompt(id: string): Promise<SystemPromptRecord | null> {
    const row = this.db.prepare('SELECT * FROM system_prompts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeSystemPrompt(row) : null;
  }

  async upsertSystemPrompt(record: SystemPromptRecord): Promise<SystemPromptRecord> {
    this.db.prepare(
      `INSERT INTO system_prompts (id, grp, name, description, content, locales, active, variables, usedIn, version, updatedAt, updatedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         grp = excluded.grp, name = excluded.name, description = excluded.description,
         content = excluded.content, locales = excluded.locales, active = excluded.active,
         variables = excluded.variables, usedIn = excluded.usedIn, version = excluded.version,
         updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy`
    ).run(
      record.id, record.group, record.name, record.description, record.content,
      record.locales ? JSON.stringify(record.locales) : null,
      record.active ? 1 : 0,
      JSON.stringify(record.variables), JSON.stringify(record.usedIn),
      record.version, record.updatedAt, record.updatedBy,
    );
    return record;
  }

  async getSystemPromptVersions(promptId: string): Promise<SystemPromptVersionRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM system_prompt_versions WHERE promptId = ? ORDER BY version DESC'
    ).all(promptId) as Record<string, unknown>[];
    return rows.map(r => this.deserializeSystemPromptVersion(r));
  }

  async getSystemPromptVersion(promptId: string, version: number): Promise<SystemPromptVersionRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM system_prompt_versions WHERE promptId = ? AND version = ?'
    ).get(promptId, version) as Record<string, unknown> | undefined;
    return row ? this.deserializeSystemPromptVersion(row) : null;
  }

  async createSystemPromptVersion(record: SystemPromptVersionRecord): Promise<SystemPromptVersionRecord> {
    this.db.prepare(
      `INSERT INTO system_prompt_versions (promptId, version, content, locales, changedBy, changedAt, changeNote)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.promptId, record.version, record.content,
      record.locales ? JSON.stringify(record.locales) : null,
      record.changedBy, record.changedAt, record.changeNote ?? null,
    );
    return record;
  }

  async pruneSystemPromptVersions(promptId: string, keepCount: number): Promise<number> {
    const result = this.db.prepare(
      `DELETE FROM system_prompt_versions WHERE promptId = ? AND version NOT IN (
         SELECT version FROM system_prompt_versions WHERE promptId = ? ORDER BY version DESC LIMIT ?
       )`
    ).run(promptId, promptId, keepCount);
    return result.changes;
  }

  async deleteAllSystemPrompts(): Promise<void> {
    this.db.prepare('DELETE FROM system_prompt_versions').run();
    this.db.prepare('DELETE FROM system_prompts').run();
  }

  // ══════════════════════════════════════════════════════════
  // ── Packages ──
  // ══════════════════════════════════════════════════════════

  private deserializePackage(row: Record<string, unknown>): PackageRecord {
    return {
      id: row.id as string,
      packageGroupId: row.packageGroupId as string,
      name: row.name as string,
      author: row.author as string,
      authorGhii: row.authorGhii as string,
      version: row.version as string,
      changelog: row.changelog as string,
      description: row.description as string,
      category: row.category as string,
      tags: JSON.parse(row.tags as string) as string[],
      visibility: row.visibility as PackageRecord['visibility'],
      status: row.status as PackageRecord['status'],
      components: JSON.parse(row.components as string) as PackageComponent[],
      manifest: row.manifest as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  }

  async createPackage(record: PackageRecord): Promise<PackageRecord> {
    try {
      this.db.prepare(
        `INSERT INTO packages (id, packageGroupId, name, author, authorGhii, version, changelog, description, category, tags, visibility, status, components, manifest, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id, record.packageGroupId, record.name, record.author,
        record.authorGhii, record.version, record.changelog, record.description,
        record.category, JSON.stringify(record.tags), record.visibility,
        record.status, JSON.stringify(record.components), record.manifest,
        record.createdAt, record.updatedAt,
      );
    } catch (e: any) {
      if (e.message?.includes('UNIQUE constraint failed')) {
        throw new Error('PACKAGE_EXISTS', { cause: e });
      }
      throw e;
    }
    return record;
  }

  async getPackage(id: string): Promise<PackageRecord | null> {
    const row = this.db.prepare('SELECT * FROM packages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializePackage(row) : null;
  }

  async getPackageByGroupAndVersion(groupId: string, version: string): Promise<PackageRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM packages WHERE packageGroupId = ? AND version = ?'
    ).get(groupId, version) as Record<string, unknown> | undefined;
    return row ? this.deserializePackage(row) : null;
  }

  async getLatestPublished(groupId: string): Promise<PackageRecord | null> {
    const row = this.db.prepare(
      `SELECT * FROM packages WHERE packageGroupId = ? AND status = 'published' ORDER BY version DESC LIMIT 1`
    ).get(groupId) as Record<string, unknown> | undefined;
    return row ? this.deserializePackage(row) : null;
  }

  async listPackages(filter: PackageFilter): Promise<{ packages: PackageRecord[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.author) { conditions.push('author = ?'); params.push(filter.author); }
    if (filter.category) { conditions.push('category = ?'); params.push(filter.category); }
    if (filter.status) { conditions.push('status = ?'); params.push(filter.status); }
    if (filter.visibility) { conditions.push('visibility = ?'); params.push(filter.visibility); }
    if (filter.search) {
      conditions.push('(name LIKE ? OR description LIKE ? OR tags LIKE ?)');
      const s = `%${filter.search}%`;
      params.push(s, s, s);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const total = (this.db.prepare(`SELECT COUNT(*) as c FROM packages ${where}`).get(...params) as { c: number }).c;
    const rows = this.db.prepare(
      `SELECT * FROM packages ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as Record<string, unknown>[];

    return { packages: rows.map(r => this.deserializePackage(r)), total };
  }

  async listVersions(groupId: string, limit?: number, offset?: number): Promise<{ versions: PackageRecord[]; total: number }> {
    const lim = limit ?? 50;
    const off = offset ?? 0;
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM packages WHERE packageGroupId = ?').get(groupId) as { c: number }).c;
    const rows = this.db.prepare(
      'SELECT * FROM packages WHERE packageGroupId = ? ORDER BY version DESC LIMIT ? OFFSET ?'
    ).all(groupId, lim, off) as Record<string, unknown>[];
    return { versions: rows.map(r => this.deserializePackage(r)), total };
  }

  async updatePackage(id: string, updates: Partial<PackageRecord>): Promise<PackageRecord | null> {
    const existing = await this.getPackage(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates, id };
    this.db.prepare(
      `UPDATE packages SET packageGroupId = ?, name = ?, author = ?, authorGhii = ?, version = ?,
       changelog = ?, description = ?, category = ?, tags = ?, visibility = ?, status = ?,
       components = ?, manifest = ?, updatedAt = ? WHERE id = ?`
    ).run(
      merged.packageGroupId, merged.name, merged.author, merged.authorGhii, merged.version,
      merged.changelog, merged.description, merged.category, JSON.stringify(merged.tags),
      merged.visibility, merged.status, JSON.stringify(merged.components), merged.manifest,
      merged.updatedAt, id,
    );
    return merged;
  }

  async archivePackage(id: string): Promise<boolean> {
    const result = this.db.prepare(
      `UPDATE packages SET status = 'archived', updatedAt = ? WHERE id = ?`
    ).run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  async archivePackageGroup(groupId: string): Promise<number> {
    const result = this.db.prepare(
      `UPDATE packages SET status = 'archived', updatedAt = ? WHERE packageGroupId = ? AND status != 'archived'`
    ).run(new Date().toISOString(), groupId);
    return result.changes;
  }

  // ══════════════════════════════════════════════════════════
  // ── Template Listings ──
  // ══════════════════════════════════════════════════════════

  private deserializeTemplateListing(row: Record<string, unknown>): TemplateListingRecord {
    return {
      id: row.id as string,
      packageGroupId: row.packageGroupId as string,
      packageName: row.packageName as string,
      packageAuthor: row.packageAuthor as string,
      publishedBy: row.publishedBy as string,
      publishedByGhii: row.publishedByGhii as string,
      title: row.title as string,
      description: row.description as string,
      screenshots: JSON.parse(row.screenshots as string) as string[],
      category: row.category as string,
      tags: JSON.parse(row.tags as string) as string[],
      featured: !!(row.featured as number),
      installCount: row.installCount as number,
      rating: row.rating as number,
      reviewCount: row.reviewCount as number,
      status: row.status as TemplateListingRecord['status'],
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
      ...(row.rejectionReason ? { rejectionReason: row.rejectionReason as string } : {}),
      ...(row.reviewedBy ? { reviewedBy: row.reviewedBy as string } : {}),
      ...(row.reviewedAt ? { reviewedAt: row.reviewedAt as string } : {}),
      ...(row.reviewComment ? { reviewComment: row.reviewComment as string } : {}),
      ...(row.proposedAt ? { proposedAt: row.proposedAt as string } : {}),
      ...(row.proposedBy ? { proposedBy: row.proposedBy as string } : {}),
    };
  }

  private deserializeReview(row: Record<string, unknown>): TemplateReview {
    return {
      id: row.id as string,
      listingId: row.listingId as string,
      authorGhii: row.authorGhii as string,
      authorName: row.authorName as string,
      rating: row.rating as number,
      comment: row.comment as string,
      createdAt: row.createdAt as string,
    };
  }

  private deserializeDiscussion(row: Record<string, unknown>): TemplateDiscussion {
    return {
      id: row.id as string,
      listingId: row.listingId as string,
      authorGhii: row.authorGhii as string,
      authorName: row.authorName as string,
      message: row.message as string,
      parentId: row.parentId as string | undefined,
      createdAt: row.createdAt as string,
    };
  }

  async createTemplateListing(record: TemplateListingRecord): Promise<TemplateListingRecord> {
    this.db.prepare(
      `INSERT INTO template_listings (id, packageGroupId, packageName, packageAuthor, publishedBy, publishedByGhii, title, description, screenshots, category, tags, featured, installCount, rating, reviewCount, status, createdAt, updatedAt, rejectionReason, reviewedBy, reviewedAt, reviewComment, proposedAt, proposedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.packageGroupId, record.packageName, record.packageAuthor,
      record.publishedBy, record.publishedByGhii, record.title, record.description,
      JSON.stringify(record.screenshots), record.category, JSON.stringify(record.tags),
      record.featured ? 1 : 0, record.installCount, record.rating, record.reviewCount,
      record.status, record.createdAt, record.updatedAt,
      record.rejectionReason ?? null, record.reviewedBy ?? null, record.reviewedAt ?? null,
      record.reviewComment ?? null, record.proposedAt ?? null, record.proposedBy ?? null,
    );
    return record;
  }

  async getTemplateListing(id: string): Promise<TemplateListingRecord | null> {
    const row = this.db.prepare('SELECT * FROM template_listings WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeTemplateListing(row) : null;
  }

  async getListingByPackage(packageGroupId: string): Promise<TemplateListingRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM template_listings WHERE packageGroupId = ?'
    ).get(packageGroupId) as Record<string, unknown> | undefined;
    return row ? this.deserializeTemplateListing(row) : null;
  }

  async listTemplateListings(filter: TemplateFilter): Promise<{ listings: TemplateListingRecord[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.category) { conditions.push('category = ?'); params.push(filter.category); }
    if (filter.tags && filter.tags.length > 0) {
      const tagConditions = filter.tags.map(() => 'tags LIKE ?');
      conditions.push(`(${tagConditions.join(' AND ')})`);
      for (const tag of filter.tags) params.push(`%${tag}%`);
    }
    if (filter.featured !== undefined) { conditions.push('featured = ?'); params.push(filter.featured ? 1 : 0); }
    if (filter.status) { conditions.push('status = ?'); params.push(filter.status); }
    if (filter.search) {
      conditions.push('(title LIKE ? OR description LIKE ? OR tags LIKE ?)');
      const s = `%${filter.search}%`;
      params.push(s, s, s);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    let orderBy: string;
    switch (filter.sort) {
      case 'rating': orderBy = 'rating DESC'; break;
      case 'installs': orderBy = 'installCount DESC'; break;
      case 'newest': orderBy = 'createdAt DESC'; break;
      default: orderBy = 'createdAt DESC';
    }

    const total = (this.db.prepare(`SELECT COUNT(*) as c FROM template_listings ${where}`).get(...params) as { c: number }).c;
    const rows = this.db.prepare(
      `SELECT * FROM template_listings ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as Record<string, unknown>[];

    return { listings: rows.map(r => this.deserializeTemplateListing(r)), total };
  }

  async updateTemplateListing(id: string, updates: Partial<TemplateListingRecord>): Promise<TemplateListingRecord | null> {
    const existing = await this.getTemplateListing(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates, id };
    this.db.prepare(
      `UPDATE template_listings SET packageGroupId = ?, packageName = ?, packageAuthor = ?,
       publishedBy = ?, publishedByGhii = ?, title = ?, description = ?, screenshots = ?,
       category = ?, tags = ?, featured = ?, installCount = ?, rating = ?, reviewCount = ?,
       status = ?, updatedAt = ?, rejectionReason = ?, reviewedBy = ?, reviewedAt = ?,
       reviewComment = ?, proposedAt = ?, proposedBy = ? WHERE id = ?`
    ).run(
      merged.packageGroupId, merged.packageName, merged.packageAuthor,
      merged.publishedBy, merged.publishedByGhii, merged.title, merged.description,
      JSON.stringify(merged.screenshots), merged.category, JSON.stringify(merged.tags),
      merged.featured ? 1 : 0, merged.installCount, merged.rating, merged.reviewCount,
      merged.status, merged.updatedAt, merged.rejectionReason ?? null,
      merged.reviewedBy ?? null, merged.reviewedAt ?? null, merged.reviewComment ?? null,
      merged.proposedAt ?? null, merged.proposedBy ?? null, id,
    );
    return merged;
  }

  async deleteTemplateListing(id: string): Promise<boolean> {
    this.db.prepare('DELETE FROM template_reviews WHERE listingId = ?').run(id);
    this.db.prepare('DELETE FROM template_discussions WHERE listingId = ?').run(id);
    const result = this.db.prepare('DELETE FROM template_listings WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async incrementInstallCount(listingId: string): Promise<void> {
    this.db.prepare('UPDATE template_listings SET installCount = installCount + 1 WHERE id = ?').run(listingId);
  }

  async listPendingTemplates(limit = 20, offset = 0): Promise<TemplateListingRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM template_listings WHERE status = ? ORDER BY createdAt ASC LIMIT ? OFFSET ?'
    ).all('pending_review', limit, offset) as Record<string, unknown>[];
    return rows.map(r => this.deserializeTemplateListing(r));
  }

  async addReview(review: TemplateReview): Promise<TemplateReview> {
    this.db.prepare(
      `INSERT OR REPLACE INTO template_reviews (id, listingId, authorGhii, authorName, rating, comment, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      review.id, review.listingId, review.authorGhii, review.authorName,
      review.rating, review.comment, review.createdAt,
    );
    await this.recalculateRating(review.listingId);
    return review;
  }

  async getReviewsByListing(listingId: string, limit?: number, offset?: number): Promise<{ reviews: TemplateReview[]; total: number }> {
    const lim = limit ?? 50;
    const off = offset ?? 0;
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM template_reviews WHERE listingId = ?').get(listingId) as { c: number }).c;
    const rows = this.db.prepare(
      'SELECT * FROM template_reviews WHERE listingId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?'
    ).all(listingId, lim, off) as Record<string, unknown>[];
    return { reviews: rows.map(r => this.deserializeReview(r)), total };
  }

  async getReviewByAuthor(listingId: string, authorGhii: string): Promise<TemplateReview | null> {
    const row = this.db.prepare(
      'SELECT * FROM template_reviews WHERE listingId = ? AND authorGhii = ?'
    ).get(listingId, authorGhii) as Record<string, unknown> | undefined;
    return row ? this.deserializeReview(row) : null;
  }

  async updateReview(id: string, updates: Partial<TemplateReview>): Promise<TemplateReview | null> {
    const row = this.db.prepare('SELECT * FROM template_reviews WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const existing = this.deserializeReview(row);
    const merged = { ...existing, ...updates, id };
    this.db.prepare(
      'UPDATE template_reviews SET rating = ?, comment = ? WHERE id = ?'
    ).run(merged.rating, merged.comment, id);
    await this.recalculateRating(merged.listingId);
    return merged;
  }

  async deleteReview(id: string): Promise<boolean> {
    const row = this.db.prepare('SELECT * FROM template_reviews WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return false;
    const listingId = row.listingId as string;
    const result = this.db.prepare('DELETE FROM template_reviews WHERE id = ?').run(id);
    if (result.changes > 0) {
      await this.recalculateRating(listingId);
      return true;
    }
    return false;
  }

  async recalculateRating(listingId: string): Promise<{ rating: number; reviewCount: number }> {
    const stats = this.db.prepare(
      'SELECT AVG(rating) as avg, COUNT(*) as cnt FROM template_reviews WHERE listingId = ?'
    ).get(listingId) as { avg: number | null; cnt: number };
    const rating = stats.avg ?? 0;
    const reviewCount = stats.cnt;
    this.db.prepare(
      'UPDATE template_listings SET rating = ?, reviewCount = ? WHERE id = ?'
    ).run(rating, reviewCount, listingId);
    return { rating, reviewCount };
  }

  async addDiscussion(discussion: TemplateDiscussion): Promise<TemplateDiscussion> {
    this.db.prepare(
      `INSERT INTO template_discussions (id, listingId, authorGhii, authorName, message, parentId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      discussion.id, discussion.listingId, discussion.authorGhii, discussion.authorName,
      discussion.message, discussion.parentId ?? null, discussion.createdAt,
    );
    return discussion;
  }

  async getDiscussionsByListing(listingId: string, limit?: number, offset?: number): Promise<{ discussions: TemplateDiscussion[]; total: number }> {
    const lim = limit ?? 50;
    const off = offset ?? 0;
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM template_discussions WHERE listingId = ?').get(listingId) as { c: number }).c;
    const rows = this.db.prepare(
      'SELECT * FROM template_discussions WHERE listingId = ? ORDER BY createdAt ASC LIMIT ? OFFSET ?'
    ).all(listingId, lim, off) as Record<string, unknown>[];
    return { discussions: rows.map(r => this.deserializeDiscussion(r)), total };
  }

  async deleteDiscussion(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM template_discussions WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ══════════════════════════════════════════════════════════
  // ── Package Instances ──
  // ══════════════════════════════════════════════════════════

  private deserializeInstance(row: Record<string, unknown>): PackageInstanceRecord {
    return {
      id: row.id as string,
      packageGroupId: row.packageGroupId as string,
      packageVersion: row.packageVersion as string,
      packageRecordId: row.packageRecordId as string,
      owner: row.owner as string,
      ownerGhii: row.ownerGhii as string,
      label: row.label as string,
      installedComponents: JSON.parse(row.installedComponents as string) as InstalledComponent[],
      status: row.status as PackageInstanceRecord['status'],
      installedAt: row.installedAt as string,
      updatedAt: row.updatedAt as string,
    };
  }

  async createInstance(record: PackageInstanceRecord): Promise<PackageInstanceRecord> {
    this.db.prepare(
      `INSERT INTO package_instances (id, packageGroupId, packageVersion, packageRecordId, owner, ownerGhii, label, installedComponents, status, installedAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.packageGroupId, record.packageVersion, record.packageRecordId,
      record.owner, record.ownerGhii, record.label,
      JSON.stringify(record.installedComponents), record.status,
      record.installedAt, record.updatedAt,
    );
    return record;
  }

  async getInstance(id: string): Promise<PackageInstanceRecord | null> {
    const row = this.db.prepare('SELECT * FROM package_instances WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeInstance(row) : null;
  }

  async listInstances(filter: InstanceFilter): Promise<{ instances: PackageInstanceRecord[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.owner) { conditions.push('owner = ?'); params.push(filter.owner); }
    if (filter.ownerGhii) { conditions.push('ownerGhii = ?'); params.push(filter.ownerGhii); }
    if (filter.packageGroupId) { conditions.push('packageGroupId = ?'); params.push(filter.packageGroupId); }
    if (filter.status) { conditions.push('status = ?'); params.push(filter.status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const total = (this.db.prepare(`SELECT COUNT(*) as c FROM package_instances ${where}`).get(...params) as { c: number }).c;
    const rows = this.db.prepare(
      `SELECT * FROM package_instances ${where} ORDER BY installedAt DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as Record<string, unknown>[];

    return { instances: rows.map(r => this.deserializeInstance(r)), total };
  }

  async updateInstance(id: string, updates: Partial<PackageInstanceRecord>): Promise<PackageInstanceRecord | null> {
    const existing = await this.getInstance(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates, id };
    this.db.prepare(
      `UPDATE package_instances SET packageGroupId = ?, packageVersion = ?, packageRecordId = ?,
       owner = ?, ownerGhii = ?, label = ?, installedComponents = ?, status = ?, updatedAt = ?
       WHERE id = ?`
    ).run(
      merged.packageGroupId, merged.packageVersion, merged.packageRecordId,
      merged.owner, merged.ownerGhii, merged.label,
      JSON.stringify(merged.installedComponents), merged.status, merged.updatedAt, id,
    );
    return merged;
  }

  async deleteInstance(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM package_instances WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async listInstancesByPackage(packageGroupId: string): Promise<{ instances: PackageInstanceRecord[]; total: number }> {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM package_instances WHERE packageGroupId = ?').get(packageGroupId) as { c: number }).c;
    const rows = this.db.prepare(
      'SELECT * FROM package_instances WHERE packageGroupId = ? ORDER BY installedAt DESC'
    ).all(packageGroupId) as Record<string, unknown>[];
    return { instances: rows.map(r => this.deserializeInstance(r)), total };
  }

  // ── Capability Layer ──────────────────────────────────────────────

  private deserializeCapability(row: Record<string, unknown>): CapabilityRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      summary: (row.summary as string) || '',
      ownerGhii: row.ownerGhii as string,
      visibility: row.visibility as CapabilityRecord['visibility'],
      scope: 'local',
      status: row.status as CapabilityRecord['status'],
      rejectionReason: (row.rejectionReason as string) || null,
      deprecationMessage: (row.deprecationMessage as string) || null,
      replacedBy: (row.replacedBy as string) || null,
      source: { type: row.sourceType as string, ref: row.sourceRef as string, version: row.sourceVersion as string } as CapabilityRecord['source'],
      authRequired: row.authRequired as CapabilityRecord['authRequired'],
      callable: row.callable === 1 || row.callable === true,
      inputSchema: row.inputSchema ? JSON.parse(row.inputSchema as string) : null,
      outputSchema: row.outputSchema ? JSON.parse(row.outputSchema as string) : null,
      exports: row.exports ? JSON.parse(row.exports as string) : null,
      usage: (row.usage as string) || '',
      whenToUse: (row.whenToUse as string) || '',
      whenNotToUse: (row.whenNotToUse as string) || '',
      examples: JSON.parse((row.examples as string) || '[]'),
      dependencies: JSON.parse((row.dependencies as string) || '[]'),
      schemaHash: (row.schemaHash as string) || '',
      webhookUrl: (row.webhookUrl as string) || null,
      cost: row.cost ? JSON.parse(row.cost as string) : null,
      trustRequired: row.trustRequired as number | null,
      trust: JSON.parse((row.trust as string) || '{}'),
      redactedFields: JSON.parse((row.redactedFields as string) || '[]'),
      operatorOverride: row.operatorOverride ? JSON.parse(row.operatorOverride as string) : null,
      stats: JSON.parse((row.stats as string) || '{}'),
      tags: JSON.parse((row.tags as string) || '[]'),
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  }

  async createCapability(record: CapabilityRecord): Promise<CapabilityRecord> {
    this.db.prepare(`INSERT INTO capabilities (id, name, summary, ownerGhii, visibility, scope, status,
      rejectionReason, deprecationMessage, replacedBy, sourceType, sourceRef, sourceVersion,
      authRequired, callable, inputSchema, outputSchema, exports, usage, whenToUse, whenNotToUse,
      examples, dependencies, schemaHash, webhookUrl, cost, trustRequired, trust, redactedFields,
      operatorOverride, stats, tags, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.name, record.summary, record.ownerGhii, record.visibility, record.scope, record.status,
      record.rejectionReason, record.deprecationMessage, record.replacedBy,
      record.source.type, record.source.ref, record.source.version,
      record.authRequired, record.callable ? 1 : 0,
      record.inputSchema ? JSON.stringify(record.inputSchema) : null,
      record.outputSchema ? JSON.stringify(record.outputSchema) : null,
      record.exports ? JSON.stringify(record.exports) : null,
      record.usage, record.whenToUse, record.whenNotToUse,
      JSON.stringify(record.examples), JSON.stringify(record.dependencies), record.schemaHash,
      record.webhookUrl,
      record.cost ? JSON.stringify(record.cost) : null,
      record.trustRequired,
      JSON.stringify(record.trust), JSON.stringify(record.redactedFields),
      record.operatorOverride ? JSON.stringify(record.operatorOverride) : null,
      JSON.stringify(record.stats), JSON.stringify(record.tags),
      record.createdAt, record.updatedAt,
    );
    return record;
  }

  async getCapability(id: string): Promise<CapabilityRecord | null> {
    const row = this.db.prepare('SELECT * FROM capabilities WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeCapability(row) : null;
  }

  async updateCapability(id: string, updates: Partial<CapabilityRecord>): Promise<CapabilityRecord | null> {
    const existing = await this.getCapability(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates, updatedAt: updates.updatedAt || new Date().toISOString() };
    if (updates.source) {
      merged.source = { ...existing.source, ...updates.source };
    }
    this.db.prepare(`UPDATE capabilities SET name=?, summary=?, ownerGhii=?, visibility=?, status=?,
      rejectionReason=?, deprecationMessage=?, replacedBy=?, sourceType=?, sourceRef=?, sourceVersion=?,
      authRequired=?, callable=?, inputSchema=?, outputSchema=?, exports=?, usage=?, whenToUse=?, whenNotToUse=?,
      examples=?, dependencies=?, schemaHash=?, webhookUrl=?, cost=?, trustRequired=?, trust=?, redactedFields=?,
      operatorOverride=?, stats=?, tags=?, updatedAt=? WHERE id=?`
    ).run(
      merged.name, merged.summary, merged.ownerGhii, merged.visibility, merged.status,
      merged.rejectionReason, merged.deprecationMessage, merged.replacedBy,
      merged.source.type, merged.source.ref, merged.source.version,
      merged.authRequired, merged.callable ? 1 : 0,
      merged.inputSchema ? JSON.stringify(merged.inputSchema) : null,
      merged.outputSchema ? JSON.stringify(merged.outputSchema) : null,
      merged.exports ? JSON.stringify(merged.exports) : null,
      merged.usage, merged.whenToUse, merged.whenNotToUse,
      JSON.stringify(merged.examples), JSON.stringify(merged.dependencies), merged.schemaHash,
      merged.webhookUrl,
      merged.cost ? JSON.stringify(merged.cost) : null,
      merged.trustRequired,
      JSON.stringify(merged.trust), JSON.stringify(merged.redactedFields),
      merged.operatorOverride ? JSON.stringify(merged.operatorOverride) : null,
      JSON.stringify(merged.stats), JSON.stringify(merged.tags),
      merged.updatedAt, id,
    );
    return merged;
  }

  async deleteCapability(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM capabilities WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async listCapabilities(filters: import('../../interface.js').CapabilityFilter): Promise<{ capabilities: CapabilityRecord[]; total: number }> {
    let query = 'SELECT * FROM capabilities WHERE 1=1';
    const params: unknown[] = [];

    if (filters.ownerGhii) { query += ' AND ownerGhii = ?'; params.push(filters.ownerGhii); }
    if (filters.visibility) { query += ' AND visibility = ?'; params.push(filters.visibility); }
    if (filters.status) { query += ' AND status = ?'; params.push(filters.status); }
    if (filters.sourceType) { query += ' AND sourceType = ?'; params.push(filters.sourceType); }
    if (filters.authRequired) { query += ' AND authRequired = ?'; params.push(filters.authRequired); }
    if (filters.callable !== undefined) { query += ' AND callable = ?'; params.push(filters.callable ? 1 : 0); }

    query += ' ORDER BY updatedAt DESC';
    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];

    let results = rows.map(r => this.deserializeCapability(r));

    if (filters.search) {
      const q = filters.search.toLowerCase();
      results = results.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        c.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    if (filters.tags && filters.tags.length > 0) {
      results = results.filter(c => filters.tags!.some(t => c.tags.includes(t)));
    }

    const total = results.length;
    const page = filters.page || 1;
    const perPage = filters.perPage || 20;
    const start = (page - 1) * perPage;
    results = results.slice(start, start + perPage);

    return { capabilities: results, total };
  }

  async listCapabilitiesByOwner(ownerGhii: string): Promise<CapabilityRecord[]> {
    const rows = this.db.prepare('SELECT * FROM capabilities WHERE ownerGhii = ? ORDER BY updatedAt DESC').all(ownerGhii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeCapability(r));
  }

  async getCapabilityBySourceRef(sourceRef: string): Promise<CapabilityRecord | null> {
    const row = this.db.prepare('SELECT * FROM capabilities WHERE sourceRef = ?').get(sourceRef) as Record<string, unknown> | undefined;
    return row ? this.deserializeCapability(row) : null;
  }

  async listCapabilitiesBySourceType(sourceType: string): Promise<CapabilityRecord[]> {
    const rows = this.db.prepare('SELECT * FROM capabilities WHERE sourceType = ?').all(sourceType) as Record<string, unknown>[];
    return rows.map(r => this.deserializeCapability(r));
  }

  async incrementCapabilityStats(id: string, delta: { success: number; error: number; totalMs: number; lastError?: string }): Promise<void> {
    const cap = await this.getCapability(id);
    if (!cap) return;
    const s = cap.stats;
    const newTotal = s.totalInvocations + delta.success + delta.error;
    const newSuccess = s.successCount + delta.success;
    const newError = s.errorCount + delta.error;
    const totalMs = (s.avgResponseMs * s.totalInvocations) + delta.totalMs;
    const newAvg = newTotal > 0 ? Math.round(totalMs / newTotal) : 0;
    const updated: CapabilityStats = {
      totalInvocations: newTotal,
      successCount: newSuccess,
      errorCount: newError,
      lastInvokedAt: new Date().toISOString(),
      avgResponseMs: newAvg,
      lastError: delta.lastError ?? s.lastError,
    };
    this.db.prepare('UPDATE capabilities SET stats = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify(updated), new Date().toISOString(), id);
  }

  async addCapabilityLog(entry: CapabilityLogEntry): Promise<void> {
    this.db.prepare(`INSERT INTO capability_logs (id, capabilityId, callerGhii, input, status, durationMs, error, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(entry.id, entry.capabilityId, entry.callerGhii, JSON.stringify(entry.input), entry.status, entry.durationMs, entry.error, entry.timestamp);
  }

  async listCapabilityLogs(capabilityId: string, filters: { status?: 'success' | 'error'; page?: number; perPage?: number }): Promise<{ logs: CapabilityLogEntry[]; total: number }> {
    let countQ = 'SELECT COUNT(*) as c FROM capability_logs WHERE capabilityId = ?';
    let dataQ = 'SELECT * FROM capability_logs WHERE capabilityId = ?';
    const params: unknown[] = [capabilityId];

    if (filters.status) {
      countQ += ' AND status = ?';
      dataQ += ' AND status = ?';
      params.push(filters.status);
    }

    const total = (this.db.prepare(countQ).get(...params) as { c: number }).c;
    dataQ += ' ORDER BY timestamp DESC';
    const page = filters.page || 1;
    const perPage = filters.perPage || 50;
    dataQ += ` LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`;

    const rows = this.db.prepare(dataQ).all(...params) as Record<string, unknown>[];
    const logs: CapabilityLogEntry[] = rows.map(r => ({
      id: r.id as string,
      capabilityId: r.capabilityId as string,
      callerGhii: r.callerGhii as string,
      input: JSON.parse((r.input as string) || '{}'),
      status: r.status as 'success' | 'error',
      durationMs: r.durationMs as number,
      error: (r.error as string) || null,
      timestamp: r.timestamp as string,
    }));
    return { logs, total };
  }

  async deleteCapabilityLogsBefore(before: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM capability_logs WHERE timestamp < ?').run(before);
    return result.changes;
  }

  async setCapabilityOverride(id: string, override: import('../../interface.js').CapabilityOverride | null): Promise<void> {
    this.db.prepare('UPDATE capabilities SET operatorOverride = ?, updatedAt = ? WHERE id = ?')
      .run(override ? JSON.stringify(override) : null, new Date().toISOString(), id);
  }

  async setCapabilityTrust(id: string, trustUpdates: Partial<import('../../interface.js').CapabilityTrust>): Promise<void> {
    const cap = await this.getCapability(id);
    if (!cap) return;
    const merged = { ...cap.trust, ...trustUpdates };
    this.db.prepare('UPDATE capabilities SET trust = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify(merged), new Date().toISOString(), id);
  }

  async incrementVouchCount(id: string): Promise<void> {
    const cap = await this.getCapability(id);
    if (!cap) return;
    const trust = { ...cap.trust, vouchCount: cap.trust.vouchCount + 1 };
    this.db.prepare('UPDATE capabilities SET trust = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify(trust), new Date().toISOString(), id);
  }

  async decrementVouchCount(id: string): Promise<void> {
    const cap = await this.getCapability(id);
    if (!cap) return;
    const trust = { ...cap.trust, vouchCount: Math.max(0, cap.trust.vouchCount - 1) };
    this.db.prepare('UPDATE capabilities SET trust = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify(trust), new Date().toISOString(), id);
  }

  // ── Stats Persistence ──

  async flushStats(counters: Record<string, number>): Promise<void> {
    const upsert = this.db.prepare(
      `INSERT INTO stats_counters (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    const tx = this.db.transaction((entries: [string, number][]) => {
      for (const [key, value] of entries) {
        upsert.run(key, value);
      }
    });
    tx(Object.entries(counters));
  }

  async loadStats(): Promise<Record<string, number>> {
    const rows = this.db.prepare('SELECT key, value FROM stats_counters').all() as Array<{ key: string; value: number }>;
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  async flushDailyHistory(history: Record<string, Record<string, number>>): Promise<void> {
    const upsert = this.db.prepare(
      `INSERT INTO stats_daily_history (date, key, value) VALUES (?, ?, ?)
       ON CONFLICT(date, key) DO UPDATE SET value = excluded.value`
    );
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const tx = this.db.transaction((entries: [string, Record<string, number>][]) => {
      for (const [date, counters] of entries) {
        for (const [key, value] of Object.entries(counters)) {
          upsert.run(date, key, value);
        }
      }
      this.db.prepare('DELETE FROM stats_daily_history WHERE date < ?').run(cutoffStr);
    });
    tx(Object.entries(history));
  }

  async loadDailyHistory(): Promise<Record<string, Record<string, number>>> {
    const rows = this.db.prepare('SELECT date, key, value FROM stats_daily_history ORDER BY date').all() as Array<{ date: string; key: string; value: number }>;
    const result: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      if (!result[row.date]) result[row.date] = {};
      result[row.date][row.key] = row.value;
    }
    return result;
  }

  // ══════════════════════════════════════════════════════════
  // ── Agent Tasks ──
  // ══════════════════════════════════════════════════════════

  async createAgentTask(record: AgentTaskRecord): Promise<AgentTaskRecord> {
    return agentTaskRepo.createAgentTask(this.db, record);
  }

  async getAgentTask(id: string): Promise<AgentTaskRecord | null> {
    return agentTaskRepo.getAgentTask(this.db, id);
  }

  async listAgentTasks(agentGaii: string, opts?: { status?: string; page?: number; perPage?: number }): Promise<{ tasks: AgentTaskRecord[]; total: number }> {
    return agentTaskRepo.listAgentTasks(this.db, agentGaii, opts);
  }

  async listAgentTasksByOwner(ownerGaii: string, opts?: { status?: string; agentGaii?: string; page?: number; perPage?: number }): Promise<{ tasks: AgentTaskRecord[]; total: number }> {
    return agentTaskRepo.listAgentTasksByOwner(this.db, ownerGaii, opts);
  }

  async updateAgentTask(id: string, updates: Partial<AgentTaskRecord>): Promise<AgentTaskRecord | null> {
    return agentTaskRepo.updateAgentTask(this.db, id, updates);
  }

  async deleteAgentTask(id: string): Promise<boolean> {
    return agentTaskRepo.deleteAgentTask(this.db, id);
  }

  async appendTaskEvent(event: AgentTaskEventRecord): Promise<AgentTaskEventRecord> {
    return agentTaskRepo.appendTaskEvent(this.db, event);
  }

  async listTaskEvents(taskId: string, opts?: { page?: number; perPage?: number }): Promise<{ events: AgentTaskEventRecord[]; total: number }> {
    return agentTaskRepo.listTaskEvents(this.db, taskId, opts);
  }

  async countTasksByAgent(agentGaii: string): Promise<{ queued: number; active: number; done: number; failed: number }> {
    return agentTaskRepo.countTasksByAgent(this.db, agentGaii);
  }

  async countTasksByOwner(ownerGaii: string): Promise<Record<string, { queued: number; active: number; done: number; failed: number; doneToday: number; lastTaskUpdateAt: string | null; lastFailedAt: string | null }>> {
    return agentTaskRepo.countTasksByOwner(this.db, ownerGaii);
  }

  async findStalledTasks(thresholdMinutes: number): Promise<AgentTaskRecord[]> {
    return agentTaskRepo.findStalledTasks(this.db, thresholdMinutes);
  }

  // ══════════════════════════════════════════════════════════
  // ── Agent Directives ──
  // ══════════════════════════════════════════════════════════

  async getAgentDirectives(agentGaii: string): Promise<AgentDirectivesRecord | null> {
    return agentDirectivesRepo.getAgentDirectives(this.db, agentGaii);
  }

  async upsertAgentDirectives(record: AgentDirectivesRecord): Promise<AgentDirectivesRecord> {
    return agentDirectivesRepo.upsertAgentDirectives(this.db, record);
  }

  async deleteAgentDirectives(agentGaii: string): Promise<boolean> {
    return agentDirectivesRepo.deleteAgentDirectives(this.db, agentGaii);
  }

  async getOwnerAgentDefaults(ownerGaii: string): Promise<OwnerAgentDefaults | null> {
    return agentDirectivesRepo.getOwnerAgentDefaults(this.db, ownerGaii);
  }

  async upsertOwnerAgentDefaults(record: OwnerAgentDefaults): Promise<OwnerAgentDefaults> {
    return agentDirectivesRepo.upsertOwnerAgentDefaults(this.db, record);
  }

  // ══════════════════════════════════════════════════════════
  // ── Sharing Groups ──
  // ══════════════════════════════════════════════════════════

  async createSharingGroup(record: SharingGroupRecord): Promise<SharingGroupRecord> {
    return sharingGroupRepo.createSharingGroup(this.db, record);
  }

  async getSharingGroup(id: string): Promise<SharingGroupRecord | null> {
    return sharingGroupRepo.getSharingGroup(this.db, id);
  }

  async listSharingGroups(ownerGaii: string): Promise<SharingGroupRecord[]> {
    return sharingGroupRepo.listSharingGroups(this.db, ownerGaii);
  }

  async listSharingGroupsByMember(identifier: string): Promise<SharingGroupRecord[]> {
    return sharingGroupRepo.listSharingGroupsByMember(this.db, identifier);
  }

  async updateSharingGroup(id: string, updates: Partial<SharingGroupRecord>): Promise<SharingGroupRecord | null> {
    return sharingGroupRepo.updateSharingGroup(this.db, id, updates);
  }

  async deleteSharingGroup(id: string): Promise<boolean> {
    return sharingGroupRepo.deleteSharingGroup(this.db, id);
  }

  async countEntriesReferencingGroup(groupId: string): Promise<number> {
    return sharingGroupRepo.countEntriesReferencingGroup(this.db, groupId);
  }

  // ══════════════════════════════════════════════════════════
  // ── Agent Activity ──
  // ══════════════════════════════════════════════════════════

  async recordActivity(record: AgentActivityRecord): Promise<void> {
    return agentActivityRepo.recordActivity(this.db, record);
  }

  async getActivityHistory(agentGaii: string, opts?: { days?: number; granularity?: 'daily' | 'hourly' }): Promise<AgentActivityRecord[]> {
    return agentActivityRepo.getActivityHistory(this.db, agentGaii, opts);
  }

  // ══════════════════════════════════════════════════════════
  // ── Agent Messages ──
  // ══════════════════════════════════════════════════════════

  async createMessage(record: AgentMessageRecord): Promise<AgentMessageRecord> {
    return agentMessageRepo.createMessage(this.db, record);
  }

  async getMessage(id: string): Promise<AgentMessageRecord | null> {
    return agentMessageRepo.getMessage(this.db, id);
  }

  async listMessages(agentGaii: string, opts?: { direction?: 'inbound' | 'outbound'; threadId?: string; page?: number; perPage?: number }): Promise<{ messages: AgentMessageRecord[]; total: number }> {
    return agentMessageRepo.listMessages(this.db, agentGaii, opts);
  }

  async listPendingMessages(agentGaii: string): Promise<AgentMessageRecord[]> {
    return agentMessageRepo.listPendingMessages(this.db, agentGaii);
  }

  async updateMessageStatus(id: string, status: string, processedAt?: string): Promise<AgentMessageRecord | null> {
    return agentMessageRepo.updateMessageStatus(this.db, id, status, processedAt);
  }

  async countMessagesByAgents(agentGaiis: string[]): Promise<Record<string, { total: number; lastMessageAt: string | null }>> {
    return agentMessageRepo.countMessagesByAgents(this.db, agentGaiis);
  }

  async listThreads(agentGaii: string): Promise<{ threadId: string; lastMessage: string; messageCount: number; updatedAt: string }[]> {
    return agentMessageRepo.listThreads(this.db, agentGaii);
  }

  // ══════════════════════════════════════════════════════════
  // ── Direct Messages (human↔human) ──
  // ══════════════════════════════════════════════════════════

  async createDirectMessage(record: DirectMessageRecord): Promise<DirectMessageRecord> {
    return directMessageRepo.createDirectMessage(this.db, record);
  }

  async getDirectMessage(id: string, ownerGhii: string): Promise<DirectMessageRecord | null> {
    return directMessageRepo.getDirectMessage(this.db, id, ownerGhii);
  }

  async listInbox(ownerGhii: string, opts?: { unreadOnly?: boolean; page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number; unread: number }> {
    return directMessageRepo.listInbox(this.db, ownerGhii, opts);
  }

  async listConversation(ownerGhii: string, conversationId: string, opts?: { page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
    return directMessageRepo.listConversation(this.db, ownerGhii, conversationId, opts);
  }

  async listDmsAddressedTo(recipientGhii: string, opts?: { page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
    return directMessageRepo.listDmsAddressedTo(this.db, recipientGhii, opts);
  }

  async listAgentDmThread(agentGaii: string, conversationId: string, opts?: { page?: number; perPage?: number }): Promise<{ messages: DirectMessageRecord[]; total: number }> {
    return directMessageRepo.listAgentDmThread(this.db, agentGaii, conversationId, opts);
  }

  async listDmsByBroadcast(broadcastId: string, ownerGhii: string): Promise<DirectMessageRecord[]> {
    return directMessageRepo.listDmsByBroadcast(this.db, broadcastId, ownerGhii);
  }

  async listConversations(ownerGhii: string): Promise<Array<{ conversationId: string; peerGhii: string; subject?: string; lastMessage: string; lastDirection: 'inbound' | 'outbound'; messageCount: number; unread: number; updatedAt: string }>> {
    return directMessageRepo.listConversations(this.db, ownerGhii);
  }

  async markMessageRead(id: string, ownerGhii: string): Promise<DirectMessageRecord | null> {
    return directMessageRepo.markMessageRead(this.db, id, ownerGhii);
  }

  async markConversationRead(ownerGhii: string, conversationId: string): Promise<number> {
    return directMessageRepo.markConversationRead(this.db, ownerGhii, conversationId);
  }

  async updateMessageDeliveryStatus(id: string, status: DirectMessageRecord['status'], extra?: { deliveredAt?: string; error?: string }): Promise<DirectMessageRecord | null> {
    return directMessageRepo.updateMessageDeliveryStatus(this.db, id, status, extra);
  }

  async setMessageReadReceipt(id: string, readAt: string): Promise<DirectMessageRecord | null> {
    return directMessageRepo.setMessageReadReceipt(this.db, id, readAt);
  }

  async listOutboundForRetry(limit?: number): Promise<DirectMessageRecord[]> {
    return directMessageRepo.listOutboundForRetry(this.db, limit);
  }

  async listInboundWithAttachments(limit?: number): Promise<DirectMessageRecord[]> {
    return directMessageRepo.listInboundWithAttachments(this.db, limit);
  }

  async updateMessageAttachments(id: string, ownerGhii: string, attachments: DirectMessageRecord['attachments']): Promise<DirectMessageRecord | null> {
    return directMessageRepo.updateMessageAttachments(this.db, id, ownerGhii, attachments);
  }

  async deleteDirectMessage(id: string, ownerGhii: string): Promise<boolean> {
    return directMessageRepo.deleteDirectMessage(this.db, id, ownerGhii);
  }

  async appendMessageDeliveryLog(log: MessageDeliveryLog): Promise<void> {
    directMessageRepo.appendMessageDeliveryLog(this.db, log);
  }

  async listMessageDeliveryLogs(limit?: number): Promise<MessageDeliveryLog[]> {
    return directMessageRepo.listMessageDeliveryLogs(this.db, limit);
  }

  async getMessageDeliveryStats(): Promise<MessageDeliveryStats> {
    return directMessageRepo.getMessageDeliveryStats(this.db);
  }

  async pruneMessageDeliveryLogs(keep?: number): Promise<number> {
    return directMessageRepo.pruneMessageDeliveryLogs(this.db, keep);
  }

  async getContact(ownerGhii: string, contactId: string): Promise<ContactConsentRecord | null> {
    return directMessageRepo.getContact(this.db, ownerGhii, contactId);
  }

  async setContactState(ownerGhii: string, contactId: string, state: ContactConsentRecord['state'], firstMessageId?: string): Promise<ContactConsentRecord> {
    return directMessageRepo.setContactState(this.db, ownerGhii, contactId, state, firstMessageId);
  }

  async listContacts(ownerGhii: string, opts?: { state?: ContactConsentRecord['state'] }): Promise<ContactConsentRecord[]> {
    return directMessageRepo.listContacts(this.db, ownerGhii, opts);
  }

  // ══════════════════════════════════════════════════════════
  // ── Agent Onboarding ──
  // ══════════════════════════════════════════════════════════

  private deserializeOnboarding(row: Record<string, unknown>): AgentOnboardingRecord {
    return {
      agentGaii: row.agentGaii as string,
      status: row.status as AgentOnboardingRecord['status'],
      startedAt: row.startedAt as string,
      completedAt: row.completedAt as string | undefined,
      steps: JSON.parse(row.steps as string),
      readinessScore: row.readinessScore as number | undefined,
      readinessLevel: row.readinessLevel as AgentOnboardingRecord['readinessLevel'],
      detectedPlatform: row.detectedPlatform as string | undefined,
      installedRuntime: row.installedRuntime as string | undefined,
      onboardingBaseline: row.onboardingBaseline as number | undefined,
      operationalHealth: row.operationalHealth as number | undefined,
      healthComponents: row.healthComponents ? JSON.parse(row.healthComponents as string) : undefined,
      healthRecalculatedAt: row.healthRecalculatedAt as string | undefined,
      readinessOverride: row.readinessOverride ? JSON.parse(row.readinessOverride as string) : undefined,
    };
  }

  async createOnboarding(record: AgentOnboardingRecord): Promise<AgentOnboardingRecord> {
    this.db.prepare(
      `INSERT INTO agent_onboarding
       (agentGaii, status, startedAt, completedAt, steps, readinessScore, readinessLevel,
        detectedPlatform, installedRuntime, onboardingBaseline, operationalHealth,
        healthComponents, healthRecalculatedAt, readinessOverride)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.agentGaii,
      record.status,
      record.startedAt,
      record.completedAt ?? null,
      JSON.stringify(record.steps),
      record.readinessScore ?? null,
      record.readinessLevel ?? null,
      record.detectedPlatform ?? null,
      record.installedRuntime ?? null,
      record.onboardingBaseline ?? null,
      record.operationalHealth ?? null,
      record.healthComponents ? JSON.stringify(record.healthComponents) : null,
      record.healthRecalculatedAt ?? null,
      record.readinessOverride ? JSON.stringify(record.readinessOverride) : null,
    );
    return record;
  }

  async getOnboarding(agentGaii: string): Promise<AgentOnboardingRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM agent_onboarding WHERE agentGaii = ?'
    ).get(agentGaii) as Record<string, unknown> | undefined;
    return row ? this.deserializeOnboarding(row) : null;
  }

  async updateOnboarding(agentGaii: string, updates: Partial<AgentOnboardingRecord>): Promise<AgentOnboardingRecord | null> {
    const existing = await this.getOnboarding(agentGaii);
    if (!existing) return null;

    const merged = { ...existing, ...updates, agentGaii };
    this.db.prepare(
      `UPDATE agent_onboarding SET
         status = ?, startedAt = ?, completedAt = ?, steps = ?,
         readinessScore = ?, readinessLevel = ?,
         detectedPlatform = ?, installedRuntime = ?,
         onboardingBaseline = ?, operationalHealth = ?,
         healthComponents = ?, healthRecalculatedAt = ?, readinessOverride = ?
       WHERE agentGaii = ?`
    ).run(
      merged.status,
      merged.startedAt,
      merged.completedAt ?? null,
      JSON.stringify(merged.steps),
      merged.readinessScore ?? null,
      merged.readinessLevel ?? null,
      merged.detectedPlatform ?? null,
      merged.installedRuntime ?? null,
      merged.onboardingBaseline ?? null,
      merged.operationalHealth ?? null,
      merged.healthComponents ? JSON.stringify(merged.healthComponents) : null,
      merged.healthRecalculatedAt ?? null,
      merged.readinessOverride ? JSON.stringify(merged.readinessOverride) : null,
      agentGaii,
    );
    return this.getOnboarding(agentGaii);
  }

  async deleteOnboarding(agentGaii: string): Promise<boolean> {
    const result = this.db.prepare(
      'DELETE FROM agent_onboarding WHERE agentGaii = ?'
    ).run(agentGaii);
    return result.changes > 0;
  }

  async listOnboardingByOwner(owner: string): Promise<AgentOnboardingRecord[]> {
    const rows = this.db.prepare(
      `SELECT * FROM agent_onboarding WHERE agentGaii LIKE ? ORDER BY startedAt DESC`
    ).all(`%#${owner}@%`) as Record<string, unknown>[];
    return rows.map(row => this.deserializeOnboarding(row));
  }

  async listOnboardingByStatus(status: string): Promise<AgentOnboardingRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM agent_onboarding WHERE status = ? ORDER BY startedAt DESC'
    ).all(status) as Record<string, unknown>[];
    return rows.map(row => this.deserializeOnboarding(row));
  }

  // ══════════════════════════════════════════════════════════
  // ── Telemetry Events ──
  // ══════════════════════════════════════════════════════════

  async appendTelemetry(event: TelemetryEvent): Promise<void> {
    this.db.prepare(
      `INSERT INTO telemetry_events (id, agentGaii, type, data, sessionId, taskId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.id,
      event.agentGaii,
      event.type,
      JSON.stringify(event.data),
      event.sessionId ?? null,
      event.taskId ?? null,
      event.createdAt,
    );
  }

  async listTelemetry(agentGaii: string, opts: { since?: string; type?: string; limit?: number }): Promise<TelemetryEvent[]> {
    let whereSql = 'WHERE agentGaii = ?';
    const params: unknown[] = [agentGaii];

    if (opts.since) {
      whereSql += ' AND createdAt > ?';
      params.push(opts.since);
    }
    if (opts.type) {
      whereSql += ' AND type = ?';
      params.push(opts.type);
    }

    const limit = opts.limit ?? 50;

    const rows = this.db.prepare(
      `SELECT * FROM telemetry_events ${whereSql} ORDER BY createdAt DESC LIMIT ?`
    ).all(...params, limit) as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      agentGaii: row.agentGaii as string,
      type: row.type as TelemetryEvent['type'],
      data: JSON.parse(row.data as string),
      sessionId: row.sessionId as string | undefined,
      taskId: row.taskId as string | undefined,
      createdAt: row.createdAt as string,
    }));
  }

  // ══════════════════════════════════════════════════════════
  // ── Webhook Delivery Log ──
  // ══════════════════════════════════════════════════════════

  async appendDeliveryLog(log: WebhookDeliveryLog): Promise<void> {
    this.db.prepare(
      `INSERT INTO webhook_delivery_log
       (id, agentGaii, event, payload, status, httpStatus, errorMessage, attemptCount, latencyMs, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      log.id,
      log.agentGaii,
      log.event,
      JSON.stringify(log.payload),
      log.status,
      log.httpStatus ?? null,
      log.errorMessage ?? null,
      log.attemptCount,
      log.latencyMs,
      log.createdAt,
    );
  }

  async listDeliveryLog(agentGaii: string, limit?: number): Promise<WebhookDeliveryLog[]> {
    const rows = this.db.prepare(
      `SELECT * FROM webhook_delivery_log WHERE agentGaii = ? ORDER BY createdAt DESC LIMIT ?`
    ).all(agentGaii, limit ?? 50) as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      agentGaii: row.agentGaii as string,
      event: row.event as string,
      payload: JSON.parse(row.payload as string),
      status: row.status as WebhookDeliveryLog['status'],
      httpStatus: row.httpStatus as number | undefined,
      errorMessage: row.errorMessage as string | undefined,
      attemptCount: row.attemptCount as number,
      latencyMs: row.latencyMs as number,
      createdAt: row.createdAt as string,
    }));
  }

  async pruneDeliveryLog(agentGaii: string, keepCount: number): Promise<number> {
    const result = this.db.prepare(
      `DELETE FROM webhook_delivery_log
       WHERE agentGaii = ? AND id NOT IN (
         SELECT id FROM webhook_delivery_log WHERE agentGaii = ? ORDER BY createdAt DESC LIMIT ?
       )`
    ).run(agentGaii, agentGaii, keepCount);
    return result.changes;
  }
}
