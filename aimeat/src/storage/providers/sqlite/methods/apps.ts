/**
 * @file src/storage/providers/sqlite/methods/apps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description App-catalog and App-draft methods, the twin of postgres-kysely/methods/apps.ts. Extracted
 *   from sqlite/index.ts to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage via prototype
 *   merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/sqlite/index.ts (max-file-lines)
 *   v1.1.0 — 2026-07-25 — Add getAppGrantByOwnerAndApp for the one-live-grant-per-(owner, app)
 *     invariant (schema.ts dedupes + enforces it with a partial unique index).
 *   v1.2.0 — 2026-08-19 — listApps names its columns instead of SELECT a.*, so a listing no longer carries each
 *     app's bytes; the query itself moved to apps-listing.ts (max-file-lines).
 *   v1.3.0 — 2026-08-25 — listAppVersionSizes: the version line without its payload, for the size
 *     trend the publish response now states.
 *   v1.4.0 — 2026-08-29 — updateAppMeta merges `marks`, replaces or withdraws `authorship` and
 *     writes `authorshipLog` (the owner's chrome switches and the named reviewer).
 *   v1.5.0 — 2026-08-29 — updateAppMeta merges `legal` per kind (mergeLegal).
 *   v1.6.0 — 2026-09-09 — deleteAppGrant and getConfigValue deleted: no caller.
 *   v1.7.0 — 2026-09-26 — app_grants.ownerAddedScopes: the words the owner added by hand, a JSON list.
 *   v1.8.1 — 2026-09-26 — normalizeAppOwnerNames strips only this node's own `@nodeId` suffix, so a
 *     visitor's app keeps its owner's home name (secaudit 2026-09, A6-4).
 *   v1.8.0 — 2026-09-26 — revokeTokenIfAbsent: INSERT OR IGNORE, true when this call filed the hash
 *     (the one-time assertion spend, secaudit 2026-09 N5).
 *   v1.9.0 — 2026-10-02 — updateAppMeta replaces or takes off `designSpec`, the design spec's stamp.
 *   v1.10.0 — 2026-10-05 — revokeToken, revokeTokenIfAbsent, isTokenRevoked, cleanExpiredRevocations moved to
 *     identity.ts; createSubdomainSite, getSubdomainSite, listSubdomainSites, updateSubdomainSite,
 *     deleteSubdomainSite, deserializeSubdomainSite moved to subdomain-sites.ts; createAppGrant, getAppGrant,
 *     getAppGrantByRefreshHash, getAppGrantByOwnerAndApp, listAppGrantsByOwner, listAppGrants,
 *     updateAppGrant, deserializeAppGrant moved to app-grants.ts; createAppPurchase, getAppPurchase,
 *     listAppPurchasesByBuyer, listAppPurchasesBySeller, hasValidLicense, deserializeAppPurchase moved to
 *     app-purchases.ts; supportsConfigPersistence, setConfigValue, deleteConfigValue, getAllConfigValues
 *     moved to system.ts so the file mirrors postgres-kysely/methods/apps.ts (secaudit 2026-10, M8).
 */
import { mergeLegal } from '../../../types/apps.js';
import type {
  AppRecord, AppSummaryRecord, AppVersionSize, AppDraftRecord, AppManifest, AppManifestCortex,
  AppListOptions, AppForkRecord, AppProtection, AppSeo, AppMarks, AppAuthorship, AppAuthorshipLogEntry,
  AppLegalKind, AppLegalDoc,
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import { SUMMARY_COLUMNS, runAppListing } from './apps-listing.js';

export const appMethods = {

  // ══════════════════════════════════════════════════════════
  // ── App Catalog ──
  // ══════════════════════════════════════════════════════════

  async createApp(this: SqliteStorage, record: AppRecord): Promise<AppRecord> {
    this.db.prepare(
      `INSERT INTO apps (ownerGaii, ownerName, filename, versionNumber, manifest, mimeType, size, data, accessCode, parked, forkable, operatorHidden, operatorHiddenBy, operatorHiddenAt, operatorHideReason, operatorSeoBlocked, operatorSeoBlockedBy, operatorSeoBlockedAt, operatorSeoBlockReason, createdAt, aiProvenanceId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.ownerGaii, record.ownerName, record.filename, record.versionNumber,
      JSON.stringify(record.manifest), record.mimeType, record.size, record.data,
      record.accessCode ?? null, record.parked ? 1 : 0, record.forkable ? 1 : 0,
      record.operatorHidden ? 1 : 0, record.operatorHiddenBy ?? null,
      record.operatorHiddenAt ?? null, record.operatorHideReason ?? null,
      record.operatorSeoBlocked ? 1 : 0, record.operatorSeoBlockedBy ?? null,
      record.operatorSeoBlockedAt ?? null, record.operatorSeoBlockReason ?? null,
      record.createdAt, record.aiProvenanceId ?? null,
    );
    return record;
  },

  async getApp(this: SqliteStorage, ownerGaii: string, filename: string, version?: number): Promise<AppRecord | null> {
    let row: Record<string, unknown> | undefined;
    if (version !== undefined) {
      row = this.db.prepare('SELECT * FROM apps WHERE ownerGaii = ? AND filename = ? AND versionNumber = ?')
        .get(ownerGaii, filename, version) as Record<string, unknown> | undefined;
    } else {
      row = this.db.prepare('SELECT * FROM apps WHERE ownerGaii = ? AND filename = ? ORDER BY versionNumber DESC LIMIT 1')
        .get(ownerGaii, filename) as Record<string, unknown> | undefined;
    }
    return row ? this.deserializeApp(row) : null;
  },

  async getAppByOwnerName(this: SqliteStorage, ownerName: string, filename: string, version?: number): Promise<AppRecord | null> {
    let row: Record<string, unknown> | undefined;
    if (version !== undefined) {
      row = this.db.prepare('SELECT * FROM apps WHERE ownerName = ? AND filename = ? AND versionNumber = ?')
        .get(ownerName, filename, version) as Record<string, unknown> | undefined;
    } else {
      row = this.db.prepare('SELECT * FROM apps WHERE ownerName = ? AND filename = ? ORDER BY versionNumber DESC LIMIT 1')
        .get(ownerName, filename) as Record<string, unknown> | undefined;
    }
    return row ? this.deserializeApp(row) : null;
  },

  async listApps(this: SqliteStorage, opts?: AppListOptions): Promise<{ apps: AppSummaryRecord[]; total: number }> {
    return runAppListing(this, SUMMARY_COLUMNS, opts, r => this.deserializeAppSummary(r));
  },

  async listAppsWithContent(this: SqliteStorage, opts?: AppListOptions): Promise<{ apps: AppRecord[]; total: number }> {
    return runAppListing(this, 'a.*', opts, r => this.deserializeApp(r));
  },


  async listAppVersions(this: SqliteStorage, ownerGaii: string, filename: string): Promise<AppRecord[]> {
    const rows = this.db.prepare('SELECT * FROM apps WHERE ownerGaii = ? AND filename = ? ORDER BY versionNumber DESC')
      .all(ownerGaii, filename) as Record<string, unknown>[];
    return rows.map(r => this.deserializeApp(r));
  },

  async listAppVersionSizes(this: SqliteStorage, ownerGaii: string, filename: string): Promise<AppVersionSize[]> {
    // Three columns by name. `SELECT *` here would read every version's payload, which is the whole
    // reason this method exists next to listAppVersions.
    const rows = this.db.prepare(
      'SELECT versionNumber, size, createdAt FROM apps WHERE ownerGaii = ? AND filename = ? ORDER BY versionNumber DESC'
    ).all(ownerGaii, filename) as { versionNumber: number; size: number; createdAt: string }[];
    return rows.map(r => ({ versionNumber: r.versionNumber, size: Number(r.size), createdAt: String(r.createdAt) }));
  },

  async getLatestVersionNumber(this: SqliteStorage, ownerGaii: string, filename: string): Promise<number> {
    const row = this.db.prepare('SELECT MAX(versionNumber) as maxVer FROM apps WHERE ownerGaii = ? AND filename = ?')
      .get(ownerGaii, filename) as { maxVer: number | null } | undefined;
    return row?.maxVer ?? 0;
  },

  async deleteApp(this: SqliteStorage, ownerGaii: string, filename: string, version?: number): Promise<boolean> {
    if (version !== undefined) {
      const result = this.db.prepare('DELETE FROM apps WHERE ownerGaii = ? AND filename = ? AND versionNumber = ?')
        .run(ownerGaii, filename, version);
      return result.changes > 0;
    }
    // Delete all versions
    const result = this.db.prepare('DELETE FROM apps WHERE ownerGaii = ? AND filename = ?')
      .run(ownerGaii, filename);
    // Also delete download counter
    this.db.prepare('DELETE FROM app_downloads WHERE ownerGaii = ? AND filename = ?')
      .run(ownerGaii, filename);
    return result.changes > 0;
  },

  async updateAppAccessCode(this: SqliteStorage, ownerGaii: string, filename: string, accessCode?: string): Promise<boolean> {
    // Update access code on all versions
    const result = this.db.prepare('UPDATE apps SET accessCode = ? WHERE ownerGaii = ? AND filename = ?')
      .run(accessCode ?? null, ownerGaii, filename);
    return result.changes > 0;
  },

  async updateAppMeta(this: SqliteStorage,
    ownerGaii: string,
    filename: string,
    meta: {
      name?: string; description?: string; descriptions?: Record<string, string>; protection?: AppProtection;
      cortex?: AppManifestCortex | null; dataMap?: AppManifest['dataMap']; seo?: Partial<AppSeo>;
      marks?: Partial<AppMarks>; authorship?: AppAuthorship | null; authorshipLog?: AppAuthorshipLogEntry[];
      legal?: Partial<Record<AppLegalKind, AppLegalDoc | null>>;
      designSpec?: AppManifest['designSpec'] | null;
    },
  ): Promise<boolean> {
    // Rename/re-describe in place on the LATEST version (the one the catalogue
    // shows). Read the current manifest, merge only the supplied fields, write
    // it back — the URL (owner/filename) is untouched. Older versions keep the
    // name they were published under.
    const row = this.db.prepare(
      'SELECT versionNumber, manifest FROM apps WHERE ownerGaii = ? AND filename = ? ORDER BY versionNumber DESC LIMIT 1'
    ).get(ownerGaii, filename) as { versionNumber: number; manifest: string } | undefined;
    if (!row) return false;
    const manifest = JSON.parse(row.manifest) as AppManifest;
    if (meta.name !== undefined) manifest.name = meta.name;
    if (meta.description !== undefined) manifest.description = meta.description;
    if (meta.descriptions !== undefined) manifest.descriptions = meta.descriptions;
    if (meta.protection !== undefined) manifest.protection = meta.protection;
    if (meta.dataMap !== undefined) manifest.dataMap = meta.dataMap;
    // MERGED, not replaced: a route flipping the search-visibility switch must not silently drop
    // the title and keywords the owner wrote on a previous visit.
    if (meta.seo !== undefined) manifest.seo = { ...manifest.seo, ...meta.seo };
    // The chrome switches merge like `seo`; the reviewer is one declaration, replaced whole or
    // withdrawn with null; the log is written as the service assembled it.
    if (meta.marks !== undefined) manifest.marks = { ...manifest.marks, ...meta.marks };
    if (meta.authorship !== undefined) {
      if (meta.authorship === null) delete manifest.authorship;
      else manifest.authorship = meta.authorship;
    }
    if (meta.authorshipLog !== undefined) manifest.authorshipLog = meta.authorshipLog;
    // Legal pages merge per kind: a document replaces that kind, null removes it, absent leaves it.
    if (meta.legal !== undefined) manifest.legal = mergeLegal(manifest.legal, meta.legal);
    // Agent-Bundled Apps: replace the crew-def section in place (null clears it).
    if (meta.cortex !== undefined) {
      if (meta.cortex === null || !meta.cortex.agents?.length) delete manifest.cortex;
      else manifest.cortex = meta.cortex;
    }
    // The design spec's stamp: replaced whole by every write of the spec, taken off with null.
    if (meta.designSpec !== undefined) {
      if (meta.designSpec === null) delete manifest.designSpec;
      else manifest.designSpec = meta.designSpec;
    }
    const result = this.db.prepare(
      'UPDATE apps SET manifest = ? WHERE ownerGaii = ? AND filename = ? AND versionNumber = ?'
    ).run(JSON.stringify(manifest), ownerGaii, filename, row.versionNumber);
    return result.changes > 0;
  },

  async setAppParked(this: SqliteStorage, ownerGaii: string, filename: string, parked: boolean): Promise<boolean> {
    // Park/unpark applies to the whole app — flag every version row.
    const result = this.db.prepare('UPDATE apps SET parked = ? WHERE ownerGaii = ? AND filename = ?')
      .run(parked ? 1 : 0, ownerGaii, filename);
    return result.changes > 0;
  },

  async setAppForkable(this: SqliteStorage, ownerGaii: string, filename: string, forkable: boolean): Promise<boolean> {
    // Fork-permission applies to the whole app — flag every version row.
    const result = this.db.prepare('UPDATE apps SET forkable = ? WHERE ownerGaii = ? AND filename = ?')
      .run(forkable ? 1 : 0, ownerGaii, filename);
    return result.changes > 0;
  },

  async setAppOperatorHidden(this: SqliteStorage, 
    ownerGaii: string,
    filename: string,
    hidden: boolean,
    meta?: { by?: string; at?: string; reason?: string },
  ): Promise<boolean> {
    // Operator moderation applies to the whole app — flag every version row.
    // On un-hide, clear the audit fields so a stale "hidden by" never lingers.
    const result = this.db.prepare(
      'UPDATE apps SET operatorHidden = ?, operatorHiddenBy = ?, operatorHiddenAt = ?, operatorHideReason = ? WHERE ownerGaii = ? AND filename = ?'
    ).run(
      hidden ? 1 : 0,
      hidden ? (meta?.by ?? null) : null,
      hidden ? (meta?.at ?? null) : null,
      hidden ? (meta?.reason ?? null) : null,
      ownerGaii,
      filename,
    );
    return result.changes > 0;
  },

  async setAppOperatorSeoBlocked(this: SqliteStorage,
    ownerGaii: string,
    filename: string,
    blocked: boolean,
    meta?: { by?: string; at?: string; reason?: string },
  ): Promise<boolean> {
    // Applies to the whole app — flag every version row, as the three setters above do.
    // On unblock, clear the audit fields so a stale "blocked by" never lingers next to a live app.
    const result = this.db.prepare(
      'UPDATE apps SET operatorSeoBlocked = ?, operatorSeoBlockedBy = ?, operatorSeoBlockedAt = ?, operatorSeoBlockReason = ? WHERE ownerGaii = ? AND filename = ?'
    ).run(
      blocked ? 1 : 0,
      blocked ? (meta?.by ?? null) : null,
      blocked ? (meta?.at ?? null) : null,
      blocked ? (meta?.reason ?? null) : null,
      ownerGaii,
      filename,
    );
    return result.changes > 0;
  },

  async getAppDownloads(this: SqliteStorage, ownerGaii: string, filename: string): Promise<number> {
    const row = this.db.prepare('SELECT downloads FROM app_downloads WHERE ownerGaii = ? AND filename = ?')
      .get(ownerGaii, filename) as { downloads: number } | undefined;
    return row?.downloads ?? 0;
  },

  async incrementAppDownloads(this: SqliteStorage, ownerGaii: string, filename: string): Promise<void> {
    this.db.prepare(
      `INSERT INTO app_downloads (ownerGaii, filename, downloads) VALUES (?, ?, 1)
       ON CONFLICT(ownerGaii, filename) DO UPDATE SET downloads = downloads + 1`
    ).run(ownerGaii, filename);
  },

  async getAppDownloadsForApps(this: SqliteStorage, refs: Array<{ ownerGaii: string; filename: string }>): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const r of refs) out[`${r.ownerGaii} ${r.filename}`] = 0;
    if (refs.length === 0) return out;
    const values = refs.map(() => '(?,?)').join(',');
    const params = refs.flatMap(r => [r.ownerGaii, r.filename]);
    const rows = this.db.prepare(
      `SELECT ownerGaii, filename, downloads FROM app_downloads WHERE (ownerGaii, filename) IN (VALUES ${values})`,
    ).all(...params) as Array<{ ownerGaii: string; filename: string; downloads: number }>;
    for (const row of rows) out[`${row.ownerGaii} ${row.filename}`] = row.downloads ?? 0;
    return out;
  },

  async recordAppFork(this: SqliteStorage, record: AppForkRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO app_forks (id, sourceOwnerGaii, sourceOwnerName, sourceFilename, sourceVersion, childOwnerGaii, childOwnerName, childFilename, forkedByGaii, forkedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.sourceOwnerGaii, record.sourceOwnerName, record.sourceFilename,
      record.sourceVersion, record.childOwnerGaii, record.childOwnerName, record.childFilename,
      record.forkedByGaii, record.forkedAt,
    );
  },

  async countAppForks(this: SqliteStorage, sourceOwnerGaii: string, sourceFilename: string): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM app_forks WHERE sourceOwnerGaii = ? AND sourceFilename = ?')
      .get(sourceOwnerGaii, sourceFilename) as { c: number } | undefined;
    return row?.c ?? 0;
  },

  async countAppForksForApps(this: SqliteStorage, refs: Array<{ ownerGaii: string; filename: string }>): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const r of refs) out[`${r.ownerGaii} ${r.filename}`] = 0;
    if (refs.length === 0) return out;
    const values = refs.map(() => '(?,?)').join(',');
    const params = refs.flatMap(r => [r.ownerGaii, r.filename]);
    const rows = this.db.prepare(
      `SELECT sourceOwnerGaii, sourceFilename, COUNT(*) as c FROM app_forks
       WHERE (sourceOwnerGaii, sourceFilename) IN (VALUES ${values})
       GROUP BY sourceOwnerGaii, sourceFilename`,
    ).all(...params) as Array<{ sourceOwnerGaii: string; sourceFilename: string; c: number }>;
    for (const row of rows) out[`${row.sourceOwnerGaii} ${row.sourceFilename}`] = row.c ?? 0;
    return out;
  },

  async listAppForks(this: SqliteStorage, sourceOwnerGaii: string, sourceFilename: string): Promise<AppForkRecord[]> {
    const rows = this.db.prepare('SELECT * FROM app_forks WHERE sourceOwnerGaii = ? AND sourceFilename = ? ORDER BY forkedAt DESC')
      .all(sourceOwnerGaii, sourceFilename) as AppForkRecord[];
    return rows;
  },

  async normalizeAppOwnerNames(this: SqliteStorage, nodeId: string): Promise<number> {
    // Strip THIS node's `@node` suffix from any ownerName stored as a full GHII of this node. A name of
    // another node (a visitor's own home GHII) stays whole, so it never becomes the local account that
    // shares its local part, nor joins that account's bucket in mergeForkedAppBuckets.
    const result = this.db.prepare(
      `UPDATE apps SET ownerName = substr(ownerName, 1, length(ownerName) - length(@suffix))
       WHERE length(ownerName) > length(@suffix) AND substr(ownerName, -length(@suffix)) = @suffix`
    ).run({ suffix: `@${nodeId}` });
    return result.changes;
  },

  async mergeForkedAppBuckets(this: SqliteStorage): Promise<number> {
    // Consolidate ownerGaii buckets forked across an owner's identity forms into
    // the owner's canonical GHII bucket. Run AFTER normalizeAppOwnerNames() so
    // grouping by the bare ownerName is reliable. See the AppRepository contract
    // for the full rationale. Wrapped in a transaction — partial merges would
    // leave inconsistent version lines.
    let reKeyed = 0;
    const tx = this.db.transaction(() => {
      // Owners we can canonicalize: those with a GHII record. Map bare
      // ownerName -> canonical GHII bucket key.
      const owners = this.db.prepare(
        `SELECT DISTINCT a.ownerName AS ownerName, g.ghii AS ghii
           FROM apps a JOIN ghiis g ON g.ownerName = a.ownerName`
      ).all() as { ownerName: string; ghii: string }[];

      const updRow = this.db.prepare('UPDATE apps SET ownerGaii = ?, versionNumber = ? WHERE rowid = ?');

      for (const { ownerName, ghii } of owners) {
        // Filenames that have at least one row OUTSIDE the canonical bucket.
        const filenames = this.db.prepare(
          'SELECT DISTINCT filename FROM apps WHERE ownerName = ? AND ownerGaii != ?'
        ).all(ownerName, ghii) as { filename: string }[];

        for (const { filename } of filenames) {
          // Stray rows ordered oldest-first so the newest stray gets the highest
          // new version number and therefore becomes the served "latest".
          const strays = this.db.prepare(
            `SELECT rowid AS rid, ownerGaii FROM apps
              WHERE ownerName = ? AND filename = ? AND ownerGaii != ?
              ORDER BY createdAt ASC, versionNumber ASC`
          ).all(ownerName, filename, ghii) as { rid: number; ownerGaii: string }[];
          if (strays.length === 0) continue;

          let maxV = (this.db.prepare(
            'SELECT COALESCE(MAX(versionNumber), 0) AS m FROM apps WHERE ownerGaii = ? AND filename = ?'
          ).get(ghii, filename) as { m: number }).m;

          for (const s of strays) {
            maxV += 1;
            updRow.run(ghii, maxV, s.rid);
            reKeyed += 1;
          }

          const strayBuckets = [...new Set(strays.map(s => s.ownerGaii))];
          const ssKey = `apps/screenshots/${filename}`;

          // Move one stray screenshot into the canonical bucket if it has none,
          // then drop any remaining stray screenshots for this app.
          const canonHasSs = this.db.prepare(
            'SELECT 1 FROM storage_files WHERE ownerGaii = ? AND key = ?'
          ).get(ghii, ssKey);
          if (!canonHasSs) {
            for (const b of strayBuckets) {
              const moved = this.db.prepare(
                'UPDATE storage_files SET ownerGaii = ? WHERE ownerGaii = ? AND key = ?'
              ).run(ghii, b, ssKey);
              if (moved.changes > 0) break;
            }
          }
          for (const b of strayBuckets) {
            this.db.prepare('DELETE FROM storage_files WHERE ownerGaii = ? AND key = ?').run(b, ssKey);
          }

          // Fold stray download counters into the canonical row, then remove them.
          for (const b of strayBuckets) {
            const d = this.db.prepare(
              'SELECT downloads FROM app_downloads WHERE ownerGaii = ? AND filename = ?'
            ).get(b, filename) as { downloads: number } | undefined;
            if (d && d.downloads > 0) {
              this.db.prepare(
                `INSERT INTO app_downloads (ownerGaii, filename, downloads) VALUES (?, ?, ?)
                 ON CONFLICT(ownerGaii, filename) DO UPDATE SET downloads = downloads + excluded.downloads`
              ).run(ghii, filename, d.downloads);
            }
            this.db.prepare('DELETE FROM app_downloads WHERE ownerGaii = ? AND filename = ?').run(b, filename);
          }
        }
      }
    });
    tx();
    return reKeyed;
  },

  /**
   * A listing row → AppSummaryRecord. Same fields as deserializeApp minus `data`, because
   * listApps never selects the payload column (see SUMMARY_COLUMNS).
   */
  deserializeAppSummary(this: SqliteStorage, row: Record<string, unknown>): AppSummaryRecord {
    const record: AppSummaryRecord = {
      ownerGaii: row.ownerGaii as string,
      ownerName: row.ownerName as string,
      filename: row.filename as string,
      versionNumber: row.versionNumber as number,
      manifest: JSON.parse((row.manifest as string) || '{}'),
      mimeType: row.mimeType as string,
      size: row.size as number,
      createdAt: row.createdAt as string,
    };
    if (row.accessCode) record.accessCode = row.accessCode as string;
    if (row.parked) record.parked = true;
    if (row.forkable) record.forkable = true;
    if (row.operatorHidden) {
      record.operatorHidden = true;
      if (row.operatorHiddenBy) record.operatorHiddenBy = row.operatorHiddenBy as string;
      if (row.operatorHiddenAt) record.operatorHiddenAt = row.operatorHiddenAt as string;
      if (row.operatorHideReason) record.operatorHideReason = row.operatorHideReason as string;
    }
    if (row.operatorSeoBlocked) {
      record.operatorSeoBlocked = true;
      if (row.operatorSeoBlockedBy) record.operatorSeoBlockedBy = row.operatorSeoBlockedBy as string;
      if (row.operatorSeoBlockedAt) record.operatorSeoBlockedAt = row.operatorSeoBlockedAt as string;
      if (row.operatorSeoBlockReason) record.operatorSeoBlockReason = row.operatorSeoBlockReason as string;
    }
    if (row.aiProvenanceId) record.aiProvenanceId = row.aiProvenanceId as string;
    return record;
  },

  deserializeApp(this: SqliteStorage, row: Record<string, unknown>): AppRecord {
    const record: AppRecord = {
      ownerGaii: row.ownerGaii as string,
      ownerName: row.ownerName as string,
      filename: row.filename as string,
      versionNumber: row.versionNumber as number,
      manifest: JSON.parse((row.manifest as string) || '{}'),
      mimeType: row.mimeType as string,
      size: row.size as number,
      data: row.data as Buffer,
      createdAt: row.createdAt as string,
    };
    if (row.accessCode) record.accessCode = row.accessCode as string;
    if (row.parked) record.parked = true;
    if (row.forkable) record.forkable = true;
    if (row.operatorHidden) {
      record.operatorHidden = true;
      if (row.operatorHiddenBy) record.operatorHiddenBy = row.operatorHiddenBy as string;
      if (row.operatorHiddenAt) record.operatorHiddenAt = row.operatorHiddenAt as string;
      if (row.operatorHideReason) record.operatorHideReason = row.operatorHideReason as string;
    }
    if (row.operatorSeoBlocked) {
      record.operatorSeoBlocked = true;
      if (row.operatorSeoBlockedBy) record.operatorSeoBlockedBy = row.operatorSeoBlockedBy as string;
      if (row.operatorSeoBlockedAt) record.operatorSeoBlockedAt = row.operatorSeoBlockedAt as string;
      if (row.operatorSeoBlockReason) record.operatorSeoBlockReason = row.operatorSeoBlockReason as string;
    }
    if (row.aiProvenanceId) record.aiProvenanceId = row.aiProvenanceId as string;
    return record;
  },

  // ── App drafts (staging slot; one per owner+filename) ──

  async saveAppDraft(this: SqliteStorage, record: AppDraftRecord): Promise<void> {
    // Upsert: at most one draft per (ownerGaii, filename); a re-save overwrites it.
    this.db.prepare(
      `INSERT INTO app_drafts (ownerGaii, ownerName, filename, manifest, mimeType, size, data, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ownerGaii, filename) DO UPDATE SET
         ownerName = excluded.ownerName, manifest = excluded.manifest,
         mimeType = excluded.mimeType, size = excluded.size,
         data = excluded.data, updatedAt = excluded.updatedAt`
    ).run(
      record.ownerGaii, record.ownerName, record.filename,
      JSON.stringify(record.manifest), record.mimeType, record.size,
      record.data, record.updatedAt,
    );
  },

  async getAppDraft(this: SqliteStorage, ownerGaii: string, filename: string): Promise<AppDraftRecord | null> {
    const row = this.db.prepare('SELECT * FROM app_drafts WHERE ownerGaii = ? AND filename = ?')
      .get(ownerGaii, filename) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      ownerGaii: row.ownerGaii as string,
      ownerName: row.ownerName as string,
      filename: row.filename as string,
      manifest: JSON.parse((row.manifest as string) || '{}'),
      mimeType: row.mimeType as string,
      size: row.size as number,
      data: row.data as Buffer,
      updatedAt: row.updatedAt as string,
    };
  },

  async deleteAppDraft(this: SqliteStorage, ownerGaii: string, filename: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM app_drafts WHERE ownerGaii = ? AND filename = ?')
      .run(ownerGaii, filename);
    return result.changes > 0;
  },

  async listAppDraftFilenames(this: SqliteStorage, ownerGaii: string): Promise<string[]> {
    const rows = this.db.prepare('SELECT filename FROM app_drafts WHERE ownerGaii = ?')
      .all(ownerGaii) as Array<{ filename: string }>;
    return rows.map(r => r.filename);
  },
};
