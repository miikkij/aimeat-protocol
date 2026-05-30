/**
 * @file connector-surfaces.test.ts
 * @description Verifies the connector (`aimeat connect serve`) registers every tool each v2 surface
 *   needs, so `--surface <role>` exposes the same focused set locally as the server /v2/mcp/<role>.
 *   Uses the same fake-MCP capture as the schema audit (handlers never run at registration).
 * @version-history
 *   v1.0.0 -- 2026-05-30 -- v2 connector surfaces
 */
import { describe, it, expect } from 'vitest';
import { registerAllTools } from '../../src/cli/connect/mcp/tools/index.js';
import type { AgentRegistry } from '../../src/cli/connect/agent-registry.js';
import { MCP_SURFACES, toolsForSurface } from '../../src/mcp/catalog/surfaces.js';

/** Capture the tool names the connector registers (fake MCP + fake registry). */
function captureConnectorTools(): Set<string> {
    const names = new Set<string>();
    const fakeMcp = new Proxy({} as Record<string, unknown>, {
        get(_t, prop: string) {
            if (prop === 'server') return {};
            if (prop === 'tool' || prop === 'registerTool') return (...args: unknown[]) => { names.add(args[0] as string); return undefined; };
            return () => undefined;
        },
        set: () => true,
    });
    const fakeAgent = { client: new Proxy({}, { get: () => () => undefined }), agent: 'a', owner: 'o' };
    const fakeRegistry = new Proxy({}, { get: (_t, p: string) => (p === 'list' ? () => [fakeAgent] : p === 'size' ? () => 1 : () => fakeAgent) }) as unknown as AgentRegistry;
    registerAllTools(fakeMcp as never, fakeRegistry);
    return names;
}

const connector = captureConnectorTools();

describe('connector v2 surface coverage', () => {
    // The connector serves agents locally; it should fully cover the agent/appdev/service surfaces.
    for (const role of ['appdev', 'agent', 'service'] as const) {
        it(`connector registers every tool of the '${role}' surface (${MCP_SURFACES[role].length})`, () => {
            const missing = MCP_SURFACES[role].filter(t => !connector.has(t));
            expect(missing).toEqual([]);
        });
    }

    it("filtering to 'agent' yields exactly the agent allowlist on the connector", () => {
        const allow = toolsForSurface('agent');
        const filtered = [...connector].filter(t => allow.has(t)).sort();
        expect(filtered).toEqual([...allow].sort());
    });
});
