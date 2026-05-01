import type { CapabilityRecord, CapabilityLogEntry, CapabilityOverride, CapabilityTrust, CapabilityFilter } from '../interface.js';

export interface CapabilityRepository {
  createCapability(record: CapabilityRecord): Promise<CapabilityRecord>;
  getCapability(id: string): Promise<CapabilityRecord | null>;
  updateCapability(id: string, updates: Partial<CapabilityRecord>): Promise<CapabilityRecord | null>;
  deleteCapability(id: string): Promise<boolean>;

  listCapabilities(filters: CapabilityFilter): Promise<{ capabilities: CapabilityRecord[]; total: number }>;
  listCapabilitiesByOwner(ownerGhii: string): Promise<CapabilityRecord[]>;
  getCapabilityBySourceRef(sourceRef: string): Promise<CapabilityRecord | null>;
  listCapabilitiesBySourceType(sourceType: string): Promise<CapabilityRecord[]>;

  incrementCapabilityStats(id: string, delta: {
    success: number; error: number; totalMs: number; lastError?: string;
  }): Promise<void>;

  addCapabilityLog(entry: CapabilityLogEntry): Promise<void>;
  listCapabilityLogs(capabilityId: string, filters: {
    status?: 'success' | 'error';
    page?: number;
    perPage?: number;
  }): Promise<{ logs: CapabilityLogEntry[]; total: number }>;
  deleteCapabilityLogsBefore(before: string): Promise<number>;

  setCapabilityOverride(id: string, override: CapabilityOverride | null): Promise<void>;
  setCapabilityTrust(id: string, trust: Partial<CapabilityTrust>): Promise<void>;
  incrementVouchCount(id: string): Promise<void>;
  decrementVouchCount(id: string): Promise<void>;
}
