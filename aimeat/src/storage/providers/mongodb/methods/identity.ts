/**
 * @file src/storage/providers/mongodb/methods/identity.ts
 * @description Storage files, peering, GHII, chat instances, personal nodes, mailbox, and schema-locking methods. Extracted from mongodb/index.ts (PrismaStorage) to satisfy max-file-lines; method bodies verbatim, bound to PrismaStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/mongodb/index.ts (max-file-lines)
 */
import type {
  OwnerRecord, AgentRecord, MemoryRecord, ActionRecord, WorkRecord, BoardRecord, BoardPostRecord, DisputeRecord, StorageFileRecord, PeeringRequestRecord, ChunkedUploadRecord, GHIIRecord, ChatInstanceRecord, PersonalNodeRecord, MailboxItemRecord, SchemaRecord
} from '../../../interface.js';
import { mongoMatchWildcardPattern, mongoMatchGlobPattern } from './helpers.js';
import { getCachedSchemaLocks, setCachedSchemaLocks, invalidateSchemaLockCache } from '../../../schema-lock-cache.js';
import type { PrismaStorage, PrismaRow } from '../index.js';

export const identityMethods = {
    // ── Storage Files ───────────────────────────────────────────

    async createStorageFile(this: PrismaStorage, file: StorageFileRecord): Promise<StorageFileRecord> {
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
                workspaceRef: file.workspaceRef ?? null,
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
                workspaceRef: file.workspaceRef ?? null,
                createdAt: new Date(file.createdAt),
            },
        });
        return file;
    },

    async getStorageFile(this: PrismaStorage, ownerGaii: string, key: string): Promise<StorageFileRecord | null> {
        this.ensureReady();
        const row = await this.prisma.storageFile.findUnique({
            where: { ownerGaii_key: { ownerGaii, key } },
        });
        if (!row) return null;
        return { key: row.key, ownerGaii: row.ownerGaii, visibility: row.visibility, groupId: row.groupId ?? undefined, workspaceRef: row.workspaceRef ?? undefined, mimeType: row.mimeType, size: row.size, data: Buffer.from(row.data), tags: row.tags || [], federate: row.federate ?? false, createdAt: row.createdAt.toISOString() };
    },

    async listStorageFiles(this: PrismaStorage, ownerGaii: string): Promise<StorageFileRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.storageFile.findMany({
            where: { ownerGaii },
            select: { key: true, ownerGaii: true, visibility: true, groupId: true, workspaceRef: true, mimeType: true, size: true, tags: true, federate: true, createdAt: true },
        });
        return rows.map((r: PrismaRow) => ({
            key: r.key, ownerGaii: r.ownerGaii, visibility: r.visibility, groupId: r.groupId ?? undefined, workspaceRef: r.workspaceRef ?? undefined, mimeType: r.mimeType, size: r.size, data: Buffer.alloc(0), tags: r.tags || [], federate: r.federate ?? false, createdAt: r.createdAt.toISOString(),
        }));
    },

    async sumStorageBytesForOwners(this: PrismaStorage, ownerGaiis: string[]): Promise<{ bytes: number; count: number }> {
        this.ensureReady();
        if (ownerGaiis.length === 0) return { bytes: 0, count: 0 };
        // ONE aggregate (sum of size + row count) across all identities — the owner-scope storage
        // footprint for the usage summary, instead of listStorageFiles-then-sum PER identity.
        const agg = await this.prisma.storageFile.aggregate({ where: { ownerGaii: { in: ownerGaiis } }, _sum: { size: true }, _count: true });
        return { bytes: agg._sum.size ?? 0, count: agg._count ?? 0 };
    },

    async deleteStorageFile(this: PrismaStorage, ownerGaii: string, key: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.storageFile.delete({ where: { ownerGaii_key: { ownerGaii, key } } });
            return true;
        } catch { return false; }
    },

    async updateFileTagsByKey(this: PrismaStorage, ownerGaii: string, key: string, tags: string[]): Promise<StorageFileRecord | null> {
        this.ensureReady();
        const updated = await this.prisma.storageFile.updateMany({
            where: { ownerGaii, key },
            data: { tags },
        });
        if (updated.count === 0) return null;
        return this.getStorageFile(ownerGaii, key);
    },

    async updateFileVisibility(this: PrismaStorage, ownerGaii: string, key: string, visibility: StorageFileRecord['visibility'], workspaceRef?: string): Promise<StorageFileRecord | null> {
        this.ensureReady();
        // workspaceRef undefined → visibility only; provided → set both (bind the file to its org/ws).
        const data: Record<string, unknown> = workspaceRef === undefined ? { visibility } : { visibility, workspaceRef: workspaceRef || null };
        const updated = await this.prisma.storageFile.updateMany({ where: { ownerGaii, key }, data });
        if (updated.count === 0) return null;
        return this.getStorageFile(ownerGaii, key);
    },

    // ── Peering Requests ────────────────────────────────────────

    async createPeeringRequest(this: PrismaStorage, req: PeeringRequestRecord): Promise<PeeringRequestRecord> {
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
    },

    async getPeeringRequest(this: PrismaStorage, id: string): Promise<PeeringRequestRecord | null> {
        this.ensureReady();
        const row = await this.prisma.peeringRequest.findUnique({ where: { requestId: id } });
        if (!row) return null;
        return this.toPeeringRecord(row);
    },

    async listPeeringRequests(this: PrismaStorage, status?: string): Promise<PeeringRequestRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (status) where.status = status;
        const rows = await this.prisma.peeringRequest.findMany({ where });
        return rows.map((r: PrismaRow) => this.toPeeringRecord(r));
    },

    async updatePeeringRequest(this: PrismaStorage, id: string, updates: Partial<PeeringRequestRecord>): Promise<PeeringRequestRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.peeringRequest.update({
                where: { requestId: id },
                data: { status: updates.status, updatedAt: updates.updatedAt ? new Date(updates.updatedAt) : new Date() },
            });
            return this.toPeeringRecord(row);
        } catch { return null; }
    },

    async deletePeeringRequest(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.peeringRequest.delete({ where: { requestId: id } });
            return true;
        } catch { return false; }
    },

    // ── Chunked Uploads (kept in-memory — transient) ───────────

    async createChunkedUpload(this: PrismaStorage, record: ChunkedUploadRecord): Promise<ChunkedUploadRecord> {
        this.chunkedUploads.set(record.uploadId, record);
        return record;
    },

    async getChunkedUpload(this: PrismaStorage, uploadId: string): Promise<ChunkedUploadRecord | null> {
        return this.chunkedUploads.get(uploadId) ?? null;
    },

    async addChunk(this: PrismaStorage, uploadId: string, chunkIndex: number, data: Buffer): Promise<boolean> {
        const upload = this.chunkedUploads.get(uploadId);
        if (!upload) return false;
        upload.receivedChunks.set(chunkIndex, data);
        return true;
    },

    async deleteChunkedUpload(this: PrismaStorage, uploadId: string): Promise<boolean> {
        return this.chunkedUploads.delete(uploadId);
    },

    // ── Node Key ────────────────────────────────────────────────

    async setNodeKey(this: PrismaStorage, publicKey: string, privateKey: string): Promise<void> {
        this.ensureReady();
        const existing = await this.prisma.nodeKey.findFirst();
        if (existing) {
            await this.prisma.nodeKey.update({ where: { id: existing.id }, data: { publicKey, privateKey } });
        } else {
            await this.prisma.nodeKey.create({ data: { publicKey, privateKey } });
        }
    },

    async getNodeKey(this: PrismaStorage): Promise<{ publicKey: string; privateKey: string } | null> {
        this.ensureReady();
        const row = await this.prisma.nodeKey.findFirst();
        return row ? { publicKey: row.publicKey, privateKey: row.privateKey } : null;
    },

    // ── Record Mappers ──────────────────────────────────────────

    toOwnerRecord(this: PrismaStorage, row: PrismaRow): OwnerRecord {
        return { name: row.name, displayName: row.displayName ?? undefined, publicKey: row.publicKey, roles: row.roles, createdAt: row.createdAt.toISOString() };
    },

    toAgentRecord(this: PrismaStorage, row: PrismaRow): AgentRecord {
        return { name: row.name, owner: row.owner, gaii: row.gaii, displayName: row.displayName ?? undefined, description: row.description ?? undefined, capabilities: row.capabilities, publicKey: row.publicKey, trustScore: row.trustScore, morselBalance: row.morselBalance, defaultScopes: row.defaultScopes?.length ? row.defaultScopes : undefined, allowedOrigins: row.allowedOrigins?.length ? row.allowedOrigins : undefined, federate: row.federate ?? false, technicalCapabilities: row.technicalCapabilities ?? undefined, domainCapabilities: row.domainCapabilities ?? undefined, languages: row.languages ?? undefined, activityStats: row.activityStats ?? undefined, modulesLoaded: row.modulesLoaded ?? undefined, agentLimitations: row.agentLimitations ?? undefined, webhookUrl: row.webhookUrl ?? undefined, webhookSecret: row.webhookSecret ?? undefined, webhookEnabled: row.webhookEnabled ?? false, webhookLastSuccess: row.webhookLastSuccess ? row.webhookLastSuccess.toISOString() : undefined, webhookLastFailure: row.webhookLastFailure ? row.webhookLastFailure.toISOString() : undefined, webhookFailCount: row.webhookFailCount ?? 0, platform: row.platform ?? undefined, platformVersion: row.platformVersion ?? undefined, platformDetectedBy: row.platformDetectedBy ?? undefined, tags: row.tags?.length ? row.tags : undefined, mode: (row.mode ?? 'interactive') as AgentRecord['mode'], maxConcurrentTasks: row.maxConcurrentTasks ?? 1, dailySpendLimit: row.dailySpendLimit ?? undefined, scheduleConstraintDefaults: row.scheduleConstraintDefaults ?? undefined, createdAt: row.createdAt.toISOString(), lastSeen: row.lastSeen.toISOString() };
    },

    toMemoryRecord(this: PrismaStorage, row: PrismaRow): MemoryRecord {
        return { key: row.key, ownerGaii: row.ownerGaii, value: row.value, visibility: row.visibility, groupId: row.groupId ?? undefined, workspaceRef: row.workspaceRef ?? undefined, tags: row.tags, ttlHours: row.ttlHours, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), flagCount: row.flagCount ?? undefined, allowedOrigins: row.allowedOrigins?.length ? row.allowedOrigins : undefined, trackable: row.trackable ? true : undefined, archived: row.archived ? true : undefined, archivedAt: row.archivedAt ? row.archivedAt.toISOString() : undefined, archivedBy: row.archivedBy ?? undefined, archivedRoot: row.archivedRoot ?? undefined };
    },

    /** Prisma `where` fragment restricting memory rows by archive filter. Default `exclude` uses
     *  `{ not: true }` (NOT `false`) so legacy docs written before the field existed — which have no
     *  `archived` key at all — are still treated as active. Mirrors SQLite's `archived = 0` default. */
    archivedWhere(this: PrismaStorage, archived?: import('../../../interface.js').ArchiveFilter): Record<string, unknown> {
        if (archived === 'include') return {};
        if (archived === 'only') return { archived: true };
        // POSITIVE equality (`archived: false`), NOT `{ $ne: true }`. `$ne` is non-selective and makes
        // MongoDB skip the index → every owner-agnostic key-prefix findMany was a ~150ms collection scan
        // even next to a 2ms indexed findUnique. `backfillArchiveFlag` sets archived=false on every legacy
        // doc at startup, so `false` matches the full active set without the $ne index-poison.
        return { archived: false };
    },

    /** Read an optional `_actor` / `_event` annotation off a record value (the structure-timeline
     *  convention) so archived history rows carry who/why. Best-effort. */
    memoryAnnotation(this: PrismaStorage, value: unknown, field: '_actor' | '_event'): string | null {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const v = (value as Record<string, unknown>)[field];
            if (typeof v === 'string' && v) return v;
        }
        return null;
    },

    toActionRecord(this: PrismaStorage, row: PrismaRow): ActionRecord {
        return { id: row.actionId, providerGaii: row.providerGaii, displayName: row.displayName, description: row.description, category: row.category ?? undefined, inputSchema: row.inputSchema as Record<string, unknown>, outputSchema: row.outputSchema as Record<string, unknown>, pricing: { baseMorsels: row.pricingBaseMorsels, perUnit: row.pricingPerUnit }, estimatedTimeSeconds: row.estimatedTimeSeconds ?? undefined, maxInputSizeBytes: row.maxInputSizeBytes ?? undefined, tags: row.tags, webhookUrl: row.webhookUrl ?? undefined, semantic: row.semantic ?? undefined, federate: row.federate ?? false, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
    },

    toWorkRecord(this: PrismaStorage, row: PrismaRow): WorkRecord {
        return { trackingCode: row.trackingCode, status: row.status, actionId: row.actionId, providerGaii: row.providerGaii, requesterGaii: row.requesterGaii, input: row.input as Record<string, unknown>, output: row.output as Record<string, unknown> | undefined, cost: { basePrice: row.costBasePrice, networkFee: row.costNetworkFee, total: row.costTotal, inEscrow: row.costInEscrow }, ttlExpiresAt: row.ttlExpiresAt.toISOString(), callbackUrl: row.callbackUrl ?? undefined, rating: row.ratingScore != null ? { score: row.ratingScore, comment: row.ratingComment ?? undefined } : undefined, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
    },

    toBoardRecord(this: PrismaStorage, row: PrismaRow): BoardRecord {
        return { id: row.boardId, name: row.name, description: row.description ?? undefined, visibility: row.visibility, ownerGaii: row.ownerGaii, allowedGaiis: row.allowedGaiis, federate: row.federate ?? false, createdAt: row.createdAt.toISOString() };
    },

    toPostRecord(this: PrismaStorage, row: PrismaRow): BoardPostRecord {
        return { id: row.postId, boardId: row.boardId, authorGaii: row.authorGaii, title: row.title, body: row.body, category: row.category ?? undefined, tags: row.tags, ttlExpiresAt: row.ttlExpiresAt?.toISOString(), reactions: row.reactions as Record<string, string[]>, replyTo: row.replyTo ?? undefined, createdAt: row.createdAt.toISOString() };
    },

    toDisputeRecord(this: PrismaStorage, row: PrismaRow): DisputeRecord {
        return { id: row.disputeId, trackingCode: row.trackingCode, status: row.status, openedBy: row.openedBy, reason: row.reason, ruling: row.ruling, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
    },

    toPeeringRecord(this: PrismaStorage, row: PrismaRow): PeeringRequestRecord {
        return { id: row.requestId, fromNodeUrl: row.fromNodeUrl, fromNodeId: row.fromNodeId ?? undefined, toNodeId: row.toNodeId ?? undefined, targetUrl: row.targetUrl ?? undefined, publicKey: row.publicKey ?? undefined, message: row.message ?? undefined, status: row.status, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
    },

    // ── GHII (persisted via Prisma) ──

    toGHIIRecord(this: PrismaStorage, row: PrismaRow): GHIIRecord {
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
            googleSub: row.googleSub ?? undefined,
            externalIdentities: (row.externalIdentities as Record<string, string> | null) ?? undefined,
            trustScore: row.trustScore ?? undefined,
            morselBalance: row.morselBalance ?? undefined,
            allowedOrigins: row.allowedOrigins?.length ? row.allowedOrigins : undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
            semantic: undefined,
        };
    },

    async createGHII(this: PrismaStorage, record: GHIIRecord): Promise<GHIIRecord> {
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
                    googleSub: record.googleSub,
                    externalIdentities: record.externalIdentities ?? undefined,
                    trustScore: record.trustScore,
                    morselBalance: record.morselBalance,
                    allowedOrigins: record.allowedOrigins ?? [],
                    createdAt: new Date(record.createdAt),
                    updatedAt: new Date(record.updatedAt),
                },
            });
            return this.toGHIIRecord(row);
        } catch (e) {
            if ((e as { code?: string })?.code === 'P2002') throw new Error('GHII_TAKEN', { cause: e });
            throw e;
        }
    },

    async getGHII(this: PrismaStorage, ghii: string): Promise<GHIIRecord | null> {
        this.ensureReady();
        const row = await this.prisma.ghii.findUnique({ where: { ghii } });
        return row ? this.toGHIIRecord(row) : null;
    },

    async getGHIIByOwner(this: PrismaStorage, ownerName: string): Promise<GHIIRecord | null> {
        this.ensureReady();
        const row = await this.prisma.ghii.findFirst({ where: { ownerName } });
        return row ? this.toGHIIRecord(row) : null;
    },

    async getGHIIByEmailHash(this: PrismaStorage, emailHash: string): Promise<GHIIRecord | null> {
        this.ensureReady();
        const row = await this.prisma.ghii.findFirst({ where: { emailHash } });
        return row ? this.toGHIIRecord(row) : null;
    },

    async getGHIIByGoogleSub(this: PrismaStorage, googleSub: string): Promise<GHIIRecord | null> {
        this.ensureReady();
        const row = await this.prisma.ghii.findFirst({ where: { googleSub } });
        return row ? this.toGHIIRecord(row) : null;
    },

    async getGHIIByExternalId(this: PrismaStorage, provider: string, sub: string): Promise<GHIIRecord | null> {
        this.ensureReady();
        // Google keeps its indexed mirror column for a fast path; all providers also live in the
        // generic externalIdentities JSON map.
        if (provider === 'google') {
            const byMirror = await this.prisma.ghii.findFirst({ where: { googleSub: sub } });
            if (byMirror) return this.toGHIIRecord(byMirror);
        }
        // JSON filtering differs by connector: PostgreSQL supports Prisma's `path`/`equals`, but the
        // MongoDB connector rejects `path` ("Unknown argument"). On Mongo we query the nested field
        // with native dot-notation via findRaw, then load the typed row by its (unique) ghii.
        if (this.schemaFileName() === 'schema.postgres.prisma') {
            const row = await this.prisma.ghii.findFirst({
                where: { externalIdentities: { path: [provider], equals: sub } },
            });
            return row ? this.toGHIIRecord(row) : null;
        }
        const raw = await this.prisma.ghii.findRaw({
            filter: { [`externalIdentities.${provider}`]: sub },
            options: { limit: 1 },
        }) as Array<{ ghii?: string }>;
        const ghiiVal = Array.isArray(raw) && raw.length > 0 ? raw[0].ghii : undefined;
        return ghiiVal ? this.getGHII(ghiiVal) : null;
    },

    async updateGHII(this: PrismaStorage, ghii: string, updates: Partial<GHIIRecord>): Promise<GHIIRecord | null> {
        this.ensureReady();
        try {
            const row = await this.prisma.ghii.update({ where: { ghii }, data: updates });
            return this.toGHIIRecord(row);
        } catch { return null; }
    },

    async listGHIIs(this: PrismaStorage, opts?: { q?: string; level?: number }): Promise<GHIIRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
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
        return rows.map((r: PrismaRow) => this.toGHIIRecord(r));
    },

    async deleteGHII(this: PrismaStorage, ghii: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.ghii.delete({ where: { ghii } });
            return true;
        } catch { return false; }
    },

    // ── Chat Instances ──

    async createChatInstance(this: PrismaStorage, record: ChatInstanceRecord): Promise<ChatInstanceRecord> {
        this.ensureReady();
        await this.prisma.chatInstance.create({
            data: { id: record.id, platform: record.platform, appName: record.appName, ownerName: record.ownerName, ghii: record.ghii, nodeId: record.nodeId, isAnonymous: record.isAnonymous, createdAt: new Date(record.createdAt), lastSeen: new Date(record.lastSeen), agentGaii: record.agentGaii ?? null, mcpClientId: record.mcpClientId ?? null },
        });
        return record;
    },

    async getChatInstance(this: PrismaStorage, id: string): Promise<ChatInstanceRecord | null> {
        this.ensureReady();
        const row = await this.prisma.chatInstance.findUnique({ where: { id } });
        return row ? this.toChatInstanceRecord(row) : null;
    },

    async listChatInstances(this: PrismaStorage, opts?: { ownerName?: string; platform?: string; ghii?: string }): Promise<ChatInstanceRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (opts?.ownerName) where.ownerName = opts.ownerName;
        if (opts?.platform) where.platform = opts.platform;
        if (opts?.ghii) where.ghii = opts.ghii;
        const rows = await this.prisma.chatInstance.findMany({ where });
        return rows.map((r: PrismaRow) => this.toChatInstanceRecord(r));
    },

    async updateChatInstance(this: PrismaStorage, id: string, updates: Partial<ChatInstanceRecord>): Promise<ChatInstanceRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.lastSeen) data.lastSeen = new Date(updates.lastSeen);
            if (updates.platform) data.platform = updates.platform;
            if (updates.appName) data.appName = updates.appName;
            if (updates.agentGaii !== undefined) data.agentGaii = updates.agentGaii;
            if (updates.mcpClientId !== undefined) data.mcpClientId = updates.mcpClientId;
            const row = await this.prisma.chatInstance.update({ where: { id }, data });
            return this.toChatInstanceRecord(row);
        } catch { return null; }
    },

    async deleteChatInstance(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.chatInstance.delete({ where: { id } }); return true; } catch { return false; }
    },

    toChatInstanceRecord(this: PrismaStorage, row: PrismaRow): ChatInstanceRecord {
        return { id: row.id, platform: row.platform, appName: row.appName, ownerName: row.ownerName, ghii: row.ghii, nodeId: row.nodeId, isAnonymous: row.isAnonymous, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, lastSeen: row.lastSeen instanceof Date ? row.lastSeen.toISOString() : row.lastSeen, agentGaii: row.agentGaii || undefined, mcpClientId: row.mcpClientId || undefined };
    },

    // ── Personal Nodes ──

    async createPersonalNode(this: PrismaStorage, node: PersonalNodeRecord): Promise<PersonalNodeRecord> {
        this.ensureReady();
        await this.prisma.personalNode.create({
            data: { id: node.nodeId, ownerName: node.ownerName, anchorNodeId: node.anchorNodeId, publicKey: node.publicKey, status: node.status, agentGaiis: node.agentGaiis, lastSeen: new Date(node.lastSeen), mailboxQuotaBytes: node.mailboxQuotaBytes, mailboxUsedBytes: node.mailboxUsedBytes, visibility: node.visibility, createdAt: new Date(node.createdAt) },
        });
        return node;
    },

    async getPersonalNode(this: PrismaStorage, nodeId: string): Promise<PersonalNodeRecord | null> {
        this.ensureReady();
        const row = await this.prisma.personalNode.findUnique({ where: { id: nodeId } });
        return row ? this.toPersonalNodeRecord(row) : null;
    },

    async getPersonalNodeByOwner(this: PrismaStorage, ownerName: string): Promise<PersonalNodeRecord | null> {
        this.ensureReady();
        const row = await this.prisma.personalNode.findFirst({ where: { ownerName } });
        return row ? this.toPersonalNodeRecord(row) : null;
    },

    async listPersonalNodes(this: PrismaStorage, opts?: { status?: string }): Promise<PersonalNodeRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.personalNode.findMany({ where });
        return rows.map((r: PrismaRow) => this.toPersonalNodeRecord(r));
    },

    async updatePersonalNode(this: PrismaStorage, nodeId: string, updates: Partial<PersonalNodeRecord>): Promise<PersonalNodeRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = { ...updates };
            delete data.nodeId;
            if (data.lastSeen && typeof data.lastSeen === 'string') data.lastSeen = new Date(data.lastSeen);
            if (data.createdAt && typeof data.createdAt === 'string') data.createdAt = new Date(data.createdAt);
            const row = await this.prisma.personalNode.update({ where: { id: nodeId }, data });
            return this.toPersonalNodeRecord(row);
        } catch { return null; }
    },

    async deletePersonalNode(this: PrismaStorage, nodeId: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.personalNode.delete({ where: { id: nodeId } }); return true; } catch { return false; }
    },

    toPersonalNodeRecord(this: PrismaStorage, row: PrismaRow): PersonalNodeRecord {
        return { nodeId: row.id, ownerName: row.ownerName, anchorNodeId: row.anchorNodeId, publicKey: row.publicKey, status: row.status, agentGaiis: row.agentGaiis, lastSeen: row.lastSeen instanceof Date ? row.lastSeen.toISOString() : row.lastSeen, mailboxQuotaBytes: row.mailboxQuotaBytes, mailboxUsedBytes: row.mailboxUsedBytes, visibility: row.visibility, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt };
    },

    // ── Mailbox ──

    async createMailboxItem(this: PrismaStorage, item: MailboxItemRecord): Promise<MailboxItemRecord> {
        this.ensureReady();
        await this.prisma.mailboxItem.create({
            data: { id: item.id, personalNodeId: item.personalNodeId, type: item.type, fromGaii: item.fromGaii, toGaii: item.toGaii, payload: item.payload, sizeBytes: item.sizeBytes, retentionDays: item.retentionDays, expiresAt: new Date(item.expiresAt), createdAt: new Date(item.createdAt) },
        });
        // Update personal node mailbox usage
        try { await this.prisma.personalNode.update({ where: { id: item.personalNodeId }, data: { mailboxUsedBytes: { increment: item.sizeBytes } } }); } catch { /* best-effort */ }
        return item;
    },

    async getMailboxItem(this: PrismaStorage, id: string): Promise<MailboxItemRecord | null> {
        this.ensureReady();
        const row = await this.prisma.mailboxItem.findUnique({ where: { id } });
        return row ? this.toMailboxItemRecord(row) : null;
    },

    async listMailboxItems(this: PrismaStorage, personalNodeId: string, opts?: { type?: string; limit?: number }): Promise<MailboxItemRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = { personalNodeId };
        if (opts?.type) where.type = opts.type;
        const rows = await this.prisma.mailboxItem.findMany({ where, orderBy: { createdAt: 'asc' }, take: opts?.limit });
        return rows.map((r: PrismaRow) => this.toMailboxItemRecord(r));
    },

    async deleteMailboxItem(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try {
            const item = await this.prisma.mailboxItem.findUnique({ where: { id } });
            if (!item) return false;
            await this.prisma.mailboxItem.delete({ where: { id } });
            try { await this.prisma.personalNode.update({ where: { id: item.personalNodeId }, data: { mailboxUsedBytes: { decrement: item.sizeBytes } } }); } catch { /* best-effort */ }
            return true;
        } catch { return false; }
    },

    async deleteMailboxItemsByNode(this: PrismaStorage, personalNodeId: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.mailboxItem.deleteMany({ where: { personalNodeId } });
        try { await this.prisma.personalNode.update({ where: { id: personalNodeId }, data: { mailboxUsedBytes: 0 } }); } catch { /* best-effort */ }
        return result.count;
    },

    async getMailboxStats(this: PrismaStorage, personalNodeId: string): Promise<{ count: number; totalBytes: number }> {
        this.ensureReady();
        const result = await this.prisma.mailboxItem.aggregate({ where: { personalNodeId }, _count: true, _sum: { sizeBytes: true } });
        return { count: result._count, totalBytes: result._sum.sizeBytes ?? 0 };
    },

    async cleanExpiredMailboxItems(this: PrismaStorage): Promise<number> {
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
    },

    toMailboxItemRecord(this: PrismaStorage, row: PrismaRow): MailboxItemRecord {
        return { id: row.id, personalNodeId: row.personalNodeId, type: row.type, fromGaii: row.fromGaii, toGaii: row.toGaii, payload: row.payload, sizeBytes: row.sizeBytes, retentionDays: row.retentionDays, expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt };
    },

    // ── Maintenance Mode ────────────────────────────────────────

    async getMaintenanceMode(this: PrismaStorage): Promise<import('../../../interface.js').MaintenanceState> {
        this.ensureReady();
        const row = await this.prisma.systemSetting.findUnique({ where: { key: 'maintenance' } });
        if (!row) return { enabled: false, message: '', enabledAt: null, enabledBy: null };
        return JSON.parse(row.value) as import('../../../interface.js').MaintenanceState;
    },

    async setMaintenanceMode(this: PrismaStorage, state: import('../../../interface.js').MaintenanceState): Promise<import('../../../interface.js').MaintenanceState> {
        this.ensureReady();
        await this.prisma.systemSetting.upsert({
            where: { key: 'maintenance' },
            create: { key: 'maintenance', value: JSON.stringify(state) },
            update: { value: JSON.stringify(state) },
        });
        return state;
    },

    // ── Schema Locking ──

    async setSchema(this: PrismaStorage, record: SchemaRecord): Promise<SchemaRecord> {
        this.ensureReady();
        await this.prisma.schemaLock.upsert({
            where: { applyTo_keyPattern: { applyTo: record.applyTo, keyPattern: record.keyPattern } },
            create: { keyPattern: record.keyPattern, applyTo: record.applyTo, schemaJson: record.schemaJson, schemaMode: record.schemaMode, lockedBy: record.lockedBy, setAt: new Date(record.setAt), semanticContext: record.semanticContext ?? null },
            update: { schemaJson: record.schemaJson, schemaMode: record.schemaMode, lockedBy: record.lockedBy, semanticContext: record.semanticContext ?? null },
        });
        invalidateSchemaLockCache();
        return record;
    },

    async getSchema(this: PrismaStorage, keyPattern: string, applyTo?: 'exact' | 'prefix'): Promise<SchemaRecord | null> {
        this.ensureReady();
        if (applyTo) {
            const row = await this.prisma.schemaLock.findUnique({ where: { applyTo_keyPattern: { applyTo, keyPattern } } });
            return row ? this.toSchemaRecord(row) : null;
        }
        const exact = await this.prisma.schemaLock.findUnique({ where: { applyTo_keyPattern: { applyTo: 'exact', keyPattern } } });
        if (exact) return this.toSchemaRecord(exact);
        const prefix = await this.prisma.schemaLock.findUnique({ where: { applyTo_keyPattern: { applyTo: 'prefix', keyPattern } } });
        return prefix ? this.toSchemaRecord(prefix) : null;
    },

    async deleteSchema(this: PrismaStorage, keyPattern: string): Promise<boolean> {
        this.ensureReady();
        let deleted = false;
        try { await this.prisma.schemaLock.delete({ where: { applyTo_keyPattern: { applyTo: 'exact', keyPattern } } }); deleted = true; } catch { /* best-effort */ }
        try { await this.prisma.schemaLock.delete({ where: { applyTo_keyPattern: { applyTo: 'prefix', keyPattern } } }); deleted = true; } catch { /* best-effort */ }
        if (deleted) invalidateSchemaLockCache();
        return deleted;
    },

    async listSchemas(this: PrismaStorage, prefix?: string): Promise<SchemaRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (prefix) where.keyPattern = { startsWith: prefix };
        const rows = await this.prisma.schemaLock.findMany({ where });
        return rows.map((r: PrismaRow) => this.toSchemaRecord(r));
    },

    async findApplicableSchema(this: PrismaStorage, memoryKey: string): Promise<SchemaRecord | null> {
        this.ensureReady();
        // Resolve against the process-cached lock set (loaded once, invalidated on setSchema/deleteSchema)
        // — findApplicableSchema runs on every write; hitting the DB for the exact key + all prefix locks +
        // per-segment probes each time was ~8 round-trips/write. Matching in memory makes it 0 after warm-up.
        let locks = getCachedSchemaLocks();
        if (!locks) { locks = await this.listSchemas(); setCachedSchemaLocks(locks); }

        // 1. Exact match — highest priority
        const exact = locks.find(l => l.applyTo === 'exact' && l.keyPattern === memoryKey);
        if (exact) return exact;

        // 2. Prefix schemas for pattern matching
        const allPrefixRecords = locks.filter(l => l.applyTo === 'prefix');

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

        // 3. Simple prefix match — longest prefix wins (in-memory over the cached prefix locks)
        const parts = memoryKey.split('.');
        for (let i = parts.length - 1; i >= 1; i--) {
            const pfx = parts.slice(0, i).join('.');
            const pfxRow = allPrefixRecords.find(l => l.keyPattern === pfx);
            if (pfxRow) return pfxRow;
        }
        return null;
    },

    toSchemaRecord(this: PrismaStorage, row: PrismaRow): SchemaRecord {
        return { keyPattern: row.keyPattern, applyTo: row.applyTo, schemaJson: row.schemaJson as Record<string, unknown>, schemaMode: row.schemaMode, lockedBy: row.lockedBy, setAt: row.setAt instanceof Date ? row.setAt.toISOString() : row.setAt, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt, semanticContext: row.semanticContext ?? undefined };
    },
};
