/**
 * @file src/mcp/memory-version-lock.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The optimistic lock for memory writes over MCP: compare the version the caller read
 *   against the record the write will actually land on, and refuse rather than overwrite.
 *
 *   The REST key route has enforced this since it existed (`routes/memory/key.ts`, 409
 *   VERSION_CONFLICT). Over MCP there was no way to pass a version at all, so an agent's write was
 *   last-write-wins against a person editing the same record in the browser. That is tolerable while
 *   a record has one writer. It stops being tolerable the moment a single key is written by the
 *   person, by their AI and by the server, which is the direction memory records are going.
 *
 *   `write-guards.ts` already knew how to do this, but only for workspace namespaces that opt in via
 *   `requires_expected_version`. This is the same idea without the namespace gate, for any key.
 *
 *   Deliberately optional: omitting the version keeps every pre-v1.15.0 caller working unchanged.
 *   Supplying it opts into the check. `0` asserts the key does not exist yet, which is how you
 *   create a record without racing another writer to the same new key.
 * @structure versionConflict(expected, current, key)
 * @usage
 *   const conflict = versionConflict(expected_version, existing?.version ?? 0, key);
 *   if (conflict) return conflict;
 * @version-history
 *   v1.0.0 — 2026-08-09 — Extracted from src/mcp/core.ts on the 800-line limit.
 */

/** The MCP tool result shape for a refusal. Mirrors the other error returns in core.ts. */
export interface McpErrorResult {
    /** The SDK's result type carries an index signature; without this the return is not assignable. */
    [x: string]: unknown;
    content: { type: 'text'; text: string }[];
    isError: true;
}

/**
 * Returns a refusal when the caller's expected version does not match the record's current one, or
 * null when the write may proceed. `expected` undefined means the caller did not ask for the check.
 *
 * Both versions go in the payload. A conflict is something the caller recovers from by re-reading
 * and retrying, and it cannot do that without knowing what the current version actually is.
 */
export function versionConflict(
    expected: number | undefined,
    current: number,
    key: string,
): McpErrorResult | null {
    if (expected === undefined || current === expected) return null;
    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify({
                error: 'VERSION_CONFLICT',
                message: `Expected version ${expected} but current is ${current} — nothing was written; re-read the record and retry`,
                key,
                current_version: current,
                your_version: expected,
            }, null, 2),
        }],
        isError: true,
    };
}
