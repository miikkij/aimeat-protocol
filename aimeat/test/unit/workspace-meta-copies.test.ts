/**
 * @file workspace-meta-copies.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A workspace's meta namespace, `organism.{id}.w.{ws}.meta.*`, and the copies of it.
 *   A memory key is unique per OWNER, not per node, so a write by a second identity does not
 *   overwrite the workspace's manifest: it stores a second copy beside it. Two things follow, and
 *   this file holds both (secaudit 2026-09, A6-9):
 *     - who may write there at all: the workspace's registered creator or an organism admin, the
 *       rule `organism.{id}.meta.*` already had one level up (checkOrganismNamespaceAccess)
 *     - which copy a reader takes when there are several: the creator's, whatever order the store
 *       returns them in (readWorkspaceManifest), and the update path writes the copy the read takes
 *   Both store orders are driven here on SQLite, which returns rows that share a key in insertion
 *   order; that is what lets one test put the other copy first and then the creator's.
 * @structure
 *   - the write rule: plain member, contributor agent, creator, creator's agent, admin, unregistered
 *   - the read: creator's copy in both orders, an agent copy of the creator, the admin fallback, a
 *     plain member's copy never, another node's copy never
 *   - the update path writes the copy the read takes
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-meta-copies.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (secaudit 2026-09, A6-9).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { checkOrganismNamespaceAccess } from '../../src/services/organism-namespace-access.js';
import { readWorkspaceManifest, updateWorkspaceMeta } from '../../src/services/workspace-meta.js';
import type { OrganismRecord, OrganismMembershipRecord, GHIIRecord, ConsentRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'test-node';
const ORG = 'org-copies';
const WS = 'ws-ledger';
const config = { nodeId: NODE } as AimeatConfig;
const now = () => new Date().toISOString();

function organism(): OrganismRecord {
  return {
    id: ORG, name: 'Copies', description: 'x', type: 'project', interests: [],
    creatorGhii: `dave@${NODE}`, admins: [`dave@${NODE}`], members: [`dave@${NODE}`], agentGaiis: [],
    boardId: 'board-copies', joinPolicy: 'open', maxMembers: 100, visibility: 'public',
    moderationConfig: { flagsEnabled: true, autoHideThreshold: 5, appealsEnabled: false },
    memoryNamespace: `organism.${ORG}`, createdAt: now(), updatedAt: now(),
  } as OrganismRecord;
}

function ghii(name: string): GHIIRecord {
  return {
    username: name, nodeId: NODE, ghii: `${name}@${NODE}`, displayName: name, ownerName: name,
    verificationLevel: 0, totpEnabled: false, createdAt: now(), updatedAt: now(),
  } as GHIIRecord;
}

function membership(name: string, role: OrganismMembershipRecord['role']): OrganismMembershipRecord {
  return { id: `mem-${name}`, organismId: ORG, ghii: name, role, status: 'active', joinedAt: now() };
}

async function put(storage: SqliteStorage, ownerGaii: string, key: string, value: unknown): Promise<void> {
  const prev = await storage.getMemory(ownerGaii, key);
  await storage.setMemory({
    key, ownerGaii, value, visibility: 'private', tags: [], ttlHours: null,
    version: (prev?.version ?? 0) + 1, createdAt: prev?.createdAt ?? now(), updatedAt: now(),
  });
}

const manifestKey = (ws = WS) => `organism.${ORG}.w.${ws}.meta.manifest`;
const ledger = (writeRole: string) => ({
  manifestVersion: '1', id: ORG, name: 'Ledger', kind: 'workspace', status: 'active',
  objectTypes: [{ name: 'ledger', schemaRef: 'schema:ledger@1', namespace: 'books.ledger', backing: 'rows', writeRole }],
});
const writeRoleOf = (m: Record<string, unknown> | null) =>
  ((m?.objectTypes as Array<{ writeRole?: string }> | undefined) ?? [])[0]?.writeRole;

/** alice created WS (a plain member of the organism), bob is a plain member, carol an admin, dave
 *  the organism's creator. The registry record that lists WS is alice's, as provisioning writes it. */
async function world(): Promise<SqliteStorage> {
  const storage = new SqliteStorage(':memory:');
  await storage.createOrganism(organism());
  for (const [name, role] of [['alice', 'member'], ['bob', 'member'], ['carol', 'admin'], ['dave', 'creator']] as const) {
    await storage.createGHII(ghii(name));
    await storage.createMembership(membership(name, role));
  }
  await put(storage, `alice@${NODE}`, `organism.${ORG}.meta.workspaces`, { workspaces: [{ id: WS, name: 'Ledger', createdBy: 'alice' }] });
  return storage;
}

const human = (name: string) => ({ principal: name, owner: name, roles: ['owner'] });

describe('who writes a workspace\'s meta namespace', () => {
  let storage: SqliteStorage;
  beforeEach(async () => { storage = await world(); });

  it('refuses a plain member, the manifest and the share record alike', async () => {
    for (const key of [manifestKey(), `organism.${ORG}.w.${WS}.meta.share`, `organism.${ORG}.w.${WS}.meta.readme`]) {
      const r = await checkOrganismNamespaceAccess({ storage, config }, human('bob'), key, 'write');
      expect(r?.status, key).toBe(403);
      expect(r?.code, key).toBe('ACCESS_DENIED');
    }
  });

  it('refuses a plain member\'s agent even with a contributor grant from the creator', async () => {
    const grant: ConsentRecord = {
      id: 'consent-bob', ownerGaii: `alice@${NODE}`, dataPattern: `organism.${ORG}.w.${WS}.**`,
      recipient: `ghii:bob@${NODE}`, purpose: 'workspace-contributor', scope: 'private',
      expires: null, status: 'active', grantedAt: now(), revokedAt: null,
    } as ConsentRecord;
    await storage.createConsent(grant);
    const agent = { principal: `bot#bob@${NODE}`, owner: 'bob', roles: ['agent'] };
    const content = await checkOrganismNamespaceAccess({ storage, config }, agent, `organism.${ORG}.w.${WS}.books.notes.n1.draft`, 'write');
    expect(content, 'the grant opens the content').toBeNull();
    const meta = await checkOrganismNamespaceAccess({ storage, config }, agent, manifestKey(), 'write');
    expect(meta?.status).toBe(403);
  });

  it('lets the workspace\'s creator write it, and the creator\'s own agent', async () => {
    expect(await checkOrganismNamespaceAccess({ storage, config }, human('alice'), manifestKey(), 'write')).toBeNull();
    const agent = { principal: `bot#alice@${NODE}`, owner: 'alice', roles: ['agent'] };
    expect(await checkOrganismNamespaceAccess({ storage, config }, agent, manifestKey(), 'write')).toBeNull();
  });

  it('lets an organism admin and the organism\'s creator write it', async () => {
    expect(await checkOrganismNamespaceAccess({ storage, config }, human('carol'), manifestKey(), 'write')).toBeNull();
    expect(await checkOrganismNamespaceAccess({ storage, config }, human('dave'), manifestKey(), 'write')).toBeNull();
  });

  it('keeps an unregistered workspace\'s meta to the organism\'s managers', async () => {
    const r = await checkOrganismNamespaceAccess({ storage, config }, human('bob'), manifestKey('ws-unlisted'), 'write');
    expect(r?.status).toBe(403);
    expect(await checkOrganismNamespaceAccess({ storage, config }, human('carol'), manifestKey('ws-unlisted'), 'write')).toBeNull();
  });

  it('leaves reads, and a member\'s content writes, as they were', async () => {
    expect(await checkOrganismNamespaceAccess({ storage, config }, human('bob'), manifestKey(), 'read')).toBeNull();
    expect(await checkOrganismNamespaceAccess({ storage, config }, human('bob'), `organism.${ORG}.w.${WS}.books.notes.n1.draft`, 'write')).toBeNull();
  });
});

describe('which copy of a workspace manifest a reader takes', () => {
  let storage: SqliteStorage;
  beforeEach(async () => { storage = await world(); });

  it('takes the creator\'s copy when another copy was stored first', async () => {
    await put(storage, `carol@${NODE}`, manifestKey(), ledger('member'));
    await put(storage, `alice@${NODE}`, manifestKey(), ledger('admin'));
    expect(writeRoleOf(await readWorkspaceManifest(storage as never, ORG, WS, NODE))).toBe('admin');
  });

  it('takes the creator\'s copy when it was stored first', async () => {
    await put(storage, `alice@${NODE}`, manifestKey(), ledger('admin'));
    await put(storage, `carol@${NODE}`, manifestKey(), ledger('member'));
    expect(writeRoleOf(await readWorkspaceManifest(storage as never, ORG, WS, NODE))).toBe('admin');
  });

  it('counts a copy under the creator\'s agent as the creator\'s, the fresher of the two winning', async () => {
    await put(storage, `alice@${NODE}`, manifestKey(), ledger('admin'));
    await new Promise(r => setTimeout(r, 5));
    await put(storage, `bot#alice@${NODE}`, manifestKey(), ledger('member'));
    expect(writeRoleOf(await readWorkspaceManifest(storage as never, ORG, WS, NODE))).toBe('member');
  });

  it('falls back to an organism manager\'s copy when the creator holds none, and never to a plain member\'s', async () => {
    await put(storage, `bob@${NODE}`, manifestKey(), ledger('member'));
    expect(await readWorkspaceManifest(storage as never, ORG, WS, NODE), 'a plain member\'s copy alone decides nothing').toBeNull();
    await put(storage, `carol@${NODE}`, manifestKey(), ledger('admin'));
    expect(writeRoleOf(await readWorkspaceManifest(storage as never, ORG, WS, NODE))).toBe('admin');
  });

  it('reads an unregistered workspace from an organism manager\'s copy, not from a member stored first', async () => {
    await put(storage, `bob@${NODE}`, manifestKey('ws-unlisted'), ledger('member'));
    await put(storage, `dave@${NODE}`, manifestKey('ws-unlisted'), ledger('admin'));
    expect(writeRoleOf(await readWorkspaceManifest(storage as never, ORG, 'ws-unlisted', NODE))).toBe('admin');
  });

  it('ignores a copy stored under an identity of another node', async () => {
    await put(storage, 'alice@other-node', manifestKey(), ledger('member'));
    await put(storage, `alice@${NODE}`, manifestKey(), ledger('admin'));
    expect(writeRoleOf(await readWorkspaceManifest(storage as never, ORG, WS, NODE))).toBe('admin');
  });
});

describe('the update path writes the copy the read takes', () => {
  it('adds a space to the creator\'s copy when an admin\'s copy was stored first', async () => {
    const storage = await world();
    await put(storage, `carol@${NODE}`, manifestKey(), ledger('member'));
    await put(storage, `alice@${NODE}`, manifestKey(), ledger('admin'));
    const res = await updateWorkspaceMeta(storage as never, config, {
      orgId: ORG, ws: WS, callerOwner: 'alice', isAdmin: false,
      addObjectTypes: [{ name: 'journal', namespace: 'books.journal', backing: 'rows' }],
    });
    expect(res.added).toEqual(['journal']);
    const creators = await storage.getMemory(`alice@${NODE}`, manifestKey());
    const names = ((creators?.value as { objectTypes?: Array<{ name: string }> }).objectTypes ?? []).map(o => o.name);
    expect(names).toEqual(['ledger', 'journal']);
    const admins = await storage.getMemory(`carol@${NODE}`, manifestKey());
    expect(((admins?.value as { objectTypes?: unknown[] }).objectTypes ?? []).length, 'the admin\'s copy is left alone').toBe(1);
  });
});
