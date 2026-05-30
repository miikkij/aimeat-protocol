/**
 * @file shape.ts
 * @description Transport-neutral helpers shared by the public server MCP surface
 *   (`src/mcp/*.ts`) and the local connector MCP surface (`src/cli/connect/mcp/tools/*.ts`).
 *   Centralising description lookup + response shaping here is what keeps the two
 *   surfaces from drifting (MCP audit F6/F5/F10): both read the SAME canonical
 *   description from the catalog and apply the SAME `response_format` projection.
 * @structure
 *   - responseFormatSchema -- zod fragment tools spread into their input shape
 *   - descriptionFor(name) -- canonical tool description from the catalog (throws if missing)
 *   - shapeResponse(name, format, data) -- apply 'concise' projection per catalog conciseFields
 *   - jsonContent(data) -- standard MCP text content envelope
 * @usage
 *   import { descriptionFor, shapeResponse, jsonContent, responseFormatSchema } from '../catalog/shape.js';
 *   mcp.tool('aimeat_memory_read', descriptionFor('aimeat_memory_read'),
 *     { key: z.string(), response_format: responseFormatSchema },
 *     annotationsFor('aimeat_memory_read'),
 *     async ({ key, response_format }) => jsonContent(shapeResponse('aimeat_memory_read', response_format, payload)));
 * @version-history
 *   v1.0.0 -- 2026-05-30 -- MCP audit Phase 1: descriptionFor + shapeResponse + jsonContent + responseFormatSchema
 *   v1.1.0 -- 2026-05-30 -- shapeResponse handles both the server's bare-array/object payloads and the
 *     connector's REST-wrapped payloads (via catalog concisePath), with an empty-projection guard so a
 *     field-name mismatch safely degrades to a no-op instead of returning {}.
 */

import { z } from 'zod';
import { getAimeatToolDefinition } from './definitions.js';

export type ResponseFormat = 'concise' | 'detailed';

/**
 * Optional input fragment for read-heavy tools. Spread into the zod input shape:
 *   { key: z.string(), response_format: responseFormatSchema }
 */
export const responseFormatSchema = z
    .enum(['concise', 'detailed'])
    .optional()
    .describe(
        "Response verbosity. 'concise' returns only the high-signal fields (fewer tokens); " +
        "'detailed' (default) returns the full record. Prefer 'concise' when scanning many results.",
    );

/**
 * Canonical description for a registered tool, read from the shared catalog so both MCP
 * surfaces stay identical. Throws if the tool has no catalog entry — mirrors annotationsFor()
 * so a tool cannot ship without canonical metadata.
 */
export function descriptionFor(name: string): string {
    const def = getAimeatToolDefinition(name);
    if (!def) {
        throw new Error(
            `Missing tool definition for "${name}". Add an entry to CLI_FALLBACK_TOOL_DEFINITIONS ` +
            `in src/mcp/catalog/definitions.ts before registering the tool (the catalog is the ` +
            `canonical source of tool descriptions for both MCP surfaces).`,
        );
    }
    return def.description;
}

/**
 * Project a single record down to the given fields. Empty-projection guard: if none of the
 * fields are present (e.g. a surface uses a different field name), return the record unchanged
 * so 'concise' degrades to a no-op rather than producing {}.
 */
function projectRecord(value: unknown, fields: string[]): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const field of fields) {
        if (field in source) out[field] = source[field];
    }
    return Object.keys(out).length === 0 ? value : out;
}

function projectArray(value: unknown[], fields: string[]): unknown[] {
    return value.map(item => projectRecord(item, fields));
}

/**
 * Apply the catalog's `conciseFields` projection when format === 'concise'. Handles three shapes
 * so one catalog entry shapes both MCP surfaces:
 *   1. bare array         -> project each element            (server list tools)
 *   2. { [concisePath]: array, ...rest } -> project that nested array, keep the wrapper
 *                                            (connector REST lists, e.g. { items, total })
 *   3. single record      -> project the object              (e.g. memory_read on both surfaces)
 * For any non-'concise' format, or when the tool declares no conciseFields, data is returned as-is.
 */
export function shapeResponse(name: string, format: ResponseFormat | undefined, data: unknown): unknown {
    if (format !== 'concise') return data;
    const def = getAimeatToolDefinition(name);
    const fields = def?.conciseFields;
    if (!fields || fields.length === 0) return data;

    if (Array.isArray(data)) return projectArray(data, fields);

    if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>;
        const path = def?.concisePath;
        if (path && Array.isArray(obj[path])) {
            return { ...obj, [path]: projectArray(obj[path] as unknown[], fields) };
        }
        return projectRecord(obj, fields);
    }
    return data;
}

/** Standard MCP text-content envelope around a JSON-serialisable payload. */
export function jsonContent(data: unknown): { content: { type: 'text'; text: string }[] } {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
