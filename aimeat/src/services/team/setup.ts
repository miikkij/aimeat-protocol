/**
 * @file src/services/team/setup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Set up one team or many at once, and add leads and members to a team that exists.
 *   The one implementation behind POST /v1/teams/setup and the MCP tool aimeat_team_setup.
 *
 *   A DRY RUN FIRST, AND NO QUESTIONS. The person's AI sends what it knows (a list, a table, an org
 *   chart read into names and addresses, or a sentence) and gets back what would be made. It shows
 *   that, the person says yes or corrects it in one sentence, and the same call runs with
 *   `dry_run: false`. Defaults stand in for every missing detail: the team's language is the
 *   caller's, a name with no translation is used in every language, and a person with no language
 *   gets the team's.
 *
 *   WHAT A NEW TEAM IS. An organism (invite only, private) made by createOrganismRecord, the three
 *   workspaces of TEAM_KIT applied by applyOrganismShape, the team context record in the shared
 *   workspace, a team skill readable by the organism's members and their agents, and the team record
 *   (record.ts). Anyone may set up a team: a team is an organism, and anyone may make one.
 *
 *   PEOPLE COME BY INVITATION, NEVER BY BEING ADDED. An address or an account name gets the
 *   invitation the organism page sends (services/invitations.ts), in that person's language, with a
 *   contributor grant on the three workspaces. A lead is invited as an admin and becomes an owner
 *   when they accept (leads.ts). A person already in the team who is named a lead becomes one at
 *   once (addOrganismOwner). Whether an address has an account is never told to the caller.
 *
 *   APPLYING TWICE MAKES NOTHING TWICE for people: an invitation pending or a member already there
 *   reads `already`. A team named again without `organism_id` is a new team; the plan says so.
 * @structure TeamSetupInput · parseTeamSetup · planOrApplyTeams
 * @usage
 *   const parsed = parseTeamSetup(req.body, callerLocale);
 *   const out = await planOrApplyTeams({ storage, config }, caller, parsed, dryRun);
 * @version-history
 *   v1.1.0 — 2026-11-14 — A team keeps its workspaces' names in every language from the kit, and its
 *     description in every language the AI writes (`descriptions`), so every part of the team reads
 *     in its reader's language.
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T1, T2, T22, T24).
 */
import type { Storage, OrganismRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { isValidEmail } from '../../utils/email-validator.js';
import { createOrganismRecord } from '../organism-lifecycle.js';
import { applyOrganismShape } from '../organism-shape-apply.js';
import { addOrganismOwner, isOrganismOwner } from '../organism-ownership.js';
import { createEmailInvitation, createNameInvitation, InvitationError, inviteEmailHash } from '../invitations.js';
import { publishSkill } from '../skills.js';
import {
    TEAM_KIT, TEAM_LANGS, TEAM_WS, TEAM_CONTEXT_ID, teamContextStart, teamLang, teamSkillMarkdown, type TeamLang,
} from '../../data/team-kit.js';
import {
    TEAM_RECORD_TYPE, readTeamRecordWithVersion, teamContextKey, teamDisplayName, writeTeamRecord,
    type PendingLead, type TeamRecord,
} from './record.js';

export const MAX_TEAMS = 30;
export const MAX_PEOPLE = 200;
const ACCOUNT_RE = /^[a-z0-9][a-z0-9._-]{1,62}$/i;

export interface PersonInput { email: string | null; account: string | null; language: TeamLang | null; who: string }
export interface TeamInput {
    organismId: string | null;
    name: string;
    names: Partial<Record<TeamLang, string>>;
    language: TeamLang;
    kind: 'team' | 'virtual';
    description: string;
    /** The description in other languages, written by the caller's AI. */
    descriptions: Partial<Record<TeamLang, string>>;
    leads: PersonInput[];
    members: PersonInput[];
}
export type TeamSetupInput = { ok: true; teams: TeamInput[] } | { ok: false; message: string };

function person(raw: unknown): PersonInput | string {
    if (typeof raw === 'string') raw = raw.includes('@') ? { email: raw } : { account: raw };
    if (!raw || typeof raw !== 'object') return 'a person is an object with email or account';
    const r = raw as Record<string, unknown>;
    const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : null;
    const account = typeof r.account === 'string' ? r.account.trim() : null;
    if (email && !isValidEmail(email)) return `"${email}" is not an email address`;
    if (account && !ACCOUNT_RE.test(account)) return `"${account}" is not an account name`;
    if (!email && !account) return 'a person needs an email or an account';
    return { email, account: email ? null : account, language: teamLang(r.language), who: email ?? account! };
}

/** Read the request body. Answers the first thing wrong with it, in words the AI can fix. */
export function parseTeamSetup(body: unknown, callerLocale: string | null | undefined): TeamSetupInput {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (!Array.isArray(b.teams) || b.teams.length === 0) return { ok: false, message: 'teams must be a non-empty array' };
    if (b.teams.length > MAX_TEAMS) return { ok: false, message: `at most ${MAX_TEAMS} teams in one call` };
    const fallbackLang = teamLang(callerLocale) ?? 'en';
    const teams: TeamInput[] = [];
    for (const [i, raw] of b.teams.entries()) {
        if (!raw || typeof raw !== 'object') return { ok: false, message: `teams[${i}] must be an object` };
        const t = raw as Record<string, unknown>;
        const organismId = typeof t.organism_id === 'string' && t.organism_id.trim() ? t.organism_id.trim() : null;
        const byLang = (raw: unknown, max: number): Partial<Record<TeamLang, string>> => {
            const out: Partial<Record<TeamLang, string>> = {};
            if (raw && typeof raw === 'object') {
                for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
                    const lang = teamLang(k);
                    if (lang && typeof v === 'string' && v.trim()) out[lang] = v.trim().slice(0, max);
                }
            }
            return out;
        };
        const names = byLang(t.names, 120);
        const descriptions = byLang(t.descriptions, 2000);
        const language = teamLang(t.language) ?? fallbackLang;
        const given = typeof t.name === 'string' ? t.name.trim() : '';
        const name = given || names[language] || Object.values(names)[0] || '';
        if (!organismId && !name) return { ok: false, message: `teams[${i}] needs a name, or organism_id for a team that exists` };
        // A new team's name stands in for its working language. A team that exists keeps the names it
        // has, so correcting one language changes that language alone.
        if (name && !names[language] && (!organismId || given)) names[language] = name.slice(0, 120);
        const people = (key: 'leads' | 'members'): PersonInput[] | string => {
            const list = t[key] === undefined ? [] : t[key];
            if (!Array.isArray(list)) return `teams[${i}].${key} must be an array`;
            const out: PersonInput[] = [];
            for (const p of list) { const parsed = person(p); if (typeof parsed === 'string') return `teams[${i}].${key}: ${parsed}`; out.push(parsed); }
            return out;
        };
        const leads = people('leads'); if (typeof leads === 'string') return { ok: false, message: leads };
        const members = people('members'); if (typeof members === 'string') return { ok: false, message: members };
        if (leads.length + members.length > MAX_PEOPLE) return { ok: false, message: `teams[${i}]: at most ${MAX_PEOPLE} people in one call` };
        teams.push({
            organismId, name: name.slice(0, 120), names, language,
            kind: t.kind === 'virtual' ? 'virtual' : 'team',
            description: typeof t.description === 'string' ? t.description.trim().slice(0, 2000) : (descriptions[language] ?? ''),
            descriptions, leads, members,
        });
    }
    return { ok: true, teams };
}

/** `accept_url` is the address an emailed invitation opens, as the organism's email invitation route answers it to the inviter. */
export interface PersonOutcome { who: string; lead: boolean; result: 'creator' | 'lead_now' | 'invite' | 'invited' | 'already' | 'refused'; language?: TeamLang; reason?: string; accept_url?: string }
export interface TeamOutcome {
    organism_id: string | null;
    action: 'create' | 'update';
    name: string;
    names: Partial<Record<TeamLang, string>>;
    language: TeamLang;
    kind: 'team' | 'virtual';
    workspaces: string[];
    skill: string | null;
    context_key: string | null;
    people: PersonOutcome[];
    problems: string[];
}

interface Caller { owner: string; principal: string; locale: string | null }
type Deps = { storage: Storage; config: AimeatConfig };

/** What a person comes to in a team that exists or is planned (read only). */
async function personPlan(storage: Storage, org: OrganismRecord | null, p: PersonInput, lead: boolean, teamLanguage: TeamLang): Promise<PersonOutcome> {
    const base = { who: p.who, lead, language: p.language ?? teamLanguage };
    if (!org) return { ...base, result: 'invite' };
    const account = p.account ?? (p.email ? (await storage.getGHIIByEmailHash(inviteEmailHash(p.email)))?.username ?? null : null);
    const membership = account ? await storage.getMembership(org.id, account) : null;
    if (membership?.status === 'active') {
        if (!lead || isOrganismOwner(org, account!)) return { ...base, result: 'already' };
        return { ...base, result: 'lead_now' };
    }
    // An account's pending name invitation is in the roster; an address's pending invitation is
    // found when it is sent (ALREADY_INVITED). Neither tells the caller whether an account exists.
    if (membership?.status === 'invited') return { ...base, result: 'already' };
    return { ...base, result: 'invite' };
}

function grantsOf(team: TeamRecord) {
    return [team.workspaces.shared, team.workspaces.decisions, team.workspaces.waiting].map(ws => ({ ws, role: 'contributor' as const }));
}

/** Invite or promote one person; answers the outcome and, for a lead invitation, what to remember. */
async function applyPerson(deps: Deps, caller: Caller, orgId: string, team: TeamRecord, planned: PersonOutcome, p: PersonInput): Promise<{ out: PersonOutcome; pending?: PendingLead }> {
    const { storage, config } = deps;
    const organism = await storage.getOrganism(orgId);
    if (!organism) return { out: { ...planned, result: 'refused', reason: 'the team is gone' } };
    try {
        if (planned.result === 'already') return { out: planned };
        if (planned.result === 'lead_now') {
            const account = p.account ?? (await storage.getGHIIByEmailHash(inviteEmailHash(p.email!)))?.username ?? '';
            const done = await addOrganismOwner(storage, config, organism, account, { performedBy: caller.owner });
            return { out: done.ok || done.code === 'ALREADY_OWNER' ? planned : { ...planned, result: 'refused', reason: done.message } };
        }
        const role = planned.lead ? 'admin' : 'member';
        if (p.email) {
            const made = await createEmailInvitation(storage, config, {
                organism, inviterGhii: caller.owner, email: p.email, orgRole: role, workspaces: grantsOf(team),
                locale: planned.language,
            });
            return { out: { ...planned, result: 'invited', accept_url: made.acceptUrl }, ...(planned.lead ? { pending: { invitation: `email:${made.invitation.id}`, who: p.who } } : {}) };
        }
        const membership = await createNameInvitation(storage, config, {
            organism, inviterGhii: caller.owner, inviteeRaw: p.account!, role, workspaces: grantsOf(team),
        });
        return { out: { ...planned, result: 'invited' }, ...(planned.lead ? { pending: { invitation: `name:${membership.id}`, who: p.who } } : {}) };
    } catch (err) {
        if (err instanceof InvitationError) {
            if (err.code === 'ALREADY_INVITED' || err.code === 'ALREADY_MEMBER') return { out: { ...planned, result: 'already' } };
            return { out: { ...planned, result: 'refused', reason: `${err.code}: ${err.message}` } };
        }
        throw err;
    }
}

function slug(s: string): string {
    const base = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (base || 'team').slice(0, 40).replace(/-+$/, '');
}

/** Make the organism, its workspaces, the context, the skill and the team record. */
async function createTeam(deps: Deps, caller: Caller, t: TeamInput, out: TeamOutcome): Promise<{ orgId: string; team: TeamRecord; version: number; ownerGaii: string } | null> {
    const { storage, config } = deps;
    const created = await createOrganismRecord(deps, caller.owner, {
        name: t.names[t.language] ?? t.name, description: t.description,
        type: t.kind === 'virtual' ? 'virtual team' : 'team', joinPolicy: 'invite_only', visibility: 'private', lang: t.language,
    });
    if (!created.ok) { out.problems.push(`${created.code}: ${created.message}`); return null; }
    const orgId = created.organism.id;
    out.organism_id = orgId;
    const shaped = await applyOrganismShape(deps, orgId, caller.owner, TEAM_KIT, t.language);
    if (shaped.made.length !== TEAM_KIT.workspaces.length) {
        out.problems.push(...shaped.notCreated.map(n => `workspace "${n.name}" was not created: ${n.reason}`));
        return null;
    }
    const ws = { shared: shaped.made[TEAM_WS.shared].ws, decisions: shaped.made[TEAM_WS.decisions].ws, waiting: shaped.made[TEAM_WS.waiting].ws };
    out.workspaces = shaped.made.map(m => m.ws);
    const teamName = t.names[t.language] ?? t.name;
    const now = new Date().toISOString();
    const ownerGhii = `${caller.owner}@${config.nodeId}`;
    const contextKey = teamContextKey(orgId, ws.shared);
    await storage.setMemory({
        key: contextKey, ownerGaii: ownerGhii,
        value: { id: TEAM_CONTEXT_ID, name: teamName, summary: t.description.slice(0, 300), core: teamContextStart(t.language, teamName, t.description) },
        visibility: 'private', tags: ['team-context'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
    out.context_key = contextKey;
    let skill: TeamRecord['skill'] = null;
    const skillName = `team-${slug(teamName)}-${orgId.replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase()}`;
    try {
        await publishSkill(storage, config, {
            scope: 'user', owner: caller.owner, publisher: caller.principal, visibility: `organism:${orgId}`,
            files: new Map([['SKILL.md', teamSkillMarkdown({ lang: t.language, skillName, teamName, orgId, ws })]]),
        });
        skill = { name: skillName, ref: `user:${caller.owner}/${skillName}` };
        out.skill = skill.ref;
    } catch (err) {
        logger.warn('team: the team skill was not published', { orgId, error: String(err) });
        out.problems.push(`the team skill was not published: ${err instanceof Error ? err.message : String(err)}`);
    }
    const workspaceNames = {
        [ws.shared]: TEAM_KIT.workspaces[TEAM_WS.shared].name,
        [ws.decisions]: TEAM_KIT.workspaces[TEAM_WS.decisions].name,
        [ws.waiting]: TEAM_KIT.workspaces[TEAM_WS.waiting].name,
    };
    const descriptions = t.description ? { ...t.descriptions, [t.language]: t.description } : t.descriptions;
    const team: TeamRecord = {
        type: TEAM_RECORD_TYPE, names: t.names, language: t.language, kind: t.kind, workspaces: ws, workspaceNames, descriptions, skill,
        leadsPending: [], createdBy: caller.owner, createdAt: now, updatedAt: now,
    };
    if (!(await writeTeamRecord(storage, config, orgId, team, null, caller.owner))) {
        out.problems.push('the team record was written by someone else at the same moment');
        return null;
    }
    const read = await readTeamRecordWithVersion(storage, orgId);
    return read ? { orgId, team: read.team, version: read.version, ownerGaii: read.ownerGaii } : null;
}

/**
 * Plan (dry run) or make every team in the input. Teams are handled one by one: a refusal in one
 * team is reported in its `problems` and the others go on.
 */
export async function planOrApplyTeams(deps: Deps, caller: Caller, teams: TeamInput[], dryRun: boolean): Promise<TeamOutcome[]> {
    const { storage, config } = deps;
    const results: TeamOutcome[] = [];
    for (const t of teams) {
        const out: TeamOutcome = {
            organism_id: t.organismId, action: t.organismId ? 'update' : 'create',
            name: teamDisplayName({ names: t.names, language: t.language }, caller.locale, t.name), names: t.names,
            language: t.language, kind: t.kind,
            workspaces: TEAM_KIT.workspaces.map(w => w.name[t.language]), skill: null, context_key: null, people: [], problems: [],
        };
        results.push(out);
        let org: OrganismRecord | null = null;
        let read: Awaited<ReturnType<typeof readTeamRecordWithVersion>> = null;
        if (t.organismId) {
            org = await storage.getOrganism(t.organismId);
            read = org ? await readTeamRecordWithVersion(storage, org.id) : null;
            if (!org || org.archived) { out.problems.push('NOT_FOUND: no team with that organism_id'); continue; }
            if (!isOrganismOwner(org, caller.owner)) { out.problems.push('FORBIDDEN: only a lead of the team may change it'); continue; }
            if (!read) { out.problems.push('NOT_A_TEAM: that organism was not set up as a team'); continue; }
            out.names = { ...read.team.names, ...t.names };
            out.language = read.team.language; out.kind = read.team.kind;
            out.name = teamDisplayName({ names: out.names, language: out.language }, caller.locale, org.name);
            out.workspaces = [read.team.workspaces.shared, read.team.workspaces.decisions, read.team.workspaces.waiting];
            out.skill = read.team.skill?.ref ?? null;
            out.context_key = teamContextKey(org.id, read.team.workspaces.shared);
        }
        const language = out.language;
        if (!t.organismId) out.people.push({ who: caller.owner, lead: true, result: 'creator', language });
        const seen = new Set<string>(t.organismId ? [] : [caller.owner]);
        const planned: { p: PersonInput; plan: PersonOutcome }[] = [];
        for (const [list, lead] of [[t.leads, true], [t.members, false]] as const) {
            for (const p of list) {
                if (seen.has(p.who)) continue;
                seen.add(p.who);
                planned.push({ p, plan: await personPlan(storage, org, p, lead, language) });
            }
        }
        if (dryRun) { out.people.push(...planned.map(x => x.plan)); continue; }

        if (!org) {
            const made = await createTeam(deps, caller, t, out);
            if (!made) continue;
            read = { team: made.team, version: made.version, ownerGaii: made.ownerGaii };
            org = await storage.getOrganism(made.orgId);
        } else if (read && (Object.keys(t.names).length || Object.keys(t.descriptions).length)) {
            const team = { ...read.team, names: out.names, descriptions: { ...(read.team.descriptions ?? {}), ...t.descriptions } };
            if (await writeTeamRecord(storage, config, org.id, team, read, read.team.createdBy)) read = await readTeamRecordWithVersion(storage, org.id);
        }
        if (!org || !read) continue;
        const pending: PendingLead[] = [];
        for (const { p, plan } of planned) {
            const r = await applyPerson(deps, caller, org.id, read.team, plan, p);
            out.people.push(r.out);
            if (r.pending) pending.push(r.pending);
        }
        if (pending.length) {
            for (let attempt = 0; attempt < 3; attempt++) {
                const now = await readTeamRecordWithVersion(storage, org.id);
                if (!now) break;
                const team = { ...now.team, leadsPending: [...now.team.leadsPending, ...pending] };
                if (await writeTeamRecord(storage, config, org.id, team, now, now.team.createdBy)) break;
            }
        }
    }
    return results;
}

export { TEAM_LANGS };
