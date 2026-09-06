/**
 * @file src/auth/anonymous-scopes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the shared anonymous principal may do, in one place.
 *
 *   WHY IT IS ITS OWN FILE. The list was written out at the mint (`POST /v1/auth/anonymous`) and
 *   nowhere else — the anonymous agent RECORD was created with no `defaultScopes` at all. That was
 *   invisible for as long as a token's own scopes were the answer, and it stopped being invisible
 *   the moment auth/effective-scopes.ts made the record the truth for every agent: the record said
 *   nothing, so the intersection said nothing, and every anonymous call was refused. Named here so
 *   the record and the mint read the same line.
 * @structure ANONYMOUS_SCOPES
 * @usage import { ANONYMOUS_SCOPES } from '../auth/anonymous-scopes.js';
 * @version-history
 *   v1.0.0 — 2026-09-07 — Extracted from routes/auth.ts when the record was found to carry none.
 */

/**
 * Read and write its own `anonymous.*` namespace, read the catalogue, read the boards. No consent,
 * no work, no social write: a shared identity anyone may hold must not be able to speak in the
 * node's name or grant anything away.
 */
export const ANONYMOUS_SCOPES: readonly string[] = [
    'memory:read', 'memory:write', 'memory:delete',
    'storage:read', 'storage:write',
    'catalogue:read', 'social:read',
];
