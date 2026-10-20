/**
 * @file connections-history-holders.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent reads its owner's publish history and the replies to it only on
 *   connections:read-as-owner (Jouni, 2026-10-16). Before, both reads keyed on the agent's own
 *   identity, so a reply-reading agent saw nothing of what its owner sent from LÄHETIN. Driven
 *   through the node MCP tools, which call the same service functions as the REST routes.
 * @usage cd aimeat && pnpm exec vitest run test/unit/connections-history-holders.test.ts
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — The McpServer fake takes registerTool(name, config, handler), the form every tool registers with since the MCP SDK v2 migration step 3.
 *   v1.0.0 — 2026-10-16 — Initial.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerConnectionTools } from '../../src/mcp/connections.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import type { ConnectionRecord } from '../../src/models/connection-schemas.js';

const NODE = 'test-node';
const OWNER = `alice@${NODE}`;
const AGENT = `claude#alice@${NODE}`;
const STRANGER = `bob@${NODE}`;
let storage: Storage;

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function toolsFor(scopes: string[]): Record<string, Handler> {
  const tools: Record<string, Handler> = {};
  const mcp = { registerTool: (name: string, ...rest: unknown[]) => { tools[name] = rest[rest.length - 1] as Handler; } } as unknown as McpServer;
  const config = {
    nodeId: NODE, connectionsEnabled: true, connectRedirectUri: '', connectFakeBaseUrl: '',
    // A key, so the replies tool reaches the ownership check instead of stopping at NO_ENCRYPTION_KEY.
    encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  } as unknown as AimeatConfig;
  registerConnectionTools(mcp, storage, config, () => AGENT, scopes);
  return tools;
}

async function seedConnection(id: string, principal: string): Promise<void> {
  const now = new Date().toISOString();
  await storage.createConnection({
    id, principal, mode: 'personal', provider: 'mastodon', instance: 'https://example.social', accountLabel: `${id}@example.social`,
    externalId: id, credential: 'x:y:z', credentialShape: 'oauth2', scopes: [], expiresAt: null, status: 'active',
    lastOkAt: now, lastError: null, providerClientId: null, createdAt: now, updatedAt: now,
  } as unknown as ConnectionRecord);
}

async function seedPublished(id: string, publisher: string, connectionId: string): Promise<void> {
  await storage.openPublishAttempt({
    id, idempotencyKey: `key-${id}`, publisher, connectionId, delegationId: null, storageKey: '', status: 'in_flight',
  });
  await storage.updatePublishAttempt(id, { status: 'done', externalRef: `https://example.social/@x/${id}` });
}

const listed = async (scopes: string[]): Promise<Array<{ id: string; holder: string }>> => {
  const out = await toolsFor(scopes)['aimeat_connection_history']({ limit: 50 });
  return JSON.parse(out.content[0].text).attempts;
};

beforeAll(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  await seedConnection('conn-owner', OWNER);
  await seedConnection('conn-agent', AGENT);
  await seedConnection('conn-stranger', STRANGER);
  await seedPublished('att-owner', OWNER, 'conn-owner');
  await seedPublished('att-agent', AGENT, 'conn-agent');
  await seedPublished('att-stranger', STRANGER, 'conn-stranger');
});

describe('whose publish history an agent reads', () => {
  it('lists only its own without connections:read-as-owner, whatever else it holds', async () => {
    for (const scopes of [['connections:read'], ['connections:read', 'connections:use', 'connections:read-through'], ['*']]) {
      const rows = await listed(scopes);
      expect(rows.map(r => r.id)).toEqual(['att-agent']);
      expect(rows[0]!.holder).toBe('own');
    }
  });

  it('lists the owner\'s too on connections:read-as-owner, each marked whose it is', async () => {
    const rows = await listed(['connections:read', 'connections:read-as-owner']);
    expect(rows.map(r => r.id).sort()).toEqual(['att-agent', 'att-owner']);
    expect(rows.find(r => r.id === 'att-owner')!.holder).toBe('owner');
    expect(rows.find(r => r.id === 'att-agent')!.holder).toBe('own');
  });

  it('never lists another person\'s items', async () => {
    const rows = await listed(['connections:read', 'connections:read-as-owner']);
    expect(rows.map(r => r.id)).not.toContain('att-stranger');
  });
});

describe('whose replies an agent reads', () => {
  const replies = (scopes: string[], id: string) => toolsFor(scopes)['aimeat_connection_replies']({ attempt_id: id });

  it('answers NOT_FOUND for the owner\'s item without connections:read-as-owner, as for a missing one', async () => {
    const owners = await replies(['connections:read-through'], 'att-owner');
    const missing = await replies(['connections:read-through'], 'no-such-item');
    expect(owners.isError).toBe(true);
    expect(owners.content[0].text).toMatch(/^NOT_FOUND/);
    expect(owners.content[0].text.split('\n')[0]).toBe(missing.content[0].text.split('\n')[0]);
  });

  it('passes the ownership check for the owner\'s item on connections:read-as-owner', async () => {
    const out = await replies(['connections:read-through', 'connections:read-as-owner'], 'att-owner');
    // The provider is not reachable here, so the read fails later than the ownership check: any
    // answer but NOT_FOUND proves the item was found as the owner's.
    expect(out.content[0].text).not.toMatch(/^NOT_FOUND/);
  });

  it('answers NOT_FOUND for another person\'s item even on connections:read-as-owner', async () => {
    const out = await replies(['connections:read-through', 'connections:read-as-owner'], 'att-stranger');
    expect(out.content[0].text).toMatch(/^NOT_FOUND/);
  });
});
