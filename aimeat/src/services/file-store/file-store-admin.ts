/**
 * @file src/services/file-store/file-store-admin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's side of file stores, as ONE implementation the REST routes and the MCP
 *   tools both call: the store the environment names and what is missing from its settings, the named
 *   stores and which is the default, how many files and bytes each place holds, a connection test, and
 *   the move of files from one place to another, one bounded batch per call.
 * @structure FileStoreResult · nodeFileStoreStatus · probeStore · testNodeFileStore · moveFilesToNodeStore
 * @usage const status = await nodeFileStoreStatus({ storage, config });
 * @version-history
 *   v1.1.0 — 2026-10-30 — The named node stores in the status, a test of one by name, and a move from
 *     any node place (`from`) to a named store (`to`) (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { randomUUID } from 'node:crypto';
import type { BlobStore } from '../../storage/blob/blob-types.js';
import { relocateStorageFile, type FileStoreTarget } from '../../storage/blob/file-store-wrap.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { nodeStoreSpec, storeFor } from './file-store-specs.js';
import { choiceIdOf, nodeTarget, ownerTarget, resolveChoice } from './file-store-resolver.js';
import { listOwnerStores, ownerStoreMode, readApprovals, type FileStoreCtx } from './owner-file-store.js';
import { nodeEntryNamed, nodeEntrySpec, nodeEntryStoreId, nodeStoreView, readNodeStores, updateNodeStores } from './node-file-stores.js';
import { placeOf, targetOfSpec, whereOf } from './store-target.js';

export type FileStoreResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

const MB = 1024 * 1024;
const NONE = { count: 0, bytes: 0 };

/** Where the node's new files go, its stores, what each place holds, and the people's own stores. */
export async function nodeFileStoreStatus(ctx: FileStoreCtx) {
  const spec = nodeStoreSpec(ctx.config);
  const places = await ctx.storage.countStorageFilesByStore();
  const sum = (pred: (store: string) => boolean) => places.filter(p => pred(p.store))
    .reduce((a, p) => ({ count: a.count + p.count, bytes: a.bytes + p.bytes }), { count: 0, bytes: 0 });
  const [owners, approvals, named, node] = await Promise.all([listOwnerStores(ctx), readApprovals(ctx), readNodeStores(ctx), nodeTarget(ctx)]);
  return {
    // The store the environment names (file_store.kind and its settings), as before named stores.
    kind: spec.kind,
    ready: spec.kind === 'database' || 'spec' in spec,
    where: 'spec' in spec ? storeFor(spec.spec, 'trusted').describe() : null,
    // The same place as parts, for a screen to say in its reader's language.
    place: 'spec' in spec ? placeOf(targetOfSpec(spec.spec)) : null,
    prefix: 'spec' in spec ? spec.prefix : null,
    missing: 'missing' in spec ? spec.missing : [],
    // The named store that takes new files, or null when the environment's setting decides.
    default_store: named.default ? nodeEntryStoreId(named.default) : null,
    // Where a new file goes when neither its writer nor its owner's own storage decides.
    new_files_go_to: choiceIdOf(node?.storeId),
    stores: named.stores.map(e => nodeStoreView(ctx, named, e, places.find(p => p.store === nodeEntryStoreId(e.name)) ?? NONE)),
    files: {
      database: sum(s => s === 'database'),
      // The store the environment names; the named ones are counted apart.
      node_store: sum(s => s === 'node:s3' || s === 'node:azure'),
      named_stores: sum(s => s.startsWith('node:') && s !== 'node:s3' && s !== 'node:azure'),
      own_stores: sum(s => s.startsWith('owner:')),
      by_place: places,
    },
    owner_stores: {
      mode: ownerStoreMode(ctx.config),
      setting: ctx.config.ownerFileStores,
      connected: owners.flatMap(o => o.stores.map(e => ({
        owner: o.owner, name: e.name, store: `own:${e.name}`, default: o.default === e.name,
        kind: e.target.kind, where: whereOf(e.target), place: placeOf(e.target),
        connected_at: e.connectedAt, last_check: e.lastCheck ?? null, reason: o.reason ?? null,
        files: places.find(p => p.store === e.storeId) ?? NONE,
        approval: approvals.owners.find(a => a.owner === o.owner) ?? null,
      }))),
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

/** Test the environment's store, or with `name` one of the named stores (its last test is kept). */
export async function testNodeFileStore(ctx: FileStoreCtx, name?: unknown): Promise<FileStoreResult<{ where: string; ok: boolean; steps: { step: string; ok: boolean; message?: string }[] }>> {
  if (typeof name === 'string' && name) {
    const entry = nodeEntryNamed(await readNodeStores(ctx), name);
    if (!entry) return { ok: false, status: 404, code: 'NOT_FOUND', message: `There is no node store called "${name}".` };
    const s = nodeEntrySpec(ctx.config, entry);
    if (!s) return { ok: false, status: 409, code: 'STORE_NOT_REACHABLE', message: `The node cannot open the key of the node store "${name}". Enter its key again.` };
    const store = storeFor(s, 'trusted');
    const r = await probeStore(store, entry.prefix);
    const failed = r.steps.find(x => !x.ok);
    const lastCheck = { at: new Date().toISOString(), ok: r.ok, message: r.ok ? 'write, read, read part, list and remove all worked' : `${failed?.step}: ${failed?.message ?? 'no answer'}` };
    await updateNodeStores(ctx, cur => ({ ...cur, stores: cur.stores.map(e => (e.name === name ? { ...e, lastCheck } : e)) }));
    emitChange('file-store');
    return { ok: true, data: { where: store.describe(), ...r } };
  }
  const spec = nodeStoreSpec(ctx.config);
  if (spec.kind === 'database') {
    return { ok: false, status: 409, code: 'NO_FILE_STORE', message: 'The environment names no file store (file_store.kind is database). Name a store to test one of the named stores.' };
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
 * Move up to `limit` files out of one node place, `from` (default `database`; else a node store id,
 * `node:<name>`, `node:s3`, `node:azure`). With `to` (a node store id) every file goes there; without
 * it each goes where a new file of the same owner goes now: their default own store when the node lets
 * them use one, else the node's store for new files. A person's own stores are never a `from`: those
 * files are the person's to move. Bounded so one call never holds the node for long; the answer says
 * how many remain and gives `next`, the position to go on from, so a file that keeps failing is passed
 * over rather than retried first.
 */
export async function moveFilesToNodeStore(ctx: FileStoreCtx, opts: { limit?: unknown; after?: unknown; from?: unknown; to?: unknown }): Promise<FileStoreResult<{
  from: string; to: string | null; moved: number; skipped: number; failed: { owner: string; key: string; error: string }[]; moved_bytes_mb: number;
  remaining: number; next: string | null;
}>> {
  const from = typeof opts.from === 'string' && opts.from ? opts.from : 'database';
  if (from !== 'database' && !/^node:[a-z0-9][a-z0-9-]{0,39}$/.test(from)) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'from is "database" or a node store, "node:<name>". A person moves the files of their own storage themselves.' };
  }
  let fixed: FileStoreTarget | null = null;
  if (typeof opts.to === 'string' && opts.to) {
    const r = await resolveChoice(ctx, '', opts.to, { operator: true });
    if (!r.ok) return r;
    if (!r.target.storeId.startsWith('node:')) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'to is a node store, "node:<name>".' };
    fixed = r.target;
  }
  const node = await nodeTarget(ctx);
  if (!fixed && !node && from === 'database') {
    return { ok: false, status: 409, code: 'NO_FILE_STORE', message: 'Set up a node store first: add a named store and make it the default, or set file_store.kind with its settings, or name one with `to`.' };
  }
  const limit = Math.max(1, Math.min(500, Number.isInteger(opts.limit) ? (opts.limit as number) : 100));
  const page = await ctx.storage.listStorageFilesIn({ store: from, limit, after: decodeAfter(opts.after) });
  let moved = 0, skipped = 0, bytes = 0;
  const failed: { owner: string; key: string; error: string }[] = [];
  for (const f of page) {
    try {
      const to = fixed ?? (await ownerTarget(ctx, f.ownerGaii)) ?? node;
      const out = await relocateStorageFile(ctx.storage, f.ownerGaii, f.key, to);
      if (out === 'moved') { moved++; bytes += f.size; } else skipped++;
    } catch (err) {
      failed.push({ owner: f.ownerGaii, key: f.key, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const remaining = (await ctx.storage.countStorageFilesByStore()).find(p => p.store === from)?.count ?? 0;
  // A full page may have more after it; a short one was the end, and the next call starts over, which
  // retries what failed.
  const next = page.length === limit ? encodeAfter(page[page.length - 1]) : null;
  if (moved > 0) emitChange('file-store');
  return { ok: true, data: { from, to: fixed ? fixed.storeId : null, moved, skipped, failed, moved_bytes_mb: Math.round((bytes / MB) * 100) / 100, remaining, next } };
}
