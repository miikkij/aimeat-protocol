/**
 * @file storage-patch-contract.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Patch omission/clear parity and a recovery-address change through the real router.
 * @version-history 1.0.0 2026-09-27 Real SQLite and PostgreSQL regressions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { registerProfileRoutes } from '../../src/routes/ghii/profile.js';
import { loadConfig } from '../../src/config.js';

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])];
const providers = new Map<string, TestStorage>();
const config = loadConfig().config;
beforeAll(async () => {
  for (const name of names) providers.set(name, await createStorage({
    provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely', sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
  }) as TestStorage);
}, 60_000);
afterAll(async () => { for (const storage of providers.values()) await storage.close(); });
async function identity(storage: Storage) {
  const name = `patch-${randomUUID()}`, now = new Date().toISOString();
  const email = `${name}@example.test`;
  await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: now });
  return storage.createGHII({ ghii: `${name}@${config.nodeId}`, username: name, nodeId: config.nodeId,
    displayName: name, ownerName: name, verificationLevel: 1, totpEnabled: false, createdAt: now, updatedAt: now,
    region: 'fi-FI', notificationEmail: email, emailVerifiedAt: now,
    emailHash: createHash('sha256').update(email).digest('hex'), magicLinkEnabled: true });
}
describe.each(names)('%s patch contract', name => {
  it('omission and undefined preserve; null clears; a new value replaces', async () => {
    const storage = providers.get(name)!;
    const who = await identity(storage);
    await storage.updateGHII(who.ghii, {});
    expect((await storage.getGHII(who.ghii))?.region).toBe('fi-FI');
    await storage.updateGHII(who.ghii, { region: undefined });
    expect((await storage.getGHII(who.ghii))?.region).toBe('fi-FI');
    await storage.updateGHII(who.ghii, { region: null });
    expect((await storage.getGHII(who.ghii))?.region ?? null).toBeNull();
    await storage.updateGHII(who.ghii, { region: 'en-GB' });
    expect((await storage.getGHII(who.ghii))?.region).toBe('en-GB');
  });

  it('changing the recovery address clears its previous verification in storage', async () => {
    const storage = providers.get(name)!;
    const who = await identity(storage);
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { sub: who.ghii, owner: who.ownerName, node: config.nodeId, roles: ['owner'], scopes: [], exp: 0 };
      next();
    });
    const router = express.Router(); registerProfileRoutes(router, config, storage, undefined); app.use(router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/ghii`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_email: 'new@example.test' }),
      });
      expect(response.status).toBe(200);
      const saved = await storage.getGHII(who.ghii);
      expect(saved?.notificationEmail).toBe('new@example.test');
      expect(saved?.emailVerifiedAt ?? null).toBeNull();
      expect(Boolean(saved?.magicLinkEnabled)).toBe(false);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });

  it('full memory replacement updates and clears workspace binding on existing rows', async () => {
    const storage = providers.get(name)!;
    const now = new Date().toISOString();
    const record: MemoryRecord = { ownerGaii: `workspace-${randomUUID()}@node`, key: 'patch.workspace',
      value: {}, visibility: 'workspace', tags: [], version: 1, ttlHours: null, createdAt: now, updatedAt: now,
      workspaceRef: 'old' };
    await storage.setMemory(record);
    await storage.setMemory({ ...record, workspaceRef: 'new' });
    expect((await storage.getMemory(record.ownerGaii, record.key))?.workspaceRef).toBe('new');
    await storage.setMemory({ ...record, workspaceRef: undefined });
    expect((await storage.getMemory(record.ownerGaii, record.key))?.workspaceRef ?? null).toBeNull();
  });
});
