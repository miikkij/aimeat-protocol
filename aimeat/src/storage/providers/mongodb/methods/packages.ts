/**
 * @file src/storage/providers/mongodb/methods/packages.ts
 * @description Template listings, reviews, discussions, package instances, and capability-layer methods. Extracted from mongodb/index.ts (PrismaStorage) to satisfy max-file-lines; method bodies verbatim, bound to PrismaStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/mongodb/index.ts (max-file-lines)
 */
import type {
  TemplateListingRecord, TemplateReview, TemplateDiscussion, TemplateFilter, PackageInstanceRecord, InstalledComponent, InstanceFilter, CapabilityRecord, CapabilityLogEntry, CapabilityFilter, CapabilityOverride, CapabilityTrust
} from '../../../interface.js';
import type { PrismaStorage, PrismaRow } from '../index.js';

export const packagesMethods = {
    // ── Template Listing Repository ────────────────────────────────────

    async createTemplateListing(this: PrismaStorage, record: TemplateListingRecord): Promise<TemplateListingRecord> {
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
    },

    async getTemplateListing(this: PrismaStorage, id: string): Promise<TemplateListingRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.templateListing.findUnique({ where: { id } });
            return row ? this.toTemplateListingRecord(row) : null;
        } catch {
            return null; // Invalid ObjectId format → not found
        }
    },

    async getListingByPackage(this: PrismaStorage, packageGroupId: string): Promise<TemplateListingRecord | null> {
        this.ensureReady();
        const row = await this.prisma.templateListing.findUnique({ where: { packageGroupId } });
        return row ? this.toTemplateListingRecord(row) : null;
    },

    async listTemplateListings(this: PrismaStorage, filter: TemplateFilter): Promise<{ listings: TemplateListingRecord[]; total: number }> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
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
        let orderBy: Record<string, unknown> = { createdAt: 'desc' };
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
        return { listings: rows.map((r: PrismaRow) => this.toTemplateListingRecord(r)), total };
    },

    async updateTemplateListing(this: PrismaStorage, id: string, updates: Partial<TemplateListingRecord>): Promise<TemplateListingRecord | null> {
        this.ensureReady();
        const data: Record<string, unknown> = {};
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
    },

    async deleteTemplateListing(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.templateReview.deleteMany({ where: { listingId: id } });
            await this.prisma.templateDiscussion.deleteMany({ where: { listingId: id } });
            await this.prisma.templateListing.delete({ where: { id } });
            return true;
        } catch {
            return false;
        }
    },

    async incrementInstallCount(this: PrismaStorage, listingId: string): Promise<void> {
        this.ensureReady();
        await this.prisma.templateListing.update({
            where: { id: listingId },
            data: { installCount: { increment: 1 } },
        });
    },

    async listPendingTemplates(this: PrismaStorage, limit = 20, offset = 0): Promise<TemplateListingRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.templateListing.findMany({
            where: { status: 'pending_review' },
            orderBy: { createdAt: 'asc' },
            skip: offset,
            take: limit,
        });
        return rows.map((r: PrismaRow) => this.toTemplateListingRecord(r));
    },

    // ── Reviews ──

    async addReview(this: PrismaStorage, review: TemplateReview): Promise<TemplateReview> {
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
    },

    async getReviewsByListing(this: PrismaStorage, listingId: string, limit?: number, offset?: number): Promise<{ reviews: TemplateReview[]; total: number }> {
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
        return { reviews: rows.map((r: PrismaRow) => this.toTemplateReview(r)), total };
    },

    async getReviewByAuthor(this: PrismaStorage, listingId: string, authorGhii: string): Promise<TemplateReview | null> {
        this.ensureReady();
        const row = await this.prisma.templateReview.findUnique({
            where: { listingId_authorGhii: { listingId, authorGhii } },
        });
        return row ? this.toTemplateReview(row) : null;
    },

    async updateReview(this: PrismaStorage, id: string, updates: Partial<TemplateReview>): Promise<TemplateReview | null> {
        this.ensureReady();
        const data: Record<string, unknown> = {};
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
    },

    async deleteReview(this: PrismaStorage, id: string): Promise<boolean> {
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
    },

    async recalculateRating(this: PrismaStorage, listingId: string): Promise<{ rating: number; reviewCount: number }> {
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
    },

    toTemplateReview(this: PrismaStorage, row: PrismaRow): TemplateReview {
        return {
            id: row.id,
            listingId: row.listingId,
            authorGhii: row.authorGhii,
            authorName: row.authorName,
            rating: row.rating,
            comment: row.comment ?? '',
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    },

    // ── Discussions ──

    async addDiscussion(this: PrismaStorage, discussion: TemplateDiscussion): Promise<TemplateDiscussion> {
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
    },

    async getDiscussionsByListing(this: PrismaStorage, listingId: string, limit?: number, offset?: number): Promise<{ discussions: TemplateDiscussion[]; total: number }> {
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
        return { discussions: rows.map((r: PrismaRow) => this.toTemplateDiscussion(r)), total };
    },

    async deleteDiscussion(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.templateDiscussion.delete({ where: { id } });
            return true;
        } catch {
            return false;
        }
    },

    toTemplateListingRecord(this: PrismaStorage, row: PrismaRow): TemplateListingRecord {
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
    },

    toTemplateDiscussion(this: PrismaStorage, row: PrismaRow): TemplateDiscussion {
        return {
            id: row.id,
            listingId: row.listingId,
            authorGhii: row.authorGhii,
            authorName: row.authorName,
            message: row.message,
            parentId: row.parentId ?? undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    },

    // ── Package Instance Repository ────────────────────────────────────

    async createInstance(this: PrismaStorage, record: PackageInstanceRecord): Promise<PackageInstanceRecord> {
        this.ensureReady();
        const row = await this.prisma.packageInstance.create({
            data: {
                packageGroupId: record.packageGroupId,
                packageVersion: record.packageVersion,
                packageRecordId: record.packageRecordId,
                owner: record.owner,
                ownerGhii: record.ownerGhii,
                label: record.label,
                installedComponents: record.installedComponents,
                status: record.status,
                installedAt: new Date(record.installedAt),
                updatedAt: new Date(record.updatedAt),
            },
        });
        return this.toPackageInstanceRecord(row);
    },

    async getInstance(this: PrismaStorage, id: string): Promise<PackageInstanceRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.packageInstance.findUnique({ where: { id } });
            return row ? this.toPackageInstanceRecord(row) : null;
        } catch {
            return null; // Invalid ObjectId format → not found
        }
    },

    async listInstances(this: PrismaStorage, filter: InstanceFilter): Promise<{ instances: PackageInstanceRecord[]; total: number }> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
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
        return { instances: rows.map((r: PrismaRow) => this.toPackageInstanceRecord(r)), total };
    },

    async updateInstance(this: PrismaStorage, id: string, updates: Partial<PackageInstanceRecord>): Promise<PackageInstanceRecord | null> {
        this.ensureReady();
        const data: Record<string, unknown> = {};
        if (updates.label !== undefined) data.label = updates.label;
        if (updates.status !== undefined) data.status = updates.status;
        if (updates.installedComponents !== undefined) data.installedComponents = updates.installedComponents;
        if (updates.packageVersion !== undefined) data.packageVersion = updates.packageVersion;
        if (updates.packageRecordId !== undefined) data.packageRecordId = updates.packageRecordId;
        data.updatedAt = new Date();
        try {
            const row = await this.prisma.packageInstance.update({ where: { id }, data });
            return this.toPackageInstanceRecord(row);
        } catch {
            return null;
        }
    },

    async deleteInstance(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.packageInstance.delete({ where: { id } });
            return true;
        } catch {
            return false;
        }
    },

    async listInstancesByPackage(this: PrismaStorage, packageGroupId: string): Promise<{ instances: PackageInstanceRecord[]; total: number }> {
        this.ensureReady();
        const where = { packageGroupId };
        const [rows, total] = await Promise.all([
            this.prisma.packageInstance.findMany({ where, orderBy: { installedAt: 'desc' } }),
            this.prisma.packageInstance.count({ where }),
        ]);
        return { instances: rows.map((r: PrismaRow) => this.toPackageInstanceRecord(r)), total };
    },

    toPackageInstanceRecord(this: PrismaStorage, row: PrismaRow): PackageInstanceRecord {
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
    },

    // ── Capability Layer ──────────────────────────────────────────────

    toCapabilityRecord(this: PrismaStorage, row: PrismaRow): CapabilityRecord {
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
    },

    async createCapability(this: PrismaStorage, record: CapabilityRecord): Promise<CapabilityRecord> {
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
                trust: record.trust, redactedFields: record.redactedFields,
                operatorOverride: record.operatorOverride ?? undefined,
                stats: record.stats, tags: record.tags,
            },
        });
        return this.toCapabilityRecord(row);
    },

    async getCapability(this: PrismaStorage, id: string): Promise<CapabilityRecord | null> {
        this.ensureReady();
        const row = await this.prisma.capability.findUnique({ where: { id } });
        return row ? this.toCapabilityRecord(row) : null;
    },

    async updateCapability(this: PrismaStorage, id: string, updates: Partial<CapabilityRecord>): Promise<CapabilityRecord | null> {
        this.ensureReady();
        const data: Record<string, unknown> = { ...updates };
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
    },

    async deleteCapability(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.capability.delete({ where: { id } }); return true; } catch { return false; }
    },

    async listCapabilities(this: PrismaStorage, filters: CapabilityFilter): Promise<{ capabilities: CapabilityRecord[]; total: number }> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (filters.ownerGhii) where.ownerGhii = filters.ownerGhii;
        if (filters.visibility) where.visibility = filters.visibility;
        if (filters.publicOrOwner) where.AND = [{ OR: [{ visibility: 'public' }, { ownerGhii: filters.publicOrOwner }] }];
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
        let caps = rows.map((r: PrismaRow) => this.toCapabilityRecord(r));
        if (filters.tags?.length) {
            caps = caps.filter((c: CapabilityRecord) => filters.tags!.some(t => c.tags.includes(t)));
        }
        return { capabilities: caps, total };
    },

    async listCapabilitiesByOwner(this: PrismaStorage, ownerGhii: string): Promise<CapabilityRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.capability.findMany({ where: { ownerGhii }, orderBy: { updatedAt: 'desc' } });
        return rows.map((r: PrismaRow) => this.toCapabilityRecord(r));
    },

    async getCapabilityBySourceRef(this: PrismaStorage, sourceRef: string): Promise<CapabilityRecord | null> {
        this.ensureReady();
        const row = await this.prisma.capability.findFirst({ where: { sourceRef } });
        return row ? this.toCapabilityRecord(row) : null;
    },

    async listCapabilitiesBySourceType(this: PrismaStorage, sourceType: string): Promise<CapabilityRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.capability.findMany({ where: { sourceType } });
        return rows.map((r: PrismaRow) => this.toCapabilityRecord(r));
    },

    async incrementCapabilityStats(this: PrismaStorage, id: string, delta: { success: number; error: number; totalMs: number; lastError?: string }): Promise<void> {
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
    },

    async addCapabilityLog(this: PrismaStorage, entry: CapabilityLogEntry): Promise<void> {
        this.ensureReady();
        await this.prisma.capabilityLog.create({
            data: {
                capabilityId: entry.capabilityId, callerGhii: entry.callerGhii,
                input: entry.input, status: entry.status,
                durationMs: entry.durationMs, error: entry.error,
                timestamp: new Date(entry.timestamp),
            },
        });
    },

    async listCapabilityLogs(this: PrismaStorage, capabilityId: string, filters: { status?: 'success' | 'error'; page?: number; perPage?: number }): Promise<{ logs: CapabilityLogEntry[]; total: number }> {
        this.ensureReady();
        const where: Record<string, unknown> = { capabilityId };
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
        const logs: CapabilityLogEntry[] = rows.map((r: PrismaRow) => ({
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
    },

    async deleteCapabilityLogsBefore(this: PrismaStorage, before: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.capabilityLog.deleteMany({ where: { timestamp: { lt: new Date(before) } } });
        return result.count;
    },

    async setCapabilityOverride(this: PrismaStorage, id: string, override: CapabilityOverride | null): Promise<void> {
        this.ensureReady();
        await this.prisma.capability.update({ where: { id }, data: { operatorOverride: override ?? undefined } });
    },

    async setCapabilityTrust(this: PrismaStorage, id: string, trustUpdates: Partial<CapabilityTrust>): Promise<void> {
        const cap = await this.getCapability(id);
        if (!cap) return;
        const merged = { ...cap.trust, ...trustUpdates };
        await this.prisma.capability.update({ where: { id }, data: { trust: merged } });
    },

    async incrementVouchCount(this: PrismaStorage, id: string): Promise<void> {
        const cap = await this.getCapability(id);
        if (!cap) return;
        const trust = { ...cap.trust, vouchCount: cap.trust.vouchCount + 1 };
        await this.prisma.capability.update({ where: { id }, data: { trust: trust } });
    },

    async decrementVouchCount(this: PrismaStorage, id: string): Promise<void> {
        const cap = await this.getCapability(id);
        if (!cap) return;
        const trust = { ...cap.trust, vouchCount: Math.max(0, cap.trust.vouchCount - 1) };
        await this.prisma.capability.update({ where: { id }, data: { trust: trust } });
    },
};
