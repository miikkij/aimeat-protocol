/**
 * @file test/unit/chunked-upload-store.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The chunked upload sessions both storage providers hold (storage/chunked-upload-store.ts).
 *   PostgreSQL's provider never read `expiresAt`, so an abandoned upload held its bytes until the node
 *   restarted, and SQLite's dropped an expired session only when the same id was asked for again
 *   (QA audit F05b-02). Here: an expired session reads as gone on every method, a new session sweeps the
 *   expired ones, and heldBy counts one principal's live sessions and bytes and nobody else's. The
 *   PostgreSQL provider's methods are one-line calls to this store; the SQLite provider is driven too.
 * @usage cd aimeat && pnpm exec vitest run test/unit/chunked-upload-store.test.ts
 * @version-history
 *   2026-10-16 — Initial (QA audit F05b-02).
 */
import { describe, it, expect } from 'vitest';
import { ChunkedUploadStore } from '../../src/storage/chunked-upload-store.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { ChunkedUploadRecord } from '../../src/storage/interface.js';

function session(id: string, owner: string, expiresInMs: number): ChunkedUploadRecord {
  const now = Date.now();
  return {
    uploadId: id, ownerGaii: owner, key: `${id}.bin`, mimeType: 'application/octet-stream', visibility: 'private',
    chunkSize: 100, totalChunks: 2, receivedChunks: new Map(), createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + expiresInMs).toISOString(),
  };
}

describe('the chunked upload store', () => {
  it('an expired session reads as gone, takes no chunk, and is removed', () => {
    const s = new ChunkedUploadStore();
    s.create(session('old', 'a@n', -1000));
    expect(s.get('old')).toBeNull();
    expect(s.addChunk('old', 0, Buffer.alloc(10))).toBe(false);
    expect(s.heldBy('a@n')).toEqual({ sessions: 0, bytes: 0 });
  });

  it('a new session sweeps every expired one, whoever held it', () => {
    const s = new ChunkedUploadStore();
    s.create(session('old1', 'a@n', 60_000));
    s.create(session('old2', 'b@n', 60_000));
    s.addChunk('old1', 0, Buffer.alloc(50));
    // Past both expiries.
    expect(s.sweep(Date.now() + 120_000)).toBe(2);
    expect(s.get('old1')).toBeNull();
  });

  it('heldBy counts one principal\'s live sessions and chunk bytes only', () => {
    const s = new ChunkedUploadStore();
    s.create(session('a1', 'a@n', 60_000));
    s.create(session('a2', 'a@n', 60_000));
    s.create(session('b1', 'b@n', 60_000));
    s.addChunk('a1', 0, Buffer.alloc(30));
    s.addChunk('a1', 1, Buffer.alloc(20));
    s.addChunk('a2', 0, Buffer.alloc(5));
    s.addChunk('b1', 0, Buffer.alloc(99));
    expect(s.heldBy('a@n')).toEqual({ sessions: 2, bytes: 55 });
    s.delete('a1');
    expect(s.heldBy('a@n')).toEqual({ sessions: 1, bytes: 5 });
  });

  it('the SQLite provider goes through the same rule', async () => {
    const st = new SqliteStorage(':memory:');
    await st.createChunkedUpload(session('x', 'a@n', -1));
    expect(await st.getChunkedUpload('x')).toBeNull();
    await st.createChunkedUpload(session('y', 'a@n', 60_000));
    expect(await st.addChunk('y', 0, Buffer.alloc(7))).toBe(true);
    expect(await st.chunkedUploadsHeldBy('a@n')).toEqual({ sessions: 1, bytes: 7 });
    expect(await st.sweepExpiredChunkedUploads()).toBe(0);
    st.close();
  });
});
