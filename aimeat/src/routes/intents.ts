/**
 * @file intents.ts
 * @description The intent pool's REST surface — one list of what the owner means to do here.
 *   A thin HTTP layer over services/intents.ts.
 *
 *   Owner-only on purpose. An agent reaches the pool two ways, both already built: a promoted
 *   intent arrives as an ordinary task in its own queue, and the records themselves are readable
 *   through `GET /v1/memory/:key?owner_scope=true`. Neither needs a route here, and a pool an agent
 *   could write into directly would stop being the person's own list.
 * @structure intentsRouter(config, storage): GET /v1/intents · POST /v1/intents ·
 *   PATCH /v1/intents/:id · DELETE /v1/intents/:id
 * @usage app.use(intentsRouter(config, storage))
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial (intent pool, phase 1).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import {
    INTENT_KINDS, CLOSES_CHECKS, listIntents, createIntent, updateIntent, deleteIntent, getIntent,
    type IntentKind, type ClosesCheck, type IntentPatch, type IntentStatus,
} from '../services/intents.js';

const MAX_TITLE = 200;
const MAX_INTENTS = 200;

export function intentsRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    // Rule 10: the owner's GHII, resolved from the session — never req.auth!.sub, which is the bare
    // name for an owner token and would file every intent under a namespace nothing reads back.
    const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

    /**
     * GET /v1/intents — the pool.
     *
     * `?include=satisfied` keeps suggestions whose condition already holds. They are dropped by
     * default: a suggestion that has come true is not a task the person still owes, and showing it
     * as outstanding is the failure this whole surface exists to avoid.
     */
    router.get('/v1/intents', requireAuth(), requireRole('owner'), async (req, res) => {
        const owner = req.auth!.owner;
        const all = await listIntents(storage, config, resolve(req), owner);
        const includeSatisfied = String(req.query.include ?? '').split(',').includes('satisfied');
        const intents = includeSatisfied ? all : all.filter(i => !i.satisfied);
        res.json(success(config.nodeId, {
            intents,
            total: intents.length,
            // How many suggestions dropped out, so a client can say "nothing to do" honestly
            // instead of rendering an empty list that reads as broken.
            satisfied_hidden: all.length - intents.length,
        }));
    });

    router.post('/v1/intents', requireAuth(), requireRole('owner'), async (req, res) => {
        const body = req.body ?? {};
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        if (!title) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'title is required'));
            return;
        }
        if (title.length > MAX_TITLE) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `title must be at most ${MAX_TITLE} characters`));
            return;
        }
        if (body.kind !== undefined && body.kind !== null && !INTENT_KINDS.includes(body.kind)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                `kind must be one of: ${INTENT_KINDS.join(', ')}`));
            return;
        }
        if (body.closes_when !== undefined && body.closes_when !== null
            && !CLOSES_CHECKS.includes(body.closes_when?.check)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                `closes_when.check must be one of: ${CLOSES_CHECKS.join(', ')}`));
            return;
        }

        const ownerGhii = resolve(req);
        // A pool is a to-do list, and a to-do list with no ceiling is a place things go to be
        // forgotten. The cap is also what keeps a loop from filling the owner's namespace.
        const existing = await listIntents(storage, config, ownerGhii, req.auth!.owner);
        if (existing.length >= MAX_INTENTS) {
            res.status(409).json(error(config.nodeId, 'TOO_MANY_INTENTS',
                `The pool holds at most ${MAX_INTENTS} items. Close or remove something first.`));
            return;
        }

        const intent = await createIntent(storage, ownerGhii, {
            title,
            kind: (body.kind ?? null) as IntentKind | null,
            prompt_ref: typeof body.prompt_ref === 'string' ? body.prompt_ref : null,
            prompt_args: (body.prompt_args && typeof body.prompt_args === 'object') ? body.prompt_args : null,
            origin: typeof body.origin === 'string' ? body.origin : null,
            object: (body.object && typeof body.object === 'object' && typeof body.object.type === 'string')
                ? { type: body.object.type, id: String(body.object.id ?? '') } : null,
            closes_when: body.closes_when ? { check: body.closes_when.check as ClosesCheck } : null,
        });
        emitChange('intents', ownerGhii);
        res.status(201).json(success(config.nodeId, { intent }, [
            { description: 'The pool', method: 'GET', url: '/v1/intents' },
        ]));
    });

    router.patch('/v1/intents/:id', requireAuth(), requireRole('owner'), async (req, res) => {
        const id = req.params.id as string;
        const body = req.body ?? {};
        const patch: IntentPatch = {};
        if (typeof body.title === 'string') {
            const t = body.title.trim();
            if (!t || t.length > MAX_TITLE) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `title must be 1-${MAX_TITLE} characters`));
                return;
            }
            patch.title = t;
        }
        if (body.status !== undefined) {
            if (!['open', 'working', 'done'].includes(body.status)) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'status must be open, working or done'));
                return;
            }
            patch.status = body.status as IntentStatus;
        }
        if (body.kind !== undefined) {
            if (body.kind !== null && !INTENT_KINDS.includes(body.kind)) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                    `kind must be one of: ${INTENT_KINDS.join(', ')}`));
                return;
            }
            patch.kind = body.kind as IntentKind | null;
        }
        if (body.object !== undefined) {
            patch.object = (body.object && typeof body.object === 'object' && typeof body.object.type === 'string')
                ? { type: body.object.type, id: String(body.object.id ?? '') } : null;
        }
        if (typeof body.prompt_ref === 'string' || body.prompt_ref === null) patch.prompt_ref = body.prompt_ref;

        const ownerGhii = resolve(req);
        const updated = await updateIntent(storage, ownerGhii, id, patch);
        if (!updated) {
            // Absent and not-yours answer identically: a 404 that distinguished them would confirm
            // another owner's intent id to a stranger.
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such intent'));
            return;
        }
        emitChange('intents', ownerGhii);
        res.json(success(config.nodeId, { intent: updated }));
    });

    router.delete('/v1/intents/:id', requireAuth(), requireRole('owner'), async (req, res) => {
        const ownerGhii = resolve(req);
        const id = req.params.id as string;
        const existing = await getIntent(storage, ownerGhii, id);
        if (!existing) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such intent'));
            return;
        }
        await deleteIntent(storage, ownerGhii, id);
        emitChange('intents', ownerGhii);
        res.json(success(config.nodeId, { deleted: true, id }));
    });

    return router;
}
