/**
 * @file src/services/team/index-line.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The teams a person is in, as a few lines their AI reads when it connects: each team's
 *   name in the person's language, its organism id and its team skill. Served in the MCP
 *   instructions next to the person's own contexts (services/mcp/build-inputs.ts) and appended to
 *   the handbook, so a member's AI knows on its first turn that the person works in a team, where
 *   the team's matters are written, and which call reads the team context.
 *
 *   SHORT ON PURPOSE. A person may be in ten teams, and the instructions are cut at a fixed length
 *   (mcp/instructions.ts). A line names the team and the two things to open; the context itself is
 *   one aimeat_team_status call away, read only when the conversation touches that team.
 *
 *   NEVER FAILS A BUILD. Any trouble reading answers null and the instructions say what they said.
 * @structure TEAM_INDEX_MAX · teamIndexLine
 * @usage const line = await teamIndexLine(storage, ownerName);
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T5).
 */
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { listTeamsOf } from './status.js';
import { teamDisplayName } from './record.js';

/** At most this many teams are named; the rest are in aimeat_team_status. */
export const TEAM_INDEX_MAX = 12;

export async function teamIndexLine(storage: Storage, owner: string | undefined): Promise<string | null> {
    if (!owner) return null;
    try {
        const teams = await listTeamsOf(storage, owner, TEAM_INDEX_MAX + 1);
        if (!teams.length) return null;
        const locale = (await storage.getGHIIByOwner(owner))?.locale ?? null;
        const lines = teams.slice(0, TEAM_INDEX_MAX).map(({ organism, team }) =>
            `- ${teamDisplayName(team, locale, organism.name)} (organism ${organism.id}${team.skill ? `, skill ${team.skill.ref}` : ''})`);
        const more = teams.length > TEAM_INDEX_MAX ? ['- more teams: aimeat_team_status lists them all'] : [];
        return [
            'This person works in these teams, with other people and their own AIs. A matter of a team is written in that team\'s workspaces, not in the person\'s own memory. When the conversation touches a team, read it first with aimeat_team_status { organism_id }: its context, who is in it and what is open. Load its skill with aimeat_skill_get { ref } to know how the team works.',
            ...lines, ...more,
        ].join('\n');
    } catch (err) {
        logger.warn('team: the team index was not built', { owner, error: String(err) });
        return null;
    }
}
