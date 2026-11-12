/**
 * @file src/routes/site.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Portal/site routes — serve the portal HTML and manage the operator's custom
 *              template, portal memory/KV, changelog and cache. Protocol-only (no SSR beyond
 *              the operator-authored portal template).
 * @usage Mounted in server.ts via siteRouter(config, storage).
 * @version-history
 *   v1.9.0 — 2026-11-12 — The template routes take `lang`: GET, POST and DELETE /v1/site/template
 *            reach a language version, GET lists the versions, POST /v1/site/import takes
 *            `templates`, and GET /v1/site/sync carries the versions to a copy.
 *   v1.8.0 — 2026-10-05 — The operator routes ask requireOperator (askOperator with operator:admin), so the operator's agent holding operator:admin passes as on MCP (secaudit 2026-10, C2).
 *   v1.7.0 — 2026-09-24 — Mounts themesRouter (/v1/themes*, Themes & Styles) behind the same LB guard,
 *            with the config provenance (who chooses is saved like any setting).
 *   v1.6.0 — 2026-08-28 — GET /v1/site/store-tiers: the store's public price record (ext:shop /
 *            tiers), fetched by the node through safeFetch and held five minutes, because the
 *            browser's CSP cannot reach the store's origin and the front page must not wait on it.
 *   v1.1.0 — 2026-06-18 — GET /v1/site/template returns 200 {template:null} (not 404) when no
 *            custom template is set, so polling clients stop logging spurious 404s.
 *   v1.2.0 — 2026-06-19 — Add GET (public) + PUT (operator) /v1/site/header-nav for
 *            operator-configurable header navigation links (visibility + order).
 *   v1.3.0 — 2026-07-01 — GET /v1/site/header-nav also returns a `features` map of node feature flags
 *            (currently { secretary }) so the SPA shell can hide optional surfaces when disabled.
 *   v1.4.0 — 2026-07-14 — WebMCP bridge note: the script injection lives in SiteService
 *            .getPortalHtml (the chokepoint both GET / routes share), not here (TARGET-034 C).
 *   v1.5.0 — 2026-07-14 — Markdown for Agents: GET / converts the portal HTML to markdown
 *            when Accept prefers text/markdown; Vary: Accept.
 */
import { Router, type RequestHandler, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOperator } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { SiteService, SiteError } from '../services/site.js';
import { siteLayoutRouter } from './site-layout.js';
import { themesRouter } from './themes.js';
import type { ConfigProvenance } from '../services/config-provenance.js';
import { isReservedSurfaceKey } from '../services/surface-layout/keys.js';
import { safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';

/** The store's price record, held for five minutes so the front page never waits on the store. */
const STORE_TIERS_TTL_MS = 5 * 60 * 1000;
let storeTiersCache: { store: string; at: number; body: { store: string | null; from: string | null; tiers: { name: string; price: string }[] } } | null = null;

export function siteRouter(config: AimeatConfig, storage: Storage, siteService?: SiteService, provenance?: ConfigProvenance): Router {
    const router = Router();
    const site = siteService ?? new SiteService(config, storage);

    // LB write guard — blocks portal modifications when in load-balancer mode
    const requireNotLb: RequestHandler = (_req, res, next) => {
        if (config.siteLbEnabled) {
            res.status(409).json(error(config.nodeId, 'LB_MODE',
                'This copy only mirrors the main site, so it cannot be edited here. Make the change on the main one.'));
            return;
        }
        next();
    };

    /** The language a request names: a code, undefined when it names none, false when the value is no code. */
    const namedLanguage = (value: unknown): string | undefined | false => {
        if (value === undefined || value === null || value === '') return undefined;
        const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
        return /^[a-z]{2}$/.test(text) ? text : false;
    };
    const refuseLanguage = (res: Response): void => {
        res.status(422).json(error(config.nodeId, 'TEMPLATE_LANG_INVALID',
            'Write the language as a two-letter code, such as "fi" or "en", then send it again. Leave it out for the default page.'));
    };

    // The surface layouts live in their own file but on this router, so they inherit the LB guard
    // and the whole site family answers from one mount.
    router.use(siteLayoutRouter(config, storage, requireNotLb));
    // The node's themes (Themes & Styles) are the site's look: the same family, the same guard.
    router.use(themesRouter(config, storage, requireNotLb, provenance));


    // GET /v1/site — Portal metadata (JSON)
    router.get('/v1/site', async (_req, res) => {
        const data = await site.getMetadata();
        res.json(success(config.nodeId, data, [
            { description: 'View the portal', method: 'GET', url: '/' },
            { description: 'Get AI prompt', method: 'GET', url: '/v1/site/prompt' },
            { description: 'View action catalogue', method: 'GET', url: '/v1/actions/catalogue' },
        ]));
    });

    // GET /v1/site/template — Download current template (operator)
    // No custom template is a normal state (default portal active), NOT an error:
    // return 200 with template:null so clients don't log a spurious 404 on every poll.
    // `?lang=<code>` names a language version of the template; without it the route means the
    // default page. A value that is not a language code is refused, never read as "no language":
    // a mistyped code on DELETE would otherwise delete the whole front page.
    router.get('/v1/site/template', requireAuth(), requireOperator(storage), async (req, res) => {
        const lang = namedLanguage(req.query.lang);
        if (lang === false) { refuseLanguage(res); return; }
        const [result, pages] = await Promise.all([site.getTemplate(lang), site.listTemplates()]);
        const languages = pages.filter(p => p.lang !== null)
            .map(p => ({ lang: p.lang, size_bytes: p.sizeBytes, updated_at: p.updatedAt }));
        res.json(success(config.nodeId, {
            template: result?.template ?? null,
            lang: lang ?? null,
            size_bytes: result?.sizeBytes ?? 0,
            updated_at: result?.updatedAt ?? null,
            tags_found: result?.tagsFound ?? [],
            languages,
        }));
    });

    // POST /v1/site/template — Upload the default page, or with `lang` a language version (operator)
    router.post('/v1/site/template', requireAuth(), requireOperator(storage), requireNotLb, async (req, res) => {
        const { template } = req.body ?? {};
        if (!template || typeof template !== 'string') {
            res.status(422).json(error(config.nodeId, 'TEMPLATE_INVALID', 'Name the template you want to use, then send it again.'));
            return;
        }
        const lang = namedLanguage(req.body?.lang ?? req.query.lang);
        if (lang === false) { refuseLanguage(res); return; }
        try {
            const result = await site.uploadTemplate(template, req.auth!.sub, lang);
            res.json(success(config.nodeId, {
                stored: true,
                lang: lang ?? null,
                size_bytes: Buffer.byteLength(template, 'utf-8'),
                tags_found: result.tagsFound,
                unresolvable_tags: result.unresolvableTags,
            }));
            emitChange('site');
        } catch (err) {
            if (err instanceof SiteError) {
                res.status(err.httpStatus).json(error(config.nodeId, err.code, err.message));
                return;
            }
            throw err;
        }
    });

    // DELETE /v1/site/template — Revert to default: the default page and its language versions.
    // With `lang`, that language version only (operator)
    router.delete('/v1/site/template', requireAuth(), requireOperator(storage), requireNotLb, async (req, res) => {
        const lang = namedLanguage(req.query.lang);
        if (lang === false) { refuseLanguage(res); return; }
        const deleted = await site.deleteTemplate(req.auth!.sub, lang);
        if (lang && !deleted) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `The front page has no ${lang} version.`));
            return;
        }
        res.json(success(config.nodeId, lang ? { deleted: true, lang } : { deleted: true, reverted_to: 'default' }));
        emitChange('site');
    });

    // POST /v1/site/import — Import portal bundle (operator)
    router.post('/v1/site/import', requireAuth(), requireOperator(storage), requireNotLb, async (req, res) => {
        const body = req.body ?? {};
        if (!body.template && !body.templates && !body.memory && !body.kv) {
            res.status(422).json(error(config.nodeId, 'IMPORT_INVALID', 'Bundle must include at least one of: template, templates, memory, kv'));
            return;
        }
        // The language versions of the template: { "<code>": "<html>" }, each a whole page.
        if (body.templates !== undefined) {
            const entries = body.templates && typeof body.templates === 'object' && !Array.isArray(body.templates)
                ? Object.entries(body.templates as Record<string, unknown>) : null;
            if (!entries || entries.some(([lang, page]) => !/^[a-z]{2}$/.test(lang) || typeof page !== 'string' || !page)) {
                res.status(422).json(error(config.nodeId, 'IMPORT_INVALID',
                    '"templates" is an object of language versions: a two-letter language code to that page\'s HTML.'));
                return;
            }
        }
        // Validate memory keys are under portal/* namespace
        if (body.memory && typeof body.memory === 'object') {
            for (const key of Object.keys(body.memory)) {
                if (!key.startsWith('portal/')) {
                    res.status(422).json(error(config.nodeId, 'IMPORT_INVALID', `Memory key "${key}" must start with "portal/"`));
                    return;
                }
                // A layout lives under portal/ so it mirrors and imports like any other portal
                // record — which means this door can reach it, and it must not. The layout is
                // checked against the block registry before it is stored, and a raw string dropped
                // in here would be a second way past that check. Same shape as the gate that was
                // enforced on the tool surface and bypassed on the HTTP route.
                if (isReservedSurfaceKey(key)) {
                    res.status(422).json(error(config.nodeId, 'MEMORY_RESERVED',
                        'That record holds a page layout, which is checked against the blocks this node has before it is stored. Send it as a layout rather than as a portal record.'));
                    return;
                }
                if (typeof body.memory[key] !== 'string') {
                    res.status(422).json(error(config.nodeId, 'IMPORT_INVALID', `Memory value for "${key}" must be a string`));
                    return;
                }
            }
        }
        if (body.kv && typeof body.kv !== 'object') {
            res.status(422).json(error(config.nodeId, 'IMPORT_INVALID', '"kv" must be an object'));
            return;
        }
        try {
            const result = await site.importBundle(
                {
                    template: typeof body.template === 'string' ? body.template : undefined,
                    templates: body.templates as Record<string, string> | undefined,
                    memory: body.memory as Record<string, string> | undefined,
                    kv: body.kv as Record<string, string> | undefined,
                },
                req.auth!.sub,
            );
            res.json(success(config.nodeId, {
                template_stored: result.templateStored,
                template_versions_stored: result.templateVersionsStored,
                memory_keys_written: result.memoryKeysWritten,
                kv_pairs_updated: result.kvPairsUpdated,
                changelog_entry_id: result.changelogEntryId,
            }));
            emitChange('site');
        } catch (err) {
            if (err instanceof SiteError) {
                res.status(err.httpStatus).json(error(config.nodeId, err.code, err.message));
                return;
            }
            throw err;
        }
    });

    // GET /v1/site/changelog — View change log (operator)
    router.get('/v1/site/changelog', requireAuth(), requireOperator(storage), async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit as string ?? '20', 10) || 20, 100);
        const cursor = req.query.cursor as string | undefined;
        const entries = await storage.listSiteChangeLog(limit, cursor);
        res.json(success(config.nodeId, entries));
    });

    // POST /v1/site/cache-invalidate — Force cache refresh (operator)
    router.post('/v1/site/cache-invalidate', requireAuth(), requireOperator(storage), async (req, res) => {
        await site.invalidateCacheAction(req.auth!.sub);
        res.json(success(config.nodeId, { cache_cleared: true }));
        emitChange('site');
    });

    // GET /v1/site/header-nav — Header navigation config (public; the SPA header reads this)
    // Public on purpose: the header renders for anonymous visitors too. Returns a normalized
    // { order, hidden } over the known public link ids (defaults = all visible, default order),
    // plus a `features` map of node-level feature flags the SPA shell needs to gate optional
    // surfaces (e.g. the Secretary nav link + the company Secretary subtab). Node capabilities are
    // already public via the federation descriptor, so exposing these booleans here is consistent.
    router.get('/v1/site/header-nav', async (_req, res) => {
        const data = await site.getHeaderNav();
        res.json(success(config.nodeId, {
            ...data,
            features: {},
        }, [
            { description: 'Update header navigation (operator)', method: 'PUT', url: '/v1/site/header-nav' },
        ]));
    });

    // GET /v1/site/store-tiers — the store's public price record, fetched by the node.
    //
    // THE STORE IS THE SOURCE OF ITS OWN PRICES, AND THE NODE IS THE ONE THAT ASKS. The front
    // page's store section shows the ladder the store publishes as the public record
    // `ext:shop / tiers` (value { from, tiers: [{ name, price }] }). The browser cannot ask for
    // it: this node's CSP allows connections to itself only, and widening it to a configured
    // origin is a larger door than a five-minute cache here. safeFetch, because the address is
    // configuration and not a constant. Empty `tiers` is the honest answer for no store, a store
    // that has not published the record, or one that did not answer in time: the page then shows
    // the ladder the operator typed into the block.
    router.get('/v1/site/store-tiers', async (_req, res) => {
        const store = (config.siteLinks.store || '').trim().replace(/\/+$/, '');
        const empty = { store: store || null, from: null as string | null, tiers: [] as { name: string; price: string }[] };
        if (!store) { res.json(success(config.nodeId, empty)); return; }
        const now = Date.now();
        if (storeTiersCache && storeTiersCache.store === store && now - storeTiersCache.at < STORE_TIERS_TTL_MS) {
            res.set('Cache-Control', 'public, max-age=300');
            res.json(success(config.nodeId, storeTiersCache.body));
            return;
        }
        let body = empty;
        try {
            const r = await safeFetch(`${store}/v1/memory/ext%3Ashop/tiers?soft=1`, { signal: AbortSignal.timeout(3000) });
            const j = r.ok ? await r.json() as { data?: { value?: unknown } } : null;
            const v = j?.data?.value as { from?: unknown; tiers?: unknown } | null | undefined;
            const rows = Array.isArray(v?.tiers)
                ? (v!.tiers as unknown[])
                    .map(t => ({ name: String((t as { name?: unknown })?.name ?? '').trim(), price: String((t as { price?: unknown })?.price ?? '').trim() }))
                    .filter(t => t.name && t.price)
                : [];
            if (rows.length) body = { store, from: typeof v?.from === 'string' ? v.from.trim() : null, tiers: rows };
        } catch (err) {
            // A store that does not answer is not an error on this page; the fallback ladder is.
            logger.warn('site: store tiers not read', { store, error: String(err) });
        }
        storeTiersCache = { store, at: now, body };
        res.set('Cache-Control', 'public, max-age=300');
        res.json(success(config.nodeId, body));
    });

    // PUT /v1/site/header-nav — Update header navigation config (operator)
    router.put('/v1/site/header-nav', requireAuth(), requireOperator(storage), requireNotLb, async (req, res) => {
        const { order, hidden } = req.body ?? {};
        try {
            const data = await site.setHeaderNav({ order, hidden }, req.auth!.sub);
            res.json(success(config.nodeId, data));
            emitChange('site');
        } catch (err) {
            if (err instanceof SiteError) {
                res.status(err.httpStatus).json(error(config.nodeId, err.code, err.message));
                return;
            }
            throw err;
        }
    });

    // GET /v1/site/prompt — AI navigation prompt
    router.get('/v1/site/prompt', async (_req, res) => {
        const prompt = await site.getPrompt();
        res.json(success(config.nodeId, { prompt }));
    });

    // GET /v1/site/memory-keys — List portal memory keys with values (operator)
    router.get('/v1/site/memory-keys', requireAuth(), requireOperator(storage), async (_req, res) => {
        const keys = await site.getPortalMemoryEntries();
        res.json(success(config.nodeId, { keys }));
    });

    // POST /v1/site/memory — Set a single portal memory key (operator)
    // Writes to the site (__site__) namespace so {{memory:portal/*}} tags resolve.
    router.post('/v1/site/memory', requireAuth(), requireOperator(storage), requireNotLb, async (req, res) => {
        const { key, value } = req.body ?? {};
        if (!key || typeof key !== 'string') {
            res.status(422).json(error(config.nodeId, 'MEMORY_INVALID', 'Name the key you want to write to, then send it again.'));
            return;
        }
        if (typeof value !== 'string') {
            res.status(422).json(error(config.nodeId, 'MEMORY_INVALID', 'Include the value you want to save, then send it again.'));
            return;
        }
        try {
            await site.setPortalMemory(key, value, req.auth!.sub);
            res.json(success(config.nodeId, { stored: true, key }));
            emitChange('site');
        } catch (err) {
            if (err instanceof SiteError) {
                res.status(err.httpStatus).json(error(config.nodeId, err.code, err.message));
                return;
            }
            throw err;
        }
    });

    // DELETE /v1/site/memory/:key — Delete a single portal memory key (operator)
    router.delete('/v1/site/memory/:key', requireAuth(), requireOperator(storage), requireNotLb, async (req, res) => {
        const key = req.params.key as string;
        let deleted: boolean;
        try {
            deleted = await site.deletePortalMemory(key, req.auth!.sub);
        } catch (err) {
            // A reserved key is refused with a reason a person can act on. Without this the refusal
            // reached the operator as a 500, which reads as "the node is broken" rather than "that
            // record is not yours to delete here".
            if (err instanceof SiteError) {
                res.status(err.httpStatus).json(error(config.nodeId, err.code, err.message));
                return;
            }
            throw err;
        }
        if (!deleted) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Portal memory key "${key}" not found`));
            return;
        }
        res.json(success(config.nodeId, { deleted: true, key }));
        emitChange('site');
    });

    // GET /v1/site/sync — Origin sync endpoint for LB nodes (no auth, portal content is public)
    router.get('/v1/site/sync', async (req, res) => {
        const since = req.query.since as string | undefined;
        const sinceDate = since ? new Date(since) : new Date(0);

        // Template
        const templateRecord = await storage.getStorageFile('__site__', '__site_template__');
        let template: { html: string; updated_at: string } | null = null;
        if (templateRecord) {
            const updatedAt = templateRecord.createdAt;
            if (new Date(updatedAt) > sinceDate) {
                template = { html: templateRecord.data.toString('utf-8'), updated_at: updatedAt };
            }
        }

        // The template's language versions: the ones changed since, and the codes of all that
        // exist, so a copy drops a version the origin no longer has.
        const pages = (await site.listTemplates()).filter(p => p.lang !== null);
        const templateVersions: Array<{ lang: string; html: string; updated_at: string }> = [];
        for (const page of pages) {
            if (!(new Date(page.updatedAt) > sinceDate)) continue;
            const version = await site.getTemplate(page.lang!);
            if (version) templateVersions.push({ lang: page.lang!, html: version.template, updated_at: version.updatedAt });
        }

        // Portal memory keys
        const allMemory = await storage.listMemory('__site__', { prefix: 'portal/' });
        const memoryKeys = allMemory
            .filter(r => new Date(r.updatedAt) > sinceDate)
            .map(r => ({ key: r.key, value: r.value, updated_at: r.updatedAt }));

        // System board posts
        const boards = await storage.listBoards({ visibility: 'system' });
        const systemBoardPosts: Array<{ id: string; board_id: string; title: string; body: string; created_at: string }> = [];
        for (const board of boards) {
            const posts = await storage.listPosts(board.id, { limit: 50 });
            for (const p of posts) {
                if (new Date(p.createdAt) > sinceDate) {
                    systemBoardPosts.push({ id: p.id, board_id: p.boardId, title: p.title, body: p.body, created_at: p.createdAt });
                }
            }
        }

        res.json(success(config.nodeId, {
            sync_timestamp: new Date().toISOString(),
            template,
            template_versions: templateVersions,
            template_languages: pages.map(p => p.lang),
            memory_keys: memoryKeys,
            deleted_memory_keys: [],
            kv: config.siteKv,
            system_board_posts: systemBoardPosts,
            deleted_post_ids: [],
        }));
    });

    return router;
}
