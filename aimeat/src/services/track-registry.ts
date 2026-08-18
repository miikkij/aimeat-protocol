/**
 * @file track-registry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Generic in-process registry of "tracked" memory keys for the Memory Contract pattern
 *   (docs/coding-guidelines/memory-contracts.md). A reactive contract (e.g. a Tracked Response)
 *   declares a memory key it watches; this registry holds the set of watched keys so the memory-write
 *   hook can answer "is this written key watched?" in O(1) before doing any heavier evaluation. The set
 *   is process-local and derived: it is rebuilt at boot from the live contracts (the contracts are the
 *   source of truth) and updated as contracts are created/cancelled/fulfilled. The reconciler sweep is
 *   the safety net for anything the in-memory set misses (missed event, restart mid-flight).
 * @structure trackKey / untrackKey / isTracked / rebuildTrackRegistry
 * @usage import { isTracked, trackKey } from '../services/track-registry.js';
 * @version-history
 *   v1.0.0 — 2026-06-21 — Initial registry (first consumer: Tracked Response).
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** watchedKey → count of active contracts watching it (refcount so one key can back several contracts). */
const watched = new Map<string, number>();

/** Prefixes of memory namespaces that hold reactive contracts, scanned at boot to rebuild the set. */
const CONTRACT_PREFIXES = ['tracked-response.'];

/** Pull the watched memory key out of a contract record value, if it is an active reactive contract. */
function watchedKeyOf(value: unknown): string | null {
  const v = value as { type?: string; state?: string; watch?: { key?: string } } | null;
  if (!v || typeof v !== 'object') return null;
  if (v.type !== 'tracked-response') return null;
  if (v.state === 'replied' || v.state === 'cancelled') return null;   // terminal → not watching
  const key = v.watch?.key;
  return typeof key === 'string' && key ? key : null;
}

/** Register a watched key (idempotent refcount). */
export function trackKey(key: string): void {
  watched.set(key, (watched.get(key) || 0) + 1);
}

/** Deregister a watched key (refcount; removed at zero). Safe to call for an unknown key. */
export function untrackKey(key: string): void {
  const n = watched.get(key);
  if (!n) return;
  if (n <= 1) watched.delete(key);
  else watched.set(key, n - 1);
}

/** O(1): is this memory key watched by any active contract? */
export function isTracked(key: string): boolean {
  return watched.has(key);
}

/** Current watched-key count (diagnostics / tests). */
export function trackedKeyCount(): number {
  return watched.size;
}

/**
 * Rebuild the watched-key set from the live contracts across all owners. Called once at startup so the
 * reactive hook survives restarts; the contracts themselves are the source of truth. Best-effort.
 */
export async function rebuildTrackRegistry(storage: Storage): Promise<void> {
  watched.clear();
  for (const prefix of CONTRACT_PREFIXES) {
    try {
      const { items } = await storage.listAllMemory({ prefix, limit: 10_000 });
      for (const rec of items) {
        const key = watchedKeyOf(rec.value);
        if (key) trackKey(key);
      }
    } catch (err) {
      logger.warn(`track-registry rebuild failed for prefix ${prefix}: ${String((err as Error).message || err)}`);
    }
  }
  logger.info(`Track registry rebuilt: ${watched.size} watched key(s)`);
}
