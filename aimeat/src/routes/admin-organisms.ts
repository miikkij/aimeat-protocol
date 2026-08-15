/**
 * @file src/routes/admin-organisms.ts
 * @description The node operator's break-glass over organism ownership. An organism has exactly one
 *   creator, and every gate below it defers to that one name: an admin cannot remove, demote or
 *   replace a creator, and only the creator can hand the organism on or delete it. So an organism
 *   whose creator account becomes unreachable — lost, handed away by mistake, or simply gone — had
 *   no repair path on any surface, including for the operator whose node it runs on. This is that
 *   path, and it is deliberately the only cross-account thing here.
 *
 *   It does NOT loosen the ordinary gates. The member-facing transfer route still refuses everyone
 *   but the current creator; this door is separate, gated on the operator ACCOUNT plus an exact
 *   scope word, and it performs the same three writes through the same service so the two cannot
 *   drift apart.
 *
 * @structure
 *   - adminOrganismsRouter(config, storage): Router factory
 *   - GET  /v1/admin/organisms/:id/ownership: read the ownership state before changing it
 *   - POST /v1/admin/organisms/:id/ownership: install `ghii` as the organism's creator
 *
 * @version-history
 *   v1.0.0 — 2026-08-15 — Initial. Written after an unscoped agent transferred this node's own
 *     development organism away in a test run and nothing on any surface could put it back.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOperatorPrincipal } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { handOverOwnership } from '../services/organism-ownership.js';
import { logger } from '../utils/logger.js';

export function adminOrganismsRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    /* ── GET /v1/admin/organisms/:id/ownership ──
     * Who holds this organism, and who else could. Read this before writing: the repair is a
     * cross-account act, and the operator should see the roster it is about to re-point. */
    router.get('/v1/admin/organisms/:id/ownership', requireAuth(), requireOperatorPrincipal(storage), async (req, res) => {
        const id = req.params.id as string;
        const organism = await storage.getOrganism(id);
        if (!organism) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
            return;
        }
        const members = await storage.listMembers(id);
        res.json(success(config.nodeId, {
            id: organism.id,
            name: organism.name,
            creator: organism.creatorGhii,
            admins: organism.admins,
            created_at: organism.createdAt,
            updated_at: organism.updatedAt,
            members: members.map(m => ({ ghii: m.ghii, role: m.role, status: m.status, joined_at: m.joinedAt })),
        }, [{
            description: 'Install an owner on this organism',
            method: 'POST',
            url: `/v1/admin/organisms/${id}/ownership`,
        }]));
    });

    /* ── POST /v1/admin/organisms/:id/ownership — { ghii } ──
     * Install `ghii` as the creator. The previous creator stays as an admin, and a target who is not
     * a member is seated as one: the repair case is precisely the organism whose reachable people are
     * on the outside of it. A BLOCKED target is refused — lifting a block is its own visible act. */
    router.post('/v1/admin/organisms/:id/ownership', requireAuth(), requireOperatorPrincipal(storage), async (req, res) => {
        const id = req.params.id as string;
        const { ghii } = req.body ?? {};
        if (!ghii || typeof ghii !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Body field "ghii" (the bare owner name to install) is required'));
            return;
        }

        const organism = await storage.getOrganism(id);
        if (!organism) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
            return;
        }

        const performedBy = req.auth!.sub;
        const outcome = await handOverOwnership(storage, config, organism, ghii, {
            seatNonMember: true,
            performedBy: `operator repair by ${performedBy}`,
        });
        if (!outcome.ok) {
            res.status(outcome.status).json(error(config.nodeId, outcome.code, outcome.message));
            return;
        }

        // A cross-account write leaves a line in the log whatever else it leaves: this is the one
        // door on the node where the caller is not the affected account and never was.
        logger.warn('[operator-organism-repair] ownership installed', {
            organism: id, from: outcome.previousCreator, to: outcome.creator,
            seated: outcome.membershipCreated, by: performedBy,
        });

        res.json(success(config.nodeId, {
            organism: id,
            creator: outcome.creator,
            previous_creator: outcome.previousCreator,
            membership_created: outcome.membershipCreated,
        }));
        emitChange('organisms');
    });

    return router;
}
