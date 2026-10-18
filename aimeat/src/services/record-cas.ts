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
 * @structure CAS_ATTEMPTS · UNCHANGED · updateRecord() · updateMemoryRecord()
 * @usage await updateRecord(storage, 'package-entitlements', key, parse, cur => ({ ...cur, n: 1 }), { tag: 'x' });
 *   await updateMemoryRecord(storage, owner, key, rec => rec ? { tags: [...rec.tags, 't'] } : UNCHANGED);
 * @version-history
 *   v1.2.0 — 2026-10-19 — updateMemoryRecord(): the same conditional write for a caller that sets the
 *     record's tags or visibility as well as its value, or keeps the stored ones (check:atomic-writes).
 *   v1.1.0 — 2026-10-18 — `opts.tags`: the whole tag list, or a function of the stored record, for a
 *     caller whose blind write kept more than one tag or the stored record's own tags (wish
 *     wish-ei-atomisen-kirjoituksen-107-avointa-kohtaa-korjataan-raha-j).
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
  opts: {
    tag: string; ttlHours?: number | null; visibility?: MemoryRecord['visibility'];
    /** The tags to write in place of `[tag]`, or a function of the stored record (null when absent). */
    tags?: string[] | ((stored: MemoryRecord | null) => string[]);
  },
): Promise<T> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const rec = await storage.getMemory(owner, key);
    const cur = parse(rec?.value);
    const next = await mutate(cur);
    if (next === UNCHANGED) return cur;
    const now = new Date().toISOString();
    const tags = typeof opts.tags === 'function' ? opts.tags(rec ?? null) : opts.tags ?? [opts.tag];
    const record: MemoryRecord = {
      key, ownerGaii: owner, value: next, visibility: opts.visibility ?? 'private', tags, ttlHours: opts.ttlHours ?? null,
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

/** What a `change` of updateMemoryRecord answers: the fields this write sets. */
export type MemoryRecordChange = Partial<Pick<MemoryRecord, 'value' | 'visibility' | 'tags' | 'ttlHours' | 'groupId' | 'workspaceRef'>>;

/**
 * updateRecord for a caller that decides more than the value: `change` gets the stored record (null
 * when there is none) and answers the fields to write, or UNCHANGED. Every other field of the stored
 * record is carried over, as a write of the record that was read always did; a new record starts
 * private, untagged and without a TTL. Written on the version that was read (createMemoryIfAbsent for
 * the first write); on a conflict `change` runs again on a fresh read, so it depends only on what it is
 * given. Answers the record as written, or null when `change` wrote nothing.
 */
export async function updateMemoryRecord(
  storage: Storage, owner: string, key: string,
  change: (rec: MemoryRecord | null) => MemoryRecordChange | typeof UNCHANGED | Promise<MemoryRecordChange | typeof UNCHANGED>,
): Promise<MemoryRecord | null> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const rec = await storage.getMemory(owner, key);
    const patch = await change(rec);
    if (patch === UNCHANGED) return null;
    const now = new Date().toISOString();
    const base: MemoryRecord = rec ?? {
      key, ownerGaii: owner, value: null, visibility: 'private', tags: [], ttlHours: null, version: 0, createdAt: now, updatedAt: now,
    };
    const record: MemoryRecord = {
      ...base, ...patch, key, ownerGaii: owner, version: base.version + 1, createdAt: base.createdAt, updatedAt: now,
    };
    if (!rec) {
      if (!storage.createMemoryIfAbsent) { await storage.setMemory(record); return record; }
      if (await storage.createMemoryIfAbsent(record)) return record;
    } else {
      if (!storage.setMemoryIfVersion) { await storage.setMemory(record); return record; }
      if (await storage.setMemoryIfVersion(record, rec.version)) return record;
    }
  }
  throw new Error(`${owner} ${key} changed under every one of ${CAS_ATTEMPTS} attempts; try again`);
}
