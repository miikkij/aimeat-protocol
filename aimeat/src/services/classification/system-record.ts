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
 *   v1.0.0 — 2026-09-30 — Moved from classifier.ts (v2.0.0) for the exceptions list; the tag is a parameter.
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';

export const CAS_ATTEMPTS = 10;

/** What a `mutate` answers to write nothing. */
export const UNCHANGED = Symbol('unchanged');

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
  const owner = `system@${nodeId}`;
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const rec = await readSystem(storage, nodeId, key);
    const cur = parse(rec?.value);
    const next = await mutate(cur);
    if (next === UNCHANGED) return cur;
    const now = new Date().toISOString();
    const record: MemoryRecord = {
      key, ownerGaii: owner, value: next, visibility: 'private', tags: [tag], ttlHours,
      version: (rec?.version ?? 0) + 1, createdAt: rec?.createdAt ?? now, updatedAt: now,
    };
    if (!rec) {
      if (!storage.createMemoryIfAbsent) { await storage.setMemory(record); return next; }
      if (await storage.createMemoryIfAbsent(record)) return next;
    } else {
      if (!storage.setMemoryIfVersion) { await storage.setMemory(record); return next; }
      if (await storage.setMemoryIfVersion(record, rec.version)) return next;
    }
  }
  throw new Error(`classification: ${key} changed under every one of ${CAS_ATTEMPTS} attempts; try again`);
}
