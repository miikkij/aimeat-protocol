/**
 * @file src/mcp/schema-flags.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Argument shapes that MCP clients disagree about, defined once.
 *
 *   Clients differ in how they serialise arguments: some send JSON booleans, some send every value
 *   as a string. A bare `z.boolean()` rejects the second kind with "expected boolean, received
 *   string", and it does so at the protocol layer — the tool never runs, and the caller sees a
 *   validation error for an argument it believes it passed correctly.
 *
 *   That is not hypothetical: `owner_scope` on `aimeat_memory_read` failed on its first real call
 *   from claude.ai, while the identical `z.boolean()` on `aimeat_memory_list` happened to pass,
 *   because the two tools are registered through different SDK forms. Defining the flag once is what
 *   stops the two from disagreeing again.
 * @structure flexibleBoolean — boolean | "true" | "false" → boolean
 * @usage
 *   import { flexibleBoolean } from './schema-flags.js';
 *   owner_scope: flexibleBoolean.optional().describe('…'),
 * @version-history
 *   v1.1.0 — 2026-10-05 — flexibleBoolean moved unchanged to src/tool-catalog/input-schemas.ts and is
 *     re-exported (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-08-08 — Initial, after owner_scope was unusable from a real client.
 */

// The flag is the exact schema of catalog fields now, so it lives in the catalog and is re-exported here.
export { flexibleBoolean } from '../tool-catalog/input-schemas.js';
