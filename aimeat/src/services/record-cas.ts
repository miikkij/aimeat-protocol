/**
 * @file src/services/record-cas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Change one stored record without losing a concurrent writer's change: read it, apply
 *   the change, and write only if nobody wrote it meanwhile (storage setMemoryIfVersion, and
 *   createMemoryIfAbsent for the first write); on a conflict, read again and re-apply. Moved out of
 *   services/classification/system-record.ts, which now calls it, so every service record that more
 *   than one request writes has one way to do it (secaudit 2026-10, PKG-7: the package entitlement
 *   and claim records were written as a stale copy plus one change, so concurrent grants wiped each
 *   other's).
 * @structure CAS_ATTEMPTS · UNCHANGED · updateRecord()
 * @usage await updateRecord(storage, 'package-entitlements', key, parse, cur => ({ ...cur, n: 1 }), { tag: 'x' });
 * @version-history
 *   v1.0.0 — 2026-10-05 — Moved from classification/system-record.ts (secaudit 2026-10, PKG-7).
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';

export const CAS_ATTEMPTS = 10;

/** What a `mutate` answers to write nothing. */
export const UNCHANGED = Symbol('unchanged');

/**
 * Read `owner`'s record `key`, change it with `mutate`, and write it only if nobody wrote it
 * meanwhile; on a conflict read again and re-apply. `mutate` may run more than once, so it depends
 * only on what it is given. It answers UNCHANGED to write nothing. Answers the value as stored.
 */
export async function updateRecord<T>(
  storage: Storage, owner: string, key: string, parse: (v: unknown) => T,
  mutate: (cur: T) => T | typeof UNCHANGED | Promise<T | typeof UNCHANGED>,
  opts: { tag: string; ttlHours?: number | null; visibility?: MemoryRecord['visibility'] },
): Promise<T> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const rec = await storage.getMemory(owner, key);
    const cur = parse(rec?.value);
    const next = await mutate(cur);
    if (next === UNCHANGED) return cur;
    const now = new Date().toISOString();
    const record: MemoryRecord = {
      key, ownerGaii: owner, value: next, visibility: opts.visibility ?? 'private', tags: [opts.tag], ttlHours: opts.ttlHours ?? null,
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
  throw new Error(`${owner} ${key} changed under every one of ${CAS_ATTEMPTS} attempts; try again`);
}
