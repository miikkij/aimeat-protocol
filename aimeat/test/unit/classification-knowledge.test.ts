/**
 * @file test/unit/classification-knowledge.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The knowledge-package and learned-pitfall surfaces pass the classification reader
 *   (TARGET-082 V4) on a real SQLite store with the switch on for everyone: an AI is not shown a
 *   manifest, an entry or a learned pitfall labelled hidden from AI, and is shown a warning-labelled
 *   one with `classificationWarning`; the person is shown everything. Covered: services/appdev-kb.ts
 *   (own and shared learned entries), the MCP pitfall list and knowledge get/list tools, the
 *   operator's overview, the Knowledge tab service, and the REST get, export and clone routes.
 * @version-history
 *   v1.1.0 — 2026-09-30 — No default label hides from AI (option B): the node policy hides the
 *     highest label explicitly, so each test still proves what a hiding label does.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { MemoryRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { readerFor, readerForAgent } from '../../src/services/classification/reader.js';
import { memoryTarget, setLabel, type LabelActor } from '../../src/services/classification/labels.js';
import { ownPitfallRecords, sharedPitfallRecords, listLearnedPitfalls, PITFALL_PREFIX } from '../../src/services/appdev-kb.js';
import { buildKnowledgeOverview } from '../../src/services/knowledge-overview.js';
import { createKnowledgeTabService } from '../../src/services/db/knowledge-tab-db-service.js';
import { registerAppdevPitfallTools } from '../../src/mcp/appdev-pitfalls.js';
import { registerKnowledgeTools } from '../../src/mcp/knowledge.js';
import { knowledgeRouter } from '../../src/routes/knowledge.js';
import { hideFromAiOnNode } from './classification-fixtures.js';

const N = 'n';
const HIDDEN = 'erittain-luottamuksellinen';
const WARN = 'luottamuksellinen';
const AGENT = `claude#alice@${N}`;
const BOB_AGENT = `claw#bob@${N}`;
const ownerAuth = { sub: 'alice', owner: 'alice', roles: ['owner'] };
const agentAuth = { sub: AGENT, owner: 'alice', roles: ['agent'], scopes: ['memory:read', 'memory:write'] };
const actor = (name: string): LabelActor => ({ principal: `${name}@${N}`, ownerGhii: `${name}@${N}`, ownerName: name, kind: 'human' });

function mem(ownerGaii: string, key: string, value: unknown, visibility: MemoryRecord['visibility'], tags: string[]): MemoryRecord {
  const now = new Date().toISOString();
  return { key, ownerGaii, value, visibility, tags, ttlHours: null, version: 1, createdAt: now, updatedAt: now };
}

/** A fake McpServer that keeps each tool's handler, so a test can call it the way the SDK would. */
function fakeMcp() {
  const tools = new Map<string, (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>>();
  const mcp = {
    tool: (...args: unknown[]) => { tools.set(args[0] as string, args[args.length - 1] as never); },
    registerResource: () => undefined,
  } as unknown as McpServer;
  return { mcp, call: async (name: string, a: Record<string, unknown> = {}) => tools.get(name)!(a) };
}

describe('knowledge and learned pitfalls pass the classification reader', () => {
  let storage: SqliteStorage;
  let config: AimeatConfig;
  const deps = () => ({ storage, config });

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: N, classificationMode: 'all' };
    // No default label hides from AI since 2026-09-30: the operator hides HIDDEN on this node.
    await hideFromAiOnNode(storage, N, [HIDDEN]);
    const now = new Date().toISOString();
    for (const name of ['alice', 'bob']) {
      await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: now });
    }
    for (const [name, owner, gaii] of [['claw', 'bob', BOB_AGENT], ['claude', 'alice', AGENT]]) {
      await storage.createAgent({
        name, owner, gaii, capabilities: [], publicKey: 'pk',
        trustScore: 50, morselBalance: 0, createdAt: now, lastSeen: now,
      } as never);
    }
  });
  afterEach(() => storage.close());

  /** Write a record and, when given, set its label as its owner. */
  const put = async (owner: string, labeller: string, key: string, value: unknown, visibility: MemoryRecord['visibility'], tags: string[], label?: string) => {
    await storage.setMemory(mem(owner, key, value, visibility, tags));
    if (label) await setLabel(deps(), actor(labeller), memoryTarget(owner, key), { label });
  };

  describe('learned pitfalls', () => {
    const pitfall = (category: string, slug: string) => ({ title: slug, category, slug, status: 'active', severity: 'warn' });
    beforeEach(async () => {
      for (const [slug, label] of [['secret', HIDDEN], ['conf', WARN], ['plain', undefined]] as const) {
        await put(`alice@${N}`, 'alice', `${PITFALL_PREFIX}auth/${slug}`, pitfall('auth', slug), 'owner', ['pitfall'], label);
      }
      for (const [slug, label] of [['bob-hidden', HIDDEN], ['bob-plain', undefined]] as const) {
        await put(`bob@${N}`, 'bob', `${PITFALL_PREFIX}ui/${slug}`, pitfall('ui', slug), 'public', ['pitfall'], label);
      }
    });

    it('appdev-kb shows an AI only what it may see, with the warning, and the person everything', async () => {
      const ai = readerForAgent(deps(), AGENT);
      expect((await ownPitfallRecords(storage, config, ai)).map(r => r.key.split('/').pop()).sort()).toEqual(['conf', 'plain']);
      expect((await sharedPitfallRecords(storage, config, ai)).map(r => r.key.split('/').pop())).toEqual(['bob-plain']);
      const entries = await listLearnedPitfalls(storage, config, readerForAgent(deps(), AGENT), { includeShared: true });
      expect(entries.find(e => e.slug === 'conf')?.classificationWarning?.label).toBe(WARN);
      expect(entries.find(e => e.slug === 'plain')?.classificationWarning).toBeUndefined();

      const person = readerFor(deps(), ownerAuth);
      expect((await ownPitfallRecords(storage, config, person)).length).toBe(3);
      expect((await sharedPitfallRecords(storage, config, person)).length).toBe(2);
    });

    it('the MCP list tool leaves hidden entries out of both branches', async () => {
      const { mcp, call } = fakeMcp();
      registerAppdevPitfallTools(mcp, storage, config, () => AGENT, () => undefined, []);
      const own = JSON.parse((await call('aimeat_appdev_pitfall_list', { scope: 'own', category: 'auth' })).content[0].text);
      expect(own.pitfalls.map((p: { slug: string }) => p.slug).sort()).toEqual(['conf', 'plain']);
      expect(own.pitfalls.find((p: { slug: string }) => p.slug === 'conf').classificationWarning.label).toBe(WARN);
      const shared = JSON.parse((await call('aimeat_appdev_pitfall_list', { scope: 'platform', category: 'ui', limit: 100 })).content[0].text);
      expect(shared.pitfalls.filter((p: { source: string }) => p.source === 'learned-shared').map((p: { slug: string }) => p.slug)).toEqual(['bob-plain']);
    });
  });

  describe('knowledge packages', () => {
    const manifest = (name: string, entries: string[]) => ({
      type: 'knowledge-package', name, content_type: 'notes', tags: [], author: 'bob', version: '1.0.0',
      entries: entries.map(key => ({ key, title: key, visibility: 'public' })),
      sharing: { catalog_listed: true, allow_clone: true, morsel_price: 0 },
    });

    it('the MCP get and list tools hide a hidden manifest and a hidden entry from the agent', async () => {
      await put(AGENT, 'alice', 'packages/p1/manifest', manifest('P1', []), 'owner', ['knowledge-package']);
      await put(AGENT, 'alice', 'packages/p1/e-secret', 's', 'owner', ['knowledge-entry'], HIDDEN);
      await put(AGENT, 'alice', 'packages/p1/e-plain', 'p', 'owner', ['knowledge-entry']);
      await put(AGENT, 'alice', 'packages/p2/manifest', manifest('P2', []), 'owner', ['knowledge-package'], HIDDEN);
      const { mcp, call } = fakeMcp();
      registerKnowledgeTools(mcp, storage, config, () => AGENT, () => undefined, () => undefined, []);

      const got = JSON.parse((await call('aimeat_knowledge_get', { package_id: 'p1' })).content[0].text);
      expect(got.entries.map((e: { key: string }) => e.key)).toEqual(['packages/p1/e-plain']);
      const refused = await call('aimeat_knowledge_get', { package_id: 'p2' });
      expect(refused.isError).toBe(true);
      const listed = JSON.parse((await call('aimeat_knowledge_list')).content[0].text);
      expect(listed.map((p: { package_id: string }) => p.package_id)).toEqual(['p1']);
    });

    it('the operator overview and the Knowledge tab count only what the reader may see', async () => {
      await put(`alice@${N}`, 'alice', 'packages/a1/manifest', manifest('A1', []), 'owner', ['knowledge-package']);
      await put(`alice@${N}`, 'alice', 'packages/a2/manifest', manifest('A2', []), 'owner', ['knowledge-package'], HIDDEN);
      await put(`alice@${N}`, 'alice', 'packages/a3/manifest', manifest('A3', []), 'owner', ['knowledge-package'], WARN);

      const ai = await buildKnowledgeOverview(config, storage, `alice@${N}`, readerForAgent(deps(), AGENT));
      expect((ai.summary as { total: number }).total).toBe(2);
      expect(ai.packages.find(p => p.package_id === 'a3')?.classificationWarning).toMatchObject({ label: WARN });
      const person = await buildKnowledgeOverview(config, storage, `alice@${N}`, readerFor(deps(), ownerAuth));
      expect((person.summary as { total: number }).total).toBe(3);

      const tab = createKnowledgeTabService(storage);
      expect((await tab.overview(`alice@${N}`, readerForAgent(deps(), AGENT))).packages.length).toBe(2);
      expect((await tab.overview(`alice@${N}`, readerFor(deps(), ownerAuth))).packages.length).toBe(3);
    });

    describe('REST routes', () => {
      let server: http.Server;
      let base: string;
      beforeEach(async () => {
        await put(BOB_AGENT, 'bob', 'packages/pb/manifest', manifest('PB', ['packages/pb/e-secret', 'packages/pb/e-plain']), 'public', ['knowledge-package']);
        await put(BOB_AGENT, 'bob', 'packages/pb/e-secret', 'secret value', 'public', ['knowledge-entry'], HIDDEN);
        await put(BOB_AGENT, 'bob', 'packages/pb/e-plain', 'plain value', 'public', ['knowledge-entry']);
        await put(BOB_AGENT, 'bob', 'packages/pc/manifest', manifest('PC', []), 'public', ['knowledge-package'], HIDDEN);
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
          const who = req.headers['x-test-as'];
          if (who === 'agent') req.auth = agentAuth as never;
          if (who === 'owner') req.auth = ownerAuth as never;
          next();
        });
        app.use(knowledgeRouter(config, storage));
        server = http.createServer(app);
        await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      });
      afterEach(async () => { await new Promise<void>(r => server.close(() => r())); });
      const req = (method: string, path: string, as: string, body?: unknown) => fetch(`${base}${path}`, {
        method, headers: { 'x-test-as': as, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
      });

      it('GET /v1/knowledge/:id answers 404 to an AI for a hidden manifest and 200 to the person', async () => {
        expect((await req('GET', '/v1/knowledge/pc', 'agent')).status).toBe(404);
        expect((await req('GET', '/v1/knowledge/pc', 'owner')).status).toBe(200);
        expect((await req('GET', '/v1/knowledge/pb', 'agent')).status).toBe(200);
      });

      it('export leaves a hidden entry out of entry_data and the entry list, for the AI only', async () => {
        const ai = await (await req('GET', '/v1/knowledge/pb/export', 'agent')).json() as { entry_data: Record<string, unknown>; package: { entries: Array<{ key: string }> } };
        expect(Object.keys(ai.entry_data)).toEqual(['e-plain']);
        expect(ai.package.entries.map(e => e.key)).toEqual(['packages/pb/e-plain']);
        const person = await (await req('GET', '/v1/knowledge/pb/export', 'owner')).json() as { entry_data: Record<string, unknown> };
        expect(Object.keys(person.entry_data).sort()).toEqual(['e-plain', 'e-secret']);
        expect((await req('GET', '/v1/knowledge/pc/export', 'agent')).status).toBe(404);
      });

      it('clone copies only what the requester may see', async () => {
        const res = await req('POST', '/v1/knowledge/pb/clone', 'agent', {});
        expect(res.status).toBe(201);
        const body = await res.json() as { data: { entries_cloned: number; cloned_package_id: string } };
        expect(body.data.entries_cloned).toBe(1);
        const copied = await storage.listMemory(AGENT, { prefix: `packages/${body.data.cloned_package_id}/` });
        expect(copied.map(r => r.value)).not.toContain('secret value');
        expect((await req('POST', '/v1/knowledge/pc/clone', 'agent', {})).status).toBe(404);
      });
    });
  });
});
