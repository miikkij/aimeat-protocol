/**
 * @file src/storage/providers/mongodb/methods/sessions.ts
 * @description Personal push subscriptions, notification templates, sessions, personal access tokens, email invitations, and token-revocation methods. Extracted from mongodb/index.ts (PrismaStorage) to satisfy max-file-lines; method bodies verbatim, bound to PrismaStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/mongodb/index.ts (max-file-lines)
 */
import type {
  PersonalPushSubscriptionRecord, NotificationPreferences, NotificationTemplateRecord
} from '../../../interface.js';
import type { PrismaStorage, PrismaRow } from '../index.js';

export const sessionsMethods = {
    // ── Personal Push Subscriptions (REQ-007) ──

    async createPersonalPushSubscription(this: PrismaStorage, record: PersonalPushSubscriptionRecord): Promise<PersonalPushSubscriptionRecord> {
        this.ensureReady();
        await this.prisma.personalPushSubscription.create({ data: { id: record.id, personalNodeId: record.personalNodeId, ownerName: record.ownerName, endpoint: record.endpoint, keys: record.keys, failureCount: record.failureCount, createdAt: new Date(record.createdAt), lastUsedAt: record.lastUsedAt ? new Date(record.lastUsedAt) : null } });
        return record;
    },

    async getPersonalPushSubscription(this: PrismaStorage, id: string): Promise<PersonalPushSubscriptionRecord | null> {
        this.ensureReady();
        const row = await this.prisma.personalPushSubscription.findUnique({ where: { id } });
        return row ? this.toPersonalPushSubRecord(row) : null;
    },

    async listPersonalPushSubscriptions(this: PrismaStorage, personalNodeId: string): Promise<PersonalPushSubscriptionRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.personalPushSubscription.findMany({ where: { personalNodeId } });
        return rows.map((r: PrismaRow) => this.toPersonalPushSubRecord(r));
    },

    async updatePersonalPushSubscription(this: PrismaStorage, id: string, updates: Partial<PersonalPushSubscriptionRecord>): Promise<boolean> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.failureCount !== undefined) data.failureCount = updates.failureCount;
            if (updates.lastUsedAt) data.lastUsedAt = new Date(updates.lastUsedAt);
            if (updates.endpoint) data.endpoint = updates.endpoint;
            if (updates.keys) data.keys = updates.keys;
            await this.prisma.personalPushSubscription.update({ where: { id }, data });
            return true;
        } catch { return false; }
    },

    async deletePersonalPushSubscription(this: PrismaStorage, id: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.personalPushSubscription.delete({ where: { id } }); return true; } catch { return false; }
    },

    async deletePersonalPushSubscriptionsByNode(this: PrismaStorage, personalNodeId: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.personalPushSubscription.deleteMany({ where: { personalNodeId } });
        return result.count;
    },

    async countPersonalPushSubscriptions(this: PrismaStorage, personalNodeId: string): Promise<number> {
        this.ensureReady();
        return await this.prisma.personalPushSubscription.count({ where: { personalNodeId } });
    },

    toPersonalPushSubRecord(this: PrismaStorage, row: PrismaRow): PersonalPushSubscriptionRecord {
        return { id: row.id, personalNodeId: row.personalNodeId, ownerName: row.ownerName, endpoint: row.endpoint, keys: row.keys, failureCount: row.failureCount, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, lastUsedAt: row.lastUsedAt ? (row.lastUsedAt instanceof Date ? row.lastUsedAt.toISOString() : row.lastUsedAt) : null };
    },

    async getNotificationPreferences(this: PrismaStorage, personalNodeId: string): Promise<NotificationPreferences | null> {
        this.ensureReady();
        const row = await this.prisma.notificationPreference.findUnique({ where: { personalNodeId } });
        if (!row) return null;
        return { personalNodeId: row.personalNodeId, enabled: row.enabled, channels: row.channels, notifyTypes: row.notifyTypes, cooldownMinutes: row.cooldownMinutes, quietHoursUtc: row.quietHoursUtc ?? null, email: row.email, locale: row.locale ?? undefined };
    },

    async upsertNotificationPreferences(this: PrismaStorage, prefs: NotificationPreferences): Promise<NotificationPreferences> {
        this.ensureReady();
        await this.prisma.notificationPreference.upsert({
            where: { personalNodeId: prefs.personalNodeId },
            create: { personalNodeId: prefs.personalNodeId, enabled: prefs.enabled, channels: prefs.channels, notifyTypes: prefs.notifyTypes, cooldownMinutes: prefs.cooldownMinutes, quietHoursUtc: prefs.quietHoursUtc ?? null, email: prefs.email, locale: prefs.locale },
            update: { enabled: prefs.enabled, channels: prefs.channels, notifyTypes: prefs.notifyTypes, cooldownMinutes: prefs.cooldownMinutes, quietHoursUtc: prefs.quietHoursUtc ?? null, email: prefs.email, locale: prefs.locale },
        });
        return prefs;
    },

    async deleteNotificationPreferences(this: PrismaStorage, personalNodeId: string): Promise<boolean> {
        this.ensureReady();
        try { await this.prisma.notificationPreference.delete({ where: { personalNodeId } }); return true; } catch { return false; }
    },

    // ── Notification Templates (Phase 3.2) ──────────────────────

    ntKey(this: PrismaStorage, id: string, locale: string): string { return `${id}::${locale}`; },

    async getNotificationTemplate(this: PrismaStorage, id: string, locale: string): Promise<NotificationTemplateRecord | null> {
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
    },

    async upsertNotificationTemplate(this: PrismaStorage, record: NotificationTemplateRecord): Promise<NotificationTemplateRecord> {
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
    },

    async listNotificationTemplates(this: PrismaStorage): Promise<NotificationTemplateRecord[]> {
        const rows = await this.prisma.notificationTemplate.findMany();
        return rows.map((row: { templateId: string; locale: string; fields: unknown; placeholders: string[]; updatedAt: Date; updatedBy: string }) => ({
            id: row.templateId,
            locale: row.locale,
            fields: row.fields as NotificationTemplateRecord['fields'],
            placeholders: row.placeholders,
            updatedAt: row.updatedAt.toISOString(),
            updatedBy: row.updatedBy,
        }));
    },

    async deleteAllNotificationTemplates(this: PrismaStorage): Promise<void> {
        await this.prisma.notificationTemplate.deleteMany();
    },

    // ── Sessions (P3-7: Server-Side Session Tracking) ──────────

    mapPrismaSession(this: PrismaStorage, s: {
        sessionId: string; gaii: string; owner: string;
        issuedAt: Date | string; expiresAt: Date | string; revoked: boolean;
        refreshTokenHash?: string | null; prevTokenHash?: string | null;
        prevValidUntil?: Date | string | null; lastUsedAt?: Date | string | null;
        idleExpiresAt?: Date | string | null; absoluteExpiresAt?: Date | string | null;
        deviceLabel?: string | null; userAgent?: string | null;
    }): import('../../../../storage/repositories/session.repository.js').SessionRecord {
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
    },

    async createSession(this: PrismaStorage, session: { sessionId: string; gaii: string; owner: string; issuedAt: string; expiresAt: string }): Promise<void> {
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
    },

    async createOwnerSession(this: PrismaStorage, session: {
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
    },

    async listActiveSessions(this: PrismaStorage, owner: string): Promise<import('../../../../storage/repositories/session.repository.js').SessionRecord[]> {
        this.ensureReady();
        const sessions = await this.prisma.session.findMany({
            where: { owner, revoked: false },
            orderBy: { issuedAt: 'desc' },
        });
        return sessions.map((s: import('@prisma/client').Session) => this.mapPrismaSession(s));
    },

    async getSessionByRefreshHash(this: PrismaStorage, tokenHash: string): Promise<import('../../../../storage/repositories/session.repository.js').SessionRecord | null> {
        this.ensureReady();
        const s = await this.prisma.session.findFirst({
            where: { OR: [{ refreshTokenHash: tokenHash }, { prevTokenHash: tokenHash }] },
        });
        return s ? this.mapPrismaSession(s) : null;
    },

    async rotateSessionRefresh(this: PrismaStorage, sessionId: string, update: {
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
    },

    async revokeSession(this: PrismaStorage, sessionId: string): Promise<boolean> {
        this.ensureReady();
        const session = await this.prisma.session.findUnique({ where: { sessionId } });
        if (!session || session.revoked) return false;
        await this.prisma.session.update({ where: { sessionId }, data: { revoked: true } });
        return true;
    },

    async revokeAllSessions(this: PrismaStorage, owner: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.session.updateMany({
            where: { owner, revoked: false },
            data: { revoked: true },
        });
        return result.count;
    },

    async isSessionRevoked(this: PrismaStorage, sessionId: string): Promise<boolean> {
        this.ensureReady();
        const session = await this.prisma.session.findUnique({ where: { sessionId } });
        if (!session) return false;
        return session.revoked;
    },

    async pruneExpiredSessions(this: PrismaStorage, nowIso: string): Promise<number> {
        this.ensureReady();
        const now = new Date(nowIso);
        // Remove fully-dead rows; keep revoked-but-unexpired rows so isSessionRevoked
        // still rejects their short-lived access tokens.
        const result = await this.prisma.session.deleteMany({
            where: { OR: [{ expiresAt: { lt: now } }, { absoluteExpiresAt: { lt: now } }] },
        });
        return result.count;
    },

    // ── Personal Access Tokens ────────────────────────────────

    mapPat(this: PrismaStorage, p: {
        id: string; tokenHash: string; label: string; owner: string; scopes: string[];
        grantOwner: boolean; grantOperator: boolean; readOwnerData: boolean; gaii: string;
        createdAt: Date | string; expiresAt?: Date | string | null; lastUsedAt?: Date | string | null; revoked: boolean;
    }): import('../../../../storage/repositories/pat.repository.js').PatRecord {
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
    },

    async createPat(this: PrismaStorage, pat: import('../../../../storage/repositories/pat.repository.js').PatRecord): Promise<void> {
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
    },

    async getPatByHash(this: PrismaStorage, tokenHash: string): Promise<import('../../../../storage/repositories/pat.repository.js').PatRecord | null> {
        this.ensureReady();
        const p = await this.prisma.personalAccessToken.findFirst({ where: { tokenHash, revoked: false } });
        return p ? this.mapPat(p) : null;
    },

    async listPats(this: PrismaStorage, owner: string): Promise<import('../../../../storage/repositories/pat.repository.js').PatRecord[]> {
        this.ensureReady();
        const pats = await this.prisma.personalAccessToken.findMany({
            where: { owner, revoked: false },
            orderBy: { createdAt: 'desc' },
        });
        return pats.map((p: import('@prisma/client').PersonalAccessToken) => this.mapPat(p));
    },

    async revokePat(this: PrismaStorage, id: string, owner: string): Promise<boolean> {
        this.ensureReady();
        const existing = await this.prisma.personalAccessToken.findFirst({ where: { id, owner, revoked: false } });
        if (!existing) return false;
        await this.prisma.personalAccessToken.update({ where: { id }, data: { revoked: true } });
        return true;
    },

    async touchPat(this: PrismaStorage, id: string, usedAtIso: string): Promise<void> {
        this.ensureReady();
        await this.prisma.personalAccessToken.update({ where: { id }, data: { lastUsedAt: new Date(usedAtIso) } });
    },

    // ── Email invitations ─────────────────────────────────────

    async createInvitation(this: PrismaStorage, rec: import('../../../../storage/repositories/invitation.repository.js').InvitationRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.invitation.create({
            data: {
                id: rec.id,
                tokenHash: rec.tokenHash,
                organismId: rec.organismId,
                orgRole: rec.orgRole,
                type: rec.type ?? 'link',
                workspaces: rec.workspaces ?? [],
                email: rec.email,
                emailHash: rec.emailHash,
                invitedBy: rec.invitedBy,
                provisionedOwner: rec.provisionedOwner ?? null,
                message: rec.message ?? null,
                status: rec.status,
                createdAt: new Date(rec.createdAt),
                expiresAt: new Date(rec.expiresAt),
                acceptedAt: rec.acceptedAt ? new Date(rec.acceptedAt) : null,
                acceptedBy: rec.acceptedBy ?? null,
            },
        });
    },

    async getInvitationByHash(this: PrismaStorage, tokenHash: string): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.invitation.findFirst({ where: { tokenHash } });
        return row ? this.toInvitationRecord(row) : null;
    },

    async getInvitation(this: PrismaStorage, id: string): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.invitation.findUnique({ where: { id } });
        return row ? this.toInvitationRecord(row) : null;
    },

    async listInvitationsByOrganism(this: PrismaStorage, organismId: string, opts?: { status?: string }): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.invitation.findMany({
            where: { organismId, ...(opts?.status ? { status: opts.status } : {}) },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map((r: unknown) => this.toInvitationRecord(r));
    },

    async countInvitationsByInviter(this: PrismaStorage, invitedBy: string, opts?: { organismId?: string; type?: 'link' | 'code'; statuses?: string[] }): Promise<number> {
        this.ensureReady();
        return this.prisma.invitation.count({
            where: {
                invitedBy,
                ...(opts?.organismId ? { organismId: opts.organismId } : {}),
                ...(opts?.type ? { type: opts.type } : {}),
                ...(opts?.statuses && opts.statuses.length ? { status: { in: opts.statuses } } : {}),
            },
        });
    },

    async getCodeInvitationByProvisionedOwner(this: PrismaStorage, owner: string): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord | null> {
        this.ensureReady();
        const row = await this.prisma.invitation.findFirst({
            where: { type: 'code', provisionedOwner: owner },
            orderBy: { createdAt: 'desc' },
        });
        return row ? this.toInvitationRecord(row) : null;
    },

    async updateInvitation(this: PrismaStorage, id: string, updates: Partial<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord>): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord | null> {
        this.ensureReady();
        try {
            const data: Record<string, unknown> = {};
            if (updates.status !== undefined) data.status = updates.status;
            if (updates.acceptedAt !== undefined) data.acceptedAt = updates.acceptedAt ? new Date(updates.acceptedAt) : null;
            if (updates.acceptedBy !== undefined) data.acceptedBy = updates.acceptedBy;
            const row = await this.prisma.invitation.update({ where: { id }, data });
            return this.toInvitationRecord(row);
        } catch { return null; }
    },

    async cleanupExpiredInvitations(this: PrismaStorage, nowIso: string): Promise<number> {
        this.ensureReady();
        // Only magic-link invites auto-expire; code invites hold a real account and are reclaimed
        // only by an explicit cancel (which deletes the account). See routes/organisms.ts.
        const result = await this.prisma.invitation.updateMany({
            where: { status: 'pending', type: 'link', expiresAt: { lte: new Date(nowIso) } },
            data: { status: 'expired' },
        });
        return result.count;
    },

    toInvitationRecord(this: PrismaStorage, row: PrismaRow): import('../../../../storage/repositories/invitation.repository.js').InvitationRecord {
        const toIso = (v: Date | string | null | undefined): string | null => (v ? (v instanceof Date ? v.toISOString() : v) : null);
        return {
            id: row.id,
            tokenHash: row.tokenHash,
            organismId: row.organismId,
            orgRole: row.orgRole ?? 'member',
            type: row.type ?? 'link',
            workspaces: Array.isArray(row.workspaces) ? row.workspaces : (row.workspaces ? JSON.parse(row.workspaces) : []),
            email: row.email,
            emailHash: row.emailHash,
            invitedBy: row.invitedBy,
            provisionedOwner: row.provisionedOwner ?? null,
            message: row.message ?? null,
            status: row.status,
            createdAt: toIso(row.createdAt) as string,
            expiresAt: toIso(row.expiresAt) as string,
            acceptedAt: toIso(row.acceptedAt),
            acceptedBy: row.acceptedBy ?? null,
        };
    },

    // ── Token Revocation ──────────────────────────────────────

    async revokeToken(this: PrismaStorage, tokenHash: string, expiresAt: number): Promise<void> {
        this.ensureReady();
        await this.prisma.revokedToken.upsert({
            where: { tokenHash },
            update: { expiresAt },
            create: { tokenHash, expiresAt },
        });
    },

    async isTokenRevoked(this: PrismaStorage, tokenHash: string): Promise<boolean> {
        this.ensureReady();
        const row = await this.prisma.revokedToken.findUnique({ where: { tokenHash } });
        return !!row;
    },

    async cleanExpiredRevocations(this: PrismaStorage): Promise<number> {
        this.ensureReady();
        const now = Math.floor(Date.now() / 1000);
        const result = await this.prisma.revokedToken.deleteMany({
            where: { expiresAt: { lt: now } },
        });
        return result.count;
    },
};
