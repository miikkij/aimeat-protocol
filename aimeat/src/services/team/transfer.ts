/**
 * @file src/services/team/transfer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A team moved to another node with its people (team setup T12). The organism export
 *   carries who was in it and in which role, and for a team its setup (names, language, kind, type,
 *   approval gate, last day); the import lets the importer choose what comes back, and says what to
 *   keep in mind.
 *
 *   PEOPLE COME BACK AS INVITATIONS, never as members. On another node an account with the same name
 *   can be another person, so a name proves nothing there. The choices, as the developer ruled:
 *   - `people: "none"` (the default): nobody is invited; the answer lists who was in the bundle.
 *   - `people: "invite"`: a person of THIS node (the bundle was made here, and the account exists) is
 *     invited by name with their role; a lead's invitation makes them a lead on accepting (leads.ts).
 *     A person of another node is listed `by_address` with their role: the importer gives their
 *     addresses, and aimeat_team_setup or aimeat_organism_invite_email sends the invitations.
 *   Direct membership without an invitation comes only through the organisation's own sign-in: an
 *   SSO connection bound to the organism makes everyone who signs in through it a member
 *   (services/sso-membership.ts). Entra gives each node its own user id, so the bundle cannot carry
 *   one that would match on the new node.
 *
 *   THE TEAM COMES BACK with `team: true` (the default when the bundle has one): the team record is
 *   written for the new organism with its restored workspaces, the team skill is published again
 *   under the importer, and the approval gate is as it was. Agents, their workplaces and the team's
 *   approvals are not in the bundle: each person connects their own AI again.
 * @structure ExportedPerson · ExportedTeam · TransferOptions · TransferPerson · teamTransferOf ·
 *   parseTransferOptions · previewTransfer · restoreTeamAndPeople
 * @usage
 *   orgJson.people = …; orgJson.team = …  ←  await teamTransferOf(storage, config, org)
 *   const out = await restoreTeamAndPeople(deps, caller, { orgId, bundle, restored, options });
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T12).
 */
import type { Storage, OrganismRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { organismOwners } from '../organism-ownership.js';
import { createNameInvitation, InvitationError } from '../invitations.js';
import { teamLang, type TeamLang } from '../../data/team-kit.js';
import { readTeamRecord, readTeamRecordWithVersion, writeTeamRecord, TEAM_RECORD_TYPE, teamGateOn, type TeamRecord, type PendingLead } from './record.js';
import { publishTeamSkill, grantsOf } from './setup.js';

type Deps = { storage: Storage; config: AimeatConfig };

export interface ExportedPerson { identity: string; role: 'creator' | 'admin' | 'member'; lead: boolean; until?: string }
export interface ExportedTeam {
    names: TeamRecord['names']; language: TeamLang; kind: TeamRecord['kind']; teamType: string;
    descriptionByLang?: TeamRecord['descriptionByLang']; approvalGate: boolean; endsOn?: string;
    workspaces: TeamRecord['workspaces'];
}
export interface TransferOptions { people: 'none' | 'invite'; team: boolean }
export interface TransferPerson {
    identity: string; role: string; lead: boolean;
    result: 'invited' | 'already' | 'by_address' | 'not_invited' | 'you' | 'refused';
    reason?: string;
}

/** What the export adds to organism.json: the people and, for a team, its setup. */
export async function teamTransferOf(storage: Storage, config: AimeatConfig, org: OrganismRecord): Promise<{ people: ExportedPerson[]; team?: ExportedTeam }> {
    const leads = new Set(organismOwners(org));
    const team = await readTeamRecord(storage, org.id);
    const people: ExportedPerson[] = (await storage.listMembers(org.id)).filter(m => m.status === 'active').map(m => {
        const until = team?.until?.[`account:${m.ghii}`];
        return {
            identity: `${m.ghii}@${config.nodeId}`,
            role: m.role === 'creator' ? 'creator' : m.role === 'admin' ? 'admin' : 'member',
            lead: leads.has(m.ghii), ...(until ? { until } : {}),
        };
    });
    if (!team) return { people };
    return {
        people,
        team: {
            names: team.names, language: team.language, kind: team.kind, teamType: team.teamType ?? 'general',
            ...(team.descriptionByLang ? { descriptionByLang: team.descriptionByLang } : {}),
            approvalGate: teamGateOn(team), ...(team.endsOn ? { endsOn: team.endsOn } : {}),
            workspaces: team.workspaces,
        },
    };
}

/** The importer's choices, from a query or a JSON body. Unknown values take the safe default. */
export function parseTransferOptions(raw: { people?: unknown; team?: unknown }): TransferOptions {
    return {
        people: raw.people === 'invite' ? 'invite' : 'none',
        team: !(raw.team === false || raw.team === 'false'),
    };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function peopleOf(raw: unknown): ExportedPerson[] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 2000).flatMap((p): ExportedPerson[] => {
        const identity = str((p as { identity?: unknown })?.identity).slice(0, 300);
        if (!identity.includes('@')) return [];
        const role = str((p as { role?: unknown }).role);
        const until = str((p as { until?: unknown }).until).slice(0, 10);
        return [{
            identity, role: role === 'creator' || role === 'admin' ? role : 'member',
            lead: (p as { lead?: unknown }).lead === true, ...(until ? { until } : {}),
        }];
    });
}

function teamOf(raw: unknown): ExportedTeam | null {
    const t = raw as Partial<ExportedTeam> | null;
    if (!t || typeof t !== 'object' || !t.workspaces || typeof t.workspaces !== 'object') return null;
    const ws = t.workspaces as Partial<TeamRecord['workspaces']>;
    if (!str(ws.shared) || !str(ws.decisions) || !str(ws.waiting)) return null;
    const names: TeamRecord['names'] = {};
    for (const l of ['fi', 'en', 'es'] as const) if (str(t.names?.[l])) names[l] = str(t.names?.[l]).slice(0, 120);
    return {
        names, language: teamLang(t.language) ?? 'en', kind: t.kind === 'virtual' ? 'virtual' : 'team',
        teamType: str(t.teamType).slice(0, 40) || 'general', approvalGate: t.approvalGate !== false,
        ...(str(t.endsOn) ? { endsOn: str(t.endsOn).slice(0, 10) } : {}),
        ...(t.descriptionByLang && typeof t.descriptionByLang === 'object' ? { descriptionByLang: t.descriptionByLang } : {}),
        workspaces: { shared: str(ws.shared), decisions: str(ws.decisions), waiting: str(ws.waiting) },
    };
}

/** What to keep in mind, in sentences an AI hands the person as they are. */
function considerations(people: ExportedPerson[], team: ExportedTeam | null, options: TransferOptions, here: string): string[] {
    // A bundle with no people and no team (a template, an old export) has nothing to keep in mind.
    if (!people.length && !team) return [];
    const other = people.filter(p => !p.identity.endsWith(`@${here}`)).length;
    const out: string[] = [];
    if (people.length && options.people === 'none') out.push(`${people.length} people were in the team. Nobody is invited unless you choose people: "invite".`);
    if (other) out.push(`${other} of them come from another node. A same name here can be another person, so they are not invited by name: give their email addresses and invite them, each with the role shown.`);
    if (people.some(p => p.lead)) out.push('A lead becomes a lead again only by accepting the invitation; until then you are the only lead.');
    if (people.some(p => p.until)) out.push('A temporary member invited here by name keeps their last day; one invited by address gets it again with `until`.');
    if (team) out.push('The team skill is published again under your name, and every member\'s AI reads it after joining.');
    out.push('AIs, their connections and open approvals do not move: each person connects their own AI again.');
    out.push('To make people members without an invitation, bind the organisation\'s sign-in (an SSO connection) to this organism: everyone who signs in through it becomes a member.');
    return out;
}

/** What a bundle would bring back, read from its organism.json alone: nothing is made. */
export function previewTransfer(bundle: { people?: unknown; team?: unknown }, options: TransferOptions, here: string) {
    const people = peopleOf(bundle.people);
    const team = teamOf(bundle.team);
    return {
        people: people.map(p => ({ identity: p.identity, role: p.role, lead: p.lead, ...(p.until ? { until: p.until } : {}), this_node: p.identity.endsWith(`@${here}`) })),
        team: team ? { names: team.names, kind: team.kind, type: team.teamType, approval_gate: team.approvalGate } : null,
        considerations: considerations(people, team, options, here),
    };
}

/**
 * After the workspaces are restored: write the team record and publish the team skill, and invite
 * the people the importer chose to invite. `restored` maps each source workspace id to its new id.
 */
export async function restoreTeamAndPeople(deps: Deps, caller: { owner: string; principal: string }, args: {
    orgId: string; bundle: { people?: unknown; team?: unknown }; restored: Array<{ from: string; ws: string }>; options: TransferOptions;
}): Promise<{ team: { restored: boolean; skill: string | null; problem?: string } | null; people: TransferPerson[]; considerations: string[] }> {
    const { storage, config } = deps;
    const people = peopleOf(args.bundle.people);
    const exported = teamOf(args.bundle.team);
    const notes = considerations(people, exported, args.options, config.nodeId);
    const map = new Map(args.restored.map(r => [r.from, r.ws]));

    let team: TeamRecord | null = null;
    let teamOut: { restored: boolean; skill: string | null; problem?: string } | null = null;
    if (exported && args.options.team) {
        const ws = { shared: map.get(exported.workspaces.shared), decisions: map.get(exported.workspaces.decisions), waiting: map.get(exported.workspaces.waiting) };
        if (!ws.shared || !ws.decisions || !ws.waiting) {
            teamOut = { restored: false, skill: null, problem: 'the bundle did not carry all three team workspaces' };
        } else {
            const workspaces = ws as TeamRecord['workspaces'];
            const organism = await storage.getOrganism(args.orgId);
            const teamName = exported.names[exported.language] ?? organism?.name ?? 'Team';
            const published = await publishTeamSkill(deps, caller, { orgId: args.orgId, teamName, lang: exported.language, ws: workspaces, teamType: exported.teamType });
            const now = new Date().toISOString();
            team = {
                type: TEAM_RECORD_TYPE, names: exported.names, language: exported.language, kind: exported.kind, teamType: exported.teamType,
                workspaces, ...(exported.descriptionByLang ? { descriptionByLang: exported.descriptionByLang } : {}),
                skill: published.ok ? published.skill : null, leadsPending: [], approvalGate: exported.approvalGate,
                ...(exported.endsOn ? { endsOn: exported.endsOn } : {}),
                createdBy: caller.owner, createdAt: now, updatedAt: now,
            };
            const written = await writeTeamRecord(storage, config, args.orgId, team, null, caller.owner);
            teamOut = { restored: written, skill: published.ok ? published.skill.ref : null, ...(published.ok ? {} : { problem: `the team skill was not published: ${published.message}` }) };
            if (!written) team = null;
        }
    }

    const results: TransferPerson[] = [];
    const pending: PendingLead[] = [];
    const until: Record<string, string> = {};
    const organism = await storage.getOrganism(args.orgId);
    for (const p of people) {
        const base = { identity: p.identity, role: p.role, lead: p.lead };
        const at = p.identity.lastIndexOf('@');
        const account = p.identity.slice(0, at);
        const local = p.identity.slice(at + 1) === config.nodeId;
        if (local && account === caller.owner) { results.push({ ...base, result: 'you' }); continue; }
        if (args.options.people !== 'invite') { results.push({ ...base, result: 'not_invited' }); continue; }
        if (!local) { results.push({ ...base, result: 'by_address', reason: 'another node: invite by email address' }); continue; }
        if (!organism) { results.push({ ...base, result: 'refused', reason: 'the organism is gone' }); continue; }
        try {
            const role = p.lead || p.role !== 'member' ? 'admin' : 'member';
            const membership = await createNameInvitation(storage, config, {
                organism, inviterGhii: caller.owner, inviteeRaw: account, role, ...(team ? { workspaces: grantsOf(team) } : {}),
            });
            if (team && p.lead) pending.push({ invitation: `name:${membership.id}`, who: account });
            if (team && p.until) until[`account:${account}`] = p.until;
            results.push({ ...base, result: 'invited' });
        } catch (err) {
            if (err instanceof InvitationError) {
                results.push({ ...base, result: err.code === 'ALREADY_INVITED' || err.code === 'ALREADY_MEMBER' ? 'already' : 'refused', ...(err.code === 'ALREADY_INVITED' || err.code === 'ALREADY_MEMBER' ? {} : { reason: `${err.code}: ${err.message}` }) });
            } else throw err;
        }
    }
    // Who becomes a lead on accepting, and each temporary member's last day, onto the team record.
    if (team && (pending.length || Object.keys(until).length)) {
        for (let attempt = 0; attempt < 3; attempt++) {
            const read = await readTeamRecordWithVersion(storage, args.orgId);
            if (!read) break;
            const next = { ...read.team, leadsPending: [...read.team.leadsPending, ...pending], until: { ...(read.team.until ?? {}), ...until } };
            if (await writeTeamRecord(storage, config, args.orgId, next, read, caller.owner)) break;
        }
    }
    return { team: teamOut, people: results, considerations: notes };
}
