/**
 * @file cli/connect/tool-call-helpers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared types + input-coercion helpers for the connect-call REST tool definitions. Extracted from cli/connect/tool-call.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 -- 2026-07-13 -- Extracted from tool-call.ts (max-file-lines)
 */
import type { ToolInputField } from '../../mcp/catalog/definitions.js';
import type { AimeatClient, ApiResponse } from './api-client.js';
import type { AimeatConnectConfig } from './config.js';

export type JsonObject = Record<string, unknown>;

export interface ConnectCliToolDefinition {
    name: string;
    description?: string;
    input?: Record<string, ToolInputField>;
    handler: (ctx: ToolCallContext, input: JsonObject) => Promise<ApiResponse>;
}

export interface ToolCallContext {
    client: AimeatClient;
    config: AimeatConnectConfig;
    agentPath: string;
}

/**
 * The two parameters every paged list takes, declared once.
 *
 * A list tool that answers `total` and `has_more` is only usable if the caller can ask for the next
 * window, and each tool declaring its own pair is how their descriptions drift apart. Spread it into
 * an input map: `input: { ...PAGING_INPUT, search: … }`.
 */
export const PAGING_INPUT = {
    limit: { type: 'number' as const, description: 'How many to return (default 50, max 200).' },
    offset: { type: 'number' as const, description: 'How many to skip; with has_more this reads the whole set.' },
};

/** The same pair on the wire: `...paging(input)` inside a query object. */
export function paging(input: JsonObject): { limit?: number; offset?: number } {
    return { limit: optionalNumber(input, 'limit'), offset: optionalNumber(input, 'offset') };
}

export function requiredString(input: JsonObject, key: string): string {
    const value = input[key];
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`Missing required string field: ${key}`);
    return value;
}

export function optionalString(input: JsonObject, key: string): string | undefined {
    const value = input[key];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function optionalNumber(input: JsonObject, key: string): number | undefined {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

export function optionalBoolean(input: JsonObject, key: string): boolean | undefined {
    const value = input[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return undefined;
}

export function requiredValue(input: JsonObject, key: string): unknown {
    if (!(key in input)) throw new Error(`Missing required field: ${key}`);
    return input[key];
}

export function optionalRecord(input: JsonObject, key: string): JsonObject | undefined {
    const value = input[key];
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

export function requiredRecord(input: JsonObject, key: string): JsonObject {
    const value = input[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as JsonObject;
    if (typeof value === 'string') {
        const parsed = JSON.parse(value) as unknown;
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as JsonObject;
    }
    throw new Error(`Missing required object field: ${key}`);
}

export function optionalArray(input: JsonObject, key: string): unknown[] | undefined {
    const value = input[key];
    return Array.isArray(value) ? value : undefined;
}

export function requiredArray(input: JsonObject, key: string): unknown[] {
    const value = input[key];
    if (Array.isArray(value)) return value;
    throw new Error(`Missing required array field: ${key}`);
}

export function query(params: Record<string, string | number | boolean | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) search.set(key, String(value));
    }
    const serialized = search.toString();
    return serialized ? `?${serialized}` : '';
}

// ── Workspace helpers (shared with the workspace_* shell handlers below) ──
export const wsRoot = (orgId: string, ws: string) => `organism.${orgId}.w.${ws}`;
/** Parse a possibly-JSON-stringified object param (value/manifest/schemas) back to an object. */
export function coerceObject(value: unknown): unknown {
    // eslint-disable-next-line aimeat/no-silent-catch -- leave as-is
    if (typeof value === 'string') { try { const p = JSON.parse(value) as unknown; if (p && typeof p === 'object') return p; } catch { /* leave as-is */ } }
    return value;
}
/** A draft value should be an object; tolerate a JSON-string, then stamp the instance id. */
export function stampValue(value: unknown, id: string): unknown {
    const v = coerceObject(value);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? { ...(v as JsonObject), id } : v;
}
export function genDocId(): string {
    return 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
export function genWsId(): string {
    return 'ws-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

export function taskTodoPayload(input: JsonObject): JsonObject {
    const todos = optionalArray(input, 'todos') ?? [];
    return {
        todos: todos.map((rawTodo, index) => {
            const todo = typeof rawTodo === 'object' && rawTodo !== null ? rawTodo as JsonObject : {};
            const title = typeof todo.title === 'string' ? todo.title : `TODO ${index + 1}`;
            return {
                id: `todo-${index + 1}`,
                order: index + 1,
                title,
                description: typeof todo.description === 'string' ? todo.description : '',
                environment: 'agent',
                environment_reason: 'The connected agent can perform this step through AIMEAT tools.',
                verification: typeof todo.verification === 'string' ? todo.verification : '',
                estimate_minutes: typeof todo.estimate_minutes === 'number' ? todo.estimate_minutes : undefined,
                status: 'pending',
            };
        }),
    };
}
