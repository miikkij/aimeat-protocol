/**
 * @file src/services/file-store/owner-file-store-actions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a person does with a store of their own, and what an operator decides about it, as
 *   ONE implementation the REST routes and the MCP tools both call: the view, connecting (the
 *   connection is tested before anything is saved), disconnecting, moving files in or back out, and
 *   the operator's approval on a node where the operators approve.
 *
 *   A STORE WITH FILES IN IT IS NOT REPLACED OR REMOVED. Every file in it is named by the store's role
 *   (`owner:<ghii>`), so pointing that role at another bucket, or removing it, would leave those files
 *   unreadable. The person moves them home first (moveOwnerFiles 'home'), and the answer says so. A new
 *   key for the same bucket is fine.
 * @structure ownerFileStoreView · connectOwnerFileStore · removeOwnerFileStore · moveOwnerFiles ·
 *   decideOwnerFileStore · ownerIdentities
 * @usage const r = await connectOwnerFileStore(ctx, { account: 'alice', actor: principal, operator: false }, body);
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { ownerStoreId, parseBlobRef, type BlobSpec } from '../../storage/blob/blob-types.js';
import { relocateStorageFile } from '../../storage/blob/file-store-wrap.js';
import { normalizePrefix } from '../../config-file-store.js';
import { notify } from '../notify.js';
import { emitChange } from '../event-bus.js';
import { listOperatorGhiis } from '../operators.js';
import { azureSpecFrom, ownerEndpointAllowed, storeFor } from './file-store-specs.js';
import { nodeTarget, ownerTarget } from './file-store-resolver.js';
import { probeStore, type FileStoreResult } from './file-store-admin.js';
import {
  approvalOf, deleteOwnerStore, ownerMayUse, ownerStoreMode, readApprovals, readOwnerStore, sealCredential,
  updateApprovals, writeOwnerStore, type FileStoreCtx, type OwnerFileStore, type OwnerStoreTarget,
} from './owner-file-store.js';

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

async function ownFiles(ctx: FileStoreCtx, account: string) {
  const storeId = ownerStoreId(`${account}@${ctx.config.nodeId}`);
  const byOwner = await ctx.storage.listStorageFilesForOwners(await ownerIdentities(ctx, account));
  const all = Object.values(byOwner).flat();
  const inOwn = all.filter(f => parseBlobRef(f.blobRef)?.storeId === storeId);
  return { all, inOwn, storeId };
}

const sizeOf = (fs: { size: number }[]) => ({ count: fs.length, bytes: fs.reduce((a, f) => a + f.size, 0) });

function whereOf(t: OwnerStoreTarget): string {
  return t.kind === 's3' ? `s3 bucket "${t.bucket}"${t.endpoint ? ` at ${new URL(t.endpoint).host}` : ''}` : `azure container "${t.container}" in account ${t.account}`;
}

/** The same place as parts, so a screen can say it in its reader's language: `name` is the bucket or
 *  container, `at` the service host (S3, empty for Amazon S3) or the storage account (Azure). */
export function placeOf(t: OwnerStoreTarget): { kind: 's3' | 'azure'; name: string; at: string } {
  return t.kind === 's3'
    ? { kind: 's3', name: t.bucket, at: t.endpoint ? new URL(t.endpoint).host : '' }
    : { kind: 'azure', name: t.container, at: t.account };
}

export async function ownerFileStoreView(ctx: FileStoreCtx, account: string) {
  const mode = ownerStoreMode(ctx.config);
  const [rec, approvals, files] = await Promise.all([readOwnerStore(ctx, account), readApprovals(ctx), ownFiles(ctx, account)]);
  const approval = approvalOf(approvals, account);
  const taking = rec ? (await ownerTarget(ctx, `${account}@${ctx.config.nodeId}`)) !== null : false;
  return {
    mode,
    may_connect: mode !== 'off',
    approval: mode === 'operator' ? (approval ? { state: approval.state, at: approval.at, note: approval.note ?? null } : null) : null,
    store: rec ? {
      kind: rec.target.kind, where: whereOf(rec.target), place: placeOf(rec.target), prefix: rec.prefix,
      connected_at: rec.connectedAt, connected_by: rec.connectedBy, last_check: rec.lastCheck ?? null,
    } : null,
    taking_new_files: taking,
    files: { in_own_store: sizeOf(files.inOwn), elsewhere: sizeOf(files.all.filter(f => !files.inOwn.includes(f))) },
  };
}

/** The target and the secret from what the person typed, or what is missing. */
function readInput(ctx: FileStoreCtx, account: string, body: Record<string, unknown>): { target: OwnerStoreTarget; secret: Record<string, string>; spec: BlobSpec; prefix: string } | { missing: string[] } {
  const kind = str(body.kind);
  const prefix = normalizePrefix(str(body.prefix, 200)) || `aimeat/${account}@${ctx.config.nodeId}/`;
  if (kind === 's3') {
    const endpoint = str(body.endpoint);
    const target: OwnerStoreTarget = {
      kind: 's3', endpoint, region: str(body.region, 64) || 'us-east-1', bucket: str(body.bucket, 255),
      addressing: (['path', 'host'] as const).find(a => a === body.addressing) ?? 'auto',
    };
    const secret = { accessKeyId: str(body.access_key_id, 256), secretAccessKey: str(body.secret_access_key, 512) };
    const missing = [!target.bucket && 'bucket', !secret.accessKeyId && 'access_key_id', !secret.secretAccessKey && 'secret_access_key']
      .filter((m): m is string => !!m);
    if (endpoint && !ownerEndpointAllowed(ctx.config, endpoint)) missing.push('endpoint (an https:// address)');
    if (missing.length) return { missing };
    const spec: BlobSpec = {
      kind: 's3', endpoint: endpoint || undefined, region: target.region, bucket: target.bucket, ...secret,
      pathStyle: target.addressing === 'auto' ? undefined : target.addressing === 'path',
    };
    return { target, secret, spec, prefix };
  }
  if (kind === 'azure') {
    const r = azureSpecFrom({ account: str(body.account, 64), container: str(body.container, 63), endpoint: '', credential: str(body.credential, 4096) || null });
    if (!r.spec) return { missing: r.missing };
    if (r.spec.endpoint && !ownerEndpointAllowed(ctx.config, r.spec.endpoint)) return { missing: ['credential (an https:// account address)'] };
    const target: OwnerStoreTarget = { kind: 'azure', account: r.spec.accountName, container: r.spec.container, endpoint: r.spec.endpoint ?? '' };
    const secret: Record<string, string> = r.spec.accountKey ? { accountKey: r.spec.accountKey } : { sasToken: r.spec.sasToken! };
    return { target, secret, spec: r.spec, prefix };
  }
  return { missing: ['kind (s3 or azure)'] };
}

const sameTarget = (a: OwnerStoreTarget, b: OwnerStoreTarget) => JSON.stringify(a) === JSON.stringify(b);

async function tellOperators(ctx: FileStoreCtx, account: string, reason: string): Promise<void> {
  const operators = await listOperatorGhiis(ctx.storage, ctx.config);
  await Promise.all(operators.map(ghii => notify(ctx.storage, ghii, {
    type: 'file_store_request',
    title: `${account} asks to keep their files in their own storage`,
    body: reason ? `Their reason: ${reason}` : undefined,
    link: ADMIN_PAGE,
  })));
}

export async function connectOwnerFileStore(ctx: FileStoreCtx, who: OwnerActor, body: Record<string, unknown>): Promise<FileStoreResult<{
  outcome: 'connected' | 'waiting_for_operator'; test: Awaited<ReturnType<typeof probeStore>>; view: Awaited<ReturnType<typeof ownerFileStoreView>>;
}>> {
  const mode = ownerStoreMode(ctx.config);
  if (mode === 'off') return fail(403, 'OWNER_FILE_STORES_OFF', 'The operators of this node do not let people connect their own storage.');
  const input = readInput(ctx, who.account, body);
  if ('missing' in input) return fail(400, 'INVALID_INPUT', `Missing or not valid: ${input.missing.join(', ')}.`);
  const reason = str(body.reason, 500);

  const current = await readOwnerStore(ctx, who.account);
  if (current && !sameTarget(current.target, input.target)) {
    const files = await ownFiles(ctx, who.account);
    if (files.inOwn.length > 0) {
      return fail(409, 'FILES_IN_STORE', `${files.inOwn.length} of your files are in your current storage (${whereOf(current.target)}). Move them home first (aimeat_file_store_move with direction "home"), then connect the new one.`);
    }
  }
  const credential = sealCredential(ctx.config, who.account, input.secret);
  if (!credential) return fail(503, 'NO_ENCRYPTION_KEY', 'This node has no encryption key, so it cannot keep a storage key safely. Ask its operators to set AIMEAT_ENCRYPTION_KEY.');

  // Tested before anything is kept: a store that cannot take a file would only fail later, on an upload.
  const test = await probeStore(storeFor(input.spec, 'guarded', ctx.config), input.prefix);
  if (!test.ok) {
    const failed = test.steps.find(s => !s.ok);
    return fail(422, 'STORE_TEST_FAILED', `The storage did not pass the test at step "${failed?.step}": ${failed?.message ?? 'no answer'}. Nothing was saved.`);
  }
  const now = new Date().toISOString();
  const rec: OwnerFileStore = {
    spec: 'aimeat.owner-file-store/v1', owner: who.account, target: input.target, prefix: input.prefix, credential,
    connectedAt: current && sameTarget(current.target, input.target) ? current.connectedAt : now,
    connectedBy: who.actor, lastCheck: { at: now, ok: true, message: 'write, read, read part, list and remove all worked' },
    ...(reason ? { reason } : current?.reason ? { reason: current.reason } : {}),
  };
  await writeOwnerStore(ctx, rec);

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
  return { ok: true, data: { outcome, test, view: await ownerFileStoreView(ctx, who.account) } };
}

export async function removeOwnerFileStore(ctx: FileStoreCtx, account: string): Promise<FileStoreResult<{ removed: boolean }>> {
  const current = await readOwnerStore(ctx, account);
  if (!current) return fail(404, 'NOT_FOUND', 'You have no storage of your own connected.');
  const files = await ownFiles(ctx, account);
  if (files.inOwn.length > 0) {
    return fail(409, 'FILES_IN_STORE', `${files.inOwn.length} of your files are in your own storage. Move them home first (aimeat_file_store_move with direction "home"), then disconnect it.`);
  }
  await deleteOwnerStore(ctx, account);
  emitChange(FILE_STORE_DOMAIN);
  return { ok: true, data: { removed: true } };
}

/**
 * Move up to `limit` of the person's files: `own` into their own store (what was there before it was
 * connected), `home` out of it to where the node keeps files, so the store can be disconnected.
 */
export async function moveOwnerFiles(ctx: FileStoreCtx, account: string, body: { direction?: unknown; limit?: unknown }): Promise<FileStoreResult<{
  moved: number; skipped: number; failed: { key: string; error: string }[]; remaining: number;
}>> {
  const direction = body.direction === 'home' ? 'home' : body.direction === 'own' ? 'own' : null;
  if (!direction) return fail(400, 'INVALID_INPUT', 'direction is "own" (into your storage) or "home" (back to the node).');
  const limit = Math.max(1, Math.min(MOVE_LIMIT_MAX, Number.isInteger(body.limit) ? (body.limit as number) : 50));
  const ghii = `${account}@${ctx.config.nodeId}`;
  const files = await ownFiles(ctx, account);
  let target;
  let candidates;
  if (direction === 'own') {
    target = await ownerTarget(ctx, ghii);
    if (!target) return fail(409, 'NOT_TAKING_FILES', 'Your own storage is not taking files: it is not connected, or the operators have not approved it yet.');
    candidates = files.all.filter(f => !files.inOwn.includes(f));
  } else {
    target = nodeTarget(ctx.config);
    candidates = files.inOwn;
  }
  let moved = 0, skipped = 0;
  const failed: { key: string; error: string }[] = [];
  for (const f of candidates.slice(0, limit)) {
    try {
      const out = await relocateStorageFile(ctx.storage, f.ownerGaii, f.key, target);
      if (out === 'moved') moved++; else skipped++;
    } catch (err) {
      failed.push({ key: f.key, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (moved > 0) emitChange(FILE_STORE_DOMAIN);
  return { ok: true, data: { moved, skipped, failed, remaining: Math.max(0, candidates.length - moved - skipped) } };
}

/** An operator's answer: approve or decline a request, or revoke an approval (the store stops taking files). */
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
