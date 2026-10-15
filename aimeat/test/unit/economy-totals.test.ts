/**
 * @file test/unit/economy-totals.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The admin dashboard's economy figures (feature-list audit #169). Morsels in
 *   circulation were summed from agent rows, which always hold 0; the "all time" ledger figures were
 *   summed from listAllTransactions, which stops at the newest 10 000 rows. morselsInCirculation()
 *   sums the account holders' balances, and storage.sumTransactionsByType() sums the whole ledger in
 *   the database. Run on SQLite; the PostgreSQL method is the same GROUP BY.
 * @usage cd aimeat && pnpm exec vitest run test/unit/economy-totals.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #169).
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { morselsInCirculation } from '../../src/services/morsel.js';

const NODE = 'economy-node';

async function person(storage: SqliteStorage, name: string, balance: number): Promise<void> {
    const now = new Date().toISOString();
    await storage.createOwner({ name, publicKey: 'x', roles: ['owner'], createdAt: now });
    await storage.createGHII({
        username: name, nodeId: NODE, ghii: `${name}@${NODE}`, displayName: name, ownerName: name,
        verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now,
    } as never);
    await storage.updateGHII(`${name}@${NODE}`, { morselBalance: balance } as never);
}

describe('morselsInCirculation', () => {
    it('is the account holders\' balances, a person with no agent included', async () => {
        const storage = new SqliteStorage(':memory:');
        await person(storage, 'alice', 120);
        await person(storage, 'bob', 30);
        expect(await morselsInCirculation(storage)).toBe(150);
    });
});

describe('sumTransactionsByType', () => {
    it('sums the whole ledger, past the 10 000 rows listAllTransactions returns', async () => {
        const storage = new SqliteStorage(':memory:');
        const db = (storage as unknown as { db: Database.Database }).db;
        const insert = db.prepare('INSERT INTO wallet_transactions (id, gaii, type, amount, timestamp) VALUES (?, ?, ?, ?, ?)');
        const old = '2025-01-01T00:00:00.000Z';
        db.transaction(() => {
            for (let i = 0; i < 10_005; i++) insert.run(`tx-${i}`, `alice@${NODE}`, 'mint', 1, old);
            insert.run('tx-burn', `alice@${NODE}`, 'burn', -4, new Date().toISOString());
        })();

        expect((await storage.listAllTransactions()).length).toBe(10_000);
        const all = await storage.sumTransactionsByType();
        expect(all.find(r => r.type === 'mint')).toEqual({ type: 'mint', count: 10_005, total: 10_005, absTotal: 10_005 });
        expect(all.find(r => r.type === 'burn')).toEqual({ type: 'burn', count: 1, total: -4, absTotal: 4 });

        const today = new Date(); today.setUTCHours(0, 0, 0, 0);
        const since = await storage.sumTransactionsByType(today.toISOString());
        expect(since).toEqual([{ type: 'burn', count: 1, total: -4, absTotal: 4 }]);
    });
});
