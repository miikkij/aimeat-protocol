/**
 * @file src/services/agent-task-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The task decisions that are the same decision whichever route or tool the call came
 *   through: whether a task starts on its own, may a plan be proposed now, and what accepting a plan
 *   does to the status.
 *
 *   Both were written out twice for a while — once in the HTTP handler and once in the MCP tool
 *   beside it — and both got there the same way: the tool was missing the rule, and the quickest
 *   repair is to paste the rule in. The copies agree today. They agree until somebody edits one.
 *
 *   THE START DECISION. A task either starts AUTOMATICALLY (the agent proposes its plan and goes on;
 *   the owner sees what was done) or WAITS FOR THE OWNER'S OK. Until 2026-10-02 the only thing that
 *   decided it was `mode === 'task-runner'`, and `mode` also picks the Hello Integration flow, so the
 *   concierge (an `interactive` front door) could not start a task without becoming something else.
 *   Measured on freshly sold hosted places: every task a customer gave it sat in `queued` for good,
 *   because nobody tells a new customer to press Start. The answer now has its own field:
 *
 *     1. THE SAFETY FLOOR. An agent that can spend money, send mail as the owner, or speak or delete
 *        as the owner never starts a task by itself. Read from its permissions, live, on every call.
 *     2. THE PLAN'S OWN WORD. A proposed todo that declares a guarded effect holds the task too.
 *     3. The task's `startPolicy`, the creator's own word when the task was given ("check with me
 *        first", "just do it"). Absent on a task given without one.
 *     4. The agent's `taskStart`, the owner's standing answer, read when the decision is made, so a
 *        task given before the owner changed it follows the new answer when its plan arrives.
 *     5. Nobody has said: `task-runner` starts, every other mode waits. Every agent that existed
 *        before the field behaves exactly as it did.
 *
 *   THE LIVE-PLAN GUARD protects work already done. The preserve step on a re-proposal keeps only
 *   todos already marked 'outdated', so proposing a second plan mid-run drops every in-progress and
 *   completed todo, their completedAt stamps included — the plan the owner approved and the record
 *   of what was finished, both gone. Mid-execution changes go through PATCH instead.
 * @structure
 *   - TASK_START_FLOOR / floorScopesOf() — the permissions that always hold a task for the owner
 *   - agentStartDefault() — the agent's own answer, or the mode-derived one
 *   - decideTaskStart() — does this task start now, and if not, why
 *   - mayLoosenStart() / mayStartWaitingTask() — who may set `automatic`, who may lift a wait
 *   - resolveAutoActivation() — the create-time status, from decideTaskStart
 *   - autoStartEvent() / startedOnItsOwn() — the marked 'started' event of a task the node started
 *   - canProposeTodos() — may a plan be proposed on this task right now
 *   - statusAfterProposal() — what accepting a plan does to the status
 *   - taskWakeId() — the delivery id of one "this task is runnable" push
 * @usage
 *   const d = decideTaskStart(agent, { policy: task.startPolicy, todos });
 *   if (!canProposeTodos(task)) return refuse(TODO_PROPOSE_REFUSAL(task.status));
 * @version-history
 *   v2.1.0 — 2026-10-02 — Rulings B and C: `memory:purge` (deleting shared records for good) is on the
 *     floor, and `*` counts once the agent's usage record is ready (services/scope-use.ts).
 *   v2.0.0 — 2026-10-02 — The start decision leaves `mode`: the agent's `taskStart`, the task's
 *     `startPolicy`, the permission floor and the plan's declared effects. `taskWakeId()`: the tunnel
 *     skipped a second `task_assigned` that reused the task id as its delivery id, so Start on a
 *     proposed task did not wake the agent (found on hosted places, ~90 s to the spawner's re-list).
 *   v1.0.0 — 2026-08-11 — Extracted after the audit's own diff was checked for duplication and both
 *     rules were found copied into the tool surface rather than shared.
 */
import type { AgentTaskRecord, AgentRecord, AgentTaskTodo } from '../storage/interface.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';

/** Starts on its own, or waits for the owner's OK. */
export type TaskStartPolicy = 'automatic' | 'confirm';
export const TASK_START_POLICIES: readonly TaskStartPolicy[] = ['automatic', 'confirm'];

/** What a todo may declare it does that the owner must see before it happens. */
export type TaskEffect = 'spend' | 'send_as_owner' | 'delete';
export const TASK_EFFECTS: readonly TaskEffect[] = ['spend', 'send_as_owner', 'delete'];

/**
 * THE SAFETY FLOOR: an agent holding any of these permissions never starts a task by itself,
 * whatever its own setting or the task's says.
 *
 * Written in permissions because a permission is the one thing the node knows for certain about
 * what an agent can do. A task is free text, and a check that reads intent from it is a guess.
 *
 * NOT HERE, ON PURPOSE:
 *   - `memory:delete`. Every agent holds it by default (AIMEAT_DEFAULT_AGENT_SCOPES), and a deleted
 *     memory entry can be restored for a grace window. Deleting shared workspace records FOR GOOD took
 *     its own word on 2026-10-02, `memory:purge`, and that one is on the floor.
 *   - `work:request`. It calls capabilities under contracts the owner already accepted, metered
 *     against the owner's own budget. Starting a new paid relationship takes `exchange:write`.
 */
export const TASK_START_FLOOR: ReadonlyArray<{ scope: string; kind: TaskEffect }> = [
    { scope: 'commerce:buy', kind: 'spend' },
    { scope: 'exchange:write', kind: 'spend' },
    { scope: 'connections:use', kind: 'send_as_owner' },
    { scope: 'outbound:send', kind: 'send_as_owner' },
    { scope: 'messages:send-as-owner', kind: 'send_as_owner' },
    { scope: 'messages:delete-as-owner', kind: 'delete' },
    // Deleting shared workspace records for good (ruling B, 2026-10-02).
    { scope: 'memory:purge', kind: 'delete' },
];

/**
 * The agent as the start rules read it. `wildcardReady` is filled by services/scope-use.ts
 * withWildcardFacts(): the agent holds `*` and its usage record is old enough to offer a narrowing.
 */
type StartAgent = Pick<AgentRecord, 'mode'> & Partial<Pick<AgentRecord, 'taskStart' | 'defaultScopes'>> & { wildcardReady?: boolean };

/**
 * The floor permissions this agent's record grants BY NAME: the word itself or its domain wildcard
 * (`commerce:*`). The record is the ceiling a token is narrowed to (auth/effective-scopes.ts).
 *
 * THE GLOBAL `*` COUNTS, BUT NOT BY SURPRISE (ruling C, Jouni 2026-10-02): "all permissions" must
 * never read as "nothing dangerous". It counts once the agent's usage record is ready
 * (`wildcardReady`, services/scope-use.ts): OBSERVE_DAYS of record naming at least one permission, so
 * the owner is offered, with one press, the named permissions it actually used. Until then a `*` agent
 * starts as it did. On aimeat.io on 2026-10-02, 52 of the 53 task-runners of the busiest account held
 * `*`, and the node had no record of what any of them used. `*` itself is reported as `'*'`.
 */
export function floorScopesOf(agent: (Partial<Pick<AgentRecord, 'defaultScopes'>> & { wildcardReady?: boolean }) | null | undefined): string[] {
    const held = agent?.defaultScopes ?? [];
    const named = held.filter(s => s !== '*');
    const floor = TASK_START_FLOOR.filter(f => scopeIsCovered(named, f.scope)).map(f => f.scope);
    return held.includes('*') && agent?.wildcardReady ? ['*', ...floor] : floor;
}

/** The agent's own answer, or, when nobody has said, the one its mode always gave. */
export function agentStartDefault(agent: StartAgent | null | undefined): TaskStartPolicy {
    if (agent?.taskStart === 'automatic' || agent?.taskStart === 'confirm') return agent.taskStart;
    return agent?.mode === 'task-runner' ? 'automatic' : 'confirm';
}

/** The guarded effects the live plan declares. Outdated todos are history and declare nothing. */
export function declaredEffects(todos: ReadonlyArray<Pick<AgentTaskTodo, 'status'> & { effects?: string[] }> | undefined): TaskEffect[] {
    const out = new Set<TaskEffect>();
    for (const t of todos ?? []) {
        if (t.status === 'outdated') continue;
        for (const e of t.effects ?? []) if ((TASK_EFFECTS as readonly string[]).includes(e)) out.add(e as TaskEffect);
    }
    return [...out];
}

export interface TaskStartDecision {
    /** What the setting says: the task's own word, else the agent's. */
    policy: TaskStartPolicy;
    /** Whose word `policy` is: the task's, the agent's setting, or the mode when nobody has said. */
    source: 'task' | 'agent' | 'mode';
    startsNow: boolean;
    /**
     * Why it waits, when it waits. `setting`: the owner asked to confirm. `floor`: the agent can spend,
     * send or delete as the owner. `effects`: the plan says it will. Only `setting` may be lifted by
     * another of the owner's agents; the other two wait for the owner in person.
     */
    waitsBecause: null | 'setting' | 'floor' | 'effects';
    floorScopes: string[];
    effects: TaskEffect[];
}

/** Does this task start now, and if not, why. Precedence: floor, effects, task, agent, mode. */
export function decideTaskStart(
    agent: StartAgent | null | undefined,
    opts: { policy?: TaskStartPolicy | null; todos?: ReadonlyArray<Pick<AgentTaskTodo, 'status'> & { effects?: string[] }> } = {},
): TaskStartDecision {
    const fromTask = opts.policy === 'automatic' || opts.policy === 'confirm';
    const policy = fromTask ? opts.policy as TaskStartPolicy : agentStartDefault(agent);
    const source = fromTask ? 'task' : (agent?.taskStart === 'automatic' || agent?.taskStart === 'confirm') ? 'agent' : 'mode';
    const floorScopes = floorScopesOf(agent);
    const effects = declaredEffects(opts.todos);
    const waitsBecause = floorScopes.length > 0 ? 'floor'
        : effects.length > 0 ? 'effects'
        : policy === 'confirm' ? 'setting'
        : null;
    return { policy, source, startsNow: waitsBecause === null, waitsBecause, floorScopes, effects };
}

/** A wait the owner in person has to lift: the floor or a declared effect, never the setting. */
export function isHeldForOwner(d: Pick<TaskStartDecision, 'waitsBecause'>): boolean {
    return d.waitsBecause === 'floor' || d.waitsBecause === 'effects';
}

/** Who is asking, as far as the start rules care. Built by the route or tool from its session. */
export interface StartCaller {
    /** The account holder in person (auth/effective-scopes.ts isOwnerInPerson). */
    ownerInPerson: boolean;
    /** A same-owner app grant that already passed its own task:write check. */
    app: boolean;
    /** The caller's principal (GAII for an agent). */
    principal: string;
    /** Every scope the caller holds, already narrowed to its record. */
    scopes: readonly string[];
}

/**
 * May this caller loosen how an agent's work starts: set the agent's `taskStart`, or give a task
 * `start: 'automatic'`? The owner in person, an app they granted task:write, or another of their
 * agents holding `agent:write` (the word that can change the agent anyway, so this widens nothing).
 * Never the agent itself: an agent does not loosen its own leash.
 */
export function mayLoosenStart(caller: StartCaller, targetGaii: string): boolean {
    if (caller.ownerInPerson || caller.app) return true;
    return caller.principal !== targetGaii && scopeIsCovered(caller.scopes, 'agent:write');
}

/**
 * May this caller start a task that waits? The owner in person and their app: always. Another of
 * the owner's agents holding task:write (the person's own chat AI, acting on their word): only a
 * task that waits because of the setting. Never the task's own agent, and never a task the floor
 * or a declared effect holds; those wait for the owner in person.
 */
export function mayStartWaitingTask(caller: StartCaller, targetGaii: string, decision: Pick<TaskStartDecision, 'waitsBecause'>): boolean {
    if (caller.ownerInPerson || caller.app) return true;
    if (caller.principal === targetGaii || !scopeIsCovered(caller.scopes, 'task:write')) return false;
    return !isHeldForOwner(decision);
}

/**
 * The create-time status: a queued task whose decision says start becomes active. `draft` is the
 * owner's "let me look first" and never moves on its own.
 */
export function resolveAutoActivation(
    decision: Pick<TaskStartDecision, 'startsNow'>,
    requestedStatus: AgentTaskRecord['status'] | undefined,
): { autoActivated: boolean; effectiveStatus: AgentTaskRecord['status'] } {
    const status = requestedStatus ?? 'queued';
    const autoActivated = status === 'queued' && decision.startsNow;
    return { autoActivated, effectiveStatus: autoActivated ? 'active' : status };
}

/**
 * The 'started' event a task gets when the node starts it on its own: a message naming whose word
 * it was, and a detail that marks it. The marker is what lets a plan that declares an effect send
 * the task back to wait (statusAfterProposal): a task the owner started, or one the node makes for
 * itself (the onboarding smoke test, a workflow step), carries no marker and is never sent back.
 */
export function autoStartEvent(decision: Pick<TaskStartDecision, 'source'>, when = ''): { message: string; details: Record<string, unknown> } {
    const why = decision.source === 'mode' ? 'agent mode: task-runner'
        : decision.source === 'task' ? 'this task was given to start on its own'
        : 'the agent starts its tasks automatically';
    return { message: `Task started on its own${when} (${why})`, details: { started_by: AUTO_START_MARK, source: decision.source } };
}
export const AUTO_START_MARK = 'start-setting';

/** Did the node start this task on its own? Read from the task's own 'started' events. */
export function startedOnItsOwn(events: ReadonlyArray<{ type: string; details?: Record<string, unknown> }>): boolean {
    return events.some(e => e.type === 'started' && e.details?.started_by === AUTO_START_MARK);
}

/**
 * The delivery id of one "this task is runnable now" push.
 *
 * NOT THE TASK ID. The connector tunnel remembers every delivery id the agent acknowledged and skips
 * a later delivery with the same id (services/connect-tunnel.ts, onDelivery). The create push used
 * the task id, so the Start push that followed it carried an id the agent had already acknowledged
 * and was dropped: the agent woke on its runtime's own re-list about 90 s later. The connector reads
 * the task id from the payload, never from the frame id, so a per-transition id changes nothing else.
 */
export function taskWakeId(taskId: string, status: string, at: string): string {
    return `${taskId}:${status}:${at}`;
}

/**
 * May a TODO plan be proposed on this task right now?
 *
 * Queued and revision_requested always; an ACTIVE task only while it has no live plan. A todo that
 * is not already 'outdated' is a live plan.
 */
export function canProposeTodos(task: Pick<AgentTaskRecord, 'status' | 'todos'>): boolean {
    const hasLivePlan = (task.todos ?? []).some(t => t.status !== 'outdated');
    return task.status === 'queued'
        || task.status === 'revision_requested'
        || (task.status === 'active' && !hasLivePlan);
}

/** The refusal every route and tool gives, so the wording does not drift either. */
export function todoProposeRefusal(status: string): string {
    return `TODOs can only be proposed on queued, revision_requested, or plan-less active tasks (current: ${status})`;
}

/**
 * What a plan proposal does to the status.
 *
 *   - revision_requested -> queued. The owner asked to review this plan, so it waits for them again.
 *   - queued -> active when the start decision says so (the agent proposes and goes on).
 *   - active, plan-less, started on its own -> queued when the floor or the plan's declared effects
 *     hold it (`heldBack`). A task the node started automatically has had nobody's OK, and the plan
 *     is the first moment the node can see that it will spend, send or delete as the owner.
 *     Only a task whose 'started' event carries the marker (autoStartEvent) can be held back: one
 *     the owner started, the onboarding smoke test and a workflow step are never sent back.
 *
 * `waits` is true whenever the result is a task waiting for the owner with a plan in hand, which is
 * the moment the owner is told.
 */
export async function statusAfterProposal(
    getAgent: (gaii: string) => Promise<StartAgent | null | undefined>,
    task: Pick<AgentTaskRecord, 'status' | 'agentGaii' | 'startPolicy'>,
    newTodos: ReadonlyArray<Pick<AgentTaskTodo, 'status'> & { effects?: string[] }>,
    autoStarted = false,
): Promise<{ nextStatus: AgentTaskRecord['status']; autoActivated: boolean; heldBack: boolean; waits: boolean; decision: TaskStartDecision | null }> {
    if (task.status === 'revision_requested') {
        return { nextStatus: 'queued', autoActivated: false, heldBack: false, waits: true, decision: null };
    }
    if (task.status === 'queued') {
        const decision = decideTaskStart(await getAgent(task.agentGaii), { policy: task.startPolicy, todos: newTodos });
        return decision.startsNow
            ? { nextStatus: 'active', autoActivated: true, heldBack: false, waits: false, decision }
            : { nextStatus: 'queued', autoActivated: false, heldBack: false, waits: true, decision };
    }
    if (task.status === 'active' && autoStarted) {
        const decision = decideTaskStart(await getAgent(task.agentGaii), { policy: task.startPolicy, todos: newTodos });
        if (isHeldForOwner(decision)) {
            return { nextStatus: 'queued', autoActivated: false, heldBack: true, waits: true, decision };
        }
        return { nextStatus: 'active', autoActivated: false, heldBack: false, waits: false, decision };
    }
    return { nextStatus: task.status, autoActivated: false, heldBack: false, waits: false, decision: null };
}
