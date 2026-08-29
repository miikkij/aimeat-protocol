/**
 * @file src/routes/apps/legal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The read side of an app's own legal pages and its audit log, on the apex:
 *
 *   GET /v1/apps/:owner/:filename/legal            the pages this app has (state, no content) and
 *                                                  what it should have; the owner also gets the
 *                                                  content, for the editor
 *   GET /v1/apps/:owner/:filename/legal/:kind      the page itself: the owner's HTML verbatim, a
 *                                                  markdown page rendered here, or a redirect
 *   GET /v1/apps/:owner/:filename/audit            the owner's audit log of the app's settings
 *
 *   A legal page is pre-contract information, so it is served without the app's access code and
 *   for a parked app; only an operator-hidden app is a 404 to anyone but its owner, the same rule
 *   the app itself follows. The writes are on PATCH /v1/apps/:filename (fork-manage.ts) and on
 *   the MCP tool, both through services/app-legal.ts.
 * @structure registerLegalRoutes(router, config, storage, canonicalOwner)
 * @version-history
 *   v1.1.0 — 2026-08-29 — The served page carries the page's provenance record (headers, marks,
 *     label, lifted by the app's reviewer); readiness answers on money, never morsels; the `me`
 *     forms keep the query; app:write on the three authenticated routes.
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import type { Router, Request } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AppRecord } from '../../storage/interface.js';
import { optionalAuth, requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { detectLocale } from '../../i18n.js';
import { appCsp } from '../../utils/app-csp.js';
import {
  appLegalState, legalReadiness, renderLegalPage, isLegalKind, LEGAL_KIND_INFO, legalLinksFor, apexLegalBase,
  appSellsForMoney,
} from '../../services/app-legal.js';
import { readAppAudit } from '../../services/app-audit.js';
import { applyServeMarks } from '../../services/app-serve-marks.js';
import { loadServedProvenance, setProvenanceHeaders } from '../../services/ai-provenance-marks.js';
import { appReviewedBy } from '../../services/app-marks.js';
import type { CanonicalOwner } from './helpers.js';

export function registerLegalRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  canonicalOwner: CanonicalOwner,
): void {
  /** The app, or null; false when the viewer may not know it exists. */
  async function visibleApp(req: Request, owner: string, filename: string): Promise<AppRecord | null | 'hidden'> {
    let app = await storage.getAppByOwnerName(owner, filename);
    if (!app && owner.includes('@')) app = await storage.getAppByOwnerName(owner.split('@')[0], filename);
    if (!app) return null;
    if (app.operatorHidden) {
      const isOperator = !!req.auth?.roles?.includes('operator');
      const isOwner = req.auth ? (await canonicalOwner(req)).owner === app.ownerName : false;
      if (!isOperator && !isOwner) return 'hidden';
    }
    return app;
  }

  async function isOwnerOf(req: Request, app: AppRecord): Promise<boolean> {
    if (!req.auth) return false;
    return (await canonicalOwner(req)).owner === app.ownerName;
  }

  // `me` in the owner slot means the signed-in account: the connector and CLI doors carry a
  // filename and a token and no owner name, and they need the same two answers the owner's own
  // browser gets. Registered before the `:owner` forms so `me` is never read as a name.
  const query = (req: Request) => { const i = req.originalUrl.indexOf('?'); return i >= 0 ? req.originalUrl.slice(i) : ''; };
  // An agent needs app:write on these three — the scope the owner grants for managing an app is
  // the one that reads its settings and its log, and the only app scope the owner's checkboxes
  // carry (test/unit/scope-vocabulary-parity.test.ts). An owner passes on the role, as everywhere.
  router.get('/v1/apps/me/:filename/legal', requireAuth(), requireScope('app:write'), async (req, res) => {
    const { owner } = await canonicalOwner(req);
    res.redirect(307, `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(req.params.filename as string)}/legal${query(req)}`);
  });
  router.get('/v1/apps/me/:filename/audit', requireAuth(), requireScope('app:write'), async (req, res) => {
    const { owner } = await canonicalOwner(req);
    // The query travels with the redirect: `?limit=1` dropped here answered oldest-first and
    // handed an agent the first entry as if it were the latest.
    res.redirect(307, `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(req.params.filename as string)}/audit${query(req)}`);
  });

  router.get('/v1/apps/:owner/:filename/legal', optionalAuth(), async (req, res) => {
    const owner = req.params.owner as string;
    const filename = req.params.filename as string;
    const app = await visibleApp(req, owner, filename);
    if (!app || app === 'hidden') {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
      return;
    }
    const own = await isOwnerOf(req, app);
    const base = apexLegalBase(config.baseUrl, app);
    res.json(success(config.nodeId, {
      owner: app.ownerName,
      filename: app.filename,
      legal: appLegalState(app),
      // Money, never morsels, decides whether the app is a shop (appSellsForMoney).
      readiness: legalReadiness(app, { sellsForMoney: await appSellsForMoney(storage, app) }),
      links: legalLinksFor(app, base),
      kinds: LEGAL_KIND_INFO,
      // The content is the owner's to edit; a reader gets the page, not the source.
      ...(own ? { documents: app.manifest?.legal ?? {} } : {}),
    }));
  });

  router.get('/v1/apps/:owner/:filename/legal/:kind', optionalAuth(), async (req, res) => {
    const owner = req.params.owner as string;
    const filename = req.params.filename as string;
    const kind = req.params.kind as string;
    if (!isLegalKind(kind)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `"${kind}" is not a kind of legal page`));
      return;
    }
    const app = await visibleApp(req, owner, filename);
    if (!app || app === 'hidden') {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`));
      return;
    }
    const doc = app.manifest?.legal?.[kind];
    if (!doc) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `This app has no ${LEGAL_KIND_INFO[kind].title.toLowerCase()} page`));
      return;
    }
    const locale = detectLocale(req.headers['accept-language']);
    const page = renderLegalPage(app, kind, doc, { baseUrl: config.baseUrl, locale });
    if ('redirect' in page) {
      res.redirect(302, page.redirect);
      return;
    }
    // The record minted for this text rides out with it, the way an app's own record does: the
    // headers, the machine marks, and the visible label where the law asks — lifted by the app's
    // named reviewer, the same act that lifts it on the app itself.
    const prov = await loadServedProvenance(storage, config, doc.aiProvenanceId);
    setProvenanceHeaders(res, prov);
    const body = applyServeMarks(page.html, {
      provenance: prov, visibleLabel: { config, locale }, reviewedBy: appReviewedBy(app.manifest),
    });
    // The same CSP the app's own inline serve gets on the apex: a legal page written as HTML is the
    // owner's document on the owner's app, and gets no more reach than the app has.
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', appCsp());
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(body);
  });

  router.get('/v1/apps/:owner/:filename/audit', requireAuth(), requireScope('app:write'), async (req, res) => {
    const owner = req.params.owner as string;
    const filename = req.params.filename as string;
    const app = await visibleApp(req, owner, filename);
    if (!app || app === 'hidden' || !(await isOwnerOf(req, app))) {
      // The log is the owner's; to anyone else the app may as well have none.
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found in your uploads`));
      return;
    }
    const all = await readAppAudit(storage, app.ownerGaii, app.filename);
    // `?limit=N` returns the newest N, newest first — what a person or an agent asking "what
    // happened lately" wants. Without it, the whole log oldest first, as it is kept.
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.floor(limitRaw)) : null;
    const entries = limit ? all.slice(Math.max(0, all.length - limit)).reverse() : all;
    res.json(success(config.nodeId, {
      owner: app.ownerName, filename: app.filename, entries, total: all.length,
      order: limit ? 'newest-first' : 'oldest-first',
    }));
  });
}
