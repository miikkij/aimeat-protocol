/**
 * @file test/unit/wallet-lifetime-sums.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/wallet's lifetime figures from the database's per-type totals
 *   (lifetimeFromTypeSums over storage.sumTransactionsByType(undefined, gaii)) are the figures the
 *   route computed from the rows before (lifetimeOf over getTransactions): every field, on a ledger of
 *   every row kind with positive and negative rows of one kind, and another person's rows left out.
 *   The route read up to 100 000 rows on every page's header for these; at 50 000 rows that was
 *   172 ms on PostgreSQL (2026-11-09). Run on SQLite; the PostgreSQL method is the same GROUP BY.
 * @usage cd aimeat && pnpm exec vitest run test/unit/wallet-lifetime-sums.test.ts
 * @version-history
 *   2026-11-09 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { lifetimeOf, lifetimeFromTypeSums } from '../../src/services/wallet-stats.js';

const NODE = 'wallet-node';
const ALICE = `alice@${NODE}`;
const BOB = `bob@${NODE}`;

async function person(storage: SqliteStorage, name: string): Promise<void> {
    const now = new Date().toISOString();
    await storage.createOwner({ name, publicKey: 'x', roles: ['owner'], createdAt: now });
    await storage.createGHII({
        username: name, nodeId: NODE, ghii: `${name}@${NODE}`, displayName: name, ownerName: name,
        verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now,
    } as never);
}

describe('lifetime figures from per-type totals', () => {
    it('equal the figures computed from the rows, and leave another person out', async () => {
        const storage = new SqliteStorage(':memory:');
        await person(storage, 'alice');
        await person(storage, 'bob');
        // Every kind lifetimeOf treats differently: granted kinds, a purchase, earned kinds, and a kind
        // with both signs (a refund on top of spending).
        const rows: Array<[string, number]> = [
            ['welcome_bonus', 1000], ['allowance', 10], ['daily_allowance', 5], ['mint', 3], ['pacing_pack', 50],
            ['earned', 7], ['extension_earn', 190], ['offer_fee', 2],
            ['spent', -20], ['escrow_hold', -15], ['escrow_release', 15], ['escrow_release', -4], ['spent', -1],
        ];
        let n = 0;
        for (const [type, amount] of rows) {
            await storage.addTransaction({ id: `a-${n++}`, gaii: ALICE, type, amount, timestamp: new Date(Date.now() - n * 1000).toISOString() });
        }
        await storage.addTransaction({ id: 'b-1', gaii: BOB, type: 'earned', amount: 999, timestamp: new Date().toISOString() });

        const balance = 1300;
        const fromRows = lifetimeOf(await storage.getTransactions(ALICE, 100_000), balance);
        const fromSums = lifetimeFromTypeSums(await storage.sumTransactionsByType(undefined, ALICE), balance);
        expect(fromSums).toEqual(fromRows);
        expect(fromSums.total_rows).toBe(rows.length);
        // earned: 7 + 190 + 2 and the positive escrow_release 15; granted kinds and purchases are not.
        expect(fromSums.earned).toBe(214);
    });

    it('is all zeros for a ledger with no rows', async () => {
        const storage = new SqliteStorage(':memory:');
        await person(storage, 'alice');
        expect(lifetimeFromTypeSums(await storage.sumTransactionsByType(undefined, ALICE), 40))
            .toEqual(lifetimeOf([], 40));
    });
});
