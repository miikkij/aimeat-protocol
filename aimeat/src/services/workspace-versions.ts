/**
 * @file workspace-versions.ts
 * @description Value-free helpers for workspace record VERSION HISTORY (`{base}.version.N` rows).
 *   Every publish appends a full-copy `.version.N` snapshot, so a long-lived record drags an
 *   ever-growing tail of history rows behind it. These helpers let the publish paths work with that
 *   history WITHOUT loading a single historic value: `listVersionRefs` enumerates the (owner, key, N)
 *   addresses via the value-free key-prefix primitive, and `maxVersionOf` yields the next version
 *   number from the key names alone (the old paths loaded every version's full JSON value just to
 *   parse N out of the key).
 * @structure
 *   - VersionRef — one `.version.N` row's address (ownerGaii, key, n)
 *   - versionNumberOf(key, base) — parse the trailing N (null for non-version keys)
 *   - listVersionRefs(storage, base) — value-free enumeration of one record's version rows
 *   - versionRefsByBase(storage, nsPrefix) — ONE value-free namespace scan, grouped per record base
 *   - maxVersionOf(refs) — the highest N (0 when no history)
 * @usage
 *   import { listVersionRefs, maxVersionOf } from '../services/workspace-versions.js';
 *   const refs = await listVersionRefs(storage, base);
 *   const n = maxVersionOf(refs) + 1;
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: value-free version enumeration for the publish maxN scan (P1 of
 *     the workspace-record version/archive performance work).
 */
import type { Storage } from '../storage/interface.js';

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
