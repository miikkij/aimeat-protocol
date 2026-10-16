/**
 * @file test/unit/storage-fault-injection.test.ts
 * @description Fault-injecting tests for multi-step writes (QA audit W26: E6-01, E6-02, E6-03,
 *   D4-10/E6-05, F10b-02, E6-07). Each case makes one step fail, or two writers overlap, and asks for
 *   the outcome the code promises. They run on SQLite always and on PostgreSQL when DATABASE_URL is
 *   set, because several of these defects exist only on PostgreSQL: a statement the database rejects
 *   inside a transaction marks the whole transaction failed there, and two requests interleave there
 *   for real, while SQLite keeps going after a failed statement and runs one statement at a time.
 * @structure
 *   - provider list (SQLite file, PostgreSQL when DATABASE_URL is set)
 *   - injected(): a Proxy over a storage that replaces chosen methods
 *   - rejectByDatabase(): make the database itself refuse a statement inside the open transaction
 *   - one describe per finding
 * @usage cd aimeat && pnpm exec vitest run test/unit/storage-fault-injection.test.ts
 *        DATABASE_URL=postgresql://… pnpm exec vitest run test/unit/storage-fault-injection.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit W26).
 */
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, OrganismRecord, WorkRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { deactivateOwner } from '../../src/services/owner-lifecycle.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';
import { createAccountRows } from '../../src/services/owner-provisioning.js';
import { deliverWork } from '../../src/services/work-lifecycle.js';
import { recordAppAudit, readAppAudit } from '../../src/services/app-audit.js';
import { PostgresKyselyStorage } from '../../src/storage/providers/postgres-kysely/index.js';
import { logger } from '../../src/utils/logger.js';

const SQLITE_PATH = `./test/.fault-injection-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const NODE = 'fault-node';

interface Provider { name: 'sqlite' | 'postgres-kysely'; storage: Storage }
const provs: Provider[] = [];
let config: AimeatConfig;

beforeAll(async () => {
  config = { ...loadConfig().config, nodeId: NODE, baseUrl: 'https://fault.test', aiProvenance: false, welcomeBonus: 10 };
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
  console.info(`[fault-injection] providers: ${provs.map(p => p.name).join(', ')}`);
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) await (storage as unknown as { close?: () => unknown }).close?.();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
  }
});

/** A Proxy over `storage` whose listed methods are replaced; everything else is the real method. */
function injected(storage: Storage, overrides: Partial<Record<keyof Storage, (...args: never[]) => unknown>>): Storage {
  return new Proxy(storage, {
    get(target, prop, receiver) {
      if (prop in overrides) return (overrides as Record<string | symbol, unknown>)[prop];
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/** Make the DATABASE refuse a statement inside the open transaction (not a JavaScript throw). */
async function rejectByDatabase(p: Provider): Promise<never> {
  if (p.name === 'postgres-kysely') {
    await sql`select 1/0`.execute((p.storage as unknown as PostgresKyselyStorage).db);
  } else {
    (p.storage as unknown as { db: { exec(s: string): void } }).db.exec('SELECT * FROM aimeat_no_such_table');
  }
  throw new Error('unreachable: the database accepted the statement');
}

const stamp = () => new Date().toISOString();
const uniq = (base: string) => `${base}${randomUUID().slice(0, 8)}`;

async function seedAccount(storage: Storage, name: string): Promise<string> {
  const ghii = `${name}@${NODE}`;
  await storage.createOwner({ name, publicKey: 'k', roles: ['owner'], createdAt: stamp() });
  await storage.createGHII({ username: name, nodeId: NODE, ghii, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, morselBalance: 100, createdAt: stamp(), updatedAt: stamp() } as never);
  return ghii;
}

describe('E6-01: a step that fails inside the deactivation transaction', () => {
  it.each(['sqlite', 'postgres-kysely'] as const)('%s: the flag lands, the failed step is reported, the other steps commit', async (which) => {
    const p = provs.find(x => x.name === which);
    if (!p) return;
    const name = uniq('leaver');
    await seedAccount(p.storage, name);
    const s = injected(p.storage, { revokeAllSessions: (() => rejectByDatabase(p)) as never });
    const result = await deactivateOwner(s, name, 'operator-test');
    expect(result.incomplete).toContain('sessions');
    const after = await p.storage.getOwner(name);
    expect(after?.disabledAt, 'the deactivation flag must be stored although one step failed').toBeTruthy();
    await p.storage.deleteOwner(name);
  });

  it.each(['sqlite', 'postgres-kysely'] as const)('%s: erasure goes through although one clean-up step failed', async (which) => {
    const p = provs.find(x => x.name === which);
    if (!p) return;
    const name = uniq('erased');
    await seedAccount(p.storage, name);
    const s = injected(p.storage, { deleteAllMemory: (() => rejectByDatabase(p)) as never });
    await eraseOwner(s, NODE, name);
    expect(await p.storage.getOwner(name), 'one broken step must not block the erasure').toBeNull();
  });
});

describe('E6-02: the account rows are written together or not at all', () => {
  it.each(['sqlite', 'postgres-kysely'] as const)('%s: a failed profile write leaves no owner row behind', async (which) => {
    const p = provs.find(x => x.name === which);
    if (!p) return;
    const name = uniq('newbie');
    const s = injected(p.storage, { createGHII: (() => Promise.reject(new Error('injected profile failure'))) as never });
    await expect(createAccountRows(s, config, { name, publicKey: 'k', roles: ['owner'], createdAt: stamp() }, {
      username: name, nodeId: NODE, ghii: `${name}@${NODE}`, displayName: name, verificationLevel: 0, totpEnabled: false,
      morselBalance: 10, createdAt: stamp(), updatedAt: stamp(),
    })).rejects.toThrow('injected profile failure');
    expect(await p.storage.getOwner(name), 'the name must stay free for a retry').toBeNull();
  });
});

describe('E6-03: a delivery whose status write fails settles nothing', () => {
  it.each(['sqlite', 'postgres-kysely'] as const)('%s: the provider is credited once, on the delivery that landed', async (which) => {
    const p = provs.find(x => x.name === which);
    if (!p) return;
    const provider = await seedAccount(p.storage, uniq('prov'));
    const requester = await seedAccount(p.storage, uniq('req'));
    const trackingCode = `wk-${randomUUID()}`;
    const work: WorkRecord = {
      trackingCode, status: 'accepted', actionId: 'act', providerGaii: provider, requesterGaii: requester, input: {},
      cost: { toll: 7, networkFee: 0, total: 7, inEscrow: 7 }, ttlExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      createdAt: stamp(), updatedAt: stamp(),
    };
    await p.storage.createWork(work);
    const before = (await p.storage.getGHII(provider))!.morselBalance ?? 0;

    let failOnce = true;
    const s = injected(p.storage, {
      updateWork: ((code: string, patch: Partial<WorkRecord>) => {
        if (failOnce) { failOnce = false; return Promise.reject(new Error('injected status write failure')); }
        return p.storage.updateWork(code, patch);
      }) as never,
    });
    await expect(deliverWork({ storage: s, config }, provider, trackingCode, { done: true })).rejects.toThrow('injected status write failure');
    expect((await p.storage.getGHII(provider))!.morselBalance ?? 0, 'a failed delivery must not credit the provider').toBe(before);
    expect((await p.storage.getWork(trackingCode))!.status).toBe('accepted');

    const ok = await deliverWork({ storage: s, config }, provider, trackingCode, { done: true });
    expect(ok.ok).toBe(true);
    expect((await p.storage.getGHII(provider))!.morselBalance ?? 0, 'credited exactly once').toBe(before + 7);
  });
});

describe('D4-10 / E6-05: deleteOrganism', () => {
  async function seedOrganism(storage: Storage, id: string, boardId: string, member: string): Promise<void> {
    await storage.createBoard({ id: boardId, name: 'b', visibility: 'private', ownerGaii: member, allowedGaiis: [], createdAt: stamp() });
    await storage.createOrganism({
      id, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: member, createdBy: member, owners: [member],
      admins: [member], members: [member], agentGaiis: [], boardId, joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: `organism.${id}`, createdAt: stamp(), updatedAt: stamp(),
    } as OrganismRecord);
    await storage.createMembership({ id: `m-${id}`, organismId: id, ghii: member, role: 'creator', status: 'active', joinedAt: stamp() } as never);
  }

  it.each(['sqlite', 'postgres-kysely'] as const)('%s: answers false for an organism that does not exist', async (which) => {
    const p = provs.find(x => x.name === which);
    if (!p) return;
    expect(await p.storage.deleteOrganism(`org-missing-${randomUUID()}`)).toBe(false);
  });

  it.each(['sqlite', 'postgres-kysely'] as const)('%s: a failure in the middle leaves the organism whole', async (which) => {
    const p = provs.find(x => x.name === which);
    if (!p) return;
    const id = `org-${randomUUID().slice(0, 8)}`;
    const boardId = `board-${randomUUID().slice(0, 8)}`;
    const member = await seedAccount(p.storage, uniq('orgo'));
    await seedOrganism(p.storage, id, boardId, member);
    const trig = `aimeat_test_fail_${randomUUID().slice(0, 8)}`;
    if (p.name === 'postgres-kysely') {
      const db = (p.storage as unknown as PostgresKyselyStorage).rootDb;
      await sql.raw(`CREATE OR REPLACE FUNCTION ${trig}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected board delete failure'; END $$ LANGUAGE plpgsql`).execute(db);
      await sql.raw(`CREATE TRIGGER ${trig} BEFORE DELETE ON "Board" FOR EACH ROW EXECUTE FUNCTION ${trig}()`).execute(db);
    } else {
      (p.storage as unknown as { db: { exec(s: string): void } }).db.exec(
        `CREATE TEMP TRIGGER ${trig} BEFORE DELETE ON boards BEGIN SELECT RAISE(ABORT, 'injected board delete failure'); END`);
    }
    try {
      await expect(p.storage.deleteOrganism(id)).rejects.toThrow();
      expect(await p.storage.getOrganism(id), 'the organism stays').not.toBeNull();
      expect(await p.storage.getMembership(id, member), 'its members stay').not.toBeNull();
    } finally {
      if (p.name === 'postgres-kysely') {
        const db = (p.storage as unknown as PostgresKyselyStorage).rootDb;
        await sql.raw(`DROP TRIGGER IF EXISTS ${trig} ON "Board"`).execute(db);
        await sql.raw(`DROP FUNCTION IF EXISTS ${trig}()`).execute(db);
      } else {
        (p.storage as unknown as { db: { exec(s: string): void } }).db.exec(`DROP TRIGGER IF EXISTS ${trig}`);
      }
    }
    expect(await p.storage.deleteOrganism(id)).toBe(true);
    expect(await p.storage.getMembership(id, member)).toBeNull();
  });
});

describe('D4-10: concurrent writers of one trackable key', () => {
  it.each(['sqlite', 'postgres-kysely'] as const)('%s: ten overlapping writes keep ten versions', async (which) => {
    const p = provs.find(x => x.name === which);
    if (!p) return;
    const owner = `tk${randomUUID().slice(0, 6)}@${NODE}`;
    const key = 'fault.trackable';
    await p.storage.setMemory({ key, ownerGaii: owner, value: { n: 0 }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: stamp(), updatedAt: stamp(), trackable: true });
    await Promise.all(Array.from({ length: 10 }, (_, i) => p.storage.setMemory({
      key, ownerGaii: owner, value: { n: i + 1 }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: stamp(), updatedAt: stamp(),
    })));
    const now = await p.storage.getMemory(owner, key);
    expect(now?.version, 'every write bumps the version once').toBe(11);
    const history = await p.storage.listMemoryHistory(owner, key, { limit: 100 });
    expect(new Set(history.map(h => h.version)).size, 'every earlier value is in the history').toBe(10);
    await p.storage.deleteAllMemory(owner);
  });
});

describe('F10b-02: overlapping audited changes', () => {
  it.each(['sqlite', 'postgres-kysely'] as const)('%s: twelve overlapping entries all survive', async (which) => {
    const p = provs.find(x => x.name === which);
    if (!p) return;
    const owner = `au${randomUUID().slice(0, 6)}@${NODE}`;
    await Promise.all(Array.from({ length: 12 }, (_, i) => recordAppAudit(p.storage, {
      ownerGhii: owner, filename: 'app.html', by: `agent${i}#x@${NODE}`, action: 'settings', detail: { i } as never,
    })));
    const entries = await readAppAudit(p.storage, owner, 'app.html');
    expect(entries.length, 'no entry may be overwritten by a concurrent one').toBe(12);
    await p.storage.deleteAllMemory(owner);
  });

  it('a write that fails for good is logged at error level and does not throw', async () => {
    const p = provs[0];
    const err = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const s = injected(p.storage, {
      getMemory: (() => Promise.reject(new Error('injected read failure'))) as never,
    });
    await expect(recordAppAudit(s, { ownerGhii: `x@${NODE}`, filename: 'a.html', by: 'b', action: 'settings' })).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('app-audit'), expect.objectContaining({ action: 'settings' }));
    err.mockRestore();
  });
});

describe('E6-07: the PostgreSQL pool has time limits', () => {
  it('a statement that runs past the limit is ended, and a wait for a connection ends with a log line', async () => {
    if (!PG_URL) return;
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const store = new PostgresKyselyStorage(PG_URL, { connectionWaitMs: 300, statementMs: 800, lockMs: 800, idleInTransactionMs: 5_000, maxConnections: 1 });
    try {
      await store.ready;
      const t0 = Date.now();
      await expect(sql`select pg_sleep(3)`.execute(store.rootDb)).rejects.toThrow(/statement timeout|canceling statement/i);
      expect(Date.now() - t0).toBeLessThan(2_500);

      // The one connection is busy for ~0.6 s; a second query waits 0.3 s and must reject.
      const busy = sql`select pg_sleep(0.6)`.execute(store.rootDb);
      await expect(sql`select 1`.execute(store.rootDb)).rejects.toThrow(/timeout exceeded when trying to connect/);
      await busy;
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('waited the whole limit'), expect.objectContaining({ wait_ms: 300 }));
    } finally {
      warn.mockRestore();
      await store.close();
    }
  }, 20_000);
});
