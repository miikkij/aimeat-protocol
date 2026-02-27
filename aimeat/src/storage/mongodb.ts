/**
 * MongoDB Storage Implementation using Prisma Client.
 *
 * To use:
 *   1. pnpm add @prisma/client prisma
 *   2. npx prisma generate
 *   3. Set DATABASE_URL environment variable
 *   4. Start with: aimeat --db mongodb://localhost:27017/aimeat
 */

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
} from './interface.js';

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
            await this.prisma.agent.delete({ where: { gaii } });
            return true;
        } catch { return false; }
    }

    async listAgents(): Promise<AgentRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.agent.findMany();
        return rows.map((r: any) => this.toAgentRecord(r));
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
                createdAt: new Date(record.createdAt),
                updatedAt: new Date(record.updatedAt),
            },
            update: {
                value: record.value as any,
                visibility: record.visibility,
                tags: record.tags,
                ttlHours: record.ttlHours,
                version: record.version,
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

    async listMemory(ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[] }): Promise<MemoryRecord[]> {
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
            .map((r: any) => this.toMemoryRecord(r));
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

    async searchMemory(ownerGaii: string, query: string, opts?: { visibility?: string }): Promise<MemoryRecord[]> {
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
            .map((r: any) => this.toMemoryRecord(r));
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

    async listAllWork(): Promise<WorkRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.work.findMany();
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

    async listAllTransactions(): Promise<WalletTransaction[]> {
        this.ensureReady();
        const rows = await this.prisma.transaction.findMany({
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
    // Note: For MongoDB, subscriptions are stored in-memory (same as memory.ts)
    // until a Prisma schema migration adds a BoardSubscription model.
    private boardSubscriptions = new Map<string, import('./interface.js').BoardSubscriptionRecord>();

    async createBoardSubscription(sub: import('./interface.js').BoardSubscriptionRecord): Promise<import('./interface.js').BoardSubscriptionRecord> {
        this.boardSubscriptions.set(`${sub.boardId}::${sub.gaii}`, sub);
        return sub;
    }

    async getBoardSubscription(boardId: string, gaii: string): Promise<import('./interface.js').BoardSubscriptionRecord | null> {
        return this.boardSubscriptions.get(`${boardId}::${gaii}`) ?? null;
    }

    async listBoardSubscriptions(boardId: string): Promise<import('./interface.js').BoardSubscriptionRecord[]> {
        return [...this.boardSubscriptions.values()].filter(s => s.boardId === boardId);
    }

    async listSubscriptionsByAgent(gaii: string): Promise<import('./interface.js').BoardSubscriptionRecord[]> {
        return [...this.boardSubscriptions.values()].filter(s => s.gaii === gaii);
    }

    async deleteBoardSubscription(boardId: string, gaii: string): Promise<boolean> {
        return this.boardSubscriptions.delete(`${boardId}::${gaii}`);
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

    async listAllDisputes(): Promise<DisputeRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.dispute.findMany();
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
        return { key: row.key, ownerGaii: row.ownerGaii, visibility: row.visibility as any, mimeType: row.mimeType, size: row.size, data: Buffer.from(row.data), createdAt: row.createdAt.toISOString() };
    }

    async listStorageFiles(ownerGaii: string): Promise<StorageFileRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.storageFile.findMany({
            where: { ownerGaii },
            select: { key: true, ownerGaii: true, visibility: true, mimeType: true, size: true, createdAt: true },
        });
        return rows.map((r: any) => ({
            key: r.key, ownerGaii: r.ownerGaii, visibility: r.visibility, mimeType: r.mimeType, size: r.size, data: Buffer.alloc(0), createdAt: r.createdAt.toISOString(),
        }));
    }

    async deleteStorageFile(ownerGaii: string, key: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.storageFile.delete({ where: { ownerGaii_key: { ownerGaii, key } } });
            return true;
        } catch { return false; }
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
        return { name: row.name, owner: row.owner, gaii: row.gaii, displayName: row.displayName ?? undefined, description: row.description ?? undefined, capabilities: row.capabilities, publicKey: row.publicKey, trustScore: row.trustScore, morselBalance: row.morselBalance, createdAt: row.createdAt.toISOString(), lastSeen: row.lastSeen.toISOString() };
    }

    private toMemoryRecord(row: any): MemoryRecord {
        return { key: row.key, ownerGaii: row.ownerGaii, value: row.value, visibility: row.visibility as any, tags: row.tags, ttlHours: row.ttlHours, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
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

    // ── GHII (in-memory fallback until Prisma schema is updated) ──

    private ghiis = new Map<string, GHIIRecord>();

    async createGHII(record: GHIIRecord): Promise<GHIIRecord> {
        if (this.ghiis.has(record.ghii)) throw new Error('GHII_TAKEN');
        this.ghiis.set(record.ghii, record);
        return record;
    }

    async getGHII(ghii: string): Promise<GHIIRecord | null> {
        return this.ghiis.get(ghii) ?? null;
    }

    async getGHIIByOwner(ownerName: string): Promise<GHIIRecord | null> {
        for (const r of this.ghiis.values()) {
            if (r.ownerName === ownerName) return r;
        }
        return null;
    }

    async updateGHII(ghii: string, updates: Partial<GHIIRecord>): Promise<GHIIRecord | null> {
        const record = this.ghiis.get(ghii);
        if (!record) return null;
        Object.assign(record, updates, { updatedAt: new Date().toISOString() });
        return record;
    }

    async listGHIIs(opts?: { q?: string; level?: number }): Promise<GHIIRecord[]> {
        let results = [...this.ghiis.values()];
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
        return this.ghiis.delete(ghii);
    }
}
