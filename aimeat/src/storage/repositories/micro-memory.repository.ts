import type { MicroMemoryRecord } from '../interface.js';

export interface MicroMemoryRepository {
  setMicroMemory(record: MicroMemoryRecord): Promise<MicroMemoryRecord>;
  getMicroMemory(gaii: string, set: string): Promise<MicroMemoryRecord | null>;
  listMicroMemorySets(gaii: string): Promise<MicroMemoryRecord[]>;
  deleteMicroMemory(gaii: string, set: string): Promise<boolean>;
  deleteMicroMemoryEntry(gaii: string, set: string, key: string): Promise<boolean>;
  findMicroMemoryByAccessCode(set: string, accessCode: string): Promise<MicroMemoryRecord | null>;
}
