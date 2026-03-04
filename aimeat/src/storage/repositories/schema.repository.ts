import type { SchemaRecord } from '../interface.js';

export interface SchemaRepository {
  setSchema(record: SchemaRecord): Promise<SchemaRecord>;
  getSchema(keyPattern: string, applyTo?: 'exact' | 'prefix'): Promise<SchemaRecord | null>;
  deleteSchema(keyPattern: string): Promise<boolean>;
  listSchemas(prefix?: string): Promise<SchemaRecord[]>;
  findApplicableSchema(memoryKey: string): Promise<SchemaRecord | null>;
}
