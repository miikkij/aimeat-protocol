/**
 * @file src/services/task-start-notice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a person learns that a task waits for them, in words: the answer a create call
 *   gives (so the person's AI can say it in the same turn) and the notification the owner gets when
 *   the agent's plan is in and the task waits for their OK.
 *
 *   WHY BOTH. Measured on freshly sold hosted places on 2026-10-01: the concierge proposed its plan
 *   and stopped, the task sat in `queued` for good, and nothing anywhere told a new customer that it
 *   was waiting for them. The Tasks view had a Start button that nobody who had never opened the
 *   Tasks view would find. The chat is where the task was given, so the chat hears first; the
 *   notification (the bell and a web push, with a Start button that runs with the owner's own
 *   session) is for the moment the plan arrives and the person has gone.
 * @structure startAnswer() · waitReason() · notifyTaskWaiting()
 * @usage
 *   res.json(success(nodeId, { task, start: startAnswer(decision, task.status) }));
 *   void notifyTaskWaiting(storage, task, decision);
 * @version-history
 *   v1.1.0 — 2026-10-02 — The reason for an agent held by `*` alone names the narrowing.
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import type { Storage, AgentTaskRecord } from '../storage/interface.js';
import type { TaskStartDecision } from './agent-task-rules.js';
import { TASK_START_FLOOR } from './agent-task-rules.js';
import { notify } from './notify.js';
import { logger } from '../utils/logger.js';

/** What the floor and the declared effects mean, as a person would say it. */
const KIND_WORDS: Record<string, string> = {
    spend: 'spend money',
    send_as_owner: 'send mail or messages as you',
    delete: 'delete things as you',
};

function kindsOf(decision: Pick<TaskStartDecision, 'waitsBecause' | 'floorScopes' | 'effects'>): string[] {
    const kinds = decision.waitsBecause === 'floor'
        ? TASK_START_FLOOR.filter(f => decision.floorScopes.includes(f.scope)).map(f => f.kind)
        : decision.effects;
    return [...new Set(kinds)].map(k => KIND_WORDS[k] ?? k);
}

function joinWords(words: string[]): string {
    return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** One sentence saying why this task waits, or that it does not. */
export function waitReason(agentName: string, decision: Pick<TaskStartDecision, 'waitsBecause' | 'floorScopes' | 'effects'>): string {
    switch (decision.waitsBecause) {
        // `*` alone: the agent may do anything. The way out is the narrowing, so the sentence names it.
        case 'floor': return decision.floorScopes.includes('*') && kindsOf(decision).length === 0
            ? `${agentName} may do anything, including spend money and send or delete things as you, so its tasks wait for your OK until you narrow it to what it uses.`
            : `${agentName} can ${joinWords(kindsOf(decision))}, so its tasks always wait for your OK.`;
        case 'effects': return `The plan says it will ${joinWords(kindsOf(decision))}, so it waits for your OK.`;
        case 'setting': return 'It waits for your OK before it starts.';
        default: return 'It starts on its own. You see the plan, the progress and the result in Tasks.';
    }
}

export interface StartAnswer {
    policy: TaskStartDecision['policy'];
    /** `now`: it is running; `after_your_ok`: it waits for the owner; `draft`: nobody sees it yet. */
    starts: 'now' | 'after_your_ok' | 'draft';
    waits_because: TaskStartDecision['waitsBecause'];
    reason: string;
    /** Who may lift the wait: anyone the owner trusts to (their AI included), or the owner in person. */
    who_can_start: 'owner_or_their_ai' | 'owner_in_person' | null;
}

/** The start part of a create answer. The person's AI reads `reason` to them as it is. */
export function startAnswer(agentName: string, decision: TaskStartDecision, status: AgentTaskRecord['status']): StartAnswer {
    if (status === 'draft') {
        return { policy: decision.policy, starts: 'draft', waits_because: decision.waitsBecause, who_can_start: null,
            reason: 'It is a draft. The agent sees it when you release it.' };
    }
    const starts = status === 'active' ? 'now' : 'after_your_ok';
    const held = decision.waitsBecause === 'floor' || decision.waitsBecause === 'effects';
    return {
        policy: decision.policy,
        starts,
        waits_because: starts === 'now' ? null : decision.waitsBecause,
        reason: starts === 'now' ? waitReason(agentName, { ...decision, waitsBecause: null }) : waitReason(agentName, decision),
        who_can_start: starts === 'now' ? null : held ? 'owner_in_person' : 'owner_or_their_ai',
    };
}

/**
 * Tell the owner that a task has a plan and waits for their OK. Best-effort: a notification that
 * fails must not fail the proposal that triggered it.
 */
export async function notifyTaskWaiting(
    storage: Storage,
    task: Pick<AgentTaskRecord, 'id' | 'title' | 'agentGaii' | 'ownerGaii' | 'todos'>,
    decision: Pick<TaskStartDecision, 'waitsBecause' | 'floorScopes' | 'effects'> | null,
): Promise<void> {
    try {
        const agentName = task.agentGaii.split('#')[0];
        const agent = await storage.getAgent(task.agentGaii);
        const who = agent?.displayName || agentName;
        const steps = (task.todos ?? []).filter(t => t.status !== 'outdated').length;
        const reason = waitReason(who, decision ?? { waitsBecause: 'setting', floorScopes: [], effects: [] });
        const held = decision?.waitsBecause === 'floor' || decision?.waitsBecause === 'effects';
        const link = `/v1/profile?tab=agents&task=${encodeURIComponent(task.id)}`;
        await notify(storage, task.ownerGaii, {
            type: 'task_waiting',
            title: `${who} waits for your OK: ${task.title}`.slice(0, 200),
            body: `${reason} The plan has ${steps} steps.`,
            link,
            // The node's own notice, not the agent's: muting an agent's chatter must not also hide
            // the one question the owner owes an answer to.
            // Two texts, because the page translates the sentence and the reason is a sentence of its
            // own: one for a wait the setting made, one for a wait only the owner in person can lift.
            i18n: { key: held ? 'task_waiting_held' : 'task_waiting', vars: { agent: who, title: task.title, steps } },
            actions: [
                {
                    id: 'start', label: 'Start', kind: 'api', method: 'POST',
                    endpoint: `/v1/agents/${encodeURIComponent(agentName)}/tasks/${encodeURIComponent(task.id)}/start`,
                    style: 'primary', confirm: held, i18n: { key: 'task_waiting.start' },
                },
                { id: 'open', label: 'Open', kind: 'navigate', link, i18n: { key: 'task_waiting.open' } },
            ],
        });
    } catch (err) {
        logger.warn('task-start: could not tell the owner a task waits for them', { taskId: task.id, error: String(err) });
    }
}
