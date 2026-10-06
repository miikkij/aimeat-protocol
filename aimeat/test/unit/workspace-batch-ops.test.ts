/**
 * @file workspace-batch-ops.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description publishRecordsBatchOp and deleteRecordsBatchOp (services/workspace-tool-ops.ts), the
 *   two functions the batch routes and ctx.workspace.publishRecords / deleteRecords run, on a real
 *   SQLite store: a workspace alice created, with a records space under a locked schema and an
 *   append-only space, bob a plain member and bob's agent with no contributor grant.
 * @structure
 *   - the ceiling: 1000 records publish in one call, 1001 are refused with nothing written
 *   - per-record verdicts: a schema violation fails alone, a repeated id is refused the second time
 *   - dryRun writes nothing and answers what a real run would
 *   - createOnly refuses an existing id; an expected version is a compare-and-swap in any space
 *   - the node provenance stamp travels to `.latest`, and a dry run mints none
 *   - the refusals of the whole batch: the publish gate, an agent without the contributor grant
 *   - deleteRecords removes exactly the ids given, and refuses an append-only space
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-batch-ops.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-06 — Initial, with the batch operations (wish bulk-records-for-ai).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { workspaceCallerOf, publishRecordsBatchOp, deleteRecordsBatchOp } from '../../src/services/workspace-tool-ops.js';
import type { OrganismRecord, OrganismMembershipRecord, GHIIRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'test-node';
// A UUID, as on a real node: the write guard's key pattern reads only that shape.
const ORG = 'b47c0e2a-1111-4222-8333-944455556666';
const WS = 'ws-crm';
const ROOT = `organism.${ORG}.w.${WS}`;
const CONTACT = 'shared.contact';
const LOG = 'shared.log';
const config = { nodeId: NODE, baseUrl: 'http://node.test' } as AimeatConfig;
const now = () => new Date().toISOString();

function organism(): OrganismRecord {
  return {
    id: ORG, name: 'Batch', description: 'x', type: 'project', interests: [],
    creatorGhii: `alice@${NODE}`, admins: [`alice@${NODE}`], members: [`alice@${NODE}`, `bob@${NODE}`], agentGaiis: [],
    boardId: 'board-batch', joinPolicy: 'open', maxMembers: 100, visibility: 'public',
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

async function world(): Promise<SqliteStorage> {
  const storage = new SqliteStorage(':memory:');
  await storage.createOrganism(organism());
  for (const [name, role] of [['alice', 'creator'], ['bob', 'member']] as const) {
    await storage.createGHII(ghii(name));
    await storage.createMembership(membership(name, role));
  }
  await put(storage, `alice@${NODE}`, `organism.${ORG}.meta.workspaces`, { workspaces: [{ id: WS, name: 'CRM', createdBy: 'alice' }] });
  await put(storage, `alice@${NODE}`, `${ROOT}.meta.manifest`, {
    manifestVersion: '1', id: WS, name: 'CRM', kind: 'workspace', status: 'active',
    objectTypes: [
      { name: 'contact', namespace: CONTACT, backing: 'memory', mode: 'records' },
      { name: 'log', namespace: LOG, backing: 'memory', mode: 'records', create_only: true },
    ],
  });
  await storage.setSchema({
    keyPattern: `${ROOT}.${CONTACT}`, applyTo: 'prefix', schemaMode: 'open', lockedBy: `alice@${NODE}`, setAt: now(), updatedAt: now(),
    schemaJson: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, email: { type: 'string' } } },
  });
  return storage;
}

const alice = workspaceCallerOf({ principal: `alice@${NODE}`, ownerName: 'alice', roles: ['owner'] }, config);
const bobsAgent = workspaceCallerOf({ principal: `importer#bob@${NODE}`, ownerName: 'bob', roles: ['agent'] }, config);
const contacts = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `c${from + i}`, value: { name: `Contact ${from + i}`, email: `c${from + i}@example.com` } }));

/** The published `.latest` rows of a namespace. */
async function latest(storage: SqliteStorage, ns: string) {
  const { items } = await storage.listAllMemory({ prefix: `${ROOT}.${ns}.`, limit: 100000 });
  return items.filter(r => r.key.endsWith('.latest'));
}

describe('publishRecordsBatchOp', () => {
  let storage: SqliteStorage;
  const deps = () => ({ storage: storage as never, config });
  beforeEach(async () => { storage = await world(); });

  it('publishes 1000 records in one call', async () => {
    const r = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: contacts(1000) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.published).toBe(1000);
    expect(r.data.failed).toBe(0);
    expect(await latest(storage, CONTACT)).toHaveLength(1000);
  });

  it('refuses 1001 records and writes none of them', async () => {
    const r = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: contacts(1001) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.code).toBe('INVALID_INPUT');
    expect(r.message).toContain('1000');
    expect(await latest(storage, CONTACT)).toHaveLength(0);
  });

  it('fails a record that breaks the locked schema alone, and publishes the rest', async () => {
    const records = [...contacts(2), { id: 'bad', value: { email: 'no-name@example.com' } }];
    const r = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.published).toBe(2);
    expect(r.data.failed).toBe(1);
    const bad = r.data.results.find(x => x.instance === 'bad');
    expect(bad?.ok).toBe(false);
    expect(bad?.code).toBe('INVALID');
    expect(JSON.stringify(bad?.violations)).toContain('name');
    expect((await latest(storage, CONTACT)).map(x => x.key).sort()).toEqual([`${ROOT}.${CONTACT}.c0.latest`, `${ROOT}.${CONTACT}.c1.latest`]);
  });

  it('refuses the second occurrence of an id in one batch and keeps the first value', async () => {
    const records = [{ id: 'c0', value: { name: 'First' } }, { id: 'c0', value: { name: 'Second' } }];
    const r = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records });
    expect(r.ok && r.data.published).toBe(1);
    expect(r.ok && r.data.results[1].code).toBe('DUPLICATE_ID');
    const rows = await latest(storage, CONTACT);
    expect(rows).toHaveLength(1);
    expect((rows[0].value as { name: string }).name).toBe('First');
  });

  it('names a record with no id or an unknown visibility in results, where the route skipped it', async () => {
    const records = [{ value: { name: 'No id' } }, { id: 'v', value: { name: 'V' }, visibility: 'everyone' }, ...contacts(1)];
    const r = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.published).toBe(1);
    expect(r.data.failed).toBe(2);
    expect(r.data.results.map(x => x.instance)).toEqual(['#0', 'v', 'c0']);
  });

  it('dryRun decides every record exactly as a real run would, and writes nothing', async () => {
    await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: contacts(1) });
    // The workspace's own keys and the decision log; the timeline snapshot is written after a publish
    // without being awaited, so it is not part of what a dry run could have changed.
    const snapshot = async () => (await storage.listAllMemory({ prefix: `organism.${ORG}.`, limit: 100000 })).items
      .filter(x => !x.key.endsWith('.meta.structure')).map(x => `${x.key}@${x.version}`).sort();
    const before = await snapshot();
    const records = [...contacts(3), { id: 'bad', value: {} }];
    const dry = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records, createOnly: true, dryRun: true });
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.data.dry_run).toBe(true);
    expect(dry.data.published).toBe(2);
    expect(dry.data.results.filter(x => x.code === 'EXISTS').map(x => x.instance)).toEqual(['c0']);
    expect(dry.data.results.filter(x => x.code === 'INVALID').map(x => x.instance)).toEqual(['bad']);
    expect(await snapshot()).toEqual(before);

    // The real run answers what the dry run said.
    const real = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records, createOnly: true });
    expect(real.ok && real.data.results.map(x => `${x.instance}:${x.ok}:${x.code ?? ''}`))
      .toEqual(dry.data.results.map(x => `${x.instance}:${x.ok}:${x.code ?? ''}`));
  });

  it('createOnly refuses an id that already exists, even with the same value', async () => {
    await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: contacts(1) });
    const r = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: contacts(2), createOnly: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.results.map(x => `${x.instance}:${x.ok}:${x.code ?? ''}`)).toEqual(['c0:false:EXISTS', 'c1:true:']);
    // Without createOnly the identical value is a no-op re-publish, as before.
    const again = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: contacts(1) });
    expect(again.ok && again.data.skipped).toBe(1);
  });

  it('holds an expected version the caller names, in a space that does not require one', async () => {
    await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: contacts(1) });
    const changed = [{ id: 'c0', value: { name: 'Changed' } }, { id: 'n1', value: { name: 'New' } }];
    const stale = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: changed, expectedVersions: { c0: 2, n1: 0 } });
    expect(stale.ok && stale.data.results.map(x => `${x.instance}:${x.code ?? 'ok'}`)).toEqual(['c0:VERSION_CONFLICT', 'n1:ok']);
    const mustBeNew = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: changed.slice(0, 1), expectedVersions: { c0: 0 } });
    expect(mustBeNew.ok && mustBeNew.data.results[0].code).toBe('VERSION_CONFLICT');
    const fresh = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: changed.slice(0, 1), expectedVersions: { c0: 1 } });
    expect(fresh.ok && fresh.data.published).toBe(1);
    // null names no expectation.
    const free = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: [{ id: 'c0', value: { name: 'Again' } }], expectedVersions: { c0: null } });
    expect(free.ok && free.data.published).toBe(1);
  });

  it('carries the node provenance stamp to .version.N and .latest, and a dry run mints none', async () => {
    const stamp = { pipeline: 'ext.crm-import.import_records', level: 'ai-generated' as const, method: 'fully-generated' as const };
    const dry = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: contacts(2), dryRun: true, nodeStamp: stamp });
    expect(dry.ok).toBe(true);
    expect((await storage.listAiProvenance({ limit: 100 } as never)).items).toHaveLength(0);

    const r = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: [...contacts(2), { id: 'bad', value: {} }], nodeStamp: stamp });
    expect(r.ok && r.data.published).toBe(2);
    const rows = await latest(storage, CONTACT);
    expect(rows).toHaveLength(2);
    const ids = rows.map(x => x.aiProvenanceId);
    expect(ids.every(Boolean)).toBe(true);
    const version = await storage.getMemory(`alice@${NODE}`, `${ROOT}.${CONTACT}.c0.version.1`);
    expect(version?.aiProvenanceId).toBe(rows.find(x => x.key.includes('.c0.'))?.aiProvenanceId);
    const prov = await storage.getAiProvenance(ids[0]!);
    expect(prov?.record.generator?.pipeline).toBe(stamp.pipeline);
    expect(prov?.record.level).toBe('ai-generated');
    // Two records landed, two provenance records; the refused record left none.
    expect((await storage.listAiProvenance({ limit: 100 } as never)).items).toHaveLength(2);
  });

  it('refuses the whole batch while the publish gate is on, and says what to do instead', async () => {
    await put(storage, `alice@${NODE}`, `organism.${ORG}.meta.config`, { gates: { publish: { enabled: true } } });
    const r = await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: contacts(3) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('GATE_ENABLED');
    expect(r.message).toContain('drafts');
    expect(await latest(storage, CONTACT)).toHaveLength(0);
  });

  it('refuses direct values from an agent of a member who holds no contributor grant', async () => {
    const r = await publishRecordsBatchOp(deps(), bobsAgent, { organismId: ORG, ws: WS, namespace: CONTACT, records: contacts(2) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(403);
    expect(r.code).toBe('CONSENT_REQUIRED');
    expect(await latest(storage, CONTACT)).toHaveLength(0);
  });

  it('refuses a caller who is not a member', async () => {
    const stranger = workspaceCallerOf({ principal: `eve@${NODE}`, ownerName: 'eve', roles: ['owner'] }, config);
    const r = await publishRecordsBatchOp(deps(), stranger, { organismId: ORG, ws: WS, namespace: CONTACT, records: contacts(1) });
    expect(!r.ok && r.code).toBe('ACCESS_DENIED');
  });
});

describe('deleteRecordsBatchOp', () => {
  let storage: SqliteStorage;
  const deps = () => ({ storage: storage as never, config });
  beforeEach(async () => { storage = await world(); });

  it('removes exactly the ids given, every row of each, and names an id it could not remove', async () => {
    await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: contacts(4) });
    await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: [{ id: 'c1', value: { name: 'Changed' } }] });
    const r = await deleteRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, ids: ['c1', 'c3', 'zzz'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.deleted).toEqual([{ id: 'c1', keys: 3 }, { id: 'c3', keys: 2 }]);
    expect(r.data.failed).toEqual([{ id: 'zzz', reason: expect.any(String) }]);
    expect(r.data.rows_removed).toBe(5);
    const { items } = await storage.listAllMemory({ prefix: `${ROOT}.${CONTACT}.`, limit: 1000 });
    expect([...new Set(items.map(x => x.key.slice(`${ROOT}.${CONTACT}.`.length).split('.')[0]))].sort()).toEqual(['c0', 'c2']);
  });

  it('refuses an append-only space whole', async () => {
    await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: LOG, records: [{ id: 'e1', value: { at: 1 } }] });
    const r = await deleteRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: LOG, ids: ['e1'] });
    expect(!r.ok && r.code).toBe('WRITE_CONFLICT');
    expect(await latest(storage, LOG)).toHaveLength(1);
  });

  it('never removes a row another member owns', async () => {
    await publishRecordsBatchOp(deps(), alice, { organismId: ORG, ws: WS, namespace: CONTACT, records: contacts(1) });
    const bob = workspaceCallerOf({ principal: `bob@${NODE}`, ownerName: 'bob', roles: ['owner'] }, config);
    const r = await deleteRecordsBatchOp(deps(), bob, { organismId: ORG, ws: WS, namespace: CONTACT, ids: ['c0'] });
    expect(r.ok && r.data.rows_removed).toBe(0);
    expect(await latest(storage, CONTACT)).toHaveLength(1);
  });
});
