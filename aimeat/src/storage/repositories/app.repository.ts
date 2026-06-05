/**
 * @file app.repository.ts
 * @description Storage contract for the App Catalog — versioned single-file HTML
 *   apps. Each publish inserts a new row with an incremented versionNumber; old
 *   versions are retained and queryable via listAppVersions. Implemented by the
 *   SQLite and MongoDB providers.
 * @structure AppRepository interface — createApp, getApp, getAppByOwnerName,
 *   listApps, listAppVersions, getLatestVersionNumber, deleteApp,
 *   updateAppAccessCode, download counters, normalizeAppOwnerNames.
 * @usage Implemented by SqliteStorage / MongoStorage; consumed by routes/apps.ts
 *   and mcp/apps.ts.
 * @version-history
 *   v1.0.0 — pre-2026-06 — Initial app repository contract
 *   v1.1.0 — 2026-06-05 — Add normalizeAppOwnerNames() for legacy GHII ownerName
 *     cleanup so agent-published apps surface under the owner's "Published Apps".
 */
import type { AppRecord, AppListOptions } from '../interface.js';

export interface AppRepository {
    createApp(record: AppRecord): Promise<AppRecord>;
    getApp(ownerGaii: string, filename: string, version?: number): Promise<AppRecord | null>;
    getAppByOwnerName(ownerName: string, filename: string, version?: number): Promise<AppRecord | null>;
    listApps(opts?: AppListOptions): Promise<{ apps: AppRecord[]; total: number }>;
    listAppVersions(ownerGaii: string, filename: string): Promise<AppRecord[]>;
    getLatestVersionNumber(ownerGaii: string, filename: string): Promise<number>;
    deleteApp(ownerGaii: string, filename: string, version?: number): Promise<boolean>;
    updateAppAccessCode(ownerGaii: string, filename: string, accessCode?: string): Promise<boolean>;
    getAppDownloads(ownerGaii: string, filename: string): Promise<number>;
    incrementAppDownloads(ownerGaii: string, filename: string): Promise<void>;
    /**
     * Data hygiene: legacy publish paths stored `ownerName` as the full GHII
     * (`owner@node`) instead of the bare owner name. The catalog "my apps"
     * filter and the by-owner-name delete sweep both key on the bare name, so
     * those rows got stranded as un-manageable "community" apps. Rewrite any
     * `ownerName` containing '@' to its bare prefix. Idempotent — once
     * normalized, no row matches. Returns the number of rows updated.
     */
    normalizeAppOwnerNames(): Promise<number>;
}
