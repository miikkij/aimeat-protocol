/**
 * @file src/services/home/waiting.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What waits for one person, across every place that holds something for them, in one
 *   answer. GET /v1/home/waiting and the MCP tool aimeat_home_waiting both call homeWaitingFor, so the
 *   Home page's first block and the person's own AI read the same list.
 *
 *   WHY ONE READ. Nine places each said "something waits for you" (agent proposals, agent sign-ins,
 *   message threads, help questions, teams, organism invitations, publish requests, workflow
 *   questions, open items) and none showed all of it; an AI needed five or more tool calls to learn it.
 *
 *   EACH SOURCE IS ONE ENTRY IN WAITING_SOURCES. It calls the service function the source's own route
 *   calls (no second query for what a service already answers), and says which permission word that
 *   route asks. A caller that does not hold the word does not read the source: the kind is named in
 *   `withheld`, never counted as zero. A source that throws does not fail the answer: its kind is
 *   named in `partial`. A kind is added later by adding one entry.
 *
 *   THE ANSWER. Items are grouped: `decide` (a yes or no), `answer` (someone waits for words), `look`
 *   (a count to open). Decide first, then answer, then look; newest first inside a group; capped at
 *   `limit`. `total` counts the decide and answer rows before the cap, `to_open` sums the look rows'
 *   counts, and `by_kind` has every kind before the cap. The two are apart because a count repeats
 *   things the other rows name: a proposal also makes an open item, and a thread that waits for an
 *   answer also holds unread messages. A row's `from`, `subject` and
 *   `detail` are data (names, previews), never sentences: the page words a row from its `kind`.
 *
 *   STATEMENTS. Each source is a fixed number of reads, except where its own service reads per item
 *   (help questions per routed question, workflow runs per active run, teams per team). Shown names of
 *   people are read after the cap, so they are bounded by `limit`, never by the number of items.
 * @structure WaitingKind · WaitingGroup · HomeWaitingItem · HomeWaitingAnswer · WaitingSource ·
 *   WAITING_SOURCES · homeWaitingFor(deps, caller, opts) · WAITING_LIMIT_DEFAULT · WAITING_LIMIT_MAX
 * @usage const answer = await homeWaitingFor({ storage, config }, callerOf(req, config.nodeId, storage), { limit: 20 });
 * @version-history
 *   v1.1.1 — 2026-11-26 — An approval row names no `act_with`: the tool it named reads the approval
 *     inbox and cannot resolve anything, and the answer's note tells an AI to act with the tool a row
 *     names.
 *   v1.1.0 — 2026-11-26 — Two kinds more, so the Settings overview draws this list and keeps none of
 *     its own: `approval` (the pending approvals of an organism the person can decide, per workspace,
 *     outside their teams) and `join_request` (a request to join an organism the person owns or
 *     administers). Both read services/organism-read/waiting.ts, which GET /v1/organisms/waiting calls.
 *   v1.0.0 — 2026-11-25 — Initial: ten kinds, one answer for the Home page and aimeat_home_waiting.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { CallerContext } from '../caller-context.js';
import { logger } from '../../utils/logger.js';
import { localAccountName, localAccountOf } from '../../utils/gaii.js';
import { HELP_ASK_SCOPE, HELP_ANSWER_SCOPE } from '../../utils/scope-coverage.js';
import { listProposals } from '../agent/proposals.js';
import { mailboxReaderOf, readOwnerConversations, readOwnerInbox } from '../owner/mailbox-reads.js';
import { listInbox } from '../help/questions.js';
import { teamWaitingFor } from '../team/waiting.js';
import { nameInvitationsOf } from '../organism-read/name-invitations.js';
import { approvalsToDecideFor, joinRequestsToReviewFor } from '../organism-read/waiting.js';
import { listPublishRequestsFor } from '../publish-requests/decide.js';
import { requesterName } from '../publish-requests/store.js';
import { pendingHumanInputs } from '../workflow/lifecycle.js';
import { HUMAN_TIMEOUT_MIN_DEFAULT } from '../workflow/engine-human.js';
import { openCount } from '../open-items.js';
import { displayNamesOf } from '../app/member-roster.js';
import { loadOwnerAgents } from '../db/owner-identity.js';

export type WaitingKind =
    | 'agent_proposal' | 'agent_sign_in' | 'reply' | 'help_question' | 'team'
    | 'invitation' | 'publish_request' | 'workflow_input' | 'open_item' | 'unread'
    | 'approval' | 'join_request';

/** decide: a yes or no · answer: someone waits for words · look: a count to open. */
export type WaitingGroup = 'decide' | 'answer' | 'look';

export interface WaitingAction { method: 'POST'; url: string }

export interface HomeWaitingItem {
    kind: WaitingKind;
    id: string;
    group: WaitingGroup;
    /** The shown name of who or what asks: an agent's shown name, a person's display name, a team's name. */
    from?: string;
    /** The thing itself: a proposal's name, a thread's subject or first words, an organism's name. */
    subject: string;
    /** One more line of data, at most DETAIL_MAX characters. */
    detail?: string;
    /** ISO time it began to wait. */
    at?: string;
    /** How many, on `look` rows, team rows and approval rows. */
    count?: number;
    /** The path on this node where a person opens it. */
    href: string;
    /** Present only when the yes and the no need nothing more than the press. */
    decide?: { approve: WaitingAction; decline: WaitingAction };
    /** The MCP tool an AI acts on it with. Absent when only the person decides it, on the page at `href`. */
    act_with?: string;
}

export interface HomeWaitingAnswer {
    /** What waits for a decision or an answer, before the cap: the rows of groups `decide` and `answer`, a team row and an approval row by its count. */
    total: number;
    /** The sum of the `look` rows' counts. Kept apart from `total`, because a count repeats things the other rows name. */
    to_open: number;
    /** Every kind read for this caller, zero included. A withheld or failed kind is not here. */
    by_kind: Partial<Record<WaitingKind, number>>;
    items: HomeWaitingItem[];
    /** Kinds whose source failed on this read. */
    partial?: WaitingKind[];
    /** Kinds this caller's permissions do not let it read; the person in person reads every kind. */
    withheld?: WaitingKind[];
    note: string;
}

/** A source's row; `fromAccount` names a person whose shown name is read after the cap. */
export type WaitingRow = HomeWaitingItem & { fromAccount?: string };

export interface WaitingDeps {
    storage: Storage;
    config: AimeatConfig;
    /** The app of an app grant (req.auth.app), which the publish requests read as the viewer's. */
    app?: string;
}

export interface WaitingSource {
    kind: WaitingKind;
    /** Whether this caller may read the source: the word the source's own route asks. */
    readable(caller: CallerContext, deps: WaitingDeps): boolean;
    read(deps: WaitingDeps, caller: CallerContext): Promise<WaitingRow[]>;
}

export const WAITING_LIMIT_DEFAULT = 20;
export const WAITING_LIMIT_MAX = 50;
const DETAIL_MAX = 200;
const SUBJECT_FROM_TEXT = 80;

const GROUP_RANK: Record<WaitingGroup, number> = { decide: 0, answer: 1, look: 2 };

/** One line of text, cut to `max` characters with a mark. */
function clip(text: unknown, max = DETAIL_MAX): string {
    const s = String(text ?? '').replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** `detail` when there is something to say, absent otherwise. */
const detailOf = (text: unknown) => {
    const d = clip(text);
    return d ? { detail: d } : {};
};

/** A workflow title is a string or { en, fi, … }; the data as written, English first. */
function titleText(title: unknown): string {
    if (typeof title === 'string') return title;
    if (title && typeof title === 'object') {
        const t = title as Record<string, unknown>;
        const first = t.en ?? Object.values(t).find(v => typeof v === 'string');
        return typeof first === 'string' ? first : '';
    }
    return '';
}

/** An agent's short name from its GAII (`name#owner@node`), or null for a person. */
function agentNameOf(principal: string): string | null {
    const hash = principal.indexOf('#');
    return hash > 0 ? principal.slice(0, hash) : null;
}

const isPersonOrAgent = (c: CallerContext) => c.kind === 'owner' || c.kind === 'agent';

// ── The sources. Each calls the function its own route calls. ──────────────────────────────────

/** GET /v1/agents/v2/agent-proposals: memory:read, the account holder and their own agents. */
const agentProposals: WaitingSource = {
    kind: 'agent_proposal',
    readable: c => isPersonOrAgent(c) && c.has('memory:read'),
    async read(deps, caller) {
        const open = (await listProposals(deps, caller.owner)).filter(p => p.state === 'proposed');
        if (!open.length) return [];
        // The proposing agent's shown name, as the Agents page shows it: one read of the owner's agents.
        const byAgent = open.some(p => agentNameOf(p.proposed_by));
        const agents = byAgent ? await loadOwnerAgents(deps.storage, caller.owner) : [];
        const shown = new Map(agents.map(a => [a.name, a.displayName?.trim() || a.name]));
        return open.map(p => {
            const agent = agentNameOf(p.proposed_by);
            const base = `/v1/agents/v2/agent-proposals/${encodeURIComponent(p.id)}`;
            return {
                kind: 'agent_proposal' as const, id: p.id, group: 'decide' as const,
                ...(agent ? { from: shown.get(agent) ?? agent } : { fromAccount: p.proposed_by }),
                subject: p.display_name || p.name,
                ...detailOf(p.purpose),
                at: p.proposed_at,
                href: `/v1/home?new-agent=1&proposal=${encodeURIComponent(p.id)}`,
                // Approving is the person's own press (requireOwnerPrincipal); no tool approves it.
                decide: { approve: { method: 'POST' as const, url: `${base}/approve` }, decline: { method: 'POST' as const, url: `${base}/decline` } },
            };
        });
    },
};

/**
 * Pending device authorizations: the live "an agent is knocking" row of GET /v1/home/feed, which a
 * reader with memory:read sees. The user code is not given out: the person approves on the Agents
 * page, where they also choose what the agent may do.
 */
const agentSignIns: WaitingSource = {
    kind: 'agent_sign_in',
    readable: c => c.has('memory:read'),
    async read(deps, caller) {
        const pending = await deps.storage.listPendingDeviceAuthByOwner(caller.owner);
        return pending.map(r => ({
            kind: 'agent_sign_in' as const, id: r.agentName, group: 'decide' as const,
            subject: r.displayName || r.agentName,
            ...detailOf(r.description),
            at: r.createdAt,
            href: '/v1/profile?tab=agents',
        }));
    },
};

/** GET /v1/messages/conversations?waiting=true: threads whose last message came in, outside the agents' mailboxes. */
const replies: WaitingSource = {
    kind: 'reply',
    readable: (c, deps) => !!mailboxReaderOf(c.auth, deps.config.nodeId),
    async read(deps, caller) {
        const reader = mailboxReaderOf(caller.auth, deps.config.nodeId)!;
        const { conversations } = await readOwnerConversations(deps.storage, reader);
        return conversations.filter(c => c.lastDirection === 'inbound' && !c.viaAgent).map(c => ({
            kind: 'reply' as const, id: c.conversationId, group: 'answer' as const,
            ...(c.groupAlias ? { from: c.groupAlias } : { fromAccount: c.peerGhii }),
            subject: clip(c.subject, DETAIL_MAX) || clip(c.lastMessage, SUBJECT_FROM_TEXT),
            ...detailOf(c.lastMessage),
            at: c.updatedAt,
            href: '/v1/profile?tab=messages',
            act_with: 'aimeat_dm_send_as_owner',
        }));
    },
};

/** GET /v1/help/inbox: the questions asked of this person that wait for them (`my_outcome` pending). */
const helpQuestions: WaitingSource = {
    kind: 'help_question',
    readable: c => c.has(HELP_ANSWER_SCOPE) || c.has(HELP_ASK_SCOPE),
    async read(deps, caller) {
        const got = await listInbox(deps, caller);
        // Switched off on this node, or for members only and the person is in no organism: nothing waits.
        if (!got.ok) return [];
        type Asked = { question_id: string; conversation_id: string; subject: string; question: string; asker: string; asker_name?: string; my_outcome: string; state: string; routed_at: string };
        return (got.data.asked_of_me as Asked[]).filter(q => q.my_outcome === 'pending' && q.state === 'open').map(q => ({
            kind: 'help_question' as const, id: q.question_id, group: 'answer' as const,
            ...(q.asker_name ? { from: q.asker_name } : { fromAccount: q.asker }),
            subject: clip(q.subject, DETAIL_MAX),
            ...detailOf(q.question),
            at: q.routed_at,
            href: `/v1/profile#inbox/${encodeURIComponent(q.conversation_id)}`,
            act_with: 'aimeat_help_respond',
        }));
    },
};

/** GET /v1/teams/waiting (organism:read): one row per team, with how many of its records and approvals wait. */
const teams: WaitingSource = {
    kind: 'team',
    readable: c => c.has('organism:read'),
    async read(deps, caller) {
        const { items, approvals } = await teamWaitingFor(deps, caller);
        const rows = new Map<string, WaitingRow>();
        const add = (organismId: string, team: string, href: string) => {
            const row = rows.get(organismId);
            if (row) { row.count = (row.count ?? 0) + 1; return; }
            rows.set(organismId, {
                kind: 'team', id: organismId, group: 'answer', from: team, subject: team, count: 1, href,
                act_with: 'aimeat_team_waiting',
            });
        };
        const at = (org: string, ws: string) => `/v1/profile?tab=organisms&org=${encodeURIComponent(org)}&ws=${encodeURIComponent(ws)}`;
        for (const i of items) add(i.organism_id, i.team, at(i.organism_id, i.workspace));
        for (const a of approvals) add(a.organism_id, a.team, a.decide_url);
        return [...rows.values()];
    },
};

/** GET /v1/organisms/invitations/mine (organism:read): invitations into an organism, accepted or declined with one press. */
const invitations: WaitingSource = {
    kind: 'invitation',
    readable: c => isPersonOrAgent(c) && c.has('organism:read'),
    async read(deps, caller) {
        const invited = await nameInvitationsOf(deps.storage, { owner: caller.owner });
        return invited.map(({ membership: m, organism: o }) => {
            const base = `/v1/organisms/${encodeURIComponent(o.id)}/invitations`;
            return {
                kind: 'invitation' as const, id: o.id, group: 'decide' as const,
                ...(m.invitedBy ? { fromAccount: m.invitedBy } : {}),
                subject: o.name,
                ...detailOf(o.description),
                at: m.joinedAt,
                href: '/v1/profile?tab=organisms',
                // Accepting is the person's own press (an agent is refused); declining an agent may do.
                decide: { approve: { method: 'POST' as const, url: `${base}/accept` }, decline: { method: 'POST' as const, url: `${base}/decline` } },
                act_with: 'aimeat_organism_invitation_respond',
            };
        });
    },
};

const organismHref = (org: string, ws?: string) =>
    `/v1/profile?tab=organisms&org=${encodeURIComponent(org)}${ws ? `&ws=${encodeURIComponent(ws)}` : ''}`;

/**
 * The read of GET /v1/organisms/waiting (organism:read), kept to what this person can decide: the
 * pending approvals of an organism, one row per workspace with how many. A team's approvals are in
 * its `team` row. No `decide`: the deciding route takes the decision in its body. No `act_with`
 * either: a person resolves an approval, never an agent (aimeat_organism_approvals only reads the
 * inbox), so the row is the person's own decision on the page at its `href`.
 */
const approvals: WaitingSource = {
    kind: 'approval',
    readable: c => isPersonOrAgent(c) && c.has('organism:read'),
    async read(deps, caller) {
        const rows = await approvalsToDecideFor(deps, { owner: caller.owner, principal: caller.principal });
        return rows.map(r => ({
            kind: 'approval' as const, id: `${r.orgId}/${r.wsId}`, group: 'decide' as const,
            from: r.orgName,
            subject: r.wsName || r.orgName,
            count: r.n,
            ...(r.at ? { at: r.at } : {}),
            href: organismHref(r.orgId, r.wsId),
        }));
    },
};

/**
 * The same read's join requests (organism:read): one row per person who asks to join an organism
 * this person owns or administers. No `decide`: the review route takes the decision in its body.
 */
const joinRequests: WaitingSource = {
    kind: 'join_request',
    readable: c => isPersonOrAgent(c) && c.has('organism:read'),
    async read(deps, caller) {
        const managed = await joinRequestsToReviewFor(deps, { owner: caller.owner, principal: caller.principal });
        return managed.flatMap(({ organism, requests }) => requests.map(r => ({
            kind: 'join_request' as const, id: r.id, group: 'decide' as const,
            fromAccount: r.ghii,
            subject: organism.name,
            ...detailOf(r.message),
            at: r.createdAt,
            href: organismHref(organism.id),
            act_with: 'aimeat_organism_join_request_review',
        })));
    },
};

/**
 * GET /v1/publish-requests (memory:write): the requests waiting for the owner's answer. No `decide`:
 * the decision route takes the decision in its body, so a bare POST is not a press.
 */
const publishRequests: WaitingSource = {
    kind: 'publish_request',
    readable: c => c.has('memory:write'),
    async read(deps, caller) {
        const out = await listPublishRequestsFor(deps, { caller, ...(deps.app ? { app: deps.app } : {}) });
        if (!out.ok) return [];
        return out.requests.filter(r => r.state === 'awaiting_owner').map(r => ({
            kind: 'publish_request' as const, id: r.id, group: 'decide' as const,
            from: requesterName({ principal: r.requested_by.principal, kind: r.requested_by.kind, sub: '' }),
            subject: r.name || r.title,
            detail: clip(r.kind),
            at: r.created_at,
            href: '/v1/profile?tab=notifications',
            act_with: 'aimeat_publish_requests',
        }));
    },
};

/** GET /v1/workflows/pending-inputs (workflow:read): workflow steps waiting for the person's answer. */
const workflowInputs: WaitingSource = {
    kind: 'workflow_input',
    readable: c => c.has('workflow:read'),
    async read(deps, caller) {
        const pending = await pendingHumanInputs(deps.storage, deps.config.nodeId, caller.ownerGhii, HUMAN_TIMEOUT_MIN_DEFAULT);
        return pending.map(p => {
            const q = (p.question ?? {}) as { prompt?: unknown };
            return {
                kind: 'workflow_input' as const, id: `${p.workflowId}/${p.runId}/${p.stepId}`, group: 'answer' as const,
                subject: clip(titleText(p.workflowTitle), DETAIL_MAX) || p.workflowId,
                ...detailOf(q.prompt),
                at: p.askedAt,
                href: '/v1/profile?tab=workflows',
                act_with: 'aimeat_workflow_answer',
            };
        });
    },
};

/** GET /v1/open-items/count (the account holder): one row with the number the top bar shows. */
const openItems: WaitingSource = {
    kind: 'open_item',
    readable: c => c.inPerson,
    async read(deps, caller) {
        const count = await openCount(deps.storage, deps.config, caller.ownerGhii, caller.owner);
        return count > 0 ? [{ kind: 'open_item', id: 'open_items', group: 'look', subject: '', count, href: '/v1/profile' }] : [];
    },
};

/** GET /v1/messages/inbox?per_page=1: one row with the unread message count. */
const unread: WaitingSource = {
    kind: 'unread',
    readable: (c, deps) => !!mailboxReaderOf(c.auth, deps.config.nodeId),
    async read(deps, caller) {
        const reader = mailboxReaderOf(caller.auth, deps.config.nodeId)!;
        const { unread: count } = await readOwnerInbox(deps.storage, reader, { page: 1, perPage: 1 });
        return count > 0 ? [{
            kind: 'unread', id: 'unread', group: 'look', subject: '', count, href: '/v1/profile?tab=messages',
            act_with: 'aimeat_dm_inbox_as_owner',
        }] : [];
    },
};

/** Every source, in the order the kinds are listed in `by_kind`. */
export const WAITING_SOURCES: readonly WaitingSource[] = [
    agentProposals, agentSignIns, invitations, publishRequests, approvals, joinRequests,
    replies, helpQuestions, workflowInputs, teams,
    openItems, unread,
];

const NOTE = 'Everything that waits for the person you act for, in one read. '
    + 'Group decide is a yes or no, answer is someone waiting for words, look is a count to open. '
    + 'total counts the decide and answer items; to_open sums the look counts, which can repeat those items. '
    + 'Act on an item with the MCP tool its act_with names; an item without act_with is decided by the person on the page at its href. '
    + 'withheld names kinds your permissions do not let you read; partial names kinds that could not be read this time.';

/** Newer first; a row without a time after the rows with one. */
function byGroupThenNewest(a: HomeWaitingItem, b: HomeWaitingItem): number {
    const g = GROUP_RANK[a.group] - GROUP_RANK[b.group];
    if (g) return g;
    return (b.at ?? '').localeCompare(a.at ?? '');
}

/** The shown names of the people the kept rows name: one read per distinct local account, at most `limit`. */
async function withShownNames(storage: Storage, rows: WaitingRow[]): Promise<HomeWaitingItem[]> {
    const accounts = [...new Set(rows.filter(r => !r.from && r.fromAccount).map(r => localAccountOf(r.fromAccount!)).filter((a): a is string => !!a))];
    const names = accounts.length ? await displayNamesOf(storage, accounts).catch((err: Error) => {
        logger.warn('home-waiting: shown names could not be read', { error: err.message });
        return new Map<string, string | null>();
    }) : new Map<string, string | null>();
    return rows.map(({ fromAccount, ...row }) => {
        if (row.from || !fromAccount) return row;
        const local = localAccountOf(fromAccount);
        return { ...row, from: (local && names.get(local)) || localAccountName(fromAccount) };
    });
}

/**
 * What waits for the caller's person. The caller is the owner in person, or something acting in their
 * name (an agent, an app grant), which reads the kinds its permissions cover. A visitor from another
 * node has no account here and is refused by the route and the tool before this is called.
 */
export async function homeWaitingFor(
    deps: WaitingDeps,
    caller: CallerContext,
    opts: { limit?: number; sources?: readonly WaitingSource[] } = {},
): Promise<HomeWaitingAnswer> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? WAITING_LIMIT_DEFAULT) || WAITING_LIMIT_DEFAULT, 1), WAITING_LIMIT_MAX);
    const sources = opts.sources ?? WAITING_SOURCES;
    const withheld: WaitingKind[] = [];
    const partial: WaitingKind[] = [];
    const failures: unknown[] = [];
    const by_kind: Partial<Record<WaitingKind, number>> = {};
    const readable = sources.filter(s => {
        if (s.readable(caller, deps)) return true;
        withheld.push(s.kind);
        return false;
    });
    const results = await Promise.all(readable.map(s => s.read(deps, caller).then(
        rows => ({ kind: s.kind, rows }),
        (err: unknown) => {
            logger.warn('home-waiting: a source could not be read', { kind: s.kind, owner: caller.owner, error: err instanceof Error ? err.message : String(err) });
            partial.push(s.kind);
            failures.push(err);
            return null;
        },
    )));
    // When every kind this caller may read failed, there is no answer to give: an answer of zero
    // items would say "nothing waits" about an account nobody could read. The first failure goes to
    // the caller, so the route answers an error and the MCP tool flags it.
    if (readable.length > 0 && failures.length === readable.length) throw failures[0];
    const all: WaitingRow[] = [];
    for (const r of results) {
        if (!r) continue;
        by_kind[r.kind] = (by_kind[r.kind] ?? 0) + r.rows.reduce((n, row) => n + (row.count ?? 1), 0);
        all.push(...r.rows);
    }
    // A count row repeats things the other rows already name (an open item made for a proposal, an
    // unread message in a thread that waits for an answer), so it is counted apart: `total` is what
    // needs a yes, a no or words, and `to_open` is the sum of the counts.
    const weight = (row: WaitingRow) => row.count ?? 1;
    const total = all.filter(r => r.group !== 'look').reduce((n, r) => n + weight(r), 0);
    const to_open = all.filter(r => r.group === 'look').reduce((n, r) => n + weight(r), 0);
    const kept = all.sort(byGroupThenNewest).slice(0, limit);
    const items = await withShownNames(deps.storage, kept);
    return {
        total, to_open, by_kind, items,
        ...(partial.length ? { partial } : {}),
        ...(withheld.length ? { withheld } : {}),
        note: NOTE,
    };
}
