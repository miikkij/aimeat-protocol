/**
 * @file test/unit/boot-migration-races.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The once-only boot steps of server-bootstrap/service-init.ts against two node processes
 *   that start together, on both real providers. Two calls of a step at the same moment stand for the
 *   two processes: exactly one runs it. Two steps that write one agent's, ecosystem app's or app
 *   grant's scope list at the same moment both keep their words. A write that lands after a step read
 *   a record (the boot runs these beside live traffic) is kept.
 *
 *   No route reaches these functions; they run at boot. On SQLite the two calls interleave at every
 *   await, so most of these are red there too; on PostgreSQL every read and write is a real round trip.
 * @usage cd aimeat && pnpm exec vitest run test/unit/boot-migration-races.test.ts
 *   cd aimeat && node --env-file=.env.test.postgres-kysely --import tsx node_modules/vitest/vitest.mjs run test/unit/boot-migration-races.test.ts
 * @version-history
 *   v1.1.0 — 2026-10-29 — The keep-working step is asserted per half: of two processes one may claim the
 *     principals' half and the other the apps' half, so both answered ran and CI on main went red
 *     (run 40938881139, "expected 2 to be 1"). The setup no longer matched what the step promises.
 *   v1.0.0 — 2026-10-18 — Initial (check:atomic-writes, the boot migration sites).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { migrateRestScopeGatesOnce, migrateAgentReadGrantOnce } from '../../src/services/rest-scope-gates-migration.js';
import { migrateRestScopeKeepWorkingOnce } from '../../src/services/rest-scope-keep-working-migration.js';
import { migrateScopeVocabulary, migrateAppGrantScopeVocabulary } from '../../src/services/scope-vocabulary-migration.js';
import { migrateToolScopeWordsOnce } from '../../src/services/tool-scope-words-migration.js';
import { migrateOperatorAdminOnce } from '../../src/services/operator-admin-migration.js';
import { migrateBasicAgentsTaskStartOnce, grantPurgeToAppGrantsOnce } from '../../src/services/task-start-migrations.js';
import { migrateImplicitFreeModelOnce } from '../../src/services/openrouter-settings-migration.js';
import { migrateAppToolsKeysOnce } from '../../src/services/app-tools-key.js';
import { noticeFailingComponents } from '../../src/services/design-book/component-notice.js';
import { partKey } from '../../src/services/design-book/service.js';
import { IMPLICIT_FREE_MODEL } from '../../src/services/ai-model-defaults.js';

requirePostgresWhenAsked('boot-migration-races');

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])] as const;
const providers = new Map<string, TestStorage>();
const RUN = randomUUID().slice(0, 8);
// Before every cutoff the steps read: the vocabulary (2026-08-10), the tool words (2026-10-06), a boot now.
const OLD = '2026-08-01T00:00:00.000Z';

beforeAll(async () => {
  for (const name of names) providers.set(name, await createStorage({
    provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely',
    sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
  }) as TestStorage);
}, 60_000);

const made: Array<{ storage: Storage; agents: string[]; owners: string[]; apps: string[] }> = [];
afterAll(async () => {
  for (const m of made) {
    for (const gaii of m.agents) await m.storage.deleteAgent(gaii).catch(() => false);
    for (const geai of m.apps) await m.storage.deleteEcosystemApp(geai).catch(() => false);
    for (const owner of m.owners) await m.storage.deleteOwner(owner).catch(() => false);
  }
  for (const storage of providers.values()) await storage.close();
});

let seq = 0;
/** A world of its own: a node id no other test's markers use, and owners named for this run. */
function world(storage: Storage) {
  const n = ++seq;
  const nodeId = `boot-race-${RUN}-${n}`;
  const config = { ...loadConfig().config, nodeId, baseUrl: 'https://node.test' } as AimeatConfig;
  const track = { storage, agents: [] as string[], owners: [] as string[], apps: [] as string[] };
  made.push(track);
  return {
    nodeId, config,
    async owner(tag: string, roles: string[] = ['owner']): Promise<string> {
      const name = `br${RUN}${n}${tag}`;
      await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles, createdAt: OLD } as never);
      track.owners.push(name);
      return name;
    },
    async agent(owner: string, name: string, scopes: string[], extra: Record<string, unknown> = {}): Promise<string> {
      const gaii = `${name}#${owner}@${nodeId}`;
      await storage.createAgent({
        name, owner, gaii, publicKey: 'pk', trustScore: 50, morselBalance: 0, capabilities: [],
        defaultScopes: scopes, createdAt: OLD, lastSeen: OLD, ...extra,
      } as never);
      track.agents.push(gaii);
      return gaii;
    },
    async ecoApp(owner: string, app: string, scopes: string[]): Promise<string> {
      const geai = `eco:${app}#${owner}@${nodeId}`;
      await storage.createEcosystemApp({
        app, owner, geai, publicKey: 'pk', scopes, status: 'active', morselBalance: 0, createdAt: OLD, updatedAt: OLD, lastSeen: OLD,
      } as never);
      track.apps.push(geai);
      return geai;
    },
    async grant(owner: string, scopes: string[]): Promise<string> {
      const grantId = `grant-${RUN}-${n}-${randomUUID().slice(0, 6)}`;
      await storage.createAppGrant({
        grantId, app: `${owner}/notes.html`, appName: 'Notes', appOrigin: 'https://notes.node.test', owner,
        gaii: `${owner}@${nodeId}`, scopes, refreshTokenHash: null, createdAt: OLD, lastUsedAt: null, revoked: false,
      });
      return grantId;
    },
  };
}

function record(owner: string, key: string, value: Record<string, unknown>, version = 1, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = new Date().toISOString();
  return { key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version, createdAt: now, updatedAt: now, ...extra };
}

const ran = (results: Array<{ ran: boolean }>) => results.filter(r => r.ran).length;

describe.each(names)('%s: once-only boot steps beside a second node process', name => {
  const storage = () => providers.get(name)!;

  it('two processes starting together run each scope step once', async () => {
    const s = storage();
    const w = world(s);
    const owner = await w.owner('o', ['owner', 'operator']);
    await w.agent(owner, 'reader', ['memory:read']);
    await w.agent(owner, 'full', ['*']);
    await w.ecoApp(owner, 'radio', ['memory:write']);

    expect(ran(await Promise.all([migrateRestScopeGatesOnce(s, w.nodeId), migrateRestScopeGatesOnce(s, w.nodeId)]))).toBe(1);
    expect(ran(await Promise.all([migrateAgentReadGrantOnce(s, w.nodeId), migrateAgentReadGrantOnce(s, w.nodeId)]))).toBe(1);
    expect(ran(await Promise.all([migrateToolScopeWordsOnce(s, w.nodeId), migrateToolScopeWordsOnce(s, w.nodeId)]))).toBe(1);
    expect(ran(await Promise.all([migrateOperatorAdminOnce(s, w.config), migrateOperatorAdminOnce(s, w.config)]))).toBe(1);
    const keep = { version: '4.0.3', existedBefore: new Date().toISOString() };
    // Two halves, each claimed on its own record: each runs once, in either process.
    const kept = await Promise.all([
      migrateRestScopeKeepWorkingOnce(s, w.config, keep), migrateRestScopeKeepWorkingOnce(s, w.config, keep),
    ]);
    expect(kept.flatMap(r => r.halves).sort()).toEqual(['apps', 'principals']);
    // The vocabulary's agent half answers how many agents it widened; the process that stands down widens none.
    const [a, b] = await Promise.all([migrateScopeVocabulary(s, w.nodeId), migrateScopeVocabulary(s, w.nodeId)]);
    expect(Math.max(a.agents, b.agents)).toBeGreaterThan(0);
    expect(Math.min(a.agents, b.agents)).toBe(0);
  }, 60_000);

  it('two processes starting together run each settings, agent and app step once', async () => {
    const s = storage();
    const w = world(s);
    const owner = await w.owner('o');
    await w.agent(owner, 'concierge', ['memory:read'], { tags: ['crew.basic'] });
    await w.grant(owner, ['memory:delete']);
    await s.setMemory(record(`${owner}@${w.nodeId}`, 'openrouter.settings', { model: IMPLICIT_FREE_MODEL, provider: 'openrouter' }));

    expect(ran(await Promise.all([migrateBasicAgentsTaskStartOnce(s, w.config), migrateBasicAgentsTaskStartOnce(s, w.config)]))).toBe(1);
    expect(ran(await Promise.all([grantPurgeToAppGrantsOnce(s, w.nodeId), grantPurgeToAppGrantsOnce(s, w.nodeId)]))).toBe(1);
    expect(ran(await Promise.all([migrateImplicitFreeModelOnce(s, w.nodeId), migrateImplicitFreeModelOnce(s, w.nodeId)]))).toBe(1);
    expect(ran(await Promise.all([migrateAppToolsKeysOnce(s, w.config), migrateAppToolsKeysOnce(s, w.config)]))).toBe(1);
  }, 60_000);

  it('a step that fails leaves no record, so the next start runs it again', async () => {
    const s = storage();
    const w = world(s);
    const owner = await w.owner('o');
    await w.agent(owner, 'reader', ['memory:read']);
    const spy = vi.spyOn(s, 'updateAgent').mockRejectedValueOnce(new Error('database went away'));
    const swap = (s as { setAgentScopesIf?: unknown }).setAgentScopesIf
      ? vi.spyOn(s as Storage & { setAgentScopesIf: Storage['updateAgent'] }, 'setAgentScopesIf').mockRejectedValueOnce(new Error('database went away'))
      : null;
    await expect(migrateToolScopeWordsOnce(s, w.nodeId)).rejects.toThrow(/database went away/);
    spy.mockRestore(); swap?.mockRestore();
    expect(await s.getMemory(`system@${w.nodeId}`, 'migrations.tool-scope-words-2026-10')).toBeNull();
    expect((await migrateToolScopeWordsOnce(s, w.nodeId)).ran).toBe(true);
  }, 60_000);
});

describe.each(names)('%s: two steps writing one scope list at the same moment', name => {
  const storage = () => providers.get(name)!;

  it('an agent keeps the words of both steps', async () => {
    const s = storage();
    const w = world(s);
    const owner = await w.owner('o');
    const gaii = await w.agent(owner, 'reader', ['memory:read']);
    await Promise.all([migrateRestScopeGatesOnce(s, w.nodeId), migrateAgentReadGrantOnce(s, w.nodeId)]);
    expect((await s.getAgent(gaii))?.defaultScopes).toEqual(expect.arrayContaining(['memory:read', 'packages:read', 'agent:read']));

    const w2 = world(s);
    const owner2 = await w2.owner('o');
    const gaii2 = await w2.agent(owner2, 'reader', ['memory:read']);
    await Promise.all([migrateToolScopeWordsOnce(s, w2.nodeId), migrateRestScopeGatesOnce(s, w2.nodeId)]);
    expect((await s.getAgent(gaii2))?.defaultScopes).toEqual(expect.arrayContaining(['memory:read', 'organism:read', 'packages:read']));
  }, 60_000);

  it('an operator\'s full-access agent keeps the vocabulary words and operator:admin', async () => {
    const s = storage();
    const w = world(s);
    const owner = await w.owner('o', ['owner', 'operator']);
    const gaii = await w.agent(owner, 'full', ['*']);
    await Promise.all([migrateScopeVocabulary(s, w.nodeId), migrateOperatorAdminOnce(s, w.config)]);
    expect((await s.getAgent(gaii))?.defaultScopes).toEqual(expect.arrayContaining(['*', 'operator:admin', 'exchange:beneficiary']));
  }, 60_000);

  it('an ecosystem app keeps the words of both steps', async () => {
    const s = storage();
    const w = world(s);
    const owner = await w.owner('o');
    const geai = await w.ecoApp(owner, 'radio', ['memory:write']);
    await Promise.all([migrateRestScopeGatesOnce(s, w.nodeId), migrateAgentReadGrantOnce(s, w.nodeId)]);
    expect((await s.getEcosystemApp(geai))?.scopes).toEqual(expect.arrayContaining(['memory:write', 'packages:read', 'agent:read']));
  }, 60_000);

  it('an app grant keeps the words of both steps', async () => {
    const s = storage();
    const w = world(s);
    const owner = await w.owner('o');
    const grantId = await w.grant(owner, ['memory:delete']);
    await Promise.all([migrateAppGrantScopeVocabulary(s), grantPurgeToAppGrantsOnce(s, w.nodeId)]);
    expect((await s.getAppGrant(grantId))?.scopes).toEqual(expect.arrayContaining(['memory:delete', 'memory:purge', 'app:write']));
  }, 60_000);
});

describe.each(names)('%s: a write that lands after a step read the record', name => {
  const storage = () => providers.get(name)!;

  it('an agent keeps the word its owner added while the step ran', async () => {
    const s = storage();
    const w = world(s);
    const owner = await w.owner('o');
    const gaii = await w.agent(owner, 'reader', ['memory:read']);
    const listAgents = s.listAgents.bind(s);
    const spy = vi.spyOn(s, 'listAgents').mockImplementationOnce(async () => {
      const listed = await listAgents();
      await s.updateAgent(gaii, { defaultScopes: ['memory:read', 'wallet:read'] });
      return listed;
    });
    await migrateToolScopeWordsOnce(s, w.nodeId);
    spy.mockRestore();
    expect((await s.getAgent(gaii))?.defaultScopes).toEqual(expect.arrayContaining(['memory:read', 'wallet:read', 'organism:read']));
  }, 60_000);

  it('an owner\'s AI settings saved while the step ran are kept', async () => {
    const s = storage();
    const w = world(s);
    const owner = `${await w.owner('o')}@${w.nodeId}`;
    await s.setMemory(record(owner, 'openrouter.settings', { model: IMPLICIT_FREE_MODEL, provider: 'openrouter' }, 2));
    const getMemory = s.getMemory.bind(s);
    const spy = vi.spyOn(s, 'getMemory').mockImplementation(async (who, key) => {
      const rec = await getMemory(who, key);
      if (who === owner && key === 'openrouter.settings' && rec && (rec.value as { model?: string }).model === IMPLICIT_FREE_MODEL) {
        await s.setMemory({ ...rec, value: { model: 'acme/chosen', modelChosen: true, dailyBudget: 5 }, version: rec.version + 1 });
      }
      return rec;
    });
    await migrateImplicitFreeModelOnce(s, w.nodeId);
    spy.mockRestore();
    expect((await s.getMemory(owner, 'openrouter.settings'))?.value).toEqual({ model: 'acme/chosen', modelChosen: true, dailyBudget: 5 });
  }, 60_000);

  it('a tool manifest published under the filename while the step ran is kept', async () => {
    const s = storage();
    const w = world(s);
    const ownerName = await w.owner('o');
    const owner = `${ownerName}@${w.nodeId}`;
    await s.createApp({
      ownerGaii: owner, ownerName, filename: 'slop.html', versionNumber: 1,
      manifest: { name: 'slop.html', description: 'fixture', version: '1', category: 'tool', tags: [], authorDisplay: ownerName, usesCortex: [] },
      mimeType: 'text/html', size: 4, data: Buffer.from('test'), createdAt: new Date().toISOString(),
    });
    await s.setMemory(record(owner, 'apps.slop.tools', { version: 1, tools: [{ name: 'old' }] }, 3, { visibility: 'public', tags: ['app-tools'] }));
    const getMemory = s.getMemory.bind(s);
    let published = false;
    const spy = vi.spyOn(s, 'getMemory').mockImplementation(async (who, key) => {
      const rec = await getMemory(who, key);
      if (!published && who === owner && key === 'apps.slop.html.tools' && !rec) {
        published = true;
        await s.setMemory(record(owner, key, { version: 1, tools: [{ name: 'published-now' }] }, 1, { visibility: 'public', tags: ['app-tools'] }));
      }
      return rec;
    });
    await migrateAppToolsKeysOnce(s, w.config);
    spy.mockRestore();
    const tools = (await s.getMemory(owner, 'apps.slop.html.tools'))?.value as { tools: Array<{ name: string }> };
    expect(tools.tools.map(t => t.name)).toEqual(['published-now']);
  }, 60_000);
});

describe.each(names)('%s: the Design Book bench notice', name => {
  const storage = () => providers.get(name)!;

  it('two rounds at the same moment tell the proposer once', async () => {
    const s = storage();
    const w = world(s);
    const ownerName = await w.owner('o');
    const owner = `${ownerName}@${w.nodeId}`;
    const system = `system@${w.nodeId}`;
    const id = `comp-race-${RUN}`;
    const now = new Date().toISOString();
    const body = {
      prefix: 'wkgrid',
      html: '<div class="wkgrid" role="grid"><button class="wkgrid-cell" type="button" data-day="mon"></button></div>',
      // `.wkgrid ~ p` reaches the page beside the component, so the bench refuses it.
      css: '.wkgrid { display: grid; color: var(--ak-ink); }\n.wkgrid ~ p { color: var(--ak-accent); }',
      use: 'One cell per day.', judgement: { reach: 'general', why: 'Any app where a person ticks days.' },
    };
    await s.setMemory({
      key: partKey(id), ownerGaii: system,
      value: JSON.stringify({
        spec: 'aimeat.designbook.part/v1', id, kind: 'component', title: 'A week', summary: 'Days.', body, tags: [], status: 'published',
        proposed_by: `claude#${ownerName}@${w.nodeId}`, proposed_by_owner: owner, bench: { checks: [], passed_at: now },
        created_at: now, updated_at: now, published_at: now,
      }),
      visibility: 'public', tags: ['designbook', 'kind:component', 'status:published'], ttlHours: null,
      version: 1, createdAt: now, updatedAt: now,
    });
    const [a, b] = await Promise.all([noticeFailingComponents(s, w.config), noticeFailingComponents(s, w.config)]);
    await s.deleteMemory(system, partKey(id), system);
    expect(a.noticed + b.noticed).toBe(1);
    const bell = (await s.listMemory(owner, { prefix: 'notif.' })).filter(r => JSON.stringify(r.value).includes(id));
    expect(bell).toHaveLength(1);
  }, 60_000);
});
