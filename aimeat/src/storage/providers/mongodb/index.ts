/**
 * @file mongodb/index.ts
 * @description Prisma-backed Storage implementation, shared by the MongoDB and
 *   PostgreSQL backends. The class `PrismaStorage` holds all the query logic and
 *   uses only portable Prisma Client CRUD; `MongoStorage` and `PostgresStorage`
 *   are thin subclasses that differ only in which Prisma schema + generated client
 *   they load (via the `schemaFileName()` / `prismaClientSpecifier()` hooks).
 *   Auto-syncs the schema on startup via `prisma db push`.
 *
 * To use:
 *   1. pnpm add @prisma/client prisma
 *   2. npx prisma generate  (MongoDB) / pnpm db:generate:postgres (PostgreSQL)
 *   3. Set DATABASE_URL environment variable
 *   4. Start with: aimeat --db mongodb (or --db postgresql)
 *
 * @version-history
 *   v1.0.0 — 2025-01-15 — Initial MongoDB storage implementation
 *   v1.1.0 — 2026-05-21 — Auto-sync Prisma schema on startup (prisma db push)
 *   v1.1.1 — 2026-05-28 — createStorageFile uses upsert to match SQLite's
 *                          INSERT OR REPLACE semantics (re-uploads to the same
 *                          key now replace the file instead of throwing on the
 *                          (ownerGaii, key) unique constraint).
 *   v1.2.0 — 2026-06-05 — Add normalizeAppOwnerNames() to rewrite legacy
 *                          full-GHII app ownerName values to the bare owner name.
 *   v1.2.1 — 2026-06-05 — deleteAgentTask now removes any non-active task
 *                          (status != 'active'), not just draft/queued.
 *   v1.3.0 — 2026-06-05 — Generalised MongoStorage into a shared `PrismaStorage`
 *                          base (schemaFileName/prismaClientSpecifier hooks) so the
 *                          PostgreSQL backend can reuse the same query logic;
 *                          MongoStorage kept as a thin back-compat subclass.
 *   v1.4.0 — 2026-06-09 — Add mergeForkedAppBuckets() to consolidate ownerGaii
 *                          buckets forked across an owner's identity forms into one
 *                          canonical bucket with a unified version line.
 *   v1.5.0 — 2026-06-12 — Add SubdomainSite CRUD (operator-managed
 *                          subdomain → published-app/redirect mappings).
 *   v1.6.0 — 2026-06-15 — Persist ecosystem-app `capabilities` + `automation`
 *                          (JSON) on EcosystemApp + EcoAuth for the eco-capability
 *                          scheduler.
 *   v1.7.0 — 2026-06-15 — Add EcoAutomationRecipe CRUD (feature B4): per-(owner, app)
 *                          rule materialising agent tasks on a matching data publish.
 *   v1.8.0 — 2026-06-15 — Persist AgentTask `automation` (JSON) — ecosystem-app recipe
 *                          provenance/routing for B5 (organism) + B6 (email on completion).
 */

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../../utils/logger.js';

import type {
    Storage,
    OwnerRecord,
    AgentRecord,
    MemoryRecord,
    ActionRecord,
    WorkRecord,
    WalletTransaction,
    BoardRecord,
    BoardPostRecord,
    OtkRecord,
    DisputeRecord,
    DisputeAuditEntry,
    MicroMemoryRecord,
    StorageFileRecord,
    PeeringRequestRecord,
    ChunkedUploadRecord,
    GHIIRecord,
    ChatInstanceRecord,
    PersonalNodeRecord,
    MailboxItemRecord,
    SchemaRecord,
    ConsentRecord,
    ConsentAuditEntry,
    CsmRecord,
    MsmRecord,
    EmailVerificationRecord,
    PushSubscriptionRecord,
    TrustedIssuerRecord,
    SiteChangeLogEntry,
    ExtensionRecord,
    EscrowHoldRecord,
    CortexExtensionRecord,
    PersonalPushSubscriptionRecord, NotificationPreferences,
    AppRecord, AppListOptions, AppPurchaseRecord,
    SubdomainSiteRecord,
    NotificationTemplateRecord,
    MemoryLinkRecord, OperatorReviewRecord,
    ScheduledJobRecord,
    ExtensionInstanceRecord,
    FederationPeerRecord,
    ReplicationQueueEntry,
    DeviceAuthorizationRecord,
    EcosystemAppRecord,
    EcoAuthorizationRecord,
    EcoAutomationRecipe,
    OAuthClientRecord,
    OAuthRefreshTokenRecord,
    OAuthApprovalRecord,
    SystemPromptRecord,
    SystemPromptVersionRecord,
    ExecutionLogEntry,
    PackageRecord, PackageComponent, PackageComponentType, PackageFilter,
    TemplateListingRecord, TemplateReview, TemplateDiscussion, TemplateFilter,
    PackageInstanceRecord, InstalledComponent, InstanceFilter,
    CapabilityRecord, CapabilityLogEntry, CapabilityFilter, CapabilityOverride, CapabilityTrust,
    AgentTaskRecord, AgentTaskEventRecord,
    AgentDirectivesRecord, OwnerAgentDefaults,
    SharingGroupRecord,
    AgentActivityRecord,
    AgentMessageRecord,
    TelemetryEvent,
    WebhookDeliveryLog,
    AgentOnboardingRecord,
    AgentOnboardingStep,
} from '../../interface.js';

import { matchesRecipient } from '../../../services/consent.js';
import { parseGaiiLoose } from '../../../utils/gaii.js';

// Prisma client will be imported dynamically at runtime
// import { PrismaClient } from '@prisma/client';

export class PrismaStorage implements Storage {
    private prisma: any; // PrismaClient — typed as any (loaded dynamically; two generated clients exist)
    private chunkedUploads = new Map<string, ChunkedUploadRecord>(); // kept in-memory (transient)
    readonly ready: Promise<void>;

    constructor(databaseUrl: string) {
        // Dynamic import to avoid requiring a generated Prisma client at compile time
        this.prisma = null;
        this.ready = this.init(databaseUrl);
    }

    /**
     * Prisma schema filename this backend syncs from (under `prisma/`).
     * Overridden by PostgresStorage to point at `schema.postgres.prisma`.
     */
    protected schemaFileName(): string { return 'schema.prisma'; }

    /**
     * Module specifier for the generated Prisma client. MongoDB uses the default
     * `@prisma/client`; PostgresStorage returns an absolute path to its own
     * custom-output client so both backends can coexist in one build.
     */
    protected prismaClientSpecifier(): string { return '@prisma/client'; }

    private async init(databaseUrl: string) {
        this.syncSchema(databaseUrl);

        let PrismaClient: any;
        try {
            ({ PrismaClient } = await import(this.prismaClientSpecifier()));
        } catch (err: any) {
            throw new Error(
                `Failed to load the Prisma client (${this.prismaClientSpecifier()}). ` +
                `Generate it first — run "pnpm db:generate:postgres" for PostgreSQL or ` +
                `"pnpm db:generate" for MongoDB.`,
                { cause: err },
            );
        }
        this.prisma = new PrismaClient({ datasourceUrl: databaseUrl });
        await this.prisma.$connect();
    }

    /**
     * Run `prisma db push --skip-generate` to create any missing
     * tables/collections & indexes. Safe and idempotent — never drops data.
     * Skips silently if the prisma CLI is not available.
     */
    private syncSchema(databaseUrl: string): void {
        const schemaPath = this.findPrismaSchema();
        if (!schemaPath) {
            logger.warn(`prisma/${this.schemaFileName()} not found — skipping auto schema sync`);
            return;
        }

        try {
            execSync(`npx prisma db push --skip-generate --schema "${schemaPath}"`, {
                stdio: 'pipe',
                env: { ...process.env, DATABASE_URL: databaseUrl },
                timeout: 30_000,
            });
            logger.info('Prisma schema synced');
        } catch (err: any) {
            const stderr = err.stderr?.toString() ?? '';
            logger.warn(`Auto schema sync skipped — run "pnpm db:push" manually if needed. ${stderr || err.message}`);
        }
    }

    /** Walk up from this file to find the nearest prisma/<schema file> */
    private findPrismaSchema(): string | null {
        let dir = dirname(fileURLToPath(import.meta.url));
        for (let i = 0; i < 10; i++) {
            const candidate = resolve(dir, 'prisma', this.schemaFileName());
            if (existsSync(candidate)) return candidate;
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
        return null;
    }

    private ensureReady() {
        if (!this.prisma) throw new Error('Prisma storage not yet initialized');
    }

    // ── Owners ──────────────────────────────────────────────────

    async createOwner(owner: OwnerRecord): Promise<OwnerRecord> {
        this.ensureReady();
        const row = await this.prisma.owner.create({
            data: {
                name: owner.name,
                displayName: owner.displayName,
                publicKey: owner.publicKey,
                roles: owner.roles,
                createdAt: new Date(owner.createdAt),
            },
        });
        return this.toOwnerRecord(row);
    }

    async getOwner(name: string): Promise<OwnerRecord | null> {
        this.ensureReady();
        const row = await this.prisma.owner.findUnique({ where: { name } });
        return row ? this.toOwnerRecord(row) : null;
    }

    async listOwners(): Promise<OwnerRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.owner.findMany();
        return rows.map((r: any) => this.toOwnerRecord(r));
    }

    async updateOwner(name: string, updates: Partial<OwnerRecord>): Promise<OwnerRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.owner.update({ where: { name }, data: updates });
            return this.toOwnerRecord(row);
        } catch { return null; }
    }

    async deleteOwner(name: string): Promise<boolean> {
        this.ensureReady();
        try {
            // 1. Get all agents belonging to this owner
            const agents = await this.prisma.agent.findMany({ where: { owner: name }, select: { gaii: true } });
            const agentGaiis = agents.map((a: any) => a.gaii);

            // 2. Cascade delete all agent-related data for each agent
            for (const gaii of agentGaiis) {
                await this.cascadeDeleteAgentData(gaii);
            }

            // 3. Delete all agents for this owner
            await this.prisma.agent.deleteMany({ where: { owner: name } });

            // 4. Delete GHII records for this owner
            await this.prisma.ghii.deleteMany({ where: { ownerName: name } });

            // 5. Delete personal nodes and their mailbox items & push subscriptions (Prisma)
            const personalNodes = await this.prisma.personalNode.findMany({ where: { ownerName: name }, select: { id: true } });
            const personalNodeIds = personalNodes.map((n: any) => n.id);
            if (personalNodeIds.length > 0) {
                await this.prisma.mailboxItem.deleteMany({ where: { personalNodeId: { in: personalNodeIds } } });
                await this.prisma.personalPushSubscription.deleteMany({ where: { personalNodeId: { in: personalNodeIds } } });
                await this.prisma.notificationPreference.deleteMany({ where: { personalNodeId: { in: personalNodeIds } } });
                await this.prisma.personalNode.deleteMany({ where: { ownerName: name } });
            }

            // 6. Delete push subscriptions for this owner
            await this.prisma.pushSubscription.deleteMany({ where: { ownerName: name } });
            await this.prisma.personalPushSubscription.deleteMany({ where: { ownerName: name } });

            // 7. Delete listings for this owner (Prisma)
            await this.prisma.listing.deleteMany({ where: { ownerName: name } });

            // 8. Delete purchases for this owner as buyer or seller (Prisma)
            await this.prisma.purchase.deleteMany({ where: { OR: [{ buyerOwner: name }, { sellerOwner: name }] } });

            // 9. Delete chat instances for this owner (Prisma)
            await this.prisma.chatInstance.deleteMany({ where: { ownerName: name } });

            // 10. Delete email verifications for this owner (Prisma)
            await this.prisma.emailVerification.deleteMany({ where: { ownerName: name } });

            // 10b. Delete owner-level agent dashboard data
            const ghiiRows = await this.prisma.ghii.findMany({ where: { ownerName: name }, select: { ghii: true } });
            for (const g of ghiiRows) {
                await this.prisma.agentTask.deleteMany({ where: { ownerGaii: g.ghii } });
                await this.prisma.sharingGroup.deleteMany({ where: { ownerGaii: g.ghii } });
                try { await this.prisma.ownerAgentDefault.delete({ where: { ownerGaii: g.ghii } }); } catch { /* not found */ }
            }

            // 11. Delete the owner record
            await this.prisma.owner.delete({ where: { name } });
            return true;
        } catch { return false; }
    }

    // ── Agents ──────────────────────────────────────────────────

    async createAgent(agent: AgentRecord): Promise<AgentRecord> {
        this.ensureReady();
        const row = await this.prisma.agent.create({
            data: {
                name: agent.name,
                owner: agent.owner,
                gaii: agent.gaii,
                displayName: agent.displayName,
                description: agent.description,
                capabilities: agent.capabilities,
                publicKey: agent.publicKey,
                trustScore: agent.trustScore,
                morselBalance: agent.morselBalance,
                allowedOrigins: agent.allowedOrigins ?? [],
                defaultScopes: agent.defaultScopes ?? ['*'],
                federate: agent.federate ?? false,
                technicalCapabilities: agent.technicalCapabilities as any ?? null,
                domainCapabilities: agent.domainCapabilities as any ?? null,
                activityStats: agent.activityStats as any ?? null,
                modulesLoaded: agent.modulesLoaded as any ?? null,
                agentLimitations: agent.agentLimitations as any ?? null,
                languages: agent.languages as any ?? null,
                mode: agent.mode ?? 'interactive',
                maxConcurrentTasks: agent.maxConcurrentTasks ?? 1,
                dailySpendLimit: agent.dailySpendLimit ?? null,
                scheduleConstraintDefaults: agent.scheduleConstraintDefaults as any ?? null,
                webhookUrl: agent.webhookUrl ?? null,
                webhookSecret: agent.webhookSecret ?? null,
                webhookEnabled: agent.webhookEnabled ?? false,
                webhookLastSuccess: agent.webhookLastSuccess ? new Date(agent.webhookLastSuccess) : null,
                webhookLastFailure: agent.webhookLastFailure ? new Date(agent.webhookLastFailure) : null,
                webhookFailCount: agent.webhookFailCount ?? 0,
                platform: agent.platform ?? null,
                platformVersion: agent.platformVersion ?? null,
                platformDetectedBy: agent.platformDetectedBy ?? null,
                tags: agent.tags ?? [],
                createdAt: new Date(agent.createdAt),
                lastSeen: new Date(agent.lastSeen),
            },
        });
        return this.toAgentRecord(row);
    }

    async getAgent(gaii: string): Promise<AgentRecord | null> {
        this.ensureReady();
        const row = await this.prisma.agent.findUnique({ where: { gaii } });
        return row ? this.toAgentRecord(row) : null;
    }

    async getAgentByName(name: string, nodeId: string): Promise<AgentRecord | null> {
        this.ensureReady();
        const row = await this.prisma.agent.findFirst({ where: { name } });
        return row ? this.toAgentRecord(row) : null;
    }

    async getAgentsByOwner(owner: string): Promise<AgentRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.agent.findMany({ where: { owner } });
        return rows.map((r: any) => this.toAgentRecord(r));
    }

    async updateAgent(gaii: string, updates: Partial<AgentRecord>): Promise<AgentRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.agent.update({ where: { gaii }, data: updates });
            return this.toAgentRecord(row);
        } catch (err) {
            logger.warn('updateAgent failed for %s: %s', gaii, (err as Error).message);
            return null;
        }
    }

    async deleteAgent(gaii: string): Promise<boolean> {
        this.ensureReady();
        try {
            // Cascade delete all agent-related data
            await this.cascadeDeleteAgentData(gaii);
            // Delete the agent record itself
            await this.prisma.agent.delete({ where: { gaii } });
            return true;
        } catch { return false; }
    }

    /**
     * Cascade-delete all data associated with a single agent GAII.
     * Called by both deleteOwner and deleteAgent.
     */
    private async cascadeDeleteAgentData(gaii: string): Promise<void> {
        // Memory (Prisma)
        await this.prisma.memory.deleteMany({ where: { ownerGaii: gaii } });
        // Micro-memory (Prisma)
        await this.prisma.microMemory.deleteMany({ where: { gaii } });
        // Actions (Prisma)
        await this.prisma.action.deleteMany({ where: { providerGaii: gaii } });
        // Work — also clean up related disputes (Prisma)
        const workItems = await this.prisma.work.findMany({
            where: { OR: [{ providerGaii: gaii }, { requesterGaii: gaii }] },
            select: { trackingCode: true },
        });
        for (const w of workItems) {
            const disputes = await this.prisma.dispute.findMany({
                where: { trackingCode: w.trackingCode },
                select: { disputeId: true },
            });
            for (const d of disputes) {
                await this.prisma.disputeAudit.deleteMany({ where: { disputeId: d.disputeId } });
            }
            await this.prisma.dispute.deleteMany({ where: { trackingCode: w.trackingCode } });
        }
        await this.prisma.work.deleteMany({ where: { OR: [{ providerGaii: gaii }, { requesterGaii: gaii }] } });
        // Wallet transactions (Prisma)
        await this.prisma.transaction.deleteMany({ where: { gaii } });
        // Board posts authored by this agent (Prisma)
        await this.prisma.boardPost.deleteMany({ where: { authorGaii: gaii } });
        // Board subscriptions (Prisma)
        await this.prisma.boardSubscription.deleteMany({ where: { gaii } });
        // Boards owned by this agent — also delete their posts and subscriptions (Prisma)
        const boards = await this.prisma.board.findMany({ where: { ownerGaii: gaii }, select: { boardId: true } });
        for (const b of boards) {
            await this.prisma.boardPost.deleteMany({ where: { boardId: b.boardId } });
            await this.prisma.boardSubscription.deleteMany({ where: { boardId: b.boardId } });
        }
        await this.prisma.board.deleteMany({ where: { ownerGaii: gaii } });
        // Consents (Prisma)
        await this.prisma.consent.deleteMany({ where: { ownerGaii: gaii } });
        await this.prisma.consentAudit.deleteMany({ where: { ownerGaii: gaii } });
        // Storage files (Prisma)
        await this.prisma.storageFile.deleteMany({ where: { ownerGaii: gaii } });
        // Matches (Prisma)
        await this.prisma.match.deleteMany({ where: { OR: [{ profileA: gaii }, { profileB: gaii }] } });
        // Flags raised by this agent (Prisma)
        await this.prisma.flag.deleteMany({ where: { flaggedBy: gaii } });
        // Escrow holds (Prisma)
        await this.prisma.escrowHold.deleteMany({ where: { fromGaii: gaii } });
        // OTKs (Prisma)
        await this.prisma.otk.deleteMany({ where: { ownerGaii: gaii } });
        // OAuth refresh tokens and approvals for this agent
        await this.prisma.oAuthRefreshToken.deleteMany({ where: { gaii } });
        await this.prisma.oAuthApproval.deleteMany({ where: { gaii } });
        // Agent tasks and events
        const tasks = await this.prisma.agentTask.findMany({ where: { agentGaii: gaii }, select: { id: true } });
        for (const t of tasks) {
            await this.prisma.agentTaskEvent.deleteMany({ where: { taskId: t.id } });
        }
        await this.prisma.agentTask.deleteMany({ where: { agentGaii: gaii } });
        // Agent directives
        try { await this.prisma.agentDirective.delete({ where: { agentGaii: gaii } }); } catch { /* not found */ }
        // Agent activity
        await this.prisma.agentActivity.deleteMany({ where: { agentGaii: gaii } });
        // Agent messages
        await this.prisma.agentMessage.deleteMany({ where: { agentGaii: gaii } });
        // Telemetry events
        await this.prisma.telemetryEvent.deleteMany({ where: { agentGaii: gaii } });
        // Webhook delivery logs
        await this.prisma.webhookDeliveryLog.deleteMany({ where: { agentGaii: gaii } });
        // Onboarding record
        try { await this.prisma.agentOnboarding.delete({ where: { agentGaii: gaii } }); } catch { /* not found */ }
        // Sharing groups
        await this.prisma.sharingGroup.deleteMany({ where: { ownerGaii: gaii } });
    }

    async listAgents(): Promise<AgentRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.agent.findMany();
        return rows.map((r: any) => this.toAgentRecord(r));
    }

    /**
     * Resolve any identity (GAII, GHII, bare owner) to the owner's GHII identifier.
     * All balance operations go through GHII — agents don't have their own balance.
     */
    private async resolveGhii(identity: string): Promise<string | null> {
        // GHII format: owner@node (no #)
        if (!identity.includes('#') && identity.includes('@')) return identity;
        // GAII format: agent#owner@node → extract owner → lookup GHII
        let ownerName: string;
        if (identity.includes('#')) {
            const hashIdx = identity.indexOf('#');
            const atIdx = identity.lastIndexOf('@');
            if (atIdx > hashIdx) {
                ownerName = identity.slice(hashIdx + 1, atIdx);
            } else return null;
        } else {
            ownerName = identity; // bare owner name
        }
        const ghiiRecord = await this.prisma.ghii.findFirst({ where: { username: ownerName }, select: { ghii: true } });
        return ghiiRecord?.ghii ?? null;
    }

    async debitBalance(gaii: string, amount: number): Promise<boolean> {
        this.ensureReady();
        const ghii = await this.resolveGhii(gaii);
        if (!ghii) return false;
        try {
            // Atomic: update only if balance >= amount (prevents double-spend race)
            const result = await this.prisma.ghii.updateMany({
                where: { ghii, morselBalance: { gte: amount } },
                data: { morselBalance: { decrement: amount } },
            });
            return result.count > 0;
        } catch { return false; }
    }

    async creditBalance(gaii: string, amount: number): Promise<boolean> {
        this.ensureReady();
        const ghii = await this.resolveGhii(gaii);
        if (!ghii) return false;
        try {
            // Atomic increment (MongoDB $inc treats null as 0)
            await this.prisma.ghii.update({
                where: { ghii },
                data: { morselBalance: { increment: amount } },
            });
            return true;
        } catch { return false; }
    }

    async creditBalanceCapped(gaii: string, amount: number, cap: number): Promise<number> {
        this.ensureReady();
        const ghii = await this.resolveGhii(gaii);
        if (!ghii) return 0;
        // Optimistic concurrency: read, calculate, CAS-update (retry on conflict)
        for (let attempt = 0; attempt < 3; attempt++) {
            const record = await this.prisma.ghii.findUnique({ where: { ghii }, select: { morselBalance: true } });
            const balance = record?.morselBalance ?? 0;
            if (balance >= cap) return 0;
            const actualCredit = Math.min(amount, cap - balance);
            if (actualCredit <= 0) return 0;
            // CAS: only update if balance hasn't changed since read
            const result = await this.prisma.ghii.updateMany({
                where: { ghii, morselBalance: balance },
                data: { morselBalance: { increment: actualCredit } },
            });
            if (result.count > 0) return actualCredit;
        }
        return 0;
    }

    async transferBalance(fromGaii: string, toGaii: string, amount: number): Promise<boolean> {
        this.ensureReady();
        const fromGhii = await this.resolveGhii(fromGaii);
        const toGhii = await this.resolveGhii(toGaii);
        if (!fromGhii || !toGhii) return false;
        if (fromGhii === toGhii) return true; // Same owner — no-op
        try {
            await this.prisma.$transaction(async (tx: any) => {
                const from = await tx.ghii.findUnique({ where: { ghii: fromGhii }, select: { morselBalance: true } });
                const fromBalance = from?.morselBalance ?? 0;
                if (fromBalance < amount) throw new Error('INSUFFICIENT');
                const to = await tx.ghii.findUnique({ where: { ghii: toGhii }, select: { morselBalance: true } });
                const toBalance = to?.morselBalance ?? 0;
                await tx.ghii.update({ where: { ghii: fromGhii }, data: { morselBalance: fromBalance - amount } });
                await tx.ghii.update({ where: { ghii: toGhii }, data: { morselBalance: toBalance + amount } });
            });
            return true;
        } catch { return false; }
    }

    // ── Memory ──────────────────────────────────────────────────

    async setMemory(record: MemoryRecord): Promise<MemoryRecord> {
        this.ensureReady();
        const row = await this.prisma.memory.upsert({
            where: { ownerGaii_key: { ownerGaii: record.ownerGaii, key: record.key } },
            create: {
                key: record.key,
                ownerGaii: record.ownerGaii,
                value: record.value as any,
                visibility: record.visibility,
                groupId: record.groupId ?? null,
                tags: record.tags,
                ttlHours: record.ttlHours,
                version: record.version,
                flagCount: record.flagCount ?? 0,
                allowedOrigins: record.allowedOrigins ?? [],
                createdAt: new Date(record.createdAt),
                updatedAt: new Date(record.updatedAt),
            },
            update: {
                value: record.value as any,
                visibility: record.visibility,
                groupId: record.groupId ?? null,
                tags: record.tags,
                ttlHours: record.ttlHours,
                version: record.version,
                flagCount: record.flagCount ?? 0,
                allowedOrigins: record.allowedOrigins ?? [],
                updatedAt: new Date(record.updatedAt),
            },
        });
        return this.toMemoryRecord(row);
    }

    async setMemoryIfVersion(record: MemoryRecord, expectedVersion: number): Promise<MemoryRecord | null> {
        this.ensureReady();
        // Atomic version-checked update using raw MongoDB $set + version filter
        const result = await this.prisma.memory.updateMany({
            where: {
                ownerGaii: record.ownerGaii,
                key: record.key,
                version: expectedVersion,
            },
            data: {
                value: record.value as any,
                visibility: record.visibility,
                groupId: record.groupId ?? null,
                tags: record.tags,
                ttlHours: record.ttlHours,
                version: record.version,
                flagCount: record.flagCount ?? 0,
                allowedOrigins: record.allowedOrigins ?? [],
                updatedAt: new Date(record.updatedAt),
            },
        });
        if (result.count === 0) return null; // version conflict
        return this.getMemory(record.ownerGaii, record.key);
    }

    async getMemory(ownerGaii: string, key: string): Promise<MemoryRecord | null> {
        this.ensureReady();
        const row = await this.prisma.memory.findUnique({
            where: { ownerGaii_key: { ownerGaii, key } },
        });
        if (!row) return null;
        // TTL check
        if (row.ttlHours) {
            const expiresAt = new Date(row.createdAt).getTime() + row.ttlHours * 3600_000;
            if (Date.now() > expiresAt) {
                await this.prisma.memory.delete({ where: { ownerGaii_key: { ownerGaii, key } } });
                return null;
            }
        }
        return this.toMemoryRecord(row);
    }

    async listMemory(ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number }): Promise<MemoryRecord[]> {
        this.ensureReady();
        const where: any = { ownerGaii };
        if (opts?.prefix) where.key = { startsWith: opts.prefix };
        if (opts?.visibility) where.visibility = opts.visibility;
        if (opts?.tags?.length) where.tags = { hasSome: opts.tags };

        const rows = await this.prisma.memory.findMany({ where });
        return rows
            .filter((r: any) => {
                if (!r.ttlHours) return true;
                return Date.now() <= new Date(r.createdAt).getTime() + r.ttlHours * 3600_000;
            })
            .map((r: any) => this.toMemoryRecord(r))
            .filter((r: MemoryRecord) => {
                if (opts?.maxFlags !== undefined && (r.flagCount ?? 0) > opts.maxFlags) return false;
                return true;
            });
    }

    async listAllMemory(opts?: { prefix?: string; ownerPrefix?: string; visibility?: string; limit?: number; offset?: number }): Promise<{ items: MemoryRecord[]; total: number }> {
        this.ensureReady();
        const where: any = {};
        if (opts?.ownerPrefix) where.ownerGaii = { startsWith: opts.ownerPrefix };
        if (opts?.prefix) where.key = { startsWith: opts.prefix };
        if (opts?.visibility) where.visibility = opts.visibility;

        const [rows, total] = await Promise.all([
            this.prisma.memory.findMany({
                where,
                orderBy: { updatedAt: 'desc' },
                take: opts?.limit ?? 50,
                skip: opts?.offset ?? 0,
            }),
            this.prisma.memory.count({ where }),
        ]);

        const items = rows
            .filter((r: any) => {
                if (!r.ttlHours) return true;
                return Date.now() <= new Date(r.createdAt).getTime() + r.ttlHours * 3600_000;
            })
            .map((r: any) => this.toMemoryRecord(r));

        return { items, total };
    }

    async deleteMemory(ownerGaii: string, key: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.memory.delete({ where: { ownerGaii_key: { ownerGaii, key } } });
            return true;
        } catch { return false; }
    }

    async deleteAllMemory(ownerGaii: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.memory.deleteMany({ where: { ownerGaii } });
        return result.count;
    }

    async incrementMemoryFlagCount(ownerGaii: string, key: string): Promise<void> {
        this.ensureReady();
        const record = await this.getMemory(ownerGaii, key);
        if (record) {
            record.flagCount = (record.flagCount ?? 0) + 1;
            await this.setMemory(record);
        }
    }

    async searchMemory(ownerGaii: string, query: string, opts?: { visibility?: string; maxFlags?: number }): Promise<MemoryRecord[]> {
        this.ensureReady();
        // MongoDB text search — search keys and string values
        const where: any = { ownerGaii };
        if (opts?.visibility) where.visibility = opts.visibility;

        const rows = await this.prisma.memory.findMany({ where });
        const q = query.toLowerCase();
        return rows
            .filter((r: any) => {
                if (r.key.toLowerCase().includes(q)) return true;
                const valStr = JSON.stringify(r.value).toLowerCase();
                if (valStr.includes(q)) return true;
                if (r.tags.some((t: string) => t.toLowerCase().includes(q))) return true;
                return false;
            })
            .filter((r: any) => {
                if (!r.ttlHours) return true;
                return Date.now() <= new Date(r.createdAt).getTime() + r.ttlHours * 3600_000;
            })
            .map((r: any) => this.toMemoryRecord(r))
            .filter((r: MemoryRecord) => {
                if (opts?.maxFlags !== undefined && (r.flagCount ?? 0) > opts.maxFlags) return false;
                return true;
            });
    }

    // ── Actions ─────────────────────────────────────────────────

    async createAction(action: ActionRecord): Promise<ActionRecord> {
        this.ensureReady();
        const existing = await this.prisma.action.findUnique({
            where: { actionId_providerGaii: { actionId: action.id, providerGaii: action.providerGaii } },
        });
        if (existing) throw new Error('ACTION_EXISTS');

        const row = await this.prisma.action.create({
            data: {
                actionId: action.id,
                providerGaii: action.providerGaii,
                displayName: action.displayName,
                description: action.description,
                category: action.category,
                inputSchema: action.inputSchema,
                outputSchema: action.outputSchema,
                pricingBaseMorsels: action.pricing.baseMorsels,
                pricingPerUnit: action.pricing.perUnit as any,
                estimatedTimeSeconds: action.estimatedTimeSeconds,
                maxInputSizeBytes: action.maxInputSizeBytes,
                tags: action.tags,
                webhookUrl: action.webhookUrl ?? null,
                semantic: action.semantic as any ?? null,
                federate: action.federate ?? false,
                createdAt: new Date(action.createdAt),
                updatedAt: new Date(action.updatedAt),
            },
        });
        return this.toActionRecord(row);
    }

    async getAction(id: string, providerGaii: string): Promise<ActionRecord | null> {
        this.ensureReady();
        const row = await this.prisma.action.findUnique({
            where: { actionId_providerGaii: { actionId: id, providerGaii } },
        });
        return row ? this.toActionRecord(row) : null;
    }

    async listActions(opts?: { search?: string; category?: string }): Promise<ActionRecord[]> {
        this.ensureReady();
        const where: any = {};
        if (opts?.category) where.category = opts.category;
        const rows = await this.prisma.action.findMany({ where });
        let results = rows.map((r: any) => this.toActionRecord(r));
        if (opts?.search) {
            const q = opts.search.toLowerCase();
            results = results.filter((a: ActionRecord) =>
                a.displayName.toLowerCase().includes(q) ||
                a.description.toLowerCase().includes(q) ||
                a.tags.some(t => t.toLowerCase().includes(q))
            );
        }
        return results;
    }

    async deleteAction(id: string, providerGaii: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.action.delete({
                where: { actionId_providerGaii: { actionId: id, providerGaii } },
            });
            return true;
        } catch { return false; }
    }

    async deleteActionsByProvider(gaii: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.action.deleteMany({ where: { providerGaii: gaii } });
        return result.count;
    }

    async listActionsByProvider(gaii: string): Promise<ActionRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.action.findMany({ where: { providerGaii: gaii } });
        return rows.map((r: any) => this.toActionRecord(r));
    }

    async updateAction(id: string, providerGaii: string, updates: Partial<ActionRecord>): Promise<ActionRecord | null> {
        this.ensureReady();
        try {
            const data: any = { ...updates, updatedAt: new Date() };
            if (updates.pricing) {
                data.pricingBaseMorsels = updates.pricing.baseMorsels;
                data.pricingPerUnit = updates.pricing.perUnit as any;
                delete data.pricing;
            }
            delete data.id;
            delete data.providerGaii;
            const row = await this.prisma.action.update({
                where: { actionId_providerGaii: { actionId: id, providerGaii } },
                data,
            });
            return this.toActionRecord(row);
        } catch { return null; }
    }

    // ── Work ────────────────────────────────────────────────────

    async createWork(work: WorkRecord): Promise<WorkRecord> {
        this.ensureReady();
        const row = await this.prisma.work.create({
            data: {
                trackingCode: work.trackingCode,
                status: work.status,
                actionId: work.actionId,
                providerGaii: work.providerGaii,
                requesterGaii: work.requesterGaii,
                input: work.input as any,
                costBasePrice: work.cost.basePrice,
                costNetworkFee: work.cost.networkFee,
                costTotal: work.cost.total,
                costInEscrow: work.cost.inEscrow,
                ttlExpiresAt: new Date(work.ttlExpiresAt),
                callbackUrl: work.callbackUrl,
                createdAt: new Date(work.createdAt),
                updatedAt: new Date(work.updatedAt),
            },
        });
        return this.toWorkRecord(row);
    }

    async getWork(trackingCode: string): Promise<WorkRecord | null> {
        this.ensureReady();
        const row = await this.prisma.work.findUnique({ where: { trackingCode } });
        return row ? this.toWorkRecord(row) : null;
    }

    async updateWork(trackingCode: string, updates: Partial<WorkRecord>): Promise<WorkRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.status) data.status = updates.status;
            if (updates.output) data.output = updates.output as any;
            if (updates.updatedAt) data.updatedAt = new Date(updates.updatedAt);
            if (updates.rating) {
                data.ratingScore = updates.rating.score;
                data.ratingComment = updates.rating.comment;
            }
            const row = await this.prisma.work.update({ where: { trackingCode }, data });
            return this.toWorkRecord(row);
        } catch { return null; }
    }

    async listWorkByProvider(gaii: string): Promise<WorkRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.work.findMany({ where: { providerGaii: gaii } });
        return rows.map((r: any) => this.toWorkRecord(r));
    }

    async listWorkByRequester(gaii: string): Promise<WorkRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.work.findMany({ where: { requesterGaii: gaii } });
        return rows.map((r: any) => this.toWorkRecord(r));
    }

    async listAllWork(limit = 10000): Promise<WorkRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.work.findMany({ take: Math.min(limit, 10000), orderBy: { createdAt: 'desc' } });
        return rows.map((r: any) => this.toWorkRecord(r));
    }

    // ── Transactions ────────────────────────────────────────────

    async addTransaction(tx: WalletTransaction): Promise<WalletTransaction> {
        this.ensureReady();
        const row = await this.prisma.transaction.create({
            data: {
                txId: tx.id,
                gaii: tx.gaii,
                type: tx.type,
                amount: tx.amount,
                counterpartyGaii: tx.counterpartyGaii,
                trackingCode: tx.trackingCode,
                timestamp: new Date(tx.timestamp),
            },
        });
        return { id: row.txId, gaii: row.gaii, type: row.type, amount: row.amount, counterpartyGaii: row.counterpartyGaii ?? undefined, trackingCode: row.trackingCode ?? undefined, timestamp: row.timestamp.toISOString() };
    }

    async getTransactions(gaii: string, limit = 50): Promise<WalletTransaction[]> {
        this.ensureReady();
        const rows = await this.prisma.transaction.findMany({
            where: { gaii },
            orderBy: { timestamp: 'desc' },
            take: limit,
        });
        return rows.map((r: any) => ({
            id: r.txId,
            gaii: r.gaii,
            type: r.type,
            amount: r.amount,
            counterpartyGaii: r.counterpartyGaii ?? undefined,
            trackingCode: r.trackingCode ?? undefined,
            timestamp: r.timestamp.toISOString(),
        }));
    }

    async listAllTransactions(limit = 10000): Promise<WalletTransaction[]> {
        this.ensureReady();
        const rows = await this.prisma.transaction.findMany({
            take: Math.min(limit, 10000),
            orderBy: { timestamp: 'desc' },
        });
        return rows.map((r: any) => ({
            id: r.txId,
            gaii: r.gaii,
            type: r.type,
            amount: r.amount,
            counterpartyGaii: r.counterpartyGaii ?? undefined,
            trackingCode: r.trackingCode ?? undefined,
            timestamp: r.timestamp.toISOString(),
        }));
    }

    async deleteTransactions(gaii: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.transaction.deleteMany({ where: { gaii } });
        return result.count;
    }

    // ── Boards ──────────────────────────────────────────────────

    async createBoard(board: BoardRecord): Promise<BoardRecord> {
        this.ensureReady();
        const row = await this.prisma.board.create({
            data: {
                boardId: board.id,
                name: board.name,
                description: board.description,
                visibility: board.visibility,
                ownerGaii: board.ownerGaii,
                allowedGaiis: board.allowedGaiis,
                federate: board.federate ?? false,
                createdAt: new Date(board.createdAt),
            },
        });
        return this.toBoardRecord(row);
    }

    async getBoard(id: string): Promise<BoardRecord | null> {
        this.ensureReady();
        const row = await this.prisma.board.findUnique({ where: { boardId: id } });
        return row ? this.toBoardRecord(row) : null;
    }

    async listBoards(opts?: { visibility?: string; ownerGaii?: string }): Promise<BoardRecord[]> {
        this.ensureReady();
        const where: any = {};
        if (opts?.visibility) where.visibility = opts.visibility;
        if (opts?.ownerGaii) where.ownerGaii = opts.ownerGaii;
        const rows = await this.prisma.board.findMany({ where });
        return rows.map((r: any) => this.toBoardRecord(r));
    }

    async updateBoardVisibility(id: string, visibility: string, federate?: boolean): Promise<import('../../interface.js').BoardRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = { visibility };
            if (federate !== undefined) data.federate = federate;
            const row = await this.prisma.board.update({ where: { boardId: id }, data });
            return this.toBoardRecord(row);
        } catch { return null; }
    }

    async updateBoardMembers(id: string, allowedGaiis: string[]): Promise<import('../../interface.js').BoardRecord | null> {
      this.ensureReady();
      try {
        const row = await this.prisma.board.update({ where: { boardId: id }, data: { allowedGaiis } });
        return this.toBoardRecord(row);
      } catch { return null; }
    }

    async deleteBoard(id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.board.delete({ where: { boardId: id } });
            await this.prisma.boardPost.deleteMany({ where: { boardId: id } });
            return true;
        } catch { return false; }
    }

    async createPost(post: BoardPostRecord): Promise<BoardPostRecord> {
        this.ensureReady();
        const row = await this.prisma.boardPost.create({
            data: {
                postId: post.id,
                boardId: post.boardId,
                authorGaii: post.authorGaii,
                title: post.title,
                body: post.body,
                category: post.category,
                tags: post.tags,
                ttlExpiresAt: post.ttlExpiresAt ? new Date(post.ttlExpiresAt) : null,
                reactions: post.reactions as any,
                replyTo: post.replyTo ?? null,
                createdAt: new Date(post.createdAt),
            },
        });
        return this.toPostRecord(row);
    }

    async getPost(boardId: string, postId: string): Promise<BoardPostRecord | null> {
        this.ensureReady();
        const row = await this.prisma.boardPost.findFirst({ where: { boardId, postId } });
        return row ? this.toPostRecord(row) : null;
    }

    async listPosts(boardId: string, opts?: { category?: string; cursor?: string; limit?: number }): Promise<BoardPostRecord[]> {
        this.ensureReady();
        const where: any = { boardId, replyTo: null };
        if (opts?.category) where.category = opts.category;
        const rows = await this.prisma.boardPost.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: opts?.limit ?? 20,
        });
        return rows
            .filter((r: any) => !r.ttlExpiresAt || new Date(r.ttlExpiresAt).getTime() > Date.now())
            .map((r: any) => this.toPostRecord(r));
    }

    async deletePost(boardId: string, postId: string): Promise<boolean> {
        this.ensureReady();
        const result = await this.prisma.boardPost.deleteMany({ where: { boardId, postId } });
        return result.count > 0;
    }

    async addReaction(boardId: string, postId: string, emoji: string, gaii: string): Promise<boolean> {
        this.ensureReady();
        const post = await this.prisma.boardPost.findFirst({ where: { boardId, postId } });
        if (!post) return false;
        const reactions = (post.reactions as Record<string, string[]>) ?? {};
        if (!reactions[emoji]) reactions[emoji] = [];
        if (!reactions[emoji].includes(gaii)) reactions[emoji].push(gaii);
        await this.prisma.boardPost.update({
            where: { postId },
            data: { reactions: reactions as any },
        });
        return true;
    }

    // ── Board Subscriptions ─────────────────────────────────────

    async createBoardSubscription(sub: import('../../interface.js').BoardSubscriptionRecord): Promise<import('../../interface.js').BoardSubscriptionRecord> {
        this.ensureReady();
        await this.prisma.boardSubscription.upsert({
            where: { boardId_gaii: { boardId: sub.boardId, gaii: sub.gaii } },
            create: { id: sub.id, boardId: sub.boardId, gaii: sub.gaii, callbackUrl: sub.callbackUrl, filters: sub.filters as any ?? null, createdAt: new Date(sub.createdAt) },
            update: { callbackUrl: sub.callbackUrl, filters: sub.filters as any ?? null },
        });
        return sub;
    }

    async getBoardSubscription(boardId: string, gaii: string): Promise<import('../../interface.js').BoardSubscriptionRecord | null> {
        this.ensureReady();
        const row = await this.prisma.boardSubscription.findUnique({ where: { boardId_gaii: { boardId, gaii } } });
        return row ? this.toBoardSubscriptionRecord(row) : null;
    }

    async listBoardSubscriptions(boardId: string): Promise<import('../../interface.js').BoardSubscriptionRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.boardSubscription.findMany({ where: { boardId } });
        return rows.map((r: any) => this.toBoardSubscriptionRecord(r));
    }

    async listSubscriptionsByAgent(gaii: string): Promise<import('../../interface.js').BoardSubscriptionRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.boardSubscription.findMany({ where: { gaii } });
        return rows.map((r: any) => this.toBoardSubscriptionRecord(r));
    }

    async deleteBoardSubscription(boardId: string, gaii: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.boardSubscription.delete({ where: { boardId_gaii: { boardId, gaii } } });
            return true;
        } catch { return false; }
    }

    private toBoardSubscriptionRecord(row: any): import('../../interface.js').BoardSubscriptionRecord {
        return {
            id: row.id,
            boardId: row.boardId,
            gaii: row.gaii,
            callbackUrl: row.callbackUrl ?? undefined,
            filters: row.filters ?? undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    }

    // ── OTK ─────────────────────────────────────────────────────

    async createOtk(otk: OtkRecord): Promise<OtkRecord> {
        this.ensureReady();
        await this.prisma.otk.create({
            data: {
                key: otk.key,
                ownerGaii: otk.ownerGaii,
                action: otk.action,
                params: otk.params as any,
                expiresAt: new Date(otk.expiresAt),
                used: otk.used,
                createdAt: new Date(otk.createdAt),
            },
        });
        return otk;
    }

    private toOtkRecord(row: any): OtkRecord {
        return {
            key: row.key,
            ownerGaii: row.ownerGaii,
            action: row.action,
            params: row.params as Record<string, unknown>,
            expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
            initial: row.initial ?? false,
            used: row.used,
            usedAt: row.usedAt ? (row.usedAt instanceof Date ? row.usedAt.toISOString() : row.usedAt) : null,
            sessionId: row.sessionId ?? null,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    }

    async getOtk(key: string): Promise<OtkRecord | null> {
        this.ensureReady();
        const row = await this.prisma.otk.findUnique({ where: { key } });
        if (!row) return null;
        return this.toOtkRecord(row);
    }

    async consumeOtk(key: string, graceMs: number = 60_000): Promise<OtkRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.otk.findUnique({ where: { key } });
            if (!row) return null;

            // Initial OTK: timer hasn't started yet — activate on first use
            if ((row as any).initial && !row.used) {
                const updated = await this.prisma.otk.update({
                    where: { key },
                    data: { used: true, usedAt: new Date(), expiresAt: new Date(Date.now() + graceMs) },
                });
                return this.toOtkRecord(updated);
            }

            if (new Date(row.expiresAt) < new Date()) {
                await this.prisma.otk.delete({ where: { key } });
                return null;
            }
            // Configurable post-use window
            if (row.used && row.usedAt) {
                const usedAt = new Date(row.usedAt).getTime();
                if (Date.now() - usedAt > graceMs) {
                    await this.prisma.otk.delete({ where: { key } });
                    return null;
                }
                return this.toOtkRecord(row);
            }
            const updated = await this.prisma.otk.update({
                where: { key },
                data: { used: true, usedAt: new Date() },
            });
            return this.toOtkRecord(updated);
        } catch { return null; }
    }

    async listOtksBySession(sessionId: string): Promise<OtkRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.otk.findMany({ where: { sessionId } });
        return rows.map((r: any) => this.toOtkRecord(r));
    }

    async expireSessionOtks(sessionId: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.otk.deleteMany({ where: { sessionId } });
        return result.count;
    }

    // ── Disputes ────────────────────────────────────────────────

    async createDispute(dispute: DisputeRecord): Promise<DisputeRecord> {
        this.ensureReady();
        await this.prisma.dispute.create({
            data: {
                disputeId: dispute.id,
                trackingCode: dispute.trackingCode,
                status: dispute.status,
                openedBy: dispute.openedBy,
                reason: dispute.reason,
                createdAt: new Date(dispute.createdAt),
                updatedAt: new Date(dispute.updatedAt),
            },
        });
        return dispute;
    }

    async getDispute(id: string): Promise<DisputeRecord | null> {
        this.ensureReady();
        const row = await this.prisma.dispute.findUnique({ where: { disputeId: id } });
        return row ? this.toDisputeRecord(row) : null;
    }

    async getDisputeByTrackingCode(tc: string): Promise<DisputeRecord | null> {
        this.ensureReady();
        const row = await this.prisma.dispute.findFirst({ where: { trackingCode: tc } });
        return row ? this.toDisputeRecord(row) : null;
    }

    async updateDispute(id: string, updates: Partial<DisputeRecord>): Promise<DisputeRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.status) data.status = updates.status;
            if (updates.ruling) data.ruling = updates.ruling as any;
            if (updates.updatedAt) data.updatedAt = new Date(updates.updatedAt);
            const row = await this.prisma.dispute.update({ where: { disputeId: id }, data });
            return this.toDisputeRecord(row);
        } catch { return null; }
    }

    async addDisputeAuditEntry(disputeId: string, entry: DisputeAuditEntry): Promise<DisputeAuditEntry> {
        this.ensureReady();
        await this.prisma.disputeAudit.create({
            data: {
                disputeId,
                sequence: entry.sequence,
                event: entry.event,
                actor: entry.actor,
                timestamp: new Date(entry.timestamp),
                data: entry.data as any,
                hash: entry.hash,
                previousHash: entry.previousHash,
            },
        });
        return entry;
    }

    async getDisputeAuditLog(disputeId: string): Promise<DisputeAuditEntry[]> {
        this.ensureReady();
        const rows = await this.prisma.disputeAudit.findMany({
            where: { disputeId },
            orderBy: { sequence: 'asc' },
        });
        return rows.map((r: any) => ({
            sequence: r.sequence,
            event: r.event,
            actor: r.actor,
            timestamp: r.timestamp.toISOString(),
            data: r.data as Record<string, unknown>,
            hash: r.hash,
            previousHash: r.previousHash,
        }));
    }

    async listDisputesByProvider(gaii: string): Promise<DisputeRecord[]> {
        this.ensureReady();
        // Find disputes through work items
        const workItems = await this.prisma.work.findMany({
            where: { providerGaii: gaii },
            select: { trackingCode: true },
        });
        const tcs = workItems.map((w: any) => w.trackingCode);
        if (tcs.length === 0) return [];
        const rows = await this.prisma.dispute.findMany({ where: { trackingCode: { in: tcs } } });
        return rows.map((r: any) => this.toDisputeRecord(r));
    }

    async listAllDisputes(limit = 10000): Promise<DisputeRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.dispute.findMany({ take: Math.min(limit, 10000), orderBy: { createdAt: 'desc' } });
        return rows.map((r: any) => this.toDisputeRecord(r));
    }

    // ── Micro-Memory ────────────────────────────────────────────

    async setMicroMemory(record: MicroMemoryRecord): Promise<MicroMemoryRecord> {
        this.ensureReady();
        await this.prisma.microMemory.upsert({
            where: { gaii_setName: { gaii: record.gaii, setName: record.set } },
            create: {
                gaii: record.gaii,
                setName: record.set,
                entries: record.entries as any,
                visibility: record.visibility,
                accessCode: record.accessCode,
                updatedAt: new Date(record.updatedAt),
            },
            update: {
                entries: record.entries as any,
                visibility: record.visibility,
                accessCode: record.accessCode,
                updatedAt: new Date(record.updatedAt),
            },
        });
        return record;
    }

    async getMicroMemory(gaii: string, set: string): Promise<MicroMemoryRecord | null> {
        this.ensureReady();
        const row = await this.prisma.microMemory.findUnique({
            where: { gaii_setName: { gaii, setName: set } },
        });
        if (!row) return null;
        return { gaii: row.gaii, set: row.setName, entries: row.entries as Record<string, string>, visibility: row.visibility as any, accessCode: row.accessCode ?? undefined, updatedAt: row.updatedAt.toISOString() };
    }

    async listMicroMemorySets(gaii: string): Promise<MicroMemoryRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.microMemory.findMany({ where: { gaii } });
        return rows.map((r: any) => ({ gaii: r.gaii, set: r.setName, entries: r.entries as Record<string, string>, visibility: r.visibility as any, accessCode: r.accessCode ?? undefined, updatedAt: r.updatedAt.toISOString() }));
    }

    async deleteMicroMemory(gaii: string, set: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.microMemory.delete({ where: { gaii_setName: { gaii, setName: set } } });
            return true;
        } catch { return false; }
    }

    async deleteMicroMemoryEntry(gaii: string, set: string, key: string): Promise<boolean> {
        this.ensureReady();
        const record = await this.getMicroMemory(gaii, set);
        if (!record || !(key in record.entries)) return false;
        delete record.entries[key];
        await this.setMicroMemory(record);
        return true;
    }

    async findMicroMemoryByAccessCode(set: string, accessCode: string): Promise<MicroMemoryRecord | null> {
        this.ensureReady();
        const row = await this.prisma.microMemory.findFirst({
            where: {
                setName: set,
                accessCode: accessCode,
                visibility: { in: ['shared_read', 'shared_write'] },
            },
        });
        if (!row) return null;
        return { gaii: row.gaii, set: row.setName, entries: row.entries as Record<string, string>, visibility: row.visibility as any, accessCode: row.accessCode ?? undefined, updatedAt: row.updatedAt.toISOString() };
    }

    // ── Storage Files ───────────────────────────────────────────

    async createStorageFile(file: StorageFileRecord): Promise<StorageFileRecord> {
        this.ensureReady();
        // Upsert semantics to match SQLite's INSERT OR REPLACE — re-uploading to
        // the same (ownerGaii, key) replaces the existing file rather than
        // failing on the unique constraint.
        await this.prisma.storageFile.upsert({
            where: { ownerGaii_key: { ownerGaii: file.ownerGaii, key: file.key } },
            create: {
                key: file.key,
                ownerGaii: file.ownerGaii,
                visibility: file.visibility,
                mimeType: file.mimeType,
                size: file.size,
                data: file.data,
                tags: file.tags || [],
                federate: file.federate ?? false,
                groupId: file.groupId ?? null,
                createdAt: new Date(file.createdAt),
            },
            update: {
                visibility: file.visibility,
                mimeType: file.mimeType,
                size: file.size,
                data: file.data,
                tags: file.tags || [],
                federate: file.federate ?? false,
                groupId: file.groupId ?? null,
                createdAt: new Date(file.createdAt),
            },
        });
        return file;
    }

    async getStorageFile(ownerGaii: string, key: string): Promise<StorageFileRecord | null> {
        this.ensureReady();
        const row = await this.prisma.storageFile.findUnique({
            where: { ownerGaii_key: { ownerGaii, key } },
        });
        if (!row) return null;
        return { key: row.key, ownerGaii: row.ownerGaii, visibility: row.visibility as any, groupId: row.groupId ?? undefined, mimeType: row.mimeType, size: row.size, data: Buffer.from(row.data), tags: (row as any).tags || [], federate: (row as any).federate ?? false, createdAt: row.createdAt.toISOString() };
    }

    async listStorageFiles(ownerGaii: string): Promise<StorageFileRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.storageFile.findMany({
            where: { ownerGaii },
            select: { key: true, ownerGaii: true, visibility: true, groupId: true, mimeType: true, size: true, tags: true, federate: true, createdAt: true },
        });
        return rows.map((r: any) => ({
            key: r.key, ownerGaii: r.ownerGaii, visibility: r.visibility, groupId: r.groupId ?? undefined, mimeType: r.mimeType, size: r.size, data: Buffer.alloc(0), tags: r.tags || [], federate: r.federate ?? false, createdAt: r.createdAt.toISOString(),
        }));
    }

    async deleteStorageFile(ownerGaii: string, key: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.storageFile.delete({ where: { ownerGaii_key: { ownerGaii, key } } });
            return true;
        } catch { return false; }
    }

    async updateFileTagsByKey(ownerGaii: string, key: string, tags: string[]): Promise<StorageFileRecord | null> {
        this.ensureReady();
        const updated = await this.prisma.storageFile.updateMany({
            where: { ownerGaii, key },
            data: { tags },
        });
        if (updated.count === 0) return null;
        return this.getStorageFile(ownerGaii, key);
    }

    async updateFileVisibility(ownerGaii: string, key: string, visibility: StorageFileRecord['visibility']): Promise<StorageFileRecord | null> {
        this.ensureReady();
        const updated = await this.prisma.storageFile.updateMany({
            where: { ownerGaii, key },
            data: { visibility },
        });
        if (updated.count === 0) return null;
        return this.getStorageFile(ownerGaii, key);
    }

    // ── Peering Requests ────────────────────────────────────────

    async createPeeringRequest(req: PeeringRequestRecord): Promise<PeeringRequestRecord> {
        this.ensureReady();
        await this.prisma.peeringRequest.create({
            data: {
                requestId: req.id,
                fromNodeUrl: req.fromNodeUrl,
                fromNodeId: req.fromNodeId,
                toNodeId: req.toNodeId,
                targetUrl: req.targetUrl,
                publicKey: req.publicKey,
                message: req.message,
                status: req.status,
                createdAt: new Date(req.createdAt),
                updatedAt: new Date(req.updatedAt),
            },
        });
        return req;
    }

    async getPeeringRequest(id: string): Promise<PeeringRequestRecord | null> {
        this.ensureReady();
        const row = await this.prisma.peeringRequest.findUnique({ where: { requestId: id } });
        if (!row) return null;
        return this.toPeeringRecord(row);
    }

    async listPeeringRequests(status?: string): Promise<PeeringRequestRecord[]> {
        this.ensureReady();
        const where: any = {};
        if (status) where.status = status;
        const rows = await this.prisma.peeringRequest.findMany({ where });
        return rows.map((r: any) => this.toPeeringRecord(r));
    }

    async updatePeeringRequest(id: string, updates: Partial<PeeringRequestRecord>): Promise<PeeringRequestRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.peeringRequest.update({
                where: { requestId: id },
                data: { status: updates.status, updatedAt: updates.updatedAt ? new Date(updates.updatedAt) : new Date() },
            });
            return this.toPeeringRecord(row);
        } catch { return null; }
    }

    async deletePeeringRequest(id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.peeringRequest.delete({ where: { requestId: id } });
            return true;
        } catch { return false; }
    }

    // ── Chunked Uploads (kept in-memory — transient) ───────────

    async createChunkedUpload(record: ChunkedUploadRecord): Promise<ChunkedUploadRecord> {
        this.chunkedUploads.set(record.uploadId, record);
        return record;
    }

    async getChunkedUpload(uploadId: string): Promise<ChunkedUploadRecord | null> {
        return this.chunkedUploads.get(uploadId) ?? null;
    }

    async addChunk(uploadId: string, chunkIndex: number, data: Buffer): Promise<boolean> {
        const upload = this.chunkedUploads.get(uploadId);
        if (!upload) return false;
        upload.receivedChunks.set(chunkIndex, data);
        return true;
    }

    async deleteChunkedUpload(uploadId: string): Promise<boolean> {
        return this.chunkedUploads.delete(uploadId);
    }

    // ── Node Key ────────────────────────────────────────────────

    async setNodeKey(publicKey: string, privateKey: string): Promise<void> {
        this.ensureReady();
        const existing = await this.prisma.nodeKey.findFirst();
        if (existing) {
            await this.prisma.nodeKey.update({ where: { id: existing.id }, data: { publicKey, privateKey } });
        } else {
            await this.prisma.nodeKey.create({ data: { publicKey, privateKey } });
        }
    }

    async getNodeKey(): Promise<{ publicKey: string; privateKey: string } | null> {
        this.ensureReady();
        const row = await this.prisma.nodeKey.findFirst();
        return row ? { publicKey: row.publicKey, privateKey: row.privateKey } : null;
    }

    // ── Record Mappers ──────────────────────────────────────────

    private toOwnerRecord(row: any): OwnerRecord {
        return { name: row.name, displayName: row.displayName ?? undefined, publicKey: row.publicKey, roles: row.roles, createdAt: row.createdAt.toISOString() };
    }

    private toAgentRecord(row: any): AgentRecord {
        return { name: row.name, owner: row.owner, gaii: row.gaii, displayName: row.displayName ?? undefined, description: row.description ?? undefined, capabilities: row.capabilities, publicKey: row.publicKey, trustScore: row.trustScore, morselBalance: row.morselBalance, defaultScopes: row.defaultScopes?.length ? row.defaultScopes : undefined, allowedOrigins: row.allowedOrigins?.length ? row.allowedOrigins : undefined, federate: row.federate ?? false, technicalCapabilities: row.technicalCapabilities ?? undefined, domainCapabilities: row.domainCapabilities ?? undefined, languages: row.languages ?? undefined, activityStats: row.activityStats ?? undefined, modulesLoaded: row.modulesLoaded ?? undefined, agentLimitations: row.agentLimitations ?? undefined, webhookUrl: row.webhookUrl ?? undefined, webhookSecret: row.webhookSecret ?? undefined, webhookEnabled: row.webhookEnabled ?? false, webhookLastSuccess: row.webhookLastSuccess ? row.webhookLastSuccess.toISOString() : undefined, webhookLastFailure: row.webhookLastFailure ? row.webhookLastFailure.toISOString() : undefined, webhookFailCount: row.webhookFailCount ?? 0, platform: row.platform ?? undefined, platformVersion: row.platformVersion ?? undefined, platformDetectedBy: row.platformDetectedBy ?? undefined, tags: row.tags?.length ? row.tags : undefined, mode: (row.mode ?? 'interactive') as AgentRecord['mode'], maxConcurrentTasks: row.maxConcurrentTasks ?? 1, dailySpendLimit: row.dailySpendLimit ?? undefined, scheduleConstraintDefaults: row.scheduleConstraintDefaults ?? undefined, createdAt: row.createdAt.toISOString(), lastSeen: row.lastSeen.toISOString() };
    }

    private toMemoryRecord(row: any): MemoryRecord {
        return { key: row.key, ownerGaii: row.ownerGaii, value: row.value, visibility: row.visibility as any, groupId: row.groupId ?? undefined, tags: row.tags, ttlHours: row.ttlHours, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), flagCount: row.flagCount ?? undefined, allowedOrigins: row.allowedOrigins?.length ? row.allowedOrigins : undefined };
    }

    private toActionRecord(row: any): ActionRecord {
        return { id: row.actionId, providerGaii: row.providerGaii, displayName: row.displayName, description: row.description, category: row.category ?? undefined, inputSchema: row.inputSchema as Record<string, unknown>, outputSchema: row.outputSchema as Record<string, unknown>, pricing: { baseMorsels: row.pricingBaseMorsels, perUnit: row.pricingPerUnit as any }, estimatedTimeSeconds: row.estimatedTimeSeconds ?? undefined, maxInputSizeBytes: row.maxInputSizeBytes ?? undefined, tags: row.tags, webhookUrl: row.webhookUrl ?? undefined, semantic: row.semantic as any ?? undefined, federate: row.federate ?? false, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
    }

    private toWorkRecord(row: any): WorkRecord {
        return { trackingCode: row.trackingCode, status: row.status, actionId: row.actionId, providerGaii: row.providerGaii, requesterGaii: row.requesterGaii, input: row.input as Record<string, unknown>, output: row.output as Record<string, unknown> | undefined, cost: { basePrice: row.costBasePrice, networkFee: row.costNetworkFee, total: row.costTotal, inEscrow: row.costInEscrow }, ttlExpiresAt: row.ttlExpiresAt.toISOString(), callbackUrl: row.callbackUrl ?? undefined, rating: row.ratingScore != null ? { score: row.ratingScore, comment: row.ratingComment ?? undefined } : undefined, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
    }

    private toBoardRecord(row: any): BoardRecord {
        return { id: row.boardId, name: row.name, description: row.description ?? undefined, visibility: row.visibility as any, ownerGaii: row.ownerGaii, allowedGaiis: row.allowedGaiis, federate: row.federate ?? false, createdAt: row.createdAt.toISOString() };
    }

    private toPostRecord(row: any): BoardPostRecord {
        return { id: row.postId, boardId: row.boardId, authorGaii: row.authorGaii, title: row.title, body: row.body, category: row.category ?? undefined, tags: row.tags, ttlExpiresAt: row.ttlExpiresAt?.toISOString(), reactions: row.reactions as Record<string, string[]>, replyTo: row.replyTo ?? undefined, createdAt: row.createdAt.toISOString() };
    }

    private toDisputeRecord(row: any): DisputeRecord {
        return { id: row.disputeId, trackingCode: row.trackingCode, status: row.status as any, openedBy: row.openedBy, reason: row.reason, ruling: row.ruling as any, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
    }

    private toPeeringRecord(row: any): PeeringRequestRecord {
        return { id: row.requestId, fromNodeUrl: row.fromNodeUrl, fromNodeId: row.fromNodeId ?? undefined, toNodeId: row.toNodeId ?? undefined, targetUrl: row.targetUrl ?? undefined, publicKey: row.publicKey ?? undefined, message: row.message ?? undefined, status: row.status as any, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
    }

    // ── GHII (persisted via Prisma) ──

    private toGHIIRecord(row: any): GHIIRecord {
        return {
            username: row.username,
            nodeId: row.nodeId,
            ghii: row.ghii,
            displayName: row.displayName,
            bio: row.bio ?? undefined,
            avatar: row.avatar ?? undefined,
            locale: row.locale ?? undefined,
            passwordHash: row.passwordHash ?? undefined,
            verificationLevel: row.verificationLevel as 0 | 1 | 2 | 3,
            ownerName: row.ownerName,
            totpSecret: row.totpSecret ?? undefined,
            totpEnabled: row.totpEnabled ?? false,
            totpBackupCodes: row.totpBackupCodes ?? undefined,
            totpLastUsedAt: row.totpLastUsedAt ?? undefined,
            totpLastUsedCode: row.totpLastUsedCode ?? undefined,
            totpFailedAttempts: row.totpFailedAttempts ?? undefined,
            totpLockedUntil: row.totpLockedUntil ?? undefined,
            emailHash: row.emailHash ?? undefined,
            emailVerifiedAt: row.emailVerifiedAt ?? undefined,
            notificationEmail: row.notificationEmail ?? undefined,
            verificationMethod: row.verificationMethod ?? undefined,
            magicLinkEnabled: row.magicLinkEnabled ?? undefined,
            lastLoginAt: row.lastLoginAt ?? undefined,
            loginCount: row.loginCount ?? undefined,
            verifiedAttributes: row.verifiedAttributes ?? undefined,
            verificationIssuer: row.verificationIssuer ?? undefined,
            verificationCredentialHash: row.verificationCredentialHash ?? undefined,
            ftnVerified: row.ftnVerified ?? undefined,
            trustScore: row.trustScore ?? undefined,
            morselBalance: row.morselBalance ?? undefined,
            allowedOrigins: row.allowedOrigins?.length ? row.allowedOrigins : undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
            semantic: undefined,
        };
    }

    async createGHII(record: GHIIRecord): Promise<GHIIRecord> {
        this.ensureReady();
        try {
            const row = await this.prisma.ghii.create({
                data: {
                    username: record.username,
                    nodeId: record.nodeId,
                    ghii: record.ghii,
                    displayName: record.displayName,
                    bio: record.bio,
                    avatar: record.avatar,
                    locale: record.locale,
                    passwordHash: record.passwordHash,
                    verificationLevel: record.verificationLevel,
                    ownerName: record.ownerName,
                    totpSecret: record.totpSecret,
                    totpEnabled: record.totpEnabled ?? false,
                    totpBackupCodes: record.totpBackupCodes ?? [],
                    totpLastUsedAt: record.totpLastUsedAt,
                    totpLastUsedCode: record.totpLastUsedCode,
                    totpFailedAttempts: record.totpFailedAttempts ?? 0,
                    totpLockedUntil: record.totpLockedUntil,
                    emailHash: record.emailHash,
                    emailVerifiedAt: record.emailVerifiedAt,
                    notificationEmail: record.notificationEmail,
                    verificationMethod: record.verificationMethod,
                    magicLinkEnabled: record.magicLinkEnabled ?? false,
                    lastLoginAt: record.lastLoginAt,
                    loginCount: record.loginCount ?? 0,
                    verifiedAttributes: record.verifiedAttributes ?? [],
                    verificationIssuer: record.verificationIssuer,
                    verificationCredentialHash: record.verificationCredentialHash,
                    ftnVerified: record.ftnVerified ?? false,
                    trustScore: record.trustScore,
                    morselBalance: record.morselBalance,
                    allowedOrigins: record.allowedOrigins ?? [],
                    createdAt: new Date(record.createdAt),
                    updatedAt: new Date(record.updatedAt),
                },
            });
            return this.toGHIIRecord(row);
        } catch (e: any) {
            if (e?.code === 'P2002') throw new Error('GHII_TAKEN', { cause: e });
            throw e;
        }
    }

    async getGHII(ghii: string): Promise<GHIIRecord | null> {
        this.ensureReady();
        const row = await this.prisma.ghii.findUnique({ where: { ghii } });
        return row ? this.toGHIIRecord(row) : null;
    }

    async getGHIIByOwner(ownerName: string): Promise<GHIIRecord | null> {
        this.ensureReady();
        const row = await this.prisma.ghii.findFirst({ where: { ownerName } });
        return row ? this.toGHIIRecord(row) : null;
    }

    async getGHIIByEmailHash(emailHash: string): Promise<GHIIRecord | null> {
        this.ensureReady();
        const row = await this.prisma.ghii.findFirst({ where: { emailHash } });
        return row ? this.toGHIIRecord(row) : null;
    }

    async updateGHII(ghii: string, updates: Partial<GHIIRecord>): Promise<GHIIRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.ghii.update({ where: { ghii }, data: updates });
            return this.toGHIIRecord(row);
        } catch { return null; }
    }

    async listGHIIs(opts?: { q?: string; level?: number }): Promise<GHIIRecord[]> {
        this.ensureReady();
        const where: any = {};
        if (opts?.q) {
            const q = opts.q;
            where.OR = [
                { username: { contains: q, mode: 'insensitive' } },
                { displayName: { contains: q, mode: 'insensitive' } },
                { bio: { contains: q, mode: 'insensitive' } },
            ];
        }
        if (opts?.level !== undefined) {
            where.verificationLevel = { gte: opts.level };
        }
        const rows = await this.prisma.ghii.findMany({ where });
        return rows.map((r: any) => this.toGHIIRecord(r));
    }

    async deleteGHII(ghii: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.ghii.delete({ where: { ghii } });
            return true;
        } catch { return false; }
    }

    // ── Chat Instances ──

    async createChatInstance(record: ChatInstanceRecord): Promise<ChatInstanceRecord> {
        this.ensureReady();
        await this.prisma.chatInstance.create({
            data: { id: record.id, platform: record.platform, appName: record.appName, ownerName: record.ownerName, ghii: record.ghii, nodeId: record.nodeId, isAnonymous: record.isAnonymous, createdAt: new Date(record.createdAt), lastSeen: new Date(record.lastSeen), agentGaii: record.agentGaii ?? null, mcpClientId: record.mcpClientId ?? null },
        });
        return record;
    }

    async getChatInstance(id: string): Promise<ChatInstanceRecord | null> {
        this.ensureReady();
        const row = await this.prisma.chatInstance.findUnique({ where: { id } });
        return row ? this.toChatInstanceRecord(row) : null;
    }

    async listChatInstances(opts?: { ownerName?: string; platform?: string; ghii?: string }): Promise<ChatInstanceRecord[]> {
        this.ensureReady();
        const where: any = {};
        if (opts?.ownerName) where.ownerName = opts.ownerName;
        if (opts?.platform) where.platform = opts.platform;
        if (opts?.ghii) where.ghii = opts.ghii;
        const rows = await this.prisma.chatInstance.findMany({ where });
        return rows.map((r: any) => this.toChatInstanceRecord(r));
    }

    async updateChatInstance(id: string, updates: Partial<ChatInstanceRecord>): Promise<ChatInstanceRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.lastSeen) data.lastSeen = new Date(updates.lastSeen);
            if (updates.platform) data.platform = updates.platform;
            if (updates.appName) data.appName = updates.appName;
            if (updates.agentGaii !== undefined) data.agentGaii = updates.agentGaii;
            if (updates.mcpClientId !== undefined) data.mcpClientId = updates.mcpClientId;
            const row = await this.prisma.chatInstance.update({ where: { id }, data });
            return this.toChatInstanceRecord(row);
        } catch { return null; }
    }

    async deleteChatInstance(id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.chatInstance.delete({ where: { id } }); return true; } catch { return false; }
    }

    private toChatInstanceRecord(row: any): ChatInstanceRecord {
        return { id: row.id, platform: row.platform, appName: row.appName, ownerName: row.ownerName, ghii: row.ghii, nodeId: row.nodeId, isAnonymous: row.isAnonymous, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, lastSeen: row.lastSeen instanceof Date ? row.lastSeen.toISOString() : row.lastSeen, agentGaii: row.agentGaii || undefined, mcpClientId: row.mcpClientId || undefined };
    }

    // ── Personal Nodes ──

    async createPersonalNode(node: PersonalNodeRecord): Promise<PersonalNodeRecord> {
        this.ensureReady();
        await this.prisma.personalNode.create({
            data: { id: node.nodeId, ownerName: node.ownerName, anchorNodeId: node.anchorNodeId, publicKey: node.publicKey, status: node.status, agentGaiis: node.agentGaiis, lastSeen: new Date(node.lastSeen), mailboxQuotaBytes: node.mailboxQuotaBytes, mailboxUsedBytes: node.mailboxUsedBytes, visibility: node.visibility, createdAt: new Date(node.createdAt) },
        });
        return node;
    }

    async getPersonalNode(nodeId: string): Promise<PersonalNodeRecord | null> {
        this.ensureReady();
        const row = await this.prisma.personalNode.findUnique({ where: { id: nodeId } });
        return row ? this.toPersonalNodeRecord(row) : null;
    }

    async getPersonalNodeByOwner(ownerName: string): Promise<PersonalNodeRecord | null> {
        this.ensureReady();
        const row = await this.prisma.personalNode.findFirst({ where: { ownerName } });
        return row ? this.toPersonalNodeRecord(row) : null;
    }

    async listPersonalNodes(opts?: { status?: string }): Promise<PersonalNodeRecord[]> {
        this.ensureReady();
        const where: any = {};
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.personalNode.findMany({ where });
        return rows.map((r: any) => this.toPersonalNodeRecord(r));
    }

    async updatePersonalNode(nodeId: string, updates: Partial<PersonalNodeRecord>): Promise<PersonalNodeRecord | null> {
        this.ensureReady();
        try {
            const data: any = { ...updates };
            delete data.nodeId;
            if (data.lastSeen && typeof data.lastSeen === 'string') data.lastSeen = new Date(data.lastSeen);
            if (data.createdAt && typeof data.createdAt === 'string') data.createdAt = new Date(data.createdAt);
            const row = await this.prisma.personalNode.update({ where: { id: nodeId }, data });
            return this.toPersonalNodeRecord(row);
        } catch { return null; }
    }

    async deletePersonalNode(nodeId: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.personalNode.delete({ where: { id: nodeId } }); return true; } catch { return false; }
    }

    private toPersonalNodeRecord(row: any): PersonalNodeRecord {
        return { nodeId: row.id, ownerName: row.ownerName, anchorNodeId: row.anchorNodeId, publicKey: row.publicKey, status: row.status, agentGaiis: row.agentGaiis, lastSeen: row.lastSeen instanceof Date ? row.lastSeen.toISOString() : row.lastSeen, mailboxQuotaBytes: row.mailboxQuotaBytes, mailboxUsedBytes: row.mailboxUsedBytes, visibility: row.visibility, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt };
    }

    // ── Mailbox ──

    async createMailboxItem(item: MailboxItemRecord): Promise<MailboxItemRecord> {
        this.ensureReady();
        await this.prisma.mailboxItem.create({
            data: { id: item.id, personalNodeId: item.personalNodeId, type: item.type, fromGaii: item.fromGaii, toGaii: item.toGaii, payload: item.payload, sizeBytes: item.sizeBytes, retentionDays: item.retentionDays, expiresAt: new Date(item.expiresAt), createdAt: new Date(item.createdAt) },
        });
        // Update personal node mailbox usage
        try { await this.prisma.personalNode.update({ where: { id: item.personalNodeId }, data: { mailboxUsedBytes: { increment: item.sizeBytes } } }); } catch { /* best-effort */ }
        return item;
    }

    async getMailboxItem(id: string): Promise<MailboxItemRecord | null> {
        this.ensureReady();
        const row = await this.prisma.mailboxItem.findUnique({ where: { id } });
        return row ? this.toMailboxItemRecord(row) : null;
    }

    async listMailboxItems(personalNodeId: string, opts?: { type?: string; limit?: number }): Promise<MailboxItemRecord[]> {
        this.ensureReady();
        const where: any = { personalNodeId };
        if (opts?.type) where.type = opts.type;
        const rows = await this.prisma.mailboxItem.findMany({ where, orderBy: { createdAt: 'asc' }, take: opts?.limit });
        return rows.map((r: any) => this.toMailboxItemRecord(r));
    }

    async deleteMailboxItem(id: string): Promise<boolean> {
        this.ensureReady();
        try {
            const item = await this.prisma.mailboxItem.findUnique({ where: { id } });
            if (!item) return false;
            await this.prisma.mailboxItem.delete({ where: { id } });
            try { await this.prisma.personalNode.update({ where: { id: item.personalNodeId }, data: { mailboxUsedBytes: { decrement: item.sizeBytes } } }); } catch { /* best-effort */ }
            return true;
        } catch { return false; }
    }

    async deleteMailboxItemsByNode(personalNodeId: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.mailboxItem.deleteMany({ where: { personalNodeId } });
        try { await this.prisma.personalNode.update({ where: { id: personalNodeId }, data: { mailboxUsedBytes: 0 } }); } catch { /* best-effort */ }
        return result.count;
    }

    async getMailboxStats(personalNodeId: string): Promise<{ count: number; totalBytes: number }> {
        this.ensureReady();
        const result = await this.prisma.mailboxItem.aggregate({ where: { personalNodeId }, _count: true, _sum: { sizeBytes: true } });
        return { count: result._count, totalBytes: result._sum.sizeBytes ?? 0 };
    }

    async cleanExpiredMailboxItems(): Promise<number> {
        this.ensureReady();
        const expired = await this.prisma.mailboxItem.findMany({ where: { expiresAt: { lt: new Date() } }, select: { id: true, personalNodeId: true, sizeBytes: true } });
        if (expired.length === 0) return 0;
        // Update personal node usage for each affected node
        const nodeBytes = new Map<string, number>();
        for (const item of expired) {
            nodeBytes.set(item.personalNodeId, (nodeBytes.get(item.personalNodeId) ?? 0) + item.sizeBytes);
        }
        for (const [nodeId, bytes] of nodeBytes) {
            try { await this.prisma.personalNode.update({ where: { id: nodeId }, data: { mailboxUsedBytes: { decrement: bytes } } }); } catch { /* best-effort */ }
        }
        const result = await this.prisma.mailboxItem.deleteMany({ where: { expiresAt: { lt: new Date() } } });
        return result.count;
    }

    private toMailboxItemRecord(row: any): MailboxItemRecord {
        return { id: row.id, personalNodeId: row.personalNodeId, type: row.type, fromGaii: row.fromGaii, toGaii: row.toGaii, payload: row.payload, sizeBytes: row.sizeBytes, retentionDays: row.retentionDays, expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt };
    }

    // ── Maintenance Mode ────────────────────────────────────────

    async getMaintenanceMode(): Promise<import('../../interface.js').MaintenanceState> {
        this.ensureReady();
        const row = await this.prisma.systemSetting.findUnique({ where: { key: 'maintenance' } });
        if (!row) return { enabled: false, message: '', enabledAt: null, enabledBy: null };
        return JSON.parse(row.value) as import('../../interface.js').MaintenanceState;
    }

    async setMaintenanceMode(state: import('../../interface.js').MaintenanceState): Promise<import('../../interface.js').MaintenanceState> {
        this.ensureReady();
        await this.prisma.systemSetting.upsert({
            where: { key: 'maintenance' },
            create: { key: 'maintenance', value: JSON.stringify(state) },
            update: { value: JSON.stringify(state) },
        });
        return state;
    }

    // ── Schema Locking ──

    async setSchema(record: SchemaRecord): Promise<SchemaRecord> {
        this.ensureReady();
        await this.prisma.schemaLock.upsert({
            where: { applyTo_keyPattern: { applyTo: record.applyTo, keyPattern: record.keyPattern } },
            create: { keyPattern: record.keyPattern, applyTo: record.applyTo, schemaJson: record.schemaJson as any, schemaMode: record.schemaMode, lockedBy: record.lockedBy, setAt: new Date(record.setAt), semanticContext: record.semanticContext as any ?? null },
            update: { schemaJson: record.schemaJson as any, schemaMode: record.schemaMode, lockedBy: record.lockedBy, semanticContext: record.semanticContext as any ?? null },
        });
        return record;
    }

    async getSchema(keyPattern: string, applyTo?: 'exact' | 'prefix'): Promise<SchemaRecord | null> {
        this.ensureReady();
        if (applyTo) {
            const row = await this.prisma.schemaLock.findUnique({ where: { applyTo_keyPattern: { applyTo, keyPattern } } });
            return row ? this.toSchemaRecord(row) : null;
        }
        const exact = await this.prisma.schemaLock.findUnique({ where: { applyTo_keyPattern: { applyTo: 'exact', keyPattern } } });
        if (exact) return this.toSchemaRecord(exact);
        const prefix = await this.prisma.schemaLock.findUnique({ where: { applyTo_keyPattern: { applyTo: 'prefix', keyPattern } } });
        return prefix ? this.toSchemaRecord(prefix) : null;
    }

    async deleteSchema(keyPattern: string): Promise<boolean> {
        this.ensureReady();
        let deleted = false;
        try { await this.prisma.schemaLock.delete({ where: { applyTo_keyPattern: { applyTo: 'exact', keyPattern } } }); deleted = true; } catch { /* best-effort */ }
        try { await this.prisma.schemaLock.delete({ where: { applyTo_keyPattern: { applyTo: 'prefix', keyPattern } } }); deleted = true; } catch { /* best-effort */ }
        return deleted;
    }

    async listSchemas(prefix?: string): Promise<SchemaRecord[]> {
        this.ensureReady();
        const where: any = {};
        if (prefix) where.keyPattern = { startsWith: prefix };
        const rows = await this.prisma.schemaLock.findMany({ where });
        return rows.map((r: any) => this.toSchemaRecord(r));
    }

    async findApplicableSchema(memoryKey: string): Promise<SchemaRecord | null> {
        this.ensureReady();
        // 1. Exact match — highest priority
        const exact = await this.prisma.schemaLock.findUnique({ where: { applyTo_keyPattern: { applyTo: 'exact', keyPattern: memoryKey } } });
        if (exact) return this.toSchemaRecord(exact);

        // 2. Load all prefix schemas for pattern matching
        const prefixSchemas = await this.prisma.schemaLock.findMany({ where: { applyTo: 'prefix' } });
        const allPrefixRecords = prefixSchemas.map((r: any) => this.toSchemaRecord(r));

        // 2a. Wildcard pattern match — supports profile.*.interests style (dot-separated)
        let bestWildcard: SchemaRecord | null = null;
        let bestSegments = 0;
        for (const record of allPrefixRecords) {
            if (!record.keyPattern.includes('*')) continue;
            if (mongoMatchWildcardPattern(record.keyPattern, memoryKey)) {
                const segments = record.keyPattern.split('.').length;
                if (segments > bestSegments) { bestWildcard = record; bestSegments = segments; }
            }
        }
        if (bestWildcard) return bestWildcard;

        // 2b. Glob-style pattern match — supports "recipe:*", "sensor:*" style (colon-separated)
        let bestGlob: SchemaRecord | null = null;
        let bestGlobLen = 0;
        for (const record of allPrefixRecords) {
            if (!record.keyPattern.includes('*')) continue;
            if (mongoMatchGlobPattern(record.keyPattern, memoryKey)) {
                if (record.keyPattern.length > bestGlobLen) { bestGlob = record; bestGlobLen = record.keyPattern.length; }
            }
        }
        if (bestGlob) return bestGlob;

        // 3. Simple prefix match — longest prefix wins
        const parts = memoryKey.split('.');
        for (let i = parts.length - 1; i >= 1; i--) {
            const pfx = parts.slice(0, i).join('.');
            const pfxRow = await this.prisma.schemaLock.findUnique({ where: { applyTo_keyPattern: { applyTo: 'prefix', keyPattern: pfx } } });
            if (pfxRow) return this.toSchemaRecord(pfxRow);
        }
        return null;
    }

    private toSchemaRecord(row: any): SchemaRecord {
        return { keyPattern: row.keyPattern, applyTo: row.applyTo, schemaJson: row.schemaJson as Record<string, unknown>, schemaMode: row.schemaMode, lockedBy: row.lockedBy, setAt: row.setAt instanceof Date ? row.setAt.toISOString() : row.setAt, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt, semanticContext: row.semanticContext ?? undefined };
    }

    // ── Consent Layer ──

    async createConsent(record: ConsentRecord): Promise<ConsentRecord> {
        this.ensureReady();
        await this.prisma.consent.create({
            data: { id: record.id, ownerGaii: record.ownerGaii, dataPattern: record.dataPattern, recipient: record.recipient, purpose: record.purpose, scope: record.scope, expires: record.expires ? new Date(record.expires) : null, status: record.status, grantedAt: new Date(record.grantedAt), revokedAt: record.revokedAt ? new Date(record.revokedAt) : null, metadata: record.metadata as any ?? null },
        });
        return record;
    }

    async getConsent(id: string): Promise<ConsentRecord | null> {
        this.ensureReady();
        const row = await this.prisma.consent.findUnique({ where: { id } });
        return row ? this.toConsentRecord(row) : null;
    }

    async listConsents(ownerGaii: string, opts?: { status?: 'active' | 'revoked' | 'expired'; recipient?: string }): Promise<ConsentRecord[]> {
        this.ensureReady();
        const where: any = { ownerGaii };
        if (opts?.status) where.status = opts.status;
        if (opts?.recipient) where.recipient = opts.recipient;
        const rows = await this.prisma.consent.findMany({ where });
        return rows.map((r: any) => this.toConsentRecord(r));
    }

    async updateConsent(id: string, updates: Partial<ConsentRecord>): Promise<ConsentRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.status) data.status = updates.status;
            if (updates.revokedAt) data.revokedAt = new Date(updates.revokedAt);
            if (updates.expires !== undefined) data.expires = updates.expires ? new Date(updates.expires) : null;
            if (updates.metadata !== undefined) data.metadata = updates.metadata as any;
            const row = await this.prisma.consent.update({ where: { id }, data });
            return this.toConsentRecord(row);
        } catch { return null; }
    }

    async deleteConsent(id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.consent.delete({ where: { id } }); return true; } catch { return false; }
    }

    async findMatchingConsents(ownerGaii: string, memoryKey: string, accessorGaii: string): Promise<ConsentRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.consent.findMany({ where: { ownerGaii, status: 'active' } });
        const now = new Date().toISOString();
        const results: ConsentRecord[] = [];

        for (const row of rows) {
            const consent = this.toConsentRecord(row);
            // Check expiration
            if (consent.expires && consent.expires < now) {
                await this.prisma.consent.update({ where: { id: consent.id }, data: { status: 'expired' } });
                continue;
            }
            // Check recipient
            const accessor = parseGaiiLoose(accessorGaii);
            if (!matchesRecipient(consent.recipient, accessorGaii, accessor.owner, accessor.node)) continue;
            // Check data_pattern (glob match)
            if (!mongoConsentMatchPattern(consent.dataPattern, memoryKey)) continue;
            results.push(consent);
        }
        return results;
    }

    async expireStaleConsents(before: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.consent.updateMany({
            where: { status: 'active', expires: { not: null, lt: new Date(before) } },
            data: { status: 'expired' },
        });
        return result.count;
    }

    // Consent Audit
    async addConsentAuditEntry(entry: ConsentAuditEntry): Promise<ConsentAuditEntry> {
        this.ensureReady();
        await this.prisma.consentAudit.create({
            data: { consentId: entry.consentId, ownerGaii: entry.ownerGaii, accessorGaii: entry.accessorGaii, memoryKey: entry.memoryKey, action: entry.action, timestamp: new Date(entry.timestamp), allowed: entry.allowed },
        });
        return entry;
    }

    async listConsentAudit(ownerGaii: string, opts?: { days?: number; consentId?: string; accessorGaii?: string }): Promise<ConsentAuditEntry[]> {
        this.ensureReady();
        const where: any = { ownerGaii };
        if (opts?.days) where.timestamp = { gte: new Date(Date.now() - opts.days * 86400000) };
        if (opts?.consentId) where.consentId = opts.consentId;
        if (opts?.accessorGaii) where.accessorGaii = opts.accessorGaii;
        const rows = await this.prisma.consentAudit.findMany({ where, orderBy: { timestamp: 'desc' } });
        return rows.map((r: any) => ({ id: r.id, consentId: r.consentId, ownerGaii: r.ownerGaii, accessorGaii: r.accessorGaii, memoryKey: r.memoryKey, action: r.action, timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp, allowed: r.allowed }));
    }

    private toConsentRecord(row: any): ConsentRecord {
        return { id: row.id, ownerGaii: row.ownerGaii, dataPattern: row.dataPattern, recipient: row.recipient, purpose: row.purpose, scope: row.scope, expires: row.expires ? (row.expires instanceof Date ? row.expires.toISOString() : row.expires) : null, status: row.status, grantedAt: row.grantedAt instanceof Date ? row.grantedAt.toISOString() : row.grantedAt, revokedAt: row.revokedAt ? (row.revokedAt instanceof Date ? row.revokedAt.toISOString() : row.revokedAt) : null, metadata: row.metadata ?? undefined };
    }

    // ── CSM — Community Service Manifest ──

    async createCsm(record: CsmRecord): Promise<CsmRecord> {
        this.ensureReady();
        try {
            await this.prisma.csm.create({
                data: { name: record.name, definition: record.definition as any, jsonSchemaKey: record.jsonSchemaKey, serviceType: record.serviceType, registeredBy: record.registeredBy, registeredAt: new Date(record.registeredAt), semantic: record.semantic as any ?? null, federate: record.federate ?? false },
            });
            return record;
        } catch { throw new Error('CSM_NAME_TAKEN'); }
    }

    async getCsm(name: string): Promise<CsmRecord | null> {
        this.ensureReady();
        const row = await this.prisma.csm.findUnique({ where: { name } });
        return row ? this.toCsmRecord(row) : null;
    }

    async listCsms(opts?: { serviceType?: string }): Promise<CsmRecord[]> {
        this.ensureReady();
        const where: any = {};
        if (opts?.serviceType) where.serviceType = opts.serviceType;
        const rows = await this.prisma.csm.findMany({ where });
        return rows.map((r: any) => this.toCsmRecord(r));
    }

    async updateCsm(name: string, updates: Partial<CsmRecord>): Promise<CsmRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.definition) data.definition = updates.definition as any;
            if (updates.serviceType) data.serviceType = updates.serviceType;
            if (updates.semantic !== undefined) data.semantic = updates.semantic as any;
            if (updates.federate !== undefined) data.federate = updates.federate;
            const row = await this.prisma.csm.update({ where: { name }, data });
            return this.toCsmRecord(row);
        } catch { return null; }
    }

    async deleteCsm(name: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.csm.delete({ where: { name } }); return true; } catch { return false; }
    }

    private toCsmRecord(row: any): CsmRecord {
        return { name: row.name, definition: row.definition as Record<string, unknown>, jsonSchemaKey: row.jsonSchemaKey, serviceType: row.serviceType, registeredBy: row.registeredBy, registeredAt: row.registeredAt instanceof Date ? row.registeredAt.toISOString() : row.registeredAt, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt, semantic: row.semantic ?? undefined, federate: row.federate ?? undefined };
    }

    // ── MSM — Machine Service Manifest ──

    async createMsm(record: MsmRecord): Promise<MsmRecord> {
        this.ensureReady();
        try {
            await this.prisma.msm.create({
                data: { name: record.name, definition: record.definition as any, category: record.category, authType: record.authType, actionsCount: record.actionsCount, registeredBy: record.registeredBy, registeredAt: new Date(record.registeredAt), federate: record.federate ?? false },
            });
            return record;
        } catch { throw new Error('MSM_NAME_TAKEN'); }
    }

    async getMsm(name: string): Promise<MsmRecord | null> {
        this.ensureReady();
        const row = await this.prisma.msm.findUnique({ where: { name } });
        return row ? this.toMsmRecord(row) : null;
    }

    async listMsms(opts?: { category?: string }): Promise<MsmRecord[]> {
        this.ensureReady();
        const where: any = {};
        if (opts?.category) where.category = opts.category;
        const rows = await this.prisma.msm.findMany({ where });
        return rows.map((r: any) => this.toMsmRecord(r));
    }

    async updateMsm(name: string, updates: Partial<MsmRecord>): Promise<MsmRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.definition) data.definition = updates.definition as any;
            if (updates.category) data.category = updates.category;
            if (updates.authType) data.authType = updates.authType;
            if (updates.actionsCount !== undefined) data.actionsCount = updates.actionsCount;
            if (updates.federate !== undefined) data.federate = updates.federate;
            const row = await this.prisma.msm.update({ where: { name }, data });
            return this.toMsmRecord(row);
        } catch { return null; }
    }

    async deleteMsm(name: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.msm.delete({ where: { name } }); return true; } catch { return false; }
    }

    private toMsmRecord(row: any): MsmRecord {
        return { name: row.name, definition: row.definition as Record<string, unknown>, category: row.category, authType: row.authType, actionsCount: row.actionsCount, registeredBy: row.registeredBy, registeredAt: row.registeredAt instanceof Date ? row.registeredAt.toISOString() : row.registeredAt, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt, federate: row.federate ?? undefined };
    }

    // ── Email Verification ──

    async createEmailVerification(record: EmailVerificationRecord): Promise<EmailVerificationRecord> {
        this.ensureReady();
        await this.prisma.emailVerification.create({
            data: { id: record.id, ownerName: record.ownerName, emailHash: record.emailHash, code: record.code, purpose: record.purpose, status: record.status, attempts: record.attempts, expiresAt: new Date(record.expiresAt), createdAt: new Date(record.createdAt), verifiedAt: record.verifiedAt ? new Date(record.verifiedAt) : null },
        });
        return record;
    }

    async getEmailVerification(id: string): Promise<EmailVerificationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.emailVerification.findUnique({ where: { id } });
        return row ? this.toEmailVerificationRecord(row) : null;
    }

    async getActiveEmailVerification(ownerName: string, purpose: string): Promise<EmailVerificationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.emailVerification.findFirst({ where: { ownerName, purpose, status: 'pending', expiresAt: { gt: new Date() } } });
        return row ? this.toEmailVerificationRecord(row) : null;
    }

    async updateEmailVerification(id: string, updates: Partial<EmailVerificationRecord>): Promise<EmailVerificationRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.status) data.status = updates.status;
            if (updates.attempts !== undefined) data.attempts = updates.attempts;
            if (updates.verifiedAt) data.verifiedAt = new Date(updates.verifiedAt);
            const row = await this.prisma.emailVerification.update({ where: { id }, data });
            return this.toEmailVerificationRecord(row);
        } catch { return null; }
    }

    async deleteExpiredEmailVerifications(): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.emailVerification.deleteMany({ where: { status: 'pending', expiresAt: { lt: new Date() } } });
        return result.count;
    }

    private toEmailVerificationRecord(row: any): EmailVerificationRecord {
        return { id: row.id, ownerName: row.ownerName, emailHash: row.emailHash, code: row.code, purpose: row.purpose, status: row.status, attempts: row.attempts, expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, verifiedAt: row.verifiedAt ? (row.verifiedAt instanceof Date ? row.verifiedAt.toISOString() : row.verifiedAt) : null };
    }

    // ── Flags (Phase 1.5) ──────────────────────────────────

    async createFlag(record: import('../../interface.js').FlagRecord): Promise<import('../../interface.js').FlagRecord> {
        this.ensureReady();
        await this.prisma.flag.create({ data: { id: record.id, targetType: record.targetType, targetId: record.targetId, flaggedBy: record.flaggedBy, reason: record.reason, description: record.description, status: record.status, createdAt: new Date(record.createdAt) } });
        return record;
    }

    async getFlag(id: string): Promise<import('../../interface.js').FlagRecord | null> {
        this.ensureReady();
        const row = await this.prisma.flag.findUnique({ where: { id } });
        return row ? this.toFlagRecord(row) : null;
    }

    async getFlagsByTarget(targetType: string, targetId: string): Promise<import('../../interface.js').FlagRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.flag.findMany({ where: { targetType, targetId } });
        return rows.map((r: any) => this.toFlagRecord(r));
    }

    async getFlagByUser(targetType: string, targetId: string, flaggedBy: string): Promise<import('../../interface.js').FlagRecord | null> {
        this.ensureReady();
        const row = await this.prisma.flag.findFirst({ where: { targetType, targetId, flaggedBy } });
        return row ? this.toFlagRecord(row) : null;
    }

    async getFlagSummary(targetType: string, targetId: string): Promise<import('../../interface.js').FlagSummary | null> {
        this.ensureReady();
        const matching = await this.prisma.flag.findMany({ where: { targetType, targetId } });
        if (matching.length === 0) return null;
        const byReason: Record<string, number> = {};
        let latestFlag = '';
        for (const f of matching) {
            byReason[f.reason] = (byReason[f.reason] ?? 0) + 1;
            const ts = f.createdAt instanceof Date ? f.createdAt.toISOString() : f.createdAt;
            if (ts > latestFlag) latestFlag = ts;
        }
        return { targetType, targetId, totalFlags: matching.length, byReason, latestFlag };
    }

    async updateFlag(id: string, updates: Partial<import('../../interface.js').FlagRecord>): Promise<import('../../interface.js').FlagRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.status) data.status = updates.status;
            if (updates.reviewedBy) data.reviewedBy = updates.reviewedBy;
            if (updates.reviewedAt) data.reviewedAt = new Date(updates.reviewedAt);
            const row = await this.prisma.flag.update({ where: { id }, data });
            return this.toFlagRecord(row);
        } catch { return null; }
    }

    async listFlags(opts?: { status?: string; targetType?: string; page?: number; perPage?: number }): Promise<import('../../interface.js').FlagRecord[]> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where: any = {};
        if (opts?.status) where.status = opts.status;
        if (opts?.targetType) where.targetType = opts.targetType;
        const rows = await this.prisma.flag.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage });
        return rows.map((r: any) => this.toFlagRecord(r));
    }

    private toFlagRecord(row: any): import('../../interface.js').FlagRecord {
        return { id: row.id, targetType: row.targetType, targetId: row.targetId, flaggedBy: row.flaggedBy, reason: row.reason, description: row.description ?? undefined, status: row.status, reviewedBy: row.reviewedBy ?? undefined, reviewedAt: row.reviewedAt ? (row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : row.reviewedAt) : undefined, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt };
    }

    // ── Matches (Phase 2.1) ──

    async createMatch(record: import('../../interface.js').MatchRecord): Promise<import('../../interface.js').MatchRecord> {
        this.ensureReady();
        await this.prisma.match.create({ data: { id: record.id, profileA: record.profileA, profileB: record.profileB, score: record.score, breakdown: record.breakdown as any, status: record.status, notifiedAt: record.notifiedAt ? new Date(record.notifiedAt) : null, respondedAt: record.respondedAt ? new Date(record.respondedAt) : null, expiresAt: new Date(record.expiresAt), createdAt: new Date(record.createdAt) } });
        return record;
    }

    async getMatch(id: string): Promise<import('../../interface.js').MatchRecord | null> {
        this.ensureReady();
        const row = await this.prisma.match.findUnique({ where: { id } });
        return row ? this.toMatchRecord(row) : null;
    }

    async getMatchByPair(profileA: string, profileB: string): Promise<import('../../interface.js').MatchRecord | null> {
        this.ensureReady();
        const row = await this.prisma.match.findFirst({ where: { OR: [{ profileA, profileB }, { profileA: profileB, profileB: profileA }] } });
        return row ? this.toMatchRecord(row) : null;
    }

    async listMatchesByProfile(profile: string, opts?: { status?: string; page?: number; perPage?: number }): Promise<import('../../interface.js').MatchRecord[]> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 10;
        const where: any = { OR: [{ profileA: profile }, { profileB: profile }] };
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.match.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage });
        return rows.map((r: any) => this.toMatchRecord(r));
    }

    async updateMatch(id: string, updates: Partial<import('../../interface.js').MatchRecord>): Promise<import('../../interface.js').MatchRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.status) data.status = updates.status;
            if (updates.notifiedAt) data.notifiedAt = new Date(updates.notifiedAt);
            if (updates.respondedAt) data.respondedAt = new Date(updates.respondedAt);
            const row = await this.prisma.match.update({ where: { id }, data });
            return this.toMatchRecord(row);
        } catch { return null; }
    }

    async deleteExpiredMatches(): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.match.deleteMany({ where: { expiresAt: { lt: new Date() }, status: { not: 'accepted' } } });
        return result.count;
    }

    async deleteMatchesByProfile(profile: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.match.deleteMany({ where: { OR: [{ profileA: profile }, { profileB: profile }] } });
        return result.count;
    }

    async listAllMatches(limit = 10000): Promise<import('../../interface.js').MatchRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.match.findMany({ take: Math.min(limit, 10000) });
        return rows.map((r: any) => this.toMatchRecord(r));
    }

    private toMatchRecord(row: any): import('../../interface.js').MatchRecord {
        return { id: row.id, profileA: row.profileA, profileB: row.profileB, score: row.score, breakdown: row.breakdown as any, status: row.status, notifiedAt: row.notifiedAt ? (row.notifiedAt instanceof Date ? row.notifiedAt.toISOString() : row.notifiedAt) : null, respondedAt: row.respondedAt ? (row.respondedAt instanceof Date ? row.respondedAt.toISOString() : row.respondedAt) : null, expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt };
    }

    // ── Organisms (Phase 2.2) ──

    async createOrganism(record: import('../../interface.js').OrganismRecord): Promise<import('../../interface.js').OrganismRecord> {
        this.ensureReady();
        await this.prisma.organism.create({ data: { id: record.id, name: record.name, description: record.description, type: record.type, location: record.location as any ?? null, interests: record.interests, creatorGhii: record.creatorGhii, admins: record.admins, members: record.members, agentGaiis: record.agentGaiis, boardId: record.boardId, joinPolicy: record.joinPolicy, maxMembers: record.maxMembers, visibility: record.visibility, moderationConfig: record.moderationConfig as any, memoryNamespace: record.memoryNamespace, semantic: record.semantic as any ?? null, createdAt: new Date(record.createdAt) } });
        return record;
    }

    async getOrganism(id: string): Promise<import('../../interface.js').OrganismRecord | null> {
        this.ensureReady();
        const row = await this.prisma.organism.findUnique({ where: { id } });
        return row ? this.toOrganismRecord(row) : null;
    }

    async listOrganisms(opts?: { type?: string; city?: string; interest?: string; visibility?: string; member?: string; page?: number; perPage?: number }): Promise<import('../../interface.js').OrganismRecord[]> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where: any = {};
        if (opts?.type) where.type = opts.type;
        if (opts?.visibility) where.visibility = opts.visibility;
        // city and interest filtering done post-query (JSON field)
        const rows = await this.prisma.organism.findMany({ where, orderBy: { createdAt: 'desc' } });
        let results = rows.map((r: any) => this.toOrganismRecord(r));
        if (opts?.city) results = results.filter((o: any) => o.location?.city?.toLowerCase() === opts.city!.toLowerCase());
        if (opts?.interest) results = results.filter((o: any) => o.interests.some((i: string) => i.toLowerCase() === opts.interest!.toLowerCase()));
        if (opts?.member) results = results.filter((o: any) => o.members.includes(opts.member!));
        const start = (page - 1) * perPage;
        return results.slice(start, start + perPage);
    }

    async updateOrganism(id: string, updates: Partial<import('../../interface.js').OrganismRecord>): Promise<import('../../interface.js').OrganismRecord | null> {
        this.ensureReady();
        try {
            const data: any = { ...updates };
            delete data.id;
            if (data.location) data.location = data.location as any;
            if (data.moderationConfig) data.moderationConfig = data.moderationConfig as any;
            if (data.semantic) data.semantic = data.semantic as any;
            if (data.createdAt && typeof data.createdAt === 'string') data.createdAt = new Date(data.createdAt);
            const row = await this.prisma.organism.update({ where: { id }, data });
            return this.toOrganismRecord(row);
        } catch { return null; }
    }

    async deleteOrganism(id: string): Promise<boolean> {
        this.ensureReady();
        const org = await this.prisma.organism.findUnique({ where: { id } });
        // Cascade: delete memberships and join requests
        await this.prisma.organismMembership.deleteMany({ where: { organismId: id } });
        await this.prisma.joinRequest.deleteMany({ where: { organismId: id } });
        // Cascade: delete organism reputation
        try { await this.prisma.organismReputation.delete({ where: { organismId: id } }); } catch { /* best-effort */ }

        if (org) {
            try {
                await this.prisma.boardPost.deleteMany({ where: { boardId: org.boardId } });
                await this.prisma.boardSubscription.deleteMany({ where: { boardId: org.boardId } });
                await this.prisma.board.delete({ where: { boardId: org.boardId } });
            } catch { /* best-effort */ }
            await this.prisma.memory.deleteMany({ where: { ownerGaii: org.memoryNamespace } });
        }
        try { await this.prisma.organism.delete({ where: { id } }); return true; } catch { return false; }
    }

    private toOrganismRecord(row: any): import('../../interface.js').OrganismRecord {
        return { id: row.id, name: row.name, description: row.description, type: row.type, location: row.location ?? undefined, interests: row.interests, creatorGhii: row.creatorGhii, admins: row.admins, members: row.members, agentGaiis: row.agentGaiis, boardId: row.boardId, joinPolicy: row.joinPolicy, maxMembers: row.maxMembers, visibility: row.visibility, moderationConfig: row.moderationConfig as any, memoryNamespace: row.memoryNamespace, semantic: row.semantic ?? undefined, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt };
    }

    async createMembership(record: import('../../interface.js').OrganismMembershipRecord): Promise<import('../../interface.js').OrganismMembershipRecord> {
        this.ensureReady();
        await this.prisma.organismMembership.create({ data: { id: record.id, organismId: record.organismId, ghii: record.ghii, role: record.role, status: record.status, joinedAt: new Date(record.joinedAt), invitedBy: record.invitedBy } });
        return record;
    }

    async getMembership(organismId: string, ghii: string): Promise<import('../../interface.js').OrganismMembershipRecord | null> {
        this.ensureReady();
        const row = await this.prisma.organismMembership.findUnique({ where: { organismId_ghii: { organismId, ghii } } });
        return row ? this.toMembershipRecord(row) : null;
    }

    async listMembers(organismId: string, opts?: { role?: string; status?: string }): Promise<import('../../interface.js').OrganismMembershipRecord[]> {
        this.ensureReady();
        const where: any = { organismId };
        if (opts?.role) where.role = opts.role;
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.organismMembership.findMany({ where });
        return rows.map((r: any) => this.toMembershipRecord(r));
    }

    async listMembershipsByGhii(ghii: string): Promise<import('../../interface.js').OrganismMembershipRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.organismMembership.findMany({ where: { ghii } });
        return rows.map((r: any) => this.toMembershipRecord(r));
    }

    async updateMembership(id: string, updates: Partial<import('../../interface.js').OrganismMembershipRecord>): Promise<import('../../interface.js').OrganismMembershipRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.role) data.role = updates.role;
            if (updates.status) data.status = updates.status;
            const row = await this.prisma.organismMembership.update({ where: { id }, data });
            return this.toMembershipRecord(row);
        } catch { return null; }
    }

    async deleteMembership(id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.organismMembership.delete({ where: { id } }); return true; } catch { return false; }
    }

    private toMembershipRecord(row: any): import('../../interface.js').OrganismMembershipRecord {
        return { id: row.id, organismId: row.organismId, ghii: row.ghii, role: row.role, status: row.status, joinedAt: row.joinedAt instanceof Date ? row.joinedAt.toISOString() : row.joinedAt, invitedBy: row.invitedBy ?? undefined };
    }

    async createJoinRequest(record: import('../../interface.js').JoinRequestRecord): Promise<import('../../interface.js').JoinRequestRecord> {
        this.ensureReady();
        await this.prisma.joinRequest.create({ data: { id: record.id, organismId: record.organismId, ghii: record.ghii, message: record.message, status: record.status, reviewedBy: record.reviewedBy, createdAt: new Date(record.createdAt), reviewedAt: record.reviewedAt ? new Date(record.reviewedAt) : null } });
        return record;
    }

    async getJoinRequest(id: string): Promise<import('../../interface.js').JoinRequestRecord | null> {
        this.ensureReady();
        const row = await this.prisma.joinRequest.findUnique({ where: { id } });
        return row ? this.toJoinRequestRecord(row) : null;
    }

    async listJoinRequests(organismId: string, opts?: { status?: string }): Promise<import('../../interface.js').JoinRequestRecord[]> {
        this.ensureReady();
        const where: any = { organismId };
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.joinRequest.findMany({ where });
        return rows.map((r: any) => this.toJoinRequestRecord(r));
    }

    async updateJoinRequest(id: string, updates: Partial<import('../../interface.js').JoinRequestRecord>): Promise<import('../../interface.js').JoinRequestRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.status) data.status = updates.status;
            if (updates.reviewedBy) data.reviewedBy = updates.reviewedBy;
            if (updates.reviewedAt) data.reviewedAt = new Date(updates.reviewedAt);
            const row = await this.prisma.joinRequest.update({ where: { id }, data });
            return this.toJoinRequestRecord(row);
        } catch { return null; }
    }

    private toJoinRequestRecord(row: any): import('../../interface.js').JoinRequestRecord {
        return { id: row.id, organismId: row.organismId, ghii: row.ghii, message: row.message ?? undefined, status: row.status, reviewedBy: row.reviewedBy ?? undefined, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, reviewedAt: row.reviewedAt ? (row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : row.reviewedAt) : undefined };
    }

    // ── Pending Approvals (Phase 4 — Gate primitive) ──

    async createPendingApproval(record: import('../../interface.js').PendingApprovalRecord): Promise<import('../../interface.js').PendingApprovalRecord> {
        this.ensureReady();
        await this.prisma.pendingApproval.create({ data: {
            id: record.id, organismId: record.organismId, flowGateId: record.flowGateId ?? null, stageId: record.stageId ?? null,
            actor: record.actor, action: record.action, arguments: (record.arguments ?? undefined) as any, risk: record.risk,
            approverRole: record.approverRole, prompt: record.prompt ?? null, status: record.status,
            decidedBy: record.decidedBy ?? null, decidedAt: record.decidedAt ? new Date(record.decidedAt) : null,
            resolutionNote: record.resolutionNote ?? null, deadline: record.deadline ? new Date(record.deadline) : null,
            createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt),
        } });
        return record;
    }

    async getPendingApproval(id: string): Promise<import('../../interface.js').PendingApprovalRecord | null> {
        this.ensureReady();
        const row = await this.prisma.pendingApproval.findUnique({ where: { id } });
        return row ? this.toPendingApprovalRecord(row) : null;
    }

    async listPendingApprovals(organismId: string, opts?: { status?: string }): Promise<import('../../interface.js').PendingApprovalRecord[]> {
        this.ensureReady();
        const where: any = { organismId };
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.pendingApproval.findMany({ where, orderBy: { createdAt: 'desc' } });
        return rows.map((r: any) => this.toPendingApprovalRecord(r));
    }

    async updatePendingApproval(id: string, updates: Partial<import('../../interface.js').PendingApprovalRecord>): Promise<import('../../interface.js').PendingApprovalRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.status !== undefined) data.status = updates.status;
            if (updates.decidedBy !== undefined) data.decidedBy = updates.decidedBy;
            if (updates.decidedAt !== undefined) data.decidedAt = updates.decidedAt ? new Date(updates.decidedAt) : null;
            if (updates.resolutionNote !== undefined) data.resolutionNote = updates.resolutionNote;
            if (updates.arguments !== undefined) data.arguments = updates.arguments as any;
            if (updates.deadline !== undefined) data.deadline = updates.deadline ? new Date(updates.deadline) : null;
            data.updatedAt = updates.updatedAt ? new Date(updates.updatedAt) : new Date();
            const row = await this.prisma.pendingApproval.update({ where: { id }, data });
            return this.toPendingApprovalRecord(row);
        } catch { return null; }
    }

    async listOverduePendingApprovals(nowIso: string): Promise<import('../../interface.js').PendingApprovalRecord[]> {
        this.ensureReady();
        // Mirror SQLite: only approvals WITH a deadline that has passed. `not: null` is required —
        // in MongoDB a bare `{ lt: date }` also matches null deadlines, which would wrongly expire
        // gates that have no deadline (e.g. publish gates).
        const rows = await this.prisma.pendingApproval.findMany({ where: { status: 'pending', deadline: { not: null, lt: new Date(nowIso) } } });
        return rows.map((r: any) => this.toPendingApprovalRecord(r));
    }

    private toPendingApprovalRecord(row: any): import('../../interface.js').PendingApprovalRecord {
        return {
            id: row.id, organismId: row.organismId, flowGateId: row.flowGateId ?? undefined, stageId: row.stageId ?? undefined,
            actor: row.actor, action: row.action, arguments: row.arguments ?? undefined, risk: row.risk,
            approverRole: row.approverRole, prompt: row.prompt ?? undefined, status: row.status,
            decidedBy: row.decidedBy ?? undefined,
            decidedAt: row.decidedAt ? (row.decidedAt instanceof Date ? row.decidedAt.toISOString() : row.decidedAt) : undefined,
            resolutionNote: row.resolutionNote ?? undefined,
            deadline: row.deadline ? (row.deadline instanceof Date ? row.deadline.toISOString() : row.deadline) : undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
    }

    // ── Appeals (Phase 2.4) ──

    async createAppeal(record: import('../../interface.js').AppealRecord): Promise<import('../../interface.js').AppealRecord> {
        this.ensureReady();
        await this.prisma.appeal.create({ data: { id: record.id, flagId: record.flagId, appealedBy: record.appealedBy, reason: record.reason, status: record.status, createdAt: new Date(record.createdAt) } });
        return record;
    }

    async getAppeal(id: string): Promise<import('../../interface.js').AppealRecord | null> {
        this.ensureReady();
        const row = await this.prisma.appeal.findUnique({ where: { id } });
        return row ? this.toAppealRecord(row) : null;
    }

    async getAppealByFlagId(flagId: string): Promise<import('../../interface.js').AppealRecord | null> {
        this.ensureReady();
        const row = await this.prisma.appeal.findFirst({ where: { flagId } });
        return row ? this.toAppealRecord(row) : null;
    }

    async listAppeals(opts?: { status?: string; page?: number; perPage?: number }): Promise<import('../../interface.js').AppealRecord[]> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where: any = {};
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.appeal.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage });
        return rows.map((r: any) => this.toAppealRecord(r));
    }

    async updateAppeal(id: string, updates: Partial<import('../../interface.js').AppealRecord>): Promise<import('../../interface.js').AppealRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.status) data.status = updates.status;
            if (updates.reviewedBy) data.reviewedBy = updates.reviewedBy;
            if (updates.reviewNote) data.reviewNote = updates.reviewNote;
            if (updates.reviewedAt) data.reviewedAt = new Date(updates.reviewedAt);
            const row = await this.prisma.appeal.update({ where: { id }, data });
            return this.toAppealRecord(row);
        } catch { return null; }
    }

    private toAppealRecord(row: any): import('../../interface.js').AppealRecord {
        return { id: row.id, flagId: row.flagId, appealedBy: row.appealedBy, reason: row.reason, status: row.status, reviewedBy: row.reviewedBy ?? undefined, reviewNote: row.reviewNote ?? undefined, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, reviewedAt: row.reviewedAt ? (row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : row.reviewedAt) : undefined };
    }

    // ── Marketplace (Phase 2.6) ──

    async createListing(record: import('../../interface.js').ListingRecord): Promise<import('../../interface.js').ListingRecord> {
        this.ensureReady();
        await this.prisma.listing.create({ data: { id: record.id, ownerName: record.ownerName, sellerGhii: record.sellerGhii, title: record.title, description: record.description, category: record.category, priceMorsels: record.priceMorsels, condition: record.condition, availability: record.availability, location: record.location as any ?? null, tags: record.tags ?? [], images: record.images ?? [], status: record.status, memoryKey: record.memoryKey, flagCount: record.flagCount, createdAt: new Date(record.createdAt), semantic: record.semantic as any ?? null } });
        return record;
    }

    async getListing(id: string): Promise<import('../../interface.js').ListingRecord | null> {
        this.ensureReady();
        const row = await this.prisma.listing.findUnique({ where: { id } });
        return row ? this.toListingRecord(row) : null;
    }

    async listListings(opts?: { category?: string; city?: string; minPrice?: number; maxPrice?: number; status?: string; sellerOwner?: string; page?: number; perPage?: number }): Promise<import('../../interface.js').ListingRecord[]> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where: any = {};
        if (opts?.category) where.category = opts.category;
        if (opts?.status) where.status = opts.status;
        if (opts?.sellerOwner) where.ownerName = opts.sellerOwner;
        if (opts?.minPrice !== undefined || opts?.maxPrice !== undefined) {
            where.priceMorsels = {};
            if (opts?.minPrice !== undefined) where.priceMorsels.gte = opts.minPrice;
            if (opts?.maxPrice !== undefined) where.priceMorsels.lte = opts.maxPrice;
        }
        const rows = await this.prisma.listing.findMany({ where, orderBy: { createdAt: 'desc' } });
        let results = rows.map((r: any) => this.toListingRecord(r));
        // city filtering post-query (JSON field)
        if (opts?.city) results = results.filter((l: any) => l.location?.city?.toLowerCase() === opts.city!.toLowerCase());
        const start = (page - 1) * perPage;
        return results.slice(start, start + perPage);
    }

    async updateListing(id: string, updates: Partial<import('../../interface.js').ListingRecord>): Promise<import('../../interface.js').ListingRecord | null> {
        this.ensureReady();
        try {
            const data: any = { ...updates };
            delete data.id;
            if (data.location) data.location = data.location as any;
            if (data.semantic) data.semantic = data.semantic as any;
            if (data.createdAt && typeof data.createdAt === 'string') data.createdAt = new Date(data.createdAt);
            if (data.updatedAt && typeof data.updatedAt === 'string') data.updatedAt = new Date(data.updatedAt);
            const row = await this.prisma.listing.update({ where: { id }, data });
            return this.toListingRecord(row);
        } catch { return null; }
    }

    async deleteListing(id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.listing.delete({ where: { id } }); return true; } catch { return false; }
    }

    private toListingRecord(row: any): import('../../interface.js').ListingRecord {
        return { id: row.id, ownerName: row.ownerName, sellerGhii: row.sellerGhii, title: row.title, description: row.description, category: row.category, priceMorsels: row.priceMorsels, condition: row.condition ?? undefined, availability: row.availability ?? undefined, location: row.location ?? undefined, tags: row.tags ?? undefined, images: row.images ?? undefined, status: row.status, memoryKey: row.memoryKey, flagCount: row.flagCount, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt, semantic: row.semantic ?? undefined };
    }

    async createPurchase(record: import('../../interface.js').PurchaseRecord): Promise<import('../../interface.js').PurchaseRecord> {
        this.ensureReady();
        await this.prisma.purchase.create({ data: { id: record.id, listingId: record.listingId, buyerOwner: record.buyerOwner, sellerOwner: record.sellerOwner, priceMorsels: record.priceMorsels, transactionFeeMorsels: record.transactionFeeMorsels, totalCostMorsels: record.totalCostMorsels, status: record.status, ratingScore: record.rating?.score, ratingComment: record.rating?.comment, trackingCode: record.trackingCode, createdAt: new Date(record.createdAt), completedAt: record.completedAt ? new Date(record.completedAt) : null } });
        return record;
    }

    async getPurchase(id: string): Promise<import('../../interface.js').PurchaseRecord | null> {
        this.ensureReady();
        const row = await this.prisma.purchase.findUnique({ where: { id } });
        return row ? this.toPurchaseRecord(row) : null;
    }

    async listPurchasesByBuyer(buyerOwner: string): Promise<import('../../interface.js').PurchaseRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.purchase.findMany({ where: { buyerOwner }, orderBy: { createdAt: 'desc' } });
        return rows.map((r: any) => this.toPurchaseRecord(r));
    }

    async listPurchasesBySeller(sellerOwner: string): Promise<import('../../interface.js').PurchaseRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.purchase.findMany({ where: { sellerOwner }, orderBy: { createdAt: 'desc' } });
        return rows.map((r: any) => this.toPurchaseRecord(r));
    }

    async updatePurchase(id: string, updates: Partial<import('../../interface.js').PurchaseRecord>): Promise<import('../../interface.js').PurchaseRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.status) data.status = updates.status;
            if (updates.rating) { data.ratingScore = updates.rating.score; data.ratingComment = updates.rating.comment; }
            if (updates.completedAt) data.completedAt = new Date(updates.completedAt);
            const row = await this.prisma.purchase.update({ where: { id }, data });
            return this.toPurchaseRecord(row);
        } catch { return null; }
    }

    private toPurchaseRecord(row: any): import('../../interface.js').PurchaseRecord {
        return { id: row.id, listingId: row.listingId, buyerOwner: row.buyerOwner, sellerOwner: row.sellerOwner, priceMorsels: row.priceMorsels, transactionFeeMorsels: row.transactionFeeMorsels, totalCostMorsels: row.totalCostMorsels, status: row.status, rating: row.ratingScore != null ? { score: row.ratingScore, comment: row.ratingComment ?? undefined } : undefined, trackingCode: row.trackingCode, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, completedAt: row.completedAt ? (row.completedAt instanceof Date ? row.completedAt.toISOString() : row.completedAt) : undefined };
    }

    // ── Push Subscriptions (Phase 3.1) ──

    async createPushSubscription(record: PushSubscriptionRecord): Promise<PushSubscriptionRecord> {
        await this.prisma.pushSubscription.upsert({
            where: { ownerName: record.ownerName },
            update: {
                endpoint: record.endpoint,
                keys: record.keys as object,
                lastUsedAt: new Date(record.lastUsedAt),
            },
            create: {
                id: record.ownerName,
                ownerName: record.ownerName,
                endpoint: record.endpoint,
                keys: record.keys as object,
                createdAt: new Date(record.createdAt),
                lastUsedAt: new Date(record.lastUsedAt),
            },
        });
        return record;
    }
    async getPushSubscription(ownerName: string): Promise<PushSubscriptionRecord | null> {
        const row = await this.prisma.pushSubscription.findUnique({ where: { ownerName } });
        if (!row) return null;
        const keys = row.keys as { p256dh: string; auth: string };
        return {
            ownerName: row.ownerName,
            endpoint: row.endpoint,
            keys,
            createdAt: row.createdAt.toISOString(),
            lastUsedAt: row.lastUsedAt.toISOString(),
        };
    }
    async deletePushSubscription(ownerName: string): Promise<boolean> {
        try {
            await this.prisma.pushSubscription.delete({ where: { ownerName } });
            return true;
        } catch { return false; }
    }
    async listPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
        const rows = await this.prisma.pushSubscription.findMany();
        return rows.map((row: { ownerName: string; endpoint: string; keys: unknown; createdAt: Date; lastUsedAt: Date }) => {
            const keys = row.keys as { p256dh: string; auth: string };
            return {
                ownerName: row.ownerName,
                endpoint: row.endpoint,
                keys,
                createdAt: row.createdAt.toISOString(),
                lastUsedAt: row.lastUsedAt.toISOString(),
            };
        });
    }

    // ── Trusted Issuers (Phase 3.3) ──

    async createTrustedIssuer(record: TrustedIssuerRecord): Promise<TrustedIssuerRecord> {
        this.ensureReady();
        await this.prisma.trustedIssuer.create({ data: { id: record.id, name: record.name, url: record.url, publicKey: record.publicKey, type: record.type, trusted: record.trusted, addedBy: record.addedBy, createdAt: new Date(record.createdAt) } });
        return record;
    }
    async getTrustedIssuer(id: string): Promise<TrustedIssuerRecord | null> {
        this.ensureReady();
        const row = await this.prisma.trustedIssuer.findUnique({ where: { id } });
        return row ? this.toTrustedIssuerRecord(row) : null;
    }
    async getTrustedIssuerByUrl(url: string): Promise<TrustedIssuerRecord | null> {
        this.ensureReady();
        const row = await this.prisma.trustedIssuer.findFirst({ where: { url } });
        return row ? this.toTrustedIssuerRecord(row) : null;
    }
    async listTrustedIssuers(opts?: { type?: string }): Promise<TrustedIssuerRecord[]> {
        this.ensureReady();
        const where: any = {};
        if (opts?.type) where.type = opts.type;
        const rows = await this.prisma.trustedIssuer.findMany({ where });
        return rows.map((r: any) => this.toTrustedIssuerRecord(r));
    }
    async deleteTrustedIssuer(id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.trustedIssuer.delete({ where: { id } }); return true; } catch { return false; }
    }
    private toTrustedIssuerRecord(row: any): TrustedIssuerRecord {
        return { id: row.id, name: row.name, url: row.url, publicKey: row.publicKey, type: row.type, trusted: row.trusted, addedBy: row.addedBy, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt };
    }

    // ── Verification Nonces (Phase 3.3) ──

    async createVerificationNonce(record: import('../../interface.js').VerificationNonceRecord): Promise<import('../../interface.js').VerificationNonceRecord> {
        this.ensureReady();
        await this.prisma.verificationNonce.create({
            data: {
                id: record.id,
                owner: record.owner,
                type: record.type,
                state: record.state,
                nonce: record.nonce,
                redirectUri: record.redirectUri ?? '',
                createdAt: new Date(record.createdAt),
                expiresAt: new Date(record.expiresAt),
            },
        });
        return record;
    }

    async getVerificationNonce(state: string): Promise<import('../../interface.js').VerificationNonceRecord | null> {
        this.ensureReady();
        const row = await this.prisma.verificationNonce.findUnique({ where: { state } });
        if (!row) return null;
        return {
            id: row.id,
            owner: row.owner,
            type: row.type as 'eudiw' | 'ftn',
            state: row.state,
            nonce: row.nonce,
            redirectUri: row.redirectUri,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
        };
    }

    async deleteVerificationNonce(state: string): Promise<void> {
        this.ensureReady();
        await this.prisma.verificationNonce.deleteMany({ where: { state } });
    }

    async cleanExpiredNonces(): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.verificationNonce.deleteMany({
            where: { expiresAt: { lt: new Date() } },
        });
        return result.count;
    }

    // ── Genesis Peers (Phase 3.4) ──

    async createGenesisPeer(record: import('../../interface.js').GenesisPeerRecord): Promise<import('../../interface.js').GenesisPeerRecord> {
        this.ensureReady();
        await this.prisma.genesisPeer.create({ data: { id: record.id, genesisNodeId: record.genesisNodeId, genesisUrl: record.genesisUrl, publicKey: record.publicKey, status: record.status, lastSyncAt: new Date(record.lastSyncAt), catalogueHash: record.catalogueHash, createdAt: new Date(record.createdAt) } });
        return record;
    }
    async getGenesisPeer(id: string): Promise<import('../../interface.js').GenesisPeerRecord | null> {
        this.ensureReady();
        const row = await this.prisma.genesisPeer.findUnique({ where: { id } });
        return row ? this.toGenesisPeerRecord(row) : null;
    }
    async getGenesisPeerByNodeId(nodeId: string): Promise<import('../../interface.js').GenesisPeerRecord | null> {
        this.ensureReady();
        const row = await this.prisma.genesisPeer.findFirst({ where: { genesisNodeId: nodeId } });
        return row ? this.toGenesisPeerRecord(row) : null;
    }
    async listGenesisPeers(opts?: { status?: string }): Promise<import('../../interface.js').GenesisPeerRecord[]> {
        this.ensureReady();
        const where: any = {};
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.genesisPeer.findMany({ where });
        return rows.map((r: any) => this.toGenesisPeerRecord(r));
    }
    async updateGenesisPeer(id: string, updates: Partial<import('../../interface.js').GenesisPeerRecord>): Promise<import('../../interface.js').GenesisPeerRecord | null> {
        this.ensureReady();
        try {
            const data: any = { ...updates };
            delete data.id;
            if (data.lastSyncAt && typeof data.lastSyncAt === 'string') data.lastSyncAt = new Date(data.lastSyncAt);
            if (data.createdAt && typeof data.createdAt === 'string') data.createdAt = new Date(data.createdAt);
            const row = await this.prisma.genesisPeer.update({ where: { id }, data });
            return this.toGenesisPeerRecord(row);
        } catch { return null; }
    }
    async deleteGenesisPeer(id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.genesisPeer.delete({ where: { id } }); return true; } catch { return false; }
    }
    private toGenesisPeerRecord(row: any): import('../../interface.js').GenesisPeerRecord {
        return { id: row.id, genesisNodeId: row.genesisNodeId, genesisUrl: row.genesisUrl, publicKey: row.publicKey, status: row.status, lastSyncAt: row.lastSyncAt instanceof Date ? row.lastSyncAt.toISOString() : row.lastSyncAt, catalogueHash: row.catalogueHash, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt };
    }

    // ── Organism Reputation (Phase 3.4) ──

    async setOrganismReputation(record: import('../../interface.js').OrganismReputationRecord): Promise<import('../../interface.js').OrganismReputationRecord> {
        this.ensureReady();
        await this.prisma.organismReputation.upsert({
            where: { organismId: record.organismId },
            create: { organismId: record.organismId, score: record.score, breakdown: record.breakdown as any, calculatedAt: new Date(record.calculatedAt) },
            update: { score: record.score, breakdown: record.breakdown as any, calculatedAt: new Date(record.calculatedAt) },
        });
        return record;
    }
    async getOrganismReputation(organismId: string): Promise<import('../../interface.js').OrganismReputationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.organismReputation.findUnique({ where: { organismId } });
        if (!row) return null;
        return { organismId: row.organismId, score: row.score, breakdown: row.breakdown as any, calculatedAt: row.calculatedAt instanceof Date ? row.calculatedAt.toISOString() : row.calculatedAt };
    }

    // ── Realtime rooms (MongoDB-backed via Prisma) ──

    async createRealtimeRoom(record: import('../../interface.js').RealtimeRoomRecord): Promise<import('../../interface.js').RealtimeRoomRecord> {
        this.ensureReady();
        const row = await this.prisma.realtimeRoom.create({
            data: {
                id: record.id,
                appType: record.appType,
                name: record.name,
                createdBy: record.createdBy,
                maxPeers: record.maxPeers,
                isPublic: record.isPublic,
                tags: record.tags,
                peerCount: record.peerCount,
                createdAt: new Date(record.createdAt),
                lastActivityAt: new Date(record.lastActivityAt),
            },
        });
        return {
            id: row.id,
            appType: row.appType,
            name: row.name,
            createdBy: row.createdBy,
            maxPeers: row.maxPeers,
            isPublic: row.isPublic,
            tags: row.tags,
            peerCount: row.peerCount,
            createdAt: row.createdAt.toISOString(),
            lastActivityAt: row.lastActivityAt.toISOString(),
        };
    }
    async getRealtimeRoom(id: string): Promise<import('../../interface.js').RealtimeRoomRecord | null> {
        this.ensureReady();
        const row = await this.prisma.realtimeRoom.findUnique({ where: { id } });
        if (!row) return null;
        return {
            id: row.id,
            appType: row.appType,
            name: row.name,
            createdBy: row.createdBy,
            maxPeers: row.maxPeers,
            isPublic: row.isPublic,
            tags: row.tags,
            peerCount: row.peerCount,
            createdAt: row.createdAt.toISOString(),
            lastActivityAt: row.lastActivityAt.toISOString(),
        };
    }
    async listRealtimeRooms(filter?: { appType?: string; isPublic?: boolean }): Promise<import('../../interface.js').RealtimeRoomRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (filter?.appType) where.appType = filter.appType;
        if (filter?.isPublic !== undefined) where.isPublic = filter.isPublic;
        const rows = await this.prisma.realtimeRoom.findMany({ where });
        return rows.map((row: any) => ({
            id: row.id,
            appType: row.appType,
            name: row.name,
            createdBy: row.createdBy,
            maxPeers: row.maxPeers,
            isPublic: row.isPublic,
            tags: row.tags,
            peerCount: row.peerCount,
            createdAt: row.createdAt.toISOString(),
            lastActivityAt: row.lastActivityAt.toISOString(),
        }));
    }
    async updateRealtimeRoom(id: string, updates: Partial<import('../../interface.js').RealtimeRoomRecord>): Promise<import('../../interface.js').RealtimeRoomRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.peerCount !== undefined) data.peerCount = updates.peerCount;
            if (updates.lastActivityAt !== undefined) data.lastActivityAt = new Date(updates.lastActivityAt);
            if (updates.name !== undefined) data.name = updates.name;
            if (updates.isPublic !== undefined) data.isPublic = updates.isPublic;
            if (updates.tags !== undefined) data.tags = updates.tags;
            const row = await this.prisma.realtimeRoom.update({ where: { id }, data });
            return {
                id: row.id,
                appType: row.appType,
                name: row.name,
                createdBy: row.createdBy,
                maxPeers: row.maxPeers,
                isPublic: row.isPublic,
                tags: row.tags,
                peerCount: row.peerCount,
                createdAt: row.createdAt.toISOString(),
                lastActivityAt: row.lastActivityAt.toISOString(),
            };
        } catch {
            return null;
        }
    }
    async deleteRealtimeRoom(id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.realtimeRoom.delete({ where: { id } });
            return true;
        } catch {
            return false;
        }
    }

    // ── Node Portal (Site) ──

    async addSiteChangeLog(entry: SiteChangeLogEntry): Promise<SiteChangeLogEntry> {
        this.ensureReady();
        await this.prisma.siteChangeLog.create({
            data: {
                id: entry.id,
                action: entry.action,
                summary: entry.summary,
                changedBy: entry.changedBy,
                changedAt: new Date(entry.changedAt),
            },
        });
        return entry;
    }

    async listSiteChangeLog(limit: number, cursor?: string): Promise<SiteChangeLogEntry[]> {
        this.ensureReady();
        const rows = await this.prisma.siteChangeLog.findMany({
            orderBy: { changedAt: 'desc' },
            take: limit,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        return rows.map((r: any) => ({
            id: r.id,
            action: r.action,
            summary: r.summary,
            changedBy: r.changedBy,
            changedAt: r.changedAt instanceof Date ? r.changedAt.toISOString() : r.changedAt,
        }));
    }

    // ── Node Extensions ──────────────────────────────────────────

    private toExtensionRecord(row: any): ExtensionRecord {
        return {
            name: row.name,
            version: row.version,
            description: row.description,
            author: row.author,
            status: row.status,
            requiredApis: row.requiredApis,
            actions: row.actions as ExtensionRecord['actions'],
            config: row.config as Record<string, unknown>,
            limits: row.limits as ExtensionRecord['limits'],
            federation: row.federation as ExtensionRecord['federation'],
            installedBy: row.installedBy,
            installedAt: row.installedAt instanceof Date ? row.installedAt.toISOString() : row.installedAt,
            activatedAt: row.activatedAt instanceof Date ? row.activatedAt.toISOString() : row.activatedAt ?? undefined,
            ...(row.instances ? { instances: row.instances as ExtensionRecord['instances'] } : {}),
        };
    }

    async createExtension(record: ExtensionRecord): Promise<ExtensionRecord> {
        this.ensureReady();
        const row = await this.prisma.extension.create({
            data: {
                name: record.name,
                version: record.version,
                description: record.description,
                author: record.author,
                status: record.status,
                requiredApis: record.requiredApis,
                actions: record.actions as any,
                config: record.config as any,
                limits: record.limits as any,
                federation: record.federation as any,
                instances: record.instances ? record.instances as any : undefined,
                installedBy: record.installedBy,
                installedAt: new Date(record.installedAt),
                activatedAt: record.activatedAt ? new Date(record.activatedAt) : null,
            },
        });
        return this.toExtensionRecord(row);
    }

    async getExtension(name: string): Promise<ExtensionRecord | null> {
        this.ensureReady();
        const row = await this.prisma.extension.findUnique({ where: { name } });
        return row ? this.toExtensionRecord(row) : null;
    }

    async listExtensions(opts?: { status?: string }): Promise<ExtensionRecord[]> {
        this.ensureReady();
        const where = opts?.status ? { status: opts.status } : {};
        const rows = await this.prisma.extension.findMany({ where });
        return rows.map((r: any) => this.toExtensionRecord(r));
    }

    async updateExtension(name: string, updates: Partial<ExtensionRecord>): Promise<ExtensionRecord | null> {
        this.ensureReady();
        try {
            const data: any = { ...updates };
            if (data.activatedAt && typeof data.activatedAt === 'string') {
                data.activatedAt = new Date(data.activatedAt);
            }
            if (data.actions) data.actions = data.actions as any;
            if (data.config) data.config = data.config as any;
            if (data.limits) data.limits = data.limits as any;
            if (data.federation) data.federation = data.federation as any;
            const row = await this.prisma.extension.update({ where: { name }, data });
            return this.toExtensionRecord(row);
        } catch {
            return null;
        }
    }

    async deleteExtension(name: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.extension.delete({ where: { name } });
            return true;
        } catch {
            return false;
        }
    }

    // ── Generic Escrow ───────────────────────────────────────────

    private toEscrowHoldRecord(row: any): EscrowHoldRecord {
        return {
            holdId: row.holdId,
            fromGaii: row.fromGaii,
            amount: row.amount,
            reason: row.reason,
            status: row.status,
            extensionName: row.extensionName,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            releasedAt: row.releasedAt instanceof Date ? row.releasedAt.toISOString() : row.releasedAt ?? undefined,
            releasedTo: row.releasedTo ?? undefined,
        };
    }

    async createEscrowHold(record: EscrowHoldRecord): Promise<EscrowHoldRecord> {
        this.ensureReady();
        const row = await this.prisma.escrowHold.create({
            data: {
                holdId: record.holdId,
                fromGaii: record.fromGaii,
                amount: record.amount,
                reason: record.reason,
                status: record.status,
                extensionName: record.extensionName,
                createdAt: new Date(record.createdAt),
                releasedAt: record.releasedAt ? new Date(record.releasedAt) : null,
                releasedTo: record.releasedTo ?? null,
            },
        });
        return this.toEscrowHoldRecord(row);
    }

    async getEscrowHold(holdId: string): Promise<EscrowHoldRecord | null> {
        this.ensureReady();
        const row = await this.prisma.escrowHold.findUnique({ where: { holdId } });
        return row ? this.toEscrowHoldRecord(row) : null;
    }

    async listEscrowHolds(fromGaii: string, opts?: { status?: string }): Promise<EscrowHoldRecord[]> {
        this.ensureReady();
        const where: any = { fromGaii };
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.escrowHold.findMany({ where });
        return rows.map((r: any) => this.toEscrowHoldRecord(r));
    }

    async releaseEscrowHold(holdId: string, toGaii: string): Promise<EscrowHoldRecord | null> {
        this.ensureReady();
        try {
            const existing = await this.prisma.escrowHold.findUnique({ where: { holdId } });
            if (!existing || existing.status !== 'held') return null;
            const row = await this.prisma.escrowHold.update({
                where: { holdId },
                data: {
                    status: 'released',
                    releasedTo: toGaii,
                    releasedAt: new Date(),
                },
            });
            return this.toEscrowHoldRecord(row);
        } catch {
            return null;
        }
    }

    async refundEscrowHold(holdId: string): Promise<EscrowHoldRecord | null> {
        this.ensureReady();
        try {
            const existing = await this.prisma.escrowHold.findUnique({ where: { holdId } });
            if (!existing || existing.status !== 'held') return null;
            const row = await this.prisma.escrowHold.update({
                where: { holdId },
                data: {
                    status: 'refunded',
                    releasedAt: new Date(),
                },
            });
            return this.toEscrowHoldRecord(row);
        } catch {
            return null;
        }
    }

    // ── Cortex Extensions (Manifest-based) ──

    async createCortexExtension(record: CortexExtensionRecord): Promise<CortexExtensionRecord> {
        this.ensureReady();
        try {
            await this.prisma.cortexExtension.create({ data: { name: record.name, namespace: record.namespace, shortName: record.shortName, apiVersion: record.apiVersion, version: record.version, description: record.description, author: record.author, license: record.license, tags: record.tags, labels: record.labels as any, aimeatCompat: record.aimeatCompat, status: record.status, visibility: record.visibility, installedAt: new Date(record.installedAt), activatedAt: record.activatedAt ? new Date(record.activatedAt) : null, installedBy: record.installedBy, manifest: record.manifest, components: record.components as any, activationArtifacts: record.activationArtifacts as any } });
            return record;
        } catch { throw new Error(`Cortex extension "${record.name}" already exists`); }
    }

    async getCortexExtension(name: string): Promise<CortexExtensionRecord | null> {
        this.ensureReady();
        const row = await this.prisma.cortexExtension.findUnique({ where: { name } });
        return row ? this.toCortexExtensionRecord(row) : null;
    }

    async listCortexExtensions(opts?: { status?: string; namespace?: string; visibility?: string; installedBy?: string }): Promise<CortexExtensionRecord[]> {
        this.ensureReady();
        const where: any = {};
        if (opts?.status) where.status = opts.status;
        if (opts?.namespace) where.namespace = opts.namespace;
        if (opts?.visibility) where.visibility = opts.visibility;
        if (opts?.installedBy) where.installedBy = opts.installedBy;
        const rows = await this.prisma.cortexExtension.findMany({ where });
        return rows.map((r: any) => this.toCortexExtensionRecord(r));
    }

    async updateCortexExtension(name: string, updates: Partial<CortexExtensionRecord>): Promise<CortexExtensionRecord | null> {
        this.ensureReady();
        try {
            const data: any = { ...updates };
            delete data.name;
            if (data.labels) data.labels = data.labels as any;
            if (data.components) data.components = data.components as any;
            if (data.activationArtifacts) data.activationArtifacts = data.activationArtifacts as any;
            if (data.activatedAt && typeof data.activatedAt === 'string') data.activatedAt = new Date(data.activatedAt);
            if (data.installedAt && typeof data.installedAt === 'string') data.installedAt = new Date(data.installedAt);
            const row = await this.prisma.cortexExtension.update({ where: { name }, data });
            return this.toCortexExtensionRecord(row);
        } catch { return null; }
    }

    async deleteCortexExtension(name: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.cortexExtension.delete({ where: { name } }); return true; } catch { return false; }
    }

    private toCortexExtensionRecord(row: any): CortexExtensionRecord {
        return { name: row.name, namespace: row.namespace, shortName: row.shortName, apiVersion: row.apiVersion, version: row.version, description: row.description, author: row.author, license: row.license ?? undefined, tags: row.tags, labels: row.labels as Record<string, string>, aimeatCompat: row.aimeatCompat ?? undefined, status: row.status, visibility: row.visibility, installedAt: row.installedAt instanceof Date ? row.installedAt.toISOString() : row.installedAt, activatedAt: row.activatedAt ? (row.activatedAt instanceof Date ? row.activatedAt.toISOString() : row.activatedAt) : undefined, installedBy: row.installedBy, manifest: row.manifest, components: row.components as any, activationArtifacts: row.activationArtifacts as any };
    }

    async setCortexLibFile(extName: string, libName: string, content: string): Promise<void> {
        this.ensureReady();
        await this.prisma.cortexLibFile.upsert({
            where: { extName_libName: { extName, libName } },
            create: { extName, libName, content },
            update: { content },
        });
    }

    async getCortexLibFile(extName: string, libName: string): Promise<string | null> {
        this.ensureReady();
        const row = await this.prisma.cortexLibFile.findUnique({ where: { extName_libName: { extName, libName } } });
        return row?.content ?? null;
    }

    async deleteCortexLibFile(extName: string, libName: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.cortexLibFile.delete({ where: { extName_libName: { extName, libName } } }); return true; } catch { return false; }
    }

    // ── Personal Push Subscriptions (REQ-007) ──

    async createPersonalPushSubscription(record: PersonalPushSubscriptionRecord): Promise<PersonalPushSubscriptionRecord> {
        this.ensureReady();
        await this.prisma.personalPushSubscription.create({ data: { id: record.id, personalNodeId: record.personalNodeId, ownerName: record.ownerName, endpoint: record.endpoint, keys: record.keys as any, failureCount: record.failureCount, createdAt: new Date(record.createdAt), lastUsedAt: record.lastUsedAt ? new Date(record.lastUsedAt) : null } });
        return record;
    }

    async getPersonalPushSubscription(id: string): Promise<PersonalPushSubscriptionRecord | null> {
        this.ensureReady();
        const row = await this.prisma.personalPushSubscription.findUnique({ where: { id } });
        return row ? this.toPersonalPushSubRecord(row) : null;
    }

    async listPersonalPushSubscriptions(personalNodeId: string): Promise<PersonalPushSubscriptionRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.personalPushSubscription.findMany({ where: { personalNodeId } });
        return rows.map((r: any) => this.toPersonalPushSubRecord(r));
    }

    async updatePersonalPushSubscription(id: string, updates: Partial<PersonalPushSubscriptionRecord>): Promise<boolean> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.failureCount !== undefined) data.failureCount = updates.failureCount;
            if (updates.lastUsedAt) data.lastUsedAt = new Date(updates.lastUsedAt);
            if (updates.endpoint) data.endpoint = updates.endpoint;
            if (updates.keys) data.keys = updates.keys as any;
            await this.prisma.personalPushSubscription.update({ where: { id }, data });
            return true;
        } catch { return false; }
    }

    async deletePersonalPushSubscription(id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.personalPushSubscription.delete({ where: { id } }); return true; } catch { return false; }
    }

    async deletePersonalPushSubscriptionsByNode(personalNodeId: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.personalPushSubscription.deleteMany({ where: { personalNodeId } });
        return result.count;
    }

    async countPersonalPushSubscriptions(personalNodeId: string): Promise<number> {
        this.ensureReady();
        return await this.prisma.personalPushSubscription.count({ where: { personalNodeId } });
    }

    private toPersonalPushSubRecord(row: any): PersonalPushSubscriptionRecord {
        return { id: row.id, personalNodeId: row.personalNodeId, ownerName: row.ownerName, endpoint: row.endpoint, keys: row.keys as any, failureCount: row.failureCount, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, lastUsedAt: row.lastUsedAt ? (row.lastUsedAt instanceof Date ? row.lastUsedAt.toISOString() : row.lastUsedAt) : null };
    }

    async getNotificationPreferences(personalNodeId: string): Promise<NotificationPreferences | null> {
        this.ensureReady();
        const row = await this.prisma.notificationPreference.findUnique({ where: { personalNodeId } });
        if (!row) return null;
        return { personalNodeId: row.personalNodeId, enabled: row.enabled, channels: row.channels as any, notifyTypes: row.notifyTypes, cooldownMinutes: row.cooldownMinutes, quietHoursUtc: row.quietHoursUtc as any ?? null, email: row.email, locale: row.locale ?? undefined };
    }

    async upsertNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences> {
        this.ensureReady();
        await this.prisma.notificationPreference.upsert({
            where: { personalNodeId: prefs.personalNodeId },
            create: { personalNodeId: prefs.personalNodeId, enabled: prefs.enabled, channels: prefs.channels, notifyTypes: prefs.notifyTypes, cooldownMinutes: prefs.cooldownMinutes, quietHoursUtc: prefs.quietHoursUtc as any ?? null, email: prefs.email, locale: prefs.locale },
            update: { enabled: prefs.enabled, channels: prefs.channels, notifyTypes: prefs.notifyTypes, cooldownMinutes: prefs.cooldownMinutes, quietHoursUtc: prefs.quietHoursUtc as any ?? null, email: prefs.email, locale: prefs.locale },
        });
        return prefs;
    }

    async deleteNotificationPreferences(personalNodeId: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.notificationPreference.delete({ where: { personalNodeId } }); return true; } catch { return false; }
    }

    // ── Notification Templates (Phase 3.2) ──────────────────────

    private ntKey(id: string, locale: string): string { return `${id}::${locale}`; }

    async getNotificationTemplate(id: string, locale: string): Promise<NotificationTemplateRecord | null> {
        const row = await this.prisma.notificationTemplate.findUnique({
            where: { templateId_locale: { templateId: id, locale } },
        });
        if (!row) return null;
        return {
            id: row.templateId,
            locale: row.locale,
            fields: row.fields as NotificationTemplateRecord['fields'],
            placeholders: row.placeholders,
            updatedAt: row.updatedAt.toISOString(),
            updatedBy: row.updatedBy,
        };
    }

    async upsertNotificationTemplate(record: NotificationTemplateRecord): Promise<NotificationTemplateRecord> {
        const compositeId = this.ntKey(record.id, record.locale);
        await this.prisma.notificationTemplate.upsert({
            where: { templateId_locale: { templateId: record.id, locale: record.locale } },
            update: {
                fields: record.fields as object,
                placeholders: record.placeholders,
                updatedAt: new Date(record.updatedAt),
                updatedBy: record.updatedBy,
            },
            create: {
                id: compositeId,
                templateId: record.id,
                locale: record.locale,
                fields: record.fields as object,
                placeholders: record.placeholders,
                updatedAt: new Date(record.updatedAt),
                updatedBy: record.updatedBy,
            },
        });
        return record;
    }

    async listNotificationTemplates(): Promise<NotificationTemplateRecord[]> {
        const rows = await this.prisma.notificationTemplate.findMany();
        return rows.map((row: { templateId: string; locale: string; fields: unknown; placeholders: string[]; updatedAt: Date; updatedBy: string }) => ({
            id: row.templateId,
            locale: row.locale,
            fields: row.fields as NotificationTemplateRecord['fields'],
            placeholders: row.placeholders,
            updatedAt: row.updatedAt.toISOString(),
            updatedBy: row.updatedBy,
        }));
    }

    async deleteAllNotificationTemplates(): Promise<void> {
        await this.prisma.notificationTemplate.deleteMany();
    }

    // ── Sessions (P3-7: Server-Side Session Tracking) ──────────

    private mapPrismaSession(s: {
        sessionId: string; gaii: string; owner: string;
        issuedAt: Date | string; expiresAt: Date | string; revoked: boolean;
        refreshTokenHash?: string | null; prevTokenHash?: string | null;
        prevValidUntil?: Date | string | null; lastUsedAt?: Date | string | null;
        idleExpiresAt?: Date | string | null; absoluteExpiresAt?: Date | string | null;
        deviceLabel?: string | null; userAgent?: string | null;
    }): import('../../../storage/repositories/session.repository.js').SessionRecord {
        const iso = (d: Date | string | null | undefined): string | null =>
            d == null ? null : (d instanceof Date ? d.toISOString() : String(d));
        return {
            sessionId: s.sessionId,
            gaii: s.gaii,
            owner: s.owner,
            issuedAt: iso(s.issuedAt) as string,
            expiresAt: iso(s.expiresAt) as string,
            revoked: s.revoked,
            refreshTokenHash: s.refreshTokenHash ?? null,
            prevTokenHash: s.prevTokenHash ?? null,
            prevValidUntil: iso(s.prevValidUntil),
            lastUsedAt: iso(s.lastUsedAt),
            idleExpiresAt: iso(s.idleExpiresAt),
            absoluteExpiresAt: iso(s.absoluteExpiresAt),
            deviceLabel: s.deviceLabel ?? null,
            userAgent: s.userAgent ?? null,
        };
    }

    async createSession(session: { sessionId: string; gaii: string; owner: string; issuedAt: string; expiresAt: string }): Promise<void> {
        this.ensureReady();
        await this.prisma.session.create({
            data: {
                sessionId: session.sessionId,
                gaii: session.gaii,
                owner: session.owner,
                issuedAt: new Date(session.issuedAt),
                expiresAt: new Date(session.expiresAt),
                revoked: false,
            },
        });
    }

    async createOwnerSession(session: {
        sessionId: string; gaii: string; owner: string; issuedAt: string;
        refreshTokenHash: string; idleExpiresAt: string; absoluteExpiresAt: string;
        lastUsedAt: string; deviceLabel?: string | null; userAgent?: string | null;
    }): Promise<void> {
        this.ensureReady();
        await this.prisma.session.create({
            data: {
                sessionId: session.sessionId,
                gaii: session.gaii,
                owner: session.owner,
                issuedAt: new Date(session.issuedAt),
                // expiresAt mirrors the idle window so listActiveSessions reflects refresh-token life.
                expiresAt: new Date(session.idleExpiresAt),
                revoked: false,
                refreshTokenHash: session.refreshTokenHash,
                idleExpiresAt: new Date(session.idleExpiresAt),
                absoluteExpiresAt: new Date(session.absoluteExpiresAt),
                lastUsedAt: new Date(session.lastUsedAt),
                deviceLabel: session.deviceLabel ?? null,
                userAgent: session.userAgent ?? null,
            },
        });
    }

    async listActiveSessions(owner: string): Promise<import('../../../storage/repositories/session.repository.js').SessionRecord[]> {
        this.ensureReady();
        const sessions = await this.prisma.session.findMany({
            where: { owner, revoked: false },
            orderBy: { issuedAt: 'desc' },
        });
        return sessions.map((s: import('@prisma/client').Session) => this.mapPrismaSession(s));
    }

    async getSessionByRefreshHash(tokenHash: string): Promise<import('../../../storage/repositories/session.repository.js').SessionRecord | null> {
        this.ensureReady();
        const s = await this.prisma.session.findFirst({
            where: { OR: [{ refreshTokenHash: tokenHash }, { prevTokenHash: tokenHash }] },
        });
        return s ? this.mapPrismaSession(s) : null;
    }

    async rotateSessionRefresh(sessionId: string, update: {
        refreshTokenHash: string; prevTokenHash: string | null; prevValidUntil: string | null;
        idleExpiresAt: string; expiresAt: string; lastUsedAt: string;
    }): Promise<void> {
        this.ensureReady();
        await this.prisma.session.update({
            where: { sessionId },
            data: {
                refreshTokenHash: update.refreshTokenHash,
                prevTokenHash: update.prevTokenHash,
                prevValidUntil: update.prevValidUntil ? new Date(update.prevValidUntil) : null,
                idleExpiresAt: new Date(update.idleExpiresAt),
                expiresAt: new Date(update.expiresAt),
                lastUsedAt: new Date(update.lastUsedAt),
            },
        });
    }

    async revokeSession(sessionId: string): Promise<boolean> {
        this.ensureReady();
        const session = await this.prisma.session.findUnique({ where: { sessionId } });
        if (!session || session.revoked) return false;
        await this.prisma.session.update({ where: { sessionId }, data: { revoked: true } });
        return true;
    }

    async revokeAllSessions(owner: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.session.updateMany({
            where: { owner, revoked: false },
            data: { revoked: true },
        });
        return result.count;
    }

    async isSessionRevoked(sessionId: string): Promise<boolean> {
        this.ensureReady();
        const session = await this.prisma.session.findUnique({ where: { sessionId } });
        if (!session) return false;
        return session.revoked;
    }

    async pruneExpiredSessions(nowIso: string): Promise<number> {
        this.ensureReady();
        const now = new Date(nowIso);
        // Remove fully-dead rows; keep revoked-but-unexpired rows so isSessionRevoked
        // still rejects their short-lived access tokens.
        const result = await this.prisma.session.deleteMany({
            where: { OR: [{ expiresAt: { lt: now } }, { absoluteExpiresAt: { lt: now } }] },
        });
        return result.count;
    }

    // ── Personal Access Tokens ────────────────────────────────

    private mapPat(p: {
        id: string; tokenHash: string; label: string; owner: string; scopes: string[];
        grantOwner: boolean; grantOperator: boolean; readOwnerData: boolean; gaii: string;
        createdAt: Date | string; expiresAt?: Date | string | null; lastUsedAt?: Date | string | null; revoked: boolean;
    }): import('../../../storage/repositories/pat.repository.js').PatRecord {
        const iso = (d: Date | string | null | undefined): string | null =>
            d == null ? null : (d instanceof Date ? d.toISOString() : String(d));
        return {
            id: p.id,
            tokenHash: p.tokenHash,
            label: p.label,
            owner: p.owner,
            scopes: p.scopes ?? [],
            grantOwner: p.grantOwner,
            grantOperator: p.grantOperator,
            readOwnerData: p.readOwnerData,
            gaii: p.gaii,
            createdAt: iso(p.createdAt) as string,
            expiresAt: iso(p.expiresAt),
            lastUsedAt: iso(p.lastUsedAt),
            revoked: p.revoked,
        };
    }

    async createPat(pat: import('../../../storage/repositories/pat.repository.js').PatRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.personalAccessToken.create({
            data: {
                id: pat.id,
                tokenHash: pat.tokenHash,
                label: pat.label,
                owner: pat.owner,
                scopes: pat.scopes ?? [],
                grantOwner: pat.grantOwner,
                grantOperator: pat.grantOperator,
                readOwnerData: pat.readOwnerData,
                gaii: pat.gaii,
                createdAt: new Date(pat.createdAt),
                expiresAt: pat.expiresAt ? new Date(pat.expiresAt) : null,
                lastUsedAt: pat.lastUsedAt ? new Date(pat.lastUsedAt) : null,
                revoked: false,
            },
        });
    }

    async getPatByHash(tokenHash: string): Promise<import('../../../storage/repositories/pat.repository.js').PatRecord | null> {
        this.ensureReady();
        const p = await this.prisma.personalAccessToken.findFirst({ where: { tokenHash, revoked: false } });
        return p ? this.mapPat(p) : null;
    }

    async listPats(owner: string): Promise<import('../../../storage/repositories/pat.repository.js').PatRecord[]> {
        this.ensureReady();
        const pats = await this.prisma.personalAccessToken.findMany({
            where: { owner, revoked: false },
            orderBy: { createdAt: 'desc' },
        });
        return pats.map((p: import('@prisma/client').PersonalAccessToken) => this.mapPat(p));
    }

    async revokePat(id: string, owner: string): Promise<boolean> {
        this.ensureReady();
        const existing = await this.prisma.personalAccessToken.findFirst({ where: { id, owner, revoked: false } });
        if (!existing) return false;
        await this.prisma.personalAccessToken.update({ where: { id }, data: { revoked: true } });
        return true;
    }

    async touchPat(id: string, usedAtIso: string): Promise<void> {
        this.ensureReady();
        await this.prisma.personalAccessToken.update({ where: { id }, data: { lastUsedAt: new Date(usedAtIso) } });
    }

    // ── Token Revocation ──────────────────────────────────────

    async revokeToken(tokenHash: string, expiresAt: number): Promise<void> {
        this.ensureReady();
        await this.prisma.revokedToken.upsert({
            where: { tokenHash },
            update: { expiresAt },
            create: { tokenHash, expiresAt },
        });
    }

    async isTokenRevoked(tokenHash: string): Promise<boolean> {
        this.ensureReady();
        const row = await this.prisma.revokedToken.findUnique({ where: { tokenHash } });
        return !!row;
    }

    async cleanExpiredRevocations(): Promise<number> {
        this.ensureReady();
        const now = Math.floor(Date.now() / 1000);
        const result = await this.prisma.revokedToken.deleteMany({
            where: { expiresAt: { lt: now } },
        });
        return result.count;
    }

    // ── App Catalog (Prisma-persisted) ──

    private toAppRecord(row: any): AppRecord {
        return {
            ownerGaii: row.ownerGaii,
            ownerName: row.ownerName,
            filename: row.filename,
            versionNumber: row.versionNumber,
            manifest: row.manifest as any,
            mimeType: row.mimeType,
            size: row.size,
            data: row.data,
            accessCode: row.accessCode ?? undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    }

    async createApp(record: AppRecord): Promise<AppRecord> {
        this.ensureReady();
        await this.prisma.app.create({
            data: {
                ownerGaii: record.ownerGaii,
                ownerName: record.ownerName,
                filename: record.filename,
                versionNumber: record.versionNumber,
                manifest: record.manifest as any,
                mimeType: record.mimeType,
                size: record.size,
                data: record.data,
                accessCode: record.accessCode,
                createdAt: new Date(record.createdAt),
            },
        });
        return record;
    }

    async getApp(ownerGaii: string, filename: string, version?: number): Promise<AppRecord | null> {
        this.ensureReady();
        if (version !== undefined) {
            const row = await this.prisma.app.findUnique({
                where: { ownerGaii_filename_versionNumber: { ownerGaii, filename, versionNumber: version } },
            });
            return row ? this.toAppRecord(row) : null;
        }
        const rows = await this.prisma.app.findMany({
            where: { ownerGaii, filename },
            orderBy: { versionNumber: 'desc' },
            take: 1,
        });
        return rows.length > 0 ? this.toAppRecord(rows[0]) : null;
    }

    async getAppByOwnerName(ownerName: string, filename: string, version?: number): Promise<AppRecord | null> {
        this.ensureReady();
        if (version !== undefined) {
            const row = await this.prisma.app.findFirst({
                where: { ownerName, filename, versionNumber: version },
            });
            return row ? this.toAppRecord(row) : null;
        }
        const rows = await this.prisma.app.findMany({
            where: { ownerName, filename },
            orderBy: { versionNumber: 'desc' },
            take: 1,
        });
        return rows.length > 0 ? this.toAppRecord(rows[0]) : null;
    }

    async listApps(opts?: AppListOptions): Promise<{ apps: AppRecord[]; total: number }> {
        this.ensureReady();
        // Fetch all apps, then deduplicate to latest version per owner+filename
        const where: any = {};
        if (opts?.ownerGaii) where.ownerGaii = opts.ownerGaii;
        const allRows = await this.prisma.app.findMany({ where, orderBy: { versionNumber: 'desc' } });
        const latestMap = new Map<string, any>();
        for (const r of allRows) {
            const key = `${r.ownerGaii}:${r.filename}`;
            if (!latestMap.has(key)) latestMap.set(key, r);
        }
        let apps = Array.from(latestMap.values()).map((r: any) => this.toAppRecord(r));
        if (opts?.category) apps = apps.filter((a: AppRecord) => a.manifest.category === opts.category);
        if (opts?.tag) apps = apps.filter((a: AppRecord) => a.manifest.tags.includes(opts.tag!));
        if (opts?.q) {
            const q = opts.q.toLowerCase();
            apps = apps.filter((a: AppRecord) => a.filename.toLowerCase().includes(q) || a.manifest.name.toLowerCase().includes(q) || a.manifest.description.toLowerCase().includes(q));
        }
        if (opts?.freeOnly) apps = apps.filter((a: AppRecord) => !a.manifest.priceMorsels);
        const total = apps.length;
        apps.sort((a: AppRecord, b: AppRecord) => b.createdAt.localeCompare(a.createdAt));
        const offset = opts?.offset ?? 0;
        const limit = opts?.limit ?? 50;
        return { apps: apps.slice(offset, offset + limit), total };
    }

    async listAppVersions(ownerGaii: string, filename: string): Promise<AppRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.app.findMany({
            where: { ownerGaii, filename },
            orderBy: { versionNumber: 'desc' },
        });
        return rows.map((r: any) => this.toAppRecord(r));
    }

    async getLatestVersionNumber(ownerGaii: string, filename: string): Promise<number> {
        this.ensureReady();
        const row = await this.prisma.app.findFirst({
            where: { ownerGaii, filename },
            orderBy: { versionNumber: 'desc' },
            select: { versionNumber: true },
        });
        return row?.versionNumber ?? 0;
    }

    async deleteApp(ownerGaii: string, filename: string, version?: number): Promise<boolean> {
        this.ensureReady();
        if (version !== undefined) {
            const result = await this.prisma.app.deleteMany({
                where: { ownerGaii, filename, versionNumber: version },
            });
            return result.count > 0;
        }
        const result = await this.prisma.app.deleteMany({ where: { ownerGaii, filename } });
        await this.prisma.appDownload.deleteMany({ where: { ownerGaii, filename } });
        return result.count > 0;
    }

    async updateAppAccessCode(ownerGaii: string, filename: string, accessCode?: string): Promise<boolean> {
        this.ensureReady();
        const result = await this.prisma.app.updateMany({
            where: { ownerGaii, filename },
            data: { accessCode: accessCode ?? null },
        });
        return result.count > 0;
    }

    async getAppDownloads(ownerGaii: string, filename: string): Promise<number> {
        this.ensureReady();
        const row = await this.prisma.appDownload.findUnique({
            where: { ownerGaii_filename: { ownerGaii, filename } },
        });
        return row?.count ?? 0;
    }

    async incrementAppDownloads(ownerGaii: string, filename: string): Promise<void> {
        this.ensureReady();
        await this.prisma.appDownload.upsert({
            where: { ownerGaii_filename: { ownerGaii, filename } },
            update: { count: { increment: 1 } },
            create: { ownerGaii, filename, count: 1 },
        });
    }

    // ── Subdomain sites (operator-managed subdomain → app/redirect mappings) ──

    async createSubdomainSite(site: SubdomainSiteRecord): Promise<SubdomainSiteRecord> {
        this.ensureReady();
        const row = await this.prisma.subdomainSite.create({
            data: {
                subdomain: site.subdomain,
                kind: site.kind,
                target: site.target,
                enabled: site.enabled,
                createdBy: site.createdBy,
                createdAt: new Date(site.createdAt),
                updatedAt: new Date(site.updatedAt),
            },
        });
        return this.toSubdomainSiteRecord(row);
    }

    async getSubdomainSite(subdomain: string): Promise<SubdomainSiteRecord | null> {
        this.ensureReady();
        const row = await this.prisma.subdomainSite.findUnique({ where: { subdomain } });
        return row ? this.toSubdomainSiteRecord(row) : null;
    }

    async listSubdomainSites(): Promise<SubdomainSiteRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.subdomainSite.findMany({ orderBy: { subdomain: 'asc' } });
        return rows.map((r: unknown) => this.toSubdomainSiteRecord(r));
    }

    async updateSubdomainSite(
        subdomain: string,
        updates: Partial<Pick<SubdomainSiteRecord, 'kind' | 'target' | 'enabled' | 'updatedAt'>>,
    ): Promise<SubdomainSiteRecord | null> {
        this.ensureReady();
        const data: Record<string, unknown> = {
            updatedAt: updates.updatedAt ? new Date(updates.updatedAt) : new Date(),
        };
        if (updates.kind !== undefined) data.kind = updates.kind;
        if (updates.target !== undefined) data.target = updates.target;
        if (updates.enabled !== undefined) data.enabled = updates.enabled;
        try {
            const row = await this.prisma.subdomainSite.update({ where: { subdomain }, data });
            return this.toSubdomainSiteRecord(row);
        } catch {
            return null;
        }
    }

    async deleteSubdomainSite(subdomain: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.subdomainSite.delete({ where: { subdomain } });
            return true;
        } catch {
            return false;
        }
    }

    private toSubdomainSiteRecord(row: any): SubdomainSiteRecord {
        return {
            subdomain: row.subdomain,
            kind: row.kind as SubdomainSiteRecord['kind'],
            target: row.target,
            enabled: row.enabled,
            createdBy: row.createdBy,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        };
    }

    async normalizeAppOwnerNames(): Promise<number> {
        this.ensureReady();
        // Find rows whose ownerName still carries the `@node` suffix and rewrite
        // each to its bare prefix. Owner names never contain '@', so the split
        // is unambiguous. Idempotent: a second pass finds nothing.
        const rows = await this.prisma.app.findMany({
            where: { ownerName: { contains: '@' } },
            select: { ownerGaii: true, filename: true, versionNumber: true, ownerName: true },
        });
        let count = 0;
        for (const r of rows) {
            const bare = (r.ownerName as string).split('@')[0];
            if (!bare || bare === r.ownerName) continue;
            await this.prisma.app.update({
                where: { ownerGaii_filename_versionNumber: { ownerGaii: r.ownerGaii, filename: r.filename, versionNumber: r.versionNumber } },
                data: { ownerName: bare },
            });
            count++;
        }
        return count;
    }

    async mergeForkedAppBuckets(): Promise<number> {
        this.ensureReady();
        // Consolidate ownerGaii buckets forked across an owner's identity forms
        // into the owner's canonical GHII bucket. Run AFTER normalizeAppOwnerNames()
        // so grouping by the bare ownerName is reliable. See the AppRepository
        // contract for the full rationale.
        let reKeyed = 0;

        // Canonical map: bare ownerName -> GHII bucket key.
        const ghiis = await this.prisma.ghii.findMany({ select: { ownerName: true, ghii: true } });
        const canonByOwner = new Map<string, string>();
        for (const g of ghiis) if (g.ownerName && g.ghii) canonByOwner.set(g.ownerName, g.ghii);
        if (canonByOwner.size === 0) return 0;

        type AppKeyRow = { ownerGaii: string; ownerName: string; filename: string; versionNumber: number; createdAt: Date };
        const rows = await this.prisma.app.findMany({
            select: { ownerGaii: true, ownerName: true, filename: true, versionNumber: true, createdAt: true },
        }) as AppKeyRow[];

        // Group by ownerName + filename (only owners we can canonicalize).
        const groups = new Map<string, AppKeyRow[]>();
        for (const r of rows) {
            if (!canonByOwner.has(r.ownerName)) continue;
            const key = `${r.ownerName} ${r.filename}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(r);
        }

        for (const [key, groupRows] of groups) {
            const sep = key.indexOf(' ');
            const ownerName = key.slice(0, sep);
            const filename = key.slice(sep + 1);
            const ghii = canonByOwner.get(ownerName)!;

            const strays = groupRows
                .filter(r => r.ownerGaii !== ghii)
                .sort((a, b) => {
                    const t = a.createdAt.getTime() - b.createdAt.getTime();
                    return t !== 0 ? t : a.versionNumber - b.versionNumber;
                });
            if (strays.length === 0) continue;

            let maxV = groupRows
                .filter(r => r.ownerGaii === ghii)
                .reduce((m, r) => Math.max(m, r.versionNumber), 0);

            for (const s of strays) {
                maxV += 1;
                await this.prisma.app.update({
                    where: { ownerGaii_filename_versionNumber: { ownerGaii: s.ownerGaii, filename, versionNumber: s.versionNumber } },
                    data: { ownerGaii: ghii, versionNumber: maxV },
                });
                reKeyed += 1;
            }

            const strayBuckets = [...new Set(strays.map(s => s.ownerGaii))];
            const ssKey = `apps/screenshots/${filename}`;

            // Move one stray screenshot into the canonical bucket if it lacks one,
            // then drop any remaining stray screenshots for this app.
            const canonSs = await this.prisma.storageFile.findUnique({
                where: { ownerGaii_key: { ownerGaii: ghii, key: ssKey } }, select: { ownerGaii: true },
            });
            if (!canonSs) {
                for (const b of strayBuckets) {
                    const existing = await this.prisma.storageFile.findUnique({
                        where: { ownerGaii_key: { ownerGaii: b, key: ssKey } }, select: { ownerGaii: true },
                    });
                    if (existing) {
                        await this.prisma.storageFile.update({
                            where: { ownerGaii_key: { ownerGaii: b, key: ssKey } }, data: { ownerGaii: ghii },
                        });
                        break;
                    }
                }
            }
            for (const b of strayBuckets) {
                await this.prisma.storageFile.deleteMany({ where: { ownerGaii: b, key: ssKey } });
            }

            // Fold stray download counters into the canonical row, then remove them.
            for (const b of strayBuckets) {
                const d = await this.prisma.appDownload.findUnique({
                    where: { ownerGaii_filename: { ownerGaii: b, filename } }, select: { count: true },
                });
                if (d && d.count > 0) {
                    await this.prisma.appDownload.upsert({
                        where: { ownerGaii_filename: { ownerGaii: ghii, filename } },
                        update: { count: { increment: d.count } },
                        create: { ownerGaii: ghii, filename, count: d.count },
                    });
                }
                await this.prisma.appDownload.deleteMany({ where: { ownerGaii: b, filename } });
            }
        }
        return reKeyed;
    }

    // ── App Marketplace (Prisma-persisted purchase receipts) ──

    private toAppPurchaseRecord(row: any): AppPurchaseRecord {
        return {
            transactionId: row.transactionId,
            buyerGaii: row.buyerGaii,
            buyerOwner: row.buyerOwner,
            sellerGaii: row.sellerGaii,
            sellerOwner: row.sellerOwner,
            appFilename: row.appFilename,
            appName: row.appName,
            appVersionNumber: row.appVersionNumber,
            licenseType: row.licenseType as 'single' | 'lifetime',
            priceMorsels: row.priceMorsels,
            transactionFeeMorsels: row.transactionFeeMorsels,
            purchasedAt: row.purchasedAt instanceof Date ? row.purchasedAt.toISOString() : row.purchasedAt,
            appContent: row.appContent,
            appManifest: row.appManifest as any,
            appScreenshot: row.appScreenshot ?? undefined,
            signature: row.signature,
            nodeId: row.nodeId,
            nodePublicKey: row.nodePublicKey,
        };
    }

    async createAppPurchase(record: AppPurchaseRecord): Promise<AppPurchaseRecord> {
        this.ensureReady();
        await this.prisma.appPurchase.create({
            data: {
                transactionId: record.transactionId,
                buyerGaii: record.buyerGaii,
                buyerOwner: record.buyerOwner,
                sellerGaii: record.sellerGaii,
                sellerOwner: record.sellerOwner,
                appFilename: record.appFilename,
                appName: record.appName,
                appVersionNumber: record.appVersionNumber,
                licenseType: record.licenseType,
                priceMorsels: record.priceMorsels,
                transactionFeeMorsels: record.transactionFeeMorsels,
                purchasedAt: new Date(record.purchasedAt),
                appContent: record.appContent,
                appManifest: record.appManifest as any,
                appScreenshot: record.appScreenshot,
                signature: record.signature,
                nodeId: record.nodeId,
                nodePublicKey: record.nodePublicKey,
            },
        });
        return record;
    }

    async getAppPurchase(transactionId: string): Promise<AppPurchaseRecord | null> {
        this.ensureReady();
        const row = await this.prisma.appPurchase.findUnique({ where: { transactionId } });
        return row ? this.toAppPurchaseRecord(row) : null;
    }

    async listAppPurchasesByBuyer(buyerGaii: string): Promise<AppPurchaseRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.appPurchase.findMany({
            where: { buyerGaii },
            orderBy: { purchasedAt: 'desc' },
        });
        return rows.map((r: any) => this.toAppPurchaseRecord(r));
    }

    async listAppPurchasesBySeller(sellerGaii: string): Promise<AppPurchaseRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.appPurchase.findMany({
            where: { sellerGaii },
            orderBy: { purchasedAt: 'desc' },
        });
        return rows.map((r: any) => this.toAppPurchaseRecord(r));
    }

    async hasValidLicense(buyerGaii: string, sellerGaii: string, filename: string, licenseType?: 'single' | 'lifetime'): Promise<boolean> {
        this.ensureReady();
        const where: any = { buyerGaii, sellerGaii, appFilename: filename };
        if (licenseType === 'lifetime') where.licenseType = 'lifetime';
        const count = await this.prisma.appPurchase.count({ where });
        return count > 0;
    }

    // ── Config Persistence ──────────────────────────────────

    supportsConfigPersistence(): boolean { return true; }

    async getConfigValue(key: string): Promise<string | null> {
        this.ensureReady();
        const row = await this.prisma.systemSetting.findUnique({ where: { key: `config:${key}` } });
        return row?.value ?? null;
    }

    async setConfigValue(key: string, value: string): Promise<void> {
        this.ensureReady();
        await this.prisma.systemSetting.upsert({
            where: { key: `config:${key}` },
            update: { value },
            create: { key: `config:${key}`, value },
        });
    }

    async deleteConfigValue(key: string): Promise<void> {
        this.ensureReady();
        await this.prisma.systemSetting.deleteMany({ where: { key: `config:${key}` } });
    }

    async getAllConfigValues(): Promise<Record<string, string>> {
        this.ensureReady();
        const rows = await this.prisma.systemSetting.findMany({
            where: { key: { startsWith: 'config:' } },
        });
        const result: Record<string, string> = {};
        for (const r of rows) result[r.key.replace('config:', '')] = r.value;
        return result;
    }

    // ══════════════════════════════════════════════════════════
    // ── Knowledge: Memory Links ──
    // ══════════════════════════════════════════════════════════

    private toMemoryLinkRecord(row: any): MemoryLinkRecord {
        return {
            source: row.source,
            target: row.target,
            relation: row.relation,
            description: row.description,
            linked_at: row.linkedAt instanceof Date ? row.linkedAt.toISOString() : row.linkedAt,
            linked_by: row.linkedBy,
        };
    }

    async createLink(record: MemoryLinkRecord): Promise<MemoryLinkRecord> {
        this.ensureReady();
        await this.prisma.knowledgeLink.create({
            data: {
                source: record.source,
                target: record.target,
                relation: record.relation,
                description: record.description,
                linkedAt: new Date(record.linked_at),
                linkedBy: record.linked_by,
            },
        });
        return record;
    }

    async getLink(source: string, target: string): Promise<MemoryLinkRecord | null> {
        this.ensureReady();
        const row = await this.prisma.knowledgeLink.findUnique({
            where: { source_target: { source, target } },
        });
        return row ? this.toMemoryLinkRecord(row) : null;
    }

    async listLinks(key: string, opts?: { direction?: 'outgoing' | 'incoming' | 'both'; relation?: string }): Promise<MemoryLinkRecord[]> {
        this.ensureReady();
        const dir = opts?.direction ?? 'both';
        const where: any = {};
        if (dir === 'outgoing') where.source = key;
        else if (dir === 'incoming') where.target = key;
        else where.OR = [{ source: key }, { target: key }];
        if (opts?.relation) where.relation = opts.relation;
        const rows = await this.prisma.knowledgeLink.findMany({ where });
        return rows.map((r: any) => this.toMemoryLinkRecord(r));
    }

    async deleteLink(source: string, target: string): Promise<boolean> {
        this.ensureReady();
        const result = await this.prisma.knowledgeLink.deleteMany({
            where: { source, target },
        });
        return result.count > 0;
    }

    async findBrokenLinks(ownerGaii: string): Promise<MemoryLinkRecord[]> {
        this.ensureReady();
        const links = await this.prisma.knowledgeLink.findMany({
            where: { linkedBy: ownerGaii },
        });
        const broken: MemoryLinkRecord[] = [];
        for (const link of links) {
            const sourceExists = await this.getMemory(ownerGaii, link.source);
            const targetExists = await this.getMemory(ownerGaii, link.target);
            if (!sourceExists || !targetExists) broken.push(this.toMemoryLinkRecord(link));
        }
        return broken;
    }

    async deleteLinksByContributor(gaii: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.knowledgeLink.deleteMany({ where: { linkedBy: gaii } });
        return result.count;
    }

    // ══════════════════════════════════════════════════════════
    // ── Knowledge: Operator Reviews (Prisma-persisted) ──
    // ══════════════════════════════════════════════════════════

    private toOperatorReviewRecord(row: any): OperatorReviewRecord {
        return {
            id: row.id,
            packageId: row.packageId,
            operatorGaii: row.operatorGaii,
            reason: row.reason,
            customText: row.customText ?? undefined,
            action: row.action,
            timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
        };
    }

    async createReview(record: OperatorReviewRecord): Promise<OperatorReviewRecord> {
        this.ensureReady();
        await this.prisma.knowledgeReview.create({
            data: {
                id: record.id,
                packageId: record.packageId,
                operatorGaii: record.operatorGaii,
                reason: record.reason,
                customText: record.customText,
                action: record.action,
                timestamp: new Date(record.timestamp),
            },
        });
        return record;
    }

    async listReviews(packageId: string): Promise<OperatorReviewRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.knowledgeReview.findMany({ where: { packageId } });
        return rows.map((r: any) => this.toOperatorReviewRecord(r));
    }

    async listAllReviews(opts?: { page?: number; perPage?: number }): Promise<OperatorReviewRecord[]> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const rows = await this.prisma.knowledgeReview.findMany({
            orderBy: { timestamp: 'desc' },
            skip: (page - 1) * perPage,
            take: perPage,
        });
        return rows.map((r: any) => this.toOperatorReviewRecord(r));
    }

    async deleteReviewsByOperator(gaii: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.knowledgeReview.deleteMany({ where: { operatorGaii: gaii } });
        return result.count;
    }

    // ══════════════════════════════════════════════════════════
    // ── Scheduler: Scheduled Jobs ──
    // ══════════════════════════════════════════════════════════

    private toScheduledJobRecord(row: any): ScheduledJobRecord {
        return {
            id: row.id,
            name: row.name,
            type: row.type as ScheduledJobRecord['type'],
            extensionName: row.extensionName ?? undefined,
            instanceId: row.instanceId ?? undefined,
            actionId: row.actionId ?? undefined,
            coreHandler: row.coreHandler ?? undefined,
            cron: row.cron,
            enabled: row.enabled,
            input: row.input as Record<string, unknown> | undefined,
            lastRunAt: row.lastRunAt instanceof Date ? row.lastRunAt.toISOString() : row.lastRunAt ?? undefined,
            lastRunResult: row.lastRunResult as ScheduledJobRecord['lastRunResult'],
            lastRunError: row.lastRunError ?? undefined,
            lastRunDurationMs: row.lastRunDurationMs ?? undefined,
            nextRunAt: row.nextRunAt instanceof Date ? row.nextRunAt.toISOString() : row.nextRunAt ?? undefined,
            createdBy: row.createdBy,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
            ownerScope: row.ownerScope ?? undefined,
            agentName: row.agentName ?? undefined,
            agentGaii: row.agentGaii ?? undefined,
            createdByAgent: row.createdByAgent ?? undefined,
            displayName: row.displayName ?? undefined,
            description: row.description ?? undefined,
            purpose: row.purpose ?? undefined,
            timezone: row.timezone ?? undefined,
            constraints: (row.constraints as ScheduledJobRecord['constraints']) ?? undefined,
            runCount: row.runCount ?? undefined,
        };
    }

    async createScheduledJob(record: ScheduledJobRecord): Promise<ScheduledJobRecord> {
        this.ensureReady();
        await this.prisma.scheduledJob.create({
            data: {
                id: record.id,
                name: record.name,
                type: record.type,
                extensionName: record.extensionName,
                instanceId: record.instanceId,
                actionId: record.actionId,
                coreHandler: record.coreHandler,
                cron: record.cron,
                enabled: record.enabled,
                input: record.input as any,
                lastRunAt: record.lastRunAt ? new Date(record.lastRunAt) : null,
                lastRunResult: record.lastRunResult,
                lastRunError: record.lastRunError,
                lastRunDurationMs: record.lastRunDurationMs,
                nextRunAt: record.nextRunAt ? new Date(record.nextRunAt) : null,
                createdBy: record.createdBy,
                createdAt: new Date(record.createdAt),
                updatedAt: new Date(record.updatedAt),
                ownerScope: record.ownerScope,
                agentName: record.agentName,
                agentGaii: record.agentGaii,
                createdByAgent: record.createdByAgent ?? false,
                displayName: record.displayName,
                description: record.description,
                purpose: record.purpose,
                timezone: record.timezone,
                constraints: record.constraints as any,
                runCount: record.runCount ?? 0,
            },
        });
        return record;
    }

    async getScheduledJob(id: string): Promise<ScheduledJobRecord | null> {
        this.ensureReady();
        const row = await this.prisma.scheduledJob.findUnique({ where: { id } });
        return row ? this.toScheduledJobRecord(row) : null;
    }

    async listScheduledJobs(filter?: { type?: string; extensionName?: string; enabled?: boolean; ownerScope?: string; agentGaii?: string }): Promise<ScheduledJobRecord[]> {
        this.ensureReady();
        const where: any = {};
        if (filter?.type !== undefined) where.type = filter.type;
        if (filter?.extensionName !== undefined) where.extensionName = filter.extensionName;
        if (filter?.enabled !== undefined) where.enabled = filter.enabled;
        if (filter?.ownerScope !== undefined) where.ownerScope = filter.ownerScope;
        if (filter?.agentGaii !== undefined) where.agentGaii = filter.agentGaii;
        const rows = await this.prisma.scheduledJob.findMany({ where });
        return rows.map((r: any) => this.toScheduledJobRecord(r));
    }

    async updateScheduledJob(id: string, updates: Partial<ScheduledJobRecord>): Promise<ScheduledJobRecord | null> {
        this.ensureReady();
        const existing = await this.prisma.scheduledJob.findUnique({ where: { id } });
        if (!existing) return null;
        const data: any = {};
        if (updates.name !== undefined) data.name = updates.name;
        if (updates.type !== undefined) data.type = updates.type;
        if (updates.extensionName !== undefined) data.extensionName = updates.extensionName;
        if (updates.instanceId !== undefined) data.instanceId = updates.instanceId;
        if (updates.actionId !== undefined) data.actionId = updates.actionId;
        if (updates.coreHandler !== undefined) data.coreHandler = updates.coreHandler;
        if (updates.cron !== undefined) data.cron = updates.cron;
        if (updates.enabled !== undefined) data.enabled = updates.enabled;
        if (updates.input !== undefined) data.input = updates.input as any;
        if (updates.lastRunAt !== undefined) data.lastRunAt = updates.lastRunAt ? new Date(updates.lastRunAt) : null;
        if (updates.lastRunResult !== undefined) data.lastRunResult = updates.lastRunResult;
        if (updates.lastRunError !== undefined) data.lastRunError = updates.lastRunError;
        if (updates.lastRunDurationMs !== undefined) data.lastRunDurationMs = updates.lastRunDurationMs;
        if (updates.nextRunAt !== undefined) data.nextRunAt = updates.nextRunAt ? new Date(updates.nextRunAt) : null;
        if (updates.ownerScope !== undefined) data.ownerScope = updates.ownerScope;
        if (updates.agentName !== undefined) data.agentName = updates.agentName;
        if (updates.agentGaii !== undefined) data.agentGaii = updates.agentGaii;
        if (updates.createdByAgent !== undefined) data.createdByAgent = updates.createdByAgent;
        if (updates.displayName !== undefined) data.displayName = updates.displayName;
        if (updates.description !== undefined) data.description = updates.description;
        if (updates.purpose !== undefined) data.purpose = updates.purpose;
        if (updates.timezone !== undefined) data.timezone = updates.timezone;
        if (updates.constraints !== undefined) data.constraints = updates.constraints as any;
        if (updates.runCount !== undefined) data.runCount = updates.runCount;
        const row = await this.prisma.scheduledJob.update({ where: { id }, data });
        return this.toScheduledJobRecord(row);
    }

    async deleteScheduledJob(id: string): Promise<boolean> {
        this.ensureReady();
        const result = await this.prisma.scheduledJob.deleteMany({ where: { id } });
        return result.count > 0;
    }

    // ══════════════════════════════════════════════════════════
    // ── Execution Log ──
    // ══════════════════════════════════════════════════════════

    async createExecutionLog(entry: ExecutionLogEntry): Promise<ExecutionLogEntry> {
        this.ensureReady();
        await this.prisma.executionLog.create({
            data: {
                id: entry.id,
                jobId: entry.jobId,
                jobName: entry.jobName,
                type: entry.type,
                extensionName: entry.extensionName,
                actionId: entry.actionId,
                trigger: entry.trigger,
                result: entry.result,
                errorMessage: entry.errorMessage,
                durationMs: entry.durationMs,
                memoryReads: entry.memoryReads as any,
                memoryWrites: entry.memoryWrites as any,
                taskId: entry.taskId,
                createdAt: new Date(entry.createdAt),
            },
        });
        return entry;
    }

    async listExecutionLogs(filter?: {
        jobId?: string; extensionName?: string; trigger?: string; result?: string;
        limit?: number; offset?: number;
    }): Promise<ExecutionLogEntry[]> {
        this.ensureReady();
        const where: any = {};
        if (filter?.jobId) where.jobId = filter.jobId;
        if (filter?.extensionName) where.extensionName = filter.extensionName;
        if (filter?.trigger) where.trigger = filter.trigger;
        if (filter?.result) where.result = filter.result;
        const rows = await this.prisma.executionLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: filter?.limit ?? 100,
            skip: filter?.offset ?? 0,
        });
        return rows.map((r: any) => this.toExecutionLogEntry(r));
    }

    async countExecutionLogs(filter?: {
        jobId?: string; extensionName?: string; trigger?: string; result?: string;
    }): Promise<number> {
        this.ensureReady();
        const where: any = {};
        if (filter?.jobId) where.jobId = filter.jobId;
        if (filter?.extensionName) where.extensionName = filter.extensionName;
        if (filter?.trigger) where.trigger = filter.trigger;
        if (filter?.result) where.result = filter.result;
        return this.prisma.executionLog.count({ where });
    }

    async pruneExecutionLogs(beforeDate: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.executionLog.deleteMany({
            where: { createdAt: { lt: new Date(beforeDate) } },
        });
        return result.count;
    }

    private toExecutionLogEntry(row: any): ExecutionLogEntry {
        return {
            id: row.id,
            jobId: row.jobId,
            jobName: row.jobName,
            type: row.type as ExecutionLogEntry['type'],
            extensionName: row.extensionName ?? undefined,
            actionId: row.actionId ?? undefined,
            trigger: row.trigger as 'cron' | 'manual' | 'activate',
            result: row.result as 'success' | 'error' | 'skipped',
            errorMessage: row.errorMessage ?? undefined,
            durationMs: row.durationMs,
            memoryReads: Array.isArray(row.memoryReads) ? row.memoryReads : JSON.parse(row.memoryReads || '[]'),
            memoryWrites: Array.isArray(row.memoryWrites) ? row.memoryWrites : JSON.parse(row.memoryWrites || '[]'),
            taskId: row.taskId ?? undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    }

    // ══════════════════════════════════════════════════════════
    // ── Extension Instances (Prisma-persisted) ──
    // ══════════════════════════════════════════════════════════

    private toExtensionInstanceRecord(row: any): ExtensionInstanceRecord {
        return {
            id: row.instanceId,
            extensionName: row.extensionName,
            config: (row.config as Record<string, unknown>) || {},
            status: row.status as 'active' | 'paused',
            translations: row.translations as Record<string, Record<string, string>> | undefined,
            createdBy: row.createdBy,
            createdByAgent: row.createdByAgent ?? undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
    }

    async createExtensionInstance(record: ExtensionInstanceRecord): Promise<ExtensionInstanceRecord> {
        this.ensureReady();
        const row = await this.prisma.extensionInstance.create({
            data: {
                instanceId: record.id,
                extensionName: record.extensionName,
                config: record.config as any,
                status: record.status,
                translations: record.translations ? record.translations as any : undefined,
                createdBy: record.createdBy,
                createdByAgent: record.createdByAgent ?? null,
                createdAt: new Date(record.createdAt),
            },
        });
        return this.toExtensionInstanceRecord(row);
    }

    async getExtensionInstance(extensionName: string, instanceId: string): Promise<ExtensionInstanceRecord | null> {
        this.ensureReady();
        const row = await this.prisma.extensionInstance.findUnique({
            where: { extensionName_instanceId: { extensionName, instanceId } },
        });
        return row ? this.toExtensionInstanceRecord(row) : null;
    }

    async listExtensionInstances(extensionName: string): Promise<ExtensionInstanceRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.extensionInstance.findMany({
            where: { extensionName },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map((r: any) => this.toExtensionInstanceRecord(r));
    }

    async updateExtensionInstance(extensionName: string, instanceId: string, updates: Partial<ExtensionInstanceRecord>): Promise<ExtensionInstanceRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.config !== undefined) data.config = updates.config as any;
            if (updates.status !== undefined) data.status = updates.status;
            if (updates.translations !== undefined) data.translations = updates.translations as any;
            const row = await this.prisma.extensionInstance.update({
                where: { extensionName_instanceId: { extensionName, instanceId } },
                data,
            });
            return this.toExtensionInstanceRecord(row);
        } catch {
            return null;
        }
    }

    async deleteExtensionInstance(extensionName: string, instanceId: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.extensionInstance.delete({
                where: { extensionName_instanceId: { extensionName, instanceId } },
            });
            return true;
        } catch {
            return false;
        }
    }

    async deleteExtensionInstancesByOwner(ownerIdentity: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.extensionInstance.deleteMany({ where: { createdBy: ownerIdentity } });
        return result.count;
    }

    // ══════════════════════════════════════════════════════════
    // ── Federation Peers (persisted active peer connections) ──
    // ══════════════════════════════════════════════════════════

    async saveFederationPeer(peer: FederationPeerRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.federationPeer.upsert({
            where: { nodeId: peer.nodeId },
            create: { nodeId: peer.nodeId, url: peer.url, publicKey: peer.publicKey, status: peer.status, addedAt: new Date(peer.addedAt), lastSeen: new Date(peer.lastSeen), shareCatalogue: peer.shareCatalogue, replicateMemory: peer.replicateMemory, allowRouting: peer.allowRouting, peerMode: peer.peerMode || 'federation', allowFederatedAuth: peer.allowFederatedAuth ?? false, federationAuthScopes: peer.federationAuthScopes ?? [] },
            update: { url: peer.url, publicKey: peer.publicKey, status: peer.status, lastSeen: new Date(peer.lastSeen), shareCatalogue: peer.shareCatalogue, replicateMemory: peer.replicateMemory, allowRouting: peer.allowRouting, peerMode: peer.peerMode || 'federation', allowFederatedAuth: peer.allowFederatedAuth ?? false, federationAuthScopes: peer.federationAuthScopes ?? [] },
        });
    }

    async listFederationPeers(): Promise<FederationPeerRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.federationPeer.findMany();
        return rows.map((r: any) => ({
            nodeId: r.nodeId,
            url: r.url,
            publicKey: r.publicKey,
            status: r.status,
            addedAt: r.addedAt instanceof Date ? r.addedAt.toISOString() : r.addedAt,
            lastSeen: r.lastSeen instanceof Date ? r.lastSeen.toISOString() : r.lastSeen,
            shareCatalogue: r.shareCatalogue ?? true,
            replicateMemory: r.replicateMemory ?? true,
            allowRouting: r.allowRouting ?? true,
            peerMode: r.peerMode || 'federation',
            allowFederatedAuth: r.allowFederatedAuth ?? false,
            federationAuthScopes: r.federationAuthScopes ?? [],
        }));
    }

    async deleteFederationPeer(nodeId: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.federationPeer.delete({ where: { nodeId } });
            return true;
        } catch {
            return false;
        }
    }

    // ══════════════════════════════════════════════════════════
    // ── Replication Queue (B.1) — persisted to MongoDB
    // ══════════════════════════════════════════════════════════

    async enqueueReplication(entry: Omit<ReplicationQueueEntry, 'id' | 'attempts' | 'lastAttemptAt' | 'status'>): Promise<string> {
        this.ensureReady();
        const id = randomUUID();
        await this.prisma.replicationQueue.create({
            data: {
                id,
                type: entry.type,
                targetPeers: entry.targetPeers,
                payload: entry.payload != null ? JSON.stringify(entry.payload) : null,
                createdAt: new Date(entry.createdAt),
                attempts: 0,
                lastAttemptAt: null,
                status: 'pending',
            },
        });
        return id;
    }

    async dequeueReplication(peerId: string, limit: number): Promise<ReplicationQueueEntry[]> {
        this.ensureReady();
        const rows = await this.prisma.replicationQueue.findMany({
            where: { status: 'pending', targetPeers: { has: peerId } },
            orderBy: { createdAt: 'asc' },
            take: limit,
        });
        return rows.map((r: any) => ({
            id: r.id,
            type: r.type,
            targetPeers: r.targetPeers,
            payload: r.payload ? JSON.parse(r.payload) : null,
            createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
            attempts: r.attempts,
            lastAttemptAt: r.lastAttemptAt instanceof Date ? r.lastAttemptAt.toISOString() : r.lastAttemptAt,
            status: r.status,
        }));
    }

    async markReplicationSent(ids: string[]): Promise<void> {
        this.ensureReady();
        await this.prisma.replicationQueue.updateMany({
            where: { id: { in: ids } },
            data: { status: 'sent' },
        });
    }

    async markReplicationFailed(ids: string[]): Promise<void> {
        this.ensureReady();
        for (const id of ids) {
            await this.prisma.replicationQueue.update({
                where: { id },
                data: { status: 'failed', attempts: { increment: 1 }, lastAttemptAt: new Date() },
            }).catch(() => {});
        }
    }

    async pruneReplicationQueue(maxAge: Date): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.replicationQueue.deleteMany({
            where: { OR: [{ createdAt: { lt: maxAge } }, { status: 'sent' }] },
        });
        return result.count;
    }

    async replicationQueueSize(): Promise<number> {
        this.ensureReady();
        return this.prisma.replicationQueue.count();
    }

    // ── Device Authorization (RFC 8628) ──

    async createDeviceAuth(req: DeviceAuthorizationRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.deviceAuth.create({
            data: {
                deviceCode: req.deviceCode,
                userCode: req.userCode,
                ownerName: req.ownerName,
                agentName: req.agentName,
                displayName: req.displayName,
                description: req.description,
                status: req.status,
                scopes: req.scopes ?? [],
                createdAt: new Date(req.createdAt),
                expiresAt: new Date(req.expiresAt),
                lastPolledAt: req.lastPolledAt ? new Date(req.lastPolledAt) : null,
                pollInterval: req.pollInterval,
                approvedBy: req.approvedBy,
                agentCredentials: req.agentCredentials ?? undefined,
                mode: req.mode ?? 'interactive',
            },
        });
    }

    async getDeviceAuthByDeviceCode(deviceCode: string): Promise<DeviceAuthorizationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.deviceAuth.findUnique({ where: { deviceCode } });
        return row ? this.toDeviceAuthRecord(row) : null;
    }

    async getDeviceAuthByUserCode(userCode: string): Promise<DeviceAuthorizationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.deviceAuth.findUnique({ where: { userCode } });
        return row ? this.toDeviceAuthRecord(row) : null;
    }

    async updateDeviceAuth(deviceCode: string, updates: Partial<DeviceAuthorizationRecord>): Promise<void> {
        this.ensureReady();
        const data: any = {};
        if (updates.status !== undefined) data.status = updates.status;
        if (updates.scopes !== undefined) data.scopes = updates.scopes;
        if (updates.lastPolledAt !== undefined) data.lastPolledAt = updates.lastPolledAt ? new Date(updates.lastPolledAt) : null;
        if (updates.pollInterval !== undefined) data.pollInterval = updates.pollInterval;
        if (updates.approvedBy !== undefined) data.approvedBy = updates.approvedBy;
        if ('agentCredentials' in updates) data.agentCredentials = updates.agentCredentials ?? null;
        await this.prisma.deviceAuth.update({ where: { deviceCode }, data });
    }

    async countPendingDeviceAuthByOwner(ownerName: string): Promise<number> {
        this.ensureReady();
        return this.prisma.deviceAuth.count({
            where: { ownerName, status: 'pending', expiresAt: { gt: new Date() } },
        });
    }

    async listPendingDeviceAuthByOwner(ownerName: string): Promise<DeviceAuthorizationRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.deviceAuth.findMany({
            where: { ownerName, status: 'pending', expiresAt: { gt: new Date() } },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map((row: any) => this.toDeviceAuthRecord(row));
    }

    async cleanupExpiredDeviceAuth(): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.deviceAuth.deleteMany({
            where: { status: 'pending', expiresAt: { lte: new Date() } },
        });
        return result.count;
    }

    async deleteDeviceAuthByOwner(ownerName: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.deviceAuth.deleteMany({ where: { ownerName } });
        return result.count;
    }

    // ── Ecosystem Applications (GEAI) + hello-integration handshake ──
    async createEcosystemApp(app: EcosystemAppRecord): Promise<EcosystemAppRecord> {
        this.ensureReady();
        const row = await this.prisma.ecosystemApp.create({
            data: {
                geai: app.geai,
                app: app.app,
                owner: app.owner,
                displayName: app.displayName ?? null,
                description: app.description ?? null,
                publicKey: app.publicKey,
                scopes: app.scopes ?? [],
                dataAreas: (app.dataAreas as any) ?? null,
                boundRef: app.boundRef ?? null,
                status: app.status,
                morselBalance: app.morselBalance ?? 0,
                capabilities: (app.capabilities as any) ?? undefined,
                automation: (app.automation as any) ?? undefined,
                createdAt: new Date(app.createdAt),
                lastSeen: new Date(app.lastSeen),
            },
        });
        return this.toEcosystemAppRecord(row);
    }

    async getEcosystemApp(geai: string): Promise<EcosystemAppRecord | null> {
        this.ensureReady();
        const row = await this.prisma.ecosystemApp.findUnique({ where: { geai } });
        return row ? this.toEcosystemAppRecord(row) : null;
    }

    async getEcosystemAppByOwnerAndApp(owner: string, app: string): Promise<EcosystemAppRecord | null> {
        this.ensureReady();
        const row = await this.prisma.ecosystemApp.findFirst({ where: { owner, app } });
        return row ? this.toEcosystemAppRecord(row) : null;
    }

    async getEcosystemAppsByOwner(owner: string): Promise<EcosystemAppRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.ecosystemApp.findMany({ where: { owner } });
        return rows.map((r: any) => this.toEcosystemAppRecord(r));
    }

    async updateEcosystemApp(geai: string, updates: Partial<EcosystemAppRecord>): Promise<EcosystemAppRecord | null> {
        this.ensureReady();
        const data: any = {};
        if (updates.app !== undefined) data.app = updates.app;
        if (updates.owner !== undefined) data.owner = updates.owner;
        if (updates.displayName !== undefined) data.displayName = updates.displayName;
        if (updates.description !== undefined) data.description = updates.description;
        if (updates.publicKey !== undefined) data.publicKey = updates.publicKey;
        if (updates.scopes !== undefined) data.scopes = updates.scopes;
        if (updates.dataAreas !== undefined) data.dataAreas = (updates.dataAreas as any) ?? null;
        if (updates.boundRef !== undefined) data.boundRef = updates.boundRef;
        if (updates.status !== undefined) data.status = updates.status;
        if (updates.morselBalance !== undefined) data.morselBalance = updates.morselBalance;
        if (updates.capabilities !== undefined) data.capabilities = (updates.capabilities as any) ?? null;
        if (updates.automation !== undefined) data.automation = (updates.automation as any) ?? null;
        if (updates.lastSeen !== undefined) data.lastSeen = new Date(updates.lastSeen);
        try {
            const row = await this.prisma.ecosystemApp.update({ where: { geai }, data });
            return this.toEcosystemAppRecord(row);
        } catch (err) {
            logger.warn('updateEcosystemApp failed for %s: %s', geai, (err as Error).message);
            return null;
        }
    }

    async deleteEcosystemApp(geai: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.ecosystemApp.delete({ where: { geai } });
            return true;
        } catch { return false; }
    }

    async createEcoAuth(req: EcoAuthorizationRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.ecoAuth.create({
            data: {
                deviceCode: req.deviceCode,
                userCode: req.userCode,
                ownerName: req.ownerName,
                app: req.app,
                displayName: req.displayName,
                description: req.description,
                status: req.status,
                publicKey: req.publicKey ?? null,
                scopes: req.scopes ?? [],
                dataAreas: (req.dataAreas as any) ?? null,
                boundRef: req.boundRef ?? null,
                createdAt: new Date(req.createdAt),
                expiresAt: new Date(req.expiresAt),
                lastPolledAt: req.lastPolledAt ? new Date(req.lastPolledAt) : null,
                pollInterval: req.pollInterval,
                approvedBy: req.approvedBy,
                validationResult: (req.validationResult as any) ?? undefined,
                capabilities: (req.capabilities as any) ?? undefined,
                automation: (req.automation as any) ?? undefined,
                appCredentials: (req.appCredentials as any) ?? undefined,
            },
        });
    }

    async getEcoAuthByDeviceCode(deviceCode: string): Promise<EcoAuthorizationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.ecoAuth.findUnique({ where: { deviceCode } });
        return row ? this.toEcoAuthRecord(row) : null;
    }

    async getEcoAuthByUserCode(userCode: string): Promise<EcoAuthorizationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.ecoAuth.findUnique({ where: { userCode } });
        return row ? this.toEcoAuthRecord(row) : null;
    }

    async updateEcoAuth(deviceCode: string, updates: Partial<EcoAuthorizationRecord>): Promise<void> {
        this.ensureReady();
        const data: any = {};
        if (updates.status !== undefined) data.status = updates.status;
        if (updates.scopes !== undefined) data.scopes = updates.scopes;
        if (updates.dataAreas !== undefined) data.dataAreas = (updates.dataAreas as any) ?? null;
        if (updates.boundRef !== undefined) data.boundRef = updates.boundRef;
        if (updates.lastPolledAt !== undefined) data.lastPolledAt = updates.lastPolledAt ? new Date(updates.lastPolledAt) : null;
        if (updates.pollInterval !== undefined) data.pollInterval = updates.pollInterval;
        if (updates.approvedBy !== undefined) data.approvedBy = updates.approvedBy;
        if ('appCredentials' in updates) data.appCredentials = updates.appCredentials ?? null;
        await this.prisma.ecoAuth.update({ where: { deviceCode }, data });
    }

    async countPendingEcoAuthByOwner(ownerName: string): Promise<number> {
        this.ensureReady();
        return this.prisma.ecoAuth.count({
            where: { ownerName, status: 'pending', expiresAt: { gt: new Date() } },
        });
    }

    async listPendingEcoAuthByOwner(ownerName: string): Promise<EcoAuthorizationRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.ecoAuth.findMany({
            where: { ownerName, status: 'pending', expiresAt: { gt: new Date() } },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map((row: any) => this.toEcoAuthRecord(row));
    }

    async cleanupExpiredEcoAuth(): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.ecoAuth.deleteMany({
            where: { status: 'pending', expiresAt: { lte: new Date() } },
        });
        return result.count;
    }

    // ── Automation recipes (feature B4). The Prisma client may not be regenerated in
    // dev (Mongo db:generate can EPERM on the native DLL under the infra ban), so the
    // ecoAutomationRecipe delegate + JSON columns are accessed via `as any` — same
    // workaround the Phase-2 capabilities/automation columns use above.
    async getAutomationRecipe(owner: string, app: string): Promise<EcoAutomationRecipe | null> {
        this.ensureReady();
        const row = await (this.prisma as any).ecoAutomationRecipe.findFirst({ where: { owner, app } });
        return row ? this.toAutomationRecipe(row) : null;
    }

    async upsertAutomationRecipe(recipe: EcoAutomationRecipe): Promise<EcoAutomationRecipe> {
        this.ensureReady();
        const data: any = {
            owner: recipe.owner,
            app: recipe.app,
            trigger: recipe.trigger as any,
            agents: recipe.agents as any,
            organism: recipe.organism ?? null,
            email: !!recipe.email,
            requireApproval: !!recipe.requireApproval,
            enabled: recipe.enabled,
            updatedAt: new Date(recipe.updatedAt),
        };
        const row = await (this.prisma as any).ecoAutomationRecipe.upsert({
            where: { owner_app: { owner: recipe.owner, app: recipe.app } },
            update: data,
            create: { ...data, createdAt: new Date(recipe.createdAt) },
        });
        return this.toAutomationRecipe(row);
    }

    async deleteAutomationRecipe(owner: string, app: string): Promise<boolean> {
        this.ensureReady();
        try {
            await (this.prisma as any).ecoAutomationRecipe.delete({ where: { owner_app: { owner, app } } });
            return true;
        } catch { return false; }
    }

    async listAutomationRecipesByOwner(owner: string): Promise<EcoAutomationRecipe[]> {
        this.ensureReady();
        const rows = await (this.prisma as any).ecoAutomationRecipe.findMany({ where: { owner } });
        return rows.map((r: any) => this.toAutomationRecipe(r));
    }

    private toAutomationRecipe(row: any): EcoAutomationRecipe {
        return {
            id: row.id,
            owner: row.owner,
            app: row.app,
            trigger: row.trigger as EcoAutomationRecipe['trigger'],
            agents: Array.isArray(row.agents) ? row.agents : [],
            organism: row.organism ?? null,
            email: !!row.email,
            requireApproval: !!row.requireApproval,
            enabled: !!row.enabled,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
    }

    private toEcosystemAppRecord(row: any): EcosystemAppRecord {
        const record: EcosystemAppRecord = {
            geai: row.geai,
            app: row.app,
            owner: row.owner,
            publicKey: row.publicKey,
            scopes: row.scopes ?? [],
            status: row.status,
            morselBalance: row.morselBalance ?? 0,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            lastSeen: row.lastSeen instanceof Date ? row.lastSeen.toISOString() : row.lastSeen,
        };
        if (row.displayName) record.displayName = row.displayName;
        if (row.description) record.description = row.description;
        if (row.dataAreas) record.dataAreas = row.dataAreas as any;
        if (row.boundRef) record.boundRef = row.boundRef;
        if (row.capabilities) record.capabilities = row.capabilities as any;
        if (row.automation) record.automation = row.automation as any;
        return record;
    }

    private toEcoAuthRecord(row: any): EcoAuthorizationRecord {
        return {
            deviceCode: row.deviceCode,
            userCode: row.userCode,
            ownerName: row.ownerName,
            app: row.app,
            displayName: row.displayName ?? undefined,
            description: row.description ?? undefined,
            status: row.status,
            publicKey: row.publicKey ?? undefined,
            scopes: row.scopes?.length ? row.scopes : undefined,
            dataAreas: row.dataAreas ?? undefined,
            boundRef: row.boundRef ?? undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
            lastPolledAt: row.lastPolledAt ? (row.lastPolledAt instanceof Date ? row.lastPolledAt.toISOString() : row.lastPolledAt) : undefined,
            pollInterval: row.pollInterval,
            approvedBy: row.approvedBy ?? undefined,
            validationResult: row.validationResult ?? undefined,
            capabilities: row.capabilities ?? undefined,
            automation: row.automation ?? undefined,
            appCredentials: row.appCredentials ?? undefined,
        };
    }

    private toDeviceAuthRecord(row: any): DeviceAuthorizationRecord {
        return {
            deviceCode: row.deviceCode,
            userCode: row.userCode,
            ownerName: row.ownerName,
            agentName: row.agentName,
            displayName: row.displayName ?? undefined,
            description: row.description ?? undefined,
            status: row.status,
            scopes: row.scopes?.length ? row.scopes : undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
            lastPolledAt: row.lastPolledAt ? (row.lastPolledAt instanceof Date ? row.lastPolledAt.toISOString() : row.lastPolledAt) : undefined,
            pollInterval: row.pollInterval,
            approvedBy: row.approvedBy ?? undefined,
            agentCredentials: row.agentCredentials ?? undefined,
            mode: row.mode ?? undefined,
        };
    }

    // ── OAuth 2.1 Persistent State ──

    async createOAuthClient(client: OAuthClientRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.oAuthClient.create({
            data: {
                clientId: client.clientId,
                clientSecret: client.clientSecret,
                clientName: client.clientName,
                redirectUris: client.redirectUris,
                createdAt: new Date(client.createdAt),
            },
        });
    }

    async getOAuthClient(clientId: string): Promise<OAuthClientRecord | null> {
        this.ensureReady();
        const row = await this.prisma.oAuthClient.findUnique({ where: { clientId } });
        if (!row) return null;
        return {
            clientId: row.clientId,
            clientSecret: row.clientSecret,
            clientName: row.clientName,
            redirectUris: row.redirectUris,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    }

    async deleteOAuthClient(clientId: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.oAuthRefreshToken.deleteMany({ where: { clientId } });
            await this.prisma.oAuthApproval.deleteMany({ where: { clientId } });
            await this.prisma.oAuthClient.delete({ where: { clientId } });
            return true;
        } catch { return false; }
    }

    async listOAuthClients(): Promise<OAuthClientRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.oAuthClient.findMany({ orderBy: { createdAt: 'desc' } });
        return rows.map((row: any) => ({
            clientId: row.clientId,
            clientSecret: row.clientSecret,
            clientName: row.clientName,
            redirectUris: row.redirectUris,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        }));
    }

    async createOAuthRefreshToken(token: OAuthRefreshTokenRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.oAuthRefreshToken.create({
            data: {
                tokenHash: token.tokenHash,
                clientId: token.clientId,
                gaii: token.gaii,
                owner: token.owner,
                roles: token.roles,
                createdAt: new Date(token.createdAt),
            },
        });
    }

    async getOAuthRefreshToken(tokenHash: string): Promise<OAuthRefreshTokenRecord | null> {
        this.ensureReady();
        const row = await this.prisma.oAuthRefreshToken.findUnique({ where: { tokenHash } });
        if (!row) return null;
        return {
            tokenHash: row.tokenHash,
            clientId: row.clientId,
            gaii: row.gaii,
            owner: row.owner,
            roles: row.roles,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    }

    async deleteOAuthRefreshToken(tokenHash: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.oAuthRefreshToken.delete({ where: { tokenHash } });
            return true;
        } catch { return false; }
    }

    async deleteOAuthRefreshTokensByClient(clientId: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.oAuthRefreshToken.deleteMany({ where: { clientId } });
        return result.count;
    }

    async deleteOAuthRefreshTokensByGaii(gaii: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.oAuthRefreshToken.deleteMany({ where: { gaii } });
        return result.count;
    }

    async createOAuthApproval(approval: OAuthApprovalRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.oAuthApproval.upsert({
            where: { clientId_gaii: { clientId: approval.clientId, gaii: approval.gaii } },
            update: { scope: approval.scope, approvedAt: new Date(approval.approvedAt) },
            create: {
                clientId: approval.clientId,
                gaii: approval.gaii,
                owner: approval.owner,
                scope: approval.scope,
                approvedAt: new Date(approval.approvedAt),
            },
        });
    }

    async getOAuthApproval(clientId: string, gaii: string): Promise<OAuthApprovalRecord | null> {
        this.ensureReady();
        const row = await this.prisma.oAuthApproval.findUnique({ where: { clientId_gaii: { clientId, gaii } } });
        if (!row) return null;
        return {
            clientId: row.clientId,
            gaii: row.gaii,
            owner: row.owner,
            scope: row.scope,
            approvedAt: row.approvedAt instanceof Date ? row.approvedAt.toISOString() : row.approvedAt,
        };
    }

    async deleteOAuthApproval(clientId: string, gaii: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.oAuthApproval.delete({ where: { clientId_gaii: { clientId, gaii } } });
            return true;
        } catch { return false; }
    }

    async deleteOAuthApprovalsByClient(clientId: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.oAuthApproval.deleteMany({ where: { clientId } });
        return result.count;
    }

    async deleteOAuthApprovalsByGaii(gaii: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.oAuthApproval.deleteMany({ where: { gaii } });
        return result.count;
    }

    async listOAuthApprovalsByOwner(owner: string): Promise<OAuthApprovalRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.oAuthApproval.findMany({ where: { owner }, orderBy: { approvedAt: 'desc' } });
        return rows.map((row: any) => ({
            clientId: row.clientId,
            gaii: row.gaii,
            owner: row.owner,
            scope: row.scope,
            approvedAt: row.approvedAt instanceof Date ? row.approvedAt.toISOString() : row.approvedAt,
        }));
    }

    // ── System Prompts ────────────────────────────────────────────────

    async listSystemPrompts(opts?: { group?: string }): Promise<SystemPromptRecord[]> {
        this.ensureReady();
        const where = opts?.group ? { group: opts.group } : {};
        const rows = await this.prisma.systemPrompt.findMany({
            where,
            orderBy: [{ group: 'asc' }, { name: 'asc' }],
        });
        return rows.map((r: any) => this.toSystemPromptRecord(r));
    }

    async getSystemPrompt(id: string): Promise<SystemPromptRecord | null> {
        this.ensureReady();
        const row = await this.prisma.systemPrompt.findUnique({ where: { id } });
        return row ? this.toSystemPromptRecord(row) : null;
    }

    async upsertSystemPrompt(record: SystemPromptRecord): Promise<SystemPromptRecord> {
        this.ensureReady();
        const fields = {
            group: record.group,
            name: record.name,
            description: record.description,
            content: record.content,
            locales: record.locales ?? undefined,
            active: record.active,
            variables: record.variables,
            usedIn: record.usedIn,
            version: record.version,
            updatedAt: new Date(record.updatedAt),
            updatedBy: record.updatedBy,
        };
        await this.prisma.systemPrompt.upsert({
            where: { id: record.id },
            create: { id: record.id, ...fields },
            update: fields,
        });
        return record;
    }

    async getSystemPromptVersions(promptId: string): Promise<SystemPromptVersionRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.systemPromptVersion.findMany({
            where: { promptId },
            orderBy: { version: 'desc' },
        });
        return rows.map((r: any) => this.toSystemPromptVersionRecord(r));
    }

    async getSystemPromptVersion(promptId: string, version: number): Promise<SystemPromptVersionRecord | null> {
        this.ensureReady();
        const row = await this.prisma.systemPromptVersion.findUnique({
            where: { promptId_version: { promptId, version } },
        });
        return row ? this.toSystemPromptVersionRecord(row) : null;
    }

    async createSystemPromptVersion(record: SystemPromptVersionRecord): Promise<SystemPromptVersionRecord> {
        this.ensureReady();
        await this.prisma.systemPromptVersion.create({
            data: {
                promptId: record.promptId,
                version: record.version,
                content: record.content,
                locales: record.locales ?? undefined,
                changedBy: record.changedBy,
                changedAt: new Date(record.changedAt),
                changeNote: record.changeNote ?? null,
            },
        });
        return record;
    }

    async pruneSystemPromptVersions(promptId: string, keepCount: number): Promise<number> {
        this.ensureReady();
        // Get versions to keep
        const keep = await this.prisma.systemPromptVersion.findMany({
            where: { promptId },
            orderBy: { version: 'desc' },
            take: keepCount,
            select: { version: true },
        });
        const keepVersions = keep.map((r: any) => r.version);
        if (keepVersions.length === 0) return 0;
        const result = await this.prisma.systemPromptVersion.deleteMany({
            where: { promptId, version: { notIn: keepVersions } },
        });
        return result.count;
    }

    async deleteAllSystemPrompts(): Promise<void> {
        this.ensureReady();
        await this.prisma.systemPromptVersion.deleteMany({});
        await this.prisma.systemPrompt.deleteMany({});
    }

    private toSystemPromptRecord(row: any): SystemPromptRecord {
        return {
            id: row.id,
            group: row.group,
            name: row.name,
            description: row.description ?? '',
            content: row.content,
            locales: row.locales && Object.keys(row.locales).length > 0 ? row.locales : undefined,
            active: row.active,
            variables: row.variables ?? [],
            usedIn: row.usedIn ?? [],
            version: row.version,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
            updatedBy: row.updatedBy,
        };
    }

    private toSystemPromptVersionRecord(row: any): SystemPromptVersionRecord {
        return {
            promptId: row.promptId,
            version: row.version,
            content: row.content,
            locales: row.locales && Object.keys(row.locales).length > 0 ? row.locales : undefined,
            changedBy: row.changedBy,
            changedAt: row.changedAt instanceof Date ? row.changedAt.toISOString() : row.changedAt,
            changeNote: row.changeNote ?? undefined,
        };
    }

    // ── Package Repository ─────────────────────────────────────────────

    async createPackage(record: PackageRecord): Promise<PackageRecord> {
        this.ensureReady();
        try {
            const row = await this.prisma.package.create({
                data: {
                    packageGroupId: record.packageGroupId,
                    name: record.name,
                    author: record.author,
                    authorGhii: record.authorGhii,
                    version: record.version,
                    changelog: record.changelog,
                    description: record.description,
                    category: record.category,
                    tags: record.tags,
                    visibility: record.visibility,
                    status: record.status,
                    components: record.components as any,
                    manifest: record.manifest,
                    createdAt: new Date(record.createdAt),
                    updatedAt: new Date(record.updatedAt),
                },
            });
            return this.toPackageRecord(row);
        } catch (e: any) {
            if (e.code === 'P2002') {
                throw new Error('PACKAGE_EXISTS', { cause: e });
            }
            throw e;
        }
    }

    async getPackage(id: string): Promise<PackageRecord | null> {
        this.ensureReady();
        const row = await this.prisma.package.findUnique({ where: { id } });
        return row ? this.toPackageRecord(row) : null;
    }

    async getPackageByGroupAndVersion(groupId: string, version: string): Promise<PackageRecord | null> {
        this.ensureReady();
        const row = await this.prisma.package.findFirst({ where: { packageGroupId: groupId, version } });
        return row ? this.toPackageRecord(row) : null;
    }

    async getLatestPublished(groupId: string): Promise<PackageRecord | null> {
        this.ensureReady();
        const row = await this.prisma.package.findFirst({
            where: { packageGroupId: groupId, status: 'published' },
            orderBy: { version: 'desc' },
        });
        return row ? this.toPackageRecord(row) : null;
    }

    async listPackages(filter: PackageFilter): Promise<{ packages: PackageRecord[]; total: number }> {
        this.ensureReady();
        const where: any = {};
        if (filter.author) where.author = filter.author;
        if (filter.category) where.category = filter.category;
        if (filter.status) where.status = filter.status;
        if (filter.visibility) where.visibility = filter.visibility;
        if (filter.search) {
            where.OR = [
                { name: { contains: filter.search, mode: 'insensitive' } },
                { description: { contains: filter.search, mode: 'insensitive' } },
            ];
        }
        const [rows, total] = await Promise.all([
            this.prisma.package.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: filter.offset ?? 0,
                take: filter.limit ?? 50,
            }),
            this.prisma.package.count({ where }),
        ]);
        return { packages: rows.map((r: any) => this.toPackageRecord(r)), total };
    }

    async listVersions(groupId: string, limit?: number, offset?: number): Promise<{ versions: PackageRecord[]; total: number }> {
        this.ensureReady();
        const where = { packageGroupId: groupId };
        const [rows, total] = await Promise.all([
            this.prisma.package.findMany({
                where,
                orderBy: { version: 'desc' },
                skip: offset ?? 0,
                take: limit ?? 50,
            }),
            this.prisma.package.count({ where }),
        ]);
        return { versions: rows.map((r: any) => this.toPackageRecord(r)), total };
    }

    async updatePackage(id: string, updates: Partial<PackageRecord>): Promise<PackageRecord | null> {
        this.ensureReady();
        const data: any = {};
        if (updates.name !== undefined) data.name = updates.name;
        if (updates.description !== undefined) data.description = updates.description;
        if (updates.changelog !== undefined) data.changelog = updates.changelog;
        if (updates.category !== undefined) data.category = updates.category;
        if (updates.tags !== undefined) data.tags = updates.tags;
        if (updates.visibility !== undefined) data.visibility = updates.visibility;
        if (updates.status !== undefined) data.status = updates.status;
        if (updates.components !== undefined) data.components = updates.components as any;
        if (updates.manifest !== undefined) data.manifest = updates.manifest;
        data.updatedAt = new Date();
        try {
            const row = await this.prisma.package.update({ where: { id }, data });
            return this.toPackageRecord(row);
        } catch {
            return null;
        }
    }

    async archivePackage(id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.package.update({ where: { id }, data: { status: 'archived', updatedAt: new Date() } });
            return true;
        } catch {
            return false;
        }
    }

    async archivePackageGroup(groupId: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.package.updateMany({
            where: { packageGroupId: groupId, status: { not: 'archived' } },
            data: { status: 'archived', updatedAt: new Date() },
        });
        return result.count;
    }

    private toPackageRecord(row: any): PackageRecord {
        return {
            id: row.id,
            packageGroupId: row.packageGroupId,
            name: row.name,
            author: row.author,
            authorGhii: row.authorGhii,
            version: row.version,
            changelog: row.changelog ?? '',
            description: row.description ?? '',
            category: row.category ?? 'other',
            tags: row.tags ?? [],
            visibility: row.visibility ?? 'private',
            status: row.status ?? 'draft',
            components: (row.components ?? []) as PackageComponent[],
            manifest: row.manifest ?? '',
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
    }

    // ── Template Listing Repository ────────────────────────────────────

    async createTemplateListing(record: TemplateListingRecord): Promise<TemplateListingRecord> {
        this.ensureReady();
        const row = await this.prisma.templateListing.create({
            data: {
                packageGroupId: record.packageGroupId,
                packageName: record.packageName,
                packageAuthor: record.packageAuthor,
                publishedBy: record.publishedBy,
                publishedByGhii: record.publishedByGhii,
                title: record.title,
                description: record.description,
                screenshots: record.screenshots,
                category: record.category,
                tags: record.tags,
                featured: record.featured,
                installCount: record.installCount,
                rating: record.rating,
                reviewCount: record.reviewCount,
                status: record.status,
                createdAt: new Date(record.createdAt),
                updatedAt: new Date(record.updatedAt),
                ...(record.rejectionReason !== undefined ? { rejectionReason: record.rejectionReason } : {}),
                ...(record.reviewedBy !== undefined ? { reviewedBy: record.reviewedBy } : {}),
                ...(record.reviewedAt !== undefined ? { reviewedAt: new Date(record.reviewedAt) } : {}),
                ...(record.reviewComment !== undefined ? { reviewComment: record.reviewComment } : {}),
                ...(record.proposedAt !== undefined ? { proposedAt: new Date(record.proposedAt) } : {}),
                ...(record.proposedBy !== undefined ? { proposedBy: record.proposedBy } : {}),
            },
        });
        return this.toTemplateListingRecord(row);
    }

    async getTemplateListing(id: string): Promise<TemplateListingRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.templateListing.findUnique({ where: { id } });
            return row ? this.toTemplateListingRecord(row) : null;
        } catch {
            return null; // Invalid ObjectId format → not found
        }
    }

    async getListingByPackage(packageGroupId: string): Promise<TemplateListingRecord | null> {
        this.ensureReady();
        const row = await this.prisma.templateListing.findUnique({ where: { packageGroupId } });
        return row ? this.toTemplateListingRecord(row) : null;
    }

    async listTemplateListings(filter: TemplateFilter): Promise<{ listings: TemplateListingRecord[]; total: number }> {
        this.ensureReady();
        const where: any = {};
        if (filter.category) where.category = filter.category;
        if (filter.status) where.status = filter.status;
        if (filter.featured !== undefined) where.featured = filter.featured;
        if (filter.tags && filter.tags.length > 0) where.tags = { hasSome: filter.tags };
        if (filter.search) {
            where.OR = [
                { title: { contains: filter.search, mode: 'insensitive' } },
                { description: { contains: filter.search, mode: 'insensitive' } },
            ];
        }
        let orderBy: any = { createdAt: 'desc' };
        if (filter.sort === 'rating') orderBy = { rating: 'desc' };
        else if (filter.sort === 'installs') orderBy = { installCount: 'desc' };
        else if (filter.sort === 'newest') orderBy = { createdAt: 'desc' };

        const [rows, total] = await Promise.all([
            this.prisma.templateListing.findMany({
                where,
                orderBy,
                skip: filter.offset ?? 0,
                take: filter.limit ?? 50,
            }),
            this.prisma.templateListing.count({ where }),
        ]);
        return { listings: rows.map((r: any) => this.toTemplateListingRecord(r)), total };
    }

    async updateTemplateListing(id: string, updates: Partial<TemplateListingRecord>): Promise<TemplateListingRecord | null> {
        this.ensureReady();
        const data: any = {};
        if (updates.title !== undefined) data.title = updates.title;
        if (updates.description !== undefined) data.description = updates.description;
        if (updates.screenshots !== undefined) data.screenshots = updates.screenshots;
        if (updates.category !== undefined) data.category = updates.category;
        if (updates.tags !== undefined) data.tags = updates.tags;
        if (updates.featured !== undefined) data.featured = updates.featured;
        if (updates.status !== undefined) data.status = updates.status;
        if (updates.rejectionReason !== undefined) data.rejectionReason = updates.rejectionReason;
        if (updates.reviewedBy !== undefined) data.reviewedBy = updates.reviewedBy;
        if (updates.reviewedAt !== undefined) data.reviewedAt = new Date(updates.reviewedAt);
        if (updates.reviewComment !== undefined) data.reviewComment = updates.reviewComment;
        if (updates.proposedAt !== undefined) data.proposedAt = new Date(updates.proposedAt);
        if (updates.proposedBy !== undefined) data.proposedBy = updates.proposedBy;
        data.updatedAt = new Date();
        try {
            const row = await this.prisma.templateListing.update({ where: { id }, data });
            return this.toTemplateListingRecord(row);
        } catch {
            return null;
        }
    }

    async deleteTemplateListing(id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.templateReview.deleteMany({ where: { listingId: id } });
            await this.prisma.templateDiscussion.deleteMany({ where: { listingId: id } });
            await this.prisma.templateListing.delete({ where: { id } });
            return true;
        } catch {
            return false;
        }
    }

    async incrementInstallCount(listingId: string): Promise<void> {
        this.ensureReady();
        await this.prisma.templateListing.update({
            where: { id: listingId },
            data: { installCount: { increment: 1 } },
        });
    }

    async listPendingTemplates(limit = 20, offset = 0): Promise<TemplateListingRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.templateListing.findMany({
            where: { status: 'pending_review' },
            orderBy: { createdAt: 'asc' },
            skip: offset,
            take: limit,
        });
        return rows.map((r: any) => this.toTemplateListingRecord(r));
    }

    // ── Reviews ──

    async addReview(review: TemplateReview): Promise<TemplateReview> {
        this.ensureReady();
        const row = await this.prisma.templateReview.upsert({
            where: { listingId_authorGhii: { listingId: review.listingId, authorGhii: review.authorGhii } },
            create: {
                listingId: review.listingId,
                authorGhii: review.authorGhii,
                authorName: review.authorName,
                rating: review.rating,
                comment: review.comment,
                createdAt: new Date(review.createdAt),
            },
            update: {
                authorName: review.authorName,
                rating: review.rating,
                comment: review.comment,
            },
        });
        await this.recalculateRating(review.listingId);
        return this.toTemplateReview(row);
    }

    async getReviewsByListing(listingId: string, limit?: number, offset?: number): Promise<{ reviews: TemplateReview[]; total: number }> {
        this.ensureReady();
        const where = { listingId };
        const [rows, total] = await Promise.all([
            this.prisma.templateReview.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: offset ?? 0,
                take: limit ?? 50,
            }),
            this.prisma.templateReview.count({ where }),
        ]);
        return { reviews: rows.map((r: any) => this.toTemplateReview(r)), total };
    }

    async getReviewByAuthor(listingId: string, authorGhii: string): Promise<TemplateReview | null> {
        this.ensureReady();
        const row = await this.prisma.templateReview.findUnique({
            where: { listingId_authorGhii: { listingId, authorGhii } },
        });
        return row ? this.toTemplateReview(row) : null;
    }

    async updateReview(id: string, updates: Partial<TemplateReview>): Promise<TemplateReview | null> {
        this.ensureReady();
        const data: any = {};
        if (updates.rating !== undefined) data.rating = updates.rating;
        if (updates.comment !== undefined) data.comment = updates.comment;
        if (updates.authorName !== undefined) data.authorName = updates.authorName;
        try {
            const row = await this.prisma.templateReview.update({ where: { id }, data });
            await this.recalculateRating(row.listingId);
            return this.toTemplateReview(row);
        } catch {
            return null;
        }
    }

    async deleteReview(id: string): Promise<boolean> {
        this.ensureReady();
        try {
            const row = await this.prisma.templateReview.findUnique({ where: { id } });
            if (!row) return false;
            await this.prisma.templateReview.delete({ where: { id } });
            await this.recalculateRating(row.listingId);
            return true;
        } catch {
            return false;
        }
    }

    async recalculateRating(listingId: string): Promise<{ rating: number; reviewCount: number }> {
        this.ensureReady();
        const agg = await this.prisma.templateReview.aggregate({
            where: { listingId },
            _avg: { rating: true },
            _count: { rating: true },
        });
        const rating = Math.round((agg._avg.rating ?? 0) * 10) / 10;
        const reviewCount = agg._count.rating ?? 0;
        await this.prisma.templateListing.update({
            where: { id: listingId },
            data: { rating, reviewCount },
        });
        return { rating, reviewCount };
    }

    private toTemplateReview(row: any): TemplateReview {
        return {
            id: row.id,
            listingId: row.listingId,
            authorGhii: row.authorGhii,
            authorName: row.authorName,
            rating: row.rating,
            comment: row.comment ?? '',
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    }

    // ── Discussions ──

    async addDiscussion(discussion: TemplateDiscussion): Promise<TemplateDiscussion> {
        this.ensureReady();
        const row = await this.prisma.templateDiscussion.create({
            data: {
                listingId: discussion.listingId,
                authorGhii: discussion.authorGhii,
                authorName: discussion.authorName,
                message: discussion.message,
                parentId: discussion.parentId ?? null,
                createdAt: new Date(discussion.createdAt),
            },
        });
        return this.toTemplateDiscussion(row);
    }

    async getDiscussionsByListing(listingId: string, limit?: number, offset?: number): Promise<{ discussions: TemplateDiscussion[]; total: number }> {
        this.ensureReady();
        const where = { listingId };
        const [rows, total] = await Promise.all([
            this.prisma.templateDiscussion.findMany({
                where,
                orderBy: { createdAt: 'asc' },
                skip: offset ?? 0,
                take: limit ?? 50,
            }),
            this.prisma.templateDiscussion.count({ where }),
        ]);
        return { discussions: rows.map((r: any) => this.toTemplateDiscussion(r)), total };
    }

    async deleteDiscussion(id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.templateDiscussion.delete({ where: { id } });
            return true;
        } catch {
            return false;
        }
    }

    private toTemplateListingRecord(row: any): TemplateListingRecord {
        return {
            id: row.id,
            packageGroupId: row.packageGroupId,
            packageName: row.packageName,
            packageAuthor: row.packageAuthor,
            publishedBy: row.publishedBy,
            publishedByGhii: row.publishedByGhii,
            title: row.title,
            description: row.description ?? '',
            screenshots: row.screenshots ?? [],
            category: row.category ?? 'other',
            tags: row.tags ?? [],
            featured: row.featured ?? false,
            installCount: row.installCount ?? 0,
            rating: row.rating ?? 0,
            reviewCount: row.reviewCount ?? 0,
            status: row.status ?? 'listed',
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
            ...(row.rejectionReason ? { rejectionReason: row.rejectionReason } : {}),
            ...(row.reviewedBy ? { reviewedBy: row.reviewedBy } : {}),
            ...(row.reviewedAt ? { reviewedAt: row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : row.reviewedAt } : {}),
            ...(row.reviewComment ? { reviewComment: row.reviewComment } : {}),
            ...(row.proposedAt ? { proposedAt: row.proposedAt instanceof Date ? row.proposedAt.toISOString() : row.proposedAt } : {}),
            ...(row.proposedBy ? { proposedBy: row.proposedBy } : {}),
        };
    }

    private toTemplateDiscussion(row: any): TemplateDiscussion {
        return {
            id: row.id,
            listingId: row.listingId,
            authorGhii: row.authorGhii,
            authorName: row.authorName,
            message: row.message,
            parentId: row.parentId ?? undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    }

    // ── Package Instance Repository ────────────────────────────────────

    async createInstance(record: PackageInstanceRecord): Promise<PackageInstanceRecord> {
        this.ensureReady();
        const row = await this.prisma.packageInstance.create({
            data: {
                packageGroupId: record.packageGroupId,
                packageVersion: record.packageVersion,
                packageRecordId: record.packageRecordId,
                owner: record.owner,
                ownerGhii: record.ownerGhii,
                label: record.label,
                installedComponents: record.installedComponents as any,
                status: record.status,
                installedAt: new Date(record.installedAt),
                updatedAt: new Date(record.updatedAt),
            },
        });
        return this.toPackageInstanceRecord(row);
    }

    async getInstance(id: string): Promise<PackageInstanceRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.packageInstance.findUnique({ where: { id } });
            return row ? this.toPackageInstanceRecord(row) : null;
        } catch {
            return null; // Invalid ObjectId format → not found
        }
    }

    async listInstances(filter: InstanceFilter): Promise<{ instances: PackageInstanceRecord[]; total: number }> {
        this.ensureReady();
        const where: any = {};
        if (filter.owner) where.owner = filter.owner;
        if (filter.ownerGhii) where.ownerGhii = filter.ownerGhii;
        if (filter.packageGroupId) where.packageGroupId = filter.packageGroupId;
        if (filter.status) where.status = filter.status;
        const [rows, total] = await Promise.all([
            this.prisma.packageInstance.findMany({
                where,
                orderBy: { installedAt: 'desc' },
                skip: filter.offset ?? 0,
                take: filter.limit ?? 50,
            }),
            this.prisma.packageInstance.count({ where }),
        ]);
        return { instances: rows.map((r: any) => this.toPackageInstanceRecord(r)), total };
    }

    async updateInstance(id: string, updates: Partial<PackageInstanceRecord>): Promise<PackageInstanceRecord | null> {
        this.ensureReady();
        const data: any = {};
        if (updates.label !== undefined) data.label = updates.label;
        if (updates.status !== undefined) data.status = updates.status;
        if (updates.installedComponents !== undefined) data.installedComponents = updates.installedComponents as any;
        if (updates.packageVersion !== undefined) data.packageVersion = updates.packageVersion;
        if (updates.packageRecordId !== undefined) data.packageRecordId = updates.packageRecordId;
        data.updatedAt = new Date();
        try {
            const row = await this.prisma.packageInstance.update({ where: { id }, data });
            return this.toPackageInstanceRecord(row);
        } catch {
            return null;
        }
    }

    async deleteInstance(id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.packageInstance.delete({ where: { id } });
            return true;
        } catch {
            return false;
        }
    }

    async listInstancesByPackage(packageGroupId: string): Promise<{ instances: PackageInstanceRecord[]; total: number }> {
        this.ensureReady();
        const where = { packageGroupId };
        const [rows, total] = await Promise.all([
            this.prisma.packageInstance.findMany({ where, orderBy: { installedAt: 'desc' } }),
            this.prisma.packageInstance.count({ where }),
        ]);
        return { instances: rows.map((r: any) => this.toPackageInstanceRecord(r)), total };
    }

    private toPackageInstanceRecord(row: any): PackageInstanceRecord {
        return {
            id: row.id,
            packageGroupId: row.packageGroupId,
            packageVersion: row.packageVersion,
            packageRecordId: row.packageRecordId,
            owner: row.owner,
            ownerGhii: row.ownerGhii,
            label: row.label ?? '',
            installedComponents: (row.installedComponents ?? []) as InstalledComponent[],
            status: row.status ?? 'installed',
            installedAt: row.installedAt instanceof Date ? row.installedAt.toISOString() : row.installedAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
    }

    // ── Capability Layer ──────────────────────────────────────────────

    private toCapabilityRecord(row: any): CapabilityRecord {
        return {
            id: row.id,
            name: row.name,
            summary: row.summary ?? '',
            ownerGhii: row.ownerGhii,
            visibility: row.visibility ?? 'private',
            scope: 'local',
            status: row.status ?? 'draft',
            rejectionReason: row.rejectionReason ?? null,
            deprecationMessage: row.deprecationMessage ?? null,
            replacedBy: row.replacedBy ?? null,
            source: { type: row.sourceType, ref: row.sourceRef, version: row.sourceVersion ?? '' },
            authRequired: row.authRequired ?? 'registered',
            callable: row.callable ?? false,
            inputSchema: row.inputSchema ?? null,
            outputSchema: row.outputSchema ?? null,
            exports: row.exports ?? null,
            usage: row.usage ?? '',
            whenToUse: row.whenToUse ?? '',
            whenNotToUse: row.whenNotToUse ?? '',
            examples: row.examples ?? [],
            dependencies: row.dependencies ?? [],
            schemaHash: row.schemaHash ?? '',
            webhookUrl: row.webhookUrl ?? null,
            cost: row.cost ?? null,
            trustRequired: row.trustRequired ?? null,
            trust: row.trust ?? { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
            redactedFields: row.redactedFields ?? [],
            operatorOverride: row.operatorOverride ?? null,
            stats: row.stats ?? { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
            tags: row.tags ?? [],
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
    }

    async createCapability(record: CapabilityRecord): Promise<CapabilityRecord> {
        this.ensureReady();
        const row = await this.prisma.capability.create({
            data: {
                id: record.id, name: record.name, summary: record.summary,
                ownerGhii: record.ownerGhii, visibility: record.visibility, scope: record.scope,
                status: record.status, rejectionReason: record.rejectionReason,
                deprecationMessage: record.deprecationMessage, replacedBy: record.replacedBy,
                sourceType: record.source.type, sourceRef: record.source.ref, sourceVersion: record.source.version,
                authRequired: record.authRequired, callable: record.callable,
                inputSchema: record.inputSchema ?? undefined, outputSchema: record.outputSchema ?? undefined,
                exports: record.exports ?? undefined, usage: record.usage,
                whenToUse: record.whenToUse, whenNotToUse: record.whenNotToUse,
                examples: record.examples, dependencies: record.dependencies,
                schemaHash: record.schemaHash, webhookUrl: record.webhookUrl,
                cost: record.cost ?? undefined, trustRequired: record.trustRequired,
                trust: record.trust as any, redactedFields: record.redactedFields,
                operatorOverride: record.operatorOverride ?? undefined,
                stats: record.stats as any, tags: record.tags,
            },
        });
        return this.toCapabilityRecord(row);
    }

    async getCapability(id: string): Promise<CapabilityRecord | null> {
        this.ensureReady();
        const row = await this.prisma.capability.findUnique({ where: { id } });
        return row ? this.toCapabilityRecord(row) : null;
    }

    async updateCapability(id: string, updates: Partial<CapabilityRecord>): Promise<CapabilityRecord | null> {
        this.ensureReady();
        const data: any = { ...updates };
        if (updates.source) {
            data.sourceType = updates.source.type;
            data.sourceRef = updates.source.ref;
            data.sourceVersion = updates.source.version;
            delete data.source;
        }
        if (updates.trust) { data.trust = updates.trust; }
        if (updates.stats) { data.stats = updates.stats; }
        if (updates.operatorOverride !== undefined) { data.operatorOverride = updates.operatorOverride; }
        try {
            const row = await this.prisma.capability.update({ where: { id }, data });
            return this.toCapabilityRecord(row);
        } catch { return null; }
    }

    async deleteCapability(id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.capability.delete({ where: { id } }); return true; } catch { return false; }
    }

    async listCapabilities(filters: CapabilityFilter): Promise<{ capabilities: CapabilityRecord[]; total: number }> {
        this.ensureReady();
        const where: any = {};
        if (filters.ownerGhii) where.ownerGhii = filters.ownerGhii;
        if (filters.visibility) where.visibility = filters.visibility;
        if (filters.status) where.status = filters.status;
        if (filters.sourceType) where.sourceType = filters.sourceType;
        if (filters.authRequired) where.authRequired = filters.authRequired;
        if (filters.callable !== undefined) where.callable = filters.callable;
        if (filters.search) {
            where.OR = [
                { name: { contains: filters.search, mode: 'insensitive' } },
                { summary: { contains: filters.search, mode: 'insensitive' } },
            ];
        }
        // tags filter done in JS since tags is a Json field
        const page = filters.page || 1;
        const perPage = filters.perPage || 20;
        const [rows, total] = await Promise.all([
            this.prisma.capability.findMany({
                where, orderBy: { updatedAt: 'desc' },
                skip: (page - 1) * perPage, take: perPage,
            }),
            this.prisma.capability.count({ where }),
        ]);
        let caps = rows.map((r: any) => this.toCapabilityRecord(r));
        if (filters.tags?.length) {
            caps = caps.filter((c: CapabilityRecord) => filters.tags!.some(t => c.tags.includes(t)));
        }
        return { capabilities: caps, total };
    }

    async listCapabilitiesByOwner(ownerGhii: string): Promise<CapabilityRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.capability.findMany({ where: { ownerGhii }, orderBy: { updatedAt: 'desc' } });
        return rows.map((r: any) => this.toCapabilityRecord(r));
    }

    async getCapabilityBySourceRef(sourceRef: string): Promise<CapabilityRecord | null> {
        this.ensureReady();
        const row = await this.prisma.capability.findFirst({ where: { sourceRef } });
        return row ? this.toCapabilityRecord(row) : null;
    }

    async listCapabilitiesBySourceType(sourceType: string): Promise<CapabilityRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.capability.findMany({ where: { sourceType } });
        return rows.map((r: any) => this.toCapabilityRecord(r));
    }

    async incrementCapabilityStats(id: string, delta: { success: number; error: number; totalMs: number; lastError?: string }): Promise<void> {
        this.ensureReady();
        const cap = await this.getCapability(id);
        if (!cap) return;
        const s = cap.stats;
        const newTotal = s.totalInvocations + delta.success + delta.error;
        const totalMs = (s.avgResponseMs * s.totalInvocations) + delta.totalMs;
        const updated = {
            totalInvocations: newTotal,
            successCount: s.successCount + delta.success,
            errorCount: s.errorCount + delta.error,
            lastInvokedAt: new Date().toISOString(),
            avgResponseMs: newTotal > 0 ? Math.round(totalMs / newTotal) : 0,
            lastError: delta.lastError ?? s.lastError,
        };
        await this.prisma.capability.update({ where: { id }, data: { stats: updated } });
    }

    async addCapabilityLog(entry: CapabilityLogEntry): Promise<void> {
        this.ensureReady();
        await this.prisma.capabilityLog.create({
            data: {
                capabilityId: entry.capabilityId, callerGhii: entry.callerGhii,
                input: entry.input as any, status: entry.status,
                durationMs: entry.durationMs, error: entry.error,
                timestamp: new Date(entry.timestamp),
            },
        });
    }

    async listCapabilityLogs(capabilityId: string, filters: { status?: 'success' | 'error'; page?: number; perPage?: number }): Promise<{ logs: CapabilityLogEntry[]; total: number }> {
        this.ensureReady();
        const where: any = { capabilityId };
        if (filters.status) where.status = filters.status;
        const page = filters.page || 1;
        const perPage = filters.perPage || 50;
        const [rows, total] = await Promise.all([
            this.prisma.capabilityLog.findMany({
                where, orderBy: { timestamp: 'desc' },
                skip: (page - 1) * perPage, take: perPage,
            }),
            this.prisma.capabilityLog.count({ where }),
        ]);
        const logs: CapabilityLogEntry[] = rows.map((r: any) => ({
            id: r.id,
            capabilityId: r.capabilityId,
            callerGhii: r.callerGhii,
            input: r.input ?? {},
            status: r.status,
            durationMs: r.durationMs,
            error: r.error ?? null,
            timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
        }));
        return { logs, total };
    }

    async deleteCapabilityLogsBefore(before: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.capabilityLog.deleteMany({ where: { timestamp: { lt: new Date(before) } } });
        return result.count;
    }

    async setCapabilityOverride(id: string, override: CapabilityOverride | null): Promise<void> {
        this.ensureReady();
        await this.prisma.capability.update({ where: { id }, data: { operatorOverride: override ?? undefined } });
    }

    async setCapabilityTrust(id: string, trustUpdates: Partial<CapabilityTrust>): Promise<void> {
        const cap = await this.getCapability(id);
        if (!cap) return;
        const merged = { ...cap.trust, ...trustUpdates };
        await this.prisma.capability.update({ where: { id }, data: { trust: merged as any } });
    }

    async incrementVouchCount(id: string): Promise<void> {
        const cap = await this.getCapability(id);
        if (!cap) return;
        const trust = { ...cap.trust, vouchCount: cap.trust.vouchCount + 1 };
        await this.prisma.capability.update({ where: { id }, data: { trust: trust as any } });
    }

    async decrementVouchCount(id: string): Promise<void> {
        const cap = await this.getCapability(id);
        if (!cap) return;
        const trust = { ...cap.trust, vouchCount: Math.max(0, cap.trust.vouchCount - 1) };
        await this.prisma.capability.update({ where: { id }, data: { trust: trust as any } });
    }

    // ── Stats Persistence ──

    async flushStats(counters: Record<string, number>): Promise<void> {
        const ops = Object.entries(counters).map(([key, value]) =>
            this.prisma.statsCounter.upsert({
                where: { id: key },
                create: { id: key, value },
                update: { value },
            })
        );
        await Promise.all(ops);
    }

    async loadStats(): Promise<Record<string, number>> {
        const rows = await this.prisma.statsCounter.findMany();
        const result: Record<string, number> = {};
        for (const row of rows) {
            result[row.id] = row.value;
        }
        return result;
    }

    async flushDailyHistory(history: Record<string, Record<string, number>>): Promise<void> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const cutoffStr = cutoff.toISOString().split('T')[0];

        const ops: Promise<unknown>[] = [];
        for (const [date, counters] of Object.entries(history)) {
            for (const [key, value] of Object.entries(counters)) {
                ops.push(
                    this.prisma.statsDailyHistory.upsert({
                        where: { date_key: { date, key } },
                        create: { date, key, value },
                        update: { value },
                    })
                );
            }
        }
        ops.push(
            this.prisma.statsDailyHistory.deleteMany({ where: { date: { lt: cutoffStr } } })
        );
        await Promise.all(ops);
    }

    async loadDailyHistory(): Promise<Record<string, Record<string, number>>> {
        const rows = await this.prisma.statsDailyHistory.findMany({ orderBy: { date: 'asc' } });
        const result: Record<string, Record<string, number>> = {};
        for (const row of rows) {
            if (!result[row.date]) result[row.date] = {};
            result[row.date][row.key] = row.value;
        }
        return result;
    }

    // ── Agent Tasks ──

    private toTaskRecord(row: any): AgentTaskRecord {
        return {
            id: row.id,
            agentGaii: row.agentGaii,
            ownerGaii: row.ownerGaii,
            title: row.title,
            description: row.description,
            scope: row.scope as AgentTaskRecord['scope'],
            rules: row.rules as string[],
            verification: row.verification as AgentTaskRecord['verification'],
            resources: row.resources as AgentTaskRecord['resources'] ?? undefined,
            todos: row.todos as AgentTaskRecord['todos'],
            status: row.status as AgentTaskRecord['status'],
            parentTaskId: row.parentTaskId ?? undefined,
            workTrackingCode: row.workTrackingCode ?? undefined,
            telemetry: row.telemetry as AgentTaskRecord['telemetry'] ?? undefined,
            lastEventAt: row.lastEventAt ? (row.lastEventAt instanceof Date ? row.lastEventAt.toISOString() : row.lastEventAt) : undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
            completedAt: row.completedAt ? (row.completedAt instanceof Date ? row.completedAt.toISOString() : row.completedAt) : undefined,
            deliverableKey: row.deliverableKey ?? undefined,
            rating: row.rating as AgentTaskRecord['rating'] ?? undefined,
            triage: (row.triage ?? undefined) as AgentTaskRecord['triage'],
            automation: (row.automation ?? undefined) as AgentTaskRecord['automation'],
        };
    }

    private toTaskEventRecord(row: any): AgentTaskEventRecord {
        return {
            id: row.id,
            taskId: row.taskId,
            type: row.type as AgentTaskEventRecord['type'],
            message: row.message,
            details: row.details as Record<string, unknown> | undefined ?? undefined,
            timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
        };
    }

    async createAgentTask(record: AgentTaskRecord): Promise<AgentTaskRecord> {
        this.ensureReady();
        await this.prisma.agentTask.create({
            data: {
                id: record.id,
                agentGaii: record.agentGaii,
                ownerGaii: record.ownerGaii,
                title: record.title,
                description: record.description,
                scope: record.scope as any,
                rules: record.rules as any,
                verification: record.verification as any,
                resources: record.resources as any ?? null,
                todos: record.todos as any,
                status: record.status,
                parentTaskId: record.parentTaskId ?? null,
                workTrackingCode: record.workTrackingCode ?? null,
                telemetry: record.telemetry as any ?? null,
                lastEventAt: record.lastEventAt ? new Date(record.lastEventAt) : null,
                createdAt: new Date(record.createdAt),
                completedAt: record.completedAt ? new Date(record.completedAt) : null,
                deliverableKey: record.deliverableKey ?? null,
                rating: record.rating as any ?? null,
                triage: record.triage ?? null,
                automation: record.automation as any ?? null,
            } as any,
        });
        return record;
    }

    async getAgentTask(id: string): Promise<AgentTaskRecord | null> {
        this.ensureReady();
        const row = await this.prisma.agentTask.findUnique({ where: { id } });
        return row ? this.toTaskRecord(row) : null;
    }

    async listAgentTasks(agentGaii: string, opts?: { status?: string; page?: number; perPage?: number }): Promise<{ tasks: AgentTaskRecord[]; total: number }> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where: any = { agentGaii };
        if (opts?.status) where.status = opts.status;

        const [rows, total] = await Promise.all([
            this.prisma.agentTask.findMany({
                where,
                orderBy: { updatedAt: 'desc' },
                skip: (page - 1) * perPage,
                take: perPage,
            }),
            this.prisma.agentTask.count({ where }),
        ]);
        return { tasks: rows.map((r: any) => this.toTaskRecord(r)), total };
    }

    async listAgentTasksByOwner(ownerGaii: string, opts?: { status?: string; agentGaii?: string; page?: number; perPage?: number }): Promise<{ tasks: AgentTaskRecord[]; total: number }> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where: any = { ownerGaii };
        if (opts?.agentGaii) where.agentGaii = opts.agentGaii;
        if (opts?.status) where.status = opts.status;

        const [rows, total] = await Promise.all([
            this.prisma.agentTask.findMany({
                where,
                orderBy: { updatedAt: 'desc' },
                skip: (page - 1) * perPage,
                take: perPage,
            }),
            this.prisma.agentTask.count({ where }),
        ]);
        return { tasks: rows.map((r: any) => this.toTaskRecord(r)), total };
    }

    async updateAgentTask(id: string, updates: Partial<AgentTaskRecord>): Promise<AgentTaskRecord | null> {
        this.ensureReady();
        const existing = await this.getAgentTask(id);
        if (!existing) return null;

        const merged: AgentTaskRecord = {
            ...existing,
            ...updates,
            id: existing.id,
            agentGaii: existing.agentGaii,
            ownerGaii: existing.ownerGaii,
            createdAt: existing.createdAt,
        };

        try {
            const row = await this.prisma.agentTask.update({
                where: { id },
                data: {
                    title: merged.title,
                    description: merged.description,
                    scope: merged.scope as any,
                    rules: merged.rules as any,
                    verification: merged.verification as any,
                    resources: merged.resources as any ?? null,
                    todos: merged.todos as any,
                    status: merged.status,
                    parentTaskId: merged.parentTaskId ?? null,
                    workTrackingCode: merged.workTrackingCode ?? null,
                    telemetry: merged.telemetry as any ?? null,
                    lastEventAt: merged.lastEventAt ? new Date(merged.lastEventAt) : null,
                    completedAt: merged.completedAt ? new Date(merged.completedAt) : null,
                    deliverableKey: merged.deliverableKey ?? null,
                    rating: merged.rating as any ?? null,
                    triage: merged.triage ?? null,
                    automation: merged.automation as any ?? null,
                } as any,
            });
            return this.toTaskRecord(row);
        } catch { return null; }
    }

    async deleteAgentTask(id: string): Promise<boolean> {
        this.ensureReady();
        try {
            // Any non-active task is deletable; an active (running) task must be
            // cancelled/paused first so we never orphan a live runner. The status
            // guard is also a race safety-net for the route-level check.
            const result = await this.prisma.agentTask.deleteMany({
                where: { id, status: { not: 'active' } },
            });
            if (result.count > 0) {
                await this.prisma.agentTaskEvent.deleteMany({ where: { taskId: id } });
                return true;
            }
            return false;
        } catch { return false; }
    }

    async appendTaskEvent(event: AgentTaskEventRecord): Promise<AgentTaskEventRecord> {
        this.ensureReady();
        const row = await this.prisma.agentTaskEvent.create({
            data: {
                taskId: event.taskId,
                type: event.type,
                message: event.message,
                details: event.details as any ?? null,
                timestamp: new Date(event.timestamp),
            },
        });
        return this.toTaskEventRecord(row);
    }

    async listTaskEvents(taskId: string, opts?: { page?: number; perPage?: number }): Promise<{ events: AgentTaskEventRecord[]; total: number }> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where = { taskId };

        const [rows, total] = await Promise.all([
            this.prisma.agentTaskEvent.findMany({
                where,
                orderBy: { timestamp: 'asc' },
                skip: (page - 1) * perPage,
                take: perPage,
            }),
            this.prisma.agentTaskEvent.count({ where }),
        ]);
        return { events: rows.map((r: any) => this.toTaskEventRecord(r)), total };
    }

    async countTasksByAgent(agentGaii: string): Promise<{ queued: number; active: number; done: number; failed: number }> {
        this.ensureReady();
        const rows = await this.prisma.agentTask.groupBy({
            by: ['status'],
            where: { agentGaii },
            _count: true,
        });
        const counts = { queued: 0, active: 0, done: 0, failed: 0 };
        for (const row of rows) {
            if (row.status in counts) {
                counts[row.status as keyof typeof counts] = row._count;
            }
        }
        return counts;
    }

    async findStalledTasks(thresholdMinutes: number): Promise<AgentTaskRecord[]> {
        this.ensureReady();
        const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);
        const rows = await this.prisma.agentTask.findMany({
            where: {
                status: 'active',
                lastEventAt: { not: null, lt: threshold },
            },
        });
        return rows.map((r: any) => this.toTaskRecord(r));
    }

    // ── Sharing Groups ──

    private toSharingGroupRecord(row: any): SharingGroupRecord {
        const record: SharingGroupRecord = {
            id: row.id,
            name: row.name,
            ownerGaii: row.ownerGaii,
            members: row.members as SharingGroupRecord['members'],
            defaultPermissions: row.defaultPermissions as SharingGroupRecord['defaultPermissions'],
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
        if (row.description) record.description = row.description;
        return record;
    }

    async createSharingGroup(record: SharingGroupRecord): Promise<SharingGroupRecord> {
        this.ensureReady();
        await this.prisma.sharingGroup.create({
            data: {
                id: record.id,
                name: record.name,
                description: record.description ?? null,
                ownerGaii: record.ownerGaii,
                members: record.members as any,
                defaultPermissions: record.defaultPermissions as any,
                createdAt: new Date(record.createdAt),
            },
        });
        return record;
    }

    async getSharingGroup(id: string): Promise<SharingGroupRecord | null> {
        this.ensureReady();
        const row = await this.prisma.sharingGroup.findUnique({ where: { id } });
        return row ? this.toSharingGroupRecord(row) : null;
    }

    async listSharingGroups(ownerGaii: string): Promise<SharingGroupRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.sharingGroup.findMany({
            where: { ownerGaii },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map((r: any) => this.toSharingGroupRecord(r));
    }

    async listSharingGroupsByMember(identifier: string): Promise<SharingGroupRecord[]> {
        this.ensureReady();
        // MongoDB JSON arrays can't be queried with SQL json_each; filter in memory
        const allGroups = await this.prisma.sharingGroup.findMany();
        return allGroups
            .filter((g: any) => {
                const members = g.members as Array<{ identifier: string }>;
                return Array.isArray(members) && members.some(m => m.identifier === identifier);
            })
            .map((r: any) => this.toSharingGroupRecord(r));
    }

    async updateSharingGroup(id: string, updates: Partial<SharingGroupRecord>): Promise<SharingGroupRecord | null> {
        this.ensureReady();
        const existing = await this.getSharingGroup(id);
        if (!existing) return null;

        const merged: SharingGroupRecord = {
            ...existing,
            ...updates,
            id: existing.id,
            ownerGaii: existing.ownerGaii,
            createdAt: existing.createdAt,
        };

        try {
            const row = await this.prisma.sharingGroup.update({
                where: { id },
                data: {
                    name: merged.name,
                    description: merged.description ?? null,
                    members: merged.members as any,
                    defaultPermissions: merged.defaultPermissions as any,
                },
            });
            return this.toSharingGroupRecord(row);
        } catch { return null; }
    }

    async deleteSharingGroup(id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.sharingGroup.delete({ where: { id } });
            return true;
        } catch { return false; }
    }

    async countEntriesReferencingGroup(groupId: string): Promise<number> {
        this.ensureReady();
        const [memoryCount, fileCount] = await Promise.all([
            this.prisma.memory.count({ where: { groupId } }),
            this.prisma.storageFile.count({ where: { groupId } }),
        ]);
        return memoryCount + fileCount;
    }

    // ── Agent Directives ──

    private toDirectivesRecord(row: any): AgentDirectivesRecord {
        const record: AgentDirectivesRecord = {
            agentGaii: row.agentGaii,
            purpose: row.purpose,
            rules: row.rules as AgentDirectivesRecord['rules'],
            memoryAreas: row.memoryAreas as AgentDirectivesRecord['memoryAreas'],
            resources: row.resources as AgentDirectivesRecord['resources'],
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
        if (row.budgetLimits) record.budgetLimits = row.budgetLimits as AgentDirectivesRecord['budgetLimits'];
        return record;
    }

    private toOwnerDefaultsRecord(row: any): OwnerAgentDefaults {
        const record: OwnerAgentDefaults = {
            ownerGaii: row.ownerGaii,
            rules: row.rules as OwnerAgentDefaults['rules'],
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
        if (row.defaultTokenBudget != null) record.defaultTokenBudget = row.defaultTokenBudget;
        if (row.defaultMemoryAreas) record.defaultMemoryAreas = row.defaultMemoryAreas as OwnerAgentDefaults['defaultMemoryAreas'];
        return record;
    }

    async getAgentDirectives(agentGaii: string): Promise<AgentDirectivesRecord | null> {
        this.ensureReady();
        const row = await this.prisma.agentDirective.findUnique({ where: { agentGaii } });
        return row ? this.toDirectivesRecord(row) : null;
    }

    async upsertAgentDirectives(record: AgentDirectivesRecord): Promise<AgentDirectivesRecord> {
        this.ensureReady();
        const row = await this.prisma.agentDirective.upsert({
            where: { agentGaii: record.agentGaii },
            create: {
                id: `dir-${record.agentGaii}`,
                agentGaii: record.agentGaii,
                purpose: record.purpose,
                rules: record.rules as any,
                memoryAreas: record.memoryAreas as any,
                resources: record.resources as any,
                budgetLimits: record.budgetLimits as any ?? null,
            },
            update: {
                purpose: record.purpose,
                rules: record.rules as any,
                memoryAreas: record.memoryAreas as any,
                resources: record.resources as any,
                budgetLimits: record.budgetLimits as any ?? null,
            },
        });
        return this.toDirectivesRecord(row);
    }

    async deleteAgentDirectives(agentGaii: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.agentDirective.delete({ where: { agentGaii } });
            return true;
        } catch { return false; }
    }

    async getOwnerAgentDefaults(ownerGaii: string): Promise<OwnerAgentDefaults | null> {
        this.ensureReady();
        const row = await this.prisma.ownerAgentDefault.findUnique({ where: { ownerGaii } });
        return row ? this.toOwnerDefaultsRecord(row) : null;
    }

    async upsertOwnerAgentDefaults(record: OwnerAgentDefaults): Promise<OwnerAgentDefaults> {
        this.ensureReady();
        const row = await this.prisma.ownerAgentDefault.upsert({
            where: { ownerGaii: record.ownerGaii },
            create: {
                id: `owd-${record.ownerGaii}`,
                ownerGaii: record.ownerGaii,
                rules: record.rules as any,
                defaultTokenBudget: record.defaultTokenBudget ?? null,
                defaultMemoryAreas: record.defaultMemoryAreas as any ?? [],
            },
            update: {
                rules: record.rules as any,
                defaultTokenBudget: record.defaultTokenBudget ?? null,
                defaultMemoryAreas: record.defaultMemoryAreas as any ?? [],
            },
        });
        return this.toOwnerDefaultsRecord(row);
    }

    // ── Agent Activity ──

    private toActivityRecord(row: any): AgentActivityRecord {
        return {
            agentGaii: row.agentGaii,
            date: row.date,
            hour: row.hour,
            metric: row.metric,
            value: row.value,
        };
    }

    async recordActivity(record: AgentActivityRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.agentActivity.upsert({
            where: {
                agentGaii_date_hour_metric: {
                    agentGaii: record.agentGaii,
                    date: record.date,
                    hour: record.hour,
                    metric: record.metric,
                },
            },
            create: {
                agentGaii: record.agentGaii,
                date: record.date,
                hour: record.hour,
                metric: record.metric,
                value: record.value,
            },
            update: {
                value: { increment: record.value },
            },
        });
    }

    async getActivityHistory(agentGaii: string, opts?: { days?: number; granularity?: 'daily' | 'hourly' }): Promise<AgentActivityRecord[]> {
        this.ensureReady();
        const days = opts?.days ?? 30;
        const granularity = opts?.granularity ?? 'daily';
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().split('T')[0];

        if (granularity === 'daily') {
            const rows = await this.prisma.agentActivity.groupBy({
                by: ['agentGaii', 'date', 'metric'],
                where: { agentGaii, date: { gte: cutoffStr } },
                _sum: { value: true },
                orderBy: { date: 'asc' },
            });
            return rows.map((r: any) => ({
                agentGaii: r.agentGaii,
                date: r.date,
                hour: 0,
                metric: r.metric,
                value: r._sum.value ?? 0,
            }));
        }

        // hourly granularity
        const rows = await this.prisma.agentActivity.findMany({
            where: { agentGaii, date: { gte: cutoffStr } },
            orderBy: [{ date: 'asc' }, { hour: 'asc' }],
        });
        return rows.map((r: any) => this.toActivityRecord(r));
    }

    // ── Agent Messages ──

    private toMessageRecord(row: any): AgentMessageRecord {
        const record: AgentMessageRecord = {
            id: row.id,
            agentGaii: row.agentGaii,
            threadId: row.threadId,
            direction: row.direction as AgentMessageRecord['direction'],
            senderGaii: row.senderGaii,
            content: row.content,
            status: row.status as AgentMessageRecord['status'],
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
        if (row.linkedTaskId) record.linkedTaskId = row.linkedTaskId;
        if (row.metadata) record.metadata = row.metadata as AgentMessageRecord['metadata'];
        if (row.processedAt) record.processedAt = row.processedAt instanceof Date ? row.processedAt.toISOString() : row.processedAt;
        return record;
    }

    async createMessage(record: AgentMessageRecord): Promise<AgentMessageRecord> {
        this.ensureReady();
        await this.prisma.agentMessage.create({
            data: {
                id: record.id,
                agentGaii: record.agentGaii,
                threadId: record.threadId,
                direction: record.direction,
                senderGaii: record.senderGaii,
                content: record.content,
                status: record.status,
                linkedTaskId: record.linkedTaskId ?? null,
                metadata: record.metadata as any ?? null,
                createdAt: new Date(record.createdAt),
                processedAt: record.processedAt ? new Date(record.processedAt) : null,
            },
        });
        return record;
    }

    async getMessage(id: string): Promise<AgentMessageRecord | null> {
        this.ensureReady();
        const row = await this.prisma.agentMessage.findUnique({ where: { id } });
        return row ? this.toMessageRecord(row) : null;
    }

    async listMessages(agentGaii: string, opts?: { direction?: 'inbound' | 'outbound'; threadId?: string; page?: number; perPage?: number }): Promise<{ messages: AgentMessageRecord[]; total: number }> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where: any = { agentGaii };
        if (opts?.direction) where.direction = opts.direction;
        if (opts?.threadId) where.threadId = opts.threadId;

        const [rows, total] = await Promise.all([
            this.prisma.agentMessage.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * perPage,
                take: perPage,
            }),
            this.prisma.agentMessage.count({ where }),
        ]);
        return { messages: rows.map((r: any) => this.toMessageRecord(r)), total };
    }

    async listPendingMessages(agentGaii: string): Promise<AgentMessageRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.agentMessage.findMany({
            where: { agentGaii, status: 'pending', direction: 'inbound' },
            orderBy: { createdAt: 'asc' },
        });
        return rows.map((r: any) => this.toMessageRecord(r));
    }

    async updateMessageStatus(id: string, status: string, processedAt?: string): Promise<AgentMessageRecord | null> {
        this.ensureReady();
        try {
            const data: any = { status };
            if (processedAt) data.processedAt = new Date(processedAt);
            const row = await this.prisma.agentMessage.update({
                where: { id },
                data,
            });
            return this.toMessageRecord(row);
        } catch { return null; }
    }

    async listThreads(agentGaii: string): Promise<{ threadId: string; lastMessage: string; messageCount: number; updatedAt: string }[]> {
        this.ensureReady();
        const groups = await this.prisma.agentMessage.groupBy({
            by: ['threadId'],
            where: { agentGaii },
            _count: { _all: true },
            _max: { createdAt: true },
        });

        const results: { threadId: string; lastMessage: string; messageCount: number; updatedAt: string }[] = [];
        for (const g of groups) {
            const lastMsg = await this.prisma.agentMessage.findFirst({
                where: { agentGaii, threadId: g.threadId },
                orderBy: { createdAt: 'desc' },
                select: { content: true },
            });
            results.push({
                threadId: g.threadId,
                lastMessage: lastMsg?.content ?? '',
                messageCount: g._count._all,
                updatedAt: g._max.createdAt instanceof Date ? g._max.createdAt.toISOString() : (g._max.createdAt ?? ''),
            });
        }

        // Sort by updatedAt descending
        results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return results;
    }

    // ══════════════════════════════════════════════════════════
    // ── Agent Onboarding ──
    // ══════════════════════════════════════════════════════════

    private toOnboardingRecord(row: any): AgentOnboardingRecord {
        return {
            agentGaii: row.agentGaii,
            status: row.status,
            startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : row.startedAt,
            completedAt: row.completedAt instanceof Date ? row.completedAt.toISOString() : row.completedAt ?? undefined,
            steps: row.steps as AgentOnboardingStep[],
            readinessScore: row.readinessScore ?? undefined,
            readinessLevel: row.readinessLevel ?? undefined,
            detectedPlatform: row.detectedPlatform ?? undefined,
            installedRuntime: row.installedRuntime ?? undefined,
            onboardingBaseline: row.onboardingBaseline ?? undefined,
            operationalHealth: row.operationalHealth ?? undefined,
            healthComponents: row.healthComponents as AgentOnboardingRecord['healthComponents'] ?? undefined,
            healthRecalculatedAt: row.healthRecalculatedAt instanceof Date ? row.healthRecalculatedAt.toISOString() : row.healthRecalculatedAt ?? undefined,
            readinessOverride: row.readinessOverride as AgentOnboardingRecord['readinessOverride'] ?? undefined,
        };
    }

    async createOnboarding(record: AgentOnboardingRecord): Promise<AgentOnboardingRecord> {
        this.ensureReady();
        const row = await this.prisma.agentOnboarding.create({
            data: {
                agentGaii: record.agentGaii,
                status: record.status,
                startedAt: new Date(record.startedAt),
                completedAt: record.completedAt ? new Date(record.completedAt) : null,
                steps: record.steps as any,
                readinessScore: record.readinessScore ?? null,
                readinessLevel: record.readinessLevel ?? null,
                detectedPlatform: record.detectedPlatform ?? null,
                installedRuntime: record.installedRuntime ?? null,
                onboardingBaseline: record.onboardingBaseline ?? null,
                operationalHealth: record.operationalHealth ?? null,
                healthComponents: record.healthComponents as any ?? null,
                healthRecalculatedAt: record.healthRecalculatedAt ? new Date(record.healthRecalculatedAt) : null,
                readinessOverride: record.readinessOverride as any ?? null,
            },
        });
        return this.toOnboardingRecord(row);
    }

    async getOnboarding(agentGaii: string): Promise<AgentOnboardingRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.agentOnboarding.findUnique({ where: { agentGaii } });
            return row ? this.toOnboardingRecord(row) : null;
        } catch {
            return null;
        }
    }

    async updateOnboarding(agentGaii: string, updates: Partial<AgentOnboardingRecord>): Promise<AgentOnboardingRecord | null> {
        this.ensureReady();
        try {
            const data: any = {};
            if (updates.status !== undefined) data.status = updates.status;
            if (updates.startedAt !== undefined) data.startedAt = new Date(updates.startedAt);
            if (updates.completedAt !== undefined) data.completedAt = updates.completedAt ? new Date(updates.completedAt) : null;
            if (updates.steps !== undefined) data.steps = updates.steps as any;
            if (updates.readinessScore !== undefined) data.readinessScore = updates.readinessScore ?? null;
            if (updates.readinessLevel !== undefined) data.readinessLevel = updates.readinessLevel ?? null;
            if (updates.detectedPlatform !== undefined) data.detectedPlatform = updates.detectedPlatform ?? null;
            if (updates.installedRuntime !== undefined) data.installedRuntime = updates.installedRuntime ?? null;
            if (updates.onboardingBaseline !== undefined) data.onboardingBaseline = updates.onboardingBaseline ?? null;
            if (updates.operationalHealth !== undefined) data.operationalHealth = updates.operationalHealth ?? null;
            if (updates.healthComponents !== undefined) data.healthComponents = updates.healthComponents as any ?? null;
            if (updates.healthRecalculatedAt !== undefined) data.healthRecalculatedAt = updates.healthRecalculatedAt ? new Date(updates.healthRecalculatedAt) : null;
            if (updates.readinessOverride !== undefined) data.readinessOverride = updates.readinessOverride as any ?? null;
            const row = await this.prisma.agentOnboarding.update({ where: { agentGaii }, data });
            return this.toOnboardingRecord(row);
        } catch {
            return null;
        }
    }

    async deleteOnboarding(agentGaii: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.agentOnboarding.delete({ where: { agentGaii } });
            return true;
        } catch {
            return false;
        }
    }

    async listOnboardingByOwner(owner: string): Promise<AgentOnboardingRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.agentOnboarding.findMany({
            where: { agentGaii: { contains: `#${owner}@` } },
            orderBy: { startedAt: 'desc' },
        });
        return rows.map((r: any) => this.toOnboardingRecord(r));
    }

    async listOnboardingByStatus(status: string): Promise<AgentOnboardingRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.agentOnboarding.findMany({
            where: { status },
            orderBy: { startedAt: 'desc' },
        });
        return rows.map((r: any) => this.toOnboardingRecord(r));
    }

    // ── Agent Telemetry ──

    private toTelemetryEvent(row: any): TelemetryEvent {
        return {
            id: row.id,
            agentGaii: row.agentGaii,
            type: row.type,
            data: row.data as Record<string, unknown>,
            sessionId: row.sessionId ?? undefined,
            taskId: row.taskId ?? undefined,
            createdAt: row.createdAt.toISOString(),
        };
    }

    async appendTelemetry(event: TelemetryEvent): Promise<void> {
        this.ensureReady();
        await this.prisma.telemetryEvent.create({
            data: {
                id: event.id,
                agentGaii: event.agentGaii,
                type: event.type,
                data: event.data,
                sessionId: event.sessionId ?? null,
                taskId: event.taskId ?? null,
                createdAt: new Date(event.createdAt),
            },
        });
    }

    async listTelemetry(agentGaii: string, opts: { since?: string; type?: string; limit?: number }): Promise<TelemetryEvent[]> {
        this.ensureReady();
        const where: any = { agentGaii };
        if (opts.type) where.type = opts.type;
        if (opts.since) where.createdAt = { gt: new Date(opts.since) };
        const rows = await this.prisma.telemetryEvent.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: opts.limit ?? 50,
        });
        return rows.map((r: any) => this.toTelemetryEvent(r));
    }

    // ── Webhook Delivery Log ──

    private toDeliveryLog(row: any): WebhookDeliveryLog {
        return {
            id: row.id,
            agentGaii: row.agentGaii,
            event: row.event,
            payload: row.payload as Record<string, unknown>,
            status: row.status as 'success' | 'failed',
            httpStatus: row.httpStatus ?? undefined,
            errorMessage: row.errorMessage ?? undefined,
            attemptCount: row.attemptCount,
            latencyMs: row.latencyMs,
            createdAt: row.createdAt.toISOString(),
        };
    }

    async appendDeliveryLog(log: WebhookDeliveryLog): Promise<void> {
        this.ensureReady();
        await this.prisma.webhookDeliveryLog.create({
            data: {
                id: log.id,
                agentGaii: log.agentGaii,
                event: log.event,
                payload: log.payload,
                status: log.status,
                httpStatus: log.httpStatus ?? null,
                errorMessage: log.errorMessage ?? null,
                attemptCount: log.attemptCount,
                latencyMs: log.latencyMs,
                createdAt: new Date(log.createdAt),
            },
        });
    }

    async listDeliveryLog(agentGaii: string, limit?: number): Promise<WebhookDeliveryLog[]> {
        this.ensureReady();
        const rows = await this.prisma.webhookDeliveryLog.findMany({
            where: { agentGaii },
            orderBy: { createdAt: 'desc' },
            take: limit ?? 50,
        });
        return rows.map((r: any) => this.toDeliveryLog(r));
    }

    async pruneDeliveryLog(agentGaii: string, keepCount: number): Promise<number> {
        this.ensureReady();
        // Find the cutoff: the keepCount-th newest record's createdAt
        const cutoffRows = await this.prisma.webhookDeliveryLog.findMany({
            where: { agentGaii },
            orderBy: { createdAt: 'desc' },
            skip: keepCount,
            take: 1,
            select: { createdAt: true },
        });
        if (cutoffRows.length === 0) return 0;
        const cutoff = cutoffRows[0].createdAt;
        const result = await this.prisma.webhookDeliveryLog.deleteMany({
            where: { agentGaii, createdAt: { lte: cutoff } },
        });
        return result.count;
    }
}

/**
 * Wildcard pattern matching: supports '*' (one segment) and '**' (multiple segments)
 */
function mongoMatchWildcardPattern(pattern: string, key: string): boolean {
    const patternParts = pattern.split('.');
    const keyParts = key.split('.');

    let pi = 0, ki = 0;
    while (pi < patternParts.length && ki < keyParts.length) {
        if (patternParts[pi] === '**') {
            return true;
        }
        if (patternParts[pi] === '*') {
            pi++;
            ki++;
            continue;
        }
        if (patternParts[pi] !== keyParts[ki]) {
            return false;
        }
        pi++;
        ki++;
    }
    return pi === patternParts.length && ki === keyParts.length;
}

/**
 * Glob-style pattern matching: converts a pattern like "recipe:*" to a regex.
 * Supports '*' as a wildcard that matches any characters.
 */
function mongoMatchGlobPattern(pattern: string, key: string): boolean {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const regexStr = '^' + escaped.replace(/\*/g, '.+') + '$';
    try {
        return new RegExp(regexStr).test(key);
    } catch {
        return false;
    }
}

/**
 * Glob pattern matching for consent data patterns.
 * Supports '*' (one segment) and '**' (multiple segments).
 */
function mongoConsentMatchPattern(pattern: string, key: string): boolean {
    const regex = pattern
        .split('.')
        .map(segment => {
            if (segment === '**') return '.*';
            if (segment === '*') return '[^.]+';
            return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('\\.');
    return new RegExp(`^${regex}$`).test(key);
}

/**
 * MongoDB-backed storage. Thin subclass of {@link PrismaStorage} kept so existing
 * imports (`new MongoStorage(url)`) keep working; the MongoDB defaults
 * (`schema.prisma` + `@prisma/client`) live in the base class.
 */
export class MongoStorage extends PrismaStorage {}
