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
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

const lang = z.enum(['fi', 'en', 'es']);
const personShape = z.union([
    z.string().describe('An email address or an account name.'),
    z.object({
        email: z.string().optional().describe('The person\'s email address.'),
        account: z.string().optional().describe('An account name on this node, when there is no address.'),
        language: lang.optional().describe('The language of this person\'s invitation; the team\'s language when left out.'),
    }),
]);
const teamsShape = z.array(z.object({
    organism_id: z.string().optional().describe('A team that exists: add leads and members, or correct its names. Leave out to make a new team.'),
    name: z.string().optional().describe('The team\'s name in its working language.'),
    names: z.object({ fi: z.string().optional(), en: z.string().optional(), es: z.string().optional() }).optional()
        .describe('The name in each language, written by you. Every member sees the name in their own language.'),
    language: lang.optional().describe('The team\'s working language: its workspaces, context and skill are written in it. The caller\'s language when left out.'),
    kind: z.enum(['team', 'virtual']).optional().describe('"virtual" for a team formed around a theme across other teams.'),
    description: z.string().optional().describe('What the team does, in a sentence or two. It starts the team context.'),
    leads: z.array(personShape).optional().describe('Leads besides you. A lead who is already a member becomes one at once; anyone else is invited and becomes a lead on accepting.'),
    members: z.array(personShape).optional().describe('Members to invite. Each gets an invitation in their own language.'),
}));

export const teamTools = [
    {
        name: 'aimeat_team_setup',
        description: 'Set up one team or many in one call, or add leads and members to a team you lead. A team is an organism with three workspaces (shared knowledge with the team context, decisions, waiting for you), a team skill that every member\'s AI reads, and one or more leads. Send what you know (names, addresses, who leads) and fill nothing else in: the defaults cover the rest. ALWAYS call first with dry_run true (the default), show the person what would be made, and call again with dry_run false only after they say yes; a correction is one more dry run. Write the team name in fi, en and es under `names`, so a member who reads English does not see a Finnish name. People are invited, never added; a lead becomes a lead on accepting. Whether an address has an account is not told. Each team in the answer has `people` with a result each (creator, lead_now, invite, invited, already, refused) and `problems` when something in it failed.',
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
