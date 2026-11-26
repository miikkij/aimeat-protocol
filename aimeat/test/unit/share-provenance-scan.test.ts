/**
 * @file share-provenance-scan.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the compliance counts read to find the records an open workspace share serves
 *   (services/share/provenance.ts sharePublicInScope), at the shape a busy node has.
 *
 *   WHAT GROWS. Published workspace records that carry a provenance record, and the workspaces they
 *   are in. On the node this was measured on (2026-11-26) the scan found 5 237 such records in 52
 *   workspaces. Seven of the 52 had an open share, and those seven held 52 of the records. The other
 *   45 shared nothing with anyone, and the scan still listed every row of every space in them, with
 *   drafts and version rows: 150 MB of values, read to learn that nothing is shared. The scan also
 *   stopped at 5 000 candidates in no stated order, so the 45 workspaces took the places of records
 *   an open share does serve.
 *
 *   The share's own listing read every row of a space, 5 000 at most, and kept the published ones.
 *   A page's version rows sort before the next page's published row, so a space with enough history
 *   stopped serving its later pages.
 * @usage cd aimeat && pnpm exec vitest run test/unit/share-provenance-scan.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import type { AiProvenance } from '../../src/models/ai-provenance-schemas.js';
import { sharePublicInScope, shareOpenedProvenanceIds, SHARE_SCAN_LIMIT } from '../../src/services/share/provenance.js';
import { createPublicCollectors } from '../../src/services/workspace/public-collectors.js';
import { readShareMetaOf } from '../../src/services/workspace/share.js';
import { readerFor } from '../../src/services/classification/reader.js';

const NODE = 'test-node';
const ALICE = 'alice';
const GHII = `${ALICE}@${NODE}`;
const CONFIG = { nodeId: NODE, aiLabelPublic: 'light', classificationMode: 'off' } as unknown as AimeatConfig;
const AT = new Date().toISOString();

let real: Storage;
let storage: Storage;
const calls = new Map<string, unknown[][]>();

const put = (key: string, value: unknown, aiProvenanceId?: string): Promise<unknown> => real.setMemory({
  key, ownerGaii: GHII, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: AT, updatedAt: AT,
  ...(aiProvenanceId ? { aiProvenanceId } : {}),
} as MemoryRecord);

/** An organism with one workspace: a document space `docs` and a record space `items`. */
async function workspace(org: string, share?: Record<string, unknown>): Promise<void> {
  await real.createOrganism({
    id: org, name: org, description: '', type: 'team', interests: [], creatorGhii: GHII, createdBy: GHII, owners: [GHII],
    admins: [], members: [GHII], agentGaiis: [], boardId: '', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
    moderationConfig: { flagsEnabled: false, autoHideThreshold: 3, appealsEnabled: false },
    memoryNamespace: `organism.${org}`, createdAt: AT, updatedAt: AT,
  } as never);
  await real.createMembership({ id: `m-${org}`, organismId: org, ghii: ALICE, role: 'creator', status: 'active', joinedAt: AT } as never);
  await put(`organism.${org}.meta.workspaces`, { workspaces: [{ id: 'ws', name: 'WS', createdBy: ALICE }] });
  await put(`organism.${org}.w.ws.meta.manifest`, {
    manifestVersion: '1.0', id: org, name: 'WS', kind: 'project', status: 'active',
    objectTypes: [
      { name: 'docs', namespace: 'doc', mode: 'document', backing: 'memory' },
      { name: 'items', namespace: 'rec', mode: 'records', backing: 'memory' },
    ],
  });
  if (share) await put(`organism.${org}.w.ws.meta.share`, share);
}

/** A published page an AI wrote, with its provenance record. */
async function aiPage(org: string, id: string): Promise<string> {
  const prov = `prov-${org}-${id}`;
  const record = { spec: 'aimeat.provenance/v1', level: 'ai-generated', humanInvolvement: 'none', generatedAt: AT } as unknown as AiProvenance;
  await real.createAiProvenance({ id: prov, ownerGhii: GHII, principal: `writer#${GHII}`, contentHash: null, generatedAt: AT, createdAt: AT, record });
  await put(`organism.${org}.w.ws.doc.${id}.latest`, { title: id, markdown: 'text' }, prov);
  return prov;
}

/** The key prefixes every listing read asked for. */
function listedPrefixes(): string[] {
  return [
    ...(calls.get('listAllMemory') ?? []).map(a => String((a[0] as { prefix?: string } | undefined)?.prefix ?? '')),
    ...(calls.get('listAllMemoryByKeyShape') ?? []).map(a => String(a[0])),
  ];
}

const OPEN_PAGES = ['p1', 'p2', 'p3'];
let openIds: string[] = [];

beforeAll(async () => {
  real = new SqliteStorage(':memory:') as unknown as Storage;
  // More candidates in a workspace that shares nothing than one scan reads, written first.
  await workspace('org-none');
  for (let i = 0; i <= SHARE_SCAN_LIMIT; i++) await aiPage('org-none', `n${i}`);
  // A share record that opens nothing to anyone: a password share, and an open one with every target off.
  await workspace('org-password', { public: true, spaces: {}, docs: {}, access: 'password', passwordHash: 'x' });
  await aiPage('org-password', 'secret');
  await workspace('org-off', { public: false, spaces: { docs: false }, docs: {}, access: 'open' });
  await aiPage('org-off', 'closed');
  // The open share, written last.
  await workspace('org-open', { public: false, spaces: { docs: true }, docs: {}, access: 'open' });
  openIds = [];
  for (const id of OPEN_PAGES) openIds.push(await aiPage('org-open', id));
  storage = new Proxy(real, {
    get(target, prop) {
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof v !== 'function' || typeof prop !== 'string') return v;
      return (...args: unknown[]) => {
        calls.set(prop, [...(calls.get(prop) ?? []), args]);
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}, 180_000);

describe('the share scan of a report', () => {
  it('finds every record an open share serves, however many candidates the unshared workspaces hold', async () => {
    calls.clear();
    const found = await sharePublicInScope(storage, CONFIG, {});
    expect([...found.ids].sort()).toEqual([...openIds].sort());
    expect(found.capped, 'the unshared workspaces take no place in the scan').toBe(false);
  });

  it('reads no content of a workspace whose share opens nothing', async () => {
    calls.clear();
    await sharePublicInScope(storage, CONFIG, {});
    const content = listedPrefixes().filter(p => /^organism\.org-(none|password|off)\.w\.ws\.(doc|rec)\./.test(p));
    expect(content, 'a space of an unshared workspace was listed').toEqual([]);
  });

  it('answers nothing, and scans no record, on a node with no open share', async () => {
    const empty = new SqliteStorage(':memory:') as unknown as Storage;
    const asked: string[] = [];
    const watched = new Proxy(empty, {
      get(target, prop) {
        const v = (target as unknown as Record<string | symbol, unknown>)[prop];
        if (typeof v !== 'function' || typeof prop !== 'string') return v;
        return (...args: unknown[]) => { asked.push(prop); return (v as (...a: unknown[]) => unknown).apply(target, args); };
      },
    });
    expect(await sharePublicInScope(watched, CONFIG, {})).toEqual({ ids: new Set(), capped: false });
    expect(asked).not.toContain('workspaceProvenanceLinks');
  });
});

describe('one record asked by id', () => {
  it('is public when an open share serves it, and reads no content of a workspace that shares nothing', async () => {
    calls.clear();
    const opened = await shareOpenedProvenanceIds(storage, CONFIG, [openIds[0]!, 'prov-org-none-n0', 'prov-org-off-closed', 'prov-org-password-secret']);
    expect([...opened]).toEqual([openIds[0]]);
    const content = listedPrefixes().filter(p => /^organism\.org-(none|password|off)\.w\.ws\.(doc|rec)\./.test(p));
    expect(content).toEqual([]);
  });
});

describe('the pages a share hands out', () => {
  it('include a page that comes after 5 000 version rows of another page', async () => {
    await workspace('org-history', { public: true, spaces: {}, docs: {}, access: 'open' });
    await put('organism.org-history.w.ws.doc.a.latest', { title: 'a', markdown: 'first' });
    await put('organism.org-history.w.ws.doc.a.draft', { title: 'a', markdown: 'draft' });
    for (let v = 1; v <= 5000; v++) await put(`organism.org-history.w.ws.doc.a.version.${v}`, { title: 'a', markdown: `v${v}` });
    await put('organism.org-history.w.ws.doc.b.latest', { title: 'b', markdown: 'second' });
    await put('organism.org-history.w.ws.rec.r1.latest', { n: 1 });
    await put('organism.org-history.w.ws.rec.r1.draft', { n: 2 });

    const C = createPublicCollectors(real, CONFIG);
    const share = await readShareMetaOf(real, CONFIG, 'org-history', 'ws');
    const anonymous = readerFor({ storage: real, config: CONFIG }, null);
    const docs = await (await C.collectPublicDocs('org-history', 'ws', share)).release(anonymous);
    expect(docs.map(d => `${d.id}:${d.markdown}`)).toEqual(['a:first', 'b:second']);
    const records = await (await C.collectPublicRecords('org-history', 'ws', share)).release(anonymous);
    expect(records.map(r => `${r.id}:${JSON.stringify(r.value)}`)).toEqual(['r1:{"n":1}']);
  }, 120_000);
});
