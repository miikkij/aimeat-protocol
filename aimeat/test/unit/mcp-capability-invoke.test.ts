/**
 * @file test/unit/mcp-capability-invoke.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A published capability whose source is a remote MCP tool.
 *
 *   THE ONE THING THIS FILE EXISTS FOR. A capability is a signpost, and a signpost does not carry
 *   access with it. Somebody who publishes a capability over their Jira has published the NAME of a
 *   tool, not their Jira, and the person who calls it reaches it with their own attachments or not
 *   at all. If that ever stopped being true, the capability register would be a way to launder
 *   access to every attached server on the node, and it would look like a feature while it did it.
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 6 of the MCP proxy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import type { CapabilityRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

// The chokepoint is mocked because what is under test is WHICH server this path resolves and WHOSE
// reach it uses, not the call itself: mcp-client-invoke.test.ts already holds the call to account.
const callRemoteTool = vi.hoisted(() => vi.fn());
// Only the call is faked. The status map is the REAL one, because whether this door answers 403 or
// 502 for a refusal is part of what is under test here.
vi.mock('../../src/services/mcp-client/invoke.js', async (importActual) => ({
  ...(await importActual<typeof import('../../src/services/mcp-client/invoke.js')>()),
  callRemoteTool,
}));

const { invokeCapability } = await import('../../src/services/capability-invoke.js');

const NODE = 'test-node-001';
const config = { nodeId: NODE } as unknown as AimeatConfig;
const ALICE = `alice@${NODE}`;
const BOB = `bob@${NODE}`;
const ALICES_AGENT = `claude#alice@${NODE}`;

function server(over: Partial<McpServerRecord> = {}): McpServerRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), slug: 'jira', title: 'Jira', description: '',
    ownership: 'owner', ownerGhii: ALICE, organismId: null, ws: null, createdBy: ALICE,
    transport: { kind: 'http', url: 'https://jira.example/mcp' },
    auth: 'none', credential: null, credentialShape: null,
    expiresAt: null, providerClientId: null,
    callerIdentity: 'node-credential', exposure: 'gateway',
    toolCache: [{ name: 'create_issue', description: '', inputSchema: { type: 'object' } }],
    toolCacheHash: 'h', lastListedAt: now,
    availability: null, allowlist: [], price: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true, status: 'active', lastOkAt: now, lastError: null,
    createdAt: now, updatedAt: now, ...over,
  };
}

function capability(ref: string): CapabilityRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), name: 'open-a-ticket', summary: 'Opens a ticket.',
    // Published BY ALICE. Whose it is decides nothing about who may call through it, which is the
    // point of the test below.
    ownerGhii: ALICE, visibility: 'public', scope: 'local', status: 'active',
    rejectionReason: null, deprecationMessage: null, replacedBy: null,
    source: { type: 'mcp', ref } as CapabilityRecord['source'],
    authRequired: 'registered', callable: true,
    inputSchema: null, outputSchema: null, exports: null,
    usage: '', whenToUse: '', whenNotToUse: '', examples: [], dependencies: [],
    schemaHash: '', webhookUrl: null, cost: null, trustRequired: null,
    trust: {} as CapabilityRecord['trust'], redactedFields: [], operatorOverride: null,
    stats: {
      totalInvocations: 0, successCount: 0, errorCount: 0,
      lastInvokedAt: null, avgResponseMs: 0, lastError: null,
    },
    tags: [], createdAt: now, updatedAt: now,
  };
}

const call = (storage: SqliteStorage, cap: CapabilityRecord, caller: string, input = {}) =>
  invokeCapability(config, storage as never, cap, input, caller, 'jwt-not-used');

beforeEach(() => {
  callRemoteTool.mockReset();
  callRemoteTool.mockResolvedValue({ ok: true, content: { said: 'SUPPORT-41' } });
});

describe('a capability over an attached MCP tool', () => {
  it('calls the tool and gives back what it said', async () => {
    const storage = new SqliteStorage(':memory:');
    const s = server();
    await storage.createMcpServer(s);

    const r = await call(storage, capability('jira/create_issue'), ALICE, { title: 'Broken' });
    expect(r.result).toEqual({ said: 'SUPPORT-41' });
    expect(callRemoteTool).toHaveBeenCalledOnce();
    const arg = callRemoteTool.mock.calls[0][0];
    expect(arg.server.id).toBe(s.id);
    expect(arg.tool).toBe('create_issue');
    expect(arg.args).toEqual({ title: 'Broken' });
  });

  it("splits the reference on the FIRST slash, so a tool name may hold one", async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server());

    await call(storage, capability('jira/issues/create'), ALICE);
    expect(callRemoteTool.mock.calls[0][0].tool).toBe('issues/create');
  });

  it('goes through the one chokepoint, so the grant, the price and the usage row all still happen', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server());

    await call(storage, capability('jira/create_issue'), ALICES_AGENT);
    // Arriving by this door must not be a way around the checks the direct door goes through, and
    // the way to be sure of that is that this path does not have its own call.
    expect(callRemoteTool).toHaveBeenCalledOnce();
    expect(callRemoteTool.mock.calls[0][0].caller).toBe(ALICES_AGENT);
  });

  it('reads the tool through the CALLER, not through whoever published it', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server());

    // Bob calls a capability Alice published over Alice's Jira. Bob has no Jira.
    await expect(call(storage, capability('jira/create_issue'), BOB)).rejects.toMatchObject({
      statusCode: 404, code: 'NO_MCP_SERVER',
    });
    // And nothing was called on Alice's credential on the way to finding that out.
    expect(callRemoteTool).not.toHaveBeenCalled();
  });

  it("lets the caller's own agent through on the OWNER's attachment", async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server());

    // An agent acts in its owner's name, so its owner's servers are the ones it reaches.
    await call(storage, capability('jira/create_issue'), ALICES_AGENT);
    expect(callRemoteTool).toHaveBeenCalledOnce();
  });

  it('answers 404 for a server nobody has, in the same words as for one that is not yours', async () => {
    const storage = new SqliteStorage(':memory:');
    await expect(call(storage, capability('nope/create_issue'), ALICE)).rejects.toMatchObject({
      code: 'NO_MCP_SERVER',
    });
  });

  it('refuses a reference that names no tool rather than calling something nameless', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server());

    for (const ref of ['jira', 'jira/', '/create_issue', '']) {
      await expect(call(storage, capability(ref), ALICE)).rejects.toMatchObject({
        code: 'BAD_MCP_REF',
      });
    }
    expect(callRemoteTool).not.toHaveBeenCalled();
  });

  it('answers a grant refusal as 403, not as the far side failing', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server());
    callRemoteTool.mockResolvedValue({ ok: false, code: 'NOT_GRANTED', message: 'Not this tool.' });

    // The same map the REST route uses. Arriving through a capability must not turn "you may not"
    // into "the server is down".
    await expect(call(storage, capability('jira/create_issue'), ALICES_AGENT)).rejects.toMatchObject({
      statusCode: 403, code: 'NOT_GRANTED',
    });
  });

  it('reports the far side saying no as a failure of the call, not of the capability', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(server());
    callRemoteTool.mockResolvedValue({ ok: false, code: 'UNREACHABLE', message: 'Nobody answered.' });

    await expect(call(storage, capability('jira/create_issue'), ALICE)).rejects.toMatchObject({
      statusCode: 502, code: 'UNREACHABLE',
    });
  });
});
