/**
 * @file test/unit/mcp-client-oauth.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The OAuth round against a REAL authorization server, not a mock of one.
 *
 *   What is in doubt here is not our code calling our functions. It is whether the SDK's `auth()`
 *   walk — RFC 9728 protected-resource metadata, RFC 8414 authorization-server metadata, RFC 7591
 *   dynamic client registration, PKCE — finds its way through a server that answers the way the
 *   specs say, and whether the four things our provider has to remember survive the two HTTP
 *   requests the round is split across. Only a server on a socket answers that.
 *
 *   The stub below implements the metadata documents, the registration endpoint and the token
 *   endpoint literally. It verifies the PKCE challenge rather than accepting anything, because a
 *   round that "works" against a server which never checks the verifier proves nothing about the
 *   half that never travels.
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy, the OAuth credential path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import { startMcpOAuth, finishMcpOAuth } from '../../src/services/mcp-client/oauth.js';
import { openMcpCredential } from '../../src/services/mcp-client/credential.js';
import { mcpClientPool } from '../../src/services/mcp-client/pool.js';
import type { AimeatConfig } from '../../src/config.js';

process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';

const PORT = 40688;
const KEY = 'c'.repeat(64);
const BASE = `http://127.0.0.1:${PORT}`;

const config = {
  nodeId: 'test-node-001',
  baseUrl: 'http://127.0.0.1:40689',
  encryptionKey: KEY,
  totpSecretEncryptionKey: null,
} as unknown as AimeatConfig;

/** What the stub recorded, so the test can assert on what actually crossed the wire. */
const seen = {
  registered: false,
  challenge: '',
  method: '',
  redirectUri: '',
  verifierAccepted: false,
  refreshUsed: false,
};

let server: http.Server;

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', BASE);
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const readBody = async (): Promise<string> => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      return Buffer.concat(chunks).toString('utf8');
    };

    // RFC 9728: the MCP endpoint says which authorization server protects it.
    if (url.pathname === '/.well-known/oauth-protected-resource' ||
        url.pathname === '/.well-known/oauth-protected-resource/mcp') {
      return json({ resource: `${BASE}/mcp`, authorization_servers: [BASE] });
    }
    // RFC 8414: what that authorization server offers.
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json({
        issuer: BASE,
        authorization_endpoint: `${BASE}/authorize`,
        token_endpoint: `${BASE}/token`,
        registration_endpoint: `${BASE}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
      });
    }
    // RFC 7591: dynamic client registration.
    if (url.pathname === '/register' && req.method === 'POST') {
      const body = JSON.parse(await readBody()) as Record<string, unknown>;
      seen.registered = true;
      seen.redirectUri = (body.redirect_uris as string[] | undefined)?.[0] ?? '';
      // RFC 7591 §3.2.1: the response ECHOES the registered metadata back beside the credentials,
      // and the SDK validates that rather than trusting it. A stub returning only the id and the
      // secret is refused with "expected array, received undefined" for redirect_uris — which is
      // the client library being right, and was worth finding here rather than at a real server.
      return json({ ...body, client_id: 'client-abc', client_secret: 'secret-xyz' }, 201);
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody());
      if (form.get('grant_type') === 'refresh_token') {
        seen.refreshUsed = true;
        return json({ access_token: 'renewed-token', token_type: 'Bearer', expires_in: 3600 });
      }
      // The half that never travels: the verifier must hash to the challenge we saw earlier.
      const verifier = form.get('code_verifier') ?? '';
      const hashed = createHash('sha256').update(verifier).digest('base64url');
      seen.verifierAccepted = hashed === seen.challenge && seen.challenge !== '';
      if (!seen.verifierAccepted) return json({ error: 'invalid_grant' }, 400);
      return json({
        access_token: 'first-token',
        token_type: 'Bearer',
        refresh_token: 'refresh-me',
        expires_in: 3600,
      });
    }
    return json({ error: 'not_found' }, 404);
  });
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()));
});

afterAll(async () => {
  await mcpClientPool.closeAll();
  await new Promise<void>((r) => server.close(() => r()));
});

function makeRow(over: Partial<McpServerRecord> = {}): McpServerRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), slug: 'oauthy', title: 'OAuth server', description: '',
    ownership: 'owner', ownerGhii: 'alice@test-node-001', organismId: null, ws: null,
    createdBy: 'alice@test-node-001',
    transport: { kind: 'http', url: `${BASE}/mcp` },
    auth: 'oauth', credential: null, credentialShape: null,
    expiresAt: null, providerClientId: null,
    callerIdentity: 'node-credential', exposure: 'gateway',
    toolCache: [], toolCacheHash: '', lastListedAt: null,
    availability: null, allowlist: [], price: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true, status: 'needs_reauth', lastOkAt: null, lastError: null,
    createdAt: now, updatedAt: now, ...over,
  };
}

describe('the OAuth round, against a real authorization server', () => {
  it('discovers, registers and produces an address for a PERSON', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow();
    await storage.createMcpServer(row);

    const started = await startMcpOAuth({
      storage, config, server: row, ownerGhii: 'alice@test-node-001', returnUrl: '/spa.html#access',
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    // It walked the whole ladder rather than guessing an endpoint.
    expect(seen.registered).toBe(true);
    expect(seen.redirectUri).toBe('http://127.0.0.1:40689/v1/mcp-servers/callback');

    const authUrl = new URL(started.authorizeUrl);
    expect(authUrl.origin + authUrl.pathname).toBe(`${BASE}/authorize`);
    expect(authUrl.searchParams.get('client_id')).toBe('client-abc');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    seen.challenge = authUrl.searchParams.get('code_challenge') ?? '';
    expect(seen.challenge).not.toBe('');

    // The verifier is NOT in the address. It is the half that never travels.
    expect(started.authorizeUrl).not.toContain('code_verifier');

    // …and it was written against the state, server-side, where the callback will find it.
    const round = await storage.getVerificationNonce(started.state);
    expect(round?.type).toBe('mcp_connect');
    expect(round?.owner).toBe('alice@test-node-001');
    expect(round?.nonce).toBeTruthy();
  });

  it('finishes the round, proves the verifier and seals the token', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow();
    await storage.createMcpServer(row);

    const started = await startMcpOAuth({
      storage, config, server: row, ownerGhii: 'alice@test-node-001', returnUrl: '/spa.html#access',
    });
    if (!started.ok) throw new Error('start failed');
    seen.challenge = new URL(started.authorizeUrl).searchParams.get('code_challenge') ?? '';

    const done = await finishMcpOAuth({ storage, config, state: started.state, code: 'the-code' });
    expect(done.ok).toBe(true);
    if (!done.ok) return;

    // The far side checked our verifier against the challenge and accepted it.
    expect(seen.verifierAccepted).toBe(true);
    expect(done.returnUrl).toBe('/spa.html#access');

    const stored = await storage.getMcpServer(row.id);
    // A successful exchange IS the evidence that whatever was wrong no longer is.
    expect(stored?.status).toBe('active');
    expect(stored?.expiresAt).toBeTruthy();

    const opened = openMcpCredential(stored!.credential!, config);
    expect(opened).not.toBe('no-key');
    expect(opened).not.toBeNull();
    if (!opened || opened === 'no-key') return;
    expect(opened.accessToken).toBe('first-token');
    expect(opened.refreshToken).toBe('refresh-me');
    // The client that MINTED the token is sealed with it, or the first refresh finds out.
    expect(opened.oauthClient?.client_id).toBe('client-abc');
  });

  it('consumes the state, so a replayed callback finds nothing', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow();
    await storage.createMcpServer(row);

    const started = await startMcpOAuth({
      storage, config, server: row, ownerGhii: 'alice@test-node-001',
    });
    if (!started.ok) throw new Error('start failed');
    seen.challenge = new URL(started.authorizeUrl).searchParams.get('code_challenge') ?? '';

    const first = await finishMcpOAuth({ storage, config, state: started.state, code: 'c' });
    expect(first.ok).toBe(true);

    const replay = await finishMcpOAuth({ storage, config, state: started.state, code: 'c' });
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.code).toBe('BAD_STATE');
  });

  it('refuses a state that was never issued', async () => {
    const storage = new SqliteStorage(':memory:');
    const r = await finishMcpOAuth({ storage, config, state: 'invented', code: 'c' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('BAD_STATE');
  });

  it('will not let one owner\'s round land on another owner\'s server', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow();
    await storage.createMcpServer(row);

    // The round is started for somebody who does not own this server. The nonce carries THEM, and
    // the callback compares it with the row: a replayed state cannot cross accounts.
    const started = await startMcpOAuth({
      storage, config, server: row, ownerGhii: 'mallory@test-node-001',
    });
    if (!started.ok) throw new Error('start failed');
    seen.challenge = new URL(started.authorizeUrl).searchParams.get('code_challenge') ?? '';

    const r = await finishMcpOAuth({ storage, config, state: started.state, code: 'c' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NO_SERVER');
  });

  it('answers a node with no encryption key by naming the env var, before any round starts', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = makeRow();
    await storage.createMcpServer(row);

    const r = await startMcpOAuth({
      storage,
      config: { ...config, encryptionKey: null } as AimeatConfig,
      server: row, ownerGhii: 'alice@test-node-001',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NO_ENCRYPTION_KEY');
    // Refused BEFORE the round: sending somebody to a consent screen whose result this node cannot
    // keep would waste their approval and leave nothing behind.
    expect(r.message).toContain('AIMEAT_ENCRYPTION_KEY');
  });
});
