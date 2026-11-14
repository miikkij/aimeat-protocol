/**
 * @file src/services/team/share-decision.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Share one team decision with other teams (team setup T19). The Decisions workspace
 *   only takes new records, and who writes in a team follows its membership, so a share is a copy:
 *   the sharer writes it into the Decisions of each named team they are a member of, and the copy
 *   says which team and which decision it came from. A share is withdrawn with a new record that
 *   says so; nothing is deleted. A team the sharer is not in is refused with the reason, and the
 *   sharer asks one of its members or leads to share it there.
 *
 *   The source decision is read through the sharer's own read rule and classification reader
 *   (loadWorkspaceContent), so a decision the sharer cannot read cannot be shared. The copies are
 *   written through writeWorkspaceDraftsOp, as a pasted answer is (services/team/prompt.ts), so every
 *   write rule of the target workspace applies to the sharer.
 *
 *   One implementation behind POST /v1/teams/:id/decisions/:decision/share and the MCP tool
 *   aimeat_team_decision_share. A dry run (the default) says what would be written and writes nothing.
 * @structure ShareTarget · shareTeamDecision
 * @usage const out = await shareTeamDecision(deps, caller, { organismId, decisionId, to, withdraw, dryRun });
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T19).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { readerFor } from '../classification/reader.js';
import { loadWorkspaceContent } from '../workspace/content.js';
import { writeWorkspaceDraftsOp } from '../workspace/tool-ops.js';
import { workspaceCallerOf } from '../workspace/ops-caller.js';
import { emitChange } from '../event-bus.js';
import { readTeamRecord, teamDisplayName } from './record.js';
import type { TeamDoorFailure } from './prompt.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** At most this many teams in one share. */
export const SHARE_MAX_TEAMS = 20;

export interface ShareTarget {
    organism_id: string;
    team: string | null;
    /** `share` or `withdraw` when it is written (or would be), `refused` with `reason` when not. */
    result: 'share' | 'withdraw' | 'refused';
    record_id?: string;
    reason?: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;

/** The value of one decision, `.latest` over `.draft`, or null. */
function decisionValue(rows: MemoryRecord[], prefix: string, id: string): Record<string, unknown> | null {
    const latest = rows.find(r => r.key === `${prefix}${id}.latest`);
    const draft = rows.find(r => r.key === `${prefix}${id}.draft`);
    const v = (latest ?? draft)?.value;
    return v && typeof v === 'object' ? v as Record<string, unknown> : null;
}

/** The share in the fields every team's Decisions schema has: id, title, decision, why, date, by. */
function compactShare(v: Record<string, unknown>, fromName: string): Record<string, unknown> {
    const from = v.from as { decision_id?: string } | undefined;
    const withdrawn = v.status === 'withdrawn';
    const note = withdrawn
        ? `WITHDRAWN: the share of decision ${from?.decision_id ?? ''} from the team "${fromName}" (${str(v.withdraws)}).`
        : `Shared from the team "${fromName}" (decision ${from?.decision_id ?? ''}).`;
    return {
        id: v.id, title: v.title, decision: v.decision, date: v.date,
        by: str(v.shared_by) || str(v.by),
        why: [note, str(v.why)].filter(Boolean).join(' '),
    };
}

/** Share a decision with other teams, or withdraw a share. A dry run unless `dryRun` is false. */
export async function shareTeamDecision(deps: Deps, caller: CallerContext, args: {
    organismId: string; decisionId: string; to: unknown; withdraw?: boolean; dryRun: boolean;
}): Promise<TeamDoorFailure | { ok: true; dry_run: boolean; decision: { id: string; title: string }; targets: ShareTarget[] }> {
    const { storage } = deps;
    if (!caller.owner || caller.visitor) return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Teams belong to an account of this node' };
    if (!SAFE_ID.test(args.decisionId)) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'decision is the id of a record in the team\'s Decisions' };
    const to = Array.isArray(args.to) ? [...new Set(args.to.filter((v): v is string => typeof v === 'string' && !!v))] : [];
    if (!to.length || to.length > SHARE_MAX_TEAMS) return { ok: false, status: 400, code: 'INVALID_INPUT', message: `to names 1 to ${SHARE_MAX_TEAMS} teams by organism_id` };

    const membership = await storage.getMembership(args.organismId, caller.owner);
    const source = membership?.status === 'active' ? await readTeamRecord(storage, args.organismId) : null;
    const sourceOrg = source ? await storage.getOrganism(args.organismId) : null;
    if (!source || !sourceOrg || sourceOrg.archived) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'No team with that organism_id that you are in' };

    const reader = readerFor(deps, caller.auth);
    const who = { sub: caller.principal, ownerName: caller.owner, accessorGaii: caller.ownerGhii };
    const got = await loadWorkspaceContent(deps, reader, who, { organismId: args.organismId, ws: source.workspaces.decisions });
    if (!got.ok) return { ok: false, status: got.status ?? 403, code: got.code ?? 'ACCESS_DENIED', message: got.message ?? 'The team\'s Decisions cannot be read' };
    // The Decisions workspace's `decision` space keeps its records under the namespace shared.decisions (data/team-kit.ts).
    const prefix = `organism.${args.organismId}.w.${source.workspaces.decisions}.shared.decisions.`;
    const decision = decisionValue(got.items, prefix, args.decisionId);
    if (!decision) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'No decision with that id in the team\'s Decisions that you can read' };
    if (decision.from && !args.withdraw) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'This decision is itself a copy shared from another team; share the original from that team' };
    }
    const title = str(decision.title) || str(decision.decision);
    const locale = (await storage.getGHIIByOwner(caller.owner))?.locale ?? null;
    const fromName = teamDisplayName(source, locale, sourceOrg.name);
    const shareId = `shared-${args.organismId.slice(0, 8)}-${args.decisionId}`.slice(0, 120);
    const now = new Date().toISOString();

    const targets: ShareTarget[] = [];
    const writes: { orgId: string; ws: string; id: string; value: Record<string, unknown> }[] = [];
    for (const orgId of to) {
        if (orgId === args.organismId) { targets.push({ organism_id: orgId, team: fromName, result: 'refused', reason: 'the decision is already in this team' }); continue; }
        const m = await storage.getMembership(orgId, caller.owner);
        const team = await readTeamRecord(storage, orgId);
        const org = team ? await storage.getOrganism(orgId) : null;
        if (!team || !org || org.archived) { targets.push({ organism_id: orgId, team: null, result: 'refused', reason: 'not a team' }); continue; }
        const name = teamDisplayName(team, locale, org.name);
        if (m?.status !== 'active') {
            targets.push({ organism_id: orgId, team: name, result: 'refused', reason: 'you are not a member of this team: ask one of its members or leads to share it there' });
            continue;
        }
        const from = { organism_id: args.organismId, team: fromName, decision_id: args.decisionId };
        if (args.withdraw) {
            const id = `withdrawn-${shareId}-${Date.now().toString(36)}`.slice(0, 120);
            writes.push({ orgId, ws: team.workspaces.decisions, id, value: {
                id, title, decision: title, status: 'withdrawn', withdraws: shareId, from, by: caller.owner, date: now.slice(0, 10), withdrawn_at: now,
            } });
            targets.push({ organism_id: orgId, team: name, result: 'withdraw', record_id: id });
        } else {
            writes.push({ orgId, ws: team.workspaces.decisions, id: shareId, value: {
                id: shareId, title, decision: title, ...(str(decision.why) ? { why: str(decision.why) } : {}),
                date: str(decision.date) || now.slice(0, 10), from, shared_by: caller.owner, shared_at: now,
            } });
            targets.push({ organism_id: orgId, team: name, result: 'share', record_id: shareId });
        }
    }
    if (args.dryRun || !writes.length) return { ok: true, dry_run: args.dryRun, decision: { id: args.decisionId, title }, targets };

    const opsCaller = workspaceCallerOf({ principal: caller.principal, ownerName: caller.owner, roles: [...caller.roles], scopes: caller.scopes }, deps.config);
    for (const w of writes) {
        const write = (value: Record<string, unknown>) => writeWorkspaceDraftsOp(deps, opsCaller, {
            organismId: w.orgId, ws: w.ws, items: [{ space: 'decision', id: w.id, value }], pipeline: 'team.decision-share',
        });
        let r = await write(w.value);
        // A team made before 2026-11-15 has a Decisions schema without the share's fields; the same
        // facts then go into the fields it has, in words.
        if (!r.ok && /additional properties/.test(r.message ?? '')) r = await write(compactShare(w.value, fromName));
        if (!r.ok) {
            const t = targets.find(x => x.organism_id === w.orgId);
            if (t) { t.result = 'refused'; t.reason = r.message ?? 'the team refused the write'; delete t.record_id; }
        }
    }
    emitChange('organisms');
    return { ok: true, dry_run: false, decision: { id: args.decisionId, title }, targets };
}
