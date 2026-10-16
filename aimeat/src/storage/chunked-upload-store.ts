/**
 * @file src/storage/chunked-upload-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The chunked upload sessions, with ONE expiry rule for both storage providers.
 *
 *   A session and its chunks' bytes live in the node process until the upload completes or is
 *   aborted. Each provider kept its own Map: PostgreSQL never read `expiresAt`, so an abandoned
 *   upload held its bytes until the process restarted, and SQLite deleted an expired session only
 *   when that same id was asked for again, so nothing ever swept the rest (QA audit F05b-02). This
 *   store is the one both providers hold: every read honours the expiry, every new session first
 *   sweeps the expired ones, and the route can ask how many sessions and bytes one principal holds
 *   before it accepts more.
 * @structure ChunkedUploadStore (create · get · addChunk · delete · sweep · heldBy)
 * @usage readonly chunkedUploads = new ChunkedUploadStore();  // in each provider
 * @version-history
 *   2026-10-16 — Initial (QA audit F05b-02).
 */
import type { ChunkedUploadRecord } from './interface.js';

export class ChunkedUploadStore {
  private readonly sessions = new Map<string, ChunkedUploadRecord>();

  private static expired(r: ChunkedUploadRecord, now: number): boolean {
    return new Date(r.expiresAt).getTime() < now;
  }

  /** Remove every expired session and its bytes; returns how many went. */
  sweep(now = Date.now()): number {
    let removed = 0;
    for (const [id, r] of this.sessions) {
      if (ChunkedUploadStore.expired(r, now)) { this.sessions.delete(id); removed++; }
    }
    return removed;
  }

  create(record: ChunkedUploadRecord): ChunkedUploadRecord {
    this.sweep();
    this.sessions.set(record.uploadId, record);
    return record;
  }

  /** The live session, or null when there is none or it has expired (an expired one is removed). */
  get(uploadId: string, now = Date.now()): ChunkedUploadRecord | null {
    const r = this.sessions.get(uploadId);
    if (!r) return null;
    if (ChunkedUploadStore.expired(r, now)) { this.sessions.delete(uploadId); return null; }
    return r;
  }

  addChunk(uploadId: string, chunkIndex: number, data: Buffer): boolean {
    const r = this.get(uploadId);
    if (!r) return false;
    r.receivedChunks.set(chunkIndex, data);
    return true;
  }

  delete(uploadId: string): boolean {
    return this.sessions.delete(uploadId);
  }

  /** How many live sessions one principal holds, and how many chunk bytes they hold in this process. */
  heldBy(ownerGaii: string, now = Date.now()): { sessions: number; bytes: number } {
    let sessions = 0, bytes = 0;
    for (const r of this.sessions.values()) {
      if (r.ownerGaii !== ownerGaii || ChunkedUploadStore.expired(r, now)) continue;
      sessions++;
      for (const b of r.receivedChunks.values()) bytes += b.length;
    }
    return { sessions, bytes };
  }
}
