/**
 * @file src/services/team/expiry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Temporary members and a team's end date (team setup T17). The team record keeps, per
 *   person, the day their membership ends (`until`, keyed `account:<name>` or `email:<hash>` for an
 *   invitation not yet accepted) and the day the whole team ends (`endsOn`). An hourly sweep:
 *   - a week before either day, tells the team's leads once, in each lead's language;
 *   - on a person's day, takes them out of the team (their own AI loses its access with them, and what
 *     they wrote stays with the team); a lead stops being a lead first, unless they are the last one,
 *     who is never removed this way and the other leads are told;
 *   - on the team's day, archives the team (organismArchiveOp, the same operation a lead runs) and
 *     tells the leads.
 *   Nothing is deleted: a removed person can be invited again and an archived team brought back.
 * @structure ENDING_NOTICE_DAYS · parseDay · sweepTeamEnds
 * @usage sweepTeamEnds(storage, config).catch(...)   // services: server-bootstrap/service-init.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T17).
 */
import type { Storage, OrganismRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { notify } from '../notify.js';
import { organismOwners, removeOrganismOwner } from '../organism/ownership.js';
import { removeOrganismMember, MemberRemoveError } from '../organism/member-remove.js';
import { organismArchiveOp } from '../organism/archive-op.js';
import { readTeamRecordWithVersion, writeTeamRecord, TEAM_ORGANISM_TYPES, type TeamRecord } from './record.js';

/** How many days before an end the leads are told. */
export const ENDING_NOTICE_DAYS = 7;
const DAY_MS = 86_400_000;

/** A day as YYYY-MM-DD, or null. The day ends at its last moment in UTC. */
export function parseDay(raw: unknown): string | null {
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return null;
    const t = Date.parse(`${raw.trim()}T23:59:59Z`);
    return Number.isFinite(t) ? raw.trim() : null;
}
const endOf = (day: string): number => Date.parse(`${day}T23:59:59Z`);

async function tellLeads(storage: Storage, config: AimeatConfig, organism: OrganismRecord, key: string, vars: Record<string, string>): Promise<void> {
    for (const lead of organismOwners(organism)) {
        await notify(storage, `${lead}@${config.nodeId}`, {
            type: `team_${key}`, title: `${key.replace(/_/g, ' ')}: ${vars.who ?? ''}`.trim(),
            link: `/v1/profile?tab=organisms&org=${encodeURIComponent(organism.id)}`,
            i18n: { key: `team_${key}`, vars, orgVars: { org: organism.id } },
        });
    }
}

async function accountOf(storage: Storage, key: string): Promise<string | null> {
    if (key.startsWith('account:')) return key.slice('account:'.length);
    if (key.startsWith('email:')) return (await storage.getGHIIByEmailHash(key.slice('email:'.length)))?.username ?? null;
    return null;
}

/** Take one person out of the team on their day. Answers false when they stay (the last lead). */
async function endMembership(storage: Storage, config: AimeatConfig, organism: OrganismRecord, account: string): Promise<boolean> {
    const membership = await storage.getMembership(organism.id, account);
    if (!membership || membership.status !== 'active') return true;
    let org = organism;
    if (organismOwners(org).includes(account)) {
        const out = await removeOrganismOwner(storage, config, org, account, { performedBy: 'team-end' });
        if (!out.ok) return false;
        org = (await storage.getOrganism(org.id)) ?? org;
    }
    const actor = organismOwners(org)[0];
    try {
        await removeOrganismMember(storage, config, { organism: org, callerOwner: actor, targetRaw: account });
        return true;
    } catch (err) {
        if (err instanceof MemberRemoveError && err.code === 'NOT_MEMBER') return true;
        throw err;
    }
}

/** One team: what is due, done; what is near, told. Writes the record once, on its version. */
async function sweepOne(storage: Storage, config: AimeatConfig, organism: OrganismRecord, now: number): Promise<void> {
    const read = await readTeamRecordWithVersion(storage, organism.id);
    if (!read) return;
    const team: TeamRecord = { ...read.team, until: { ...(read.team.until ?? {}) }, noticed: { ...(read.team.noticed ?? {}) } };
    let changed = false;
    for (const [key, day] of Object.entries(team.until ?? {})) {
        const end = endOf(day);
        const account = await accountOf(storage, key);
        const who = account ?? key.replace(/^email:/, '');
        if (end <= now) {
            if (!account) { delete team.until![key]; changed = true; continue; }
            const ended = await endMembership(storage, config, organism, account);
            if (ended) {
                await tellLeads(storage, config, (await storage.getOrganism(organism.id)) ?? organism, 'member_ended', { who, date: day });
                delete team.until![key];
                delete team.noticed![key];
            } else if (!team.noticed![`last-lead:${key}`]) {
                await tellLeads(storage, config, organism, 'member_last_lead', { who, date: day });
                team.noticed![`last-lead:${key}`] = new Date(now).toISOString();
            }
            changed = true;
        } else if (end - now <= ENDING_NOTICE_DAYS * DAY_MS && !team.noticed![key]) {
            await tellLeads(storage, config, organism, 'member_ending', { who, date: day });
            team.noticed![key] = new Date(now).toISOString();
            changed = true;
        }
    }
    let archiveDay: string | null = null;
    if (team.endsOn) {
        const end = endOf(team.endsOn);
        if (end <= now) {
            // The record is written first: archiving the organism archives its records too, the team
            // record with them, and an archived record is no longer written on its version.
            archiveDay = team.endsOn;
            team.endedOn = team.endsOn;
            delete team.endsOn;
            changed = true;
        } else if (end - now <= ENDING_NOTICE_DAYS * DAY_MS && !team.noticed!['team']) {
            await tellLeads(storage, config, organism, 'ending', { date: team.endsOn });
            team.noticed!['team'] = new Date(now).toISOString();
            changed = true;
        }
    }
    if (changed && !(await writeTeamRecord(storage, config, organism.id, team, read, read.team.createdBy))) {
        logger.info('team: the end sweep found the team record changed, it runs again next round', { orgId: organism.id });
        return;
    }
    if (archiveDay) {
        const lead = organismOwners(organism)[0];
        const out = await organismArchiveOp({ storage, config }, { principal: `${lead}@${config.nodeId}`, ownerName: lead, roles: ['owner'], scopes: [] }, organism.id, 'archive', { level: 'organism' });
        if (out.ok) {
            await tellLeads(storage, config, organism, 'ended', { date: archiveDay });
        } else {
            // Not archived: the end day goes back, so the next round tries again.
            logger.warn('team: a team that reached its end date was not archived', { orgId: organism.id, code: out.code });
            const again = await readTeamRecordWithVersion(storage, organism.id);
            if (again) await writeTeamRecord(storage, config, organism.id, { ...again.team, endsOn: archiveDay, endedOn: undefined }, again, again.team.createdBy);
        }
    }
}

/** Every team with a person's or the team's end date: run what is due. Never throws per team. */
export async function sweepTeamEnds(storage: Storage, config: AimeatConfig, now = Date.now()): Promise<{ teams: number }> {
    let teams = 0;
    const PAGE = 200;
    for (const type of TEAM_ORGANISM_TYPES) {
        // A list with no member filter is paged by the storage layer, so every page is read.
        for (let page = 1; ; page++) {
            const list = await storage.listOrganisms({ type, archived: 'exclude', page, perPage: PAGE });
            for (const organism of list) {
                teams++;
                try { await sweepOne(storage, config, organism, now); }
                catch (err) { logger.warn('team: the end sweep failed for one team', { orgId: organism.id, error: String(err) }); }
            }
            if (list.length < PAGE) break;
        }
    }
    return { teams };
}
