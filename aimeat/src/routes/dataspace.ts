/**
 * @file src/routes/dataspace.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's and the operator's endpoints of the Dataspace Protocol provider (plan
 *   doc-mvwxcas3dom3, D8). The work is services/dataspace/owner.ts and status.ts, which the MCP tool
 *   aimeat_dataspace calls too; this file parses requests and renders answers in the node's envelope.
 *   The protocol endpoints a connector calls are routes/dsp/.
 *
 *   The owner's endpoints take a node session of the account: the owner in person, or a principal of
 *   the owner holding party:manage (an agreement makes an outside party and shares a package with it).
 *   They answer whether or not the dataspace is on, so an owner reads and ends what was agreed after
 *   the operator switched it off.
 * @structure
 *   - GET  /v1/dataspace/negotiations                 the negotiations of the owner's packages (?state, ?waiting=true)
 *   - GET  /v1/dataspace/negotiations/:pid            one, with its transfers
 *   - POST /v1/dataspace/negotiations/:pid/approve    agree to a request that waits
 *   - POST /v1/dataspace/negotiations/:pid/decline    decline it, or end an agreement
 *   - GET/PUT /v1/dataspace/settings                  which packages agree on their own
 *   - GET  /v1/admin/dataspace                        the operator's status read
 *   - PUT  /v1/admin/dataspace/tck-result             the operator records a TCK run
 * @usage app.use(dataspaceRouter(config, storage))
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope, requireOperator } from '../auth/middleware.js';
import { refuseAnonymousPrincipal } from '../auth/anonymous-principal.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { deny403 } from '../auth/deny.js';
import { validateBody } from '../models/schemas.js';
import { DataspaceDeclineSchema, DataspaceSettingsSchema, DataspaceTckResultSchema } from '../models/dataspace-schemas.js';
import {
    approveNegotiation, dataspaceSettings, declineNegotiation, getOwnerNegotiation, listOwnerNegotiations,
    type DataspaceAnswer, type DataspaceOwnerCtx,
} from '../services/dataspace/owner.js';
import { dataspaceStatus, recordTckResult } from '../services/dataspace/status.js';

export function dataspaceRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const deps = { storage, config };
    const ctxOf = (req: Request): DataspaceOwnerCtx => ({ deps, caller: callerOf(req, config.nodeId, storage) });
    const render = <T>(req: Request, res: Response, out: DataspaceAnswer<T>) => {
        if (out.ok) { res.json(success(config.nodeId, out.data as Record<string, unknown>)); return; }
        if (out.status === 403 && (out.code === 'SCOPE_DENIED' || out.code === 'FORBIDDEN')) { deny403(req, res, out.code, out.message); return; }
        res.status(out.status).json(error(config.nodeId, out.code, out.message));
    };
    const owner = [requireAuth(), refuseAnonymousPrincipal(), requireScope('party:manage')];
    const pid = (req: Request) => String(req.params.pid ?? '');

    router.get('/v1/dataspace/negotiations', ...owner, async (req, res) => {
        render(req, res, await listOwnerNegotiations(ctxOf(req), {
            ...(typeof req.query.state === 'string' ? { state: req.query.state } : {}), waiting: req.query.waiting === 'true',
        }));
    });
    router.get('/v1/dataspace/negotiations/:pid', ...owner, async (req, res) => { render(req, res, await getOwnerNegotiation(ctxOf(req), pid(req))); });
    router.post('/v1/dataspace/negotiations/:pid/approve', ...owner, validateBody(DataspaceDeclineSchema, config.nodeId), async (req, res) => {
        render(req, res, await approveNegotiation(ctxOf(req), pid(req)));
    });
    router.post('/v1/dataspace/negotiations/:pid/decline', ...owner, validateBody(DataspaceDeclineSchema, config.nodeId), async (req, res) => {
        const { reason } = (req.body ?? {}) as { reason?: string };
        render(req, res, await declineNegotiation(ctxOf(req), pid(req), reason));
    });
    router.get('/v1/dataspace/settings', ...owner, async (req, res) => { render(req, res, await dataspaceSettings(ctxOf(req))); });
    router.put('/v1/dataspace/settings', ...owner, validateBody(DataspaceSettingsSchema, config.nodeId), async (req, res) => {
        render(req, res, await dataspaceSettings(ctxOf(req), (req.body ?? {}) as Record<string, unknown>));
    });

    // ── The operator ──
    router.get('/v1/admin/dataspace', requireAuth(), requireOperator(storage), async (_req, res) => {
        res.json(success(config.nodeId, await dataspaceStatus(deps)));
    });
    router.put('/v1/admin/dataspace/tck-result', requireAuth(), requireOperator(storage), validateBody(DataspaceTckResultSchema, config.nodeId), async (req, res) => {
        const out = await recordTckResult(storage, config.nodeId, (req.body ?? {}) as Record<string, unknown>);
        if (!out.ok) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', out.message)); return; }
        res.json(success(config.nodeId, { recorded: out.value }));
    });

    return router;
}
