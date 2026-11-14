/**
 * @file src/routes/organisms/teams.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Teams: set up one or many with a dry run first, and read where the caller's teams
 *   stand. A team is an organism with three workspaces, a team context, a team skill and leads
 *   (services/team/). The MCP tools aimeat_team_setup and aimeat_team_status call the same functions
 *   (services/team/for-caller.ts).
 *
 *   POST /v1/teams/setup  — dry run unless `dry_run: false`. organism:write; inviting people also
 *                           needs organism:invite.
 *   GET  /v1/teams/status — the caller's teams, or one with ?organism_id=. organism:read.
 * @structure teamsRouter
 * @usage app.use(teamsRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { callerOf } from '../../middleware/caller.js';
import { validateBody } from '../../models/schemas.js';
import { TeamSetupBody } from '../../models/write-body-schemas.js';
import { teamSetupForCaller, teamStatusForCaller } from '../../services/team/for-caller.js';

export function teamsRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    router.post('/v1/teams/setup', requireAuth(), requireScope('organism:write'), validateBody(TeamSetupBody, config.nodeId), async (req, res) => {
        const out = await teamSetupForCaller({ storage, config }, callerOf(req, config.nodeId, storage), req.body);
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.status(out.dryRun ? 200 : 201).json(success(config.nodeId, { dry_run: out.dryRun, teams: out.teams }, out.dryRun
            ? [{ description: 'Make these teams', method: 'POST', url: '/v1/teams/setup' }]
            : [{ description: 'Where the teams stand', method: 'GET', url: '/v1/teams/status' }]));
    });

    router.get('/v1/teams/status', requireAuth(), requireScope('organism:read'), async (req, res) => {
        const orgId = typeof req.query.organism_id === 'string' && req.query.organism_id ? req.query.organism_id : null;
        const out = await teamStatusForCaller({ storage, config }, callerOf(req, config.nodeId, storage), orgId);
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { teams: out.teams }));
    });

    return router;
}
