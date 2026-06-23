// E2E Tests for Agent Capabilities in Chat (inbox Phase A commands + Phase B schedule)
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=chat-capabilities
//
// The inbox composer surfaces two agent capabilities. This suite locks the data contracts they rely on
// (the frontend that renders them is verified by driving the browser, Rule 1b):
//   Phase A — an agent self-describes fill-in chat commands under its PUBLIC `chat.commands` memory key;
//             anyone (no auth) can read it via GET /v1/memory/:gaii/:key, and a NON-public key is hidden.
//   Phase B — the human creates/lists a recurring agent_task on their OWN agent via the agent-scoped
//             scheduler routes (POST/GET /v1/agents/:name/schedules), which resolve under the caller's owner.

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
        if (res.status === 429 && attempt < retries) {
            await sleep(Number(res.headers.get('Retry-After') || '5') * 1000 + 500);
            continue;
        }
        return { status: res.status, body };
    }
    throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function getToken(ownerOrGaii: string, privKey: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = isAgent ? ownerOrGaii + timestamp : ownerOrGaii + NODE_ID + timestamp;
    const signature = await signMsg(privKey, message);
    const payload = isAgent ? { gaii: ownerOrGaii, timestamp, signature } : { owner: ownerOrGaii, timestamp, signature };
    const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

async function registerOwner(name: string): Promise<{ token: string; ghii: string; name: string }> {
    const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(status === 201, `register owner ${name}: ${status} ${JSON.stringify(body)}`);
    const token = await getToken(name, body.data.private_key, false);
    return { token, ghii: `${name}@${NODE_ID}`, name };
}

async function createAgent(ownerName: string, ownerToken: string, agentName: string, scopes: string[]): Promise<{ gaii: string; token: string; name: string }> {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'], scopes }),
    });
    assert(status === 201, `create agent ${agentName}: ${status} ${JSON.stringify(body)}`);
    return { gaii: body.data.agent.gaii, token: await getToken(body.data.agent.gaii, body.data.private_key, true), name: agentName };
}

// ─── State ───
const stamp = Date.now();
const ownerName = `capowner${stamp}`;
let owner = { token: '', ghii: '', name: '' };
let bot = { gaii: '', token: '', name: '' };

const COMMANDS = {
    v: 1,
    commands: [
        {
            id: 'search_web',
            label: 'Search the web',
            description: 'Find the best links and send them',
            template: 'Search the web for {{query}} and send me the top {{count}} links.',
            params: [
                { name: 'query', type: 'text', required: true, placeholder: 'e.g. AI agents' },
                { name: 'count', type: 'number', required: false, placeholder: '5', default: '5' },
            ],
        },
    ],
};

console.log('\n=== AIMEAT Agent Capabilities in Chat E2E ===\n');

console.log('Setup — owner + agent');
await test('Register owner + create agent (memory:write)', async () => {
    owner = await registerOwner(ownerName);
    bot = await createAgent(ownerName, owner.token, 'capbot', ['memory:write']);
    assert(bot.gaii.startsWith('capbot#'), `agent gaii: ${bot.gaii}`);
});

console.log('\nPhase A — chat commands via public memory');
await test('1. Agent publishes chat.commands as a PUBLIC memory key', async () => {
    const { status, body } = await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${bot.token}` },
        body: JSON.stringify({ key: 'chat.commands', value: COMMANDS, visibility: 'public' }),
    });
    assert(status === 201 || status === 200, `write chat.commands: ${status} ${JSON.stringify(body)}`);
});

await test('2. Anyone (no auth) reads the agent chat.commands via GET /v1/memory/:gaii/:key', async () => {
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(bot.gaii)}/${encodeURIComponent('chat.commands')}`);
    assert(status === 200, `public read: ${status} ${JSON.stringify(body)}`);
    const val = body.data?.value;
    assert(Array.isArray(val?.commands) && val.commands.length === 1, 'one command returned');
    assert(val.commands[0].id === 'search_web', `command id preserved, got ${val.commands[0]?.id}`);
    assert(val.commands[0].params[0].name === 'query', 'param shape preserved');
});

await test('3. A NON-public memory key is NOT exposed by the public read (404)', async () => {
    await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${bot.token}` },
        body: JSON.stringify({ key: 'chat.secret', value: { x: 1 }, visibility: 'private' }),
    });
    const { status } = await json(`/v1/memory/${encodeURIComponent(bot.gaii)}/${encodeURIComponent('chat.secret')}`);
    // The public read exposes only public keys; a non-public key is denied (403) or absent (404) — either
    // way it never returns the value to an unauthenticated reader.
    assert(status === 403 || status === 404, `private key must be hidden from the public read, got ${status}`);
});

console.log('\nPhase B — agent-scoped schedule (own agent)');
let scheduleId = '';
await test('4. Owner schedules a recurring agent_task on their own agent (201)', async () => {
    const { status, body } = await json(`/v1/agents/${encodeURIComponent(bot.name)}/schedules`, {
        method: 'POST', headers: { Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ kind: 'agent_task', cron: '0 9 * * *', task_title: 'Daily standup digest', display_name: 'Daily standup digest' }),
    });
    assert(status === 201, `create schedule: ${status} ${JSON.stringify(body)}`);
    scheduleId = body.data?.schedule?.id || body.data?.id || '';
    assert(!!scheduleId, `schedule id returned: ${JSON.stringify(body.data)}`);
});

await test('5. The schedule appears in the agent-scoped list', async () => {
    const { status, body } = await json(`/v1/agents/${encodeURIComponent(bot.name)}/schedules`, {
        headers: { Authorization: `Bearer ${owner.token}` },
    });
    assert(status === 200, `list: ${status}`);
    const managed = body.data?.managed || [];
    assert(managed.some((j: any) => j.id === scheduleId), 'created schedule is listed for the agent');
});

await test('6. agent_task without a task_title is rejected (400)', async () => {
    const { status } = await json(`/v1/agents/${encodeURIComponent(bot.name)}/schedules`, {
        method: 'POST', headers: { Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ kind: 'agent_task', cron: '0 9 * * *' }),
    });
    assert(status === 400, `expected 400 for missing task_title, got ${status}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
