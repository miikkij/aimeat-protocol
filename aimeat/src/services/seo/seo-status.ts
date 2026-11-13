/**
 * @file src/services/seo/seo-status.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's search-engine status payload and the sentence an IndexNow run ends
 *   with. GET /v1/admin/seo/status and POST /v1/admin/seo/indexnow (routes/admin/seo.ts) and the MCP
 *   tools aimeat_seo_status and aimeat_seo_announce share them. Moved out of routes/admin/seo.ts
 *   unchanged on 2026-11-13, so the MCP tools call them without importing a route file (CLAUDE.md,
 *   Backend; dependency-cruiser rule mcp-does-not-import-routes). The history of both is in
 *   routes/admin/seo.ts's header.
 * @structure keyFileServed (module-private) · buildSeoStatus(config, storage) · announceNote(scope, urlCount, hosts, failed)
 * @usage const status = await buildSeoStatus(config, storage);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved out of routes/admin-seo.ts unchanged (structure programme unit 2).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { indexedPages, primaryNodeOf } from '../../data/public-pages.js';
import { appSeoIndexable, appSeoListable, appSeoState, appOwnDescription, appOwnWords, APP_OWN_WORDS_MIN, type AppSeoState } from '../app-seo.js';
import { readIndexNowRuns } from '../indexnow-log.js';
import { planAnnouncement, type AnnounceScope } from '../indexnow-site.js';
import { safeFetch } from '../../utils/url-validator.js';
import { logger } from '../../utils/logger.js';
import { localAccountName } from '../../utils/gaii.js';

/** How long one answer about the key file is believed before it is fetched again. */
const KEY_CHECK_TTL_MS = 5 * 60_000;
let keyCheck: { url: string; at: number; served: boolean | null } | null = null;

/**
 * Whether the key file answers from outside with the key as its body. True and false are answers;
 * null means the node could not reach its own address (a locked-down node refuses loopback egress,
 * a node behind a proxy that is down), which is "could not check" and never "not served".
 */
async function keyFileServed(keyUrl: string, key: string): Promise<{ served: boolean | null; checked_at: string }> {
  const now = Date.now();
  if (keyCheck && keyCheck.url === keyUrl && now - keyCheck.at < KEY_CHECK_TTL_MS) {
    return { served: keyCheck.served, checked_at: new Date(keyCheck.at).toISOString() };
  }
  let served: boolean | null;
  try {
    const resp = await safeFetch(keyUrl, { headers: { Accept: 'text/plain' }, signal: AbortSignal.timeout(4000) });
    served = resp.ok && (await resp.text()).trim() === key;
  } catch (err) {
    logger.warn('Discovery: could not fetch this node\'s own IndexNow key file to check it', { url: keyUrl, error: String(err) });
    served = null;
  }
  keyCheck = { url: keyUrl, at: now, served };
  return { served, checked_at: new Date(now).toISOString() };
}

/** The status payload, assembled once and shared by the HTTP route and the MCP tool. */
export async function buildSeoStatus(config: AimeatConfig, storage: Storage) {
  const b = config.baseUrl.replace(/\/$/, '');
  // adminView, so a parked or operator-hidden app is still counted rather than silently missing
  // from an operator's own tally. Their states say why they are not indexable.
  const { apps } = await storage.listApps({ adminView: true, limit: 1000, sort: 'newest' });
  const byState: Record<AppSeoState, number> = {
    on: 0, off: 0, pending: 0, blocked: 0, hidden: 0, gated: 0,
  };
  for (const app of apps) byState[appSeoState(app, config)] += 1;
  // The search-visible apps with no description of their own: indexable at their address, never
  // announced (appSeoListable, TARGET-089 Y2). Listed by name so the operator can ask the owner.
  // Asks for the description itself: appSeoListable also needs 150 words since TARGET-093, and a thin
  // app with a description is in thin_text, not here.
  const withoutDescription = apps
    .filter((app) => appSeoIndexable(app, config) && appOwnDescription(app) === '')
    .map((app) => ({ owner: localAccountName(app.ownerGaii), filename: app.filename, name: app.manifest?.name ?? app.filename }));
  const listable = apps.filter((app) => appSeoListable(app, config)).length;
  // The search-visible apps whose page carries fewer than APP_OWN_WORDS_MIN words of their own text
  // (name, description and the text about the app), fewest first: the owner writes the text about
  // the app for each (TARGET-093).
  const thinText = apps
    .filter((app) => appSeoIndexable(app, config))
    .map((app) => ({ owner: localAccountName(app.ownerGaii), filename: app.filename, name: app.manifest?.name ?? app.filename, words: appOwnWords(app), has_about: !!app.manifest?.about }))
    .filter((a) => a.words < APP_OWN_WORDS_MIN)
    .sort((a, b) => a.words - b.words);

  const keyUrl = config.indexNowKey ? `${b}/${config.indexNowKey}.txt` : null;
  const [runs, plan, key] = await Promise.all([
    readIndexNowRuns(storage),
    planAnnouncement(config, storage, 'all', apps),
    keyUrl && config.indexNowKey ? keyFileServed(keyUrl, config.indexNowKey) : Promise.resolve(null),
  ]);
  const last = runs[0] ?? null;
  const lastWhole = runs.find((r) => r.scope === 'all') ?? null;

  return {
    indexing: config.seoIndexing,
    identity: {
      site_name: config.seoSiteName,
      site_description: config.seoSiteDescription,
      organization_name: config.seoOrganizationName,
      organization_url: config.seoOrganizationUrl || b,
      og_image: /^https?:\/\//i.test(config.seoOgImage) ? config.seoOgImage : `${b}${config.seoOgImage}`,
      same_as: config.seoSameAs,
      twitter_site: config.seoTwitterSite ?? '',
    },
    robots: {
      url: `${b}/robots.txt`,
      // What the served document actually says, not what the config field holds: an empty
      // AIMEAT_CONTENT_SIGNAL pairs itself to the training decision, so reading the raw value
      // would report "unset" for a node that is serving a directive.
      content_signal: config.contentSignal
        || (config.aiTraining === 'allow'
          ? 'search=yes, ai-input=yes, ai-train=yes'
          : 'search=yes, ai-input=yes, ai-train=no'),
      ai_training: config.aiTraining,
      training_crawlers_blocked: config.aiTraining !== 'allow',
    },
    sitemap: {
      url: `${b}/sitemap.xml`,
      index_url: `${b}/sitemap-index.xml`,
      page_count: indexedPages(config).length,
      // The main node this node hands its general pages to, or null (seo.primary_node_url).
      primary_node: primaryNodeOf(config),
      // How many app hosts the index will actually list. The same decision the index itself makes,
      // including the operator's seo.announce_apps switch and the description rule.
      app_host_count: config.seoAnnounceApps ? listable : 0,
      announce_apps: config.seoAnnounceApps,
    },
    verification: {
      google: !!config.seoVerificationGoogle,
      bing: !!config.seoVerificationBing,
      extra: Object.keys(config.seoVerificationExtra ?? {}),
    },
    indexnow: {
      key_configured: !!config.indexNowKey,
      key_url: keyUrl,
      key_served: key?.served ?? null,
      key_checked_at: key?.checked_at ?? null,
      auto: config.seoIndexnowAuto,
      last_submitted_at: last?.at ?? null,
      last_url_count: last?.urlCount ?? null,
      last,
      runs,
      everything: {
        url_count: plan.urls.length,
        host_count: plan.hosts.length,
        last_sent_at: lastWhole?.at ?? null,
      },
    },
    apps: {
      mode: config.appsSeoMode,
      total: apps.length,
      ...byState,
      // Search-visible, and left out of the sitemaps and IndexNow until the owner writes a description.
      without_description: withoutDescription,
      // Search-visible, with fewer than 150 words of their own text on the page.
      own_words_min: APP_OWN_WORDS_MIN,
      thin_text: thinText,
    },
  };
}

/** The sentence the operator reads after a run, in the register the rest of the page speaks. */
export function announceNote(scope: AnnounceScope, urlCount: number, hosts: number, failed: string[]): string {
  const what = scope === 'pages' ? 'the pages' : 'the pages and every findable application';
  if (failed.length === 0) {
    return `Sent ${what}: ${urlCount} addresses on ${hosts} host${hosts === 1 ? '' : 's'}. The engines decide when they come; Bing shows what it did in Webmaster Tools once the site is verified there.`;
  }
  return `Sent ${what}, but ${failed.length} of ${hosts} host${hosts === 1 ? '' : 's'} refused the batch: ${failed.join(', ')}. A refusal usually means the key file does not answer on that host.`;
}
