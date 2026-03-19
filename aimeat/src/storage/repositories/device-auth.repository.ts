import type { DeviceAuthorizationRecord } from '../interface.js';

export interface DeviceAuthRepository {
  createDeviceAuth(req: DeviceAuthorizationRecord): Promise<void>;
  getDeviceAuthByDeviceCode(deviceCode: string): Promise<DeviceAuthorizationRecord | null>;
  getDeviceAuthByUserCode(userCode: string): Promise<DeviceAuthorizationRecord | null>;
  updateDeviceAuth(deviceCode: string, updates: Partial<DeviceAuthorizationRecord>): Promise<void>;
  countPendingDeviceAuthByOwner(ownerName: string): Promise<number>;
  listPendingDeviceAuthByOwner(ownerName: string): Promise<DeviceAuthorizationRecord[]>;
  cleanupExpiredDeviceAuth(): Promise<number>;
}
