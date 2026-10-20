/**
 * @file test/unit/mcp-client-negotiation.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's MCP client negotiates the revision with a Streamable HTTP server
 *   (services/mcp-client/pool.ts): 2026-07-28 with a server that serves it, the 2025 handshake with
 *   one that does not, and a reconnect reuses the era it answered instead of probing again. Two real
 *   far sides on loopback, both built from the SDK v2 server package.
 * @version-history
 *   v1.0.0 -- 2026-10-20 -- Initial (MCP SDK v2 migration step 9).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { McpServer, createMcpHandler, legacyStatelessFallback } from '@modelcontextprotocol/server';
import { toNodeHandler, type NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import { McpClientPool } from '../../src/services/mcp-client/pool.js';

// Loopback egress is gated, and these far sides are real sockets on loopback.
process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';

function factory(): McpServer {
    const srv = new McpServer({ name: 'far-side', version: '1.0.0' });
    srv.registerTool('echo', { description: 'Echo the text back', inputSchema: { text: z.string() } },
        async ({ text }) => ({ content: [{ type: 'text', text }] }));
    return srv;
}

/** A far side on loopback that counts the server/discover probes it receives. */
async function farSide(fetchHandler: (r: Request) => Promise<Response>): Promise<{ server: http.Server; url: string; probes: () => number }> {
    let probes = 0;
    const node = toNodeHandler({ fetch: fetchHandler });
    const server = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw ? JSON.parse(raw) : undefined;
        if (body?.method === 'server/discover') probes++;
        await node(req as unknown as NodeIncomingMessageLike, res, body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, probes: () => probes };
}

const record = (id: string, url: string): McpServerRecord => ({
    id, slug: id, name: id, scope: 'node', ownerGhii: null, enabled: true,
    transport: { kind: 'http', url }, auth: { mode: 'none' },
} as unknown as McpServerRecord);

let modernSide: Awaited<ReturnType<typeof farSide>>;
let legacySide: Awaited<ReturnType<typeof farSide>>;

beforeAll(async () => {
    // Serves 2026-07-28 and, statelessly, the 2025 revisions: the SDK handler's default.
    const both = createMcpHandler(async () => factory());
    modernSide = await farSide((r) => both.fetch(r));
    // Serves only the 2025 revisions, the way a server on an older SDK does.
    const legacyOnly = legacyStatelessFallback(async () => factory());
    legacySide = await farSide((r) => legacyOnly(r));
});

afterAll(async () => {
    for (const s of [modernSide, legacySide]) {
        s.server.closeAllConnections();
        await new Promise<void>((r) => s.server.close(() => r()));
    }
});

describe('the MCP client negotiates the revision with a Streamable HTTP server', () => {
    it('speaks 2026-07-28 with a server that serves it, and a reconnect skips the probe', async () => {
        const pool = new McpClientPool();
        const server = record('modern-side', modernSide.url);
        const client = await pool.acquire(server, null, 'node');
        expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
        expect(pool.eraOf(server.id, 'node')).toBe('modern');
        const r = await client.callTool({ name: 'echo', arguments: { text: 'hello' } });
        expect(JSON.stringify(r.content)).toContain('hello');
        expect(modernSide.probes()).toBe(1);

        await pool.closeAll();
        const again = await pool.acquire(server, null, 'node');
        expect(again.getNegotiatedProtocolVersion()).toBe('2026-07-28');
        expect(modernSide.probes()).toBe(1);
        await pool.closeAll();
    });

    it('falls back to the 2025 handshake with a server that does not, and a reconnect does not probe again', async () => {
        const pool = new McpClientPool();
        const server = record('legacy-side', legacySide.url);
        const client = await pool.acquire(server, null, 'node');
        expect(client.getNegotiatedProtocolVersion()).not.toBe('2026-07-28');
        expect(pool.eraOf(server.id, 'node')).toBe('legacy');
        const r = await client.callTool({ name: 'echo', arguments: { text: 'hi' } });
        expect(JSON.stringify(r.content)).toContain('hi');
        const probesAfterFirst = legacySide.probes();
        expect(probesAfterFirst).toBe(1);

        await pool.closeAll();
        await pool.acquire(server, null, 'node');
        expect(legacySide.probes()).toBe(probesAfterFirst);
        await pool.closeAll();
    });

    it('asks again after the record is invalidated', async () => {
        const pool = new McpClientPool();
        const server = record('modern-side-2', modernSide.url);
        const before = modernSide.probes();
        await pool.acquire(server, null, 'node');
        await pool.invalidate(server.id);
        expect(pool.eraOf(server.id, 'node')).toBeUndefined();
        await pool.acquire(server, null, 'node');
        expect(modernSide.probes()).toBe(before + 2);
        await pool.closeAll();
    });
});
