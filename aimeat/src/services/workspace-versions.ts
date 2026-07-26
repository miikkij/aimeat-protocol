/**
 * @file workspace-versions.ts
 * @description Value-free helpers for workspace record VERSION HISTORY (`{base}.version.N` rows).
 *   Every publish appends a full-copy `.version.N` snapshot, so a long-lived record drags an
 *   ever-growing tail of history rows behind it. These helpers let the publish paths work with that
 *   history WITHOUT loading a single historic value: `listVersionRefs` enumerates the (owner, key, N)
 *   addresses via the value-free key-prefix primitive, and `maxVersionOf` yields the next version
 *   number from the key names alone (the old paths loaded every version's full JSON value just to
 *   parse N out of the key).
 *   RETENTION: `effectiveMaxVersions` resolves the per-space history window (manifest objectType
 *   `maxVersions` → node default `workspaceMaxVersions` / AIMEAT_WS_MAX_VERSIONS; 0 = keep all;
 *   append-only `create_only` spaces are NEVER pruned), `versionRefsToPrune` picks the rows that
 *   fall outside the window after a publish, and `compactWorkspaceVersions` is the one-shot
 *   maintenance sweep that applies the same window to EXISTING bloat (admin route + core job).
 * @structure
 *   - VersionRef — one `.version.N` row's address (ownerGaii, key, n)
 *   - versionNumberOf(key, base) — parse the trailing N (null for non-version keys)
 *   - listVersionRefs(storage, base) — value-free enumeration of one record's version rows
 *   - versionRefsByBase(storage, nsPrefix) — ONE value-free namespace scan, grouped per record base
 *   - maxVersionOf(refs) — the highest N (0 when no history)
 *   - effectiveMaxVersions(config, ot) — the retention window for a space (0 = keep all)
 *   - versionRefsToPrune(refs, publishedN, window) — rows outside the window
 *   - pruneVersionsAfterPublish(storage, config, opts) — best-effort prune after ONE publish
 *   - compactWorkspaceVersions(storage, config, opts?) — one-shot sweep over existing history
 * @usage
 *   import { listVersionRefs, maxVersionOf } from '../services/workspace-versions.js';
 *   const refs = await listVersionRefs(storage, base);
 *   const n = maxVersionOf(refs) + 1;
 * @version-history
 *   v1.1.0 — 2026-07-16 — Retention (P2): per-space maxVersions window pruned on publish +
 *     compactWorkspaceVersions one-shot sweep. Append-only (create_only) spaces are never pruned;
 *     a workspace whose manifest cannot be found is skipped entirely (fail-safe).
 *   v1.0.0 — 2026-07-16 — Initial: value-free version enumeration for the publish maxN scan (P1 of
 *     the workspace-record version/archive performance work).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { parseWorkspaceRecordKey } from './write-guards.js';
import { logger } from '../utils/logger.js';

/** The address of one `.version.N` history row — no value loaded. */
export interface VersionRef {
  ownerGaii: string;
  key: string;
  /** The parsed version number N. */
  n: number;
}

/** Parse the trailing N of `{base}.version.N`; null when `key` is not a version row of `base`
 *  (including `{base}.version.notanumber` and any deeper suffix). */
export function versionNumberOf(key: string, base: string): number | null {
  const prefix = `${base}.version.`;
  if (!key.startsWith(prefix)) return null;
  const s = key.slice(prefix.length);
  return /^\d+$/.test(s) ? parseInt(s, 10) : null;
}

/** VALUE-FREE list of one record's `.version.N` rows (active rows only — matching the default
 *  archive filter the old value-loading scan used). Uses the key-prefix address primitive when the
 *  backend has it; the fallback loads values (correct, just slower — no current backend needs it). */
export async function listVersionRefs(storage: Storage, base: string): Promise<VersionRef[]> {
  const prefix = `${base}.version.`;
  const addrs: Array<{ ownerGaii: string; key: string }> = storage.listMemoryKeysByPrefix
    ? await storage.listMemoryKeysByPrefix(prefix)
    : (await storage.listAllMemory({ prefix, limit: 10_000 })).items;
  const out: VersionRef[] = [];
  for (const a of addrs) {
    const n = versionNumberOf(a.key, base);
    if (n !== null) out.push({ ownerGaii: a.ownerGaii, key: a.key, n });
  }
  return out;
}

/** ONE value-free scan of a whole namespace's version rows, grouped by record base
 *  (`{nsPrefix}{instance}`) — the batch-publish amortisation of {@link listVersionRefs}. */
export async function versionRefsByBase(storage: Storage, nsPrefix: string): Promise<Map<string, VersionRef[]>> {
  const addrs: Array<{ ownerGaii: string; key: string }> = storage.listMemoryKeysByPrefix
    ? await storage.listMemoryKeysByPrefix(nsPrefix)
    : (await storage.listAllMemory({ prefix: nsPrefix, limit: 100_000 })).items;
  const byBase = new Map<string, VersionRef[]>();
  for (const a of addrs) {
    // `{nsPrefix}{instance}.version.{N}` — split on the LAST '.version.' so an instance id that
    // happens to contain '.version.' cannot shift the base boundary.
    const i = a.key.lastIndexOf('.version.');
    if (i <= nsPrefix.length - 1) continue;
    const base = a.key.slice(0, i);
    const n = versionNumberOf(a.key, base);
    if (n === null) continue;
    const arr = byBase.get(base) ?? [];
    arr.push({ ownerGaii: a.ownerGaii, key: a.key, n });
    byBase.set(base, arr);
  }
  return byBase;
}

/** The highest version number among the refs — 0 when the record has no history yet. */
export function maxVersionOf(refs: VersionRef[]): number {
  let max = 0;
  for (const r of refs) if (r.n > max) max = r.n;
  return max;
}

// ── Retention (P2) ───────────────────────────────────────────────────────────

/** The manifest objectType fields retention consults. */
export interface RetentionObjType {
  create_only?: unknown;
  maxVersions?: unknown;
  versioned?: unknown;
}

/**
 * The retention window for a space: how many `.version.N` snapshots to keep per record.
 * - `create_only` (append-only) spaces → 0 (NEVER pruned — their history is the record).
 * - A finite non-negative `maxVersions` on the objectType overrides per space (0 = keep all).
 * - Otherwise the node default `workspaceMaxVersions` (AIMEAT_WS_MAX_VERSIONS; 0/negative = keep all).
 * Returns 0 for "keep everything".
 */
export function effectiveMaxVersions(config: Pick<AimeatConfig, 'workspaceMaxVersions'>, ot?: RetentionObjType | null): number {
  if (ot?.create_only === true) return 0;
  const m = ot?.maxVersions;
  if (typeof m === 'number' && Number.isFinite(m) && m >= 0) return Math.floor(m);
  return config.workspaceMaxVersions > 0 ? Math.floor(config.workspaceMaxVersions) : 0;
}

/** The refs that fall OUTSIDE the window once version `publishedN` exists: keep
 *  `publishedN-window+1 … publishedN` (the window includes the just-published snapshot), prune the
 *  rest. Empty when window <= 0 (keep all). */
export function versionRefsToPrune(refs: VersionRef[], publishedN: number, window: number): VersionRef[] {
  if (window <= 0) return [];
  return refs.filter(r => r.n <= publishedN - window);
}

/**
 * Best-effort history prune after ONE publish: deletes the `.version.N` rows outside the space's
 * retention window. `refs` is the PRE-publish enumeration the caller already holds (it never includes
 * the snapshot just written). Never throws — a prune failure must not fail the publish that succeeded.
 * Returns the number of rows pruned.
 */
export async function pruneVersionsAfterPublish(
  storage: Storage,
  config: Pick<AimeatConfig, 'workspaceMaxVersions'>,
  opts: { refs: VersionRef[]; publishedN: number; ot?: RetentionObjType | null },
): Promise<number> {
  try {
    const window = effectiveMaxVersions(config, opts.ot);
    const doomed = versionRefsToPrune(opts.refs, opts.publishedN, window);
    if (!doomed.length) return 0;
    if (storage.bulkDeleteMemory) return await storage.bulkDeleteMemory(doomed.map(r => ({ ownerGaii: r.ownerGaii, key: r.key })));
    let removed = 0;
    for (const r of doomed) if (await storage.deleteMemory(r.ownerGaii, r.key)) removed++;
    return removed;
  } catch (err) {
    logger.warn(`Workspace version prune failed (publish succeeded): ${(err as Error).message}`);
    return 0;
  }
}

export interface CompactionResult {
  /** `.version.N` rows enumerated (active rows, value-free). */
  versionRowsScanned: number;
  /** Rows deleted. */
  pruned: number;
  /** Record instances that lost at least one history row. */
  recordsPruned: number;
  /** Workspaces whose manifest could not be read — skipped entirely (fail-safe: without the
   *  manifest we cannot know a space is append-only). */
  workspacesSkipped: number;
}

/**
 * ONE-SHOT compaction of EXISTING version bloat: applies the same retention window the publish path
 * now enforces to every workspace record's accumulated `.version.N` history. Value-free scan
 * (addresses only); per (org, ws) the manifest is read ONCE and each namespace's objectType decides
 * the window (`create_only` → skip, `maxVersions` override, else the node default). A workspace
 * whose manifest is missing/unreadable is SKIPPED entirely — never prune what we cannot classify.
 * Only active rows are touched (archived history stays in the archive). Optionally scoped to one
 * organism. Exposed via POST /v1/admin/maintenance/compact-workspace-versions and the
 * `workspace-version-compaction` core job handler.
 */
export async function compactWorkspaceVersions(
  storage: Storage,
  config: Pick<AimeatConfig, 'workspaceMaxVersions'>,
  opts?: { organismId?: string },
): Promise<CompactionResult> {
  const prefix = opts?.organismId ? `organism.${opts.organismId}.` : 'organism.';
  const byBase = await versionRefsByBase(storage, prefix);
  const result: CompactionResult = { versionRowsScanned: 0, pruned: 0, recordsPruned: 0, workspacesSkipped: 0 };
  for (const refs of byBase.values()) result.versionRowsScanned += refs.length;

  // Manifest cache: ONE read per (org, ws). null = missing/unreadable → skip that workspace.
  type Manifest = { objectTypes?: Array<RetentionObjType & { namespace?: unknown }> };
  const manifests = new Map<string, Manifest | null>();
  const skippedWs = new Set<string>();
  const readManifest = async (orgId: string, ws: string): Promise<Manifest | null> => {
    const cacheKey = `${orgId} ${ws}`;
    if (manifests.has(cacheKey)) return manifests.get(cacheKey) ?? null;
    let man: Manifest | null;
    try {
      const mkey = `organism.${orgId}.w.${ws}.meta.manifest`;
      const { items } = await storage.listAllMemory({ prefix: mkey, limit: 10 });
      man = (items.find(r => r.key === mkey)?.value as Manifest | undefined) ?? null;
    } catch (err) {
      // Caching the null is deliberate (see above: unreadable == skip this workspace), but the read
      // failure itself must be visible — otherwise a transient error is indistinguishable from a
      // workspace that genuinely declares no manifest.
      logger.warn('workspace manifest unreadable; treating the workspace as having none', { orgId, ws, error: String(err) });
      man = null;
    }
    manifests.set(cacheKey, man);
    return man;
  };

  const doomed: Array<{ ownerGaii: string; key: string }> = [];
  for (const [base, refs] of byBase) {
    // Classify via the shared key parser (`.latest` is a valid role probe). Records outside the
    // organism.{id}.w.{ws}.* convention (e.g. legacy org-level records) are left untouched.
    const parts = parseWorkspaceRecordKey(`${base}.latest`);
    if (!parts) continue;
    const man = await readManifest(parts.organismId, parts.ws);
    if (!man) { skippedWs.add(`${parts.organismId}/${parts.ws}`); continue; }
    const ot = (man.objectTypes ?? []).find(o => o?.namespace === parts.namespace) ?? null;
    const window = effectiveMaxVersions(config, ot);
    if (window <= 0) continue;   // keep-all (or append-only)
    const cut = versionRefsToPrune(refs, maxVersionOf(refs), window);
    if (!cut.length) continue;
    result.recordsPruned++;
    for (const r of cut) doomed.push({ ownerGaii: r.ownerGaii, key: r.key });
  }
  result.workspacesSkipped = skippedWs.size;

  for (let i = 0; i < doomed.length; i += 500) {
    const chunk = doomed.slice(i, i + 500);
    if (storage.bulkDeleteMemory) result.pruned += await storage.bulkDeleteMemory(chunk);
    else for (const r of chunk) { if (await storage.deleteMemory(r.ownerGaii, r.key)) result.pruned++; }
  }
  if (result.pruned > 0) {
    logger.info(`Workspace version compaction: pruned ${result.pruned} of ${result.versionRowsScanned} history rows across ${result.recordsPruned} records${result.workspacesSkipped ? ` (${result.workspacesSkipped} workspaces skipped: no readable manifest)` : ''}`);
  }
  return result;
}
