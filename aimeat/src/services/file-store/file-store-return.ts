/**
 * @file src/services/file-store/file-store-return.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Moves a file a store holds, and would not take now, back to the node's database: a
 *   store says which files it is for (storage/blob/store-takes.ts), and a file it is not for keeps its
 *   bytes in the database. That covers the files written before a store had a rule (every file went to
 *   the default store whatever its size; one account's container held about 9200 files under one
 *   kilobyte) and the files a store holds after its rule was narrowed.
 *
 *   BY ITSELF. It runs once when the node starts and with the daily file store sweep (core-jobs.ts), so
 *   an operator runs nothing. Each run moves at most RETURN_MAX_PER_RUN files and the next run goes on.
 *   A move keeps the file's key, owner, visibility, tags and provenance; only where its bytes live
 *   changes (relocateStorageFile, which leaves a file alone that changed while it was being moved).
 *
 *   A store this node can no longer reach is passed over: its files cannot be read to be moved.
 *
 *   THE DATABASE'S CEILINGS HOLD. A file over the per-file ceiling (storageMaxFileSizeMb) stays in its
 *   store, and so does a file from a person's own store that would take them past their storage quota
 *   (storageQuotaMb): a file in a person's own store never counted toward that quota, and the person
 *   can set their store's rule so that it takes nothing under 10 GB. A file kept this way stays
 *   readable where it is; the run counts it (`kept`) and logs which setting to raise to move it.
 * @structure RETURN_MAX_PER_RUN · ReturnResult · returnUntakenFiles
 * @usage const r = await returnUntakenFiles({ storage, config });
 * @version-history
 *   v1.0.1 — 2026-11-08 — The per-file ceiling and, for a person's own store, the storage quota decide
 *     whether a file comes into the database (secaudit2026nov08b round 15,
 *     file-store/relocate-to-database-without-file-or-quota-ceiling).
 *   v1.0.0 — 2026-11-08 — Initial (wish-a-file-store-says-what-it-is-for-so-small-files-stay-in-post).
 */
import { relocateStorageFile, type FileStoreTarget } from '../../storage/blob/file-store-wrap.js';
import { storeTakesFile } from '../../storage/blob/store-takes.js';
import { logger } from '../../utils/logger.js';
import { emitChange } from '../event-bus.js';
import { getStorageTotalBytes } from '../quota.js';
import { storeTargetOf } from './file-store-resolver.js';
import type { FileStoreCtx } from './owner-file-store.js';

/** At most this many files move in one run. */
export const RETURN_MAX_PER_RUN = 20000;
const PAGE = 500;
const MB = 1024 * 1024;

export interface ReturnResult {
  storeId: string; checked: number; moved: number; failed: number;
  /** Files the store does not take that stay in it, because the database's ceilings would not hold
   *  them. Present only when there are some. */
  kept?: number;
  error?: string;
}

/** A setting in megabytes as bytes; Infinity when the config has no such number. */
const mbSetting = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v * MB : Infinity);

/** Move the files every store holds and does not take back to the database. Answers one line per store. */
export async function returnUntakenFiles(ctx: FileStoreCtx, opts: {
  maxMoves?: number;
  /** The store an id names; storeTargetOf, unless a test gives a store of its own. */
  targetOf?: (storeId: string) => Promise<FileStoreTarget | null>;
} = {}): Promise<ReturnResult[]> {
  const budget = { left: Math.max(1, opts.maxMoves ?? RETURN_MAX_PER_RUN) };
  const targetOf = opts.targetOf ?? ((id: string) => storeTargetOf(ctx, id));
  const places = (await ctx.storage.countStorageFilesByStore()).filter(p => p.store !== 'database' && p.count > 0);
  const perFile = mbSetting(ctx.config?.storageMaxFileSizeMb);
  const quota = mbSetting(ctx.config?.storageQuotaMb);
  // The bytes each owner keeps in the database, read once per owner and run and grown by each move.
  const used = new Map<string, number>();
  const results: ReturnResult[] = [];
  for (const place of places) {
    if (budget.left <= 0) break;
    const r: ReturnResult = { storeId: place.store, checked: 0, moved: 0, failed: 0 };
    results.push(r);
    // A file in a person's own store is outside their quota (quota.ts getStorageTotalBytes); one in
    // the node's store is counted already, so only the per-file ceiling applies to it.
    const ownStore = place.store.startsWith('owner:');
    const keep = () => { r.kept = (r.kept ?? 0) + 1; };
    try {
      const target = await targetOf(place.store);
      if (!target?.takes) { r.error = target ? 'takes every file' : 'not reachable from this node'; continue; }
      let after: { ownerGaii: string; key: string } | undefined;
      for (;;) {
        const page = await ctx.storage.listStorageFilesIn({ store: place.store, limit: PAGE, ...(after ? { after } : {}) });
        for (const f of page) {
          r.checked++;
          if (storeTakesFile(target.takes, f.size, f.mimeType)) continue;
          let room = perFile;
          let inDatabase = 0;
          if (ownStore && quota !== Infinity) {
            inDatabase = used.get(f.ownerGaii) ?? await getStorageTotalBytes(ctx.storage, f.ownerGaii);
            used.set(f.ownerGaii, inDatabase);
            room = Math.min(room, quota - inDatabase);
          }
          if (f.size > room) { keep(); continue; }
          if (budget.left <= 0) break;
          budget.left--;
          try {
            const out = await relocateStorageFile(ctx.storage, f.ownerGaii, f.key, null, room === Infinity ? {} : { maxDatabaseBytes: room });
            if (out === 'moved') {
              r.moved++;
              if (ownStore) used.set(f.ownerGaii, inDatabase + f.size);
            } else if (out === 'too-large') keep();
          } catch (err) {
            r.failed++;
            logger.warn('file store: a file the store does not take could not be moved to the database; the next run tries again', {
              storeId: place.store, owner: f.ownerGaii, key: f.key, error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        if (page.length < PAGE || budget.left <= 0) break;
        const last = page[page.length - 1];
        after = { ownerGaii: last.ownerGaii, key: last.key };
      }
    } catch (err) {
      r.error = err instanceof Error ? err.message : String(err);
    }
  }
  const moved = results.reduce((a, r) => a + r.moved, 0);
  if (moved > 0) {
    emitChange('file-store');
    logger.info('file store: files the stores do not take were moved to the database', { moved, results });
  }
  const kept = results.reduce((a, r) => a + (r.kept ?? 0), 0);
  if (kept > 0) {
    logger.info('file store: files the stores do not take stay in them, because the database would pass a ceiling. '
      + 'To move them, raise storageMaxFileSizeMb (quota.storage_max_file_size_mb, the largest file the database keeps) '
      + 'or, for a person\'s own store, storageQuotaMb (quota.storage_mb, each account\'s storage in the database)', {
      kept, results: results.filter(r => r.kept),
    });
  }
  return results;
}
