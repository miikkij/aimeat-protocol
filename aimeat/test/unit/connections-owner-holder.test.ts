/**
 * @file connections-owner-holder.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Feature-list audit rows 128-130: the Email page and the tool descriptions promised the
 *   owner's AI the mailboxes the owner connected, and every MCP tool read only the agent's own
 *   connections; aimeat_mail_send looked the recipient up in the agent's own address book while
 *   POST /v1/outbound/send uses the owner's. Now an agent names its owner's connections on
 *   connections:use, reads them only on connections:read-as-owner, and sends from the owner's book.
 * @usage cd aimeat && pnpm exec vitest run test/unit/connections-owner-holder.test.ts
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — The McpServer fake takes registerTool(name, config, handler), the form every tool registers with since the MCP SDK v2 migration step 3.
 *   v1.0.0 — 2026-10-15 — Initial (feature-list audit 128-130).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerConnectionTools } from '../../src/mcp/connections.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import type { ConnectionRecord } from '../../src/models/connection-schemas.js';
import { connectionHoldersOf, requireUsableConnection } from '../../src/services/connections/access.js';
import { ensureContact } from '../../src/services/outbound/outbound-service.js';

const NODE = 'test-node';
const OWNER = `alice@${NODE}`;
const AGENT = `claude#alice@${NODE}`;
let storage: Storage;
let ownerContactId = '';

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function toolsFor(scopes: string[]): Record<string, Handler> {
  const tools: Record<string, Handler> = {};
  const mcp = { registerTool: (name: string, ...rest: unknown[]) => { tools[name] = rest[rest.length - 1] as Handler; } } as unknown as McpServer;
  const config = {
    nodeId: NODE, connectionsEnabled: true, connectGoogleClientId: 'g', connectGoogleClientSecret: 's',
    connectRedirectUri: '', connectFakeBaseUrl: '', outboundDailyLimit: 100,
  } as unknown as AimeatConfig;
  registerConnectionTools(mcp, storage, config, () => AGENT, scopes);
  return tools;
}

async function seedConnection(id: string, principal: string): Promise<void> {
  const now = new Date().toISOString();
  await storage.createConnection({
    id, principal, mode: 'personal', provider: 'google-mail', instance: null, accountLabel: `${id}@example.test`,
    externalId: id, credential: 'x:y:z', credentialShape: 'oauth2', scopes: [], expiresAt: null, status: 'active',
    lastOkAt: now, lastError: null, providerClientId: null, createdAt: now, updatedAt: now,
  } as unknown as ConnectionRecord);
}

beforeAll(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  await seedConnection('conn-owner', OWNER);
  await seedConnection('conn-agent', AGENT);
  ownerContactId = (await ensureContact(storage, OWNER, { name: 'Bob', email: 'bob@example.test' })).id;
});

describe('whose connections an agent may use', () => {
  it('names only its own without a word for the owner\'s', async () => {
    const out = await toolsFor(['connections:read'])['aimeat_connection_list']({});
    const ids = JSON.parse(out.content[0].text).connections.map((c: { id: string }) => c.id);
    expect(ids).toEqual(['conn-agent']);
  });

  it('names the owner\'s too on connections:use, marked as the owner\'s', async () => {
    const out = await toolsFor(['connections:use'])['aimeat_connection_list']({});
    const rows = JSON.parse(out.content[0].text).connections as Array<{ id: string; holder: string }>;
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'conn-agent', holder: 'own' }),
      expect.objectContaining({ id: 'conn-owner', holder: 'owner' }),
    ]));
  });

  it('reads the owner\'s only on connections:read-as-owner, which no wildcard carries', async () => {
    const readHolders = (scopes: string[]) => connectionHoldersOf(AGENT, OWNER, scopes, 'read');
    expect(await requireUsableConnection(storage, readHolders(['connections:read-through', 'connections:use']), 'conn-owner')).toBeNull();
    expect(await requireUsableConnection(storage, readHolders(['*']), 'conn-owner')).toBeNull();
    expect((await requireUsableConnection(storage, readHolders(['connections:read-through', 'connections:read-as-owner']), 'conn-owner'))?.id).toBe('conn-owner');
    expect((await requireUsableConnection(storage, readHolders([]), 'conn-agent'))?.id).toBe('conn-agent');
  });
});

describe('aimeat_mail_send reads the owner\'s address book', () => {
  it('finds a contact the owner saved', async () => {
    const out = await toolsFor(['outbound:send', 'connections:use'])['aimeat_mail_send']({
      contact_id: ownerContactId, subject: 'Hello', body: 'Hi Bob',
    });
    // No transport is configured here, so the send itself fails; what matters is that the
    // recipient was found. In the agent's own book it was NOT_FOUND: Contact not found.
    expect(out.content[0].text).not.toContain('Contact not found');
  });
});
