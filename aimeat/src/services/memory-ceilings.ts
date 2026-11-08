/**
 * @file src/services/memory-ceilings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three limits a memory write answers to, in one place.
 *
 *   A value may hold at most `memoryMaxValueSizeKb`. A principal may hold at most
 *   `memoryMaxKeysPerAgent` keys. And the bytes together must fit the owner's paid budget, with the
 *   excess charged as overage.
 *
 *   They were written out twice: once in services/memory-write.ts for a single record, and once in
 *   services/workspace-write-guards.ts for a workspace batch. The workspace path deliberately does
 *   NOT go through writeMemoryRecord — it has its own owner-collapse rule, one owner per key — but
 *   that is a reason to share the CEILINGS, not a reason to copy them. Two copies of a limit agree
 *   until the day somebody raises one, and nobody notices a ceiling that stopped holding.
 *
 *   Written for a SET of records, because the batch case is the general one: a single write is a set
 *   of one, and the byte budget has to be measured over the whole set or a batch of fifty small
 *   records each passes on its own and the batch still lands over the line.
 * @structure
 *   - memoryCeilingRefusal() — value size, key count and byte budget for a planned set
 *   - flipWithinCeilings() — a restore or unarchive kept only when it leaves every principal it grew within the limits
 * @usage
 *   const refusal = await memoryCeilingRefusal({ storage, config }, target, [{ key, value }]);
 *   if (refusal) return { ok: false, ...refusal };
 *   const kept = await flipWithinCeilings({ storage, config }, [owner], () => storage.restoreMemory(owner, key), words);
 * @version-history
 *   2026-11-08 — flipWithinCeilings: a restore from the bin and an unarchive ask the key ceiling and
 *     the byte quota, and a refusal names the setting (secaudit2026nov08 round 14,
 *     services/memory-ceilings:count-returning-transitions-skip-ceiling).
 *   2026-11-04 — No countMemory and sumMemoryBytes for a storage without getMemoryTotals: it is
 *     required on Storage (codebase analysis 2026-11-03, item D-e).
 *   2026-11-04 — The key count and the byte total come from one read of the kept totals
 *     (storage.getMemoryTotals), and a record the caller already read is passed in `known` instead
 *     of being read again; the answers are the same (codebase analysis 2026-11-03, item C3).
 *   v1.0.1 — 2026-10-25 — The node's own UCP records under a seller (NODE_BOOKKEEPING_PREFIXES) are
 *     left out of the owner's key count (secaudit2026oct22).
 *   v1.0.0 — 2026-08-11 — Extracted after the audit's own diff was checked for duplication: the same
 *     three ceilings existed in memory-write.ts and workspace-write-guards.ts.
 */
import type { AimeatConfig } from '../config.js';
import type { MemoryRecord, Storage } from '../storage/interface.js';
import { checkMemoryQuota, chargeOverage } from './quota.js';

export interface CeilingRefusal {
    status: number;
    code: 'QUOTA_EXCEEDED';
    message: string;
    /** Which item of the planned set failed, for a batch that wants to say so. */
    index?: number;
}

/** What the caller intends to write. `value` is the stored value, before serialisation. */
export interface PlannedWrite { key: string; value: unknown }

/** What the check measured, for the caller's own alarm and reporting. */
export interface CeilingMeasurement {
    /** Keys held before this write, taken only when the set adds at least one new key. */
    keyCount?: number;
    /** Bytes held after this write would land. */
    usedBytes: number;
}

export type CeilingResult =
    | { ok: true; measured: CeilingMeasurement }
    | { ok: false; refusal: CeilingRefusal };

/**
 * Do these writes fit?
 *
 * Refuses on the first value over the per-value ceiling, then on the key count if the set adds new
 * keys, then on the byte budget for the whole set. Charges the overage where the quota is measured,
 * because a caller that has to remember to charge it is a caller that will one day forget.
 */
export async function memoryCeilings(
    deps: { storage: Storage; config: AimeatConfig },
    targetGaii: string,
    planned: PlannedWrite[],
    /** The records the caller already read by key (storage.getMemory, null for none), so they are not read twice. */
    known?: ReadonlyMap<string, MemoryRecord | null>,
): Promise<CeilingResult> {
    const { storage, config } = deps;
    const maxValueBytes = config.memoryMaxValueSizeKb * 1024;

    let additional = 0;
    let replacing = 0;
    let newKeys = 0;

    for (const [i, p] of planned.entries()) {
        const size = Buffer.byteLength(JSON.stringify(p.value), 'utf8');
        if (size > maxValueBytes) {
            return {
                ok: false,
                refusal: {
                    status: 413, code: 'QUOTA_EXCEEDED', index: i,
                    message: `Value size ${size} bytes exceeds limit of ${maxValueBytes} bytes`,
                },
            };
        }
        additional += size;
        const row = known?.has(p.key) ? known.get(p.key) ?? null : await storage.getMemory(targetGaii, p.key);
        if (row) replacing += Buffer.byteLength(JSON.stringify(row.value), 'utf8');
        else newKeys++;
    }

    // The writer's key count and byte total as the database keeps them (storage/memory-totals.ts), one
    // read of a few rows. Until 2026-11-04 every write summed every row of the writer, and a write that
    // added a key also counted them (codebase analysis 2026-11-03, item C3).
    const totals = await storage.getMemoryTotals(targetGaii);

    // An UPDATE never grows the key count, so the count is only taken when the set adds a key.
    let keyCount: number | undefined;
    if (newKeys > 0) {
        // The node's own expiring UCP records under a seller (idempotency claims, guest checkouts)
        // are written by the node for platforms with no account here, so they do not use up the
        // owner's own key limit (secaudit2026oct22): the kept totals leave them out
        // (MEMORY_COUNT_EXCLUDED_PREFIXES, storage/memory-totals.ts).
        keyCount = totals.keys;
        if (keyCount + newKeys > config.memoryMaxKeysPerAgent) {
            // The remedy named here matters: "delete unused keys" sends someone who hit the wall
            // through one-key-per-small-fact off to delete data instead of fixing the shape that
            // will refill the space next week.
            return {
                ok: false,
                refusal: {
                    status: 413, code: 'QUOTA_EXCEEDED',
                    message: `Memory key limit reached (${config.memoryMaxKeysPerAgent}). One value may hold `
                        + `${config.memoryMaxValueSizeKb} kB, so fold a set of small keys into one record holding `
                        + 'an array or an object keyed by id, rather than deleting data.',
                },
            };
        }
    }

    const quota = await checkMemoryQuota(config, storage, targetGaii, additional, replacing, totals.bytes);
    if (!quota.allowed) {
        return { ok: false, refusal: { status: 413, code: 'QUOTA_EXCEEDED', message: quota.reason ?? 'Storage quota exceeded' } };
    }
    // Overage is charged where the quota is measured. It was billed on the HTTP path only, so a
    // write over MCP consumed the space and nobody paid for it.
    if (quota.overageMorsels > 0) {
        await chargeOverage(storage, targetGaii, quota.overageMorsels, 'memory_overage');
    }

    return {
        ok: true,
        measured: {
            ...(keyCount !== undefined ? { keyCount: keyCount + newKeys } : {}),
            usedBytes: quota.currentBytes - replacing + additional,
        },
    };
}

/** Thrown inside the transaction of flipWithinCeilings to roll the flip back. */
class CeilingRollback extends Error {
    constructor(readonly refusal: CeilingRefusal) { super(refusal.message); }
}

/**
 * Run a flip that returns stored rows to principals' totals (a restore from the bin, an unarchive) and
 * keep it only when no principal it grew ends past the key ceiling or the byte quota
 * (secaudit2026nov08 round 14, count-returning-transitions-skip-ceiling).
 *
 * The flip runs in one transaction; the kept totals (storage/memory-totals.ts) are read before it and
 * after it in the same transaction, so what the flip returned is measured by the same triggers that
 * count it on either provider (PostgreSQL counts no bytes for an archived row, SQLite counts every
 * row). A principal past a limit rolls the flip back. Only growth is refused: a principal the flip
 * did not grow is never refused for being over a limit already. Overage within the quota is charged
 * as a write's is. `owners` may name more principals than the flip touches.
 */
export async function flipWithinCeilings<T>(
    deps: { storage: Storage; config: AimeatConfig },
    owners: readonly string[],
    flip: () => Promise<T>,
    /** What the refusal says the flip was, and what happens to the rows: "Putting it back", "It stays in the bin." */
    words: { act: string; stays: string },
): Promise<{ ok: true; value: T } | { ok: false; refusal: CeilingRefusal }> {
    const { storage, config } = deps;
    const unique = [...new Set(owners)];
    const overage: Array<[string, number]> = [];
    try {
        const value = await storage.transaction(async () => {
            const before = new Map<string, { keys: number; bytes: number }>();
            for (const o of unique) before.set(o, await storage.getMemoryTotals(o));
            const out = await flip();
            for (const o of unique) {
                const was = before.get(o)!;
                const now = await storage.getMemoryTotals(o);
                if (now.keys > was.keys && now.keys > config.memoryMaxKeysPerAgent) {
                    throw new CeilingRollback({
                        status: 413, code: 'QUOTA_EXCEEDED',
                        message: `${words.act} would take ${o} past the memory key limit of ${config.memoryMaxKeysPerAgent} keys `
                            + '(the node setting memoryMaxKeysPerAgent, AIMEAT_MEMORY_MAX_KEYS, which the operator sets on the Config tab). '
                            + `${words.stays} One value may hold ${config.memoryMaxValueSizeKb} kB, so fold a set of small keys into one `
                            + 'record holding an array or an object keyed by id, or ask the operator to raise the limit.',
                    });
                }
                if (now.bytes > was.bytes) {
                    const quota = await checkMemoryQuota(config, storage, o, now.bytes - was.bytes, 0, was.bytes);
                    if (!quota.allowed) {
                        throw new CeilingRollback({
                            status: 413, code: 'QUOTA_EXCEEDED',
                            message: `${words.act} would take ${o} past its memory quota. ${quota.reason ?? ''} `
                                + `The quota is the node setting memoryQuotaMb (AIMEAT_MEMORY_QUOTA_MB, ${config.memoryQuotaMb} MB), `
                                + `which the operator sets on the Config tab. ${words.stays} Remove records you no longer need, or ask the operator to raise the quota.`,
                        });
                    }
                    if (quota.overageMorsels > 0) overage.push([o, quota.overageMorsels]);
                }
            }
            return out;
        });
        for (const [o, morsels] of overage) await chargeOverage(storage, o, morsels, 'memory_overage');
        return { ok: true, value };
    } catch (err) {
        if (err instanceof CeilingRollback) return { ok: false, refusal: err.refusal };
        throw err;
    }
}
