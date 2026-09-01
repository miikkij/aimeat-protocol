/**
 * @file test/e2e-agent-v2-agui.ts
 * @description Agent v2 V6d: a web front end watching one of this owner's agents, over AG-UI.
 *
 *   THE SUITE READS THE EVENT STREAM, not a JSON body. AG-UI is server-sent events and the whole
 *   question is what arrives, in what order, while the work is still going — so the test opens the
 *   stream, drives the task from the other side over REST, and asserts on the sequence. A test that
 *   waited for the response to finish and then parsed it would pass on a door that sent everything
 *   at the end, which is the exact failure this protocol exists to avoid.
 *
 *   IT IS THE SAME TASK AS EVERY OTHER DOOR. Work started here is in the V5 roster and readable
 *   over A2A; that is asserted rather than assumed, because two stores that agree today is what a
 *   projection looks like right up until it is not one.
 *
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-v2-agui
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
    const owner = `gui${label}${Date.now().toString(36)}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'AguiPass12345678' }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'AguiPass12345678' }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    return { owner, ownerToken: tok.body.data.token as string };
}

async function addAgent(owner: string, ownerToken: string, name: string, scopes: string[] = ['*']) {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name, owner, capabilities: [], mode: 'interactive', scopes }),
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

/** An open AG-UI stream, read event by event as a front end would. */
interface OpenStream {
    events: Array<Record<string, unknown>>;
    /** Resolves when the stream closes. */
    done: Promise<void>;
    close(): void;
    /** Wait until an event of this type has arrived, or give up. */
    waitFor(type: string, ms?: number): Promise<Record<string, unknown> | null>;
}

async function openAgui(path: string, token: string, init: RequestInit = {}): Promise<{ status: number; stream: OpenStream | null; body?: any }> {
    const controller = new AbortController();
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
        signal: controller.signal,
    });
    if (!res.ok || !res.body) {
        const ct = res.headers.get('content-type') ?? '';
        return { status: res.status, stream: null, body: ct.includes('json') ? await res.json() : await res.text() };
    }

    const events: Array<Record<string, unknown>> = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const done = (async () => {
        try {
            for (;;) {
                const { value, done: finished } = await reader.read();
                if (finished) break;
                buffer += decoder.decode(value, { stream: true });
                // SSE frames are separated by a blank line; anything before the last one is complete.
                const frames = buffer.split('\n\n');
                buffer = frames.pop() ?? '';
                for (const frame of frames) {
                    const line = frame.split('\n').find(l => l.startsWith('data: '));
                    if (!line) continue;
                    try { events.push(JSON.parse(line.slice(6))); } catch { /* a frame we cannot read is not an event */ }
                }
            }
        } catch { /* the reader was cancelled, which is how a front end leaves */ }
    })();

    const waitFor = async (type: string, ms = 15000): Promise<Record<string, unknown> | null> => {
        const until = Date.now() + ms;
        while (Date.now() < until) {
            const hit = events.find(e => e.type === type);
            if (hit) return hit;
            await new Promise(r => setTimeout(r, 50));
        }
        return null;
    };

    return { status: res.status, stream: { events, done, close: () => controller.abort(), waitFor } };
}

async function run(): Promise<void> {
    console.log('\n🧪 Agent v2 V6d — a front end watching an agent work, over AG-UI\n');

    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const authA = { Authorization: `Bearer ${a.ownerToken}` };
    const worker = await addAgent(a.owner, a.ownerToken, 'agui-worker');
    const outsider = await addAgent(b.owner, b.ownerToken, 'agui-outsider');
    // Deliberately narrow: it may read, and it may not create work.
    const reader = await addAgent(a.owner, a.ownerToken, 'agui-reader', ['memory:read']);

    /** The task the owner's worker has just been given, once the node has it. */
    async function latestTask(status = 'working'): Promise<string> {
        for (let i = 0; i < 80; i++) {
            const list = await json(`/v1/agents/v2/tasks?assigned_to=${encodeURIComponent(worker.gaii)}&status=${status}`, { headers: authA });
            const found = (list.body?.data?.tasks as any[] | undefined)?.[0];
            if (found) return found.taskId;
            await new Promise(r => setTimeout(r, 100));
        }
        return '';
    }

    let threadId = '';
    let taskId = '';

    await test('a run starts the stream before the work is done, not after', async () => {
        threadId = `thread-${Date.now().toString(36)}`;
        const opened = await openAgui(`/v1/agui/${a.owner}/${worker.name}`, a.ownerToken, {
            method: 'POST',
            body: JSON.stringify({ threadId, runId: 'run-1', messages: [{ id: 'm1', role: 'user', content: 'Draft the release note.' }] }),
        });
        assert(opened.status === 200, `expected 200, got ${opened.status}: ${JSON.stringify(opened.body ?? null).slice(0, 300)}`);
        assert(!!opened.stream, 'the response should be a stream');

        // RUN_STARTED arrives while the task is still open, which is the whole point of the door.
        const started = await opened.stream!.waitFor('RUN_STARTED');
        assert(!!started, 'RUN_STARTED should arrive');
        assert(started!.threadId === threadId && started!.runId === 'run-1',
            'carrying the thread and run the front end named');

        taskId = await latestTask();
        assert(!!taskId, 'and a real task exists on the node by then');
        opened.stream!.close();
        await opened.stream!.done;
    });

    await test('the work started here is in the V5 roster, under the thread as its context', async () => {
        const r = await json(`/v1/agents/v2/tasks/${taskId}`, { headers: authA });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        const t = r.body.data.task;
        assert(t.assignedTo === worker.gaii, 'assigned to the agent that was addressed');
        assert(t.contextId === threadId, `the AG-UI thread is the exchange, got ${t.contextId}`);
        assert(t.input[0].text === 'Draft the release note.', 'carrying what the front end sent');
        assert(t.metadata?.source === 'ag-ui', 'and marked as having come from a front end');
    });

    await test('what the worker says while working arrives as it happens, and the run finishes', async () => {
        const watching = await openAgui(`/v1/agui/${a.owner}/${worker.name}/${taskId}`, a.ownerToken);
        assert(watching.status === 200, `watching an existing task should stream, got ${watching.status}`);
        const s = watching.stream!;
        assert(!!(await s.waitFor('RUN_STARTED')), 'RUN_STARTED first');

        await json(`/v1/agents/v2/tasks/${taskId}/status`, {
            method: 'POST', headers: { Authorization: `Bearer ${worker.token}` },
            body: JSON.stringify({ status: 'working', statusMessage: 'Reading the commits.' }),
        });
        const content = await s.waitFor('TEXT_MESSAGE_CONTENT');
        assert(!!content, 'a text event should arrive while the work is still going');

        await json(`/v1/agents/v2/tasks/${taskId}/status`, {
            method: 'POST', headers: { Authorization: `Bearer ${worker.token}` },
            body: JSON.stringify({ status: 'completed', result: [{ kind: 'text', text: 'Here is the note.' }] }),
        });
        const finished = await s.waitFor('RUN_FINISHED');
        assert(!!finished, 'RUN_FINISHED should arrive when the task settles');
        await s.done;

        const texts = s.events.filter(e => e.type === 'TEXT_MESSAGE_CONTENT').map(e => String(e.delta));
        assert(texts.some(t => t.includes('Reading the commits.')), `the status line was streamed, got ${JSON.stringify(texts)}`);
        assert(texts.some(t => t.includes('Here is the note.')), 'and so was the result');

        // Each utterance is its own message: a status line and a result are different things said at
        // different times, and one message would render them as one paragraph.
        const startIds = s.events.filter(e => e.type === 'TEXT_MESSAGE_START').map(e => e.messageId);
        assert(new Set(startIds).size === startIds.length, 'every message has its own id');
        assert(startIds.length >= 2, `at least two utterances, got ${startIds.length}`);
        assert(s.events.filter(e => e.type === 'TEXT_MESSAGE_END').length === startIds.length,
            'and every one of them is closed');
    });

    await test('a failed task ends the run as an error, and a cancelled one does not', async () => {
        // Two runs, because the difference between them is the point: a deliberate stop rendered as
        // an error teaches a person to distrust the errors that matter.
        const first = await openAgui(`/v1/agui/${a.owner}/${worker.name}`, a.ownerToken, {
            method: 'POST',
            body: JSON.stringify({ messages: [{ id: 'm2', role: 'user', content: 'Something impossible.' }] }),
        });
        const failing = await latestTask();
        await json(`/v1/agents/v2/tasks/${failing}/status`, {
            method: 'POST', headers: { Authorization: `Bearer ${worker.token}` },
            body: JSON.stringify({ status: 'failed', error: { code: 'NO_SOURCE', message: 'Nothing to read.' } }),
        });
        const err = await first.stream!.waitFor('RUN_ERROR');
        assert(!!err, 'a failed task ends the run as an error');
        assert(String(err!.code) === 'NO_SOURCE', `carrying the worker's own code, got ${err!.code}`);
        await first.stream!.done;

        const second = await openAgui(`/v1/agui/${a.owner}/${worker.name}`, a.ownerToken, {
            method: 'POST',
            body: JSON.stringify({ messages: [{ id: 'm3', role: 'user', content: 'Never mind.' }] }),
        });
        const cancelling = await latestTask();
        await json(`/v1/agents/v2/tasks/${cancelling}/cancel`, { method: 'POST', headers: authA });
        const done = await second.stream!.waitFor('RUN_FINISHED');
        assert(!!done, 'a cancelled task FINISHES the run rather than erroring it');
        assert(!second.stream!.events.some(e => e.type === 'RUN_ERROR'), 'and no error is sent');
        await second.stream!.done;
    });

    await test('the assistant turns a front end replays are not filed as new work', async () => {
        const opened = await openAgui(`/v1/agui/${a.owner}/${worker.name}`, a.ownerToken, {
            method: 'POST',
            body: JSON.stringify({
                messages: [
                    { id: 'h1', role: 'user', content: 'The earlier question.' },
                    { id: 'h2', role: 'assistant', content: 'The earlier answer.' },
                    { id: 'h3', role: 'user', content: 'The new question.' },
                ],
            }),
        });
        assert(opened.status === 200, `expected 200, got ${opened.status}`);
        const id = await latestTask();
        opened.stream!.close();
        await opened.stream!.done;

        const t = (await json(`/v1/agents/v2/tasks/${id}`, { headers: authA })).body.data.task;
        const texts = (t.input as any[]).map(p => p.text);
        assert(texts.includes('The new question.'), 'the new question is the ask');
        assert(!texts.includes('The earlier answer.'),
            `an assistant turn is history, not work, got ${JSON.stringify(texts)}`);
    });

    await test('a run with nothing to act on is refused before a stream is opened', async () => {
        const r = await json(`/v1/agui/${a.owner}/${worker.name}`, {
            method: 'POST', headers: authA,
            body: JSON.stringify({ messages: [{ id: 'x', role: 'assistant', content: 'only history' }] }),
        });
        assert(r.status === 400, `expected 400, got ${r.status}`);
    });

    await test('another account cannot start or watch a run here', async () => {
        const start = await json(`/v1/agui/${a.owner}/${worker.name}`, {
            method: 'POST', headers: { Authorization: `Bearer ${outsider.token}` },
            body: JSON.stringify({ messages: [{ id: 'y', role: 'user', content: 'let me in' }] }),
        });
        assert(start.status === 403, `expected 403 on the run, got ${start.status}`);
        const watch = await json(`/v1/agui/${a.owner}/${worker.name}/${taskId}`, {
            headers: { Authorization: `Bearer ${outsider.token}` },
        });
        assert(watch.status === 403, `expected 403 on the watch, got ${watch.status}`);
        const anon = await json(`/v1/agui/${a.owner}/${worker.name}/${taskId}`);
        assert(anon.status === 401, `and no credential is 401, got ${anon.status}`);
    });

    await test('an agent whose scopes do not carry task:write cannot start a run, but may watch', async () => {
        const start = await json(`/v1/agui/${a.owner}/${worker.name}`, {
            method: 'POST', headers: { Authorization: `Bearer ${reader.token}` },
            body: JSON.stringify({ messages: [{ id: 'z', role: 'user', content: 'start something' }] }),
        });
        assert(start.status === 403, `expected 403, got ${start.status}`);

        const watching = await openAgui(`/v1/agui/${a.owner}/${worker.name}/${taskId}`, reader.token);
        assert(watching.status === 200, `a read needs no scope, got ${watching.status}`);
        watching.stream?.close();
        await watching.stream?.done;
    });

    await test('the same work reads over A2A, which is what makes this a projection', async () => {
        const res = await fetch(`${BASE}/v1/a2a/${a.owner}/${worker.name}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'A2A-Version': '1.0', Authorization: `Bearer ${a.ownerToken}` },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'GetTask', params: { id: taskId } }),
        });
        const body = await res.json() as any;
        assert(!body.error, `A2A should read the same task, got ${JSON.stringify(body.error)}`);
        assert(body.result.id === taskId, 'one task, three doors');
        assert(body.result.status.state === 'TASK_STATE_COMPLETED',
            `and the state agrees, got ${body.result.status.state}`);
    });
}

run().then(() => {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
    console.error('Suite crashed:', err);
    process.exit(1);
});
