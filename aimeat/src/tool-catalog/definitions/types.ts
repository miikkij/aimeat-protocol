/**
 * @file types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Transport-neutral tool-contract metadata types (ToolCallerType, ToolVisibility,
 *   ToolInputField, AimeatToolDefinition) plus the shared `agentEverywhere` visibility constant.
 *   Consumed by definitions.ts and every extracted definitions/*.ts tool-group module.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from definitions.ts (pure extraction; no behavior change).
 */

export type ToolCallerType = 'agent' | 'owner' | 'operator' | 'public';

export interface ToolVisibility {
    publicMcp: boolean;
    connectorMcp: boolean;
    cliFallback: boolean;
}

export interface ToolInputField {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';
    required?: boolean;
    description: string;
    enum?: string[];
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
    conciseFields?: string[];
    /**
     * F5: for list tools whose connector REST payload wraps the array under a key
     * (e.g. { items: [...] }, { actions: [...] }), the wrapper key. Lets one catalog entry shape
     * both the server's bare array and the connector's wrapped object. Omit for bare-array or
     * single-record tools.
     */
    concisePath?: string;
}

export const agentEverywhere: ToolVisibility = {
    publicMcp: true,
    connectorMcp: true,
    cliFallback: true,
};
