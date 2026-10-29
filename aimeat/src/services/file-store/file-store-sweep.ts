/**
 * @file src/services/file-store/file-store-sweep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Removes the objects in a file store that no stored file names any more. That is how the
 *   bytes of an erased account leave a store: its rows go by a cascade inside each database provider
 *   that never passes through the storage wrapper, and the next sweep finds every object they named.
 *   It also removes what a failed removal left (a re-upload whose old object could not be deleted).
 *
 *   ONLY ITS OWN FOLDER, ONLY OLD OBJECTS. A sweep lists the store's prefix and nothing else, so it
 *   never touches what someone keeps beside the node's files in the same bucket; a store with no
 *   prefix is not swept at all. An object younger than a day is left alone, because a write puts the
 *   object before the row that names it, and a sweep between the two must not take it.
 * @structure SweepResult · sweepStore · sweepFileStores · SWEEP_MIN_AGE_MS
 * @usage scheduler.registerCoreHandler('file-store-sweep', () => sweepFileStores({ storage, config }));
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { formatBlobRef, nodeStoreId, ownerStoreId, type BlobStore } from '../../storage/blob/blob-types.js';
import { logger } from '../../utils/logger.js';
import { nodeStoreSpec, storeFor } from './file-store-specs.js';
import { listOwnerStores, ownerStoreSpec, type FileStoreCtx } from './owner-file-store.js';

/** A day: an object this young may be one whose row is still being written. */
export const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface SweepResult { storeId: string; listed: number; removed: number; error?: string }

export async function sweepStore(
  ctx: FileStoreCtx, storeId: string, store: BlobStore, prefix: string,
  opts: { now?: number; minAgeMs?: number } = {},
): Promise<SweepResult> {
  const result: SweepResult = { storeId, listed: 0, removed: 0 };
  if (!prefix) return { ...result, error: 'no folder set, so the store is not swept' };
  const now = opts.now ?? Date.now();
  const minAge = opts.minAgeMs ?? SWEEP_MIN_AGE_MS;
  let next: string | undefined;
  do {
    const page = await store.list(prefix, next);
    next = page.next;
    result.listed += page.objects.length;
    const old = page.objects.filter(o => !o.lastModified || now - Date.parse(o.lastModified) >= minAge);
    if (old.length === 0) continue;
    const held = new Set(await ctx.storage.storageFileBlobRefsIn(old.map(o => formatBlobRef(storeId, o.key))));
    for (const o of old) {
      if (held.has(formatBlobRef(storeId, o.key))) continue;
      await store.delete(o.key);
      result.removed++;
    }
  } while (next);
  return result;
}

/** Sweep the node's stores (each kind whose settings are complete) and every store a person connected. */
export async function sweepFileStores(ctx: FileStoreCtx, opts: { now?: number; minAgeMs?: number } = {}): Promise<SweepResult[]> {
  const targets: { storeId: string; store: BlobStore; prefix: string }[] = [];
  for (const kind of ['s3', 'azure'] as const) {
    const r = nodeStoreSpec(ctx.config, kind);
    if ('spec' in r) targets.push({ storeId: nodeStoreId(kind), store: storeFor(r.spec, 'trusted'), prefix: r.prefix });
  }
  for (const rec of await listOwnerStores(ctx)) {
    const spec = ownerStoreSpec(ctx.config, rec);
    if (spec) targets.push({ storeId: ownerStoreId(`${rec.owner}@${ctx.config.nodeId}`), store: storeFor(spec, 'guarded', ctx.config), prefix: rec.prefix });
  }
  const results: SweepResult[] = [];
  for (const t of targets) {
    try {
      results.push(await sweepStore(ctx, t.storeId, t.store, t.prefix, opts));
    } catch (err) {
      results.push({ storeId: t.storeId, listed: 0, removed: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  for (const r of results) {
    if (r.error) logger.warn(`[file-store-sweep] ${r.storeId}: ${r.error}`);
    else if (r.removed > 0) logger.info(`[file-store-sweep] ${r.storeId}: removed ${r.removed} object(s) no file names, of ${r.listed} listed`);
  }
  return results;
}
