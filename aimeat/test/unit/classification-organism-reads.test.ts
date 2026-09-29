/**
 * @file test/unit/classification-organism-reads.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description TARGET-082 review, item 1, on a real SQLite store with classification on for
 *   everyone: an `organism.<id>.*` record whose visibility is `members` or `public` reaches a reader
 *   outside that organism only when its label may leave the organism. Each route and service that
 *   serves another account's memory by visibility is asked: GET /v1/memory/:gaii/:key, the node MCP
 *   tool aimeat_memory_read_public, an extension's ctx.memory.getPublic, the librarian's public scope
 *   and discovery's public scope. A member, a label that may leave (julkinen) and a personal record
 *   are the positive controls.
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-organism-reads.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-30 — TARGET-082 review, item 1. Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { MemoryRecord, OrganismRecord, OrganismMembershipRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { memoryTarget, setLabel, type LabelActor } from '../../src/services/classification/labels.js';
import { readerFor } from '../../src/services/classification/reader.js';
import { resetClassificationAudit } from '../../src/services/classification/audit.js';
import { organismKeysCarried } from '../../src/services/group-shares-classification.js';
import { memoryRouter } from '../../src/routes/memory.js';
import { registerMemoryExtendedTools } from '../../src/mcp/memory-extended.js';
import { buildExtensionCtx } from '../../src/services/extension-ctx.js';
import { librarianSearch } from '../../src/services/librarian.js';
import { createMemorySource } from '../../src/services/discovery/sources/memory-source.js';
import type { DiscoveryContext } from '../../src/services/discovery/types.js';

const N = 'n';
const ALICE = `alice@${N}`;
const BOB = `bob@${N}`;
const BOB_AGENT = `claw#bob@${N}`;
const ALICE_AGENT = `claude#alice@${N}`;
const ORG = 'o1';
const ROOT = `organism.${ORG}.w.ws1`;
const MEMBERS_KEY = `${ROOT}.notes.m.latest`;
const PUBLIC_KEY = `${ROOT}.notes.p.latest`;
const OPEN_KEY = `${ROOT}.notes.j.latest`;
const PERSONAL_KEY = 'notes.personal';
const stamp = '2026-09-30T12:00:00.000Z';
const alice: LabelActor = { principal: ALICE, ownerGhii: ALICE, ownerName: 'alice', kind: 'human' };
const auths: Record<string, unknown> = {
  alice: { sub: 'alice', owner: 'alice', roles: ['owner'] },
  bob: { sub: 'bob', owner: 'bob', roles: ['owner'] },
  anon: { sub: 'anonymous', owner: 'anonymous', roles: [], anonymous: true },
};

function mem(key: string, value: unknown, visibility: MemoryRecord['visibility']): MemoryRecord {
  return { key, ownerGaii: ALICE, value, visibility, tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp };
}

describe('TARGET-082 review, item 1: an organism record read by its visibility stays inside for a non-member', () => {
  let storage: SqliteStorage;
  let config: AimeatConfig;
  const deps = () => ({ storage, config });

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: N, classificationMode: 'all', consentEnabled: true };
    resetClassificationAudit();
    for (const name of ['alice', 'bob']) {
      await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: stamp });
      await storage.createGHII({ username: name, nodeId: N, ghii: `${name}@${N}`, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: stamp, updatedAt: stamp } as never);
    }
    for (const [name, owner, gaii] of [['claude', 'alice', ALICE_AGENT], ['claw', 'bob', BOB_AGENT]]) {
      await storage.createAgent({ name, owner, gaii, capabilities: [], publicKey: 'pk', trustScore: 50, morselBalance: 0, createdAt: stamp, lastSeen: stamp } as never);
    }
    await storage.createOrganism({
      id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: ALICE, createdBy: ALICE, owners: [ALICE],
      admins: [ALICE], members: [ALICE], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: `organism.${ORG}`, createdAt: stamp, updatedAt: stamp,
    } as OrganismRecord);
    await storage.createMembership({ id: 'm-alice', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: stamp } as OrganismMembershipRecord);
    // Three organism records (the default label, sisainen, may not leave; julkinen may) and one
    // personal public record, all held by alice and all mentioning "merger" for the searches.
    await storage.setMemory(mem(MEMBERS_KEY, { title: 'Members merger note' }, 'members'));
    await storage.setMemory(mem(PUBLIC_KEY, { title: 'Public merger note' }, 'public'));
    await storage.setMemory(mem(OPEN_KEY, { title: 'Open merger note' }, 'public'));
    await storage.setMemory(mem(PERSONAL_KEY, { title: 'Personal merger note' }, 'public'));
    await setLabel(deps(), alice, memoryTarget(ALICE, OPEN_KEY), { label: 'julkinen' });
  });
  afterEach(() => { storage.close(); resetClassificationAudit(); });

  it('organismKeysCarried keeps a member\'s and a leaving label\'s records, and keeps the rest inside', async () => {
    const records = [MEMBERS_KEY, PUBLIC_KEY, OPEN_KEY, PERSONAL_KEY].map(key => ({ ownerGaii: ALICE, key }));
    const outsider = await organismKeysCarried(deps(), records, BOB);
    expect(outsider.kept.map(r => r.key)).toEqual([OPEN_KEY, PERSONAL_KEY]);
    expect(outsider.left.map(l => [l.item.key, l.label])).toEqual([[MEMBERS_KEY, 'sisainen'], [PUBLIC_KEY, 'sisainen']]);
    expect((await organismKeysCarried(deps(), records, 'anonymous')).kept.map(r => r.key)).toEqual([OPEN_KEY, PERSONAL_KEY]);
    expect((await organismKeysCarried(deps(), records, ALICE)).kept).toHaveLength(4);
    expect((await organismKeysCarried(deps(), records, ALICE_AGENT)).kept).toHaveLength(4);
    const off = { storage, config: { ...config, classificationMode: 'off' as const } };
    expect((await organismKeysCarried(off, records, BOB)).kept).toHaveLength(4);
  });

  describe('GET /v1/memory/:gaii/:key', () => {
    let server: http.Server;
    let base: string;
    beforeEach(async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        const who = req.headers['x-test-as'];
        if (typeof who === 'string' && auths[who]) req.auth = auths[who] as never;
        next();
      });
      app.use(memoryRouter(config, storage));
      server = http.createServer(app);
      await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterEach(async () => { await new Promise<void>(r => server.close(() => r())); });
    const get = async (key: string, as?: string) => {
      const res = await fetch(`${base}/v1/memory/${encodeURIComponent(ALICE)}/${encodeURIComponent(key)}`, { headers: as ? { 'x-test-as': as } : {} });
      return { status: res.status, body: await res.json() as { data?: { value: unknown }; error?: { code: string; details?: { label?: string } } } };
    };

    it('a members record: another signed-in account gets 403 CLASSIFIED with the label; the member reads it', async () => {
      const bob = await get(MEMBERS_KEY, 'bob');
      expect(bob.status).toBe(403);
      expect(bob.body.error?.code).toBe('CLASSIFIED');
      expect(bob.body.error?.details?.label).toBe('sisainen');
      const member = await get(MEMBERS_KEY, 'alice');
      expect(member.status).toBe(200);
      expect(member.body.data?.value).toEqual({ title: 'Members merger note' });
    });

    it('a public record: anonymous and a non-member get 403 CLASSIFIED; a label that may leave and a personal record are read', async () => {
      expect((await get(PUBLIC_KEY)).body.error?.code).toBe('CLASSIFIED');
      expect((await get(PUBLIC_KEY, 'bob')).status).toBe(403);
      expect((await get(PUBLIC_KEY, 'alice')).status).toBe(200);
      expect((await get(OPEN_KEY)).status).toBe(200);
      expect((await get(OPEN_KEY, 'bob')).status).toBe(200);
      expect((await get(PERSONAL_KEY, 'bob')).status).toBe(200);
    });
  });

  it('node MCP aimeat_memory_read_public: CLASSIFIED for an agent whose owner is not a member', async () => {
    const tools = new Map<string, (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>>();
    const fakeMcp = { tool: (name: string, ...rest: unknown[]) => { tools.set(name, rest[rest.length - 1] as never); } };
    const call = async (agent: string, key: string) => {
      registerMemoryExtendedTools(fakeMcp as never, storage, config, () => agent, () => undefined, () => undefined);
      return tools.get('aimeat_memory_read_public')!({ gaii: ALICE, key });
    };
    const refused = await call(BOB_AGENT, PUBLIC_KEY);
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toMatch(/^CLASSIFIED: .*label sisainen/);
    expect((await call(BOB_AGENT, OPEN_KEY)).isError).toBeFalsy();
    expect((await call(ALICE_AGENT, PUBLIC_KEY)).isError).toBeFalsy();
  });

  it('an extension\'s ctx.memory.getPublic reads the kept record as absent for a non-member caller', async () => {
    const ctxFor = (gaii: string, owner: string) => buildExtensionCtx({ config, storage, extMemoryOwner: 'ext:x', caller: { gaii, owner, roles: ['agent'], scopes: [] }, extConfig: {}, logPrefix: '[t]' });
    expect(await ctxFor(BOB_AGENT, 'bob').memory.getPublic(ALICE, PUBLIC_KEY)).toBeNull();
    expect(await ctxFor(BOB_AGENT, 'bob').memory.getPublic(ALICE, OPEN_KEY)).toEqual({ title: 'Open merger note' });
    expect(await ctxFor(ALICE_AGENT, 'alice').memory.getPublic(ALICE, PUBLIC_KEY)).toEqual({ title: 'Public merger note' });
  });

  it('the librarian\'s public scope leaves the kept record out for a non-member, and keeps it for a member', async () => {
    const search = (who: 'alice' | 'bob') => librarianSearch(storage, config, {
      ownerName: who, fanOutOwner: true, viewerGaii: `${who}@${N}`, query: 'merger', scope: 'public',
      reader: readerFor(deps(), auths[who] as never),
    });
    expect((await search('bob')).hits.map(h => h.key).sort()).toEqual([OPEN_KEY, PERSONAL_KEY].sort());
    expect((await search('alice')).hits.map(h => h.key).sort()).toEqual([OPEN_KEY, PERSONAL_KEY, PUBLIC_KEY].sort());
  });

  it('discovery\'s public scope leaves the kept record out for a non-member, with and without a query', async () => {
    const source = createMemorySource(storage, config);
    const ctxFor = (q?: string): DiscoveryContext => ({
      caller: { ownerName: 'bob', sub: 'bob', gaii: BOB, isOwnerSession: true, scopes: [] },
      scope: 'public', filters: { q, limit: 50 }, reader: readerFor(deps(), auths.bob as never),
    } as DiscoveryContext);
    for (const q of ['merger', undefined]) {
      const keys = (await source.enumerate(ctxFor(q))).map(h => (h.record as { key: string }).key);
      expect(keys).toContain(OPEN_KEY);
      expect(keys).toContain(PERSONAL_KEY);
      expect(keys).not.toContain(PUBLIC_KEY);
    }
  });
});
