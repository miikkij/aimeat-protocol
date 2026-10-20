/**
 * @file test/unit/mcp-sdk-seams.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP SDK still has every private member mcp/sdk-seams.ts reaches for, and each
 *   seam does its job on a real McpServer. A failure here names the member that is gone, so an SDK
 *   upgrade that renamed one fails in CI with the reason, not in a client as "tool not found" or a
 *   null that is refused (MCP migration plan doc-mvguy322f9se, step 2).
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-sdk-seams.test.ts
 * @version-history
 *   v1.1.0 — 2026-10-20 — On SDK v2: @modelcontextprotocol/server, a z.object schema, and the tools
 *     are called through a real client over an in-memory transport.
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { seamsPresent, wrapToolsCall, registeredTools, wrapToolInputValidation } from '../../src/mcp/sdk-seams.js';

/** Call one tool on `mcp` through a real client over an in-memory transport. */
async function call(mcp: McpServer, name: string, args: Record<string, unknown>): Promise<unknown> {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'seams-test', version: '1.0.0' }, { capabilities: {} });
    await Promise.all([mcp.server.connect(serverSide), client.connect(clientSide)]);
    try { return await client.callTool({ name, arguments: args }); } finally { await client.close(); }
}

function server(): McpServer {
    const mcp = new McpServer({ name: 'seams', version: '1.0.0' });
    mcp.registerTool('echo', { description: 'echo', inputSchema: z.object({ text: z.string(), note: z.string().optional() }) },
        async ({ text }) => ({ content: [{ type: 'text', text }] }));
    return mcp;
}

describe('the SDK members mcp/sdk-seams.ts reaches', () => {
    it('are all still there (a false names the member an SDK release renamed or removed)', () => {
        expect(seamsPresent(server())).toEqual({ requestHandlers: true, toolsCallHandler: true, registeredTools: true, validateToolInput: true });
    });

    it('wrapToolsCall puts a function in front of the SDK\'s tools/call handler, and the original still runs', async () => {
        const mcp = server();
        const seen: string[] = [];
        expect(wrapToolsCall(mcp, (original) => async (request, extra) => { seen.push(String(request.params?.name)); return original(request, extra); })).toBe(true);
        const out = await call(mcp, 'echo', { text: 'hi' });
        expect(seen).toEqual(['echo']);
        expect(JSON.stringify(out)).toContain('hi');
    });

    it('wrapToolsCall answers false on a server with no tool, so the caller can warn', () => {
        expect(wrapToolsCall(new McpServer({ name: 'empty', version: '1.0.0' }), (o) => o)).toBe(false);
    });

    it('registeredTools lists what was registered, with the SDK\'s enable and disable', () => {
        const tools = registeredTools(server());
        expect(Object.keys(tools)).toEqual(['echo']);
        expect(typeof tools.echo.disable).toBe('function');
        expect(tools.echo.enabled).toBe(true);
    });

    it('wrapToolInputValidation is called for every tool call\'s arguments', async () => {
        const mcp = server();
        const seen: string[] = [];
        wrapToolInputValidation(mcp, (original) => async (tool, args, name) => { seen.push(name); return original(tool, args, name); });
        await call(mcp, 'echo', { text: 'x' });
        expect(seen).toEqual(['echo']);
    });
});
