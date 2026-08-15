// E2E Tests for Agent Messages
// Run: cd aimeat && pnpm exec tsx test/e2e-agent-messages.ts
// v1.2.0 -- 2026-06-06 -- Add Phase 5 (tests 11-15): task-based threads -- a message with
//   linked_task_id (no thread_id) joins the task's thread, subsequent linked messages share it,
//   the thread listing labels it by task title, and a task-less message stays in its own thread.
// v1.1.0 -- 2026-05-30 -- Add option-prompt tests (4b/4c): prompt metadata round-trip and
//   prompt_answer correlation via thread history (the path aimeat_message_history reads).

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

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any; headers: Headers }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts,
            headers: { 'Content-Type': 'application/json', ...opts.headers },
        });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
        if (res.status === 429 && attempt < retries) {
            const retryAfter = Number(res.headers.get('Retry-After') || '5');
            await sleep(retryAfter * 1000 + 500);
            continue;
        }
        return { status: res.status, body, headers: res.headers };
    }
    throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

async function getToken(ownerOrGaii: string, privKey: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = isAgent ? ownerOrGaii + timestamp : ownerOrGaii + NODE_ID + timestamp;
    const signature = await signMsg(privKey, message);
    const payload = isAgent
        ? { gaii: ownerOrGaii, timestamp, signature }
        : { owner: ownerOrGaii, timestamp, signature };
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

// ─── State ───
const ownerName = `msgowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'msgbot';

let firstMessageId = '';
let firstThreadId = '';

console.log('\n=== AIMEAT Agent Messages E2E Test ===\n');

// ─── Setup ───
console.log('Setup -- Owner & Agent');

await test('Register owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
    ownerToken = await getToken(ownerName, ownerPrivKey, false);
});

await test('Register agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: agentName,
            owner: ownerName,
            capabilities: ['memory', 'actions'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
    assert(typeof agentPrivKey === 'string', 'got agent private key');
});

await test('Agent auth token', async () => {
    agentToken = await getToken(agentGaii, agentPrivKey, true);
    assert(typeof agentToken === 'string' && agentToken.length > 0, 'got agent token');
});

// ─── Phase 1: Send Messages ───
console.log('\nPhase 1 -- Send Messages');

await test('1. Owner sends inbound message', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            direction: 'inbound',
            content: 'Hello agent, please do something for me.',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.direction === 'inbound', `direction: ${body.data.message.direction}`);
    assert(body.data.message.status === 'pending', `status: ${body.data.message.status}`);
    assert(body.data.message.content === 'Hello agent, please do something for me.', 'content matches');
    assert(typeof body.data.message.id === 'string', 'has id');
    assert(typeof body.data.message.threadId === 'string', 'has threadId');
    firstMessageId = body.data.message.id;
    firstThreadId = body.data.message.threadId;
});

await test('2. Agent polls inbox -- pending message appears', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages/inbox`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.messages), 'has messages array');
    assert(body.data.messages.length >= 1, `inbox should have >=1 messages, got ${body.data.messages.length}`);
    const pending = body.data.messages.find((m: any) => m.id === firstMessageId);
    assert(pending !== undefined, 'first message appears in inbox');
});

await test('3. Agent sends outbound response', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            direction: 'outbound',
            content: 'Done! Here is the result you asked for.',
            thread_id: firstThreadId,
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.direction === 'outbound', `direction: ${body.data.message.direction}`);
    assert(body.data.message.status === 'delivered', `status: ${body.data.message.status}`);
    assert(body.data.message.threadId === firstThreadId, 'same thread');
});

await test('4. Message with proposed_task metadata', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            direction: 'inbound',
            content: 'Can you scrape this website for me?',
            thread_id: firstThreadId,
            metadata: {
                proposed_task: {
                    title: 'Scrape website',
                    description: 'Scrape https://example.com and return the content',
                },
            },
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.metadata !== undefined, 'has metadata');
    assert(body.data.message.metadata.proposedTask !== undefined, 'has proposedTask in metadata');
    assert(body.data.message.metadata.proposedTask.title === 'Scrape website', 'proposedTask title matches');
});

const promptId = `p-${Date.now()}`;

await test('4b. Option-prompt round-trips in outbound message metadata', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            direction: 'outbound',
            content: 'What kind of image do you want me to create?',
            thread_id: firstThreadId,
            metadata: {
                prompt: {
                    prompt_id: promptId,
                    question: 'What kind of image?',
                    options: ['color', 'black and white', 'photorealistic'],
                    allow_other: true,
                },
            },
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    const p = body.data.message.metadata?.prompt;
    assert(p !== undefined, 'has prompt in metadata');
    assert(p.promptId === promptId, `prompt_id round-trips: ${p.promptId}`);
    assert(Array.isArray(p.options) && p.options.length === 3, 'options round-trip');
    assert(p.allowOther === true, 'allow_other round-trips');
});

await test('4c. Owner prompt_answer round-trips and is correlatable via history', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            direction: 'inbound',
            content: 'color',
            thread_id: firstThreadId,
            metadata: { prompt_answer: { prompt_id: promptId, choice: 'color', is_other: false } },
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    const pa = body.data.message.metadata?.promptAnswer;
    assert(pa !== undefined, 'has promptAnswer in metadata');
    assert(pa.promptId === promptId, 'answer prompt_id matches the question');
    assert(pa.choice === 'color', 'choice round-trips');
    assert(pa.isOther === false, 'is_other round-trips');

    // The answer must be findable in thread history (what aimeat_message_history reads).
    const hist = await json(`/v1/agents/${agentName}/messages?thread_id=${firstThreadId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const found = hist.body.data.messages.find((m: any) => m.metadata?.promptAnswer?.promptId === promptId);
    assert(found !== undefined, 'answer is findable in thread history by prompt_id');
    assert(found.metadata.promptAnswer.choice === 'color', 'history answer choice matches');
});

// ─── Phase 2: Update Status ───
console.log('\nPhase 2 -- Update Message Status');

await test('5. Update message status to processing', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages/${firstMessageId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ status: 'processing' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.status === 'processing', `status: ${body.data.message.status}`);
});

await test('6. Update message status to delivered', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages/${firstMessageId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ status: 'delivered' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.status === 'delivered', `status: ${body.data.message.status}`);
    assert(typeof body.data.message.processedAt === 'string', 'has processedAt');
});

// A11 (E2E test-quality audit). Tests 5 and 6 update this agent's own message and prove the status
// moves. The access check they pass, canAccessAgent(), asks "may you act as the agent named in the
// PATH" and builds that name against the CALLER's own owner — a real check, and not this one. The
// message id was a second coordinate nobody checked, so any agent on the node could flip the status
// of any message by id, and the handler returns the whole updated row, which made the write a read
// of another owner's message as well. Against the pre-fix source this fails with 200 and B's
// message content in the response.
await test('6b. An agent cannot touch another owner\'s message by id', async () => {
    const strangerName = `agmsgstranger${Date.now()}`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: strangerName, public_key: 'placeholder' }) });
    assert(reg.status === 201, `stranger owner ${reg.status}: ${JSON.stringify(reg.body).slice(0, 200)}`);
    const strangerToken = await getToken(strangerName, reg.body.data.private_key, false);

    const strangerAgent = 'stranger-bot';
    const ar = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${strangerToken}` },
        body: JSON.stringify({ name: strangerAgent, owner: strangerName, capabilities: ['memory'] }),
    });
    assert(ar.status === 201, `stranger agent ${ar.status}: ${JSON.stringify(ar.body).slice(0, 200)}`);
    const strangerAgentToken = await getToken(ar.body.data.agent.gaii, ar.body.data.private_key, true);

    // A message that belongs to the STRANGER's agent, with content only they should ever see.
    const secret = 'the stranger\'s private instruction';
    const sent = await json(`/v1/agents/${strangerAgent}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${strangerToken}` },
        body: JSON.stringify({ direction: 'inbound', content: secret }),
    });
    assert(sent.status === 201, `stranger message ${sent.status}: ${JSON.stringify(sent.body).slice(0, 200)}`);
    const strangerMsgId = sent.body.data.message.id;

    // Our agent, addressing its OWN name in the path so canAccessAgent passes, but naming the
    // stranger's message id.
    const attack = await json(`/v1/agents/${agentName}/messages/${strangerMsgId}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ status: 'error' }),
    });
    assert(attack.status === 404, `expected 404, got ${attack.status}: ${JSON.stringify(attack.body).slice(0, 200)}`);
    assert(!JSON.stringify(attack.body).includes(secret),
        `another owner's message content was served: ${JSON.stringify(attack.body).slice(0, 220)}`);

    // The stranger's message is untouched, and they can still work with it themselves.
    const theirs = await json(`/v1/agents/${strangerAgent}/messages/${strangerMsgId}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${strangerAgentToken}` },
        body: JSON.stringify({ status: 'processing' }),
    });
    assert(theirs.status === 200, `the rightful agent must still update its own message, got ${theirs.status}`);
    assert(theirs.body.data.message.status === 'processing',
        `expected processing (not the attacker's 'error'), got ${theirs.body.data.message.status}`);

    await json(`/v1/owners/${strangerName}`, { method: 'DELETE', headers: { Authorization: `Bearer ${strangerToken}` } });
});

// ─── Phase 3: Filtering ───
console.log('\nPhase 3 -- List & Filter');

await test('7. List messages with direction filter (inbound)', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages?direction=inbound`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.messages), 'has messages array');
    assert(body.data.messages.length >= 2, `should have >=2 inbound messages, got ${body.data.messages.length}`);
    assert(body.data.messages.every((m: any) => m.direction === 'inbound'), 'all messages are inbound');
});

await test('8. List messages with thread_id filter', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages?thread_id=${firstThreadId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.messages), 'has messages array');
    assert(body.data.messages.length >= 3, `thread should have >=3 messages, got ${body.data.messages.length}`);
    assert(body.data.messages.every((m: any) => m.threadId === firstThreadId), 'all messages in same thread');
});

await test('9. Thread listing', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages/threads`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.threads), 'has threads array');
    assert(body.data.threads.length >= 1, `should have >=1 thread, got ${body.data.threads.length}`);
    const thread = body.data.threads.find((t: any) => t.threadId === firstThreadId);
    assert(thread !== undefined, 'our thread appears in listing');
    assert(thread.messageCount >= 3, `thread should have >=3 messages, got ${thread.messageCount}`);
});

await test('9b. GET /messages/overview folds commands + threads + messages', async () => {
    // Seed the command palette (agent-authored, under the agent's own GAII).
    await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: `agents.${agentName}.commands`, value: [{ id: 'greet', label: 'Greet' }], visibility: 'public' }),
    });

    const { status, body } = await json(`/v1/agents/${agentName}/messages/overview`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `overview status ${status}: ${JSON.stringify(body)}`);
    const d = body.data;
    // commands
    assert(Array.isArray(d.commands) && d.commands.some((c: any) => c.id === 'greet'), 'command palette surfaced');
    // threads mirror GET /messages/threads (incl. task-title enrichment fields)
    const threadsSingle = await json(`/v1/agents/${agentName}/messages/threads`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(d.threads.length === threadsSingle.body.data.threads.length, `threads count matches /messages/threads: ${d.threads.length} vs ${threadsSingle.body.data.threads.length}`);
    // messages mirror GET /messages (page 1)
    const msgSingle = await json(`/v1/agents/${agentName}/messages`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(d.messages.messages.length === msgSingle.body.data.messages.length, `messages count matches /messages: ${d.messages.messages.length} vs ${msgSingle.body.data.messages.length}`);
    assert(d.messages.page === 1, 'messages page is 1');
});

await test('9c. messages/overview owner-or-self: a sibling agent gets 403', async () => {
    const r = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'msgbot2', owner: ownerName, capabilities: ['memory'] }),
    });
    assert(r.status === 201, `register agent2 ${r.status}: ${JSON.stringify(r.body)}`);
    const a2 = await getToken(r.body.data.agent.gaii, r.body.data.private_key, true);
    const { status } = await json(`/v1/agents/${agentName}/messages/overview`, { headers: { Authorization: `Bearer ${a2}` } });
    assert(status === 403, `sibling agent should get 403, got ${status}`);
});

// ─── Phase 4: Consolidated Inbox ───
console.log('\nPhase 4 -- Consolidated Inbox');

await test('10. Consolidated inbox shows pending messages', async () => {
    // Send a new inbound message that will stay pending (not yet processed)
    await json(`/v1/agents/${agentName}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            direction: 'inbound',
            content: 'Another task for you -- this stays pending.',
        }),
    });

    const { status, body } = await json(`/v1/agents/${agentName}/inbox`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.pending_messages), 'has pending_messages array');
    assert(body.data.pending_messages.length >= 1, `should have >=1 pending message, got ${body.data.pending_messages.length}`);
    // Each entry should have preview and from fields
    const first = body.data.pending_messages[0];
    assert(typeof first.preview === 'string', 'pending message has preview');
    assert(typeof first.from === 'string', 'pending message has from');
    assert(typeof first.id === 'string', 'pending message has id');
});

// ─── Phase 5: Task-based threads ───
console.log('\nPhase 5 -- Task-based threads');

let taskId = '';
const taskTitle = `Build the landing page ${Date.now()}`;

await test('11. Create a task', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ title: taskTitle, description: 'Design and build it.', status: 'queued' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    taskId = body.data.task.id;
    assert(typeof taskId === 'string', 'has task id');
});

await test('12. Message with linked_task_id (no thread_id) joins the task thread', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            direction: 'outbound',
            content: 'Clarification: what color scheme should I use?',
            linked_task_id: taskId,
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.threadId === taskId, `threadId should equal task id, got ${body.data.message.threadId}`);
    assert(body.data.message.linkedTaskId === taskId, 'linkedTaskId is set on the message');
});

await test('13. A second linked message lands in the SAME task thread', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            direction: 'inbound',
            content: 'Use blue and white.',
            linked_task_id: taskId,
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.threadId === taskId, `second message should join the task thread, got ${body.data.message.threadId}`);
});

await test('14. Thread listing labels the task thread by task title', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages/threads`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const taskThread = body.data.threads.find((t: any) => t.threadId === taskId);
    assert(taskThread !== undefined, 'task thread appears in listing');
    assert(taskThread.title === taskTitle, `thread title should be the task title, got ${JSON.stringify(taskThread.title)}`);
    assert(taskThread.linkedTaskId === taskId, 'thread linkedTaskId is set to the task id');
    assert(taskThread.messageCount >= 2, `task thread should have >=2 messages, got ${taskThread.messageCount}`);
});

await test('15. Failure mode: a task-less message does NOT join the task thread', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            direction: 'inbound',
            content: 'Unrelated ad-hoc question with no task.',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.message.threadId !== taskId, 'task-less message gets its own thread, not the task thread');
    // And the thread listing must not mislabel it with a task title.
    const threads = await json(`/v1/agents/${agentName}/messages/threads`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const adhoc = threads.body.data.threads.find((t: any) => t.threadId === body.data.message.threadId);
    assert(adhoc !== undefined, 'ad-hoc thread appears in listing');
    assert(adhoc.title === null, `ad-hoc thread should have no task title, got ${JSON.stringify(adhoc.title)}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Cascade-delete owner', async () => {
    const { status, body } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
});

// ─── Summary ───
console.log(`\n${'='.repeat(50)}`);
console.log(`Agent Messages E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
