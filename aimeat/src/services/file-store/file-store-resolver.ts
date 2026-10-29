/**
 * @file src/services/file-store/file-store-resolver.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which store a file goes to and which store a reference is read from: the decision the
 *   storage wrapper (storage/blob/file-store-wrap.ts) asks for on every write and every read.
 *
 *   A WRITE goes to the store its owner connected, when the node's rule lets that person use one
 *   right now (owner-file-store.ts ownerMayUse); else to the node's store when the operator set one
 *   and its settings are complete; else to the database. An agent's or an app's file goes where its
 *   owner's would, because the files are the person's. An identity of another node, an extension and
 *   the node itself have no owner here and use the node's store.
 *
 *   A READ goes to the store the reference names, whatever new files do now. A person's store is
 *   read while its record exists, approved or not: the rule decides where new files go, never whether
 *   a person can read the files they already have.
 * @structure createFileStoreResolver · ownerTarget · nodeTarget · writesToOwnStore · installFileStores
 * @usage installFileStores(storage, config);   // once, after createStorage and the config overrides
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { nodeStoreId, ownerStoreId, type BlobStore } from '../../storage/blob/blob-types.js';
import { wrapStorageWithFileStores, type FileStoreResolver, type FileStoreTarget } from '../../storage/blob/file-store-wrap.js';
import { localAccountOf, ownerGhiiOf } from '../../utils/gaii.js';
import { nodeStoreSpec, storeFor } from './file-store-specs.js';
import { ownerMayUse, ownerStoreSpec, readOwnerStore, type FileStoreCtx } from './owner-file-store.js';

/** The local account behind an identity, when it is a person of this node; null otherwise. */
function localOwner(config: AimeatConfig, identity: string): { account: string; ghii: string } | null {
  const ghii = ownerGhiiOf(identity);
  const account = localAccountOf(ghii);
  if (!account || ghii !== `${account}@${config.nodeId}`) return null;
  return { account, ghii };
}

/** The person's own store, when it may take this identity's new file now. */
export async function ownerTarget(ctx: FileStoreCtx, identity: string): Promise<FileStoreTarget | null> {
  const who = localOwner(ctx.config, identity);
  if (!who) return null;
  const rec = await readOwnerStore(ctx, who.account);
  if (!rec || !(await ownerMayUse(ctx, who.account))) return null;
  const spec = ownerStoreSpec(ctx.config, rec);
  return spec ? { storeId: ownerStoreId(who.ghii), store: storeFor(spec, 'guarded', ctx.config), prefix: rec.prefix } : null;
}

/** The node's store for new files, when one is set and complete. */
export function nodeTarget(config: AimeatConfig): FileStoreTarget | null {
  const r = nodeStoreSpec(config);
  if (!('spec' in r)) return null;
  return { storeId: nodeStoreId(r.spec.kind), store: storeFor(r.spec, 'trusted'), prefix: r.prefix };
}

/** For the storage quota: does this identity's next file go to its owner's own store? Those files
 *  are kept at the person's expense, so the node's quota does not count them. */
export async function writesToOwnStore(ctx: FileStoreCtx, identity: string): Promise<boolean> {
  return (await ownerTarget(ctx, identity)) !== null;
}

export function createFileStoreResolver(ctx: FileStoreCtx): FileStoreResolver {
  return {
    async forWrite(ownerGaii) {
      return (await ownerTarget(ctx, ownerGaii)) ?? nodeTarget(ctx.config);
    },
    async forRead(storeId): Promise<BlobStore | null> {
      if (storeId === nodeStoreId('s3') || storeId === nodeStoreId('azure')) {
        const r = nodeStoreSpec(ctx.config, storeId === nodeStoreId('s3') ? 's3' : 'azure');
        return 'spec' in r ? storeFor(r.spec, 'trusted') : null;
      }
      if (storeId.startsWith('owner:')) {
        const who = localOwner(ctx.config, storeId.slice('owner:'.length));
        const rec = who ? await readOwnerStore(ctx, who.account) : null;
        const spec = rec ? ownerStoreSpec(ctx.config, rec) : null;
        return spec ? storeFor(spec, 'guarded', ctx.config) : null;
      }
      return null;
    },
  };
}

/** Wrap the node's storage so every file write and read goes through the resolver. Reads the config
 *  live, so a change on the Config tab takes effect on the next file without a restart. */
export function installFileStores(storage: Storage, config: AimeatConfig): void {
  wrapStorageWithFileStores(storage, createFileStoreResolver({ storage, config }));
}
