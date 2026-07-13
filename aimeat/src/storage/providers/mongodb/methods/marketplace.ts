/**
 * @file src/storage/providers/mongodb/methods/marketplace.ts
 * @description Marketplace, push subscriptions, trusted issuers, genesis peers, realtime rooms, node portal/extensions, escrow, and cortex-extension methods. Extracted from mongodb/index.ts (PrismaStorage) to satisfy max-file-lines; method bodies verbatim, bound to PrismaStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/mongodb/index.ts (max-file-lines)
 */
import type {
  PushSubscriptionRecord, TrustedIssuerRecord, SiteChangeLogEntry, ExtensionRecord, EscrowHoldRecord, CortexExtensionRecord
} from '../../../interface.js';
import type { PrismaStorage, PrismaRow } from '../index.js';

export const marketplaceMethods = {
    // ── Marketplace (Phase 2.6) ──

    async createListing(this: PrismaStorage, record: import('../../../interface.js').ListingRecord): Promise<import('../../../interface.js').ListingRecord> {
        this.ensureReady();
        await this.prisma.listing.create({ data: { id: record.id, ownerName: record.ownerName, sellerGhii: record.sellerGhii, title: record.title, description: record.description, category: record.category, priceMorsels: record.priceMorsels, condition: record.condition, availability: record.availability, location: record.location ?? null, tags: record.tags ?? [], images: record.images ?? [], status: record.status, memoryKey: record.memoryKey, flagCount: record.flagCount, createdAt: new Date(record.createdAt), semantic: record.semantic ?? null } });
        return record;
    },

    async getListing(this: PrismaStorage, id: string): Promise<import('../../../interface.js').ListingRecord | null> {
        this.ensureReady();
        const row = await this.prisma.listing.findUnique({ where: { id } });
        return row ? this.toListingRecord(row) : null;
    },

    async listListings(this: PrismaStorage, opts?: { category?: string; city?: string; minPrice?: number; maxPrice?: number; status?: string; sellerOwner?: string; page?: number; perPage?: number }): Promise<import('../../../interface.js').ListingRecord[]> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where: Record<string, unknown> = {};
        if (opts?.category) where.category = opts.category;
        if (opts?.status) where.status = opts.status;
        if (opts?.sellerOwner) where.ownerName = opts.sellerOwner;
        if (opts?.minPrice !== undefined || opts?.maxPrice !== undefined) {
            where.priceMorsels = {};
            if (opts?.minPrice !== undefined) (where.priceMorsels as Record<string, unknown>).gte = opts.minPrice;
            if (opts?.maxPrice !== undefined) (where.priceMorsels as Record<string, unknown>).lte = opts.maxPrice;
        }
        const rows = await this.prisma.listing.findMany({ where, orderBy: { createdAt: 'desc' } });
        let results = rows.map((r: PrismaRow) => this.toListingRecord(r));
        // city filtering post-query (JSON field)
        if (opts?.city) results = results.filter((l: PrismaRow) => l.location?.city?.toLowerCase() === opts.city!.toLowerCase());
        const start = (page - 1) * perPage;
        return results.slice(start, start + perPage);
    },

    async updateListing(this: PrismaStorage, id: string, updates: Partial<import('../../../interface.js').ListingRecord>): Promise<import('../../../interface.js').ListingRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = { ...updates };
            delete data.id;
            if (data.location) data.location = data.location as unknown;
            if (data.semantic) data.semantic = data.semantic as unknown;
            if (data.createdAt && typeof data.createdAt === 'string') data.createdAt = new Date(data.createdAt);
            if (data.updatedAt && typeof data.updatedAt === 'string') data.updatedAt = new Date(data.updatedAt);
            const row = await this.prisma.listing.update({ where: { id }, data });
            return this.toListingRecord(row);
        } catch { return null; }
    },

    async deleteListing(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.listing.delete({ where: { id } }); return true; } catch { return false; }
    },

    toListingRecord(this: PrismaStorage, row: PrismaRow): import('../../../interface.js').ListingRecord {
        return { id: row.id, ownerName: row.ownerName, sellerGhii: row.sellerGhii, title: row.title, description: row.description, category: row.category, priceMorsels: row.priceMorsels, condition: row.condition ?? undefined, availability: row.availability ?? undefined, location: row.location ?? undefined, tags: row.tags ?? undefined, images: row.images ?? undefined, status: row.status, memoryKey: row.memoryKey, flagCount: row.flagCount, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt, semantic: row.semantic ?? undefined };
    },

    async createPurchase(this: PrismaStorage, record: import('../../../interface.js').PurchaseRecord): Promise<import('../../../interface.js').PurchaseRecord> {
        this.ensureReady();
        await this.prisma.purchase.create({ data: { id: record.id, listingId: record.listingId, buyerOwner: record.buyerOwner, sellerOwner: record.sellerOwner, priceMorsels: record.priceMorsels, transactionFeeMorsels: record.transactionFeeMorsels, totalCostMorsels: record.totalCostMorsels, status: record.status, ratingScore: record.rating?.score, ratingComment: record.rating?.comment, trackingCode: record.trackingCode, createdAt: new Date(record.createdAt), completedAt: record.completedAt ? new Date(record.completedAt) : null } });
        return record;
    },

    async getPurchase(this: PrismaStorage, id: string): Promise<import('../../../interface.js').PurchaseRecord | null> {
        this.ensureReady();
        const row = await this.prisma.purchase.findUnique({ where: { id } });
        return row ? this.toPurchaseRecord(row) : null;
    },

    async listPurchasesByBuyer(this: PrismaStorage, buyerOwner: string): Promise<import('../../../interface.js').PurchaseRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.purchase.findMany({ where: { buyerOwner }, orderBy: { createdAt: 'desc' } });
        return rows.map((r: PrismaRow) => this.toPurchaseRecord(r));
    },

    async listPurchasesBySeller(this: PrismaStorage, sellerOwner: string): Promise<import('../../../interface.js').PurchaseRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.purchase.findMany({ where: { sellerOwner }, orderBy: { createdAt: 'desc' } });
        return rows.map((r: PrismaRow) => this.toPurchaseRecord(r));
    },

    async updatePurchase(this: PrismaStorage, id: string, updates: Partial<import('../../../interface.js').PurchaseRecord>): Promise<import('../../../interface.js').PurchaseRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.status) data.status = updates.status;
            if (updates.rating) { data.ratingScore = updates.rating.score; data.ratingComment = updates.rating.comment; }
            if (updates.completedAt) data.completedAt = new Date(updates.completedAt);
            const row = await this.prisma.purchase.update({ where: { id }, data });
            return this.toPurchaseRecord(row);
        } catch { return null; }
    },

    toPurchaseRecord(this: PrismaStorage, row: PrismaRow): import('../../../interface.js').PurchaseRecord {
        return { id: row.id, listingId: row.listingId, buyerOwner: row.buyerOwner, sellerOwner: row.sellerOwner, priceMorsels: row.priceMorsels, transactionFeeMorsels: row.transactionFeeMorsels, totalCostMorsels: row.totalCostMorsels, status: row.status, rating: row.ratingScore != null ? { score: row.ratingScore, comment: row.ratingComment ?? undefined } : undefined, trackingCode: row.trackingCode, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, completedAt: row.completedAt ? (row.completedAt instanceof Date ? row.completedAt.toISOString() : row.completedAt) : undefined };
    },

    // ── Push Subscriptions (Phase 3.1) ──

    async createPushSubscription(this: PrismaStorage, record: PushSubscriptionRecord): Promise<PushSubscriptionRecord> {
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
    },
    async getPushSubscription(this: PrismaStorage, ownerName: string): Promise<PushSubscriptionRecord | null> {
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
    },
    async deletePushSubscription(this: PrismaStorage, ownerName: string): Promise<boolean> {
        try {
            await this.prisma.pushSubscription.delete({ where: { ownerName } });
            return true;
        } catch { return false; }
    },
    async listPushSubscriptions(this: PrismaStorage): Promise<PushSubscriptionRecord[]> {
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
    },

    // ── Trusted Issuers (Phase 3.3) ──

    async createTrustedIssuer(this: PrismaStorage, record: TrustedIssuerRecord): Promise<TrustedIssuerRecord> {
        this.ensureReady();
        await this.prisma.trustedIssuer.create({ data: { id: record.id, name: record.name, url: record.url, publicKey: record.publicKey, type: record.type, trusted: record.trusted, addedBy: record.addedBy, createdAt: new Date(record.createdAt) } });
        return record;
    },
    async getTrustedIssuer(this: PrismaStorage, id: string): Promise<TrustedIssuerRecord | null> {
        this.ensureReady();
        const row = await this.prisma.trustedIssuer.findUnique({ where: { id } });
        return row ? this.toTrustedIssuerRecord(row) : null;
    },
    async getTrustedIssuerByUrl(this: PrismaStorage, url: string): Promise<TrustedIssuerRecord | null> {
        this.ensureReady();
        const row = await this.prisma.trustedIssuer.findFirst({ where: { url } });
        return row ? this.toTrustedIssuerRecord(row) : null;
    },
    async listTrustedIssuers(this: PrismaStorage, opts?: { type?: string }): Promise<TrustedIssuerRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (opts?.type) where.type = opts.type;
        const rows = await this.prisma.trustedIssuer.findMany({ where });
        return rows.map((r: PrismaRow) => this.toTrustedIssuerRecord(r));
    },
    async deleteTrustedIssuer(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.trustedIssuer.delete({ where: { id } }); return true; } catch { return false; }
    },
    toTrustedIssuerRecord(this: PrismaStorage, row: PrismaRow): TrustedIssuerRecord {
        return { id: row.id, name: row.name, url: row.url, publicKey: row.publicKey, type: row.type, trusted: row.trusted, addedBy: row.addedBy, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt };
    },

    // ── Verification Nonces (Phase 3.3) ──

    async createVerificationNonce(this: PrismaStorage, record: import('../../../interface.js').VerificationNonceRecord): Promise<import('../../../interface.js').VerificationNonceRecord> {
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
    },

    async getVerificationNonce(this: PrismaStorage, state: string): Promise<import('../../../interface.js').VerificationNonceRecord | null> {
        this.ensureReady();
        const row = await this.prisma.verificationNonce.findUnique({ where: { state } });
        if (!row) return null;
        return {
            id: row.id,
            owner: row.owner,
            type: row.type as 'eudiw' | 'ftn' | 'google_login',
            state: row.state,
            nonce: row.nonce,
            redirectUri: row.redirectUri,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
        };
    },

    async deleteVerificationNonce(this: PrismaStorage, state: string): Promise<void> {
        this.ensureReady();
        await this.prisma.verificationNonce.deleteMany({ where: { state } });
    },

    async cleanExpiredNonces(this: PrismaStorage): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.verificationNonce.deleteMany({
            where: { expiresAt: { lt: new Date() } },
        });
        return result.count;
    },

    // ── Genesis Peers (Phase 3.4) ──

    async createGenesisPeer(this: PrismaStorage, record: import('../../../interface.js').GenesisPeerRecord): Promise<import('../../../interface.js').GenesisPeerRecord> {
        this.ensureReady();
        await this.prisma.genesisPeer.create({ data: { id: record.id, genesisNodeId: record.genesisNodeId, genesisUrl: record.genesisUrl, publicKey: record.publicKey, status: record.status, lastSyncAt: new Date(record.lastSyncAt), catalogueHash: record.catalogueHash, createdAt: new Date(record.createdAt) } });
        return record;
    },
    async getGenesisPeer(this: PrismaStorage, id: string): Promise<import('../../../interface.js').GenesisPeerRecord | null> {
        this.ensureReady();
        const row = await this.prisma.genesisPeer.findUnique({ where: { id } });
        return row ? this.toGenesisPeerRecord(row) : null;
    },
    async getGenesisPeerByNodeId(this: PrismaStorage, nodeId: string): Promise<import('../../../interface.js').GenesisPeerRecord | null> {
        this.ensureReady();
        const row = await this.prisma.genesisPeer.findFirst({ where: { genesisNodeId: nodeId } });
        return row ? this.toGenesisPeerRecord(row) : null;
    },
    async listGenesisPeers(this: PrismaStorage, opts?: { status?: string }): Promise<import('../../../interface.js').GenesisPeerRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.genesisPeer.findMany({ where });
        return rows.map((r: PrismaRow) => this.toGenesisPeerRecord(r));
    },
    async updateGenesisPeer(this: PrismaStorage, id: string, updates: Partial<import('../../../interface.js').GenesisPeerRecord>): Promise<import('../../../interface.js').GenesisPeerRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = { ...updates };
            delete data.id;
            if (data.lastSyncAt && typeof data.lastSyncAt === 'string') data.lastSyncAt = new Date(data.lastSyncAt);
            if (data.createdAt && typeof data.createdAt === 'string') data.createdAt = new Date(data.createdAt);
            const row = await this.prisma.genesisPeer.update({ where: { id }, data });
            return this.toGenesisPeerRecord(row);
        } catch { return null; }
    },
    async deleteGenesisPeer(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.genesisPeer.delete({ where: { id } }); return true; } catch { return false; }
    },
    toGenesisPeerRecord(this: PrismaStorage, row: PrismaRow): import('../../../interface.js').GenesisPeerRecord {
        return { id: row.id, genesisNodeId: row.genesisNodeId, genesisUrl: row.genesisUrl, publicKey: row.publicKey, status: row.status, lastSyncAt: row.lastSyncAt instanceof Date ? row.lastSyncAt.toISOString() : row.lastSyncAt, catalogueHash: row.catalogueHash, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt };
    },

    // ── Organism Reputation (Phase 3.4) ──

    async setOrganismReputation(this: PrismaStorage, record: import('../../../interface.js').OrganismReputationRecord): Promise<import('../../../interface.js').OrganismReputationRecord> {
        this.ensureReady();
        await this.prisma.organismReputation.upsert({
            where: { organismId: record.organismId },
            create: { organismId: record.organismId, score: record.score, breakdown: record.breakdown, calculatedAt: new Date(record.calculatedAt) },
            update: { score: record.score, breakdown: record.breakdown, calculatedAt: new Date(record.calculatedAt) },
        });
        return record;
    },
    async getOrganismReputation(this: PrismaStorage, organismId: string): Promise<import('../../../interface.js').OrganismReputationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.organismReputation.findUnique({ where: { organismId } });
        if (!row) return null;
        return { organismId: row.organismId, score: row.score, breakdown: row.breakdown, calculatedAt: row.calculatedAt instanceof Date ? row.calculatedAt.toISOString() : row.calculatedAt };
    },

    // ── Realtime rooms (MongoDB-backed via Prisma) ──

    async createRealtimeRoom(this: PrismaStorage, record: import('../../../interface.js').RealtimeRoomRecord): Promise<import('../../../interface.js').RealtimeRoomRecord> {
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
    },
    async getRealtimeRoom(this: PrismaStorage, id: string): Promise<import('../../../interface.js').RealtimeRoomRecord | null> {
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
    },
    async listRealtimeRooms(this: PrismaStorage, filter?: { appType?: string; isPublic?: boolean }): Promise<import('../../../interface.js').RealtimeRoomRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (filter?.appType) where.appType = filter.appType;
        if (filter?.isPublic !== undefined) where.isPublic = filter.isPublic;
        const rows = await this.prisma.realtimeRoom.findMany({ where });
        return rows.map((row: PrismaRow) => ({
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
    },
    async updateRealtimeRoom(this: PrismaStorage, id: string, updates: Partial<import('../../../interface.js').RealtimeRoomRecord>): Promise<import('../../../interface.js').RealtimeRoomRecord | null> {
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
    },
    async deleteRealtimeRoom(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.realtimeRoom.delete({ where: { id } });
            return true;
        } catch {
            return false;
        }
    },

    // ── Node Portal (Site) ──

    async addSiteChangeLog(this: PrismaStorage, entry: SiteChangeLogEntry): Promise<SiteChangeLogEntry> {
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
    },

    async listSiteChangeLog(this: PrismaStorage, limit: number, cursor?: string): Promise<SiteChangeLogEntry[]> {
        this.ensureReady();
        const rows = await this.prisma.siteChangeLog.findMany({
            orderBy: { changedAt: 'desc' },
            take: limit,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        return rows.map((r: PrismaRow) => ({
            id: r.id,
            action: r.action,
            summary: r.summary,
            changedBy: r.changedBy,
            changedAt: r.changedAt instanceof Date ? r.changedAt.toISOString() : r.changedAt,
        }));
    },

    // ── Node Extensions ──────────────────────────────────────────

    toExtensionRecord(this: PrismaStorage, row: PrismaRow): ExtensionRecord {
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
    },

    async createExtension(this: PrismaStorage, record: ExtensionRecord): Promise<ExtensionRecord> {
        this.ensureReady();
        const row = await this.prisma.extension.create({
            data: {
                name: record.name,
                version: record.version,
                description: record.description,
                author: record.author,
                status: record.status,
                requiredApis: record.requiredApis,
                actions: record.actions,
                config: record.config,
                limits: record.limits,
                federation: record.federation,
                instances: record.instances ? record.instances : undefined,
                installedBy: record.installedBy,
                installedAt: new Date(record.installedAt),
                activatedAt: record.activatedAt ? new Date(record.activatedAt) : null,
            },
        });
        return this.toExtensionRecord(row);
    },

    async getExtension(this: PrismaStorage, name: string): Promise<ExtensionRecord | null> {
        this.ensureReady();
        const row = await this.prisma.extension.findUnique({ where: { name } });
        return row ? this.toExtensionRecord(row) : null;
    },

    async listExtensions(this: PrismaStorage, opts?: { status?: string }): Promise<ExtensionRecord[]> {
        this.ensureReady();
        const where = opts?.status ? { status: opts.status } : {};
        const rows = await this.prisma.extension.findMany({ where });
        return rows.map((r: PrismaRow) => this.toExtensionRecord(r));
    },

    async updateExtension(this: PrismaStorage, name: string, updates: Partial<ExtensionRecord>): Promise<ExtensionRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = { ...updates };
            if (data.activatedAt && typeof data.activatedAt === 'string') {
                data.activatedAt = new Date(data.activatedAt);
            }
            if (data.actions) data.actions = data.actions as unknown;
            if (data.config) data.config = data.config as unknown;
            if (data.limits) data.limits = data.limits as unknown;
            if (data.federation) data.federation = data.federation as unknown;
            const row = await this.prisma.extension.update({ where: { name }, data });
            return this.toExtensionRecord(row);
        } catch {
            return null;
        }
    },

    async deleteExtension(this: PrismaStorage, name: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.extension.delete({ where: { name } });
            return true;
        } catch {
            return false;
        }
    },

    // ── Generic Escrow ───────────────────────────────────────────

    toEscrowHoldRecord(this: PrismaStorage, row: PrismaRow): EscrowHoldRecord {
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
    },

    async createEscrowHold(this: PrismaStorage, record: EscrowHoldRecord): Promise<EscrowHoldRecord> {
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
    },

    async getEscrowHold(this: PrismaStorage, holdId: string): Promise<EscrowHoldRecord | null> {
        this.ensureReady();
        const row = await this.prisma.escrowHold.findUnique({ where: { holdId } });
        return row ? this.toEscrowHoldRecord(row) : null;
    },

    async listEscrowHolds(this: PrismaStorage, fromGaii: string, opts?: { status?: string }): Promise<EscrowHoldRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = { fromGaii };
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.escrowHold.findMany({ where });
        return rows.map((r: PrismaRow) => this.toEscrowHoldRecord(r));
    },

    async releaseEscrowHold(this: PrismaStorage, holdId: string, toGaii: string): Promise<EscrowHoldRecord | null> {
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
    },

    async refundEscrowHold(this: PrismaStorage, holdId: string): Promise<EscrowHoldRecord | null> {
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
    },

    // ── Cortex Extensions (Manifest-based) ──

    async createCortexExtension(this: PrismaStorage, record: CortexExtensionRecord): Promise<CortexExtensionRecord> {
        this.ensureReady();
        try {
            await this.prisma.cortexExtension.create({ data: { name: record.name, namespace: record.namespace, shortName: record.shortName, apiVersion: record.apiVersion, version: record.version, description: record.description, author: record.author, license: record.license, tags: record.tags, labels: record.labels, aimeatCompat: record.aimeatCompat, status: record.status, visibility: record.visibility, installedAt: new Date(record.installedAt), activatedAt: record.activatedAt ? new Date(record.activatedAt) : null, installedBy: record.installedBy, manifest: record.manifest, components: record.components, activationArtifacts: record.activationArtifacts } });
            return record;
        } catch { throw new Error(`Cortex extension "${record.name}" already exists`); }
    },

    async getCortexExtension(this: PrismaStorage, name: string): Promise<CortexExtensionRecord | null> {
        this.ensureReady();
        const row = await this.prisma.cortexExtension.findUnique({ where: { name } });
        return row ? this.toCortexExtensionRecord(row) : null;
    },

    async listCortexExtensions(this: PrismaStorage, opts?: { status?: string; namespace?: string; visibility?: string; installedBy?: string }): Promise<CortexExtensionRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (opts?.status) where.status = opts.status;
        if (opts?.namespace) where.namespace = opts.namespace;
        if (opts?.visibility) where.visibility = opts.visibility;
        if (opts?.installedBy) where.installedBy = opts.installedBy;
        const rows = await this.prisma.cortexExtension.findMany({ where });
        return rows.map((r: PrismaRow) => this.toCortexExtensionRecord(r));
    },

    async updateCortexExtension(this: PrismaStorage, name: string, updates: Partial<CortexExtensionRecord>): Promise<CortexExtensionRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = { ...updates };
            delete data.name;
            if (data.labels) data.labels = data.labels as unknown;
            if (data.components) data.components = data.components as unknown;
            if (data.activationArtifacts) data.activationArtifacts = data.activationArtifacts as unknown;
            if (data.activatedAt && typeof data.activatedAt === 'string') data.activatedAt = new Date(data.activatedAt);
            if (data.installedAt && typeof data.installedAt === 'string') data.installedAt = new Date(data.installedAt);
            const row = await this.prisma.cortexExtension.update({ where: { name }, data });
            return this.toCortexExtensionRecord(row);
        } catch { return null; }
    },

    async deleteCortexExtension(this: PrismaStorage, name: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.cortexExtension.delete({ where: { name } }); return true; } catch { return false; }
    },

    toCortexExtensionRecord(this: PrismaStorage, row: PrismaRow): CortexExtensionRecord {
        return { name: row.name, namespace: row.namespace, shortName: row.shortName, apiVersion: row.apiVersion, version: row.version, description: row.description, author: row.author, license: row.license ?? undefined, tags: row.tags, labels: row.labels as Record<string, string>, aimeatCompat: row.aimeatCompat ?? undefined, status: row.status, visibility: row.visibility, installedAt: row.installedAt instanceof Date ? row.installedAt.toISOString() : row.installedAt, activatedAt: row.activatedAt ? (row.activatedAt instanceof Date ? row.activatedAt.toISOString() : row.activatedAt) : undefined, installedBy: row.installedBy, manifest: row.manifest, components: row.components, activationArtifacts: row.activationArtifacts };
    },

    async setCortexLibFile(this: PrismaStorage, extName: string, libName: string, content: string): Promise<void> {
        this.ensureReady();
        await this.prisma.cortexLibFile.upsert({
            where: { extName_libName: { extName, libName } },
            create: { extName, libName, content },
            update: { content },
        });
    },

    async getCortexLibFile(this: PrismaStorage, extName: string, libName: string): Promise<string | null> {
        this.ensureReady();
        const row = await this.prisma.cortexLibFile.findUnique({ where: { extName_libName: { extName, libName } } });
        return row?.content ?? null;
    },

    async deleteCortexLibFile(this: PrismaStorage, extName: string, libName: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.cortexLibFile.delete({ where: { extName_libName: { extName, libName } } }); return true; } catch { return false; }
    },
};
