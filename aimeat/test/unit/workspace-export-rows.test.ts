/**
 * @file test/unit/workspace-export-rows.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A workspace export carries the rows of its row spaces and the import restores them;
 *   a limit the export reached is named in `truncated`. Until 2026-10-15 the export read memory keys
 *   only, so a row space came back empty without a word, and an export that stopped at 10 000
 *   records said nothing (feature-list audit #68). Driven against in-memory SQLite with a reader
 *   that shows and lets out everything.
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-export-rows.test.ts
 * @version-history
 *   2026-10-16 — A workspace past one read page (10 050 records, the manifest at the end of key order) is exported whole (QA audit F06c-01).
 *   2026-10-15 — Initial (feature-list audit #68).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { collectWorkspace, EXPORT_RECORD_LIMIT } from '../../src/services/workspace-export.js';
import { restoreWorkspace } from '../../src/services/workspace-import.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, OrganismRecord, OrganismMembershipRecord, WorkspaceRowRecord } from '../../src/storage/interface.js';
import type { ContentReader } from '../../src/services/classification/reader.js';

const NODE = 'test-node';
const ALICE = `alice@${NODE}`;
const ORG = 'org-rows';
const WS = 'ws-src';
const ROOT = `organism.${ORG}.w.${WS}`;
const at = new Date().toISOString();
const baseConfig = { nodeId: NODE, classificationMode: 'off', wsRowsMaxPerWorkspace: 50000, wsRowsQuotaMb: 100, wsRowsMaxRowKb: 64 } as unknown as AimeatConfig;
const MANIFEST = {
  manifestVersion: '1', name: 'Mail', kind: 'project',
  objectTypes: [
    { name: 'note', namespace: 'notes', mode: 'records', backing: 'memory' },
    { name: 'mail', namespace: 'crm.mail', mode: 'records', backing: 'rows', indexOn: ['from'] },
  ],
};

const passReader = {
  kind: 'human', identity: ALICE, principal: ALICE, auth: null, warnings: [],
  async show<T>(items: readonly T[]) { return [...items]; },
  async useForAi() { /* not used */ },
  async leave<T>(items: readonly T[]) { return { kept: [...items], left: [] }; },
} as unknown as ContentReader;

describe('the row spaces in a workspace export and import', () => {
  let storage: InstanceType<typeof SqliteStorage>;

  const put = (key: string, value: unknown) => storage.setMemory({
    key, ownerGaii: ALICE, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: at, updatedAt: at,
  });
  const row = (rowId: string, from: string): WorkspaceRowRecord => ({
    id: `sur-${rowId}`, organismId: ORG, wsId: WS, namespace: 'crm.mail', rowId, k1: from, k2: '', k3: '',
    occurredAt: '2026-10-01T08:00:00.000Z', createdAt: at, updatedAt: at, createdBy: ALICE, body: { from, subject: `s-${rowId}` }, bytes: 40,
  });

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await storage.createOrganism({
      id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: 'alice', admins: ['alice'],
      members: ['alice'], agentGaiis: [], boardId: 'b1', joinPolicy: 'open', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: true, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: `organism.${ORG}`, createdAt: at, updatedAt: at,
    } as OrganismRecord);
    await storage.createMembership({ id: 'm1', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: at } as OrganismMembershipRecord);
    await put(`organism.${ORG}.meta.workspaces`, { workspaces: [{ id: WS, name: 'Mail', createdBy: 'alice' }] });
    await put(`${ROOT}.meta.manifest`, MANIFEST);
    await put(`${ROOT}.notes.n1.latest`, { title: 'A note' });
    await storage.appendWorkspaceRows([row('r1', 'ann@x'), row('r2', 'bob@x'), row('r3', 'cid@x')]);
  });
  afterEach(() => { storage.close(); });

  const collect = (config = baseConfig, s: Storage = storage as unknown as Storage) =>
    collectWorkspace(s, config, { orgId: ORG, ws: WS, exporterGaii: ALICE, callerSub: ALICE, exportedAt: at, isOrgManager: true, reader: passReader });

  /** The importer's own facts: the owner in person, so the restore's write rules change nothing here. */
  const IMPORTER = { principal: ALICE, targetGaii: ALICE, owner: 'alice', roles: ['owner'], scopes: ['*'] };

  it('the export carries every row of the row space, and truncated is empty', async () => {
    const { json } = await collect();
    expect(json.rows?.map((r) => r.rowId).sort()).toEqual(['r1', 'r2', 'r3']);
    expect(json.rows?.[0]).toMatchObject({ namespace: 'crm.mail', occurredAt: '2026-10-01T08:00:00.000Z' });
    expect(json.truncated).toEqual([]);
  });

  it('the import restores the rows into the new workspace, with their ids, bodies and index column', async () => {
    const { json } = await collect();
    const result = await restoreWorkspace(storage as unknown as Storage, baseConfig, { orgId: ORG, importerGaii: ALICE, importerOwner: 'alice', caller: IMPORTER, data: json, images: new Map() });
    expect(result.rows).toBe(3);
    const page = await storage.listWorkspaceRows({ organismId: ORG, wsId: result.ws, namespace: 'crm.mail', order: 'asc' });
    expect(page.rows.map((r) => r.rowId).sort()).toEqual(['r1', 'r2', 'r3']);
    const r2 = page.rows.find((r) => r.rowId === 'r2')!;
    expect(r2.body).toEqual({ from: 'bob@x', subject: 's-r2' });
    expect(r2.k1).toBe('bob@x');
    expect(r2.occurredAt).toBe('2026-10-01T08:00:00.000Z');
  });

  it('an import whose rows do not fit the workspace row quota is refused before anything is written', async () => {
    const { json } = await collect();
    const tight = { ...baseConfig, wsRowsMaxPerWorkspace: 2 } as AimeatConfig;
    const before = (await storage.listAllMemory({ prefix: `organism.${ORG}.w.`, limit: 1000 })).items.length;
    await expect(restoreWorkspace(storage as unknown as Storage, tight, { orgId: ORG, importerGaii: ALICE, importerOwner: 'alice', caller: IMPORTER, data: json, images: new Map() }))
      .rejects.toThrow(/limit is 2/);
    expect((await storage.listAllMemory({ prefix: `organism.${ORG}.w.`, limit: 1000 })).items.length).toBe(before);
  });

  it('a row limit the export reached is named in truncated', async () => {
    const { json } = await collect({ ...baseConfig, wsRowsMaxPerWorkspace: 2 } as AimeatConfig);
    expect(json.rows).toHaveLength(2);
    expect(json.truncated).toEqual([{ what: 'rows', namespace: 'crm.mail', exported: 2, total: 3 }]);
  });

  it('the memory record limit the export reached is named in truncated', async () => {
    // The store reports more records under the workspace than the export reads.
    const over = new Proxy(storage as unknown as Storage, {
      get(target, prop, recv) {
        if (prop === 'listAllMemory') {
          return async (opts: { prefix?: string; limit?: number }) => {
            const out = await target.listAllMemory(opts);
            return opts.prefix === `${ROOT}.` ? { ...out, total: EXPORT_RECORD_LIMIT + 5 } : out;
          };
        }
        const v = Reflect.get(target, prop, recv);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const { json } = await collect(baseConfig, over);
    expect(json.truncated).toContainEqual({ what: 'records', exported: 2, total: EXPORT_RECORD_LIMIT + 5 });
  });

  // QA audit F06c-01. The export read ONE window of 10 000 records in key order. Records in a namespace
  // that sorts before `meta.` (here `alerts.`) pushed the workspace's own manifest out of it, and the
  // rest of the tail went with it, in a 200 answer.
  it('a workspace larger than one read page is exported whole, its manifest included', async () => {
    const N = 10_050;
    const rows = Array.from({ length: N }, (_, i) => ({
      key: `${ROOT}.alerts.a${String(i).padStart(6, '0')}.latest`, ownerGaii: ALICE, value: { n: i },
      visibility: 'private' as const, tags: [], ttlHours: null, version: 1, createdAt: at, updatedAt: at,
    }));
    await storage.bulkSetMemory!(rows);
    const { json } = await collect();
    expect(json.manifest).toEqual(MANIFEST);
    expect(json.objects.filter(o => o.namespace === 'alerts')).toHaveLength(N);
    expect(json.objects.filter(o => o.namespace === 'notes')).toHaveLength(1);
    expect(json.truncated).toEqual([]);
  }, 60_000);
});
