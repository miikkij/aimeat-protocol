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
 *
 *   EVERY STORE OF THE SAME BUCKET COUNTS. Two stores may name one bucket (the environment's and a
 *   named one an operator added for the same container, or a person's two folders), and one folder may
 *   lie inside another. An object is kept when a row names it under ANY store id of its bucket, so the
 *   sweep of one store never takes the objects of another.
 * @structure SweepResult · SweepTarget · sweepStore · sweepFileStores · SWEEP_MIN_AGE_MS
 * @usage scheduler.registerCoreHandler('file-store-sweep', () => sweepFileStores({ storage, config }));
 * @version-history
 *   v1.1.0 — 2026-10-30 — Sweeps the named node stores and every store of every person, and keeps an
 *     object a sibling store of the same bucket names (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { formatBlobRef, nodeStoreId, type BlobStore } from '../../storage/blob/blob-types.js';
import { logger } from '../../utils/logger.js';
import { nodeStoreSpec, storeFor } from './file-store-specs.js';
import { listOwnerStores, ownerStoreSpec, type FileStoreCtx } from './owner-file-store.js';
import { nodeEntrySpec, nodeEntryStoreId, readNodeStores } from './node-file-stores.js';
import { placeKey, targetOfSpec } from './store-target.js';

/** A day: an object this young may be one whose row is still being written. */
export const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface SweepResult { storeId: string; listed: number; removed: number; error?: string }

export interface SweepTarget { storeId: string; store: BlobStore; prefix: string; place: string }

/**
 * Remove the old objects under `prefix` that no row names. `siblings` are the store ids a row of the
 * same bucket may name an object by; the store's own id is always one of them.
 */
export async function sweepStore(
  ctx: FileStoreCtx, storeId: string, store: BlobStore, prefix: string,
  opts: { now?: number; minAgeMs?: number; siblings?: readonly string[] } = {},
): Promise<SweepResult> {
  const result: SweepResult = { storeId, listed: 0, removed: 0 };
  if (!prefix) return { ...result, error: 'no folder set, so the store is not swept' };
  const now = opts.now ?? Date.now();
  const minAge = opts.minAgeMs ?? SWEEP_MIN_AGE_MS;
  const ids = [...new Set([storeId, ...(opts.siblings ?? [])])];
  let next: string | undefined;
  do {
    const page = await store.list(prefix, next);
    next = page.next;
    result.listed += page.objects.length;
    const old = page.objects.filter(o => !o.lastModified || now - Date.parse(o.lastModified) >= minAge);
    if (old.length === 0) continue;
    const held = new Set(await ctx.storage.storageFileBlobRefsIn(old.flatMap(o => ids.map(id => formatBlobRef(id, o.key)))));
    for (const o of old) {
      if (ids.some(id => held.has(formatBlobRef(id, o.key)))) continue;
      await store.delete(o.key);
      result.removed++;
    }
  } while (next);
  return result;
}

/**
 * Every store this node knows: the environment's (each kind whose settings are complete), the named
 * node stores, and every store a person connected. `places` holds them all; `targets` only those whose
 * key opens here, the ones a sweep can list. A store whose key does not open still counts as a
 * sibling, so its objects are never taken by the sweep of another store of its bucket.
 */
async function allStores(ctx: FileStoreCtx): Promise<{ targets: SweepTarget[]; places: { storeId: string; place: string }[] }> {
  const targets: SweepTarget[] = [];
  const places: { storeId: string; place: string }[] = [];
  const add = (storeId: string, place: string, store: BlobStore | null, prefix: string) => {
    places.push({ storeId, place });
    if (store) targets.push({ storeId, store, prefix, place });
  };
  for (const kind of ['s3', 'azure'] as const) {
    const r = nodeStoreSpec(ctx.config, kind);
    if ('spec' in r) add(nodeStoreId(kind), placeKey(targetOfSpec(r.spec)), storeFor(r.spec, 'trusted'), r.prefix);
  }
  for (const entry of (await readNodeStores(ctx)).stores) {
    const spec = nodeEntrySpec(ctx.config, entry);
    add(nodeEntryStoreId(entry.name), placeKey(entry.target), spec && storeFor(spec, 'trusted'), entry.prefix);
  }
  for (const rec of await listOwnerStores(ctx)) {
    for (const entry of rec.stores) {
      const spec = ownerStoreSpec(ctx.config, rec.owner, entry);
      add(entry.storeId, placeKey(entry.target), spec && storeFor(spec, 'guarded', ctx.config), entry.prefix);
    }
  }
  return { targets, places };
}

/** Sweep every store, each with the ids of the stores that share its bucket. */
export async function sweepFileStores(ctx: FileStoreCtx, opts: { now?: number; minAgeMs?: number } = {}): Promise<SweepResult[]> {
  const { targets, places } = await allStores(ctx);
  const byPlace = new Map<string, string[]>();
  for (const p of places) byPlace.set(p.place, [...(byPlace.get(p.place) ?? []), p.storeId]);
  const results: SweepResult[] = [];
  for (const t of targets) {
    try {
      results.push(await sweepStore(ctx, t.storeId, t.store, t.prefix, { ...opts, siblings: byPlace.get(t.place) }));
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
