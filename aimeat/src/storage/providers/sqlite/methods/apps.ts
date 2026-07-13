/**
 * @file src/storage/providers/sqlite/methods/apps.ts
 * @description Token-revocation, App-catalog, Subdomain, App-grant, App-draft, App-marketplace, Config, Knowledge-link methods. Extracted from sqlite/index.ts to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage via prototype merge.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/sqlite/index.ts (max-file-lines)
 */
import type {
  AppRecord, AppDraftRecord, AppManifest, AppListOptions, AppPurchaseRecord, AppForkRecord,
  AppProtection, SubdomainSiteRecord, AppGrantRecord, MemoryLinkRecord
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const appsMethods = {
  // ── Token Revocation ──
  // ══════════════════════════════════════════════════════════

  async revokeToken(this: SqliteStorage, tokenHash: string, expiresAt: number): Promise<void> {
    this.db.prepare(
      'INSERT OR REPLACE INTO revoked_tokens (token_hash, expires_at) VALUES (?, ?)'
    ).run(tokenHash, expiresAt);
  },

  async isTokenRevoked(this: SqliteStorage, tokenHash: string): Promise<boolean> {
    const row = this.db.prepare('SELECT 1 FROM revoked_tokens WHERE token_hash = ?').get(tokenHash);
    return !!row;
  },

  async cleanExpiredRevocations(this: SqliteStorage): Promise<number> {
    const result = this.db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(Math.floor(Date.now() / 1000));
    return result.changes;
  },

  // ══════════════════════════════════════════════════════════
  // ── App Catalog ──
  // ══════════════════════════════════════════════════════════

  async createApp(this: SqliteStorage, record: AppRecord): Promise<AppRecord> {
    this.db.prepare(
      `INSERT INTO apps (ownerGaii, ownerName, filename, versionNumber, manifest, mimeType, size, data, accessCode, parked, forkable, operatorHidden, operatorHiddenBy, operatorHiddenAt, operatorHideReason, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.ownerGaii, record.ownerName, record.filename, record.versionNumber,
      JSON.stringify(record.manifest), record.mimeType, record.size, record.data,
      record.accessCode ?? null, record.parked ? 1 : 0, record.forkable ? 1 : 0,
      record.operatorHidden ? 1 : 0, record.operatorHiddenBy ?? null,
      record.operatorHiddenAt ?? null, record.operatorHideReason ?? null,
      record.createdAt,
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

  async listApps(this: SqliteStorage, opts?: AppListOptions): Promise<{ apps: AppRecord[]; total: number }> {
    // Get latest version of each app
    let query = `SELECT a.* FROM apps a
      INNER JOIN (SELECT ownerGaii, filename, MAX(versionNumber) as maxVer FROM apps GROUP BY ownerGaii, filename) latest
      ON a.ownerGaii = latest.ownerGaii AND a.filename = latest.filename AND a.versionNumber = latest.maxVer`;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.ownerGaii) {
      conditions.push(`a.ownerGaii = ?`);
      params.push(opts.ownerGaii);
    }
    if (opts?.category) {
      conditions.push(`json_extract(a.manifest, '$.category') = ?`);
      params.push(opts.category);
    }
    if (opts?.tag) {
      conditions.push(`a.manifest LIKE ?`);
      params.push(`%"${opts.tag}"%`);
    }
    if (opts?.q) {
      conditions.push(`(a.filename LIKE ? OR json_extract(a.manifest, '$.name') LIKE ? OR json_extract(a.manifest, '$.description') LIKE ?)`);
      const like = `%${opts.q}%`;
      params.push(like, like, like);
    }
    if (opts?.freeOnly) {
      conditions.push(`(json_extract(a.manifest, '$.priceMorsels') IS NULL OR json_extract(a.manifest, '$.priceMorsels') = 0)`);
    }
    // Parked + operator-hidden apps are hidden from everyone EXCEPT their owner
    // (viewerGhii) — decided purely from who is authenticated. The owner sees their
    // own (operator-hidden ones carry operator_hidden=true so the client can badge
    // them); everyone else does not. An explicit ownerGaii filter already scopes to
    // one owner, so skip the clause there. adminView sees EVERYTHING.
    if (!opts?.ownerGaii && !opts?.adminView) {
      if (opts?.viewerGhii) {
        conditions.push(`(a.parked = 0 OR a.ownerGaii = ?)`);
        params.push(opts.viewerGhii);
        conditions.push(`(a.operatorHidden = 0 OR a.ownerGaii = ?)`);
        params.push(opts.viewerGhii);
      } else {
        conditions.push(`a.parked = 0`);
        conditions.push(`a.operatorHidden = 0`);
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    // Count total before pagination
    const countQuery = query.replace('SELECT a.*', 'SELECT COUNT(*) as cnt');
    const countRow = this.db.prepare(countQuery).get(...params) as { cnt: number };
    const total = countRow.cnt;

    // Sort
    if (opts?.sort === 'popular') {
      query += ` ORDER BY (SELECT COALESCE(d.downloads, 0) FROM app_downloads d WHERE d.ownerGaii = a.ownerGaii AND d.filename = a.filename) DESC, a.createdAt DESC`;
    } else {
      query += ' ORDER BY a.createdAt DESC';
    }

    // Pagination
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return { apps: rows.map(r => this.deserializeApp(r)), total };
  },

  async listAppVersions(this: SqliteStorage, ownerGaii: string, filename: string): Promise<AppRecord[]> {
    const rows = this.db.prepare('SELECT * FROM apps WHERE ownerGaii = ? AND filename = ? ORDER BY versionNumber DESC')
      .all(ownerGaii, filename) as Record<string, unknown>[];
    return rows.map(r => this.deserializeApp(r));
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
    meta: { name?: string; description?: string; protection?: AppProtection },
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
    if (meta.protection !== undefined) manifest.protection = meta.protection;
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

  async listAppForks(this: SqliteStorage, sourceOwnerGaii: string, sourceFilename: string): Promise<AppForkRecord[]> {
    const rows = this.db.prepare('SELECT * FROM app_forks WHERE sourceOwnerGaii = ? AND sourceFilename = ? ORDER BY forkedAt DESC')
      .all(sourceOwnerGaii, sourceFilename) as AppForkRecord[];
    return rows;
  },

  // ── Subdomain sites (operator-managed subdomain → app/redirect mappings) ──

  async createSubdomainSite(this: SqliteStorage, site: SubdomainSiteRecord): Promise<SubdomainSiteRecord> {
    this.db.prepare(
      `INSERT INTO subdomain_sites (subdomain, kind, target, enabled, createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      site.subdomain, site.kind, site.target, site.enabled ? 1 : 0,
      site.createdBy, site.createdAt, site.updatedAt,
    );
    return site;
  },

  async getSubdomainSite(this: SqliteStorage, subdomain: string): Promise<SubdomainSiteRecord | null> {
    const row = this.db.prepare('SELECT * FROM subdomain_sites WHERE subdomain = ?')
      .get(subdomain) as Record<string, unknown> | undefined;
    return row ? this.deserializeSubdomainSite(row) : null;
  },

  async listSubdomainSites(this: SqliteStorage): Promise<SubdomainSiteRecord[]> {
    const rows = this.db.prepare('SELECT * FROM subdomain_sites ORDER BY subdomain')
      .all() as Record<string, unknown>[];
    return rows.map(r => this.deserializeSubdomainSite(r));
  },

  async updateSubdomainSite(this: SqliteStorage, 
    subdomain: string,
    updates: Partial<Pick<SubdomainSiteRecord, 'kind' | 'target' | 'enabled' | 'updatedAt'>>,
  ): Promise<SubdomainSiteRecord | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.kind !== undefined) { sets.push('kind = ?'); params.push(updates.kind); }
    if (updates.target !== undefined) { sets.push('target = ?'); params.push(updates.target); }
    if (updates.enabled !== undefined) { sets.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }
    sets.push('updatedAt = ?');
    params.push(updates.updatedAt ?? new Date().toISOString());
    params.push(subdomain);
    const result = this.db.prepare(`UPDATE subdomain_sites SET ${sets.join(', ')} WHERE subdomain = ?`)
      .run(...params);
    if (result.changes === 0) return null;
    return this.getSubdomainSite(subdomain);
  },

  async deleteSubdomainSite(this: SqliteStorage, subdomain: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM subdomain_sites WHERE subdomain = ?').run(subdomain);
    return result.changes > 0;
  },

  deserializeSubdomainSite(this: SqliteStorage, row: Record<string, unknown>): SubdomainSiteRecord {
    return {
      subdomain: row.subdomain as string,
      kind: row.kind as SubdomainSiteRecord['kind'],
      target: row.target as string,
      enabled: (row.enabled as number) === 1,
      createdBy: row.createdBy as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  },

  // ── App grants (owner-issued app authorizations → agent tokens) ──

  async createAppGrant(this: SqliteStorage, grant: AppGrantRecord): Promise<AppGrantRecord> {
    this.db.prepare(
      `INSERT INTO app_grants (grantId, app, appName, appOrigin, owner, gaii, scopes, refreshTokenHash, createdAt, lastUsedAt, revoked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      grant.grantId, grant.app, grant.appName, grant.appOrigin, grant.owner, grant.gaii,
      JSON.stringify(grant.scopes), grant.refreshTokenHash, grant.createdAt, grant.lastUsedAt,
      grant.revoked ? 1 : 0,
    );
    return grant;
  },

  async getAppGrant(this: SqliteStorage, grantId: string): Promise<AppGrantRecord | null> {
    const row = this.db.prepare('SELECT * FROM app_grants WHERE grantId = ?')
      .get(grantId) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppGrant(row) : null;
  },

  async getAppGrantByRefreshHash(this: SqliteStorage, tokenHash: string): Promise<AppGrantRecord | null> {
    const row = this.db.prepare('SELECT * FROM app_grants WHERE refreshTokenHash = ?')
      .get(tokenHash) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppGrant(row) : null;
  },

  async listAppGrantsByOwner(this: SqliteStorage, owner: string): Promise<AppGrantRecord[]> {
    const rows = this.db.prepare('SELECT * FROM app_grants WHERE owner = ? ORDER BY createdAt DESC')
      .all(owner) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAppGrant(r));
  },

  async updateAppGrant(this: SqliteStorage, 
    grantId: string,
    updates: Partial<Pick<AppGrantRecord, 'refreshTokenHash' | 'lastUsedAt' | 'revoked' | 'scopes'>>,
  ): Promise<AppGrantRecord | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.refreshTokenHash !== undefined) { sets.push('refreshTokenHash = ?'); params.push(updates.refreshTokenHash); }
    if (updates.lastUsedAt !== undefined) { sets.push('lastUsedAt = ?'); params.push(updates.lastUsedAt); }
    if (updates.revoked !== undefined) { sets.push('revoked = ?'); params.push(updates.revoked ? 1 : 0); }
    if (updates.scopes !== undefined) { sets.push('scopes = ?'); params.push(JSON.stringify(updates.scopes)); }
    if (sets.length === 0) return this.getAppGrant(grantId);
    params.push(grantId);
    const result = this.db.prepare(`UPDATE app_grants SET ${sets.join(', ')} WHERE grantId = ?`)
      .run(...params);
    if (result.changes === 0) return null;
    return this.getAppGrant(grantId);
  },

  async deleteAppGrant(this: SqliteStorage, grantId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM app_grants WHERE grantId = ?').run(grantId);
    return result.changes > 0;
  },

  deserializeAppGrant(this: SqliteStorage, row: Record<string, unknown>): AppGrantRecord {
    return {
      grantId: row.grantId as string,
      app: row.app as string,
      appName: row.appName as string,
      appOrigin: row.appOrigin as string,
      owner: row.owner as string,
      gaii: row.gaii as string,
      scopes: JSON.parse(row.scopes as string) as string[],
      refreshTokenHash: (row.refreshTokenHash as string | null) ?? null,
      createdAt: row.createdAt as string,
      lastUsedAt: (row.lastUsedAt as string | null) ?? null,
      revoked: (row.revoked as number) === 1,
    };
  },

  async normalizeAppOwnerNames(this: SqliteStorage): Promise<number> {
    // Strip the `@node` suffix from any ownerName stored as a full GHII. Owner
    // names never contain '@', so `instr` finds only the GHII separator.
    const result = this.db.prepare(
      `UPDATE apps SET ownerName = substr(ownerName, 1, instr(ownerName, '@') - 1)
       WHERE ownerName LIKE '%@%'`
    ).run();
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

  // ── App Marketplace (purchase receipts) ──

  async createAppPurchase(this: SqliteStorage, record: AppPurchaseRecord): Promise<AppPurchaseRecord> {
    this.db.prepare(`INSERT INTO app_purchases (transactionId, buyerGaii, buyerOwner, sellerGaii, sellerOwner, appFilename, appName, appVersionNumber, licenseType, priceMorsels, transactionFeeMorsels, purchasedAt, appContent, appManifest, appScreenshot, signature, nodeId, nodePublicKey) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      record.transactionId, record.buyerGaii, record.buyerOwner,
      record.sellerGaii, record.sellerOwner, record.appFilename,
      record.appName, record.appVersionNumber, record.licenseType,
      record.priceMorsels, record.transactionFeeMorsels, record.purchasedAt,
      record.appContent, JSON.stringify(record.appManifest),
      record.appScreenshot ?? null, record.signature,
      record.nodeId, record.nodePublicKey,
    );
    return record;
  },

  async getAppPurchase(this: SqliteStorage, transactionId: string): Promise<AppPurchaseRecord | null> {
    const row = this.db.prepare('SELECT * FROM app_purchases WHERE transactionId = ?').get(transactionId) as Record<string, unknown> | undefined;
    return row ? this.deserializeAppPurchase(row) : null;
  },

  async listAppPurchasesByBuyer(this: SqliteStorage, buyerGaii: string): Promise<AppPurchaseRecord[]> {
    const rows = this.db.prepare('SELECT * FROM app_purchases WHERE buyerGaii = ? ORDER BY purchasedAt DESC').all(buyerGaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAppPurchase(r));
  },

  async listAppPurchasesBySeller(this: SqliteStorage, sellerGaii: string): Promise<AppPurchaseRecord[]> {
    const rows = this.db.prepare('SELECT * FROM app_purchases WHERE sellerGaii = ? ORDER BY purchasedAt DESC').all(sellerGaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAppPurchase(r));
  },

  async hasValidLicense(this: SqliteStorage, buyerGaii: string, sellerGaii: string, filename: string, licenseType?: 'single' | 'lifetime'): Promise<boolean> {
    // Lifetime license: any purchase of this app grants access to all versions
    const lifetime = this.db.prepare('SELECT 1 FROM app_purchases WHERE buyerGaii = ? AND sellerGaii = ? AND appFilename = ? AND licenseType = ? LIMIT 1').get(buyerGaii, sellerGaii, filename, 'lifetime') as Record<string, unknown> | undefined;
    if (lifetime) return true;
    // Single license: buyer has at least one purchase of this app (version-specific check done at download)
    if (!licenseType || licenseType === 'single') {
      const single = this.db.prepare('SELECT 1 FROM app_purchases WHERE buyerGaii = ? AND sellerGaii = ? AND appFilename = ? LIMIT 1').get(buyerGaii, sellerGaii, filename) as Record<string, unknown> | undefined;
      return !!single;
    }
    return false;
  },

  deserializeAppPurchase(this: SqliteStorage, row: Record<string, unknown>): AppPurchaseRecord {
    const record: AppPurchaseRecord = {
      transactionId: row.transactionId as string,
      buyerGaii: row.buyerGaii as string,
      buyerOwner: row.buyerOwner as string,
      sellerGaii: row.sellerGaii as string,
      sellerOwner: row.sellerOwner as string,
      appFilename: row.appFilename as string,
      appName: row.appName as string,
      appVersionNumber: row.appVersionNumber as number,
      licenseType: row.licenseType as 'single' | 'lifetime',
      priceMorsels: row.priceMorsels as number,
      transactionFeeMorsels: row.transactionFeeMorsels as number,
      purchasedAt: row.purchasedAt as string,
      appContent: row.appContent as string,
      appManifest: JSON.parse((row.appManifest as string) || '{}'),
      signature: row.signature as string,
      nodeId: row.nodeId as string,
      nodePublicKey: row.nodePublicKey as string,
    };
    if (row.appScreenshot) record.appScreenshot = row.appScreenshot as string;
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Config Persistence ──
  // ══════════════════════════════════════════════════════════

  supportsConfigPersistence(this: SqliteStorage): boolean {
    // In-memory SQLite (:memory:) does not persist across restarts
    return this.db.name !== ':memory:';
  },

  async getConfigValue(this: SqliteStorage, key: string): Promise<string | null> {
    const row = this.db.prepare('SELECT value FROM system_settings WHERE key = ?').get(`config:${key}`) as { value: string } | undefined;
    return row?.value ?? null;
  },

  async setConfigValue(this: SqliteStorage, key: string, value: string): Promise<void> {
    this.db.prepare(`
      INSERT INTO system_settings (key, value, updatedAt) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = datetime('now')
    `).run(`config:${key}`, value);
  },

  async deleteConfigValue(this: SqliteStorage, key: string): Promise<void> {
    this.db.prepare('DELETE FROM system_settings WHERE key = ?').run(`config:${key}`);
  },

  async getAllConfigValues(this: SqliteStorage): Promise<Record<string, string>> {
    const rows = this.db.prepare("SELECT key, value FROM system_settings WHERE key LIKE 'config:%'").all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const r of rows) result[r.key.replace('config:', '')] = r.value;
    return result;
  },

  // ══════════════════════════════════════════════════════════
  // ── Knowledge: Memory Links ──
  // ══════════════════════════════════════════════════════════

  async createLink(this: SqliteStorage, record: MemoryLinkRecord): Promise<MemoryLinkRecord> {
    this.db.prepare(`
      INSERT INTO knowledge_links (source, target, relation, description, linked_at, linked_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, target) DO UPDATE SET
        relation = excluded.relation, description = excluded.description,
        linked_at = excluded.linked_at, linked_by = excluded.linked_by
    `).run(record.source, record.target, record.relation, record.description, record.linked_at, record.linked_by);
    return record;
  },

  async getLink(this: SqliteStorage, source: string, target: string): Promise<MemoryLinkRecord | null> {
    const row = this.db.prepare('SELECT * FROM knowledge_links WHERE source = ? AND target = ?').get(source, target) as MemoryLinkRecord | undefined;
    return row ?? null;
  },

  async listLinks(this: SqliteStorage, key: string, opts?: { direction?: 'outgoing' | 'incoming' | 'both'; relation?: string }): Promise<MemoryLinkRecord[]> {
    const dir = opts?.direction ?? 'both';
    let sql: string;
    const params: string[] = [];

    if (dir === 'outgoing') {
      sql = 'SELECT * FROM knowledge_links WHERE source = ?';
      params.push(key);
    } else if (dir === 'incoming') {
      sql = 'SELECT * FROM knowledge_links WHERE target = ?';
      params.push(key);
    } else {
      sql = 'SELECT * FROM knowledge_links WHERE source = ? OR target = ?';
      params.push(key, key);
    }

    if (opts?.relation) {
      sql += ' AND relation = ?';
      params.push(opts.relation);
    }

    return this.db.prepare(sql).all(...params) as MemoryLinkRecord[];
  },

  async deleteLink(this: SqliteStorage, source: string, target: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM knowledge_links WHERE source = ? AND target = ?').run(source, target);
    return result.changes > 0;
  },

  async findBrokenLinks(this: SqliteStorage, ownerGaii: string): Promise<MemoryLinkRecord[]> {
    const links = this.db.prepare('SELECT * FROM knowledge_links WHERE linked_by = ?').all(ownerGaii) as MemoryLinkRecord[];
    const broken: MemoryLinkRecord[] = [];
    for (const link of links) {
      const sourceExists = await this.getMemory(ownerGaii, link.source);
      const targetExists = await this.getMemory(ownerGaii, link.target);
      if (!sourceExists || !targetExists) broken.push(link);
    }
    return broken;
  },

  async deleteLinksByContributor(this: SqliteStorage, gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM knowledge_links WHERE linked_by = ?').run(gaii);
    return result.changes;
  },

  // ══════════════════════════════════════════════════════════
};
