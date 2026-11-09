/**
 * @file indexnow-site.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The whole site in one instant update: the node's pages and every findable
 *   application, planned host by host and sent under each host's own key.
 *
 *   Nothing had ever sent the whole site from the node. A publish announces one application, and
 *   the hand-run script sends the pages alone; on aimeat.io the last notice was two addresses while
 *   the 14 pages and 30 findable application hosts had never gone out together. This is the one
 *   implementation behind POST /v1/admin/seo/indexnow and aimeat_seo_announce, so the grouping,
 *   the stamp on each app and the log happen in one place.
 *
 *   A file of its own, beside indexnow.ts, because of one arrow: the plan reads the
 *   search-visibility decision from app-seo.ts, and app-seo.ts calls announceApp from indexnow.ts.
 *   Putting the plan in indexnow.ts closed that into a cycle.
 *
 * @structure
 *   - planAnnouncement(config, storage, scope, listed?) — what "everything" would send, without sending
 *   - announceEverything(config, storage, opts)         — the plan, sent, each app stamped
 * @usage
 *   const out = await announceEverything(config, storage, { scope: 'all', by: operatorName });
 * @version-history
 *   v1.4.0 — 2026-11-09 — The pages handed to the main node (seo.primary_node_url) and the copies of
 *     another public data package are left out, as in the sitemaps (TARGET-094).
 *   v1.3.0 — 2026-11-06 — "all" names an app only when it has a description of its own
 *     (appSeoListable, TARGET-089 Y2).
 *   v1.2.0 — 2026-11-01 — "all" carries the public data packages' pages too, the list of
 *     /sitemap-datasets.xml (plan doc-mvwxcas3dom3, D1.4).
 *   v1.1.0 — 2026-10-01 — With seo.announce_apps off, "all" carries the pages alone.
 *   v1.0.0 — 2026-09-11 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { AppSummaryRecord } from '../storage/types/apps.js';
import { indexedPages } from '../data/public-pages.js';
import { appSeoListable } from './app-seo.js';
import { submitToIndexNow, appSubmitUrls, groupByHost, stampAnnounced } from './indexnow.js';
import type { IndexNowRun } from './indexnow-log.js';
import { indexedDatasetPages } from './datapackage/copy-origin.js';

/** What "everything" means: the pages, or the pages and every findable application. */
export type AnnounceScope = 'pages' | 'all';

export interface AnnouncementPlan {
  scope: AnnounceScope;
  urls: string[];
  /** Origin → how many addresses on it, in the order they would be sent. */
  hosts: Array<{ host: string; url_count: number }>;
  /** The applications the plan covers, for the stamp after a run. */
  apps: Array<{ ownerGaii: string; ownerName: string; filename: string; subdomain?: string }>;
}

/**
 * The addresses a whole-site notice would carry, without sending anything. The same decision the
 * sitemap index makes per app (appSeoIndexable), so the plan and the index never disagree about
 * which applications exist to a search engine.
 *
 * `listed` may be handed in by a caller that already listed the apps (the status read does), and
 * they are listed here otherwise.
 */
export async function planAnnouncement(
  config: AimeatConfig,
  storage: Storage,
  scope: AnnounceScope,
  listed?: AppSummaryRecord[],
): Promise<AnnouncementPlan> {
  const b = config.baseUrl.replace(/\/$/, '');
  // The pages handed to the main node (seo.primary_node_url) are its to announce, as in sitemap.xml.
  const urls = indexedPages(config).map((p) => `${b}${p.path === '/' ? '/' : p.path}`);
  const apps: AnnouncementPlan['apps'] = [];

  // seo.announce_apps off: the operator has asked that no notice name an app, so "everything" is
  // the pages. The sitemap index reads the same switch, so the two still never disagree.
  if (scope === 'all' && config.seoAnnounceApps) {
    const [all, sites] = await Promise.all([
      listed ?? storage.listApps({ adminView: true, limit: 1000, sort: 'newest' }).then((r) => r.apps),
      storage.listSubdomainSites(),
    ]);
    const subFor = new Map<string, string>();
    for (const s of sites) {
      if (s.enabled && s.kind === 'app' && s.target) subFor.set(s.target, s.subdomain);
    }
    for (const app of all) {
      // An app with no description of its own is not announced (TARGET-089 Y2).
      if (!appSeoListable(app, config)) continue;
      const subdomain = subFor.get(`${app.ownerName}/${app.filename}`);
      apps.push({ ownerGaii: app.ownerGaii, ownerName: app.ownerName, filename: app.filename, subdomain });
      urls.push(...appSubmitUrls(config, app, subdomain));
    }
  }

  // The public data packages, at their public page: the same list /sitemap-datasets.xml carries.
  if (scope === 'all') urls.push(...(await indexedDatasetPages(config, storage)).map(p => p.loc));

  const unique = [...new Set(urls)];
  const hosts = [...groupByHost(unique).entries()].map(([host, list]) => ({ host, url_count: list.length }));
  return { scope, urls: unique, hosts, apps };
}

export type AnnounceOutcome =
  | { sent: true; plan: AnnouncementPlan; run: IndexNowRun }
  | { sent: false; plan: AnnouncementPlan; reason: 'no_key' | 'indexing_off' | 'nothing' };

/**
 * The whole site in one run: the pages and every findable application, each host under its own
 * key. Explicit, so the auto switch does not apply; the key and the discovery switch still do, and
 * the answer says which one stopped it rather than returning nothing.
 */
export async function announceEverything(
  config: AimeatConfig,
  storage: Storage,
  opts: { scope: AnnounceScope; by?: string },
): Promise<AnnounceOutcome> {
  const plan = await planAnnouncement(config, storage, opts.scope);
  if (!config.indexNowKey) return { sent: false, plan, reason: 'no_key' };
  if (config.seoIndexing === 'off') return { sent: false, plan, reason: 'indexing_off' };
  if (plan.urls.length === 0) return { sent: false, plan, reason: 'nothing' };

  const run = await submitToIndexNow(config, storage, plan.urls, { scope: opts.scope, by: opts.by, explicit: true });
  // submitToIndexNow returns null only for the conditions checked above; the guard keeps the type
  // honest rather than trusting the order of two functions to stay aligned.
  if (!run) return { sent: false, plan, reason: 'nothing' };
  if (run.ok) await stampAnnounced(storage, plan.apps, run.at);
  return { sent: true, plan, run };
}
