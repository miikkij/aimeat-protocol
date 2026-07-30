/**
 * @file src/storage/providers/postgres-kysely/methods/apps.ts
 * @description App Catalog domain for the Postgres+Kysely backend: versioned single-file HTML apps
 *   (App), the one-per-(owner,filename) draft slot (AppDraft), download counters (AppDownload), and
 *   append-only fork lineage (AppFork). Translated 1:1 from the Prisma implementation against the same
 *   tables — getApp with no version returns the latest row; listApps dedups to the latest version per
 *   (owner,filename), filters, and paginates returning {apps,total}; downloads live in a separate
 *   AppDownload row keyed (ownerGaii,filename); the data-hygiene sweeps (normalizeAppOwnerNames,
 *   mergeForkedAppBuckets) replicate the Prisma migration logic exactly.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: app catalog on Postgres+Kysely.
 */
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type {
  AppRecord, AppDraftRecord, AppListOptions, AppForkRecord, AppManifest, AppManifestCortex, AppProtection,
} from '../../../interface.js';
import type { App, AppDraft, AppFork } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoOpt = (t: Date | string | null | undefined): string | undefined => (t == null ? undefined : iso(t));
const ms = (t: Date | string): number => (t instanceof Date ? t : new Date(t)).getTime();

function toApp(r: Selectable<App>): AppRecord {
  return {
    ownerGaii: r.ownerGaii,
    ownerName: r.ownerName,
    filename: r.filename,
    versionNumber: r.versionNumber,
    manifest: r.manifest as unknown as AppManifest,
    mimeType: r.mimeType,
    size: r.size,
    data: Buffer.from(r.data),
    accessCode: r.accessCode ?? undefined,
    parked: r.parked ? true : undefined,
    forkable: r.forkable ? true : undefined,
    operatorHidden: r.operatorHidden ? true : undefined,
    operatorHiddenBy: r.operatorHiddenBy ?? undefined,
    operatorHiddenAt: isoOpt(r.operatorHiddenAt),
    operatorHideReason: r.operatorHideReason ?? undefined,
    createdAt: iso(r.createdAt),
  };
}

function toDraft(r: Selectable<AppDraft>): AppDraftRecord {
  return {
    ownerGaii: r.ownerGaii,
    ownerName: r.ownerName,
    filename: r.filename,
    manifest: r.manifest as unknown as AppManifest,
    mimeType: r.mimeType,
    size: r.size,
    data: Buffer.from(r.data),
    updatedAt: iso(r.updatedAt),
  };
}

function toFork(r: Selectable<AppFork>): AppForkRecord {
  return {
    id: r.id,
    sourceOwnerGaii: r.sourceOwnerGaii,
    sourceOwnerName: r.sourceOwnerName,
    sourceFilename: r.sourceFilename,
    sourceVersion: r.sourceVersion,
    childOwnerGaii: r.childOwnerGaii,
    childOwnerName: r.childOwnerName,
    childFilename: r.childFilename,
    forkedByGaii: r.forkedByGaii,
    forkedAt: iso(r.forkedAt),
  };
}

export const appMethods = {
  // ── App Catalog ──
  async createApp(this: PostgresKyselyStorage, record: AppRecord): Promise<AppRecord> {
    await this.db.insertInto('App').values({
      ownerGaii: record.ownerGaii, ownerName: record.ownerName, filename: record.filename,
      versionNumber: record.versionNumber, manifest: jsonb(record.manifest), mimeType: record.mimeType,
      size: record.size, data: record.data, accessCode: record.accessCode ?? null,
      parked: record.parked ?? false, forkable: record.forkable ?? false,
      operatorHidden: record.operatorHidden ?? false, operatorHiddenBy: record.operatorHiddenBy ?? null,
      operatorHiddenAt: record.operatorHiddenAt ? new Date(record.operatorHiddenAt) : null,
      operatorHideReason: record.operatorHideReason ?? null, createdAt: new Date(record.createdAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return record;
  },

  // ── App drafts (staging slot; one per owner+filename) ──
  async saveAppDraft(this: PostgresKyselyStorage, record: AppDraftRecord): Promise<void> {
    // Upsert: at most one draft per (ownerGaii, filename); a re-save overwrites it.
    const shared = {
      ownerName: record.ownerName, manifest: jsonb(record.manifest), mimeType: record.mimeType,
      size: record.size, data: record.data, updatedAt: new Date(record.updatedAt),
    };
    await this.db.insertInto('AppDraft')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ ownerGaii: record.ownerGaii, filename: record.filename, ...shared } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict(oc => oc.columns(['ownerGaii', 'filename']).doUpdateSet(shared as any)).execute();
  },

  async getAppDraft(this: PostgresKyselyStorage, ownerGaii: string, filename: string): Promise<AppDraftRecord | null> {
    const r = await this.db.selectFrom('AppDraft').selectAll().where('ownerGaii', '=', ownerGaii).where('filename', '=', filename).executeTakeFirst();
    return r ? toDraft(r) : null;
  },

  async deleteAppDraft(this: PostgresKyselyStorage, ownerGaii: string, filename: string): Promise<boolean> {
    const r = await this.db.deleteFrom('AppDraft').where('ownerGaii', '=', ownerGaii).where('filename', '=', filename).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async listAppDraftFilenames(this: PostgresKyselyStorage, ownerGaii: string): Promise<string[]> {
    const rows = await this.db.selectFrom('AppDraft').select('filename').where('ownerGaii', '=', ownerGaii).execute();
    return rows.map(r => r.filename);
  },

  async getApp(this: PostgresKyselyStorage, ownerGaii: string, filename: string, version?: number): Promise<AppRecord | null> {
    let q = this.db.selectFrom('App').selectAll().where('ownerGaii', '=', ownerGaii).where('filename', '=', filename);
    if (version !== undefined) q = q.where('versionNumber', '=', version);
    const r = await q.orderBy('versionNumber', 'desc').executeTakeFirst();
    return r ? toApp(r) : null;
  },

  async getAppByOwnerName(this: PostgresKyselyStorage, ownerName: string, filename: string, version?: number): Promise<AppRecord | null> {
    let q = this.db.selectFrom('App').selectAll().where('ownerName', '=', ownerName).where('filename', '=', filename);
    if (version !== undefined) q = q.where('versionNumber', '=', version);
    const r = await q.orderBy('versionNumber', 'desc').executeTakeFirst();
    return r ? toApp(r) : null;
  },

  async listApps(this: PostgresKyselyStorage, opts?: AppListOptions): Promise<{ apps: AppRecord[]; total: number }> {
    // Fetch (optionally owner-scoped) rows, then deduplicate to latest version per owner+filename.
    let q = this.db.selectFrom('App').selectAll();
    if (opts?.ownerGaii) q = q.where('ownerGaii', '=', opts.ownerGaii);
    const allRows = await q.orderBy('versionNumber', 'desc').execute();
    const latestMap = new Map<string, Selectable<App>>();
    for (const r of allRows) {
      const key = `${r.ownerGaii}:${r.filename}`;
      if (!latestMap.has(key)) latestMap.set(key, r);
    }
    let apps = Array.from(latestMap.values()).map(toApp);
    if (opts?.category) apps = apps.filter(a => a.manifest.category === opts.category);
    if (opts?.tag) apps = apps.filter(a => a.manifest.tags.includes(opts.tag!));
    if (opts?.q) {
      const query = opts.q.toLowerCase();
      apps = apps.filter(a => a.filename.toLowerCase().includes(query) || a.manifest.name.toLowerCase().includes(query) || a.manifest.description.toLowerCase().includes(query));
    }
    if (opts?.freeOnly) apps = apps.filter(a => !a.manifest.priceMorsels);
    // Parked + operator-hidden apps are hidden from everyone EXCEPT their owner (viewerGhii). A scoped
    // ownerGaii query already returns only that owner's apps, so skip the filters there. adminView sees all.
    if (!opts?.ownerGaii && !opts?.adminView) {
      apps = apps.filter(a => !a.parked || (opts?.viewerGhii && a.ownerGaii === opts.viewerGhii));
      apps = apps.filter(a => !a.operatorHidden || (opts?.viewerGhii && a.ownerGaii === opts.viewerGhii));
    }
    const total = apps.length;
    // 'popular' was accepted and then ignored here: every caller asking for it got the newest
    // apps instead, silently. SQLite has always ordered by the download count, so the two
    // backends disagreed about what the same query means. One row per downloaded app makes the
    // whole counter table cheap to read, and it has to be read before the slice or the ordering
    // would only shuffle whichever page the newest-first cut happened to produce.
    if (opts?.sort === 'popular') {
      const counts = new Map<string, number>();
      const rows = await this.db.selectFrom('AppDownload').select(['ownerGaii', 'filename', 'count']).execute();
      for (const r of rows) counts.set(`${r.ownerGaii} ${r.filename}`, r.count ?? 0);
      const of = (a: AppRecord) => counts.get(`${a.ownerGaii} ${a.filename}`) ?? 0;
      // Newest first among apps nobody has opened yet, so the tail stays meaningful.
      apps.sort((a, b) => (of(b) - of(a)) || b.createdAt.localeCompare(a.createdAt));
    } else {
      apps.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 50;
    return { apps: apps.slice(offset, offset + limit), total };
  },

  async listAppVersions(this: PostgresKyselyStorage, ownerGaii: string, filename: string): Promise<AppRecord[]> {
    const rows = await this.db.selectFrom('App').selectAll().where('ownerGaii', '=', ownerGaii).where('filename', '=', filename).orderBy('versionNumber', 'desc').execute();
    return rows.map(toApp);
  },

  async getLatestVersionNumber(this: PostgresKyselyStorage, ownerGaii: string, filename: string): Promise<number> {
    const r = await this.db.selectFrom('App').select('versionNumber').where('ownerGaii', '=', ownerGaii).where('filename', '=', filename).orderBy('versionNumber', 'desc').executeTakeFirst();
    return r?.versionNumber ?? 0;
  },

  async deleteApp(this: PostgresKyselyStorage, ownerGaii: string, filename: string, version?: number): Promise<boolean> {
    if (version !== undefined) {
      const r = await this.db.deleteFrom('App').where('ownerGaii', '=', ownerGaii).where('filename', '=', filename).where('versionNumber', '=', version).executeTakeFirst();
      return Number(r.numDeletedRows ?? 0) > 0;
    }
    const r = await this.db.deleteFrom('App').where('ownerGaii', '=', ownerGaii).where('filename', '=', filename).executeTakeFirst();
    await this.db.deleteFrom('AppDownload').where('ownerGaii', '=', ownerGaii).where('filename', '=', filename).execute();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async updateAppAccessCode(this: PostgresKyselyStorage, ownerGaii: string, filename: string, accessCode?: string): Promise<boolean> {
    const r = await this.db.updateTable('App').set({ accessCode: accessCode ?? null }).where('ownerGaii', '=', ownerGaii).where('filename', '=', filename).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },

  async updateAppMeta(
    this: PostgresKyselyStorage, ownerGaii: string, filename: string,
    meta: { name?: string; description?: string; descriptions?: Record<string, string>; protection?: AppProtection; cortex?: AppManifestCortex | null },
  ): Promise<boolean> {
    // Rename/re-describe in place on the LATEST version (the one the catalogue shows). Read the current
    // manifest, merge only the supplied fields, write it back — the URL (owner/filename) is untouched.
    const latest = await this.db.selectFrom('App').selectAll().where('ownerGaii', '=', ownerGaii).where('filename', '=', filename).orderBy('versionNumber', 'desc').executeTakeFirst();
    if (!latest) return false;
    const manifest = { ...(latest.manifest as unknown as AppManifest) };
    if (meta.name !== undefined) manifest.name = meta.name;
    if (meta.description !== undefined) manifest.description = meta.description;
    if (meta.descriptions !== undefined) manifest.descriptions = meta.descriptions;
    if (meta.protection !== undefined) manifest.protection = meta.protection;
    // Agent-Bundled Apps: replace the crew-def section in place (null clears it).
    if (meta.cortex !== undefined) {
      if (meta.cortex === null || !meta.cortex.agents?.length) delete manifest.cortex;
      else manifest.cortex = meta.cortex;
    }
    await this.db.updateTable('App')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set({ manifest: jsonb(manifest) } as any)
      .where('ownerGaii', '=', ownerGaii).where('filename', '=', filename).where('versionNumber', '=', latest.versionNumber).execute();
    return true;
  },

  async setAppParked(this: PostgresKyselyStorage, ownerGaii: string, filename: string, parked: boolean): Promise<boolean> {
    // Park/unpark applies to the whole app — flag every version row.
    const r = await this.db.updateTable('App').set({ parked }).where('ownerGaii', '=', ownerGaii).where('filename', '=', filename).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },

  async setAppForkable(this: PostgresKyselyStorage, ownerGaii: string, filename: string, forkable: boolean): Promise<boolean> {
    // Fork-permission applies to the whole app — flag every version row.
    const r = await this.db.updateTable('App').set({ forkable }).where('ownerGaii', '=', ownerGaii).where('filename', '=', filename).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },

  async setAppOperatorHidden(
    this: PostgresKyselyStorage, ownerGaii: string, filename: string, hidden: boolean,
    meta?: { by?: string; at?: string; reason?: string },
  ): Promise<boolean> {
    // Operator moderation applies to the whole app — flag every version row. On un-hide, clear the
    // audit fields so a stale "hidden by" never lingers.
    const r = await this.db.updateTable('App').set({
      operatorHidden: hidden,
      operatorHiddenBy: hidden ? (meta?.by ?? null) : null,
      operatorHiddenAt: hidden ? (meta?.at ? new Date(meta.at) : null) : null,
      operatorHideReason: hidden ? (meta?.reason ?? null) : null,
    }).where('ownerGaii', '=', ownerGaii).where('filename', '=', filename).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },

  async getAppDownloads(this: PostgresKyselyStorage, ownerGaii: string, filename: string): Promise<number> {
    const r = await this.db.selectFrom('AppDownload').select('count').where('ownerGaii', '=', ownerGaii).where('filename', '=', filename).executeTakeFirst();
    return r?.count ?? 0;
  },

  async incrementAppDownloads(this: PostgresKyselyStorage, ownerGaii: string, filename: string): Promise<void> {
    await this.db.insertInto('AppDownload')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ ownerGaii, filename, count: 1 } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict(oc => oc.columns(['ownerGaii', 'filename']).doUpdateSet({ count: sql`"AppDownload"."count" + 1` } as any)).execute();
  },

  async getAppDownloadsForApps(this: PostgresKyselyStorage, refs: Array<{ ownerGaii: string; filename: string }>): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const r of refs) out[`${r.ownerGaii} ${r.filename}`] = 0;
    if (refs.length === 0) return out;
    const rows = await this.db.selectFrom('AppDownload').select(['ownerGaii', 'filename', 'count'])
      .where(eb => eb.or(refs.map(r => eb.and([eb('ownerGaii', '=', r.ownerGaii), eb('filename', '=', r.filename)])))).execute();
    for (const row of rows) out[`${row.ownerGaii} ${row.filename}`] = row.count ?? 0;
    return out;
  },

  // ── Fork lineage (append-only) ──
  async recordAppFork(this: PostgresKyselyStorage, record: AppForkRecord): Promise<void> {
    await this.db.insertInto('AppFork').values({
      id: record.id, sourceOwnerGaii: record.sourceOwnerGaii, sourceOwnerName: record.sourceOwnerName,
      sourceFilename: record.sourceFilename, sourceVersion: record.sourceVersion,
      childOwnerGaii: record.childOwnerGaii, childOwnerName: record.childOwnerName,
      childFilename: record.childFilename, forkedByGaii: record.forkedByGaii, forkedAt: new Date(record.forkedAt),
    }).execute();
  },

  async countAppForks(this: PostgresKyselyStorage, sourceOwnerGaii: string, sourceFilename: string): Promise<number> {
    const r = await this.db.selectFrom('AppFork').select(sql<number>`count(*)`.as('n')).where('sourceOwnerGaii', '=', sourceOwnerGaii).where('sourceFilename', '=', sourceFilename).executeTakeFirst();
    return Number(r?.n ?? 0);
  },

  async countAppForksForApps(this: PostgresKyselyStorage, refs: Array<{ ownerGaii: string; filename: string }>): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const r of refs) out[`${r.ownerGaii} ${r.filename}`] = 0;
    if (refs.length === 0) return out;
    const rows = await this.db.selectFrom('AppFork')
      .select(['sourceOwnerGaii', 'sourceFilename', sql<number>`count(*)`.as('n')])
      .where(eb => eb.or(refs.map(r => eb.and([eb('sourceOwnerGaii', '=', r.ownerGaii), eb('sourceFilename', '=', r.filename)]))))
      .groupBy(['sourceOwnerGaii', 'sourceFilename']).execute();
    for (const row of rows) out[`${row.sourceOwnerGaii} ${row.sourceFilename}`] = Number(row.n ?? 0);
    return out;
  },

  async listAppForks(this: PostgresKyselyStorage, sourceOwnerGaii: string, sourceFilename: string): Promise<AppForkRecord[]> {
    const rows = await this.db.selectFrom('AppFork').selectAll().where('sourceOwnerGaii', '=', sourceOwnerGaii).where('sourceFilename', '=', sourceFilename).orderBy('forkedAt', 'desc').execute();
    return rows.map(toFork);
  },

  // ── Data hygiene sweeps ──
  async normalizeAppOwnerNames(this: PostgresKyselyStorage): Promise<number> {
    // Find rows whose ownerName still carries the `@node` suffix and rewrite each to its bare prefix.
    // Owner names never contain '@', so the split is unambiguous. Idempotent: a second pass finds nothing.
    const rows = await this.db.selectFrom('App').select(['ownerGaii', 'filename', 'versionNumber', 'ownerName']).where('ownerName', 'like', '%@%').execute();
    let count = 0;
    for (const r of rows) {
      const bare = r.ownerName.split('@')[0];
      if (!bare || bare === r.ownerName) continue;
      await this.db.updateTable('App').set({ ownerName: bare }).where('ownerGaii', '=', r.ownerGaii).where('filename', '=', r.filename).where('versionNumber', '=', r.versionNumber).execute();
      count++;
    }
    return count;
  },

  async mergeForkedAppBuckets(this: PostgresKyselyStorage): Promise<number> {
    // Consolidate ownerGaii buckets forked across an owner's identity forms into the owner's canonical
    // GHII bucket. Run AFTER normalizeAppOwnerNames() so grouping by the bare ownerName is reliable.
    let reKeyed = 0;

    // Canonical map: bare ownerName -> GHII bucket key.
    const ghiis = await this.db.selectFrom('Ghii').select(['ownerName', 'ghii']).execute();
    const canonByOwner = new Map<string, string>();
    for (const g of ghiis) if (g.ownerName && g.ghii) canonByOwner.set(g.ownerName, g.ghii);
    if (canonByOwner.size === 0) return 0;

    type AppKeyRow = { ownerGaii: string; ownerName: string; filename: string; versionNumber: number; createdAt: Date | string };
    const rows = await this.db.selectFrom('App').select(['ownerGaii', 'ownerName', 'filename', 'versionNumber', 'createdAt']).execute() as AppKeyRow[];

    // Group by ownerName + filename (only owners we can canonicalize).
    const groups = new Map<string, AppKeyRow[]>();
    for (const r of rows) {
      if (!canonByOwner.has(r.ownerName)) continue;
      const key = `${r.ownerName} ${r.filename}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    for (const [key, groupRows] of groups) {
      const sep = key.indexOf(' ');
      const ownerName = key.slice(0, sep);
      const filename = key.slice(sep + 1);
      const ghii = canonByOwner.get(ownerName)!;

      const strays = groupRows
        .filter(r => r.ownerGaii !== ghii)
        .sort((a, b) => {
          const t = ms(a.createdAt) - ms(b.createdAt);
          return t !== 0 ? t : a.versionNumber - b.versionNumber;
        });
      if (strays.length === 0) continue;

      let maxV = groupRows
        .filter(r => r.ownerGaii === ghii)
        .reduce((m, r) => Math.max(m, r.versionNumber), 0);

      for (const s of strays) {
        maxV += 1;
        await this.db.updateTable('App').set({ ownerGaii: ghii, versionNumber: maxV })
          .where('ownerGaii', '=', s.ownerGaii).where('filename', '=', filename).where('versionNumber', '=', s.versionNumber).execute();
        reKeyed += 1;
      }

      const strayBuckets = [...new Set(strays.map(s => s.ownerGaii))];
      const ssKey = `apps/screenshots/${filename}`;

      // Move one stray screenshot into the canonical bucket if it lacks one, then drop remaining strays.
      const canonSs = await this.db.selectFrom('StorageFile').select('ownerGaii').where('ownerGaii', '=', ghii).where('key', '=', ssKey).executeTakeFirst();
      if (!canonSs) {
        for (const b of strayBuckets) {
          const existing = await this.db.selectFrom('StorageFile').select('ownerGaii').where('ownerGaii', '=', b).where('key', '=', ssKey).executeTakeFirst();
          if (existing) {
            await this.db.updateTable('StorageFile').set({ ownerGaii: ghii }).where('ownerGaii', '=', b).where('key', '=', ssKey).execute();
            break;
          }
        }
      }
      for (const b of strayBuckets) {
        await this.db.deleteFrom('StorageFile').where('ownerGaii', '=', b).where('key', '=', ssKey).execute();
      }

      // Fold stray download counters into the canonical row, then remove them.
      for (const b of strayBuckets) {
        const d = await this.db.selectFrom('AppDownload').select('count').where('ownerGaii', '=', b).where('filename', '=', filename).executeTakeFirst();
        if (d && d.count > 0) {
          await this.db.insertInto('AppDownload')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .values({ ownerGaii: ghii, filename, count: d.count } as any)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .onConflict(oc => oc.columns(['ownerGaii', 'filename']).doUpdateSet({ count: sql`"AppDownload"."count" + ${d.count}` } as any)).execute();
        }
        await this.db.deleteFrom('AppDownload').where('ownerGaii', '=', b).where('filename', '=', filename).execute();
      }
    }
    return reKeyed;
  },
};
