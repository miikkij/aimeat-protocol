/**
 * @file app.repository.ts
 * @description Storage contract for the App Catalog — versioned single-file HTML
 *   apps. Each publish inserts a new row with an incremented versionNumber; old
 *   versions are retained and queryable via listAppVersions. Implemented by the
 *   SQLite and MongoDB providers.
 * @structure AppRepository interface — createApp, getApp, getAppByOwnerName,
 *   listApps, listAppVersions, getLatestVersionNumber, deleteApp,
 *   updateAppAccessCode, setAppParked/setAppForkable, download counters,
 *   fork-lineage events (recordAppFork/countAppForks/listAppForks),
 *   normalizeAppOwnerNames.
 * @usage Implemented by SqliteStorage / MongoStorage; consumed by routes/apps.ts
 *   and mcp/apps.ts.
 * @version-history
 *   v1.0.0 — pre-2026-06 — Initial app repository contract
 *   v1.1.0 — 2026-06-05 — Add normalizeAppOwnerNames() for legacy GHII ownerName
 *     cleanup so agent-published apps surface under the owner's "Published Apps".
 *   v1.2.0 — 2026-06-09 — Add mergeForkedAppBuckets() to consolidate ownerGaii
 *     buckets forked across an owner's identity forms (dashboard bare name vs
 *     MCP/PAT full GHII) into one canonical record with a unified version line.
 *   v1.3.0 — 2026-06-20 — Add setAppParked() for the parked-app state (hide from
 *     public listings while keeping the app usable by its owner).
 *   v1.4.0 — 2026-06-24 — Add setAppOperatorHidden() + AppListOptions.adminView for
 *     operator moderation (remove an app from every public surface; owner sees a
 *     badge but cannot lift it).
 *   v1.5.0 — 2026-06-26 — Add updateAppMeta() so an owner can rename an app (and
 *     edit its description) in place — without re-publishing or changing the URL.
 */
import type { AppRecord, AppListOptions, AppForkRecord } from '../interface.js';

export interface AppRepository {
    createApp(record: AppRecord): Promise<AppRecord>;
    getApp(ownerGaii: string, filename: string, version?: number): Promise<AppRecord | null>;
    getAppByOwnerName(ownerName: string, filename: string, version?: number): Promise<AppRecord | null>;
    listApps(opts?: AppListOptions): Promise<{ apps: AppRecord[]; total: number }>;
    listAppVersions(ownerGaii: string, filename: string): Promise<AppRecord[]>;
    getLatestVersionNumber(ownerGaii: string, filename: string): Promise<number>;
    deleteApp(ownerGaii: string, filename: string, version?: number): Promise<boolean>;
    updateAppAccessCode(ownerGaii: string, filename: string, accessCode?: string): Promise<boolean>;
    /**
     * Edit an app's display metadata (name and/or description) in place on its
     * LATEST version row — the version the catalogue/gallery surfaces. This lets
     * an owner rename an app without re-publishing, so the stable `owner/filename`
     * URL never changes (the name is display-only; the filename is the identity).
     * Only the fields present in `meta` are touched; omitted fields are left as-is.
     * Older version rows keep the name they were published under (historical).
     * Returns true if the latest row was updated.
     */
    updateAppMeta(
        ownerGaii: string,
        filename: string,
        meta: { name?: string; description?: string },
    ): Promise<boolean>;
    /**
     * Park or unpark an app: set the `parked` flag on EVERY version row of
     * (ownerGaii, filename). Parked apps drop out of the public catalogue,
     * gallery, and search but remain fully usable by the owner. Returns true if
     * any row was updated.
     */
    setAppParked(ownerGaii: string, filename: string, parked: boolean): Promise<boolean>;
    /**
     * Set the fork-permission flag on EVERY version row of (ownerGaii, filename).
     * When true, outsiders (users other than the owner and the owner's own agents)
     * may fork the app; when false (default), only the owner/their agents/operators
     * may. Mirrors setAppParked. Returns true if any row was updated.
     */
    setAppForkable(ownerGaii: string, filename: string, forkable: boolean): Promise<boolean>;
    /**
     * Operator moderation: hide or un-hide an app from EVERY public surface
     * (catalogue/gallery/search/discovery + public download). Sets the
     * `operatorHidden` flag (and audit fields) on EVERY version row of
     * (ownerGaii, filename). Unlike setAppParked, only an operator may call this
     * — the owner cannot lift it; they only see a "moderated by operator: hidden"
     * badge on their own copy. Pass meta on hide; cleared on un-hide. Returns
     * true if any row was updated.
     */
    setAppOperatorHidden(
        ownerGaii: string,
        filename: string,
        hidden: boolean,
        meta?: { by?: string; at?: string; reason?: string },
    ): Promise<boolean>;
    getAppDownloads(ownerGaii: string, filename: string): Promise<number>;
    incrementAppDownloads(ownerGaii: string, filename: string): Promise<void>;
    /**
     * Fork lineage (append-only). recordAppFork writes one immutable event when an
     * app is forked; countAppForks returns how many times (ownerGaii, filename) has
     * been forked (direct children); listAppForks returns the fork events where the
     * given app is the SOURCE (its direct descendants), newest first. These back the
     * fork-count column, the "who forked this" list, and the lineage graph.
     */
    recordAppFork(record: AppForkRecord): Promise<void>;
    countAppForks(sourceOwnerGaii: string, sourceFilename: string): Promise<number>;
    listAppForks(sourceOwnerGaii: string, sourceFilename: string): Promise<AppForkRecord[]>;
    /**
     * Data hygiene: legacy publish paths stored `ownerName` as the full GHII
     * (`owner@node`) instead of the bare owner name. The catalog "my apps"
     * filter and the by-owner-name delete sweep both key on the bare name, so
     * those rows got stranded as un-manageable "community" apps. Rewrite any
     * `ownerName` containing '@' to its bare prefix. Idempotent — once
     * normalized, no row matches. Returns the number of rows updated.
     */
    normalizeAppOwnerNames(): Promise<number>;
    /**
     * Data hygiene: legacy publish paths keyed an app's storage bucket
     * (`ownerGaii`) off the caller's raw `owner` claim, which varies by identity
     * form — the dashboard sends the bare owner name, MCP/PAT sends the full GHII
     * (`owner@node`). The same owner therefore forked into two `ownerGaii`
     * buckets for the same filename, each with its own version counter, so a
     * publish from one identity could not update the other's record. This merges
     * every stray bucket into the owner's canonical GHII bucket (resolved from
     * the identity table), appending stray versions after the canonical bucket's
     * max so version numbers never collide and the newest content stays latest.
     * Screenshots and download counters are moved/folded too. Idempotent — once
     * consolidated, no row is stray. Returns the number of app rows re-keyed.
     */
    mergeForkedAppBuckets(): Promise<number>;
}
