/**
 * @file src/services/workspace-suggestion-notices.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The bell notifications of a member's suggested change to a workspace: one to each
 *   person who may decide it, with Approve and Decline on it, and one to the member when it is
 *   decided or expires. The suggestion itself is a PendingApproval (services/workspace-suggestions.ts);
 *   this file only says it to people.
 *
 *   WHY A FILE OF ITS OWN. The expiry sweep (services/gate-expiry.ts) has to tell the member too, and
 *   the suggestion service imports the sweep to run it before a decision. A notice module that imports
 *   neither is what lets both reach it without an import cycle.
 *
 *   Every notification is written by the node, never from a caller's text: the Approve and Decline
 *   actions run with the clicker's own session against the decide route, which checks everything
 *   again, so a stale click is answered, not obeyed. The words come from the `notiftext.*` keys in
 *   each language; the English here is the fallback and what a push carries.
 * @structure
 *   - MEMBER_CHANGE_ACTIONS, isMemberChangeAction() — the two approval actions a suggestion files
 *   - SuggestionNoticeFacts / noticeFactsOf() — what a notice says, read from the suggestion itself
 *   - noticeDeciders() — one notification per decider, with the two actions
 *   - noticeRequester() — the outcome to the member who suggested it
 * @usage
 *   await noticeDeciders(storage, nodeId, deciders, facts);
 *   await noticeRequester(storage, approval, 'approved');
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial: the member change doors (workspace actions for plain members).
 */
import type { Storage, PendingApprovalRecord } from '../storage/interface.js';
import { notify } from './notify.js';
import { emitChange } from './event-bus.js';

/**
 * The two approval actions a member's suggested change files (services/workspace-suggestions.ts).
 * They live here, below the suggestion service, so the expiry sweep can recognise one without
 * importing the service that imports the sweep.
 */
export const MEMBER_CHANGE_ACTIONS = { space: 'workspace.space.add', sections: 'workspace.sections.change' } as const;

export function isMemberChangeAction(action: unknown): boolean {
    return action === MEMBER_CHANGE_ACTIONS.space || action === MEMBER_CHANGE_ACTIONS.sections;
}

/** What a notice about one suggestion says. All of it is stored on the suggestion when it is made. */
export interface SuggestionNoticeFacts {
    organismId: string;
    suggestionId: string;
    kind: 'space' | 'sections';
    /** The workspace's name as the registry had it when the suggestion was made. */
    wsName: string;
    /** space: the names of the spaces; sections: the document space's name. */
    label: string;
    /** The member's name, as a person reads it. */
    who: string;
    /** sections: how many steps the change has. */
    count?: number;
}

/** The facts a stored suggestion carries, for a notice sent after it was made (a decision, an expiry). */
export function noticeFactsOf(approval: PendingApprovalRecord): SuggestionNoticeFacts | null {
    if (!isMemberChangeAction(approval.action)) return null;
    const a = (approval.arguments ?? {}) as Record<string, unknown>;
    const kind = a.kind === 'space' || a.kind === 'sections' ? a.kind : null;
    if (!kind) return null;
    return {
        organismId: approval.organismId,
        suggestionId: approval.id,
        kind,
        wsName: typeof a.ws_name === 'string' && a.ws_name ? a.ws_name : String(a.ws ?? ''),
        label: typeof a.label === 'string' ? a.label : '',
        who: ownerNameOf(approval.actor),
        count: Array.isArray(a.ops) ? a.ops.length : undefined,
    };
}

/** The bare account name behind a GHII or a GAII: `bot#bob@node` and `bob@node` both give `bob`. */
export function ownerNameOf(identity: string): string {
    const afterHash = identity.includes('#') ? identity.slice(identity.indexOf('#') + 1) : identity;
    return afterHash.split('@')[0];
}

/** The GHII a notification to this identity's person goes to: the agent part is dropped. */
function personOf(identity: string): string {
    return identity.includes('#') ? identity.slice(identity.indexOf('#') + 1) : identity;
}

/**
 * Tell each person who may decide the suggestion. `deciders` are bare account names, already without
 * the member who made it. One notification each, carrying Approve and Decline.
 */
export async function noticeDeciders(
    storage: Storage, nodeId: string, deciders: string[], facts: SuggestionNoticeFacts,
): Promise<void> {
    const endpoint = `/v1/organisms/${facts.organismId}/workspace/suggestions/${facts.suggestionId}`;
    const space = facts.kind === 'space';
    const title = space
        ? `${facts.who} suggests adding the space "${facts.label}" to "${facts.wsName}"`
        : `${facts.who} suggests changes to the sections of "${facts.label}" in "${facts.wsName}"`;
    const body = space
        ? 'When you approve, the space is added at once.'
        : `Changes waiting: ${facts.count ?? 0}. When you approve, they are made at once.`;
    for (const decider of new Set(deciders)) {
        await notify(storage, `${decider}@${nodeId}`, {
            type: space ? 'workspace_space_suggested' : 'workspace_sections_suggested',
            title, body,
            link: '/v1/profile#organisms',
            i18n: {
                key: space ? 'workspace_space_suggested' : 'workspace_sections_suggested',
                vars: { who: facts.who, ws: facts.wsName, space: facts.label, count: facts.count ?? 0 },
            },
            actions: [
                { id: 'approve', label: 'Approve', kind: 'api', method: 'POST', endpoint, body: { decision: 'approve' }, style: 'primary' },
                { id: 'decline', label: 'Decline', kind: 'api', method: 'POST', endpoint, body: { decision: 'decline' }, style: 'danger', confirm: true },
            ],
        });
    }
    emitChange('notifications');
}

/** Tell the member who made the suggestion how it ended. */
export async function noticeRequester(
    storage: Storage, approval: PendingApprovalRecord, outcome: 'approved' | 'declined' | 'expired', note?: string,
): Promise<void> {
    const facts = noticeFactsOf(approval);
    if (!facts) return;
    const space = facts.kind === 'space';
    const english: Record<typeof outcome, string> = space
        ? {
            approved: `Your suggested space "${facts.label}" was added to "${facts.wsName}"`,
            declined: `Your suggested space "${facts.label}" was not added to "${facts.wsName}"`,
            expired: `Your suggested space "${facts.label}" for "${facts.wsName}" expired before anyone decided`,
        }
        : {
            approved: `Your changes to the sections of "${facts.label}" in "${facts.wsName}" were made`,
            declined: `Your changes to the sections of "${facts.label}" in "${facts.wsName}" were not made`,
            expired: `Your changes to the sections of "${facts.label}" in "${facts.wsName}" expired before anyone decided`,
        };
    const key = `workspace_${space ? 'space' : 'sections'}_${outcome}`;
    await notify(storage, personOf(approval.actor), {
        type: key,
        title: english[outcome],
        body: note ?? '',
        link: '/v1/profile#organisms',
        i18n: { key, vars: { ws: facts.wsName, space: facts.label, note: note ?? '' } },
    });
    emitChange('notifications');
}
