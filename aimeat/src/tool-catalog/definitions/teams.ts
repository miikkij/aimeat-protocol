/**
 * @file src/tool-catalog/definitions/teams.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_team_setup and aimeat_team_status: set up one or many teams with a dry run
 *   first, and read where the person's teams stand. On all three surfaces: the node's MCP endpoint
 *   (src/mcp/teams.ts), the connector MCP and the CLI dispatch (src/tool-dispatch/tool-call-defs-teams.ts),
 *   the last two over POST /v1/teams/setup and GET /v1/teams/status. One implementation:
 *   services/team/.
 * @structure teamTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';
import { TeamSetupTeams } from '../../models/write-body-schemas.js';

/** The same bounded shape POST /v1/teams/setup validates its body with. */
const teamsShape = TeamSetupTeams;

export const teamTools = [
    {
        name: 'aimeat_team_setup',
        description: 'Set up one team or many in one call, or add leads and members to a team you lead. A team is an organism with three workspaces (shared knowledge with the team context, decisions, waiting for you), a team skill that every member\'s AI reads, and one or more leads. Send what you know (names, addresses, who leads) and fill nothing else in: the defaults cover the rest. ALWAYS call first with dry_run true (the default), show the person what would be made, and call again with dry_run false only after they say yes; a correction is one more dry run. Write the team name in fi, en and es under `names`, and the description under `descriptions`, so a member who reads English does not see Finnish; the workspaces are named in every language by the node. People are invited, never added; a lead becomes a lead on accepting. Whether an address has an account is not told. Each team in the answer has `people` with a result each (creator, lead_now, invite, invited, already, refused) and `problems` when something in it failed.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Set Up Teams', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'organism:write',
        surfaces: ['agent', 'service'],
        input: {
            teams: { type: 'array', required: true, description: 'The teams, at most 30, each with at most 200 people.', zod: teamsShape },
            dry_run: { type: 'boolean', description: 'True (the default) shows what would be made and makes nothing. False makes it; inviting people then also needs organism:invite.' },
        },
    },
    {
        name: 'aimeat_team_waiting',
        description: 'Everything that waits for the person across their teams, in one read: the open records of each team\'s "Waiting for you" workspace that name them, or name nobody when they lead the team, and the team approvals they may decide. Use it when the person asks "what waits for me". To decide a waiting record, write its status (approved, rejected or done) with aimeat_workspace_write in that workspace\'s `waiting` space; a team approval is decided by the person signed in, at its `decide_url`.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'What Waits for You', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'organism:read',
        surfaces: ['agent', 'service'],
        input: {},
    },
    {
        name: 'aimeat_team_status',
        description: 'Where the person\'s teams stand, or one team: its name in the person\'s language, the leads, every member and whether their own AI is connected, the team context (what the team does and what is open), the team skill to load with aimeat_skill_get, and the three workspaces. A lead also sees the invitations still open. Read it before you answer or write anything about a team, and when the person asks who has not connected an AI yet.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Team Status', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'organism:read',
        surfaces: ['agent', 'service'],
        input: {
            organism_id: { type: 'string', description: 'One team. Leave out for all of the person\'s teams.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
