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
 * @structure RETURN_MAX_PER_RUN · ReturnResult · returnUntakenFiles
 * @usage const r = await returnUntakenFiles({ storage, config });
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (wish-a-file-store-says-what-it-is-for-so-small-files-stay-in-post).
 */
import { relocateStorageFile, type FileStoreTarget } from '../../storage/blob/file-store-wrap.js';
import { storeTakesFile } from '../../storage/blob/store-takes.js';
import { logger } from '../../utils/logger.js';
import { emitChange } from '../event-bus.js';
import { storeTargetOf } from './file-store-resolver.js';
import type { FileStoreCtx } from './owner-file-store.js';

/** At most this many files move in one run. */
export const RETURN_MAX_PER_RUN = 20000;
const PAGE = 500;

export interface ReturnResult { storeId: string; checked: number; moved: number; failed: number; error?: string }

/** Move the files every store holds and does not take back to the database. Answers one line per store. */
export async function returnUntakenFiles(ctx: FileStoreCtx, opts: {
  maxMoves?: number;
  /** The store an id names; storeTargetOf, unless a test gives a store of its own. */
  targetOf?: (storeId: string) => Promise<FileStoreTarget | null>;
} = {}): Promise<ReturnResult[]> {
  const budget = { left: Math.max(1, opts.maxMoves ?? RETURN_MAX_PER_RUN) };
  const targetOf = opts.targetOf ?? ((id: string) => storeTargetOf(ctx, id));
  const places = (await ctx.storage.countStorageFilesByStore()).filter(p => p.store !== 'database' && p.count > 0);
  const results: ReturnResult[] = [];
  for (const place of places) {
    if (budget.left <= 0) break;
    const r: ReturnResult = { storeId: place.store, checked: 0, moved: 0, failed: 0 };
    results.push(r);
    try {
      const target = await targetOf(place.store);
      if (!target?.takes) { r.error = target ? 'takes every file' : 'not reachable from this node'; continue; }
      let after: { ownerGaii: string; key: string } | undefined;
      for (;;) {
        const page = await ctx.storage.listStorageFilesIn({ store: place.store, limit: PAGE, ...(after ? { after } : {}) });
        for (const f of page) {
          r.checked++;
          if (storeTakesFile(target.takes, f.size, f.mimeType)) continue;
          if (budget.left <= 0) break;
          budget.left--;
          try {
            if (await relocateStorageFile(ctx.storage, f.ownerGaii, f.key, null) === 'moved') r.moved++;
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
  return results;
}
