/**
 * @file src/services/compliance-apps-overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every app on the node in one line each, for the operator's report: who can see its
 *   personal data (compliance-app-reach.ts), whether it uses AI, the Annex III area its map points
 *   to, and whether the publish check found that it shows people an AI label.
 *
 *   WHY IT EXISTS. The report printed an app wherever a gap named it: as an AI use, then again in
 *   three or four gap tables. On aimeat.io (195 apps, 2026-10-29) that was more than 180 pages, and
 *   no page said the one thing a reader wants first: which apps let someone other than their user see
 *   personal data. This list is that page; the gaps keep the detail.
 * @structure ComplianceAppRow · appsOverview()
 * @usage const { apps, by_reach } = await appsOverview({ storage, config });
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { readAppDataMap } from './data-map/data-map-store.js';
import { appAiSignals } from './compliance-app-signals.js';
import { appReach, REACH_ORDER, type AppReach } from './compliance-app-reach.js';

/** How many apps are read, as the records-of-processing gaps read them. */
const APP_SCAN = 1000;

export interface ComplianceAppRow {
  /** `owner/filename.html`. */
  app: string;
  owner: string;
  title: string;
  reach: AppReach;
  /** The map marks a row personal that someone other than the app's user, or the user, keeps on the node. */
  personal: boolean;
  /** The app has a data map. */
  has_map: boolean;
  uses_ai: boolean;
  /** The Annex III area the map points to, or null. */
  annex3: string | null;
  /**
   * For an app that uses AI: the publish check found that it shows people an AI label (`true`), found
   * none (`false`), or recorded nothing (`null`). Null for an app that uses no AI.
   */
  tells_ai: boolean | null;
  /**
   * The regulated data domains its personal data falls in, stated or read from the map's words.
   * Such an app needs a record of processing even when only its user sees the data.
   */
  domains: string[];
  /** The key families someone other than the app's user can see, with who (no `self` rows). */
  rows: Array<{ what: string; reach: AppReach; personal: 'yes' | 'unstated' }>;
}

/** Every app, parked and hidden ones included, sorted by reach (widest first) and then by name. */
export async function appsOverview(deps: { storage: Storage; config: AimeatConfig }): Promise<{
  apps: ComplianceAppRow[]; by_reach: Record<AppReach, number>;
}> {
  const { storage, config } = deps;
  const { apps } = await storage.listApps({ adminView: true, limit: APP_SCAN });
  const rows: ComplianceAppRow[] = [];
  for (const a of apps) {
    const owner = localAccountName(a.ownerName ?? a.ownerGaii ?? '');
    if (!owner) continue;
    const map = await readAppDataMap(storage, `${owner}@${config.nodeId}`, a.filename.replace(/\.html$/i, ''));
    const reach = appReach(map);
    const posture = a.manifest?.aiPosture;
    const ai = appAiSignals(map, posture);
    rows.push({
      app: `${owner}/${a.filename}`,
      owner,
      title: a.manifest?.name || a.filename.replace(/\.html$/i, ''),
      reach: reach.reach,
      personal: reach.personal,
      has_map: reach.hasMap,
      uses_ai: ai.usesAi,
      annex3: ai.annex3?.area ?? null,
      tells_ai: !ai.usesAi ? null
        : posture ? Boolean(posture.discloses || posture.disclosureCallFound) : null,
      domains: [...new Set(ai.domains.map(d => d.domain))],
      rows: reach.rows.filter(r => r.reach !== 'self').slice(0, 30),
    });
  }
  const rank = (r: AppReach) => REACH_ORDER.length - REACH_ORDER.indexOf(r);
  rows.sort((x, y) => rank(x.reach) - rank(y.reach) || x.title.localeCompare(y.title));
  const by_reach = Object.fromEntries(REACH_ORDER.map(r => [r, 0])) as Record<AppReach, number>;
  for (const r of rows) by_reach[r.reach]++;
  return { apps: rows, by_reach };
}
