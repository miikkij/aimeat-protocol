/**
 * @file src/services/team/weekly-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The team's week for its leads (team setup T8): every Friday each lead of each team gets
 *   one notice, written in their own language, that says what the team decided this week, what is
 *   open, what waits for a person, and how many members have their own AI connected. It is built from
 *   the team's own records, read as the node's own summary for the team's leads, who may read all of
 *   them; nothing is sent outside the node and nothing is written into the team.
 *
 *   A team with nothing new this week and nothing open or waiting gets no notice: a report that says
 *   nothing teaches its reader to skip it.
 * @structure weekOf · runTeamWeeklyReports
 * @usage registered as the core job team-weekly (services/core-jobs.ts), Fridays at 14:05.
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T8).
 */
import type { Storage, MemoryRecord, OrganismRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { notify } from '../notify.js';
import { organismOwners } from '../organism-ownership.js';
import { readTeamRecord, TEAM_ORGANISM_TYPES, type TeamRecord } from './record.js';

const WEEK_MS = 7 * 86_400_000;

/** The newest row of each record in a space: `.latest` over `.draft` over the bare key. */
function latest(rows: MemoryRecord[], prefix: string): { value: Record<string, unknown>; at: string }[] {
    const rank = (key: string) => key.endsWith('.latest') ? 3 : key.endsWith('.draft') ? 2 : 1;
    const best = new Map<string, { rank: number; value: Record<string, unknown>; at: string }>();
    for (const r of rows) {
        if (!r.key.startsWith(prefix) || !r.value || typeof r.value !== 'object') continue;
        const id = r.key.slice(prefix.length).replace(/\.(latest|draft)$/, '');
        if (!id || id.includes('.')) continue;
        const k = rank(r.key);
        const at = r.createdAt ?? r.updatedAt ?? '';
        if ((best.get(id)?.rank ?? 0) < k) best.set(id, { rank: k, value: r.value as Record<string, unknown>, at });
    }
    return [...best.values()];
}

/** The week's figures of one team. Reads its three workspaces (the node's own summary for its leads). */
export async function weekOf(storage: Storage, organism: OrganismRecord, team: TeamRecord, now: number): Promise<{ decided: string[]; open: number; waiting: number; aiConnected: number; members: number }> {
    const rows = async (ws: string, ns: string) => {
        const prefix = `organism.${organism.id}.w.${ws}.${ns}.`;
        const { items } = await storage.listAllMemory({ prefix, limit: 5000, excludeVersionRows: true });
        return latest(items, prefix);
    };
    const since = new Date(now - WEEK_MS).toISOString();
    const decisions = (await rows(team.workspaces.decisions, 'shared.decisions')).filter(d => d.at >= since);
    const open = (await rows(team.workspaces.shared, 'shared.items')).filter(o => (o.value.status ?? 'open') === 'open');
    const waiting = (await rows(team.workspaces.waiting, 'shared.waiting')).filter(w => (w.value.status ?? 'open') === 'open');
    const members = (await storage.listMembers(organism.id)).filter(m => m.status === 'active').map(m => m.ghii);
    const agents = members.length ? await storage.getAgentsByOwners(members) : {};
    const aiConnected = members.filter(m => (agents[m] ?? []).some(a => a.mcpLastSeen)).length;
    return {
        decided: decisions.map(d => String(d.value.title ?? d.value.decision ?? '')).filter(Boolean).slice(0, 5),
        open: open.length, waiting: waiting.length, aiConnected, members: members.length,
    };
}

/** Every team's week to its leads. Never throws per team. */
export async function runTeamWeeklyReports(storage: Storage, config: AimeatConfig, now = Date.now()): Promise<{ teams: number; reported: number }> {
    let teams = 0, reported = 0;
    const PAGE = 200;
    for (const type of TEAM_ORGANISM_TYPES) {
        for (let page = 1; ; page++) {
            const list = await storage.listOrganisms({ type, archived: 'exclude', page, perPage: PAGE });
            for (const organism of list) {
                teams++;
                try {
                    const team = await readTeamRecord(storage, organism.id);
                    if (!team) continue;
                    const w = await weekOf(storage, organism, team, now);
                    if (!w.decided.length && !w.open && !w.waiting) continue;
                    const vars = {
                        decided: w.decided.length, decisions: w.decided.join('; ') || '-',
                        open: w.open, waiting: w.waiting, ai: w.aiConnected, members: w.members,
                    };
                    for (const lead of organismOwners(organism)) {
                        await notify(storage, `${lead}@${config.nodeId}`, {
                            type: 'team_weekly',
                            title: `The week in the team: ${w.decided.length} decisions, ${w.waiting} waiting`,
                            body: `Decided: ${vars.decisions}. Open: ${w.open}. Waiting for a person: ${w.waiting}. Own AI connected: ${w.aiConnected} of ${w.members}.`,
                            link: `/v1/profile?tab=organisms&org=${encodeURIComponent(organism.id)}`,
                            i18n: { key: 'team_weekly', vars, orgVars: { org: organism.id } },
                        });
                    }
                    reported++;
                } catch (err) {
                    logger.warn('team: the weekly report failed for one team', { orgId: organism.id, error: String(err) });
                }
            }
            if (list.length < PAGE) break;
        }
    }
    return { teams, reported };
}
