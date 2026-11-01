/**
 * @file src/routes/dataproducts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The HTTP endpoints of data products: the definitions that build a data package version
 *   from records, app data, memory, an extension, a file or another package (plan doc-mvwxcas3dom3, D9).
 *   The work is services/dataproduct/service.ts, which the MCP tool aimeat_dataproduct calls too; this
 *   file parses the request and renders the answer.
 * @structure
 *   - GET    /v1/dataproducts                 the caller's own definitions (storage:read)
 *   - GET    /v1/dataproducts/:name           one definition, its schedule and its package (storage:read)
 *   - PUT    /v1/dataproducts/:name           define or replace (storage:write and memory:write)
 *   - DELETE /v1/dataproducts/:name           delete it and its schedules (storage:write and memory:write)
 *   - POST   /v1/dataproducts/:name/preview   build without publishing (storage:read); a body with
 *                                             `sources` previews a draft that is not stored
 *   - POST   /v1/dataproducts/:name/run       build and publish one version (storage:write and memory:write)
 *   - POST   /v1/dataproducts/:name/describe  a description draft by the owner's own AI (storage:read, ai:use)
 * @usage app.use(dataProductsRouter(config, storage))
 * @version-history
 *   v1.1.0 — 2026-11-01 — POST /v1/dataproducts/:name/describe: a description draft by the owner's own
 *     AI (storage:read and ai:use); a refusal carries its `details` (WP9c).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { refuseAnonymousPrincipal } from '../auth/anonymous-principal.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { deny403 } from '../auth/deny.js';
import { validateBody } from '../models/schemas.js';
import { DataProductBodySchema, DataProductRunBodySchema, DataProductDescribeBodySchema } from '../models/dataproduct-schemas.js';
import { describeProduct } from '../services/dataproduct/describe.js';
import {
    defineProduct, getProduct, listProducts, deleteProduct, previewProductAnswer, runStored,
    type DataProductAnswer, type DataProductCtx,
} from '../services/dataproduct/service.js';

export function dataProductsRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const ctxOf = (req: Request): DataProductCtx => {
        const isApp = req.auth!.roles.includes('app');
        return {
            deps: { storage, config }, caller: callerOf(req, config.nodeId, storage),
            ...(isApp && req.auth!.app ? { app: req.auth!.app } : {}),
            ...(isApp && req.auth!.app_grant ? { appGrant: req.auth!.app_grant } : {}),
        };
    };
    const render = <T>(req: Request, res: Response, out: DataProductAnswer<T>, okStatus = 200, links: Array<{ description: string; method: string; url: string }> = []) => {
        if (out.ok) { res.status(okStatus).json(success(config.nodeId, out.data as Record<string, unknown>, links)); return; }
        if (out.status === 403 && (out.code === 'SCOPE_DENIED' || out.code === 'FORBIDDEN')) { deny403(req, res, out.code, out.message); return; }
        const details = { ...(out.details ?? {}), ...(out.source ? { source: out.source } : {}) };
        res.status(out.status).json(error(config.nodeId, out.code, out.message, undefined, Object.keys(details).length ? details : undefined));
    };
    const name = (req: Request) => String(req.params.name ?? '');
    const self = (req: Request) => `/v1/dataproducts/${encodeURIComponent(name(req))}`;

    router.get('/v1/dataproducts', requireAuth(), refuseAnonymousPrincipal(), requireScope('storage:read'), async (req, res) => {
        render(req, res, await listProducts(ctxOf(req)));
    });

    router.get('/v1/dataproducts/:name', requireAuth(), refuseAnonymousPrincipal(), requireScope('storage:read'), async (req, res) => {
        render(req, res, await getProduct(ctxOf(req), name(req)), 200, [
            { description: 'Preview a build without publishing', method: 'POST', url: `${self(req)}/preview` },
            { description: 'Build and publish one version', method: 'POST', url: `${self(req)}/run` },
        ]);
    });

    // The words a publish asks, as literals so the REST scope scanner reads them.
    router.put('/v1/dataproducts/:name', requireAuth(), refuseAnonymousPrincipal(), requireScope('storage:write', 'memory:write'), validateBody(DataProductBodySchema, config.nodeId), async (req, res) => {
        const out = await defineProduct(ctxOf(req), name(req), (req.body ?? {}) as Record<string, unknown>);
        render(req, res, out, out.ok && out.data.created ? 201 : 200, [
            { description: 'Preview a build without publishing', method: 'POST', url: `${self(req)}/preview` },
            { description: 'Build and publish one version', method: 'POST', url: `${self(req)}/run` },
        ]);
    });

    router.delete('/v1/dataproducts/:name', requireAuth(), refuseAnonymousPrincipal(), requireScope('storage:write', 'memory:write'), async (req, res) => {
        render(req, res, await deleteProduct(ctxOf(req), name(req)));
    });

    router.post('/v1/dataproducts/:name/preview', requireAuth(), refuseAnonymousPrincipal(), requireScope('storage:read'), validateBody(DataProductBodySchema, config.nodeId), async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        render(req, res, await previewProductAnswer(ctxOf(req), name(req), Array.isArray(body.sources) ? body : undefined));
    });

    // A draft of the description by the owner's own AI. ai:use is the word POST /v1/ai/complete asks.
    router.post('/v1/dataproducts/:name/describe', requireAuth(), refuseAnonymousPrincipal(), requireScope('storage:read', 'ai:use'), validateBody(DataProductDescribeBodySchema, config.nodeId), async (req, res) => {
        render(req, res, await describeProduct(ctxOf(req), name(req), (req.body ?? {}) as Record<string, unknown>));
    });

    router.post('/v1/dataproducts/:name/run', requireAuth(), refuseAnonymousPrincipal(), requireScope('storage:write', 'memory:write'), validateBody(DataProductRunBodySchema, config.nodeId), async (req, res) => {
        const out = await runStored(ctxOf(req), name(req));
        render(req, res, out, out.ok && !out.data.unchanged && !out.data.publish_request ? 201 : out.ok && out.data.publish_request ? 202 : 200,
            out.ok ? [{ description: 'Read the descriptor (permanent)', method: 'GET', url: out.data.descriptor_url }] : []);
    });

    return router;
}
