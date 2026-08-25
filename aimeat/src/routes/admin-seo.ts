/**
 * @file admin-seo.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an operator needs in order to run this node's search-engine presence: one
 *   status answer, and the two per-app moderation doors.
 *
 *   The status route exists because no other endpoint answers the question an operator actually
 *   has, which is "is this node findable, and what is still undone". That question is answered by
 *   several documents at once — robots.txt, the two sitemaps, the verification tags in the head,
 *   the IndexNow key, the per-app switches — and reading them one at a time is how it stayed
 *   unanswered. It reports what is BEING SERVED rather than what the config says, wherever the two
 *   could differ, because a configured verification token that never reaches the page looks exactly
 *   like a working one from inside the config.
 *
 *   It is not a wrapper over an existing API: nothing else aggregates this, and a second reader —
 *   a monitor, the operator's own agent through aimeat_seo_status — wants the same answer.
 *
 * @structure
 *   - buildSeoStatus(config, storage) — the status payload, shared with the MCP tool
 *   - registerAdminSeoRoutes(...)     — GET  /v1/admin/seo/status
 *                                       POST /v1/admin/apps/:owner/:filename/seo-block
 *                                       POST /v1/admin/apps/:owner/:filename/seo-approve
 * @usage registerAdminSeoRoutes(router, config, storage, canonicalOwner);
 * @version-history
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
import { readIndexNowLastRun } from '../services/indexnow-log.js';
import type { CanonicalOwner } from './apps/helpers.js';

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

  const lastRun = await readIndexNowLastRun(storage);

  return {
    indexing: config.seoIndexing,
    identity: {
      site_name: config.seoSiteName,
      site_description: config.seoSiteDescription,
      organization_name: config.seoOrganizationName,
      organization_url: config.seoOrganizationUrl || b,
      og_image: /^https?:\/\//i.test(config.seoOgImage) ? config.seoOgImage : `${b}${config.seoOgImage}`,
      same_as: config.seoSameAs,
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
      key_url: config.indexNowKey ? `${b}/${config.indexNowKey}.txt` : null,
      auto: config.seoIndexnowAuto,
      last_submitted_at: lastRun?.at ?? null,
      last_url_count: lastRun?.urlCount ?? null,
    },
    apps: {
      mode: config.appsSeoMode,
      total: apps.length,
      ...byState,
    },
  };
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
