/**
 * @file memory-namespace-hints.ts
 * @description The guidance the memory tools return when a caller runs into the same-owner
 *   namespace model. Memory is keyed by the WRITER: an app writes as the owner's GHII, an agent
 *   writes as its own GAII, and owner-scope reads resolve GHII-first.
 *
 *   These strings exist because the tools used to answer with nothing at all. A bare
 *   "Memory not found" for a key an app had plainly saved, a listing that silently dropped every
 *   value, and a write that quietly landed somewhere the app would never look, together read as
 *   "the platform cannot share this data" — a wrong conclusion that cost a redesign. Naming the
 *   holder and the working call turns a dead end into a next step.
 * @structure notInYourNamespace · shadowedByOwnerCopy · OWNER_SCOPE_LIST_NOTE
 * @usage
 *   import { notInYourNamespace } from './memory-namespace-hints.js';
 *   return { content: [{ type: 'text', text: JSON.stringify(notInYourNamespace(...), null, 2) }], isError: true };
 * @version-history
 *   v1.0.0 — 2026-07-26 — Extracted from core.ts (max-file-lines) with the namespace-legibility work.
 *     Covered by test/e2e-memory-namespaces.ts.
 */

/** How to obtain a credential that reads AND writes the owner's own records. */
const APP_GRANT_ADVICE =
    'Your own writes land in YOUR namespace and are shadowed by the owner\'s copy. To read AND write '
    + 'the owner\'s records directly, use an app-grant credential (sub = the owner GHII, roles ["app"], '
    + 'scopes memory:read + memory:write) obtained via GET /v1/app-grants/authorize and '
    + 'POST /v1/app-grants/token.';

/**
 * Payload for `aimeat_memory_read` when the key is absent from the caller's namespace but present
 * somewhere in the owner scope. Names the holder and the call that actually returns the value.
 */
export function notInYourNamespace(key: string, callerGaii: string, foundUnder: string): Record<string, unknown> {
    return {
        error: 'NOT_IN_YOUR_NAMESPACE',
        message: `"${key}" is not in your namespace (${callerGaii}), but it exists under ${foundUnder}. `
            + 'Memory is keyed by whoever wrote it.',
        key,
        your_namespace: callerGaii,
        found_under: foundUnder,
        read_it: `GET /v1/memory/${encodeURIComponent(key)}?owner_scope=true`,
        to_write_it: APP_GRANT_ADVICE,
    };
}

/**
 * Extra fields for a successful `aimeat_memory_write` whose key ALSO exists under the owner's GHII.
 * The write succeeded — into the caller's own namespace — but owner-scope reads resolve GHII-first,
 * so this copy will not surface anywhere, including in an owner-scope listing.
 */
export function shadowedByOwnerCopy(key: string, callerGaii: string, ownerCopyGaii: string): Record<string, unknown> {
    return {
        warning: 'SHADOWED_BY_OWNER_COPY',
        warning_detail: `This wrote to YOUR namespace (${callerGaii}), but "${key}" also exists under `
            + `${ownerCopyGaii}. Owner-scope reads resolve GHII-first, so the owner's copy wins and this `
            + 'one will not surface — not even in an owner-scope listing. To update the owner\'s record '
            + 'itself, use an app-grant credential (sub = the owner GHII).',
        shadowed_by: ownerCopyGaii,
    };
}

/** Disclosure for an owner-scope listing: it spans identities and carries no values. */
export const OWNER_SCOPE_LIST_NOTE =
    'Metadata only, no values. These entries span the owner GHII and every same-owner agent, so '
    + 'aimeat_memory_read (your namespace only) will not find the ones owned by another identity — '
    + 'read a value with GET /v1/memory/{key}?owner_scope=true.';
