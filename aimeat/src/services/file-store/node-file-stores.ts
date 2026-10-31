/**
 * @file src/services/file-store/node-file-stores.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The named stores an operator adds for the whole node, beside the one the environment
 *   names (config-file-store.ts). One record in the node's own namespace (`system@<node>`) holds the
 *   list and the name of the default: a new file goes to the default when its writer chooses no store.
 *   With no default named, new files go where the environment's store setting says, as before.
 *
 *   THE KEYS are typed by an operator on the admin page or through chat and kept in this record,
 *   encrypted with the node key and bound to the node (encryptBound), so no route or tool returns
 *   them and the ciphertext opens on no other node. Jouni ruled this on 2026-10-30: a store added
 *   needs no server change and no restart.
 *
 *   WHO MAY CHOOSE ONE. `selectable` says whether every person on the node may name the store for a
 *   file of theirs. An operator may name any store. The default takes everybody's files either way.
 *
 *   THE ID of a named store is `node:<name>`. The environment's store keeps `node:s3` or `node:azure`,
 *   so `s3`, `azure` and `database` are not names a store can have.
 * @structure NODE_STORES_KEY · RESERVED_NODE_STORE_NAMES · NodeStoreEntry · NodeFileStores · nodeEntryStoreId ·
 *   readNodeStores · updateNodeStores · nodeEntryNamed · sealNodeCredential · nodeStoreView · nodeEntrySpec
 * @usage const rec = await readNodeStores(ctx); const entry = nodeEntryNamed(rec, rec.default);
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 */
import type { AimeatConfig } from '../../config.js';
import type { BlobSpec } from '../../storage/blob/blob-types.js';
import { decryptBound, encryptBound, getEncryptionKey } from '../encryption.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { logger } from '../../utils/logger.js';
import { placeOf, specFromTarget, whereOf, type StoreTarget } from './store-target.js';
import { FILE_STORE_PRINCIPAL, FILE_STORE_TAG, type FileStoreCtx } from './owner-file-store.js';

export const NODE_STORES_KEY = 'file-store.node-stores';
/** The kinds the environment's store is named by, and the place a file in no store is in. */
export const RESERVED_NODE_STORE_NAMES = ['s3', 'azure', 'database'] as const;

export interface NodeStoreEntry {
  name: string;
  target: StoreTarget;
  /** The folder inside the bucket or container, ending in `/`. */
  prefix: string;
  /** encryptBound JSON, as an owner store's: `{ accessKeyId, secretAccessKey }`, `{ accountKey }` or `{ sasToken }`. */
  credential: string;
  /** Whether every person may choose this store for a file of theirs. */
  selectable: boolean;
  addedAt: string;
  addedBy: string;
  lastCheck?: { at: string; ok: boolean; message: string };
}

export interface NodeFileStores {
  spec: 'aimeat.node-file-stores/v1';
  /** The store a new file goes to when its writer names none; null: the environment's setting decides. */
  default: string | null;
  stores: NodeStoreEntry[];
}

const credentialContext = (nodeId: string) => `file-store:node@${nodeId}`;

export function nodeEntryStoreId(name: string): string {
  return `node:${name}`;
}

function parse(v: unknown): NodeFileStores {
  const r = v as NodeFileStores | null | undefined;
  return r && r.spec === 'aimeat.node-file-stores/v1' && Array.isArray(r.stores)
    ? r : { spec: 'aimeat.node-file-stores/v1', default: null, stores: [] };
}

export async function readNodeStores(ctx: FileStoreCtx): Promise<NodeFileStores> {
  const rec = await ctx.storage.getMemory(FILE_STORE_PRINCIPAL(ctx.config.nodeId), NODE_STORES_KEY);
  return parse(rec?.value);
}

export async function updateNodeStores(
  ctx: FileStoreCtx, mutate: (cur: NodeFileStores) => NodeFileStores | typeof UNCHANGED,
): Promise<NodeFileStores> {
  return updateRecord<NodeFileStores>(ctx.storage, FILE_STORE_PRINCIPAL(ctx.config.nodeId), NODE_STORES_KEY,
    parse, mutate, { tag: FILE_STORE_TAG });
}

export function nodeEntryNamed(rec: NodeFileStores, name: string | null | undefined): NodeStoreEntry | null {
  return name ? rec.stores.find(s => s.name === name) ?? null : null;
}

/** The credential sealed for this node. Null when the node has no encryption key: nothing is stored then. */
export function sealNodeCredential(config: AimeatConfig, secret: Record<string, string>): string | null {
  const key = getEncryptionKey(config);
  if (!key) return null;
  return encryptBound(JSON.stringify(secret), key, credentialContext(config.nodeId));
}

/** One named store as the operator's page and tool show it. `files` from countStorageFilesByStore. */
export function nodeStoreView(ctx: FileStoreCtx, rec: NodeFileStores, e: NodeStoreEntry, files: { count: number; bytes: number }) {
  return {
    name: e.name, store: nodeEntryStoreId(e.name), default: rec.default === e.name, selectable: e.selectable,
    kind: e.target.kind, where: whereOf(e.target), place: placeOf(e.target), prefix: e.prefix,
    added_at: e.addedAt, added_by: e.addedBy, last_check: e.lastCheck ?? null,
    // False when the node's key no longer opens the store's key: an operator enters it again.
    reachable: nodeEntrySpec(ctx.config, e) !== null,
    files,
  };
}

/** The spec a named node store is reached with, or null when its credential cannot be opened here. */
export function nodeEntrySpec(config: AimeatConfig, entry: NodeStoreEntry): BlobSpec | null {
  const key = getEncryptionKey(config);
  if (!key) return null;
  try {
    return specFromTarget(entry.target, JSON.parse(decryptBound(entry.credential, key, credentialContext(config.nodeId))) as Record<string, string>);
  } catch (err) {
    // The node key changed since the store was added: an operator enters its key again.
    logger.warn('file store: a node store\'s key cannot be opened with this node\'s key', {
      store: entry.name, error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export { UNCHANGED };
