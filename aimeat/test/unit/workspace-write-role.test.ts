/**
 * @file workspace-write-role.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who writes a workspace's content through a permission: the role the node stamps from
 *   POST /v1/consent's explicit `role`, never the purpose text. Until 2026-11-08 the write check read
 *   `purpose === 'workspace-contributor'`, so a purpose typed as that word gave write access, while the
 *   Data Wallet's Read and write was filed read-only for every dated grant. Driven through the shared
 *   service (grantConsent, services/consent-write.ts) and the shared check
 *   (checkOrganismNamespaceAccess, services/organism-namespace-access.ts) on SQLite.
 * @structure
 *   - the attack: a purpose word grants no write; a caller's own metadata.wsRole grants no write
 *   - the use: an explicit write grant with an end date writes; a read grant does not; a passed end
 *     date writes nothing
 *   - the refusals before any write: a key area, an organism's members, another node's person, a
 *     caller who is not the workspace's creator
 *   - a grant from before the stamp keeps the access it had
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-write-role.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (Data Wallet write: the role is a field, not the purpose).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { checkOrganismNamespaceAccess } from '../../src/services/organism-namespace-access.js';
import { grantConsent } from '../../src/services/consent-write.js';
import { listWorkspaceMemberRoles, LEGACY_ROLE_PURPOSE_BEFORE } from '../../src/services/workspace-roles.js';
import type { OrganismRecord, GHIIRecord, ConsentRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'test-node';
const ORG = 'org-wsrole';
const WS = 'ws-plan';
const config = { nodeId: NODE } as AimeatConfig;
const now = () => new Date().toISOString();
const WS_PATTERN = `organism.${ORG}.w.${WS}.**`;
const CONTENT = `organism.${ORG}.w.${WS}.docs.d1`;
const BOB = `ghii:bob@${NODE}`;
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

async function world(): Promise<SqliteStorage> {
  const storage = new SqliteStorage(':memory:');
  await storage.createOrganism({
    id: ORG, name: 'Role', description: 'x', type: 'project', interests: [],
    creatorGhii: `dave@${NODE}`, admins: [`dave@${NODE}`], members: [`dave@${NODE}`], agentGaiis: [],
    boardId: 'board-wsrole', joinPolicy: 'open', maxMembers: 100, visibility: 'public',
    moderationConfig: { flagsEnabled: true, autoHideThreshold: 5, appealsEnabled: false },
    memoryNamespace: `organism.${ORG}`, createdAt: now(), updatedAt: now(),
  } as OrganismRecord);
  for (const [name, role] of [['alice', 'member'], ['bob', 'member'], ['dave', 'creator']] as const) {
    await storage.createGHII({
      username: name, nodeId: NODE, ghii: `${name}@${NODE}`, displayName: name, ownerName: name,
      verificationLevel: 0, totpEnabled: false, createdAt: now(), updatedAt: now(),
    } as GHIIRecord);
    await storage.createMembership({ id: `mem-${name}`, organismId: ORG, ghii: name, role, status: 'active', joinedAt: now() });
  }
  // alice created WS: the registry record that lists it is hers.
  await storage.setMemory({
    key: `organism.${ORG}.meta.workspaces`, ownerGaii: `alice@${NODE}`,
    value: { workspaces: [{ id: WS, name: 'Plan', createdBy: 'alice' }] },
    visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now(), updatedAt: now(),
  });
  return storage;
}

/** alice in person, as POST /v1/consent resolves her session. */
const aliceCaller = { ownerGaii: `alice@${NODE}`, scopes: [], roles: ['owner'] };
const bobInPerson = { principal: 'bob', owner: 'bob', roles: ['owner'] };
const bobAgent = { principal: `bot#bob@${NODE}`, owner: 'bob', roles: ['agent'] };
const bobWrites = async (storage: SqliteStorage, caller: typeof bobInPerson = bobInPerson) =>
  checkOrganismNamespaceAccess({ storage, config }, caller, CONTENT, 'write');

describe('the role that opens a workspace for writing is a field, never the purpose text', () => {
  let storage: SqliteStorage;
  beforeEach(async () => { storage = await world(); });

  it('purpose text "workspace-contributor" grants no write (attack)', async () => {
    const g = await grantConsent({ storage, config }, aliceCaller, {
      recipient: BOB, dataPattern: WS_PATTERN, purpose: 'workspace-contributor', scope: 'local', expires: inDays(30),
    });
    expect(g.ok).toBe(true);
    for (const caller of [bobInPerson, bobAgent]) {
      const r = await bobWrites(storage, caller);
      expect(r?.status, caller.principal).toBe(403);
      expect(r?.code, caller.principal).toBe('CONSENT_REQUIRED');
    }
  });

  it('a caller\'s own metadata.wsRole grants no write (attack)', async () => {
    const g = await grantConsent({ storage, config }, aliceCaller, {
      recipient: BOB, dataPattern: WS_PATTERN, purpose: 'notes', scope: 'local', metadata: { wsRole: 'contributor' },
    });
    expect(g.ok).toBe(true);
    if (g.ok) expect(g.value.metadata?.wsRole).toBe('viewer');
    expect((await bobWrites(storage))?.code).toBe('CONSENT_REQUIRED');
  });

  it('an explicit read-and-write grant with an end date gives write (use)', async () => {
    const g = await grantConsent({ storage, config }, aliceCaller, {
      recipient: BOB, dataPattern: WS_PATTERN, purpose: 'Project Lighthouse until launch', scope: 'local', expires: inDays(30), role: 'write',
    });
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.value.purpose, 'the purpose sentence is saved as typed').toBe('Project Lighthouse until launch');
      expect(g.value.metadata?.wsRole).toBe('contributor');
    }
    expect(await bobWrites(storage), 'bob in person').toBeNull();
    expect(await bobWrites(storage, bobAgent), 'bob\'s agent').toBeNull();
    const roles = await listWorkspaceMemberRoles(storage, config, { creatorGhii: `alice@${NODE}`, orgId: ORG, ws: WS });
    expect(roles.get('bob')?.role, 'the members list shows the role the write check reads').toBe('contributor');
  });

  it('a read grant gives no write', async () => {
    const g = await grantConsent({ storage, config }, aliceCaller, {
      recipient: BOB, dataPattern: WS_PATTERN, purpose: 'reads the plan', scope: 'local', role: 'read',
    });
    expect(g.ok).toBe(true);
    expect((await bobWrites(storage))?.code).toBe('CONSENT_REQUIRED');
    const roles = await listWorkspaceMemberRoles(storage, config, { creatorGhii: `alice@${NODE}`, orgId: ORG, ws: WS });
    expect(roles.get('bob')?.role).toBe('viewer');
  });

  it('a write grant past its end date writes nothing, before the expiry job marks it', async () => {
    await storage.createConsent({
      id: 'c-expired', ownerGaii: `alice@${NODE}`, dataPattern: WS_PATTERN, recipient: BOB, purpose: 'old',
      scope: 'local', expires: inDays(-1), status: 'active', grantedAt: inDays(-10), revokedAt: null,
      metadata: { wsRole: 'contributor' },
    } as ConsentRecord);
    expect((await bobWrites(storage))?.code).toBe('CONSENT_REQUIRED');
  });

  it('refuses write where no write check reads it, and stores nothing', async () => {
    const cases: Array<{ what: string; recipient: string; dataPattern: string; caller?: typeof aliceCaller; status: number }> = [
      { what: 'a key area', recipient: BOB, dataPattern: 'portfolio.**', status: 400 },
      { what: 'a whole organism', recipient: BOB, dataPattern: `organism.${ORG}.**`, status: 400 },
      { what: 'an organism\'s members', recipient: `organism.${ORG}`, dataPattern: WS_PATTERN, status: 400 },
      { what: 'one agent', recipient: `bot#bob@${NODE}`, dataPattern: WS_PATTERN, status: 400 },
      { what: 'a person on another node', recipient: 'ghii:bob@other-node', dataPattern: WS_PATTERN, status: 400 },
      { what: 'a caller who is not the workspace\'s creator', recipient: BOB, dataPattern: WS_PATTERN, caller: { ownerGaii: `dave@${NODE}`, scopes: [], roles: ['owner'] }, status: 403 },
    ];
    for (const c of cases) {
      const caller = c.caller ?? aliceCaller;
      const before = (await storage.listConsents(caller.ownerGaii)).length;
      const g = await grantConsent({ storage, config }, caller, {
        recipient: c.recipient, dataPattern: c.dataPattern, purpose: 'x', scope: 'local', role: 'write',
      });
      expect(g.ok, c.what).toBe(false);
      if (!g.ok) {
        expect(g.status, c.what).toBe(c.status);
        expect(g.code, c.what).toBe('WRITE_NOT_SUPPORTED');
      }
      expect((await storage.listConsents(caller.ownerGaii)).length, `${c.what}: nothing stored`).toBe(before);
    }
  });

  it('refuses a role that is neither read nor write', async () => {
    const g = await grantConsent({ storage, config }, aliceCaller, {
      recipient: BOB, dataPattern: WS_PATTERN, purpose: 'x', scope: 'local', role: 'admin',
    });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.code).toBe('INVALID_INPUT');
  });

  it('a role grant from before the stamp keeps the write access it had', async () => {
    const before = new Date(Date.parse(LEGACY_ROLE_PURPOSE_BEFORE) - 86_400_000).toISOString();
    await storage.createConsent({
      id: 'c-legacy', ownerGaii: `alice@${NODE}`, dataPattern: WS_PATTERN, recipient: BOB, purpose: 'workspace-contributor',
      scope: 'local', expires: null, status: 'active', grantedAt: before, revokedAt: null,
    } as ConsentRecord);
    expect(await bobWrites(storage)).toBeNull();
  });
});
