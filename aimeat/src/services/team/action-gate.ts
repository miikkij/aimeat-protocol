/**
 * @file src/services/team/action-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The team's approval gate (team setup T7): a delete in a team's workspaces, and a send
 *   or a payment by an agent that works for a team, waits until one of the team's leads approves it,
 *   when an AI asks for it. The skill told a member's AI the same thing; this is where the node holds
 *   it, whatever the AI remembers.
 *
 *   WHO IS HELD. A caller that is not the person in person (isOwnerInPerson): an agent, an app
 *   grant, an ecosystem app. A person deleting with their own hands is their own act. A delete is
 *   held when its keys lie in a team with the gate on, whoever's AI asks. A send or a payment is held
 *   when the caller is an agent whose workplace (services/agent/ties.ts) is a workspace of such a
 *   team: the member's own AI on their own matters is outside the gate, as the developer ruled.
 *
 *   HOW IT WAITS. The first ask files a pending approval in the team (action `team:delete`,
 *   `team:send` or `team:pay`, approver role `owner`, which every lead holds) with a fingerprint of
 *   exactly what was asked, and the call is refused with TEAM_APPROVAL_REQUIRED and where a lead
 *   decides it. A lead approves on the organism's approval route (POST /v1/organisms/:id/approvals/:aid),
 *   which records who approved and writes the decision log. The same caller asking the same thing
 *   again then passes, for ten minutes from that first use, so a record removed key by key passes on
 *   one approval; after that the same ask waits again. A delete's ask is its records, not its keys. Asking again before a decision does not
 *   file a second approval. An approval unused for seven days lapses, and a declined one is told back.
 *
 *   A lead turns the gate off or on with aimeat_team_setup `approval_gate` (TeamRecord.approvalGate).
 * @structure TEAM_GATE_ACTIONS · TeamGateCaller · TeamGateRefusal · isTeamGateAction ·
 *   teamDeleteGate · teamAgentGate
 * @usage
 *   const held = await teamDeleteGate(deps, { principal, roles }, keys);
 *   if (held) → answer held.status with held.code, held.message and held.details
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T7).
 */
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Storage, PendingApprovalRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { isOwnerInPerson, parseGAII, ownerGhiiOf } from '../../utils/gaii.js';
import { readWorkplace } from '../agent/ties.js';
import { emitChange } from '../event-bus.js';
import { readTeamRecord, teamGateOn, teamDisplayName } from './record.js';

type Deps = { storage: Storage; config: AimeatConfig };
export type TeamGateKind = 'delete' | 'send' | 'pay';

export const TEAM_GATE_ACTIONS: Record<TeamGateKind, string> = { delete: 'team:delete', send: 'team:send', pay: 'team:pay' };
const ACTIONS = new Set(Object.values(TEAM_GATE_ACTIONS));
/** An approval this gate filed: it is approved or declined as asked, never edited. */
export function isTeamGateAction(action: string): boolean { return ACTIONS.has(action); }

/** How long an approved ask stays usable. */
const APPROVAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** How long an approval passes the same ask after its first use. */
const USE_WINDOW_MS = 10 * 60 * 1000;
/** A key's record: the key without its `.draft`, `.latest` or `.version.N`. */
const recordOf = (key: string) => key.replace(/\.(draft|latest|version\.\d+)$/, '');

export interface TeamGateCaller { principal: string; roles: readonly string[] }
export interface TeamGateRefusal {
    status: 403;
    code: 'TEAM_APPROVAL_REQUIRED' | 'TEAM_APPROVAL_DECLINED';
    message: string;
    details: { approval_id: string; organism_id: string; team: string; status: 'pending' | 'rejected'; decide_url: string; retry: string };
}

const ORG_OF_KEY = /^organism\.([0-9a-fA-F-]{8,})\./;

function fingerprintOf(kind: TeamGateKind, parts: unknown): string {
    return createHash('sha256').update(JSON.stringify([kind, parts])).digest('hex').slice(0, 40);
}

async function gateIn(deps: Deps, caller: TeamGateCaller, orgId: string, kind: TeamGateKind, parts: unknown, summary: string): Promise<TeamGateRefusal | null> {
    const { storage } = deps;
    const team = await readTeamRecord(storage, orgId);
    if (!team || !teamGateOn(team)) return null;
    const organism = await storage.getOrganism(orgId);
    if (!organism || organism.archived) return null;
    const action = TEAM_GATE_ACTIONS[kind];
    const fingerprint = fingerprintOf(kind, parts);
    const now = Date.now();
    const mine = (await storage.listPendingApprovals(orgId))
        .filter(a => a.action === action && a.actor === caller.principal && a.arguments?.fingerprint === fingerprint)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const usedAt = (a: PendingApprovalRecord) => (typeof a.arguments?.used_at === 'string' ? Date.parse(a.arguments.used_at) : null);
    const usable = mine.find(a => a.status === 'approved'
        && now - Date.parse(a.decidedAt ?? a.updatedAt) < APPROVAL_LIFETIME_MS
        && (usedAt(a) === null || now - (usedAt(a) as number) < USE_WINDOW_MS));
    if (usable) {
        // The first use starts a short window, so a record removed key by key (its draft, its
        // published copy, its versions) passes on one approval; after it the same ask waits again.
        if (usedAt(usable) === null) {
            await storage.updatePendingApproval(usable.id, { arguments: { ...usable.arguments, used_at: new Date(now).toISOString() }, updatedAt: new Date(now).toISOString() });
        }
        return null;
    }
    const name = teamDisplayName(team, null, organism.name);
    const where = `/v1/profile?tab=organisms&org=${encodeURIComponent(orgId)}&ws=${encodeURIComponent(team.workspaces.waiting)}`;
    const retry = 'After a lead approves, make the same call again with the same input; it then runs once.';
    const pending = mine.find(a => a.status === 'pending');
    const latest = mine[0];
    if (!pending && latest?.status === 'rejected' && now - Date.parse(latest.decidedAt ?? latest.updatedAt) < 24 * 60 * 60 * 1000) {
        return {
            status: 403, code: 'TEAM_APPROVAL_DECLINED',
            message: `A lead of the team "${name}" declined this${latest.resolutionNote ? `: ${latest.resolutionNote}` : ''} (approval ${latest.id}). Tell the person; do not try it again today.`,
            details: { approval_id: latest.id, organism_id: orgId, team: name, status: 'rejected', decide_url: where, retry },
        };
    }
    let id = pending?.id;
    if (!id) {
        id = uuidv4();
        const at = new Date(now).toISOString();
        const record: PendingApprovalRecord = {
            id, organismId: orgId, actor: caller.principal, action,
            arguments: { kind, fingerprint, summary: summary.slice(0, 500) },
            risk: 'high', approverRole: 'owner', prompt: summary.slice(0, 500),
            status: 'pending', createdAt: at, updatedAt: at,
        };
        await storage.createPendingApproval(record);
        emitChange('organisms');
    }
    return {
        status: 403, code: 'TEAM_APPROVAL_REQUIRED',
        message: `The team "${name}" asks a lead to approve this first: ${summary.slice(0, 200)}. Approval ${id} waits for a lead at ${where}. Tell the person; after the approval, make the same call again with the same input.`,
        details: { approval_id: id, organism_id: orgId, team: name, status: 'pending', decide_url: where, retry },
    };
}

/**
 * A delete of these keys (or of a whole workspace or organism, given as its key prefix). Held when
 * the caller is not the person in person and the keys lie in a team with the gate on.
 */
export async function teamDeleteGate(deps: Deps, caller: TeamGateCaller, keys: readonly string[], summary?: string): Promise<TeamGateRefusal | null> {
    if (isOwnerInPerson({ roles: [...caller.roles] })) return null;
    const byOrg = new Map<string, string[]>();
    for (const k of keys) {
        const org = ORG_OF_KEY.exec(k)?.[1];
        if (org) (byOrg.get(org) ?? byOrg.set(org, []).get(org)!).push(recordOf(k));
    }
    for (const [orgId, own] of byOrg) {
        const sorted = [...new Set(own)].sort();
        const what = summary ?? (sorted.length === 1 ? `delete ${sorted[0]}` : `delete ${sorted.length} keys, first ${sorted[0]}`);
        const held = await gateIn(deps, caller, orgId, 'delete', sorted, what);
        if (held) return held;
    }
    return null;
}

/**
 * A send or a payment. Held when the caller is an agent whose workplace is a workspace of a team
 * with the gate on. `parts` is what the ask is (recipient and content, or the checkout), so only the
 * same ask passes on the approval.
 */
export async function teamAgentGate(deps: Deps, caller: TeamGateCaller, kind: 'send' | 'pay', parts: unknown, summary: string): Promise<TeamGateRefusal | null> {
    if (isOwnerInPerson({ roles: [...caller.roles] })) return null;
    const agent = parseGAII(caller.principal);
    if (!agent) return null;
    const workplace = await readWorkplace(deps.storage, ownerGhiiOf(caller.principal), agent.agent);
    if (!workplace?.organismId) return null;
    return gateIn(deps, caller, workplace.organismId, kind, parts, summary);
}
