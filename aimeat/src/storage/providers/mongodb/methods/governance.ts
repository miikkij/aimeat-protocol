/**
 * @file src/storage/providers/mongodb/methods/governance.ts
 * @description Consent, CSM/MSM, email verification, flags, matches, organisms, approvals, and appeals methods. Extracted from mongodb/index.ts (PrismaStorage) to satisfy max-file-lines; method bodies verbatim, bound to PrismaStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/mongodb/index.ts (max-file-lines)
 */
import type {
  ConsentRecord, ConsentAuditEntry, CsmRecord, MsmRecord, EmailVerificationRecord
} from '../../../interface.js';
import { matchesRecipient } from '../../../../services/consent.js';
import { parseGaiiLoose } from '../../../../utils/gaii.js';
import { mongoConsentMatchPattern } from './helpers.js';
import type { PrismaStorage, PrismaRow } from '../index.js';

export const governanceMethods = {
    // ── Consent Layer ──

    async createConsent(this: PrismaStorage, record: ConsentRecord): Promise<ConsentRecord> {
        this.ensureReady();
        await this.prisma.consent.create({
            data: { id: record.id, ownerGaii: record.ownerGaii, dataPattern: record.dataPattern, recipient: record.recipient, purpose: record.purpose, scope: record.scope, expires: record.expires ? new Date(record.expires) : null, status: record.status, grantedAt: new Date(record.grantedAt), revokedAt: record.revokedAt ? new Date(record.revokedAt) : null, metadata: record.metadata ?? null },
        });
        return record;
    },

    async getConsent(this: PrismaStorage, id: string): Promise<ConsentRecord | null> {
        this.ensureReady();
        const row = await this.prisma.consent.findUnique({ where: { id } });
        return row ? this.toConsentRecord(row) : null;
    },

    async listConsents(this: PrismaStorage, ownerGaii: string, opts?: { status?: 'active' | 'revoked' | 'expired'; recipient?: string }): Promise<ConsentRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = { ownerGaii };
        if (opts?.status) where.status = opts.status;
        if (opts?.recipient) where.recipient = opts.recipient;
        const rows = await this.prisma.consent.findMany({ where });
        return rows.map((r: PrismaRow) => this.toConsentRecord(r));
    },

    async updateConsent(this: PrismaStorage, id: string, updates: Partial<ConsentRecord>): Promise<ConsentRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.status) data.status = updates.status;
            if (updates.revokedAt) data.revokedAt = new Date(updates.revokedAt);
            if (updates.expires !== undefined) data.expires = updates.expires ? new Date(updates.expires) : null;
            if (updates.metadata !== undefined) data.metadata = updates.metadata;
            const row = await this.prisma.consent.update({ where: { id }, data });
            return this.toConsentRecord(row);
        } catch { return null; }
    },

    async deleteConsent(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.consent.delete({ where: { id } }); return true; } catch { return false; }
    },

    async findMatchingConsents(this: PrismaStorage, ownerGaii: string, memoryKey: string, accessorGaii: string): Promise<ConsentRecord[]> {
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
    },

    async expireStaleConsents(this: PrismaStorage, before: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.consent.updateMany({
            where: { status: 'active', expires: { not: null, lt: new Date(before) } },
            data: { status: 'expired' },
        });
        return result.count;
    },

    // Consent Audit
    async addConsentAuditEntry(this: PrismaStorage, entry: ConsentAuditEntry): Promise<ConsentAuditEntry> {
        this.ensureReady();
        await this.prisma.consentAudit.create({
            data: { consentId: entry.consentId, ownerGaii: entry.ownerGaii, accessorGaii: entry.accessorGaii, memoryKey: entry.memoryKey, action: entry.action, timestamp: new Date(entry.timestamp), allowed: entry.allowed },
        });
        return entry;
    },

    async pruneConsentAudit(this: PrismaStorage, beforeIso: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.consentAudit.deleteMany({ where: { timestamp: { lt: new Date(beforeIso) } } });
        return result.count;
    },

    async listConsentAudit(this: PrismaStorage, ownerGaii: string, opts?: { days?: number; consentId?: string; accessorGaii?: string }): Promise<ConsentAuditEntry[]> {
        this.ensureReady();
        const where: Record<string, unknown> = { ownerGaii };
        if (opts?.days) where.timestamp = { gte: new Date(Date.now() - opts.days * 86400000) };
        if (opts?.consentId) where.consentId = opts.consentId;
        if (opts?.accessorGaii) where.accessorGaii = opts.accessorGaii;
        const rows = await this.prisma.consentAudit.findMany({ where, orderBy: { timestamp: 'desc' } });
        return rows.map((r: PrismaRow) => ({ id: r.id, consentId: r.consentId, ownerGaii: r.ownerGaii, accessorGaii: r.accessorGaii, memoryKey: r.memoryKey, action: r.action, timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp, allowed: r.allowed }));
    },

    toConsentRecord(this: PrismaStorage, row: PrismaRow): ConsentRecord {
        return { id: row.id, ownerGaii: row.ownerGaii, dataPattern: row.dataPattern, recipient: row.recipient, purpose: row.purpose, scope: row.scope, expires: row.expires ? (row.expires instanceof Date ? row.expires.toISOString() : row.expires) : null, status: row.status, grantedAt: row.grantedAt instanceof Date ? row.grantedAt.toISOString() : row.grantedAt, revokedAt: row.revokedAt ? (row.revokedAt instanceof Date ? row.revokedAt.toISOString() : row.revokedAt) : null, metadata: row.metadata ?? undefined };
    },

    // ── CSM — Community Service Manifest ──

    async createCsm(this: PrismaStorage, record: CsmRecord): Promise<CsmRecord> {
        this.ensureReady();
        try {
            await this.prisma.csm.create({
                data: { name: record.name, definition: record.definition, jsonSchemaKey: record.jsonSchemaKey, serviceType: record.serviceType, registeredBy: record.registeredBy, registeredAt: new Date(record.registeredAt), semantic: record.semantic ?? null, federate: record.federate ?? false },
            });
            return record;
        } catch { throw new Error('CSM_NAME_TAKEN'); }
    },

    async getCsm(this: PrismaStorage, name: string): Promise<CsmRecord | null> {
        this.ensureReady();
        const row = await this.prisma.csm.findUnique({ where: { name } });
        return row ? this.toCsmRecord(row) : null;
    },

    async listCsms(this: PrismaStorage, opts?: { serviceType?: string }): Promise<CsmRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (opts?.serviceType) where.serviceType = opts.serviceType;
        const rows = await this.prisma.csm.findMany({ where });
        return rows.map((r: PrismaRow) => this.toCsmRecord(r));
    },

    async updateCsm(this: PrismaStorage, name: string, updates: Partial<CsmRecord>): Promise<CsmRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.definition) data.definition = updates.definition;
            if (updates.serviceType) data.serviceType = updates.serviceType;
            if (updates.semantic !== undefined) data.semantic = updates.semantic;
            if (updates.federate !== undefined) data.federate = updates.federate;
            const row = await this.prisma.csm.update({ where: { name }, data });
            return this.toCsmRecord(row);
        } catch { return null; }
    },

    async deleteCsm(this: PrismaStorage, name: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.csm.delete({ where: { name } }); return true; } catch { return false; }
    },

    toCsmRecord(this: PrismaStorage, row: PrismaRow): CsmRecord {
        return { name: row.name, definition: row.definition as Record<string, unknown>, jsonSchemaKey: row.jsonSchemaKey, serviceType: row.serviceType, registeredBy: row.registeredBy, registeredAt: row.registeredAt instanceof Date ? row.registeredAt.toISOString() : row.registeredAt, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt, semantic: row.semantic ?? undefined, federate: row.federate ?? undefined };
    },

    // ── MSM — Machine Service Manifest ──

    async createMsm(this: PrismaStorage, record: MsmRecord): Promise<MsmRecord> {
        this.ensureReady();
        try {
            await this.prisma.msm.create({
                data: { name: record.name, definition: record.definition, category: record.category, authType: record.authType, actionsCount: record.actionsCount, registeredBy: record.registeredBy, registeredAt: new Date(record.registeredAt), federate: record.federate ?? false },
            });
            return record;
        } catch { throw new Error('MSM_NAME_TAKEN'); }
    },

    async getMsm(this: PrismaStorage, name: string): Promise<MsmRecord | null> {
        this.ensureReady();
        const row = await this.prisma.msm.findUnique({ where: { name } });
        return row ? this.toMsmRecord(row) : null;
    },

    async listMsms(this: PrismaStorage, opts?: { category?: string }): Promise<MsmRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = {};
        if (opts?.category) where.category = opts.category;
        const rows = await this.prisma.msm.findMany({ where });
        return rows.map((r: PrismaRow) => this.toMsmRecord(r));
    },

    async updateMsm(this: PrismaStorage, name: string, updates: Partial<MsmRecord>): Promise<MsmRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.definition) data.definition = updates.definition;
            if (updates.category) data.category = updates.category;
            if (updates.authType) data.authType = updates.authType;
            if (updates.actionsCount !== undefined) data.actionsCount = updates.actionsCount;
            if (updates.federate !== undefined) data.federate = updates.federate;
            const row = await this.prisma.msm.update({ where: { name }, data });
            return this.toMsmRecord(row);
        } catch { return null; }
    },

    async deleteMsm(this: PrismaStorage, name: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.msm.delete({ where: { name } }); return true; } catch { return false; }
    },

    toMsmRecord(this: PrismaStorage, row: PrismaRow): MsmRecord {
        return { name: row.name, definition: row.definition as Record<string, unknown>, category: row.category, authType: row.authType, actionsCount: row.actionsCount, registeredBy: row.registeredBy, registeredAt: row.registeredAt instanceof Date ? row.registeredAt.toISOString() : row.registeredAt, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt, federate: row.federate ?? undefined };
    },

    // ── Email Verification ──

    async createEmailVerification(this: PrismaStorage, record: EmailVerificationRecord): Promise<EmailVerificationRecord> {
        this.ensureReady();
        await this.prisma.emailVerification.create({
            data: { id: record.id, ownerName: record.ownerName, emailHash: record.emailHash, code: record.code, purpose: record.purpose, status: record.status, attempts: record.attempts, expiresAt: new Date(record.expiresAt), createdAt: new Date(record.createdAt), verifiedAt: record.verifiedAt ? new Date(record.verifiedAt) : null },
        });
        return record;
    },

    async getEmailVerification(this: PrismaStorage, id: string): Promise<EmailVerificationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.emailVerification.findUnique({ where: { id } });
        return row ? this.toEmailVerificationRecord(row) : null;
    },

    async getActiveEmailVerification(this: PrismaStorage, ownerName: string, purpose: string): Promise<EmailVerificationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.emailVerification.findFirst({ where: { ownerName, purpose, status: 'pending', expiresAt: { gt: new Date() } } });
        return row ? this.toEmailVerificationRecord(row) : null;
    },

    async updateEmailVerification(this: PrismaStorage, id: string, updates: Partial<EmailVerificationRecord>): Promise<EmailVerificationRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.status) data.status = updates.status;
            if (updates.attempts !== undefined) data.attempts = updates.attempts;
            if (updates.verifiedAt) data.verifiedAt = new Date(updates.verifiedAt);
            const row = await this.prisma.emailVerification.update({ where: { id }, data });
            return this.toEmailVerificationRecord(row);
        } catch { return null; }
    },

    async deleteExpiredEmailVerifications(this: PrismaStorage): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.emailVerification.deleteMany({ where: { status: 'pending', expiresAt: { lt: new Date() } } });
        return result.count;
    },

    toEmailVerificationRecord(this: PrismaStorage, row: PrismaRow): EmailVerificationRecord {
        return { id: row.id, ownerName: row.ownerName, emailHash: row.emailHash, code: row.code, purpose: row.purpose, status: row.status, attempts: row.attempts, expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, verifiedAt: row.verifiedAt ? (row.verifiedAt instanceof Date ? row.verifiedAt.toISOString() : row.verifiedAt) : null };
    },

    // ── Flags (Phase 1.5) ──────────────────────────────────

    async createFlag(this: PrismaStorage, record: import('../../../interface.js').FlagRecord): Promise<import('../../../interface.js').FlagRecord> {
        this.ensureReady();
        await this.prisma.flag.create({ data: { id: record.id, targetType: record.targetType, targetId: record.targetId, flaggedBy: record.flaggedBy, reason: record.reason, description: record.description, status: record.status, createdAt: new Date(record.createdAt) } });
        return record;
    },

    async getFlag(this: PrismaStorage, id: string): Promise<import('../../../interface.js').FlagRecord | null> {
        this.ensureReady();
        const row = await this.prisma.flag.findUnique({ where: { id } });
        return row ? this.toFlagRecord(row) : null;
    },

    async getFlagsByTarget(this: PrismaStorage, targetType: string, targetId: string): Promise<import('../../../interface.js').FlagRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.flag.findMany({ where: { targetType, targetId } });
        return rows.map((r: PrismaRow) => this.toFlagRecord(r));
    },

    async getFlagByUser(this: PrismaStorage, targetType: string, targetId: string, flaggedBy: string): Promise<import('../../../interface.js').FlagRecord | null> {
        this.ensureReady();
        const row = await this.prisma.flag.findFirst({ where: { targetType, targetId, flaggedBy } });
        return row ? this.toFlagRecord(row) : null;
    },

    async getFlagSummary(this: PrismaStorage, targetType: string, targetId: string): Promise<import('../../../interface.js').FlagSummary | null> {
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
    },

    async updateFlag(this: PrismaStorage, id: string, updates: Partial<import('../../../interface.js').FlagRecord>): Promise<import('../../../interface.js').FlagRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.status) data.status = updates.status;
            if (updates.reviewedBy) data.reviewedBy = updates.reviewedBy;
            if (updates.reviewedAt) data.reviewedAt = new Date(updates.reviewedAt);
            const row = await this.prisma.flag.update({ where: { id }, data });
            return this.toFlagRecord(row);
        } catch { return null; }
    },

    async listFlags(this: PrismaStorage, opts?: { status?: string; targetType?: string; page?: number; perPage?: number }): Promise<import('../../../interface.js').FlagRecord[]> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where: Record<string, unknown> = {};
        if (opts?.status) where.status = opts.status;
        if (opts?.targetType) where.targetType = opts.targetType;
        const rows = await this.prisma.flag.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage });
        return rows.map((r: PrismaRow) => this.toFlagRecord(r));
    },

    toFlagRecord(this: PrismaStorage, row: PrismaRow): import('../../../interface.js').FlagRecord {
        return { id: row.id, targetType: row.targetType, targetId: row.targetId, flaggedBy: row.flaggedBy, reason: row.reason, description: row.description ?? undefined, status: row.status, reviewedBy: row.reviewedBy ?? undefined, reviewedAt: row.reviewedAt ? (row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : row.reviewedAt) : undefined, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt };
    },

    // ── Matches (Phase 2.1) ──

    async createMatch(this: PrismaStorage, record: import('../../../interface.js').MatchRecord): Promise<import('../../../interface.js').MatchRecord> {
        this.ensureReady();
        await this.prisma.match.create({ data: { id: record.id, profileA: record.profileA, profileB: record.profileB, score: record.score, breakdown: record.breakdown, status: record.status, notifiedAt: record.notifiedAt ? new Date(record.notifiedAt) : null, respondedAt: record.respondedAt ? new Date(record.respondedAt) : null, expiresAt: new Date(record.expiresAt), createdAt: new Date(record.createdAt) } });
        return record;
    },

    async getMatch(this: PrismaStorage, id: string): Promise<import('../../../interface.js').MatchRecord | null> {
        this.ensureReady();
        const row = await this.prisma.match.findUnique({ where: { id } });
        return row ? this.toMatchRecord(row) : null;
    },

    async getMatchByPair(this: PrismaStorage, profileA: string, profileB: string): Promise<import('../../../interface.js').MatchRecord | null> {
        this.ensureReady();
        const row = await this.prisma.match.findFirst({ where: { OR: [{ profileA, profileB }, { profileA: profileB, profileB: profileA }] } });
        return row ? this.toMatchRecord(row) : null;
    },

    async listMatchesByProfile(this: PrismaStorage, profile: string, opts?: { status?: string; page?: number; perPage?: number }): Promise<import('../../../interface.js').MatchRecord[]> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 10;
        const where: Record<string, unknown> = { OR: [{ profileA: profile }, { profileB: profile }] };
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.match.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage });
        return rows.map((r: PrismaRow) => this.toMatchRecord(r));
    },

    async updateMatch(this: PrismaStorage, id: string, updates: Partial<import('../../../interface.js').MatchRecord>): Promise<import('../../../interface.js').MatchRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.status) data.status = updates.status;
            if (updates.notifiedAt) data.notifiedAt = new Date(updates.notifiedAt);
            if (updates.respondedAt) data.respondedAt = new Date(updates.respondedAt);
            const row = await this.prisma.match.update({ where: { id }, data });
            return this.toMatchRecord(row);
        } catch { return null; }
    },

    async deleteExpiredMatches(this: PrismaStorage): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.match.deleteMany({ where: { expiresAt: { lt: new Date() }, status: { not: 'accepted' } } });
        return result.count;
    },

    async deleteMatchesByProfile(this: PrismaStorage, profile: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.match.deleteMany({ where: { OR: [{ profileA: profile }, { profileB: profile }] } });
        return result.count;
    },

    async listAllMatches(this: PrismaStorage, limit = 10000): Promise<import('../../../interface.js').MatchRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.match.findMany({ take: Math.min(limit, 10000) });
        return rows.map((r: PrismaRow) => this.toMatchRecord(r));
    },

    toMatchRecord(this: PrismaStorage, row: PrismaRow): import('../../../interface.js').MatchRecord {
        return { id: row.id, profileA: row.profileA, profileB: row.profileB, score: row.score, breakdown: row.breakdown, status: row.status, notifiedAt: row.notifiedAt ? (row.notifiedAt instanceof Date ? row.notifiedAt.toISOString() : row.notifiedAt) : null, respondedAt: row.respondedAt ? (row.respondedAt instanceof Date ? row.respondedAt.toISOString() : row.respondedAt) : null, expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt };
    },

    // ── Organisms (Phase 2.2) ──

    async createOrganism(this: PrismaStorage, record: import('../../../interface.js').OrganismRecord): Promise<import('../../../interface.js').OrganismRecord> {
        this.ensureReady();
        await this.prisma.organism.create({ data: { id: record.id, name: record.name, description: record.description, type: record.type, location: record.location ?? null, interests: record.interests, creatorGhii: record.creatorGhii, admins: record.admins, members: record.members, agentGaiis: record.agentGaiis, boardId: record.boardId, joinPolicy: record.joinPolicy, maxMembers: record.maxMembers, visibility: record.visibility, memberVisibility: record.memberVisibility ?? null, moderationConfig: record.moderationConfig, memoryNamespace: record.memoryNamespace, semantic: record.semantic ?? null, archived: record.archived ?? false, archivedAt: record.archivedAt ? new Date(record.archivedAt) : null, archivedBy: record.archivedBy ?? null, createdAt: new Date(record.createdAt) } });
        return record;
    },

    async getOrganism(this: PrismaStorage, id: string): Promise<import('../../../interface.js').OrganismRecord | null> {
        this.ensureReady();
        const row = await this.prisma.organism.findUnique({ where: { id } });
        return row ? this.toOrganismRecord(row) : null;
    },

    async listOrganisms(this: PrismaStorage, opts?: { type?: string; city?: string; interest?: string; visibility?: string; member?: string; page?: number; perPage?: number; archived?: import('../../../interface.js').ArchiveFilter }): Promise<import('../../../interface.js').OrganismRecord[]> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where: Record<string, unknown> = {};
        if (opts?.type) where.type = opts.type;
        if (opts?.visibility) where.visibility = opts.visibility;
        // Archive filter — default include; `{ not: true }` for exclude also matches legacy docs that
        // predate the field (belt-and-suspenders alongside the startup backfill).
        if (opts?.archived === 'exclude') where.archived = { not: true };
        else if (opts?.archived === 'only') where.archived = true;
        // city and interest filtering done post-query (JSON field)
        const rows = await this.prisma.organism.findMany({ where, orderBy: { createdAt: 'desc' } });
        let results = rows.map((r: PrismaRow) => this.toOrganismRecord(r));
        if (opts?.city) results = results.filter((o: PrismaRow) => o.location?.city?.toLowerCase() === opts.city!.toLowerCase());
        if (opts?.interest) results = results.filter((o: PrismaRow) => o.interests.some((i: string) => i.toLowerCase() === opts.interest!.toLowerCase()));
        if (opts?.member) results = results.filter((o: PrismaRow) => o.members.includes(opts.member!));
        const start = (page - 1) * perPage;
        return results.slice(start, start + perPage);
    },

    async updateOrganism(this: PrismaStorage, id: string, updates: Partial<import('../../../interface.js').OrganismRecord>): Promise<import('../../../interface.js').OrganismRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = { ...updates };
            delete data.id;
            if (data.location) data.location = data.location as unknown;
            if (data.moderationConfig) data.moderationConfig = data.moderationConfig as unknown;
            if (data.semantic) data.semantic = data.semantic as unknown;
            if (data.createdAt && typeof data.createdAt === 'string') data.createdAt = new Date(data.createdAt);
            if (data.archivedAt && typeof data.archivedAt === 'string') data.archivedAt = new Date(data.archivedAt);
            const row = await this.prisma.organism.update({ where: { id }, data });
            return this.toOrganismRecord(row);
        } catch { return null; }
    },

    async deleteOrganism(this: PrismaStorage, id: string): Promise<boolean> {
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
            // Delete ALL content under the organism's key namespace, across every owner — workspace
            // records/documents/meta are keyed `organism.{id}.…` but owned by the member who wrote
            // them, NOT by memoryNamespace, so a delete-by-ownerGaii left them orphaned (and still
            // findable via librarian search). Delete by key prefix; also the trackable-version history and
            // any locked schemas under the prefix.
            const orgKey = `organism.${id}`;
            const keyFilter = { OR: [{ key: orgKey }, { key: { startsWith: `${orgKey}.` } }] };
            await this.prisma.memory.deleteMany({ where: keyFilter });
            await this.prisma.memoryVersion.deleteMany({ where: keyFilter });
            await this.prisma.schemaLock.deleteMany({ where: { OR: [{ keyPattern: orgKey }, { keyPattern: { startsWith: `${orgKey}.` } }] } });
        }
        try { await this.prisma.organism.delete({ where: { id } }); return true; } catch { return false; }
    },

    toOrganismRecord(this: PrismaStorage, row: PrismaRow): import('../../../interface.js').OrganismRecord {
        return { id: row.id, name: row.name, description: row.description, type: row.type, location: row.location ?? undefined, interests: row.interests, creatorGhii: row.creatorGhii, admins: row.admins, members: row.members, agentGaiis: row.agentGaiis, boardId: row.boardId, joinPolicy: row.joinPolicy, maxMembers: row.maxMembers, visibility: row.visibility, memberVisibility: row.memberVisibility ?? undefined, moderationConfig: row.moderationConfig, memoryNamespace: row.memoryNamespace, semantic: row.semantic ?? undefined, archived: row.archived ? true : undefined, archivedAt: row.archivedAt ? (row.archivedAt instanceof Date ? row.archivedAt.toISOString() : row.archivedAt) : undefined, archivedBy: row.archivedBy ?? undefined, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt };
    },

    async createMembership(this: PrismaStorage, record: import('../../../interface.js').OrganismMembershipRecord): Promise<import('../../../interface.js').OrganismMembershipRecord> {
        this.ensureReady();
        await this.prisma.organismMembership.create({ data: { id: record.id, organismId: record.organismId, ghii: record.ghii, role: record.role, status: record.status, joinedAt: new Date(record.joinedAt), invitedBy: record.invitedBy } });
        return record;
    },

    async getMembership(this: PrismaStorage, organismId: string, ghii: string): Promise<import('../../../interface.js').OrganismMembershipRecord | null> {
        this.ensureReady();
        const row = await this.prisma.organismMembership.findUnique({ where: { organismId_ghii: { organismId, ghii } } });
        return row ? this.toMembershipRecord(row) : null;
    },

    async listMembers(this: PrismaStorage, organismId: string, opts?: { role?: string; status?: string }): Promise<import('../../../interface.js').OrganismMembershipRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = { organismId };
        if (opts?.role) where.role = opts.role;
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.organismMembership.findMany({ where });
        return rows.map((r: PrismaRow) => this.toMembershipRecord(r));
    },

    async listMembershipsByGhii(this: PrismaStorage, ghii: string): Promise<import('../../../interface.js').OrganismMembershipRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.organismMembership.findMany({ where: { ghii } });
        return rows.map((r: PrismaRow) => this.toMembershipRecord(r));
    },

    async updateMembership(this: PrismaStorage, id: string, updates: Partial<import('../../../interface.js').OrganismMembershipRecord>): Promise<import('../../../interface.js').OrganismMembershipRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.role) data.role = updates.role;
            if (updates.status) data.status = updates.status;
            const row = await this.prisma.organismMembership.update({ where: { id }, data });
            return this.toMembershipRecord(row);
        } catch { return null; }
    },

    async deleteMembership(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.organismMembership.delete({ where: { id } }); return true; } catch { return false; }
    },

    toMembershipRecord(this: PrismaStorage, row: PrismaRow): import('../../../interface.js').OrganismMembershipRecord {
        return { id: row.id, organismId: row.organismId, ghii: row.ghii, role: row.role, status: row.status, joinedAt: row.joinedAt instanceof Date ? row.joinedAt.toISOString() : row.joinedAt, invitedBy: row.invitedBy ?? undefined };
    },

    async createJoinRequest(this: PrismaStorage, record: import('../../../interface.js').JoinRequestRecord): Promise<import('../../../interface.js').JoinRequestRecord> {
        this.ensureReady();
        await this.prisma.joinRequest.create({ data: { id: record.id, organismId: record.organismId, ghii: record.ghii, message: record.message, status: record.status, reviewedBy: record.reviewedBy, createdAt: new Date(record.createdAt), reviewedAt: record.reviewedAt ? new Date(record.reviewedAt) : null } });
        return record;
    },

    async getJoinRequest(this: PrismaStorage, id: string): Promise<import('../../../interface.js').JoinRequestRecord | null> {
        this.ensureReady();
        const row = await this.prisma.joinRequest.findUnique({ where: { id } });
        return row ? this.toJoinRequestRecord(row) : null;
    },

    async listJoinRequests(this: PrismaStorage, organismId: string, opts?: { status?: string }): Promise<import('../../../interface.js').JoinRequestRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = { organismId };
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.joinRequest.findMany({ where });
        return rows.map((r: PrismaRow) => this.toJoinRequestRecord(r));
    },

    async updateJoinRequest(this: PrismaStorage, id: string, updates: Partial<import('../../../interface.js').JoinRequestRecord>): Promise<import('../../../interface.js').JoinRequestRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.status) data.status = updates.status;
            if (updates.reviewedBy) data.reviewedBy = updates.reviewedBy;
            if (updates.reviewedAt) data.reviewedAt = new Date(updates.reviewedAt);
            const row = await this.prisma.joinRequest.update({ where: { id }, data });
            return this.toJoinRequestRecord(row);
        } catch { return null; }
    },

    toJoinRequestRecord(this: PrismaStorage, row: PrismaRow): import('../../../interface.js').JoinRequestRecord {
        return { id: row.id, organismId: row.organismId, ghii: row.ghii, message: row.message ?? undefined, status: row.status, reviewedBy: row.reviewedBy ?? undefined, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, reviewedAt: row.reviewedAt ? (row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : row.reviewedAt) : undefined };
    },

    // ── Pending Approvals (Phase 4 — Gate primitive) ──

    async createPendingApproval(this: PrismaStorage, record: import('../../../interface.js').PendingApprovalRecord): Promise<import('../../../interface.js').PendingApprovalRecord> {
        this.ensureReady();
        await this.prisma.pendingApproval.create({ data: {
            id: record.id, organismId: record.organismId, flowGateId: record.flowGateId ?? null, stageId: record.stageId ?? null,
            actor: record.actor, action: record.action, arguments: (record.arguments ?? undefined), risk: record.risk,
            approverRole: record.approverRole, prompt: record.prompt ?? null, status: record.status,
            decidedBy: record.decidedBy ?? null, decidedAt: record.decidedAt ? new Date(record.decidedAt) : null,
            resolutionNote: record.resolutionNote ?? null, deadline: record.deadline ? new Date(record.deadline) : null,
            createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt),
        } });
        return record;
    },

    async getPendingApproval(this: PrismaStorage, id: string): Promise<import('../../../interface.js').PendingApprovalRecord | null> {
        this.ensureReady();
        const row = await this.prisma.pendingApproval.findUnique({ where: { id } });
        return row ? this.toPendingApprovalRecord(row) : null;
    },

    async listPendingApprovals(this: PrismaStorage, organismId: string, opts?: { status?: string }): Promise<import('../../../interface.js').PendingApprovalRecord[]> {
        this.ensureReady();
        const where: Record<string, unknown> = { organismId };
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.pendingApproval.findMany({ where, orderBy: { createdAt: 'desc' } });
        return rows.map((r: PrismaRow) => this.toPendingApprovalRecord(r));
    },

    async updatePendingApproval(this: PrismaStorage, id: string, updates: Partial<import('../../../interface.js').PendingApprovalRecord>): Promise<import('../../../interface.js').PendingApprovalRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.status !== undefined) data.status = updates.status;
            if (updates.decidedBy !== undefined) data.decidedBy = updates.decidedBy;
            if (updates.decidedAt !== undefined) data.decidedAt = updates.decidedAt ? new Date(updates.decidedAt) : null;
            if (updates.resolutionNote !== undefined) data.resolutionNote = updates.resolutionNote;
            if (updates.arguments !== undefined) data.arguments = updates.arguments;
            if (updates.deadline !== undefined) data.deadline = updates.deadline ? new Date(updates.deadline) : null;
            data.updatedAt = updates.updatedAt ? new Date(updates.updatedAt) : new Date();
            const row = await this.prisma.pendingApproval.update({ where: { id }, data });
            return this.toPendingApprovalRecord(row);
        } catch { return null; }
    },

    async listOverduePendingApprovals(this: PrismaStorage, nowIso: string): Promise<import('../../../interface.js').PendingApprovalRecord[]> {
        this.ensureReady();
        // Mirror SQLite: only approvals WITH a deadline that has passed. `not: null` is required —
        // in MongoDB a bare `{ lt: date }` also matches null deadlines, which would wrongly expire
        // gates that have no deadline (e.g. publish gates).
        const rows = await this.prisma.pendingApproval.findMany({ where: { status: 'pending', deadline: { not: null, lt: new Date(nowIso) } } });
        return rows.map((r: PrismaRow) => this.toPendingApprovalRecord(r));
    },

    toPendingApprovalRecord(this: PrismaStorage, row: PrismaRow): import('../../../interface.js').PendingApprovalRecord {
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
    },

    // ── Appeals (Phase 2.4) ──

    async createAppeal(this: PrismaStorage, record: import('../../../interface.js').AppealRecord): Promise<import('../../../interface.js').AppealRecord> {
        this.ensureReady();
        await this.prisma.appeal.create({ data: { id: record.id, flagId: record.flagId, appealedBy: record.appealedBy, reason: record.reason, status: record.status, createdAt: new Date(record.createdAt) } });
        return record;
    },

    async getAppeal(this: PrismaStorage, id: string): Promise<import('../../../interface.js').AppealRecord | null> {
        this.ensureReady();
        const row = await this.prisma.appeal.findUnique({ where: { id } });
        return row ? this.toAppealRecord(row) : null;
    },

    async getAppealByFlagId(this: PrismaStorage, flagId: string): Promise<import('../../../interface.js').AppealRecord | null> {
        this.ensureReady();
        const row = await this.prisma.appeal.findFirst({ where: { flagId } });
        return row ? this.toAppealRecord(row) : null;
    },

    async listAppeals(this: PrismaStorage, opts?: { status?: string; page?: number; perPage?: number }): Promise<import('../../../interface.js').AppealRecord[]> {
        this.ensureReady();
        const page = opts?.page ?? 1;
        const perPage = opts?.perPage ?? 20;
        const where: Record<string, unknown> = {};
        if (opts?.status) where.status = opts.status;
        const rows = await this.prisma.appeal.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage });
        return rows.map((r: PrismaRow) => this.toAppealRecord(r));
    },

    async updateAppeal(this: PrismaStorage, id: string, updates: Partial<import('../../../interface.js').AppealRecord>): Promise<import('../../../interface.js').AppealRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.status) data.status = updates.status;
            if (updates.reviewedBy) data.reviewedBy = updates.reviewedBy;
            if (updates.reviewNote) data.reviewNote = updates.reviewNote;
            if (updates.reviewedAt) data.reviewedAt = new Date(updates.reviewedAt);
            const row = await this.prisma.appeal.update({ where: { id }, data });
            return this.toAppealRecord(row);
        } catch { return null; }
    },

    toAppealRecord(this: PrismaStorage, row: PrismaRow): import('../../../interface.js').AppealRecord {
        return { id: row.id, flagId: row.flagId, appealedBy: row.appealedBy, reason: row.reason, status: row.status, reviewedBy: row.reviewedBy ?? undefined, reviewNote: row.reviewNote ?? undefined, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, reviewedAt: row.reviewedAt ? (row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : row.reviewedAt) : undefined };
    },
};
