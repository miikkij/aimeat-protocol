/**
 * @file test/e2e-verb-parity-unified.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The writing verbs of one path admit the same callers, where Jouni ruled that the
 *   looser side decides (codebase analysis 2026-11-03, decision 13a of 2026-11-05). Before, each of
 *   these paths admitted the owner's agent on one verb and refused it on the other:
 *     - PATCH /v1/contacts/:id           owner only    -> as DELETE: the owner's agent holding messages:send
 *     - PATCH /v1/groups/:id/members/:m  owner only    -> as DELETE: the owner's agent holding consent:groups
 *     - DELETE /v1/agents/:n/tasks/:id   owner only    -> as PATCH: the task's own agent
 *   (PATCH and DELETE /v1/agents/v2/connectors/:id are proved in e2e-agent-connectors.ts, which opens
 *   the tunnels a connector needs.)
 *
 *   Each case has the use that works now and the refusals that stay: an agent without the word,
 *   another owner, and for tasks another agent of the same owner.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=verb-parity-unified
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 13a of 2026-11-05).
 */

import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, type McpAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

/** One REST call with a bearer token; retries a 429, which is not what this suite tests. */
async function rest(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (res.status === 429 && attempt < 6) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        const text = await res.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
        return { status: res.status, body: parsed };
    }
}

const short = (v: unknown): string => String(JSON.stringify(v)).slice(0, 300);
const stamp = Date.now().toString(36).slice(-6);

console.log('\n=== One path, one set of callers: the looser verb decides (decision 13a) ===\n');

let alice: RegisteredOwner;
let bob: RegisteredOwner;
/** Holds the words the three paths name. */
let worker: McpAgent;
/** Holds none of them. */
let bare: McpAgent;

await test('Phase 1: the operator, alice with two agents, bob', async () => {
    await registerOwner(BASE, `opvp${stamp}`);
    alice = await registerOwner(BASE, `alvp${stamp}`);
    bob = await registerOwner(BASE, `bovp${stamp}`);
    worker = await makeAgent(BASE, alice, ['memory:read', 'messages:send', 'contacts:read', 'consent:groups', 'task:read'], `wk${stamp}`);
    bare = await makeAgent(BASE, alice, ['memory:read'], `br${stamp}`);
    assert(worker.token && bare.token && worker.gaii.endsWith(`#${alice.ghii}`), `alice's agents: ${worker.gaii}`);
});

// ── Phase 2: a contact's card ─────────────────────────────────────────────────────────────────────
let personId = '';
const cardOf = async (): Promise<any> => {
    const r = await rest('GET', '/v1/contacts', alice.token);
    assert(r.status === 200, `alice's book: ${r.status} ${short(r.body.error)}`);
    return (r.body.data.contacts as any[]).find((c) => c.contact_id === personId);
};

await test('2a. the owner\'s agent holding messages:send edits a card in the owner\'s book, as it may remove one', async () => {
    const made = await rest('POST', '/v1/contacts', alice.token, { name: 'Carol Card', email: `carol-${stamp}@example.com` });
    assert(made.status === 201, `create ${made.status} ${short(made.body.error)}`);
    personId = made.body.data.contact_id;
    const r = await rest('PATCH', `/v1/contacts/${encodeURIComponent(personId)}`, worker.token, { note: 'met at the fair', relation: 'colleague' });
    assert(r.status === 200, `PATCH by the agent: ${r.status} ${short(r.body.error)}`);
    const card = await cardOf();
    assert(card?.note === 'met at the fair' && card?.relation === 'colleague', `the card in alice's book: ${short(card)}`);
});

await test('2b. an agent without messages:send and another owner are refused, and the card is unchanged', async () => {
    const asBare = await rest('PATCH', `/v1/contacts/${encodeURIComponent(personId)}`, bare.token, { note: 'by the bare agent' });
    assert(asBare.status === 403, `an agent without the word: expected 403, got ${asBare.status}`);
    const asBob = await rest('PATCH', `/v1/contacts/${encodeURIComponent(personId)}`, bob.token, { note: 'mine now' });
    assert(asBob.status === 404, `another owner: expected 404, got ${asBob.status}`);
    const card = await cardOf();
    assert(card?.note === 'met at the fair', `the card is unchanged: ${short(card)}`);
});

// ── Phase 3: a group member's permissions ─────────────────────────────────────────────────────────
let groupId = '';
let bobGroupId = '';
const memberPath = (group: string) => `/v1/groups/${group}/members/${encodeURIComponent(bob.ghii)}`;
const bobsPermissions = async (): Promise<any> => {
    const r = await rest('GET', `/v1/groups/${groupId}`, alice.token);
    assert(r.status === 200, `the group: ${r.status} ${short(r.body.error)}`);
    return (r.body.data.group.members as any[]).find((m) => m.identifier === bob.ghii)?.permissions;
};

await test('3a. the owner\'s agent holding consent:groups changes a member\'s permissions, as it may remove the member', async () => {
    const made = await rest('POST', '/v1/groups', alice.token, {
        name: `Readers ${stamp}`, members: [{ identifier: bob.ghii, identifier_type: 'ghii', permissions: { read: true, write: false } }],
    });
    assert(made.status === 201, `create ${made.status} ${short(made.body.error)}`);
    groupId = made.body.data.group.id;
    const r = await rest('PATCH', memberPath(groupId), worker.token, { permissions: { read: true, write: true } });
    assert(r.status === 200, `PATCH by the agent: ${r.status} ${short(r.body.error)}`);
    const perms = await bobsPermissions();
    assert(perms?.read === true && perms?.write === true, `bob's permissions in alice's group: ${short(perms)}`);
});

await test('3b. an agent without consent:groups is refused, and another owner\'s group is not the agent\'s to change', async () => {
    const asBare = await rest('PATCH', memberPath(groupId), bare.token, { permissions: { read: false, write: false } });
    assert(asBare.status === 403, `an agent without the word: expected 403, got ${asBare.status}`);
    const bobs = await rest('POST', '/v1/groups', bob.token, {
        name: `Bob's ${stamp}`, members: [{ identifier: bob.ghii, identifier_type: 'ghii', permissions: { read: true, write: false } }],
    });
    assert(bobs.status === 201, `bob's group ${bobs.status} ${short(bobs.body.error)}`);
    bobGroupId = bobs.body.data.group.id;
    const cross = await rest('PATCH', memberPath(bobGroupId), worker.token, { permissions: { read: true, write: true } });
    assert(cross.status === 403, `another owner's group: expected 403, got ${cross.status}`);
    const perms = await bobsPermissions();
    assert(perms?.write === true, `alice's group is unchanged by the refused call: ${short(perms)}`);
});

// ── Phase 4: a task's own agent deletes it ────────────────────────────────────────────────────────
const newTask = async (agent: McpAgent, title: string): Promise<string> => {
    const r = await rest('POST', `/v1/agents/${agent.name}/tasks`, alice.token, {
        title, description: 'A task its agent may remove', status: 'queued',
        todos: [{ id: 't-1', order: 1, title: 'Step', environment: 'agent', verification: 'done' }],
    });
    assert(r.status === 201, `task ${r.status} ${short(r.body.error)}`);
    return r.body.data.task.id as string;
};

await test('4a. the task\'s own agent deletes a task that is not active, as it may update it', async () => {
    const id = await newTask(worker, 'Removable by its agent');
    const r = await rest('DELETE', `/v1/agents/${worker.name}/tasks/${id}`, worker.token);
    assert(r.status === 200 && r.body.data?.deleted === true, `DELETE by the agent: ${r.status} ${short(r.body.error ?? r.body.data)}`);
    const gone = await rest('GET', `/v1/agents/${worker.name}/tasks/${id}`, alice.token);
    assert(gone.status === 404, `the task is gone: ${gone.status}`);
});

await test('4b. another agent of the same owner and another owner cannot delete it, and the owner still can', async () => {
    const id = await newTask(worker, 'Not theirs to remove');
    const asSibling = await rest('DELETE', `/v1/agents/${worker.name}/tasks/${id}`, bare.token);
    assert(asSibling.status === 403, `another agent of alice: expected 403, got ${asSibling.status}`);
    const asBob = await rest('DELETE', `/v1/agents/${worker.name}/tasks/${id}`, bob.token);
    assert(asBob.status === 403, `another owner: expected 403, got ${asBob.status}`);
    const still = await rest('GET', `/v1/agents/${worker.name}/tasks/${id}`, alice.token);
    assert(still.status === 200, `the task is still there: ${still.status}`);
    const byOwner = await rest('DELETE', `/v1/agents/${worker.name}/tasks/${id}`, alice.token);
    assert(byOwner.status === 200, `the owner deletes it: ${byOwner.status} ${short(byOwner.body.error)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
