/**
 * @file test/e2e-mcp-mail-connection-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The mail and connection tools of src/mcp/connections.ts, each called once to succeed
 *   and once to be refused, over a real session on /v1/mcp: aimeat_connection_providers,
 *   aimeat_connection_start, aimeat_connection_list, aimeat_connection_history,
 *   aimeat_connection_replies, aimeat_mail_search, aimeat_mail_read, aimeat_mail_aliases and
 *   aimeat_mail_send.
 *
 *   WHY THIS SUITE EXISTS. No test had called these tools through /v1/mcp (QA audit F12b-02). The
 *   unit file for the surface replaces the MCP server with a stand-in that records tool names, so a
 *   wrong parameter mapping or a wrong ownership check in the nine handlers would pass every suite.
 *   The audit also found that the tools read a different set of mailboxes than the Email page's
 *   prompt promised. The code is deliberate there (a connection belongs to the exact principal, and
 *   reading the OWNER's mailbox is a word of its own, connections:read-as-owner), so Phase 4 holds
 *   what the code does: an agent holding connections:use sees the owner's mailbox in the list, a read
 *   of it without the word is refused with a sentence that says which permission is missing, and an
 *   agent holding the word reads it.
 *
 *   HOW IT IS BUILT. The node boots IN THIS PROCESS on its own port, the pattern of
 *   e2e-mail-connections, because the Gmail and Bluesky upstreams are module constants that only a
 *   replacement for globalThis.fetch can answer (test/helpers/fake-mail-upstreams.ts). It follows the
 *   runner's backend: a SQLite file of its own, or the runner's Postgres database. An agent connects
 *   its own mailbox through aimeat_connection_start and the owner's confirmation in the owner's
 *   browser, exactly the round a person completes.
 * @structure
 *   - boot (env, node, fake upstreams) · helpers
 *   - Phase 0: owners, agents with the scopes each test needs, MCP sessions
 *   - Phase 1: aimeat_connection_providers
 *   - Phase 2: aimeat_connection_start and aimeat_connection_list (the agent's own mailbox)
 *   - Phase 3: aimeat_mail_search, aimeat_mail_read, aimeat_mail_aliases, aimeat_mail_send
 *   - Phase 4: the owner's mailbox: listed on connections:use, read only on connections:read-as-owner
 *   - Phase 5: aimeat_connection_history and aimeat_connection_replies
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-mail-connection-tools
 * @version-history
 *   2026-10-27 — Its own node is on suitePort block 30200, out of the range the claims board hands out.
 *   2026-10-17 — 2b, 2c, 3b: a tool missing only one-press words is listed (permission ask,
 *     mcp/permission-ask-gate.ts), so the plain agent's calls are asserted as SCOPE_DENIED with the
 *     allow address instead of "not offered". 3h: the looker's aimeat_mail_send is listed and refused with
 *     the allow address (connections.ts's own guard for it is gone).
 *   2026-10-16 — 4b-rest, 4c and 4d also read over POST /v1/connections/:id/read/:resource: the owner's
 *     mailbox without connections:read-as-owner is 403 READ_AS_OWNER_REQUIRED with the MCP sentence,
 *     another owner's agent keeps 404 (Jouni, 2026-10-16).
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F12b-02 and W27: the mail and connection tools called and refused).
 */
import { randomBytes } from 'node:crypto';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { BROWSER_START, roundCookie } from './helpers/oauth-round.js';
import { suitePort } from './helpers/free-port.js';

// A suitePort block, not the base port plus 170: that landed in the range the claims board hands out.
const PORT = Number(process.env.E2E_MCP_MAIL_PORT
    ?? suitePort(30200, process.env.E2E_BASE ?? `http://localhost:${process.env.AIMEAT_TEST_PORT ?? '40251'}`));
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), 'aimeat-mcp-mail-'));
const USE_SQLITE = (process.env.AIMEAT_STORAGE ?? 'sqlite') !== 'postgres-kysely';

// Read by loadConfig below, so set BEFORE it is called. The client credentials turn the Google
// providers on; the stand-in provider stays out.
Object.assign(process.env, {
    AIMEAT_PORT: String(PORT),
    AIMEAT_BASE_URL: BASE,
    AIMEAT_NODE_ID: 'aimeat-local-001-dev',
    AIMEAT_DEV_MODE: 'true',
    AIMEAT_TEST_MODE: 'true',
    AIMEAT_ANONYMOUS: 'true',
    AIMEAT_LOG_LEVEL: 'error',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'error',
    AIMEAT_STORAGE: USE_SQLITE ? 'sqlite' : 'postgres-kysely',
    AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
    AIMEAT_CONNECTIONS_ENABLED: 'true',
    AIMEAT_CONNECT_GOOGLE_CLIENT_ID: 'google-client-id',
    AIMEAT_CONNECT_GOOGLE_CLIENT_SECRET: 'google-client-secret',
    AIMEAT_CONNECT_FAKE_BASE_URL: '',
    AIMEAT_CONNECT_REDIRECT_URI: `${BASE}/v1/connections/callback`,
    AIMEAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    AIMEAT_ADMIN_PASSWORD: process.env.AIMEAT_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url'),
    AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '200',
    AIMEAT_LOGIN_RATE_LIMIT_MAX: '200',
    AIMEAT_OUTBOUND_DAILY_LIMIT: '200',
    AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    AIMEAT_RL_GLOBAL: '10000',
    AIMEAT_RL_AUTH: '1000',
    AIMEAT_RL_MEMORY: '1000',
});
// A SQLite file of this suite's own: a second node beside the runner's must not share its file.
if (USE_SQLITE) {
    process.env.AIMEAT_SQLITE_PATH = join(TMP, 'mcp-mail.db');
}

const { createServer } = await import('../src/server.js');
const { loadConfig } = await import('../src/config.js');
const { installFakeUpstreams } = await import('./helpers/fake-mail-upstreams.js');
const { registerOwner } = await import('./helpers/owner-login.js');
const { makeAgent, openSession, callTool, toolNames } = await import('./helpers/mcp-session.js');

const { config } = loadConfig({});
config.port = PORT;
const { app, storage } = await createServer(config);
await (storage as { ready?: Promise<unknown> }).ready;
const server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, '127.0.0.1', () => resolve(s)); });
const { up, restore } = installFakeUpstreams();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

interface Call { status: number; data: any; cookie: string }
async function api(path: string, opts: { method?: string; body?: unknown; bearer?: string; browser?: boolean } = {}): Promise<Call> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.browser ? BROWSER_START : {}) };
    if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
    const res = await fetch(`${BASE}${path}`, {
        method: opts.method ?? 'POST', headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        redirect: 'manual',
    });
    let data: any = null;
    try { data = await res.json(); } catch { /* redirect or plain text */ }
    return { status: res.status, data, cookie: roundCookie(res) };
}

type Session = Awaited<ReturnType<typeof openSession>>;

/**
 * An agent's round, finished the way a person finishes it: the agent's aimeat_connection_start hands
 * back the node's confirmation page, the owner confirms it signed in in their own browser, and the
 * provider's redirect comes back with that browser's cookie. Returns the connection id the agent's
 * own list then shows for `provider`.
 */
async function agentConnects(session: Session, ownerToken: string, provider: string, mailbox: string): Promise<string> {
    up.mailbox = mailbox;
    const start = await callTool(session, 'aimeat_connection_start', { provider });
    assert(!start.isError, `start ${provider}: ${start.text}`);
    assert(start.data.owner_confirms === true, `the answer does not say the owner confirms: ${start.text}`);
    const page = new URL(start.data.authorize_url as string);
    assert(page.origin === new URL(BASE).origin, `the agent was handed an address off this node: ${page.href}`);
    const state = page.searchParams.get('state') ?? '';
    assert(state, `no state on the confirmation page: ${page.href}`);
    const ok = await api(`/v1/oauth-rounds/${encodeURIComponent(state)}/approve`, { bearer: ownerToken, browser: true });
    assert(ok.status === 200 && ok.cookie, `the owner's confirmation: ${ok.status} ${JSON.stringify(ok.data?.error)}`);
    const cb = await fetch(`${BASE}/v1/connections/callback?state=${encodeURIComponent(state)}&code=code-${provider}-${Date.now()}`, {
        redirect: 'manual', headers: { Cookie: ok.cookie },
    });
    assert(cb.status === 302, `callback ${provider}: ${cb.status} ${await cb.text()}`);
    const list = await callTool(session, 'aimeat_connection_list', {});
    const conn = (list.data.connections ?? []).find((c: any) => c.provider === provider && c.holder === 'own');
    assert(conn, `the agent's list has no ${provider} of its own: ${list.text}`);
    return conn.id as string;
}

/** The owner's own round, started in their browser (REST), as the Email page does. */
async function ownerConnects(ownerToken: string, provider: string, mailbox: string): Promise<string> {
    up.mailbox = mailbox;
    const res = await fetch(`${BASE}/v1/connections/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}`, ...BROWSER_START },
        body: JSON.stringify({ provider, mode: 'personal', return_url: '/profile#access' }),
    });
    const start = await res.json() as any;
    assert(res.status === 200, `owner start ${provider}: ${res.status} ${start?.error?.message}`);
    const cb = await fetch(`${BASE}/v1/connections/callback?state=${encodeURIComponent(start.data.state)}&code=code-owner-${provider}`, {
        redirect: 'manual', headers: { Cookie: roundCookie(res) },
    });
    assert(cb.status === 302, `owner callback ${provider}: ${cb.status}`);
    const list = await api('/v1/connections', { method: 'GET', bearer: ownerToken });
    const conn = (list.data?.data?.connections ?? []).find((c: any) => c.provider === provider && c.accountLabel === mailbox);
    assert(conn, `the owner's ${provider} is not listed: ${JSON.stringify(list.data)}`);
    return conn.id as string;
}

console.log('\n── Mail and connection tools over /v1/mcp (QA audit F12b-02, W27) ──');

try {
    // ── Phase 0 ──
    const stamp = Date.now().toString(36).slice(-6);
    const alice = await registerOwner(BASE, `mmalice${stamp}`);
    const bob = await registerOwner(BASE, `mmbob${stamp}`);
    const MAIL_WORDS = ['connections:read', 'connections:write', 'connections:read-through', 'connections:use', 'outbound:send', 'storage:read', 'storage:write'];
    // mailbot works with its own mailbox and may name (not read) the owner's; ownerreader may also
    // read the owner's; looker may connect and read but not store or send; plain holds none of these words; bobbot
    // is another owner's agent holding every word.
    const mailbot = await makeAgent(BASE, alice, MAIL_WORDS);
    const ownerreader = await makeAgent(BASE, alice, [...MAIL_WORDS, 'connections:read-as-owner']);
    const looker = await makeAgent(BASE, alice, ['connections:read', 'connections:write', 'connections:read-through']);
    const plain = await makeAgent(BASE, alice, ['memory:read']);
    const bobbot = await makeAgent(BASE, bob, MAIL_WORDS);
    const sMail = await openSession(BASE, mailbot.token, 'mail-tools-mailbot');
    const sOwnerReader = await openSession(BASE, ownerreader.token, 'mail-tools-ownerreader');
    const sLooker = await openSession(BASE, looker.token, 'mail-tools-looker');
    const sPlain = await openSession(BASE, plain.token, 'mail-tools-plain');
    const sBob = await openSession(BASE, bobbot.token, 'mail-tools-bobbot');
    const AGENT_BOX = `agentbox-${stamp}@mail.example.test`;
    const OWNER_BOX = `ownerbox-${stamp}@mail.example.test`;

    // ── Phase 1: aimeat_connection_providers ──
    console.log('\nPhase 1: aimeat_connection_providers');
    await test('1a. the providers are listed, mail in read/send pairs, with no credential in the answer', async () => {
        const r = await callTool(sMail, 'aimeat_connection_providers', {});
        assert(!r.isError, `providers refused: ${r.text}`);
        const ids = (r.data.providers ?? []).map((p: any) => p.id);
        assert(ids.includes('google-mail') && ids.includes('google-mail-send'), `ids: ${ids}`);
        assert(!r.text.includes('google-client-secret'), 'the client secret is in the answer');
    });
    await test('1b. with connections switched off on the node, the tool refuses and says so', async () => {
        config.connectionsEnabled = false;
        try {
            const r = await callTool(sMail, 'aimeat_connection_providers', {});
            assert(r.isError && r.offered, `expected the handler's refusal: ${r.text}`);
            assert(/switched off/i.test(r.text), `the refusal: ${r.text}`);
        } finally {
            config.connectionsEnabled = true;
        }
    });

    // ── Phase 2: aimeat_connection_start and aimeat_connection_list ──
    console.log('\nPhase 2: aimeat_connection_start and aimeat_connection_list');
    let readConn = '';
    let sendConn = '';
    await test('2a. an agent starts its own round, the owner confirms, and the mailbox is the agent\'s own', async () => {
        readConn = await agentConnects(sMail, alice.token, 'google-mail', AGENT_BOX);
        sendConn = await agentConnects(sMail, alice.token, 'google-mail-send', AGENT_BOX);
        const rest = await api('/v1/connections', { method: 'GET', bearer: mailbot.token });
        const ids = (rest.data?.data?.connections ?? []).map((c: any) => c.id);
        assert(ids.includes(readConn) && ids.includes(sendConn), `REST disagrees with the tool: ${JSON.stringify(rest.data?.data)}`);
    });
    // Listed since 2026-10-17 (permission ask): a one-press permission keeps the tool on the list and the call is refused with the allow address.
    // The plain agent's refusals below are that answer: SCOPE_DENIED with /v1/allow?, so `offered` is true.
    await test('2b. aimeat_connection_start refuses a provider this node does not have, and is refused with the allow address without connections:write', async () => {
        const r = await callTool(sMail, 'aimeat_connection_start', { provider: 'no-such-provider' });
        assert(r.isError && r.offered, `an unknown provider was started: ${r.text}`);
        const plainStart = await callTool(sPlain, 'aimeat_connection_start', { provider: 'google-mail' });
        assert(plainStart.isError && /^SCOPE_DENIED/.test(plainStart.text) && plainStart.text.includes('/v1/allow?'), `the plain agent was not refused with the allow address: ${plainStart.text}`);
    });
    await test('2c. aimeat_connection_list is refused with the allow address without connections:read, and another owner\'s agent sees none of alice\'s', async () => {
        const r = await callTool(sPlain, 'aimeat_connection_list', {});
        assert(r.isError && /^SCOPE_DENIED/.test(r.text) && r.text.includes('/v1/allow?'), `the plain agent listed: ${r.text}`);
        const other = await callTool(sBob, 'aimeat_connection_list', {});
        assert(!other.isError, `bob's own list refused: ${other.text}`);
        assert(!(other.data.connections ?? []).some((c: any) => c.id === readConn || c.id === sendConn), 'bob\'s agent sees alice\'s agent\'s mailbox');
    });

    // ── Phase 3: reading and sending through the agent's own mailbox ──
    console.log('\nPhase 3: aimeat_mail_search, aimeat_mail_read, aimeat_mail_aliases, aimeat_mail_send');
    await test('3a. aimeat_mail_search passes the query to Gmail and answers the message ids', async () => {
        const mark = up.mark();
        const r = await callTool(sMail, 'aimeat_mail_search', { connection_id: readConn, query: 'from:lasku@example.com', limit: 2 });
        assert(!r.isError, `search refused: ${r.text}`);
        assert(r.data.provider === 'google-mail' && r.data.resource === 'messages', `answer: ${r.text.slice(0, 300)}`);
        assert(JSON.stringify(r.data.data).includes('m1'), `no message ids: ${r.text.slice(0, 300)}`);
        const sent = up.since(mark).find((c) => c.host === 'gmail.googleapis.com' && c.path.endsWith('/messages'));
        assert(sent && new URL(sent.url).searchParams.get('q') === 'from:lasku@example.com', `the query did not reach Gmail: ${sent?.url}`);
    });
    await test('3b. aimeat_mail_search refuses another owner\'s agent the mailbox as if it did not exist, and is refused with the allow address without the read word', async () => {
        const mark = up.mark();
        const r = await callTool(sBob, 'aimeat_mail_search', { connection_id: readConn, query: 'x' });
        assert(r.isError && /NOT_FOUND/.test(r.text), `bob's agent searched alice's agent's mailbox: ${r.text}`);
        assert(!up.since(mark).some((c) => c.host === 'gmail.googleapis.com'), 'the refused search reached Gmail');
        const p = await callTool(sPlain, 'aimeat_mail_search', { connection_id: readConn, query: 'x' });
        assert(p.isError && /^SCOPE_DENIED/.test(p.text) && p.text.includes('/v1/allow?'), `the plain agent searched: ${p.text}`);
    });
    await test('3c. aimeat_mail_read answers one message, and stores its attachment as a private file of the agent', async () => {
        const msg = await callTool(sMail, 'aimeat_mail_read', { connection_id: readConn, message_id: 'm1' });
        assert(!msg.isError, `read refused: ${msg.text}`);
        assert(msg.text.includes('Invoice m1'), `the message: ${msg.text.slice(0, 300)}`);
        const stored = await callTool(sMail, 'aimeat_mail_read', { connection_id: readConn, message_id: 'm1', attachment_id: 'att-1', store: true, filename: 'invoice.pdf' });
        assert(!stored.isError, `store refused: ${stored.text}`);
        const key = stored.data.stored?.key as string;
        assert(typeof key === 'string' && key.length > 0, `stored: ${stored.text}`);
        const file = await fetch(`${BASE}/v1/storage/${key.split('/').map(encodeURIComponent).join('/')}`, { headers: { Authorization: `Bearer ${mailbot.token}` } });
        assert(file.status === 200, `the stored file does not read back: ${file.status}`);
        assert(Buffer.from(await file.arrayBuffer()).toString('utf8') === 'the invoice bytes of m1', 'the stored bytes are not the attachment');
    });
    await test('3d. aimeat_mail_read refuses another owner\'s agent, and a store without storage:write', async () => {
        const r = await callTool(sBob, 'aimeat_mail_read', { connection_id: readConn, message_id: 'm1' });
        assert(r.isError && /NOT_FOUND/.test(r.text) && !r.text.includes('Invoice m1'), `bob's agent read the message: ${r.text}`);
        const lookerConn = await agentConnects(sLooker, alice.token, 'google-mail', `looker-${stamp}@mail.example.test`);
        const noStore = await callTool(sLooker, 'aimeat_mail_read', { connection_id: lookerConn, message_id: 'm2', attachment_id: 'att-1', store: true });
        assert(noStore.isError && /SCOPE_DENIED/.test(noStore.text) && /storage:write/.test(noStore.text), `a store without storage:write: ${noStore.text}`);
    });
    await test('3e. aimeat_mail_aliases lists the verified addresses and leaves out the unverified one', async () => {
        const r = await callTool(sMail, 'aimeat_mail_aliases', { connection_id: sendConn });
        assert(!r.isError, `aliases refused: ${r.text}`);
        const addresses: string[] = r.data.addresses ?? [];
        assert(addresses.includes('billing@mail.example.test'), `addresses: ${r.text}`);
        assert(!addresses.includes('pending@mail.example.test'), 'an unverified alias was offered');
    });
    await test('3f. aimeat_mail_aliases refuses another owner\'s agent', async () => {
        const r = await callTool(sBob, 'aimeat_mail_aliases', { connection_id: sendConn });
        assert(r.isError && /NO_SUCH_MAILBOX/.test(r.text) && !r.text.includes('billing@'), `bob's agent read the aliases: ${r.text}`);
    });
    let contactId = '';
    await test('3g. aimeat_mail_send sends to a contact in the owner\'s book through the agent\'s own mailbox', async () => {
        const c = await api('/v1/outbound/contacts', { bearer: alice.token, body: { name: 'Recipient', email: `recipient-${stamp}@example.test` } });
        assert(c.status === 201, `contact: ${c.status} ${JSON.stringify(c.data?.error)}`);
        contactId = c.data.data.contact.id as string;
        const before = up.stats.gmailSends;
        const r = await callTool(sMail, 'aimeat_mail_send', {
            contact_id: contactId, subject: `MCP report ${stamp}`, body: 'Sent by the agent.', connection_id: sendConn, ai_disclosure: 'ai-generated',
        });
        assert(!r.isError, `send refused: ${r.text}`);
        assert(r.data.status === 'sent' && typeof r.data.message_id === 'string', `answer: ${r.text}`);
        assert(!('channel' in r.data), 'the answer carries channel, which only the owner in person reads');
        assert(up.stats.gmailSends === before + 1, `Gmail sends ${before} -> ${up.stats.gmailSends}`);
        assert(up.lastGmailRaw.includes(`MCP report ${stamp}`) && up.lastGmailRaw.includes(`recipient-${stamp}@example.test`), 'the message Gmail got is not the one sent');
    });
    await test('3h. aimeat_mail_send refuses a contact that is not in the owner\'s book, and without outbound:send it is listed and refused with the allow address', async () => {
        const before = up.stats.gmailSends;
        const bobContact = await api('/v1/outbound/contacts', { bearer: bob.token, body: { name: 'Bob\'s', email: `bobs-${stamp}@example.test` } });
        assert(bobContact.status === 201, `bob's contact: ${bobContact.status}`);
        const r = await callTool(sMail, 'aimeat_mail_send', {
            contact_id: bobContact.data.data.contact.id, subject: 'x', body: 'x', connection_id: sendConn,
        });
        assert(r.isError && r.offered && /NOT_FOUND/.test(r.text), `a contact of another owner was sent to: ${r.text}`);
        assert(up.stats.gmailSends === before, 'the refused send reached Gmail');
        // Listed since 2026-10-17 (permission ask): a one-press permission keeps the tool on the list and the
        // call is refused with the allow address. connections.ts's own guard for this tool went the same day.
        const names = await toolNames(sLooker);
        assert(names.includes('aimeat_mail_send'), 'aimeat_mail_send is not on the looker\'s list');
        const looked = await callTool(sLooker, 'aimeat_mail_send', { contact_id: contactId, subject: 'x', body: 'x', connection_id: sendConn });
        assert(looked.isError && /^SCOPE_DENIED/.test(looked.text) && looked.text.includes('/v1/allow?'), `the looker's send was not refused with the allow address: ${looked.text}`);
        assert(up.stats.gmailSends === before, 'the looker\'s refused send reached Gmail');
    });

    // ── Phase 4: the owner's mailbox ──
    console.log('\nPhase 4: the owner\'s mailbox, listed on connections:use and read on connections:read-as-owner');
    let ownerConn = '';
    await test('4a. an agent holding connections:use sees the mailbox its owner connected, marked as the owner\'s', async () => {
        ownerConn = await ownerConnects(alice.token, 'google-mail', OWNER_BOX);
        const r = await callTool(sMail, 'aimeat_connection_list', {});
        const row = (r.data.connections ?? []).find((c: any) => c.id === ownerConn);
        assert(row && row.holder === 'owner', `the owner's mailbox is not listed as the owner's: ${r.text}`);
        const other = await callTool(sBob, 'aimeat_connection_list', {});
        assert(!(other.data.connections ?? []).some((c: any) => c.id === ownerConn), 'another owner\'s agent sees alice\'s mailbox');
    });
    await test('4b. a read of the owner\'s mailbox without connections:read-as-owner is refused, and the refusal names the permission', async () => {
        const mark = up.mark();
        const r = await callTool(sMail, 'aimeat_mail_search', { connection_id: ownerConn, query: 'x' });
        assert(r.isError, `an agent without connections:read-as-owner read the owner's mailbox: ${r.text}`);
        assert(!up.since(mark).some((c) => c.host === 'gmail.googleapis.com'), 'the refused read reached Gmail');
        // The tool listed this mailbox to the agent a moment ago, so "no such connection" is not true;
        // the refusal says what is missing and where the owner gives it.
        assert(/READ_AS_OWNER_REQUIRED/.test(r.text) && /connections:read-as-owner/.test(r.text), `the refusal does not say which permission: ${r.text}`);
        const read = await callTool(sMail, 'aimeat_mail_read', { connection_id: ownerConn, message_id: 'm1' });
        assert(read.isError && /READ_AS_OWNER_REQUIRED/.test(read.text), `aimeat_mail_read: ${read.text}`);
    });
    await test('4b-rest. the same read over REST answers 403 READ_AS_OWNER_REQUIRED with the MCP sentence (Jouni, 2026-10-16)', async () => {
        const mark = up.mark();
        const mcp = await callTool(sMail, 'aimeat_mail_search', { connection_id: ownerConn, query: 'x' });
        const r = await api(`/v1/connections/${ownerConn}/read/messages`, { bearer: mailbot.token, body: { query: 'x' } });
        assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.data?.error)}`);
        assert(r.data?.error?.code === 'READ_AS_OWNER_REQUIRED', `code: ${r.data?.error?.code}`);
        assert(r.data?.error?.details?.scope === 'connections:read-as-owner', `details: ${JSON.stringify(r.data?.error?.details)}`);
        assert(mcp.text.includes(r.data.error.message), `REST and MCP say different things: REST "${r.data.error.message}" MCP "${mcp.text}"`);
        const msg = await api(`/v1/connections/${ownerConn}/read/message`, { bearer: mailbot.token, body: { id: 'm1' } });
        assert(msg.status === 403 && msg.data?.error?.code === 'READ_AS_OWNER_REQUIRED', `read/message: ${msg.status} ${JSON.stringify(msg.data?.error)}`);
        assert(!up.since(mark).some((c) => c.host === 'gmail.googleapis.com'), 'the refused read reached Gmail');
    });
    await test('4c. another owner\'s agent still gets "no such connection" for alice\'s mailbox', async () => {
        const r = await callTool(sBob, 'aimeat_mail_search', { connection_id: ownerConn, query: 'x' });
        assert(r.isError && /NOT_FOUND/.test(r.text) && !/READ_AS_OWNER_REQUIRED/.test(r.text), `bob's agent learned the mailbox exists: ${r.text}`);
        const rest = await api(`/v1/connections/${ownerConn}/read/messages`, { bearer: bobbot.token, body: { query: 'x' } });
        assert(rest.status === 404 && rest.data?.error?.code === 'NOT_FOUND', `REST told bob's agent the mailbox exists: ${rest.status} ${JSON.stringify(rest.data?.error)}`);
    });
    await test('4d. an agent holding connections:read-as-owner searches and reads the owner\'s mailbox', async () => {
        const r = await callTool(sOwnerReader, 'aimeat_mail_search', { connection_id: ownerConn, query: 'subject:invoice' });
        assert(!r.isError, `search refused: ${r.text}`);
        const read = await callTool(sOwnerReader, 'aimeat_mail_read', { connection_id: ownerConn, message_id: 'm3' });
        assert(!read.isError && read.text.includes('Invoice m3'), `read: ${read.text.slice(0, 300)}`);
        const rest = await api(`/v1/connections/${ownerConn}/read/message`, { bearer: ownerreader.token, body: { id: 'm3' } });
        assert(rest.status === 200 && JSON.stringify(rest.data?.data).includes('Invoice m3'), `REST read: ${rest.status} ${JSON.stringify(rest.data?.error)}`);
    });

    // ── Phase 5: what was published, and what came back ──
    console.log('\nPhase 5: aimeat_connection_history and aimeat_connection_replies');
    let attemptId = '';
    await test('5a. aimeat_connection_history lists the agent\'s own published post', async () => {
        const attach = await api('/v1/connections/attach', {
            bearer: mailbot.token, body: { provider: 'bluesky', fields: { identifier: 'tester.bsky.social', password: 'app-pw-1234' } },
        });
        assert(attach.status === 201 || attach.status === 200, `attach bluesky: ${attach.status} ${JSON.stringify(attach.data?.error)}`);
        const bsky = attach.data.data.connection.id as string;
        const pub = await api('/v1/connections/publish', { bearer: mailbot.token, body: { connection_id: bsky, caption: `history probe ${stamp}` } });
        assert(pub.status === 200 || pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.data?.error)}`);
        attemptId = pub.data.data.attempt.id as string;
        const r = await callTool(sMail, 'aimeat_connection_history', { limit: 10 });
        assert(!r.isError, `history refused: ${r.text}`);
        const row = (r.data.attempts ?? []).find((a: any) => a.id === attemptId);
        assert(row && row.provider === 'bluesky' && row.status === 'done', `the attempt: ${r.text.slice(0, 400)}`);
    });
    await test('5b. aimeat_connection_history shows another owner\'s agent none of it, and refuses when connections are off', async () => {
        const other = await callTool(sBob, 'aimeat_connection_history', {});
        assert(!other.isError && !(other.data.attempts ?? []).some((a: any) => a.id === attemptId), `bob's agent sees the attempt: ${other.text}`);
        config.connectionsEnabled = false;
        try {
            const r = await callTool(sMail, 'aimeat_connection_history', {});
            assert(r.isError && /CONNECTIONS_DISABLED/.test(r.text), `history with connections off: ${r.text}`);
        } finally {
            config.connectionsEnabled = true;
        }
    });
    await test('5c. aimeat_connection_replies reads the post\'s thread from Bluesky', async () => {
        const mark = up.mark();
        const r = await callTool(sMail, 'aimeat_connection_replies', { attempt_id: attemptId });
        assert(!r.isError, `replies refused: ${r.text}`);
        assert(r.data.attemptId === attemptId && r.data.provider === 'bluesky' && Array.isArray(r.data.replies), `answer: ${r.text}`);
        assert(up.since(mark).some((c) => c.path === '/xrpc/app.bsky.feed.getPostThread'), 'Bluesky was not asked');
    });
    await test('5d. aimeat_connection_replies refuses another owner\'s agent the attempt as if it did not exist', async () => {
        const mark = up.mark();
        const r = await callTool(sBob, 'aimeat_connection_replies', { attempt_id: attemptId });
        assert(r.isError && /NOT_FOUND/.test(r.text), `bob's agent read the replies: ${r.text}`);
        assert(!up.since(mark).some((c) => c.host === 'bsky.social'), 'the refused read reached Bluesky');
    });
} finally {
    restore();
    server.close();
    await (storage as { disconnect?: () => Promise<void> }).disconnect?.().catch(() => { /* already closed */ });
    try { rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows holds the file a moment */ }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
