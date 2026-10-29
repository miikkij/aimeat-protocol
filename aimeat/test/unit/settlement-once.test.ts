/**
 * @file test/unit/settlement-once.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The database holds one federation_settlement ledger row per identity and tracking code,
 *   on both providers, so two node processes over one database cannot both record (and credit) one
 *   signed settlement (secaudit2026oct26 round 8c, federation-01; Postgres migration 0122, SQLite
 *   schema-settlement-once.ts). Every other ledger row is as before: the same tracking code under
 *   another type or another identity is taken. On SQLite, rows that already repeat a key are left as
 *   they are, and the index still refuses a new copy.
 * @usage cd aimeat && pnpm exec vitest run test/unit/settlement-once.test.ts
 *   (with DATABASE_URL set, the PostgreSQL half runs too)
 * @version-history
 *   2026-10-29 -- Initial (secaudit2026oct26 round 8c, federation-01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, WalletTransaction } from '../../src/storage/interface.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { settleOncePerTrackingCode, SETTLEMENT_ONCE_INDEX } from '../../src/storage/providers/sqlite/schema-settlement-once.js';

type TestStorage = Storage & { close(): void | Promise<void> };
const providers: Array<{ name: string; storage: TestStorage }> = [];
beforeAll(async () => {
  providers.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: ':memory:' }) as TestStorage });
  if (process.env.DATABASE_URL) {
    providers.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: process.env.DATABASE_URL }) as TestStorage });
  } else if (process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true') {
    throw new Error('The PostgreSQL half of settlement-once needs DATABASE_URL.');
  }
}, 60_000);

const written: Array<{ storage: TestStorage; gaii: string }> = [];
afterAll(async () => {
  for (const { storage, gaii } of written) {
    if (storage instanceof SqliteStorage) storage.db.prepare('DELETE FROM wallet_transactions WHERE gaii = ?').run(gaii);
    else await (storage as unknown as { db: { deleteFrom(t: string): { where(c: string, o: string, v: string): { execute(): Promise<unknown> } } } }).db.deleteFrom('Transaction').where('gaii', '=', gaii).execute();
  }
  for (const p of providers) await p.storage.close();
});

function row(gaii: string, trackingCode: string, type = 'federation_settlement'): WalletTransaction {
  return { id: `txn-${randomUUID()}`, gaii, type, amount: 10, counterpartyGaii: 'aimeat-peer-x', trackingCode, timestamp: new Date().toISOString() };
}

describe('one federation settlement row per identity and tracking code', () => {
  it.each(['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])])('%s: a second row for the same settlement is refused', async name => {
    const storage = providers.find(p => p.name === name)!.storage;
    const gaii = `settle-once-${randomUUID()}`;
    written.push({ storage, gaii });
    await storage.addTransaction(row(gaii, 'settle:tc-1'));
    await expect(storage.addTransaction(row(gaii, 'settle:tc-1'))).rejects.toThrow();
    expect((await storage.getTransactions(gaii)).filter(t => t.trackingCode === 'settle:tc-1')).toHaveLength(1);
  });

  it.each(['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])])('%s: designed use: other codes, other identities and other types are taken', async name => {
    const storage = providers.find(p => p.name === name)!.storage;
    const gaii = `settle-once-${randomUUID()}`;
    const other = `settle-once-${randomUUID()}`;
    written.push({ storage, gaii }, { storage, gaii: other });
    await storage.addTransaction(row(gaii, 'settle:tc-a'));
    await storage.addTransaction(row(gaii, 'settle:tc-b'));
    await storage.addTransaction(row(other, 'settle:tc-a'));
    await storage.addTransaction(row(gaii, 'settle:tc-a', 'work_payment'));
    await storage.addTransaction(row(gaii, 'settle:tc-a', 'work_payment'));
    expect(await storage.getTransactions(gaii)).toHaveLength(4);
  });
});

describe('SQLite: rows that already repeat a settlement stay, and a new copy is refused', () => {
  it('builds the index around the existing duplicates', () => {
    const storage = new SqliteStorage(':memory:');
    try {
      const db = storage.db;
      db.exec(`DROP INDEX ${SETTLEMENT_ONCE_INDEX}`);
      const insert = db.prepare('INSERT INTO wallet_transactions (id, gaii, type, amount, trackingCode, timestamp) VALUES (?, ?, ?, ?, ?, ?)');
      insert.run('old-1', 'pat@node', 'federation_settlement', 5, 'settle:dup', '2026-01-01T00:00:00.000Z');
      insert.run('old-2', 'pat@node', 'federation_settlement', 5, 'settle:dup', '2026-01-01T00:00:01.000Z');
      settleOncePerTrackingCode(db);
      const count = () => (db.prepare("SELECT COUNT(*) AS n FROM wallet_transactions WHERE trackingCode = 'settle:dup'").get() as { n: number }).n;
      expect(count()).toBe(2);
      expect(() => insert.run('new-3', 'pat@node', 'federation_settlement', 5, 'settle:dup', '2026-10-29T00:00:00.000Z')).toThrow(/UNIQUE/);
      expect(count()).toBe(2);
      // Run again on the next open: nothing changes.
      settleOncePerTrackingCode(db);
      expect(count()).toBe(2);
    } finally { storage.close(); }
  });
});
