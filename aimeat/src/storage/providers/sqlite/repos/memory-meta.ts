/**
 * @file src/storage/providers/sqlite/repos/memory-meta.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The memory row's metadata projection for the SQLite memory methods: the projected
 *   columns, the row-to-meta mapping, and a keyspace listing run unpaged or with its SQL page.
 * @structure META_COLS · rowToMeta · allPaged
 * @usage import { META_COLS, rowToMeta, allPaged } from '../repos/memory-meta.js';   // in ../methods/memory.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Moved unchanged out of methods/memory.ts, which passed the 800-line limit when
 *     the wave 2 performance branches were merged (codebase analysis 2026-11-03).
 */
import type { MemoryListOpts, MemoryMetaRow } from '../../../repositories/memory.repository.js';
import type { SqliteStorage } from '../index.js';
import { memoryPageSql } from './memory.js';

/** The projected columns, in one place so the three reads below cannot drift apart on what META means. */
export const META_COLS = 'key, ownerGaii, visibility, groupId, workspaceRef, allowedOrigins, aiProvenanceId, '
  + 'archived, tags, version, flagCount, byteSize, ttlHours, createdAt, updatedAt';

/** Shared row→meta mapping for the projections below (tags parsed, defaults applied). */
export function rowToMeta(row: Record<string, unknown>): MemoryMetaRow {
  return {
    key: row.key as string,
    ownerGaii: row.ownerGaii as string,
    visibility: row.visibility as MemoryMetaRow['visibility'],
    tags: JSON.parse((row.tags as string) ?? '[]') as string[],
    version: row.version as number,
    flagCount: (row.flagCount as number | null) ?? 0,
    byteSize: (row.byteSize as number | null) ?? 0,
    ttlHours: (row.ttlHours as number | null) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
    groupId: (row.groupId as string | null) ?? null,
    workspaceRef: (row.workspaceRef as string | null) ?? null,
    allowedOrigins: row.allowedOrigins ? JSON.parse(row.allowedOrigins as string) as string[] : null,
    aiProvenanceId: (row.aiProvenanceId as string | null) ?? null,
    archived: !!row.archived,
  };
}

/** A keyspace listing's statement run unpaged, as it always was, or with the page memoryPageSql builds. */
export function allPaged(db: SqliteStorage['db'], sql: string, params: unknown[], opts: MemoryListOpts | undefined): Record<string, unknown>[] {
  const page = memoryPageSql(opts, new Date().toISOString());
  if (!page) return db.prepare(sql).all(...params) as Record<string, unknown>[];
  return db.prepare(sql + page.where + page.tail).all(...params, ...page.whereParams, ...page.tailParams) as Record<string, unknown>[];
}
