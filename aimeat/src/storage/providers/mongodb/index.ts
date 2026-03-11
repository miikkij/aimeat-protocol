/**
 * MongoDB Storage Implementation using Prisma Client.
 *
 * To use:
 *   1. pnpm add @prisma/client prisma
 *   2. npx prisma generate
 *   3. Set DATABASE_URL environment variable
 *   4. Start with: aimeat --db mongodb://localhost:27017/aimeat
 */

import { randomUUID } from 'node:crypto';

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
    NotificationTemplateRecord,
    MemoryLinkRecord, OperatorReviewRecord,
    ScheduledJobRecord,
    ExtensionInstanceRecord,
    ReplicationQueueEntry,
    DeviceAuthorizationRecord,
    OAuthClientRecord,
    OAuthRefreshTokenRecord,
    OAuthApprovalRecord,
    SystemPromptRecord,
    SystemPromptVersionRecord,
} from '../../interface.js';

import { matchesRecipient } from '../../../services/consent.js';
import { parseGaiiLoose } from '../../../utils/gaii.js';

// Prisma client will be imported dynamically at runtime
// import { PrismaClient } from '@prisma/client';

export class MongoStorage implements Storage {
    private prisma: any; // PrismaClient — typed as any until @prisma/client is installed
    private chunkedUploads = new Map<string, ChunkedUploadRecord>(); // kept in-memory (transient)
    readonly ready: Promise<void>;

    constructor(databaseUrl: string) {
        // Dynamic import to avoid requiring @prisma/client at compile time
        this.prisma = null;
        this.ready = this.init(databaseUrl);
    }

    private async init(databaseUrl: string) {
        const { PrismaClient } = await import('@prisma/client');
        this.prisma = new PrismaClient({ datasourceUrl: databaseUrl });
        await this.prisma.$connect();
    }

    private ensureReady() {
        if (!this.prisma) throw new Error('MongoDB storage not yet initialized');
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
        } catch { return null; }
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
    }

    async listAgents(): Promise<AgentRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.agent.findMany();
        return rows.map((r: any) => this.toAgentRecord(r));
    }

    async debitBalance(gaii: string, amount: number): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.agent.update({
                where: { gaii, morselBalance: { gte: amount } },
                data: { morselBalance: { decrement: amount } },
            });
            return true;
        } catch { return false; }
    }

    async creditBalance(gaii: string, amount: number): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.agent.update({
                where: { gaii },
                data: { morselBalance: { increment: amount } },
            });
            return true;
        } catch { return false; }
    }

    async creditBalanceCapped(gaii: string, amount: number, cap: number): Promise<number> {
        this.ensureReady();
        const agent = await this.prisma.agent.findUnique({ where: { gaii }, select: { morselBalance: true } });
        if (!agent || agent.morselBalance >= cap) return 0;
        const actualCredit = Math.min(amount, cap - agent.morselBalance);
        if (actualCredit <= 0) return 0;
        await this.prisma.agent.update({
            where: { gaii },
            data: { morselBalance: { increment: actualCredit } },
        });
        return actualCredit;
    }

    async transferBalance(fromGaii: string, toGaii: string, amount: number): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.$transaction(async (tx: any) => {
                const from = await tx.agent.findUnique({ where: { gaii: fromGaii }, select: { morselBalance: true } });
                if (!from || from.morselBalance < amount) throw new Error('INSUFFICIENT');
                await tx.agent.update({ where: { gaii: fromGaii }, data: { morselBalance: { decrement: amount } } });
                await tx.agent.update({ where: { gaii: toGaii }, data: { morselBalance: { increment: amount } } });
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
                replyTo: post.replyTo,
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
        const where: any = { boardId };
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
        const result = await this.prisma.boardPost.deleteMany({ where: { boardId, id: postId } });
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
        await this.prisma.storageFile.create({
            data: {
                key: file.key,
                ownerGaii: file.ownerGaii,
                visibility: file.visibility,
                mimeType: file.mimeType,
                size: file.size,
                data: file.data,
                tags: file.tags || [],
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
        return { key: row.key, ownerGaii: row.ownerGaii, visibility: row.visibility as any, mimeType: row.mimeType, size: row.size, data: Buffer.from(row.data), tags: (row as any).tags || [], createdAt: row.createdAt.toISOString() };
    }

    async listStorageFiles(ownerGaii: string): Promise<StorageFileRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.storageFile.findMany({
            where: { ownerGaii },
            select: { key: true, ownerGaii: true, visibility: true, mimeType: true, size: true, tags: true, createdAt: true },
        });
        return rows.map((r: any) => ({
            key: r.key, ownerGaii: r.ownerGaii, visibility: r.visibility, mimeType: r.mimeType, size: r.size, data: Buffer.alloc(0), tags: r.tags || [], createdAt: r.createdAt.toISOString(),
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
        return { name: row.name, owner: row.owner, gaii: row.gaii, displayName: row.displayName ?? undefined, description: row.description ?? undefined, capabilities: row.capabilities, publicKey: row.publicKey, trustScore: row.trustScore, morselBalance: row.morselBalance, allowedOrigins: row.allowedOrigins?.length ? row.allowedOrigins : undefined, createdAt: row.createdAt.toISOString(), lastSeen: row.lastSeen.toISOString() };
    }

    private toMemoryRecord(row: any): MemoryRecord {
        return { key: row.key, ownerGaii: row.ownerGaii, value: row.value, visibility: row.visibility as any, tags: row.tags, ttlHours: row.ttlHours, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), flagCount: row.flagCount ?? undefined, allowedOrigins: row.allowedOrigins?.length ? row.allowedOrigins : undefined };
    }

    private toActionRecord(row: any): ActionRecord {
        return { id: row.actionId, providerGaii: row.providerGaii, displayName: row.displayName, description: row.description, category: row.category ?? undefined, inputSchema: row.inputSchema as Record<string, unknown>, outputSchema: row.outputSchema as Record<string, unknown>, pricing: { baseMorsels: row.pricingBaseMorsels, perUnit: row.pricingPerUnit as any }, estimatedTimeSeconds: row.estimatedTimeSeconds ?? undefined, maxInputSizeBytes: row.maxInputSizeBytes ?? undefined, tags: row.tags, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
    }

    private toWorkRecord(row: any): WorkRecord {
        return { trackingCode: row.trackingCode, status: row.status, actionId: row.actionId, providerGaii: row.providerGaii, requesterGaii: row.requesterGaii, input: row.input as Record<string, unknown>, output: row.output as Record<string, unknown> | undefined, cost: { basePrice: row.costBasePrice, networkFee: row.costNetworkFee, total: row.costTotal, inEscrow: row.costInEscrow }, ttlExpiresAt: row.ttlExpiresAt.toISOString(), callbackUrl: row.callbackUrl ?? undefined, rating: row.ratingScore != null ? { score: row.ratingScore, comment: row.ratingComment ?? undefined } : undefined, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
    }

    private toBoardRecord(row: any): BoardRecord {
        return { id: row.boardId, name: row.name, description: row.description ?? undefined, visibility: row.visibility as any, ownerGaii: row.ownerGaii, allowedGaiis: row.allowedGaiis, createdAt: row.createdAt.toISOString() };
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
            if (e?.code === 'P2002') throw new Error('GHII_TAKEN');
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
        try { await this.prisma.personalNode.update({ where: { id: item.personalNodeId }, data: { mailboxUsedBytes: { increment: item.sizeBytes } } }); } catch {}
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
            try { await this.prisma.personalNode.update({ where: { id: item.personalNodeId }, data: { mailboxUsedBytes: { decrement: item.sizeBytes } } }); } catch {}
            return true;
        } catch { return false; }
    }

    async deleteMailboxItemsByNode(personalNodeId: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.mailboxItem.deleteMany({ where: { personalNodeId } });
        try { await this.prisma.personalNode.update({ where: { id: personalNodeId }, data: { mailboxUsedBytes: 0 } }); } catch {}
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
            try { await this.prisma.personalNode.update({ where: { id: nodeId }, data: { mailboxUsedBytes: { decrement: bytes } } }); } catch {}
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
        try { await this.prisma.schemaLock.delete({ where: { applyTo_keyPattern: { applyTo: 'exact', keyPattern } } }); deleted = true; } catch {}
        try { await this.prisma.schemaLock.delete({ where: { applyTo_keyPattern: { applyTo: 'prefix', keyPattern } } }); deleted = true; } catch {}
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
        let rows = await this.prisma.organism.findMany({ where, orderBy: { createdAt: 'desc' } });
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
        try { await this.prisma.organismReputation.delete({ where: { organismId: id } }); } catch {}

        if (org) {
            try {
                await this.prisma.boardPost.deleteMany({ where: { boardId: org.boardId } });
                await this.prisma.boardSubscription.deleteMany({ where: { boardId: org.boardId } });
                await this.prisma.board.delete({ where: { boardId: org.boardId } });
            } catch {}
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
        let rows = await this.prisma.listing.findMany({ where, orderBy: { createdAt: 'desc' } });
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

    // ══════════════════════════════════════════════════════════
    // ── Scheduler: Scheduled Jobs ──
    // ══════════════════════════════════════════════════════════

    private toScheduledJobRecord(row: any): ScheduledJobRecord {
        return {
            id: row.id,
            name: row.name,
            type: row.type as 'extension' | 'core',
            extensionName: row.extensionName ?? undefined,
            instanceId: row.instanceId ?? undefined,
            actionId: row.actionId ?? undefined,
            coreHandler: row.coreHandler ?? undefined,
            cron: row.cron,
            enabled: row.enabled,
            input: row.input as Record<string, unknown> | undefined,
            lastRunAt: row.lastRunAt instanceof Date ? row.lastRunAt.toISOString() : row.lastRunAt ?? undefined,
            lastRunResult: row.lastRunResult as 'success' | 'error' | undefined,
            lastRunError: row.lastRunError ?? undefined,
            lastRunDurationMs: row.lastRunDurationMs ?? undefined,
            nextRunAt: row.nextRunAt instanceof Date ? row.nextRunAt.toISOString() : row.nextRunAt ?? undefined,
            createdBy: row.createdBy,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
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
            },
        });
        return record;
    }

    async getScheduledJob(id: string): Promise<ScheduledJobRecord | null> {
        this.ensureReady();
        const row = await this.prisma.scheduledJob.findUnique({ where: { id } });
        return row ? this.toScheduledJobRecord(row) : null;
    }

    async listScheduledJobs(filter?: { type?: string; extensionName?: string; enabled?: boolean }): Promise<ScheduledJobRecord[]> {
        this.ensureReady();
        const where: any = {};
        if (filter?.type !== undefined) where.type = filter.type;
        if (filter?.extensionName !== undefined) where.extensionName = filter.extensionName;
        if (filter?.enabled !== undefined) where.enabled = filter.enabled;
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
        const row = await this.prisma.scheduledJob.update({ where: { id }, data });
        return this.toScheduledJobRecord(row);
    }

    async deleteScheduledJob(id: string): Promise<boolean> {
        this.ensureReady();
        const result = await this.prisma.scheduledJob.deleteMany({ where: { id } });
        return result.count > 0;
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

    // ══════════════════════════════════════════════════════════
    // ── Replication Queue (B.1) — in-memory (transient queue)
    // ══════════════════════════════════════════════════════════

    private replicationQueue = new Map<string, ReplicationQueueEntry>();

    async enqueueReplication(entry: Omit<ReplicationQueueEntry, 'id' | 'attempts' | 'lastAttemptAt' | 'status'>): Promise<string> {
        const id = randomUUID();
        const full: ReplicationQueueEntry = {
            ...entry,
            id,
            attempts: 0,
            lastAttemptAt: null,
            status: 'pending',
        };
        this.replicationQueue.set(id, full);
        return id;
    }

    async dequeueReplication(peerId: string, limit: number): Promise<ReplicationQueueEntry[]> {
        const results: ReplicationQueueEntry[] = [];
        // Iterate in insertion order (Map preserves insertion order)
        for (const entry of this.replicationQueue.values()) {
            if (entry.status === 'pending' && entry.targetPeers.includes(peerId)) {
                results.push(entry);
                if (results.length >= limit) break;
            }
        }
        return results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    async markReplicationSent(ids: string[]): Promise<void> {
        for (const id of ids) {
            const entry = this.replicationQueue.get(id);
            if (entry) entry.status = 'sent';
        }
    }

    async markReplicationFailed(ids: string[]): Promise<void> {
        for (const id of ids) {
            const entry = this.replicationQueue.get(id);
            if (entry) {
                entry.status = 'failed';
                entry.attempts++;
                entry.lastAttemptAt = new Date().toISOString();
            }
        }
    }

    async pruneReplicationQueue(maxAge: Date): Promise<number> {
        let pruned = 0;
        for (const [id, entry] of this.replicationQueue) {
            if (new Date(entry.createdAt) < maxAge || entry.status === 'sent') {
                this.replicationQueue.delete(id);
                pruned++;
            }
        }
        return pruned;
    }

    async replicationQueueSize(): Promise<number> {
        return this.replicationQueue.size;
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

    async cleanupExpiredDeviceAuth(): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.deviceAuth.deleteMany({
            where: { status: 'pending', expiresAt: { lte: new Date() } },
        });
        return result.count;
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
        const data = {
            id: record.id,
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
            create: data,
            update: data,
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
