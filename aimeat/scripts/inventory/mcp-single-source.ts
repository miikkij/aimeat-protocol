/**
 * @file scripts/inventory/mcp-single-source.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether each tool's WHOLE input schema, on both MCP surfaces, is the one its catalog
 *   entry builds (zodShapeFor, src/tool-catalog/zod-shape.ts; secaudit 2026-10, M3). The key-level
 *   audit beside it says two surfaces take the same parameter names; this says they take the same
 *   types, bounds, defaults and descriptions, because both read them from one place.
 *
 *   Each schema is turned into JSON Schema with zod's own converter and compared with sorted keys.
 *   The connector's `agent_name` is its own routing parameter and is left out. The tools not moved
 *   yet are listed in security/mcp-schema-single-source.json, and the list only shrinks: a tool that
 *   matches while listed is reported, so each move removes its names in the same commit.
 * @structure singleSourceReport(server, connector) · BASELINE_PATH
 * @usage const r = singleSourceReport(captureServer(), captureConnector()); r.unlisted, r.stale
 * @version-history
 *   v1.1.0 — 2026-10-05 — ownHandlerReport(): the connector tools that keep a handler of their own beside
 *     their CLI dispatch definition, against security/connector-own-handlers.json (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, M3).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../../src/tool-catalog/definitions.js';
import { zodShapeFor } from '../../src/tool-catalog/zod-shape.js';
import type { CapturedTool } from './mcp-capture.js';

export const BASELINE_PATH = new URL('../../security/mcp-schema-single-source.json', import.meta.url);

/** Sorted keys everywhere, and `required` lists sorted, so key order is not a difference. */
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value).sort()) {
            if (key === '$schema') continue;
            const v = (value as Record<string, unknown>)[key];
            out[key] = key === 'required' && Array.isArray(v) ? [...v].sort() : canonical(v);
        }
        return out;
    }
    return value;
}

export function schemaText(shape: Record<string, unknown> | undefined, drop: readonly string[] = []): string {
    const rest = { ...(shape ?? {}) };
    for (const key of drop) delete rest[key];
    try {
        return JSON.stringify(canonical(z.toJSONSchema(z.object(rest as z.ZodRawShape), { unrepresentable: 'any', io: 'input' })));
    } catch (err) {
        return `UNCONVERTIBLE: ${err instanceof Error ? err.message : String(err)}`;
    }
}

export const OWN_HANDLERS_PATH = new URL('../../security/connector-own-handlers.json', import.meta.url);

/**
 * Connector tools that have a CLI dispatch definition and still register a handler of their own
 * (src/cli/connect/mcp/tools/), against the list of the ones not yet settled. Every other connector
 * tool runs its dispatch definition (dispatch-tools.ts). A listed tool differs from its dispatch
 * definition in what it sends or answers; settling one means making the two the same and deleting
 * the handler. The list only shrinks.
 */
export function ownHandlerReport(dispatchNames: ReadonlySet<string>): { own: string[]; unlisted: string[]; stale: string[] } {
    const dir = fileURLToPath(new URL('../../src/cli/connect/mcp/tools/', import.meta.url));
    const own = new Set<string>();
    for (const f of readdirSync(dir)) {
        if (!f.endsWith('.ts') || f === 'dispatch-tools.ts') continue;
        for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/\bmcp\.(?:register)?[Tt]ool\(\s*'([a-z0-9_]+)'/g)) {
            if (dispatchNames.has(m[1]!)) own.add(m[1]!);
        }
    }
    const listed = new Set<string>((JSON.parse(readFileSync(OWN_HANDLERS_PATH, 'utf8')) as { tools: string[] }).tools);
    return {
        own: [...own].sort(),
        unlisted: [...own].filter(n => !listed.has(n)).sort(),
        stale: [...listed].filter(n => !own.has(n)).sort(),
    };
}

export interface SingleSourceReport {
    /** Tools whose surface schemas are not the catalog's. */
    differing: Map<string, string[]>;
    /** Differing, and not on the list: a new hand-written schema. */
    unlisted: string[];
    /** On the list, and matching: remove them from the list. */
    stale: string[];
    listed: number;
}

export function singleSourceReport(server: Map<string, CapturedTool>, connector: Map<string, CapturedTool>): SingleSourceReport {
    const listed = new Set<string>((JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as { tools: string[] }).tools);
    const catalog = new Set(CLI_FALLBACK_TOOL_DEFINITIONS.map(d => d.name));
    const differing = new Map<string, string[]>();
    for (const name of [...new Set([...server.keys(), ...connector.keys()])].sort()) {
        if (!catalog.has(name)) continue; // the key-level audit reports a tool missing from the catalog
        const want = schemaText(zodShapeFor(name));
        const why: string[] = [];
        const sv = server.get(name);
        if (sv && schemaText(sv.shape) !== want) why.push('node');
        const cn = connector.get(name);
        if (cn && schemaText(cn.shape, ['agent_name']) !== want) why.push('connector');
        if (why.length) differing.set(name, why);
    }
    return {
        differing,
        unlisted: [...differing.keys()].filter(n => !listed.has(n)),
        stale: [...listed].filter(n => !differing.has(n)).sort(),
        listed: listed.size,
    };
}
