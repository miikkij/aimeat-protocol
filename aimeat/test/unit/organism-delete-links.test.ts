/**
 * @file test/unit/organism-delete-links.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an organism delete releases outside the organism's own tables
 *   (releaseOrganismLinks in services/organism-lifecycle.ts, called by DELETE /v1/organisms/:id).
 *
 *   Before 2026-11-11 a deleted organism left its own remote MCP servers, with the personal sign-ins
 *   to them, and every SSO connection that joined people to it still pointing at it. Nobody could
 *   see or remove the servers afterwards, because every door to them asks about the organism.
 *
 *   What it proves:
 *     - the organism's MCP servers and their personal sign-ins are gone;
 *     - another organism's server and an owner's own server stay, with their sign-ins;
 *     - an SSO connection that joined people to the organism keeps working as a sign-in, with no
 *       organism; one that names another organism keeps it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/organism-delete-links.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-11 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, SsoConnectionRecord } from '../../src/storage/interface.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import { releaseOrganismLinks } from '../../src/services/organism-lifecycle.js';

const NODE = 'test-node-001';
const GONE = 'org-gone';
const KEPT = 'org-kept';
const ALICE = `alice@${NODE}`;

function server(over: Partial<McpServerRecord>): McpServerRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), slug: `s-${randomUUID().slice(0, 6)}`, title: 'A server', description: '',
    ownership: 'organism', ownerGhii: null, organismId: GONE, ws: null, createdBy: ALICE,
    transport: { kind: 'http', url: 'https://wiki.example/mcp' },
    auth: 'none', credential: null, credentialShape: null,
    expiresAt: null, providerClientId: null,
    callerIdentity: 'node-credential', exposure: 'gateway',
    toolCache: [], toolCacheHash: '', lastListedAt: null,
    availability: null, allowlist: [], price: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true, status: 'active', lastOkAt: null, lastError: null,
    createdAt: now, updatedAt: now, ...over,
  } as McpServerRecord;
}

function sso(organismId: string | null): SsoConnectionRecord {
  const now = new Date().toISOString();
  return {
    id: `sso-${randomUUID()}`, name: 'Company sign-in', organismId, domains: ['example.com'],
    saml: null, allowIdpInitiated: false, loginVisibility: 'listed',
    createdBy: ALICE, createdAt: now, updatedAt: now,
  };
}

describe('releaseOrganismLinks', () => {
  it('detaches the organism\'s MCP servers with their sign-ins and keeps every other server', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    const gone = server({ organismId: GONE });
    const kept = server({ organismId: KEPT });
    const own = server({ ownership: 'owner', ownerGhii: ALICE, organismId: null });
    for (const s of [gone, kept, own]) await storage.createMcpServer(s);
    for (const s of [gone, kept, own]) await storage.putMcpUserCredential(s.id, ALICE, 'sealed-token', null);

    const out = await releaseOrganismLinks(storage, GONE);

    expect(out.mcpServers).toBe(1);
    expect(await storage.getMcpServer(gone.id)).toBeFalsy();
    expect(await storage.getMcpUserCredential(gone.id, ALICE)).toBeFalsy();
    expect(await storage.getMcpServer(kept.id)).toBeTruthy();
    expect(await storage.getMcpUserCredential(kept.id, ALICE)).toBeTruthy();
    expect(await storage.getMcpServer(own.id)).toBeTruthy();
    expect(await storage.getMcpUserCredential(own.id, ALICE)).toBeTruthy();
  });

  it('unlinks an SSO connection from the organism and keeps the connection; another organism\'s link stays', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    const linked = await storage.createSsoConnection(sso(GONE));
    const other = await storage.createSsoConnection(sso(KEPT));

    const out = await releaseOrganismLinks(storage, GONE);

    expect(out.ssoConnections).toBe(1);
    const after = await storage.getSsoConnection(linked.id);
    expect(after).toBeTruthy();
    expect(after?.organismId ?? null).toBeNull();
    expect((await storage.getSsoConnection(other.id))?.organismId).toBe(KEPT);
  });
});
