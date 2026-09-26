/**
 * @file test/unit/visit-retention.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The privacy notice promises that a record of somebody opening a published app names
 *   their account for thirteen months, and that only counts without names remain after that. This
 *   holds the job that keeps the promise to it, on BOTH storage providers (Postgres runs when
 *   DATABASE_URL is set, SQLite always).
 *
 *   WHAT IS SEEDED IS WHAT THE NODE WRITES. The raw rows have the shape services/usage/
 *   record-app-open.ts gives an open, and their rollups come from the fold's own projection
 *   (pendingRollupDeltas), committed with the cursor left where it was: the same state a node is in
 *   when the fold has already consumed those rows. Nothing here hand-writes a rollup row.
 *
 *   THE FOUR ASSERTIONS THE PROMISE IS MADE OF: a fourteen-month-old named visit is still named
 *   before the job and folded after it, in the hot table, in the archive and in the rollups; a
 *   twelve-month-old one is untouched; a call of another kind by the same person, of the same age,
 *   is untouched, and so is the paid part of a row that mixes both; and the app owner's report
 *   gives the same totals before and after.
 * @structure
 *   - provs: sqlite, plus postgres-kysely when DATABASE_URL is set
 *   - seed(): one app, its opens and the calls around them, raw and folded
 *   - describe blocks: the cutoff · the cut table · the fold, per provider
 * @usage cd aimeat && pnpm exec vitest run test/unit/visit-retention.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial, with the thirteen-month rule in the privacy notice.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import type BetterSqlite3 from 'better-sqlite3';
import type { Kysely } from 'kysely';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, UsageCallRecord, UsageRollupRow } from '../../src/storage/interface.js';
import { USAGE_FOLDED_VISITOR, APP_VISIT_ROLLUP_CUTS, APP_USE_CUT } from '../../src/storage/interface.js';
import { pendingRollupDeltas } from '../../src/services/usage/rollup-engine.js';
import { CUTS } from '../../src/services/usage/rollup-cuts.js';
import { readAppVisitors, type AppVisitorsReport } from '../../src/services/app-visitors.js';
import {
  runVisitRetentionJob, visitNameCutoffDay, ACCOUNT_ACTIVITY_CUTS,
} from '../../src/services/usage/visit-retention.js';

const SQLITE_PATH = `./test/.visit-retention-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';

interface Provider { name: 'sqlite' | 'postgres-kysely'; storage: Storage }
const provs: Provider[] = [];

beforeAll(async () => {
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) {
    provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
  } else {
    console.warn('[visit-retention] DATABASE_URL not set — sqlite only');
  }
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) {
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
  }
});

/** The job's clock. Fixed, so a run on the last day of a month cannot move the boundary under a test. */
const NOW = new Date('2026-09-25T10:00:00.000Z');
const NODE = 'aimeat-test-001-visits';

/** Noon UTC on the day `months` calendar months (and `extraDays` days) before NOW. */
function monthsAgo(months: number, extraDays = 0): string {
  const d = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - months, NOW.getUTCDate() - extraDays, 12, 0, 0));
  return d.toISOString();
}

/** A raw row of the shape the node writes, with the given differences. */
function row(over: Partial<UsageCallRecord> & { id: string; ts: string }): UsageCallRecord {
  return {
    ownerGhii: '', actorGaii: '', actorKind: 'owner', surface: 'app', coordinate: '', appId: '',
    counterpartyGhii: '', outcome: 'ok', reason: '', durationMs: 0, chargedUnits: 0, unit: '',
    currency: '', entitlementId: '', runId: '', meta: {},
    ...over,
  };
}

interface Seeded {
  appId: string;
  author: string;
  filename: string;
  visitorOld: string;
  visitorNew: string;
  visitorArch: string;
  rows: Record<'openOld1' | 'openOld2' | 'openNew' | 'openAnon' | 'mcpOld' | 'toolOld' | 'openArch', UsageCallRecord>;
}

/**
 * One app and the calls around it, raw and folded, with one of the old opens moved to the archive.
 *
 * The visitor of the archived open is a THIRD person on purpose. After the fold nobody can tell
 * whether the visitor of one folded day came back on another, so a report over both counts them per
 * day; the totals this file holds equal are the ones a fold can keep, and a person who visits on one
 * day only is counted exactly before and after.
 */
async function seed(storage: Storage, tag: string): Promise<Seeded> {
  const s = `${tag}${randomBytes(3).toString('hex')}`;
  const author = `vrauthor${s}`;
  const authorGhii = `${author}@${NODE}`;
  const filename = `visits-${s}.html`;
  const appId = `${author}/${filename}`;
  const visitorOld = `vrold${s}@${NODE}`;
  const visitorNew = `vrnew${s}@${NODE}`;
  const visitorArch = `vrarch${s}@${NODE}`;

  const body = Buffer.from('<!doctype html><p>visits</p>', 'utf-8');
  await storage.createApp({
    ownerGaii: authorGhii, ownerName: author, filename, versionNumber: 1,
    manifest: { name: 'Visits', description: 'retention fixture', version: '1.0.0', author, category: 'tool', tags: ['test'] } as never,
    mimeType: 'text/html', size: body.length, data: body, createdAt: NOW.toISOString(),
  });

  const open = (id: string, ts: string, visitor: string): UsageCallRecord => row({
    id: `${id}-${s}`, ts, ownerGhii: visitor, actorGaii: visitor, actorKind: visitor ? 'owner' : 'anon',
    coordinate: appId, appId, counterpartyGhii: authorGhii,
  });
  const rows: Seeded['rows'] = {
    // Two opens by one person on one day fourteen months ago: one rollup row, one person.
    openOld1: open('open-old-1', monthsAgo(14), visitorOld),
    openOld2: open('open-old-2', monthsAgo(14).replace('T12:', 'T13:'), visitorOld),
    openNew: open('open-new', monthsAgo(12), visitorNew),
    openAnon: open('open-anon', monthsAgo(14).replace('T12:', 'T14:'), ''),
    // The same person, the same day, a call of another kind. Not a visit.
    mcpOld: row({
      id: `mcp-old-${s}`, ts: monthsAgo(14).replace('T12:', 'T15:'), ownerGhii: visitorOld,
      actorGaii: visitorOld, surface: 'mcp', coordinate: 'aimeat_memory_write',
    }),
    // The same person paying for the same app's tool, the same day. Its appId puts it in the same
    // `call.owner.app` row as the two opens, which is the row the fold must take apart correctly.
    toolOld: row({
      id: `tool-old-${s}`, ts: monthsAgo(14).replace('T12:', 'T16:'), ownerGhii: visitorOld,
      actorGaii: visitorOld, surface: 'apptool', coordinate: `apptool:${appId}/act`, appId,
      counterpartyGhii: authorGhii, chargedUnits: 5, unit: 'morsels',
    }),
    // Fourteen months and ten days: old enough to be in the archive by the time the job runs.
    openArch: open('open-arch', monthsAgo(14, 10), visitorArch),
  };
  const all = Object.values(rows);

  // The fold is CURRENT: its cursor is at NOW, so every row below is one it has already consumed.
  // Their rollups are then written the way the fold writes them, and the cursor stays where it is.
  await storage.setUsageCursor('call', NOW.toISOString(), '');
  await storage.appendUsageCall(all);
  const deltas = await pendingRollupDeltas(storage, 'call', all);
  await storage.advanceUsageRollup({ stream: 'call', deltas, lastTs: NOW.toISOString(), lastId: '' });

  // The archive sweep, bounded so it takes the ten-days-older open and nothing else.
  const archiveBefore = monthsAgo(14, 5);
  await storage.archiveUsageRows({ before: archiveBefore, pruneHourBefore: '0000', batch: 1000 });

  return { appId, author, filename, visitorOld, visitorNew, visitorArch, rows };
}

interface RawRow { ownerGhii: string; actorGaii: string; actorKind: string; ts: string; meta: unknown }

/** One raw row by id, from the hot table or the archive. The archive has no read door, by design. */
async function rawRow(p: Provider, table: 'hot' | 'archive', id: string): Promise<RawRow | undefined> {
  if (p.name === 'sqlite') {
    const db = (p.storage as unknown as { db: BetterSqlite3.Database }).db;
    const t = table === 'hot' ? 'usage_calls' : 'usage_calls_archive';
    const r = db.prepare(`SELECT ownerGhii, actorGaii, actorKind, ts, meta FROM ${t} WHERE id = ?`).get(id) as RawRow | undefined;
    return r ? { ...r, meta: JSON.parse(String(r.meta)) } : undefined;
  }
  const db = (p.storage as unknown as { db: Kysely<any> }).db;
  const t = table === 'hot' ? 'UsageCall' : 'UsageCallArchive';
  return await db.selectFrom(t).select(['ownerGhii', 'actorGaii', 'actorKind', 'ts', 'meta']).where('id', '=', id).executeTakeFirst() as RawRow | undefined;
}

const day = (iso: string): string => iso.slice(0, 10);

async function rollup(storage: Storage, cut: string, bucket: string, filter: { appId?: string; ownerGhii?: string } = {}): Promise<UsageRollupRow[]> {
  return storage.queryUsageRollup({ cut, grain: 'day', from: bucket, to: bucket, ...filter });
}

async function report(storage: Storage, s: Seeded): Promise<AppVisitorsReport> {
  // 500 days: wider than the App Catalog's 360, which cannot reach a folded day, on purpose.
  return readAppVisitors(storage, { app: { owner: s.author, filename: s.filename }, days: 500, geoAvailable: false });
}

describe('the cutoff', () => {
  it('is thirteen calendar months back, on the same day of the month', () => {
    expect(visitNameCutoffDay(NOW)).toBe('2025-08-25');
  });

  it('lands on the last day of a shorter month rather than spilling into the next', () => {
    expect(visitNameCutoffDay(new Date('2026-03-31T08:00:00.000Z'))).toBe('2025-02-28');
  });
});

describe('the cut table', () => {
  it('every call cut keyed by the visitor is either folded or named as the account\'s own activity', () => {
    // A cut added later that keys on ownerGhii or actorGaii makes this red until somebody decides
    // whether it is a visit record. Deciding by default is how a name outlives the promise.
    const keyedOnPerson = CUTS.filter(c => c.stream === 'call' && (c.dims.includes('ownerGhii') || c.dims.includes('actorGaii')))
      .map(c => c.name).sort();
    const decided = [...APP_VISIT_ROLLUP_CUTS, APP_USE_CUT, ...ACCOUNT_ACTIVITY_CUTS].sort();
    expect(keyedOnPerson).toEqual(decided);
  });

  it('the folded cuts are the ones that carry the app surface, so their rows are visits and nothing else', () => {
    for (const name of APP_VISIT_ROLLUP_CUTS) {
      const cut = CUTS.find(c => c.name === name);
      expect(cut?.dims, name).toContain('surface');
      expect(cut?.dims, name).toContain('ownerGhii');
    }
  });
});

describe('the harness itself', () => {
  // vitest swallows console.warn, so a postgres arm that failed to connect would skip in silence and
  // this file would pass having tested one provider. Make the skip loud.
  it('runs postgres whenever DATABASE_URL is set', () => {
    expect(provs.map(p => p.name)).toContain('sqlite');
    if (PG_URL) expect(provs.map(p => p.name)).toContain('postgres-kysely');
  });
});

/** Decided at collection time, so each provider's cases are reported on their own. */
const PROVIDER_NAMES: Array<Provider['name']> = PG_URL ? ['sqlite', 'postgres-kysely'] : ['sqlite'];

for (const providerName of PROVIDER_NAMES) describe(`folding the account out of visit records older than thirteen months, on ${providerName}`, () => {
  const pick = (): Provider[] => provs.filter(x => x.name === providerName);

  it('a fourteen-month-old visit names the visitor today and not after the job, in every place it was kept', async () => {
    for (const p of pick()) {
      const s = await seed(p.storage, p.name === 'sqlite' ? 'sq' : 'pg');
      const oldDay = day(s.rows.openOld1.ts);
      const archDay = day(s.rows.openArch.ts);

      // ── Before: still named, which is the control for everything below ──
      expect((await rawRow(p, 'hot', s.rows.openOld1.id))?.ownerGhii, `${p.name}: hot open before`).toBe(s.visitorOld);
      expect((await rawRow(p, 'archive', s.rows.openArch.id))?.ownerGhii, `${p.name}: archived open before`).toBe(s.visitorArch);
      const visitorBefore = await rollup(p.storage, 'call.app.visitor', oldDay, { appId: s.appId });
      expect(visitorBefore.some(r => r.ownerGhii === s.visitorOld), `${p.name}: visitor cut before`).toBe(true);

      await runVisitRetentionJob(p.storage, NOW);

      // ── The raw rows: the account is gone, the open is still there, on its day ──
      for (const id of [s.rows.openOld1.id, s.rows.openOld2.id]) {
        const r = await rawRow(p, 'hot', id);
        expect(r?.ownerGhii, `${p.name}: hot ${id} owner`).toBe(USAGE_FOLDED_VISITOR);
        expect(r?.actorGaii, `${p.name}: hot ${id} actor`).toBe(USAGE_FOLDED_VISITOR);
        expect(r?.ts, `${p.name}: hot ${id} keeps its day and nothing finer`).toBe(`${oldDay}T00:00:00.000Z`);
        expect(r?.actorKind, `${p.name}: hot ${id} still says a signed-in person came`).toBe('owner');
      }
      const arch = await rawRow(p, 'archive', s.rows.openArch.id);
      expect(arch?.ownerGhii, `${p.name}: archived open owner`).toBe(USAGE_FOLDED_VISITOR);
      expect(arch?.actorGaii, `${p.name}: archived open actor`).toBe(USAGE_FOLDED_VISITOR);
      expect(arch?.ts, `${p.name}: archived open day`).toBe(`${archDay}T00:00:00.000Z`);

      // ── The rollups that name a visitor of an app: folded into the unnamed row beside them ──
      for (const cut of APP_VISIT_ROLLUP_CUTS) {
        const rows = await rollup(p.storage, cut, oldDay);
        const mine = rows.filter(r => (r.appId === s.appId || r.coordinate === s.appId || cut === 'call.owner.surface'));
        expect(mine.some(r => r.ownerGhii === s.visitorOld && r.surface === 'app'), `${p.name}: ${cut} still names the visitor`).toBe(false);
      }
      const folded = (await rollup(p.storage, 'call.app.visitor', oldDay, { appId: s.appId }))
        .filter(r => r.ownerGhii === USAGE_FOLDED_VISITOR);
      expect(folded.length, `${p.name}: one unnamed row for the day`).toBe(1);
      expect(folded[0].calls, `${p.name}: both opens are still counted`).toBe(2);
      expect(folded[0].actorsSeen, `${p.name}: as one person`).toBe(1);
      const foldedTool = (await rollup(p.storage, 'call.owner.tool', oldDay, { ownerGhii: USAGE_FOLDED_VISITOR }))
        .filter(r => r.coordinate === s.appId);
      expect(foldedTool.map(r => r.calls), `${p.name}: call.owner.tool unnamed`).toEqual([2]);

      // ── The row that mixes the opens with a paid call: only the opens leave the name ──
      const appUse = await rollup(p.storage, APP_USE_CUT, oldDay, { appId: s.appId });
      const named = appUse.find(r => r.ownerGhii === s.visitorOld);
      expect(named?.calls, `${p.name}: the paid call stays with the person who paid`).toBe(1);
      expect(named?.chargedUnits, `${p.name}: and so does what it cost`).toBe(5);
      expect(appUse.find(r => r.ownerGhii === USAGE_FOLDED_VISITOR)?.calls, `${p.name}: the opens moved`).toBe(2);
    }
  }, 60_000);

  it('a twelve-month-old visit, a call of another kind and an anonymous open are untouched', async () => {
    for (const p of pick()) {
      const s = await seed(p.storage, p.name === 'sqlite' ? 'sq' : 'pg');
      await runVisitRetentionJob(p.storage, NOW);

      const recent = await rawRow(p, 'hot', s.rows.openNew.id);
      expect(recent?.ownerGhii, `${p.name}: twelve months is inside the window`).toBe(s.visitorNew);
      expect(recent?.ts, `${p.name}: and its time is kept to the second`).toBe(s.rows.openNew.ts);
      expect((await rollup(p.storage, 'call.app.visitor', day(s.rows.openNew.ts), { appId: s.appId }))
        .some(r => r.ownerGhii === s.visitorNew), `${p.name}: its rollup still names the visitor`).toBe(true);

      const mcp = await rawRow(p, 'hot', s.rows.mcpOld.id);
      expect(mcp?.ownerGhii, `${p.name}: a call of another kind is not a visit`).toBe(s.visitorOld);
      expect(mcp?.ts, `${p.name}: and keeps its time`).toBe(s.rows.mcpOld.ts);
      const tool = await rawRow(p, 'hot', s.rows.toolOld.id);
      expect(tool?.ownerGhii, `${p.name}: a paid tool call keeps its payer`).toBe(s.visitorOld);

      const anon = await rawRow(p, 'hot', s.rows.openAnon.id);
      expect(anon?.ownerGhii, `${p.name}: an open nobody was signed in for stays anonymous`).toBe('');
      expect(anon?.actorKind, `${p.name}: and says so`).toBe('anon');

      // The account's own activity total names no app, so it is not a visit record and stays whole.
      const activity = await rollup(p.storage, 'call.owner', day(s.rows.openOld1.ts), { ownerGhii: s.visitorOld });
      expect(activity.map(r => r.calls), `${p.name}: call.owner untouched`).toEqual([4]);
    }
  }, 60_000);

  it('the app owner\'s report gives the same totals before and after, and a second run changes nothing', async () => {
    for (const p of pick()) {
      const s = await seed(p.storage, p.name === 'sqlite' ? 'sq' : 'pg');
      const before = await report(p.storage, s);
      expect(before.opens.total, `${p.name}: five opens seeded`).toBe(5);

      const first = await runVisitRetentionJob(p.storage, NOW);
      // At least: a Postgres test database can hold an earlier run's rows of the same age.
      expect(first.hotRows + first.archiveRows, `${p.name}: the three old raw opens folded`).toBeGreaterThanOrEqual(3);
      const after = await report(p.storage, s);
      expect(after.opens.total, `${p.name}: total`).toBe(before.opens.total);
      expect(after.opens.signed_in, `${p.name}: signed in`).toBe(before.opens.signed_in);
      expect(after.opens.anonymous, `${p.name}: anonymous`).toBe(before.opens.anonymous);
      expect(after.opens.signed_in_people, `${p.name}: different people`).toBe(before.opens.signed_in_people);
      expect(after.opens.series, `${p.name}: every day`).toEqual(before.opens.series);
      expect(JSON.stringify(after), `${p.name}: and no visitor is named anywhere in it`).not.toContain(s.visitorOld);

      const second = await runVisitRetentionJob(p.storage, NOW);
      expect(second.hotRows + second.archiveRows + second.rollupRows, `${p.name}: nothing left to fold`).toBe(0);
      expect(await report(p.storage, s), `${p.name}: the report is stable`).toEqual(after);
    }
  }, 60_000);
});
