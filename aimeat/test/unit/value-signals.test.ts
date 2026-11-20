/**
 * @file test/unit/value-signals.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The value signals (services/value/signal-buffer.ts, storage/types/value.ts): what
 *   happened to a record an AI made, derived from writes, deletes and opens with nobody acknowledging
 *   anything. Three parts: the replay rules on plain data; the storage contract on every configured
 *   provider, compared between them; and the buffer end to end on SQLite.
 *
 *   A run without DATABASE_URL checks SQLite only, as the other conformance suites do.
 * @usage cd aimeat && DATABASE_URL=postgresql://… pnpm exec vitest run test/unit/value-signals.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 1).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import type { ValueKeyRow } from '../../src/storage/types/value.js';
import {
  replayValueTouches, valueRecordOf, isAiPrincipal, recordValueWrite, recordValueDelete, recordValueRead,
  flushValueSignals, initValueSignals, resetValueSignals, shutdownValueSignals,
} from '../../src/services/value/signal-buffer.js';
import { sourceOf, sizeBucketOf } from '../../src/services/value/data-buffer.js';
import { teamAiWeek } from '../../src/services/team/weekly-report.js';

const NODE = 'aimeat-local-001-dev';
const ALICE = `alice@${NODE}`;
const AGENT = `claude#alice@${NODE}`;
const OTHER_AGENT = `writer#bob@${NODE}`;
const BOB = `bob@${NODE}`;
const APP = `eco:notes#alice@${NODE}`;
const D1 = '2026-11-02T10:00:00.000Z';
const D2 = '2026-11-03T10:00:00.000Z';
const D30 = '2026-12-05T10:00:00.000Z';

type T = Parameters<typeof replayValueTouches>[1][number];
const w = (principal: string, at: string, bytes?: number, key = 'report.nov', ownerGaii = ALICE, level?: string): T =>
  ({ kind: 'write', ownerGaii, key, principal, at, bytes, level });
const del = (principal: string, at: string, key = 'report.nov', ownerGaii = ALICE): T =>
  ({ kind: 'delete', ownerGaii, key, principal, at });
const rd = (principal: string, at: string, key = 'report.nov', ownerGaii = ALICE): T =>
  ({ kind: 'read', ownerGaii, key, principal, at });
const signals = (out: ReturnType<typeof replayValueTouches>): Record<string, number> => {
  const s: Record<string, number> = {};
  for (const d of out.daily) s[d.signal] = (s[d.signal] ?? 0) + d.count;
  return s;
};

describe('who counts as an AI', () => {
  it('an agent and a scheduled AI job are; a person, an app grant and an extension are not', () => {
    expect(isAiPrincipal(AGENT)).toBe(true);
    expect(isAiPrincipal('schedule:abc123')).toBe(true);
    expect(isAiPrincipal(ALICE)).toBe(false);
    expect(isAiPrincipal(APP)).toBe(false);
    expect(isAiPrincipal('ext:weather')).toBe(false);
  });
});

describe('the replay rules', () => {
  it('an AI writing a new record is one result, and its own next writes are revisions, not more results', () => {
    const out = replayValueTouches([], [w(AGENT, D1, 100), w(AGENT, D1, 120), w(AGENT, D2, 130)]);
    expect(signals(out)).toEqual({ produced: 1, revised: 2 });
    expect(out.upserts).toHaveLength(1);
    expect(out.upserts[0]).toMatchObject({ producer: AGENT, revisions: 2, corrections: 0, lastBytes: 130 });
  });

  it('a record only a person wrote is not counted at all', () => {
    const out = replayValueTouches([], [w(ALICE, D1, 100), w(BOB, D1, 90), rd(BOB, D2), del(ALICE, D2)]);
    expect(out.daily).toHaveLength(0);
    expect(out.upserts).toHaveLength(0);
  });

  it('an AI writing over a record a person started makes it the AI\'s result from then on', () => {
    const out = replayValueTouches([], [w(ALICE, D1, 100), w(AGENT, D1, 90)]);
    expect(signals(out)).toEqual({ produced: 1 });
    expect(out.upserts[0]).toMatchObject({ producer: AGENT });
  });

  it('someone else changing an AI-made record is a correction, with the size of the change', () => {
    const out = replayValueTouches([], [w(AGENT, D1, 100), w(ALICE, D2, 140)]);
    expect(signals(out)).toEqual({ produced: 1, corrected: 1 });
    const corrected = out.daily.find(d => d.signal === 'corrected')!;
    expect(corrected.bytes).toBe(40);
    expect(corrected.producer).toBe(AGENT);
    expect(out.upserts[0]).toMatchObject({ corrections: 1, correctionBytes: 40, lastCorrectedAt: D2 });
  });

  it('an app the person uses changing it is a correction too, because an app is not an AI', () => {
    const out = replayValueTouches([], [w(AGENT, D1, 100), w(APP, D2, 80)]);
    expect(signals(out)).toEqual({ produced: 1, corrected: 1 });
  });

  it('someone else saving it unchanged in size is a publish, not a correction', () => {
    const out = replayValueTouches([], [w(AGENT, D1, 100), w(ALICE, D2, 100)]);
    expect(signals(out)).toEqual({ produced: 1 });
  });

  it('a delete within the window is a rejection, and the record state goes', () => {
    const out = replayValueTouches([], [w(AGENT, D1, 100), del(ALICE, D2)]);
    expect(signals(out)).toEqual({ produced: 1, rejected: 1 });
    expect(out.upserts).toHaveLength(0);
  });

  it('a delete after the window is not a rejection', () => {
    const stored: ValueKeyRow = {
      ownerGaii: ALICE, key: 'report.nov', producer: AGENT, producerLevel: null, producedAt: D1,
      revisions: 0, corrections: 0, correctionBytes: 0, lastCorrectedAt: null, readsByOthers: 3, lastReadAt: D2, lastBytes: 100,
    };
    const out = replayValueTouches([stored], [del(ALICE, D30)]);
    expect(out.daily).toHaveLength(0);
    expect(out.deletes).toEqual([{ ownerGaii: ALICE, key: 'report.nov' }]);
  });

  it('someone other than the maker opening it is a use; the maker opening its own is not', () => {
    const out = replayValueTouches([], [w(AGENT, D1, 100), rd(AGENT, D1), rd(ALICE, D2), rd(BOB, D2)]);
    expect(signals(out)).toEqual({ produced: 1, used: 2 });
    expect(out.upserts[0]).toMatchObject({ readsByOthers: 2, lastReadAt: D2 });
  });

  it('a declared synthesis is a refinement', () => {
    const out = replayValueTouches([], [w(AGENT, D1, 100, 'brief.q4', ALICE, 'synthesized')]);
    expect(signals(out)).toEqual({ refined: 1 });
  });

  it('a stored record folds only the change: counts are deltas against what is stored', () => {
    const stored: ValueKeyRow = {
      ownerGaii: ALICE, key: 'report.nov', producer: AGENT, producerLevel: null, producedAt: D1,
      revisions: 4, corrections: 1, correctionBytes: 10, lastCorrectedAt: D1, readsByOthers: 2, lastReadAt: D1, lastBytes: 100,
    };
    const out = replayValueTouches([stored], [w(BOB, D2, 105), rd(BOB, D2)]);
    expect(out.upserts).toEqual([expect.objectContaining({ revisions: 0, corrections: 1, correctionBytes: 5, readsByOthers: 1, lastBytes: 105 })]);
    expect(out.deletes).toHaveLength(0);
  });

  it('deleted and made again in one batch: the old row goes and a new one is made', () => {
    const stored: ValueKeyRow = {
      ownerGaii: ALICE, key: 'report.nov', producer: AGENT, producerLevel: null, producedAt: D1,
      revisions: 0, corrections: 0, correctionBytes: 0, lastCorrectedAt: null, readsByOthers: 0, lastReadAt: null, lastBytes: 100,
    };
    const out = replayValueTouches([stored], [del(ALICE, D30), w(OTHER_AGENT, D30, 50)]);
    expect(out.deletes).toEqual([{ ownerGaii: ALICE, key: 'report.nov' }]);
    expect(out.upserts).toEqual([expect.objectContaining({ producer: OTHER_AGENT, producedAt: D30, revisions: 0 })]);
  });

  it('a day count belongs to the person whose AI made the record, and carries the organism and workspace', () => {
    const key = 'organism.org1.w.ws-abc.shared.offer.o1';
    const out = replayValueTouches([], [w(OTHER_AGENT, D1, 10, key, '')]);
    expect(out.daily[0]).toMatchObject({ ownerGhii: BOB, orgId: 'org1', wsId: 'ws-abc', signal: 'produced' });
  });
});

describe('a workspace record is one record whatever copy is touched', () => {
  it('its draft, its published copy and its versions name the same record, in no namespace', () => {
    const draft = valueRecordOf(AGENT, 'organism.org1.w.ws-abc.shared.offer.o1.draft');
    const latest = valueRecordOf(ALICE, 'organism.org1.w.ws-abc.shared.offer.o1.latest');
    const version = valueRecordOf(ALICE, 'organism.org1.w.ws-abc.shared.offer.o1.version.3');
    expect(draft).toEqual(latest);
    expect(latest).toEqual(version);
    expect(draft.ownerGaii).toBe('');
  });

  it('a personal key keeps its namespace', () => {
    expect(valueRecordOf(ALICE, 'report.nov')).toEqual({ ownerGaii: ALICE, key: 'report.nov' });
  });
});

// ── The storage contract, on every configured provider ──

const SQLITE_PATH = `./test/.value-signals-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];
const RUN = randomUUID().slice(0, 8);

beforeAll(async () => {
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
}, 60_000);

afterAll(async () => {
  await shutdownValueSignals();
  for (const { storage } of provs) await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
  }
});

describe('the storage contract, the same on every provider', () => {
  it('a per-record row is created from the first delta and later deltas add', async () => {
    const answers: unknown[] = [];
    for (const { storage } of provs) {
      const owner = `k-${RUN}@${NODE}`;
      const base = {
        ownerGaii: owner, key: 'a.b', producer: AGENT, producerLevel: null, producedAt: D1,
        revisions: 0, corrections: 0, correctionBytes: 0, lastCorrectedAt: null, readsByOthers: 0, lastReadAt: null, lastBytes: 100,
      };
      await storage.upsertValueKeys([base]);
      await storage.upsertValueKeys([{ ...base, revisions: 2, corrections: 1, correctionBytes: 7, lastCorrectedAt: D2, readsByOthers: 3, lastReadAt: D2, lastBytes: null }]);
      const [row] = await storage.getValueKeys([{ ownerGaii: owner, key: 'a.b' }]);
      answers.push(row);
      expect(row).toMatchObject({ producer: AGENT, revisions: 2, corrections: 1, correctionBytes: 7, readsByOthers: 3, lastBytes: 100, lastCorrectedAt: D2, lastReadAt: D2 });
      const listed = await storage.listValueKeys({ ownerGaii: owner, keyPrefix: 'a.' });
      expect(listed).toHaveLength(1);
      await storage.deleteValueKeys([{ ownerGaii: owner, key: 'a.b' }]);
      expect(await storage.getValueKeys([{ ownerGaii: owner, key: 'a.b' }])).toEqual([]);
    }
    if (answers.length === 2) expect(answers[1]).toEqual(answers[0]);
  });

  it('day counts add, group by the asked columns, count the owners behind a group, and fold into Monday weeks', async () => {
    const answers: unknown[] = [];
    for (const { storage } of provs) {
      const a = `d1-${RUN}@${NODE}`;
      const b = `d2-${RUN}@${NODE}`;
      const row = { ownerGhii: a, orgId: `org-${RUN}`, wsId: '', producer: AGENT, family: 'report.*', signal: 'produced' as const, count: 1, bytes: 10 };
      await storage.upsertValueDaily([
        { ...row, day: '2026-01-07' }, { ...row, day: '2026-01-07' }, { ...row, day: '2026-01-08', signal: 'used', bytes: 0 },
        { ...row, ownerGhii: b, day: '2026-01-08' },
      ]);
      const bySignal = await storage.sumValueDaily({ orgId: `org-${RUN}` }, ['signal']);
      expect(bySignal).toEqual([
        { signal: 'produced', count: 3, bytes: 30, owners: 2 },
        { signal: 'used', count: 1, bytes: 0, owners: 1 },
      ]);
      // 2026-01-07 is a Wednesday and 2026-01-08 a Thursday: both fold into Monday 2026-01-05.
      const folded = await storage.foldValueDaily('2026-01-09');
      expect(folded).toBeGreaterThanOrEqual(3);
      const byDay = await storage.sumValueDaily({ orgId: `org-${RUN}` }, ['day', 'signal']);
      expect(byDay).toEqual([
        { day: '2026-01-05', signal: 'produced', count: 3, bytes: 30, owners: 2 },
        { day: '2026-01-05', signal: 'used', count: 1, bytes: 0, owners: 1 },
      ]);
      answers.push(byDay);
    }
    if (answers.length === 2) expect(answers[1]).toEqual(answers[0]);
  });
});

describe('the data counts', () => {
  it('a source and a size class are told from the principal and the bytes', () => {
    expect(sourceOf(AGENT, ALICE)).toBe('agent');
    expect(sourceOf(ALICE, ALICE)).toBe('person');
    expect(sourceOf(APP, ALICE)).toBe('app');
    expect(sourceOf('ext:weather', ALICE)).toBe('extension');
    expect(sourceOf('schedule:abc', ALICE)).toBe('automation');
    expect(sourceOf('carol@other-node', ALICE)).toBe('federation');
    expect([sizeBucketOf(10), sizeBucketOf(2048), sizeBucketOf(2_000_000), sizeBucketOf(20_000_000), sizeBucketOf(undefined)])
      .toEqual(['lt1k', 'lt100k', 'lt10m', 'gte10m', 'unknown']);
  });

  it('day counts add and group the same on every provider, with the owners behind a group', async () => {
    const answers: unknown[] = [];
    for (const { storage } of provs) {
      const day = '2026-02-03';
      const base = { day, kind: 'memory', source: 'agent', direction: 'in', sizeBucket: 'lt1k', level: '', contentClass: '', count: 1, bytes: 100 };
      await storage.upsertDataDaily([
        { ...base, ownerGhii: `dd1-${RUN}@${NODE}` }, { ...base, ownerGhii: `dd1-${RUN}@${NODE}` },
        { ...base, ownerGhii: `dd2-${RUN}@${NODE}`, kind: 'file', sizeBucket: 'lt10m', bytes: 5000 },
      ]);
      const byKind = await storage.sumDataDaily({ from: day, to: day }, ['kind']);
      answers.push(byKind);
      expect(byKind).toEqual([
        { kind: 'file', count: 1, bytes: 5000, owners: 1 },
        { kind: 'memory', count: 2, bytes: 200, owners: 1 },
      ]);
      expect(await storage.pruneDataDaily('2026-02-04')).toBeGreaterThanOrEqual(2);
      expect(await storage.sumDataDaily({ from: day, to: day }, ['kind'])).toEqual([]);
    }
    if (answers.length === 2) expect(answers[1]).toEqual(answers[0]);
  });
});

describe('the team\'s week in the Friday report', () => {
  it('counts what AI made in the organism in the seven days before, and nothing older or elsewhere', async () => {
    const storage = provs[0].storage;
    const org = `teamorg-${RUN}`;
    const now = Date.parse('2026-03-13T12:00:00.000Z');
    const row = { ownerGhii: `tw-${RUN}@${NODE}`, orgId: org, wsId: 'ws-1', producer: AGENT, family: 'organism.<id>.w.<id>.offer.*', count: 1, bytes: 0 };
    await storage.upsertValueDaily([
      { ...row, day: '2026-03-12', signal: 'produced' }, { ...row, day: '2026-03-10', signal: 'produced' },
      { ...row, day: '2026-03-11', signal: 'corrected' }, { ...row, day: '2026-03-12', signal: 'used' },
      { ...row, day: '2026-03-01', signal: 'produced' },
      { ...row, orgId: `other-${RUN}`, day: '2026-03-12', signal: 'produced' },
    ]);
    expect(await teamAiWeek(storage, org, now)).toEqual({ made: 2, corrected: 1, rejected: 0, used: 1 });
  });
});

describe('the buffer end to end', () => {
  beforeEach(() => { resetValueSignals(); });

  it('writes, a correction, an open and a rejection land as per-record state and day counts', async () => {
    const storage = provs[0].storage;
    initValueSignals(storage, 60_000);
    const owner = `e-${RUN}@${NODE}`;
    const agent = `claude#e-${RUN}@${NODE}`;
    recordValueWrite({ ownerGaii: owner, key: 'plan.q1', writerPrincipal: agent, at: D1, bytes: 200 });
    recordValueWrite({ ownerGaii: owner, key: 'plan.q1', writerPrincipal: owner, at: D2, bytes: 260 });
    recordValueRead({ ownerGaii: owner, key: 'plan.q1', readerPrincipal: BOB, at: D2 });
    recordValueRead({ ownerGaii: owner, key: 'plan.q1', readerPrincipal: BOB, at: D2 });
    recordValueWrite({ ownerGaii: owner, key: 'draft.bad', writerPrincipal: agent, at: D1, bytes: 50 });
    recordValueDelete({ ownerGaii: owner, key: 'draft.bad', principal: owner, at: D2 });
    await flushValueSignals();

    const [plan] = await storage.getValueKeys([{ ownerGaii: owner, key: 'plan.q1' }]);
    expect(plan).toMatchObject({ producer: agent, corrections: 1, correctionBytes: 60, readsByOthers: 1 });
    expect(await storage.getValueKeys([{ ownerGaii: owner, key: 'draft.bad' }])).toEqual([]);
    const sums = await storage.sumValueDaily({ ownerGhii: owner }, ['signal']);
    expect(Object.fromEntries(sums.map(s => [s.signal, s.count]))).toEqual({ produced: 2, corrected: 1, used: 1, rejected: 1 });
  });
});

describe('an organism\'s own measure over row-space rows, the same on every provider', () => {
  const row = (rowId: string, occurredAt: string, body: Record<string, unknown>, k1 = '') => ({
    id: `${RUN}-${rowId}`, organismId: `org-${RUN}`, wsId: 'ws-offers', namespace: 'sales.offers', rowId,
    k1, k2: '', k3: '', occurredAt, createdAt: occurredAt, updatedAt: occurredAt, createdBy: AGENT,
    body, bytes: JSON.stringify(body).length,
  });
  const scope = { organismId: `org-${RUN}`, wsId: 'ws-offers', namespace: 'sales.offers' };

  it('counts, sums, takes the median and splits by week, filtered by a field value', async () => {
    const answers: unknown[] = [];
    for (const { storage } of provs) {
      await storage.appendWorkspaceRows([
        row('o1', '2026-11-02T09:00:00.000Z', { status: 'sent', amount: 1000, customer: { tier: 'a' } }, 'sent'),
        row('o2', '2026-11-03T09:00:00.000Z', { status: 'sent', amount: 3000, customer: { tier: 'b' } }, 'sent'),
        row('o3', '2026-11-10T09:00:00.000Z', { status: 'won', amount: 2000, customer: { tier: 'a' } }, 'won'),
        row('o4', '2026-11-11T09:00:00.000Z', { status: 'sent', amount: 'n/a' }, 'sent'),
      ]);
      const sentPerWeek = await storage.aggregateWorkspaceRows({ ...scope, op: 'count', where: [{ field: 'status', value: 'sent' }], period: 'week' });
      expect(sentPerWeek).toEqual([
        { period: '2026-11-02', value: 2, rows: 2 },
        { period: '2026-11-09', value: 1, rows: 1 },
      ]);
      const byIndexColumn = await storage.aggregateWorkspaceRows({ ...scope, op: 'count', where: [{ field: 'k1', value: 'won' }] });
      expect(byIndexColumn).toEqual([{ period: null, value: 1, rows: 1 }]);
      const sum = await storage.aggregateWorkspaceRows({ ...scope, op: 'sum', field: 'amount' });
      expect(sum).toEqual([{ period: null, value: 6000, rows: 4 }]);
      const median = await storage.aggregateWorkspaceRows({ ...scope, op: 'median', field: 'amount' });
      expect(median).toEqual([{ period: null, value: 2000, rows: 4 }]);
      const nested = await storage.aggregateWorkspaceRows({ ...scope, op: 'count', where: [{ field: 'customer.tier', value: 'a' }] });
      expect(nested).toEqual([{ period: null, value: 2, rows: 2 }]);
      const span = await storage.aggregateWorkspaceRows({ ...scope, op: 'max', field: 'amount', from: '2026-11-03T00:00:00.000Z', to: '2026-11-10T23:59:59.999Z' });
      expect(span).toEqual([{ period: null, value: 3000, rows: 2 }]);
      answers.push([sentPerWeek, sum, median]);
    }
    if (answers.length === 2) expect(answers[1]).toEqual(answers[0]);
  });

  it('refuses a field name that is not a plain path, before any SQL is built', async () => {
    for (const { storage } of provs) {
      await expect(storage.aggregateWorkspaceRows({ ...scope, op: 'count', where: [{ field: "x') OR 1=1 --", value: 1 }] }))
        .rejects.toThrow(/INVALID_FIELD/);
    }
  });
});
