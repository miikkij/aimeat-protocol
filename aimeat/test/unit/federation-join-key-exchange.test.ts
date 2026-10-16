/**
 * @file test/unit/federation-join-key-exchange.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `aimeat join` (cli/federation-join.ts) against a fake peer built from a fetch double.
 *   QA audit F5-06: a failed key exchange was reported only on the spinner, the command then wrote
 *   AIMEAT_FEDERATION_ROLE and AIMEAT_GENESIS_URL to .env, printed "Joined!" and exited 0; and the
 *   exchange sent `public_key`, which the route refuses because it requires `node_public_key`.
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F5-06).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const said: string[] = [];
vi.mock('@clack/prompts', () => {
  const rec = (m?: unknown) => { if (m !== undefined) said.push(String(m)); };
  return {
    intro: rec, outro: rec, cancel: rec, note: rec,
    log: { info: rec, warn: rec, error: rec, success: rec },
    spinner: () => ({ start: rec, stop: rec, message: rec }),
    text: async () => { throw new Error('the join prompted for a URL in a test'); },
    select: async () => { throw new Error('the join prompted for a choice in a test'); },
    isCancel: () => false,
  };
});

const { runFederationJoin } = await import('../../src/cli/federation-join.js');
const { generateKeyPair } = await import('../../src/auth/keypair.js');
const { createT } = await import('../../src/i18n.js');
const t = createT('en');

const TARGET = 'http://peer.example.test';
const dir = mkdtempSync(join(tmpdir(), 'aimeat-join-'));
const startCwd = process.cwd();
const savedEnv = { ...process.env };
let keyExchangeBodies: Array<Record<string, unknown>> = [];

/** The fake peer. `exchange` decides how /v1/federation/key-exchange answers. */
function fakePeer(exchange: (body: Record<string, unknown>) => { status: number; body: unknown }) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.endsWith('/.well-known/aimeat')) return reply(200, { ok: true, data: { node_id: 'peer-node', protocol: 'aimeat' } });
    if (u.endsWith('/v1/federation/peer/introduce')) return reply(201, { ok: true, data: { request_id: 'r1', status: 'auto_approved' } });
    if (u.endsWith('/v1/federation/key-exchange')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      keyExchangeBodies.push(body);
      const r = exchange(body);
      return reply(r.status, r.body);
    }
    return reply(404, { ok: false, error: { code: 'NOT_FOUND', message: u } });
  });
}

/** The receiving route's own rule (routes/federation-peer/lifecycle.ts): node_public_key is required. */
const realRoute = (body: Record<string, unknown>) => (!body.node_id || !body.node_public_key
  ? { status: 400, body: { ok: false, error: { code: 'INVALID_INPUT', message: 'node_id and node_public_key are required' } } }
  : { status: 200, body: { ok: true, data: { node_id: 'peer-node', public_key: 'peer-key' } } });

const config = {
  nodeId: 'aimeat-join-test', baseUrl: 'http://localhost:1', nodeType: 'full',
  federationRole: 'contributor', genesisUrl: null,
} as unknown as Parameters<typeof runFederationJoin>[0];

beforeAll(async () => {
  const keys = await generateKeyPair();
  process.env.AIMEAT_PUBLIC_KEY = keys.publicKey;
  process.env.AIMEAT_PRIVATE_KEY = keys.privateKey;
  process.chdir(dir);
});
afterAll(() => {
  process.chdir(startCwd);
  process.env = savedEnv;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  said.length = 0;
  keyExchangeBodies = [];
  delete process.env.AIMEAT_GENESIS_URL;
  delete process.env.AIMEAT_FEDERATION_ROLE;
  // A .env in the working directory, so every write lands here and nowhere else.
  writeFileSync(join(dir, '.env'), '# test\n');
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('aimeat join: the key exchange decides the outcome', () => {
  it('a refused key exchange returns false, saves no federation state and prints no success text', async () => {
    vi.stubGlobal('fetch', fakePeer(() => ({ status: 500, body: { ok: false, error: { code: 'INTERNAL', message: 'boom' } } })));
    const joined = await runFederationJoin(config, TARGET);
    expect(joined).toBe(false);
    const env = readFileSync(join(dir, '.env'), 'utf-8');
    expect(env).not.toContain('AIMEAT_GENESIS_URL');
    expect(env).not.toContain('AIMEAT_FEDERATION_ROLE');
    expect(said).not.toContain(t('join.done'));
    expect(said).toContain(t('join.notJoined'));
    expect(said.some(s => s.includes('INTERNAL'))).toBe(true);
  });

  it('sends node_public_key, the field the route requires, and then saves the state and says joined', async () => {
    vi.stubGlobal('fetch', fakePeer(realRoute));
    const joined = await runFederationJoin(config, TARGET);
    expect(keyExchangeBodies[0]?.node_public_key).toBe(process.env.AIMEAT_PUBLIC_KEY);
    expect(joined).toBe(true);
    const env = readFileSync(join(dir, '.env'), 'utf-8');
    expect(env).toContain(`AIMEAT_GENESIS_URL="${TARGET}"`);
    expect(env).toContain('AIMEAT_FEDERATION_ROLE="contributor"');
    expect(said).toContain(t('join.done'));
  });

  it('an unreachable target returns false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await runFederationJoin(config, TARGET)).toBe(false);
    expect(readFileSync(join(dir, '.env'), 'utf-8')).not.toContain('AIMEAT_GENESIS_URL');
  });
});
