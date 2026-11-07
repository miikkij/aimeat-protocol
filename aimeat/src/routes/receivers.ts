/**
 * @file src/routes/receivers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Managing receivers over REST: the owner's /v1/receivers routes and the operator's
 *   /v1/admin/receivers routes. Every handler calls services/receivers/manage.ts, the same functions the
 *   MCP tools aimeat_receiver and aimeat_admin_receivers reach, and answers in the node's envelope.
 *   The permission words are asked twice on purpose: here as middleware (so the route list shows the
 *   gate) and inside the service (so the MCP tool cannot skip it). Each handler is written where its
 *   route is registered, so check:field-reach can place every field it reads on its route.
 * @structure receiversRouter(config, storage)
 * @usage app.use(receiversRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope, requireAnyScope, requireOperator } from '../auth/middleware.js';
import { refuseAnonymousPrincipal } from '../auth/anonymous-principal.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { deny403 } from '../auth/deny.js';
import { RECEIVERS_READ_SCOPE, RECEIVERS_MANAGE_SCOPE } from '../services/receivers/contract.js';
import { ReceiverError } from '../services/receivers/store.js';
import {
    listForCaller, getForCaller, deliveriesForCaller, createOrPropose, decideProposal, updateSettings, setPaused,
    rotateKey, removeReceiver, operatorList, operatorSetStopped, operatorDecide, receiversUsingCsm,
} from '../services/receivers/manage.js';
import { registerCsmUseCheck } from '../services/csm-service.js';
import { requireOwnerPrincipal } from '../auth/account-security.js';
import { validateBody } from '../models/schemas.js';
import {
    ReceiverCreateSchema, ReceiverUpdateSchema, ReceiverDecisionSchema, ReceiverRotateSchema, ReceiverStopSchema,
    ReceiverOperatorDecisionSchema, EmptyReceiverBodySchema,
} from '../models/receiver-schemas.js';

export function receiversRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const deps = { storage, config };
    // A CSM a receiver checks messages against is refused deletion while the receiver exists.
    registerCsmUseCheck(name => receiversUsingCsm(storage, name));

    /** Answer a service call: its value in the envelope, or its refusal with the REST code. */
    const send = async (req: Request, res: Response, status: number, work: Promise<Record<string, unknown>>): Promise<void> => {
        try {
            const out = await work;
            // A key leaves the node once: no proxy or browser may keep the answer that carries it.
            if (typeof out.key === 'string') { res.set('Cache-Control', 'no-store'); res.set('Pragma', 'no-cache'); }
            res.status(status).json(success(config.nodeId, out));
        } catch (err) {
            if (!(err instanceof ReceiverError)) throw err;
            if (err.status === 403 && (err.code === 'SCOPE_DENIED' || err.code === 'FORBIDDEN')) { deny403(req, res, err.code, err.message); return; }
            res.status(err.status).json(error(config.nodeId, err.code, err.message, undefined, err.extra));
        }
    };
    const caller = (req: Request) => callerOf(req, config.nodeId, storage);
    const decisionOf = (v: unknown): 'approve' | 'refuse' => {
        if (v !== 'approve' && v !== 'refuse') throw new ReceiverError(400, 'INVALID_INPUT', 'decision is "approve" or "refuse".');
        return v;
    };
    const session = [requireAuth(), refuseAnonymousPrincipal()];
    const reads = [...session, requireAnyScope(RECEIVERS_READ_SCOPE, RECEIVERS_MANAGE_SCOPE)];
    const manages = [...session, requireScope(RECEIVERS_MANAGE_SCOPE)];
    const operator = [requireAuth(), requireOperator(storage)];

    // ── The owner's receivers ──
    router.get('/v1/receivers', ...reads, async (req, res) => {
        await send(req, res, 200, listForCaller(deps, caller(req)));
    });
    router.post('/v1/receivers', ...manages, validateBody(ReceiverCreateSchema, config.nodeId), async (req, res) => {
        await send(req, res, 201, createOrPropose(deps, caller(req), req.body ?? {}, { propose: false }));
    });
    router.post('/v1/receivers/proposals', ...session, requireScope(RECEIVERS_READ_SCOPE), validateBody(ReceiverCreateSchema, config.nodeId), async (req, res) => {
        await send(req, res, 201, createOrPropose(deps, caller(req), req.body ?? {}, { propose: true }));
    });
    router.get('/v1/receivers/:name', ...reads, async (req, res) => {
        await send(req, res, 200, getForCaller(deps, caller(req), String(req.params.name)));
    });
    router.get('/v1/receivers/:name/deliveries', ...reads, async (req, res) => {
        await send(req, res, 200, deliveriesForCaller(deps, caller(req), String(req.params.name), { onlyRefused: req.query.refused === 'true' }));
    });
    // The owner in person decides a proposal: an agent cannot approve what an agent proposed.
    router.post('/v1/receivers/:name/decide', ...session, requireOwnerPrincipal('Only the owner, signed in, approves a receiver someone proposed.'),
        validateBody(ReceiverDecisionSchema, config.nodeId), async (req, res) => {
        await send(req, res, 200, (async () => decideProposal(deps, caller(req), String(req.params.name), decisionOf(req.body?.decision)))());
    });
    router.patch('/v1/receivers/:name', ...manages, validateBody(ReceiverUpdateSchema, config.nodeId), async (req, res) => {
        await send(req, res, 200, updateSettings(deps, caller(req), String(req.params.name), req.body ?? {}));
    });
    router.post('/v1/receivers/:name/pause', ...manages, validateBody(EmptyReceiverBodySchema, config.nodeId), async (req, res) => {
        await send(req, res, 200, setPaused(deps, caller(req), String(req.params.name), true));
    });
    router.post('/v1/receivers/:name/resume', ...manages, validateBody(EmptyReceiverBodySchema, config.nodeId), async (req, res) => {
        await send(req, res, 200, setPaused(deps, caller(req), String(req.params.name), false));
    });
    router.post('/v1/receivers/:name/rotate', ...manages, validateBody(ReceiverRotateSchema, config.nodeId), async (req, res) => {
        await send(req, res, 200, rotateKey(deps, caller(req), String(req.params.name), req.body?.overlap_minutes));
    });
    router.delete('/v1/receivers/:name', ...manages, async (req, res) => {
        await send(req, res, 200, removeReceiver(deps, caller(req), String(req.params.name)));
    });

    // ── The operator ──
    router.get('/v1/admin/receivers', ...operator, async (req, res) => {
        const owner = typeof req.query.owner === 'string' ? req.query.owner : undefined;
        await send(req, res, 200, operatorList(deps, caller(req), owner ? { owner } : {}));
    });
    router.post('/v1/admin/receivers/:owner/:name/stop', ...operator, validateBody(ReceiverStopSchema, config.nodeId), async (req, res) => {
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        await send(req, res, 200, operatorSetStopped(deps, caller(req), String(req.params.owner), String(req.params.name), true, reason));
    });
    router.post('/v1/admin/receivers/:owner/:name/start', ...operator, validateBody(EmptyReceiverBodySchema, config.nodeId), async (req, res) => {
        await send(req, res, 200, operatorSetStopped(deps, caller(req), String(req.params.owner), String(req.params.name), false));
    });
    router.post('/v1/admin/receivers/:owner/:name/decide', ...operator, validateBody(ReceiverOperatorDecisionSchema, config.nodeId), async (req, res) => {
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        await send(req, res, 200, (async () => operatorDecide(deps, caller(req), String(req.params.owner), String(req.params.name), decisionOf(req.body?.decision), reason))());
    });

    return router;
}
