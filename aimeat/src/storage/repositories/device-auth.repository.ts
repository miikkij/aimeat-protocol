/**
 * @file src/storage/repositories/device-auth.repository.ts
 * @description Storage-interface contract for RFC 8628 device-authorization records — the backend-agnostic
 *   repository shape each provider (SQLite/Prisma) implements for the agent device-auth flow.
 *
 * @structure
 *   - DeviceAuthRepository: create/get-by-device-code/get-by-user-code, update, per-owner pending
 *     count+list, expiry cleanup, and per-owner deletion methods
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { DeviceAuthorizationRecord } from '../interface.js';

export interface DeviceAuthRepository {
  createDeviceAuth(req: DeviceAuthorizationRecord): Promise<void>;
  getDeviceAuthByDeviceCode(deviceCode: string): Promise<DeviceAuthorizationRecord | null>;
  getDeviceAuthByUserCode(userCode: string): Promise<DeviceAuthorizationRecord | null>;
  updateDeviceAuth(deviceCode: string, updates: Partial<DeviceAuthorizationRecord>): Promise<void>;
  countPendingDeviceAuthByOwner(ownerName: string): Promise<number>;
  listPendingDeviceAuthByOwner(ownerName: string): Promise<DeviceAuthorizationRecord[]>;
  cleanupExpiredDeviceAuth(): Promise<number>;
  deleteDeviceAuthByOwner(ownerName: string): Promise<number>;
}
