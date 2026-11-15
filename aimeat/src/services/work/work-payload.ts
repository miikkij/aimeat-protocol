/**
 * @file src/services/work/work-payload.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one rule for a work item's input and a delivery's output: a JSON object (decision
 *   2026-11-15, as the MCP tools already took them). The REST schemas in models/schemas.ts refuse
 *   anything else first; createWorkItem, deliverWork, the re-delivery after a dispute and the
 *   cross-node work route ask this function as well, so every code path that writes a work row agrees.
 *   Rows stored between 2026-02-26 and 2026-11-15 may hold any JSON value, and readers pass them
 *   through unchanged.
 * @structure isWorkPayload · WORK_INPUT_NOT_OBJECT · WORK_OUTPUT_NOT_OBJECT
 * @usage if (!isWorkPayload(input)) return { error: WORK_INPUT_NOT_OBJECT, status: 400, code: 'INVALID_INPUT' };
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial.
 */

/** A JSON object: not null, not an array, not text or a number. */
export function isWorkPayload(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const WORK_INPUT_NOT_OBJECT =
    'input must be a JSON object whose fields the action reads, for example { "text": "..." }; text, a number, an array or null is not accepted';

export const WORK_OUTPUT_NOT_OBJECT =
    'output must be a JSON object, for example { "text": "..." }; text, a number, an array or null is not accepted';
