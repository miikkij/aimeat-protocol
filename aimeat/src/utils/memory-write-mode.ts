/**
 * @file src/utils/memory-write-mode.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which write aimeat_memory_write was asked for: a whole `value` (POST /v1/memory) or a
 *   partial `patch` (PATCH /v1/memory/:key, JSON Merge Patch). One decision for the node MCP and the
 *   CLI dispatch behind the connector, so the two doors cannot read the same call two ways.
 *
 *   Exactly one of the two is given. A patch takes no `group_id` (a record at 'group' keeps its group)
 *   and no `ai_provenance` declaration (the merged bytes are stamped by the node): either alongside a
 *   patch is refused rather than dropped in silence, because a dropped parameter is a call that
 *   succeeds having done less than it was asked.
 * @structure memoryWriteMode()
 * @usage
 *   const mode = memoryWriteMode(args);
 *   if ('error' in mode) return toolError(mode.error.code, mode.error.message);
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial (aimeat_memory_write `patch`).
 */

export type MemoryWriteMode =
    | { mode: 'value' }
    | { mode: 'patch' }
    | { error: { code: 'INVALID_INPUT'; message: string } };

const given = (input: Record<string, unknown>, k: string): boolean => input[k] !== undefined;

/** The write this call asks for, or why it is refused. */
export function memoryWriteMode(input: Record<string, unknown>): MemoryWriteMode {
    const hasValue = given(input, 'value');
    const hasPatch = given(input, 'patch');
    if (hasValue && hasPatch) {
        return { error: { code: 'INVALID_INPUT', message: 'Give either value (the whole new record) or patch (the fields to change), not both.' } };
    }
    if (!hasValue && !hasPatch) {
        return { error: { code: 'INVALID_INPUT', message: 'Give value (the whole new record) or patch (the fields to change).' } };
    }
    if (hasValue) return { mode: 'value' };
    const extra = ['group_id', 'ai_provenance', 'ai_provenance_id'].filter(k => given(input, k));
    if (extra.length) {
        return { error: { code: 'INVALID_INPUT', message: `A patch takes no ${extra.join(' or ')}: a record at group keeps its group, and the node stamps the merged value itself. Leave ${extra.length > 1 ? 'them' : 'it'} out, or write the whole value.` } };
    }
    return { mode: 'patch' };
}
