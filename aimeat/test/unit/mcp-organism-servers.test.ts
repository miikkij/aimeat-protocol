/**
 * @file test/unit/mcp-organism-servers.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A server bound to a group: who reaches it, and who may attach one.
 *
 *   The point of binding a server to an organism is that the team's wiki is reachable by the team
 *   and nobody hands a token to each person who joins. So the failures that matter are the two that
 *   would look like it working: somebody outside the group reaching it, and a workspace binding
 *   turning out to be no narrower than the organism it sits in.
 * @version-history
 *   v1.1.0 — 2026-09-24 — Changing one: the group's owners and admins may change or remove its
 *     server, a member may only use it (requireManageableServer, secaudit 2026-09 A2-1).
 *   v1.0.0 — 2026-09-16 — Phase 5 of the MCP proxy.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { McpServerRecord } from '../../src/models/mcp-server-schemas.js';
import {
  organismAdmits, requireUsableServer, requireManageableServer, listUsableServers, attachOrganismServer,
} from '../../src/services/mcp-client/registry.js';
import { grantWorkspaceRole } from '../../src/services/workspace-roles.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'test-node-001';
const config = { nodeId: NODE, encryptionKey: null, totpSecretEncryptionKey: null } as unknown as AimeatConfig;

const ORG = 'org-abc';
const BOSS = `boss@${NODE}`;
const ADMIN = `admin@${NODE}`;
const MEMBER = `member@${NODE}`;
const OUTSIDER = `outsider@${NODE}`;

async function withOrganism(storage: SqliteStorage): Promise<void> {
  await storage.createOrganism({
    id: ORG, name: 'The team', description: '', type: 'team', location: '', interests: [],
    creatorGhii: BOSS, createdBy: BOSS, owners: [BOSS], admins: [ADMIN], members: [MEMBER],
    agentGaiis: [], boardId: '', joinPolicy: 'invite_only', maxMembers: 100,
    visibility: 'private', memoryNamespace: `organism.${ORG}`,
    moderationConfig: {}, memberVisibility: 'members',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  } as never);
}

function orgServer(over: Partial<McpServerRecord> = {}): McpServerRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), slug: 'wiki', title: 'The team wiki', description: '',
    ownership: 'organism', ownerGhii: null, organismId: ORG, ws: null, createdBy: BOSS,
    transport: { kind: 'http', url: 'https://wiki.example/mcp' },
    auth: 'none', credential: null, credentialShape: null,
    expiresAt: null, providerClientId: null,
    callerIdentity: 'node-credential', exposure: 'gateway',
    toolCache: [], toolCacheHash: '', lastListedAt: null,
    availability: null, allowlist: [], price: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true, status: 'active', lastOkAt: null, lastError: null,
    createdAt: now, updatedAt: now, ...over,
  };
}

describe('a server bound to the whole group', () => {
  it('is reachable by an owner, an admin and a member alike', async () => {
    const storage = new SqliteStorage(':memory:');
    await withOrganism(storage);
    const s = orgServer();

    for (const who of [BOSS, ADMIN, MEMBER]) {
      // Governing the organism and USING a tool it attached are different things, and only the
      // first depends on which of the three you are.
      expect(await organismAdmits(storage, config, s, who, true)).toBe(true);
    }
  });

  it('is not reachable by somebody outside it', async () => {
    const storage = new SqliteStorage(':memory:');
    await withOrganism(storage);
    expect(await organismAdmits(storage, config, orgServer(), OUTSIDER, true)).toBe(false);
  });

  it('answers 404-shaped for an outsider naming it by id', async () => {
    const storage = new SqliteStorage(':memory:');
    await withOrganism(storage);
    const s = orgServer();
    await storage.createMcpServer(s);

    expect((await requireUsableServer(storage, MEMBER, s.id, config))?.id).toBe(s.id);
    // Absent and not-admitted answer alike: naming it must not confirm it exists.
    expect(await requireUsableServer(storage, OUTSIDER, s.id, config)).toBeNull();
  });

  it('appears in a member\'s listing and not an outsider\'s', async () => {
    const storage = new SqliteStorage(':memory:');
    await withOrganism(storage);
    await storage.createMcpServer(orgServer());

    expect((await listUsableServers(storage, MEMBER, config)).map((s) => s.slug)).toEqual(['wiki']);
    expect(await listUsableServers(storage, OUTSIDER, config)).toEqual([]);
  });

  it('is invisible to every caller when the config is not passed', async () => {
    const storage = new SqliteStorage(':memory:');
    await withOrganism(storage);
    await storage.createMcpServer(orgServer());

    // The safe direction for a missing argument: a caller that cannot resolve workspace roles sees
    // nothing rather than everything.
    expect(await listUsableServers(storage, MEMBER)).toEqual([]);
  });
});

describe('a server bound to ONE workspace inside it', () => {
  const inWorkspace = () => orgServer({ ws: 'ws-secret' });

  it('is NOT reachable by a member who has no role in that workspace', async () => {
    const storage = new SqliteStorage(':memory:');
    await withOrganism(storage);
    // In the group, but not in this workspace. If this passed, binding to a workspace would be
    // decoration.
    expect(await organismAdmits(storage, config, inWorkspace(), MEMBER, true)).toBe(false);
  });

  it('lets a CONTRIBUTOR call it', async () => {
    const storage = new SqliteStorage(':memory:');
    await withOrganism(storage);
    await grantWorkspaceRole(storage, config, {
      creatorGhii: BOSS, orgId: ORG, ws: 'ws-secret', grantee: MEMBER,
      role: 'contributor', source: 'grant', grantedBy: BOSS,
    } as never);

    expect(await organismAdmits(storage, config, inWorkspace(), MEMBER, true)).toBe(true);
  });

  it('lets a VIEWER see it but not call it', async () => {
    const storage = new SqliteStorage(':memory:');
    await withOrganism(storage);
    await grantWorkspaceRole(storage, config, {
      creatorGhii: BOSS, orgId: ORG, ws: 'ws-secret', grantee: MEMBER,
      role: 'viewer', source: 'grant', grantedBy: BOSS,
    } as never);

    // The same two words the workspace already uses for everything else in it, which is why
    // binding to a workspace is worth having beside binding to the organism.
    expect(await organismAdmits(storage, config, inWorkspace(), MEMBER, false)).toBe(true);
    expect(await organismAdmits(storage, config, inWorkspace(), MEMBER, true)).toBe(false);
  });
});

describe('attaching one', () => {
  const attach = (storage: SqliteStorage, callerName: string) => attachOrganismServer({
    storage, config, organismId: ORG, callerName,
    createdBy: `${callerName}@${NODE}`, slug: 'wiki', title: 'Wiki',
    transport: { kind: 'http', url: 'https://wiki.example/mcp' },
    // Deferred, so the test asserts the AUTHORITY rather than reaching a real server.
    deferCredential: true,
  });

  it('is allowed for an owner and for an admin', async () => {
    const storage = new SqliteStorage(':memory:');
    await withOrganism(storage);
    expect((await attach(storage, 'boss')).ok).toBe(true);

    const s2 = new SqliteStorage(':memory:');
    await withOrganism(s2);
    expect((await attach(s2, 'admin')).ok).toBe(true);
  });

  it('is refused for an ordinary member', async () => {
    const storage = new SqliteStorage(':memory:');
    await withOrganism(storage);
    const r = await attach(storage, 'member');
    // Attaching is governance even though using the result is not.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NOT_ALLOWED');
  });

  it('is refused for an outsider, in the same words', async () => {
    const storage = new SqliteStorage(':memory:');
    await withOrganism(storage);
    const r = await attach(storage, 'outsider');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NOT_ALLOWED');
  });

  it('is refused for an organism that does not exist, in the same words', async () => {
    const storage = new SqliteStorage(':memory:');
    const r = await attachOrganismServer({
      storage, config, organismId: 'org-nope', callerName: 'boss',
      createdBy: BOSS, slug: 'wiki', title: 'Wiki',
      transport: { kind: 'http', url: 'https://wiki.example/mcp' },
      deferCredential: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Absent and not-allowed answer alike: naming an organism id must not confirm it exists.
    expect(r.code).toBe('NOT_ALLOWED');
  });

  it('refuses a second server with the same name in the same group', async () => {
    const storage = new SqliteStorage(':memory:');
    await withOrganism(storage);
    expect((await attach(storage, 'boss')).ok).toBe(true);
    const again = await attach(storage, 'boss');
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe('SLUG_TAKEN');
  });

  it('belongs to the GROUP, not to whoever attached it', async () => {
    const storage = new SqliteStorage(':memory:');
    await withOrganism(storage);
    const r = await attach(storage, 'boss');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const stored = await storage.getMcpServer(r.server.id);
    // Putting a person here would charge their account for the group's use and erase the group's
    // server with their account — the ruling migration 0052 already made for workspace rows.
    expect(stored?.ownerGhii).toBeNull();
    expect(stored?.organismId).toBe(ORG);
  });
});

describe('changing one', () => {
  it("is for the group's owners and admins; a member may use it and not change it", async () => {
    const storage = new SqliteStorage(':memory:');
    await withOrganism(storage);
    const s = orgServer();
    await storage.createMcpServer(s);

    // The same people who may attach one there: switching it off or removing it is governance too.
    for (const who of [BOSS, ADMIN]) {
      expect((await requireManageableServer(storage, who, s.id, config))?.id).toBe(s.id);
    }
    expect((await requireUsableServer(storage, MEMBER, s.id, config))?.id).toBe(s.id);
    expect(await requireManageableServer(storage, MEMBER, s.id, config)).toBeNull();
    expect(await requireManageableServer(storage, OUTSIDER, s.id, config)).toBeNull();
  });

  it('reads a roll of bare account names as accounts on THIS node', async () => {
    // organism-ownership.ts writes owners as bare names ('boss'), and the rolls above hold whole
    // GHIIs; both must answer alike, and only for the account on this node.
    const storage = new SqliteStorage(':memory:');
    await storage.createOrganism({
      id: ORG, name: 'The team', description: '', type: 'team', location: '', interests: [],
      creatorGhii: BOSS, createdBy: BOSS, owners: ['boss'], admins: ['admin'], members: ['member'],
      agentGaiis: [], boardId: '', joinPolicy: 'invite_only', maxMembers: 100,
      visibility: 'private', memoryNamespace: `organism.${ORG}`,
      moderationConfig: {}, memberVisibility: 'members',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never);
    const s = orgServer();
    await storage.createMcpServer(s);

    expect((await requireManageableServer(storage, BOSS, s.id, config))?.id).toBe(s.id);
    expect((await requireManageableServer(storage, ADMIN, s.id, config))?.id).toBe(s.id);
    expect(await requireManageableServer(storage, MEMBER, s.id, config)).toBeNull();
    expect(await requireManageableServer(storage, 'boss@another-node-002', s.id, config)).toBeNull();
  });
});
