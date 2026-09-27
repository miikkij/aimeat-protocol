/**
 * @file owner-reuse-contract.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Actual erasure and same-name recreation on both providers.
 * @version-history 1.0.0 2026-09-27 Private memory, consent and remote credential boundaries.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])];
const providers = new Map<string, TestStorage>();
beforeAll(async () => {
  for (const name of names) providers.set(name, await createStorage({
    provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely',
    sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
  }) as TestStorage);
}, 60_000);
afterAll(async () => { for (const s of providers.values()) await s.close(); });

describe.each(names)('%s same-name recreation', provider => {
  it('cannot recover the former owner memory, consent or private remote credential; node resources remain', async () => {
    const s = providers.get(provider)!;
    const name = 'reuse' + randomUUID().replaceAll('-', ''), node = 'reuse-test';
    const ghii = name + '@' + node, now = new Date().toISOString(), consent = randomUUID();
    const create = async (key: string) => {
      await s.createOwner({ name, displayName: name, publicKey: key, roles: ['owner'], createdAt: now });
      await s.createGHII({ ghii, username: name, nodeId: node, ownerName: name, displayName: name,
        verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now });
    };
    await create('old-public-key');
    await s.setMemory({ ownerGaii: ghii, key: 'private.reuse', value: { secret: 'old-data' },
      visibility: 'private', tags: [], version: 1, ttlHours: null, createdAt: now, updatedAt: now });
    await s.createConsent({ id: consent, ownerGaii: ghii, dataPattern: 'private.*', recipient: '*',
      purpose: 'test', scope: 'dmz', expires: null, status: 'active', grantedAt: now, revokedAt: null });
    const server: McpServerRecord = { id: randomUUID(), slug: 'reuse-' + randomUUID().slice(0, 8),
      title: 'Private remote', description: '', ownership: 'owner', ownerGhii: ghii, organismId: null,
      ws: null, createdBy: ghii, transport: { kind: 'http', url: 'https://example.test/mcp' },
      auth: 'static', credential: 'fixture-ciphertext-never-used', credentialShape: 'static',
      expiresAt: null, providerClientId: null, callerIdentity: 'owner-only', exposure: 'gateway',
      toolCache: [], toolCacheHash: '', lastListedAt: null, availability: null, allowlist: [], price: null,
      directory: { listed: false, visibility: 'private', tags: [] },
      enabled: true, status: 'active', lastOkAt: null, lastError: null, createdAt: now, updatedAt: now };
    const nodeServer = { ...server, id: randomUUID(), slug: 'node-' + randomUUID().slice(0, 8),
      ownership: 'node' as const, ownerGhii: null, callerIdentity: 'node-credential' as const };
    await s.createMcpServer(server);
    await s.createMcpServer(nodeServer);
    // Negative control: all protected material is reachable at the old coordinates before erasure.
    expect((await s.getMemory(ghii, 'private.reuse'))?.value).toEqual({ secret: 'old-data' });
    expect((await s.getMcpServer(server.id))?.credential).toBe(server.credential);
    expect(await s.listConsents(ghii, {})).toHaveLength(1);
    try {
      const erased = await eraseOwner(s, node, name);
      expect(erased.deletionLog).toContain('mcp_servers:1');
      await create('new-public-key');
      expect((await s.getOwner(name))?.publicKey).toBe('new-public-key');
      expect(await s.getMemory(ghii, 'private.reuse')).toBeFalsy();
      expect(await s.listConsents(ghii, {})).toEqual([]);
      expect(await s.getMcpServer(server.id)).toBeUndefined();
      expect((await s.getMcpServer(nodeServer.id))?.credential).toBe(nodeServer.credential);
    } finally {
      await eraseOwner(s, node, name);
      await s.deleteMcpServer(nodeServer.id);
    }
  }, 60_000);
});
