import type { CsmRecord, MsmRecord } from '../interface.js';

export interface CatalogueRepository {
  createCsm(record: CsmRecord): Promise<CsmRecord>;
  getCsm(name: string): Promise<CsmRecord | null>;
  listCsms(opts?: { serviceType?: string }): Promise<CsmRecord[]>;
  updateCsm(name: string, updates: Partial<CsmRecord>): Promise<CsmRecord | null>;
  deleteCsm(name: string): Promise<boolean>;
  createMsm(record: MsmRecord): Promise<MsmRecord>;
  getMsm(name: string): Promise<MsmRecord | null>;
  listMsms(opts?: { category?: string }): Promise<MsmRecord[]>;
  updateMsm(name: string, updates: Partial<MsmRecord>): Promise<MsmRecord | null>;
  deleteMsm(name: string): Promise<boolean>;
}
