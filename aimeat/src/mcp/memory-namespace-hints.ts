/**
 * @file memory-namespace-hints.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The guidance the memory tools return when a caller runs into the same-owner
 *   namespace model. Memory is keyed by the WRITER: an app writes as the owner's GHII, an agent
 *   writes as its own GAII, and owner-scope reads resolve GHII-first.
 *
 *   These strings exist because the tools used to answer with nothing at all. A bare
 *   "Memory not found" for a key an app had plainly saved, a listing that silently dropped every
 *   value, and a write that quietly landed somewhere the app would never look, together read as
 *   "the platform cannot share this data" — a wrong conclusion that cost a redesign. Naming the
 *   holder and the working call turns a dead end into a next step.
 * @structure notInYourNamespace · OWNER_SCOPE_LIST_NOTE
 * @usage
 *   import { notInYourNamespace } from './memory-namespace-hints.js';
 *   return { content: [{ type: 'text', text: JSON.stringify(notInYourNamespace(...), null, 2) }], isError: true };
 * @version-history
 *   v1.1.0 — 2026-09-13 — shadowedByOwnerCopy removed: the shadow warning is written once, by
 *     services/memory-write.ts, for every door, and this copy had no caller left. Its advice to use
 *     an app-grant credential had already gone stale beside APP_GRANT_ADVICE.
 *   v1.0.0 — 2026-07-26 — Extracted from core.ts (max-file-lines) with the namespace-legibility work.
 *     Covered by test/e2e-memory-namespaces.ts.
 */

/** How to obtain a credential that reads AND writes the owner's own records. */
const APP_GRANT_ADVICE =
    'Your own writes land in YOUR namespace and are shadowed by the owner\'s copy. To write the '
    + 'owner\'s records instead, ask for it: aimeat_memory_write { key, value, owner_scope: true }, '
    + 'which needs the memory:write-as-owner scope your owner grants per agent in Profile -> Agents. '
    + 'An app (not an agent) uses an app-grant credential instead (sub = the owner GHII, '
    + 'roles ["app"]) via GET /v1/app-grants/authorize and POST /v1/app-grants/token.';

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
        // Retry the same tool with the flag — it is one argument away, not a different protocol.
        read_it: 'aimeat_memory_read { key, owner_scope: true }',
        read_it_over_rest: `GET /v1/memory/${encodeURIComponent(key)}?owner_scope=true`,
        to_write_it: APP_GRANT_ADVICE,
    };
}

/** Disclosure for an owner-scope listing: it spans identities and carries no values. */
export const OWNER_SCOPE_LIST_NOTE =
    'Metadata only, no values. These entries span the owner GHII and every same-owner agent. '
    + 'Read one with aimeat_memory_read {key, owner_scope: true} — it defaults to your own namespace, '
    + 'so the flag is what reaches a record another identity wrote.';

