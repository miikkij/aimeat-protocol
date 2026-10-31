/**
 * @file connect-auth-held-node.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `aimeat connect` sends the bearer and the return proof it holds for an agent only to
 *   the node that agent was connected to (secaudit2026oct31w2, W2-2,
 *   runAuth-sends-held-credential-and-proof-to-another-node). The connector keys its token, key and
 *   settings by `<agent>@<owner>`, with no node, and the per-agent settings name the node. A connect
 *   to another address with the same names starts a fresh device request there, without the held
 *   bearer and without a proof signed by the held key, and says which node holds those names. A
 *   reconnect to the stored node sends both, as before.
 *
 *   Two loopback stubs stand in for the nodes. Both publish the SAME node id at
 *   /.well-known/aimeat, because a node can report any id; the stored address is what tells them
 *   apart. Each stub answers the inbox check with 401, takes the device request, and answers the
 *   first poll with access_denied, so runAuth ends at process.exit (stubbed to throw).
 * @usage cd aimeat && pnpm exec vitest run test/unit/connect-auth-held-node.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit2026oct31w2 round 10, W2-2).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { proofVerifies } from '../../src/services/device-return-proof.js';

interface Seen { method: string; path: string; authorization?: string; body?: Record<string, unknown> }

/** One fake node: records every request; its card names `nodeId` whatever its address is. */
async function stubNode(nodeId: string): Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0];
      let body: Record<string, unknown> | undefined;
      try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
      seen.push({ method: req.method ?? '', path, authorization: req.headers.authorization, body });
      res.setHeader('Content-Type', 'application/json');
      if (path === '/.well-known/aimeat') { res.end(JSON.stringify({ ok: true, data: { node_id: nodeId } })); return; }
      if (path.endsWith('/inbox')) { res.statusCode = 401; res.end(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'no' } })); return; }
      if (path === '/v1/agents/device-authorize') {
        res.end(JSON.stringify({ ok: true, data: { device_code: 'dc', user_code: 'UC-1', verification_uri: `http://x/v1/agents/verify`, interval: 0 } }));
        return;
      }
      if (path === '/v1/agents/device-token') { res.statusCode = 400; res.end(JSON.stringify({ error: 'access_denied' })); return; }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise<void>(r => server.close(() => r())) };
}

let home = '';
let nodeA: Awaited<ReturnType<typeof stubNode>>;
let nodeB: Awaited<ReturnType<typeof stubNode>>;
let publicKey = '';

/** Store token, key and settings for assistant@alice as a connect to `nodeUrl` leaves them. */
async function holdFor(nodeUrl: string | null, opts: { globalOnly?: boolean } = {}) {
  process.env.AIMEAT_HOME = home;
  vi.resetModules();
  const keychain = await import('../../src/cli/connect/keychain.js');
  const config = await import('../../src/cli/connect/config.js');
  const kp = await generateKeyPair();
  publicKey = kp.publicKey;
  await keychain.storeToken('assistant', 'alice', 'tok-held');
  await keychain.storeAgentKey('assistant', 'alice', kp.privateKey);
  if (nodeUrl && opts.globalOnly) config.saveConfig({ node_url: nodeUrl, agent: 'assistant', owner: 'alice' });
  else if (nodeUrl) config.savePerAgentConfig('assistant', 'alice', { node_url: nodeUrl, primary: true });
}

async function connect(url: string): Promise<string> {
  process.env.AIMEAT_HOME = home;
  vi.resetModules();
  const { runAuth } = await import('../../src/cli/connect/auth.js');
  const lines: string[] = [];
  const log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  const spies = [
    vi.spyOn(console, 'log').mockImplementation(log),
    vi.spyOn(console, 'warn').mockImplementation(log),
    vi.spyOn(console, 'error').mockImplementation(log),
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never),
  ];
  try {
    await runAuth({ url, owner: 'alice', agent: 'assistant' }).catch((e: Error) => {
      if (!/^exit /.test(e.message)) throw e;
    });
  } finally {
    for (const s of spies) s.mockRestore();
  }
  return lines.join('\n');
}

const withBearer = (seen: Seen[]) => seen.filter(s => s.authorization?.includes('tok-held'));
const deviceRequest = (seen: Seen[]) => seen.find(s => s.path === '/v1/agents/device-authorize');

describe('aimeat connect sends a held credential only to the node it belongs to (W2-2)', () => {
  beforeEach(async () => {
    home = resolve(process.cwd(), `test/.tmp-auth-held-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(home, { recursive: true });
    nodeA = await stubNode('node-A');
    nodeB = await stubNode('node-A');
  });
  afterEach(async () => {
    delete process.env.AIMEAT_HOME;
    await nodeA.close();
    await nodeB.close();
    try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('a connect to another node sends neither the held bearer nor a proof, and names the node that holds them', async () => {
    await holdFor(nodeA.url);
    const out = await connect(nodeB.url);
    expect(withBearer(nodeB.seen)).toHaveLength(0);
    const req = deviceRequest(nodeB.seen);
    expect(req, 'the fresh device request still goes to the new node').toBeDefined();
    expect(req?.body?.proof).toBeUndefined();
    expect(nodeA.seen).toHaveLength(0);
    expect(out).toContain(nodeA.url);
  });

  it('the same holds when only the old single-agent settings name the node', async () => {
    await holdFor(nodeA.url, { globalOnly: true });
    await connect(nodeB.url);
    expect(withBearer(nodeB.seen)).toHaveLength(0);
    expect(deviceRequest(nodeB.seen)?.body?.proof).toBeUndefined();
  });

  it('usage: a reconnect to the node it was set up for sends the bearer and a proof that node accepts', async () => {
    await holdFor(nodeA.url);
    await connect(nodeA.url);
    expect(withBearer(nodeA.seen).map(s => s.path)).toContain('/v1/agents/assistant/inbox');
    const req = deviceRequest(nodeA.seen);
    expect(req?.body?.proof).toBeDefined();
    expect(await proofVerifies(publicKey, 'alice', 'assistant', req?.body?.proof, Date.now(), 'node-A')).toBe(true);
    expect(nodeB.seen).toHaveLength(0);
  });

  it('usage: the address written with a trailing slash is the same node', async () => {
    await holdFor(`${nodeA.url}/`);
    await connect(nodeA.url);
    expect(withBearer(nodeA.seen)).not.toHaveLength(0);
    expect(deviceRequest(nodeA.seen)?.body?.proof).toBeDefined();
  });
});
