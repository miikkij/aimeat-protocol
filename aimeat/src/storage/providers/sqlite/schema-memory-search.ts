/**
 * @file src/storage/providers/sqlite/schema-memory-search.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The text the SQLite full-text index holds for a memory row, on the PostgreSQL rule.
 *
 *   The FTS5 tables (memory_fts, memory_archive_fts) indexed the raw JSON of each value, so a search
 *   matched FIELD NAMES at ANY depth, while PostgreSQL production matches only the scalar values to six
 *   levels (storage/search-text.ts). The memory row now carries `searchValues`, the text
 *   searchValueText() produces, written by setMemory and createMemoryIfAbsent; the FTS triggers in
 *   schema.ts index that column (feature-list audit #52).
 *
 *   A row written before the column existed has `searchValues` NULL. This fills it once, at start, in
 *   one transaction; the memory_fts_au trigger then re-indexes each row it updates, so the index holds
 *   the new text without a separate rebuild. A database whose rows all carry the column does nothing
 *   here beyond one indexed count.
 * @structure backfillMemorySearchValues(db)
 * @usage backfillMemorySearchValues(db);   // from initializeSchema in schema.ts, after the FTS triggers
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #52).
 */
import type Database from 'better-sqlite3';
import { searchValueText } from '../../search-text.js';
import { logger } from '../../../utils/logger.js';

/**
 * A stored value as the search text reads it. setMemory always writes JSON; a column that does not
 * parse is indexed as the text it holds, so the row stays findable rather than stopping the start.
 */
function parseStoredValue(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn('memory search backfill: a stored value is not JSON, indexing it as text', { error: String(err) });
    return raw;
  }
}

/** Fill `searchValues` for every memory row that has none. Returns how many rows it filled. */
export function backfillMemorySearchValues(db: Database.Database): number {
  const rows = db.prepare('SELECT rowid AS id, value FROM memory WHERE searchValues IS NULL').all() as { id: number; value: string | null }[];
  if (rows.length === 0) return 0;
  const update = db.prepare('UPDATE memory SET searchValues = ? WHERE rowid = ?');
  const fill = db.transaction((batch: { id: number; value: string | null }[]) => {
    for (const r of batch) update.run(searchValueText(parseStoredValue(r.value)), r.id);
  });
  fill(rows);
  return rows.length;
}
