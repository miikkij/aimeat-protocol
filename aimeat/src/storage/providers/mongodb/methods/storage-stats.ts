/**
 * @file storage-stats.ts
 * @description Operator storage-growth telemetry (admin Database tab) for the Prisma backends: per-table
 *   live row counts (backend-specific — exact count(*) on Postgres, collection counts on MongoDB) plus the
 *   generic hourly-snapshot CRUD. Shared by the MongoDB and PostgreSQL(Prisma) providers via the same
 *   `this.backendKind()` branch used elsewhere.
 * @version-history
 *   v1.0.0 -- 2026-07-16 -- Initial: getTableRowCounts + snapshot save/list/prune.
 */
import type { StorageStatsSnapshot } from '../../../interface.js';
import type { PrismaStorage } from '../index.js';

export const storageStatsMethods = {
    async getTableRowCounts(this: PrismaStorage): Promise<Record<string, number>> {
        const counts: Record<string, number> = {};
        if (this.backendKind() === 'postgresql') {
            // Exact count(*) per table in one round-trip. pg_stat's n_live_tup is instant but reads 0 until
            // autovacuum analyses (wrong for an accounting tool); a once-an-hour scan buys correct numbers.
            const tbls = await this.prisma.$queryRawUnsafe(
                `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`) as Array<{ table_name: string }>;
            if (tbls.length === 0) return counts;
            const union = tbls
                .map(r => `SELECT '${r.table_name.replace(/'/g, "''")}' AS t, count(*)::bigint AS n FROM "${r.table_name.replace(/"/g, '""')}"`)
                .join(' UNION ALL ');
            const rows = await this.prisma.$queryRawUnsafe(union) as Array<{ t: string; n: number | bigint }>;
            for (const r of rows) counts[r.t] = Number(r.n);
            return counts;
        }
        // MongoDB: enumerate collections and count each.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listed = await this.prisma.$runCommandRaw({ listCollections: 1, nameOnly: true }) as any;
        const names: string[] = (listed?.cursor?.firstBatch ?? []).map((c: { name: string }) => c.name).filter((n: string) => !n.startsWith('system.'));
        for (const name of names) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const res = await this.prisma.$runCommandRaw({ count: name }) as any;
                counts[name] = Number(res?.n ?? 0);
            } catch { counts[name] = 0; }
        }
        return counts;
    },
    async saveStorageStatsSnapshot(this: PrismaStorage, s: StorageStatsSnapshot): Promise<void> {
        await this.prisma.storageStatsSnapshot.upsert({
            where: { id: s.id },
            create: { id: s.id, capturedAt: new Date(s.capturedAt), counts: s.counts, totalRows: s.totalRows },
            update: { capturedAt: new Date(s.capturedAt), counts: s.counts, totalRows: s.totalRows },
        });
    },
    async listStorageStatsSnapshots(this: PrismaStorage, opts?: { limit?: number; sinceIso?: string }): Promise<StorageStatsSnapshot[]> {
        const rows = await this.prisma.storageStatsSnapshot.findMany({
            where: opts?.sinceIso ? { capturedAt: { gte: new Date(opts.sinceIso) } } : undefined,
            orderBy: { capturedAt: 'desc' },
            take: opts?.limit,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return rows.map((r: any) => ({
            id: r.id, capturedAt: new Date(r.capturedAt).toISOString(),
            counts: (r.counts ?? {}) as Record<string, number>, totalRows: r.totalRows,
        }));
    },
    async pruneStorageStatsSnapshots(this: PrismaStorage, beforeIso: string): Promise<number> {
        const res = await this.prisma.storageStatsSnapshot.deleteMany({ where: { capturedAt: { lt: new Date(beforeIso) } } });
        return res.count;
    },
};
