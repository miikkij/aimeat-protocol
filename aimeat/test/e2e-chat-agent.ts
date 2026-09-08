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
 *   E2E_CHAT_AGENT_PORT moves the pair (default 40300, the broken node one port above).
 * @structure
 *   - the node lifecycle: startNode(), stopNode()
 *   - the owner, the uploads, and the SSE reader
 *   - Phase 1, against the fake agent: the turn, the callbacks, the attachments, cancel, reset, death
 *   - Phase 2, against a binary that does not exist
 * @usage
 *   cd aimeat && node --import tsx test/e2e-chat-agent.ts
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=chat-agent
 * @version-history
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

async function startNode(opts: { port: number; gooseBin: string; tag: string }): Promise<Node> {
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
            // what carries the peer into the agent child this node spawns.
            NODE_OPTIONS: `--import tsx --import ${PEER}`,
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
            AIMEAT_GOOSE_PROVIDER_API_KEY: 'sk-fake-e2e-key',
            AIMEAT_GOOSE_PATH_ROOT: dbDir,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout?.on('data', (c: Buffer) => { output += c.toString(); });
    proc.stderr?.on('data', (c: Buffer) => { output += c.toString(); });

    const start = Date.now();
    while (Date.now() - start < 90_000) {
        try { const r = await fetch(`${base}/v1/spec`); if (r.ok) return { proc, base, dbDir, peerLog, output: () => output }; }
        catch { /* still booting */ }
        await sleep(300);
    }
    throw new Error(`node did not start on ${opts.port}\n--- output ---\n${output.slice(-3000)}`);
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
        assert(said === 'Here is your game.', `the chunks arrive in order, got ${JSON.stringify(said)}`);

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
        assert(server.url === `${BASE}/v1/mcp`, `at this node's address, got ${server.url}`);
        const auth = (server.headers ?? []).find((h: any) => h.name === 'Authorization');
        assert(!!auth && auth.value.startsWith('Bearer ') && auth.value.length > 40, `with a bearer token, got ${JSON.stringify(auth)}`);
        assert(auth.value !== `Bearer ${token}`, 'and it is the agent\'s token, never the owner\'s browser session');

        const started = peerEntries().find((e) => e.kind === 'started');
        assert(started.env.GOOSE_MODEL === 'fake/model-1', `the model is passed in the env, got ${started.env.GOOSE_MODEL}`);
        assert(started.env.GOOSE_PROVIDER === 'fake-provider', `so is the provider, got ${started.env.GOOSE_PROVIDER}`);
        assert(started.env.OPENROUTER_API_KEY === 'sk-fake-e2e-key', `and the key it spends, got ${started.env.OPENROUTER_API_KEY}`);
        assert(typeof started.env.GOOSE_PATH_ROOT === 'string' && started.env.GOOSE_PATH_ROOT.length > 0,
            `and the path root, got ${started.env.GOOSE_PATH_ROOT}`);
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
        assert(last.text === 'Here is your game.', `the answer as it was streamed, got ${JSON.stringify(last.text)}`);
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
        const before = peerRequests('session/cancel').length;
        await turnAndLeave(threadId, 'STALL: keep going until I stop you');
        const deadline = Date.now() + 6_000;
        while (peerRequests('session/cancel').length === before && Date.now() < deadline) await sleep(250);
        assert(peerRequests('session/cancel').length === before + 1,
            `the agent is told to stop once the person has gone, cancels seen: ${peerRequests('session/cancel').length - before}`);

        await sleep(2_000);
        const thread = await readThread(threadId);
        const stalled = (thread.turns as any[]).filter((t) => t.role === 'agent').at(-1);
        assert(!stalled?.text?.includes('....'),
            `nothing keeps being written after the person left, got ${JSON.stringify(stalled?.text)}`);
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
}

run()
    .catch(async (err: Error) => { console.error('Suite crashed:', err); failed++; })
    .finally(async () => {
        await stopNode(node);
        await stopNode(broken);
        console.log(`\nChat agent E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
        process.exit(failed > 0 ? 1 : 0);
    });
