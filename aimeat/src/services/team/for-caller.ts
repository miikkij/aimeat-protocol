/**
 * @file src/services/team/for-caller.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The team setup and the team status for one caller: who may, in which language, and
 *   with which permission. POST /v1/teams/setup, GET /v1/teams/status and the MCP tools
 *   aimeat_team_setup and aimeat_team_status call these two functions and only translate the answer,
 *   so the two surfaces cannot decide differently.
 * @structure TeamDoorRefusal · teamSetupForCaller · teamStatusForCaller
 * @usage
 *   const out = await teamSetupForCaller({ storage, config }, caller, req.body);
 *   if (!out.ok) → out.status, out.code, out.message
 * @version-history
 *   v1.1.0 — 2026-11-14 — teamWaitingForCaller: what waits for the person across their teams (T6).
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { emitChange } from '../event-bus.js';
import { readerFor } from '../classification/reader.js';
import { parseTeamSetup, planOrApplyTeams, type TeamOutcome } from './setup.js';
import { teamStatusFor, type TeamStatus } from './status.js';
import { teamWaitingFor } from './waiting.js';

export interface TeamDoorRefusal { ok: false; status: number; code: string; message: string }
type Deps = { storage: Storage; config: AimeatConfig };

async function localeOf(storage: Storage, owner: string): Promise<string | null> {
    return (await storage.getGHIIByOwner(owner))?.locale ?? null;
}

/** Plan or make the teams in `body` for this caller. */
export async function teamSetupForCaller(deps: Deps, caller: CallerContext, body: unknown): Promise<TeamDoorRefusal | { ok: true; dryRun: boolean; teams: TeamOutcome[] }> {
    if (!caller.owner || caller.visitor) return { ok: false, status: 403, code: 'FORBIDDEN', message: 'A team is set up by an account of this node or its agent' };
    const locale = await localeOf(deps.storage, caller.owner);
    const parsed = parseTeamSetup(body, locale);
    if (!parsed.ok) return { ok: false, status: 400, code: 'INVALID_INPUT', message: parsed.message };
    const dryRun = (body as { dry_run?: unknown } | null)?.dry_run !== false;
    if (!dryRun && parsed.teams.some(t => t.leads.length || t.members.length) && !caller.has('organism:invite')) {
        return { ok: false, status: 403, code: 'SCOPE_DENIED', message: 'Inviting people to a team needs the organism:invite permission' };
    }
    const teams = await planOrApplyTeams(deps, { owner: caller.owner, principal: caller.principal, locale }, parsed.teams, dryRun);
    if (!dryRun) emitChange('organisms');
    return { ok: true, dryRun, teams };
}

/** What waits for the caller across their teams (waiting.ts). */
export async function teamWaitingForCaller(deps: Deps, caller: CallerContext): Promise<TeamDoorRefusal | ({ ok: true } & Awaited<ReturnType<typeof teamWaitingFor>>)> {
    if (!caller.owner || caller.visitor) return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Teams belong to an account of this node' };
    return { ok: true, ...(await teamWaitingFor(deps, caller)) };
}

/** The caller's teams, or the one named. */
export async function teamStatusForCaller(deps: Deps, caller: CallerContext, orgId: string | null): Promise<TeamDoorRefusal | { ok: true; teams: TeamStatus[] }> {
    if (!caller.owner || caller.visitor) return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Teams belong to an account of this node' };
    const reader = readerFor(deps, caller.auth);
    const teams = await teamStatusFor(deps.storage, deps.config, reader, caller.owner, await localeOf(deps.storage, caller.owner), orgId);
    if (!teams) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'No team with that organism_id that you are in' };
    return { ok: true, teams };
}
