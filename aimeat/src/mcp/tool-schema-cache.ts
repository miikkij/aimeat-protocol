/**
 * @file src/mcp/tool-schema-cache.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The JSON Schema a tool's input lists as, built once per schema rather than on every
 *   `tools/list` (codebase analysis 2026-11-03, item C5; decision 11b of 2026-11-05).
 *
 *   WHY. The MCP SDK answers `tools/list` by converting every registered tool's zod schema to JSON
 *   Schema, every time it is asked and on every server. A 2026-07-28 request builds a server per
 *   request and a 2025-era session lists again whenever its client asks, so a full-access agent's
 *   list converted about 500 schemas each time, although the schemas never change: the catalog's
 *   shapes are built once per process and frozen (tool-catalog/zod-shape.ts).
 *
 *   HOW. Registration hands the SDK one zod object per raw shape, the same object on every server
 *   (the SDK would wrap the shape in a new `z.object()` each time), and that object's Standard Schema
 *   `jsonSchema.input`/`.output` answers from a memo. The SDK's own `tools/list` handler is unchanged
 *   and reads through the memo, so the list is built by the same code as before. Each answer is a
 *   fresh copy of the memo, so nothing that edits a listed schema can reach the next list.
 *
 *   WHEN IT IS BUILT AGAIN. The memo is keyed by the schema object itself (a WeakMap), so a tool set
 *   that changes brings new schema objects, which are converted on their first list, and an object
 *   nobody registers any more is collected with its memo. Nothing has to be told: a schema rebuilt per
 *   server (a remote server's flattened tools) is simply converted once per server, as before.
 *
 *   THE LIST IS THE SAME, BYTE FOR BYTE: test/unit/mcp-tool-list-cache.test.ts compares it with the
 *   cache on and off for four kinds of caller on both MCP code paths.
 * @structure stableToolSchemas(register) · stableSchema(schema) · setToolSchemaCache(on)
 * @usage const register = stableToolSchemas(mcp.registerTool.bind(mcp));
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 11b of 2026-11-05).
 */
import { z } from 'zod';

type Json = Record<string, unknown>;
type JsonSchemaMethod = (options?: unknown) => Json;
interface StandardJsonSchema { input: JsonSchemaMethod; output: JsonSchemaMethod }
type AnyFn = (...args: unknown[]) => unknown;

/** One zod object per raw shape, for the life of the shape. */
const objects = new WeakMap<object, z.ZodType>();
/** The zod objects whose JSON Schema answers from a memo. */
const memoized = new WeakSet<object>();
let enabled = true;

const isZodSchema = (v: unknown): boolean => typeof v === 'object' && v !== null && '_zod' in v;

/** The SDK's test for a raw shape (normalizeRawShapeSchema), so the two never disagree on what gets wrapped. */
function isRawShape(v: unknown): v is z.ZodRawShape {
    if (typeof v !== 'object' || v === null) return false;
    if ('~standard' in v) return false;
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(v).every(isZodSchema);
}

/** Make a zod schema's Standard Schema JSON methods answer from a memo, each call a fresh copy. */
function memoizeJsonSchema(schema: z.ZodType): void {
    if (memoized.has(schema)) return;
    const std = (schema as unknown as { '~standard'?: { jsonSchema?: StandardJsonSchema } & Record<string, unknown> })['~standard'];
    const json = std?.jsonSchema;
    if (!std || !json || typeof json.input !== 'function' || typeof json.output !== 'function') return;
    const memo = new Map<string, Json>();
    const through = (io: 'input' | 'output'): JsonSchemaMethod => (options?: unknown) => {
        const key = `${io} ${JSON.stringify(options ?? null)}`;
        let built = memo.get(key);
        if (!built) {
            built = json[io](options);
            memo.set(key, built);
        }
        return structuredClone(built);
    };
    // zod keeps `~standard` as an own, writable property once read (core util.hide); this replaces it
    // the same way, and every other member (validate, vendor, version) stays the one zod built.
    Object.defineProperty(schema, '~standard', {
        configurable: true, writable: true, enumerable: false,
        value: { ...std, jsonSchema: { input: through('input'), output: through('output') } },
    });
    memoized.add(schema);
}

/**
 * The schema to register in place of `schema`: for a raw shape, its one zod object; for a zod schema,
 * the same schema with a memo. Anything else is returned as it came. Off, everything is returned as
 * it came, which is the code path before this module.
 */
export function stableSchema(schema: unknown): unknown {
    if (!enabled || typeof schema !== 'object' || schema === null) return schema;
    if (isRawShape(schema)) {
        let object = objects.get(schema);
        if (!object) {
            object = z.object(schema);
            memoizeJsonSchema(object);
            objects.set(schema, object);
        }
        return object;
    }
    if (isZodSchema(schema)) memoizeJsonSchema(schema as z.ZodType);
    return schema;
}

/** `registerTool` with its input and output schemas made stable; every other argument passes as it came. */
export function stableToolSchemas(register: AnyFn): AnyFn {
    return (...args: unknown[]) => {
        const config = args[1] as Record<string, unknown> | undefined;
        if (!enabled || !config || typeof config !== 'object') return register(...args);
        const next = { ...config };
        if ('inputSchema' in config) next.inputSchema = stableSchema(config.inputSchema);
        if ('outputSchema' in config) next.outputSchema = stableSchema(config.outputSchema);
        return register(args[0], next, ...args.slice(2));
    };
}

/** Switch the cache off and on: for the test that compares the list both ways. */
export function setToolSchemaCache(on: boolean): void {
    enabled = on;
}
