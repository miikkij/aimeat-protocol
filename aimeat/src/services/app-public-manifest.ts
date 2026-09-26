/**
 * @file src/services/app-public-manifest.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's manifest as anybody but its owner reads it. Four things on a manifest are the
 *   owner's own and nobody else's: the AI disclosure check's finding (`aiPosture.gap`), the data map
 *   check's finding (`dataMap.gap`), the build-spec state of the last publish (`specCheck`) and the
 *   log of who put a reviewer's name on the app and took it off (`authorshipLog`). The rest of the
 *   manifest is what the app promises whoever opens it, and stays: the posture itself, the data map
 *   summary, the reviewer's name.
 *
 *   ONE FUNCTION, BECAUSE EVERY DOOR STRIPPED BY HAND. The catalogue listing, the MCP app read and
 *   the purchase receipt each built their own copy of this, and the copies drifted: the MCP read
 *   kept `dataMap.gap`, and the receipt kept all four (secaudit 2026-09, A6-10). A door that shows a
 *   manifest to somebody else calls this, and a new owner-only field is added here once.
 * @structure publicAppManifest(manifest)
 * @usage
 *   import { publicAppManifest } from '../services/app-public-manifest.js';
 *   const shown = isOwn ? app.manifest : publicAppManifest(app.manifest);
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09, A6-10).
 */
import type { AppManifest } from '../storage/interface.js';
import { publicPosture } from './app-ai-posture.js';

/** The manifest without the notes that are the owner's own. A copy: the stored record is untouched. */
export function publicAppManifest(manifest: AppManifest): AppManifest {
  const shown: AppManifest = { ...manifest };
  if (manifest.aiPosture) shown.aiPosture = publicPosture(manifest.aiPosture);
  if (manifest.dataMap) shown.dataMap = { ...manifest.dataMap, gap: undefined };
  delete shown.specCheck;
  delete shown.authorshipLog;
  return shown;
}
