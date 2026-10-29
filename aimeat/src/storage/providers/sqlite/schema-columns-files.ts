/**
 * @file sqlite/schema-columns-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The storage_files columns added after the table, for existing SQLite databases: the
 *   UTF-8 verdict, the AI-provenance record and the object reference of a file whose bytes live in an
 *   S3 or Azure Blob store. Called by initializeSchema where the provenance column was always added.
 * @structure applyFileColumns
 * @usage applyFileColumns(safeAddColumn, sql => db.exec(sql));
 * @version-history
 *   v1.0.0 — 2026-10-29 — utf8Verified and aiProvenanceId (with its index) moved out of schema.ts
 *     unchanged (max-file-lines), plus storage_files.blobRef and its index (mirrors Postgres 0121;
 *     wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import type { SafeAddColumn } from './schema-columns-scheduler.js';

export function applyFileColumns(safeAddColumn: SafeAddColumn, exec: (sql: string) => void): void {
  // TARGET-063: does the whole file decode as UTF-8? Settled on write, so a byte-range or HEAD
  // response can name the charset without loading the file. No DEFAULT: NULL means "not
  // established", which is a different thing from "not UTF-8" and is read as such.
  safeAddColumn('storage_files', 'utf8Verified', 'INTEGER');
  // A stored file's AI-provenance record, and the index PUBLICLY_LINKED reads. Mirrors Postgres 0096.
  safeAddColumn('storage_files', 'aiProvenanceId', 'TEXT');
  exec('CREATE INDEX IF NOT EXISTS idx_storage_files_ai_provenance ON storage_files(aiProvenanceId) WHERE aiProvenanceId IS NOT NULL;');
  // Where the bytes are when the row does not hold them: "<storeId>|<objectKey>", NULL for a file
  // whose bytes are in `data`. The index serves the orphan sweep. Mirrors Postgres 0121.
  safeAddColumn('storage_files', 'blobRef', 'TEXT');
  exec('CREATE INDEX IF NOT EXISTS idx_storage_files_blob_ref ON storage_files(blobRef) WHERE blobRef IS NOT NULL;');
}
