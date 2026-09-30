/**
 * @file test/unit/classification-exits-review.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The exits of the TARGET-082 review, on a real SQLite store with classification on
 *   for everyone. Each block names its review item:
 *   1. a group share of `organism.<id>.**` hands a non-member nothing an organism label keeps inside;
 *   2. the personal exports (GET /v1/memory/export, the bundle) leave an organism's record behind and
 *      say so; the GDPR export (GET /v1/owners/:name/export) takes it and says it carries classified
 *      organism content (decided 2026-09-30);
 *   3. a workspace export, a share link and federation say what stayed behind;
 *   5. POST /v1/memory/copy reads its source through the reader and carries the label, never lower;
 *   6. the reach gate counts the reads it missed.
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-exits-review.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-30 — The GDPR export takes the person's organism records and names them in
 *     classified_organism_content; the ordinary export still leaves them out (decided 2026-09-30).
 *   v1.0.0 — 2026-09-29 — TARGET-082 review, items 1, 2, 3, 5 and 6. Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { Router } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { MemoryRecord, OrganismRecord, OrganismMembershipRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { memoryTarget, setLabel, type LabelActor } from '../../src/services/classification/labels.js';
import { readerFor, systemReader } from '../../src/services/classification/reader.js';
import { resetClassificationAudit } from '../../src/services/classification/audit.js';
import { collectWorkspace } from '../../src/services/workspace-export.js';
import { leaveMemoriesToPeer, WITHHELD_REASON } from '../../src/services/classification-exits.js';
import { safeUnzip, BACKUP_ZIP_LIMITS } from '../../src/services/safe-zip.js';
import { memoryRouter } from '../../src/routes/memory.js';
import { registerOwnerExportRoute } from '../../src/routes/owners/export.js';
import { findingsOf } from '../../scripts/check-classification-reach.js';
import { logger } from '../../src/utils/logger.js';

const N = 'n';
const ALICE = `alice@${N}`;
const AGENT = `claude#${ALICE}`;
const ORG = 'o1';
const ORG_KEY = `organism.${ORG}.w.ws1.notes.a`;
const stamp = '2026-09-29T12:00:00.000Z';
const alice: LabelActor = { principal: ALICE, ownerGhii: ALICE, ownerName: 'alice', kind: 'human' };
const ownerAuth = { sub: 'alice', owner: 'alice', roles: ['owner'] };
const agentAuth = { sub: AGENT, owner: 'alice', roles: ['agent'], scopes: ['memory:read', 'memory:write'] };
/** A visitor signed in from another node, whose home can never be reached from the test. */
const VISITOR = 'dora@home-node';
const visitorAuth = { sub: VISITOR, owner: VISITOR, roles: ['federated'], federated: true, homeNode: 'home-node', homeUrl: 'http://127.0.0.1:9' };

function mem(ownerGaii: string, key: string, value: unknown, visibility: MemoryRecord['visibility'] = 'private'): MemoryRecord {
  return { key, ownerGaii, value, visibility, tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp };
}

describe('TARGET-082 review: what leaves, and what the answer says stayed', () => {
  let storage: SqliteStorage;
  let config: AimeatConfig;
  const deps = () => ({ storage, config });

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: N, classificationMode: 'all', consentEnabled: true };
    resetClassificationAudit();
    for (const name of ['alice', 'bob', 'carol']) {
      await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: stamp });
      await storage.createGHII({ username: name, nodeId: N, ghii: `${name}@${N}`, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: stamp, updatedAt: stamp } as never);
    }
    await storage.createAgent({ name: 'claude', owner: 'alice', gaii: AGENT, capabilities: [], publicKey: 'pk', trustScore: 50, morselBalance: 0, createdAt: stamp, lastSeen: stamp } as never);
    await storage.createOrganism({
      id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: ALICE, createdBy: ALICE, owners: [ALICE],
      admins: [ALICE], members: [ALICE], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: `organism.${ORG}`, createdAt: stamp, updatedAt: stamp,
    } as OrganismRecord);
    for (const [name, role] of [['alice', 'creator'], ['carol', 'member']] as const) {
      await storage.createMembership({ id: `m-${name}`, organismId: ORG, ghii: name, role, status: 'active', joinedAt: stamp } as OrganismMembershipRecord);
    }
  });
  afterEach(() => { storage.close(); vi.restoreAllMocks(); resetClassificationAudit(); });

  describe('the memory routes', () => {
    let server: http.Server;
    let base: string;
    beforeEach(async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        const who = req.headers['x-test-as'];
        if (who === 'owner') req.auth = ownerAuth as never;
        if (who === 'agent') req.auth = agentAuth as never;
        if (who === 'visitor') req.auth = visitorAuth as never;
        if (who === 'bob' || who === 'carol') req.auth = { sub: who, owner: who, roles: ['owner'] } as never;
        next();
      });
      app.use(memoryRouter(config, storage));
      const owners = Router();
      registerOwnerExportRoute(owners, config, storage);
      app.use(owners);
      server = http.createServer(app);
      await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterEach(async () => { await new Promise<void>(r => server.close(() => r())); });
    const call = (method: string, path: string, as: string, body?: unknown) => fetch(`${base}${path}`, {
      method, headers: { 'x-test-as': as, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
    });

    describe('item 1: a group share keeps an organism label inside the organism', () => {
      beforeEach(async () => {
        await storage.createSharingGroup({
          id: 'g1', name: 'Friends', ownerGaii: ALICE, defaultPermissions: { read: true, write: false }, createdAt: stamp, updatedAt: stamp,
          members: [{ identifier: `bob@${N}`, permissions: { read: true, write: false } }, { identifier: `carol@${N}`, permissions: { read: true, write: false } }],
        } as never);
        await storage.createGroupShare({ id: 's1', groupId: 'g1', ownerGaii: ALICE, keyPattern: `organism.${ORG}.**`, createdAt: stamp, createdBy: ALICE });
        await storage.createGroupShare({ id: 's2', groupId: 'g1', ownerGaii: ALICE, keyPattern: 'notes.**', createdAt: stamp, createdBy: ALICE });
        await storage.setMemory(mem(ALICE, ORG_KEY, 'organism note'));
        await storage.setMemory(mem(ALICE, 'notes.b', 'personal note'));
      });
      const read = (as: string, key: string) => call('GET', `/v1/memory/${encodeURIComponent(ALICE)}/${encodeURIComponent(key)}`, as);

      it('refuses a non-member an organism key the default label keeps inside, and names the label', async () => {
        const res = await read('bob', ORG_KEY);
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: unknown }).error).toMatchObject({ code: 'CLASSIFIED', details: { label: 'sisainen' } });
      });

      it('still hands the same key to a member of the organism, and personal content to anyone shared', async () => {
        expect((await read('carol', ORG_KEY)).status).toBe(200);
        expect((await read('bob', 'notes.b')).status).toBe(200);
      });

      it('hands a non-member an organism key whose label may leave', async () => {
        await setLabel(deps(), alice, memoryTarget(ALICE, ORG_KEY), { label: 'julkinen' });
        expect((await read('bob', ORG_KEY)).status).toBe(200);
      });
    });

    describe('item 2: personal exports', () => {
      beforeEach(async () => {
        await storage.setMemory(mem(ALICE, ORG_KEY, 'organism note'));
        await storage.setMemory(mem(ALICE, 'notes.mine', 'my own'));
      });

      it('GET /v1/memory/export leaves the organism record behind and names it in left_out', async () => {
        const body = await (await call('GET', '/v1/memory/export', 'owner')).json() as { data: { entries: Array<{ key: string }>; left_out?: unknown[]; count: number } };
        expect(body.data.entries.map(e => e.key)).toEqual(['notes.mine']);
        expect(body.data.count).toBe(1);
        expect(body.data.left_out).toEqual([{ key: ORG_KEY, label: 'sisainen', reason: expect.stringContaining('may not leave its organism') }]);
      });

      // Decided by Jouni 2026-09-30: the GDPR export is the person's legal right to their own data,
      // so their organism records come out, and the answer says it carries classified organism content.
      it('GET /v1/owners/:name/export, the GDPR export, takes the organism record too and says so', async () => {
        await setLabel(deps(), alice, memoryTarget(ALICE, ORG_KEY), { label: 'erittain-luottamuksellinen' });
        const body = await (await call('GET', '/v1/owners/alice/export', 'owner')).json() as {
          data: { memories: Array<{ key: string }>; left_out?: unknown[]; classified_organism_content?: { count: number; keys: string[]; note: string } };
        };
        expect(body.data.memories.map(m => m.key).sort()).toEqual([ORG_KEY, 'notes.mine'].sort());
        expect(body.data.left_out).toBeUndefined();
        expect(body.data.classified_organism_content).toMatchObject({ count: 1, keys: [ORG_KEY], note: expect.stringContaining('classified') });
        // The ordinary export still keeps the same record behind.
        const ordinary = await (await call('GET', '/v1/memory/export', 'owner')).json() as { data: { entries: Array<{ key: string }>; left_out?: Array<{ key: string }> } };
        expect(ordinary.data.entries.map(e => e.key)).toEqual(['notes.mine']);
        expect(ordinary.data.left_out?.map(l => l.key)).toEqual([ORG_KEY]);
      });

      it('GET /v1/owners/:name/export says nothing about organism content when it holds none', async () => {
        await storage.deleteMemory(ALICE, ORG_KEY);
        const body = await (await call('GET', '/v1/owners/alice/export', 'owner')).json() as { data: { memories: Array<{ key: string }>; classified_organism_content?: unknown } };
        expect(body.data.memories.map(m => m.key)).toEqual(['notes.mine']);
        expect(body.data.classified_organism_content).toBeUndefined();
      });

      it('the bundle leaves it out and its manifest says classified', async () => {
        const res = await call('POST', '/v1/memory/bundle', 'owner', { items: [{ kind: 'memory', key: ORG_KEY }, { kind: 'memory', key: 'notes.mine' }] });
        expect(res.status).toBe(200);
        const zip = await safeUnzip(Buffer.from(await res.arrayBuffer()), BACKUP_ZIP_LIMITS);
        const manifest = JSON.parse(zip.get('manifest.json')!.toString('utf8')) as { items: Array<Record<string, unknown>> };
        expect(manifest.items.find(i => i.key === ORG_KEY)).toMatchObject({ included: false, reason: 'classified', label: 'sisainen' });
        expect(manifest.items.find(i => i.key === 'notes.mine')).toMatchObject({ included: true });
        expect([...zip.keys()].some(k => k.includes('organism'))).toBe(false);
      });
    });

    describe('item 3: push-home says why a record stays', () => {
      it('answers 403 CLASSIFIED with the label for the visitor\'s organism record, before any home node is asked', async () => {
        await storage.setMemory(mem(VISITOR, ORG_KEY, 'held here'));
        const res = await call('POST', '/v1/memory/push-home', 'visitor', { key: ORG_KEY });
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string; details?: { label?: string } } };
        expect(body.error).toMatchObject({ code: 'CLASSIFIED', details: { label: 'sisainen' } });
      });
    });

    describe('item 5: copy', () => {
      const BOB = `bob@${N}`;
      const bob: LabelActor = { principal: BOB, ownerGhii: BOB, ownerName: 'bob', kind: 'human' };

      it('answers 404 for a public source the calling AI may not see, and writes nothing', async () => {
        await storage.setMemory(mem(BOB, 'notes.pub', 'secret', 'public'));
        await setLabel(deps(), bob, memoryTarget(BOB, 'notes.pub'), { label: 'erittain-luottamuksellinen' });
        const res = await call('POST', '/v1/memory/copy', 'agent', { source_gaii: BOB, key: 'notes.pub' });
        expect(res.status).toBe(404);
        expect(await storage.getMemory(AGENT, 'notes.pub')).toBeNull();
      });

      it('carries the source label onto the copy', async () => {
        await storage.setMemory(mem(BOB, 'notes.conf', 'confidential', 'public'));
        await setLabel(deps(), bob, memoryTarget(BOB, 'notes.conf'), { label: 'luottamuksellinen' });
        const res = await call('POST', '/v1/memory/copy', 'agent', { source_gaii: BOB, key: 'notes.conf' });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { data: { classification?: string } }).data.classification).toBe('luottamuksellinen');
        expect(await storage.getContentLabel(memoryTarget(AGENT, 'notes.conf'))).toMatchObject({ label: 'luottamuksellinen', source: 'rule' });
      });

      it('never lowers a label the copy already has', async () => {
        await storage.setMemory(mem(BOB, 'notes.low', 'fine', 'public'));
        await setLabel(deps(), bob, memoryTarget(BOB, 'notes.low'), { label: 'julkinen' });
        await setLabel(deps(), alice, memoryTarget(AGENT, 'notes.low'), { label: 'luottamuksellinen' });
        expect((await call('POST', '/v1/memory/copy', 'agent', { source_gaii: BOB, key: 'notes.low' })).status).toBe(200);
        expect(await storage.getContentLabel(memoryTarget(AGENT, 'notes.low'))).toMatchObject({ label: 'luottamuksellinen', source: 'human' });
      });
    });

    describe('item 6: the bin lists what the reader may see', () => {
      it('GET /v1/memory/deleted leaves out a binned key hidden from the calling AI', async () => {
        await storage.setMemory(mem(AGENT, 'bin.secret', 's'));
        await storage.setMemory(mem(AGENT, 'bin.plain', 'p'));
        await setLabel(deps(), alice, memoryTarget(AGENT, 'bin.secret'), { label: 'erittain-luottamuksellinen' });
        await storage.deleteMemory(AGENT, 'bin.secret');
        await storage.deleteMemory(AGENT, 'bin.plain');
        const body = await (await call('GET', '/v1/memory/deleted', 'agent')).json() as { data: { items: Array<{ key: string }> } };
        expect(body.data.items.map(i => i.key)).toEqual(['bin.plain']);
      });
    });
  });

  describe('item 3: the multi-item exits say what stayed', () => {
    it('a workspace export names what leave() kept back in leftOut', async () => {
      await storage.setMemory(mem(ALICE, `organism.${ORG}.meta.workspaces`, { workspaces: [{ id: 'ws1', name: 'Board', createdAt: stamp, createdBy: 'alice' }] }));
      await storage.setMemory(mem(ALICE, `organism.${ORG}.w.ws1.meta.manifest`, { manifestVersion: '1', name: 'Board', kind: 'project', objectTypes: [] }));
      await storage.setMemory(mem(ALICE, ORG_KEY, 'stays'));
      await setLabel(deps(), alice, memoryTarget(ALICE, `organism.${ORG}.w.ws1.meta.manifest`), { label: 'julkinen' });
      const { json } = await collectWorkspace(storage, config, {
        orgId: ORG, ws: 'ws1', exporterGaii: ALICE, exportedAt: stamp, isOrgManager: true, reader: readerFor(deps(), ownerAuth),
      });
      expect(json.leftOut.map(l => l.key)).toEqual([ORG_KEY]);
      expect(json.leftOut[0]).toMatchObject({ label: 'sisainen' });
    });

    it('federation tells the peer a count and a reason, and logs the keys here', async () => {
      const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
      const out = await leaveMemoriesToPeer(deps(), [mem(ALICE, ORG_KEY, 'x'), mem(ALICE, 'notes.mine', 'y')], 'peer-1', 'test');
      expect(out.kept.map(r => r.key)).toEqual(['notes.mine']);
      expect(out.withheld).toEqual({ count: 1, reason: WITHHELD_REASON });
      expect(JSON.stringify(out.withheld)).not.toContain(ORG_KEY);
      expect(info).toHaveBeenCalledWith('test: classified memory stayed on this node', expect.objectContaining({ keys: [ORG_KEY] }));
    });

    it('the node reader leaves nothing behind when classification is off', async () => {
      const off = { storage, config: { ...config, classificationMode: 'off' as const } };
      const { left } = await systemReader(off, ALICE).leave([ORG_KEY], k => memoryTarget(ALICE, k), { kind: 'federation', peer: 'p' });
      expect(left).toEqual([]);
    });
  });

  describe('item 6: the reach gate counts the reads it missed', () => {
    it('counts versions, the bin, key lists, byte ranges, several owners\' files, the token mint and this.memoryDb', () => {
      const src = [
        'await storage.listMemoryHistory(o, k);',
        'await deps.storage.listDeletedMemory(o);',
        'await storage.listAllDeletedMemory({});',
        'await storage.listMemoryKeysByPrefix(p);',
        'await storage.readStorageFileRange(o, k, 0, 1);',
        'await this.storage.listStorageFilesForOwners([o]);',
        'await generateDownloadToken({ sub: o, key: k });',
        'await this.memoryDb.listOwnerScopeMeta(n, {});',
      ].join('\n');
      expect(findingsOf('x.ts', src)).toEqual({
        listMemoryHistory: 1, listDeletedMemory: 1, listAllDeletedMemory: 1, listMemoryKeysByPrefix: 1,
        readStorageFileRange: 1, listStorageFilesForOwners: 1, generateDownloadToken: 1, 'memoryDb.listOwnerScopeMeta': 1,
      });
    });
  });
});
