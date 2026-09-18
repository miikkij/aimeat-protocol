/**
 * @file scripts/cold-agent/tasks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tasks a cold agent is given, and how each one is judged.
 *
 *   A task is what a PERSON would say, in their words: no tool name, no key, no route. That is
 *   the point of the measurement. The instruction review of 2026-09-18 judged forty sources of
 *   agent-facing text by reading them, which finds what is false and says nothing about where an
 *   agent actually stumbles. Here the agent gets the node and a sentence, and the node is asked
 *   afterwards whether the thing happened.
 *
 *   JUDGING. `verify` asks the NODE, through REST as the owner, never the agent's own account of
 *   what it did: an agent that says "saved" and saved nothing is the failure this exists to see.
 *   Where the outcome is an answer rather than a record, the final text is checked for the fact
 *   it must contain. `goodTools` names the tools a well-guided run reaches for; a run that gets
 *   there through others still passes, and the report shows the detour.
 *
 *   MARKERS. Every task carries a string that occurs nowhere else on the node, so a verifier
 *   finds this run's result and not an earlier run's.
 * @structure Door · TaskContext · Task · TASKS · api()
 * @usage
 *   import { TASKS } from './tasks.js';
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial: ten tasks across memory, apps, skills, joining, asking the
 *     operators, orientation and a missing record.
 */
import type { RunMetrics } from './transcript.js';

/** `mcp`: the agent is connected over MCP as the owner's agent. `url`: it gets the address only. */
export type Door = 'mcp' | 'url';

export interface TaskContext {
    baseUrl: string;
    ownerName: string;
    ownerToken: string;
    agentToken: string;
    /** Unique to this run of this task. */
    marker: string;
    metrics: RunMetrics;
}

export interface Task {
    id: string;
    door: Door;
    /** What the person says. `{marker}` and `{baseUrl}` are filled in. */
    prompt: string;
    goodTools: string[];
    /** Runs before the agent starts, for a task that needs something to exist first. */
    setup?: (ctx: Omit<TaskContext, 'metrics'>) => Promise<void>;
    verify: (ctx: TaskContext) => Promise<{ ok: boolean; detail: string }>;
}

export async function api<T = Record<string, unknown>>(baseUrl: string, path: string, token: string | null, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: T | null }> {
    const res = await fetch(baseUrl + path, {
        method: init.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    try { return { status: res.status, data: (JSON.parse(text) as { data?: T }).data ?? null }; } catch { return { status: res.status, data: null }; }
}

/** Every record the owner can see, their agents' included, as one searchable string per record. */
async function ownerRecords(ctx: TaskContext): Promise<string[]> {
    const r = await api<{ items: unknown[] }>(ctx.baseUrl, '/v1/memory?owner_scope=true&limit=500', ctx.ownerToken);
    return (r.data?.items ?? []).map(i => JSON.stringify(i));
}

const says = (ctx: TaskContext, ...needles: string[]) => needles.every(n => ctx.metrics.finalText.toLowerCase().includes(n.toLowerCase()));

export const TASKS: Task[] = [
    {
        id: 'remember',
        door: 'mcp',
        prompt: 'Remember this for me: the boiler was serviced by {marker} on 3 September, and the next service is due in a year.',
        goodTools: ['aimeat_memory_write'],
        verify: async (ctx) => {
            const hit = (await ownerRecords(ctx)).find(r => r.includes(ctx.marker));
            return { ok: !!hit, detail: hit ? 'a record carries the fact' : 'no record on the node carries the fact' };
        },
    },
    {
        id: 'recall',
        door: 'mcp',
        prompt: 'Who has my spare key? I told you a while ago.',
        goodTools: ['aimeat_memory_search', 'aimeat_memory_list', 'aimeat_memory_read'],
        setup: async (ctx) => {
            await api(ctx.baseUrl, '/v1/memory', ctx.agentToken, { method: 'POST', body: { key: 'home.spare-key', value: { note: `The spare key is with ${ctx.marker} at number 12.` }, visibility: 'private' } });
        },
        verify: async (ctx) => ({ ok: says(ctx, ctx.marker), detail: says(ctx, ctx.marker) ? 'the answer names the holder' : 'the answer does not name the holder' }),
    },
    {
        id: 'share-to-workspace',
        door: 'mcp',
        prompt: 'Write down our house rules as a short document and share it with my family in a workspace called "{marker}". Make the workspace if it does not exist yet. The rules: shoes off at the door, quiet after ten, whoever cooks does not wash up.',
        goodTools: ['aimeat_organism_create', 'aimeat_workspace_create', 'aimeat_workspace_write', 'aimeat_workspace_publish'],
        verify: async (ctx) => {
            const orgs = await api<{ organisms: { id: string }[] }>(ctx.baseUrl, '/v1/organisms', ctx.ownerToken);
            for (const o of orgs.data?.organisms ?? []) {
                const ws = await api(ctx.baseUrl, `/v1/organisms/${o.id}/workspaces`, ctx.ownerToken);
                if (JSON.stringify(ws.data ?? '').includes(ctx.marker)) return { ok: true, detail: `workspace found in organism ${o.id}` };
            }
            return { ok: false, detail: 'no workspace by that name in any of the owner\'s organisms' };
        },
    },
    {
        id: 'build-app',
        door: 'mcp',
        prompt: 'Build me a small tip calculator and put it on my AIMEAT so I can open it on my phone. Call it "{marker}".',
        goodTools: ['aimeat_skill_get', 'aimeat_app_publish'],
        verify: async (ctx) => {
            const r = await api<{ apps: unknown[] }>(ctx.baseUrl, `/v1/apps?owner=${ctx.ownerName}`, ctx.ownerToken);
            const hit = (r.data?.apps ?? []).find(a => JSON.stringify(a).includes(ctx.marker));
            return { ok: !!hit, detail: hit ? 'the app is published' : 'no published app carries the name' };
        },
    },
    {
        id: 'what-apps',
        door: 'mcp',
        prompt: 'Which apps do I have here, and how do I open them?',
        goodTools: ['aimeat_app_list'],
        verify: async (ctx) => {
            const ok = says(ctx, 'Sandbox hello', 'Sandbox notes') && /https?:\/\//.test(ctx.metrics.finalText);
            return { ok, detail: ok ? 'both apps named, with an address' : 'an app or the address is missing from the answer' };
        },
    },
    {
        id: 'find-a-guide',
        door: 'mcp',
        prompt: 'I want to make a little platform game for my kid. Is there anything here that tells you how to build one properly?',
        goodTools: ['aimeat_skill_list', 'aimeat_skill_get'],
        verify: async (ctx) => {
            const loaded = ctx.metrics.toolCalls.some(c => c.name === 'aimeat_skill_get' && /phaser|game/i.test(JSON.stringify(c.input)));
            return { ok: loaded, detail: loaded ? 'a game skill was loaded' : 'no game skill was loaded' };
        },
    },
    {
        id: 'tell-the-operators',
        door: 'mcp',
        prompt: 'The page where I change my password just shows a blank screen ({marker}). Can you let the people who run this know?',
        goodTools: ['aimeat_dm_send'],
        verify: async (ctx) => {
            const sent = ctx.metrics.toolCalls.some(c => !c.isError && /support@operators/.test(JSON.stringify(c.input)) && JSON.stringify(c.input).includes(ctx.marker));
            return { ok: sent, detail: sent ? 'a message went to support@operators' : 'nothing was sent to support@operators' };
        },
    },
    {
        id: 'what-can-you-do',
        door: 'mcp',
        prompt: 'I just connected you to this. What can you actually do for me here?',
        goodTools: ['aimeat_handbook_get', 'aimeat_discover'],
        verify: async (ctx) => {
            const ok = says(ctx, 'remember') || says(ctx, 'memory');
            const plain = !/aimeat_[a-z_]+/.test(ctx.metrics.finalText);
            return { ok: ok && plain, detail: !ok ? 'the answer never mentions remembering things' : plain ? 'answered in the person\'s words' : 'the answer recites tool names at the person' };
        },
    },
    {
        id: 'missing-record',
        door: 'mcp',
        prompt: 'Read me what I saved about the {marker} warranty.',
        goodTools: ['aimeat_memory_search'],
        verify: async (ctx) => {
            const honest = /(no|not|nothing|couldn't|could not|can't find|cannot find|don't see)/i.test(ctx.metrics.finalText);
            const calm = ctx.metrics.toolCalls.length <= 6;
            return { ok: honest && calm, detail: !honest ? 'the answer does not say the record is missing' : calm ? 'said so, without thrashing' : `said so after ${ctx.metrics.toolCalls.length} calls` };
        },
    },
    {
        id: 'join-as-agent',
        door: 'url',
        prompt: 'This is my AIMEAT: {baseUrl} and my username there is {ownerName}. Connect yourself to it as my agent, under the name "{marker}". Tell me if you need me to approve something; I am at the screen.',
        goodTools: [],
        verify: async (ctx) => {
            const r = await api<{ agents: { name: string }[] }>(ctx.baseUrl, '/v1/agents', ctx.ownerToken);
            const hit = (r.data?.agents ?? []).some(a => a.name === ctx.marker);
            return { ok: hit, detail: hit ? 'the agent exists under the owner' : 'no such agent under the owner' };
        },
    },
];
