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
 * @usage const view = await nodeTeamsView(storage, { now: Date.now(), reader: operatorName });
 * @version-history
 *   v1.1.0 — 2026-11-15 — `ai_onboarding`: how many members went through the team's AI onboarding (T11).
 *   v1.0.0 — 2026-11-15 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T16).
 */
import type { Storage } from '../../storage/interface.js';
import { organismOwners } from '../organism-ownership.js';
import { readTeamRecord, teamDisplayName, TEAM_ORGANISM_TYPES } from '../team/record.js';
import { teamWeekRecords } from '../team/weekly-report.js';
import { structureKey } from '../structure-snapshot.js';
import { readTeamLiteracy, literacySummary } from '../team/onboarding.js';

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
    /** Members who confirmed they went through the team's AI onboarding (EU AI Act art. 4; team/onboarding.ts). */
    ai_onboarding: number;
    created_at: string;
}

/** Every team on this node, newest first. */
export async function nodeTeamsView(storage: Storage, opts: { now: number; reader?: string | null }): Promise<{ teams: AdminTeamRow[]; count: number; complete: boolean }> {
    // The team names in the reading operator's own language.
    const locale = opts.reader ? (await storage.getGHIIByOwner(opts.reader))?.locale ?? null : null;
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
        const literacy = literacySummary(await readTeamLiteracy(storage, organism.id), accounts, null);
        teams.push({
            organism_id: organism.id,
            name: teamDisplayName(team, locale, organism.name),
            kind: team.kind, team_type: team.teamType ?? 'general',
            leads: organismOwners(organism),
            members: accounts.length,
            temporary: Object.keys(team.until ?? {}).length,
            ai_connected: aiConnected,
            last_change: lastChange,
            ends_on: team.endsOn ?? null,
            week: { decided: week.decided.length, open: week.open, waiting: week.waiting },
            ai_onboarding: literacy.done,
            created_at: organism.createdAt,
        });
    }
    teams.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return { teams, count: teams.length, complete: organisms.length < ADMIN_TEAMS_SCAN };
}
