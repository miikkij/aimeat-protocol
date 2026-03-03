import { Router, type RequestHandler } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { SiteService, SiteError } from '../services/site.js';

export function siteRouter(config: AimeatConfig, storage: Storage, siteService?: SiteService): Router {
    const router = Router();
    const site = siteService ?? new SiteService(config, storage);

    // LB write guard — blocks portal modifications when in load-balancer mode
    const requireNotLb: RequestHandler = (_req, res, next) => {
        if (config.siteLbEnabled) {
            res.status(409).json(error(config.nodeId, 'LB_MODE',
                'Cannot modify portal content in load-balancer mode. Content synced from origin.'));
            return;
        }
        next();
    };

    // GET / — Serve the portal HTML
    router.get('/', async (req, res) => {
        if (!config.siteEnabled) {
            res.status(404).send('Portal not enabled');
            return;
        }
        try {
            const langParam = req.query.lang as string | undefined;
            const html = await site.getPortalHtml(langParam, req.headers.cookie, req.headers['accept-language']);
            res.set('Cache-Control', `public, max-age=${config.siteCacheTtlSeconds}`);
            res.type('text/html').send(html);
        } catch (err) {
            if (err instanceof SiteError) {
                res.status(err.httpStatus).json(error(config.nodeId, err.code, err.message));
                return;
            }
            throw err;
        }
    });

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
    router.get('/v1/site/template', requireAuth(), requireRole('operator'), async (_req, res) => {
        const result = await site.getTemplate();
        if (!result) {
            res.status(404).json(error(config.nodeId, 'NO_TEMPLATE', 'No custom template. Default portal is active.'));
            return;
        }
        res.json(success(config.nodeId, {
            template: result.template,
            size_bytes: result.sizeBytes,
            updated_at: result.updatedAt,
            tags_found: result.tagsFound,
        }));
    });

    // POST /v1/site/template — Upload new template (operator)
    router.post('/v1/site/template', requireAuth(), requireRole('operator'), requireNotLb, async (req, res) => {
        const { template } = req.body ?? {};
        if (!template || typeof template !== 'string') {
            res.status(422).json(error(config.nodeId, 'TEMPLATE_INVALID', 'Request body must include "template" string'));
            return;
        }
        try {
            const result = await site.uploadTemplate(template, req.auth!.sub);
            res.json(success(config.nodeId, {
                stored: true,
                size_bytes: Buffer.byteLength(template, 'utf-8'),
                tags_found: result.tagsFound,
                unresolvable_tags: result.unresolvableTags,
            }));
        } catch (err) {
            if (err instanceof SiteError) {
                res.status(err.httpStatus).json(error(config.nodeId, err.code, err.message));
                return;
            }
            throw err;
        }
    });

    // DELETE /v1/site/template — Revert to default (operator)
    router.delete('/v1/site/template', requireAuth(), requireRole('operator'), requireNotLb, async (req, res) => {
        await site.deleteTemplate(req.auth!.sub);
        res.json(success(config.nodeId, { deleted: true, reverted_to: 'default' }));
    });

    // POST /v1/site/import — Import portal bundle (operator)
    router.post('/v1/site/import', requireAuth(), requireRole('operator'), requireNotLb, async (req, res) => {
        const body = req.body ?? {};
        if (!body.template && !body.memory && !body.kv) {
            res.status(422).json(error(config.nodeId, 'IMPORT_INVALID', 'Bundle must include at least one of: template, memory, kv'));
            return;
        }
        // Validate memory keys are under portal/* namespace
        if (body.memory && typeof body.memory === 'object') {
            for (const key of Object.keys(body.memory)) {
                if (!key.startsWith('portal/')) {
                    res.status(422).json(error(config.nodeId, 'IMPORT_INVALID', `Memory key "${key}" must start with "portal/"`));
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
                    memory: body.memory as Record<string, string> | undefined,
                    kv: body.kv as Record<string, string> | undefined,
                },
                req.auth!.sub,
            );
            res.json(success(config.nodeId, {
                template_stored: result.templateStored,
                memory_keys_written: result.memoryKeysWritten,
                kv_pairs_updated: result.kvPairsUpdated,
                changelog_entry_id: result.changelogEntryId,
            }));
        } catch (err) {
            if (err instanceof SiteError) {
                res.status(err.httpStatus).json(error(config.nodeId, err.code, err.message));
                return;
            }
            throw err;
        }
    });

    // GET /v1/site/changelog — View change log (operator)
    router.get('/v1/site/changelog', requireAuth(), requireRole('operator'), async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit as string ?? '20', 10) || 20, 100);
        const cursor = req.query.cursor as string | undefined;
        const entries = await storage.listSiteChangeLog(limit, cursor);
        res.json(success(config.nodeId, entries));
    });

    // POST /v1/site/cache-invalidate — Force cache refresh (operator)
    router.post('/v1/site/cache-invalidate', requireAuth(), requireRole('operator'), async (req, res) => {
        await site.invalidateCacheAction(req.auth!.sub);
        res.json(success(config.nodeId, { cache_cleared: true }));
    });

    // GET /v1/site/prompt — AI navigation prompt
    router.get('/v1/site/prompt', async (_req, res) => {
        const prompt = await site.getPrompt();
        res.json(success(config.nodeId, { prompt }));
    });

    // GET /v1/site/memory-keys — List portal memory keys with values (operator)
    router.get('/v1/site/memory-keys', requireAuth(), requireRole('operator'), async (_req, res) => {
        const keys = await site.getPortalMemoryEntries();
        res.json(success(config.nodeId, { keys }));
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
            memory_keys: memoryKeys,
            deleted_memory_keys: [],
            kv: config.siteKv,
            system_board_posts: systemBoardPosts,
            deleted_post_ids: [],
        }));
    });

    return router;
}
