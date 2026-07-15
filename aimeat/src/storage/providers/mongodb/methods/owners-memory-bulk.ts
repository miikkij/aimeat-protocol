/**
 * @file src/storage/providers/mongodb/methods/owners-memory-bulk.ts
 * @description Memory bulk/history storage methods for the shared Prisma backend (PrismaStorage, used by
 *   both MongoDB and PostgreSQL). Split out of ./owners.ts to keep that file ≤800 lines (max-file-lines);
 *   method bodies are verbatim, bound to PrismaStorage via the same prototype merge. Holds the version
 *   history read plus the Phase-1 bulk primitives (batched key read, bulk upsert, subtree delete).
 * @version-history
 *   v1.0.0 — 2026-07-15 — Extracted from owners.ts (listMemoryHistory + Phase-1 bulk primitives).
 */
import type { MemoryRecord } from '../../../interface.js';
import type { MemoryVersionRecord } from '../../../repositories/memory.repository.js';
import type { PrismaStorage, PrismaRow } from '../index.js';

export const ownerMemoryBulkMethods = {
    async listMemoryHistory(this: PrismaStorage, ownerGaii: string, key: string, opts?: { limit?: number }): Promise<MemoryVersionRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.memoryVersion.findMany({
            where: { ownerGaii, key },
            orderBy: { version: 'desc' },
            take: opts?.limit ?? 200,
        });
        return rows.map((r: PrismaRow) => ({
            ownerGaii: r.ownerGaii,
            key: r.key,
            version: r.version,
            value: r.value,
            actor: r.actor ?? null,
            event: r.event ?? null,
            recordedAt: r.recordedAt.toISOString(),
        }));
    },

    // BULK PRIMITIVE (Phase 1) — many keys under one owner in ONE `key IN (…)` query (findMany). Live
    // rows only (TTL-expired rows filtered like listAllMemory). Order not guaranteed — caller indexes by key.
    async getMemoryByKeys(this: PrismaStorage, ownerGaii: string, keys: string[]): Promise<MemoryRecord[]> {
        this.ensureReady();
        if (keys.length === 0) return [];
        const rows = await this.prisma.memory.findMany({ where: { ownerGaii, key: { in: keys } } });
        return rows
            .filter((r: PrismaRow) => !r.ttlHours || Date.now() <= new Date(r.createdAt).getTime() + r.ttlHours * 3600_000)
            .map((r: PrismaRow) => this.toMemoryRecord(r));
    },

    // BULK PRIMITIVE (Phase 1) — upsert many rows. Reuses setMemory per row (identical version/history/
    // byteSize semantics). NOTE: sequential for now — a true single-statement/transaction batched write
    // is a per-backend thin-adapter concern (Phase 4); the structural bulk-write win here comes from the
    // caller batching its READS (getMemoryByKeys + one count + one sum) instead of per-entry round-trips.
    async bulkSetMemory(this: PrismaStorage, records: MemoryRecord[]): Promise<MemoryRecord[]> {
        this.ensureReady();
        const out: MemoryRecord[] = [];
        for (const r of records) out.push(await this.setMemory(r));
        return out;
    },

    // BULK PRIMITIVE (Phase 1) — delete a record's whole family in ONE deleteMany: the base key plus its
    // `base.*` children (.draft/.latest/.version.N), WITHOUT matching a sibling `baseX` (startsWith
    // `base.` requires the dot). Replaces the per-key gated deletes a record teardown ran.
    async deleteMemorySubtree(this: PrismaStorage, ownerGaii: string, baseKey: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.memory.deleteMany({
            where: { ownerGaii, OR: [{ key: baseKey }, { key: { startsWith: baseKey + '.' } }] },
        });
        return result.count;
    },

    // BULK PRIMITIVE (Phase 2) — delete EVERY row under a key prefix, all owners, active AND archived, in
    // ONE deleteMany. Backs the workspace/organism wipe, replacing its per-key deleteMemory loop.
    async deleteMemoryByPrefix(this: PrismaStorage, keyPrefix: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.memory.deleteMany({ where: { key: { startsWith: keyPrefix } } });
        return result.count;
    },
};
