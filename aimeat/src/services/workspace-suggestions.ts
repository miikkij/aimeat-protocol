/**
 * @file src/services/workspace-suggestions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A plain member's change to a workspace that waits for an approval: the workspace's
 *   rule says 'suggest' (services/workspace-meta.ts, `member_changes`), so adding a space or changing
 *   the sections of a document space becomes a suggestion that the workspace's creator or an organism
 *   admin approves or declines with one tap.
 *
 *   A SUGGESTION IS AN APPROVAL. It is the organism's PendingApproval (routes/organisms/gates.ts),
 *   with `approverRole: 'admin'`, a deadline, and the exact change as its `arguments`. Two actions are
 *   reserved for it (MEMBER_CHANGE_ACTIONS); the generic approval route refuses to create either, so
 *   the only suggestion that exists is one this file made, and approving one runs exactly the change
 *   it stored. Nothing in the record is trusted at approval time: the approver is checked against the
 *   workspace as it is now, the change is validated again, and the member who suggested it must still
 *   be able to change the workspace.
 *
 *   WHO DECIDES. The workspace's creator and every organism creator or admin: the people who may
 *   write its structure anyway. Never the member who made the suggestion, whatever role they have
 *   gained since. An agent decides for its owner when the owner is one of those people and the agent
 *   holds the permission the change needs, which is the organism namespace rule's write on the record
 *   the change lands in (services/organism-namespace-access.ts). A person in their own chat is always
 *   an agent here, so this is the road a decision from a chat takes.
 *
 *   EXPIRY FAILS CLOSED. A suggestion carries a deadline SUGGESTION_TTL_DAYS out; the gate expiry
 *   sweep marks an overdue one rejected ('expired: …') and tells the member, and a decision on one
 *   that is overdue expires it instead of running it.
 * @structure
 *   - MEMBER_CHANGE_ACTIONS, isMemberChangeAction(), SUGGESTION_TTL_DAYS
 *   - SuggestionView, suggestionView() — what a caller is shown
 *   - suggestSpaces(), suggestSectionOps() — make one (sections coalesce per member and space)
 *   - listSuggestions() — the ones a caller may see, with `can_decide`
 *   - visibleApprovals() — the organism's approval inbox without the suggestions a caller may not see
 *   - decideSuggestion() — approve (run it) or decline, and tell the member
 * @usage
 *   const r = await decideSuggestion({ storage, config }, caller, { orgId, id, decision: 'approve' });
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial: the member change doors (workspace actions for plain members).
 */
import { v4 as uuidv4 } from 'uuid';
import type { PendingApprovalRecord } from '../storage/interface.js';
import { createOrganismHelpers } from '../routes/organisms/shared.js';
import { expireOverdueApprovals, expireApproval, isOverdue } from './gate-expiry.js';
import { checkOrganismNamespaceAccess } from './organism-namespace-access.js';
import { canReadWorkspace } from './workspace-access.js';
import { findWorkspaceRegistration } from './workspace-meta.js';
import { noticeDeciders, noticeRequester, ownerNameOf, MEMBER_CHANGE_ACTIONS, isMemberChangeAction } from './workspace-suggestion-notices.js';
import {
    refusal, isRefusal, nowOf, workspaceStanding, refuseUnlessMayChange, validateSpaceRequest, applySpaces,
    resolveDocumentSpace, readSections, writeSections,
    type ChangeCaller, type ChangeDeps, type ChangeRefusal, type WorkspaceStanding, type SpaceRequest,
} from './workspace-change-core.js';
import { applySectionOps, summarizeSectionOps, validateSectionOps, MAX_SECTION_OPS, type SectionOp, type Section } from './workspace-sections.js';
import { emitChange } from './event-bus.js';
import { updateOrganismStructure } from './structure-snapshot.js';
import { logger } from '../utils/logger.js';

/** The two approval actions a member change files. The generic approval route refuses both. */
export { MEMBER_CHANGE_ACTIONS, isMemberChangeAction };
export type SuggestionKind = keyof typeof MEMBER_CHANGE_ACTIONS;

/** How long a suggestion waits for a decision before it expires. */
export const SUGGESTION_TTL_DAYS = 30;
/** How many space suggestions one member may have waiting in one workspace. */
export const MAX_PENDING_SPACE_SUGGESTIONS = 20;

/** What a stored suggestion's `arguments` hold. */
interface SuggestionArgs {
    kind: SuggestionKind;
    ws: string;
    ws_name: string;
    label: string;
    spaces?: Array<Record<string, unknown>>;
    schemas?: Record<string, Record<string, unknown>>;
    space?: string;
    ops?: SectionOp[];
}

function argsOf(a: PendingApprovalRecord): SuggestionArgs | null {
    const v = (a.arguments ?? {}) as Record<string, unknown>;
    if ((v.kind !== 'space' && v.kind !== 'sections') || typeof v.ws !== 'string' || !v.ws) return null;
    return v as unknown as SuggestionArgs;
}

export interface SuggestionView {
    id: string;
    organism_id: string;
    ws: string;
    ws_name: string;
    kind: SuggestionKind;
    /** space: the names of the spaces; sections: the document space. */
    label: string;
    summary: string;
    spaces?: Array<Record<string, unknown>>;
    schemas?: Record<string, Record<string, unknown>>;
    space?: string;
    ops?: SectionOp[];
    requested_by: string;
    requested_at: string;
    status: 'pending' | 'approved' | 'declined' | 'expired';
    decided_by?: string;
    decided_at?: string;
    note?: string;
    expires_at?: string;
    can_decide?: boolean;
}

function statusOf(a: PendingApprovalRecord): SuggestionView['status'] {
    if (a.status === 'pending') return 'pending';
    if (a.status === 'approved' || a.status === 'edited') return 'approved';
    return (a.resolutionNote ?? '').startsWith('expired') ? 'expired' : 'declined';
}

/** The note an approver wrote, without the outcome word the record keeps in front of it. */
function noteOf(a: PendingApprovalRecord): string | undefined {
    const m = /^(approved|declined): ([\s\S]*)$/.exec(a.resolutionNote ?? '');
    return m ? m[2] : undefined;
}

export function suggestionView(a: PendingApprovalRecord, canDecide?: boolean): SuggestionView {
    const args = argsOf(a);
    const kind = (args?.kind ?? 'space') as SuggestionKind;
    return {
        id: a.id, organism_id: a.organismId, ws: args?.ws ?? '', ws_name: args?.ws_name ?? args?.ws ?? '',
        kind, label: args?.label ?? '',
        summary: kind === 'sections' ? summarizeSectionOps(args?.ops ?? []) : `add ${args?.label ?? ''}`,
        ...(kind === 'space'
            ? { spaces: args?.spaces ?? [], ...(args?.schemas ? { schemas: args.schemas } : {}) }
            : { space: args?.space, ops: args?.ops ?? [] }),
        requested_by: a.actor, requested_at: a.createdAt, status: statusOf(a),
        ...(a.decidedBy ? { decided_by: a.decidedBy } : {}),
        ...(a.decidedAt ? { decided_at: a.decidedAt } : {}),
        ...(noteOf(a) ? { note: noteOf(a) } : {}),
        ...(a.deadline ? { expires_at: a.deadline } : {}),
        ...(canDecide !== undefined ? { can_decide: canDecide } : {}),
    };
}

/** Everyone who may decide: the workspace's creator and every active organism creator or admin, bare names. */
async function decidersOf(deps: ChangeDeps, orgId: string, standing: WorkspaceStanding, except: string): Promise<string[]> {
    const members = await deps.storage.listMembers(orgId, { status: 'active' });
    const names = members.filter(m => m.role === 'creator' || m.role === 'admin').map(m => m.ghii);
    if (members.some(m => m.ghii === standing.creator)) names.push(standing.creator);
    return [...new Set(names)].filter(n => n && n !== except);
}

/** The member's pending suggestions of one kind in one workspace. */
async function pendingOf(deps: ChangeDeps, orgId: string, ws: string, kind: SuggestionKind, owner: string): Promise<PendingApprovalRecord[]> {
    return (await deps.storage.listPendingApprovals(orgId, { status: 'pending' }))
        .filter(a => a.action === MEMBER_CHANGE_ACTIONS[kind] && argsOf(a)?.ws === ws && ownerNameOf(a.actor) === owner);
}

async function fileSuggestion(
    deps: ChangeDeps, caller: ChangeCaller, standing: WorkspaceStanding, orgId: string,
    args: SuggestionArgs, prompt: string, risk: PendingApprovalRecord['risk'],
): Promise<PendingApprovalRecord> {
    const now = nowOf(deps);
    const record: PendingApprovalRecord = {
        id: uuidv4(), organismId: orgId, actor: caller.principal, action: MEMBER_CHANGE_ACTIONS[args.kind],
        arguments: args as unknown as Record<string, unknown>, risk, approverRole: 'admin', prompt, status: 'pending',
        deadline: new Date(now.getTime() + SUGGESTION_TTL_DAYS * 86_400_000).toISOString(),
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    await deps.storage.createPendingApproval(record);
    const deciders = await decidersOf(deps, orgId, standing, caller.owner);
    await noticeDeciders(deps.storage, deps.config.nodeId, deciders, {
        organismId: orgId, suggestionId: record.id, kind: args.kind, wsName: args.ws_name, label: args.label,
        who: caller.owner, count: args.ops?.length,
    });
    emitChange('organisms');
    return record;
}

/**
 * File a suggestion to add spaces. The same member asking again for the same namespaces gets the
 * suggestion already waiting instead of a second one, so a page that retries does not multiply the
 * admins' notifications.
 */
export async function suggestSpaces(
    deps: ChangeDeps, caller: ChangeCaller, standing: WorkspaceStanding,
    args: { orgId: string; ws: string; request: SpaceRequest },
): Promise<{ suggestion: SuggestionView; duplicate: boolean } | ChangeRefusal> {
    const { orgId, ws, request } = args;
    const wanted = request.spaces.map(s => String(s.namespace)).sort().join('|');
    const waiting = await pendingOf(deps, orgId, ws, 'space', caller.owner);
    const same = waiting.find(a => (argsOf(a)?.spaces ?? []).map(s => String(s.namespace)).sort().join('|') === wanted);
    if (same) return { suggestion: suggestionView(same, false), duplicate: true };
    if (waiting.length >= MAX_PENDING_SPACE_SUGGESTIONS) {
        return refusal(429, 'QUOTA_EXCEEDED', `You have ${waiting.length} space suggestions waiting in this workspace. Wait until its creator or an admin decides them, or ask one of them to.`);
    }
    const names = request.spaces.map(s => String(s.name));
    const stored: SuggestionArgs = {
        kind: 'space', ws, ws_name: standing.wsName, label: names.join(', '),
        spaces: request.spaces, ...(Object.keys(request.schemas).length ? { schemas: request.schemas } : {}),
    };
    const prompt = `${caller.owner} suggests adding the space${names.length > 1 ? 's' : ''} ${names.map(n => `"${n}"`).join(', ')} to workspace "${standing.wsName}".`;
    const record = await fileSuggestion(deps, caller, standing, orgId, stored, prompt, 'medium');
    return { suggestion: suggestionView(record, false), duplicate: false };
}

/**
 * File the steps of a change to one document space's sections. A member has at most ONE suggestion
 * waiting per document space: further changes join it, so reorganising a tree in ten moves asks the
 * admins once. The deadline moves with the latest change.
 */
export async function suggestSectionOps(
    deps: ChangeDeps, caller: ChangeCaller, standing: WorkspaceStanding,
    args: { orgId: string; ws: string; spaceName: string; ops: SectionOp[] },
): Promise<{ suggestion: SuggestionView; merged: boolean } | ChangeRefusal> {
    const { orgId, ws, spaceName, ops } = args;
    const waiting = (await pendingOf(deps, orgId, ws, 'sections', caller.owner)).find(a => argsOf(a)?.space === spaceName);
    const now = nowOf(deps);
    if (waiting) {
        const prev = argsOf(waiting)!;
        const all = [...(prev.ops ?? []), ...ops];
        if (all.length > MAX_SECTION_OPS) {
            return refusal(429, 'QUOTA_EXCEEDED', `Your suggested changes to "${spaceName}" already hold ${prev.ops?.length ?? 0} steps. Wait until the workspace's creator or an admin decides them.`);
        }
        const updated = await deps.storage.updatePendingApproval(waiting.id, {
            arguments: { ...(prev as unknown as Record<string, unknown>), ops: all },
            prompt: `${caller.owner} suggests changes to the sections of "${spaceName}" in workspace "${standing.wsName}": ${summarizeSectionOps(all)}.`,
            deadline: new Date(now.getTime() + SUGGESTION_TTL_DAYS * 86_400_000).toISOString(),
            updatedAt: now.toISOString(),
        });
        emitChange('organisms');
        return { suggestion: suggestionView(updated ?? waiting, false), merged: true };
    }
    const stored: SuggestionArgs = { kind: 'sections', ws, ws_name: standing.wsName, label: spaceName, space: spaceName, ops };
    const prompt = `${caller.owner} suggests changes to the sections of "${spaceName}" in workspace "${standing.wsName}": ${summarizeSectionOps(ops)}.`;
    const record = await fileSuggestion(deps, caller, standing, orgId, stored, prompt, 'low');
    return { suggestion: suggestionView(record, false), merged: false };
}

/** Is `owner` a manager of the workspace: its registered creator, or an organism creator or admin? */
async function managesWorkspace(deps: ChangeDeps, orgId: string, ws: string, owner: string): Promise<boolean> {
    const m = await deps.storage.getMembership(orgId, owner);
    if (!m || m.status !== 'active') return false;
    if (m.role === 'creator' || m.role === 'admin') return true;
    return (await findWorkspaceRegistration(deps.storage, orgId, ws))?.creator === owner;
}

export type SuggestionStatusFilter = 'pending' | 'approved' | 'declined' | 'expired' | 'all';

/**
 * The suggestions a caller may see: those in workspaces they can read, and their own. Each says
 * whether this caller may decide it. Overdue ones are expired first, so a list never offers a
 * decision that would only be refused.
 */
export async function listSuggestions(
    deps: ChangeDeps, caller: ChangeCaller,
    args: { orgId: string; ws?: string; status?: SuggestionStatusFilter },
): Promise<{ suggestions: SuggestionView[] } | ChangeRefusal> {
    const { storage, config } = deps;
    const { orgId, ws } = args;
    const status = args.status ?? 'pending';
    const organism = await storage.getOrganism(orgId);
    if (!organism) return refusal(404, 'NOT_FOUND', 'Organism not found. Check the id with aimeat_organism_list.');
    const membership = await storage.getMembership(orgId, caller.owner);
    if (!membership || membership.status !== 'active' || organism.agentGaiis.includes(caller.principal)) {
        return refusal(403, 'ACCESS_DENIED', 'You are not an active member of this organism. Join it first.');
    }
    await expireOverdueApprovals(storage, nowOf(deps).toISOString());
    const stored = status === 'pending' ? 'pending' : status === 'approved' ? 'approved' : status === 'all' ? undefined : 'rejected';
    const rows = (await storage.listPendingApprovals(orgId, stored ? { status: stored } : undefined))
        .filter(a => isMemberChangeAction(a.action))
        .filter(a => !ws || argsOf(a)?.ws === ws)
        .filter(a => status === 'all' || statusOf(a) === status);
    const readable = new Map<string, boolean>();
    const managed = new Map<string, boolean>();
    const out: SuggestionView[] = [];
    for (const a of rows) {
        const w = argsOf(a)?.ws;
        if (!w) continue;
        const mine = ownerNameOf(a.actor) === caller.owner;
        if (!managed.has(w)) managed.set(w, await managesWorkspace(deps, orgId, w, caller.owner));
        if (!managed.get(w) && !mine) {
            if (!readable.has(w)) readable.set(w, await canReadWorkspace(storage, config, organism, caller.principal, caller.owner, `${caller.owner}@${config.nodeId}`, w));
            if (!readable.get(w)) continue;
        }
        out.push(suggestionView(a, a.status === 'pending' && !!managed.get(w) && !mine));
    }
    return { suggestions: out };
}

/**
 * The organism's approval inbox (GET /v1/organisms/:id/approvals) with the member suggestions the
 * caller may not see taken out: a suggestion carries the structure it would add to a workspace, and a
 * member who cannot read that workspace is not shown its structure by an inbox either. Every other
 * approval passes through as it was.
 */
export async function visibleApprovals(
    deps: ChangeDeps, caller: ChangeCaller, orgId: string, approvals: PendingApprovalRecord[],
): Promise<PendingApprovalRecord[]> {
    const organism = await deps.storage.getOrganism(orgId);
    if (!organism) return [];
    const seen = new Map<string, boolean>();
    const out: PendingApprovalRecord[] = [];
    for (const a of approvals) {
        if (!isMemberChangeAction(a.action)) { out.push(a); continue; }
        const w = argsOf(a)?.ws;
        if (!w) continue;
        if (ownerNameOf(a.actor) === caller.owner) { out.push(a); continue; }
        if (!seen.has(w)) {
            seen.set(w, await managesWorkspace(deps, orgId, w, caller.owner)
                || await canReadWorkspace(deps.storage, deps.config, organism, caller.principal, caller.owner, `${caller.owner}@${deps.config.nodeId}`, w));
        }
        if (seen.get(w)) out.push(a);
    }
    return out;
}

export interface DecisionResult {
    suggestion: SuggestionView;
    added?: string[];
    skipped?: string[];
    sections?: Section[];
}

/**
 * Approve or decline one suggestion. Approving runs exactly the stored change on the workspace as it
 * is now and leaves the suggestion pending when that is refused, so it can be approved again once
 * the cause is fixed, or declined. Either outcome is written to the organism's decision log and told
 * to the member who suggested it.
 */
export async function decideSuggestion(
    deps: ChangeDeps, caller: ChangeCaller,
    args: { orgId: string; id: string; decision: unknown; note?: unknown },
): Promise<DecisionResult | ChangeRefusal> {
    const { storage, config } = deps;
    const { orgId, id } = args;
    const decision = args.decision === 'approve' ? 'approve' : (args.decision === 'decline' || args.decision === 'reject') ? 'decline' : null;
    if (!decision) return refusal(400, 'INVALID_INPUT', "decision is 'approve' or 'decline'. A suggestion is decided as it was sent; to change it, decline it and make the change yourself.");
    if (args.note !== undefined && (typeof args.note !== 'string' || args.note.length > 1000)) return refusal(400, 'INVALID_INPUT', 'note is text of at most 1000 characters.');
    const note = typeof args.note === 'string' && args.note.trim() ? args.note.trim() : undefined;
    const nowIso = nowOf(deps).toISOString();

    await expireOverdueApprovals(storage, nowIso);
    const a = await storage.getPendingApproval(id);
    if (!a || a.organismId !== orgId || !isMemberChangeAction(a.action)) {
        return refusal(404, 'NOT_FOUND', 'No suggestion with that id in this organism. List them with aimeat_workspace_suggestions.');
    }
    if (a.status !== 'pending') {
        return statusOf(a) === 'expired'
            ? refusal(409, 'EXPIRED', 'This suggestion expired before anyone decided it, so nothing was changed. The member can suggest it again.')
            : refusal(409, 'ALREADY_RESOLVED', `This suggestion was already ${statusOf(a)}, so there is nothing left to decide.`);
    }
    if (isOverdue(a, nowIso)) {
        await expireApproval(storage, a.id, nowIso);
        await noticeRequester(storage, a, 'expired');
        return refusal(409, 'EXPIRED', 'This suggestion expired before anyone decided it, so nothing was changed. The member can suggest it again.');
    }
    const stored = argsOf(a);
    const ws = stored?.ws ?? String((a.arguments as { ws?: unknown } | undefined)?.ws ?? '');
    if (!(await managesWorkspace(deps, orgId, ws, caller.owner))) {
        return refusal(403, 'ACCESS_DENIED', "Deciding a member's suggestion takes the workspace's creator or an organism admin. Ask one of them.");
    }
    if (ownerNameOf(a.actor) === caller.owner) {
        return refusal(403, 'ACCESS_DENIED', "You made this suggestion, so somebody else decides it: the workspace's creator or another organism admin.");
    }
    const metaKey = stored?.kind === 'sections'
        ? `organism.${orgId}.w.${ws}.meta.sections.${stored.space ?? ''}`
        : `organism.${orgId}.w.${ws}.meta.manifest`;
    const gate = await checkOrganismNamespaceAccess({ storage, config }, { principal: caller.principal, owner: caller.owner, roles: caller.roles }, metaKey, 'write');
    if (gate) {
        return refusal(gate.status, gate.code, 'Deciding this suggestion takes the permission to change what it changes, and this session does not hold it. Decide it from your own session instead.');
    }

    const H = createOrganismHelpers(config, storage);
    if (decision === 'decline') {
        const updated = await storage.updatePendingApproval(a.id, {
            status: 'rejected', decidedBy: caller.principal, decidedAt: nowIso,
            resolutionNote: note ? `declined: ${note}` : 'declined', updatedAt: nowIso,
        });
        await H.writeDecision(orgId, caller.principal, `declined a suggestion: ${a.prompt ?? a.action}`, [a.id]);
        await noticeRequester(storage, a, 'declined', note);
        emitChange('organisms');
        return { suggestion: suggestionView(updated ?? a, false) };
    }

    if (!stored) return refusal(409, 'INVALID_STATE', 'This suggestion cannot be read, so it cannot be applied. Decline it instead.');
    const standing = await workspaceStanding(deps, caller, orgId, ws);
    if (isRefusal(standing)) return standing;
    // The member must still be able to change the workspace: approving runs THEIR change, stamped
    // with their name, and a member who has left or lost the role no longer makes changes here.
    const requester: ChangeCaller = { principal: a.actor, owner: ownerNameOf(a.actor), roles: a.actor.includes('#') ? ['agent'] : ['owner'] };
    const theirs = await workspaceStanding(deps, requester, orgId, ws);
    if (isRefusal(theirs) || refuseUnlessMayChange(theirs)) {
        return refusal(409, 'INVALID_STATE', 'The member who suggested this can no longer change this workspace, so it was not applied. Decline it instead.');
    }
    const approval = { approvedBy: caller.principal, suggestion: a.id };
    let result: Omit<DecisionResult, 'suggestion'>;
    if (stored.kind === 'space') {
        const request = validateSpaceRequest(stored.spaces, stored.schemas);
        if ('error' in request) return refusal(409, 'INVALID_STATE', `This suggestion no longer describes a valid space: ${request.error} Decline it instead.`);
        const applied = await applySpaces(deps, standing, { orgId, ws, request, stamp: { addedBy: a.actor, addedAt: nowIso, ...approval } });
        if (isRefusal(applied)) return applied;
        result = applied;
    } else {
        const doc = await resolveDocumentSpace(deps, orgId, ws, stored.space ?? '');
        if (isRefusal(doc)) return doc;
        const ops = validateSectionOps(stored.ops);
        if (!ops) return refusal(409, 'INVALID_STATE', 'The steps of this suggestion cannot be read, so it cannot be applied. Decline it instead.');
        const { record, sections } = await readSections(deps, orgId, ws, doc.name);
        const merged = applySectionOps(sections, ops);
        await writeSections(deps, { orgId, ws, spaceName: doc.name, sections: merged, prev: record, registrar: standing.registrarGaii, stamp: { changedBy: a.actor, changedAt: nowIso, ...approval } });
        result = { sections: merged };
    }
    const updated = await storage.updatePendingApproval(a.id, {
        status: 'approved', decidedBy: caller.principal, decidedAt: nowIso,
        resolutionNote: note ? `approved: ${note}` : 'approved', updatedAt: nowIso,
    });
    await H.writeDecision(orgId, caller.principal, `approved a suggestion: ${a.prompt ?? a.action}`, [a.id]);
    await noticeRequester(storage, a, 'approved');
    emitChange('organisms');
    if (stored.kind === 'space' && result.added?.length) {
        void updateOrganismStructure(storage, config, orgId, { event: 'workspace updated', actor: caller.principal })
            .catch(err => { logger.warn('decideSuggestion: the timeline is best-effort', { error: String(err) }); });
    }
    return { suggestion: suggestionView(updated ?? a, false), ...result };
}
