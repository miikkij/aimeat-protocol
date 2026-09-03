/**
 * @file services/memory-bin-sweep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The hand that makes "delete" mean delete.
 *
 *   THE NODE HAD NO DELETE AT ALL UNTIL 2026-09-03, on purpose: a value could be emptied but never
 *   removed, so nothing could be lost by accident. The cost was real — an agent could write memory
 *   through a tool and never clean up after itself, and `memory:delete` was a permission an owner
 *   could grant that reached no tool anywhere. The delete that replaced that principle keeps its
 *   spirit by being undoable for `memoryDeleteGraceDays`, and this is what closes the window.
 *
 *   WITHOUT THIS FILE THE FEATURE IS A LIE. A bin nothing empties is not a delete, it is a rename:
 *   the record stays on disk for ever, the storage bill grows and the word on the button promises
 *   something the system never does. That is the shape this project has been fixing all week — a
 *   permission enforced on no door, a flag no reader reads, a version number describing code it did
 *   not contain — so the sweeper ships in the same commit as the button, not after it.
 *
 *   IT IS THE ONLY CALLER OF purgeDeletedMemory, and that is the only call in the memory path that
 *   destroys anything. Everything else either hides a row or puts it back.
 * @structure sweepMemoryBin(storage, config)
 * @usage started by server-bootstrap/service-init.ts on a timer
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial, with the delete it exists to complete.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/**
 * Remove everything that has been in the bin longer than the grace window.
 *
 * A grace of 0 means the operator chose an immediate, final delete. The route already writes the
 * tombstone, so the sweep still has to run — it is what turns that tombstone into a removal — and
 * the cutoff is simply now.
 *
 * Never throws: it runs on a timer with nobody watching, and a failed sweep must leave the node
 * alone rather than take a boot path down with it. The count is logged whenever it is not zero,
 * because "how much did the bin actually release" is the one number an operator asks for.
 */
export async function sweepMemoryBin(storage: Storage, config: AimeatConfig): Promise<number> {
  const graceMs = Math.max(0, config.memoryDeleteGraceDays) * 86_400_000;
  const cutoff = new Date(Date.now() - graceMs).toISOString();
  try {
    const removed = await storage.purgeDeletedMemory(cutoff);
    if (removed > 0) {
      logger.info('memory bin: records past the grace window removed for good', {
        event: 'memory.bin.swept', removed, cutoff, graceDays: config.memoryDeleteGraceDays,
      });
    }
    return removed;
  } catch (err) {
    logger.warn('memory bin sweep failed', { error: String(err) });
    return 0;
  }
}
