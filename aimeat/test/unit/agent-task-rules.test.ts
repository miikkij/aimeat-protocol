/**
 * @file test/unit/agent-task-rules.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The start decision as a table: the floor, the plan's declared effects, the task's word,
 *   the agent's setting and the mode, in that order; who may loosen it and who may lift a wait; the
 *   per-transition wake id; and the basic agents a brand-new place gets.
 * @usage pnpm test -- agent-task-rules
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { describe, expect, it } from 'vitest';
import {
    decideTaskStart, agentStartDefault, floorScopesOf, mayLoosenStart, mayStartWaitingTask,
    statusAfterProposal, taskWakeId, autoStartEvent, startedOnItsOwn, type StartCaller,
} from '../../src/services/agent-task-rules.js';
import { BASIC_AGENTS } from '../../src/data/basic-agents.js';

const A = 'worker#alice@n';
const pending = (effects?: string[]) => ({ status: 'pending' as const, ...(effects ? { effects } : {}) });

describe('the start decision', () => {
    it('nobody has said: task-runner starts, every other mode waits', () => {
        expect(agentStartDefault({ mode: 'task-runner' })).toBe('automatic');
        expect(agentStartDefault({ mode: 'interactive' })).toBe('confirm');
        expect(agentStartDefault({ mode: 'interactive', taskStart: 'automatic' })).toBe('automatic');
        expect(agentStartDefault({ mode: 'task-runner', taskStart: 'confirm' })).toBe('confirm');
    });

    it('the task\'s own word beats the agent\'s', () => {
        expect(decideTaskStart({ mode: 'interactive', taskStart: 'automatic' }, { policy: 'confirm' }))
            .toMatchObject({ startsNow: false, waitsBecause: 'setting' });
        expect(decideTaskStart({ mode: 'interactive' }, { policy: 'automatic' })).toMatchObject({ startsNow: true, waitsBecause: null });
    });

    it('a declared effect holds the task whatever the setting; an outdated todo declares nothing', () => {
        const d = decideTaskStart({ mode: 'task-runner' }, { todos: [pending(), pending(['spend'])] });
        expect(d).toMatchObject({ startsNow: false, waitsBecause: 'effects', effects: ['spend'] });
        expect(decideTaskStart({ mode: 'task-runner' }, { todos: [{ status: 'outdated', effects: ['delete'] }] }).startsNow).toBe(true);
    });

    it('a named floor permission holds every task, a domain wildcard too, the global * does not', () => {
        expect(decideTaskStart({ mode: 'task-runner', defaultScopes: ['commerce:buy'] }, { policy: 'automatic' }))
            .toMatchObject({ startsNow: false, waitsBecause: 'floor', floorScopes: ['commerce:buy'] });
        // delete-as-owner is one of the words only an exact grant confers (utils/scope-coverage.ts),
        // so `messages:*` does not carry it and the floor does not count it either.
        expect(floorScopesOf({ defaultScopes: ['messages:*'] })).toEqual(['messages:send-as-owner']);
        expect(floorScopesOf({ defaultScopes: ['*'] })).toEqual([]);
        expect(floorScopesOf({ defaultScopes: ['memory:read', 'memory:write', 'memory:delete', 'task:write'] })).toEqual([]);
    });
});

describe('who may loosen it, and who may lift a wait', () => {
    const owner: StartCaller = { ownerInPerson: true, app: false, principal: 'alice@n', scopes: [] };
    const chat: StartCaller = { ownerInPerson: false, app: false, principal: 'chat#alice@n', scopes: ['task:write', 'agent:write'] };
    const self: StartCaller = { ...chat, principal: A };
    const taskOnly: StartCaller = { ...chat, scopes: ['task:write'] };

    it('loosen: the owner, or another agent with agent:write, never the agent itself', () => {
        expect(mayLoosenStart(owner, A)).toBe(true);
        expect(mayLoosenStart(chat, A)).toBe(true);
        expect(mayLoosenStart(self, A)).toBe(false);
        expect(mayLoosenStart(taskOnly, A)).toBe(false);
    });

    it('lift: the owner always; another agent only a wait the setting made', () => {
        expect(mayStartWaitingTask(owner, A, { waitsBecause: 'floor' })).toBe(true);
        expect(mayStartWaitingTask(chat, A, { waitsBecause: 'setting' })).toBe(true);
        expect(mayStartWaitingTask(chat, A, { waitsBecause: 'floor' })).toBe(false);
        expect(mayStartWaitingTask(chat, A, { waitsBecause: 'effects' })).toBe(false);
        expect(mayStartWaitingTask(self, A, { waitsBecause: 'setting' })).toBe(false);
    });
});

describe('what a plan does to the status', () => {
    const get = (agent: object) => async () => agent as never;

    it('a task given before the owner switched the agent follows the new answer', async () => {
        expect(await statusAfterProposal(get({ mode: 'interactive', taskStart: 'automatic' }), { status: 'queued', agentGaii: A }, [pending()]))
            .toMatchObject({ nextStatus: 'active', autoActivated: true });
    });

    it('queued + automatic goes on; queued + confirm waits and the owner is told', async () => {
        expect(await statusAfterProposal(get({ mode: 'interactive' }), { status: 'queued', agentGaii: A, startPolicy: 'automatic' }, [pending()]))
            .toMatchObject({ nextStatus: 'active', autoActivated: true, waits: false });
        expect(await statusAfterProposal(get({ mode: 'task-runner' }), { status: 'queued', agentGaii: A, startPolicy: 'confirm' }, [pending()]))
            .toMatchObject({ nextStatus: 'queued', waits: true });
    });

    it('a task the node started goes back to wait when the plan declares an effect; a node-made task never does', async () => {
        expect(await statusAfterProposal(get({ mode: 'task-runner' }), { status: 'active', agentGaii: A }, [pending(['delete'])], true))
            .toMatchObject({ nextStatus: 'queued', heldBack: true, waits: true });
        expect(await statusAfterProposal(get({ mode: 'task-runner' }), { status: 'active', agentGaii: A }, [pending(['delete'])], false))
            .toMatchObject({ nextStatus: 'active', heldBack: false });
    });

    it('a revision always returns to the owner', async () => {
        expect(await statusAfterProposal(get({ mode: 'task-runner' }), { status: 'revision_requested', agentGaii: A, startPolicy: 'automatic' }, [pending()]))
            .toMatchObject({ nextStatus: 'queued', waits: true });
    });
});

describe('the marker on a task the node started', () => {
    it('names whose word it was and marks the event; other started events are not marked', () => {
        expect(autoStartEvent({ source: 'mode' }).message).toMatch(/agent mode: task-runner/);
        expect(startedOnItsOwn([{ type: 'started', details: autoStartEvent({ source: 'agent' }).details }])).toBe(true);
        expect(startedOnItsOwn([{ type: 'started', details: {} }, { type: 'progress' }])).toBe(false);
    });
});

describe('the wake and the defaults', () => {
    it('every runnable push has its own delivery id, naming the task', () => {
        const a = taskWakeId('t1', 'queued', '2026-10-02T10:00:00.000Z');
        const b = taskWakeId('t1', 'active', '2026-10-02T10:00:05.000Z');
        expect(a).not.toBe(b);
        expect(a.startsWith('t1:') && b.startsWith('t1:')).toBe(true);
    });

    it('a brand-new place\'s basic agents start their tasks on their own, and nothing holds them', () => {
        for (const t of BASIC_AGENTS) {
            expect(t.taskStart).toBe('automatic');
            expect(decideTaskStart({ mode: t.mode, taskStart: t.taskStart, defaultScopes: t.scopes }).startsNow).toBe(true);
        }
        const concierge = BASIC_AGENTS.find(t => t.name === 'concierge')!;
        expect(concierge.crewDef.listen_for).toContain('tasks');
    });
});
