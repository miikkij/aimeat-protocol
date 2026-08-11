/**
 * @file src/services/workspace-write-guards.ts
 * @description The two limits a workspace write answers to, extracted from mcp/workspaces.ts when
 *   that file passed the 800-line limit. Bodies verbatim.
 *
 *   Both were missing on this surface until 2026-08-11. A workspace record is a memory record, but
 *   the workspace tools write through their own helper rather than /v1/memory, so they inherited
 *   nothing: an archived workspace kept accepting drafts, and a batch of up to 50 items in one call
 *   was a road straight past the value-size limit, the per-principal key ceiling and the byte
 *   budget.
 *
 *   They live in services/ rather than beside the tools because they are a decision, not protocol
 *   surface — which is what aimeat/no-storage-in-mcp says, and it caught this file on its first run.
 *   They are not part of services/memory-write.ts because that function owns a whole write,
 *   and this path deliberately does not use it: the workspace write has its own owner-collapse rule
 *   (one owner per key, see writeRecord in mcp/workspaces.ts) that a generic write would undo.
 * @structure
 *   - archivedRefusal() — is this key inside something the owner archived
 *   - checkWorkspaceWriteLimits() — value size and key count for a planned batch
 * @usage
 *   const bad = await archivedRefusal(storage, `${root}.`);
 *   if (bad) return fail(bad);
 * @version-history
 *   v1.1.0 — 2026-08-11 — The byte budget and the per-RECORD archive flag, both of which the
 *     HTTP door applies and this path did not: a batch could clear the value and key limits
 *     and still write past the owner's paid storage, and a single archived record was
 *     overwritten by a draft write.
 *   v1.0.0 — 2026-08-11 — Extracted from mcp/workspaces.ts (max-file-lines), no behaviour change.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { isKeyArchived } from './archive.js';
import { checkMemoryQuota, chargeOverage } from './quota.js';

/**
 * Is this key inside something the owner archived? Archived is read-only, and it means it on every
 * surface. These tools checked nothing, so an archived workspace kept accepting drafts, publishes
 * and structure edits through an agent while the web door refused them with 409.
 *
 * `ownerGhii` and `recordKey` add the third level the HTTP door also checks: a SINGLE record the
 * owner archived, not only the workspace and the organism around it. isKeyArchived resolves the
 * organism column and the workspace registry marker; the row's own `archived` flag is a separate
 * fact, and services/memory-write.ts refuses on it. Without it, "this document is finished" held
 * for /v1/memory and not for a workspace draft written through a tool.
 */
export async function archivedRefusal(
    storage: Storage,
    key: string,
    record?: { ownerGhii: string; key: string },
): Promise<string | null> {
    const guard = await isKeyArchived(storage, key);
    if (guard.archived) return `This ${guard.level} is archived (read-only). Unarchive it before writing.`;
    if (record) {
        const row = await storage.getMemory(record.ownerGhii, record.key);
        if (row?.archived) return 'This record is archived (read-only). Unarchive it before writing.';
    }
    return null;
}

/**
 * The memory ceilings for a planned workspace write. A batch is up to 50 items in one call and every
 * one of them is a memory record, so without these the batch walked past the value-size limit, the
 * key ceiling and the byte budget that /v1/memory has always applied.
 *
 * Returns a refusal message, or null when the whole batch fits.
 */
export async function checkWorkspaceWriteLimits(
    storage: Storage,
    config: AimeatConfig,
    ownerGhii: string,
    planned: { key: string; v: unknown }[],
    label: (i: number) => string,
): Promise<string | null> {
    const maxValueBytes = config.memoryMaxValueSizeKb * 1024;
    let newKeys = 0;
    for (const [i, p] of planned.entries()) {
        const size = Buffer.byteLength(JSON.stringify(p.v), 'utf8');
        if (size > maxValueBytes) {
            return `${label(i)}Value size ${size} bytes exceeds limit of ${maxValueBytes} bytes`;
        }
        if (!(await storage.getMemory(ownerGhii, p.key))) newKeys++;
    }
    if (newKeys > 0) {
        const held = await storage.countMemory([ownerGhii]);
        if (held + newKeys > config.memoryMaxKeysPerAgent) {
            return `Memory key limit reached (${config.memoryMaxKeysPerAgent}). One value may hold `
                + `${config.memoryMaxValueSizeKb} kB, so fold small records together rather than deleting data.`;
        }
    }

    // The BYTE budget, which is a different limit from the two above and was missing here entirely:
    // a batch could sit under the per-value ceiling and under the key count and still write past the
    // owner's paid storage. The same bytes posted to /v1/memory are refused, and the overage there
    // is charged in morsels. Measured as one batch, replacing what the existing rows already hold.
    let additional = 0;
    let replacing = 0;
    for (const p of planned) {
        additional += Buffer.byteLength(JSON.stringify(p.v), 'utf8');
        const row = await storage.getMemory(ownerGhii, p.key);
        if (row) replacing += Buffer.byteLength(JSON.stringify(row.value), 'utf8');
    }
    const quota = await checkMemoryQuota(config, storage, ownerGhii, additional, replacing);
    if (!quota.allowed) return quota.reason ?? 'Storage quota exceeded';
    if (quota.overageMorsels > 0) {
        await chargeOverage(storage, ownerGhii, quota.overageMorsels, 'memory_overage');
    }
    return null;
}
