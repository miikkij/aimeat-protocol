/**
 * @file src/routes/themes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Themes & Styles over HTTP: the node's themes, what the pill offers, the stylesheet of
 *   the node's own themes, the operator's edits, and a person's own choice.
 *
 *   GET  /v1/themes             public: what the pill offers and the operator's choices
 *   GET  /v1/themes.css         public: every custom theme that is not retired, as one stylesheet
 *   GET  /v1/themes/all         public: every theme with its full values and contrast, and what a
 *                               theme may set (tokens, faces, hooks), for the editor and for an AI
 *   GET  /v1/themes/choice      a signed-in person's own choice
 *   PUT  /v1/themes/choice      save it to their account
 *   POST /v1/themes/check       operator: check a draft without saving it
 *   POST /v1/themes             operator: a new theme, or a copy (basedOn)
 *   GET  /v1/themes/:id         public: one theme
 *   PUT  /v1/themes/:id         operator: edit, retire (retired: true) or bring back
 *
 *   Reading is public on purpose: a theme is CSS every visitor downloads anyway, and other admins
 *   see the themes without being able to change them (Jouni, 2026-09-24: only the operator edits).
 *   The writes go through requireOperatorPrincipal, not requireRole('operator'), so the operator's
 *   own agent can make a theme from a chat when it holds site:theme-write.
 * @structure themesRouter(config, storage, requireNotLb?)
 * @usage app.use(themesRouter(config, storage, requireNotLb));
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles).
 */
import { Router, type RequestHandler } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireOperatorPrincipal } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { THEME_WRITE_SCOPE } from '../utils/scope-coverage.js';
import { ThemeService, ThemeError, type ThemeInput } from '../services/themes/service.js';
import { catalogueHooks, themeStylesheet } from '../services/themes/css.js';
import { requireOwnerSession } from './home/welcome-mat.js';
import { onChangeEvent } from '../services/event-bus.js';

export function themesRouter(config: AimeatConfig, storage: Storage, requireNotLb?: RequestHandler): Router {
    const router = Router();
    const svc = new ThemeService(config, storage);
    const notLb: RequestHandler[] = requireNotLb ? [requireNotLb] : [];
    const operator: RequestHandler[] = [requireAuth(), requireOperatorPrincipal(storage, THEME_WRITE_SCOPE), ...notLb];

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

    router.get('/v1/themes', async (_req, res) => {
        try {
            const snap = await svc.offered();
            res.json(success(config.nodeId, { policy: snap.policy, themes: snap.themes, stylesheet: `/v1/themes.css?v=${snap.stamp}` }, [
                { description: 'Every theme with its values', method: 'GET', url: '/v1/themes/all' },
            ]));
        } catch (err) { sendError(res, err); }
    });

    router.get('/v1/themes.css', async (req, res) => {
        try {
            const { css, etag } = await svc.stylesheet();
            res.setHeader('ETag', etag);
            res.setHeader('Cache-Control', 'public, max-age=60');
            if (req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
            res.type('text/css; charset=utf-8').send(css);
        } catch (err) { sendError(res, err); }
    });

    // ?summary=1 gives each theme its core colours and failing contrast only (what a chat needs).
    router.get('/v1/themes/all', async (req, res) => {
        try {
            res.json(success(config.nodeId, await svc.catalogue(req.query.summary === '1' || req.query.summary === 'true')));
        } catch (err) { sendError(res, err); }
    });

    router.get('/v1/themes/choice', requireAuth(), requireRole('owner'), requireOwnerSession(config.nodeId), async (req, res) => {
        try {
            const snap = await svc.offered();
            const chosen = await svc.choiceGet(resolveIdentity(req.auth!, config.nodeId));
            res.json(success(config.nodeId, { theme: chosen, personalChoice: snap.policy.personalChoice, default: snap.policy.default }));
        } catch (err) { sendError(res, err); }
    });

    router.put('/v1/themes/choice', requireAuth(), requireRole('owner'), requireOwnerSession(config.nodeId), async (req, res) => {
        const theme = (req.body ?? {}).theme;
        if (typeof theme !== 'string' || !theme) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'theme is a theme id, such as "aimeat"'));
            return;
        }
        try {
            res.json(success(config.nodeId, await svc.choiceSet(resolveIdentity(req.auth!, config.nodeId), theme)));
        } catch (err) { sendError(res, err); }
    });

    router.post('/v1/themes/check', ...operator, async (req, res) => {
        const body = (req.body ?? {}) as ThemeInput & { id?: string };
        try {
            const draft = await svc.draft(body, body.id ?? null);
            res.json(success(config.nodeId, {
                ok: true, contrast: svc.contrastOf(draft.light, draft.dark),
                stylesheet: themeStylesheet({ ...draft, id: 'draft' }, catalogueHooks()),
            }));
        } catch (err) {
            if (err instanceof ThemeError && (err.code === 'INVALID_THEME' || err.code === 'CONTRAST')) {
                // A draft that only misses contrast can still be looked at: its stylesheet comes too.
                const draft = (err.details as { draft?: Parameters<typeof themeStylesheet>[0] } | undefined)?.draft;
                res.json(success(config.nodeId, {
                    ok: false, code: err.code, message: err.message, details: err.details,
                    ...(draft ? { stylesheet: themeStylesheet({ ...draft, id: 'draft' }, catalogueHooks()) } : {}),
                }));
                return;
            }
            sendError(res, err);
        }
    });

    router.post('/v1/themes', ...operator, async (req, res) => {
        try {
            const theme = await svc.create((req.body ?? {}) as ThemeInput, resolveIdentity(req.auth!, config.nodeId));
            res.status(201).json(success(config.nodeId, { theme }, [
                { description: 'Offer it in the pill', method: 'PUT', url: '/v1/admin/config' },
            ]));
        } catch (err) { sendError(res, err); }
    });

    router.get('/v1/themes/:id', async (req, res) => {
        try {
            const theme = await svc.get(String(req.params.id));
            if (!theme) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `There is no theme "${String(req.params.id)}".`)); return; }
            res.json(success(config.nodeId, { theme: { ...theme, contrast: svc.contrastOf(theme.light, theme.dark) } }));
        } catch (err) { sendError(res, err); }
    });

    router.put('/v1/themes/:id', ...operator, async (req, res) => {
        try {
            const theme = await svc.update(String(req.params.id), (req.body ?? {}) as ThemeInput, resolveIdentity(req.auth!, config.nodeId));
            res.json(success(config.nodeId, { theme }));
        } catch (err) { sendError(res, err); }
    });

    return router;
}
