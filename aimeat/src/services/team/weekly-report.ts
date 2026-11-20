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
 * @structure weekOf · teamWeekRecords · runTeamWeeklyReports
 * @usage registered as the core job team-weekly (services/core-jobs.ts), Fridays at 14:05.
 * @version-history
 *   v1.3.0 — 2026-11-20 — teamAiWeek: the report carries what AI made in the team's workspaces this week
 *     and what happened to it, as the team's sums; a week with only AI work is reported too.
 *   v1.2.0 — 2026-11-14 — teamWeekRecords, the counts team status reads for a member's home (T15).
 *   v1.1.0 — 2026-11-14 — Decision titles pass each lead's classification reader; the counts stay whole.
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T8).
 */
import type { Storage, MemoryRecord, OrganismRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { notify } from '../notify.js';
import { organismOwners } from '../organism/ownership.js';
import { readTeamRecord, TEAM_ORGANISM_TYPES, type TeamRecord } from './record.js';
import { readerFor } from '../classification/reader.js';
import { memoryTarget } from '../classification/labels.js';

const WEEK_MS = 7 * 86_400_000;

/** The newest row of each record in a space: `.latest` over `.draft` over the bare key. */
function latest(rows: MemoryRecord[], prefix: string): { value: Record<string, unknown>; at: string; rec: MemoryRecord }[] {
    const rank = (key: string) => key.endsWith('.latest') ? 3 : key.endsWith('.draft') ? 2 : 1;
    const best = new Map<string, { rank: number; value: Record<string, unknown>; at: string; rec: MemoryRecord }>();
    for (const r of rows) {
        if (!r.key.startsWith(prefix) || !r.value || typeof r.value !== 'object') continue;
        const id = r.key.slice(prefix.length).replace(/\.(latest|draft)$/, '');
        if (!id || id.includes('.')) continue;
        const k = rank(r.key);
        const at = r.createdAt ?? r.updatedAt ?? '';
        if ((best.get(id)?.rank ?? 0) < k) best.set(id, { rank: k, value: r.value as Record<string, unknown>, at, rec: r });
    }
    return [...best.values()];
}

/** The week's figures of one team, and this week's decision records. Only counts leave this function
 *  as they are; a decision's title reaches a lead through that lead's classification reader. */
export async function weekOf(storage: Storage, organism: OrganismRecord, team: TeamRecord, now: number): Promise<{ decided: MemoryRecord[]; open: number; waiting: number; aiConnected: number; members: number }> {
    const { decided, open, waiting } = await teamWeekRecords(storage, organism.id, team, now);
    const members = (await storage.listMembers(organism.id)).filter(m => m.status === 'active').map(m => m.ghii);
    const agents = members.length ? await storage.getAgentsByOwners(members) : {};
    const aiConnected = members.filter(m => (agents[m] ?? []).some(a => a.mcpLastSeen)).length;
    return { decided, open, waiting, aiConnected, members: members.length };
}

/** This week's decision records, and the counts of open matters and of what waits for a person.
 *  Only the counts may leave as they are; a record passes the reader's classification first. */
export async function teamWeekRecords(storage: Storage, orgId: string, team: TeamRecord, now: number): Promise<{ decided: MemoryRecord[]; open: number; waiting: number }> {
    const rows = async (ws: string, ns: string) => {
        const prefix = `organism.${orgId}.w.${ws}.${ns}.`;
        const { items } = await storage.listAllMemory({ prefix, limit: 5000, excludeVersionRows: true });
        return latest(items, prefix);
    };
    const since = new Date(now - WEEK_MS).toISOString();
    const decisions = (await rows(team.workspaces.decisions, 'shared.decisions')).filter(d => d.at >= since);
    const open = (await rows(team.workspaces.shared, 'shared.items')).filter(o => (o.value.status ?? 'open') === 'open');
    const waiting = (await rows(team.workspaces.waiting, 'shared.waiting')).filter(w => (w.value.status ?? 'open') === 'open');
    return { decided: decisions.map(d => d.rec), open: open.length, waiting: waiting.length };
}

/** Every team's week to its leads. Never throws per team. */
/**
 * What AI made in the team's workspaces in the seven days before `now`, and what happened to it: the
 * team's sums from the value signals (storage ValueDaily, by organism), never per member or agent.
 */
export async function teamAiWeek(storage: Storage, orgId: string, now: number): Promise<{ made: number; corrected: number; rejected: number; used: number }> {
    const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
    const rows = await storage.sumValueDaily({ orgId, from: day(now - 6 * 86_400_000), to: day(now) }, ['signal']);
    const n = (s: string): number => rows.filter(r => r.signal === s).reduce((t, r) => t + r.count, 0);
    return { made: n('produced') + n('refined'), corrected: n('corrected'), rejected: n('rejected'), used: n('used') };
}

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
                    // What AI made in the team's workspaces this week and what happened to it: the
                    // team's sums from the value signals, never per member (services/value/).
                    const ai = await teamAiWeek(storage, organism.id, now);
                    if (!w.decided.length && !w.open && !w.waiting && !ai.made) continue;
                    for (const lead of organismOwners(organism)) {
                        // The titles this lead may read: a classified decision above the lead's
                        // clearance is counted, never named.
                        const reader = readerFor({ storage, config }, { sub: lead, owner: lead, roles: ['owner'] });
                        const shown = await reader.show(w.decided, r => memoryTarget(r.ownerGaii, r.key));
                        const titles = shown.map(r => r.value as Record<string, unknown>)
                            .map(v => String(v.title ?? v.decision ?? '')).filter(Boolean).slice(0, 5);
                        const vars = {
                            decided: w.decided.length, decisions: titles.join('; ') || '-',
                            open: w.open, waiting: w.waiting, ai: w.aiConnected, members: w.members,
                            aiMade: ai.made, aiCorrected: ai.corrected, aiRejected: ai.rejected, aiUsed: ai.used,
                        };
                        await notify(storage, `${lead}@${config.nodeId}`, {
                            type: 'team_weekly',
                            title: `The week in the team: ${w.decided.length} decisions, ${w.waiting} waiting`,
                            body: `Decided: ${vars.decisions}. Open: ${w.open}. Waiting for a person: ${w.waiting}. Own AI connected: ${w.aiConnected} of ${w.members}. AI made ${ai.made}: ${ai.corrected} corrected, ${ai.rejected} deleted, ${ai.used} opened by someone else.`,
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
