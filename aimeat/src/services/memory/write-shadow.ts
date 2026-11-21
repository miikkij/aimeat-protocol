/**
 * @file src/services/memory/write-shadow.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two warnings an agent's memory write carries when it lands in the agent's own
 *   namespace and an owner-scope reader looks elsewhere: SHADOWED_BY_OWNER_COPY (the owner already
 *   holds the key) and APP_READS_OWNER_NAMESPACE (the key is under a prefix one of the owner's apps
 *   reads from the owner's namespace, services/app/declared-key-prefixes.ts). Moved out of
 *   services/memory/write.ts (max-file-lines), which re-exports shadowWarning for its importers.
 * @structure OWNER_SCOPE_FIX · shadowWarning · appPrefixWarning
 * @usage if (shadowedBy) warnings.push(shadowWarning(key, targetGaii, shadowedBy));
 * @version-history
 *   2026-11-21 — appPrefixWarning: an agent's write under an app's declared key prefix names the fix
 *     (owner_scope: true) also when the owner holds no copy yet; the write itself is unchanged.
 *   2026-10-27 — Extracted from services/memory-write.ts, unchanged (secaudit2026oct26 needed the lines).
 */
/** The warning's shape; it is one of memory-write.ts MemoryWriteWarning, named here so the two files import in one direction. */
export interface ShadowedWarning { code: 'SHADOWED_BY_OWNER_COPY'; message: string; [detail: string]: unknown }
/** The second warning's shape, the same way. */
export interface AppPrefixWarning { code: 'APP_READS_OWNER_NAMESPACE'; message: string; [detail: string]: unknown }

/** What an agent does about either warning, worded once for both. */
export const OWNER_SCOPE_FIX = 'Write the owner\'s record itself with owner_scope: true (aimeat_memory_write, or POST '
    + '/v1/memory), which needs the memory:write-as-owner permission the owner grants per agent in '
    + 'Profile -> Agents. Without that permission, tell the person what you meant to write so they can save it.';

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
        how_to_fix: OWNER_SCOPE_FIX,
    };
}

/**
 * The APP_READS_OWNER_NAMESPACE warning, worded once for every door: `key` is under `prefix`, which
 * the owner's app `app` keeps in the owner's memory, and this copy landed in `landedIn`.
 */
export function appPrefixWarning(key: string, landedIn: string, hit: { app: string; prefix: string }): AppPrefixWarning {
    return {
        code: 'APP_READS_OWNER_NAMESPACE',
        message: `Saved under ${landedIn}, but "${key}" is under "${hit.prefix}", which the app ${hit.app} keeps `
            + 'in the owner\'s memory. This copy is the agent\'s own: an app read without ownerScope does not '
            + 'see it, and a copy the owner or the app writes later hides it.',
        app: hit.app,
        prefix: hit.prefix,
        how_to_fix: OWNER_SCOPE_FIX,
    };
}
