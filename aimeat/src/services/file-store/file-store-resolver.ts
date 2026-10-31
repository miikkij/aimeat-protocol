/**
 * @file src/services/file-store/file-store-resolver.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which store a file goes to and which store a reference is read from: the decision the
 *   storage wrapper (storage/blob/file-store-wrap.ts) asks for on every write and every read.
 *
 *   A WRITE WITH A CHOICE goes to the store its writer named: `own:<name>`, one of the stores the
 *   file's owner connected, or `node:<name>`, one of the node's. resolveChoice says why a choice cannot
 *   be taken (no such store, the node's rule does not let the person use their own stores now, a node
 *   store the operator did not open to everyone). The upload services ask it before any byte moves;
 *   the wrapper asks it again at the write, so a store removed in between refuses the write.
 *
 *   A WRITE WITHOUT ONE goes to the person's default store, when the node's rule lets that person use
 *   their own stores right now (owner-file-store.ts ownerMayUse); else to the node's default named
 *   store; else to the store the environment names, when its settings are complete; else to the
 *   database. An agent's or an app's file goes where its owner's would, because the files are the
 *   person's. An identity of another node, an extension and the node itself have no owner here.
 *
 *   A READ goes to the store the reference names, whatever new files do now. A person's store is
 *   read while its entry exists, approved or not: the rule decides where new files go, never whether
 *   a person can read the files they already have.
 * @structure StoreRefusal · choiceIdOf · ownerTarget · nodeEnvTarget · nodeTarget · resolveChoice ·
 *   writesToOwnStore · createFileStoreResolver · installFileStores
 * @usage installFileStores(storage, config);   // once, after createStorage and the config overrides
 * @version-history
 *   v1.1.0 — 2026-10-30 — A write may name its store (resolveChoice); the person's and the node's named
 *     stores each have a default; nodeTarget reads the named stores and is async
 *     (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { BlobStoreError, nodeStoreId, type BlobStore } from '../../storage/blob/blob-types.js';
import { wrapStorageWithFileStores, type FileStoreResolver, type FileStoreTarget } from '../../storage/blob/file-store-wrap.js';
import { localAccountOf, ownerGhiiOf } from '../../utils/gaii.js';
import { nodeStoreSpec, storeFor } from './file-store-specs.js';
import {
  defaultEntry, entryNamed, LEGACY_STORE_NAME, ownerMayUse, ownerStoreSpec, readOwnerStores,
  type FileStoreCtx, type OwnerStoreEntry,
} from './owner-file-store.js';
import { nodeEntryNamed, nodeEntrySpec, nodeEntryStoreId, readNodeStores, type NodeStoreEntry } from './node-file-stores.js';

export type StoreRefusal = { ok: false; status: number; code: string; message: string };
const refuse = (status: number, code: string, message: string): StoreRefusal => ({ ok: false, status, code, message });

/** The local account behind an identity, when it is a person of this node; null otherwise. */
function localOwner(config: AimeatConfig, identity: string): { account: string; ghii: string } | null {
  const ghii = ownerGhiiOf(identity);
  const account = localAccountOf(ghii);
  if (!account || ghii !== `${account}@${config.nodeId}`) return null;
  return { account, ghii };
}

/**
 * What a person reads and names for the store an id points at: `database`, `node:<name>` (the
 * environment's store is `node:s3` or `node:azure`), or `own:<name>` for one of the file owner's own.
 */
export function choiceIdOf(storeId: string | null | undefined): string {
  if (!storeId) return 'database';
  if (storeId.startsWith('owner:')) {
    const slash = storeId.indexOf('/');
    return `own:${slash < 0 ? LEGACY_STORE_NAME : storeId.slice(slash + 1)}`;
  }
  return storeId;
}

function ownerEntryTarget(ctx: FileStoreCtx, account: string, entry: OwnerStoreEntry): FileStoreTarget | null {
  const spec = ownerStoreSpec(ctx.config, account, entry);
  return spec ? { storeId: entry.storeId, store: storeFor(spec, 'guarded', ctx.config), prefix: entry.prefix } : null;
}

function nodeEntryTarget(ctx: FileStoreCtx, entry: NodeStoreEntry): FileStoreTarget | null {
  const spec = nodeEntrySpec(ctx.config, entry);
  return spec ? { storeId: nodeEntryStoreId(entry.name), store: storeFor(spec, 'trusted'), prefix: entry.prefix } : null;
}

/** The person's default store, when it may take this identity's new file now. */
export async function ownerTarget(ctx: FileStoreCtx, identity: string): Promise<FileStoreTarget | null> {
  const who = localOwner(ctx.config, identity);
  if (!who) return null;
  const entry = defaultEntry(await readOwnerStores(ctx, who.account));
  if (!entry || !(await ownerMayUse(ctx, who.account))) return null;
  return ownerEntryTarget(ctx, who.account, entry);
}

/** The store the environment names, when one is set and complete. */
export function nodeEnvTarget(config: AimeatConfig, kind?: 's3' | 'azure'): FileStoreTarget | null {
  const r = nodeStoreSpec(config, kind);
  if (!('spec' in r)) return null;
  return { storeId: nodeStoreId(r.spec.kind), store: storeFor(r.spec, 'trusted'), prefix: r.prefix };
}

/** The node's store for new files: the default named store, else the environment's, else none. */
export async function nodeTarget(ctx: FileStoreCtx): Promise<FileStoreTarget | null> {
  const rec = await readNodeStores(ctx);
  const entry = nodeEntryNamed(rec, rec.default);
  return (entry && nodeEntryTarget(ctx, entry)) || nodeEnvTarget(ctx.config);
}

/**
 * The store a writer named for a file of `identity`, or why it cannot take the file. `operator` lets
 * the writer name a node store that is not open to everyone, and the environment's own store.
 */
export async function resolveChoice(
  ctx: FileStoreCtx, identity: string, choice: string, opts: { operator: boolean },
): Promise<{ ok: true; target: FileStoreTarget } | StoreRefusal> {
  const sep = choice.indexOf(':');
  const space = sep > 0 ? choice.slice(0, sep) : '';
  const name = choice.slice(sep + 1);
  if (space === 'own') {
    const who = localOwner(ctx.config, identity);
    if (!who) return refuse(403, 'NO_OWN_STORAGE', 'Only a person of this node, and their agents and apps, have storage of their own here.');
    const entry = entryNamed(await readOwnerStores(ctx, who.account), name);
    if (!entry) return refuse(404, 'UNKNOWN_STORE', `There is no own storage called "${name}". aimeat_file_store_get lists the stores you may choose.`);
    if (!(await ownerMayUse(ctx, who.account))) {
      return refuse(409, 'STORE_NOT_TAKING_FILES', 'Your own storage does not take new files now: the operators of this node have not approved it, or they turned own storage off.');
    }
    const target = ownerEntryTarget(ctx, who.account, entry);
    return target ? { ok: true, target } : refuse(409, 'STORE_NOT_REACHABLE', `The node cannot open the key of your storage "${name}". Connect it again.`);
  }
  if (space === 'node') {
    if (name === 's3' || name === 'azure') {
      if (!opts.operator) return refuse(403, 'STORE_NOT_SELECTABLE', `The node store "${name}" is not open for people to choose.`);
      const target = nodeEnvTarget(ctx.config, name);
      return target ? { ok: true, target } : refuse(409, 'STORE_NOT_REACHABLE', `The node's ${name} store is not set up completely.`);
    }
    const entry = nodeEntryNamed(await readNodeStores(ctx), name);
    if (!entry) return refuse(404, 'UNKNOWN_STORE', `There is no node store called "${name}". aimeat_file_store_get lists the stores you may choose.`);
    if (!entry.selectable && !opts.operator) return refuse(403, 'STORE_NOT_SELECTABLE', `The node store "${name}" is not open for people to choose.`);
    const target = nodeEntryTarget(ctx, entry);
    return target ? { ok: true, target } : refuse(409, 'STORE_NOT_REACHABLE', `The node cannot open the key of the node store "${name}".`);
  }
  return refuse(400, 'INVALID_INPUT', 'store is "own:<name>" for one of your own stores or "node:<name>" for one of the node\'s.');
}

/** For the storage quota: does this identity's next file go to its owner's own store? Those files
 *  are kept at the person's expense, so the node's quota does not count them. */
export async function writesToOwnStore(ctx: FileStoreCtx, identity: string, choice?: string): Promise<boolean> {
  if (choice) return choice.startsWith('own:');
  return (await ownerTarget(ctx, identity)) !== null;
}

export function createFileStoreResolver(ctx: FileStoreCtx): FileStoreResolver {
  return {
    async forWrite(ownerGaii, choice) {
      if (choice) {
        // The upload services asked with the writer's own rights before any byte moved; asked again
        // here so a store removed or closed in between refuses the write instead of losing the choice.
        const r = await resolveChoice(ctx, ownerGaii, choice, { operator: true });
        if (!r.ok) throw new BlobStoreError(r.message, r.status, r.code);
        return r.target;
      }
      return (await ownerTarget(ctx, ownerGaii)) ?? (await nodeTarget(ctx));
    },
    async forRead(storeId): Promise<BlobStore | null> {
      if (storeId === nodeStoreId('s3') || storeId === nodeStoreId('azure')) {
        return nodeEnvTarget(ctx.config, storeId === nodeStoreId('s3') ? 's3' : 'azure')?.store ?? null;
      }
      if (storeId.startsWith('node:')) {
        const entry = nodeEntryNamed(await readNodeStores(ctx), storeId.slice('node:'.length));
        return entry ? nodeEntryTarget(ctx, entry)?.store ?? null : null;
      }
      if (storeId.startsWith('owner:')) {
        const rest = storeId.slice('owner:'.length);
        const slash = rest.indexOf('/');
        const who = localOwner(ctx.config, slash < 0 ? rest : rest.slice(0, slash));
        if (!who) return null;
        const entry = (await readOwnerStores(ctx, who.account))?.stores.find(s => s.storeId === storeId);
        return entry ? ownerEntryTarget(ctx, who.account, entry)?.store ?? null : null;
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
