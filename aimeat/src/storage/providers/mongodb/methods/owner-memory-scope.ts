/**
 * @file src/storage/providers/mongodb/methods/owner-memory-scope.ts
 * @description Owner-scope memory reads (Prisma): the value-free ?include=meta projection and the
 *   single-query cross-identity list/meta variants. Split out of owners.ts to keep every method-group
 *   file <=800 lines; bound to PrismaStorage via prototype merge (same as the other method groups).
 * @version-history
 *   v1.0.0 - 2026-07-15 - Extracted from owners.ts (max-file-lines) during the owner-scope query perf pass.
 */
import type { MemoryRecord } from '../../../interface.js';
import type { PrismaStorage, PrismaRow } from '../index.js';

export const ownerMemoryScopeMethods = {
    async listMemoryMeta(this: PrismaStorage, ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number; archived?: import('../../../interface.js').ArchiveFilter }): Promise<import('../../../repositories/memory.repository.js').MemoryMetaRow[]> {
        this.ensureReady();
        const where: Record<string, unknown> = { ownerGaii, ...this.archivedWhere(opts?.archived) };
        if (opts?.prefix) where.key = { startsWith: opts.prefix };
        if (opts?.visibility) where.visibility = opts.visibility;
        if (opts?.tags?.length) where.tags = { hasSome: opts.tags };
        // META projection: `select` the metadata + byteSize columns only — the (potentially large)
        // `value` is NEVER read from the DB. ttlHours + createdAt come along only for lazy TTL pruning.
        const rows = await this.prisma.memory.findMany({
            where,
            select: { key: true, ownerGaii: true, visibility: true, tags: true, version: true, flagCount: true, byteSize: true, ttlHours: true, createdAt: true, updatedAt: true },
        });
        return rows
            .filter((r: PrismaRow) => !r.ttlHours || Date.now() <= new Date(r.createdAt).getTime() + r.ttlHours * 3600_000)
            .filter((r: PrismaRow) => opts?.maxFlags === undefined || (r.flagCount ?? 0) <= opts.maxFlags)
            .map((r: PrismaRow) => ({
                key: r.key,
                ownerGaii: r.ownerGaii,
                visibility: r.visibility,
                tags: Array.isArray(r.tags) ? r.tags : [],
                version: r.version,
                flagCount: r.flagCount ?? 0,
                byteSize: r.byteSize ?? 0,
                createdAt: new Date(r.createdAt).toISOString(),
                updatedAt: new Date(r.updatedAt).toISOString(),
            }));
    },

    async listMemoryForOwners(this: PrismaStorage, ownerGaiis: string[], opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number; archived?: import('../../../interface.js').ArchiveFilter }): Promise<MemoryRecord[]> {
        this.ensureReady();
        if (ownerGaiis.length === 0) return [];
        // Like listMemory, but ONE query across all the owner's identities (ownerGaii IN …) — the
        // owner-scope union in a single round-trip instead of one listMemory per identity. Dedup by
        // key (GHII-first) is done by the caller (services/owner-memory.ts).
        const where: Record<string, unknown> = { ownerGaii: { in: ownerGaiis }, ...this.archivedWhere(opts?.archived) };
        if (opts?.prefix) where.key = { startsWith: opts.prefix };
        if (opts?.visibility) where.visibility = opts.visibility;
        if (opts?.tags?.length) where.tags = { hasSome: opts.tags };
        const rows = await this.prisma.memory.findMany({ where });
        return rows
            .filter((r: PrismaRow) => !r.ttlHours || Date.now() <= new Date(r.createdAt).getTime() + r.ttlHours * 3600_000)
            .map((r: PrismaRow) => this.toMemoryRecord(r))
            .filter((r: MemoryRecord) => opts?.maxFlags === undefined || (r.flagCount ?? 0) <= opts.maxFlags);
    },

    async listMemoryMetaForOwners(this: PrismaStorage, ownerGaiis: string[], opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number; archived?: import('../../../interface.js').ArchiveFilter }): Promise<import('../../../repositories/memory.repository.js').MemoryMetaRow[]> {
        this.ensureReady();
        if (ownerGaiis.length === 0) return [];
        const where: Record<string, unknown> = { ownerGaii: { in: ownerGaiis }, ...this.archivedWhere(opts?.archived) };
        if (opts?.prefix) where.key = { startsWith: opts.prefix };
        if (opts?.visibility) where.visibility = opts.visibility;
        if (opts?.tags?.length) where.tags = { hasSome: opts.tags };
        const rows = await this.prisma.memory.findMany({
            where,
            select: { key: true, ownerGaii: true, visibility: true, tags: true, version: true, flagCount: true, byteSize: true, ttlHours: true, createdAt: true, updatedAt: true },
        });
        return rows
            .filter((r: PrismaRow) => !r.ttlHours || Date.now() <= new Date(r.createdAt).getTime() + r.ttlHours * 3600_000)
            .filter((r: PrismaRow) => opts?.maxFlags === undefined || (r.flagCount ?? 0) <= opts.maxFlags)
            .map((r: PrismaRow) => ({
                key: r.key, ownerGaii: r.ownerGaii, visibility: r.visibility, tags: Array.isArray(r.tags) ? r.tags : [],
                version: r.version, flagCount: r.flagCount ?? 0, byteSize: r.byteSize ?? 0,
                createdAt: new Date(r.createdAt).toISOString(), updatedAt: new Date(r.updatedAt).toISOString(),
            }));
    },
};
