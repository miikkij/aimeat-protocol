/**
 * @file scripts/inventory/mcp-capture.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The input keys each agent-facing tool actually declares: the node MCP surface and the
 *   connector's, captured by registering the real tools against a fake MCP server (handlers never
 *   run), and the CLI dispatch table, read from its own definitions.
 *
 *   A declared key is what the MCP SDK lets through: it builds a zod object from the shape and strips
 *   every key the shape does not name, so a caller who passes an undeclared field gets ok and the
 *   field is gone. That makes the declared shape the honest answer to "can an agent set this field
 *   through this tool", and it is read at runtime rather than out of the source.
 *
 *   Moved out of audit-mcp-schemas.ts unchanged on 2026-09-14, so check:field-reach reads the same
 *   capture instead of a second copy.
 * @structure CapturedTool · captureServer() · captureConnector() · captureCliDispatch()
 * @usage const tools = captureServer(); tools.get('aimeat_company_update')?.inputKeys
 * @version-history
 *   v1.0.0 — 2026-09-14 — Extracted from scripts/audit-mcp-schemas.ts (v1.3.1).
 */
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AgentRegistry } from '../../src/cli/connect/agent-registry.js';

// ── The server's own registration, not a copy of it ──
import { registerAllServerTools } from '../../src/mcp/register-all.js';

// ── Connector register entrypoint ──
import { registerAllTools } from '../../src/cli/connect/mcp/tools/index.js';

// ── The CLI dispatch table and the catalog it takes its declared input from ──
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';
import { getAimeatToolDefinition } from '../../src/mcp/catalog/definitions.js';

export interface CapturedTool {
    inputKeys: string[];
    hasOutputSchema: boolean;
}

/** Extract the top-level input-schema keys from an mcp.tool(...) call's arguments. */
function keysFromToolArgs(args: unknown[]): string[] {
    // Codebase forms: tool(name, descString, schemaObj, annObj?, handler) or tool(name, schemaObj, handler)
    const candidate = typeof args[1] === 'string' ? args[2] : args[1];
    return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? Object.keys(candidate) : [];
}

/** A Proxy that satisfies whatever the register functions call; records tool registrations. */
function makeFakeMcp(sink: Map<string, CapturedTool>) {
    const server = {};
    return new Proxy({} as Record<string, unknown>, {
        get(_t, prop: string) {
            if (prop === 'server') return server;
            if (prop === 'tool') {
                return (...args: unknown[]) => {
                    sink.set(args[0] as string, { inputKeys: keysFromToolArgs(args), hasOutputSchema: false });
                    return undefined;
                };
            }
            if (prop === 'registerTool') {
                return (...args: unknown[]) => {
                    const cfg = (args[1] ?? {}) as { inputSchema?: object; outputSchema?: unknown };
                    sink.set(args[0] as string, {
                        inputKeys: cfg.inputSchema ? Object.keys(cfg.inputSchema) : [],
                        hasOutputSchema: cfg.outputSchema !== undefined,
                    });
                    return undefined;
                };
            }
            return () => undefined; // resource / registerResource / prompt / etc. — no-op
        },
        set() { return true; },
    });
}

/**
 * Register what the SERVER registers — through mcp/register-all.ts, the same call /v1/mcp makes.
 *
 * This used to be a hand-kept list of register functions here, and it fell behind: on 2026-09-03 it
 * loaded 26 groups while the server called 52. The audit did not go silent about it — it printed
 * twenty-seven whole families as "not server-registered" and still exited green, because they were
 * tracked as known. A blind spot with a plausible explanation for its own noise is worse than a
 * blind spot, because a real drift inside those families would have printed as one more line in a
 * list nobody could read. There is nothing to keep in step now: one list, both callers.
 */
export function captureServer(): Map<string, CapturedTool> {
    const sink = new Map<string, CapturedTool>();
    const mcp = makeFakeMcp(sink) as never;
    const noop = () => { };
    registerAllServerTools(mcp, {
        storage: {} as Storage,
        // Every optional feature ON, for the same reason the scopes below are '*': this asks what
        // the surface CAN register, not what one node has turned on. commerce and portfolio each
        // return early from their whole group when their flag is off, and with the flags absent the
        // audit read sixteen live tools as missing.
        config: {
            nodeId: 'audit-node', baseUrl: 'http://localhost', mcpEnforceScopes: true,
            commerceEnabled: true, portfolioEnabled: true,
        } as unknown as AimeatConfig,
        agentGaii: () => 'auditor#owner@audit-node',
        owner: () => 'owner',
        // Every scope, because this asks what the surface CAN register, not what one agent holds.
        scopes: ['*'],
        peers: new Map(),
        getToken: () => undefined,
        emitResourceUpdated: noop,
        emitResourceListChanged: noop,
    });
    return sink;
}

export function captureConnector(): Map<string, CapturedTool> {
    const sink = new Map<string, CapturedTool>();
    // Some connector modules call registry.resolve()/list() at registration time, so stub them.
    const fakeAgent = { client: new Proxy({}, { get: () => () => undefined }), agent: 'auditor', owner: 'owner' };
    const fakeRegistry = new Proxy({}, {
        get(_t, prop: string) {
            if (prop === 'list') return () => [fakeAgent];
            if (prop === 'size') return () => 1;
            return () => fakeAgent; // resolve() and anything else
        },
    }) as unknown as AgentRegistry;
    registerAllTools(makeFakeMcp(sink) as never, fakeRegistry);
    return sink;
}

/**
 * The CLI dispatch behind `aimeat connect call` and `/local/call/<tool>`: each tool's declared input,
 * which is its own `input` plus the catalog's, the same union tool-call.ts's withDeclaredInputOnly
 * accepts and refuses everything outside. Whether a declared key then LEAVES the process is
 * test/unit/cli-tool-param-forwarding.test.ts's question, and it invokes every handler to answer it.
 */
export function captureCliDispatch(): Map<string, CapturedTool> {
    const sink = new Map<string, CapturedTool>();
    for (const tool of CONNECT_CLI_TOOLS) {
        const keys = new Set([
            ...Object.keys(tool.input ?? {}),
            ...Object.keys(getAimeatToolDefinition(tool.name)?.input ?? {}),
        ]);
        sink.set(tool.name, { inputKeys: [...keys], hasOutputSchema: false });
    }
    return sink;
}
