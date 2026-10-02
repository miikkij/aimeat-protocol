/**
 * @file test/e2e-chat-agent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A chat turn with an agent actually answering: the handshake, the session, the
 *   callbacks, the attachments, the cancel, and the death of the agent mid-turn.
 *
 *   WHY THIS SUITE EXISTS. `chatEnabled()` is `!!config.gooseBin`, and no node in the whole E2E sweep
 *   has one, so every turn returned at chat-session.ts's third line and nothing below it had ever
 *   executed under test: the ACP client, the card recogniser, the attachment reader and the three
 *   file-text extractors were reachable only by installing goose. test/e2e-chat.ts asserts the doors
 *   around the agent and says so in its own header; this suite is the other half, and the two are
 *   deliberately separate, because a node with an agent cannot also prove what a node without one
 *   says.
 *
 *   IT RUNS ITS OWN NODE because AIMEAT_GOOSE_BIN is process-wide configuration, and it runs TWO:
 *   one pointed at the fake agent (test/helpers/fake-goose-acp.ts), and a second pointed at a path
 *   that names no binary at all, which is the only way to reach the child `error` handler. Both are
 *   SQLite whichever backend the runner was started with: what is under test is a child process and
 *   the ordering of a stream, which no storage provider changes.
 *
 *   THE SHIM IS NOT A SHELL SCRIPT. goose-acp spawns `spawn(bin, ['acp'])` with the arguments fixed,
 *   and Node 24 on Windows refuses to spawn a .cmd or .bat without `shell:true`. So `bin` is node
 *   itself and NODE_OPTIONS carries the peer, which claims the process when the entry point is
 *   called `acp`. One mechanism, both platforms, nothing to mark executable.
 *
 *   E2E_CHAT_AGENT_PORT moves the set (default 40300, the broken node one port above, the node-route
 *   node two above and its stub AI provider three above).
 * @structure
 *   - the node lifecycle: startNode(), stopNode()
 *   - the owner, the uploads, and the SSE reader
 *   - Phase 1, against the fake agent: the turn, the callbacks, the attachments, cancel, reset, death
 *   - Phase 2, against a binary that does not exist
 *   - Phase 3, the node route (no shared key): a process per person, its model calls through
 *     /v1/llm with that person's token, metered to them, and the "the node's chat" policy switch
 * @usage
 *   cd aimeat && node --import tsx test/e2e-chat-agent.ts
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=chat-agent
 * @version-history
 *   v1.3.0 — 2026-10-02 — The cancel is counted as the notification goose obeys, and asserted to stop
 *     the agent; the turn ceiling: asked for an answer past twelve tool calls, and ended by the node
 *     in the person's language when even that does not answer.
 *   v1.2.0 — 2026-09-28 — System 2 plan, V5: phase 3, the node route.
 *   v1.1.0 — 2026-09-16 — The agent child receives no AIMEAT_* value and no DATABASE_URL.
 *   v1.0.0 — 2026-09-08 — Initial.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { waitForServer } from './helpers/wait-for-server.js';
import { startFakeAiProvider, type FakeAiProvider } from './helpers/fake-ai-provider.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = Number(process.env.E2E_CHAT_AGENT_PORT ?? 40300);
const BROKEN_PORT = PORT + 1;
const NODE_ID = 'aimeat-local-001-dev';
const PEER = pathToFileURL(resolvePath(process.cwd(), 'test/helpers/fake-goose-acp.ts')).href;
const FIXTURES = resolvePath(process.cwd(), 'test/fixtures/file-text');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** A 1x1 PNG, so the picture branch has real bytes with a real mime. */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }
function sleep(ms: number): Promise<void> { return new Promise((r) => { setTimeout(r, ms); }); }

// ─── The nodes ────────────────────────────────────────────────────────────────

interface Node {
    proc: ChildProcess;
    base: string;
    dbDir: string;
    peerLog: string;
    output: () => string;
}

async function startNode(opts: {
    port: number; gooseBin: string; tag: string; sharedKey?: boolean; extraEnv?: Record<string, string>;
}): Promise<Node> {
    const dbDir = mkdtempSync(join(tmpdir(), `aimeat-chatagent-${opts.tag}-`));
    const peerLog = join(dbDir, 'peer.jsonl');
    const base = `http://127.0.0.1:${opts.port}`;
    let output = '';

    const proc = spawn(process.execPath, [
        'src/index.ts', 'start', '--db', 'sqlite', '--db-path', join(dbDir, 'chat.db'), '--port', String(opts.port),
    ], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            // tsx comes from here rather than from the command line, because the same NODE_OPTIONS is
            // what carries the peer into the agent child this node spawns. Whatever NODE_OPTIONS the
            // suite itself was given stays in front: under `pnpm test:e2e:coverage` that is the
            // coverage preload, and replacing it made this node the one node in the sweep that
            // wrote no snapshot (measured 2026-09-08: goose-acp read 15 of 17 functions uncalled).
            NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import tsx --import ${PEER}`.trim(),
            FAKE_GOOSE_LOG: peerLog,
            AIMEAT_PORT: String(opts.port),
            AIMEAT_BASE_URL: base,
            AIMEAT_NODE_ID: NODE_ID,
            AIMEAT_DB: 'sqlite',
            AIMEAT_DB_PATH: join(dbDir, 'chat.db'),
            // The warnings this suite asserts on are logged at info and warn.
            AIMEAT_LOG_LEVEL: 'info',
            AIMEAT_ENCRYPTION_KEY: process.env.AIMEAT_ENCRYPTION_KEY
                ?? '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20',
            AIMEAT_DEFAULT_AGENT_SCOPES: '*',
            AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000',
            // The whole point of a node of our own.
            AIMEAT_GOOSE_BIN: opts.gooseBin,
            AIMEAT_GOOSE_MODEL: 'fake/model-1',
            AIMEAT_GOOSE_PROVIDER: 'fake-provider',
            // Empty is the node route: each person's agent calls this node's /v1/llm (phase 3).
            AIMEAT_GOOSE_PROVIDER_API_KEY: opts.sharedKey === false ? '' : 'sk-fake-e2e-key',
            AIMEAT_GOOSE_PATH_ROOT: dbDir,
            // The fake agent writes its log where this names. The child's environment is an
            // allow-list now, so the name is passed the way a host passes a provider key.
            AIMEAT_GOOSE_ENV_PASSTHROUGH: 'FAKE_GOOSE_LOG',
            ...(opts.extraEnv ?? {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout?.on('data', (c: Buffer) => { output += c.toString(); });
    proc.stderr?.on('data', (c: Buffer) => { output += c.toString(); });

    await waitForServer(proc, base, { label: `the node on port ${opts.port}` });
    return { proc, base, dbDir, peerLog, output: () => output };
}

/**
 * Stop a node and wait for it to be GONE.
 *
 * The exit is awaited rather than assumed: the coverage preload is given four seconds to write its
 * snapshot when the process is signalled, and exiting the suite before that throws the measurement
 * this suite exists to produce.
 */
async function stopNode(node: Node | null): Promise<void> {
    if (!node) return;
    if (node.proc.exitCode === null && !node.proc.killed) {
        node.proc.kill();
        await Promise.race([once(node.proc, 'exit'), sleep(10_000)]);
    }
    try { rmSync(node.dbDir, { recursive: true, force: true }); } catch { /* the OS will get it */ }
}

// ─── Talking to one of them ───────────────────────────────────────────────────

let BASE = '';
let token = '';
const authed = (o: RequestInit = {}): RequestInit => ({
    ...o,
    headers: { 'Content-Type': 'application/json', ...((o.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` },
});

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
            break;
        } catch (err) {
            // The node is still standing extensions up for a few seconds after /v1/spec answers.
            if (attempt === 4) throw err;
            await sleep(500);
        }
    }
    if (!res) throw new Error('unreachable');
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body };
}

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body).slice(0, 200)}`);
    const priv = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(name + NODE_ID + timestamp), Buffer.from(priv, 'base64'));
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp, signature: Buffer.from(sig).toString('base64') }),
    });
    assert(tok.body?.ok === true, `token ${name}: ${JSON.stringify(tok.body?.error)}`);
    return tok.body.data.token as string;
}

async function upload(key: string, bytes: Buffer, mimeType: string): Promise<void> {
    const { status, body } = await json('/v1/storage', authed({
        method: 'POST',
        body: JSON.stringify({ key, data: bytes.toString('base64'), mime_type: mimeType }),
    }));
    assert(status === 201, `upload ${key}: ${status} ${JSON.stringify(body?.error)}`);
}

interface StreamEvent { kind: string; [k: string]: any }

function parseEvents(text: string): StreamEvent[] {
    return text.split('\n\n')
        .filter((frame) => frame.startsWith('data:'))
        .map((frame) => JSON.parse(frame.slice(5).trim()) as StreamEvent);
}

/** One turn, read to the end. */
async function turn(threadId: string, body: Record<string, unknown>): Promise<StreamEvent[]> {
    const res = await fetch(`${BASE}/v1/chat/threads/${threadId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });
    assert(res.status === 200, `the stream opens with 200, got ${res.status}`);
    return parseEvents(await res.text());
}

/**
 * Start a turn, wait for the agent to say something, then leave, which is what Stop does.
 *
 * The connection is ABORTED rather than the body reader cancelled. Cancelling the reader lets the
 * socket sit there being drained, and the node then notices the person has gone only when its next
 * keepalive write fails, fifteen seconds later. An abort destroys the socket, which is what a
 * browser does when the tab closes and the only thing that makes `req.on('close')` immediate.
 */
async function turnAndLeave(threadId: string, text: string): Promise<void> {
    const leaving = new AbortController();
    const res = await fetch(`${BASE}/v1/chat/threads/${threadId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text }),
        signal: leaving.signal,
    });
    assert(res.status === 200, `the stream opens with 200, got ${res.status}`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let seen = '';
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += decoder.decode(value, { stream: true });
        if (seen.includes('"kind":"text"')) break;
    }
    assert(seen.includes('"kind":"text"'), `the agent said something before the page was left, got ${seen.slice(0, 200)}`);
    leaving.abort();
}

async function readThread(threadId: string): Promise<any> {
    const { body } = await json(`/v1/chat/threads/${threadId}`, authed());
    return body.data?.thread;
}

// ─── What the peer wrote down ─────────────────────────────────────────────────

let peerLogPath = '';
function peerEntries(): any[] {
    if (!existsSync(peerLogPath)) return [];
    return readFileSync(peerLogPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function peerRequests(method: string): any[] {
    return peerEntries().filter((e) => e.kind === 'request' && e.method === method);
}
/** What the node sent without an id. `session/cancel` is one of these in ACP, and goose refuses it as a request. */
function peerNotifications(method: string): any[] {
    return peerEntries().filter((e) => e.kind === 'notification' && e.method === method);
}
function lastPromptText(): string {
    const prompts = peerRequests('session/prompt');
    assert(prompts.length > 0, 'the agent was asked something');
    const blocks: any[] = prompts.at(-1)!.params.prompt ?? [];
    return blocks.filter((b) => b?.type === 'text').map((b) => String(b.text)).join('\n');
}
// ─── The run ──────────────────────────────────────────────────────────────────

console.log('\n=== A chat turn with an agent answering: ACP, attachments, cancel, death ===\n');

let node: Node | null = null;
let broken: Node | null = null;

async function run(): Promise<void> {
    node = await startNode({ port: PORT, gooseBin: process.execPath, tag: 'fake' });
    BASE = node.base;
    peerLogPath = node.peerLog;

    const ownerName = `chatag${Date.now() % 100000}`;
    let threadId = '';

    await test('setup: an owner, and a node that says it has an agent', async () => {
        token = await registerOwner(ownerName);
        const { status, body } = await json('/v1/chat/status', authed());
        assert(status === 200, `status ${status}`);
        assert(body.data.enabled === true, `the node reports an agent, got ${JSON.stringify(body.data.enabled)}`);
        assert(body.data.note === undefined, `a configured node explains nothing away, got ${body.data.note}`);
        assert(body.data.model === 'fake/model-1', `it names the model the operator chose, got ${body.data.model}`);
        const created = await json('/v1/chat/threads', authed({ method: 'POST', body: JSON.stringify({ title: 'agent' }) }));
        assert(created.status === 201, `create ${created.status}`);
        threadId = created.body.data.thread.id;
    });

    await test('a turn streams the thinking, the words, the tool call and a verdict', async () => {
        const events = await turn(threadId, { text: 'build me a pong game' });
        const kinds = events.map((e) => e.kind);
        assert(kinds.includes('thought'), `the thinking is carried, got ${kinds.join(',')}`);
        assert(kinds.includes('text'), `the words are carried, got ${kinds.join(',')}`);
        assert(kinds.includes('tool_call'), `the tool calls are carried, got ${kinds.join(',')}`);

        const said = events.filter((e) => e.kind === 'text').map((e) => e.text).join('');
        // The words after a round of tool calls are a new paragraph (chat-session.ts v1.8.0): a model
        // asked to say what it is doing between its steps writes a sentence before each round, and
        // without the break the next one is glued to its full stop.
        assert(said === 'Here is \n\nyour game.', `the chunks arrive in order, got ${JSON.stringify(said)}`);

        const done = events.at(-1)!;
        assert(done.kind === 'done', `the turn ends with a verdict, got ${done.kind}`);
        assert(done.stopReason === 'end_turn', `the stop reason is the agent's, got ${done.stopReason}`);
        assert(done.tokens === 1234, `the token count survives the flattening, got ${done.tokens}`);
    });

    await test('an update kind nobody has taught it about is kept, not dropped', async () => {
        // usage_update, session_info_update, and whatever goose adds next. The chat shows spend from
        // these, so a client that drops what it does not recognise loses the feature silently.
        const events = await turn(threadId, { text: 'again' });
        const other = events.find((e) => e.kind === 'other');
        assert(!!other, `an unrecognised update arrives as "other", got ${events.map((e) => e.kind).join(',')}`);
        assert(other!.type === 'usage_update', `it keeps its own name, got ${other!.type}`);
        assert(other!.raw?.usage?.totalTokens === 11, `and its payload, got ${JSON.stringify(other!.raw)}`);
    });

    await test('a finished tool call hands over the thing it made, as a card', async () => {
        const events = await turn(threadId, { text: 'publish it' });
        const calls = events.filter((e) => e.kind === 'tool_call');
        const pending = calls.find((e) => e.status === 'pending');
        const completed = calls.find((e) => e.status === 'completed');
        assert(!!pending && !!completed, `both halves of the call arrive, got ${calls.map((c) => c.status).join(',')}`);
        assert(pending!.card === null, `a call still running has nothing to open yet, got ${JSON.stringify(pending!.card)}`);
        assert(completed!.card?.kind === 'app', `the finished call produced an app card, got ${JSON.stringify(completed!.card)}`);
        assert(completed!.card.title === 'pong.html', `named by its file, got ${completed!.card.title}`);
        assert(completed!.card.url === 'https://apps.example.test/pong', `carrying the address from the payload, got ${completed!.card.url}`);
    });

    await test('the client declares no filesystem, and answers both of the agent\'s callbacks', async () => {
        const init = peerRequests('initialize').at(0);
        assert(!!init, 'the handshake happened');
        assert(init.params.clientCapabilities?.fs?.readTextFile === false,
            `it says out loud that it cannot read files, got ${JSON.stringify(init.params.clientCapabilities)}`);

        const perm = peerEntries().filter((e) => e.kind === 'permission-answer').at(-1);
        assert(!!perm, 'the permission request was answered');
        assert(perm.result?.outcome?.outcome === 'selected', `permission is granted, got ${JSON.stringify(perm.result)}`);
        // allow_once was listed FIRST by the peer: taking allow_always proves a preference rather
        // than a client that picks whatever came first.
        assert(perm.result.outcome.optionId === 'always',
            `it prefers allow_always over the first option, got ${perm.result.outcome.optionId}`);

        const fs = peerEntries().filter((e) => e.kind === 'fs-answer').at(-1);
        assert(!!fs, 'the file read was answered');
        assert(fs.error?.code === -32601, `a file read is refused, got ${JSON.stringify(fs)}`);
    });

    await test('the session carries this person\'s own MCP token, and the operator\'s model reaches the process', async () => {
        const created = peerRequests('session/new').at(0);
        assert(!!created, 'a session was created');
        const server = (created.params.mcpServers ?? [])[0];
        assert(server?.name === 'aimeat' && server.type === 'http', `the node's own MCP surface is handed over, got ${JSON.stringify(server)}`);
        // The chat surface (2026-10-02): a small core listed, the rest switched on by purpose.
        assert(server.url === `${BASE}/v2/mcp/chat`, `at this node's chat surface, got ${server.url}`);
        const auth = (server.headers ?? []).find((h: any) => h.name === 'Authorization');
        assert(!!auth && auth.value.startsWith('Bearer ') && auth.value.length > 40, `with a bearer token, got ${JSON.stringify(auth)}`);
        assert(auth.value !== `Bearer ${token}`, 'and it is the agent\'s token, never the owner\'s browser session');

        const started = peerEntries().find((e) => e.kind === 'started');
        assert(started.env.GOOSE_MODEL === 'fake/model-1', `the model is passed in the env, got ${started.env.GOOSE_MODEL}`);
        assert(started.env.GOOSE_PROVIDER === 'fake-provider', `so is the provider, got ${started.env.GOOSE_PROVIDER}`);
        assert(started.env.OPENROUTER_API_KEY === 'sk-fake-e2e-key', `and the key it spends, got ${started.env.OPENROUTER_API_KEY}`);
        assert(typeof started.env.GOOSE_PATH_ROOT === 'string' && started.env.GOOSE_PATH_ROOT.length > 0,
            `and the path root, got ${started.env.GOOSE_PATH_ROOT}`);
        // THE LEAK: the child had the node's whole environment, database address and keys included.
        assert(Array.isArray(started.leaked) && started.leaked.length === 0,
            `the agent must not receive the node's own configuration, got ${JSON.stringify(started.leaked)}`);
    });

    await test('an MCP server that failed to load is said out loud, and a human line on stdout is not an error', async () => {
        const log = node!.output();
        assert(log.includes('extension "broken-mcp" failed to load: the node was not reachable'),
            'the failed extension is named in the log, which is the only place it shows');
        assert(log.includes('starting the model, this may take a moment'),
            'a non-JSON line on stdout is logged rather than breaking the stream');
        assert(log.includes('fake-goose: warming up the model'), 'and the agent\'s stderr reaches the node\'s log');
    });

    await test('the conversation keeps what was said, the tools that ran, the card and the model', async () => {
        const thread = await readThread(threadId);
        const turns: any[] = thread.turns;
        const mine = turns.filter((t) => t.role === 'user');
        const theirs = turns.filter((t) => t.role === 'agent');
        assert(mine.length >= 3 && theirs.length >= 3, `both sides are written down, got ${turns.length} turns`);
        assert(mine[0].text === 'build me a pong game', `the person's own words, got ${mine[0].text}`);

        const last = theirs.at(-1);
        assert(last.text === 'Here is \n\nyour game.', `the answer as it was streamed, got ${JSON.stringify(last.text)}`);
        assert(last.model === 'fake/model-1', `the model the node chose, got ${last.model}`);
        // One entry, not two: the call arrives twice and only the first carries a title, so a log
        // keyed by title leaves every call reading "starting" whatever happened to it.
        assert(Array.isArray(last.tools) && last.tools.length === 1, `one tool call, not one per event, got ${JSON.stringify(last.tools)}`);
        assert(last.tools[0].title === 'aimeat_app_publish', `the title from the opening event, got ${last.tools[0].title}`);
        assert(last.tools[0].status === 'completed', `the status from the closing one, got ${last.tools[0].status}`);
        assert(Array.isArray(last.cards) && last.cards[0]?.title === 'pong.html', `the card is kept, got ${JSON.stringify(last.cards)}`);
    });

    // ── What a person attaches ──

    await test('setup: the files a person would attach are in their own storage', async () => {
        await upload('chat-files/sales.xlsx', readFileSync(join(FIXTURES, 'sales.xlsx')), XLSX_MIME);
        await upload('chat-files/contract.docx', readFileSync(join(FIXTURES, 'contract.docx')), DOCX_MIME);
        await upload('chat-files/tracked.docx', readFileSync(join(FIXTURES, 'tracked.docx')), DOCX_MIME);
        await upload('chat-files/invoice.pdf', readFileSync(join(FIXTURES, 'invoice.pdf')), 'application/pdf');
        await upload('chat-files/shot.png', Buffer.from(PNG_B64, 'base64'), 'image/png');
        await upload('chat-files/rows.csv', Buffer.from('nimi,summa\nKahvi,3\n', 'utf8'), 'text/csv');
        await upload('chat-files/big.txt', Buffer.alloc(250 * 1024, 'a'), 'text/plain');
        await upload('chat-files/broken.xlsx', Buffer.from('this is not a spreadsheet', 'utf8'), XLSX_MIME);
        await upload('chat-files/old.xls', Buffer.from('an ancient binary sheet', 'utf8'), 'application/vnd.ms-excel');
        await upload('chat-files/thing.bin', Buffer.from([0, 1, 2, 3, 4]), 'application/octet-stream');
        for (const n of [1, 2, 3, 4]) await upload(`chat-files/extra${n}.txt`, Buffer.from(`extra file ${n}`, 'utf8'), 'text/plain');

        // They have to be in the OWNER's own namespace, because that is where the turn reads them
        // from: readAttachments asks storage for `<owner gaii>` and the key, and nothing else.
        const { body } = await json('/v1/storage', authed());
        const keys: string[] = body.data.files.map((f: any) => f.key);
        assert(keys.includes('chat-files/sales.xlsx') && keys.includes('chat-files/shot.png'),
            `the files are the person's own, got ${keys.length} file(s)`);
    });

    await test('a spreadsheet, two Word documents and a PDF reach the model as text', async () => {
        const events = await turn(threadId, {
            text: 'what do these say?',
            attachments: ['chat-files/sales.xlsx', 'chat-files/contract.docx', 'chat-files/tracked.docx', 'chat-files/invoice.pdf'],
        });
        assert(events.at(-1)!.kind === 'done', `the turn finished, got ${JSON.stringify(events.at(-1))}`);
        const prompt = lastPromptText();

        assert(prompt.includes('Attached spreadsheet: chat-files/sales.xlsx'), 'the sheet is labelled as what it is');
        assert(prompt.includes('## Sheet: Myynti'), 'and arrives sheet by sheet');
        assert(prompt.includes('Asiakas,Päivä,Summa,Maksettu,Huomio'), 'as CSV, with its heading row');
        assert(prompt.includes('2026-08-17'), 'a date is a date rather than the number 46251');
        assert(prompt.includes('Smith & Co') && !prompt.includes('&amp;'), 'entities are decoded');
        assert(prompt.includes('Kärkkäinen Oy'), 'and non-ASCII survives the trip through storage and JSON');

        assert(prompt.includes('Attached Word document: chat-files/contract.docx'), 'the document is labelled');
        assert(prompt.includes('Tämä on erittäin tärkeä sopimus & liite.'), 'a word split across two runs is rejoined');
        assert(prompt.includes('Kahvi\t3\t12,50'), 'a table keeps its rows');
        assert(prompt.includes('250') && !prompt.includes('vanha hinta 100'), 'a tracked edit is applied, not undone');

        assert(prompt.includes('Attached PDF: chat-files/invoice.pdf'), 'the PDF is labelled');
        assert(prompt.includes('Lasku 2026-114') && prompt.includes('Toinen sivu'), 'and comes out across every page');
    });

    await test('a picture goes as bytes and a CSV goes as text, in the same turn', async () => {
        await turn(threadId, { text: 'and these?', attachments: ['chat-files/shot.png', 'chat-files/rows.csv'] });
        const params = peerRequests('session/prompt').at(-1)!.params;
        const blocks: any[] = params.prompt;
        const image = blocks.find((b) => b.type === 'image');
        assert(!!image, `the picture is an ACP image block, got ${blocks.map((b) => b.type).join(',')}`);
        assert(image.mimeType === 'image/png', `carrying its type, got ${image.mimeType}`);
        assert(image.data === PNG_B64, 'and the exact bytes that were uploaded, not a link the model cannot fetch');
        const prompt = lastPromptText();
        assert(prompt.includes('Attached file: chat-files/rows.csv'), 'the CSV is quoted under its own name');
        assert(prompt.includes('nimi,summa'), 'with its content');
    });

    await test('a file nothing can read is named to the agent rather than dropped', async () => {
        await turn(threadId, {
            text: 'and this lot?',
            attachments: ['chat-files/big.txt', 'chat-files/broken.xlsx', 'chat-files/old.xls', 'chat-files/thing.bin'],
        });
        const prompt = lastPromptText();
        assert(prompt.includes('Attached file: chat-files/big.txt (first 200 kB of 250 kB)'),
            'a long text file says how much of it the model is seeing');
        assert(prompt.includes('An attached spreadsheet (chat-files/broken.xlsx) was not read because'),
            'a spreadsheet that will not open is reported, not thrown');
        assert(prompt.includes('older Office format'), 'a .xls gets the one sentence the person can act on');
        assert(prompt.includes('chat-files/thing.bin (application/octet-stream)'),
            'and a format nobody here reads is named so the agent can admit it never saw it');
        assert(prompt.includes('you have not seen them'), 'in a sentence that says exactly that');
    });

    await test('four files is the ceiling, and a key that resolves to nothing is skipped quietly', async () => {
        const keys = ['chat-files/missing.txt', 'chat-files/extra1.txt', 'chat-files/extra2.txt', 'chat-files/extra3.txt', 'chat-files/extra4.txt'];
        await turn(threadId, { text: 'the last lot', attachments: keys });
        const prompt = lastPromptText();
        assert(prompt.includes('extra file 1') && prompt.includes('extra file 3'), 'the first four are read');
        assert(!prompt.includes('extra file 4'), 'the fifth never reaches the model');
        assert(!prompt.includes('chat-files/missing.txt'), 'a key with no file behind it is not reported to the agent: it is our bug, not theirs');
        assert(node!.output().includes('attachment not found'), 'it is logged on our side instead');

        const thread = await readThread(threadId);
        const mine = (thread.turns as any[]).filter((t) => t.role === 'user').at(-1);
        assert(mine.attachments.length === 4, `the record keeps the four that counted, got ${JSON.stringify(mine.attachments)}`);
    });

    // ── Stopping, resetting, dying ──

    await test('leaving the page reaches the agent: the turn is cancelled, not paid for in silence', async () => {
        // Closing the stream aborts the turn and `cancel()` tells goose to stop (routes/chat.ts
        // v1.2.0, chat-session.ts v1.2.0). This asserted a hole first, on 2026-09-08: the route
        // listened for `close` on the REQUEST, which on Express 5 fires once as soon as the body is
        // read, before the handler's awaits return, so the person leaving was never seen and the
        // agent went on for the whole turn. Fixed in routes/chat.ts v1.6.0 (`res.on('close')`).
        //
        // It asserted a second hole on 2026-10-02: the node sent `session/cancel` as a request, real
        // goose 1.50.0 answers that with "-32601: Method not found", and the peer here had answered
        // it as a request too, so this test passed while no cancel had ever reached goose. In ACP the
        // cancel is a notification; the peer now refuses the request form the way goose does.
        const before = peerNotifications('session/cancel').length;
        const stalls = peerEntries().filter((e) => e.kind === 'stall-ended').length;
        await turnAndLeave(threadId, 'STALL: keep going until I stop you');
        const deadline = Date.now() + 6_000;
        while (peerNotifications('session/cancel').length === before && Date.now() < deadline) await sleep(250);
        assert(peerNotifications('session/cancel').length === before + 1,
            `the agent is told to stop once the person has gone, cancels seen: ${peerNotifications('session/cancel').length - before}`);
        while (peerEntries().filter((e) => e.kind === 'stall-ended').length === stalls && Date.now() < deadline + 4_000) await sleep(250);
        const ended = peerEntries().filter((e) => e.kind === 'stall-ended').at(-1);
        assert(ended?.cancelled === true, `and the agent stopped because of it, got ${JSON.stringify(ended)}`);

        await sleep(2_000);
        const thread = await readThread(threadId);
        const stalled = (thread.turns as any[]).filter((t) => t.role === 'agent').at(-1);
        assert(!stalled?.text?.includes('....'),
            `nothing keeps being written after the person left, got ${JSON.stringify(stalled?.text)}`);
    });

    // ── The turn ceiling (services/chat-turn-guard.ts) ──
    //
    // Measured 2026-10-02 on a real model (scripts/chat-turn-measure.ts): a request for a new agent
    // ran 149 s, 12 tool calls and six model rounds, with its first word at 141.8 s and no proposal.
    // These two hold what the node does about it with a model that never stops on its own.

    await test('a turn that keeps calling tools is stopped, asked for an answer, and answers', async () => {
        const created = await json('/v1/chat/threads', authed({ method: 'POST', body: JSON.stringify({ title: 'loop' }) }));
        const loopThread = created.body.data.thread.id as string;
        const prompts = peerRequests('session/prompt').length;
        const events = await turn(loopThread, { text: 'LOOPTOOLS: find my CRM', lang: 'en' });
        const kinds = events.map((e) => e.kind);

        const firstText = kinds.indexOf('text');
        const start = events.findIndex((e) => e.kind === 'progress' && e.step === 'start');
        assert(start >= 0 && start < firstText, `the node speaks before the agent does, got ${kinds.slice(0, 8).join(',')}`);
        assert(events[start].text === 'On it. I\'ll look at what you have here first.', `in the page's language, got ${JSON.stringify(events[start].text)}`);
        assert(events.some((e) => e.kind === 'progress' && e.step === 'reading'), 'a reading call gets its line');
        const guard = events.find((e) => e.kind === 'guard');
        assert(guard?.phase === 'wrap_up' && guard.reason === 'tool_calls', `the ceiling is the tool calls, got ${JSON.stringify(guard)}`);
        const calls = new Set(events.filter((e) => e.kind === 'tool_call').map((e) => e.id));
        assert(calls.size >= 13 && calls.size <= 15, `it stops just past twelve calls, got ${calls.size}`);
        assert(peerEntries().filter((e) => e.kind === 'loop-ended').at(-1)?.cancelled === true, 'the agent was cancelled, not left running');

        const asked = peerRequests('session/prompt').slice(prompts).map((p) => (p.params.prompt as any[]).map((b) => b.text ?? '').join('\n'));
        assert(asked.length === 2, `two prompts in this turn, the question and the request for an answer, got ${asked.length}`);
        assert(asked[0].includes('[A note from this node, not from the person]'), 'the first prompt carries the turn note');
        assert(asked[1].includes('stop looking for more') && asked[1].includes('aimeat_agent_propose'), 'the second asks for an answer and names the proposal');
        assert(peerRequests('session/prompt').slice(prompts).every((p) => p.params.sessionId === peerRequests('session/prompt').at(-1)!.params.sessionId),
            'both in the same session, so the answer is built on what the agent found');

        const said = events.filter((e) => e.kind === 'text').map((e) => e.text).join('');
        assert(said === 'I will look first.\n\nHere is what I found.', `the agent's words, a paragraph apart, got ${JSON.stringify(said)}`);
        const done = events.at(-1)!;
        assert(done.kind === 'done' && done.stopReason === 'end_turn', `one verdict, the answer's, got ${JSON.stringify(done)}`);
        assert(kinds.filter((k) => k === 'done').length === 1, 'the cancelled first phase ends no turn of its own');

        const thread = await readThread(loopThread);
        const saved = (thread.turns as any[]).filter((t) => t.role === 'agent').at(-1);
        assert(saved.text === said, `the record keeps the words and no progress line, got ${JSON.stringify(saved.text)}`);
    });

    await test('a turn that does not answer even when asked is ended by the node, in the person\'s language', async () => {
        const created = await json('/v1/chat/threads', authed({ method: 'POST', body: JSON.stringify({ title: 'loop all' }) }));
        const loopThread = created.body.data.thread.id as string;
        const events = await turn(loopThread, { text: 'LOOPALL: find my CRM', lang: 'fi' });
        const guards = events.filter((e) => e.kind === 'guard');
        assert(guards.length === 2 && guards[0].phase === 'wrap_up' && guards[1].phase === 'stopped',
            `asked once, then stopped, got ${JSON.stringify(guards)}`);
        assert(events.find((e) => e.kind === 'progress' && e.step === 'start')?.text === 'Selvä. Katson ensin, mitä sinulla on täällä.',
            'the progress lines are in Finnish');
        const said = events.filter((e) => e.kind === 'text').map((e) => e.text).join('');
        assert(said.startsWith('I will look first.') && said.includes('Lopetin tähän, koska tämä kesti liian kauan'),
            `the turn ends in words, the node's own, got ${JSON.stringify(said)}`);
        const done = events.at(-1)!;
        assert(done.kind === 'done' && done.stopReason === 'max_turn_requests', `the verdict says why, got ${JSON.stringify(done)}`);
        const ended = peerEntries().filter((e) => e.kind === 'loop-ended').slice(-2);
        assert(ended.length === 2 && ended.every((e) => e.cancelled === true), `both phases were cancelled, got ${JSON.stringify(ended)}`);
    });

    await test('a reset makes the next turn open a fresh session, and keeps the conversation', async () => {
        const before = peerRequests('session/new').length;
        const reset = await json(`/v1/chat/threads/${threadId}/reset`, authed({ method: 'POST' }));
        assert(reset.status === 200, `reset ${reset.status}`);
        const events = await turn(threadId, { text: 'still there?' });
        assert(events.at(-1)!.kind === 'done', `the turn ran on the new session, got ${JSON.stringify(events.at(-1))}`);
        assert(peerRequests('session/new').length === before + 1,
            `exactly one new session was opened, got ${peerRequests('session/new').length - before}`);
        const prompt = peerRequests('session/prompt').at(-1)!;
        assert(prompt.params.sessionId !== peerRequests('session/prompt').at(0)!.params.sessionId,
            'and the turn runs on it rather than on the session the scopes were minted for');
        const thread = await readThread(threadId);
        assert((thread.turns as any[]).length > 0, 'the conversation itself is untouched');
    });

    await test('an agent that dies mid-turn ends the turn with the reason', async () => {
        const events = await turn(threadId, { text: 'DIENOW: fall over please' });
        const last = events.at(-1)!;
        assert(last.kind === 'error', `the turn ends as an error, got ${last.kind}`);
        assert(/exited/.test(String(last.message)), `and says the agent exited, got ${JSON.stringify(last.message)}`);
    });

    await test('after that death the next turn starts another agent', async () => {
        // This asserted a hole first, on 2026-09-08: chat-session kept the one client in a
        // module-level variable and nothing cleared it when the child exited, so every later turn
        // was refused with "goose agent is not running" until the node restarted. Fixed in
        // chat-session.ts v1.5.0: a closed client is dropped and the next turn starts a process.
        const starts = peerRequests('initialize').length;
        const events = await turn(threadId, { text: 'are you back?' });
        const last = events.at(-1)!;
        assert(last.kind === 'done', `the turn completes on a fresh process, got ${last.kind}: ${JSON.stringify(last)}`);
        assert(peerRequests('initialize').length === starts + 1,
            `exactly one more process was started, got ${peerRequests('initialize').length - starts}`);
    });

    await test('a thread is its owner\'s: no credential is 401, another owner cannot read it', async () => {
        const anonymous = await json(`/v1/chat/threads/${threadId}`);
        assert(anonymous.status === 401, `no credential: ${anonymous.status}`);
        const other = await registerOwner(`chatother${Date.now() % 100000}`);
        // A thread is read under the caller's own identity, so another owner sees nothing at all:
        // 404 rather than 403, and the same on the write door (routes/chat.ts, "No such conversation").
        const stranger = await json(`/v1/chat/threads/${threadId}`, { headers: { Authorization: `Bearer ${other}` } });
        assert(stranger.status === 404, `another owner reading this thread: ${stranger.status}, expected nothing to see`);
        const turnByStranger = await json(`/v1/chat/threads/${threadId}/turn`, {
            method: 'POST', headers: { Authorization: `Bearer ${other}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'not mine' }),
        });
        assert(turnByStranger.status === 404, `another owner speaking into this thread: ${turnByStranger.status}`);
    });

    await stopNode(node);
    node = null;

    // ── Phase 2: a binary that names nothing ──

    broken = await startNode({ port: BROKEN_PORT, gooseBin: '/nonexistent/goose', tag: 'broken' });
    BASE = broken.base;
    peerLogPath = broken.peerLog;
    let brokenThread = '';

    await test('a node configured with a binary that does not exist still says it has an agent', async () => {
        token = await registerOwner(`chatbrk${Date.now() % 100000}`);
        const { body } = await json('/v1/chat/status', authed());
        assert(body.data.enabled === true, `configuration is what enabled means, got ${JSON.stringify(body.data.enabled)}`);
        const created = await json('/v1/chat/threads', authed({ method: 'POST', body: JSON.stringify({}) }));
        brokenThread = created.body.data.thread.id;
    });

    await test('…and a turn on it fails THAT TURN, rather than taking the node down', async () => {
        // A child that cannot be spawned emits `error`, not `exit`, and an unlistened `error` is
        // thrown: one wrong character in an operator's path used to kill the node on the first
        // person who said hello.
        const events = await turn(brokenThread, { text: 'hello' });
        const last = events.at(-1)!;
        assert(last.kind === 'error', `the person is told, got ${last.kind}`);
        assert(/could not be started|ENOENT|timed out/.test(String(last.message)),
            `and told why, got ${JSON.stringify(last.message)}`);
        const after = await json('/v1/chat/status', authed());
        assert(after.status === 200, `the node is still answering afterwards, got ${after.status}`);
    });

    await stopNode(broken);
    broken = null;

    await runNodeRoute();
}

// ─── Phase 3: the node route ──────────────────────────────────────────────────

const ROUTE_PORT = PORT + 2;
const STUB_PORT = PORT + 3;
const STUB_MODEL = 'stub/chat-route-model';
let routed: Node | null = null;
let stub: FakeAiProvider | null = null;

/** The `sub` of a JWT, read without verifying: the node verified it, this only names whose it is. */
function subOf(jwt: string): string {
    return JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')).sub as string;
}

async function runNodeRoute(): Promise<void> {
    stub = await startFakeAiProvider(STUB_PORT);
    routed = await startNode({
        port: ROUTE_PORT, gooseBin: process.execPath, tag: 'route', sharedKey: false,
        // No node key, so a person without a provider has no payer; the stub is on loopback.
        extraEnv: { AIMEAT_OPENROUTER_INSTANCE_KEY: '', AIMEAT_ALLOW_PRIVATE_EGRESS: 'true', AIMEAT_RL_OPENROUTER: '1000' },
    });
    BASE = routed.base;
    peerLogPath = routed.peerLog;

    const owners: Record<'a' | 'b', { name: string; token: string; thread: string }> = {
        a: { name: `chatra${Date.now() % 100000}`, token: '', thread: '' },
        b: { name: `chatrb${Date.now() % 100000}`, token: '', thread: '' },
    };
    const as = (who: 'a' | 'b') => { token = owners[who].token; };
    const usage = async (who: 'a' | 'b') => {
        const { body } = await json('/v1/ai/usage', { headers: { Authorization: `Bearer ${owners[who].token}` } });
        return body.data as { total_calls: number; spent_today_usd: number; per_app: Record<string, unknown> };
    };
    /** The process that ran the last prompt of a thread's session, and the token it carries. */
    const processOf = (sessionPrompt: any) => {
        const started = peerEntries().find((e) => e.kind === 'started' && e.pid === sessionPrompt.pid);
        assert(!!started, `the process that ran the turn wrote its start record (pid ${sessionPrompt.pid})`);
        return started;
    };

    await test('3a. setup: two owners; with no key anywhere the node names no payer, with their own provider it names them', async () => {
        for (const who of ['a', 'b'] as const) {
            owners[who].token = await registerOwner(owners[who].name);
            as(who);
            const created = await json('/v1/chat/threads', authed({ method: 'POST', body: JSON.stringify({ title: 'route' }) }));
            assert(created.status === 201, `create ${created.status}`);
            owners[who].thread = created.body.data.thread.id;
        }
        as('a');
        const before = await json('/v1/chat/status', authed());
        assert(before.body.data.pays === null, `no key anywhere: no payer, got ${JSON.stringify(before.body.data.pays)}`);
        for (const who of ['a', 'b'] as const) {
            as(who);
            const r = await json('/v1/memory', authed({
                method: 'POST',
                body: JSON.stringify({ key: 'openrouter.settings', visibility: 'private', value: { provider: 'custom', baseUrl: stub!.baseUrl, model: STUB_MODEL, daily_budget_usd: 50 } }),
            }));
            assert(r.status === 201, `settings ${r.status}: ${JSON.stringify(r.body?.error)}`);
        }
        as('a');
        const after = await json('/v1/chat/status', authed());
        assert(after.body.data.pays === 'own', `their own provider pays, got ${JSON.stringify(after.body.data.pays)}`);
        assert(after.body.data.model === STUB_MODEL, `the model /v1/llm would choose, got ${after.body.data.model}`);
    });

    await test('3b. a turn\'s model call reaches /v1/llm with that owner\'s token and is metered to that owner', async () => {
        const [aBefore, bBefore] = [await usage('a'), await usage('b')];
        const chatsBefore = stub!.requestsFor('chat').length;
        as('a');
        const events = await turn(owners.a.thread, { text: 'LLMCALL-A what is two and two' });
        assert(events.at(-1)!.kind === 'done', `the turn finished, got ${JSON.stringify(events.at(-1))}`);
        const said = events.filter((e) => e.kind === 'text').map((e) => e.text).join('');
        assert(said.includes('The stub provider answered.'), `the model's answer came back through the node, got ${JSON.stringify(said)}`);

        const call = peerEntries().filter((e) => e.kind === 'llm-call').at(-1);
        assert(call.url === `${BASE}/v1/llm/chat/completions`, `goose's URL is the node's /v1/llm, got ${call.url}`);
        assert(call.status === 200, `the node answered, got ${call.status} ${JSON.stringify(call.body)}`);
        const upstream = stub!.requestsFor('chat').slice(chatsBefore);
        assert(upstream.length === 1 && upstream[0].body.includes('LLMCALL-A'), `the provider got this turn's call once, got ${upstream.length}`);
        assert(upstream[0].json?.model === STUB_MODEL, `on the model the node chose, not goose's, got ${upstream[0].json?.model}`);

        const [aAfter, bAfter] = [await usage('a'), await usage('b')];
        assert(aAfter.total_calls === aBefore.total_calls + 1, `owner A's usage counts the call: ${aBefore.total_calls} -> ${aAfter.total_calls}`);
        assert(aAfter.spent_today_usd > aBefore.spent_today_usd, `and its cost: ${aBefore.spent_today_usd} -> ${aAfter.spent_today_usd}`);
        assert(!!aAfter.per_app?.['llm-proxy'], `under llm-proxy, got ${JSON.stringify(aAfter.per_app)}`);
        assert(bAfter.total_calls === bBefore.total_calls, `owner B paid nothing for it: ${bBefore.total_calls} -> ${bAfter.total_calls}`);

        const thread = await readThread(owners.a.thread);
        const last = (thread.turns as any[]).filter((t) => t.role === 'agent').at(-1);
        assert(last.model === undefined, `the node does not claim goose's model answered, got ${last.model}`);
    });

    await test('3c. that owner\'s process points at the node with their chat token and holds no other key', async () => {
        const prompt = peerRequests('session/prompt').at(-1)!;
        const started = processOf(prompt);
        assert(started.env.GOOSE_PROVIDER === 'openai', `goose's OpenAI provider, got ${started.env.GOOSE_PROVIDER}`);
        assert(started.env.OPENAI_HOST === BASE, `at this node, got ${started.env.OPENAI_HOST}`);
        assert(started.env.OPENAI_BASE_PATH === 'v1/llm/chat/completions', `on /v1/llm, got ${started.env.OPENAI_BASE_PATH}`);
        assert(started.env.OPENROUTER_API_KEY === null, `no provider key of the node's, got ${started.env.OPENROUTER_API_KEY}`);
        assert(subOf(started.env.OPENAI_API_KEY) === `chat#${owners.a.name}@${NODE_ID}`,
            `the key is owner A's chat agent token, got ${subOf(started.env.OPENAI_API_KEY)}`);
        assert(started.leaked.length === 0, `no node configuration, got ${JSON.stringify(started.leaked)}`);
    });

    await test('3d. another owner\'s turn runs in another process, on their own token, and never in the first one', async () => {
        const [aBefore, bBefore] = [await usage('a'), await usage('b')];
        as('b');
        const events = await turn(owners.b.thread, { text: 'LLMCALL-B and three and three' });
        assert(events.at(-1)!.kind === 'done', `the turn finished, got ${JSON.stringify(events.at(-1))}`);
        const prompts = peerRequests('session/prompt');
        const aPid = prompts.find((p) => textOfPrompt(p).includes('LLMCALL-A'))!.pid;
        const bPid = prompts.find((p) => textOfPrompt(p).includes('LLMCALL-B'))!.pid;
        assert(aPid !== bPid, `two owners, two processes, got pid ${aPid} for both`);
        assert(subOf(processOf({ pid: bPid }).env.OPENAI_API_KEY) === `chat#${owners.b.name}@${NODE_ID}`, 'B\'s process carries B\'s token');
        // Every turn each process ran belongs to the owner whose token it holds.
        for (const p of prompts) {
            const holder = subOf(processOf(p).env.OPENAI_API_KEY);
            const whose = textOfPrompt(p).includes('LLMCALL-B') ? owners.b.name : owners.a.name;
            assert(holder === `chat#${whose}@${NODE_ID}`, `a turn of ${whose} ran in a process holding ${holder}`);
        }
        const [aAfter, bAfter] = [await usage('a'), await usage('b')];
        assert(bAfter.total_calls === bBefore.total_calls + 1, `B's usage counts B's call: ${bBefore.total_calls} -> ${bAfter.total_calls}`);
        assert(aAfter.total_calls === aBefore.total_calls, `A paid nothing for B's turn: ${aBefore.total_calls} -> ${aAfter.total_calls}`);
    });

    await test('3e. the same owner\'s next turn reuses their process', async () => {
        const starts = peerEntries().filter((e) => e.kind === 'started').length;
        as('a');
        const events = await turn(owners.a.thread, { text: 'LLMCALL-A again' });
        assert(events.at(-1)!.kind === 'done', `the turn finished, got ${JSON.stringify(events.at(-1))}`);
        assert(peerEntries().filter((e) => e.kind === 'started').length === starts, 'no new process was started');
    });

    await test('3f. the owner\'s "the node\'s chat" switch covers these calls: refused before the provider, and nothing metered', async () => {
        as('a');
        const setPolicy = async (chat: boolean) => {
            const r = await json('/v1/ai/policy', authed({
                method: 'PUT',
                body: JSON.stringify({ policy: { mode: 'custom', allow: ['openrouter:vendor/not-the-stub-model'], appliesTo: { owner: true, chat, agents: false, apps: true } } }),
            }));
            assert(r.status === 200, `policy ${r.status}: ${JSON.stringify(r.body?.error)}`);
        };
        await setPolicy(true);
        const before = await usage('a');
        const chatsBefore = stub!.requestsFor('chat').length;
        await turn(owners.a.thread, { text: 'LLMCALL-A under the policy' });
        const refused = peerEntries().filter((e) => e.kind === 'llm-call').at(-1);
        assert(refused.status === 403 && refused.body?.error?.code === 'AI_MODEL_NOT_ALLOWED',
            `the chat's call is the chat's, and the chat switch refuses it: ${refused.status} ${JSON.stringify(refused.body?.error)}`);
        assert(stub!.requestsFor('chat').length === chatsBefore, 'the provider was never called');
        assert((await usage('a')).total_calls === before.total_calls, 'and nothing was metered');

        // The same policy with the chat switch off lets the chat through, while agents stay off too:
        // the chat is not counted as one of the owner's other agents.
        await setPolicy(false);
        await turn(owners.a.thread, { text: 'LLMCALL-A with the chat switch off' });
        const allowed = peerEntries().filter((e) => e.kind === 'llm-call').at(-1);
        assert(allowed.status === 200, `with "the node's chat" off the call passes, got ${allowed.status} ${JSON.stringify(allowed.body?.error)}`);
        const open = await json('/v1/ai/policy', authed({ method: 'PUT', body: JSON.stringify({ policy: { mode: 'open' } }) }));
        assert(open.status === 200, `policy back to open ${open.status}`);
    });

    await stopNode(routed);
    routed = null;
    await stub.close();
    stub = null;
}

function textOfPrompt(p: any): string {
    return ((p.params?.prompt ?? []) as any[]).filter((b) => b?.type === 'text').map((b) => String(b.text)).join('\n');
}

run()
    .catch(async (err: Error) => { console.error('Suite crashed:', err); failed++; })
    .finally(async () => {
        await stopNode(node);
        await stopNode(broken);
        await stopNode(routed);
        await stub?.close();
        console.log(`\nChat agent E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
        process.exit(failed > 0 ? 1 : 0);
    });
