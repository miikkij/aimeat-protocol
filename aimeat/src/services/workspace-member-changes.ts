/**
 * @file src/services/workspace-member-changes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The doors through which a workspace member adds a space or changes the sections of a
 *   document space, whoever they are to the workspace. One implementation for every surface: the REST
 *   routes (routes/organisms/workspace-member-changes.ts), the MCP tools on the node and on the
 *   connector, the CLI dispatch, and the draft write that files a new document under a section
 *   (services/workspace-tool-ops.ts).
 *
 *   WHY IT EXISTS. Since the workspace's meta namespace became the creator's and the admins' alone
 *   (services/organism-namespace-access.ts, 2026-09-24), a contributor who filed a document under a
 *   section, or whose notebook added a document space to someone else's workspace, was refused, and
 *   the page swallowed the refusal. The owner's ruling, 2026-09-25: a proper server path, and one rule
 *   per workspace that its creator or an admin sets. "It needs to enable instead of make everyone's
 *   life hard, but it needs to enable safely."
 *
 *   WHAT HAPPENS TO A CHANGE. A manager's (the workspace creator, an organism creator or admin) is
 *   written at once. A contributor's follows the workspace's rule (`member_changes`, default
 *   'suggest'): 'direct' writes it at once, 'suggest' files it as a suggestion that a manager approves
 *   with one tap (services/workspace-suggestions.ts). Either way the change goes into the workspace's
 *   own record, the copy that counts, with the member's full identity and the time on it, never into a
 *   copy of their own. The answer says which of the three happened: applied, pending_approval, or a
 *   refusal with its reason.
 *
 *   One exception to the rule, and it is housekeeping: taking a document that no longer exists out of
 *   a section is written at once. Its record is gone, so the id in the index points at nothing, and
 *   asking an admin to approve that would make everyone's life hard for no one's benefit.
 * @structure
 *   - addWorkspaceSpaces() — add one or more spaces
 *   - setWorkspaceSections() — replace one document space's section index (what the page sends)
 *   - fileDocumentInSection() — file one document under one section (the draft write's `section`)
 *   - unfileDeletedDocument() — take a deleted document out of the index (the delete tools)
 * @usage
 *   const r = await addWorkspaceSpaces({ storage, config }, caller, { orgId, ws, spaces });
 *   if (!isRefusal(r)) res.status(r.status === 'pending_approval' ? 202 : 200).json(...);
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial: the member change doors (workspace actions for plain members).
 */
import {
    refusal, isRefusal, nowOf, workspaceStanding, refuseUnlessMayChange, validateSpaceRequest, newSpacesOf,
    applySpaces, resolveDocumentSpace, readSections, writeSections, existingDocIds,
    type ChangeCaller, type ChangeDeps, type ChangeRefusal, type WorkspaceStanding,
} from './workspace-change-core.js';
import { suggestSpaces, suggestSectionOps, type SuggestionView } from './workspace-suggestions.js';
import { findWorkspaceRegistration, type MemberChangeRule } from './workspace-meta.js';
import { validateSections, diffSections, applySectionOps, type Section, type SectionOp } from './workspace-sections.js';
import { emitChange } from './event-bus.js';
import { updateOrganismStructure } from './structure-snapshot.js';
import { logger } from '../utils/logger.js';

export { isRefusal };
export type { ChangeCaller, ChangeRefusal };

/** How a change ended: written, filed as a suggestion, or nothing to do. */
export type ChangeStatus = 'applied' | 'pending_approval' | 'unchanged';

export interface SpaceChangeOutcome {
    status: ChangeStatus;
    ws: string;
    rule: MemberChangeRule;
    added: string[];
    skipped: string[];
    changed_by?: string;
    changed_at?: string;
    suggestion?: SuggestionView;
    /** The same suggestion was already waiting; no second one was filed. */
    duplicate?: boolean;
}

export interface SectionsChangeOutcome {
    status: ChangeStatus;
    ws: string;
    space: string;
    rule: MemberChangeRule;
    /** The index as it stands after this call (for a suggestion: as it stands now, unchanged). */
    sections: Section[];
    changed_by?: string;
    changed_at?: string;
    suggestion?: SuggestionView;
    /** The change joined the member's suggestion already waiting for this space. */
    merged?: boolean;
    /** A document that no longer exists was taken out of the index; the rule was not asked. */
    housekeeping?: boolean;
}

/** Whether this caller's change is written at once. */
const writesAtOnce = (standing: WorkspaceStanding): boolean => standing.manager || standing.rule === 'direct';

/**
 * Add spaces to a workspace. The body is what aimeat_workspace_update's `add_spaces` takes (a space
 * is { name, namespace, mode } with defaults filled), plus `schemas` for the ones being added. A
 * space whose name or namespace already exists is skipped; when every one exists the answer is
 * `unchanged` and nothing is filed.
 */
export async function addWorkspaceSpaces(
    deps: ChangeDeps, caller: ChangeCaller,
    args: { orgId: string; ws: string; spaces: unknown; schemas?: unknown },
): Promise<SpaceChangeOutcome | ChangeRefusal> {
    const { orgId, ws } = args;
    const request = validateSpaceRequest(args.spaces, args.schemas);
    if ('error' in request) return refusal(400, 'INVALID_INPUT', request.error);
    const standing = await workspaceStanding(deps, caller, orgId, ws);
    if (isRefusal(standing)) return standing;
    const denied = refuseUnlessMayChange(standing);
    if (denied) return denied;
    const plan = await newSpacesOf(deps, orgId, ws, request);
    if (isRefusal(plan)) return plan;
    const base = { ws, rule: standing.rule, skipped: plan.skipped };
    if (!plan.fresh.length) return { status: 'unchanged', ...base, added: [] };
    const fresh = {
        spaces: plan.fresh,
        schemas: Object.fromEntries(Object.entries(request.schemas).filter(([ns]) => plan.fresh.some(s => s.namespace === ns))),
    };
    if (writesAtOnce(standing)) {
        const at = nowOf(deps).toISOString();
        const applied = await applySpaces(deps, standing, { orgId, ws, request: fresh, stamp: { addedBy: caller.principal, addedAt: at } });
        if (isRefusal(applied)) return applied;
        emitChange('organisms');
        void updateOrganismStructure(deps.storage, deps.config, orgId, { event: 'workspace updated', actor: caller.principal })
            .catch(err => { logger.warn('addWorkspaceSpaces: the timeline is best-effort', { error: String(err) }); });
        return { status: 'applied', ...base, added: applied.added, skipped: [...plan.skipped, ...applied.skipped], changed_by: caller.principal, changed_at: at };
    }
    const filed = await suggestSpaces(deps, caller, standing, { orgId, ws, request: fresh });
    if (isRefusal(filed)) return filed;
    return { status: 'pending_approval', ...base, added: [], suggestion: filed.suggestion, ...(filed.duplicate ? { duplicate: true } : {}) };
}

/** Write the steps of a section change, or file them, as the caller's standing and the rule say. */
async function commitSectionChange(
    deps: ChangeDeps, caller: ChangeCaller, standing: WorkspaceStanding,
    args: { orgId: string; ws: string; doc: { name: string; namespace: string }; current: { record: Awaited<ReturnType<typeof readSections>>['record']; sections: Section[] }; ops: SectionOp[]; replacement?: Section[] },
): Promise<SectionsChangeOutcome | ChangeRefusal> {
    const { orgId, ws, doc, current, ops } = args;
    const base = { ws, space: doc.name, rule: standing.rule };
    if (!ops.length) return { status: 'unchanged', ...base, sections: current.sections };
    const housekeeping = !writesAtOnce(standing) && ops.every(o => o.op === 'unfile')
        && (await existingDocIds(deps, orgId, ws, doc.namespace, ops.map(o => (o as { doc: string }).doc))).size === 0;
    if (writesAtOnce(standing) || housekeeping) {
        const at = nowOf(deps).toISOString();
        const next = args.replacement && !housekeeping ? args.replacement : applySectionOps(current.sections, ops);
        await writeSections(deps, { orgId, ws, spaceName: doc.name, sections: next, prev: current.record, registrar: standing.registrarGaii, stamp: { changedBy: caller.principal, changedAt: at } });
        emitChange('organisms');
        return { status: 'applied', ...base, sections: next, changed_by: caller.principal, changed_at: at, ...(housekeeping ? { housekeeping: true } : {}) };
    }
    const filed = await suggestSectionOps(deps, caller, standing, { orgId, ws, spaceName: doc.name, ops });
    if (isRefusal(filed)) return filed;
    return { status: 'pending_approval', ...base, sections: current.sections, suggestion: filed.suggestion, ...(filed.merged ? { merged: true } : {}) };
}

/**
 * Replace one document space's section index with the one sent: exactly what the workspace page's
 * saveSections sends, `{ sections: [{ id, name, parentId, documents, color? }] }`. Written at once it
 * is written as sent; filed as a suggestion it is the steps from the index as it stands to the one
 * sent, which an approval applies to the index as it stands then.
 */
export async function setWorkspaceSections(
    deps: ChangeDeps, caller: ChangeCaller,
    args: { orgId: string; ws: string; space: string; sections: unknown },
): Promise<SectionsChangeOutcome | ChangeRefusal> {
    const { orgId, ws, space } = args;
    const valid = validateSections(args.sections);
    if ('error' in valid) return refusal(400, 'INVALID_INPUT', valid.error);
    const standing = await workspaceStanding(deps, caller, orgId, ws);
    if (isRefusal(standing)) return standing;
    const denied = refuseUnlessMayChange(standing);
    if (denied) return denied;
    const doc = await resolveDocumentSpace(deps, orgId, ws, space);
    if (isRefusal(doc)) return doc;
    const current = await readSections(deps, orgId, ws, doc.name);
    return commitSectionChange(deps, caller, standing, { orgId, ws, doc, current, ops: diffSections(current.sections, valid.sections), replacement: valid.sections });
}

/**
 * File one document under one section, named by its id or its name: what aimeat_workspace_write's
 * `section` does after the document's draft landed. A section that does not exist is a refusal that
 * names the ones that do, where it used to be a silent nothing.
 */
export async function fileDocumentInSection(
    deps: ChangeDeps, caller: ChangeCaller,
    args: { orgId: string; ws: string; space: string; docId: string; section: string },
): Promise<SectionsChangeOutcome | ChangeRefusal> {
    const { orgId, ws, space, docId, section } = args;
    const standing = await workspaceStanding(deps, caller, orgId, ws);
    if (isRefusal(standing)) return standing;
    const denied = refuseUnlessMayChange(standing);
    if (denied) return denied;
    const doc = await resolveDocumentSpace(deps, orgId, ws, space);
    if (isRefusal(doc)) return doc;
    const current = await readSections(deps, orgId, ws, doc.name);
    const target = current.sections.find(s => s.id === section) ?? current.sections.find(s => s.name === section);
    if (!target) {
        const names = current.sections.map(s => s.name || s.id);
        return refusal(404, 'NOT_FOUND', `"${doc.name}" has no section "${section}". Its sections: ${names.length ? names.join(', ') : 'none yet'}. Add one with aimeat_workspace_sections_set.`);
    }
    const alone = target.documents.includes(docId) && current.sections.every(s => s === target || !s.documents.includes(docId));
    const ops: SectionOp[] = alone ? [] : [{ op: 'file', id: target.id, doc: docId }];
    return commitSectionChange(deps, caller, standing, { orgId, ws, doc, current, ops });
}

/**
 * Take a deleted document out of the section index of its space. Housekeeping: done at once for any
 * active member, and only when no copy of the document is left under anyone, because deleting your
 * own copy of a record another member also holds does not make it gone. Never throws: the delete it
 * follows has already happened.
 */
export async function unfileDeletedDocument(
    deps: ChangeDeps, caller: ChangeCaller,
    args: { orgId: string; ws: string; namespace: string; docId: string },
): Promise<{ unfiled: boolean }> {
    const { orgId, ws, namespace, docId } = args;
    try {
        const m = await deps.storage.getMembership(orgId, caller.owner);
        if (!m || m.status !== 'active') return { unfiled: false };
        const registration = await findWorkspaceRegistration(deps.storage, orgId, ws);
        if (!registration) return { unfiled: false };
        const doc = await resolveDocumentSpace(deps, orgId, ws, namespace);
        if (isRefusal(doc)) return { unfiled: false };
        const current = await readSections(deps, orgId, ws, doc.name);
        const holders = current.sections.filter(s => s.documents.includes(docId));
        if (!holders.length || (await existingDocIds(deps, orgId, ws, doc.namespace, [docId])).size) return { unfiled: false };
        const next = applySectionOps(current.sections, holders.map(s => ({ op: 'unfile', id: s.id, doc: docId })));
        await writeSections(deps, { orgId, ws, spaceName: doc.name, sections: next, prev: current.record, registrar: registration.record.ownerGaii,
            stamp: { changedBy: caller.principal, changedAt: nowOf(deps).toISOString() } });
        emitChange('organisms');
        return { unfiled: true };
    } catch (err) {
        logger.warn('unfileDeletedDocument: the index keeps the id, the delete stands', { error: String(err) });
        return { unfiled: false };
    }
}
