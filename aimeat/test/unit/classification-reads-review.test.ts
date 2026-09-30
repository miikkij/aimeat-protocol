/**
 * @file test/unit/classification-reads-review.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The reads of the TARGET-082 review, on a real SQLite store with classification on for
 *   everyone. Each block names its review item:
 *   4. a workspace's manifest and readme pass the reader before an overview hands them to an AI;
 *   7. an AI shown a warning-classified record is told so on REST (single read, list, search, the
 *      workspace read), in readWorkspaceOp and in an extension's ctx.memory.getPublic;
 *   8. the refinery reads an attachment through readAiFile before its text reaches a model;
 *   9. the visibility and share gates run before the reader, so an outsider writes no audit row;
 *   3. a share link logs what stayed inside the organism;
 *   6. the listings the widened reach gate found (the Memory tab, the portfolio catalog, the
 *      structure history) pass the reader.
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-reads-review.test.ts
 * @version-history
 *   v1.2.0 — 2026-09-30 — No default label hides from AI (option B): the node policy hides the
 *     highest label explicitly, so each test still proves what a hiding label does.
 *   v1.1.0 — 2026-09-30 — A warning names the document's address (one label per document, decided
 *     2026-09-30), so the two warning lists expect `notes.a` where they expected `notes.a.latest`.
 *   v1.0.0 — 2026-09-29 — TARGET-082 review, items 3, 4, 6, 7, 8 and 9. Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { Router } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { MemoryRecord, OrganismRecord, OrganismMembershipRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { memoryTarget, fileTarget, setLabel, type LabelActor } from '../../src/services/classification/labels.js';
import { readerFor, readerForAgent } from '../../src/services/classification/reader.js';
import { resetClassificationAudit, pendingClassificationAudit } from '../../src/services/classification/audit.js';
import { loadWorkspaceContent } from '../../src/services/workspace-content.js';
import { collectWorkspaceSummary } from '../../src/services/structure-overview.js';
import { readWorkspaceOp } from '../../src/services/workspace-tool-ops.js';
import { buildExtensionCtx } from '../../src/services/extension-ctx.js';
import { readAttachments, type Ctx } from '../../src/services/refinery/pipeline.js';
import { memoryRouter } from '../../src/routes/memory.js';
import { storageFilesRouter } from '../../src/routes/storage-files.js';
import { portfolioRouter } from '../../src/routes/portfolio.js';
import { createMemoryTabService } from '../../src/services/db/memory-tab-db-service.js';
import { createOrganismHelpers } from '../../src/routes/organisms/shared.js';
import { registerOrganismWorkspaceOpsRoutes } from '../../src/routes/organisms/workspace-ops.js';
import { registerOrganismWorkspaceReadRoutes } from '../../src/routes/organisms/workspace-read.js';
import { logger } from '../../src/utils/logger.js';
import { hideFromAiOnNode } from './classification-fixtures.js';

vi.mock('../../src/services/connections/attachment-store.js', () => ({
  storeMailAttachment: vi.fn(async () => ({ ok: true, provider: 'gmail', key: 'mail/r.pdf', filename: 'r.pdf', mime_type: 'application/pdf', size: 10 })),
}));
vi.mock('../../src/services/file-text/index.js', () => ({
  extractFileText: vi.fn(async () => ({ text: 'The secret invoice text, long enough to be taken as a text layer.', kind: 'pdf' })),
}));

const N = 'n';
const ALICE = `alice@${N}`;
const AGENT = `claude#${ALICE}`;
const BOB_AGENT = `claw#bob@${N}`;
const ORG = 'o1';
const ROOT = `organism.${ORG}.w.ws1`;
const HIDDEN = 'erittain-luottamuksellinen';
const WARN = 'luottamuksellinen';
const stamp = '2026-09-29T12:00:00.000Z';
const alice: LabelActor = { principal: ALICE, ownerGhii: ALICE, ownerName: 'alice', kind: 'human' };
const ownerAuth = { sub: 'alice', owner: 'alice', roles: ['owner'] };
const agentAuth = { sub: AGENT, owner: 'alice', roles: ['agent'], scopes: ['memory:read', 'memory:write', 'organism:read'] };
const bobAgentAuth = { sub: BOB_AGENT, owner: 'bob', roles: ['agent'], scopes: ['memory:read'] };

function mem(ownerGaii: string, key: string, value: unknown, visibility: MemoryRecord['visibility'] = 'private'): MemoryRecord {
  return { key, ownerGaii, value, visibility, tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp };
}

describe('TARGET-082 review: what a read hands out, and in which order it asks', () => {
  let storage: SqliteStorage;
  let config: AimeatConfig;
  const deps = () => ({ storage, config });
  const label = (owner: string, key: string, id: string) => setLabel(deps(), alice, memoryTarget(owner, key), { label: id });

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: N, classificationMode: 'all', consentEnabled: true };
    resetClassificationAudit();
    // No default label hides from AI since 2026-09-30: the operator hides HIDDEN on this node.
    await hideFromAiOnNode(storage, N, [HIDDEN]);
    for (const name of ['alice', 'bob']) {
      await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: stamp });
      await storage.createGHII({ username: name, nodeId: N, ghii: `${name}@${N}`, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: stamp, updatedAt: stamp } as never);
    }
    for (const [name, owner, gaii] of [['claude', 'alice', AGENT], ['claw', 'bob', BOB_AGENT]]) {
      await storage.createAgent({ name, owner, gaii, capabilities: [], publicKey: 'pk', trustScore: 50, morselBalance: 0, createdAt: stamp, lastSeen: stamp } as never);
    }
    await storage.createOrganism({
      id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: ALICE, createdBy: ALICE, owners: [ALICE],
      admins: [ALICE], members: [ALICE], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: `organism.${ORG}`, createdAt: stamp, updatedAt: stamp,
    } as OrganismRecord);
    await storage.createMembership({ id: 'm-alice', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: stamp } as OrganismMembershipRecord);
    await storage.setMemory(mem(ALICE, `organism.${ORG}.meta.workspaces`, { workspaces: [{ id: 'ws1', name: 'Board', createdAt: stamp, createdBy: 'alice' }] }));
    await storage.setMemory(mem(ALICE, `${ROOT}.meta.manifest`, {
      manifestVersion: '1', name: 'Board', kind: 'project', objectTypes: [{ name: 'note', namespace: 'notes', mode: 'records' }],
    }));
    await storage.setMemory(mem(ALICE, `${ROOT}.meta.readme`, '# Board\n\nThe secret plan for the merger.'));
    await storage.setMemory(mem(ALICE, `${ROOT}.notes.a.latest`, { title: 'Warned note' }));
    await storage.setMemory(mem(ALICE, `${ROOT}.notes.b.latest`, { title: 'Plain note' }));
    await label(ALICE, `${ROOT}.notes.a.latest`, WARN);
  });
  afterEach(() => { storage.close(); vi.restoreAllMocks(); resetClassificationAudit(); });

  describe('item 4: the manifest and readme pass the reader', () => {
    it('an AI gets no readme the label hides from it, in the loader and in the structure overview', async () => {
      await label(ALICE, `${ROOT}.meta.readme`, HIDDEN);
      const who = { sub: AGENT, ownerName: 'alice', accessorGaii: ALICE };
      const ai = await loadWorkspaceContent(deps(), readerForAgent(deps(), AGENT), who, { organismId: ORG, ws: 'ws1' });
      expect(ai.ok && ai.descriptor.readme).toBeNull();
      expect(ai.ok && ai.descriptor.manifest?.key).toBe(`${ROOT}.meta.manifest`);
      const summary = await collectWorkspaceSummary(storage, config, { orgId: ORG, ws: 'ws1', viewerGaii: ALICE, reader: readerForAgent(deps(), AGENT) });
      expect(summary.readme).toBeNull();
      const person = await collectWorkspaceSummary(storage, config, { orgId: ORG, ws: 'ws1', viewerGaii: ALICE, reader: readerFor(deps(), ownerAuth) });
      expect(person.readme).toBe('The secret plan for the merger.');
    });

    it('an AI gets neither the manifest nor the workspace name the label hides from it', async () => {
      await label(ALICE, `${ROOT}.meta.manifest`, HIDDEN);
      const summary = await collectWorkspaceSummary(storage, config, { orgId: ORG, ws: 'ws1', name: 'ws1', viewerGaii: ALICE, reader: readerForAgent(deps(), AGENT) });
      expect(summary.name).toBe('ws1');
      expect(summary.readable).toBe(false);
    });
  });

  describe('item 7: the warning reaches an AI on every read surface', () => {
    const W = { label: WARN, name: 'Confidential', says: expect.any(String) };

    it('readWorkspaceOp names the warned record in the index and over the read', async () => {
      const r = await readWorkspaceOp(deps(), { principal: AGENT, ownerName: 'alice', ownerGhii: ALICE, writerGaii: AGENT, roles: ['agent'] },
        { organismId: ORG, ws: 'ws1', reader: readerForAgent(deps(), AGENT) });
      expect(r.ok).toBe(true);
      const data = (r as { data: { index: { note: Array<Record<string, unknown>> }; classification_warnings?: unknown[] } }).data;
      expect(data.index.note.find(e => e.id === 'a')?.classification_warning).toEqual(W);
      expect(data.index.note.find(e => e.id === 'b')?.classification_warning).toBeUndefined();
      // One label per document (2026-09-30): the warning names the document, not the copy read.
      expect(data.classification_warnings).toEqual([{ key: `${ROOT}.notes.a`, label: WARN, name: 'Confidential' }]);
      const opened = await readWorkspaceOp(deps(), { principal: AGENT, ownerName: 'alice', ownerGhii: ALICE, writerGaii: AGENT, roles: ['agent'] },
        { organismId: ORG, ws: 'ws1', ids: ['a'], reader: readerForAgent(deps(), AGENT) });
      expect((opened as { data: { items: Array<Record<string, unknown>> } }).data.items[0]?.classification_warning).toEqual(W);
    });

    it('ctx.memory.getPublic hands an AI caller the warning beside the value', async () => {
      await storage.setMemory(mem(ALICE, 'pub.conf', { text: 'x' }, 'public'));
      await label(ALICE, 'pub.conf', WARN);
      const ctx = buildExtensionCtx({ config, storage, extMemoryOwner: 'ext:x', caller: { gaii: AGENT, owner: 'alice', roles: ['agent'], scopes: [] }, extConfig: {}, logPrefix: '[t]' });
      expect(await ctx.memory.getPublic(ALICE, 'pub.conf')).toEqual({ text: 'x', classificationWarning: W });
    });

    describe('REST', () => {
      let server: http.Server;
      let base: string;
      beforeEach(async () => {
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
          const who = req.headers['x-test-as'];
          if (who === 'owner') req.auth = ownerAuth as never;
          if (who === 'agent') req.auth = agentAuth as never;
          if (who === 'bob-agent') req.auth = bobAgentAuth as never;
          next();
        });
        app.use(memoryRouter(config, storage));
        app.use(storageFilesRouter(config, storage));
        const orgs = Router();
        const H = createOrganismHelpers(config, storage);
        registerOrganismWorkspaceOpsRoutes(orgs, config, storage, H);
        registerOrganismWorkspaceReadRoutes(orgs, config, storage);
        app.use(orgs);
        server = http.createServer(app);
        await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        await storage.setMemory(mem(AGENT, 'mine.conf', { text: 'confidential words' }));
        await label(AGENT, 'mine.conf', WARN);
      });
      afterEach(async () => { await new Promise<void>(r => server.close(() => r())); });
      const get = async (path: string, as?: string) => {
        const res = await fetch(`${base}${path}`, { headers: as ? { 'x-test-as': as } : {} });
        return { status: res.status, body: await res.json() as { data: Record<string, unknown> } };
      };

      it('GET /v1/memory/:key, the list and the search carry classificationWarning for an AI', async () => {
        expect((await get('/v1/memory/mine.conf', 'agent')).body.data.classificationWarning).toEqual(W);
        const listed = (await get('/v1/memory?prefix=mine.', 'agent')).body.data.items as Array<Record<string, unknown>>;
        expect(listed[0]?.classificationWarning).toEqual(W);
        const found = (await get('/v1/memory/search?q=confidential', 'agent')).body.data.results as Array<Record<string, unknown>>;
        expect(found.find(r => r.key === 'mine.conf')?.classificationWarning).toEqual(W);
        const meta = (await get('/v1/memory/search?q=confidential&include=meta', 'agent')).body.data.results as Array<Record<string, unknown>>;
        expect(meta.find(r => r.key === 'mine.conf')?.classificationWarning).toEqual(W);
      });

      it('the REST workspace read marks the warned record and lists it', async () => {
        const { body } = await get('/v1/organisms/o1/workspace?ws=ws1', 'agent');
        const notes = (body.data.objects as { note: Array<Record<string, unknown>> }).note;
        expect(notes.find(n => n.title === 'Warned note')?._classificationWarning).toEqual(W);
        expect(body.data.classificationWarnings).toEqual([{ key: `${ROOT}.notes.a`, label: WARN, name: 'Confidential' }]);
      });

      it('item 9: an outsider refused by the visibility gate writes no classification audit row', async () => {
        await storage.setMemory(mem(ALICE, 'secret.doc', 'x'));
        await label(ALICE, 'secret.doc', HIDDEN);
        resetClassificationAudit();
        const { status } = await get(`/v1/memory/${encodeURIComponent(ALICE)}/secret.doc`, 'bob-agent');
        expect(status).toBe(403);
        expect(pendingClassificationAudit({ scope: ALICE }).filter(r => r.action === 'refused')).toEqual([]);
      });

      it('item 6: GET /structure/history shows an AI neither the structure record nor its versions the label hides', async () => {
        const key = `organism.${ORG}.meta.structure`;
        await storage.setMemory({ ...mem(ALICE, key, { v: 1 }), trackable: true } as MemoryRecord);
        await storage.setMemory({ ...mem(ALICE, key, { v: 2 }), version: 2, trackable: true } as MemoryRecord);
        await label(ALICE, key, HIDDEN);
        const ai = (await get('/v1/organisms/o1/structure/history', 'agent')).body.data as { current: unknown; history: unknown[] };
        expect(ai.current).toBeNull();
        expect(ai.history).toEqual([]);
        const person = (await get('/v1/organisms/o1/structure/history', 'owner')).body.data as { current: unknown };
        expect(person.current).not.toBeNull();
      });

      it('item 9: GET /v1/pub asks the access decision before the reader, as its memory twin does', async () => {
        await storage.createStorageFile({ key: 'secret.txt', ownerGaii: ALICE, visibility: 'private', mimeType: 'text/plain', size: 1, data: Buffer.from('s'), tags: [], createdAt: stamp });
        await setLabel(deps(), alice, fileTarget(ALICE, 'secret.txt'), { label: HIDDEN });
        resetClassificationAudit();
        const { status } = await get(`/v1/pub/${encodeURIComponent(ALICE)}/secret.txt`, 'bob-agent');
        expect(status).toBe(403);
        expect(pendingClassificationAudit({ scope: ALICE }).filter(r => r.action === 'refused')).toEqual([]);
      });

      it('item 9: a visitor the share gate refuses writes no audit row into the organism\'s log', async () => {
        await storage.setMemory(mem(ALICE, `${ROOT}.meta.share`, { public: true, access: 'account' }));
        resetClassificationAudit();
        const { status } = await get('/v1/organisms/o1/workspace/public/records?ws=ws1');
        expect(status).toBe(401);
        expect(pendingClassificationAudit({ scope: `organism:${ORG}` })).toEqual([]);
      });

      it('item 3: an open share hands out what may leave and logs what stayed', async () => {
        await storage.setMemory(mem(ALICE, `${ROOT}.meta.share`, { public: true, access: 'open' }));
        await label(ALICE, `${ROOT}.notes.b.latest`, 'julkinen');
        const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const { status, body } = await get('/v1/organisms/o1/workspace/public/records?ws=ws1');
        expect(status).toBe(200);
        expect((body.data.records as Array<{ id: string }>).map(r => r.id)).toEqual(['b']);
        expect(info).toHaveBeenCalledWith('share link: classified content stayed in the organism',
          expect.objectContaining({ count: 1, left: [expect.objectContaining({ key: `${ROOT}.notes.a.latest` })] }));
      });
    });
  });

  describe('item 6: the listings the gate found now pass the reader', () => {
    beforeEach(async () => {
      for (const k of ['img/secret.png', 'img/plain.png']) {
        await storage.createStorageFile({ key: k, ownerGaii: AGENT, visibility: 'private', mimeType: 'image/png', size: 1, data: Buffer.from('i'), tags: [], createdAt: stamp });
      }
      await setLabel(deps(), alice, fileTarget(AGENT, 'img/secret.png'), { label: HIDDEN });
      await storage.setMemory(mem(AGENT, 'tab.secret', 's'));
      await label(AGENT, 'tab.secret', HIDDEN);
    });

    it('the Memory tab composite lists neither a key nor a file the reader may not see', async () => {
      const tab = await createMemoryTabService(config, storage).overview(readerForAgent(deps(), AGENT), 'alice', ALICE);
      expect(tab.memory.items.map(i => i.key)).not.toContain('tab.secret');
      expect(tab.files.files.map(f => f.key)).toEqual(['img/plain.png']);
      const person = await createMemoryTabService(config, storage).overview(readerFor(deps(), ownerAuth), 'alice', ALICE);
      expect(person.memory.items.map(i => i.key)).toContain('tab.secret');
    });

    it('the portfolio catalog offers an AI no image the label hides from it', async () => {
      const app = express();
      app.use((req, _res, next) => { req.auth = agentAuth as never; next(); });
      app.use(portfolioRouter(config, storage));
      const server = http.createServer(app);
      await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
      try {
        const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/portfolio/catalog`);
        const body = await res.json() as { data: { images: Array<{ key: string }> } };
        expect(body.data.images.map(i => i.key)).toEqual(['img/plain.png']);
      } finally {
        await new Promise<void>(r => server.close(() => r()));
      }
    });
  });

  describe('item 8: the refinery asks useForAi before an attachment\'s text reaches a model', () => {
    const ctx = (): Ctx => ({
      deps: deps(),
      caller: { ownerGhii: ALICE, owner: 'alice', principal: ALICE, roles: ['owner'], scopes: [], isOwner: true },
      def: { connectionId: 'c1' } as Ctx['def'],
      conn: {} as Ctx['conn'],
    });
    const msg = { id: 'm1', date: '', subject: 'Invoice', from: 'x@y', text: '', attachments: [{ id: 'a1', filename: 'r.pdf', mime: 'application/pdf', size: 10 }] };

    beforeEach(async () => {
      await storage.createStorageFile({ key: 'mail/r.pdf', ownerGaii: ALICE, visibility: 'private', mimeType: 'application/pdf', size: 10, data: Buffer.from('%PDF-1.4'), tags: [], createdAt: stamp });
    });

    it('leaves out a file hidden from AI and names the refusal on the row', async () => {
      await setLabel(deps(), alice, fileTarget(ALICE, 'mail/r.pdf'), { label: HIDDEN });
      const out = await readAttachments(ctx(), msg);
      expect(out.text).toBe('');
      expect(out.fileKeys).toEqual([]);
      expect(out.stored[0]).toMatchObject({ key: 'mail/r.pdf', error: expect.stringMatching(/^CLASSIFIED: /) });
    });

    it('reads the text layer of a file a model may read', async () => {
      const out = await readAttachments(ctx(), msg);
      expect(out.text).toContain('The secret invoice text');
      expect(out.stored[0]).not.toHaveProperty('error');
    });
  });
});
