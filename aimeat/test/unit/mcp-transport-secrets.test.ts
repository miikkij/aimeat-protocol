/**
 * @file test/unit/mcp-transport-secrets.test.ts
 * @description A remote MCP server's stdio env and transport headers are sealed at rest, open only
 *   for their own server and name, and the rows written before 2026-10-09 are sealed at boot. The
 *   error text that reaches a log or the stored lastError carries no endpoint and no upstream body.
 *
 *   Secrets audit 2026-10-09, chapter 2: both maps sat in plain text in mcp_servers.transport, and
 *   invoke.ts and oauth.ts logged the SDK's error text verbatim. Unit level because the test node
 *   runs no local processes (STDIO_DISABLED) and no door writes headers; the storage is real SQLite.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-transport-secrets.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, chapter 2).
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { McpServerRecord, McpTransport } from '../../src/models/mcp-server-schemas.js';
import {
  sealTransportSecrets, openTransportSecrets, sealServerRowSecrets, sealLegacyTransportSecrets,
} from '../../src/services/mcp-client/transport-secrets.js';
import { describeUpstreamError } from '../../src/services/mcp-client/upstream-error.js';

const keyHex = randomBytes(32).toString('hex');
const key = Buffer.from(keyHex, 'hex');
const config = { encryptionKey: keyHex, totpSecretEncryptionKey: null };
const SECRET = 'sk-canary-7f3a9c1e5b';

function row(id: string, transport: McpTransport): McpServerRecord {
  const now = new Date().toISOString();
  return {
    id, slug: `s-${id}`, title: 't', description: '', ownership: 'node', ownerGhii: null,
    organismId: null, ws: null, createdBy: 'op@node', transport, auth: 'none', credential: null,
    credentialShape: null, expiresAt: null, providerClientId: null, callerIdentity: 'node-credential',
    exposure: 'gateway', toolCache: [], toolCacheHash: '', lastListedAt: null, availability: null,
    allowlist: [], price: null, directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true, status: 'active', lastOkAt: null, lastError: null, createdAt: now, updatedAt: now,
  } as McpServerRecord;
}

describe('transport secrets', () => {
  it('seal stdio env values and header values, and open them for the same server only', () => {
    const env: McpTransport = { kind: 'stdio', command: 'node', args: [], env: { API_KEY: SECRET } };
    const sealed = sealTransportSecrets(env, key, 'srv-a');
    expect(JSON.stringify(sealed)).not.toContain(SECRET);
    expect((sealed as { env: Record<string, string> }).env.API_KEY).toMatch(/^v2:/);
    expect(openTransportSecrets(sealed, config, 'srv-a')).toEqual(env);
    // Copied into another server's row it does not open, and is left out rather than passed as ciphertext.
    expect((openTransportSecrets(sealed, config, 'srv-b') as { env: Record<string, string> }).env).toEqual({});

    const http: McpTransport = { kind: 'http', url: 'https://x.example/mcp', headers: { 'X-Api-Key': SECRET } };
    const sealedHttp = sealTransportSecrets(http, key, 'srv-a');
    expect(JSON.stringify(sealedHttp)).not.toContain(SECRET);
    expect(openTransportSecrets(sealedHttp, config, 'srv-a')).toEqual(http);
  });

  it('refuse to build a stored row with secrets and no key', () => {
    const r = row('id-nokey', { kind: 'stdio', command: 'node', args: [], env: { K: SECRET } });
    expect(() => sealServerRowSecrets(r, { encryptionKey: null, totpSecretEncryptionKey: null })).toThrow();
    expect(sealServerRowSecrets(row('id-plain', { kind: 'http', url: 'https://x.example/mcp' }), config).transport)
      .toEqual({ kind: 'http', url: 'https://x.example/mcp' });
  });

  it('the boot step seals a plain row once, and leaves sealed rows alone', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    await storage.createMcpServer(row('legacy-1', { kind: 'stdio', command: 'node', args: [], env: { API_KEY: SECRET } }));
    await storage.createMcpServer(row('legacy-2', { kind: 'http', url: 'https://x.example/mcp', headers: { Authorization: `Bearer ${SECRET}` } }));
    expect(await sealLegacyTransportSecrets(storage, key)).toBe(2);
    for (const id of ['legacy-1', 'legacy-2']) {
      const stored = await storage.getMcpServer(id);
      expect(JSON.stringify(stored?.transport)).not.toContain(SECRET);
      expect(JSON.stringify(openTransportSecrets(stored!.transport, config, id))).toContain(SECRET);
    }
    // Idempotent: a second boot rewrites nothing.
    expect(await sealLegacyTransportSecrets(storage, key)).toBe(0);
  });
});

describe('describeUpstreamError', () => {
  it('keeps the host and the status, and drops the path, the query and the upstream body', () => {
    const err = new Error(`Error POSTing to endpoint https://api.example.com/mcp?api_key=${SECRET} (HTTP 401): {"echo":{"authorization":"Bearer ${SECRET}"}}`);
    const told = describeUpstreamError(err);
    expect(told).not.toContain(SECRET);
    expect(told).toContain('https://api.example.com/');
    expect(told).toContain('HTTP 401');
    expect(told).not.toContain('echo');
  });

  it('masks a bearer or a token field that is still in the text', () => {
    expect(describeUpstreamError(`failed: Bearer ${SECRET}`)).not.toContain(SECRET);
    expect(describeUpstreamError(`invalid_grant refresh_token=${SECRET}`)).not.toContain(SECRET);
  });
});
