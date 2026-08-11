/**
 * @file src/services/memory-ceilings.ts
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
 * @usage
 *   const refusal = await memoryCeilingRefusal({ storage, config }, target, [{ key, value }]);
 *   if (refusal) return { ok: false, ...refusal };
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted after the audit's own diff was checked for duplication: the same
 *     three ceilings existed in memory-write.ts and workspace-write-guards.ts.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
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
        const row = await storage.getMemory(targetGaii, p.key);
        if (row) replacing += Buffer.byteLength(JSON.stringify(row.value), 'utf8');
        else newKeys++;
    }

    // An UPDATE never grows the key count, so the count is only taken when the set adds a key.
    let keyCount: number | undefined;
    if (newKeys > 0) {
        keyCount = await storage.countMemory([targetGaii]);
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

    const quota = await checkMemoryQuota(config, storage, targetGaii, additional, replacing);
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
