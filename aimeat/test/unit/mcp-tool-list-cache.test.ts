/**
 * @file test/unit/mcp-tool-list-cache.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The JSON Schemas of `tools/list` are built once per tool schema, not on every list
 *   (mcp/tool-schema-cache.ts; codebase analysis 2026-11-03, item C5, decision 11b of 2026-11-05).
 *
 *   THE LIST STAYS THE SAME, BYTE FOR BYTE. On the real MCP router over in-memory SQLite, for the
 *   person's own full-access agent (what an owner's MCP sign-in gives), a scoped agent, an owner
 *   session and an app grant, on both MCP code paths (a 2025-era session and a stateless 2026-07-28
 *   request) and on two surfaces (/v1/mcp and the chat surface, which lists its own short texts), the
 *   `tools/list` answer with the cache on is the answer with it off, the old code path. An owner
 *   session and an app grant token are refused on the MCP endpoint (401, before and after: the
 *   person's MCP sign-in is an agent, which is what "full" is), and the refusal is compared too.
 *
 *   THE WORK IS DONE ONCE. After the first list, a second list of the same tool set converts no
 *   schema at all; the time per list is printed before and after.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-tool-list-cache.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 11b of 2026-11-05).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const quiet: unknown = new Proxy({}, { get: () => () => quiet });
  return { ...real, logger: quiet };
});

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage, issueJWT } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { mcpRouter } from '../../src/mcp/index.js';
import { MCP_PROTOCOL_VERSION } from '../../src/mcp/protocol-version.js';
import { setToolSchemaCache } from '../../src/mcp/tool-schema-cache.js';
import { z } from 'zod';

/**
 * Every JSON Schema zod builds for a z.object's Standard Schema, counted where zod defines it (the
 * `~standard` getter on the ZodObject prototype), so the count is the same instrument with the cache
 * on and off. A tool's input schema is a z.object on every MCP surface.
 */
let conversions = 0;
function countZodObjectConversions(): void {
  const proto = Object.getPrototypeOf(z.object({})) as object;
  const desc = Object.getOwnPropertyDescriptor(proto, '~standard');
  if (!desc?.get) throw new Error('zod no longer defines ~standard as a getter on the ZodObject prototype');
  const get = desc.get;
  Object.defineProperty(proto, '~standard', {
    ...desc,
    get(this: object) {
      const std = get.call(this) as { jsonSchema?: { input: (o?: unknown) => unknown; output: (o?: unknown) => unknown } };
      if (std.jsonSchema && !(std.jsonSchema as { counted?: boolean }).counted) {
        const { input, output } = std.jsonSchema;
        std.jsonSchema = Object.assign({
          input: (o?: unknown) => { conversions++; return input(o); },
          output: (o?: unknown) => { conversions++; return output(o); },
        }, { counted: true });
      }
      return std;
    },
  });
}
countZodObjectConversions();

const NODE_ID = 'aimeat-tool-list-cache-test';
const OWNER = 'listowner';
const GHII = `${OWNER}@${NODE_ID}`;
const FULL = `claude#${OWNER}@${NODE_ID}`;
const SCOPED = `reader#${OWNER}@${NODE_ID}`;
const LEGACY_VERSION = '2025-06-18';

let server: http.Server;
let base = '';
const tokens: Record<string, string> = {};

beforeAll(async () => {
  setThisNodeId(null);
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  const config: AimeatConfig = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test', corsAllowedOrigins: ['*'] };
  const keys = await generateKeyPair();
  await initNodeKeys(keys.publicKey, keys.privateKey);
  initSessionAuth(storage, config);
  initRevocationStorage(storage, NODE_ID);
  await initStats();
  const now = new Date();
  const created = new Date(now.getTime() - 60_000).toISOString();
  const expires = new Date(now.getTime() + 3_600_000).toISOString();
  await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: keys.publicKey, roles: ['owner'], createdAt: created } as never);
  await storage.createGHII({ username: OWNER, nodeId: NODE_ID, ghii: GHII, displayName: OWNER, ownerName: OWNER, totpEnabled: false, verificationLevel: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() } as never);
  const agents: Array<[string, string, string[]]> = [['full', FULL, ['*']], ['scoped', SCOPED, ['memory:read', 'social:read', 'social:write']]];
  for (const [label, gaii, scopes] of agents) {
    await storage.createAgent({ name: gaii.split('#')[0], owner: OWNER, gaii, publicKey: keys.publicKey, trustScore: 50, morselBalance: 0, capabilities: [], defaultScopes: scopes, createdAt: created, lastSeen: now.toISOString() } as never);
    await storage.createSession({ sessionId: `list-${label}`, gaii, owner: OWNER, issuedAt: now.toISOString(), expiresAt: expires });
    tokens[label] = await issueJWT({ sub: gaii, owner: OWNER, node: NODE_ID, roles: ['agent'], scopes }, 3600, `list-${label}`);
  }
  await storage.createSession({ sessionId: 'list-owner', gaii: OWNER, owner: OWNER, issuedAt: now.toISOString(), expiresAt: expires });
  tokens.owner = await issueJWT({ sub: OWNER, owner: OWNER, node: NODE_ID, roles: ['owner'] }, 3600, 'list-owner');
  // An app grant token as routes/app-grants.ts issues it: the owner's GHII, role app, the granted words.
  tokens.app = await issueJWT({ sub: GHII, owner: OWNER, node: NODE_ID, roles: ['app'], scopes: ['memory:read'], app_grant: 'grant-list-test', app: `${OWNER}/list.html` } as never, 3600);
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware());
  app.use(mcpRouter(config, storage, new Map()));
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  setToolSchemaCache(true);
  server?.closeAllConnections();
  await new Promise((r) => server.close(() => r(null)));
  setThisNodeId(null);
});

/** The JSON-RPC message in a body that is JSON or one SSE event, as the exact text the server sent. */
function messageText(body: string): string {
  const line = body.split('\n').find(l => l.startsWith('data: '));
  return line ? line.slice(6) : body;
}

const baseHeaders = (token: string) => ({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` });

/** tools/list on a stateless 2026-07-28 request: the status and the exact message text. */
async function modernList(path: string, token: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { ...baseHeaders(token), 'MCP-Protocol-Version': MCP_PROTOCOL_VERSION, 'Mcp-Method': 'tools/list' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION, 'io.modelcontextprotocol/clientCapabilities': {} } } }),
  });
  return { status: res.status, text: messageText(await res.text()) };
}

/** A 2025-era session: initialize, then tools/list on it. The status and exact message text of the list. */
async function legacyList(path: string, token: string): Promise<{ status: number; text: string }> {
  const init = await fetch(`${base}${path}`, {
    method: 'POST', headers: baseHeaders(token),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: LEGACY_VERSION, capabilities: {}, clientInfo: { name: 'list-cache-test', version: '1.0.0' } } }),
  });
  const initText = await init.text();
  const session = init.headers.get('mcp-session-id');
  if (!session) return { status: init.status, text: messageText(initText) };
  const res = await fetch(`${base}${path}`, {
    method: 'POST', headers: { ...baseHeaders(token), 'mcp-session-id': session, 'mcp-protocol-version': LEGACY_VERSION },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} }),
  });
  const text = messageText(await res.text());
  await fetch(`${base}${path}`, { method: 'DELETE', headers: { ...baseHeaders(token), 'mcp-session-id': session, 'mcp-protocol-version': LEGACY_VERSION } });
  return { status: res.status, text };
}

const PRINCIPALS = ['full', 'scoped', 'owner', 'app'] as const;
const PATHS = ['/v1/mcp', '/v2/mcp/chat'] as const;
const ERAS = { modern: modernList, legacy: legacyList } as const;

describe('tools/list JSON Schemas built once (codebase analysis 2026-11-03, decision 11b)', () => {
  it('the list every caller receives is byte-identical with the cache on and off, on both code paths', async () => {
    const answered: string[] = [];
    for (const era of Object.keys(ERAS) as Array<keyof typeof ERAS>) {
      for (const path of PATHS) {
        for (const who of PRINCIPALS) {
          setToolSchemaCache(false);
          const before = await ERAS[era](path, tokens[who]);
          setToolSchemaCache(true);
          const cold = await ERAS[era](path, tokens[who]);
          const warm = await ERAS[era](path, tokens[who]);
          const label = `${era} ${path} ${who}`;
          answered.push(`${label}: ${before.status}, ${before.text.length} bytes`);
          expect(cold.status, label).toBe(before.status);
          expect(warm.status, label).toBe(before.status);
          expect(cold.text === before.text, `${label}: the first list with the cache differs`).toBe(true);
          expect(warm.text === before.text, `${label}: a cached list differs`).toBe(true);
          if (who === 'full' || who === 'scoped') {
            expect(before.status, label).toBe(200);
            const tools = (JSON.parse(before.text) as { result?: { tools?: unknown[] } }).result?.tools ?? [];
            expect(tools.length, label).toBeGreaterThan(who === 'full' && path === '/v1/mcp' ? 300 : 5);
          }
        }
      }
    }
    console.log(`[11b] what each caller was answered:\n${answered.join('\n')}`);
  }, 240_000);

  it('a second list of the same tool set converts no schema, and is faster', async () => {
    setToolSchemaCache(false);
    const timeOf = async (n: number) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) expect((await modernList('/v1/mcp', tokens.full)).status).toBe(200);
      return (performance.now() - t0) / n;
    };
    await timeOf(2);
    let converted = conversions;
    const off = await timeOf(10);
    const perListOff = (conversions - converted) / 10;
    setToolSchemaCache(true);
    await modernList('/v1/mcp', tokens.full);
    await legacyList('/v1/mcp', tokens.full);
    converted = conversions;
    const on = await timeOf(10);
    const legacy = await legacyList('/v1/mcp', tokens.full);
    expect(legacy.status).toBe(200);
    // Before: every list converted every listed tool's schema again (about 500 for this agent).
    expect(perListOff, 'conversions per list without the cache').toBeGreaterThan(300);
    expect(conversions - converted, 'conversions after warm-up, both code paths').toBe(0);
    console.log(`[11b] modern tools/list for a full-access agent: ${perListOff} schema conversions and ${off.toFixed(1)} ms per list without the cache, 0 and ${on.toFixed(1)} ms with it`);
  }, 120_000);
});
