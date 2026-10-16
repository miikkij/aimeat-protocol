/**
 * @file src/storage/repositories/schema.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-interface segment for locked memory schemas (CSM/MSM) — the contract each
 *   backend implements to set/get/delete/list schemas and resolve the schema applicable to a memory key.
 *
 * @structure
 *   - SchemaRepository: interface with setSchema, getSchema (exact|prefix), deleteSchema,
 *     listSchemas, findApplicableSchema
 *
 * @version-history
 *   2026-10-16 — deleteSchema takes an optional applyTo, so one row of a pattern can go without the
 *     other principal's row beside it (QA audit S2-04).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { SchemaRecord } from '../interface.js';

export interface SchemaRepository {
  setSchema(record: SchemaRecord): Promise<SchemaRecord>;
  getSchema(keyPattern: string, applyTo?: 'exact' | 'prefix'): Promise<SchemaRecord | null>;
  /** Without `applyTo`, every row of the pattern; with it, that one row (the table key is both). */
  deleteSchema(keyPattern: string, applyTo?: 'exact' | 'prefix'): Promise<boolean>;
  listSchemas(prefix?: string): Promise<SchemaRecord[]>;
  findApplicableSchema(memoryKey: string): Promise<SchemaRecord | null>;
}
