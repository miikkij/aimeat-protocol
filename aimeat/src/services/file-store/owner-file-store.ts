/**
 * @file src/services/file-store/owner-file-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The stores one person connected for their own files, and the operator's rule on who may
 *   connect one. Both records live in the node's own namespace (`system@<node>`), never in the
 *   person's: where a person's files go is decided by this record, and a record in their namespace
 *   could be rewritten by any agent holding memory:write, which would send every later upload to a
 *   bucket of the agent's choosing. Only the services in this folder write them.
 *
 *   SEVERAL STORES, ONE DEFAULT. A person keeps a list of named stores in one record, and `default`
 *   names the one a new file goes to when the writer does not choose. Each entry carries its own store
 *   id, the name every file in it is read by: `owner:<ghii>/<name>`. The one store a record of the
 *   first version held is read as the entry `main` with the id it was written under, `owner:<ghii>`, so
 *   its files stay readable without a migration.
 *
 *   THE CREDENTIAL is encrypted with the node key and bound to the account (encryptBound), so the
 *   ciphertext cannot be copied onto another person's record, and no route or tool returns it.
 *
 *   THE RULE. config.ownerFileStores: `self` lets everyone connect; `operator` lets the people an
 *   operator approved (FileStoreApprovals); `off` lets nobody; `auto` is `operator` on a node whose
 *   content is for signed-in accounts and `self` otherwise. It is asked on every write, so turning it
 *   off or withdrawing an approval stops new files going to the person's stores at once. Files already
 *   there stay readable.
 * @structure FILE_STORE_PRINCIPAL · OWNER_STORE_PREFIX · APPROVALS_KEY · LEGACY_STORE_NAME · OwnerStoreEntry ·
 *   OwnerFileStores · FileStoreApprovals · ownerStoreMode · ownerEntryStoreId · readOwnerStores ·
 *   updateOwnerStores · listOwnerStores · entryNamed · defaultEntry · readApprovals · updateApprovals ·
 *   approvalOf · ownerMayUse · sealCredential · ownerStoreSpec
 * @usage const rec = await readOwnerStores(ctx, 'alice'); const entry = rec && defaultEntry(rec);
 * @version-history
 *   v1.1.0 — 2026-10-30 — Several named stores per person, one of them the default; a first-version
 *     record is read as one entry named `main` (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { ownerStoreId, type BlobSpec } from '../../storage/blob/blob-types.js';
import { signedInOnly } from '../../config-visibility.js';
import { decryptBound, encryptBound, getEncryptionKey } from '../encryption.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { logger } from '../../utils/logger.js';
import { specFromTarget, type StoreTarget } from './store-target.js';

export interface FileStoreCtx { storage: Storage; config: AimeatConfig }

export const FILE_STORE_PRINCIPAL = (nodeId: string) => `system@${nodeId}`;
export const OWNER_STORE_PREFIX = 'file-store.owner.';
export const APPROVALS_KEY = 'file-store.approvals';
export const FILE_STORE_TAG = 'file-store';
/** The name the one store of a first-version record is read under. */
export const LEGACY_STORE_NAME = 'main';

/** @deprecated The shared name is StoreTarget (store-target.ts). */
export type OwnerStoreTarget = StoreTarget;

export interface OwnerStoreEntry {
  /** What the person calls it and chooses it by: `own:<name>`. */
  name: string;
  /** The id every file in it is read by: `owner:<ghii>/<name>`, or `owner:<ghii>` for a first-version store. */
  storeId: string;
  target: StoreTarget;
  /** The folder inside the bucket or container, empty or ending in `/`. */
  prefix: string;
  /** encryptBound JSON: `{ accessKeyId, secretAccessKey }` for S3, `{ accountKey }` or `{ sasToken }` for Azure. */
  credential: string;
  connectedAt: string;
  /** The principal that connected it: the person, or their agent holding secrets:manage. */
  connectedBy: string;
  /** The last connection test: written when connecting and by the test action. */
  lastCheck?: { at: string; ok: boolean; message: string };
}

export interface OwnerFileStores {
  spec: 'aimeat.owner-file-stores/v2';
  /** The account name. */
  owner: string;
  /** The entry a new file goes to when the writer names none; null when the person has none. */
  default: string | null;
  stores: OwnerStoreEntry[];
  /** Why the person wants their own storage, when the operator must approve. */
  reason?: string;
}

export interface FileStoreApproval {
  owner: string;
  /** 'approved' lets the person's stores take files; 'requested' waits for an operator; 'declined' does not. */
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

/** The id a new entry's files are read by. */
export function ownerEntryStoreId(ownerGhii: string, name: string): string {
  return `${ownerStoreId(ownerGhii)}/${name}`;
}

interface FirstVersionStore {
  spec: 'aimeat.owner-file-store/v1'; owner: string; target: StoreTarget; prefix: string; credential: string;
  connectedAt: string; connectedBy: string; lastCheck?: OwnerStoreEntry['lastCheck']; reason?: string;
}

function parseStores(nodeId: string) {
  return (v: unknown): OwnerFileStores | null => {
    const r = v as Partial<OwnerFileStores> & Partial<FirstVersionStore> | null | undefined;
    if (!r || typeof r.owner !== 'string') return null;
    if (r.spec === 'aimeat.owner-file-stores/v2' && Array.isArray(r.stores)) return r as OwnerFileStores;
    if (r.spec === 'aimeat.owner-file-store/v1' && r.target) {
      const v1 = r as FirstVersionStore;
      return {
        spec: 'aimeat.owner-file-stores/v2', owner: v1.owner, default: LEGACY_STORE_NAME,
        stores: [{
          name: LEGACY_STORE_NAME, storeId: ownerStoreId(`${v1.owner}@${nodeId}`), target: v1.target, prefix: v1.prefix,
          credential: v1.credential, connectedAt: v1.connectedAt, connectedBy: v1.connectedBy,
          ...(v1.lastCheck ? { lastCheck: v1.lastCheck } : {}),
        }],
        ...(v1.reason ? { reason: v1.reason } : {}),
      };
    }
    return null;
  };
}

/** The person's stores, or null when they never connected one. The list may be empty. */
export async function readOwnerStores(ctx: FileStoreCtx, account: string): Promise<OwnerFileStores | null> {
  const rec = await ctx.storage.getMemory(FILE_STORE_PRINCIPAL(ctx.config.nodeId), storeKey(account));
  return parseStores(ctx.config.nodeId)(rec?.value);
}

export async function updateOwnerStores(
  ctx: FileStoreCtx, account: string, mutate: (cur: OwnerFileStores | null) => OwnerFileStores | typeof UNCHANGED,
): Promise<OwnerFileStores | null> {
  return updateRecord<OwnerFileStores | null>(ctx.storage, FILE_STORE_PRINCIPAL(ctx.config.nodeId), storeKey(account),
    parseStores(ctx.config.nodeId), mutate, { tag: FILE_STORE_TAG });
}

/** Every person's stores on this node, for the operator's list and the sweep. */
export async function listOwnerStores(ctx: FileStoreCtx): Promise<OwnerFileStores[]> {
  const principal = FILE_STORE_PRINCIPAL(ctx.config.nodeId);
  const parse = parseStores(ctx.config.nodeId);
  const { items } = await ctx.storage.listAllMemory({ prefix: OWNER_STORE_PREFIX, limit: 5000 });
  return items.filter(r => r.ownerGaii === principal).map(r => parse(r.value))
    .filter((s): s is OwnerFileStores => s !== null && s.stores.length > 0);
}

export function entryNamed(rec: OwnerFileStores | null, name: string): OwnerStoreEntry | null {
  return rec?.stores.find(s => s.name === name) ?? null;
}

export function defaultEntry(rec: OwnerFileStores | null): OwnerStoreEntry | null {
  return rec?.default ? entryNamed(rec, rec.default) : null;
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

/** Whether this person's own stores may take new files under the node's rule right now. */
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

/** The spec one of a person's stores is reached with, or null when its credential cannot be opened here. */
export function ownerStoreSpec(config: AimeatConfig, account: string, entry: OwnerStoreEntry): BlobSpec | null {
  const key = getEncryptionKey(config);
  if (!key) return null;
  try {
    return specFromTarget(entry.target, JSON.parse(decryptBound(entry.credential, key, credentialContext(account, config.nodeId))) as Record<string, string>);
  } catch (err) {
    // The node key changed since the store was connected: the store cannot be reached until the
    // person connects it again. Logged, because to everyone else it looks like a disconnected store.
    logger.warn('file store: a person\'s storage key cannot be opened with this node\'s key', {
      owner: account, store: entry.name, error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export { UNCHANGED };
