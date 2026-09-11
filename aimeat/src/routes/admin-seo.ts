/**
 * @file admin-seo.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an operator needs in order to run this node's search-engine presence: one
 *   status answer, the whole-site instant update, and the two per-app moderation doors.
 *
 *   The status route exists because no other endpoint answers the question an operator actually
 *   has, which is "is this node findable, and what is still undone". That question is answered by
 *   several documents at once — robots.txt, the two sitemaps, the verification tags in the head,
 *   the IndexNow key, the per-app switches — and reading them one at a time is how it stayed
 *   unanswered. It reports what is BEING SERVED rather than what the config says, wherever the two
 *   could differ, because a configured verification token that never reaches the page looks exactly
 *   like a working one from inside the config. The key file is read the same way: fetched from the
 *   node's own public address, because a key that is configured and a key file that answers are
 *   two different claims and IndexNow only honours the second.
 *
 *   It is not a wrapper over an existing API: nothing else aggregates this, and a second reader —
 *   a monitor, the operator's own agent through aimeat_seo_status — wants the same answer.
 *
 * @structure
 *   - buildSeoStatus(config, storage) — the status payload, shared with the MCP tool
 *   - registerAdminSeoRoutes(...)     — GET  /v1/admin/seo/status
 *                                       GET  /v1/admin/seo/indexnow/plan
 *                                       POST /v1/admin/seo/indexnow
 *                                       POST /v1/admin/apps/:owner/:filename/seo-block
 *                                       POST /v1/admin/apps/:owner/:filename/seo-approve
 * @usage registerAdminSeoRoutes(router, config, storage, canonicalOwner);
 * @version-history
 *   v1.1.0 — 2026-09-11 — The key file checked from outside, the newest five notices and what a
 *     whole-site notice would carry in the status; the plan and the send doors for it. The MCP tool
 *     aimeat_seo_announce calls the same two service functions the doors call.
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { sitemapPages } from '../data/public-pages.js';
import { appSeoState, type AppSeoState } from '../services/app-seo.js';
import { readIndexNowRuns } from '../services/indexnow-log.js';
import { planAnnouncement, announceEverything, type AnnounceScope } from '../services/indexnow-site.js';
import { safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';
import type { CanonicalOwner } from './apps/helpers.js';

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
      page_count: sitemapPages().length,
      // How many app hosts the index will actually list. The same decision the index itself makes.
      app_host_count: byState.on,
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
    },
  };
}

/** "all" or "pages", or null for anything else. Absent means all. */
function parseScope(raw: unknown): AnnounceScope | null {
  if (raw === undefined || raw === null || raw === '') return 'all';
  return raw === 'all' || raw === 'pages' ? raw : null;
}

/** The sentence the operator reads after a run, in the register the rest of the page speaks. */
export function announceNote(scope: AnnounceScope, urlCount: number, hosts: number, failed: string[]): string {
  const what = scope === 'pages' ? 'the pages' : 'the pages and every findable application';
  if (failed.length === 0) {
    return `Sent ${what}: ${urlCount} addresses on ${hosts} host${hosts === 1 ? '' : 's'}. The engines decide when they come; Bing shows what it did in Webmaster Tools once the site is verified there.`;
  }
  return `Sent ${what}, but ${failed.length} of ${hosts} host${hosts === 1 ? '' : 's'} refused the batch: ${failed.join(', ')}. A refusal usually means the key file does not answer on that host.`;
}

export function registerAdminSeoRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  canonicalOwner: CanonicalOwner,
): void {
  router.get('/v1/admin/seo/status', requireAuth(), requireRole('operator'), async (_req, res) => {
    res.json(success(config.nodeId, await buildSeoStatus(config, storage), [
      { description: 'Change a setting', method: 'PUT', url: '/v1/admin/config' },
      { description: 'Tell the search engines about the whole site now', method: 'POST', url: '/v1/admin/seo/indexnow' },
    ]));
  });

  /** What a whole-site notice would carry, host by host. Sends nothing. */
  router.get('/v1/admin/seo/indexnow/plan', requireAuth(), requireRole('operator'), async (req, res) => {
    const scope = parseScope(req.query.scope);
    if (!scope) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'scope must be "all" or "pages"'));
      return;
    }
    const plan = await planAnnouncement(config, storage, scope);
    res.json(success(config.nodeId, {
      scope,
      url_count: plan.urls.length,
      host_count: plan.hosts.length,
      hosts: plan.hosts,
      urls: plan.urls,
      apps: plan.apps.map((a) => ({ owner: a.ownerName, filename: a.filename, subdomain: a.subdomain ?? null })),
    }, [
      { description: 'Send it', method: 'POST', url: '/v1/admin/seo/indexnow' },
    ]));
  });

  /**
   * The whole site to IndexNow, now. Explicit, so the auto switch does not apply; the key and the
   * discovery switch still do, and the refusal names which one. The MCP tool calls the same
   * announceEverything, so the grouping, the stamp on each app and the log happen in one place.
   */
  router.post('/v1/admin/seo/indexnow', requireAuth(), requireRole('operator'), async (req, res) => {
    const scope = parseScope((req.body ?? {}).scope);
    if (!scope) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'scope must be "all" or "pages"'));
      return;
    }
    const { owner: operatorName } = await canonicalOwner(req);
    const out = await announceEverything(config, storage, { scope, by: operatorName });
    if (!out.sent) {
      const [code, message] = out.reason === 'no_key'
        ? ['NO_INDEXNOW_KEY', 'No IndexNow key is set on this node. It is one server setting (AIMEAT_INDEXNOW_KEY) and needs a restart, so whoever installed this is the one to ask.']
        : out.reason === 'indexing_off'
          ? ['INDEXING_OFF', 'Search engines are turned away on this node (seo.indexing is off), so there is nothing to announce. Welcome them first.']
          : ['NOTHING_TO_SEND', 'There is nothing to send: no pages and no findable application.'];
      res.status(409).json(error(config.nodeId, code, message, 409, { scope, url_count: out.plan.urls.length }));
      return;
    }
    // The apps carry a new announcedAt, and the status page reads the log: both re-read on 'apps'.
    emitChange('apps');
    const { run } = out;
    if (run.failed.length === run.hosts) {
      res.status(502).json(error(config.nodeId, 'INDEXNOW_REFUSED',
        `IndexNow refused every batch (${run.status ?? 'no answer'}). The key file has to answer on each host with the key as its body.`,
        502, { scope, run }));
      return;
    }
    res.json(success(config.nodeId, {
      scope,
      url_count: run.urlCount,
      host_count: run.hosts,
      run,
      note: announceNote(scope, run.urlCount, run.hosts, run.failed),
    }, [
      { description: 'Where things stand now', method: 'GET', url: '/v1/admin/seo/status' },
    ]));
  });

  /**
   * Block or unblock ONE app's search visibility. Narrower than /moderate, deliberately: the app
   * keeps working, keeps its listing and keeps its link, and only stops being findable through a
   * search engine. That is the proportionate answer to an app origin being used to farm keywords
   * on the operator's domain.
   */
  router.post('/v1/admin/apps/:owner/:filename/seo-block', requireAuth(), requireRole('operator'),
    async (req, res) => {
      const ownerParam = req.params.owner as string;
      const filename = req.params.filename as string;
      const owner = ownerParam.includes('@') ? ownerParam.split('@')[0] : ownerParam;
      const body = req.body ?? {};
      if (typeof body.blocked !== 'boolean') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'blocked must be a boolean'));
        return;
      }
      // The reason reaches the OWNER, not just the audit log: a block whose reason the owner
      // cannot read is one they cannot fix.
      const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : undefined;

      const app = await storage.getAppByOwnerName(owner, filename);
      if (!app) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
        return;
      }
      const { owner: operatorName } = await canonicalOwner(req);
      const ok = await storage.setAppOperatorSeoBlocked(app.ownerGaii, filename, body.blocked, {
        by: operatorName, at: new Date().toISOString(), reason,
      });
      if (!ok) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
        return;
      }
      const after = await storage.getAppByOwnerName(owner, filename);
      emitChange('apps');
      res.json(success(config.nodeId, {
        owner, filename,
        seo_state: after ? appSeoState(after, config) : 'blocked',
        note: body.blocked
          ? 'This app is no longer findable in search engines. It still works, stays listed, and can be shared by link.'
          : 'The search block is lifted. Whether the app is findable now depends on its owner\'s own setting.',
      }));
    });

  /**
   * Approve or withdraw approval in `review` mode. A no-op in `owner` mode, and it says so rather
   * than writing a field that would silently start mattering if the mode were switched later.
   */
  router.post('/v1/admin/apps/:owner/:filename/seo-approve', requireAuth(), requireRole('operator'),
    async (req, res) => {
      const ownerParam = req.params.owner as string;
      const filename = req.params.filename as string;
      const owner = ownerParam.includes('@') ? ownerParam.split('@')[0] : ownerParam;
      const body = req.body ?? {};
      if (typeof body.approved !== 'boolean') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'approved must be a boolean'));
        return;
      }
      if (config.appsSeoMode !== 'review') {
        res.status(409).json(error(config.nodeId, 'NOT_IN_REVIEW_MODE',
          'This node lets app owners decide their own search visibility, so there is nothing to approve. Set apps.seo_mode to "review" first.'));
        return;
      }
      const app = await storage.getAppByOwnerName(owner, filename);
      if (!app) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
        return;
      }
      const { owner: operatorName } = await canonicalOwner(req);
      const now = new Date().toISOString();
      await storage.updateAppMeta(app.ownerGaii, filename, {
        seo: body.approved
          ? { approvedBy: operatorName, approvedAt: now }
          : { approvedBy: undefined, approvedAt: undefined },
      });
      const after = await storage.getAppByOwnerName(owner, filename);
      emitChange('apps');
      res.json(success(config.nodeId, {
        owner, filename,
        seo_state: after ? appSeoState(after, config) : 'pending',
        note: body.approved
          ? 'Approved. The app is in this node\'s sitemap; search engines usually take a few days.'
          : 'Approval withdrawn. The app is back to waiting for a decision.',
      }));
    });
}
