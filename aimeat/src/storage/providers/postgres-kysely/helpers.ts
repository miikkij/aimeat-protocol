/**
 * @file src/storage/providers/postgres-kysely/helpers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared row↔record mapping + value helpers for the Postgres+Kysely memory methods. Keeps
 *   the JSONB/tsvector/byteSize conventions in one place so every method serialises a MemoryRecord the
 *   same way (matching the Mongo/SQLite backends: byteSize = utf8 bytes of the JSON value; searchBlob =
 *   key + tags + recursively-collected scalar values, which the DB turns into the ranked tsvector).
 * @version-history
 *   2026-10-18 — scopeListIs: the condition of the scope-list compare-and-swap (check:atomic-writes, boot migrations).
 *   2026-10-15 — buildSearchBlob moved to storage/search-text.ts and is re-exported here, so SQLite indexes the same text (feature-list audit #52).
 *   v1.0.0 — 2026-07-15 — Phase 5: memory-domain mappers + jsonb param helper.
 */
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { MemoryRecord } from '../../interface.js';
import type { MemoryMetaRow } from '../../repositories/memory.repository.js';
import type { Memory } from './db-types.js';

/** utf8 byte length of a value's JSON encoding — the stored per-row byteSize (quota accounting). */
export const byteSize = (value: unknown): number => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');

/** The FTS source text for a row. One definition for both providers, in storage/search-text.ts, so
 *  the SQLite index holds the same text (feature-list audit #52). */
export { buildSearchBlob } from '../../search-text.js';

/** A jsonb parameter — pass a JS value, get a `<json>::jsonb` fragment (handles objects, arrays, null
 *  uniformly, unlike node-pg's default object/array coercion). */
export const jsonb = (value: unknown) => sql<unknown>`${JSON.stringify(value ?? null)}::jsonb`;

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

/** Map a full Memory row to a MemoryRecord (drops null optionals so the shape matches the other backends). */
export function rowToRecord(r: Selectable<Memory>): MemoryRecord {
  const rec: MemoryRecord = {
    key: r.key,
    ownerGaii: r.ownerGaii,
    value: r.value,
    visibility: r.visibility as MemoryRecord['visibility'],
    tags: r.tags ?? [],
    ttlHours: r.ttlHours,
    version: r.version,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    flagCount: r.flagCount,
    trackable: r.trackable,
    archived: r.archived,
  };
  if (r.groupId) rec.groupId = r.groupId;
  if (r.workspaceRef) rec.workspaceRef = r.workspaceRef;
  if (r.allowedOrigins && r.allowedOrigins.length) rec.allowedOrigins = r.allowedOrigins;
  if (r.archivedAt) rec.archivedAt = iso(r.archivedAt);
  if (r.archivedBy) rec.archivedBy = r.archivedBy;
  if (r.archivedRoot) rec.archivedRoot = r.archivedRoot;
  if (r.deletedAt) { rec.deletedAt = (r.deletedAt instanceof Date ? r.deletedAt.toISOString() : String(r.deletedAt)); rec.deletedBy = r.deletedBy ?? null; }
  if (r.aiProvenanceId) rec.aiProvenanceId = r.aiProvenanceId;
  return rec;
}

/** The value-free META projection (`?include=meta`). */
export function rowToMeta(r: Pick<Selectable<Memory>, 'key' | 'ownerGaii' | 'visibility' | 'tags' | 'version' | 'flagCount' | 'byteSize' | 'ttlHours' | 'createdAt' | 'updatedAt' | 'groupId' | 'workspaceRef' | 'allowedOrigins' | 'aiProvenanceId' | 'archived'>): MemoryMetaRow {
  return {
    key: r.key,
    ownerGaii: r.ownerGaii,
    visibility: r.visibility as MemoryRecord['visibility'],
    tags: r.tags ?? [],
    version: r.version,
    flagCount: r.flagCount,
    byteSize: r.byteSize,
    ttlHours: r.ttlHours ?? null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    // The audience and the provenance — see MemoryMetaRow. `visibility` says "group"; groupId says which.
    groupId: r.groupId ?? null,
    workspaceRef: r.workspaceRef ?? null,
    allowedOrigins: r.allowedOrigins ?? null,
    aiProvenanceId: r.aiProvenanceId ?? null,
    archived: !!r.archived,
  };
}

/**
 * The condition of a scope-list compare-and-swap (setAgentScopesIf and its twins): the text[] column
 * still holds exactly the list the caller read. An empty list also matches NULL, because the readers
 * map both to "no words". One UPDATE carries it, so two writers cannot both pass it.
 */
export function scopeListIs(column: string, expected: readonly string[]) {
  return expected.length === 0
    ? sql<boolean>`(${sql.ref(column)} IS NULL OR ${sql.ref(column)} = '{}'::text[])`
    : sql<boolean>`${sql.ref(column)} = ${sql.val([...expected])}::text[]`;
}

/** Whether a TTL'd row is still live (matches the other backends' expiry check). */
export const isLive = (r: { ttlHours: number | null; createdAt: Date | string }): boolean =>
  !r.ttlHours || Date.now() <= (r.createdAt instanceof Date ? r.createdAt.getTime() : new Date(r.createdAt).getTime()) + r.ttlHours * 3600_000;

/**
 * Wrap a provider-level failure so it carries the method that failed, and rethrow it.
 *
 * Why this exists: these methods used to end in `catch { return null; }`. Every caller reads `null`
 * as "no such row", so a failed write was indistinguishable from a missing record — on the PRIMARY
 * production backend, while the SQLite provider (which throws) kept local tests green. That pairing
 * is what let an extension upsert report `200 success:true` over code it never wrote. `null` now
 * means exactly one thing: no row matched. Everything else reaches the route's error handler, which
 * already turns it into a 500.
 */
export function dbError(method: string, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`${method} failed: ${message}`, { cause: err });
}
