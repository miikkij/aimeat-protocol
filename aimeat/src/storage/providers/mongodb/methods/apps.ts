/**
 * @file src/storage/providers/mongodb/methods/apps.ts
 * @description App catalog, app drafts, subdomain sites, app grants, and app-marketplace methods. Extracted from mongodb/index.ts (PrismaStorage) to satisfy max-file-lines; method bodies verbatim, bound to PrismaStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/mongodb/index.ts (max-file-lines)
 */
import type {
  AppRecord, AppDraftRecord, AppManifest, AppListOptions, AppPurchaseRecord, AppForkRecord, AppProtection, SubdomainSiteRecord, AppGrantRecord
} from '../../../interface.js';
import type { PrismaStorage, PrismaRow } from '../index.js';

export const appsMethods = {
    // ── App Catalog (Prisma-persisted) ──

    toAppRecord(this: PrismaStorage, row: PrismaRow): AppRecord {
        return {
            ownerGaii: row.ownerGaii,
            ownerName: row.ownerName,
            filename: row.filename,
            versionNumber: row.versionNumber,
            manifest: row.manifest,
            mimeType: row.mimeType,
            size: row.size,
            data: row.data,
            accessCode: row.accessCode ?? undefined,
            parked: row.parked ? true : undefined,
            forkable: row.forkable ? true : undefined,
            operatorHidden: row.operatorHidden ? true : undefined,
            operatorHiddenBy: row.operatorHiddenBy ?? undefined,
            operatorHiddenAt: row.operatorHiddenAt
                ? (row.operatorHiddenAt instanceof Date ? row.operatorHiddenAt.toISOString() : row.operatorHiddenAt)
                : undefined,
            operatorHideReason: row.operatorHideReason ?? undefined,
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    },

    async createApp(this: PrismaStorage, record: AppRecord): Promise<AppRecord> {
        this.ensureReady();
        await this.prisma.app.create({
            data: {
                ownerGaii: record.ownerGaii,
                ownerName: record.ownerName,
                filename: record.filename,
                versionNumber: record.versionNumber,
                manifest: record.manifest,
                mimeType: record.mimeType,
                size: record.size,
                data: record.data,
                accessCode: record.accessCode,
                parked: record.parked ?? false,
                forkable: record.forkable ?? false,
                operatorHidden: record.operatorHidden ?? false,
                operatorHiddenBy: record.operatorHiddenBy ?? null,
                operatorHiddenAt: record.operatorHiddenAt ? new Date(record.operatorHiddenAt) : null,
                operatorHideReason: record.operatorHideReason ?? null,
                createdAt: new Date(record.createdAt),
            },
        });
        return record;
    },

    // ── App drafts (staging slot; one per owner+filename) ──

    async saveAppDraft(this: PrismaStorage, record: AppDraftRecord): Promise<void> {
        this.ensureReady();
        // Upsert: at most one draft per (ownerGaii, filename); a re-save overwrites it.
        await this.prisma.appDraft.upsert({
            where: { ownerGaii_filename: { ownerGaii: record.ownerGaii, filename: record.filename } },
            create: {
                ownerGaii: record.ownerGaii,
                ownerName: record.ownerName,
                filename: record.filename,
                manifest: record.manifest,
                mimeType: record.mimeType,
                size: record.size,
                data: record.data,
                updatedAt: new Date(record.updatedAt),
            },
            update: {
                ownerName: record.ownerName,
                manifest: record.manifest,
                mimeType: record.mimeType,
                size: record.size,
                data: record.data,
                updatedAt: new Date(record.updatedAt),
            },
        });
    },

    async getAppDraft(this: PrismaStorage, ownerGaii: string, filename: string): Promise<AppDraftRecord | null> {
        this.ensureReady();
        const row = await this.prisma.appDraft.findUnique({
            where: { ownerGaii_filename: { ownerGaii, filename } },
        });
        if (!row) return null;
        return {
            ownerGaii: row.ownerGaii,
            ownerName: row.ownerName,
            filename: row.filename,
            manifest: row.manifest,
            mimeType: row.mimeType,
            size: row.size,
            data: row.data as Buffer,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        };
    },

    async deleteAppDraft(this: PrismaStorage, ownerGaii: string, filename: string): Promise<boolean> {
        this.ensureReady();
        const result = await this.prisma.appDraft.deleteMany({ where: { ownerGaii, filename } });
        return result.count > 0;
    },

    async getApp(this: PrismaStorage, ownerGaii: string, filename: string, version?: number): Promise<AppRecord | null> {
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
    },

    async getAppByOwnerName(this: PrismaStorage, ownerName: string, filename: string, version?: number): Promise<AppRecord | null> {
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
    },

    async listApps(this: PrismaStorage, opts?: AppListOptions): Promise<{ apps: AppRecord[]; total: number }> {
        this.ensureReady();
        // Fetch all apps, then deduplicate to latest version per owner+filename
        const where: Record<string, unknown> = {};
        if (opts?.ownerGaii) where.ownerGaii = opts.ownerGaii;
        const allRows = await this.prisma.app.findMany({ where, orderBy: { versionNumber: 'desc' } });
        const latestMap = new Map<string, PrismaRow>();
        for (const r of allRows) {
            const key = `${r.ownerGaii}:${r.filename}`;
            if (!latestMap.has(key)) latestMap.set(key, r);
        }
        let apps = Array.from(latestMap.values()).map((r: PrismaRow) => this.toAppRecord(r));
        if (opts?.category) apps = apps.filter((a: AppRecord) => a.manifest.category === opts.category);
        if (opts?.tag) apps = apps.filter((a: AppRecord) => a.manifest.tags.includes(opts.tag!));
        if (opts?.q) {
            const q = opts.q.toLowerCase();
            apps = apps.filter((a: AppRecord) => a.filename.toLowerCase().includes(q) || a.manifest.name.toLowerCase().includes(q) || a.manifest.description.toLowerCase().includes(q));
        }
        if (opts?.freeOnly) apps = apps.filter((a: AppRecord) => !a.manifest.priceMorsels);
        // Parked + operator-hidden apps are hidden from everyone EXCEPT their owner
        // (viewerGhii) — decided purely from who is authenticated. The owner sees
        // their own (operator-hidden ones carry operator_hidden=true so the client
        // can badge them); everyone else does not. A scoped ownerGaii query already
        // returns only that owner's apps, so skip the filters there. adminView sees all.
        if (!opts?.ownerGaii && !opts?.adminView) {
            apps = apps.filter((a: AppRecord) => !a.parked || (opts?.viewerGhii && a.ownerGaii === opts.viewerGhii));
            apps = apps.filter((a: AppRecord) => !a.operatorHidden || (opts?.viewerGhii && a.ownerGaii === opts.viewerGhii));
        }
        const total = apps.length;
        apps.sort((a: AppRecord, b: AppRecord) => b.createdAt.localeCompare(a.createdAt));
        const offset = opts?.offset ?? 0;
        const limit = opts?.limit ?? 50;
        return { apps: apps.slice(offset, offset + limit), total };
    },

    async listAppVersions(this: PrismaStorage, ownerGaii: string, filename: string): Promise<AppRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.app.findMany({
            where: { ownerGaii, filename },
            orderBy: { versionNumber: 'desc' },
        });
        return rows.map((r: PrismaRow) => this.toAppRecord(r));
    },

    async getLatestVersionNumber(this: PrismaStorage, ownerGaii: string, filename: string): Promise<number> {
        this.ensureReady();
        const row = await this.prisma.app.findFirst({
            where: { ownerGaii, filename },
            orderBy: { versionNumber: 'desc' },
            select: { versionNumber: true },
        });
        return row?.versionNumber ?? 0;
    },

    async deleteApp(this: PrismaStorage, ownerGaii: string, filename: string, version?: number): Promise<boolean> {
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
    },

    async updateAppAccessCode(this: PrismaStorage, ownerGaii: string, filename: string, accessCode?: string): Promise<boolean> {
        this.ensureReady();
        const result = await this.prisma.app.updateMany({
            where: { ownerGaii, filename },
            data: { accessCode: accessCode ?? null },
        });
        return result.count > 0;
    },

    async updateAppMeta(
        this: PrismaStorage, ownerGaii: string,
        filename: string,
        meta: { name?: string; description?: string; protection?: AppProtection },
    ): Promise<boolean> {
        this.ensureReady();
        // Rename/re-describe in place on the LATEST version (the one the catalogue
        // shows). Read the current manifest, merge only the supplied fields, write
        // it back — the URL (owner/filename) is untouched. Older versions keep the
        // name they were published under.
        const rows = await this.prisma.app.findMany({
            where: { ownerGaii, filename },
            orderBy: { versionNumber: 'desc' },
            take: 1,
        });
        if (rows.length === 0) return false;
        const latest = rows[0];
        const manifest = { ...(latest.manifest) } as AppManifest;
        if (meta.name !== undefined) manifest.name = meta.name;
        if (meta.description !== undefined) manifest.description = meta.description;
        if (meta.protection !== undefined) manifest.protection = meta.protection;
        await this.prisma.app.update({
            where: { ownerGaii_filename_versionNumber: { ownerGaii, filename, versionNumber: latest.versionNumber } },
            data: { manifest: manifest },
        });
        return true;
    },

    async setAppParked(this: PrismaStorage, ownerGaii: string, filename: string, parked: boolean): Promise<boolean> {
        this.ensureReady();
        // Park/unpark applies to the whole app — flag every version row.
        const result = await this.prisma.app.updateMany({
            where: { ownerGaii, filename },
            data: { parked },
        });
        return result.count > 0;
    },

    async setAppForkable(this: PrismaStorage, ownerGaii: string, filename: string, forkable: boolean): Promise<boolean> {
        this.ensureReady();
        // Fork-permission applies to the whole app — flag every version row.
        const result = await this.prisma.app.updateMany({
            where: { ownerGaii, filename },
            data: { forkable },
        });
        return result.count > 0;
    },

    async setAppOperatorHidden(
        this: PrismaStorage, ownerGaii: string,
        filename: string,
        hidden: boolean,
        meta?: { by?: string; at?: string; reason?: string },
    ): Promise<boolean> {
        this.ensureReady();
        // Operator moderation applies to the whole app — flag every version row.
        // On un-hide, clear the audit fields so a stale "hidden by" never lingers.
        const result = await this.prisma.app.updateMany({
            where: { ownerGaii, filename },
            data: {
                operatorHidden: hidden,
                operatorHiddenBy: hidden ? (meta?.by ?? null) : null,
                operatorHiddenAt: hidden ? (meta?.at ? new Date(meta.at) : null) : null,
                operatorHideReason: hidden ? (meta?.reason ?? null) : null,
            },
        });
        return result.count > 0;
    },

    async getAppDownloads(this: PrismaStorage, ownerGaii: string, filename: string): Promise<number> {
        this.ensureReady();
        const row = await this.prisma.appDownload.findUnique({
            where: { ownerGaii_filename: { ownerGaii, filename } },
        });
        return row?.count ?? 0;
    },

    async incrementAppDownloads(this: PrismaStorage, ownerGaii: string, filename: string): Promise<void> {
        this.ensureReady();
        await this.prisma.appDownload.upsert({
            where: { ownerGaii_filename: { ownerGaii, filename } },
            update: { count: { increment: 1 } },
            create: { ownerGaii, filename, count: 1 },
        });
    },

    async recordAppFork(this: PrismaStorage, record: AppForkRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.appFork.create({
            data: {
                id: record.id,
                sourceOwnerGaii: record.sourceOwnerGaii,
                sourceOwnerName: record.sourceOwnerName,
                sourceFilename: record.sourceFilename,
                sourceVersion: record.sourceVersion,
                childOwnerGaii: record.childOwnerGaii,
                childOwnerName: record.childOwnerName,
                childFilename: record.childFilename,
                forkedByGaii: record.forkedByGaii,
                forkedAt: new Date(record.forkedAt),
            },
        });
    },

    async countAppForks(this: PrismaStorage, sourceOwnerGaii: string, sourceFilename: string): Promise<number> {
        this.ensureReady();
        return this.prisma.appFork.count({ where: { sourceOwnerGaii, sourceFilename } });
    },

    async listAppForks(this: PrismaStorage, sourceOwnerGaii: string, sourceFilename: string): Promise<AppForkRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.appFork.findMany({
            where: { sourceOwnerGaii, sourceFilename },
            orderBy: { forkedAt: 'desc' },
        });
        return rows.map((r: PrismaRow) => ({
            id: r.id,
            sourceOwnerGaii: r.sourceOwnerGaii,
            sourceOwnerName: r.sourceOwnerName,
            sourceFilename: r.sourceFilename,
            sourceVersion: r.sourceVersion,
            childOwnerGaii: r.childOwnerGaii,
            childOwnerName: r.childOwnerName,
            childFilename: r.childFilename,
            forkedByGaii: r.forkedByGaii,
            forkedAt: r.forkedAt instanceof Date ? r.forkedAt.toISOString() : r.forkedAt,
        }));
    },

    // ── Subdomain sites (operator-managed subdomain → app/redirect mappings) ──

    async createSubdomainSite(this: PrismaStorage, site: SubdomainSiteRecord): Promise<SubdomainSiteRecord> {
        this.ensureReady();
        const row = await this.prisma.subdomainSite.create({
            data: {
                subdomain: site.subdomain,
                kind: site.kind,
                target: site.target,
                enabled: site.enabled,
                createdBy: site.createdBy,
                createdAt: new Date(site.createdAt),
                updatedAt: new Date(site.updatedAt),
            },
        });
        return this.toSubdomainSiteRecord(row);
    },

    async getSubdomainSite(this: PrismaStorage, subdomain: string): Promise<SubdomainSiteRecord | null> {
        this.ensureReady();
        const row = await this.prisma.subdomainSite.findUnique({ where: { subdomain } });
        return row ? this.toSubdomainSiteRecord(row) : null;
    },

    async listSubdomainSites(this: PrismaStorage): Promise<SubdomainSiteRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.subdomainSite.findMany({ orderBy: { subdomain: 'asc' } });
        return rows.map((r: unknown) => this.toSubdomainSiteRecord(r));
    },

    async updateSubdomainSite(
        this: PrismaStorage, subdomain: string,
        updates: Partial<Pick<SubdomainSiteRecord, 'kind' | 'target' | 'enabled' | 'updatedAt'>>,
    ): Promise<SubdomainSiteRecord | null> {
        this.ensureReady();
        const data: Record<string, unknown> = {
            updatedAt: updates.updatedAt ? new Date(updates.updatedAt) : new Date(),
        };
        if (updates.kind !== undefined) data.kind = updates.kind;
        if (updates.target !== undefined) data.target = updates.target;
        if (updates.enabled !== undefined) data.enabled = updates.enabled;
        try {
            const row = await this.prisma.subdomainSite.update({ where: { subdomain }, data });
            return this.toSubdomainSiteRecord(row);
        } catch {
            return null;
        }
    },

    async deleteSubdomainSite(this: PrismaStorage, subdomain: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.subdomainSite.delete({ where: { subdomain } });
            return true;
        } catch {
            return false;
        }
    },

    toSubdomainSiteRecord(this: PrismaStorage, row: PrismaRow): SubdomainSiteRecord {
        return {
            subdomain: row.subdomain,
            kind: row.kind as SubdomainSiteRecord['kind'],
            target: row.target,
            enabled: row.enabled,
            createdBy: row.createdBy,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        };
    },

    // ── App grants (owner-issued app authorizations → agent tokens) ──

    async createAppGrant(this: PrismaStorage, grant: AppGrantRecord): Promise<AppGrantRecord> {
        this.ensureReady();
        const row = await this.prisma.appGrant.create({
            data: {
                grantId: grant.grantId,
                app: grant.app,
                appName: grant.appName,
                appOrigin: grant.appOrigin,
                owner: grant.owner,
                gaii: grant.gaii,
                scopes: grant.scopes,
                refreshTokenHash: grant.refreshTokenHash,
                createdAt: new Date(grant.createdAt),
                lastUsedAt: grant.lastUsedAt ? new Date(grant.lastUsedAt) : null,
                revoked: grant.revoked,
            },
        });
        return this.toAppGrantRecord(row);
    },

    async getAppGrant(this: PrismaStorage, grantId: string): Promise<AppGrantRecord | null> {
        this.ensureReady();
        const row = await this.prisma.appGrant.findUnique({ where: { grantId } });
        return row ? this.toAppGrantRecord(row) : null;
    },

    async getAppGrantByRefreshHash(this: PrismaStorage, tokenHash: string): Promise<AppGrantRecord | null> {
        this.ensureReady();
        const row = await this.prisma.appGrant.findFirst({ where: { refreshTokenHash: tokenHash } });
        return row ? this.toAppGrantRecord(row) : null;
    },

    async listAppGrantsByOwner(this: PrismaStorage, owner: string): Promise<AppGrantRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.appGrant.findMany({ where: { owner }, orderBy: { createdAt: 'desc' } });
        return rows.map((r: unknown) => this.toAppGrantRecord(r));
    },

    async updateAppGrant(
        this: PrismaStorage, grantId: string,
        updates: Partial<Pick<AppGrantRecord, 'refreshTokenHash' | 'lastUsedAt' | 'revoked' | 'scopes'>>,
    ): Promise<AppGrantRecord | null> {
        this.ensureReady();
        const data: Record<string, unknown> = {};
        if (updates.refreshTokenHash !== undefined) data.refreshTokenHash = updates.refreshTokenHash;
        if (updates.lastUsedAt !== undefined) data.lastUsedAt = updates.lastUsedAt ? new Date(updates.lastUsedAt) : null;
        if (updates.revoked !== undefined) data.revoked = updates.revoked;
        if (updates.scopes !== undefined) data.scopes = updates.scopes;
        try {
            const row = await this.prisma.appGrant.update({ where: { grantId }, data });
            return this.toAppGrantRecord(row);
        } catch {
            return null;
        }
    },

    async deleteAppGrant(this: PrismaStorage, grantId: string): Promise<boolean> {
        this.ensureReady();
        try {
            await this.prisma.appGrant.delete({ where: { grantId } });
            return true;
        } catch {
            return false;
        }
    },

    toAppGrantRecord(this: PrismaStorage, row: PrismaRow): AppGrantRecord {
        return {
            grantId: row.grantId,
            app: row.app,
            appName: row.appName,
            appOrigin: row.appOrigin,
            owner: row.owner,
            gaii: row.gaii,
            scopes: row.scopes,
            refreshTokenHash: row.refreshTokenHash ?? null,
            createdAt: row.createdAt.toISOString(),
            lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
            revoked: row.revoked,
        };
    },

    async normalizeAppOwnerNames(this: PrismaStorage): Promise<number> {
        this.ensureReady();
        // Find rows whose ownerName still carries the `@node` suffix and rewrite
        // each to its bare prefix. Owner names never contain '@', so the split
        // is unambiguous. Idempotent: a second pass finds nothing.
        const rows = await this.prisma.app.findMany({
            where: { ownerName: { contains: '@' } },
            select: { ownerGaii: true, filename: true, versionNumber: true, ownerName: true },
        });
        let count = 0;
        for (const r of rows) {
            const bare = (r.ownerName as string).split('@')[0];
            if (!bare || bare === r.ownerName) continue;
            await this.prisma.app.update({
                where: { ownerGaii_filename_versionNumber: { ownerGaii: r.ownerGaii, filename: r.filename, versionNumber: r.versionNumber } },
                data: { ownerName: bare },
            });
            count++;
        }
        return count;
    },

    async mergeForkedAppBuckets(this: PrismaStorage): Promise<number> {
        this.ensureReady();
        // Consolidate ownerGaii buckets forked across an owner's identity forms
        // into the owner's canonical GHII bucket. Run AFTER normalizeAppOwnerNames()
        // so grouping by the bare ownerName is reliable. See the AppRepository
        // contract for the full rationale.
        let reKeyed = 0;

        // Canonical map: bare ownerName -> GHII bucket key.
        const ghiis = await this.prisma.ghii.findMany({ select: { ownerName: true, ghii: true } });
        const canonByOwner = new Map<string, string>();
        for (const g of ghiis) if (g.ownerName && g.ghii) canonByOwner.set(g.ownerName, g.ghii);
        if (canonByOwner.size === 0) return 0;

        type AppKeyRow = { ownerGaii: string; ownerName: string; filename: string; versionNumber: number; createdAt: Date };
        const rows = await this.prisma.app.findMany({
            select: { ownerGaii: true, ownerName: true, filename: true, versionNumber: true, createdAt: true },
        }) as AppKeyRow[];

        // Group by ownerName + filename (only owners we can canonicalize).
        const groups = new Map<string, AppKeyRow[]>();
        for (const r of rows) {
            if (!canonByOwner.has(r.ownerName)) continue;
            const key = `${r.ownerName} ${r.filename}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(r);
        }

        for (const [key, groupRows] of groups) {
            const sep = key.indexOf(' ');
            const ownerName = key.slice(0, sep);
            const filename = key.slice(sep + 1);
            const ghii = canonByOwner.get(ownerName)!;

            const strays = groupRows
                .filter(r => r.ownerGaii !== ghii)
                .sort((a, b) => {
                    const t = a.createdAt.getTime() - b.createdAt.getTime();
                    return t !== 0 ? t : a.versionNumber - b.versionNumber;
                });
            if (strays.length === 0) continue;

            let maxV = groupRows
                .filter(r => r.ownerGaii === ghii)
                .reduce((m, r) => Math.max(m, r.versionNumber), 0);

            for (const s of strays) {
                maxV += 1;
                await this.prisma.app.update({
                    where: { ownerGaii_filename_versionNumber: { ownerGaii: s.ownerGaii, filename, versionNumber: s.versionNumber } },
                    data: { ownerGaii: ghii, versionNumber: maxV },
                });
                reKeyed += 1;
            }

            const strayBuckets = [...new Set(strays.map(s => s.ownerGaii))];
            const ssKey = `apps/screenshots/${filename}`;

            // Move one stray screenshot into the canonical bucket if it lacks one,
            // then drop any remaining stray screenshots for this app.
            const canonSs = await this.prisma.storageFile.findUnique({
                where: { ownerGaii_key: { ownerGaii: ghii, key: ssKey } }, select: { ownerGaii: true },
            });
            if (!canonSs) {
                for (const b of strayBuckets) {
                    const existing = await this.prisma.storageFile.findUnique({
                        where: { ownerGaii_key: { ownerGaii: b, key: ssKey } }, select: { ownerGaii: true },
                    });
                    if (existing) {
                        await this.prisma.storageFile.update({
                            where: { ownerGaii_key: { ownerGaii: b, key: ssKey } }, data: { ownerGaii: ghii },
                        });
                        break;
                    }
                }
            }
            for (const b of strayBuckets) {
                await this.prisma.storageFile.deleteMany({ where: { ownerGaii: b, key: ssKey } });
            }

            // Fold stray download counters into the canonical row, then remove them.
            for (const b of strayBuckets) {
                const d = await this.prisma.appDownload.findUnique({
                    where: { ownerGaii_filename: { ownerGaii: b, filename } }, select: { count: true },
                });
                if (d && d.count > 0) {
                    await this.prisma.appDownload.upsert({
                        where: { ownerGaii_filename: { ownerGaii: ghii, filename } },
                        update: { count: { increment: d.count } },
                        create: { ownerGaii: ghii, filename, count: d.count },
                    });
                }
                await this.prisma.appDownload.deleteMany({ where: { ownerGaii: b, filename } });
            }
        }
        return reKeyed;
    },

    // ── App Marketplace (Prisma-persisted purchase receipts) ──

    toAppPurchaseRecord(this: PrismaStorage, row: PrismaRow): AppPurchaseRecord {
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
            appManifest: row.appManifest,
            appScreenshot: row.appScreenshot ?? undefined,
            signature: row.signature,
            nodeId: row.nodeId,
            nodePublicKey: row.nodePublicKey,
        };
    },

    async createAppPurchase(this: PrismaStorage, record: AppPurchaseRecord): Promise<AppPurchaseRecord> {
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
                appManifest: record.appManifest,
                appScreenshot: record.appScreenshot,
                signature: record.signature,
                nodeId: record.nodeId,
                nodePublicKey: record.nodePublicKey,
            },
        });
        return record;
    },

    async getAppPurchase(this: PrismaStorage, transactionId: string): Promise<AppPurchaseRecord | null> {
        this.ensureReady();
        const row = await this.prisma.appPurchase.findUnique({ where: { transactionId } });
        return row ? this.toAppPurchaseRecord(row) : null;
    },

    async listAppPurchasesByBuyer(this: PrismaStorage, buyerGaii: string): Promise<AppPurchaseRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.appPurchase.findMany({
            where: { buyerGaii },
            orderBy: { purchasedAt: 'desc' },
        });
        return rows.map((r: PrismaRow) => this.toAppPurchaseRecord(r));
    },

    async listAppPurchasesBySeller(this: PrismaStorage, sellerGaii: string): Promise<AppPurchaseRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.appPurchase.findMany({
            where: { sellerGaii },
            orderBy: { purchasedAt: 'desc' },
        });
        return rows.map((r: PrismaRow) => this.toAppPurchaseRecord(r));
    },

    async hasValidLicense(this: PrismaStorage, buyerGaii: string, sellerGaii: string, filename: string, licenseType?: 'single' | 'lifetime'): Promise<boolean> {
        this.ensureReady();
        const where: Record<string, unknown> = { buyerGaii, sellerGaii, appFilename: filename };
        if (licenseType === 'lifetime') where.licenseType = 'lifetime';
        const count = await this.prisma.appPurchase.count({ where });
        return count > 0;
    },
};
