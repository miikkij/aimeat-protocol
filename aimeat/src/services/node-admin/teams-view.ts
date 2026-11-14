/**
 * @file src/services/node-admin/teams-view.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every team on this node as the operator sees it (team setup T16): who leads it, how
 *   many people are in it and how many of them for a set time, how many have their own AI connected,
 *   when its shape last changed, and how many decisions, open matters and waiting items its last week
 *   holds. Counts and names only: no record, no title, no team context. A team's content is read by
 *   its members, and the operator who runs the node is not one by running it.
 *
 *   GET /v1/admin/teams and aimeat_admin_teams both read it here. Both ask the operator question
 *   (services/operator-principal.ts) before they call this.
 * @structure AdminTeamRow · nodeTeamsView(storage, opts) → { teams, count, complete }
 * @usage const view = await nodeTeamsView(storage, { now: Date.now() });
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T16).
 */
import type { Storage } from '../../storage/interface.js';
import { organismOwners } from '../organism-ownership.js';
import { readTeamRecord, teamDisplayName, TEAM_ORGANISM_TYPES } from '../team/record.js';
import { teamWeekRecords } from '../team/weekly-report.js';
import { structureKey } from '../structure-snapshot.js';

/** How many organisms one read looks through for teams; `complete` says whether it saw them all. */
export const ADMIN_TEAMS_SCAN = 1000;

export interface AdminTeamRow {
    organism_id: string;
    name: string;
    kind: string;
    team_type: string;
    leads: string[];
    members: number;
    /** Members whose membership ends on a set day. */
    temporary: number;
    /** Members with an agent that has opened an MCP session. */
    ai_connected: number;
    /** When the team's shape (its workspaces, spaces, counts or people) last changed; null before the first snapshot. */
    last_change: string | null;
    ends_on: string | null;
    week: { decided: number; open: number; waiting: number };
    created_at: string;
}

/** Every team on this node, newest first. */
export async function nodeTeamsView(storage: Storage, opts: { now: number; locale?: string | null }): Promise<{ teams: AdminTeamRow[]; count: number; complete: boolean }> {
    const organisms = await storage.listOrganisms({ perPage: ADMIN_TEAMS_SCAN, archived: 'exclude' });
    const teams: AdminTeamRow[] = [];
    for (const organism of organisms) {
        if (!TEAM_ORGANISM_TYPES.has(String(organism.type ?? ''))) continue;
        const team = await readTeamRecord(storage, organism.id);
        if (!team) continue;
        const accounts = (await storage.listMembers(organism.id)).filter(m => m.status === 'active').map(m => m.ghii);
        const agentsBy = accounts.length ? await storage.getAgentsByOwners(accounts) : {};
        const aiConnected = accounts.filter(a => (agentsBy[a] ?? []).some(g => g.mcpLastSeen)).length;
        const structure = await storage.listAllMemory({ prefix: structureKey(organism.id), limit: 5 });
        const lastChange = structure.items.filter(r => r.key === structureKey(organism.id))
            .map(r => r.updatedAt ?? null).filter((v): v is string => !!v).sort().pop() ?? null;
        const week = await teamWeekRecords(storage, organism.id, team, opts.now);
        teams.push({
            organism_id: organism.id,
            name: teamDisplayName(team, opts.locale ?? null, organism.name),
            kind: team.kind, team_type: team.teamType ?? 'general',
            leads: organismOwners(organism),
            members: accounts.length,
            temporary: Object.keys(team.until ?? {}).length,
            ai_connected: aiConnected,
            last_change: lastChange,
            ends_on: team.endsOn ?? null,
            week: { decided: week.decided.length, open: week.open, waiting: week.waiting },
            created_at: organism.createdAt,
        });
    }
    teams.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return { teams, count: teams.length, complete: organisms.length < ADMIN_TEAMS_SCAN };
}
