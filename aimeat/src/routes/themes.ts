/**
 * @file src/routes/themes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Themes & Styles over HTTP (07-themes-and-styles.md). A theme holds styles, its
 *   component CSS and its theme CSS; the operator's CSS is refused only when it does not parse, and
 *   every other finding comes back as a warning.
 *
 *   GET  /v1/themes                               public: what the pill offers, and who chooses
 *   GET  /v1/themes/all                           public: every theme whole, its warnings, and what a
 *                                                 theme may set (?summary=1: core colours only)
 *   GET  /v1/themes/choice   PUT                  a signed-in person's own { theme, style }
 *   PUT  /v1/themes/policy                        operator: who chooses, the available themes, the default
 *   POST /v1/themes/preview                       operator: a draft's stylesheet and warnings, unsaved
 *   POST /v1/themes                               operator: a new theme, a copy of basedOn
 *   GET  /v1/themes/:id                           public: one theme, its warnings, its versions
 *   PUT  /v1/themes/:id                           operator: name, theme CSS, default and offered styles, retired
 *   GET  /v1/themes/:id/theme.css                 public: the theme's stylesheet
 *   POST /v1/themes/:id/styles                    operator: a new style in the theme
 *   PUT  /v1/themes/:id/styles/:styleId           operator: change a style
 *   PUT  /v1/themes/:id/components/:componentId   operator: component CSS (empty removes it)
 *   GET  /v1/themes/:id/versions                  operator: the saved versions
 *   POST /v1/themes/:id/versions/:version/restore operator: put one back
 *
 *   Reading is public: a theme is CSS every visitor of AIMEAT's own pages downloads anyway. Writing
 *   goes through requireOperatorPrincipal with site:theme-write (Jouni: only the operator edits), so
 *   the operator's own agent can make and repair a theme from a chat.
 * @structure themesRouter(config, storage, requireNotLb?, provenance?)
 * @usage router.use(themesRouter(config, storage, requireNotLb));  (mounted by routes/site.ts)
 * @version-history
 *   v2.0.0 — 2026-09-24 — The two-level model of 07: styles, component CSS, versions, previews,
 *     warnings instead of refusals, a sheet per theme.
 *   v1.0.0 — 2026-09-24 — Initial (one level).
 */
import { Router, type RequestHandler } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireOperatorPrincipal } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { THEME_WRITE_SCOPE } from '../utils/scope-coverage.js';
import { ThemeService, ThemeError, type ThemeInput, type Theme } from '../services/themes/service.js';
import type { StyleInput } from '../services/themes/styles.js';
import type { ConfigProvenance } from '../services/config-provenance.js';
import { requireOwnerSession } from './home/welcome-mat.js';
import { onChangeEvent } from '../services/event-bus.js';

export function themesRouter(config: AimeatConfig, storage: Storage, requireNotLb?: RequestHandler, provenance?: ConfigProvenance): Router {
    const router = Router();
    const svc = new ThemeService(config, storage);
    const notLb: RequestHandler[] = requireNotLb ? [requireNotLb] : [];
    const operator: RequestHandler[] = [requireAuth(), requireOperatorPrincipal(storage, THEME_WRITE_SCOPE)];

    // The SPA shell reads the snapshot synchronously before its first paint (portal-spa.ts): build it
    // now, and again whenever the operator changes a setting (a theme write refreshes it itself).
    const refresh = () => { svc.offered().catch((e) => console.warn('[themes] snapshot:', e instanceof Error ? e.message : e)); };
    refresh();
    onChangeEvent((evt) => { if (evt.domain === 'config') refresh(); });

    function sendError(res: Parameters<RequestHandler>[1], err: unknown): void {
        if (err instanceof ThemeError) {
            res.status(err.httpStatus).json(error(config.nodeId, err.code, err.message, err.httpStatus, err.details));
            return;
        }
        throw err;
    }
    const by = (req: Parameters<RequestHandler>[0]) => resolveIdentity(req.auth!, config.nodeId);
    const dry = (req: Parameters<RequestHandler>[0]) => req.query.dryRun === '1' || (req.body ?? {}).dryRun === true;

    router.get('/v1/themes', async (_req, res) => {
        try {
            res.json(success(config.nodeId, await svc.offered(), [{ description: 'Every theme whole', method: 'GET', url: '/v1/themes/all' }]));
        } catch (err) { sendError(res, err); }
    });

    router.get('/v1/themes/all', async (req, res) => {
        try { res.json(success(config.nodeId, await svc.catalogue(req.query.summary === '1' || req.query.summary === 'true'))); } catch (err) { sendError(res, err); }
    });

    router.get('/v1/themes/choice', requireAuth(), requireRole('owner'), requireOwnerSession(config.nodeId), async (req, res) => {
        try {
            const snap = await svc.offered();
            res.json(success(config.nodeId, { ...(await svc.choiceGet(by(req))), personalChoice: snap.policy.personalChoice, default: snap.policy.default }));
        } catch (err) { sendError(res, err); }
    });

    router.put('/v1/themes/choice', requireAuth(), requireRole('owner'), requireOwnerSession(config.nodeId), async (req, res) => {
        const { theme, style } = (req.body ?? {}) as { theme?: unknown; style?: unknown };
        if (typeof theme !== 'string' || !theme || (style !== undefined && typeof style !== 'string')) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'theme is a theme id such as "aimeat", and style (optional) a style id of it'));
            return;
        }
        try { res.json(success(config.nodeId, await svc.choiceSet(by(req), theme, style as string | undefined))); } catch (err) { sendError(res, err); }
    });

    // Who chooses: before /v1/themes/:id, or "policy" would be read as a theme id.
    router.put('/v1/themes/policy', ...operator, ...notLb, async (req, res) => {
        const { personalChoice, offered, default: def } = (req.body ?? {}) as { personalChoice?: boolean; offered?: string[]; default?: string };
        try { res.json(success(config.nodeId, await svc.setPolicy({ personalChoice, offered, default: def }, provenance))); } catch (err) { sendError(res, err); }
    });

    router.post('/v1/themes/preview', ...operator, async (req, res) => {
        try { res.json(success(config.nodeId, svc.preview(((req.body ?? {}) as { theme?: Partial<Theme> }).theme ?? {}))); } catch (err) { sendError(res, err); }
    });

    router.post('/v1/themes', ...operator, ...notLb, async (req, res) => {
        // A copy of basedOn; the theme's own fields sent with it land on the copy in the same save.
        const body = (req.body ?? {}) as ThemeInput & { basedOn?: string };
        try { res.status(201).json(success(config.nodeId, await svc.create(body, by(req)))); } catch (err) { sendError(res, err); }
    });

    router.get('/v1/themes/:id', async (req, res) => {
        try {
            const theme = await svc.get(String(req.params.id));
            if (!theme) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `There is no theme "${String(req.params.id)}".`)); return; }
            res.json(success(config.nodeId, { theme, warnings: svc.warningsOf(theme), versions: await svc.versions(theme.id) }));
        } catch (err) { sendError(res, err); }
    });

    router.put('/v1/themes/:id', ...operator, ...notLb, async (req, res) => {
        try { res.json(success(config.nodeId, await svc.update(String(req.params.id), (req.body ?? {}) as ThemeInput, by(req), dry(req)))); } catch (err) { sendError(res, err); }
    });

    router.get('/v1/themes/:id/theme.css', async (req, res) => {
        try {
            const { css, etag } = await svc.stylesheet(String(req.params.id));
            res.setHeader('ETag', etag);
            res.setHeader('Cache-Control', 'public, max-age=60');
            if (req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
            res.type('text/css; charset=utf-8').send(css);
        } catch (err) { sendError(res, err); }
    });

    router.post('/v1/themes/:id/styles', ...operator, ...notLb, async (req, res) => {
        try { res.status(dry(req) ? 200 : 201).json(success(config.nodeId, await svc.saveStyle(String(req.params.id), null, (req.body ?? {}) as StyleInput & { basedOn?: string }, by(req), dry(req)))); } catch (err) { sendError(res, err); }
    });

    router.put('/v1/themes/:id/styles/:styleId', ...operator, ...notLb, async (req, res) => {
        try { res.json(success(config.nodeId, await svc.saveStyle(String(req.params.id), String(req.params.styleId), (req.body ?? {}) as StyleInput, by(req), dry(req)))); } catch (err) { sendError(res, err); }
    });

    router.put('/v1/themes/:id/components/:componentId', ...operator, ...notLb, async (req, res) => {
        const css = ((req.body ?? {}) as { css?: unknown }).css;
        if (css !== null && css !== undefined && typeof css !== 'string') { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'css is text, or empty to remove it')); return; }
        try { res.json(success(config.nodeId, await svc.setComponentCss(String(req.params.id), String(req.params.componentId), (css as string | null | undefined) ?? null, by(req), dry(req)))); } catch (err) { sendError(res, err); }
    });

    router.get('/v1/themes/:id/versions', ...operator, async (req, res) => {
        try { res.json(success(config.nodeId, { versions: await svc.versions(String(req.params.id)) })); } catch (err) { sendError(res, err); }
    });

    router.post('/v1/themes/:id/versions/:version/restore', ...operator, ...notLb, async (req, res) => {
        const version = Number(req.params.version);
        if (!Number.isInteger(version) || version < 1) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'version is a whole number from the versions list')); return; }
        try { res.json(success(config.nodeId, await svc.restore(String(req.params.id), version, by(req)))); } catch (err) { sendError(res, err); }
    });

    return router;
}
