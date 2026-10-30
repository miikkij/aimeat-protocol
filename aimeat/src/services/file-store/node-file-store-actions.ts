/**
 * @file src/services/file-store/node-file-store-actions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an operator does with the node's named stores, as ONE implementation the REST routes
 *   and the MCP tools both call: add one or give it a new key (tested before anything is saved), open
 *   it to everyone or close it, make it the default or stop it being one, and remove it.
 *
 *   A STORE WITH FILES IN IT IS NOT REPOINTED OR REMOVED. Every file in it is read by the store's id,
 *   `node:<name>`, so pointing the id at another bucket, or removing it, would leave those files
 *   unreadable. The operator moves them first (file-store-admin.ts moveFilesBetweenPlaces with
 *   `from: node:<name>`), and the answer says so.
 * @structure setNodeFileStore · removeNodeFileStore
 * @usage const r = await setNodeFileStore(ctx, principal, { name: 'archive', kind: 'azure', credential, container });
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 */
import { emitChange } from '../event-bus.js';
import { nodeStoreSpec, storeFor } from './file-store-specs.js';
import { probeStore, type FileStoreResult } from './file-store-admin.js';
import { FILE_STORE_DOMAIN } from './owner-file-store-actions.js';
import { UNCHANGED, type FileStoreCtx } from './owner-file-store.js';
import {
  nodeEntryNamed, nodeEntryStoreId, nodeStoreView, readNodeStores, RESERVED_NODE_STORE_NAMES, sealNodeCredential,
  updateNodeStores, type NodeFileStores, type NodeStoreEntry,
} from './node-file-stores.js';
import { placeKey, readStoreInput, sameTarget, storeNameProblem, targetOfSpec, whereOf } from './store-target.js';

const fail = (status: number, code: string, message: string) => ({ ok: false as const, status, code, message });
const str = (v: unknown, max = 2048) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function filesIn(ctx: FileStoreCtx, storeId: string): Promise<{ count: number; bytes: number }> {
  const p = (await ctx.storage.countStorageFilesByStore()).find(x => x.store === storeId);
  return { count: p?.count ?? 0, bytes: p?.bytes ?? 0 };
}

/**
 * Add a named store, give one a new key, or change its options. With `kind` the address and the key
 * are read, the store is tested and then kept; without it only `selectable` and `make_default` change.
 * `make_default: false` on the default store makes the environment's setting decide again.
 */
export async function setNodeFileStore(ctx: FileStoreCtx, actor: string, body: Record<string, unknown>): Promise<FileStoreResult<{
  outcome: 'added' | 'updated'; test: Awaited<ReturnType<typeof probeStore>> | null; store: ReturnType<typeof nodeStoreView>;
}>> {
  const name = str(body.name, 40);
  const nameProblem = storeNameProblem(name, RESERVED_NODE_STORE_NAMES);
  if (nameProblem) return fail(400, 'INVALID_INPUT', nameProblem);
  const rec = await readNodeStores(ctx);
  const current = nodeEntryNamed(rec, name);
  const selectable = typeof body.selectable === 'boolean' ? body.selectable : undefined;
  const makeDefault = typeof body.make_default === 'boolean' ? body.make_default : undefined;
  const defaultAfter = (cur: NodeFileStores) => (makeDefault === true ? name : makeDefault === false && cur.default === name ? null : cur.default);
  const storeId = nodeEntryStoreId(name);

  if (!str(body.kind)) {
    if (!current) return fail(400, 'INVALID_INPUT', `Missing or not valid: kind (s3 or azure). There is no node store called "${name}" to change.`);
    const saved = await updateNodeStores(ctx, cur => {
      const entry = nodeEntryNamed(cur, name);
      if (!entry) return UNCHANGED;
      return { ...cur, default: defaultAfter(cur), stores: cur.stores.map(s => (s.name === name ? { ...s, ...(selectable !== undefined ? { selectable } : {}) } : s)) };
    });
    emitChange(FILE_STORE_DOMAIN);
    const entry = nodeEntryNamed(saved, name) ?? current;
    return { ok: true, data: { outcome: 'updated', test: null, store: nodeStoreView(ctx, saved, entry, await filesIn(ctx, storeId)) } };
  }

  const input = readStoreInput(ctx.config, body, { reach: 'node', defaultPrefix: `aimeat/${ctx.config.nodeId}/stores/${name}/` });
  if ('missing' in input) return fail(400, 'INVALID_INPUT', `Missing or not valid: ${input.missing.join(', ')}.`);
  if (current && !sameTarget(current.target, input.target)) {
    const inIt = (await filesIn(ctx, storeId)).count;
    if (inIt > 0) {
      return fail(409, 'FILES_IN_STORE', `${inIt} files are in the node store "${name}" (${whereOf(current.target)}). Move them first (aimeat_admin_file_store_move with from "${storeId}"), then point it at the new place.`);
    }
  }
  // The same folder of the same bucket as another store would be two names for one set of objects.
  const env = nodeStoreSpec(ctx.config);
  const others = [
    ...rec.stores.filter(s => s.name !== name).map(s => ({ label: `node:${s.name}`, place: placeKey(s.target), prefix: s.prefix })),
    ...('spec' in env ? [{ label: `node:${env.spec.kind}`, place: placeKey(targetOfSpec(env.spec)), prefix: env.prefix }] : []),
  ];
  const twin = others.find(o => o.place === placeKey(input.target) && o.prefix === input.prefix);
  if (twin) return fail(409, 'STORE_ALREADY_CONNECTED', `That folder of that bucket is already the node store "${twin.label}". Give this one its own folder (prefix).`);

  const credential = sealNodeCredential(ctx.config, input.secret);
  if (!credential) return fail(503, 'NO_ENCRYPTION_KEY', 'This node has no encryption key, so it cannot keep a storage key safely. Set AIMEAT_ENCRYPTION_KEY first.');
  const test = await probeStore(storeFor(input.spec, 'trusted'), input.prefix);
  if (!test.ok) {
    const failed = test.steps.find(s => !s.ok);
    return fail(422, 'STORE_TEST_FAILED', `The store did not pass the test at step "${failed?.step}": ${failed?.message ?? 'no answer'}. Nothing was saved.`);
  }
  const now = new Date().toISOString();
  const entry: NodeStoreEntry = {
    name, target: input.target, prefix: input.prefix, credential,
    selectable: selectable ?? current?.selectable ?? false,
    addedAt: current && sameTarget(current.target, input.target) ? current.addedAt : now, addedBy: actor,
    lastCheck: { at: now, ok: true, message: 'write, read, read part, list and remove all worked' },
  };
  const saved = await updateNodeStores(ctx, cur => ({ ...cur, default: defaultAfter(cur), stores: [...cur.stores.filter(s => s.name !== name), entry] }));
  emitChange(FILE_STORE_DOMAIN);
  return { ok: true, data: { outcome: current ? 'updated' : 'added', test, store: nodeStoreView(ctx, saved, entry, await filesIn(ctx, storeId)) } };
}

/** Remove a named store. Refused while files are in it. The bucket and what is in it are not touched. */
export async function removeNodeFileStore(ctx: FileStoreCtx, given: unknown): Promise<FileStoreResult<{ removed: boolean; name: string }>> {
  const name = str(given, 40);
  const entry = nodeEntryNamed(await readNodeStores(ctx), name);
  if (!entry) return fail(404, 'NOT_FOUND', `There is no node store called "${name}".`);
  const storeId = nodeEntryStoreId(name);
  const inIt = (await filesIn(ctx, storeId)).count;
  if (inIt > 0) {
    return fail(409, 'FILES_IN_STORE', `${inIt} files are in the node store "${name}". Move them first (aimeat_admin_file_store_move with from "${storeId}"), then remove it.`);
  }
  // Removing the default leaves the environment's setting to decide, never another named store.
  await updateNodeStores(ctx, cur => ({ ...cur, stores: cur.stores.filter(s => s.name !== name), default: cur.default === name ? null : cur.default }));
  emitChange(FILE_STORE_DOMAIN);
  return { ok: true, data: { removed: true, name } };
}
