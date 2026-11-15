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
 *   GET  /v1/teams/waiting — what waits for the caller across their teams (T6). organism:read.
 *   GET  /v1/teams/:id/prompt — the team as a prompt for an AI without MCP (T9). organism:read.
 *   POST /v1/teams/:id/paste — that AI's tagged answer back into the team; a dry run unless
 *                              `dry_run: false` (T9). organism:write.
 *   POST /v1/teams/:id/decisions/:decision/share — a copy of one decision into the Decisions of the
 *                              named teams the caller is in, or its withdrawal; a dry run unless
 *                              `dry_run: false` (T19). organism:write.
 *   POST /v1/teams/:id/onboarding — the caller confirms they went through the team's AI onboarding;
 *                              the team's record of it (EU AI Act art. 4, T11). organism:write.
 * @structure teamsRouter
 * @usage app.use(teamsRouter(config, storage));
 * @version-history
 *   v1.3.0 — 2026-11-15 — /v1/teams/:id/onboarding (T11).
 *   v1.2.0 — 2026-11-15 — /v1/teams/:id/decisions/:decision/share (T19).
 *   v1.1.0 — 2026-11-14 — /v1/teams/waiting, /v1/teams/:id/prompt and /v1/teams/:id/paste (T6, T9).
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { callerOf } from '../../middleware/caller.js';
import { validateBody } from '../../models/schemas.js';
import { TeamSetupBody, TeamPasteBody, TeamDecisionShareBody, TeamOnboardingBody } from '../../models/write-body-schemas.js';
import { shareTeamDecision } from '../../services/team/share-decision.js';
import { recordTeamOnboarding } from '../../services/team/onboarding.js';
import { teamSetupForCaller, teamStatusForCaller, teamWaitingForCaller } from '../../services/team/for-caller.js';
import { buildTeamPrompt, importTeamPaste } from '../../services/team/prompt.js';

export function teamsRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    router.get('/v1/teams/waiting', requireAuth(), requireScope('organism:read'), async (req, res) => {
        const out = await teamWaitingForCaller({ storage, config }, callerOf(req, config.nodeId, storage));
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { items: out.items, approvals: out.approvals }));
    });

    router.get('/v1/teams/:id/prompt', requireAuth(), requireScope('organism:read'), async (req, res) => {
        const out = await buildTeamPrompt({ storage, config }, callerOf(req, config.nodeId, storage), req.params.id as string);
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { prompt: out.prompt, language: out.language }));
    });

    router.post('/v1/teams/:id/paste', requireAuth(), requireScope('organism:write'), validateBody(TeamPasteBody, config.nodeId), async (req, res) => {
        const out = await importTeamPaste({ storage, config }, callerOf(req, config.nodeId, storage), req.params.id as string, req.body?.text, req.body?.dry_run !== false);
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.status(out.dry_run ? 200 : 201).json(success(config.nodeId, { dry_run: out.dry_run, entries: out.entries, written: out.written }));
    });

    router.post('/v1/teams/:id/decisions/:decision/share', requireAuth(), requireScope('organism:write'), validateBody(TeamDecisionShareBody, config.nodeId), async (req, res) => {
        const out = await shareTeamDecision({ storage, config }, callerOf(req, config.nodeId, storage), {
            organismId: req.params.id as string, decisionId: req.params.decision as string,
            to: req.body?.to, withdraw: req.body?.withdraw === true, dryRun: req.body?.dry_run !== false,
        });
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.status(out.dry_run ? 200 : 201).json(success(config.nodeId, { dry_run: out.dry_run, decision: out.decision, targets: out.targets }));
    });

    router.post('/v1/teams/:id/onboarding', requireAuth(), requireScope('organism:write'), validateBody(TeamOnboardingBody, config.nodeId), async (req, res) => {
        const out = await recordTeamOnboarding({ storage, config }, callerOf(req, config.nodeId, storage), req.params.id as string);
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.status(out.already ? 200 : 201).json(success(config.nodeId, { entry: out.entry, already: out.already, team: out.team }));
    });

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
