/**
 * @file open-items.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The REST surface for open items — the one list of what the owner is going to do here.
 *   A thin HTTP layer over services/open-items.ts.
 *
 *   Owner-only on purpose, and that is not a restriction on the AI: the list is one memory record,
 *   so a connected agent reads it with `aimeat_memory_read` + `owner_scope` and writes it with
 *   `aimeat_memory_write` + `owner_scope` + `expected_version`. No route here is needed for that and
 *   none should be added. These endpoints exist for the browser, which has an owner session.
 * @structure openItemsRouter(config, storage): GET /v1/open-items · GET /v1/open-items/count ·
 *   GET /v1/open-items/stats · POST /v1/open-items · PATCH /v1/open-items/:id ·
 *   DELETE /v1/open-items/:id
 * @usage app.use(openItemsRouter(config, storage))
 * @version-history
 *   v1.0.0 — 2026-08-09 — Replaces routes/intents.ts. One key instead of one record per item, and
 *     DELETE means "switch it off" rather than "erase it".
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import {
    ITEM_KINDS, CLOSES_CHECKS, MAX_ITEMS, OpenItemsConflict,
    listItems, openCount, addItem, patchItem, closeItem, getItem, itemStats,
    type ItemKind, type ClosesCheck, type ItemPatch, type ItemStatus, type FlippedBy,
} from '../services/open-items.js';

const MAX_TITLE = 200;

export function openItemsRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    // Rule 10: the owner's GHII, resolved from the session — never req.auth!.sub, which is the bare
    // name for an owner token and would file every item under a namespace nothing reads back.
    const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

    /** A write conflict is a retry, not a server fault. Say so with the status that means that. */
    const onConflict = (res: Parameters<Parameters<Router['get']>[1]>[1], e: unknown) => {
        if (!(e instanceof OpenItemsConflict)) throw e;
        res.status(409).json(error(config.nodeId, 'VERSION_CONFLICT',
            'The list changed while writing. Read it again and retry.', 409));
    };

    /**
     * GET /v1/open-items — what is switched on.
     *
     * `?include=satisfied` keeps suggestions whose condition already holds. They are dropped by
     * default: a suggestion that has come true is not something the person still owes, and showing
     * it as outstanding is the failure this whole surface exists to avoid.
     */
    router.get('/v1/open-items', requireAuth(), requireRole('owner'), async (req, res) => {
        const all = await listItems(storage, config, resolve(req), req.auth!.owner);
        const includeSatisfied = String(req.query.include ?? '').split(',').includes('satisfied');
        const items = includeSatisfied ? all : all.filter(i => !i.satisfied);
        // How many suggestions were dropped because their condition already holds. Without this an
        // empty list is indistinguishable from a broken one, and the caller cannot say which.
        const satisfiedHidden = all.length - all.filter(i => !i.satisfied).length;
        res.json(success(config.nodeId, {
            items, count: items.length, satisfied_hidden: satisfiedHidden,
        }, [
            { description: 'Switch something on', method: 'POST', url: '/v1/open-items' },
        ]));
    });

    /**
     * GET /v1/open-items/count — just the number.
     *
     * The header asks for this on every page, so it stays one key read and returns one field. It is
     * separate from the list because the header must not pay for the list's payload to show a badge.
     */
    router.get('/v1/open-items/count', requireAuth(), requireRole('owner'), async (req, res) => {
        const count = await openCount(storage, config, resolve(req), req.auth!.owner);
        res.json(success(config.nodeId, { count }));
    });

    router.get('/v1/open-items/stats', requireAuth(), requireRole('owner'), async (req, res) => {
        res.json(success(config.nodeId, await itemStats(storage, resolve(req))));
    });

    /** POST /v1/open-items — switch something on. */
    router.post('/v1/open-items', requireAuth(), requireRole('owner'), async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        if (!title) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'title is required'));
            return;
        }
        if (title.length > MAX_TITLE) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                `title must be ${MAX_TITLE} characters or fewer`));
            return;
        }
        if (body.kind !== undefined && body.kind !== null
            && !ITEM_KINDS.includes(body.kind as ItemKind)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                `kind must be one of: ${ITEM_KINDS.join(', ')}`));
            return;
        }
        const closes = body.closes_when as { check?: string } | null | undefined;
        if (closes && !CLOSES_CHECKS.includes(closes.check as ClosesCheck)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                `closes_when.check must be one of: ${CLOSES_CHECKS.join(', ')}`));
            return;
        }

        try {
            const item = await addItem(storage, resolve(req), {
                title,
                kind: (body.kind as ItemKind) ?? null,
                prompt_ref: typeof body.prompt_ref === 'string' ? body.prompt_ref : null,
                prompt_args: (body.prompt_args && typeof body.prompt_args === 'object')
                    ? body.prompt_args as Record<string, unknown> : null,
                origin: typeof body.origin === 'string' ? body.origin : null,
                object: (body.object && typeof body.object === 'object')
                    ? body.object as { type: string; id: string } : null,
                closes_when: closes ? { check: closes.check as ClosesCheck } : null,
                by: body.by === 'ai' ? 'ai' as FlippedBy : 'person' as FlippedBy,
            });
            if (!item) {
                res.status(409).json(error(config.nodeId, 'LIMIT_REACHED',
                    `the list holds at most ${MAX_ITEMS} items; switch something off first`, 409));
                return;
            }
            emitChange(req.auth!.owner, 'memory');
            res.status(201).json(success(config.nodeId, { item }));
        } catch (e) { onConflict(res, e); }
    });

    /** PATCH /v1/open-items/:id — move a field. Switching off is DELETE, not a status. */
    router.patch('/v1/open-items/:id', requireAuth(), requireRole('owner'), async (req, res) => {
        const id = req.params.id as string;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const patch: ItemPatch = {};

        if (typeof body.title === 'string') {
            const title = body.title.trim();
            if (!title || title.length > MAX_TITLE) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                    `title must be 1-${MAX_TITLE} characters`));
                return;
            }
            patch.title = title;
        }
        if (body.status !== undefined) {
            if (body.status !== 'open' && body.status !== 'working') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                    'status must be open or working; switching an item off is DELETE'));
                return;
            }
            patch.status = body.status as ItemStatus;
        }
        if (body.agent !== undefined) patch.agent = typeof body.agent === 'string' ? body.agent : null;
        if (body.object !== undefined) {
            patch.object = (body.object && typeof body.object === 'object')
                ? body.object as { type: string; id: string } : null;
        }
        if (Object.keys(patch).length === 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'nothing to change'));
            return;
        }

        try {
            const item = await patchItem(storage, resolve(req), id, patch);
            if (!item) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such item'));
                return;
            }
            emitChange(req.auth!.owner, 'memory');
            res.json(success(config.nodeId, { item }));
        } catch (e) { onConflict(res, e); }
    });

    /**
     * DELETE /v1/open-items/:id — switch it off.
     *
     * The same control that switched it on, in the same place, the other way. A short record stays
     * behind so "does anything on this list get done" has an answer; nothing shows it and nothing
     * ages it.
     */
    router.delete('/v1/open-items/:id', requireAuth(), requireRole('owner'), async (req, res) => {
        const id = req.params.id as string;
        const ownerGhii = resolve(req);
        if (!await getItem(storage, ownerGhii, id)) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such item'));
            return;
        }
        try {
            await closeItem(storage, ownerGhii, id, 'person');
            emitChange(req.auth!.owner, 'memory');
            res.json(success(config.nodeId, { switched_off: id }));
        } catch (e) { onConflict(res, e); }
    });

    return router;
}
