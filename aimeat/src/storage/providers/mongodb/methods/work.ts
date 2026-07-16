/**
 * @file src/storage/providers/mongodb/methods/work.ts
 * @description Actions, work, transactions, boards, OTK, disputes, and micro-memory methods. Extracted from mongodb/index.ts (PrismaStorage) to satisfy max-file-lines; method bodies verbatim, bound to PrismaStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/mongodb/index.ts (max-file-lines)
 */
import type {
  ActionRecord, WorkRecord, WalletTransaction, BoardRecord, BoardPostRecord, OtkRecord, DisputeRecord, DisputeAuditEntry, MicroMemoryRecord
} from '../../../interface.js';
import type { PrismaStorage, PrismaRow } from '../index.js';

export const workMethods = {
    // ── Actions ─────────────────────────────────────────────────

    async createAction(this: PrismaStorage, action: ActionRecord): Promise<ActionRecord> {
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
                pricingPerUnit: action.pricing.perUnit,
                estimatedTimeSeconds: action.estimatedTimeSeconds,
                maxInputSizeBytes: action.maxInputSizeBytes,
                tags: action.tags,
                webhookUrl: action.webhookUrl ?? null,
                semantic: action.semantic ?? null,
                federate: action.federate ?? false,
                createdAt: new Date(action.createdAt),
                updatedAt: new Date(action.updatedAt),
            },
        });
        return this.toActionRecord(row);
    },

    async getAction(this: PrismaStorage, id: string, providerGaii: string): Promise<ActionRecord | null> {
        this.ensureReady();
        const row = await this.prisma.action.findUnique({
            where: { actionId_providerGaii: { actionId: id, providerGaii } },
        });
        return row ? this.toActionRecord(row) : null;
    },

    async listActions(this: PrismaStorage, opts?: { search?: string; category?: string }): Promise<ActionRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (opts?.category) where.category = opts.category;
        const rows = await this.prisma.action.findMany({ where });
        let results = rows.map((r: PrismaRow) => this.toActionRecord(r));
        if (opts?.search) {
            const q = opts.search.toLowerCase();
            results = results.filter((a: ActionRecord) =>
                a.displayName.toLowerCase().includes(q) ||
                a.description.toLowerCase().includes(q) ||
                a.tags.some(t => t.toLowerCase().includes(q))
            );
        }
        return results;
    },

    async deleteAction(this: PrismaStorage, id: string, providerGaii: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.action.delete({
                where: { actionId_providerGaii: { actionId: id, providerGaii } },
            });
            return true;
        } catch { return false; }
    },

    async deleteActionsByProvider(this: PrismaStorage, gaii: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.action.deleteMany({ where: { providerGaii: gaii } });
        return result.count;
    },

    async listActionsByProvider(this: PrismaStorage, gaii: string): Promise<ActionRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.action.findMany({ where: { providerGaii: gaii } });
        return rows.map((r: PrismaRow) => this.toActionRecord(r));
    },

    async countActionsForProviders(this: PrismaStorage, providerGaiis: string[]): Promise<number> {
        this.ensureReady();
        if (providerGaiis.length === 0) return 0;
        // One count across all the owner's agents — the "services used" figure for the usage summary.
        return this.prisma.action.count({ where: { providerGaii: { in: providerGaiis } } });
    },

    async getMicroMemoryTotalForOwners(this: PrismaStorage, gaiis: string[]): Promise<{ bytes: number; sets: number }> {
        this.ensureReady();
        if (gaiis.length === 0) return { bytes: 0, sets: 0 };
        // One query over the (deprecated) micro-memory sets for all identities, summed in JS — keeps the
        // usage summary off a per-identity fan-out. Sets are tiny; loading them once is cheap.
        const rows = await this.prisma.microMemory.findMany({ where: { gaii: { in: gaiis } }, select: { entries: true } });
        let bytes = 0;
        for (const r of rows) {
            const entries = (r.entries ?? {}) as Record<string, unknown>;
            for (const [k, v] of Object.entries(entries)) bytes += Buffer.byteLength(k, 'utf8') + Buffer.byteLength(String(v), 'utf8');
        }
        return { bytes, sets: rows.length };
    },

    async updateAction(this: PrismaStorage, id: string, providerGaii: string, updates: Partial<ActionRecord>): Promise<ActionRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = { ...updates, updatedAt: new Date() };
            if (updates.pricing) {
                data.pricingBaseMorsels = updates.pricing.baseMorsels;
                data.pricingPerUnit = updates.pricing.perUnit;
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
    },

    // ── Work ────────────────────────────────────────────────────

    async createWork(this: PrismaStorage, work: WorkRecord): Promise<WorkRecord> {
        this.ensureReady();
        const row = await this.prisma.work.create({
            data: {
                trackingCode: work.trackingCode,
                status: work.status,
                actionId: work.actionId,
                providerGaii: work.providerGaii,
                requesterGaii: work.requesterGaii,
                input: work.input,
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
    },

    async getWork(this: PrismaStorage, trackingCode: string): Promise<WorkRecord | null> {
        this.ensureReady();
        const row = await this.prisma.work.findUnique({ where: { trackingCode } });
        return row ? this.toWorkRecord(row) : null;
    },

    async updateWork(this: PrismaStorage, trackingCode: string, updates: Partial<WorkRecord>): Promise<WorkRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.status) data.status = updates.status;
            if (updates.output) data.output = updates.output;
            if (updates.updatedAt) data.updatedAt = new Date(updates.updatedAt);
            if (updates.rating) {
                data.ratingScore = updates.rating.score;
                data.ratingComment = updates.rating.comment;
            }
            const row = await this.prisma.work.update({ where: { trackingCode }, data });
            return this.toWorkRecord(row);
        } catch { return null; }
    },

    async listWorkByProvider(this: PrismaStorage, gaii: string): Promise<WorkRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.work.findMany({ where: { providerGaii: gaii } });
        return rows.map((r: PrismaRow) => this.toWorkRecord(r));
    },

    async countPendingWorkByProviders(this: PrismaStorage, providerGaiis: string[], statuses: string[]): Promise<number> {
        this.ensureReady();
        if (providerGaiis.length === 0 || statuses.length === 0) return 0;
        return this.prisma.work.count({ where: { providerGaii: { in: providerGaiis }, status: { in: statuses } } });
    },

    async listWorkByProviders(this: PrismaStorage, gaiis: string[]): Promise<WorkRecord[]> {
        this.ensureReady();
        if (gaiis.length === 0) return [];
        const rows = await this.prisma.work.findMany({ where: { providerGaii: { in: gaiis } } });
        return rows.map((r: PrismaRow) => this.toWorkRecord(r));
    },

    async listWorkByRequesters(this: PrismaStorage, gaiis: string[]): Promise<WorkRecord[]> {
        this.ensureReady();
        if (gaiis.length === 0) return [];
        const rows = await this.prisma.work.findMany({ where: { requesterGaii: { in: gaiis } } });
        return rows.map((r: PrismaRow) => this.toWorkRecord(r));
    },

    async listWorkByRequester(this: PrismaStorage, gaii: string): Promise<WorkRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.work.findMany({ where: { requesterGaii: gaii } });
        return rows.map((r: PrismaRow) => this.toWorkRecord(r));
    },

    async listAllWork(this: PrismaStorage, limit = 10000): Promise<WorkRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.work.findMany({ take: Math.min(limit, 10000), orderBy: { createdAt: 'desc' } });
        return rows.map((r: PrismaRow) => this.toWorkRecord(r));
    },

    // ── Transactions ────────────────────────────────────────────

    async addTransaction(this: PrismaStorage, tx: WalletTransaction): Promise<WalletTransaction> {
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
    },

    async getTransactions(this: PrismaStorage, gaii: string, limit = 50): Promise<WalletTransaction[]> {
        this.ensureReady();
        const rows = await this.prisma.transaction.findMany({
            where: { gaii },
            orderBy: { timestamp: 'desc' },
            take: limit,
        });
        return rows.map((r: PrismaRow) => ({
            id: r.txId,
            gaii: r.gaii,
            type: r.type,
            amount: r.amount,
            counterpartyGaii: r.counterpartyGaii ?? undefined,
            trackingCode: r.trackingCode ?? undefined,
            timestamp: r.timestamp.toISOString(),
        }));
    },

    async listAllTransactions(this: PrismaStorage, limit = 10000): Promise<WalletTransaction[]> {
        this.ensureReady();
        const rows = await this.prisma.transaction.findMany({
            take: Math.min(limit, 10000),
            orderBy: { timestamp: 'desc' },
        });
        return rows.map((r: PrismaRow) => ({
            id: r.txId,
            gaii: r.gaii,
            type: r.type,
            amount: r.amount,
            counterpartyGaii: r.counterpartyGaii ?? undefined,
            trackingCode: r.trackingCode ?? undefined,
            timestamp: r.timestamp.toISOString(),
        }));
    },

    async deleteTransactions(this: PrismaStorage, gaii: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.transaction.deleteMany({ where: { gaii } });
        return result.count;
    },

    // ── Boards ──────────────────────────────────────────────────

    async createBoard(this: PrismaStorage, board: BoardRecord): Promise<BoardRecord> {
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
    },

    async getBoard(this: PrismaStorage, id: string): Promise<BoardRecord | null> {
        this.ensureReady();
        const row = await this.prisma.board.findUnique({ where: { boardId: id } });
        return row ? this.toBoardRecord(row) : null;
    },

    async listBoards(this: PrismaStorage, opts?: { visibility?: string; ownerGaii?: string }): Promise<BoardRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (opts?.visibility) where.visibility = opts.visibility;
        if (opts?.ownerGaii) where.ownerGaii = opts.ownerGaii;
        const rows = await this.prisma.board.findMany({ where });
        return rows.map((r: PrismaRow) => this.toBoardRecord(r));
    },

    async updateBoardVisibility(this: PrismaStorage, id: string, visibility: string, federate?: boolean): Promise<import('../../../interface.js').BoardRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = { visibility };
            if (federate !== undefined) data.federate = federate;
            const row = await this.prisma.board.update({ where: { boardId: id }, data });
            return this.toBoardRecord(row);
        } catch { return null; }
    },

    async updateBoardMembers(this: PrismaStorage, id: string, allowedGaiis: string[]): Promise<import('../../../interface.js').BoardRecord | null> {
      this.ensureReady();
      try {
        const row = await this.prisma.board.update({ where: { boardId: id }, data: { allowedGaiis } });
        return this.toBoardRecord(row);
      } catch { return null; }
    },

    async deleteBoard(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.board.delete({ where: { boardId: id } });
            await this.prisma.boardPost.deleteMany({ where: { boardId: id } });
            return true;
        } catch { return false; }
    },

    async createPost(this: PrismaStorage, post: BoardPostRecord): Promise<BoardPostRecord> {
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
                reactions: post.reactions,
                replyTo: post.replyTo ?? null,
                createdAt: new Date(post.createdAt),
            },
        });
        return this.toPostRecord(row);
    },

    async getPost(this: PrismaStorage, boardId: string, postId: string): Promise<BoardPostRecord | null> {
        this.ensureReady();
        const row = await this.prisma.boardPost.findFirst({ where: { boardId, postId } });
        return row ? this.toPostRecord(row) : null;
    },

    async listPosts(this: PrismaStorage, boardId: string, opts?: { category?: string; cursor?: string; limit?: number }): Promise<BoardPostRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = { boardId, replyTo: null };
        if (opts?.category) where.category = opts.category;
        const rows = await this.prisma.boardPost.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: opts?.limit ?? 20,
        });
        return rows
            .filter((r: PrismaRow) => !r.ttlExpiresAt || new Date(r.ttlExpiresAt).getTime() > Date.now())
            .map((r: PrismaRow) => this.toPostRecord(r));
    },

    async deletePost(this: PrismaStorage, boardId: string, postId: string): Promise<boolean> {
        this.ensureReady();
        const result = await this.prisma.boardPost.deleteMany({ where: { boardId, postId } });
        return result.count > 0;
    },

    async addReaction(this: PrismaStorage, boardId: string, postId: string, emoji: string, gaii: string): Promise<boolean> {
        this.ensureReady();
        const post = await this.prisma.boardPost.findFirst({ where: { boardId, postId } });
        if (!post) return false;
        const reactions = (post.reactions as Record<string, string[]>) ?? {};
        if (!reactions[emoji]) reactions[emoji] = [];
        if (!reactions[emoji].includes(gaii)) reactions[emoji].push(gaii);
        await this.prisma.boardPost.update({
            where: { postId },
            data: { reactions: reactions },
        });
        return true;
    },

    // ── Board Subscriptions ─────────────────────────────────────

    async createBoardSubscription(this: PrismaStorage, sub: import('../../../interface.js').BoardSubscriptionRecord): Promise<import('../../../interface.js').BoardSubscriptionRecord> {
        this.ensureReady();
        await this.prisma.boardSubscription.upsert({
            where: { boardId_gaii: { boardId: sub.boardId, gaii: sub.gaii } },
            create: { id: sub.id, boardId: sub.boardId, gaii: sub.gaii, callbackUrl: sub.callbackUrl, filters: sub.filters ?? null, createdAt: new Date(sub.createdAt) },
            update: { callbackUrl: sub.callbackUrl, filters: sub.filters ?? null },
        });
        return sub;
    },

    async getBoardSubscription(this: PrismaStorage, boardId: string, gaii: string): Promise<import('../../../interface.js').BoardSubscriptionRecord | null> {
        this.ensureReady();
        const row = await this.prisma.boardSubscription.findUnique({ where: { boardId_gaii: { boardId, gaii } } });
        return row ? this.toBoardSubscriptionRecord(row) : null;
    },

    async listBoardSubscriptions(this: PrismaStorage, boardId: string): Promise<import('../../../interface.js').BoardSubscriptionRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.boardSubscription.findMany({ where: { boardId } });
        return rows.map((r: PrismaRow) => this.toBoardSubscriptionRecord(r));
    },

    async listSubscriptionsByAgent(this: PrismaStorage, gaii: string): Promise<import('../../../interface.js').BoardSubscriptionRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.boardSubscription.findMany({ where: { gaii } });
        return rows.map((r: PrismaRow) => this.toBoardSubscriptionRecord(r));
    },

    async deleteBoardSubscription(this: PrismaStorage, boardId: string, gaii: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.boardSubscription.delete({ where: { boardId_gaii: { boardId, gaii } } });
            return true;
        } catch { return false; }
    },

    toBoardSubscriptionRecord(this: PrismaStorage, row: PrismaRow): import('../../../interface.js').BoardSubscriptionRecord {
        return {
            id: row.id,
            boardId: row.boardId,
            gaii: row.gaii,
            callbackUrl: row.callbackUrl ?? undefined,
            filters: row.filters ?? undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    },

    // ── OTK ─────────────────────────────────────────────────────

    async createOtk(this: PrismaStorage, otk: OtkRecord): Promise<OtkRecord> {
        this.ensureReady();
        await this.prisma.otk.create({
            data: {
                key: otk.key,
                ownerGaii: otk.ownerGaii,
                action: otk.action,
                params: otk.params,
                expiresAt: new Date(otk.expiresAt),
                used: otk.used,
                createdAt: new Date(otk.createdAt),
            },
        });
        return otk;
    },

    toOtkRecord(this: PrismaStorage, row: PrismaRow): OtkRecord {
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
    },

    async getOtk(this: PrismaStorage, key: string): Promise<OtkRecord | null> {
        this.ensureReady();
        const row = await this.prisma.otk.findUnique({ where: { key } });
        if (!row) return null;
        return this.toOtkRecord(row);
    },

    async consumeOtk(this: PrismaStorage, key: string, graceMs: number = 60_000): Promise<OtkRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.otk.findUnique({ where: { key } });
            if (!row) return null;

            // Initial OTK: timer hasn't started yet — activate on first use
            if (row.initial && !row.used) {
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
    },

    async listOtksBySession(this: PrismaStorage, sessionId: string): Promise<OtkRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.otk.findMany({ where: { sessionId } });
        return rows.map((r: PrismaRow) => this.toOtkRecord(r));
    },

    async expireSessionOtks(this: PrismaStorage, sessionId: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.otk.deleteMany({ where: { sessionId } });
        return result.count;
    },

    // ── Disputes ────────────────────────────────────────────────

    async createDispute(this: PrismaStorage, dispute: DisputeRecord): Promise<DisputeRecord> {
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
    },

    async getDispute(this: PrismaStorage, id: string): Promise<DisputeRecord | null> {
        this.ensureReady();
        const row = await this.prisma.dispute.findUnique({ where: { disputeId: id } });
        return row ? this.toDisputeRecord(row) : null;
    },

    async getDisputeByTrackingCode(this: PrismaStorage, tc: string): Promise<DisputeRecord | null> {
        this.ensureReady();
        const row = await this.prisma.dispute.findFirst({ where: { trackingCode: tc } });
        return row ? this.toDisputeRecord(row) : null;
    },

    async updateDispute(this: PrismaStorage, id: string, updates: Partial<DisputeRecord>): Promise<DisputeRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.status) data.status = updates.status;
            if (updates.ruling) data.ruling = updates.ruling;
            if (updates.updatedAt) data.updatedAt = new Date(updates.updatedAt);
            const row = await this.prisma.dispute.update({ where: { disputeId: id }, data });
            return this.toDisputeRecord(row);
        } catch { return null; }
    },

    async addDisputeAuditEntry(this: PrismaStorage, disputeId: string, entry: DisputeAuditEntry): Promise<DisputeAuditEntry> {
        this.ensureReady();
        await this.prisma.disputeAudit.create({
            data: {
                disputeId,
                sequence: entry.sequence,
                event: entry.event,
                actor: entry.actor,
                timestamp: new Date(entry.timestamp),
                data: entry.data,
                hash: entry.hash,
                previousHash: entry.previousHash,
            },
        });
        return entry;
    },

    async getDisputeAuditLog(this: PrismaStorage, disputeId: string): Promise<DisputeAuditEntry[]> {
        this.ensureReady();
        const rows = await this.prisma.disputeAudit.findMany({
            where: { disputeId },
            orderBy: { sequence: 'asc' },
        });
        return rows.map((r: PrismaRow) => ({
            sequence: r.sequence,
            event: r.event,
            actor: r.actor,
            timestamp: r.timestamp.toISOString(),
            data: r.data as Record<string, unknown>,
            hash: r.hash,
            previousHash: r.previousHash,
        }));
    },

    async listDisputesByProvider(this: PrismaStorage, gaii: string): Promise<DisputeRecord[]> {
        this.ensureReady();
        // Find disputes through work items
        const workItems = await this.prisma.work.findMany({
            where: { providerGaii: gaii },
            select: { trackingCode: true },
        });
        const tcs = workItems.map((w: PrismaRow) => w.trackingCode);
        if (tcs.length === 0) return [];
        const rows = await this.prisma.dispute.findMany({ where: { trackingCode: { in: tcs } } });
        return rows.map((r: PrismaRow) => this.toDisputeRecord(r));
    },

    async listAllDisputes(this: PrismaStorage, limit = 10000): Promise<DisputeRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.dispute.findMany({ take: Math.min(limit, 10000), orderBy: { createdAt: 'desc' } });
        return rows.map((r: PrismaRow) => this.toDisputeRecord(r));
    },

    // ── Micro-Memory ────────────────────────────────────────────

    async setMicroMemory(this: PrismaStorage, record: MicroMemoryRecord): Promise<MicroMemoryRecord> {
        this.ensureReady();
        await this.prisma.microMemory.upsert({
            where: { gaii_setName: { gaii: record.gaii, setName: record.set } },
            create: {
                gaii: record.gaii,
                setName: record.set,
                entries: record.entries,
                visibility: record.visibility,
                accessCode: record.accessCode,
                updatedAt: new Date(record.updatedAt),
            },
            update: {
                entries: record.entries,
                visibility: record.visibility,
                accessCode: record.accessCode,
                updatedAt: new Date(record.updatedAt),
            },
        });
        return record;
    },

    async getMicroMemory(this: PrismaStorage, gaii: string, set: string): Promise<MicroMemoryRecord | null> {
        this.ensureReady();
        const row = await this.prisma.microMemory.findUnique({
            where: { gaii_setName: { gaii, setName: set } },
        });
        if (!row) return null;
        return { gaii: row.gaii, set: row.setName, entries: row.entries as Record<string, string>, visibility: row.visibility, accessCode: row.accessCode ?? undefined, updatedAt: row.updatedAt.toISOString() };
    },

    async listMicroMemorySets(this: PrismaStorage, gaii: string): Promise<MicroMemoryRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.microMemory.findMany({ where: { gaii } });
        return rows.map((r: PrismaRow) => ({ gaii: r.gaii, set: r.setName, entries: r.entries as Record<string, string>, visibility: r.visibility, accessCode: r.accessCode ?? undefined, updatedAt: r.updatedAt.toISOString() }));
    },

    async deleteMicroMemory(this: PrismaStorage, gaii: string, set: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.microMemory.delete({ where: { gaii_setName: { gaii, setName: set } } });
            return true;
        } catch { return false; }
    },

    async deleteMicroMemoryEntry(this: PrismaStorage, gaii: string, set: string, key: string): Promise<boolean> {
        this.ensureReady();
        const record = await this.getMicroMemory(gaii, set);
        if (!record || !(key in record.entries)) return false;
        delete record.entries[key];
        await this.setMicroMemory(record);
        return true;
    },

    async findMicroMemoryByAccessCode(this: PrismaStorage, set: string, accessCode: string): Promise<MicroMemoryRecord | null> {
        this.ensureReady();
        const row = await this.prisma.microMemory.findFirst({
            where: {
                setName: set,
                accessCode: accessCode,
                visibility: { in: ['shared_read', 'shared_write'] },
            },
        });
        if (!row) return null;
        return { gaii: row.gaii, set: row.setName, entries: row.entries as Record<string, string>, visibility: row.visibility, accessCode: row.accessCode ?? undefined, updatedAt: row.updatedAt.toISOString() };
    },
};
