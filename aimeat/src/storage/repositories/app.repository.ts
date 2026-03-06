import type { AppRecord, AppListOptions } from '../interface.js';

export interface AppRepository {
  createApp(record: AppRecord): Promise<AppRecord>;
  getApp(ownerGaii: string, filename: string, version?: number): Promise<AppRecord | null>;
  getAppByOwnerName(ownerName: string, filename: string, version?: number): Promise<AppRecord | null>;
  listApps(opts?: AppListOptions): Promise<{ apps: AppRecord[]; total: number }>;
  listAppVersions(ownerGaii: string, filename: string): Promise<AppRecord[]>;
  getLatestVersionNumber(ownerGaii: string, filename: string): Promise<number>;
  deleteApp(ownerGaii: string, filename: string, version?: number): Promise<boolean>;
  updateAppAccessCode(ownerGaii: string, filename: string, accessCode?: string): Promise<boolean>;
  getAppDownloads(ownerGaii: string, filename: string): Promise<number>;
  incrementAppDownloads(ownerGaii: string, filename: string): Promise<void>;
}
