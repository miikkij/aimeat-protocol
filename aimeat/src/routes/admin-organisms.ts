/**
 * @file src/routes/admin-organisms.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   - GET  /v1/admin/organisms: every organism on this node and who holds it
 *   - GET  /v1/admin/organisms/:id/ownership: read the ownership state before changing it
 *   - POST /v1/admin/organisms/:id/ownership: install `ghii` as the organism's creator
 *
 * @version-history
 *   v1.1.0 — 2026-09-12 — GET /v1/admin/organisms. The repair door took an organism id, and no
 *     operator surface on this node could tell anyone one: the page could only be used by somebody
 *     who already knew the answer. The listing is also what lets a screen work out whether any
 *     organism is stuck, instead of waiting for its people to write in and say so.
 *   v1.0.0 — 2026-08-15 — Initial. Written after an unscoped agent transferred this node's own
 *     development organism away in a test run and nothing on any surface could put it back.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOperatorPrincipal } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { addOrganismOwner, organismOwners } from '../services/organism-ownership.js';
import { logger } from '../utils/logger.js';

/**
 * How many organisms one read carries. The page that consumes this answers "is any organism stuck",
 * and an answer folded over a truncated list would say "none" while the one nobody can reach sits on
 * the next page. So the cap is generous and the answer says whether it was reached: a reader that
 * sees `complete: false` must say what it counted rather than state a total.
 */
const LIST_CAP = 1000;

export function adminOrganismsRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    /* ── GET /v1/admin/organisms ──
     * Every organism on this node with who holds it. The repair below takes an id, and until this
     * existed there was nowhere on the operator's surface to get one. `?archived=include` counts the
     * archived ones too; they are left out by default because an archived organism nobody can reach
     * is not the emergency the repair door is for. */
    router.get('/v1/admin/organisms', requireAuth(), requireOperatorPrincipal(storage), async (req, res) => {
        const archived = req.query.archived === 'include' ? 'include' : 'exclude';
        const organisms = await storage.listOrganisms({ perPage: LIST_CAP, archived });
        res.json(success(config.nodeId, {
            organisms: organisms.map(o => ({
                id: o.id,
                name: o.name,
                type: o.type,
                visibility: o.visibility,
                owners: organismOwners(o),
                created_by: o.createdBy,
                members: o.members?.length ?? 0,
                created_at: o.createdAt,
                updated_at: o.updatedAt,
                archived_at: o.archivedAt ?? null,
            })),
            count: organisms.length,
            complete: organisms.length < LIST_CAP,
        }, [{
            description: 'Read one organism\'s ownership before changing it',
            method: 'GET',
            url: '/v1/admin/organisms/{id}/ownership',
        }]));
    });

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
            owners: organismOwners(organism),
            created_by: organism.createdBy,
            admins: organism.admins,
            created_at: organism.createdAt,
            updated_at: organism.updatedAt,
            members: members.map(m => ({ ghii: m.ghii, role: m.role, status: m.status, joined_at: m.joinedAt })),
        }, [{
            description: 'Add an owner to this organism',
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
        const outcome = await addOrganismOwner(storage, config, organism, ghii, {
            seatNonMember: true,
            performedBy: `operator repair by ${performedBy}`,
        });
        if (!outcome.ok) {
            res.status(outcome.status).json(error(config.nodeId, outcome.code, outcome.message));
            return;
        }

        // A cross-account write leaves a line in the log whatever else it leaves: this is the one
        // door on the node where the caller is not the affected account and never was.
        logger.warn('[operator-organism-repair] owner installed', {
            organism: id, added: outcome.added, owners: outcome.owners,
            seated: outcome.membershipCreated, by: performedBy,
        });

        res.json(success(config.nodeId, {
            organism: id,
            added: outcome.added,
            owners: outcome.owners,
            membership_created: outcome.membershipCreated,
        }));
        emitChange('organisms');
    });

    return router;
}
