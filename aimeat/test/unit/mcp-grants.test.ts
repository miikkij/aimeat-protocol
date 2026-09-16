/**
 * @file test/unit/mcp-grants.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a grant does, and the four things it must never do.
 *
 *   A grant NARROWS. Every assertion here is written to catch the opposite: a grant that widens, a
 *   grant that leaks across owners, a grant that survives its own expiry, or a grant whose locked
 *   arguments a caller can steer out of. Those are the failures that would not look like failures —
 *   the feature would appear to work and would be handing out more than the owner wrote.
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 2 of the MCP proxy.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import {
  putMcpGrant, listMcpGrants, removeMcpGrant, resolveMcpAccess, applyLockedInput,
  type McpGrant,
} from '../../src/services/mcp-client/grants.js';

const OWNER = 'alice@test-node-001';
const AGENT = `claude#alice@test-node-001`;
const OTHER_AGENT = `codex#alice@test-node-001`;

function makeServer(over: Partial<McpServerRecord> = {}): McpServerRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), slug: 'jira', title: 'Jira', description: '',
    ownership: 'owner', ownerGhii: OWNER, organismId: null, ws: null, createdBy: OWNER,
    transport: { kind: 'http', url: 'https://jira.example/mcp' },
    auth: 'static', credential: 'iv:tag:ct', credentialShape: 'static',
    expiresAt: null, providerClientId: null,
    callerIdentity: 'node-credential', exposure: 'gateway',
    toolCache: [], toolCacheHash: '', lastListedAt: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true, status: 'active', lastOkAt: null, lastError: null,
    createdAt: now, updatedAt: now, ...over,
  };
}

const grant = (over: Partial<McpGrant> = {}): McpGrant => ({
  type: 'aimeat:McpGrant',
  ownerGhii: OWNER,
  server: 'jira',
  grantee: AGENT,
  tools: ['read_issue'],
  expires: null,
  grantedBy: OWNER,
  grantedAt: new Date().toISOString(),
  ...over,
});

describe('with no grant written', () => {
  it('the scope decides, which is the phase-1 default a grant replaces', async () => {
    const storage = new SqliteStorage(':memory:');
    const server = makeServer();

    const r = await resolveMcpAccess({
      storage, server, grantee: AGENT, tool: 'anything', scopes: ['mcp:use'],
    });
    expect(r.allowed).toBe(true);
  });

  it('and an agent without the scope is refused anyway', async () => {
    const storage = new SqliteStorage(':memory:');
    const r = await resolveMcpAccess({
      storage, server: makeServer(), grantee: AGENT, tool: 'anything', scopes: ['mcp:read'],
    });
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.code).toBe('NO_SCOPE');
  });
});

describe('a grant narrows and never widens', () => {
  it('allows the tool it names', async () => {
    const storage = new SqliteStorage(':memory:');
    await putMcpGrant(storage, grant());
    const r = await resolveMcpAccess({
      storage, server: makeServer(), grantee: AGENT, tool: 'read_issue', scopes: ['mcp:use'],
    });
    expect(r.allowed).toBe(true);
  });

  it('refuses a tool it does not name, and says what IS allowed', async () => {
    const storage = new SqliteStorage(':memory:');
    await putMcpGrant(storage, grant());
    const r = await resolveMcpAccess({
      storage, server: makeServer(), grantee: AGENT, tool: 'delete_project', scopes: ['mcp:use'],
    });
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.code).toBe('TOOL_NOT_GRANTED');
    // Naming what IS allowed turns a dead end into a next step.
    expect(r.message).toContain('read_issue');
  });

  it('CANNOT hand out a permission the agent was never given', async () => {
    const storage = new SqliteStorage(':memory:');
    // The most generous grant imaginable, for an agent holding only the read word.
    await putMcpGrant(storage, grant({ tools: '*' }));
    const r = await resolveMcpAccess({
      storage, server: makeServer(), grantee: AGENT, tool: 'delete_project', scopes: ['mcp:read'],
    });
    // The scope is asked FIRST, and this is the assertion that keeps it that way.
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.code).toBe('NO_SCOPE');
  });

  it('does not narrow the OWNER out of their own server', async () => {
    const storage = new SqliteStorage(':memory:');
    await putMcpGrant(storage, grant({ grantee: '*', tools: [] }));
    const r = await resolveMcpAccess({
      storage, server: makeServer(), grantee: OWNER, tool: 'anything', scopes: [],
    });
    // Grants exist to narrow the things acting FOR a person. A person cannot be narrowed out of
    // their own account, and a grant of zero tools to everything must not lock them out.
    expect(r.allowed).toBe(true);
  });
});

describe('which grant applies', () => {
  it('a grant for this agent beats the catch-all', async () => {
    const storage = new SqliteStorage(':memory:');
    await putMcpGrant(storage, grant({ grantee: '*', tools: [] }));
    await putMcpGrant(storage, grant({ grantee: AGENT, tools: ['read_issue'] }));

    const mine = await resolveMcpAccess({
      storage, server: makeServer(), grantee: AGENT, tool: 'read_issue', scopes: ['mcp:use'],
    });
    expect(mine.allowed).toBe(true);

    // …and the catch-all still governs everything else.
    const other = await resolveMcpAccess({
      storage, server: makeServer(), grantee: OTHER_AGENT, tool: 'read_issue', scopes: ['mcp:use'],
    });
    expect(other.allowed).toBe(false);
  });

  it('a grant on one server says nothing about another', async () => {
    const storage = new SqliteStorage(':memory:');
    await putMcpGrant(storage, grant({ server: 'jira', tools: [] }));

    const elsewhere = await resolveMcpAccess({
      storage, server: makeServer({ slug: 'wiki' }), grantee: AGENT, tool: 'write_page',
      scopes: ['mcp:use'],
    });
    expect(elsewhere.allowed).toBe(true);
  });

  it('one owner\'s grant never reaches another owner\'s server', async () => {
    const storage = new SqliteStorage(':memory:');
    await putMcpGrant(storage, grant({ ownerGhii: 'mallory@test-node-001', tools: '*' }));

    // Same slug, same agent name, different owner. The key is scoped by owner, so this finds
    // nothing rather than Mallory's generous grant.
    const r = await resolveMcpAccess({
      storage, server: makeServer(), grantee: AGENT, tool: 'delete_project', scopes: ['mcp:use'],
    });
    // No grant found for THIS owner, so the scope decides — not Mallory's wildcard.
    expect(r.allowed).toBe(true);
    const mine = await listMcpGrants(storage, OWNER);
    expect(mine).toHaveLength(0);
  });
});

describe('expiry and caps', () => {
  it('a grant past its expiry refuses, and says when it ran out', async () => {
    const storage = new SqliteStorage(':memory:');
    await putMcpGrant(storage, grant({
      tools: '*', expires: new Date(Date.now() - 86_400_000).toISOString(),
    }));
    const r = await resolveMcpAccess({
      storage, server: makeServer(), grantee: AGENT, tool: 'read_issue', scopes: ['mcp:use'],
    });
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.code).toBe('GRANT_EXPIRED');
  });

  it('a grant still in date does not', async () => {
    const storage = new SqliteStorage(':memory:');
    await putMcpGrant(storage, grant({
      tools: '*', expires: new Date(Date.now() + 86_400_000).toISOString(),
    }));
    const r = await resolveMcpAccess({
      storage, server: makeServer(), grantee: AGENT, tool: 'read_issue', scopes: ['mcp:use'],
    });
    expect(r.allowed).toBe(true);
  });

  it('a cap that cannot be counted does NOT refuse', async () => {
    const storage = new SqliteStorage(':memory:');
    await putMcpGrant(storage, grant({ tools: '*', callCap: { count: 1, windowHours: 24 } }));
    // No usage rows at all here, which is the "nothing to count" case. A cap is a courtesy
    // ceiling, and refusing because telemetry said nothing would break working agents to
    // enforce a limit nobody reached.
    const r = await resolveMcpAccess({
      storage, server: makeServer(), grantee: AGENT, tool: 'read_issue', scopes: ['mcp:use'],
    });
    expect(r.allowed).toBe(true);
  });
});

describe('locked arguments', () => {
  it('win over what the caller sent', () => {
    // The whole point: "only in project SUPPORT" is not a suggestion, and a caller supplying its
    // own project must not be able to steer out of the fence.
    expect(applyLockedInput({ project: 'SECRET', title: 'x' }, { project: 'SUPPORT' }))
      .toEqual({ project: 'SUPPORT', title: 'x' });
  });

  it('leave everything else alone', () => {
    expect(applyLockedInput({ title: 'x' }, { project: 'SUPPORT' }))
      .toEqual({ title: 'x', project: 'SUPPORT' });
  });

  it('are absent when the grant names none', () => {
    expect(applyLockedInput({ title: 'x' })).toEqual({ title: 'x' });
  });

  it('come back from the resolver so the call path can apply them', async () => {
    const storage = new SqliteStorage(':memory:');
    await putMcpGrant(storage, grant({ tools: '*', lockedInput: { project: 'SUPPORT' } }));
    const r = await resolveMcpAccess({
      storage, server: makeServer(), grantee: AGENT, tool: 'create_issue', scopes: ['mcp:use'],
    });
    expect(r.allowed).toBe(true);
    if (!r.allowed) return;
    expect(r.lockedInput).toEqual({ project: 'SUPPORT' });
  });
});

describe('removing a narrowing', () => {
  it('WIDENS what the agent may do, back to its permissions', async () => {
    const storage = new SqliteStorage(':memory:');
    await putMcpGrant(storage, grant({ tools: ['read_issue'] }));

    const before = await resolveMcpAccess({
      storage, server: makeServer(), grantee: AGENT, tool: 'delete_project', scopes: ['mcp:use'],
    });
    expect(before.allowed).toBe(false);

    expect(await removeMcpGrant(storage, OWNER, 'jira', AGENT)).toBe(true);

    const after = await resolveMcpAccess({
      storage, server: makeServer(), grantee: AGENT, tool: 'delete_project', scopes: ['mcp:use'],
    });
    // This is the direction people get wrong, which is why the tool's own description and the
    // route's response both say it out loud.
    expect(after.allowed).toBe(true);
  });

  it('answers false when there was nothing to remove', async () => {
    const storage = new SqliteStorage(':memory:');
    expect(await removeMcpGrant(storage, OWNER, 'jira', AGENT)).toBe(false);
  });
});
