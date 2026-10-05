/**
 * @file types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Transport-neutral tool-contract metadata types (ToolCallerType, ToolVisibility,
 *   ToolInputField, AimeatToolDefinition) plus the shared `agentEverywhere` visibility constant.
 *   Consumed by definitions.ts and every extracted definitions/*.ts tool-group module.
 * @version-history
 *   v1.1.0 — 2026-10-05 — ToolInputField.zod: the exact schema of a field whose type the coarse
 *     metadata cannot state, read by zodShapeFor() (zod-shape.ts) for both MCP surfaces. A definition
 *     carries its `annotations`, `scope` and `surfaces`, which the three maps read (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-07-13 — Extracted from definitions.ts (pure extraction; no behavior change).
 */
import type { z } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

export type ToolCallerType = 'agent' | 'owner' | 'operator' | 'public';

/** One word, or every word of a list: a tool whose route asks for several asks for all of them. */
export type ToolScope = string | readonly string[];

/** The v2 MCP surfaces (../surfaces.ts). */
export type SurfaceRole = 'appdev' | 'agent' | 'service' | 'admin' | 'commerce' | 'primitives' | 'chat' | 'full';

export interface ToolVisibility {
    publicMcp: boolean;
    connectorMcp: boolean;
    cliFallback: boolean;
}

export interface ToolInputField {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';
    required?: boolean;
    description: string;
    enum?: readonly string[];
    /**
     * The exact schema, when `type` and `enum` cannot state it: lengths, bounds, item types, nested
     * objects, unions, defaults. Without `.optional()` and without `.describe()`: zodShapeFor() adds
     * both from `required` and `description`. `type` stays the coarse label the CLI listing shows.
     */
    zod?: z.ZodType;
}

export interface AimeatToolDefinition {
    name: string;
    description: string;
    caller: ToolCallerType;
    visibility: ToolVisibility;
    input: Record<string, ToolInputField>;
    /** F5: tool accepts a `response_format` ('concise' | 'detailed') input parameter. */
    supportsResponseFormat?: boolean;
    /**
     * F5: fields kept when `response_format` is 'concise'. Applied by shape.ts:shapeResponse()
     * to the tool's high-signal return payload (array items or a single object). When absent,
     * 'concise' is a no-op. Keys must match the handler's snake_case return fields.
     */
    conciseFields?: readonly string[];
    /**
     * F5: for list tools whose connector REST payload wraps the array under a key
     * (e.g. { items: [...] }, { actions: [...] }), the wrapper key. Lets one catalog entry shape
     * both the server's bare array and the connector's wrapped object. Omit for bare-array or
     * single-record tools.
     */
    concisePath?: string;
    /**
     * The MCP annotations both surfaces register (title, read-only, destructive, idempotent, open
     * world). Read by annotationsFor() (src/mcp/annotations.ts); every registered tool has them.
     */
    annotations?: ToolAnnotations;
    /**
     * The scope word an agent needs, or every word of a list, the same as the REST route asks
     * (../scopes.ts TOOL_SCOPES). Absent: the tool needs no word, or is listed in scope-exempt-tools.ts.
     */
    scope?: ToolScope;
    /**
     * The v2 surfaces that carry the tool, besides `full` (../surfaces.ts MCP_SURFACES). `full`
     * carries every catalog tool not in V2_EXCLUDED.
     */
    surfaces?: readonly SurfaceRole[];
}

export const agentEverywhere: ToolVisibility = {
    publicMcp: true,
    connectorMcp: true,
    cliFallback: true,
};
