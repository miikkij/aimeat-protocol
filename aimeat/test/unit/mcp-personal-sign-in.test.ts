/**
 * @file test/unit/mcp-personal-sign-in.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A shared MCP server each person signs in to with their own account (auth
 *   per-user-oauth): a call spends the caller's own sign-in and nothing shared, a person who has not
 *   signed in is refused with the way to do it, the listing says who has signed in, signing out
 *   touches nobody else, and detaching the server or erasing the account leaves no token behind.
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (wish-henkil-kohtainen-kirjautuminen-jaettuun-mcp-palvelimeen).
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import { toPublicMcpServer } from '../../src/models/mcp-server-schemas.js';
import { callRemoteTool, statusForRemoteRefusal } from '../../src/services/mcp-client/invoke.js';
import { sealMcpCredential, requireEncryptionKey } from '../../src/services/mcp-client/credential.js';
import { withPersonalSignIn, signOutPersonal } from '../../src/services/mcp-client/personal-sign-in.js';
import { attachNodeServer, detachMcpServer } from '../../src/services/mcp-client/registry.js';
import type { AimeatConfig } from '../../src/config.js';

const config = {
  nodeId: 'test-node-001', baseUrl: 'http://127.0.0.1:40689',
  encryptionKey: 'd'.repeat(64), totpSecretEncryptionKey: null,
} as unknown as AimeatConfig;

const ALICE = 'alice@test-node-001';
const BOB = 'bob@test-node-001';

function sharedRow(over: Partial<McpServerRecord> = {}): McpServerRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), slug: 'jira', title: 'Jira', description: '',
    ownership: 'node', ownerGhii: null, organismId: null, ws: null, createdBy: 'operator@test-node-001',
    // An address nothing listens on: a call that reaches the network fails loudly, not quietly.
    transport: { kind: 'http', url: 'http://127.0.0.1:9/mcp' },
    auth: 'per-user-oauth', credential: null, credentialShape: null, expiresAt: null, providerClientId: null,
    callerIdentity: 'per-user-oauth', exposure: 'gateway',
    toolCache: [], toolCacheHash: '', lastListedAt: null,
    availability: 'all-owners', allowlist: [], price: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true, status: 'active', lastOkAt: null, lastError: null, createdAt: now, updatedAt: now, ...over,
  };
}

const sealed = (): string => sealMcpCredential({ shape: 'oauth2', accessToken: 'alices-token' }, requireEncryptionKey(config)!);

describe('a shared server each person signs in to', () => {
  it('refuses a call from somebody who has not signed in, with the way to do it, and spends nothing shared', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = sharedRow();
    await storage.createMcpServer(row);

    const r = await callRemoteTool({
      storage, config, server: row, tool: 'search', args: {}, caller: BOB, scopes: ['mcp:use'], ownerInPerson: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('SIGN_IN_REQUIRED');
    expect(statusForRemoteRefusal(r.code)).toBe(403);
    expect(r.message).toContain('aimeat_mcp_authorize');
    // The server is not parked for anybody: the refusal is Bob's alone.
    expect((await storage.getMcpServer(row.id))?.status).toBe('active');
  });

  it('refuses an agent of somebody who has not signed in, even when another person has', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = sharedRow();
    await storage.createMcpServer(row);
    await storage.putMcpUserCredential(row.id, ALICE, sealed(), null);

    const r = await callRemoteTool({
      storage, config, server: row, tool: 'search', args: {}, caller: 'claude#bob@test-node-001', scopes: ['mcp:use'],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('SIGN_IN_REQUIRED');
  });

  it('refuses a sign-in parked as needs_reauth instead of sending its dead token', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = sharedRow();
    await storage.createMcpServer(row);
    await storage.putMcpUserCredential(row.id, ALICE, sealed(), null);
    await storage.setMcpUserCredentialStatus(row.id, ALICE, 'needs_reauth', 'refused');

    const r = await callRemoteTool({
      storage, config, server: row, tool: 'search', args: {}, caller: ALICE, scopes: ['mcp:use'], ownerInPerson: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('SIGN_IN_REQUIRED');
  });

  it('spends the caller\'s own sign-in: a signed-in person\'s call goes to the far side', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = sharedRow();
    await storage.createMcpServer(row);
    await storage.putMcpUserCredential(row.id, ALICE, sealed(), null);

    const r = await callRemoteTool({
      storage, config, server: row, tool: 'search', args: {}, caller: ALICE, scopes: ['mcp:use'], ownerInPerson: true,
    });
    // Nothing listens at the address, so reaching it is the proof the credential was found and used.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('UNREACHABLE');
  });

  it('says on the listing who has signed in, per caller', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = sharedRow();
    const other = sharedRow({ slug: 'wiki', auth: 'static', callerIdentity: 'node-credential' });
    await storage.createMcpServer(row);
    await storage.putMcpUserCredential(row.id, ALICE, sealed(), null);

    const forAlice = await withPersonalSignIn(storage, ALICE, [toPublicMcpServer(row), toPublicMcpServer(other)]);
    expect(forAlice[0]!.personalSignIn).toEqual({ signedIn: true, status: 'active' });
    expect(forAlice[1]!.personalSignIn).toBeUndefined();
    const forBob = await withPersonalSignIn(storage, BOB, [toPublicMcpServer(row)]);
    expect(forBob[0]!.personalSignIn).toEqual({ signedIn: false, status: null });
  });

  it('signs one person out and leaves the others signed in', async () => {
    const storage = new SqliteStorage(':memory:');
    const row = sharedRow();
    await storage.createMcpServer(row);
    await storage.putMcpUserCredential(row.id, ALICE, sealed(), null);
    await storage.putMcpUserCredential(row.id, BOB, sealed(), null);

    expect(await signOutPersonal(storage, row, ALICE)).toBe(true);
    expect(await signOutPersonal(storage, row, ALICE)).toBe(false);
    expect(await storage.getMcpUserCredential(row.id, ALICE)).toBeUndefined();
    expect(await storage.getMcpUserCredential(row.id, BOB)).toBeDefined();
  });

  it('detaching the server removes every personal sign-in on it; erasing an account removes that person\'s', async () => {
    const storage = new SqliteStorage(':memory:');
    const a = sharedRow();
    const b = sharedRow({ slug: 'wiki' });
    await storage.createMcpServer(a);
    await storage.createMcpServer(b);
    for (const s of [a, b]) for (const p of [ALICE, BOB]) await storage.putMcpUserCredential(s.id, p, sealed(), null);

    await detachMcpServer(storage, a);
    expect(await storage.getMcpUserCredential(a.id, ALICE)).toBeUndefined();
    expect(await storage.getMcpUserCredential(a.id, BOB)).toBeUndefined();

    expect(await storage.deleteMcpUserCredentialsByOwner(ALICE)).toBe(1);
    expect(await storage.listMcpUserCredentials(ALICE)).toEqual([]);
    expect((await storage.listMcpUserCredentials(BOB)).map((r) => r.serverId)).toEqual([b.id]);
  });

  it('an operator attaches one: no credential on the row, no probe, ready at once', async () => {
    const storage = new SqliteStorage(':memory:');
    const r = await attachNodeServer({
      storage, config, createdBy: 'operator@test-node-001', slug: 'jira', title: 'Jira',
      transport: { kind: 'http', url: 'https://jira.example/mcp' }, personalSignIn: true, availability: 'all-owners',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.server.personalSignIn).toEqual({ signedIn: false, status: null });
    const row = await storage.getMcpServer(r.server.id);
    expect(row?.auth).toBe('per-user-oauth');
    expect(row?.callerIdentity).toBe('per-user-oauth');
    expect(row?.credential).toBeNull();
    expect(row?.status).toBe('active');
  });
});
