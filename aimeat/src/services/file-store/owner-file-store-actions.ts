/**
 * @file src/services/file-store/owner-file-store-actions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a person does with stores of their own, and what an operator decides about it, as
 *   ONE implementation the REST routes and the MCP tools both call: the view (with the stores the
 *   person may choose for a file), connecting a named store (tested before anything is saved) or
 *   making one the default, disconnecting one, moving files between places, and the operator's
 *   approval on a node where the operators approve.
 *
 *   A STORE WITH FILES IN IT IS NOT REPLACED OR REMOVED. Every file in it is named by the store's id,
 *   so pointing that id at another bucket, or removing it, would leave those files unreadable. The
 *   person moves them elsewhere first (moveOwnerFiles), and the answer says so. A new key for the same
 *   bucket is fine.
 * @structure OwnerActor · ownerIdentities · ownerFileStoreView · connectOwnerFileStore ·
 *   removeOwnerFileStore · moveOwnerFiles · decideOwnerFileStore · FILE_STORE_DOMAIN · placeOf (re-export)
 * @usage const r = await connectOwnerFileStore(ctx, { account: 'alice', actor: principal, operator: false }, body);
 * @version-history
 *   v1.1.0 — 2026-10-30 — Several named stores per person with one default; a move goes to any store
 *     the person may choose, or home; the view lists the stores a file may be put in
 *     (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { parseBlobRef } from '../../storage/blob/blob-types.js';
import { relocateStorageFile, type FileStoreTarget } from '../../storage/blob/file-store-wrap.js';
import type { StorageFileRecord } from '../../storage/interface.js';
import { notify } from '../notify.js';
import { emitChange } from '../event-bus.js';
import { listOperatorGhiis } from '../operators.js';
import { storeFor } from './file-store-specs.js';
import { choiceIdOf, nodeTarget, ownerTarget, resolveChoice } from './file-store-resolver.js';
import { probeStore, type FileStoreResult } from './file-store-admin.js';
import { readNodeStores } from './node-file-stores.js';
import { placeKey, placeOf, readStoreInput, sameTarget, storeNameProblem, whereOf } from './store-target.js';
import {
  approvalOf, defaultEntry, entryNamed, LEGACY_STORE_NAME, ownerEntryStoreId, ownerMayUse, ownerStoreMode,
  readApprovals, readOwnerStores, sealCredential, UNCHANGED, updateApprovals, updateOwnerStores,
  type FileStoreCtx, type OwnerFileStores, type OwnerStoreEntry,
} from './owner-file-store.js';

export { placeOf };

const PROFILE_PAGE = '/v1/profile?tab=storage';
/** The live domain both file-store pages listen on: a change re-reads them over the SSE stream. */
export const FILE_STORE_DOMAIN = 'file-store';
const ADMIN_PAGE = '/v1/admin?tab=file-stores';
const MOVE_LIMIT_MAX = 200;

const fail = (status: number, code: string, message: string) => ({ ok: false as const, status, code, message });
const str = (v: unknown, max = 2048) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export interface OwnerActor { account: string; actor: string; operator: boolean }

/** The person and every identity acting in their name whose files are theirs: their agents too. */
export async function ownerIdentities(ctx: FileStoreCtx, account: string): Promise<string[]> {
  const agents = await ctx.storage.getAgentsByOwner(account);
  return [`${account}@${ctx.config.nodeId}`, ...agents.map(a => a.gaii)];
}

/** Every file of the person, and the store id each is in (null: the database). */
async function ownFiles(ctx: FileStoreCtx, account: string): Promise<{ file: StorageFileRecord; storeId: string | null }[]> {
  const byOwner = await ctx.storage.listStorageFilesForOwners(await ownerIdentities(ctx, account));
  return Object.values(byOwner).flat().map(file => ({ file, storeId: parseBlobRef(file.blobRef)?.storeId ?? null }));
}

const sizeOf = (fs: { file: { size: number } }[]) => ({ count: fs.length, bytes: fs.reduce((a, f) => a + f.file.size, 0) });

function entryView(rec: OwnerFileStores, e: OwnerStoreEntry, files: { file: StorageFileRecord; storeId: string | null }[]) {
  return {
    name: e.name, choice: `own:${e.name}`, default: rec.default === e.name,
    kind: e.target.kind, where: whereOf(e.target), place: placeOf(e.target), prefix: e.prefix,
    connected_at: e.connectedAt, connected_by: e.connectedBy, last_check: e.lastCheck ?? null,
    files: sizeOf(files.filter(f => f.storeId === e.storeId)),
  };
}

export async function ownerFileStoreView(ctx: FileStoreCtx, account: string, opts: { operator?: boolean } = {}) {
  const mode = ownerStoreMode(ctx.config);
  const ghii = `${account}@${ctx.config.nodeId}`;
  const [rec, approvals, files, nodeStores, mayUse] = await Promise.all([
    readOwnerStores(ctx, account), readApprovals(ctx), ownFiles(ctx, account), readNodeStores(ctx), ownerMayUse(ctx, account),
  ]);
  const approval = approvalOf(approvals, account);
  const own = rec?.stores ?? [];
  const ownIds = new Set(own.map(e => e.storeId));
  const taking = (await ownerTarget(ctx, ghii)) !== null;
  const node = await nodeTarget(ctx);
  const stores = rec ? own.map(e => entryView(rec, e, files)) : [];
  const byStore = new Map<string, { count: number; bytes: number }>();
  for (const f of files) {
    const id = choiceIdOf(f.storeId);
    const cur = byStore.get(id) ?? { count: 0, bytes: 0 };
    byStore.set(id, { count: cur.count + 1, bytes: cur.bytes + f.file.size });
  }
  return {
    mode,
    may_connect: mode !== 'off',
    approval: mode === 'operator' ? (approval ? { state: approval.state, at: approval.at, note: approval.note ?? null } : null) : null,
    stores,
    default_store: rec?.default ? `own:${rec.default}` : null,
    // The default entry, as the one-store view had it, for a reader written before several stores.
    store: stores.find(s => s.default) ?? null,
    taking_new_files: taking,
    // Where a file goes when its writer names no store.
    new_files_go_to: taking ? `own:${rec!.default}` : choiceIdOf(node?.storeId),
    // What a writer may name in `store` when saving a file: their own stores while the node's rule
    // lets them use them, and the node's stores an operator opened to everyone (every one, for an operator).
    choices: [
      ...(mayUse ? own.map(e => ({ store: `own:${e.name}`, kind: e.target.kind, place: placeOf(e.target) })) : []),
      ...nodeStores.stores.filter(s => s.selectable || opts.operator)
        .map(s => ({ store: `node:${s.name}`, kind: s.target.kind, place: placeOf(s.target), default: nodeStores.default === s.name })),
    ],
    files: {
      in_own_store: sizeOf(files.filter(f => f.storeId !== null && ownIds.has(f.storeId))),
      elsewhere: sizeOf(files.filter(f => f.storeId === null || !ownIds.has(f.storeId))),
      by_store: [...byStore.entries()].map(([store, s]) => ({ store, ...s })),
    },
  };
}

async function tellOperators(ctx: FileStoreCtx, account: string, reason: string): Promise<void> {
  const operators = await listOperatorGhiis(ctx.storage, ctx.config);
  await Promise.all(operators.map(ghii => notify(ctx.storage, ghii, {
    type: 'file_store_request',
    title: `${account} asks to keep their files in their own storage`,
    body: reason ? `Their reason: ${reason}` : undefined,
    link: ADMIN_PAGE,
  })));
}

/** The entry a call names, or the only one when it names none. */
function pickName(rec: OwnerFileStores | null, given: string): { name: string } | { problem: string } {
  if (given) return { name: given };
  const stores = rec?.stores ?? [];
  if (stores.length === 0) return { name: LEGACY_STORE_NAME };
  if (stores.length === 1) return { name: stores[0].name };
  return { problem: `You have ${stores.length} stores of your own (${stores.map(s => s.name).join(', ')}): name the one you mean.` };
}

export async function connectOwnerFileStore(ctx: FileStoreCtx, who: OwnerActor, body: Record<string, unknown>): Promise<FileStoreResult<{
  outcome: 'connected' | 'updated' | 'waiting_for_operator'; test: Awaited<ReturnType<typeof probeStore>> | null; view: Awaited<ReturnType<typeof ownerFileStoreView>>;
}>> {
  const mode = ownerStoreMode(ctx.config);
  if (mode === 'off') return fail(403, 'OWNER_FILE_STORES_OFF', 'The operators of this node do not let people connect their own storage.');
  const rec = await readOwnerStores(ctx, who.account);
  const picked = pickName(rec, str(body.name, 40));
  if ('problem' in picked) return fail(400, 'INVALID_INPUT', picked.problem);
  const name = picked.name;
  const nameProblem = storeNameProblem(name);
  if (nameProblem) return fail(400, 'INVALID_INPUT', nameProblem);
  const current = entryNamed(rec, name);
  const makeDefault = body.make_default === true;

  // No kind: only the store's options change (which one is the default), and nothing is tested.
  if (!str(body.kind)) {
    if (!current) return fail(400, 'INVALID_INPUT', `Missing or not valid: kind (s3 or azure). You have no store called "${name}" to change.`);
    if (makeDefault) await updateOwnerStores(ctx, who.account, cur => (cur ? { ...cur, default: name } : UNCHANGED));
    emitChange(FILE_STORE_DOMAIN);
    return { ok: true, data: { outcome: 'updated', test: null, view: await ownerFileStoreView(ctx, who.account, { operator: who.operator }) } };
  }

  const ghii = `${who.account}@${ctx.config.nodeId}`;
  const input = readStoreInput(ctx.config, body, { reach: 'owner', defaultPrefix: `aimeat/${ghii}/${name}/` });
  if ('missing' in input) return fail(400, 'INVALID_INPUT', `Missing or not valid: ${input.missing.join(', ')}.`);
  const reason = str(body.reason, 500);

  if (current && !sameTarget(current.target, input.target)) {
    const inIt = (await ownFiles(ctx, who.account)).filter(f => f.storeId === current.storeId).length;
    if (inIt > 0) {
      return fail(409, 'FILES_IN_STORE', `${inIt} of your files are in your storage "${name}" (${whereOf(current.target)}). Move them elsewhere first (aimeat_file_store_move with from "own:${name}"), then point it at the new place.`);
    }
  }
  const twin = rec?.stores.find(s => s.name !== name && placeKey(s.target) === placeKey(input.target) && s.prefix === input.prefix);
  if (twin) return fail(409, 'STORE_ALREADY_CONNECTED', `That folder of that bucket is already your storage "${twin.name}".`);

  const credential = sealCredential(ctx.config, who.account, input.secret);
  if (!credential) return fail(503, 'NO_ENCRYPTION_KEY', 'This node has no encryption key, so it cannot keep a storage key safely. Ask its operators to set AIMEAT_ENCRYPTION_KEY.');

  // Tested before anything is kept: a store that cannot take a file would only fail later, on an upload.
  const test = await probeStore(storeFor(input.spec, 'guarded', ctx.config), input.prefix);
  if (!test.ok) {
    const failed = test.steps.find(s => !s.ok);
    return fail(422, 'STORE_TEST_FAILED', `The storage did not pass the test at step "${failed?.step}": ${failed?.message ?? 'no answer'}. Nothing was saved.`);
  }
  const now = new Date().toISOString();
  const entry: OwnerStoreEntry = {
    name, storeId: current?.storeId ?? ownerEntryStoreId(ghii, name),
    target: input.target, prefix: input.prefix, credential,
    connectedAt: current && sameTarget(current.target, input.target) ? current.connectedAt : now,
    connectedBy: who.actor, lastCheck: { at: now, ok: true, message: 'write, read, read part, list and remove all worked' },
  };
  await updateOwnerStores(ctx, who.account, cur => {
    const base: OwnerFileStores = cur ?? { spec: 'aimeat.owner-file-stores/v2', owner: who.account, default: null, stores: [] };
    const stores = [...base.stores.filter(s => s.name !== name), entry];
    return {
      ...base, stores,
      // The first store becomes the default; a later one only when asked.
      default: makeDefault || !base.default || !stores.some(s => s.name === base.default) ? name : base.default,
      ...(reason ? { reason } : {}),
    };
  });

  let outcome: 'connected' | 'waiting_for_operator' = 'connected';
  if (mode === 'operator' && !(await ownerMayUse(ctx, who.account))) {
    if (who.operator) {
      await updateApprovals(ctx, cur => ({ ...cur, owners: [...cur.owners.filter(o => o.owner !== who.account), { owner: who.account, state: 'approved', at: now, by: who.actor, note: 'an operator connecting their own storage' }] }));
    } else {
      outcome = 'waiting_for_operator';
      const before = approvalOf(await readApprovals(ctx), who.account);
      await updateApprovals(ctx, cur => ({ ...cur, owners: [...cur.owners.filter(o => o.owner !== who.account), { owner: who.account, state: 'requested', at: now, by: who.actor, ...(reason ? { note: reason } : {}) }] }));
      if (before?.state !== 'requested') await tellOperators(ctx, who.account, reason);
    }
  }
  emitChange(FILE_STORE_DOMAIN);
  return { ok: true, data: { outcome, test, view: await ownerFileStoreView(ctx, who.account, { operator: who.operator }) } };
}

/** Disconnect one of the person's stores: the one named, or the only one. Refused while files are in it. */
export async function removeOwnerFileStore(ctx: FileStoreCtx, account: string, given?: unknown): Promise<FileStoreResult<{ removed: boolean; name: string }>> {
  const rec = await readOwnerStores(ctx, account);
  if (!rec || rec.stores.length === 0) return fail(404, 'NOT_FOUND', 'You have no storage of your own connected.');
  const picked = pickName(rec, str(given, 40));
  if ('problem' in picked) return fail(400, 'INVALID_INPUT', picked.problem);
  const entry = entryNamed(rec, picked.name);
  if (!entry) return fail(404, 'NOT_FOUND', `You have no storage called "${picked.name}".`);
  const inIt = (await ownFiles(ctx, account)).filter(f => f.storeId === entry.storeId).length;
  if (inIt > 0) {
    return fail(409, 'FILES_IN_STORE', `${inIt} of your files are in your storage "${entry.name}". Move them elsewhere first (aimeat_file_store_move with from "own:${entry.name}"), then disconnect it.`);
  }
  // Removing the default leaves no default: new files go to the node, never silently to another store.
  await updateOwnerStores(ctx, account, cur => (cur
    ? { ...cur, stores: cur.stores.filter(s => s.name !== entry.name), default: cur.default === entry.name ? null : cur.default }
    : UNCHANGED));
  emitChange(FILE_STORE_DOMAIN);
  return { ok: true, data: { removed: true, name: entry.name } };
}

/**
 * Move up to `limit` of the person's files to `to`: one of the stores they may choose (`own:<name>`,
 * `node:<name>`) or `home`, where the node keeps files. `from` narrows to the files of one place
 * (`own:<name>`, `node:<name>`, `database`); without it, `home` moves every file in their own stores
 * and a store moves every file not yet in it. `direction` is the first version's word: `own` is the
 * default own store, `home` is home.
 */
export async function moveOwnerFiles(
  ctx: FileStoreCtx, who: { account: string; operator: boolean },
  body: { to?: unknown; from?: unknown; direction?: unknown; limit?: unknown },
): Promise<FileStoreResult<{ to: string; moved: number; skipped: number; failed: { key: string; error: string }[]; remaining: number }>> {
  const rec = await readOwnerStores(ctx, who.account);
  let to = str(body.to, 100);
  if (!to && body.direction === 'home') to = 'home';
  if (!to && body.direction === 'own') {
    const entry = defaultEntry(rec);
    if (!entry) return fail(409, 'NOT_TAKING_FILES', 'You have no default storage of your own. Name the store with `to`.');
    to = `own:${entry.name}`;
  }
  if (!to) return fail(400, 'INVALID_INPUT', 'to is "home" (where the node keeps files) or a store you may choose: "own:<name>" or "node:<name>".');
  const from = str(body.from, 100);
  const limit = Math.max(1, Math.min(MOVE_LIMIT_MAX, Number.isInteger(body.limit) ? (body.limit as number) : 50));
  const ghii = `${who.account}@${ctx.config.nodeId}`;

  let target: FileStoreTarget | null;
  if (to === 'home') {
    target = await nodeTarget(ctx);
  } else {
    const r = await resolveChoice(ctx, ghii, to, { operator: who.operator });
    if (!r.ok) return r;
    target = r.target;
  }
  const ownIds = new Set((rec?.stores ?? []).map(s => s.storeId));
  const files = await ownFiles(ctx, who.account);
  const candidates = files.filter(f => (f.storeId ?? null) !== (target?.storeId ?? null))
    .filter(f => (from ? choiceIdOf(f.storeId) === from : to === 'home' ? f.storeId !== null && ownIds.has(f.storeId) : true));

  let moved = 0, skipped = 0;
  const failed: { key: string; error: string }[] = [];
  for (const { file } of candidates.slice(0, limit)) {
    try {
      const out = await relocateStorageFile(ctx.storage, file.ownerGaii, file.key, target);
      if (out === 'moved') moved++; else skipped++;
    } catch (err) {
      failed.push({ key: file.key, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (moved > 0) emitChange(FILE_STORE_DOMAIN);
  return { ok: true, data: { to: to === 'home' ? choiceIdOf(target?.storeId) : to, moved, skipped, failed, remaining: Math.max(0, candidates.length - moved - skipped) } };
}

/** An operator's answer: approve or decline a request, or revoke an approval (the stores stop taking files). */
export async function decideOwnerFileStore(ctx: FileStoreCtx, operator: string, input: { owner: string; decision?: unknown; note?: unknown }): Promise<FileStoreResult<{ owner: string; state: string }>> {
  const decision = input.decision;
  if (decision !== 'approve' && decision !== 'decline' && decision !== 'revoke') {
    return fail(400, 'INVALID_INPUT', 'decision is "approve", "decline" or "revoke".');
  }
  const note = str(input.note, 500);
  if (decision !== 'approve' && !note) return fail(400, 'INVALID_INPUT', 'A decline or a revoke needs a note: the person reads it.');
  const state = decision === 'approve' ? 'approved' as const : 'declined' as const;
  const now = new Date().toISOString();
  await updateApprovals(ctx, cur => ({
    ...cur, owners: [...cur.owners.filter(o => o.owner !== input.owner), { owner: input.owner, state, at: now, by: operator, ...(note ? { note } : {}) }],
  }));
  await notify(ctx.storage, `${input.owner}@${ctx.config.nodeId}`, {
    type: 'file_store_decision',
    title: state === 'approved' ? 'Your own storage is approved: new files go there now' : 'Your own storage was not approved: new files stay on the node',
    body: note || undefined,
    link: PROFILE_PAGE,
  });
  emitChange(FILE_STORE_DOMAIN);
  return { ok: true, data: { owner: input.owner, state } };
}
