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
                flagCount: record.flagCount ?? 0,
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
        return { key: row.key, ownerGaii: row.ownerGaii, value: row.value, visibility: row.visibility as any, tags: row.tags, ttlHours: row.ttlHours, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), flagCount: row.flagCount ?? undefined };
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

    private personalNodes = new Map<string, PersonalNodeRecord>();
    private mailboxItems = new Map<string, MailboxItemRecord>();

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

    // ── Chat Instances (in-memory fallback until Prisma schema is updated) ──

    private chatInstances = new Map<string, ChatInstanceRecord>();

    async createChatInstance(record: ChatInstanceRecord): Promise<ChatInstanceRecord> {
        this.chatInstances.set(record.id, record);
        return record;
    }

    async getChatInstance(id: string): Promise<ChatInstanceRecord | null> {
        return this.chatInstances.get(id) ?? null;
    }

    async listChatInstances(opts?: { ownerName?: string; platform?: string; ghii?: string }): Promise<ChatInstanceRecord[]> {
        let results = [...this.chatInstances.values()];
        if (opts?.ownerName) results = results.filter(r => r.ownerName === opts.ownerName);
        if (opts?.platform) results = results.filter(r => r.platform === opts.platform);
        if (opts?.ghii) results = results.filter(r => r.ghii === opts.ghii);
        return results;
    }

    async updateChatInstance(id: string, updates: Partial<ChatInstanceRecord>): Promise<ChatInstanceRecord | null> {
        const record = this.chatInstances.get(id);
        if (!record) return null;
        Object.assign(record, updates);
        return record;
    }

    async deleteChatInstance(id: string): Promise<boolean> {
        return this.chatInstances.delete(id);
    }

    // ── Personal Nodes ──

    async createPersonalNode(node: PersonalNodeRecord): Promise<PersonalNodeRecord> {
        this.personalNodes.set(node.nodeId, { ...node });
        return { ...node };
    }

    async getPersonalNode(nodeId: string): Promise<PersonalNodeRecord | null> {
        const node = this.personalNodes.get(nodeId);
        return node ? { ...node } : null;
    }

    async getPersonalNodeByOwner(ownerName: string): Promise<PersonalNodeRecord | null> {
        for (const node of this.personalNodes.values()) {
            if (node.ownerName === ownerName) return { ...node };
        }
        return null;
    }

    async listPersonalNodes(opts?: { status?: string }): Promise<PersonalNodeRecord[]> {
        let results = [...this.personalNodes.values()];
        if (opts?.status) {
            results = results.filter(n => n.status === opts.status);
        }
        return results.map(n => ({ ...n }));
    }

    async updatePersonalNode(nodeId: string, updates: Partial<PersonalNodeRecord>): Promise<PersonalNodeRecord | null> {
        const node = this.personalNodes.get(nodeId);
        if (!node) return null;
        Object.assign(node, updates, { updatedAt: new Date().toISOString() });
        return { ...node };
    }

    async deletePersonalNode(nodeId: string): Promise<boolean> {
        return this.personalNodes.delete(nodeId);
    }

    // ── Mailbox ──

    async createMailboxItem(item: MailboxItemRecord): Promise<MailboxItemRecord> {
        this.mailboxItems.set(item.id, { ...item });
        const node = this.personalNodes.get(item.personalNodeId);
        if (node) node.mailboxUsedBytes += item.sizeBytes;
        return { ...item };
    }

    async getMailboxItem(id: string): Promise<MailboxItemRecord | null> {
        const item = this.mailboxItems.get(id);
        return item ? { ...item } : null;
    }

    async listMailboxItems(personalNodeId: string, opts?: { type?: string; limit?: number }): Promise<MailboxItemRecord[]> {
        let results = [...this.mailboxItems.values()]
            .filter(i => i.personalNodeId === personalNodeId)
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        if (opts?.type) results = results.filter(i => i.type === opts.type);
        if (opts?.limit) results = results.slice(0, opts.limit);
        return results.map(i => ({ ...i }));
    }

    async deleteMailboxItem(id: string): Promise<boolean> {
        const item = this.mailboxItems.get(id);
        if (!item) return false;
        const node = this.personalNodes.get(item.personalNodeId);
        if (node) node.mailboxUsedBytes = Math.max(0, node.mailboxUsedBytes - item.sizeBytes);
        return this.mailboxItems.delete(id);
    }

    async deleteMailboxItemsByNode(personalNodeId: string): Promise<number> {
        let count = 0;
        for (const [id, item] of this.mailboxItems) {
            if (item.personalNodeId === personalNodeId) {
                this.mailboxItems.delete(id);
                count++;
            }
        }
        const node = this.personalNodes.get(personalNodeId);
        if (node) node.mailboxUsedBytes = 0;
        return count;
    }

    async getMailboxStats(personalNodeId: string): Promise<{ count: number; totalBytes: number }> {
        let count = 0;
        let totalBytes = 0;
        for (const item of this.mailboxItems.values()) {
            if (item.personalNodeId === personalNodeId) {
                count++;
                totalBytes += item.sizeBytes;
            }
        }
        return { count, totalBytes };
    }

    async cleanExpiredMailboxItems(): Promise<number> {
        const now = Date.now();
        let count = 0;
        for (const [id, item] of this.mailboxItems) {
            if (new Date(item.expiresAt).getTime() < now) {
                const node = this.personalNodes.get(item.personalNodeId);
                if (node) node.mailboxUsedBytes = Math.max(0, node.mailboxUsedBytes - item.sizeBytes);
                this.mailboxItems.delete(id);
                count++;
            }
        }
        return count;
    }

    // ── Maintenance Mode ────────────────────────────────────────

    async getMaintenanceMode(): Promise<import('./interface.js').MaintenanceState> {
        this.ensureReady();
        const row = await this.prisma.systemSetting.findUnique({ where: { key: 'maintenance' } });
        if (!row) return { enabled: false, message: '', enabledAt: null, enabledBy: null };
        return JSON.parse(row.value) as import('./interface.js').MaintenanceState;
    }

    async setMaintenanceMode(state: import('./interface.js').MaintenanceState): Promise<import('./interface.js').MaintenanceState> {
        this.ensureReady();
        await this.prisma.systemSetting.upsert({
            where: { key: 'maintenance' },
            create: { key: 'maintenance', value: JSON.stringify(state) },
            update: { value: JSON.stringify(state) },
        });
        return state;
    }

    // ── Schema Locking (in-memory fallback until Prisma schema is updated) ──

    private schemas = new Map<string, SchemaRecord>();
    private consents = new Map<string, ConsentRecord>();
    private consentAudit: ConsentAuditEntry[] = [];
    private csms = new Map<string, CsmRecord>();

    async setSchema(record: SchemaRecord): Promise<SchemaRecord> {
        const storageKey = `${record.applyTo}:${record.keyPattern}`;
        this.schemas.set(storageKey, record);
        return record;
    }

    async getSchema(keyPattern: string, applyTo?: 'exact' | 'prefix'): Promise<SchemaRecord | null> {
        if (applyTo) {
            return this.schemas.get(`${applyTo}:${keyPattern}`) ?? null;
        }
        return this.schemas.get(`exact:${keyPattern}`) ?? this.schemas.get(`prefix:${keyPattern}`) ?? null;
    }

    async deleteSchema(keyPattern: string): Promise<boolean> {
        const deleted1 = this.schemas.delete(`exact:${keyPattern}`);
        const deleted2 = this.schemas.delete(`prefix:${keyPattern}`);
        return deleted1 || deleted2;
    }

    async listSchemas(prefix?: string): Promise<SchemaRecord[]> {
        const results: SchemaRecord[] = [];
        for (const record of this.schemas.values()) {
            if (!prefix || record.keyPattern.startsWith(prefix)) {
                results.push(record);
            }
        }
        return results;
    }

    async findApplicableSchema(memoryKey: string): Promise<SchemaRecord | null> {
        // 1. Exact match — highest priority
        const exact = this.schemas.get(`exact:${memoryKey}`);
        if (exact) return exact;

        // 2. Wildcard pattern match — supports profile.*.interests style
        let bestWildcard: SchemaRecord | null = null;
        let bestSegments = 0;
        for (const record of this.schemas.values()) {
            if (record.applyTo !== 'prefix') continue;
            if (!record.keyPattern.includes('*')) continue;
            if (mongoMatchWildcardPattern(record.keyPattern, memoryKey)) {
                const segments = record.keyPattern.split('.').length;
                if (segments > bestSegments) {
                    bestWildcard = record;
                    bestSegments = segments;
                }
            }
        }
        if (bestWildcard) return bestWildcard;

        // 3. Simple prefix match — longest prefix wins
        const parts = memoryKey.split('.');
        for (let i = parts.length - 1; i >= 1; i--) {
            const prefix = parts.slice(0, i).join('.');
            const prefixSchema = this.schemas.get(`prefix:${prefix}`);
            if (prefixSchema) return prefixSchema;
        }

        return null;
    }

    // ── Consent Layer (in-memory fallback until Prisma schema is updated) ──

    async createConsent(record: ConsentRecord): Promise<ConsentRecord> {
        this.consents.set(record.id, record);
        return record;
    }

    async getConsent(id: string): Promise<ConsentRecord | null> {
        return this.consents.get(id) ?? null;
    }

    async listConsents(ownerGaii: string, opts?: {
        status?: 'active' | 'revoked' | 'expired';
        recipient?: string;
    }): Promise<ConsentRecord[]> {
        const results: ConsentRecord[] = [];
        for (const c of this.consents.values()) {
            if (c.ownerGaii !== ownerGaii) continue;
            if (opts?.status && c.status !== opts.status) continue;
            if (opts?.recipient && c.recipient !== opts.recipient) continue;
            results.push(c);
        }
        return results;
    }

    async updateConsent(id: string, updates: Partial<ConsentRecord>): Promise<ConsentRecord | null> {
        const existing = this.consents.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...updates };
        this.consents.set(id, updated);
        return updated;
    }

    async deleteConsent(id: string): Promise<boolean> {
        return this.consents.delete(id);
    }

    async findMatchingConsents(ownerGaii: string, memoryKey: string, accessorGaii: string): Promise<ConsentRecord[]> {
        const now = new Date().toISOString();
        const results: ConsentRecord[] = [];

        for (const consent of this.consents.values()) {
            if (consent.ownerGaii !== ownerGaii) continue;
            if (consent.status !== 'active') continue;

            // Check expiration
            if (consent.expires && consent.expires < now) {
                consent.status = 'expired';
                continue;
            }

            // Check recipient
            if (consent.recipient !== '*' && consent.recipient !== accessorGaii) continue;

            // Check data_pattern (glob match)
            if (!mongoConsentMatchPattern(consent.dataPattern, memoryKey)) continue;

            results.push(consent);
        }

        return results;
    }

    // Consent Audit
    async addConsentAuditEntry(entry: ConsentAuditEntry): Promise<ConsentAuditEntry> {
        this.consentAudit.push(entry);
        return entry;
    }

    async listConsentAudit(ownerGaii: string, opts?: {
        days?: number;
        consentId?: string;
        accessorGaii?: string;
    }): Promise<ConsentAuditEntry[]> {
        const cutoff = opts?.days
            ? new Date(Date.now() - opts.days * 86400000).toISOString()
            : null;

        return this.consentAudit.filter(e => {
            if (e.ownerGaii !== ownerGaii) return false;
            if (cutoff && e.timestamp < cutoff) return false;
            if (opts?.consentId && e.consentId !== opts.consentId) return false;
            if (opts?.accessorGaii && e.accessorGaii !== opts.accessorGaii) return false;
            return true;
        });
    }

    // ── CSM — Community Service Manifest (in-memory fallback) ──

    async createCsm(record: CsmRecord): Promise<CsmRecord> {
        if (this.csms.has(record.name)) throw new Error('CSM_NAME_TAKEN');
        this.csms.set(record.name, record);
        return record;
    }

    async getCsm(name: string): Promise<CsmRecord | null> {
        return this.csms.get(name) ?? null;
    }

    async listCsms(opts?: { serviceType?: string }): Promise<CsmRecord[]> {
        const results: CsmRecord[] = [];
        for (const csm of this.csms.values()) {
            if (opts?.serviceType && csm.serviceType !== opts.serviceType) continue;
            results.push(csm);
        }
        return results;
    }

    async updateCsm(name: string, updates: Partial<CsmRecord>): Promise<CsmRecord | null> {
        const existing = this.csms.get(name);
        if (!existing) return null;
        const updated = { ...existing, ...updates, name: existing.name };
        this.csms.set(name, updated);
        return updated;
    }

    async deleteCsm(name: string): Promise<boolean> {
        return this.csms.delete(name);
    }

    // ── MSM — Machine Service Manifest (in-memory fallback) ──
    // TODO: Migrate to MongoDB collection ('msm') when persistence is needed.
    // Current in-memory implementation means MSM data does not survive restarts.

    private msms = new Map<string, MsmRecord>();

    async createMsm(record: MsmRecord): Promise<MsmRecord> {
        if (this.msms.has(record.name)) throw new Error('MSM_NAME_TAKEN');
        this.msms.set(record.name, record);
        return record;
    }

    async getMsm(name: string): Promise<MsmRecord | null> {
        return this.msms.get(name) ?? null;
    }

    async listMsms(opts?: { category?: string }): Promise<MsmRecord[]> {
        let results = [...this.msms.values()];
        if (opts?.category) results = results.filter(m => m.category === opts.category);
        return results;
    }

    async updateMsm(name: string, updates: Partial<MsmRecord>): Promise<MsmRecord | null> {
        const existing = this.msms.get(name);
        if (!existing) return null;
        const updated = { ...existing, ...updates, name: existing.name, updatedAt: new Date().toISOString() };
        this.msms.set(name, updated);
        return updated;
    }

    async deleteMsm(name: string): Promise<boolean> {
        return this.msms.delete(name);
    }

    // ── Email Verification (in-memory fallback until Prisma schema is updated) ──

    private emailVerifications = new Map<string, EmailVerificationRecord>();

    async createEmailVerification(record: EmailVerificationRecord): Promise<EmailVerificationRecord> {
        this.emailVerifications.set(record.id, record);
        return record;
    }

    async getEmailVerification(id: string): Promise<EmailVerificationRecord | null> {
        return this.emailVerifications.get(id) ?? null;
    }

    async getActiveEmailVerification(ownerName: string, purpose: string): Promise<EmailVerificationRecord | null> {
        const now = new Date().toISOString();
        for (const record of this.emailVerifications.values()) {
            if (record.ownerName === ownerName && record.purpose === purpose &&
                record.status === 'pending' && record.expiresAt > now) {
                return record;
            }
        }
        return null;
    }

    async updateEmailVerification(id: string, updates: Partial<EmailVerificationRecord>): Promise<EmailVerificationRecord | null> {
        const existing = this.emailVerifications.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...updates };
        this.emailVerifications.set(id, updated);
        return updated;
    }

    async deleteExpiredEmailVerifications(): Promise<number> {
        const now = new Date().toISOString();
        let count = 0;
        for (const [id, record] of this.emailVerifications) {
            if (record.status === 'pending' && record.expiresAt < now) {
                this.emailVerifications.delete(id);
                count++;
            }
        }
        return count;
    }

    // ── Flags (Phase 1.5) ──────────────────────────────────

    private flags = new Map<string, import('./interface.js').FlagRecord>();

    async createFlag(record: import('./interface.js').FlagRecord): Promise<import('./interface.js').FlagRecord> {
        this.flags.set(record.id, record);
        return record;
    }

    async getFlag(id: string): Promise<import('./interface.js').FlagRecord | null> {
        return this.flags.get(id) ?? null;
    }

    async getFlagsByTarget(targetType: string, targetId: string): Promise<import('./interface.js').FlagRecord[]> {
        return [...this.flags.values()].filter(
            f => f.targetType === targetType && f.targetId === targetId,
        );
    }

    async getFlagByUser(targetType: string, targetId: string, flaggedBy: string): Promise<import('./interface.js').FlagRecord | null> {
        for (const f of this.flags.values()) {
            if (f.targetType === targetType && f.targetId === targetId && f.flaggedBy === flaggedBy) {
                return f;
            }
        }
        return null;
    }

    async getFlagSummary(targetType: string, targetId: string): Promise<import('./interface.js').FlagSummary | null> {
        const matching = [...this.flags.values()].filter(
            f => f.targetType === targetType && f.targetId === targetId,
        );
        if (matching.length === 0) return null;

        const byReason: Record<string, number> = {};
        let latestFlag = '';
        for (const f of matching) {
            byReason[f.reason] = (byReason[f.reason] ?? 0) + 1;
            if (f.createdAt > latestFlag) latestFlag = f.createdAt;
        }

        return {
            targetType,
            targetId,
            totalFlags: matching.length,
            byReason,
            latestFlag,
        };
    }

    async updateFlag(id: string, updates: Partial<import('./interface.js').FlagRecord>): Promise<import('./interface.js').FlagRecord | null> {
        const existing = this.flags.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...updates };
        this.flags.set(id, updated);
        return updated;
    }

    async listFlags(opts?: { status?: string; targetType?: string; page?: number; perPage?: number }): Promise<import('./interface.js').FlagRecord[]> {
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        let results = [...this.flags.values()];

        if (opts?.status) results = results.filter(f => f.status === opts.status);
        if (opts?.targetType) results = results.filter(f => f.targetType === opts.targetType);

        // Sort newest first
        results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const start = (page - 1) * perPage;
        return results.slice(start, start + perPage);
    }

    // ── Matches (Phase 2.1 — in-memory fallback until Prisma schema is updated) ──

    private matchRecords = new Map<string, import('./interface.js').MatchRecord>();

    async createMatch(record: import('./interface.js').MatchRecord): Promise<import('./interface.js').MatchRecord> {
        this.matchRecords.set(record.id, record);
        return record;
    }

    async getMatch(id: string): Promise<import('./interface.js').MatchRecord | null> {
        return this.matchRecords.get(id) ?? null;
    }

    async getMatchByPair(profileA: string, profileB: string): Promise<import('./interface.js').MatchRecord | null> {
        for (const m of this.matchRecords.values()) {
            if (
                (m.profileA === profileA && m.profileB === profileB) ||
                (m.profileA === profileB && m.profileB === profileA)
            ) {
                return m;
            }
        }
        return null;
    }

    async listMatchesByProfile(profile: string, opts?: { status?: string; page?: number; perPage?: number }): Promise<import('./interface.js').MatchRecord[]> {
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 10;
        let results = [...this.matchRecords.values()].filter(
            m => m.profileA === profile || m.profileB === profile,
        );

        if (opts?.status) results = results.filter(m => m.status === opts.status);

        // Sort newest first
        results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const start = (page - 1) * perPage;
        return results.slice(start, start + perPage);
    }

    async updateMatch(id: string, updates: Partial<import('./interface.js').MatchRecord>): Promise<import('./interface.js').MatchRecord | null> {
        const existing = this.matchRecords.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...updates };
        this.matchRecords.set(id, updated);
        return updated;
    }

    async deleteExpiredMatches(): Promise<number> {
        const now = Date.now();
        let count = 0;
        for (const [id, match] of this.matchRecords) {
            if (new Date(match.expiresAt).getTime() < now && match.status !== 'accepted') {
                this.matchRecords.delete(id);
                count++;
            }
        }
        return count;
    }

    async listAllMatches(): Promise<import('./interface.js').MatchRecord[]> {
        return Array.from(this.matchRecords.values());
    }

    // ── Organisms (Phase 2.2 — in-memory fallback until Prisma schema is updated) ──

    private organismRecords = new Map<string, import('./interface.js').OrganismRecord>();
    private membershipRecords = new Map<string, import('./interface.js').OrganismMembershipRecord>();
    private joinRequestRecords = new Map<string, import('./interface.js').JoinRequestRecord>();

    async createOrganism(record: import('./interface.js').OrganismRecord): Promise<import('./interface.js').OrganismRecord> {
        this.organismRecords.set(record.id, record);
        return record;
    }

    async getOrganism(id: string): Promise<import('./interface.js').OrganismRecord | null> {
        return this.organismRecords.get(id) ?? null;
    }

    async listOrganisms(opts?: { type?: string; city?: string; interest?: string; visibility?: string; page?: number; perPage?: number }): Promise<import('./interface.js').OrganismRecord[]> {
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        let results = [...this.organismRecords.values()];

        if (opts?.type) results = results.filter(o => o.type === opts.type);
        if (opts?.city) results = results.filter(o => o.location?.city?.toLowerCase() === opts.city!.toLowerCase());
        if (opts?.interest) results = results.filter(o => o.interests.some(i => i.toLowerCase() === opts.interest!.toLowerCase()));
        if (opts?.visibility) results = results.filter(o => o.visibility === opts.visibility);

        results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const start = (page - 1) * perPage;
        return results.slice(start, start + perPage);
    }

    async updateOrganism(id: string, updates: Partial<import('./interface.js').OrganismRecord>): Promise<import('./interface.js').OrganismRecord | null> {
        const existing = this.organismRecords.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...updates, id: existing.id };
        this.organismRecords.set(id, updated);
        return updated;
    }

    async deleteOrganism(id: string): Promise<boolean> {
        for (const [mid, m] of this.membershipRecords) {
            if (m.organismId === id) this.membershipRecords.delete(mid);
        }
        for (const [jid, j] of this.joinRequestRecords) {
            if (j.organismId === id) this.joinRequestRecords.delete(jid);
        }
        return this.organismRecords.delete(id);
    }

    async createMembership(record: import('./interface.js').OrganismMembershipRecord): Promise<import('./interface.js').OrganismMembershipRecord> {
        this.membershipRecords.set(record.id, record);
        return record;
    }

    async getMembership(organismId: string, ghii: string): Promise<import('./interface.js').OrganismMembershipRecord | null> {
        for (const m of this.membershipRecords.values()) {
            if (m.organismId === organismId && m.ghii === ghii) return m;
        }
        return null;
    }

    async listMembers(organismId: string, opts?: { role?: string; status?: string }): Promise<import('./interface.js').OrganismMembershipRecord[]> {
        let results = [...this.membershipRecords.values()].filter(m => m.organismId === organismId);
        if (opts?.role) results = results.filter(m => m.role === opts.role);
        if (opts?.status) results = results.filter(m => m.status === opts.status);
        return results;
    }

    async listMembershipsByGhii(ghii: string): Promise<import('./interface.js').OrganismMembershipRecord[]> {
        return [...this.membershipRecords.values()].filter(m => m.ghii === ghii);
    }

    async updateMembership(id: string, updates: Partial<import('./interface.js').OrganismMembershipRecord>): Promise<import('./interface.js').OrganismMembershipRecord | null> {
        const existing = this.membershipRecords.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...updates, id: existing.id };
        this.membershipRecords.set(id, updated);
        return updated;
    }

    async deleteMembership(id: string): Promise<boolean> {
        return this.membershipRecords.delete(id);
    }

    async createJoinRequest(record: import('./interface.js').JoinRequestRecord): Promise<import('./interface.js').JoinRequestRecord> {
        this.joinRequestRecords.set(record.id, record);
        return record;
    }

    async getJoinRequest(id: string): Promise<import('./interface.js').JoinRequestRecord | null> {
        return this.joinRequestRecords.get(id) ?? null;
    }

    async listJoinRequests(organismId: string, opts?: { status?: string }): Promise<import('./interface.js').JoinRequestRecord[]> {
        let results = [...this.joinRequestRecords.values()].filter(j => j.organismId === organismId);
        if (opts?.status) results = results.filter(j => j.status === opts.status);
        return results;
    }

    async updateJoinRequest(id: string, updates: Partial<import('./interface.js').JoinRequestRecord>): Promise<import('./interface.js').JoinRequestRecord | null> {
        const existing = this.joinRequestRecords.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...updates, id: existing.id };
        this.joinRequestRecords.set(id, updated);
        return updated;
    }

    // ── Appeals (Phase 2.4 — in-memory fallback until Prisma schema is updated) ──

    private appealRecords = new Map<string, import('./interface.js').AppealRecord>();

    async createAppeal(record: import('./interface.js').AppealRecord): Promise<import('./interface.js').AppealRecord> {
        this.appealRecords.set(record.id, record);
        return record;
    }

    async getAppeal(id: string): Promise<import('./interface.js').AppealRecord | null> {
        return this.appealRecords.get(id) ?? null;
    }

    async getAppealByFlagId(flagId: string): Promise<import('./interface.js').AppealRecord | null> {
        for (const a of this.appealRecords.values()) {
            if (a.flagId === flagId) return a;
        }
        return null;
    }

    async listAppeals(opts?: { status?: string; page?: number; perPage?: number }): Promise<import('./interface.js').AppealRecord[]> {
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        let results = [...this.appealRecords.values()];

        if (opts?.status) results = results.filter(a => a.status === opts.status);

        // Sort newest first
        results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const start = (page - 1) * perPage;
        return results.slice(start, start + perPage);
    }

    async updateAppeal(id: string, updates: Partial<import('./interface.js').AppealRecord>): Promise<import('./interface.js').AppealRecord | null> {
        const existing = this.appealRecords.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...updates, id: existing.id };
        this.appealRecords.set(id, updated);
        return updated;
    }

    // ── Marketplace (Phase 2.6 — in-memory fallback until Prisma schema is updated) ──

    private listingRecords = new Map<string, import('./interface.js').ListingRecord>();
    private purchaseRecords = new Map<string, import('./interface.js').PurchaseRecord>();

    async createListing(record: import('./interface.js').ListingRecord): Promise<import('./interface.js').ListingRecord> {
        this.listingRecords.set(record.id, record);
        return record;
    }

    async getListing(id: string): Promise<import('./interface.js').ListingRecord | null> {
        return this.listingRecords.get(id) ?? null;
    }

    async listListings(opts?: { category?: string; city?: string; minPrice?: number; maxPrice?: number; status?: string; sellerOwner?: string; page?: number; perPage?: number }): Promise<import('./interface.js').ListingRecord[]> {
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        let results = [...this.listingRecords.values()];

        if (opts?.category) results = results.filter(l => l.category === opts.category);
        if (opts?.city) results = results.filter(l => l.location?.city?.toLowerCase() === opts.city!.toLowerCase());
        if (opts?.minPrice !== undefined) results = results.filter(l => l.priceMorsels >= opts.minPrice!);
        if (opts?.maxPrice !== undefined) results = results.filter(l => l.priceMorsels <= opts.maxPrice!);
        if (opts?.status) results = results.filter(l => l.status === opts.status);
        if (opts?.sellerOwner) results = results.filter(l => l.ownerName === opts.sellerOwner);

        results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const start = (page - 1) * perPage;
        return results.slice(start, start + perPage);
    }

    async updateListing(id: string, updates: Partial<import('./interface.js').ListingRecord>): Promise<import('./interface.js').ListingRecord | null> {
        const existing = this.listingRecords.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...updates, id: existing.id };
        this.listingRecords.set(id, updated);
        return updated;
    }

    async deleteListing(id: string): Promise<boolean> {
        return this.listingRecords.delete(id);
    }

    async createPurchase(record: import('./interface.js').PurchaseRecord): Promise<import('./interface.js').PurchaseRecord> {
        this.purchaseRecords.set(record.id, record);
        return record;
    }

    async getPurchase(id: string): Promise<import('./interface.js').PurchaseRecord | null> {
        return this.purchaseRecords.get(id) ?? null;
    }

    async listPurchasesByBuyer(buyerOwner: string): Promise<import('./interface.js').PurchaseRecord[]> {
        return [...this.purchaseRecords.values()]
            .filter(p => p.buyerOwner === buyerOwner)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    async listPurchasesBySeller(sellerOwner: string): Promise<import('./interface.js').PurchaseRecord[]> {
        return [...this.purchaseRecords.values()]
            .filter(p => p.sellerOwner === sellerOwner)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    async updatePurchase(id: string, updates: Partial<import('./interface.js').PurchaseRecord>): Promise<import('./interface.js').PurchaseRecord | null> {
        const existing = this.purchaseRecords.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...updates, id: existing.id };
        this.purchaseRecords.set(id, updated);
        return updated;
    }

    // ── Push Subscriptions (Phase 3.1) ──
    private pushSubscriptions = new Map<string, PushSubscriptionRecord>();
    private trustedIssuers = new Map<string, TrustedIssuerRecord>();

    async createPushSubscription(record: PushSubscriptionRecord): Promise<PushSubscriptionRecord> {
        this.pushSubscriptions.set(record.ownerName, record);
        return record;
    }
    async getPushSubscription(ownerName: string): Promise<PushSubscriptionRecord | null> {
        return this.pushSubscriptions.get(ownerName) ?? null;
    }
    async deletePushSubscription(ownerName: string): Promise<boolean> {
        return this.pushSubscriptions.delete(ownerName);
    }
    async listPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
        return [...this.pushSubscriptions.values()];
    }

    // ── Trusted Issuers (Phase 3.3) ──

    async createTrustedIssuer(record: TrustedIssuerRecord): Promise<TrustedIssuerRecord> {
        this.trustedIssuers.set(record.id, record);
        return record;
    }
    async getTrustedIssuer(id: string): Promise<TrustedIssuerRecord | null> {
        return this.trustedIssuers.get(id) ?? null;
    }
    async getTrustedIssuerByUrl(url: string): Promise<TrustedIssuerRecord | null> {
        for (const issuer of this.trustedIssuers.values()) {
            if (issuer.url === url) return issuer;
        }
        return null;
    }
    async listTrustedIssuers(opts?: { type?: string }): Promise<TrustedIssuerRecord[]> {
        let issuers = [...this.trustedIssuers.values()];
        if (opts?.type) issuers = issuers.filter(i => i.type === opts.type);
        return issuers;
    }
    async deleteTrustedIssuer(id: string): Promise<boolean> {
        return this.trustedIssuers.delete(id);
    }

    // ── Genesis Peers (Phase 3.4) ──

    private genesisPeers = new Map<string, import('./interface.js').GenesisPeerRecord>();
    private organismReputations = new Map<string, import('./interface.js').OrganismReputationRecord>();

    async createGenesisPeer(record: import('./interface.js').GenesisPeerRecord): Promise<import('./interface.js').GenesisPeerRecord> {
        this.genesisPeers.set(record.id, record);
        return record;
    }
    async getGenesisPeer(id: string): Promise<import('./interface.js').GenesisPeerRecord | null> {
        return this.genesisPeers.get(id) ?? null;
    }
    async getGenesisPeerByNodeId(nodeId: string): Promise<import('./interface.js').GenesisPeerRecord | null> {
        for (const peer of this.genesisPeers.values()) {
            if (peer.genesisNodeId === nodeId) return peer;
        }
        return null;
    }
    async listGenesisPeers(opts?: { status?: string }): Promise<import('./interface.js').GenesisPeerRecord[]> {
        let peers = [...this.genesisPeers.values()];
        if (opts?.status) peers = peers.filter(p => p.status === opts.status);
        return peers;
    }
    async updateGenesisPeer(id: string, updates: Partial<import('./interface.js').GenesisPeerRecord>): Promise<import('./interface.js').GenesisPeerRecord | null> {
        const peer = this.genesisPeers.get(id);
        if (!peer) return null;
        const updated = { ...peer, ...updates };
        this.genesisPeers.set(id, updated);
        return updated;
    }
    async deleteGenesisPeer(id: string): Promise<boolean> {
        return this.genesisPeers.delete(id);
    }

    // ── Organism Reputation (Phase 3.4) ──

    async setOrganismReputation(record: import('./interface.js').OrganismReputationRecord): Promise<import('./interface.js').OrganismReputationRecord> {
        this.organismReputations.set(record.organismId, record);
        return record;
    }
    async getOrganismReputation(organismId: string): Promise<import('./interface.js').OrganismReputationRecord | null> {
        return this.organismReputations.get(organismId) ?? null;
    }

    // ── Realtime rooms (MongoDB-backed via Prisma) ──

    async createRealtimeRoom(record: import('./interface.js').RealtimeRoomRecord): Promise<import('./interface.js').RealtimeRoomRecord> {
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
    async getRealtimeRoom(id: string): Promise<import('./interface.js').RealtimeRoomRecord | null> {
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
    async listRealtimeRooms(filter?: { appType?: string; isPublic?: boolean }): Promise<import('./interface.js').RealtimeRoomRecord[]> {
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
    async updateRealtimeRoom(id: string, updates: Partial<import('./interface.js').RealtimeRoomRecord>): Promise<import('./interface.js').RealtimeRoomRecord | null> {
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

    // ── Node Extensions (stubs) ──────────────────────────────────

    async createExtension(_record: ExtensionRecord): Promise<ExtensionRecord> {
        throw new Error('Not implemented');
    }
    async getExtension(_name: string): Promise<ExtensionRecord | null> {
        throw new Error('Not implemented');
    }
    async listExtensions(_opts?: { status?: string }): Promise<ExtensionRecord[]> {
        throw new Error('Not implemented');
    }
    async updateExtension(_name: string, _updates: Partial<ExtensionRecord>): Promise<ExtensionRecord | null> {
        throw new Error('Not implemented');
    }
    async deleteExtension(_name: string): Promise<boolean> {
        throw new Error('Not implemented');
    }

    // ── Generic Escrow (stubs) ───────────────────────────────────

    async createEscrowHold(_record: EscrowHoldRecord): Promise<EscrowHoldRecord> {
        throw new Error('Not implemented');
    }
    async getEscrowHold(_holdId: string): Promise<EscrowHoldRecord | null> {
        throw new Error('Not implemented');
    }
    async listEscrowHolds(_fromGaii: string, _opts?: { status?: string }): Promise<EscrowHoldRecord[]> {
        throw new Error('Not implemented');
    }
    async releaseEscrowHold(_holdId: string, _toGaii: string): Promise<EscrowHoldRecord | null> {
        throw new Error('Not implemented');
    }
    async refundEscrowHold(_holdId: string): Promise<EscrowHoldRecord | null> {
        throw new Error('Not implemented');
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
