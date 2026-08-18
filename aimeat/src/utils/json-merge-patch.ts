/**
 * @file src/utils/json-merge-patch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description JSON Merge Patch (RFC 7386) — the merge semantics behind PATCH /v1/memory/:key.
 *
 *   The reason this exists: a record written by several principals at once. Six Sanomat agents each
 *   own one subtree of one edition; a marketplace app and its owner each own part of one listing.
 *   Without a merge each writer has to own a whole key, which is how a pipeline ends up sharding into
 *   one key per writer and burning the key budget (the memory-key-shape audit, 2026-08-09).
 *
 *   RFC 7386 is deliberately small, and the small parts are the load-bearing ones:
 *     - an object in the patch merges KEY BY KEY into an object in the target, recursively;
 *     - `null` in the patch DELETES that key from the target (this is why the format cannot express
 *       "set this field to null" — a caller that needs a stored null must model it another way);
 *     - anything else — a scalar, an array, or an object replacing a non-object — REPLACES wholesale.
 *   Arrays are replaced, never merged element-wise. There is no index-level merge in the RFC and
 *   inventing one would make two concurrent list appends silently reorder each other.
 * @structure
 *   - applyMergePatch(target, patch) -> the merged value (pure; never mutates either argument)
 *   - mergePatchTouchesReservedRoot(patch, roots) -> the first reserved top-level key the patch
 *     writes, or null. Lets a caller refuse a patch that reaches into a namespace it may not touch.
 * @usage import { applyMergePatch } from '../utils/json-merge-patch.js';
 *   const merged = applyMergePatch(existing?.value ?? {}, req.body.patch);
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial, with PATCH /v1/memory/:key.
 */

/** A JSON value, as it arrives from a request body. */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** True for a mergeable object: a plain object, not an array and not null. */
function isMergeableObject(v: unknown): v is Record<string, Json> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Apply an RFC 7386 merge patch and return the result. Pure: neither argument is mutated, so a
 * caller can compute the merged value, run it past the size and schema guards, and still have the
 * original in hand to retry with when a concurrent writer wins the compare-and-swap.
 *
 * When `patch` is not an object the result IS the patch — that is the RFC's rule, and it means
 * `PATCH` with a scalar body replaces the whole record. Callers that want to forbid that should
 * reject a non-object patch before calling, which the route does.
 */
export function applyMergePatch(target: unknown, patch: unknown): Json {
    if (!isMergeableObject(patch)) return patch as Json;

    // A non-object target is replaced by an empty object first: RFC 7386 says merging an object into
    // a scalar discards the scalar. Copying rather than mutating keeps the function pure.
    const out: Record<string, Json> = isMergeableObject(target) ? { ...target } : {};

    for (const [k, v] of Object.entries(patch)) {
        if (v === null) {
            delete out[k];                              // null means REMOVE, not "store null"
        } else if (isMergeableObject(v)) {
            out[k] = applyMergePatch(out[k], v);        // recurse; a scalar under k is replaced
        } else {
            out[k] = v;                                 // scalar or array: wholesale replace
        }
    }
    return out;
}

/**
 * The first top-level key in `patch` that appears in `roots`, or null.
 *
 * A merge patch can reach anywhere in a record, so the reserved-key rules that guard a whole KEY
 * (`appMayWriteKey`) need a companion for the fields INSIDE one. Without it, a principal allowed to
 * patch a record could reach a subtree it would be refused as its own key.
 */
export function mergePatchTouchesReservedRoot(patch: unknown, roots: readonly string[]): string | null {
    if (!isMergeableObject(patch)) return null;
    for (const k of Object.keys(patch)) if (roots.includes(k)) return k;
    return null;
}
