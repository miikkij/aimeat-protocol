/**
 * @file test/unit/agent-connection-orphans.test.ts
 * @description The boot step that removes the connections and own app clients of agents deleted
 *   before 2026-10-09 (secrets audit 2026-10-09, chapter 2, F2): a GAII of this node with no agent
 *   row loses them; a live agent, the owner, an ecosystem app and another node's agent keep theirs.
 * @usage cd aimeat && pnpm exec vitest run test/unit/agent-connection-orphans.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { removeDeletedAgentsConnections } from '../../src/services/connections/agent-orphans.js';

const NODE = 'node-1';

describe('removeDeletedAgentsConnections', () => {
  it('takes only what a deleted agent of this node left', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    const now = new Date().toISOString();
    await storage.createAgent({
      name: 'live', owner: 'alice', gaii: `live#alice@${NODE}`, publicKey: 'pk', trustScore: 50,
      morselBalance: 0, capabilities: [], createdAt: now, lastSeen: now,
    } as never);
    const principals = {
      gone: `gone#alice@${NODE}`,
      live: `live#alice@${NODE}`,
      owner: `alice@${NODE}`,
      eco: `eco:app#alice@${NODE}`,
      remote: `gone#alice@other-node`,
    };
    for (const p of Object.values(principals)) {
      await storage.createConnection({
        id: randomUUID(), principal: p, mode: 'personal', provider: 'fake', instance: null,
        accountLabel: p, externalId: p, credential: 'iv:tag:ct', credentialShape: 'oauth2', scopes: [],
        expiresAt: null, status: 'active', lastOkAt: null, lastError: null, providerClientId: null,
        createdAt: now, updatedAt: now,
      });
    }
    await storage.upsertPrincipalProviderClient({
      id: randomUUID(), provider: 'fake', instance: null, principal: principals.gone, clientId: 'c',
      clientSecret: 'iv:tag:ct', tenant: null, registeredAt: now,
    });

    expect(await removeDeletedAgentsConnections(storage, NODE)).toEqual({ connections: 1, clients: 1 });
    expect(await storage.listConnections({ principal: principals.gone })).toEqual([]);
    expect(await storage.getPrincipalProviderClient('fake', principals.gone)).toBeFalsy();
    for (const p of [principals.live, principals.owner, principals.eco, principals.remote]) {
      expect((await storage.listConnections({ principal: p })).length, p).toBe(1);
    }
    expect(await removeDeletedAgentsConnections(storage, NODE)).toEqual({ connections: 0, clients: 0 });
  });
});
