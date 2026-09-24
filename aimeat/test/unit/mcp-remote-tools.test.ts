/**
 * @file test/unit/mcp-remote-tools.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Flattening: which remote tools reach a session's tool list, under what names, and
 *   what must never appear there.
 *
 *   The registrations are captured against a fake MCP server rather than asserted by reading the
 *   source, for the reason the tool audit gives for doing the same: reading a registration's source
 *   to decide what it registers was tried on 2026-08-16 and was wrong in both directions inside an
 *   hour.
 * @version-history
 *   v1.1.0 — 2026-09-24 — A flattened tool calls with the server row as it is at call time: a
 *     server switched off or detached mid-session is honoured (secaudit 2026-09 a49e32ddeb4e).
 *   v1.0.0 — 2026-09-16 — Phase 3 of the MCP proxy.
 */
import { describe, it, expect } from 'vitest';
import { z, toJSONSchema } from 'zod';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import { putMcpGrant } from '../../src/services/mcp-client/grants.js';
import {
  registerRemoteTools, remoteToolName, splitRemoteToolName,
} from '../../src/mcp/remote-tools.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../../src/config.js';

const OWNER = 'alice@test-node-001';
const AGENT = 'claude#alice@test-node-001';
const config = { nodeId: 'test-node-001' } as unknown as AimeatConfig;

type ToolAnswer = { content: { type: string; text: string }[]; isError?: boolean };

/** Records what was registered, so the test asserts on the real calls rather than on source. */
function fakeMcp() {
  const registered: {
    name: string; cfg: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<ToolAnswer>;
  }[] = [];
  const mcp = {
    registerTool(name: string, cfg: Record<string, unknown>, handler: (args: Record<string, unknown>) => Promise<ToolAnswer>) {
      registered.push({ name, cfg, handler });
    },
  } as unknown as McpServer;
  return { mcp, registered };
}

function makeServer(over: Partial<McpServerRecord> = {}): McpServerRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), slug: 'jira', title: 'Jira', description: '',
    ownership: 'owner', ownerGhii: OWNER, organismId: null, ws: null, createdBy: OWNER,
    transport: { kind: 'http', url: 'https://jira.example/mcp' },
    auth: 'static', credential: 'iv:tag:ct', credentialShape: 'static',
    expiresAt: null, providerClientId: null,
    callerIdentity: 'node-credential', exposure: 'flatten',
    toolCache: [
      { name: 'read_issue', description: 'Reads one issue.', inputSchema: { type: 'object', properties: { key: { description: 'The issue key.' } }, required: ['key'] } },
      { name: 'create_issue', description: 'Creates one.', inputSchema: { type: 'object', properties: { title: {}, project: {} }, required: ['title'] } },
    ],
    toolCacheHash: 'h', lastListedAt: now,
    availability: null, allowlist: [], price: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true, status: 'active', lastOkAt: now, lastError: null,
    createdAt: now, updatedAt: now, ...over,
  };
}

const deps = (storage: SqliteStorage, scopes = ['mcp:use']) =>
  ({ storage, config, agentGaii: () => AGENT, scopes });

describe('the flattened tool name', () => {
  it('splits on the FIRST separator, so an underscore in the tool name is safe', () => {
    const name = remoteToolName('jira', 'create_issue_now');
    expect(name).toBe('jira__create_issue_now');
    expect(splitRemoteToolName(name)).toEqual({ slug: 'jira', tool: 'create_issue_now' });
  });

  it('refuses a name with no separator rather than guessing', () => {
    expect(splitRemoteToolName('aimeat_memory_write')).toBeNull();
  });
});

describe('what reaches the tool list', () => {
  it('registers a flattened server\'s tools under its slug', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(makeServer());
    const { mcp, registered } = fakeMcp();

    const n = await registerRemoteTools(mcp, deps(storage));
    expect(n).toBe(2);
    expect(registered.map(r => r.name).sort()).toEqual(['jira__create_issue', 'jira__read_issue']);
  });

  it('says whose tool it is, so a transcript shows the call left this node', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(makeServer());
    const { mcp, registered } = fakeMcp();
    await registerRemoteTools(mcp, deps(storage));

    const desc = String(registered[0].cfg.description);
    expect(desc).toContain('attached to this account');
    // The far side's own words survive too.
    expect(registered.some(r => String(r.cfg.description).startsWith('Reads one issue.'))).toBe(true);
  });

  it('carries the upstream schema\'s NAMES and which are required, AS EMITTED', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(makeServer());
    const { mcp, registered } = fakeMcp();
    await registerRemoteTools(mcp, deps(storage));

    // Asserted on the JSON Schema that actually reaches a client, not on Zod's isOptional(). Those
    // two disagree: z.unknown() reports isOptional true and still lands in `required`, and an
    // earlier version of this test chased the Zod detail instead of the wire and drove the code to
    // z.custom() — which cannot be serialised at all and broke every session's tools/list.
    const emitted = (name: string) => toJSONSchema(
      z.object(registered.find(r => r.name === name)!.cfg.inputSchema as z.ZodRawShape),
    ) as { properties: Record<string, unknown>; required?: string[] };

    const read = emitted('jira__read_issue');
    expect(Object.keys(read.properties)).toEqual(['key']);
    expect(read.required).toEqual(['key']);

    const create = emitted('jira__create_issue');
    // `title` is required and `project` is not — which is what an AI reads to build the call.
    expect(create.required).toEqual(['title']);
    expect(Object.keys(create.properties).sort()).toEqual(['project', 'title']);
  });

  it('every registered schema can actually be serialised', async () => {
    const storage = new SqliteStorage(':memory:');
    // One of each declared type, plus an untyped field, because the untyped branch is the one that
    // was wrong: a schema that cannot be represented in JSON Schema takes down tools/list for the
    // WHOLE session, not just its own tool.
    await storage.createMcpServer(makeServer({
      toolCache: [{
        name: 'everything', description: 'one of each', inputSchema: {
          type: 'object',
          properties: {
            s: { type: 'string' }, n: { type: 'number' }, i: { type: 'integer' },
            b: { type: 'boolean' }, a: { type: 'array' }, o: { type: 'object' },
            untyped: { description: 'no type at all' },
          },
          required: ['s', 'untyped'],
        },
      }],
    }));
    const { mcp, registered } = fakeMcp();
    await registerRemoteTools(mcp, deps(storage));

    const schema = z.object(registered[0].cfg.inputSchema as z.ZodRawShape);
    expect(() => toJSONSchema(schema)).not.toThrow();
    const emitted = toJSONSchema(schema) as { required?: string[] };
    expect(emitted.required?.sort()).toEqual(['s', 'untyped']);
  });

  it('tells the truth about a stranger\'s tool: nothing is claimed to be safe', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(makeServer());
    const { mcp, registered } = fakeMcp();
    await registerRemoteTools(mcp, deps(storage));

    const ann = registered[0].cfg.annotations as Record<string, boolean>;
    // This node cannot know what somebody else's tool does, and a client deciding whether to
    // auto-run must not be told "safe" on our guess.
    expect(ann.readOnlyHint).toBe(false);
    expect(ann.idempotentHint).toBe(false);
    expect(ann.openWorldHint).toBe(true);
  });
});

describe('what must NOT reach the tool list', () => {
  it('a gateway server contributes nothing', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(makeServer({ exposure: 'gateway' }));
    const { mcp, registered } = fakeMcp();

    expect(await registerRemoteTools(mcp, deps(storage))).toBe(0);
    expect(registered).toHaveLength(0);
  });

  it('a switched-off server contributes nothing', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(makeServer({ enabled: false }));
    const { mcp } = fakeMcp();
    expect(await registerRemoteTools(mcp, deps(storage))).toBe(0);
  });

  it('a server awaiting sign-in contributes nothing', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(makeServer({ status: 'needs_reauth' }));
    const { mcp } = fakeMcp();
    expect(await registerRemoteTools(mcp, deps(storage))).toBe(0);
  });

  it('a session without mcp:use gets nothing, and pays no storage read for it', async () => {
    // Deliberately a storage object that would THROW if touched: the scope is asked first, so an
    // ordinary session pays nothing for a feature it is not using.
    const exploding = { listMcpServers() { throw new Error('should not be reached'); } } as never;
    const { mcp } = fakeMcp();
    expect(await registerRemoteTools(mcp, {
      storage: exploding, config, agentGaii: () => AGENT, scopes: ['mcp:read'],
    })).toBe(0);
  });

  it('a tool the owner\'s grant excludes is NOT OFFERED, rather than offered and refused', async () => {
    const storage = new SqliteStorage(':memory:');
    await storage.createMcpServer(makeServer());
    await putMcpGrant(storage, {
      type: 'aimeat:McpGrant', ownerGhii: OWNER, server: 'jira', grantee: AGENT,
      tools: ['read_issue'], expires: null, grantedBy: OWNER, grantedAt: new Date().toISOString(),
    });
    const { mcp, registered } = fakeMcp();

    expect(await registerRemoteTools(mcp, deps(storage))).toBe(1);
    // A control whose only possible answer is a refusal costs the AI a turn to discover.
    expect(registered.map(r => r.name)).toEqual(['jira__read_issue']);
  });

  it('a server switched off after the session opened is off for its flattened tools too', async () => {
    const storage = new SqliteStorage(':memory:');
    const s = makeServer();
    await storage.createMcpServer(s);
    const { mcp, registered } = fakeMcp();
    await registerRemoteTools(mcp, deps(storage));

    // The owner switches it off while this session is open. Until 2026-09-24 the tool held the row
    // it was registered with and went on as if it were still on (secaudit 2026-09 a49e32ddeb4e).
    await storage.updateMcpServer(s.id, { enabled: false });
    const r = await registered.find((t) => t.name === 'jira__read_issue')!.handler({ key: 'SUP-1' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('switched off');
  });

  it('a server detached after the session opened answers that it is gone', async () => {
    const storage = new SqliteStorage(':memory:');
    const s = makeServer();
    await storage.createMcpServer(s);
    const { mcp, registered } = fakeMcp();
    await registerRemoteTools(mcp, deps(storage));

    await storage.deleteMcpServer(s.id);
    const r = await registered.find((t) => t.name === 'jira__read_issue')!.handler({ key: 'SUP-1' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('no longer attached');
  });

  it('a storage failure leaves the session usable rather than breaking it', async () => {
    const broken = { listMcpServers() { return Promise.reject(new Error('db gone')); } } as never;
    const { mcp } = fakeMcp();
    // The gateway tools are already registered and reach the same servers, so the cost of this
    // failure is a smaller tool list, never a connection that will not open.
    expect(await registerRemoteTools(mcp, {
      storage: broken, config, agentGaii: () => AGENT, scopes: ['mcp:use'],
    })).toBe(0);
  });
});
