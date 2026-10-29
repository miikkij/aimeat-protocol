/**
 * @file src/services/file-store/owner-file-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The store one person connected for their own files, and the operator's rule on who
 *   may connect one. Both records live in the node's own namespace (`system@<node>`), never in the
 *   person's: where a person's files go is decided by this record, and a record in their namespace
 *   could be rewritten by any agent holding memory:write, which would send every later upload to a
 *   bucket of the agent's choosing. Only the services in this folder write them.
 *
 *   THE CREDENTIAL is encrypted with the node key and bound to the account (encryptBound), so the
 *   ciphertext cannot be copied onto another person's record, and no route or tool returns it.
 *
 *   THE RULE. config.ownerFileStores: `self` lets everyone connect; `operator` lets the people an
 *   operator approved (FileStoreApprovals); `off` lets nobody; `auto` is `operator` on a node whose
 *   content is for signed-in accounts and `self` otherwise. It is asked on every write, so turning it
 *   off or withdrawing an approval stops new files going to the person's store at once. Files already
 *   there stay readable.
 * @structure FILE_STORE_PRINCIPAL · OWNER_STORE_PREFIX · APPROVALS_KEY · OwnerFileStore · FileStoreApprovals ·
 *   ownerStoreMode · readOwnerStore · writeOwnerStore · deleteOwnerStore · readApprovals · updateApprovals ·
 *   ownerMayUse · sealCredential · ownerStoreSpec · listOwnerStores
 * @usage const rec = await readOwnerStore(ctx, 'alice'); if (rec && await ownerMayUse(ctx, 'alice')) …
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { BlobSpec } from '../../storage/blob/blob-types.js';
import { signedInOnly } from '../../config-visibility.js';
import { decryptBound, encryptBound, getEncryptionKey } from '../encryption.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { logger } from '../../utils/logger.js';

export interface FileStoreCtx { storage: Storage; config: AimeatConfig }

export const FILE_STORE_PRINCIPAL = (nodeId: string) => `system@${nodeId}`;
export const OWNER_STORE_PREFIX = 'file-store.owner.';
export const APPROVALS_KEY = 'file-store.approvals';
export const FILE_STORE_TAG = 'file-store';

/** The parts of a person's store that are not secret, as they gave them. */
export type OwnerStoreTarget =
  | { kind: 's3'; endpoint: string; region: string; bucket: string; addressing: 'auto' | 'path' | 'host' }
  | { kind: 'azure'; account: string; container: string; endpoint: string };

export interface OwnerFileStore {
  spec: 'aimeat.owner-file-store/v1';
  /** The account name. */
  owner: string;
  target: OwnerStoreTarget;
  /** The folder inside the bucket or container, empty or ending in `/`. */
  prefix: string;
  /** encryptBound JSON: `{ accessKeyId, secretAccessKey }` for S3, `{ accountKey }` or `{ sasToken }` for Azure. */
  credential: string;
  connectedAt: string;
  /** The principal that connected it: the person, or their agent holding secrets:manage. */
  connectedBy: string;
  /** The last connection test: written when connecting and by the test action. */
  lastCheck?: { at: string; ok: boolean; message: string };
  /** Why the person wants it, when the operator must approve. */
  reason?: string;
}

export interface FileStoreApproval {
  owner: string;
  /** 'approved' lets the person's store take files; 'requested' waits for an operator; 'declined' does not. */
  state: 'approved' | 'requested' | 'declined';
  at: string;
  by: string;
  note?: string;
}

export interface FileStoreApprovals {
  spec: 'aimeat.file-store-approvals/v1';
  owners: FileStoreApproval[];
}

export function ownerStoreMode(config: AimeatConfig): 'off' | 'operator' | 'self' {
  const m = config.ownerFileStores;
  if (m === 'auto') return signedInOnly(config) ? 'operator' : 'self';
  return m;
}

const storeKey = (account: string) => `${OWNER_STORE_PREFIX}${account}`;
const credentialContext = (account: string, nodeId: string) => `file-store:${account}@${nodeId}`;

function parseStore(v: unknown): OwnerFileStore | null {
  const r = v as OwnerFileStore | null | undefined;
  return r && r.spec === 'aimeat.owner-file-store/v1' && typeof r.owner === 'string' && r.target ? r : null;
}

export async function readOwnerStore(ctx: FileStoreCtx, account: string): Promise<OwnerFileStore | null> {
  const rec = await ctx.storage.getMemory(FILE_STORE_PRINCIPAL(ctx.config.nodeId), storeKey(account));
  return parseStore(rec?.value);
}

export async function writeOwnerStore(ctx: FileStoreCtx, store: OwnerFileStore): Promise<OwnerFileStore | null> {
  return updateRecord<OwnerFileStore | null>(ctx.storage, FILE_STORE_PRINCIPAL(ctx.config.nodeId), storeKey(store.owner),
    parseStore, () => store, { tag: FILE_STORE_TAG });
}

export async function updateOwnerStore(
  ctx: FileStoreCtx, account: string, mutate: (cur: OwnerFileStore | null) => OwnerFileStore | null | typeof UNCHANGED,
): Promise<OwnerFileStore | null> {
  return updateRecord<OwnerFileStore | null>(ctx.storage, FILE_STORE_PRINCIPAL(ctx.config.nodeId), storeKey(account),
    parseStore, mutate, { tag: FILE_STORE_TAG });
}

export async function deleteOwnerStore(ctx: FileStoreCtx, account: string): Promise<boolean> {
  return ctx.storage.deleteMemory(FILE_STORE_PRINCIPAL(ctx.config.nodeId), storeKey(account));
}

/** Every connected store on this node, for the operator's list. */
export async function listOwnerStores(ctx: FileStoreCtx): Promise<OwnerFileStore[]> {
  const principal = FILE_STORE_PRINCIPAL(ctx.config.nodeId);
  const { items } = await ctx.storage.listAllMemory({ prefix: OWNER_STORE_PREFIX, limit: 5000 });
  return items.filter(r => r.ownerGaii === principal).map(r => parseStore(r.value)).filter((s): s is OwnerFileStore => s !== null);
}

function parseApprovals(v: unknown): FileStoreApprovals {
  const r = v as FileStoreApprovals | null | undefined;
  return r && r.spec === 'aimeat.file-store-approvals/v1' && Array.isArray(r.owners) ? r : { spec: 'aimeat.file-store-approvals/v1', owners: [] };
}

export async function readApprovals(ctx: FileStoreCtx): Promise<FileStoreApprovals> {
  const rec = await ctx.storage.getMemory(FILE_STORE_PRINCIPAL(ctx.config.nodeId), APPROVALS_KEY);
  return parseApprovals(rec?.value);
}

export async function updateApprovals(
  ctx: FileStoreCtx, mutate: (cur: FileStoreApprovals) => FileStoreApprovals | typeof UNCHANGED,
): Promise<FileStoreApprovals> {
  return updateRecord<FileStoreApprovals>(ctx.storage, FILE_STORE_PRINCIPAL(ctx.config.nodeId), APPROVALS_KEY,
    parseApprovals, mutate, { tag: FILE_STORE_TAG });
}

/** The operator's answer for one person, or null when nobody has asked. */
export function approvalOf(rec: FileStoreApprovals, account: string): FileStoreApproval | null {
  return rec.owners.find(o => o.owner === account) ?? null;
}

/** Whether this person's own store may take new files under the node's rule right now. */
export async function ownerMayUse(ctx: FileStoreCtx, account: string): Promise<boolean> {
  const mode = ownerStoreMode(ctx.config);
  if (mode === 'self') return true;
  if (mode === 'off') return false;
  return approvalOf(await readApprovals(ctx), account)?.state === 'approved';
}

/** The credential sealed for this account. Null when the node has no encryption key: nothing is stored then. */
export function sealCredential(config: AimeatConfig, account: string, secret: Record<string, string>): string | null {
  const key = getEncryptionKey(config);
  if (!key) return null;
  return encryptBound(JSON.stringify(secret), key, credentialContext(account, config.nodeId));
}

/** The spec a person's store is reached with, or null when its credential cannot be opened here. */
export function ownerStoreSpec(config: AimeatConfig, store: OwnerFileStore): BlobSpec | null {
  const key = getEncryptionKey(config);
  if (!key) return null;
  let secret: Record<string, string>;
  try {
    secret = JSON.parse(decryptBound(store.credential, key, credentialContext(store.owner, config.nodeId))) as Record<string, string>;
  } catch (err) {
    // The node key changed since the store was connected: the store cannot be reached until the
    // person connects it again. Logged, because to everyone else it looks like a disconnected store.
    logger.warn('file store: a person\'s storage key cannot be opened with this node\'s key', {
      owner: store.owner, error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  const t = store.target;
  if (t.kind === 's3') {
    if (!secret.accessKeyId || !secret.secretAccessKey) return null;
    return {
      kind: 's3', endpoint: t.endpoint || undefined, region: t.region || 'us-east-1', bucket: t.bucket,
      accessKeyId: secret.accessKeyId, secretAccessKey: secret.secretAccessKey,
      pathStyle: t.addressing === 'auto' ? undefined : t.addressing === 'path',
    };
  }
  if (!secret.accountKey && !secret.sasToken) return null;
  return {
    kind: 'azure', accountName: t.account, container: t.container, endpoint: t.endpoint || undefined,
    accountKey: secret.accountKey || undefined, sasToken: secret.sasToken || undefined,
  };
}

export { UNCHANGED };
