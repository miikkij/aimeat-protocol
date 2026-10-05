/**
 * @file src/services/classification/system-record.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification service's own records under `system@<node>`, which no account
 *   can register, so no principal writes them except through this service: the classifier's daily
 *   counter, queues and index (classifier.ts) and the exceptions list (exceptions.ts). Every write is
 *   a compare-and-swap with retry (storage setMemoryIfVersion and createMemoryIfAbsent), so two
 *   writers of one record do not lose each other's change.
 *
 *   Moved out of classifier.ts unchanged on 2026-09-30 (a pure extraction), with the record's tag as
 *   a parameter, so the exceptions list writes the same way.
 * @structure CAS_ATTEMPTS · UNCHANGED · readSystem() · updateSystem()
 * @usage await updateSystem(storage, nodeId, key, parse, cur => ({ ...cur, n: cur.n + 1 }));
 * @version-history
 *   v1.1.0 — 2026-10-05 — The compare-and-swap loop moved to services/record-cas.ts unchanged, so other
 *     services write their records the same way; updateSystem calls it (secaudit 2026-10, PKG-7).
 *   v1.0.0 — 2026-09-30 — Moved from classifier.ts (v2.0.0) for the exceptions list; the tag is a parameter.
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { updateRecord, CAS_ATTEMPTS, UNCHANGED } from '../record-cas.js';

export { CAS_ATTEMPTS, UNCHANGED };

/** The one read of a record of system@<node>. */
export async function readSystem(storage: Storage, nodeId: string, key: string): Promise<MemoryRecord | null> {
  return storage.getMemory(`system@${nodeId}`, key);
}

/**
 * Read a record of system@<node>, change it, and write it only if nobody wrote it meanwhile; on a
 * conflict read again and re-apply. `mutate` may run more than once, so it depends only on what it
 * is given. It answers UNCHANGED to write nothing. Answers the value as stored.
 */
export async function updateSystem<T>(
  storage: Storage, nodeId: string, key: string, parse: (v: unknown) => T,
  mutate: (cur: T) => T | typeof UNCHANGED | Promise<T | typeof UNCHANGED>, ttlHours: number | null = null,
  tag = 'classification-classifier',
): Promise<T> {
  return updateRecord(storage, `system@${nodeId}`, key, parse, mutate, { tag, ttlHours });
}
