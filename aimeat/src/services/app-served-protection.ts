/**
 * @file src/services/app-served-protection.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gates that apply to a served or forked app version: the app's CURRENT settings,
 *   whatever version was asked for.
 *
 *   WHY. The owner's protection (obfuscate, domainLock, watermark, noRawDownload) is written by
 *   updateAppMeta, which changes the manifest of the latest version only. The version list is
 *   public (GET /v1/apps/:owner/:filename/versions), so `GET /v1/apps/:owner/:filename?version=1`
 *   served an older version with whatever its own manifest said, usually nothing: the raw source
 *   unobfuscated, without watermark and as a download the owner had blocked (feature-list
 *   audit #103). Protection is a setting of the app, as the access code is (updateAppAccessCode
 *   writes every version), so it is read from the latest version for every version served.
 *
 *   The same holds for two more gates (QA audit F10a-01). An access code set, changed or cleared in
 *   the body of a publish lands on the new version row only, and a pacing amount is set only by a
 *   publish, in the new version's manifest. So an older version answered without the code, the old
 *   code still opened it, and a version from before the pacing amount was read and forked without a
 *   licence. currentAppRow() gives the row whose settings decide: the latest version's.
 * @structure currentAppRow(storage, app, versionRequested)
 * @usage
 *   const current = await currentAppRow(storage, app, version);   // protection, accessCode, operatorHidden, pacing
 * @version-history
 *   2026-10-16 — currentAppRow() replaces servedProtection(): the access code, the operator hide and
 *     the pacing amount of an older version are the latest version's too (QA audit F10a-01).
 *   2026-10-15 — Initial (feature-list audit #103).
 */
import type { Storage, AppRecord } from '../storage/interface.js';

/**
 * The row whose settings decide for `app`: `app` itself when it is the latest version or no version
 * was asked for, else the latest version of the same app.
 */
export async function currentAppRow(
  storage: Storage, app: AppRecord, versionRequested: number | undefined,
): Promise<AppRecord> {
  if (versionRequested === undefined) return app;
  const latest = await storage.getAppByOwnerName(app.ownerName, app.filename);
  if (!latest || latest.versionNumber === app.versionNumber) return app;
  return latest;
}
