/**
 * @file src/services/app-served-protection.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The copy protection that applies to a served app version: the app's CURRENT
 *   setting, whatever version was asked for.
 *
 *   WHY. The owner's protection (obfuscate, domainLock, watermark, noRawDownload) is written by
 *   updateAppMeta, which changes the manifest of the latest version only. The version list is
 *   public (GET /v1/apps/:owner/:filename/versions), so `GET /v1/apps/:owner/:filename?version=1`
 *   served an older version with whatever its own manifest said, usually nothing: the raw source
 *   unobfuscated, without watermark and as a download the owner had blocked (feature-list
 *   audit #103). Protection is a setting of the app, as the access code is (updateAppAccessCode
 *   writes every version), so it is read from the latest version for every version served.
 * @structure servedProtection(storage, app, versionRequested)
 * @usage const protection = await servedProtection(storage, app, version);
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #103).
 */
import type { Storage, AppProtection, AppRecord } from '../storage/interface.js';

/**
 * The protection to apply when serving `app`. With no version asked for, `app` is the latest and
 * its own manifest is the answer; with one, the latest version's manifest is.
 */
export async function servedProtection(
  storage: Storage, app: AppRecord, versionRequested: number | undefined,
): Promise<AppProtection | undefined> {
  if (versionRequested === undefined) return app.manifest.protection;
  const latest = await storage.getAppByOwnerName(app.ownerName, app.filename);
  if (!latest || latest.versionNumber === app.versionNumber) return app.manifest.protection;
  return latest.manifest.protection;
}
