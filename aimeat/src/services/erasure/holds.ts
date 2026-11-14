/**
 * @file src/services/erasure/holds.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The accounts whose erasure runs now, and the storage writes in progress, as one
 *   in-process write buffer keeps them.
 *
 *   WHY. A write buffer takes a row on a request and writes it later. The erasure cascade
 *   (services/owner-erasure.ts) deletes the account's rows in the tables those buffers write, so a
 *   row that waited in a buffer, or was being written, when the erasure ran was stored after it:
 *   the erased person came back in the table (register finding f-2026-11-13-write-buffers-and-erasure).
 *   Each buffer holds the account for the length of the erasure: it lets its writes in progress
 *   answer first (writesSettled), drops the account's waiting rows, and keeps no new row of the
 *   account (covers) until the erasure releases it.
 *
 *   WHOSE ROW. An account is its person (the GHII and the bare account name) and everything acting
 *   in their name: an agent (`claude#alice@node`) and an ecosystem app (`eco:x#alice@node`), both of
 *   which ownerGhiiOf takes to the GHII.
 *
 *   PROCESS-LOCAL, as the buffer is. A buffer's waiting rows live in one process, and so do its holds
 *   and its writes in progress. The erasure runs in the process that serves DELETE /v1/owners/:name,
 *   so another process's buffer keeps its own rows of the account (the same limit the classification
 *   audit names in services/classification/audit.ts).
 * @structure ErasedAccount · ErasureHolds (hold → release, covers, track, writesSettled,
 *   currentWritesSettled, static isOf)
 * @usage
 *   const erasing = new ErasureHolds();
 *   await erasing.track(storage.addRows(batch));           // a buffer's write
 *   const release = erasing.hold({ name: 'alice', ghii: 'alice@node' });
 *   await erasing.writesSettled();                          // then drop the waiting rows
 *   if (erasing.covers(row.ownerGaii)) return;              // a new row of the account
 *   release();                                              // after the cascade
 * @version-history
 *   v1.1.0 — 2026-11-14 — currentWritesSettled, for the write-time classification queue.
 *   v1.0.0 — 2026-11-14 — Initial.
 */
import { ownerGhiiOf } from '../../utils/gaii.js';

/** The account an erasure removes: its bare name and its GHII on this node. */
export interface ErasedAccount { name: string; ghii: string }

/** True when `identity` is the account or acts in its name. */
function isOf(identity: string, account: ErasedAccount): boolean {
  return identity === account.name || identity === account.ghii || ownerGhiiOf(identity) === account.ghii;
}

/** One buffer's erasures in progress and its storage writes in progress. */
export class ErasureHolds {
  private readonly held = new Set<ErasedAccount>();
  private readonly writes = new Set<Promise<unknown>>();

  /** Hold `account` until the returned function is called. Two holds of one account are two entries. */
  hold(account: ErasedAccount): () => void {
    const entry = { ...account };
    this.held.add(entry);
    return () => { this.held.delete(entry); };
  }

  /** True when `identity` is an account held now, or acts in its name. */
  covers(identity: string | null | undefined): boolean {
    if (!identity || this.held.size === 0) return false;
    for (const account of this.held) if (isOf(identity, account)) return true;
    return false;
  }

  /** A storage write of the buffer, answered as it comes; an erasure waits for it (writesSettled). */
  track<T>(write: Promise<T>): Promise<T> {
    this.writes.add(write);
    const done = (): void => { this.writes.delete(write); };
    write.then(done, done);
    return write;
  }

  /** Answer when every write tracked so far, and every write those started, has answered. */
  async writesSettled(): Promise<void> {
    while (this.writes.size > 0) await Promise.allSettled([...this.writes]);
  }

  /**
   * Answer when the writes in progress now have answered, and no later one. For a queue that keeps
   * working through other accounts' items while the erasure waits: once the account is held, none
   * of its items starts, so only one already started can be the account's.
   */
  async currentWritesSettled(): Promise<void> {
    await Promise.allSettled([...this.writes]);
  }

  /** True when `identity` is `account` or acts in its name, whether held or not. */
  static isOf(identity: string | null | undefined, account: ErasedAccount): boolean {
    return !!identity && isOf(identity, account);
  }
}
