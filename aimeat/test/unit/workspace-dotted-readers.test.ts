/**
 * @file workspace-dotted-readers.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The readers of a workspace key that have no route of their own to test through read a
 *   record whose id holds a dot under its whole id, as the workspace index does
 *   (services/workspace/record-key.ts; secaudit2026oct31w2 round 10b, dotted record ids): the KPI
 *   roll-up (services/kpi-rollup.ts), the section index's "does this page still exist"
 *   (services/workspace/change-core.ts existingDocIds), the version history compaction
 *   (services/workspace/versions.ts compactWorkspaceVersions) and the connector's record wake
 *   (services/connect-tunnel-push.ts onMemoryWrite). The helpers themselves are tested first. The E2E
 *   half is test/e2e-workspace-dotted-id.ts.
 *
 *   FIRST FAIL. On the tree before round 10b the "dotted" cases of the KPI, existingDocIds, the
 *   compaction and the record wake fail; the "plain" cases pass on both trees.
 * @usage cd aimeat && pnpm vitest run test/unit/workspace-dotted-readers.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 10b).
 */
import { describe, it, expect } from 'vitest';
import { WebSocket } from 'ws';
import type { MemoryRecord } from '../../src/storage/interface.js';
import { evaluateRecordsKpi } from '../../src/services/kpi-rollup.js';
import { existingDocIds, type ChangeDeps } from '../../src/services/workspace/change-core.js';
import { compactWorkspaceVersions } from '../../src/services/workspace/versions.js';
import { onMemoryWrite, type RecordPushContext, type PushConn } from '../../src/services/connect-tunnel-push.js';
import { recordRowAt, spaceRowAt, declaredNamespaceOf } from '../../src/services/workspace/record-key.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const WS = 'wsdot';
const ROOT = `organism.${ORG}.w.${WS}`;
const rec = (key: string, value: unknown): MemoryRecord => ({ key, value, ownerGaii: `alice@node`, visibility: 'private', version: 1, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' } as unknown as MemoryRecord);

describe('the key helpers', () => {
  it('read the id and the copy from the end of the rest', () => {
    expect(recordRowAt('v1.2.latest')).toEqual({ id: 'v1.2', copy: 'latest' });
    expect(recordRowAt('v1.2.draft')).toEqual({ id: 'v1.2', copy: 'draft' });
    expect(recordRowAt('v1.2.version.3')).toEqual({ id: 'v1.2', copy: 'version' });
    expect(recordRowAt('plain')).toEqual({ id: 'plain', copy: 'bare' });
    expect(recordRowAt('plain.latest')).toEqual({ id: 'plain', copy: 'latest' });
    expect(recordRowAt('v1.2')).toBeNull();
  });

  it('leave a key of a longer declared namespace to that space', () => {
    const prefixes = [`${ROOT}.notes.`, `${ROOT}.notes.old.`];
    expect(spaceRowAt(`${ROOT}.notes.v1.2.latest`, `${ROOT}.notes.`, prefixes)).toEqual({ id: 'v1.2', copy: 'latest' });
    expect(spaceRowAt(`${ROOT}.notes.old.x.latest`, `${ROOT}.notes.`, prefixes)).toBeNull();
    expect(spaceRowAt(`${ROOT}.notes.old.x.latest`, `${ROOT}.notes.old.`, prefixes)).toEqual({ id: 'x', copy: 'latest' });
    expect(spaceRowAt(`${ROOT}.other.x.latest`, `${ROOT}.notes.`, prefixes)).toBeNull();
  });

  it('find the declared space a write-guard parse of a dotted id names', () => {
    expect(declaredNamespaceOf('logs.e1', ['logs'])).toBe('logs');
    expect(declaredNamespaceOf('logs', ['logs'])).toBe('logs');
    expect(declaredNamespaceOf('notes.old', ['notes', 'notes.old'])).toBe('notes.old');
    expect(declaredNamespaceOf('logsx.e1', ['logs'])).toBeNull();
  });
});

describe('the KPI roll-up', () => {
  const types = [{ name: 'deal', namespace: 'deals' }];
  const source = { from: 'records' as const, space: 'deal', agg: 'sum' as const, field: 'amount' };
  it('plain: sums the published copy of each record, as before', () => {
    const rows = [rec(`${ROOT}.deals.a.latest`, { amount: 2 }), rec(`${ROOT}.deals.a.draft`, { amount: 100 }), rec(`${ROOT}.deals.b`, { amount: 3 })];
    expect(evaluateRecordsKpi(rows, types, ROOT, source)).toBe(5);
    expect(evaluateRecordsKpi(rows, types, ROOT, { ...source, agg: 'count' })).toBe(2);
  });
  it('dotted: counts each record whose id holds a dot under its whole id', () => {
    const rows = [rec(`${ROOT}.deals.a.latest`, { amount: 2 }), rec(`${ROOT}.deals.q1.1.latest`, { amount: 10 }), rec(`${ROOT}.deals.q1.2.latest`, { amount: 20 })];
    expect(evaluateRecordsKpi(rows, types, ROOT, source)).toBe(32);
    expect(evaluateRecordsKpi(rows, types, ROOT, { ...source, agg: 'count' })).toBe(3);
  });
});

describe('existingDocIds', () => {
  const deps = (keys: string[]): ChangeDeps => ({
    storage: { listMemoryKeysByPrefix: async (prefix: string) => keys.filter(k => k.startsWith(prefix)).map(key => ({ key })) },
    config: {},
  } as unknown as ChangeDeps);
  const keys = [`${ROOT}.pages.intro.latest`, `${ROOT}.pages.p1.2.latest`, `${ROOT}.pages.p1.2.version.1`, `${ROOT}.pages.gone.version.1`];
  it('plain: finds a page by any of its copies, and not one that is not there', async () => {
    const found = await existingDocIds(deps(keys), ORG, WS, 'pages', ['intro', 'gone', 'never']);
    expect([...found].sort()).toEqual(['gone', 'intro']);
  });
  it('dotted: finds a page whose id holds a dot, and not its first part', async () => {
    const found = await existingDocIds(deps(keys), ORG, WS, 'pages', ['p1.2', 'p1']);
    expect([...found]).toEqual(['p1.2']);
  });
});

describe('the version history compaction', () => {
  const manifest = { objectTypes: [
    { name: 'log', namespace: 'logs', create_only: true },
    { name: 'note', namespace: 'notes', maxVersions: 4 },
  ] };
  const compact = async (ids: Array<[string, string]>) => {
    const keys = ids.flatMap(([ns, id]) => [1, 2, 3, 4, 5].map(n => `${ROOT}.${ns}.${id}.version.${n}`));
    const deleted: string[] = [];
    const storage = {
      listMemoryKeysByPrefix: async (prefix: string) => keys.filter(k => k.startsWith(prefix)).map(key => ({ ownerGaii: 'alice@node', key })),
      listAllMemory: async ({ prefix }: { prefix: string }) => ({ items: prefix === `${ROOT}.meta.manifest` ? [rec(`${ROOT}.meta.manifest`, manifest)] : [] }),
      bulkDeleteMemory: async (rows: Array<{ key: string }>) => { deleted.push(...rows.map(r => r.key)); return rows.length; },
    };
    await compactWorkspaceVersions(storage as unknown as Parameters<typeof compactWorkspaceVersions>[0], { workspaceMaxVersions: 2 }, { organismId: ORG });
    return deleted.map(k => k.slice(ROOT.length + 1)).sort();
  };
  it('plain: an append-only space keeps all history, and a space keeps its own window', async () => {
    expect(await compact([['logs', 'e1'], ['notes', 'n1']])).toEqual(['notes.n1.version.1']);
  });
  it('dotted: a record whose id holds a dot keeps its space\'s rule, append-only included', async () => {
    expect(await compact([['logs', 'e1.2'], ['notes', 'v1.2']])).toEqual(['notes.v1.2.version.1']);
  });
});

describe('the record wake over the connector', () => {
  const run = async (key: string, spaces: string[]) => {
    const sent: Array<{ space: string; id: string }> = [];
    const principal = `worker#alice@node`;
    const conn: PushConn = { principal, ws: { readyState: WebSocket.OPEN } as unknown as WebSocket };
    const ctx: RecordPushContext = {
      stats: { deliveriesTotal: 0 } as unknown as RecordPushContext['stats'],
      connections: new Map([[principal, conn]]),
      spaceSubscribers: new Map(spaces.map(s => [`${ORG}|${WS}|${s}`, new Set([principal])])),
      sendTo: (_c, frame) => { const p = (frame as { payload: { space: string; id: string } }).payload; sent.push({ space: p.space, id: p.id }); },
      canPrincipalReadSpace: async () => true,
      workspaceEngagements: async () => [],
      clearSubscriptionFor: () => {},
      pushTaskCancellations: async () => {},
    };
    await onMemoryWrite(ctx, { key, ownerGaii: 'alice@node', op: 'updated', timestamp: Date.parse('2026-11-01T00:00:00Z') } as Parameters<typeof onMemoryWrite>[1]);
    return sent;
  };
  it('plain: a published record wakes its space; a draft and a history row do not', async () => {
    expect(await run(`${ROOT}.notes.plain.latest`, ['notes'])).toEqual([{ space: 'notes', id: 'plain' }]);
    expect(await run(`${ROOT}.notes.plain`, ['notes'])).toEqual([{ space: 'notes', id: 'plain' }]);
    expect(await run(`${ROOT}.notes.plain.draft`, ['notes'])).toEqual([]);
    expect(await run(`${ROOT}.notes.plain.version.2`, ['notes'])).toEqual([]);
  });
  it('dotted: a published record whose id holds a dot wakes its space under its whole id; its draft does not', async () => {
    expect(await run(`${ROOT}.notes.v1.2.latest`, ['notes'])).toEqual([{ space: 'notes', id: 'v1.2' }]);
    expect(await run(`${ROOT}.notes.v1.2.draft`, ['notes'])).toEqual([]);
  });
  it('a record of a longer subscribed namespace wakes that space only', async () => {
    expect(await run(`${ROOT}.notes.old.x.latest`, ['notes', 'notes.old'])).toEqual([{ space: 'notes.old', id: 'x' }]);
  });
});
