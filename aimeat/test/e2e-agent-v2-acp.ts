/**
 * @file test/e2e-agent-v2-acp.ts
 * @description Agent v2 V6b: an AIMEAT agent presented to a code editor over the Agent Client
 *   Protocol.
 *
 *   THE EDITOR IN THIS SUITE IS THE SDK'S OWN CLIENT, wired to our agent through a pair of in-memory
 *   streams. That is the point: what an editor sends and expects is decided by the ACP SDK, so
 *   driving our side with anything else would prove our idea of the protocol rather than the
 *   protocol. Everything below `session/prompt` is the real node — a real task on the real store,
 *   settled by a real worker over REST.
 *
 *   WHAT IS NOT TESTED HERE, said out loud: the twenty lines of `aimeat connect acp` that read the
 *   connector's config and turn stdin and stdout into the same stream pair. That path needs a
 *   keychain entry and a spawned process, and standing one up would test the keychain rather than
 *   the protocol.
 *
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-v2-acp
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial, with the feature.
 */
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { client as acpClient, ndJsonStream, type Stream, type SessionNotification } from '@agentclientprotocol/sdk';
import { AimeatClient } from '../src/cli/connect/api-client.js';
import { buildAimeatAcpAgent } from '../src/cli/connect/acp/agent.js';
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
    const owner = `acp${label}${Date.now().toString(36)}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'AcpPass123456789' }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'AcpPass123456789' }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    return { owner, ownerToken: tok.body.data.token as string };
}

async function addAgent(owner: string, ownerToken: string, name: string) {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name, owner, capabilities: [], mode: 'interactive', scopes: ['*'] }),
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

/** Two ndjson streams facing each other: the editor on one end, our agent on the other. */
function streamPair(): { agentSide: Stream; clientSide: Stream } {
    const toClient = new TransformStream<Uint8Array, Uint8Array>();
    const toAgent = new TransformStream<Uint8Array, Uint8Array>();
    return {
        agentSide: ndJsonStream(toClient.writable, toAgent.readable),
        clientSide: ndJsonStream(toAgent.writable, toClient.readable),
    };
}

async function run(): Promise<void> {
    console.log('\n🧪 Agent v2 V6b — an AIMEAT agent, presented to an editor over ACP\n');

    const a = await setupOwner('a');
    const authA = { Authorization: `Bearer ${a.ownerToken}` };
    const worker = await addAgent(a.owner, a.ownerToken, 'acp-worker');
    const editorPrincipal = await addAgent(a.owner, a.ownerToken, 'acp-editor');

    // Everything the editor's prompts arrive as, and the credential they arrive under.
    const nodeClient = new AimeatClient(BASE, editorPrincipal.token);
    const app = buildAimeatAcpAgent({
        client: nodeClient,
        agentGaii: worker.gaii,
        agentLabel: 'acp-worker',
        nodeLabel: 'localhost',
    });

    /** Everything the agent said into the editor's chat. */
    const updates: SessionNotification[] = [];
    const editor = acpClient({ name: 'test-editor' })
        .onNotification('session/update', (ctx) => { updates.push(ctx.params); });

    const { agentSide, clientSide } = streamPair();
    app.connect(agentSide);
    const conn = editor.connect(clientSide);

    /** Everything said so far, as one string, for a test that only cares that it was said. */
    const said = () => updates
        .map(u => (u.update as { content?: { text?: string } }).content?.text ?? '')
        .join('\n');

    let sessionId = '';

    await test('the editor initializes and is told what this agent can and cannot take', async () => {
        const r = await conn.agent.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
        assert(r.protocolVersion === 1, `expected protocol 1, got ${r.protocolVersion}`);
        assert(r.agentInfo?.name.includes('acp-worker'), `the editor should see which agent it got, saw ${r.agentInfo?.name}`);
        // The capabilities and the behaviour have to agree: bytes are refused below, so they are
        // declared off here rather than left for the editor to discover by losing an attachment.
        assert(r.agentCapabilities?.promptCapabilities?.image === false, 'images are declared off');
        assert(r.agentCapabilities?.promptCapabilities?.audio === false, 'and audio');
        assert(r.agentCapabilities?.promptCapabilities?.embeddedContext === true, 'embedded text does travel');
        assert(r.agentCapabilities?.loadSession === false, 'and loading a session back is declared off');
        assert((r.authMethods ?? []).length === 0, 'nothing for the editor to authenticate: the connector holds the credential');
    });

    await test('a new session is an AIMEAT exchange', async () => {
        const r = await conn.agent.request('session/new', { cwd: '/tmp/project', mcpServers: [] });
        assert(typeof r.sessionId === 'string' && r.sessionId.length > 0, 'a session id comes back');
        sessionId = r.sessionId;
    });

    await test('a prompt becomes a real task on the node, and the editor is told where it went', async () => {
        // The prompt is deliberately not awaited: it holds the editor's turn open until the work
        // settles, which is the behaviour under test. The worker settles it below.
        const turn = conn.agent.request('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: 'Rename the widget and update its tests.' }],
        });

        // Wait for the task to appear on the node, then act as the worker that picks it up.
        let taskId = '';
        for (let i = 0; i < 60 && !taskId; i++) {
            const list = await json(`/v1/agents/v2/tasks?assigned_to=${encodeURIComponent(worker.gaii)}`, { headers: authA });
            const found = (list.body?.data?.tasks as any[] | undefined)?.[0];
            if (found) taskId = found.taskId;
            else await new Promise(r => setTimeout(r, 100));
        }
        assert(!!taskId, 'the prompt should have created a task on the node');

        const stored = await json(`/v1/agents/v2/tasks/${taskId}`, { headers: authA });
        const task = stored.body.data.task;
        assert(task.createdBy === editorPrincipal.gaii, `created by the principal the editor runs as, got ${task.createdBy}`);
        assert(task.assignedTo === worker.gaii, 'and assigned to the agent it was pointed at');
        assert(task.input[0].text === 'Rename the widget and update its tests.', 'carrying the editor\'s prompt');
        assert(task.metadata?.source === 'acp', 'marked as having come from an editor');
        assert(task.metadata?.cwd === '/tmp/project', 'with the directory the editor was in');

        // The worker does the work, over REST, exactly as any runtime would.
        const moved = await json(`/v1/agents/v2/tasks/${taskId}/status`, {
            method: 'POST', headers: { Authorization: `Bearer ${worker.token}` },
            body: JSON.stringify({ status: 'working', statusMessage: 'Reading the widget.' }),
        });
        assert(moved.status === 200, `worker status ${moved.status}: ${JSON.stringify(moved.body?.error)}`);
        const done = await json(`/v1/agents/v2/tasks/${taskId}/status`, {
            method: 'POST', headers: { Authorization: `Bearer ${worker.token}` },
            body: JSON.stringify({ status: 'completed', result: [{ kind: 'text', text: 'Renamed it and the three tests that named it.' }] }),
        });
        assert(done.status === 200, `worker complete ${done.status}: ${JSON.stringify(done.body?.error)}`);

        const answer = await turn;
        assert(answer.stopReason === 'end_turn', `a finished task ends the turn, got ${answer.stopReason}`);

        const transcript = said();
        assert(transcript.includes(taskId), 'the editor was told which task its prompt became');
        assert(transcript.includes('Reading the widget.'), 'and what the worker said while working');
        assert(transcript.includes('Renamed it and the three tests that named it.'),
            `and the result itself, got: ${transcript.slice(0, 300)}`);
    });

    await test('a prompt the node cannot carry says so instead of losing it', async () => {
        const before = updates.length;
        const turn = conn.agent.request('session/prompt', {
            sessionId,
            prompt: [
                { type: 'text', text: 'Look at this screenshot.' },
                { type: 'image', mimeType: 'image/png', data: Buffer.from('not-really-a-png').toString('base64') },
            ],
        });

        // The text still travels, so a task appears; the image does not, and the editor is told.
        let taskId = '';
        for (let i = 0; i < 60 && !taskId; i++) {
            const list = await json(`/v1/agents/v2/tasks?assigned_to=${encodeURIComponent(worker.gaii)}&status=working`, { headers: authA });
            const found = (list.body?.data?.tasks as any[] | undefined)?.[0];
            if (found) taskId = found.taskId;
            else await new Promise(r => setTimeout(r, 100));
        }
        assert(!!taskId, 'the text part should still have become work');
        await json(`/v1/agents/v2/tasks/${taskId}/status`, {
            method: 'POST', headers: { Authorization: `Bearer ${worker.token}` },
            body: JSON.stringify({ status: 'completed', result: [{ kind: 'text', text: 'Done without the picture.' }] }),
        });
        await turn;

        const fresh = updates.slice(before)
            .map(u => (u.update as { content?: { text?: string } }).content?.text ?? '').join('\n');
        assert(fresh.toLowerCase().includes('image'),
            `the editor should be told the image did not travel, got: ${fresh.slice(0, 250)}`);
    });

    await test('cancelling in the editor cancels the task on the node', async () => {
        const turn = conn.agent.request('session/prompt', {
            sessionId, prompt: [{ type: 'text', text: 'Something long.' }],
        });
        let taskId = '';
        for (let i = 0; i < 60 && !taskId; i++) {
            const list = await json(`/v1/agents/v2/tasks?assigned_to=${encodeURIComponent(worker.gaii)}&status=working`, { headers: authA });
            const found = (list.body?.data?.tasks as any[] | undefined)?.[0];
            if (found) taskId = found.taskId;
            else await new Promise(r => setTimeout(r, 100));
        }
        assert(!!taskId, 'the task should exist before it can be cancelled');

        await conn.agent.notify('session/cancel', { sessionId });
        const answer = await turn;
        assert(answer.stopReason === 'cancelled', `the turn ends as cancelled, got ${answer.stopReason}`);

        const after = await json(`/v1/agents/v2/tasks/${taskId}`, { headers: authA });
        assert(after.body.data.task.status === 'cancelled',
            `and the task on the node is cancelled, got ${after.body.data.task.status}`);
    });

    await test('every turn of this editor session is one AIMEAT exchange', async () => {
        // The ACP session id IS the contextId, so a person reading the exchange back gets the whole
        // conversation rather than three unrelated tasks that happened to be near each other.
        const r = await json(`/v1/agents/v2/tasks?context_id=${encodeURIComponent(sessionId)}&limit=200`, { headers: authA });
        const tasks = r.body.data.tasks as any[];
        assert(tasks.length === 3, `three prompts, three tasks in one context, got ${tasks.length}`);
        assert(tasks.every(t => t.contextId === sessionId), 'all under the session');
    });

    await test('an editor pointed at another account\'s agent is refused, and told so', async () => {
        // The fence is the node's, not this process's: the ACP agent runs as ONE principal and
        // cannot be talked out of that, so the refusal that matters is the one the node gives when
        // that principal reaches for work on somebody else's account. An editor left waiting on a
        // silently dropped prompt is the failure this asserts against.
        const other = await setupOwner('b');
        const stranger = await addAgent(other.owner, other.ownerToken, 'not-yours');

        const misdirected = buildAimeatAcpAgent({
            client: new AimeatClient(BASE, editorPrincipal.token),
            agentGaii: stranger.gaii,
            agentLabel: 'not-yours',
            nodeLabel: 'localhost',
        });
        const seen: SessionNotification[] = [];
        const otherEditor = acpClient({ name: 'test-editor-2' })
            .onNotification('session/update', (ctx) => { seen.push(ctx.params); });
        const pair = streamPair();
        misdirected.connect(pair.agentSide);
        const otherConn = otherEditor.connect(pair.clientSide);

        await otherConn.agent.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
        const opened = await otherConn.agent.request('session/new', { cwd: '/tmp/other', mcpServers: [] });
        const answer = await otherConn.agent.request('session/prompt', {
            sessionId: opened.sessionId,
            prompt: [{ type: 'text', text: 'Do something on an account that is not mine.' }],
        });
        assert(answer.stopReason === 'refusal', `expected a refusal, got ${answer.stopReason}`);
        const told = seen.map(u => (u.update as { content?: { text?: string } }).content?.text ?? '').join(' | ');
        assert(told.toLowerCase().includes('would not take'),
            `and the editor should be told why, got: ${told.slice(0, 250)}`);

        // And nothing was created on the other account.
        const theirs = await json('/v1/agents/v2/tasks?limit=200', { headers: { Authorization: `Bearer ${other.ownerToken}` } });
        assert((theirs.body.data.tasks as any[]).length === 0, 'no task landed on the other account');

        // The fence itself, named rather than inferred from a stop reason: what the ACP path relies
        // on is the node answering 403 to this principal reaching for that agent, and ACP has no
        // status codes to carry that up to the editor.
        const direct = await json('/v1/agents/v2/tasks', {
            method: 'POST', headers: { Authorization: `Bearer ${editorPrincipal.token}` },
            body: JSON.stringify({ assignedTo: stranger.gaii, input: [{ kind: 'text', text: 'direct' }] }),
        });
        assert(direct.status === 403, `the node refuses it with 403, got ${direct.status}`);
    });

    await test('a prompt for a session nobody opened is refused, not guessed at', async () => {
        const answer = await conn.agent.request('session/prompt', {
            sessionId: 'not-a-session',
            prompt: [{ type: 'text', text: 'hello' }],
        });
        assert(answer.stopReason === 'refusal', `expected a refusal, got ${answer.stopReason}`);
    });
}

run().then(() => {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
    console.error('Suite crashed:', err);
    process.exit(1);
});
