/**
 * @file src/services/team/changes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The changes to a team that one sentence asks for (team setup T23, T17 and the team
 *   map): "Pekka leaves", "the project ends on 31 March", "sales needs the technical details from
 *   software development". A person named under `remove` is taken out of the team, or their open
 *   invitation is cancelled; a lead stops being a lead first, and the last lead is never removed this
 *   way. `ends_on` sets or clears the team's last day (the end sweep, expiry.ts, archives it then).
 *   `depends_on` replaces the list of teams this team needs something from.
 *
 *   A dry run says what would happen and changes nothing. Removing a person takes their own AI's
 *   access with them (it acts with its owner's rights); what they wrote stays with the team.
 * @structure TeamChanges · parseDependsOn · untilKeyOf · applyTeamChanges
 * @usage out.changes = await applyTeamChanges(deps, caller, organism, teamInput, dryRun);
 * @version-history
 *   v1.1.0 — 2026-11-15 — `approval_gate` turns the team's approval gate on or off (T7).
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T17, T23, T21).
 */
import type { Storage, OrganismRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { organismOwners, removeOrganismOwner } from '../organism/ownership.js';
import { removeOrganismMember, MemberRemoveError } from '../organism/member-remove.js';
import { cancelEmailInvitation, cancelNameInvitation, InvitationError, inviteEmailHash } from '../invitations.js';
import { readTeamRecordWithVersion, writeTeamRecord } from './record.js';
/** The parts of a setup's person and team this file reads (services/team/setup.ts PersonInput, TeamInput). */
interface PersonInput { email: string | null; account: string | null; who: string }
interface TeamInput { remove: PersonInput[]; endsOn: string | null | undefined; dependsOn: { organism_id: string; what: string }[] | undefined; approvalGate?: boolean | undefined }

type Deps = { storage: Storage; config: AimeatConfig };
interface Caller { owner: string; principal: string; locale: string | null }

export interface TeamChanges {
    removed: { who: string; result: 'remove' | 'removed' | 'invitation_cancelled' | 'not_member' | 'last_lead' | 'refused'; reason?: string }[];
    ends_on?: string | null;
    depends_on?: { organism_id: string; what: string }[];
    approval_gate?: boolean;
}

/** `depends_on` as the setup takes it: [{ organism_id, what }]. Answers the first thing wrong with it. */
export function parseDependsOn(raw: unknown): { organism_id: string; what: string }[] | undefined | string {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw)) return 'must be an array of { organism_id, what }';
    const out: { organism_id: string; what: string }[] = [];
    for (const d of raw.slice(0, 30)) {
        if (!d || typeof d !== 'object') return 'each item is { organism_id, what }';
        const r = d as Record<string, unknown>;
        if (typeof r.organism_id !== 'string' || !r.organism_id.trim()) return 'each item needs organism_id';
        out.push({ organism_id: r.organism_id.trim().slice(0, 256), what: typeof r.what === 'string' ? r.what.trim().slice(0, 300) : '' });
    }
    return out;
}

/** How a person's end day is kept in the team record: by account, or by address until they join. */
export function untilKeyOf(p: Pick<PersonInput, 'account' | 'email'>): string {
    return p.account ? `account:${p.account}` : `email:${inviteEmailHash(p.email ?? '')}`;
}

async function removeOne(deps: Deps, caller: Caller, organism: OrganismRecord, p: PersonInput, dryRun: boolean): Promise<TeamChanges['removed'][number]> {
    const { storage, config } = deps;
    const account = p.account ?? (p.email ? (await storage.getGHIIByEmailHash(inviteEmailHash(p.email)))?.username ?? null : null);
    const membership = account ? await storage.getMembership(organism.id, account) : null;
    if (membership?.status === 'active') {
        const owners = organismOwners(organism);
        if (owners.includes(account!) && owners.length === 1) return { who: p.who, result: 'last_lead' };
        if (dryRun) return { who: p.who, result: 'remove' };
        let org = organism;
        if (owners.includes(account!)) {
            const out = await removeOrganismOwner(storage, config, org, account!, { performedBy: caller.owner });
            if (!out.ok) return { who: p.who, result: 'refused', reason: out.message };
            org = (await storage.getOrganism(org.id)) ?? org;
        }
        try {
            await removeOrganismMember(storage, config, { organism: org, callerOwner: caller.owner, targetRaw: account! });
            return { who: p.who, result: 'removed' };
        } catch (err) {
            if (err instanceof MemberRemoveError) return { who: p.who, result: 'refused', reason: err.message };
            throw err;
        }
    }
    // An invitation not yet accepted is cancelled instead.
    if (membership?.status === 'invited') {
        if (dryRun) return { who: p.who, result: 'remove' };
        await cancelNameInvitation(storage, config, { organism, cancellerGhii: caller.owner, inviteeRaw: account! });
        return { who: p.who, result: 'invitation_cancelled' };
    }
    if (p.email) {
        const open = (await storage.listInvitationsByOrganism(organism.id, { status: 'pending' })).filter(i => i.email.toLowerCase() === p.email);
        if (open.length) {
            if (dryRun) return { who: p.who, result: 'remove' };
            for (const inv of open) {
                try { await cancelEmailInvitation(storage, { organismId: organism.id, invitationId: inv.id }); }
                catch (err) { if (!(err instanceof InvitationError)) throw err; }
            }
            return { who: p.who, result: 'invitation_cancelled' };
        }
    }
    return { who: p.who, result: 'not_member' };
}

/** Plan or make the removals, the end day and the dependencies of one team. */
export async function applyTeamChanges(deps: Deps, caller: Caller, organism: OrganismRecord | null, t: TeamInput, dryRun: boolean): Promise<TeamChanges> {
    const { storage, config } = deps;
    const changes: TeamChanges = { removed: [] };
    if (t.endsOn !== undefined) changes.ends_on = t.endsOn;
    if (t.dependsOn !== undefined) changes.depends_on = t.dependsOn;
    if (t.approvalGate !== undefined) changes.approval_gate = t.approvalGate;
    if (!organism) return changes;
    for (const p of t.remove) changes.removed.push(await removeOne(deps, caller, (await storage.getOrganism(organism.id)) ?? organism, p, dryRun));
    if (dryRun) return changes;
    const gone = new Set(t.remove.filter((_, i) => ['removed', 'invitation_cancelled'].includes(changes.removed[i].result)).map(untilKeyOf));
    if (t.endsOn === undefined && t.dependsOn === undefined && t.approvalGate === undefined && !gone.size) return changes;
    for (let attempt = 0; attempt < 3; attempt++) {
        const read = await readTeamRecordWithVersion(storage, organism.id);
        if (!read) break;
        const until = { ...(read.team.until ?? {}) };
        for (const key of gone) delete until[key];
        const team = {
            ...read.team, until,
            ...(t.endsOn !== undefined ? { endsOn: t.endsOn ?? undefined } : {}),
            ...(t.dependsOn !== undefined ? { dependsOn: t.dependsOn } : {}),
            ...(t.approvalGate !== undefined ? { approvalGate: t.approvalGate } : {}),
        };
        if (await writeTeamRecord(storage, config, organism.id, team, read, read.team.createdBy)) break;
    }
    return changes;
}
