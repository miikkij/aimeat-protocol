/**
 * @file src/storage/repositories/schema.repository.ts
 * @description Storage-interface segment for locked memory schemas (CSM/MSM) — the contract each
 *   backend implements to set/get/delete/list schemas and resolve the schema applicable to a memory key.
 *
 * @structure
 *   - SchemaRepository: interface with setSchema, getSchema (exact|prefix), deleteSchema,
 *     listSchemas, findApplicableSchema
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { SchemaRecord } from '../interface.js';

export interface SchemaRepository {
  setSchema(record: SchemaRecord): Promise<SchemaRecord>;
  getSchema(keyPattern: string, applyTo?: 'exact' | 'prefix'): Promise<SchemaRecord | null>;
  deleteSchema(keyPattern: string): Promise<boolean>;
  listSchemas(prefix?: string): Promise<SchemaRecord[]>;
  findApplicableSchema(memoryKey: string): Promise<SchemaRecord | null>;
}
