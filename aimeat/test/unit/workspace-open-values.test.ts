/**
 * @file test/unit/workspace-open-values.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A workspace batch-open reads the values of the records it opens, not of the whole
 *   workspace, and a read past the 5 000-row window says so (codebase analysis 2026-11-03, item C7).
 *   - loadWorkspaceContent with valuesOnDemand gives the same rows, in the same order, through the
 *     same reader decisions and warnings as the full load, and `hydrate` gives back the full rows;
 *   - readWorkspaceOp with ids lists no value of the workspace and reads only the opened records,
 *     and answers what the stored records hold (latest, draft, versions, the warning);
 *   - both modes answer `truncated: true` past the window, and nothing extra below it.
 * @structure fixture (classification-reads-review.test.ts) · cases
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-open-values.test.ts
 * @version-history
 *   2026-11-04 — Initial (codebase analysis 2026-11-03, item C7).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { MemoryRecord, OrganismRecord, OrganismMembershipRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { memoryTarget, setLabel, type LabelActor } from '../../src/services/classification/labels.js';
import { readerFor, readerForAgent } from '../../src/services/classification/reader.js';
import { resetClassificationAudit, pendingClassificationAudit } from '../../src/services/classification/audit.js';
import { loadWorkspaceContent } from '../../src/services/workspace/content.js';
import { readWorkspaceOp } from '../../src/services/workspace/tool-ops.js';
import { hideFromAiOnNode } from './classification-fixtures.js';

const N = 'n';
const ALICE = `alice@${N}`;
const BOB = `bob@${N}`;
const AGENT = `claude#${ALICE}`;
const ORG = 'o1';
const ROOT = `organism.${ORG}.w.ws1`;
const WARN = 'luottamuksellinen';
const HIDDEN = 'erittain-luottamuksellinen';
const stamp = '2026-09-29T12:00:00.000Z';
const alice: LabelActor = { principal: ALICE, ownerGhii: ALICE, ownerName: 'alice', kind: 'human' };
const ownerAuth = { sub: 'alice', owner: 'alice', roles: ['owner'] };

function mem(ownerGaii: string, key: string, value: unknown, at = stamp, version = 1): MemoryRecord {
  return { key, ownerGaii, value, visibility: 'private', tags: [], ttlHours: null, version, createdAt: at, updatedAt: at };
}

describe('workspace batch-open reads only what it opens (C7)', () => {
  let storage: SqliteStorage;
  let config: AimeatConfig;
  const deps = () => ({ storage, config });
  const caller = { principal: AGENT, ownerName: 'alice', ownerGhii: ALICE, writerGaii: AGENT, roles: ['agent'] };

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: N, classificationMode: 'all', consentEnabled: true };
    resetClassificationAudit();
    await hideFromAiOnNode(storage, N, [HIDDEN]);
    for (const name of ['alice', 'bob']) {
      await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: stamp });
      await storage.createGHII({ username: name, nodeId: N, ghii: `${name}@${N}`, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: stamp, updatedAt: stamp } as never);
    }
    await storage.createAgent({ name: 'claude', owner: 'alice', gaii: AGENT, capabilities: [], publicKey: 'pk', trustScore: 50, morselBalance: 0, createdAt: stamp, lastSeen: stamp } as never);
    await storage.createOrganism({
      id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: ALICE, createdBy: ALICE, owners: [ALICE],
      admins: [ALICE], members: [ALICE, BOB], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: `organism.${ORG}`, createdAt: stamp, updatedAt: stamp,
    } as OrganismRecord);
    await storage.createMembership({ id: 'm-alice', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: stamp } as OrganismMembershipRecord);
    await storage.createMembership({ id: 'm-bob', organismId: ORG, ghii: 'bob', role: 'member', status: 'active', joinedAt: stamp } as OrganismMembershipRecord);
    await storage.setMemory(mem(ALICE, `organism.${ORG}.meta.workspaces`, { workspaces: [{ id: 'ws1', name: 'Board', createdAt: stamp, createdBy: 'alice' }] }));
    await storage.setMemory(mem(ALICE, `${ROOT}.meta.manifest`, {
      manifestVersion: '1', name: 'Board', kind: 'project',
      objectTypes: [{ name: 'note', namespace: 'notes', mode: 'records' }, { name: 'page', namespace: 'pages', mode: 'document' }],
    }));
    await storage.setMemory(mem(ALICE, `${ROOT}.meta.readme`, '# Board'));
    await storage.setMemory(mem(ALICE, `${ROOT}.notes.a.latest`, { title: 'Warned note' }));
    await storage.setMemory(mem(ALICE, `${ROOT}.notes.b.latest`, { title: 'Plain note' }));
    await storage.setMemory(mem(ALICE, `${ROOT}.notes.b.draft`, { title: 'Plain note, edited' }));
    await storage.setMemory(mem(ALICE, `${ROOT}.notes.c.draft`, { title: 'Draft only' }));
    // Two owners' copies of one record: the fresher wins.
    await storage.setMemory(mem(ALICE, `${ROOT}.pages.p.latest`, { title: 'Old copy' }, stamp, 1));
    await storage.setMemory(mem(BOB, `${ROOT}.pages.p.latest`, { title: 'New copy' }, '2026-09-30T12:00:00.000Z', 1));
    await storage.setMemory(mem(ALICE, `${ROOT}.pages.hid.latest`, { title: 'Hidden from AI' }));
    await setLabel(deps(), alice, memoryTarget(ALICE, `${ROOT}.notes.a.latest`), { label: WARN });
    await setLabel(deps(), alice, memoryTarget(ALICE, `${ROOT}.pages.hid.latest`), { label: HIDDEN });
  });
  afterEach(() => { storage.close(); vi.restoreAllMocks(); resetClassificationAudit(); });

  for (const [who, reader] of [['an AI', () => readerForAgent(deps(), AGENT)], ['the person', () => readerFor(deps(), ownerAuth)]] as const) {
    it(`the loader gives ${who} the same rows, decisions and warnings with values on demand`, async () => {
      const w = { sub: AGENT, ownerName: 'alice', accessorGaii: ALICE };
      // The labelling in the fixture wrote audit rows of its own.
      resetClassificationAudit();
      const eagerReader = reader();
      const eager = await loadWorkspaceContent(deps(), eagerReader, w, { organismId: ORG, ws: 'ws1' });
      const eagerAudit = pendingClassificationAudit().map(a => [a.key, a.action, a.purpose]);
      resetClassificationAudit();
      const lazyReader = reader();
      const lazy = await loadWorkspaceContent(deps(), lazyReader, w, { organismId: ORG, ws: 'ws1', valuesOnDemand: true });
      expect(eager.ok && lazy.ok).toBe(true);
      if (!eager.ok || !lazy.ok) return;
      expect(lazy.items.map(r => [r.ownerGaii, r.key, r.version, r.updatedAt])).toEqual(eager.items.map(r => [r.ownerGaii, r.key, r.version, r.updatedAt]));
      expect(lazy.items.every(r => r.value === undefined)).toBe(true);
      expect(await lazy.hydrate(lazy.items)).toEqual(eager.items);
      expect(lazy.manRec).toEqual(eager.manRec);
      expect(lazy.descriptor).toEqual(eager.descriptor);
      expect(lazyReader.warnings).toEqual(eagerReader.warnings);
      expect(pendingClassificationAudit().map(a => [a.key, a.action, a.purpose])).toEqual(eagerAudit);
      expect(lazy.truncated).toBe(false);
      expect(eager.truncated).toBe(false);
    });
  }

  it('an open lists no value of the workspace and reads only the records it opens', async () => {
    const listAll = vi.spyOn(storage, 'listAllMemory');
    const byKeys = vi.spyOn(storage, 'getMemoryByKeys');
    const r = await readWorkspaceOp(deps(), caller, { organismId: ORG, ws: 'ws1', ids: ['b', `${ROOT}.pages.p`, 'nope', 'hid'], reader: readerForAgent(deps(), AGENT) });
    expect(r.ok).toBe(true);
    expect(listAll.mock.calls.filter(([o]) => (o?.prefix ?? '').startsWith(`organism.${ORG}.w.ws1.`))).toEqual([]);
    const opened = byKeys.mock.calls.flatMap(([, keys]) => keys).sort();
    expect(opened).toEqual([`${ROOT}.meta.manifest`, `${ROOT}.meta.readme`, `${ROOT}.notes.b.draft`, `${ROOT}.notes.b.latest`, `${ROOT}.pages.p.latest`].sort());
    const data = (r as { data: { items: Array<Record<string, unknown>>; missing?: string[]; truncated?: boolean } }).data;
    const b = await storage.getMemory(ALICE, `${ROOT}.notes.b.latest`);
    const bd = await storage.getMemory(ALICE, `${ROOT}.notes.b.draft`);
    const p = await storage.getMemory(BOB, `${ROOT}.pages.p.latest`);
    expect(data.items).toEqual([
      { space: 'note', id: 'b', value: b!.value, published: true, _version: b!.version, _createdAt: b!.createdAt, _updatedAt: b!.updatedAt, draft: bd!.value, _draftVersion: bd!.version },
      { space: 'page', id: 'p', value: p!.value, published: true, _version: p!.version, _createdAt: p!.createdAt, _updatedAt: p!.updatedAt },
    ]);
    // The record hidden from an AI is not in the read at all, as before.
    expect(data.missing).toEqual(['nope', 'hid']);
    expect(data.truncated).toBeUndefined();
  });

  it('the open carries the warning of a warned record and the whole read\'s warnings', async () => {
    const reader = readerForAgent(deps(), AGENT);
    const r = await readWorkspaceOp(deps(), caller, { organismId: ORG, ws: 'ws1', ids: ['c'], reader });
    const data = (r as { data: { items: Array<Record<string, unknown>>; classification_warnings?: unknown[] } }).data;
    expect(data.items).toEqual([expect.objectContaining({ id: 'c', value: { title: 'Draft only' }, published: false, draft: { title: 'Draft only' } })]);
    // The warnings name what the read showed, the warned record included, as the full load did.
    expect(data.classification_warnings).toEqual([{ key: `${ROOT}.notes.a`, label: WARN, name: 'Confidential' }]);
    const a = await readWorkspaceOp(deps(), caller, { organismId: ORG, ws: 'ws1', ids: ['a'], reader: readerForAgent(deps(), AGENT) });
    expect((a as { data: { items: Array<Record<string, unknown>> } }).data.items[0]?.classification_warning).toEqual(expect.objectContaining({ label: WARN }));
  });

  it('says truncated past the 5 000-row window, in the index and in an open', async () => {
    await storage.transaction(async () => {
      for (let i = 0; i < 5000; i++) await storage.setMemory(mem(ALICE, `${ROOT}.notes.n${String(i).padStart(4, '0')}.latest`, { title: `n${i}` }));
    });
    const index = await readWorkspaceOp(deps(), caller, { organismId: ORG, ws: 'ws1', reader: readerFor(deps(), ownerAuth) });
    expect((index as { data: { truncated?: boolean } }).data.truncated).toBe(true);
    const open = await readWorkspaceOp(deps(), caller, { organismId: ORG, ws: 'ws1', ids: ['n0001'], reader: readerFor(deps(), ownerAuth) });
    expect((open as { data: { truncated?: boolean; items: unknown[] } }).data).toEqual(expect.objectContaining({ truncated: true, items: [expect.objectContaining({ id: 'n0001' })] }));
  }, 60_000);
});
