/**
 * @file src/services/memory-list-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The values of one page of a memory listing, read after the listing itself.
 *
 *   GET /v1/memory?limit=N used to read every matching record WITH its value, run the classification
 *   reader over all of them, and only then cut the page; then it serialised every value again to sum
 *   `quota.used_bytes` (codebase analysis 2026-11-03, item C1). A bounded listing now decides which
 *   rows match from the meta rows (no value column), and reads the values of the page only.
 *
 *   THE ANSWER STAYS THE SAME. The meta listing has the same filters and the same order as the value
 *   listing (the same WHERE on both providers, only the column list differs), the classification
 *   reader decides from the record's address and never from its value, and the credential mask is
 *   applied to each value of the page as presentMemories applies it. `used_bytes` was the sum of
 *   `JSON.stringify` of each SHOWN value: for a key the mask never changes, that is the stored
 *   `byteSize`, which both providers write from the same `JSON.stringify` on every write; for a key
 *   the mask may change (shownMemoryValue: the credential records and a workspace share record), and
 *   for a row whose byteSize was never written, the value is read and measured as before.
 * @structure memoryPageWithValues(storage, page) · shownMemoryBytes(storage, rows)
 * @usage
 *   const records = await memoryPageWithValues(storage, matched.slice(0, limit));
 *   const usedBytes = await shownMemoryBytes(storage, matched);
 * @version-history
 *   2026-11-04 — No per-key getMemory for a storage without getMemoryByKeys: it is required on Storage
 *     (codebase analysis 2026-11-03, item D-e).
 *   2026-11-04 — Initial (codebase analysis 2026-11-03, item C1).
 */
import type { MemoryRecord, Storage } from '../storage/interface.js';
import type { MemoryMetaRow } from '../storage/repositories/memory.repository.js';
import { isSecretRecordKey, isWorkspaceShareKey, shownMemoryValue } from './secret-records.js';

/** What a listing row carries besides its columns: the owner-scope shadow list and the classification warning. */
type ListedMeta = MemoryMetaRow & { alsoUnder?: string[]; classificationWarning?: unknown };

const addressOf = (ownerGaii: string, key: string): string => `${ownerGaii}\n${key}`;

/** True when shownMemoryValue may show something other than the stored value for this key. */
function maskedKey(key: string): boolean {
    return isSecretRecordKey(key) || isWorkspaceShareKey(key);
}

/** The records at these addresses, one read per owner, by address. Rows gone since the listing are absent. */
async function recordsAt(storage: Storage, rows: ReadonlyArray<{ ownerGaii: string; key: string }>): Promise<Map<string, MemoryRecord>> {
    const keysByOwner = new Map<string, string[]>();
    for (const r of rows) {
        const keys = keysByOwner.get(r.ownerGaii);
        if (keys) keys.push(r.key); else keysByOwner.set(r.ownerGaii, [r.key]);
    }
    const out = new Map<string, MemoryRecord>();
    for (const [owner, keys] of keysByOwner) {
        const found = await storage.getMemoryByKeys(owner, keys);
        for (const r of found) out.set(addressOf(r.ownerGaii, r.key), r);
    }
    return out;
}

/**
 * The page's records with their values as they may be shown, in the page's order, each carrying the
 * listing row's `alsoUnder` and `classificationWarning`. A row deleted between the listing and this
 * read is left out.
 */
export async function memoryPageWithValues(storage: Storage, page: readonly ListedMeta[]): Promise<MemoryRecord[]> {
    const found = await recordsAt(storage, page);
    const out: MemoryRecord[] = [];
    for (const row of page) {
        const rec = found.get(addressOf(row.ownerGaii, row.key));
        if (!rec) continue;
        out.push({
            ...rec,
            value: shownMemoryValue(rec.key, rec.value),
            ...(row.alsoUnder ? { alsoUnder: row.alsoUnder } : {}),
            ...(row.classificationWarning !== undefined ? { classificationWarning: row.classificationWarning } : {}),
        } as MemoryRecord);
    }
    return out;
}

/** The sum of the UTF-8 length of `JSON.stringify` of each row's shown value: the value listing's `used_bytes`. */
export async function shownMemoryBytes(storage: Storage, rows: readonly MemoryMetaRow[]): Promise<number> {
    let total = 0;
    const measure: MemoryMetaRow[] = [];
    for (const r of rows) {
        if (maskedKey(r.key) || !(r.byteSize > 0)) measure.push(r);
        else total += r.byteSize;
    }
    if (measure.length === 0) return total;
    const found = await recordsAt(storage, measure);
    for (const r of measure) {
        const rec = found.get(addressOf(r.ownerGaii, r.key));
        total += rec ? Buffer.byteLength(JSON.stringify(shownMemoryValue(rec.key, rec.value)), 'utf8') : r.byteSize;
    }
    return total;
}
