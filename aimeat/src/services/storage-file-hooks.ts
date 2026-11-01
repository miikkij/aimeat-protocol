/**
 * @file src/services/storage-file-hooks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who is told about a stored or removed file after the fact: the content class hooks
 *   (setStorageFileHooks, one pair) and further listeners (addStorageFileListener). Moved out of
 *   ./storage-file-write.ts by extraction when the listeners joined, at its 800-line limit; the write
 *   module re-exports the names it had, so its importers are unchanged.
 * @structure StorageFileHook · setStorageFileHooks · addStorageFileListener · fileStored · fileRemoved
 * @usage addStorageFileListener((deps, ownerGaii, key) => { ... });
 * @version-history
 *   v1.0.0 — 2026-11-01 — StorageFileHook, the hooks and setStorageFileHooks moved unchanged from
 *     storage-file-write.ts; addStorageFileListener added for the data products that run when a source
 *     changes (services/dataproduct/on-change.ts, WP9c).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** A function told about a stored or removed file after the fact. It returns at once and never throws. */
export type StorageFileHook = (deps: { storage: Storage; config: AimeatConfig }, ownerGaii: string, key: string) => void;

/**
 * The hooks the write and the delete call once the file has landed or gone. Set at boot
 * (setStorageFileHooks), as the write classifier is (classify-on-write.ts): the content class
 * pipeline that listens here stores its own text files through this module, so a static import
 * would close an import cycle.
 */
const fileHooks: { afterStore?: StorageFileHook; afterRemove?: StorageFileHook } = {};

/** Set the hooks the write and the delete call. Called once at boot. */
export function setStorageFileHooks(hooks: { afterStore?: StorageFileHook; afterRemove?: StorageFileHook }): void {
    fileHooks.afterStore = hooks.afterStore;
    fileHooks.afterRemove = hooks.afterRemove;
}

/** Further listeners told about every stored and removed file, after the hooks above. */
const fileListeners: StorageFileHook[] = [];

/** Add a listener for stored and removed files. Called once at boot by each listener. */
export function addStorageFileListener(listener: StorageFileHook): void {
    if (!fileListeners.includes(listener)) fileListeners.push(listener);
}

/** Tell every listener; a listener's failure is its own and never reaches the write. */
function tellFileListeners(deps: { storage: Storage; config: AimeatConfig }, ownerGaii: string, key: string): void {
    for (const l of fileListeners) {
        try { l(deps, ownerGaii, key); } catch (err) { logger.warn('storage-file-hooks: a file listener threw', { key, error: String(err) }); }
    }
}

/** A file landed: the hook, then the listeners. */
export function fileStored(deps: { storage: Storage; config: AimeatConfig }, ownerGaii: string, key: string): void {
    fileHooks.afterStore?.(deps, ownerGaii, key);
    tellFileListeners(deps, ownerGaii, key);
}

/** A file is gone: the hook, then the listeners. */
export function fileRemoved(deps: { storage: Storage; config: AimeatConfig }, ownerGaii: string, key: string): void {
    fileHooks.afterRemove?.(deps, ownerGaii, key);
    tellFileListeners(deps, ownerGaii, key);
}
