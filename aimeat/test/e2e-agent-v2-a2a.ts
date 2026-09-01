/**
 * @file test/e2e-agent-v2-a2a.ts
 * @description Agent v2 V6a and V6c: one of this node's agents, answering A2A, and the same agent
 *   as an OASF record.
 *
 *   THE SUITE SPEAKS JSON-RPC, not our REST. Every call here is a real `POST /v1/a2a/:owner/:agent`
 *   with `{"jsonrpc":"2.0","method":…}`, because the whole point of V6a is that a client which knows
 *   nothing about AIMEAT can talk to these agents. Reading the projection through our own doors
 *   would prove the mapping and not the protocol.
 *
 *   IT IS A PROJECTION AND THAT IS ASSERTED BOTH WAYS. Work created over A2A appears in the V5
 *   roster; work created over REST is readable over A2A; a task cancelled over A2A reads cancelled
 *   over REST. If the two ever became separate stores, half of these would still pass, which is why
 *   the crossings are the tests rather than the round trips.
 *
 *   THE SCOPE GATE IS THE REASON THIS FILE IS NAMED IN A SECURITY EXEMPTION. One HTTP door and a
 *   dozen methods behind it means the scope is checked per method, in the handler, and a claim like
 *   that has to be measured: a deliberately scope-limited agent tries every mutating method and is
 *   refused by each one.
 *
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-v2-a2a
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial, with the feature.
 */
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const owner = `v6${label}${Date.now().toString(36)}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'AgentV6Pass12345' }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'AgentV6Pass12345' }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    return { owner, ownerToken: tok.body.data.token as string, ghii: `${owner}@${NODE_ID}` };
}

async function addAgent(owner: string, ownerToken: string, name: string, scopes: string[] = ['*'], extra: Record<string, unknown> = {}) {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name, owner, capabilities: [], mode: 'interactive', scopes, ...extra }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(ag.body.data.private_key, gaii + ts) }),
    });
    return { name, gaii, token: tok.body.data.token as string };
}

let rpcId = 0;

/**
 * One JSON-RPC call at an agent's A2A door, exactly as an A2A 1.0 client would make it: the version
 * header, and the 1.0 method names (`SendMessage`, `GetTask`). A request with no header is read as
 * 0.3 by the SDK, which is the compat path and is exercised separately below.
 */
async function rpc(owner: string, agentName: string, token: string, method: string, params: unknown, version = '1.0') {
    const res = await fetch(`${BASE}/v1/a2a/${encodeURIComponent(owner)}/${encodeURIComponent(agentName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'A2A-Version': version, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text }; }
    return { status: res.status, body, result: body?.result, error: body?.error };
}

async function run(): Promise<void> {
    console.log('\n🧪 Agent v2 V6a — this node\'s agents, answering A2A\n');

    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const authA = { Authorization: `Bearer ${a.ownerToken}` };

    const worker = await addAgent(a.owner, a.ownerToken, 'a2a-worker', ['*'], {
        display_name: 'A2A Worker', description: 'Handles work sent over A2A.',
    });
    const caller = await addAgent(a.owner, a.ownerToken, 'a2a-caller');
    // Deliberately narrow: enough to authenticate and read, nothing that writes.
    const reader = await addAgent(a.owner, a.ownerToken, 'a2a-reader', ['memory:read']);
    const outsider = await addAgent(b.owner, b.ownerToken, 'a2a-outsider');

    let taskId = '';
    let contextId = '';

    // ── 1. Discovery ──────────────────────────────────────────────────────────

    await test('the agent card is public, and says what this door does and does not do', async () => {
        const r = await json(`/v1/a2a/${a.owner}/${worker.name}/agent-card.json`);
        assert(r.status === 200, `expected 200 with no credential, got ${r.status}`);
        const card = r.body;
        assert(card.name === 'A2A Worker', `the card is the agent, got ${card.name}`);
        assert(card.description.includes('A2A'), 'with the description the owner gave it');
        // Two interfaces at one address: A2A 1.0, and the 0.3 nearly every client speaks today.
        // The SDK's compat layer decides which shape a request is by its version header.
        assert(Array.isArray(card.supportedInterfaces) && card.supportedInterfaces.length === 2,
            `1.0 and 0.3 at the same address, got ${card.supportedInterfaces?.length}`);
        const versions = (card.supportedInterfaces as any[]).map(i => i.protocolVersion).sort();
        assert(versions.join(',') === '0.3,1.0', `expected both versions, got ${versions.join(',')}`);
        assert(String(card.supportedInterfaces[0].url).endsWith(`/v1/a2a/${a.owner}/${worker.name}`),
            `pointing at the JSON-RPC door, got ${card.supportedInterfaces[0].url}`);
        // The card and the refusal have to agree: streaming is declared off and the method throws.
        assert(card.capabilities.streaming === false, 'streaming is declared off');
        assert(card.capabilities.pushNotifications === true, 'and push notifications on');
        assert(!!card.securitySchemes?.bearer, 'and it says a bearer is needed before a client tries');
        assert(Array.isArray(card.skills) && card.skills.length >= 1, 'a card with no skills is invisible to a client');
    });

    await test('there is no card for an agent nobody created', async () => {
        const r = await json(`/v1/a2a/${a.owner}/nobody/agent-card.json`);
        assert(r.status === 404, `expected 404, got ${r.status}`);
    });

    // ── 2. The work road ──────────────────────────────────────────────────────

    await test('message/send with no task creates one, and it comes back as an A2A Task', async () => {
        const r = await rpc(a.owner, worker.name, caller.token, 'SendMessage', {
            message: {
                messageId: 'client-msg-1',
                role: 'ROLE_USER',
                parts: [{ text: 'Summarise the attached note.' }],
            },
        });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
        assert(!r.error, `expected no error, got ${JSON.stringify(r.error)}`);
        // A2A 1.0 wraps the answer: `{task}` when the server made work of it, `{message}` when it
        // answered in words. This node always makes work of it, and the wrapper is how a client
        // tells which it got.
        const task = r.result?.task;
        assert(typeof task?.id === 'string', `a Task with an id, got ${JSON.stringify(r.result).slice(0, 200)}`);
        taskId = task.id;
        contextId = task.contextId;
        // Nobody has picked it up, which is the state A2A has and MCP does not.
        assert(task.status.state === 'TASK_STATE_SUBMITTED', `expected submitted, got ${task.status.state}`);
        assert(Array.isArray(task.history) && task.history.length === 1,
            `the message itself is filed against the task, got ${task.history?.length}`);
    });

    await test('the same work is in the V5 roster: one store, two doors', async () => {
        const r = await json(`/v1/agents/v2/tasks/${taskId}`, { headers: authA });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        const t = r.body.data.task;
        assert(t.assignedTo === worker.gaii, 'assigned to the agent that was addressed');
        assert(t.createdBy === caller.gaii, 'by the principal that called');
        assert(t.status === 'working' && t.a2a_state === 'submitted',
            `and the two vocabularies agree, got ${t.status}/${t.a2a_state}`);
        assert(t.input[0].text === 'Summarise the attached note.', 'with the parts that were sent');
    });

    await test('tasks/get reads it back, and reflects what the worker did over REST', async () => {
        const moved = await json(`/v1/agents/v2/tasks/${taskId}/status`, {
            method: 'POST', headers: { Authorization: `Bearer ${worker.token}` },
            body: JSON.stringify({ status: 'working', statusMessage: 'On it.' }),
        });
        assert(moved.status === 200, `rest status ${moved.status}: ${JSON.stringify(moved.body?.error)}`);

        const r = await rpc(a.owner, worker.name, caller.token, 'GetTask', { id: taskId });
        assert(!r.error, `expected no error, got ${JSON.stringify(r.error)}`);
        assert(r.result.status.state === 'TASK_STATE_WORKING',
            `a started task is working, got ${r.result.status.state}`);
        assert(r.result.status.message?.parts?.[0]?.text === 'On it.',
            'and the status message travels as a message part');
    });

    await test('a second message on the same task is another turn, not another task', async () => {
        const r = await rpc(a.owner, worker.name, caller.token, 'SendMessage', {
            message: { messageId: 'client-msg-2', role: 'ROLE_USER', taskId, parts: [{ text: 'The short version, please.' }] },
        });
        assert(!r.error, `expected no error, got ${JSON.stringify(r.error)}`);
        assert(r.result.task.id === taskId, 'the same task comes back');
        assert(r.result.task.history.length === 2, `with both turns, got ${r.result.task.history.length}`);

        const turns = await json(`/v1/agents/v2/messages?task_id=${encodeURIComponent(taskId)}`, { headers: authA });
        assert((turns.body.data.messages as any[]).length === 2, 'and the V4 store has both');
    });

    await test('a completed task carries its result as an ARTIFACT, not as a status sentence', async () => {
        const done = await json(`/v1/agents/v2/tasks/${taskId}/status`, {
            method: 'POST', headers: { Authorization: `Bearer ${worker.token}` },
            body: JSON.stringify({ status: 'completed', statusMessage: 'Done.', result: [{ kind: 'text', text: 'The summary.' }] }),
        });
        assert(done.status === 200, `rest complete ${done.status}: ${JSON.stringify(done.body?.error)}`);

        const r = await rpc(a.owner, worker.name, caller.token, 'GetTask', { id: taskId });
        assert(r.result.status.state === 'TASK_STATE_COMPLETED', `expected completed, got ${r.result.status.state}`);
        assert(Array.isArray(r.result.artifacts) && r.result.artifacts.length === 1,
            `the output belongs in artifacts, got ${JSON.stringify(r.result.artifacts)}`);
        assert(r.result.artifacts[0].parts[0].text === 'The summary.', 'and it is what the worker returned');
    });

    await test('tasks/cancel over A2A settles the same task over REST', async () => {
        const created = await rpc(a.owner, worker.name, caller.token, 'SendMessage', {
            message: { messageId: 'client-msg-3', role: 'ROLE_USER', parts: [{ text: 'Never mind.' }] },
        });
        const id = created.result.task.id;
        const r = await rpc(a.owner, worker.name, caller.token, 'CancelTask', { id });
        assert(!r.error, `expected no error, got ${JSON.stringify(r.error)}`);
        assert(r.result.status.state === 'TASK_STATE_CANCELED',
            `A2A spells it with one L, got ${r.result.status.state}`);

        const rest = await json(`/v1/agents/v2/tasks/${id}`, { headers: authA });
        assert(rest.body.data.task.status === 'cancelled', 'and MCP spells it with two, in the same row');
    });

    await test('cancelling an already settled task is refused, not silently accepted', async () => {
        const r = await rpc(a.owner, worker.name, caller.token, 'CancelTask', { id: taskId });
        assert(!!r.error, 'expected an error');
        assert(r.error.code === -32002, `expected the not-cancelable code, got ${r.error.code}`);
    });

    await test('a task nobody created answers the task-not-found code', async () => {
        const r = await rpc(a.owner, worker.name, caller.token, 'GetTask', { id: 'a4d2b0e6-0000-4000-8000-000000000000' });
        assert(!!r.error, 'expected an error');
        assert(r.error.code === -32001, `expected task-not-found, got ${r.error.code}`);
    });

    // ── 3. What the card promises, refused where it says so ───────────────────

    await test('streaming is declared off, and the method says so rather than hanging', async () => {
        const r = await rpc(a.owner, worker.name, caller.token, 'message/stream', {
            message: { messageId: 'client-msg-4', role: 'ROLE_USER', parts: [{ text: 'stream me' }] },
        });
        // A card that said streaming: true and a door that never sent an event would leave a client
        // holding a connection open forever. Refusing is the honest half of the declaration.
        assert(!!r.error || r.status >= 400, `expected a refusal, got ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    });

    await test('a part with inline bytes is refused, because a part here carries a pointer', async () => {
        const r = await rpc(a.owner, worker.name, caller.token, 'SendMessage', {
            message: {
                messageId: 'client-msg-5', role: 'ROLE_USER',
                parts: [{ raw: Buffer.from('hello').toString('base64'), mediaType: 'text/plain' }],
            },
        });
        assert(!!r.error, `expected a refusal, got ${JSON.stringify(r.body).slice(0, 300)}`);
        assert(r.error.code === -32602, `expected a malformed-request code, got ${r.error.code}`);
        assert(String(r.error.message).includes('inline bytes'), 'and it should say why');
    });

    await test('a 0.3 client reaches the same agent, because that is what clients speak today', async () => {
        // The card declares both interfaces at one address and the SDK's compat layer decides which
        // shape a request is by its version header. Declaring 1.0 alone would have been correct and
        // unreachable, so the older road is exercised rather than assumed.
        const r = await rpc(a.owner, worker.name, caller.token, 'message/send', {
            message: {
                messageId: 'legacy-msg-1',
                role: 'user',
                kind: 'message',
                parts: [{ kind: 'text', text: 'Sent the old way.' }],
            },
        }, '0.3');
        assert(!r.error, `the 0.3 road should answer, got ${JSON.stringify(r.error)}`);
        const id = r.result?.id ?? r.result?.task?.id;
        assert(typeof id === 'string', `with a task, got ${JSON.stringify(r.result).slice(0, 250)}`);

        // And it is the same store: the 1.0 road reads back what the 0.3 road made.
        const back = await rpc(a.owner, worker.name, caller.token, 'GetTask', { id });
        assert(!back.error, `and 1.0 reads it, got ${JSON.stringify(back.error)}`);
        assert(back.result.id === id, 'one task, two protocol versions');
    });

    // ── 4. The push config, which A2A binds to a task ─────────────────────────

    await test('a push config registered over A2A is bound to the task, and hides its credentials', async () => {
        const created = await rpc(a.owner, worker.name, caller.token, 'SendMessage', {
            message: { messageId: 'client-msg-6', role: 'ROLE_USER', parts: [{ text: 'Tell me when this moves.' }] },
        });
        const id = created.result.task.id;

        const set = await rpc(a.owner, worker.name, caller.token, 'CreateTaskPushNotificationConfig', {
            taskId: id,
            url: 'https://client.example.test/hook',
            token: 'echo-me',
            authentication: { scheme: 'Bearer', credentials: 'the-a2a-secret' },
        });
        assert(!set.error, `expected no error, got ${JSON.stringify(set.error)}`);
        assert(set.result.taskId === id, `bound to the task, got ${set.result.taskId}`);
        assert(set.result.token === 'echo-me', 'the token comes back');
        assert(!JSON.stringify(set.body).includes('the-a2a-secret'), 'the credentials do not');

        const listed = await rpc(a.owner, worker.name, caller.token, 'ListTaskPushNotificationConfigs', { taskId: id });
        assert(!listed.error, `expected no error, got ${JSON.stringify(listed.error)}`);
        assert((listed.result.configs as any[]).some(c => c.id === set.result.id), 'and it lists under that task');
        assert(!JSON.stringify(listed.body).includes('the-a2a-secret'), 'nor in the listing');

        // And V4's own door agrees it exists, because there is one store.
        const rest = await json('/v1/agents/v2/push-config', { headers: { Authorization: `Bearer ${caller.token}` } });
        assert((rest.body.data.push_configs as any[]).some(c => c.id === set.result.id),
            'the same target is on the V4 listing');

        const gone = await rpc(a.owner, worker.name, caller.token, 'DeleteTaskPushNotificationConfig', { taskId: id, id: set.result.id });
        assert(!gone.error, `delete should work, got ${JSON.stringify(gone.error)}`);
    });

    // ── 5. The fences ─────────────────────────────────────────────────────────

    await test('no credential, no door — but the card is still public', async () => {
        const res = await fetch(`${BASE}/v1/a2a/${a.owner}/${worker.name}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'GetTask', params: { id: taskId } }),
        });
        assert(res.status === 401, `expected 401, got ${res.status}`);
        const card = await json(`/v1/a2a/${a.owner}/${worker.name}/agent-card.json`);
        assert(card.status === 200, 'and the card is still readable without one');
    });

    await test('a principal of another account is refused at the door', async () => {
        const r = await rpc(a.owner, worker.name, outsider.token, 'GetTask', { id: taskId });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('every mutating method refuses an agent whose scopes do not carry it', async () => {
        // The reason this file is named in the route-scope exemption: one HTTP door, a dozen
        // methods, so the gate is per method and the claim has to be measured rather than asserted.
        const send = await rpc(a.owner, worker.name, reader.token, 'SendMessage', {
            message: { messageId: 'nope-1', role: 'ROLE_USER', parts: [{ text: 'let me in' }] },
        });
        assert(!!send.error, 'message/send should be refused');
        assert(String(send.error.message).includes('messages:send'), `and name the word, got ${send.error.message}`);

        const cancel = await rpc(a.owner, worker.name, reader.token, 'CancelTask', { id: taskId });
        assert(!!cancel.error && String(cancel.error.message).includes('task:write'),
            `tasks/cancel should be refused for task:write, got ${JSON.stringify(cancel.error)}`);

        const push = await rpc(a.owner, worker.name, reader.token, 'CreateTaskPushNotificationConfig', {
            taskId, url: 'https://client.example.test/hook',
        });
        assert(!!push.error && String(push.error.message).includes('agent:write'),
            `the push write should be refused for agent:write, got ${JSON.stringify(push.error)}`);

        const del = await rpc(a.owner, worker.name, reader.token, 'DeleteTaskPushNotificationConfig', { taskId, id: 'x' });
        assert(!!del.error && String(del.error.message).includes('agent:write'),
            `the push delete should be refused too, got ${JSON.stringify(del.error)}`);
    });

    await test('and the reads that its REST twins leave ungated still work for that agent', async () => {
        const r = await rpc(a.owner, worker.name, reader.token, 'GetTask', { id: taskId });
        assert(!r.error, `a task read should not need a scope, got ${JSON.stringify(r.error)}`);
        assert(r.result.id === taskId, 'and it is the task');
    });

    // ── 6. The OASF record: the same agent, for a directory rather than a caller (V6c) ──

    await test('the OASF record is public and is generated from the agent, not written by hand', async () => {
        const r = await json(`/v1/oasf/${a.owner}/${worker.name}`);
        assert(r.status === 200, `expected 200 with no credential, got ${r.status}`);
        const rec = r.body;
        assert(rec.name === `${a.owner}/${worker.name}`, `OASF names an agent publisher/name, got ${rec.name}`);
        assert(typeof rec.schema_version === 'string' && rec.schema_version.length > 0, 'and says which schema it is written against');
        assert(rec.description === 'Handles work sent over A2A.', 'the description is the one the owner gave the agent');
        assert(rec.authors[0] === a.owner, 'the author is whose agent it is');
        assert(typeof rec.created_at === 'string', 'with the date the agent was created');
        assert(Array.isArray(rec.skills) && rec.skills.length >= 1, 'a record with no skills is invisible to a directory');
        // No invented taxonomy id: emitting one would file the agent under something it is not.
        assert(rec.skills.every((s: any) => s.id === undefined), 'and no invented taxonomy id');
    });

    await test('the record carries the addresses a machine can act on, and the AIMEAT half in an extension', async () => {
        const rec = (await json(`/v1/oasf/${a.owner}/${worker.name}`)).body;
        const byType = Object.fromEntries((rec.locators as any[]).map(l => [l.type, l.url]));
        assert(String(byType['a2a-jsonrpc']).endsWith(`/v1/a2a/${a.owner}/${worker.name}`),
            `the A2A door is locatable, got ${byType['a2a-jsonrpc']}`);
        assert(String(byType['a2a-agent-card']).endsWith('/agent-card.json'), 'and the A2A card');
        assert(String(byType['aimeat-agent-card']).includes('/v1/agents/'), 'and the signed AIMEAT card');

        // The AIMEAT-specific half travels in an extension a consumer can step over, rather than
        // being smuggled into a field OASF defined for something else.
        const ext = (rec.extensions as any[]).find(e => e.name === 'aimeat.agent');
        assert(!!ext, 'there is an aimeat.agent extension');
        assert(ext.data.gaii === worker.gaii, `carrying the GAII, got ${ext.data.gaii}`);
        assert(ext.data.node === NODE_ID, 'and the node');
        assert(ext.data.owner === a.owner, 'and the owner');
        assert('run_mode' in ext.data, 'and the run mode, even when nobody has said');

        // The locator actually resolves: a directory that followed it would reach the card.
        const card = await json(`/v1/a2a/${a.owner}/${worker.name}/agent-card.json`);
        assert(card.status === 200, 'and following the A2A card locator works');
    });

    await test('there is no OASF record for an agent nobody created', async () => {
        const r = await json(`/v1/oasf/${a.owner}/nobody`);
        assert(r.status === 404, `expected 404, got ${r.status}`);
    });

    // ── 7. Nothing existing moved ─────────────────────────────────────────────

    await test('the REST and MCP doors onto the same work answer exactly what they did', async () => {
        const rest = await json('/v1/agents/v2/tasks?limit=200', { headers: authA });
        assert(rest.status === 200, `the V5 roster still answers, got ${rest.status}`);
        // Three tasks were created over A2A in this suite: the main one, the one cancelled, and the
        // one a push target was registered for. All three are in the V5 roster because there is one
        // store; if A2A had grown a store of its own, this is the assertion that would have caught it.
        assert((rest.body.data.tasks as any[]).length >= 3,
            `with everything A2A created in it, got ${(rest.body.data.tasks as any[]).length}`);
        assert((rest.body.data.tasks as any[]).every(t => typeof t.a2a_state === 'string'),
            'and every task still carries both vocabularies');

        const dashboard = await json(`/v1/agents/${worker.name}/tasks`, { headers: authA });
        assert(dashboard.status === 200, `the dashboard task store still answers, got ${dashboard.status}`);
        assert(!JSON.stringify(dashboard.body).includes('Summarise the attached note.'),
            'and no A2A work has leaked into it');
    });
}

run().then(() => {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
    console.error('Suite crashed:', err);
    process.exit(1);
});
