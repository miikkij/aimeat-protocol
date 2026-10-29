/**
 * @file src/services/file-store/file-store-admin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's side of file stores, as ONE implementation the REST routes and the MCP
 *   tools both call: what the node's store is and what is missing from its settings, how many files
 *   and bytes each place holds, a connection test, and the move of older files out of the database
 *   into the node's store, one bounded batch per call.
 * @structure FileStoreResult · nodeFileStoreStatus · probeStore · testNodeFileStore · moveFilesToNodeStore
 * @usage const status = await nodeFileStoreStatus({ storage, config });
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { randomUUID } from 'node:crypto';
import type { BlobStore } from '../../storage/blob/blob-types.js';
import { relocateStorageFile } from '../../storage/blob/file-store-wrap.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { nodeStoreSpec, storeFor } from './file-store-specs.js';
import { nodeTarget, ownerTarget } from './file-store-resolver.js';
import { listOwnerStores, ownerStoreMode, readApprovals, type FileStoreCtx } from './owner-file-store.js';

export type FileStoreResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

const MB = 1024 * 1024;

/** Where the node's new files go, what each place holds, and the people's own stores. */
export async function nodeFileStoreStatus(ctx: FileStoreCtx) {
  const spec = nodeStoreSpec(ctx.config);
  const places = await ctx.storage.countStorageFilesByStore();
  const sum = (pred: (store: string) => boolean) => places.filter(p => pred(p.store))
    .reduce((a, p) => ({ count: a.count + p.count, bytes: a.bytes + p.bytes }), { count: 0, bytes: 0 });
  const owners = await listOwnerStores(ctx);
  const approvals = await readApprovals(ctx);
  return {
    kind: spec.kind,
    ready: spec.kind === 'database' || 'spec' in spec,
    where: 'spec' in spec ? storeFor(spec.spec, 'trusted').describe() : null,
    // The same place as parts, for a screen to say in its reader's language (owner-file-store-actions.ts placeOf).
    place: 'spec' in spec
      ? (spec.spec.kind === 's3'
        ? { kind: 's3', name: spec.spec.bucket, at: spec.spec.endpoint ? new URL(spec.spec.endpoint).host : '' }
        : { kind: 'azure', name: spec.spec.container, at: spec.spec.accountName })
      : null,
    prefix: 'spec' in spec ? spec.prefix : null,
    missing: 'missing' in spec ? spec.missing : [],
    files: {
      database: sum(s => s === 'database'),
      node_store: sum(s => s.startsWith('node:')),
      own_stores: sum(s => s.startsWith('owner:')),
      by_place: places,
    },
    owner_stores: {
      mode: ownerStoreMode(ctx.config),
      setting: ctx.config.ownerFileStores,
      connected: owners.map(o => ({
        owner: o.owner, kind: o.target.kind,
        where: o.target.kind === 's3' ? `s3 bucket "${o.target.bucket}"` : `azure container "${o.target.container}" in account ${o.target.account}`,
        place: o.target.kind === 's3'
          ? { kind: 's3', name: o.target.bucket, at: o.target.endpoint ? new URL(o.target.endpoint).host : '' }
          : { kind: 'azure', name: o.target.container, at: o.target.account },
        connected_at: o.connectedAt, last_check: o.lastCheck ?? null, reason: o.reason ?? null,
        approval: approvals.owners.find(a => a.owner === o.owner) ?? null,
      })),
      waiting: approvals.owners.filter(a => a.state === 'requested'),
    },
  };
}

/**
 * Write, read back, read a range of and remove one small object under the store's folder. Each step
 * named on failure, because "it does not work" is the answer an operator cannot act on; "listing is
 * refused" (a key without list rights) is one they can.
 */
export async function probeStore(store: BlobStore, prefix: string): Promise<{ ok: boolean; steps: { step: string; ok: boolean; message?: string }[] }> {
  const key = `${prefix}aimeat-connection-test-${randomUUID()}`;
  const body = Buffer.from(`AIMEAT connection test ${new Date().toISOString()}`);
  const steps: { step: string; ok: boolean; message?: string }[] = [];
  const run = async (step: string, fn: () => Promise<boolean>): Promise<boolean> => {
    try {
      const ok = await fn();
      steps.push(ok ? { step, ok } : { step, ok, message: 'the store answered, with different bytes' });
      return ok;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('file store test: a step failed', { step, where: store.describe(), error: message });
      steps.push({ step, ok: false, message });
      return false;
    }
  };
  if (!(await run('write', async () => { await store.put(key, body, 'text/plain'); return true; }))) return { ok: false, steps };
  await run('read', async () => (await store.get(key))?.equals(body) ?? false);
  await run('read part', async () => (await store.getRange(key, 0, 6))?.equals(body.subarray(0, 6)) ?? false);
  await run('list', async () => (await store.list(prefix)).objects.some(o => o.key === key));
  await run('remove', async () => { await store.delete(key); return (await store.get(key)) === null; });
  return { ok: steps.every(s => s.ok), steps };
}

export async function testNodeFileStore(ctx: FileStoreCtx): Promise<FileStoreResult<{ where: string; ok: boolean; steps: { step: string; ok: boolean; message?: string }[] }>> {
  const spec = nodeStoreSpec(ctx.config);
  if (spec.kind === 'database') {
    return { ok: false, status: 409, code: 'NO_FILE_STORE', message: 'This node keeps file bytes in its database. Set file_store.kind to s3 or azure first.' };
  }
  if (!('spec' in spec)) {
    return { ok: false, status: 409, code: 'FILE_STORE_INCOMPLETE', message: `The ${spec.kind} store is missing: ${spec.missing.join(', ')}.` };
  }
  const store = storeFor(spec.spec, 'trusted');
  const r = await probeStore(store, spec.prefix);
  return { ok: true, data: { where: store.describe(), ...r } };
}

/** The opaque position after one file, so a file that keeps failing does not hold back the rest. */
function encodeAfter(f: { ownerGaii: string; key: string }): string {
  return Buffer.from(JSON.stringify([f.ownerGaii, f.key])).toString('base64url');
}

function decodeAfter(raw: unknown): { ownerGaii: string; key: string } | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const [ownerGaii, key] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as [string, string];
    return typeof ownerGaii === 'string' && typeof key === 'string' ? { ownerGaii, key } : undefined;
  } catch (err) {
    // A garbled position starts the batch from the beginning, which retries and loses nothing.
    logger.warn('file store move: the position to go on from could not be read; starting from the first file', { error: String(err) });
    return undefined;
  }
}

/**
 * Move up to `limit` files from the database to where a new file of the same owner would go now:
 * the person's own store when they have one the node lets them use, else the node's store. Bounded
 * so one call never holds the node for long; the answer says how many remain and gives `next`, the
 * position to go on from, so a file that keeps failing is passed over rather than retried first.
 */
export async function moveFilesToNodeStore(ctx: FileStoreCtx, opts: { limit?: unknown; after?: unknown }): Promise<FileStoreResult<{
  moved: number; skipped: number; failed: { owner: string; key: string; error: string }[]; moved_bytes_mb: number;
  remaining: number; next: string | null;
}>> {
  const target = nodeTarget(ctx.config);
  if (!target) {
    return { ok: false, status: 409, code: 'NO_FILE_STORE', message: 'Set up the node\'s file store first (file_store.kind s3 or azure, with its settings complete).' };
  }
  const limit = Math.max(1, Math.min(500, Number.isInteger(opts.limit) ? (opts.limit as number) : 100));
  const page = await ctx.storage.listStorageFilesInDatabase({ limit, after: decodeAfter(opts.after) });
  let moved = 0, skipped = 0, bytes = 0;
  const failed: { owner: string; key: string; error: string }[] = [];
  for (const f of page) {
    try {
      const to = (await ownerTarget(ctx, f.ownerGaii)) ?? target;
      const out = await relocateStorageFile(ctx.storage, f.ownerGaii, f.key, to);
      if (out === 'moved') { moved++; bytes += f.size; } else skipped++;
    } catch (err) {
      failed.push({ owner: f.ownerGaii, key: f.key, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const remaining = (await ctx.storage.countStorageFilesByStore()).find(p => p.store === 'database')?.count ?? 0;
  // A full page may have more after it; a short one was the end, and the next call starts over, which
  // retries what failed.
  const next = page.length === limit ? encodeAfter(page[page.length - 1]) : null;
  if (moved > 0) emitChange('file-store');
  return { ok: true, data: { moved, skipped, failed, moved_bytes_mb: Math.round((bytes / MB) * 100) / 100, remaining, next } };
}
