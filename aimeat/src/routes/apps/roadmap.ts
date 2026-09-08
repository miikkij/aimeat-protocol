/**
 * @file src/routes/apps/roadmap.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app's roadmap: what has been done to it and what people wish would be.
 *
 *   Registered on the app router rather than mounted on its own, so nothing had to be added to the
 *   boot path for four routes that belong to an app anyway.
 *
 *   WHO SEES WHAT. The done half is public, because it is a changelog and it sells the app. The
 *   wanted half goes to the owner and to whoever holds a development right, because what is missing
 *   is a builder's conversation rather than a shop window — until the owner opens it, which is one
 *   field. Anybody signed in who can see the app may LEAVE a wish; only the owner and the builders
 *   write a done line, and only the owner prunes.
 * @structure registerRoadmapRoutes(router, config, storage, appTarget) —
 *   GET /roadmap · POST /roadmap · DELETE /roadmap/:entryId · PATCH /roadmap
 * @usage registerRoadmapRoutes(router, config, storage, appTarget);
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial. Phase 5 of the shared-app work.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, optionalAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { accountOf } from '../../services/app-members.js';
import {
  readAppRoadmap, addRoadmapEntry, removeRoadmapEntry, setWantedVisibility, publicRoadmap,
} from '../../services/app-roadmap.js';
import type { AppTargetFor } from './helpers.js';

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

export function registerRoadmapRoutes(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    appTarget: AppTargetFor,
): void {
    /** `alice/paja.html`, or null when the filename is not one. */
    const appIdOf = (req: import('express').Request): string | null => {
        const owner = String(req.params.owner ?? '');
        const filename = String(req.params.filename ?? '');
        if (!owner || !FILENAME_RE.test(filename)) return null;
        return `${owner}/${filename}`;
    };

    /**
     * Is this caller inside the build? The owner, or somebody holding a rung.
     *
     * Asked through the same resolver every write door asks, with the lowest act there is: anybody
     * who may touch the draft is inside the build, and everybody else is a reader.
     */
    const insideTheBuild = async (req: import('express').Request): Promise<boolean> => {
        if (!req.auth) return false;
        return (await appTarget(req, 'draft')).ok;
    };

    /** Only the owner, for the two doors that are the owner's alone. */
    const isOwner = (req: import('express').Request): boolean => {
        if (!req.auth) return false;
        return accountOf(resolveIdentity(req.auth, config.nodeId)) === String(req.params.owner ?? '').toLowerCase();
    };

    // ── GET .../roadmap — what has been done, and what is wished for ──
    router.get('/v1/apps/:owner/:filename/roadmap', optionalAuth(), async (req, res) => {
        const appId = appIdOf(req);
        if (!appId) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Invalid filename.'));
        const road = await readAppRoadmap(storage, appId);
        const inside = await insideTheBuild(req);
        return res.json(success(config.nodeId, {
            roadmap: inside ? road : publicRoadmap(road),
            inside_the_build: inside,
            meaning: road
                ? 'Done lines are this app\'s changelog. Wanted lines are what people have asked for; the owner decides which stay.'
                : 'Nobody has written one yet. A publish that carries a `roadmap` line starts it.',
        }));
    });

    // ── POST .../roadmap — leave a wish, or record what a change did ──
    // `social:write` rather than an app word: leaving a wish on somebody's app is the same kind of
    // act as posting on their board, and the people who leave the best ones are exactly the people
    // who hold no rights over the app. Requiring an app scope here would shut them out.
    router.post('/v1/apps/:owner/:filename/roadmap', requireAuth(), requireScope('social:write'), async (req, res) => {
        const appId = appIdOf(req);
        if (!appId) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Invalid filename.'));
        const body = (req.body ?? {}) as Record<string, unknown>;
        const what = typeof body.what === 'string' ? body.what.trim() : '';
        if (what.length < 3) {
            return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'what is required: one sentence, in your own words.'));
        }
        const state = body.state === 'done' ? 'done' : 'wanted';
        // A wish is anybody's to leave. Saying something IS DONE is a claim about the app, and only
        // the people who can change it get to make it.
        if (state === 'done' && !(await insideTheBuild(req))) {
            return res.status(403).json(error(config.nodeId, 'FORBIDDEN',
                'Only the owner and the people building this app record what a change did. Leave it as a wish instead.'));
        }
        const by = accountOf(resolveIdentity(req.auth!, config.nodeId));
        const road = await addRoadmapEntry(storage, { appId, state, what, by });
        return res.status(201).json(success(config.nodeId, { added: true, roadmap: road }));
    });

    // ── DELETE .../roadmap/:entryId — the owner prunes; anybody may withdraw their own wish ──
    router.delete('/v1/apps/:owner/:filename/roadmap/:entryId', requireAuth(), requireScope('social:write'), async (req, res) => {
        const appId = appIdOf(req);
        if (!appId) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Invalid filename.'));
        const entryId = String(req.params.entryId ?? '');
        const me = accountOf(resolveIdentity(req.auth!, config.nodeId));
        const road = await readAppRoadmap(storage, appId);
        const entry = road?.entries.find(e => e.id === entryId);
        if (!entry) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such entry.'));
        if (!isOwner(req) && entry.by !== me) {
            return res.status(403).json(error(config.nodeId, 'FORBIDDEN',
                'The app owner prunes this list. You can withdraw a wish you left yourself.'));
        }
        const removed = await removeRoadmapEntry(storage, appId, entryId);
        return res.json(success(config.nodeId, { removed }));
    });

    // ── PATCH .../roadmap — open the wishes to everybody, or close them ──
    // The owner's own decision about their app, so this one takes the app word.
    router.patch('/v1/apps/:owner/:filename/roadmap', requireAuth(), requireScope('app:write'), async (req, res) => {
        const appId = appIdOf(req);
        if (!appId) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Invalid filename.'));
        if (!isOwner(req)) {
            return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the app owner decides who sees the wishes.'));
        }
        const v = (req.body ?? {}).wanted_visibility;
        if (v !== 'developers' && v !== 'everyone') {
            return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'wanted_visibility must be "developers" or "everyone".'));
        }
        const road = await setWantedVisibility(storage, appId, v);
        return res.json(success(config.nodeId, { roadmap: road }));
    });
}
