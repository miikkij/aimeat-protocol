/**
 * @file test/unit/sandbox-identity.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `pnpm sandbox` tells its own node from another node on the recorded port by the node's
 *   published key (scripts/lib/sandbox-identity.ts). It said UP for another worktree's node and asked
 *   it for tokens (docs/pitfalls.md §77b until 2026-11-21). Two stub servers stand in for the nodes.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sandboxIdentity } from '../../scripts/lib/sandbox-identity.js';

function stub(key: string | null): Promise<Server> {
    const s = createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/v1/spec') { res.end('{}'); return; }
        if (req.url === '/.well-known/aimeat' && key) { res.end(JSON.stringify({ data: { public_key: key } })); return; }
        res.statusCode = 404; res.end('{}');
    });
    return new Promise(r => s.listen(0, '127.0.0.1', () => r(s)));
}
const url = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

let ours: Server, other: Server;
beforeAll(async () => { ours = await stub('KEY-OURS'); other = await stub('KEY-OTHER'); });
afterAll(() => { ours.close(); other.close(); });

describe('the sandbox answering on the recorded port is this one', () => {
    it('is ours when the key matches', async () => {
        expect(await sandboxIdentity(url(ours), 'KEY-OURS')).toBe('ours');
    });
    it('is another node when a node answers with a different key', async () => {
        expect(await sandboxIdentity(url(other), 'KEY-OURS')).toBe('other');
    });
    it('is down when nothing answers, and ours for a state written before keys were recorded', async () => {
        expect(await sandboxIdentity('http://127.0.0.1:9', 'KEY-OURS')).toBe('down');
        expect(await sandboxIdentity(url(other), undefined)).toBe('ours');
    });
});
