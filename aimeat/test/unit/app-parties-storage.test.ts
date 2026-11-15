/**
 * @file test/unit/app-parties-storage.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AppPartyRepository behaves the same on both storage providers: the insert under the cap
 *   (an address already there, the cap reached and nothing written, the stale signups dropped only by an
 *   insert that fits, and two signups at once never both taking the last place), the lookups by address,
 *   name and link hash, the version-conditional update (the second writer loses), the page and the counts,
 *   the collections (a new key refused past the per-party count, the shared ones apart), and the three
 *   deletes: one person with their collections, one app, and the owner's erasure.
 *
 *   Runs SQLite always and PostgreSQL when DATABASE_URL is set (AIMEAT_CONFORMANCE_REQUIRE_POSTGRES=true
 *   makes a missing DATABASE_URL a failure). Every id carries a run tag, and the owner delete at the end
 *   removes what the run wrote.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-parties-storage.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import { APP_PARTY_SHARED, type Storage, type AppPartyRow } from '../../src/storage/interface.js';

const SQLITE_PATH = `./test/.app-parties-storage-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const REQUIRE_POSTGRES = process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true';
const RUN = randomUUID().slice(0, 8);
const NODE = 'ap-node';
const ALICE = `alice-${RUN}@${NODE}`;
const BOB = `bob-${RUN}@${NODE}`;

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];

beforeAll(async () => {
  if (REQUIRE_POSTGRES && !PG_URL) throw new Error('Postgres conformance requires DATABASE_URL.');
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
  else console.warn('[app-parties-storage] DATABASE_URL not set — the Postgres half is skipped, sqlite still runs');
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) {
    for (const who of [ALICE, BOB]) await storage.deleteAppPartiesByOwner(who).catch(() => 0);
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
  }
});

const NOW = '2026-11-15T12:00:00.000Z';
const OLD = '2026-11-01T12:00:00.000Z';
/** Pending rows whose pendingSince is before this are stale. */
const RULE = { now: NOW, staleBefore: '2026-11-14T12:00:00.000Z' };

let seq = 0;
function row(owner: string, appId: string, over: Partial<AppPartyRow> = {}): AppPartyRow {
  const n = ++seq;
  const uid = `u-${RUN}-${n}`;
  return {
    uid, ownerGhii: owner, appId, name: `ap-${RUN}${n}`, emailHash: `h-${RUN}-${n}`, status: 'active',
    linkHash: null, linkExpiresAt: null, verifiedAt: OLD, pendingSince: OLD, epoch: 0,
    record: { uid, note: 'whole record' }, createdAt: `2026-11-0${(n % 9) + 1}T00:00:00.000Z`, updatedAt: OLD, version: 1,
    ...over,
  };
}

describe.each([0, 1])('AppPartyRepository on provider #%s', (i) => {
  const p = () => provs[i];

  it('inserts under the cap, answers exists for an address already there, and full without writing', async () => {
    if (!p()) return;
    const s = p().storage;
    const app = `alice-${RUN}/cap-${i}.html`;
    const a = row(ALICE, app);
    expect((await s.insertAppPartyCapped(a, 2, RULE)).outcome).toBe('created');
    expect((await s.insertAppPartyCapped({ ...row(ALICE, app), emailHash: a.emailHash }, 2, RULE)).outcome).toBe('exists');
    expect((await s.insertAppPartyCapped(row(ALICE, app), 2, RULE)).outcome).toBe('created');
    const full = await s.insertAppPartyCapped(row(ALICE, app), 2, RULE);
    expect(full.outcome).toBe('full');
    expect(await s.countAppParties(app)).toBe(2);
    // The whole record comes back as written.
    expect((await s.getAppParty(app, a.uid))?.record).toEqual(a.record);
  });

  it('drops stale signups only on an insert that fits, and counts live places by the rule', async () => {
    if (!p()) return;
    const s = p().storage;
    const app = `alice-${RUN}/stale-${i}.html`;
    const stale = row(ALICE, app, { status: 'pending', verifiedAt: null, pendingSince: OLD });
    const fresh = row(ALICE, app, { status: 'pending', verifiedAt: null, pendingSince: NOW });
    const linkOpen = row(ALICE, app, { status: 'pending', verifiedAt: null, pendingSince: OLD, linkHash: 'L', linkExpiresAt: '2026-11-15T12:30:00.000Z' });
    for (const r of [stale, fresh, linkOpen]) expect((await s.insertAppPartyCapped(r, 10, { now: NOW, staleBefore: null })).outcome).toBe('created');
    expect(await s.countAppParties(app)).toBe(3);
    expect(await s.countAppParties(app, RULE)).toBe(2);
    // Cap 2: two live places are taken, so the insert is refused and the stale row stays.
    expect((await s.insertAppPartyCapped(row(ALICE, app), 2, RULE)).outcome).toBe('full');
    expect(await s.getAppParty(app, stale.uid)).not.toBeNull();
    // Cap 3: it fits, and the stale row goes in the same transaction, with its collections.
    await s.putAppPartyData({ appId: app, partyUid: stale.uid, key: 'cart', ownerGhii: ALICE, value: { a: 1 }, bytes: 7, updatedAt: NOW }, 20);
    const out = await s.insertAppPartyCapped(row(ALICE, app), 3, RULE);
    expect(out.outcome).toBe('created');
    expect(out.dropped.map(d => d.uid)).toEqual([stale.uid]);
    expect(await s.getAppParty(app, stale.uid)).toBeNull();
    expect(await s.getAppPartyData(app, stale.uid, 'cart')).toBeNull();
  });

  it('never lets two signups at once take the last place', async () => {
    if (!p()) return;
    const s = p().storage;
    const app = `alice-${RUN}/race-${i}.html`;
    const outs = await Promise.all(Array.from({ length: 6 }, () => s.insertAppPartyCapped(row(ALICE, app), 3, RULE)));
    expect(outs.filter(o => o.outcome === 'created')).toHaveLength(3);
    expect(await s.countAppParties(app)).toBe(3);
  });

  it('finds by address, name and link hash, only inside the app', async () => {
    if (!p()) return;
    const s = p().storage;
    const app = `alice-${RUN}/find-${i}.html`;
    const r = row(ALICE, app, { linkHash: `link-${RUN}-${i}`, linkExpiresAt: NOW });
    await s.insertAppPartyCapped(r, 10, RULE);
    expect((await s.findAppParty(app, { emailHash: r.emailHash }))?.uid).toBe(r.uid);
    expect((await s.findAppParty(app, { name: r.name }))?.uid).toBe(r.uid);
    expect((await s.findAppParty(app, { linkHash: r.linkHash! }))?.uid).toBe(r.uid);
    expect(await s.findAppParty(`alice-${RUN}/other-${i}.html`, { emailHash: r.emailHash })).toBeNull();
    expect(await s.findAppParty(app, {})).toBeNull();
  });

  it('replaces a row only on the version read: the second writer loses', async () => {
    if (!p()) return;
    const s = p().storage;
    const app = `alice-${RUN}/cas-${i}.html`;
    const r = row(ALICE, app);
    await s.insertAppPartyCapped(r, 10, RULE);
    expect(await s.updateAppParty({ ...r, epoch: 1 }, 1)).toBe(true);
    expect(await s.updateAppParty({ ...r, epoch: 9 }, 1)).toBe(false);
    const now = await s.getAppParty(app, r.uid);
    expect(now?.epoch).toBe(1);
    expect(now?.version).toBe(2);
  });

  it('lists a page oldest first', async () => {
    if (!p()) return;
    const s = p().storage;
    const app = `alice-${RUN}/page-${i}.html`;
    const rows = [row(ALICE, app, { createdAt: '2026-11-03T00:00:00.000Z' }), row(ALICE, app, { createdAt: '2026-11-01T00:00:00.000Z' }), row(ALICE, app, { createdAt: '2026-11-02T00:00:00.000Z' })];
    for (const r of rows) await s.insertAppPartyCapped(r, 10, RULE);
    const page1 = await s.listAppParties(app, { limit: 2 });
    const page2 = await s.listAppParties(app, { limit: 2, offset: 2 });
    expect(page1.map(r => r.createdAt)).toEqual(['2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z']);
    expect(page2.map(r => r.createdAt)).toEqual(['2026-11-03T00:00:00.000Z']);
  });

  it('keeps collections per party, refuses a new key past the count, and keeps the shared ones apart', async () => {
    if (!p()) return;
    const s = p().storage;
    const app = `alice-${RUN}/data-${i}.html`;
    const r = row(ALICE, app);
    await s.insertAppPartyCapped(r, 10, RULE);
    const put = (partyUid: string, key: string, value: unknown) =>
      s.putAppPartyData({ appId: app, partyUid, key, ownerGhii: ALICE, value, bytes: 1, updatedAt: NOW }, 2);
    expect(await put(r.uid, 'a', { x: 1 })).toEqual({ stored: true, version: 1 });
    expect(await put(r.uid, 'a', { x: 2 })).toEqual({ stored: true, version: 2 });
    expect((await put(r.uid, 'b', [1, 2])).stored).toBe(true);
    expect((await put(r.uid, 'c', 'no room')).stored).toBe(false);
    expect((await put(APP_PARTY_SHARED, 'prices', { eur: 5 })).stored).toBe(true);
    expect((await s.getAppPartyData(app, r.uid, 'a'))?.value).toEqual({ x: 2 });
    expect((await s.getAppPartyData(app, APP_PARTY_SHARED, 'prices'))?.value).toEqual({ eur: 5 });
    expect(await s.deleteAppPartyData(app, r.uid, 'b')).toBe(true);
    expect(await s.deleteAppPartyData(app, r.uid, 'b')).toBe(false);
    // Removing the person removes what they kept, not what the app shares.
    expect(await s.deleteAppParty(app, r.uid)).toEqual({ removed: true, data: 1 });
    expect((await s.deleteAppParty(app, r.uid)).removed).toBe(false);
    expect(await s.getAppPartyData(app, r.uid, 'a')).toBeNull();
    expect(await s.getAppPartyData(app, APP_PARTY_SHARED, 'prices')).not.toBeNull();
  });

  it('removes a whole app, and the owner erasure removes every row of the owner and no other', async () => {
    if (!p()) return;
    const s = p().storage;
    const app = `alice-${RUN}/gone-${i}.html`;
    const kept = `bob-${RUN}/kept-${i}.html`;
    const a = row(ALICE, app);
    const b = row(BOB, kept);
    await s.insertAppPartyCapped(a, 10, RULE);
    await s.insertAppPartyCapped(b, 10, RULE);
    await s.putAppPartyData({ appId: app, partyUid: a.uid, key: 'k', ownerGhii: ALICE, value: 1, bytes: 1, updatedAt: NOW }, 20);
    await s.putAppPartyData({ appId: app, partyUid: APP_PARTY_SHARED, key: 'k', ownerGhii: ALICE, value: 1, bytes: 1, updatedAt: NOW }, 20);
    const gone = await s.deleteAppPartiesByApp(app);
    expect(gone.parties.map(x => x.uid)).toEqual([a.uid]);
    expect(gone.data).toBe(2);
    expect(await s.countAppParties(app)).toBe(0);

    const app2 = `alice-${RUN}/erase-${i}.html`;
    await s.insertAppPartyCapped(row(ALICE, app2), 10, RULE);
    expect(await s.deleteAppPartiesByOwner(ALICE)).toBeGreaterThan(0);
    expect(await s.countAppParties(app2)).toBe(0);
    expect(await s.getAppParty(kept, b.uid)).not.toBeNull();
  });

  it('imports by uid: inserted, then present, and a conflict for an address another uid holds', async () => {
    if (!p()) return;
    const s = p().storage;
    const app = `bob-${RUN}/import-${i}.html`;
    const r = row(BOB, app);
    expect(await s.importAppParty(r)).toBe('inserted');
    expect(await s.importAppParty(r)).toBe('present');
    expect(await s.importAppParty({ ...row(BOB, app), emailHash: r.emailHash })).toBe('conflict');
    expect(await s.importAppParty({ ...row(BOB, app), name: r.name })).toBe('conflict');
  });
});
