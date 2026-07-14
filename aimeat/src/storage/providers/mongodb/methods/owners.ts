/**
 * @file src/storage/providers/mongodb/methods/owners.ts
 * @description Owner, agent, and memory storage methods. Extracted from mongodb/index.ts (PrismaStorage) to satisfy max-file-lines; method bodies verbatim, bound to PrismaStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/mongodb/index.ts (max-file-lines)
 */
import type {
  OwnerRecord, AgentRecord, MemoryRecord
} from '../../../interface.js';
import type { MemoryTextHit, MemoryTextSearchOpts, MemoryVersionRecord } from '../../../repositories/memory.repository.js';
import { logger } from '../../../../utils/logger.js';
import type { PrismaStorage, PrismaRow } from '../index.js';

export const ownerMethods = {
    // ── Owners ──────────────────────────────────────────────────

    async createOwner(this: PrismaStorage, owner: OwnerRecord): Promise<OwnerRecord> {
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
    },

    async getOwner(this: PrismaStorage, name: string): Promise<OwnerRecord | null> {
        this.ensureReady();
        const row = await this.prisma.owner.findUnique({ where: { name } });
        return row ? this.toOwnerRecord(row) : null;
    },

    async listOwners(this: PrismaStorage): Promise<OwnerRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.owner.findMany();
        return rows.map((r: PrismaRow) => this.toOwnerRecord(r));
    },

    async updateOwner(this: PrismaStorage, name: string, updates: Partial<OwnerRecord>): Promise<OwnerRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.owner.update({ where: { name }, data: updates });
            return this.toOwnerRecord(row);
        } catch { return null; }
    },

    async deleteOwner(this: PrismaStorage, name: string): Promise<boolean> {
        this.ensureReady();
        try {
            // 1. Get all agents belonging to this owner
            const agents = await this.prisma.agent.findMany({ where: { owner: name }, select: { gaii: true } });
            const agentGaiis = agents.map((a: PrismaRow) => a.gaii);

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
            const personalNodeIds = personalNodes.map((n: PrismaRow) => n.id);
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
    },

    // ── Agents ──────────────────────────────────────────────────

    async createAgent(this: PrismaStorage, agent: AgentRecord): Promise<AgentRecord> {
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
                technicalCapabilities: agent.technicalCapabilities ?? null,
                domainCapabilities: agent.domainCapabilities ?? null,
                activityStats: agent.activityStats ?? null,
                modulesLoaded: agent.modulesLoaded ?? null,
                agentLimitations: agent.agentLimitations ?? null,
                languages: agent.languages ?? null,
                mode: agent.mode ?? 'interactive',
                maxConcurrentTasks: agent.maxConcurrentTasks ?? 1,
                dailySpendLimit: agent.dailySpendLimit ?? null,
                scheduleConstraintDefaults: agent.scheduleConstraintDefaults ?? null,
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
    },

    async getAgent(this: PrismaStorage, gaii: string): Promise<AgentRecord | null> {
        this.ensureReady();
        const row = await this.prisma.agent.findUnique({ where: { gaii } });
        return row ? this.toAgentRecord(row) : null;
    },

    async getAgentByName(this: PrismaStorage, name: string, _nodeId: string): Promise<AgentRecord | null> {
        this.ensureReady();
        const row = await this.prisma.agent.findFirst({ where: { name } });
        return row ? this.toAgentRecord(row) : null;
    },

    async getAgentsByOwner(this: PrismaStorage, owner: string): Promise<AgentRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.agent.findMany({ where: { owner } });
        return rows.map((r: PrismaRow) => this.toAgentRecord(r));
    },

    async updateAgent(this: PrismaStorage, gaii: string, updates: Partial<AgentRecord>): Promise<AgentRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.agent.update({ where: { gaii }, data: updates });
            return this.toAgentRecord(row);
        } catch (err) {
            logger.warn('updateAgent failed for %s: %s', gaii, (err as Error).message);
            return null;
        }
    },

    async deleteAgent(this: PrismaStorage, gaii: string): Promise<boolean> {
        this.ensureReady();
        try {
            // Cascade delete all agent-related data
            await this.cascadeDeleteAgentData(gaii);
            // Delete the agent record itself
            await this.prisma.agent.delete({ where: { gaii } });
            return true;
        } catch { return false; }
    },

    /**
     * Cascade-delete all data associated with a single agent GAII.
     * Called by both deleteOwner and deleteAgent.
     */
    async cascadeDeleteAgentData(this: PrismaStorage, gaii: string): Promise<void> {
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
    },

    async listAgents(this: PrismaStorage): Promise<AgentRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.agent.findMany();
        return rows.map((r: PrismaRow) => this.toAgentRecord(r));
    },

    /**
     * Resolve any identity (GAII, GHII, bare owner) to the owner's GHII identifier.
     * All balance operations go through GHII — agents don't have their own balance.
     */
    async resolveGhii(this: PrismaStorage, identity: string): Promise<string | null> {
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
    },

    async debitBalance(this: PrismaStorage, gaii: string, amount: number): Promise<boolean> {
        // SECURITY: reject negative/non-finite amounts. A negative amount would INVERT the
        // decrement (decrement: -n adds n) and mint morsels. 0 is allowed (no-op;
        // free/0-cost work escrow relies on it).
        if (!Number.isFinite(amount) || amount < 0) return false;
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
    },

    async creditBalance(this: PrismaStorage, gaii: string, amount: number): Promise<boolean> {
        // SECURITY: reject negative/non-finite amounts (a negative credit would silently debit); 0 is a no-op.
        if (!Number.isFinite(amount) || amount < 0) return false;
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
    },

    async creditBalanceCapped(this: PrismaStorage, gaii: string, amount: number, cap: number): Promise<number> {
        // SECURITY: reject negative/non-finite amounts (NaN would slip past the actualCredit<=0 guard below).
        if (!Number.isFinite(amount) || amount < 0) return 0;
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
    },

    async transferBalance(this: PrismaStorage, fromGaii: string, toGaii: string, amount: number): Promise<boolean> {
        // SECURITY: reject negative/non-finite amounts (a negative transfer would drain the recipient); 0 is a no-op.
        if (!Number.isFinite(amount) || amount < 0) return false;
        this.ensureReady();
        const fromGhii = await this.resolveGhii(fromGaii);
        const toGhii = await this.resolveGhii(toGaii);
        if (!fromGhii || !toGhii) return false;
        if (fromGhii === toGhii) return true; // Same owner — no-op
        try {
            await this.prisma.$transaction(async (tx: PrismaRow) => {
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
    },

    // ── Memory ──────────────────────────────────────────────────

    async setMemory(this: PrismaStorage, record: MemoryRecord): Promise<MemoryRecord> {
        this.ensureReady();
        const existing = await this.getMemory(record.ownerGaii, record.key);
        // Trackable is a property of the key: inherit the existing setting if unspecified so a generic
        // rewrite never silently turns tracking off. Archiving keeps the PREVIOUS version.
        const trackable = record.trackable ?? existing?.trackable ?? false;
        record.trackable = trackable || undefined;
        if (existing?.trackable) {
            // Archive the about-to-be-overwritten version into the separate MemoryVersion collection.
            await this.prisma.memoryVersion.upsert({
                where: { ownerGaii_key_version: { ownerGaii: existing.ownerGaii, key: existing.key, version: existing.version } },
                create: {
                    ownerGaii: existing.ownerGaii, key: existing.key, version: existing.version,
                    value: existing.value,
                    actor: this.memoryAnnotation(existing.value, '_actor'),
                    event: this.memoryAnnotation(existing.value, '_event'),
                    recordedAt: new Date(existing.updatedAt),
                },
                update: {},
            });
        }
        // `as any` on the data objects: workspaceRef is new in the Prisma schema; the generated client
        // gets it on the next `prisma generate` (deploy). Matches the storage-file writes above.
        const byteSize = Buffer.byteLength(JSON.stringify(record.value ?? null), 'utf8');   // cached for the O(1) total-size quota sum
        const memCreate: Record<string, unknown> = {
            key: record.key,
            ownerGaii: record.ownerGaii,
            value: record.value,
            visibility: record.visibility,
            groupId: record.groupId ?? null,
            workspaceRef: record.workspaceRef ?? null,
            tags: record.tags,
            ttlHours: record.ttlHours,
            version: record.version,
            flagCount: record.flagCount ?? 0,
            allowedOrigins: record.allowedOrigins ?? [],
            trackable,
            byteSize,
            searchBlob: this.buildSearchBlob(record),
            createdAt: new Date(record.createdAt),
            updatedAt: new Date(record.updatedAt),
        };
        const memUpdate: Record<string, unknown> = {
            value: record.value,
            visibility: record.visibility,
            groupId: record.groupId ?? null,
            workspaceRef: record.workspaceRef ?? null,
            tags: record.tags,
            ttlHours: record.ttlHours,
            version: record.version,
            flagCount: record.flagCount ?? 0,
            allowedOrigins: record.allowedOrigins ?? [],
            trackable,
            byteSize,
            searchBlob: this.buildSearchBlob(record),
            updatedAt: new Date(record.updatedAt),
        };
        const row = await this.prisma.memory.upsert({
            where: { ownerGaii_key: { ownerGaii: record.ownerGaii, key: record.key } },
            create: memCreate,
            update: memUpdate,
        });
        return this.toMemoryRecord(row);
    },

    async listMemoryHistory(this: PrismaStorage, ownerGaii: string, key: string, opts?: { limit?: number }): Promise<MemoryVersionRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.memoryVersion.findMany({
            where: { ownerGaii, key },
            orderBy: { version: 'desc' },
            take: opts?.limit ?? 200,
        });
        return rows.map((r: PrismaRow) => ({
            ownerGaii: r.ownerGaii,
            key: r.key,
            version: r.version,
            value: r.value,
            actor: r.actor ?? null,
            event: r.event ?? null,
            recordedAt: r.recordedAt.toISOString(),
        }));
    },

    async setMemoryIfVersion(this: PrismaStorage, record: MemoryRecord, expectedVersion: number): Promise<MemoryRecord | null> {
        this.ensureReady();
        // Atomic version-checked update using raw MongoDB $set + version filter
        const cvData: Record<string, unknown> = {
            value: record.value,
            visibility: record.visibility,
            groupId: record.groupId ?? null,
            workspaceRef: record.workspaceRef ?? null,
            tags: record.tags,
            ttlHours: record.ttlHours,
            version: record.version,
            flagCount: record.flagCount ?? 0,
            allowedOrigins: record.allowedOrigins ?? [],
            searchBlob: this.buildSearchBlob(record),
            updatedAt: new Date(record.updatedAt),
        };
        const result = await this.prisma.memory.updateMany({
            where: {
                ownerGaii: record.ownerGaii,
                key: record.key,
                version: expectedVersion,
            },
            data: cvData,
        });
        if (result.count === 0) return null; // version conflict
        return this.getMemory(record.ownerGaii, record.key);
    },

    async getMemory(this: PrismaStorage, ownerGaii: string, key: string): Promise<MemoryRecord | null> {
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
    },

    async listMemory(this: PrismaStorage, ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number; archived?: import('../../../interface.js').ArchiveFilter }): Promise<MemoryRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = { ownerGaii, ...this.archivedWhere(opts?.archived) };
        if (opts?.prefix) where.key = { startsWith: opts.prefix };
        if (opts?.visibility) where.visibility = opts.visibility;
        if (opts?.tags?.length) where.tags = { hasSome: opts.tags };

        const rows = await this.prisma.memory.findMany({ where });
        return rows
            .filter((r: PrismaRow) => {
                if (!r.ttlHours) return true;
                return Date.now() <= new Date(r.createdAt).getTime() + r.ttlHours * 3600_000;
            })
            .map((r: PrismaRow) => this.toMemoryRecord(r))
            .filter((r: MemoryRecord) => {
                if (opts?.maxFlags !== undefined && (r.flagCount ?? 0) > opts.maxFlags) return false;
                return true;
            });
    },

    async countMemory(this: PrismaStorage, ownerGaiis: string[], opts?: { prefix?: string; visibility?: string; archived?: import('../../../interface.js').ArchiveFilter }): Promise<number> {
        this.ensureReady();
        if (ownerGaiis.length === 0) return 0;
        const where: Record<string, unknown> = { ownerGaii: { in: ownerGaiis }, ...this.archivedWhere(opts?.archived) };
        if (opts?.prefix) where.key = { startsWith: opts.prefix };
        if (opts?.visibility) where.visibility = opts.visibility;
        // DISTINCT keys (mirrors listOwnerScopeMemory's cross-identity key-dedup); loads only the
        // key column, not values — far cheaper than materializing every record for a count.
        const rows = await this.prisma.memory.findMany({ where, distinct: ['key'], select: { key: true } });
        return rows.length;
    },

    async sumMemoryBytes(this: PrismaStorage, ownerGaii: string): Promise<number> {
        this.ensureReady();
        // DB-side SUM of the cached per-row byteSize — no records/values transferred. Replaces the old
        // load-all + re-serialise that ran on every write (O(N) per write / O(N²) per bulk import).
        const agg = await this.prisma.memory.aggregate({ where: { ownerGaii }, _sum: { byteSize: true } });
        return agg._sum.byteSize ?? 0;
    },

    async listAllMemory(this: PrismaStorage, opts?: { prefix?: string; ownerPrefix?: string; visibility?: string; limit?: number; offset?: number; archived?: import('../../../interface.js').ArchiveFilter }): Promise<{ items: MemoryRecord[]; total: number }> {
        this.ensureReady();
        const where: Record<string, unknown> = { ...this.archivedWhere(opts?.archived) };
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
            .filter((r: PrismaRow) => {
                if (!r.ttlHours) return true;
                return Date.now() <= new Date(r.createdAt).getTime() + r.ttlHours * 3600_000;
            })
            .map((r: PrismaRow) => this.toMemoryRecord(r));

        return { items, total };
    },

    async deleteMemory(this: PrismaStorage, ownerGaii: string, key: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.memory.delete({ where: { ownerGaii_key: { ownerGaii, key } } });
            return true;
        } catch { return false; }
    },

    async deleteAllMemory(this: PrismaStorage, ownerGaii: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.memory.deleteMany({ where: { ownerGaii } });
        return result.count;
    },

    async incrementMemoryFlagCount(this: PrismaStorage, ownerGaii: string, key: string): Promise<void> {
        this.ensureReady();
        const record = await this.getMemory(ownerGaii, key);
        if (record) {
            record.flagCount = (record.flagCount ?? 0) + 1;
            await this.setMemory(record);
        }
    },

    async searchMemory(this: PrismaStorage, ownerGaii: string, query: string, opts?: { visibility?: string; maxFlags?: number; prefix?: string; archived?: import('../../../interface.js').ArchiveFilter; limit?: number }): Promise<MemoryRecord[]> {
        this.ensureReady();
        // MongoDB text search — search keys and string values
        const where: Record<string, unknown> = { ownerGaii, ...this.archivedWhere(opts?.archived) };
        if (opts?.visibility) where.visibility = opts.visibility;
        if (opts?.prefix) where.key = { startsWith: opts.prefix };

        const rows = await this.prisma.memory.findMany({ where });
        const q = query.toLowerCase();
        const out = rows
            .filter((r: PrismaRow) => {
                if (r.key.toLowerCase().includes(q)) return true;
                const valStr = JSON.stringify(r.value).toLowerCase();
                if (valStr.includes(q)) return true;
                if (r.tags.some((t: string) => t.toLowerCase().includes(q))) return true;
                return false;
            })
            .filter((r: PrismaRow) => {
                if (!r.ttlHours) return true;
                return Date.now() <= new Date(r.createdAt).getTime() + r.ttlHours * 3600_000;
            })
            .map((r: PrismaRow) => this.toMemoryRecord(r))
            .filter((r: MemoryRecord) => {
                if (opts?.maxFlags !== undefined && (r.flagCount ?? 0) > opts.maxFlags) return false;
                return true;
            });
        // Optional result cap (additive; omitted → full result set). Post-filter, matching SQLite.
        return opts?.limit !== undefined ? out.slice(0, opts.limit) : out;
    },

    /** Flatten a record into searchable text: key + string/number leaves of value + tags, stored on
     *  `searchBlob`. NOTE: `searchText` below queries this with a per-token `contains` (a substring
     *  scan / regex), NOT a MongoDB `$text` index — there is no `$text` index on this collection.
     *  Substring matching finds infixes (e.g. "portaat" inside "kyvykkyysportaat"), which SQLite's
     *  FTS5 `tok*` prefix match does not; the tradeoff is no index-backed scalability here. */
    buildSearchBlob(this: PrismaStorage, record: MemoryRecord): string {
        const parts: string[] = [record.key, ...(record.tags ?? [])];
        const collect = (v: unknown, depth: number): void => {
            if (depth > 6 || v == null) return;
            if (typeof v === 'string') { if (v.trim()) parts.push(v); }
            else if (typeof v === 'number' || typeof v === 'boolean') parts.push(String(v));
            else if (Array.isArray(v)) for (const x of v) collect(x, depth + 1);
            else if (typeof v === 'object') for (const x of Object.values(v as Record<string, unknown>)) collect(x, depth + 1);
        };
        collect(record.value, 0);
        return parts.join(' \n ');
    },

    async searchText(this: PrismaStorage, query: string, opts?: MemoryTextSearchOpts): Promise<MemoryTextHit[]> {
        this.ensureReady();
        const tokens = query.toLowerCase().match(/[\p{L}\p{N}]+/gu);
        if (!tokens || tokens.length === 0) return [];

        const where: Record<string, unknown> = { OR: tokens.map(tok => ({ searchBlob: { contains: tok, mode: 'insensitive' } })), ...this.archivedWhere(opts?.archived) };
        if (opts?.ownerGaiis?.length) where.ownerGaii = { in: opts.ownerGaiis };
        if (opts?.visibility) where.visibility = opts.visibility;
        if (opts?.keyPrefix) where.key = { startsWith: opts.keyPrefix };
        const limit = opts?.limit ?? 50;

        const rows = await this.prisma.memory.findMany({ where, take: limit * 4 }) as PrismaRow[];

        // Rank: more distinct tokens matched first, then most-recently updated. (No bm25 here; the
        // librarian's value is finding the right records, and an AI rerank can follow — design §4.)
        return rows
            .filter(r => !r.ttlHours || Date.now() <= new Date(r.createdAt).getTime() + r.ttlHours * 3600_000)
            .filter(r => opts?.maxFlags === undefined || (r.flagCount ?? 0) <= opts.maxFlags)
            .map(r => {
                const blob = String(r.searchBlob ?? '').toLowerCase();
                const score = tokens.reduce((n, t) => n + (blob.includes(t) ? 1 : 0), 0);
                return { record: this.toMemoryRecord(r), score, updatedAt: r.updatedAt as Date };
            })
            .sort((a, b) => (b.score - a.score) || (b.updatedAt.getTime() - a.updatedAt.getTime()))
            .slice(0, limit)
            .map(({ record, score }) => ({ record, score }));
    },

    async archiveMemoryByKey(this: PrismaStorage, keyOrPrefix: string, opts: { archivedRoot: string; archivedBy: string; archivedAt: string; match?: 'exact' | 'prefix' | 'subtree' }): Promise<number> {
        this.ensureReady();
        const match = opts.match ?? 'prefix';
        const where: Record<string, unknown> = { archived: { not: true } };
        if (match === 'exact') where.key = keyOrPrefix;
        else if (match === 'subtree') where.OR = [{ key: keyOrPrefix }, { key: { startsWith: keyOrPrefix + '.' } }];
        else where.key = { startsWith: keyOrPrefix };
        const res = await this.prisma.memory.updateMany({
            where,
            data: { archived: true, archivedAt: new Date(opts.archivedAt), archivedBy: opts.archivedBy, archivedRoot: opts.archivedRoot },
        });
        return res.count;
    },

    async unarchiveMemoryByRoot(this: PrismaStorage, archivedRoot: string): Promise<number> {
        this.ensureReady();
        const res = await this.prisma.memory.updateMany({
            where: { archived: true, archivedRoot },
            data: { archived: false, archivedAt: null, archivedBy: null, archivedRoot: null },
        });
        return res.count;
    },

    async unarchiveMemoryByKey(this: PrismaStorage, keyOrPrefix: string, opts?: { match?: 'exact' | 'prefix' | 'subtree' }): Promise<number> {
        this.ensureReady();
        const match = opts?.match ?? 'subtree';
        const where: Record<string, unknown> = { archived: true };
        if (match === 'exact') where.key = keyOrPrefix;
        else if (match === 'subtree') where.OR = [{ key: keyOrPrefix }, { key: { startsWith: keyOrPrefix + '.' } }];
        else where.key = { startsWith: keyOrPrefix };
        const res = await this.prisma.memory.updateMany({
            where,
            data: { archived: false, archivedAt: null, archivedBy: null, archivedRoot: null },
        });
        return res.count;
    },

    async countArchivedByKeyPrefix(this: PrismaStorage, keyPrefix: string): Promise<{ active: number; archived: number }> {
        this.ensureReady();
        const [active, archived] = await Promise.all([
            this.prisma.memory.count({ where: { key: { startsWith: keyPrefix }, archived: { not: true } } }),
            this.prisma.memory.count({ where: { key: { startsWith: keyPrefix }, archived: true } }),
        ]);
        return { active, archived };
    },
};
