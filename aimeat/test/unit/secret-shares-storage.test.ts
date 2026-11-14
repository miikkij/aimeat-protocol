/**
 * @file test/unit/secret-shares-storage.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SecretShareRepository behaves the same on both storage providers: the create and
 *   read round trip with its JSON columns, the one-statement pickup count (a `once` share is picked
 *   up once; past its end it is refused), a request filled only once, a close that removes the
 *   content and refuses a second close, the expiry sweep, the member list, the owner delete, the
 *   share lists' limit and the purge of closed shares past a cutoff.
 *
 *   Runs SQLite always and PostgreSQL when DATABASE_URL is set (AIMEAT_CONFORMANCE_REQUIRE_POSTGRES=true
 *   makes a missing DATABASE_URL a failure). Every id carries a run tag, and the owner delete at the
 *   end removes what the run wrote, so a shared Postgres test database keeps nothing.
 * @usage cd aimeat && pnpm exec vitest run test/unit/secret-shares-storage.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial
 *   2026-11-14 — share lists' opts.limit; purgeClosedSecretShares.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import type { SecretShareRecord, SecretShareMember } from '../../src/storage/types/secret-shares.js';

const SQLITE_PATH = `./test/.secret-shares-storage-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const REQUIRE_POSTGRES = process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true';
const RUN = randomUUID().slice(0, 8);
const NODE = 'shares-node';
const ALICE = `alice-${RUN}@${NODE}`;
const BOB = `bob-${RUN}@${NODE}`;
const CAROL = `carol-${RUN}@${NODE}`;

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];

beforeAll(async () => {
  if (REQUIRE_POSTGRES && !PG_URL) throw new Error('Postgres conformance requires DATABASE_URL.');
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
  else console.warn('[secret-shares] DATABASE_URL not set — the Postgres half is skipped, sqlite still runs');
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) {
    for (const who of [ALICE, BOB, CAROL]) {
      await storage.deleteSecretSharesByOwner(who).catch(() => 0);
      await storage.deleteVaultDeviceKeysByOwner(who).catch(() => 0);
    }
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
  }
});

const T0 = '2026-11-14T10:00:00.000Z';
const T1 = '2026-11-14T11:00:00.000Z';
const T2 = '2026-11-14T12:00:00.000Z';
const T3 = '2026-11-14T13:00:00.000Z';

function share(over: Partial<SecretShareRecord> = {}): SecretShareRecord {
  return {
    id: `ss-${RUN}-${randomUUID().slice(0, 8)}`,
    ownerGhii: ALICE, createdBy: ALICE, organismId: null, kind: 'share',
    name: 'ELEVENLABS_API_KEY', note: 'for the narration app', secretFormat: 'text',
    fileName: null, fileType: null, ciphertext: 'iv:tag:ct', sizeBytes: 9,
    protectionLevel: 'open', recipients: { people: [BOB], agents: true, organism: false, code: false },
    codeHash: null, codeLogin: false, codeSalt: null,
    retention: 'once', maxPickups: 1, expiresAt: null, pickups: 0, status: 'ready',
    depositTokenHash: null, requestExpiresAt: null, depositedAt: T0, depositedBy: ALICE,
    check: { service: 'elevenlabs', ok: true, status: 200, account: 'ab12', facts: { plan: 'creator' }, at: T0 },
    e2eKeys: null, createdAt: T0, updatedAt: T0, revokedAt: null, revokedBy: null,
    ...over,
  };
}

const pickup = (id: string, ghii: string): SecretShareMember => ({ shareId: id, ghii, role: 'pickup' });

describe('secret shares storage', () => {
  it('create and get round trip keeps every field, JSON columns included', async () => {
    for (const { name, storage } of provs) {
      const rec = share({
        codeLogin: true, codeHash: 'h', codeSalt: 's', protectionLevel: 'e2e',
        e2eKeys: [{ ghii: BOB, keyId: 'k1', wrapped: 'w' }], organismId: `org-${RUN}`,
      });
      await storage.createSecretShare(rec, [pickup(rec.id, BOB)]);
      expect(await storage.getSecretShare(rec.id), name).toEqual(rec);
      expect(await storage.listSecretShareMembers(rec.id), name).toEqual([pickup(rec.id, BOB)]);
      expect((await storage.listSecretSharesByOrganisms([`org-${RUN}`])).map(s => s.id), name).toEqual([rec.id]);
      expect(await storage.listSecretSharesByOrganisms([]), name).toEqual([]);
      expect(await storage.getSecretShare(`ss-${RUN}-none`), name).toBeNull();
    }
  });

  it('a once share is picked up once; the second claim answers null', async () => {
    for (const { name, storage } of provs) {
      const rec = share();
      await storage.createSecretShare(rec, [pickup(rec.id, BOB)]);
      const first = await storage.claimSecretSharePickup(rec.id, T1);
      expect(first?.pickups, name).toBe(1);
      expect(first?.ciphertext, name).toBe('iv:tag:ct');
      expect(first?.updatedAt, name).toBe(T1);
      expect(await storage.claimSecretSharePickup(rec.id, T1), name).toBeNull();
      // Two claims at once on a fresh once share: exactly one gets a row.
      const race = share();
      await storage.createSecretShare(race, []);
      const both = await Promise.all([
        storage.claimSecretSharePickup(race.id, T1), storage.claimSecretSharePickup(race.id, T1),
      ]);
      expect(both.filter(Boolean).length, name).toBe(1);
    }
  });

  it('a claim past expiresAt is refused; before it, it counts', async () => {
    for (const { name, storage } of provs) {
      const rec = share({ retention: 'until', maxPickups: null, expiresAt: T2 });
      await storage.createSecretShare(rec, []);
      expect((await storage.claimSecretSharePickup(rec.id, T1))?.pickups, name).toBe(1);
      expect(await storage.claimSecretSharePickup(rec.id, T2), name).toBeNull();
      expect(await storage.claimSecretSharePickup(rec.id, T3), name).toBeNull();
      expect((await storage.getSecretShare(rec.id))?.pickups, name).toBe(1);
    }
  });

  it('a request is filled only once', async () => {
    for (const { name, storage } of provs) {
      const req = share({
        kind: 'request', status: 'waiting', ciphertext: null, sizeBytes: 0, check: null,
        depositedAt: null, depositedBy: null, depositTokenHash: 'dt', requestExpiresAt: T3,
      });
      await storage.createSecretShare(req, [{ shareId: req.id, ghii: BOB, role: 'deposit' }]);
      const fill = {
        ciphertext: 'iv:tag:filled', sizeBytes: 6, secretFormat: 'pairs' as const, fileName: null, fileType: null,
        check: { service: 'x', ok: false, status: 0, at: T1 }, e2eKeys: null, codeSalt: null,
        depositedAt: T1, depositedBy: BOB,
      };
      expect(await storage.depositSecretShare(req.id, fill), name).toBe(true);
      expect(await storage.depositSecretShare(req.id, { ...fill, ciphertext: 'second' }), name).toBe(false);
      const got = await storage.getSecretShare(req.id);
      expect(got?.status, name).toBe('ready');
      expect(got?.ciphertext, name).toBe('iv:tag:filled');
      expect(got?.secretFormat, name).toBe('pairs');
      expect(got?.check, name).toEqual(fill.check);
      expect(got?.updatedAt, name).toBe(T1);
      expect(got?.depositedBy, name).toBe(BOB);
    }
  });

  it('closeSecretShare removes the content and refuses a second close', async () => {
    for (const { name, storage } of provs) {
      const rec = share({ e2eKeys: [{ ghii: BOB, keyId: 'k', wrapped: 'w' }] });
      await storage.createSecretShare(rec, []);
      expect(await storage.closeSecretShare(rec.id, 'revoked', T1, ALICE), name).toBe(true);
      const got = await storage.getSecretShare(rec.id);
      expect(got, name).toMatchObject({ status: 'revoked', ciphertext: null, e2eKeys: null, revokedAt: T1, revokedBy: ALICE, updatedAt: T1 });
      expect(await storage.closeSecretShare(rec.id, 'ended', T2, null), name).toBe(false);
      expect(await storage.claimSecretSharePickup(rec.id, T2), name).toBeNull();

      const ended = share();
      await storage.createSecretShare(ended, []);
      expect(await storage.closeSecretShare(ended.id, 'ended', T1, ALICE), name).toBe(true);
      expect(await storage.getSecretShare(ended.id), name).toMatchObject({ status: 'ended', ciphertext: null, revokedAt: null, revokedBy: null });
    }
  });

  it('endExpiredSecretShares ends ready shares past their end and waiting requests past their time', async () => {
    for (const { name, storage } of provs) {
      const past = share({ retention: 'until', maxPickups: null, expiresAt: T1 });
      const future = share({ retention: 'until', maxPickups: null, expiresAt: T3 });
      const keep = share({ retention: 'keep', maxPickups: null, expiresAt: null });
      const lateReq = share({ kind: 'request', status: 'waiting', ciphertext: null, requestExpiresAt: T1 });
      const openReq = share({ kind: 'request', status: 'waiting', ciphertext: null, requestExpiresAt: T3 });
      for (const r of [past, future, keep, lateReq, openReq]) await storage.createSecretShare(r, []);
      const ids = await storage.endExpiredSecretShares(T2);
      const mine = new Set([past.id, future.id, keep.id, lateReq.id, openReq.id]);
      expect(ids.filter(id => mine.has(id)).sort(), name).toEqual([past.id, lateReq.id].sort());
      expect(await storage.getSecretShare(past.id), name).toMatchObject({ status: 'ended', ciphertext: null });
      expect((await storage.getSecretShare(future.id))?.status, name).toBe('ready');
      expect((await storage.getSecretShare(keep.id))?.status, name).toBe('ready');
      expect((await storage.getSecretShare(openReq.id))?.status, name).toBe('waiting');
      expect((await storage.endExpiredSecretShares(T2)).filter(id => mine.has(id)), name).toEqual([]);
    }
  });

  it('listSecretSharesForMember answers the shares naming a person in a role, newest first', async () => {
    for (const { name, storage } of provs) {
      const older = share({ ownerGhii: CAROL, createdBy: CAROL, createdAt: T0 });
      const newer = share({ ownerGhii: CAROL, createdBy: CAROL, createdAt: T2 });
      const req = share({ ownerGhii: CAROL, createdBy: CAROL, kind: 'request', status: 'waiting', ciphertext: null, createdAt: T1 });
      await storage.createSecretShare(older, [pickup(older.id, BOB)]);
      await storage.createSecretShare(newer, [pickup(newer.id, BOB)]);
      await storage.createSecretShare(req, [{ shareId: req.id, ghii: BOB, role: 'deposit' }]);
      const forBob = (await storage.listSecretSharesForMember(BOB, 'pickup')).filter(s => s.ownerGhii === CAROL);
      expect(forBob.map(s => s.id), name).toEqual([newer.id, older.id]);
      const toFill = (await storage.listSecretSharesForMember(BOB, 'deposit')).filter(s => s.ownerGhii === CAROL);
      expect(toFill.map(s => s.id), name).toEqual([req.id]);
      const byCarol = await storage.listSecretSharesByOwner(CAROL);
      expect(byCarol.map(s => s.id), name).toEqual([newer.id, req.id, older.id]);
    }
  });

  it('events are listed newest first, at most limit', async () => {
    for (const { name, storage } of provs) {
      const rec = share();
      await storage.createSecretShare(rec, []);
      for (const [i, at] of [T0, T1, T2].entries()) {
        await storage.addSecretShareEvent({
          id: `ev-${RUN}-${name}-${i}`, shareId: rec.id, at, kind: i === 0 ? 'created' : 'picked_up',
          actor: BOB, onBehalfOf: BOB, detail: { to: 'reveal' },
        });
      }
      const evs = await storage.listSecretShareEvents(rec.id, 2);
      expect(evs.map(e => e.at), name).toEqual([T2, T1]);
      expect(evs[0].detail, name).toEqual({ to: 'reveal' });
    }
  });

  it('vault device keys: put, replace, list, delete', async () => {
    for (const { name, storage } of provs) {
      const key = { ownerGhii: BOB, keyId: `k-${RUN}`, publicKey: '{"kty":"EC"}', label: 'laptop', createdAt: T0, lastUsedAt: null };
      await storage.putVaultDeviceKey(key);
      await storage.putVaultDeviceKey({ ...key, label: 'work laptop', lastUsedAt: T1 });
      expect(await storage.listVaultDeviceKeys(BOB), name).toEqual([{ ...key, label: 'work laptop', lastUsedAt: T1 }]);
      expect(await storage.deleteVaultDeviceKey(BOB, key.keyId), name).toBe(true);
      expect(await storage.deleteVaultDeviceKey(BOB, key.keyId), name).toBe(false);
      await storage.putVaultDeviceKey(key);
      expect(await storage.deleteVaultDeviceKeysByOwner(BOB), name).toBe(1);
    }
  });

  it('deleteSecretSharesByOwner removes the shares, their events and members, and the owner\'s member rows on others', async () => {
    for (const { name, storage } of provs) {
      const owner = `dave-${RUN}-${name}@${NODE}`;
      const other = `erin-${RUN}-${name}@${NODE}`;
      const a = share({ ownerGhii: owner, createdBy: owner });
      const b = share({ ownerGhii: owner, createdBy: owner });
      const theirs = share({ ownerGhii: other, createdBy: other });
      await storage.createSecretShare(a, [pickup(a.id, other)]);
      await storage.createSecretShare(b, []);
      await storage.createSecretShare(theirs, [pickup(theirs.id, owner), pickup(theirs.id, BOB)]);
      await storage.addSecretShareEvent({ id: `ev-${RUN}-${name}-del`, shareId: a.id, at: T1, kind: 'created', actor: owner, onBehalfOf: owner, detail: {} });
      await storage.addSecretShareEvent({ id: `ev-${RUN}-${name}-keep`, shareId: theirs.id, at: T1, kind: 'created', actor: other, onBehalfOf: other, detail: {} });

      expect(await storage.deleteSecretSharesByOwner(owner), name).toBe(2);
      expect(await storage.getSecretShare(a.id), name).toBeNull();
      expect(await storage.getSecretShare(b.id), name).toBeNull();
      expect(await storage.listSecretShareEvents(a.id, 10), name).toEqual([]);
      expect(await storage.listSecretShareMembers(a.id), name).toEqual([]);
      expect(await storage.listSecretSharesForMember(owner, 'pickup'), name).toEqual([]);
      // The other person's share, its event and its other member stay.
      expect((await storage.getSecretShare(theirs.id))?.id, name).toBe(theirs.id);
      expect(await storage.listSecretShareMembers(theirs.id), name).toEqual([pickup(theirs.id, BOB)]);
      expect((await storage.listSecretShareEvents(theirs.id, 10)).length, name).toBe(1);
      expect(await storage.deleteSecretSharesByOwner(owner), name).toBe(0);
      await storage.deleteSecretSharesByOwner(other);
    }
  });

  it('the share lists answer at most opts.limit, newest first; 0 and junk fall back to the bounds', async () => {
    for (const { name, storage } of provs) {
      const owner = `fran-${RUN}-${name}@${NODE}`;
      const org = `org-lim-${RUN}-${name}`;
      const times = [T0, T1, T2, T3];
      const recs = times.map(t => share({ ownerGhii: owner, createdBy: owner, organismId: org, createdAt: t }));
      for (const r of recs) await storage.createSecretShare(r, [pickup(r.id, CAROL), { shareId: r.id, ghii: CAROL, role: 'deposit' }]);
      const newestTwo = [recs[3].id, recs[2].id];
      expect((await storage.listSecretSharesByOwner(owner, { limit: 2 })).map(s => s.id), name).toEqual(newestTwo);
      expect((await storage.listSecretSharesByOrganisms([org], { limit: 2 })).map(s => s.id), name).toEqual(newestTwo);
      const forCarol = await storage.listSecretSharesForMember(CAROL, 'pickup', { limit: 2 });
      expect(forCarol.length, name).toBe(2);
      // Without opts the default (500) answers all four; a limit under 1 still answers one row.
      expect((await storage.listSecretSharesByOwner(owner)).length, name).toBe(4);
      expect((await storage.listSecretSharesByOwner(owner, { limit: 0 })).map(s => s.id), name).toEqual([recs[3].id]);
      expect((await storage.listSecretSharesByOwner(owner, { limit: Number.NaN })).length, name).toBe(4);
      await storage.deleteSecretSharesByOwner(owner);
    }
  });

  it('purgeClosedSecretShares removes closed shares older than the cutoff with their events and members', async () => {
    for (const { name, storage } of provs) {
      const owner = `gus-${RUN}-${name}@${NODE}`;
      const mk = (over: Partial<SecretShareRecord>) => share({ ownerGhii: owner, createdBy: owner, ...over });
      const oldEnded = mk({ status: 'ended', ciphertext: null, updatedAt: T0 });
      const oldRevoked = mk({ status: 'revoked', ciphertext: null, updatedAt: T0, revokedAt: T0, revokedBy: owner });
      const recentEnded = mk({ status: 'ended', ciphertext: null, updatedAt: T3 });
      const oldReady = mk({ status: 'ready', updatedAt: T0 });
      const oldWaiting = mk({ kind: 'request', status: 'waiting', ciphertext: null, updatedAt: T0 });
      const all = [oldEnded, oldRevoked, recentEnded, oldReady, oldWaiting];
      for (const r of all) {
        await storage.createSecretShare(r, [pickup(r.id, BOB)]);
        await storage.addSecretShareEvent({ id: `ev-${r.id}`, shareId: r.id, at: T0, kind: 'created', actor: owner, onBehalfOf: owner, detail: {} });
      }

      // Other runs' closed shares may also be past T2 in a shared database, so count only ours.
      const purged = await storage.purgeClosedSecretShares(T2);
      expect(purged, name).toBeGreaterThanOrEqual(2);
      for (const gone of [oldEnded, oldRevoked]) {
        expect(await storage.getSecretShare(gone.id), name).toBeNull();
        expect(await storage.listSecretShareEvents(gone.id, 10), name).toEqual([]);
        expect(await storage.listSecretShareMembers(gone.id), name).toEqual([]);
      }
      for (const kept of [recentEnded, oldReady, oldWaiting]) {
        expect((await storage.getSecretShare(kept.id))?.id, name).toBe(kept.id);
        expect((await storage.listSecretShareEvents(kept.id, 10)).length, name).toBe(1);
        expect(await storage.listSecretShareMembers(kept.id), name).toEqual([pickup(kept.id, BOB)]);
      }
      expect((await storage.listSecretSharesByOwner(owner)).map(s => s.id).sort(), name)
        .toEqual([recentEnded.id, oldReady.id, oldWaiting.id].sort());
      await storage.deleteSecretSharesByOwner(owner);
    }
  });

  it('a malformed JSON column reads as its empty default (sqlite)', async () => {
    const sqlite = provs.find(p => p.name === 'sqlite')!.storage as unknown as {
      db: { prepare(s: string): { run(...a: unknown[]): unknown } };
    } & Storage;
    const rec = share();
    await sqlite.createSecretShare(rec, []);
    sqlite.db.prepare('UPDATE secret_shares SET recipients = ?, "check" = ?, e2eKeys = ? WHERE id = ?')
      .run('{not json', '[1]', '"x"', rec.id);
    const got = await sqlite.getSecretShare(rec.id);
    expect(got?.recipients).toEqual({ people: [], agents: false, organism: false, code: false });
    expect(got?.check).toBeNull();
    expect(got?.e2eKeys).toBeNull();
  });
});
