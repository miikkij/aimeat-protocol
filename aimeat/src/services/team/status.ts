/**
 * @file src/services/team/status.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a person's teams stand: the one implementation behind GET /v1/teams/status and
 *   the MCP tool aimeat_team_status, and the read an AI makes before it answers about a team.
 *
 *   For each team the caller is an active member of: its name in the caller's language, the leads,
 *   every member and whether that member's own AI is connected (an agent of theirs that has opened
 *   an MCP session, the node's own test for connected: services/agent/mcp-touch.ts), the team
 *   context, the team skill and the three workspaces. A lead also sees the invitations still open
 *   and which of them make a lead, so "who has not joined yet" is answered in one call.
 *
 *   A member sees the roster of a team they are in, as the organism members route shows it to an
 *   active member. Nobody outside the team gets anything: a team the caller is not in is NOT_FOUND.
 * @structure TeamStatus · teamStatusFor · listTeamsOf
 * @usage const teams = await teamStatusFor(storage, config, ownerName, locale, orgId);
 * @version-history
 *   v1.4.0 — 2026-11-15 — `approval_gate` (T7).
 *   v1.3.0 — 2026-11-14 — `week`: this week's decisions, open matters and what waits, as counts (T15).
 *   v1.2.0 — 2026-11-14 — `team_type`.
 *   v1.1.0 — 2026-11-14 — The team's last day, its dependencies, and for a lead each temporary member's day.
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T5, T13).
 */
import type { Storage, OrganismRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { isOrganismOwner, organismOwners } from '../organism-ownership.js';
import { readTeamRecord, teamContextKey, teamDisplayName, teamGateOn, type TeamRecord } from './record.js';
import { memoryTarget } from '../classification/labels.js';
import type { ContentReader } from '../classification/reader.js';
import { teamWeekRecords } from './weekly-report.js';

export const MAX_TEAMS_LISTED = 50;

export interface TeamMemberStatus {
    account: string;
    lead: boolean;
    ai: { connected: boolean; agents: { name: string; client: string | null; last_seen: string | null }[] };
}
export interface TeamStatus {
    organism_id: string;
    name: string;
    names: TeamRecord['names'];
    language: TeamRecord['language'];
    kind: TeamRecord['kind'];
    /** The team type (data/team-kit.ts TEAM_TYPES); "general" for a team made before types existed. */
    team_type: string;
    you_lead: boolean;
    leads: string[];
    members: TeamMemberStatus[];
    ai_connected: number;
    workspaces: TeamRecord['workspaces'];
    skill: string | null;
    context: { key: string; summary: string; core: string; updated_at: string | null } | null;
    invitations?: { who: string; lead: boolean; sent_at: string }[];
    /** The team's last day (a project team), when it has one. */
    ends_on: string | null;
    /** The teams this one needs something from (the team map). */
    depends_on: { organism_id: string; what: string }[];
    /** A lead's view: the last day of each temporary membership, by account (or address hash before they join). */
    member_until?: Record<string, string>;
    /** Counts only: decisions made in the last seven days, open matters, and what waits for a person. */
    week: { decided: number; open: number; waiting: number };
    /** On: an AI's delete in the team, and a send or payment by an agent working for it, waits for a lead (T7). */
    approval_gate: boolean;
}

/** The organisms the owner is an active member of that are teams, newest membership first. */
export async function listTeamsOf(storage: Storage, owner: string, limit = MAX_TEAMS_LISTED): Promise<{ organism: OrganismRecord; team: TeamRecord }[]> {
    const memberships = (await storage.listMembershipsByGhii(owner))
        .filter(m => m.status === 'active')
        .sort((a, b) => String(b.joinedAt).localeCompare(String(a.joinedAt)));
    const out: { organism: OrganismRecord; team: TeamRecord }[] = [];
    for (const m of memberships) {
        if (out.length >= limit) break;
        const team = await readTeamRecord(storage, m.organismId);
        if (!team) continue;
        const organism = await storage.getOrganism(m.organismId);
        if (organism && !organism.archived) out.push({ organism, team });
    }
    return out;
}

/** The team context the reader may see: it passes the caller's classification reader, as any content does. */
async function contextOf(storage: Storage, reader: ContentReader, orgId: string, team: TeamRecord): Promise<TeamStatus['context']> {
    const key = teamContextKey(orgId, team.workspaces.shared);
    const { items } = await storage.listAllMemory({ prefix: key, limit: 5 });
    const found = items.find(r => r.key === key);
    const [rec] = found ? await reader.show([found], r => memoryTarget(r.ownerGaii, r.key)) : [];
    if (!rec || !rec.value || typeof rec.value !== 'object') return null;
    const v = rec.value as { summary?: unknown; core?: unknown };
    return { key, summary: typeof v.summary === 'string' ? v.summary : '', core: typeof v.core === 'string' ? v.core : '', updated_at: rec.updatedAt ?? null };
}

async function statusOf(storage: Storage, reader: ContentReader, organism: OrganismRecord, team: TeamRecord, caller: string, locale: string | null): Promise<TeamStatus> {
    const memberships = (await storage.listMembers(organism.id)).filter(m => m.status === 'active');
    const accounts = memberships.map(m => m.ghii);
    const agentsBy = accounts.length ? await storage.getAgentsByOwners(accounts) : {};
    const leads = organismOwners(organism);
    const members: TeamMemberStatus[] = accounts.map(account => {
        const agents = (agentsBy[account] ?? []).filter(a => a.mcpLastSeen)
            .map(a => ({ name: a.displayName || a.name, client: a.mcpClient ?? null, last_seen: a.mcpLastSeen ?? null }));
        return { account, lead: leads.includes(account), ai: { connected: agents.length > 0, agents } };
    }).sort((a, b) => Number(b.lead) - Number(a.lead) || a.account.localeCompare(b.account));
    const youLead = isOrganismOwner(organism, caller);
    const counts = await teamWeekRecords(storage, organism.id, team, Date.now());
    const status: TeamStatus = {
        organism_id: organism.id,
        name: teamDisplayName(team, locale, organism.name),
        names: team.names, language: team.language, kind: team.kind, team_type: team.teamType ?? 'general',
        you_lead: youLead, leads, members,
        ai_connected: members.filter(m => m.ai.connected).length,
        workspaces: team.workspaces,
        skill: team.skill?.ref ?? null,
        context: await contextOf(storage, reader, organism.id, team),
        ends_on: team.endsOn ?? null,
        depends_on: team.dependsOn ?? [],
        week: { decided: counts.decided.length, open: counts.open, waiting: counts.waiting },
        approval_gate: teamGateOn(team),
    };
    if (youLead) {
        status.member_until = Object.fromEntries(Object.entries(team.until ?? {}).map(([k, v]) => [k.replace(/^account:/, ''), v]));
        const pendingLead = new Set(team.leadsPending.map(p => p.invitation));
        const byEmail = (await storage.listInvitationsByOrganism(organism.id, { status: 'pending' }))
            .map(i => ({ who: i.email, lead: pendingLead.has(`email:${i.id}`), sent_at: i.createdAt }));
        const byName = (await storage.listMembers(organism.id, { status: 'invited' }))
            .map(m => ({ who: m.ghii, lead: pendingLead.has(`name:${m.id}`), sent_at: m.joinedAt }));
        status.invitations = [...byEmail, ...byName];
    }
    return status;
}

/**
 * The caller's teams, or the one named. Answers null when the named organism is not a team the
 * caller is an active member of, which the doors report as NOT_FOUND.
 */
export async function teamStatusFor(storage: Storage, _config: AimeatConfig, reader: ContentReader, owner: string, locale: string | null, orgId?: string | null): Promise<TeamStatus[] | null> {
    if (orgId) {
        const membership = await storage.getMembership(orgId, owner);
        const organism = membership?.status === 'active' ? await storage.getOrganism(orgId) : null;
        const team = organism && !organism.archived ? await readTeamRecord(storage, orgId) : null;
        return organism && team ? [await statusOf(storage, reader, organism, team, owner, locale)] : null;
    }
    const teams = await listTeamsOf(storage, owner);
    const out: TeamStatus[] = [];
    for (const { organism, team } of teams) out.push(await statusOf(storage, reader, organism, team, owner, locale));
    return out;
}
