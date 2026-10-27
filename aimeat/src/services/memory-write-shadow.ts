/**
 * @file src/services/memory-write-shadow.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SHADOWED_BY_OWNER_COPY warning a memory write carries. Moved unchanged out of
 *   services/memory-write.ts (max-file-lines), which re-exports it for its importers.
 * @structure shadowWarning
 * @usage if (shadowedBy) warnings.push(shadowWarning(key, targetGaii, shadowedBy));
 * @version-history
 *   2026-10-27 — Extracted from services/memory-write.ts, unchanged (secaudit2026oct26 needed the lines).
 */
/** The warning's shape; it is one of memory-write.ts MemoryWriteWarning, named here so the two files import in one direction. */
export interface ShadowedWarning { code: 'SHADOWED_BY_OWNER_COPY'; message: string; [detail: string]: unknown }

/**
 * The SHADOWED_BY_OWNER_COPY warning, worded once for every door. `landedIn` is the namespace this
 * copy was written to; `ownerCopy` is the owner GHII holding the copy owner-scope reads resolve to.
 */
export function shadowWarning(key: string, landedIn: string, ownerCopy: string): ShadowedWarning {
    return {
        code: 'SHADOWED_BY_OWNER_COPY',
        message: `Saved under ${landedIn}, but "${key}" also exists under ${ownerCopy}. `
            + 'Owner-scope reads resolve the owner\'s copy first, so an app reading with ownerScope '
            + 'and an owner-scope listing show that copy and not this one: this write did not update it.',
        shadowed_by: ownerCopy,
        how_to_fix: 'Write the owner\'s record itself with owner_scope: true (aimeat_memory_write, or POST '
            + '/v1/memory), which needs the memory:write-as-owner permission the owner grants per agent in '
            + 'Profile -> Agents. Without that permission, tell the person what you meant to write so they can save it.',
    };
}
