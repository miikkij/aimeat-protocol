/**
 * @file test/e2e-agent-connectors.ts
 * @description The owner's connectors as named, remembered machines, and an agent ordered to one of
 *   them.
 *
 *   WHAT THIS PROVES. A connector that presents an install id is listed for its owner with the name
 *   it reported, stays listed after it disconnects, and can be renamed and forgotten. A proposal can
 *   name a connector by id or by name, the approval reaches that connector and no other, and an
 *   agent approved for a connector that is not connected waits for THAT connector: another connector
 *   of the same owner connecting is offered nothing.
 *
 *   THE REFUSALS. Another owner sees and changes none of it, an app grant reads none of it, an agent
 *   without agent:write cannot rename, forgetting is the owner in person, and an unknown connector
 *   is refused before anything is written.
 *
 *   THE CHAT PATH. The same list, the same naming and the same proposal go through the node's own
 *   MCP server as an agent, because a person asks their own AI for an agent on a named machine.
 *
 *   THIS SUITE OPENS REAL TUNNELS, like e2e-agent-v2: the test is the daemon, on a WebSocket to
 *   /v1/connect/tunnel, answering the node's enrolment offer with signed cards.
 *
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-connectors
 * @version-history
 *   v1.1.0 — 2026-10-10 — The home's read of the same state (GET /v1/home/agents): each worker
 *     with its machine and whether it waits, one agent by name, and the refusals (an agent, an
 *     ecosystem app, no credential, another owner).
 *   v1.0.0 — 2026-10-10 — Initial, with the connector registry (services/connector-registry.ts).
 */
import { WebSocket } from 'ws';
import { CompactSign, importJWK, exportJWK, generateKeyPair, calculateJwkThumbprint } from 'jose';
import * as ed from '@noble/ed25519';
import { createHash, randomUUID } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ENROL_CAPABILITY = 'aimeat.agents.enrol';
const KEY_GRANT = 'urn:aimeat:params:oauth:grant-type:agent-key';

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

async function signOwner(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const owner = `con${label}${Date.now().toString(36)}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'ConnectorPass12345' }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'ConnectorPass12345' }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await signOwner(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    return { owner, ownerToken: tok.body.data.token as string };
}

/** A v1 agent: the kind whose socket a connector holds before any v2 agent exists. */
async function addV1Agent(owner: string, ownerToken: string, name: string, scopes: string[] = ['*']) {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name, owner, capabilities: [], mode: 'interactive', scopes }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await signOwner(ag.body.data.private_key, gaii + ts) }),
    });
    return { name, gaii, token: tok.body.data.token as string };
}

/** A GEAI token for this owner: a real principal of a class that is not an agent. */
async function mintEcoToken(owner: string, ownerAuth: Record<string, string>, app: string): Promise<string> {
    const hello = await json('/v1/ecosystem-apps/hello', {
        method: 'POST',
        body: JSON.stringify({ owner, app, public_key: Buffer.from(`key-${app}`).toString('base64') }),
    });
    assert(hello.status === 200, `hello ${hello.status}`);
    const approve = await json(`/v1/ecosystem-apps/${hello.body.data.user_code}/approve`, {
        method: 'POST', headers: ownerAuth, body: JSON.stringify({ action: 'approve', scopes: ['memory:read', 'memory:write'] }),
    });
    assert(approve.status === 200, `approve ${approve.status}: ${JSON.stringify(approve.body?.error)}`);
    const tok = await json('/v1/ecosystem-apps/token', {
        method: 'POST',
        body: JSON.stringify({ device_code: hello.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(!!tok.body.access_token, `eco token ${tok.status}: ${JSON.stringify(tok.body)}`);
    return tok.body.access_token as string;
}

// ── The daemon, as a socket ──────────────────────────────────────────────────

interface FakeDaemon {
    ws: WebSocket;
    onEnrol: ((offer: any) => Promise<{ ok: boolean; result: unknown }>) | null;
    /** Every auth_revoked frame the node sent on this socket, and every attach it accepted. */
    revoked: any[];
    attached: string[];
    close(): void;
}

/** `installName` is sent the way the connector sends it: URI-encoded, because a host name may not be ASCII. */
function openDaemon(token: string, installId: string, installName?: string, runModes?: string): Promise<FakeDaemon> {
    return new Promise((resolve, reject) => {
        const wsUrl = BASE.replace(/^http/, 'ws') + '/v1/connect/tunnel';
        const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'X-AIMEAT-Install': installId };
        if (installName) headers['X-AIMEAT-Install-Name'] = encodeURIComponent(installName);
        if (runModes) headers['X-AIMEAT-Run-Modes'] = runModes;
        const ws = new WebSocket(wsUrl, { headers });
        const daemon: FakeDaemon = { ws, onEnrol: null, revoked: [], attached: [], close: () => { try { ws.close(); } catch { /* already gone */ } } };
        const timer = setTimeout(() => reject(new Error('tunnel did not welcome in time')), 10_000);
        ws.on('message', (data) => {
            let frame: any;
            try { frame = JSON.parse(data.toString()); } catch { return; }
            if (frame.type === 'welcome') { clearTimeout(timer); resolve(daemon); return; }
            if (frame.type === 'auth_revoked') { daemon.revoked.push(frame); return; }
            if (frame.type === 'attached') { daemon.attached.push(String(frame.agent)); return; }
            if (frame.type !== 'invoke') return;
            const answer = frame.capability === ENROL_CAPABILITY && daemon.onEnrol
                ? daemon.onEnrol(frame.input)
                : Promise.resolve({ ok: false, result: { code: 'NO_HANDLER', message: 'nothing listening' } });
            void answer.then(r => ws.send(JSON.stringify({ type: 'invoke_result', id: frame.id, ok: r.ok, result: r.result })));
        });
        ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
}

interface TestKey { privateKey: string; publicKey: string; kid: string }

async function makeKey(): Promise<TestKey> {
    const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
    const priv = await exportJWK(pair.privateKey);
    const pub = await exportJWK(pair.publicKey);
    const kid = await calculateJwkThumbprint({ kty: 'OKP', crv: 'Ed25519', x: pub.x! }, 'sha256');
    return { privateKey: priv.d!, publicKey: pub.x!, kid };
}

async function signWith(payload: unknown, key: TestKey): Promise<string> {
    const jwk = await importJWK({ kty: 'OKP', crv: 'Ed25519', d: key.privateKey, x: key.publicKey }, 'EdDSA');
    return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
        .setProtectedHeader({ alg: 'EdDSA', kid: key.kid })
        .sign(jwk);
}

function cardFor(offered: any, owner: string, key: TestKey) {
    return {
        spec: 'aimeat.agent-card/v1',
        gaii: offered.gaii,
        name: offered.name,
        owner,
        node: NODE_ID,
        displayName: offered.display_name ?? offered.name,
        description: offered.description ?? '',
        runtime: { platform: 'e2e-daemon', version: '1.0.0' },
        runMode: offered.run_mode ?? 'spawn',
        skills: [],
        modalities: ['text'],
        requestedScopes: offered.scopes ?? [],
        publicKey: { kty: 'OKP', crv: 'Ed25519', x: key.publicKey, kid: key.kid },
        jwksUri: offered.jwks_url,
        cardUri: offered.card_url,
        issuedAt: new Date().toISOString(),
    };
}

/** The key each agent holds after its latest enrolment, as the machine that enrolled it would. */
const keysByAgent = new Map<string, TestKey>();

async function signAssertion(gaii: string, key: TestKey) {
    const now = Math.floor(Date.now() / 1000);
    return signWith({ sub: gaii, aud: NODE_ID, iat: now, exp: now + 60, jti: randomUUID() }, key);
}

/** Whether this key still turns into a credential for the agent. */
async function keyWorks(gaii: string, key: TestKey): Promise<boolean> {
    const r = await json('/v1/agents/v2/token', { method: 'POST', body: JSON.stringify({ grant_type: KEY_GRANT, assertion: await signAssertion(gaii, key) }) });
    return r.status === 200;
}

/** The daemon half of an enrolment, recording which agents each machine was offered. */
function enrolWith(daemonToken: string, owner: string, heard: string[][]) {
    return async (offer: any) => {
        heard.push((offer.agents as any[]).map(x => x.name));
        const cards: string[] = [];
        const made = new Map<string, TestKey>();
        for (const offered of offer.agents) {
            const key = await makeKey();
            made.set(offered.name, key);
            cards.push(await signWith(cardFor(offered, owner, key), key));
        }
        const res = await json('/v1/agents/v2/enrol', {
            method: 'POST', headers: { Authorization: `Bearer ${daemonToken}` },
            body: JSON.stringify({ grant_id: offer.grant_id, cards }),
        });
        if (res.status !== 200) return { ok: false, result: res.body?.error ?? null };
        for (const [name, key] of made) keysByAgent.set(name, key);
        return { ok: true, result: { attached: (res.body.data.enrolled as any[]).map(e => e.name) } };
    };
}

const DEF = {
    agent_name: 'placeholder',
    agents: [{ role: 'Watcher', goal: 'watch', backstory: 'You watch.', allow_delegation: false, tools: ['memory'] }],
    tasks: [{ id: 'watch', description: 'Watch this: {{ctx.prompt}}', expected_output: 'notes', agent: 'Watcher' }],
};

/** One session on the node's own MCP server, as an agent: initialize once, then tools/call. */
async function mcpSession(token: string) {
    let sid: string | undefined;
    let id = 0;
    const rpc = async (method: string, params: Record<string, unknown> = {}) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(sid ? { 'mcp-session-id': sid, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        });
        sid = res.headers.get('mcp-session-id') ?? sid;
        const text = await res.text();
        const line = text.split('\n').find(l => l.startsWith('data: '));
        return JSON.parse(line ? line.slice(6) : text);
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-connectors', version: '1' } });
    return async (name: string, args: Record<string, unknown>) => {
        const body = await rpc('tools/call', { name, arguments: args });
        const t = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body);
        let data: any; try { data = JSON.parse(t); } catch { data = null; }
        return { isError: body?.result?.isError === true || !!body?.error, text: t as string, data };
    };
}

async function until(what: string, cond: () => Promise<boolean>, ms = 25_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await cond()) return; await new Promise(r => setTimeout(r, 300)); }
    throw new Error(`timed out waiting for ${what}`);
}

console.log('\n=== Connectors: named machines, and an agent ordered to one ===\n');

async function run() {
    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const authA = { Authorization: `Bearer ${a.ownerToken}` };
    const authB = { Authorization: `Bearer ${b.ownerToken}` };

    // The server's id sorts FIRST, so every default lands on it: a choice that reaches the laptop is
    // the choice working, not the sort order.
    const SERVER = 'aaa-server';
    const LAPTOP = 'zzz-laptop';
    const seatLaptop = await addV1Agent(a.owner, a.ownerToken, 'seat-laptop');
    const seatServer = await addV1Agent(a.owner, a.ownerToken, 'seat-server');
    const reader = await addV1Agent(a.owner, a.ownerToken, 'plain-reader', ['memory:read', 'memory:write']);
    const seatB = await addV1Agent(b.owner, b.ownerToken, 'seat-b');

    const list = async (auth: Record<string, string>) => json('/v1/agents/v2/connectors', { headers: auth });
    const connectorOf = async (id: string) => ((await list(authA)).body?.data?.connectors as any[] ?? []).find(c => c.id === id);
    const recordOf = async (name: string) => (await json('/v1/agents?owner=' + a.owner, { headers: authA }))
        .body.data.agents.find((x: any) => x.name === name);
    const propose = (name: string, extra: Record<string, unknown> = {}) => json('/v1/agents/v2/agent-proposals', {
        method: 'POST', headers: authA,
        body: JSON.stringify({ name, purpose: 'Watches the sources and reports what changed.', scopes: ['memory:read'], crew_def: DEF, ...extra }),
    });
    const approve = (id: string, body: Record<string, unknown> = {}) => json(`/v1/agents/v2/agent-proposals/${id}/approve`, {
        method: 'POST', headers: authA, body: JSON.stringify(body),
    });

    // ── 1. Nothing connected ──────────────────────────────────────────────────
    await test('an owner with no connector has an empty list', async () => {
        const r = await list(authA);
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(Array.isArray(r.body.data.connectors) && r.body.data.connectors.length === 0,
            `expected no connectors, got ${JSON.stringify(r.body.data.connectors)}`);
    });

    // ── 2. Two machines connect ───────────────────────────────────────────────
    const heardLaptop: string[][] = [];
    const heardServer: string[][] = [];
    let dLaptop = await openDaemon(seatLaptop.token, LAPTOP, 'Jounin läppäri');
    let dServer = await openDaemon(seatServer.token, SERVER);
    dLaptop.onEnrol = enrolWith(seatLaptop.token, a.owner, heardLaptop);
    dServer.onEnrol = enrolWith(seatServer.token, a.owner, heardServer);
    const dB = await openDaemon(seatB.token, 'bbb-other', 'B machine');

    await test('each connected machine is listed with the name it reported and what it holds', async () => {
        const r = await list(authA);
        const rows = r.body.data.connectors as any[];
        assert(rows.length === 2, `expected two connectors, got ${JSON.stringify(rows)}`);
        const laptop = rows.find(c => c.id === LAPTOP);
        const server = rows.find(c => c.id === SERVER);
        assert(!!laptop && !!server, `both ids should be listed, got ${rows.map(c => c.id).join(',')}`);
        assert(laptop.online === true && server.online === true, 'both are connected right now');
        assert(laptop.reported_name === 'Jounin läppäri', `the reported name survives its encoding, got ${JSON.stringify(laptop.reported_name)}`);
        assert(laptop.name === 'Jounin läppäri', `with no name from the owner the reported one is the name, got ${JSON.stringify(laptop.name)}`);
        assert(server.reported_name === null && server.name === null, `a connector that reports no name has none, got ${JSON.stringify(server)}`);
        assert((laptop.agents as string[]).includes('seat-laptop'), `the laptop holds seat-laptop, got ${JSON.stringify(laptop.agents)}`);
        assert(!(laptop.agents as string[]).includes('seat-server'), 'and not the server\'s agent');
        assert(laptop.run_modes === null, `a connector that presents no run modes has none, got ${JSON.stringify(laptop.run_modes)}`);
    });

    await test('another owner sees only their own connector', async () => {
        const r = await list(authB);
        const ids = (r.body.data.connectors as any[]).map(c => c.id);
        assert(JSON.stringify(ids) === JSON.stringify(['bbb-other']), `owner b should see only its own, got ${JSON.stringify(ids)}`);
    });

    await test('an ecosystem app cannot read how the account\'s machines are set up', async () => {
        const eco = await mintEcoToken(a.owner, authA, 'conn-reader');
        const r = await list({ Authorization: `Bearer ${eco}` });
        assert(r.status === 403, `expected 403 for an ecosystem app, got ${r.status}`);
    });

    await test('an agent of the owner can read the list', async () => {
        const r = await list({ Authorization: `Bearer ${reader.token}` });
        assert(r.status === 200 && (r.body.data.connectors as any[]).length === 2, `expected the two connectors, got ${r.status}`);
    });

    // ── 3. Rename ─────────────────────────────────────────────────────────────
    const rename = (auth: Record<string, string>, id: string, name: unknown) => json(`/v1/agents/v2/connectors/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: auth, body: JSON.stringify({ name }),
    });

    await test('the owner names a machine, and the reported name is kept beside it', async () => {
        const r = await rename(authA, LAPTOP, 'Kotikone');
        assert(r.status === 200, `rename ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const row = await connectorOf(LAPTOP);
        assert(row.name === 'Kotikone', `expected Kotikone, got ${JSON.stringify(row.name)}`);
        assert(row.reported_name === 'Jounin läppäri', 'the reported name is still there');
    });

    await test('a name is one line of ordinary length, or it is refused', async () => {
        const empty = await rename(authA, SERVER, '   ');
        assert(empty.status === 400, `an empty name: expected 400, got ${empty.status}`);
        const long = await rename(authA, SERVER, 'x'.repeat(61));
        assert(long.status === 400, `61 characters: expected 400, got ${long.status}`);
        const two = await rename(authA, SERVER, 'Kotikone');
        assert(two.status === 409 && two.body?.error?.code === 'NAME_TAKEN',
            `two machines with one name cannot be told apart: expected 409 NAME_TAKEN, got ${two.status} ${two.body?.error?.code}`);
    });

    await test('renaming takes agent:write, and never reaches another account', async () => {
        const asReader = await rename({ Authorization: `Bearer ${reader.token}` }, SERVER, 'Mine now');
        assert(asReader.status === 403, `an agent without agent:write: expected 403, got ${asReader.status}`);
        const asOther = await rename(authB, SERVER, 'Mine now');
        assert(asOther.status === 404, `another owner must not learn it exists: expected 404, got ${asOther.status}`);
        const row = await connectorOf(SERVER);
        assert(row.name === null, `the server is still unnamed, got ${JSON.stringify(row.name)}`);
    });

    // ── 4. A proposal names a machine ─────────────────────────────────────────
    await test('a proposal that names an unknown machine is refused and writes nothing', async () => {
        const r = await propose('nowhere-watcher', { connector: 'No such machine' });
        assert(r.status === 400 && r.body?.error?.code === 'UNKNOWN_CONNECTOR',
            `expected 400 UNKNOWN_CONNECTOR, got ${r.status} ${r.body?.error?.code}`);
        const all = await json('/v1/agents/v2/agent-proposals', { headers: authA });
        assert(!(all.body.data.proposals as any[]).some(p => p.name === 'nowhere-watcher'), 'no proposal was written');
    });

    let laptopProposal = '';
    await test('a proposal can name a machine by the owner\'s name for it', async () => {
        const r = await propose('laptop-watcher', { connector: 'kotikone' });
        assert(r.status === 201, `propose ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.proposal.install_id === LAPTOP, `expected ${LAPTOP}, got ${JSON.stringify(r.body.data.proposal.install_id)}`);
        assert(r.body.data.proposal.connector_name === 'Kotikone', `and the name as the owner wrote it, got ${JSON.stringify(r.body.data.proposal.connector_name)}`);
        laptopProposal = r.body.data.proposal.id;
    });

    await test('approving it reaches the named machine and no other', async () => {
        heardLaptop.length = 0; heardServer.length = 0;
        const r = await approve(laptopProposal);
        assert(r.status === 200, `approve ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.attached === true, `expected attached, got ${JSON.stringify(r.body.data.attach_problem)}`);
        assert(r.body.data.connector?.id === LAPTOP, `the answer names the machine, got ${JSON.stringify(r.body.data.connector)}`);
        assert(heardLaptop.length === 1 && heardServer.length === 0,
            `only the laptop is asked: laptop ${JSON.stringify(heardLaptop)}, server ${JSON.stringify(heardServer)}`);
        const row = await connectorOf(LAPTOP);
        assert((row.agents as string[]).includes('laptop-watcher'), `the laptop now holds the agent, got ${JSON.stringify(row.agents)}`);
    });

    await test('the approval may name a different machine than the proposal did', async () => {
        // Proposed for the server, which is also where every default lands, and approved for the
        // laptop: only the approval's own choice can explain the laptop being asked.
        const p = await propose('moved-watcher', { connector: SERVER });
        heardLaptop.length = 0; heardServer.length = 0;
        const r = await approve(p.body.data.proposal.id, { install_id: LAPTOP });
        assert(r.status === 200 && r.body.data.attached === true, `approve ${r.status}: ${JSON.stringify(r.body?.data?.attach_problem ?? r.body?.error)}`);
        assert(heardLaptop.length === 1 && heardServer.length === 0,
            `only the laptop is asked: laptop ${JSON.stringify(heardLaptop)}, server ${JSON.stringify(heardServer)}`);
    });

    await test('approving for an unknown machine is refused before anything is created', async () => {
        const p = await propose('ghost-watcher');
        const r = await approve(p.body.data.proposal.id, { install_id: 'no-such-install' });
        assert(r.status === 409 && r.body?.error?.code === 'UNKNOWN_CONNECTOR',
            `expected 409 UNKNOWN_CONNECTOR, got ${r.status} ${r.body?.error?.code}`);
        assert(!(await recordOf('ghost-watcher')), 'no agent was created');
        const again = await approve(p.body.data.proposal.id);
        assert(again.status === 200, `and the proposal can still be approved, got ${again.status}`);
    });

    // ── 4b. The same three things from a chat, over the node's MCP server ─────
    const asSeat = await mcpSession(seatLaptop.token);
    const asReader = await mcpSession(reader.token);

    await test('MCP: an agent reads the machines by the names the owner gave them', async () => {
        const r = await asSeat('aimeat_connector_list', {});
        assert(!r.isError, `aimeat_connector_list failed: ${r.text}`);
        const rows = r.data?.connectors as any[];
        assert(Array.isArray(rows) && rows.length === 2, `expected two connectors, got ${r.text.slice(0, 200)}`);
        assert(rows.find(c => c.id === LAPTOP)?.name === 'Kotikone', 'the laptop carries the owner\'s name');
    });

    await test('MCP: a proposal made from a chat names the machine, and it is stored by id', async () => {
        const r = await asSeat('aimeat_agent_propose', {
            name: 'mcp-watcher', purpose: 'Watches the sources and reports what changed.',
            scopes: ['memory:read'], crew_def: DEF, connector: 'Kotikone',
        });
        assert(!r.isError, `aimeat_agent_propose failed: ${r.text}`);
        assert(r.data?.proposal?.install_id === LAPTOP, `expected ${LAPTOP}, got ${JSON.stringify(r.data?.proposal?.install_id)}`);
    });

    await test('MCP: naming a machine takes agent:write', async () => {
        const refused = await asReader('aimeat_connector_rename', { connector: SERVER, name: 'Mine now' });
        assert(refused.isError, `an agent without agent:write must be refused, got ${refused.text.slice(0, 160)}`);
        assert((await connectorOf(SERVER)).name === null, 'and the server is still unnamed');
        const ok = await asSeat('aimeat_connector_rename', { connector: SERVER, name: 'Palvelin' });
        assert(!ok.isError, `aimeat_connector_rename failed: ${ok.text}`);
        assert((await connectorOf(SERVER)).name === 'Palvelin', 'the server carries the new name');
    });

    // ── 5. The chosen machine is not connected ────────────────────────────────
    dLaptop.close();
    await until('the laptop to read as disconnected', async () => (await connectorOf(LAPTOP))?.online === false);

    await test('a machine that disconnected stays listed, with when it was last seen', async () => {
        const row = await connectorOf(LAPTOP);
        assert(!!row && row.online === false, 'still listed, and not connected');
        assert(row.name === 'Kotikone', 'with the owner\'s name');
        assert(typeof row.last_seen === 'string' && !Number.isNaN(Date.parse(row.last_seen)), `last_seen is a time, got ${JSON.stringify(row.last_seen)}`);
        assert((row.agents as string[]).includes('laptop-watcher'), 'and the agents that live there');
    });

    await test('an agent approved for a disconnected machine waits for that machine', async () => {
        const p = await propose('late-watcher', { connector: LAPTOP });
        heardLaptop.length = 0; heardServer.length = 0;
        const r = await approve(p.body.data.proposal.id);
        assert(r.status === 200, `approve ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.created === true && r.body.data.attached === false, 'made, and not attached');
        assert(r.body.data.waiting_for_connector === true, 'the answer says it waits');
        assert(r.body.data.connector?.id === LAPTOP && r.body.data.connector?.name === 'Kotikone',
            `and for which machine, got ${JSON.stringify(r.body.data.connector)}`);
        assert(heardServer.length === 0, `the connected server is not asked instead, got ${JSON.stringify(heardServer)}`);
        const row = await connectorOf(LAPTOP);
        assert((row.waiting as string[]).includes('late-watcher'), `the laptop lists it as waiting, got ${JSON.stringify(row.waiting)}`);
    });

    // ── 5b. The home's read of the same state (GET /v1/home/agents) ────────────
    // Here the laptop is away with laptop-watcher on it and late-watcher waiting for it, and the
    // server is connected: every state the home's rows tell apart exists at once.
    const homeAgents = (auth: Record<string, string>, query = '?limit=20') => json('/v1/home/agents' + query, { headers: auth });

    await test('the home reads each worker with its machine and whether it still waits', async () => {
        const r = await homeAgents(authA);
        assert(r.status === 200, `home agents ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const workers = r.body.data.workers as any[];
        const machines = r.body.data.connectors as any[];
        const late = workers.find(w => w.name === 'late-watcher');
        assert(!!late && late.has_key === false, `late-watcher is listed without a key, got ${JSON.stringify(late)}`);
        assert(late.connector?.id === LAPTOP && late.connector?.name === 'Kotikone' && late.connector?.online === false,
            `and with the machine it waits for, got ${JSON.stringify(late.connector)}`);
        assert(late.when === 'ask', `a task runner with no schedule works when asked, got ${late.when}`);
        const settled = workers.find(w => w.name === 'laptop-watcher');
        assert(!!settled && settled.has_key === true && settled.connector?.id === LAPTOP,
            `laptop-watcher holds a key on the laptop, got ${JSON.stringify(settled)}`);
        assert(!workers.some(w => w.name === 'seat-laptop' || w.name === 'plain-reader'),
            'a chat agent that only holds a connection is not a worker');
        const laptop = machines.find(c => c.id === LAPTOP);
        const server = machines.find(c => c.id === SERVER);
        assert(laptop?.online === false && laptop?.waiting === 1, `the laptop is away with one agent waiting, got ${JSON.stringify(laptop)}`);
        assert(server?.online === true, `the server is connected, got ${JSON.stringify(server)}`);
        assert(r.body.data.worker_total >= workers.length, 'the total counts at least the rows shown');
    });

    await test('the home reads one agent by name, and an unknown name is an empty answer', async () => {
        const one = await homeAgents(authA, '?agent=late-watcher');
        assert(one.status === 200, `one agent ${one.status}`);
        const names = (one.body.data.workers as any[]).map(w => w.name);
        assert(names.length === 1 && names[0] === 'late-watcher', `exactly that agent, got ${JSON.stringify(names)}`);
        const none = await homeAgents(authA, '?agent=no-such-agent');
        assert(none.status === 200 && (none.body.data.workers as any[]).length === 0, 'an unknown name answers with no worker');
    });

    await test('the home\'s agents are the owner\'s in person, and never another account\'s', async () => {
        const asAgent = await homeAgents({ Authorization: `Bearer ${seatServer.token}` });
        assert(asAgent.status === 403, `an agent carrying the owner's name is not the owner: got ${asAgent.status}`);
        const eco = await mintEcoToken(a.owner, authA, 'home-reader');
        const asApp = await homeAgents({ Authorization: `Bearer ${eco}` });
        assert(asApp.status === 403, `expected 403 for an ecosystem app, got ${asApp.status}`);
        const anonymous = await homeAgents({});
        assert(anonymous.status === 401 || anonymous.status === 403, `no credential is refused, got ${anonymous.status}`);
        const other = await homeAgents(authB);
        assert(other.status === 200, `the other owner reads their own home, got ${other.status}`);
        assert(!(other.body.data.workers as any[]).some(w => w.name === 'late-watcher'), 'and none of this owner\'s agents');
        assert(!(other.body.data.connectors as any[]).some(c => c.id === LAPTOP || c.id === SERVER), 'and none of this owner\'s machines');
    });

    await test('the other machine reconnecting is offered nothing', async () => {
        dServer.close();
        await new Promise(r => setTimeout(r, 500));
        heardServer.length = 0;
        dServer = await openDaemon(seatServer.token, SERVER);
        dServer.onEnrol = enrolWith(seatServer.token, a.owner, heardServer);
        // Past the settle wait and the freshness wait of the pending-enrolment offer.
        await new Promise(r => setTimeout(r, 13_000));
        assert(heardServer.length === 0, `the server must not be offered the laptop's agent, got ${JSON.stringify(heardServer)}`);
        assert(!(await recordOf('late-watcher'))?.enrolled_at, 'and the agent still has no key');
    });

    await test('when the chosen machine connects, the agent gets its key there', async () => {
        heardLaptop.length = 0;
        dLaptop = await openDaemon(seatLaptop.token, LAPTOP, 'Jounin läppäri');
        dLaptop.onEnrol = enrolWith(seatLaptop.token, a.owner, heardLaptop);
        await until('late-watcher to hold a key', async () => !!(await recordOf('late-watcher'))?.enrolled_at);
        assert(heardLaptop.some(names => names.includes('late-watcher')), `the laptop was the one asked, got ${JSON.stringify(heardLaptop)}`);
        const row = await connectorOf(LAPTOP);
        assert((row.agents as string[]).includes('late-watcher'), 'the laptop holds it now');
        assert(!(row.waiting as string[]).includes('late-watcher'), 'and it no longer waits');
        assert(row.name === 'Kotikone', `the owner's name survives a reconnect, got ${JSON.stringify(row.name)}`);
    });

    // ── 6. Move an agent to another machine ───────────────────────────────────
    const move = (auth: Record<string, string>, name: string, installId: unknown) => json(`/v1/agents/v2/agents/${name}/move`, {
        method: 'POST', headers: auth, body: JSON.stringify({ install_id: installId }),
    });
    const gaiiOf = (name: string) => `${name}#${a.owner}@${NODE_ID}`;

    await test('moving is the owner in person, and never reaches another account', async () => {
        const asAgent = await move({ Authorization: `Bearer ${seatServer.token}` }, 'laptop-watcher', SERVER);
        assert(asAgent.status === 403, `an agent carrying the owner's name is not the owner: got ${asAgent.status}`);
        const asOther = await move(authB, 'laptop-watcher', SERVER);
        assert(asOther.status === 404, `another owner must not learn it exists: got ${asOther.status}`);
    });

    await test('an agent moves to another connected machine, and the key on the old machine stops working', async () => {
        const oldKey = keysByAgent.get('laptop-watcher')!;
        assert(await keyWorks(gaiiOf('laptop-watcher'), oldKey), 'before the move the laptop\'s key works');
        // The laptop holds the agent on its socket, as a connector does: attached with a credential
        // minted from the agent's key. That socket identity is what the move has to reach.
        const minted = await json('/v1/agents/v2/token', { method: 'POST', body: JSON.stringify({ grant_type: KEY_GRANT, assertion: await signAssertion(gaiiOf('laptop-watcher'), oldKey) }) });
        dLaptop.ws.send(JSON.stringify({ type: 'attach', id: randomUUID(), agent: gaiiOf('laptop-watcher'), token: minted.body?.access_token ?? minted.body?.data?.access_token }));
        await until('the laptop to hold laptop-watcher on its socket', async () => dLaptop.attached.includes(gaiiOf('laptop-watcher')));
        heardLaptop.length = 0; heardServer.length = 0;
        const r = await move(authA, 'laptop-watcher', SERVER);
        assert(r.status === 200, `move ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.moved === true && r.body.data.connector?.id === SERVER, `the answer names the new machine, got ${JSON.stringify(r.body.data)}`);
        assert(heardServer.length === 1 && heardLaptop.length === 0, 'only the server is asked to take it');
        const newKey = keysByAgent.get('laptop-watcher')!;
        assert(newKey.kid !== oldKey.kid, 'the server made a key of its own');
        assert(await keyWorks(gaiiOf('laptop-watcher'), newKey), 'the server\'s key works');
        assert(!(await keyWorks(gaiiOf('laptop-watcher'), oldKey)), 'the laptop\'s key no longer does');
        // The old connector is told WHY, so it removes the agent instead of keeping a dead key, and
        // a mint with that key is answered as a verdict on the key, not as a passing failure.
        await until('the laptop to be told', async () => dLaptop.revoked.some(f => f.agent === gaiiOf('laptop-watcher')), 5_000);
        const told = dLaptop.revoked.find(f => f.agent === gaiiOf('laptop-watcher'));
        assert(told?.reason === 'moved', `the frame says the agent moved, got ${JSON.stringify(told)}`);
        assert(!dLaptop.revoked.some(f => f.agent !== gaiiOf('laptop-watcher')), 'and no other identity on that connector is revoked');
        const refused = await json('/v1/agents/v2/token', { method: 'POST', body: JSON.stringify({ grant_type: KEY_GRANT, assertion: await signAssertion(gaiiOf('laptop-watcher'), oldKey) }) });
        assert(refused.status === 401 && refused.body?.error?.details?.reason === 'key_not_pinned',
            `the old key is refused as a key the node does not pin, got ${refused.status} ${JSON.stringify(refused.body?.error)}`);
        const server = await connectorOf(SERVER);
        const laptop = await connectorOf(LAPTOP);
        assert((server.agents as string[]).includes('laptop-watcher'), 'the server lists it');
        assert(!(laptop.agents as string[]).includes('laptop-watcher'), 'and the laptop no longer does');
    });

    await test('a move that cannot happen changes nothing', async () => {
        const key = keysByAgent.get('laptop-watcher')!;
        const there = await move(authA, 'laptop-watcher', SERVER);
        assert(there.status === 409 && there.body?.error?.code === 'ALREADY_THERE',
            `expected 409 ALREADY_THERE, got ${there.status} ${there.body?.error?.code}`);
        const nowhere = await move(authA, 'laptop-watcher', 'no-such-install');
        assert(nowhere.status === 409 && nowhere.body?.error?.code === 'UNKNOWN_CONNECTOR',
            `expected 409 UNKNOWN_CONNECTOR, got ${nowhere.status} ${nowhere.body?.error?.code}`);
        const noAgent = await move(authA, 'no-such-agent', SERVER);
        assert(noAgent.status === 404, `expected 404 for an agent that does not exist, got ${noAgent.status}`);
        assert(await keyWorks(gaiiOf('laptop-watcher'), key), 'and the agent\'s key still works');
    });

    // ── 6b. A move re-decides the run mode against the connector the agent goes to ──
    // Found by a real two-connector run on 2026-10-11: a resident agent moved to a connector that
    // only starts a worker per job kept `resident`, and nobody ran it there.
    const ALWAYS = 'mmm-always';
    const SPAWN_ONLY = 'sss-spawn-only';
    const seatAlways = await addV1Agent(a.owner, a.ownerToken, 'seat-always');
    const seatSpawn = await addV1Agent(a.owner, a.ownerToken, 'seat-spawn');
    const heardAlways: string[][] = [];
    const heardSpawn: string[][] = [];
    const dAlways = await openDaemon(seatAlways.token, ALWAYS, 'Aina päällä', 'spawn,resident');
    dAlways.onEnrol = enrolWith(seatAlways.token, a.owner, heardAlways);
    const dSpawn = await openDaemon(seatSpawn.token, SPAWN_ONLY, 'Vain spawn', 'spawn');
    dSpawn.onEnrol = enrolWith(seatSpawn.token, a.owner, heardSpawn);
    await until('both run-mode connectors to be listed', async () => !!(await connectorOf(ALWAYS)) && !!(await connectorOf(SPAWN_ONLY)));

    await test('a resident agent keeps its run mode on a connector that keeps agents running, or that never said', async () => {
        const p = await propose('stay-up', { connector: ALWAYS, run_mode: 'resident' });
        const r = await approve(p.body.data.proposal.id);
        assert(r.status === 200 && r.body.data.attached === true, `approve ${r.status}: ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
        assert((await recordOf('stay-up'))?.run_mode === 'resident', 'approved as resident on a connector that says it keeps agents running');
        const toServer = await move(authA, 'stay-up', SERVER);
        assert(toServer.status === 200, `move to the server ${toServer.status}: ${JSON.stringify(toServer.body?.error)}`);
        assert(toServer.body.data.run_mode === 'resident' && toServer.body.data.run_mode_corrected === null,
            `a connector that never said how it runs agents is not second-guessed, got ${JSON.stringify(toServer.body.data)}`);
        assert((await recordOf('stay-up'))?.run_mode === 'resident', 'and the record still says resident');
    });

    await test('a resident agent moved to a connector that only starts a worker per job becomes spawn, and the answer says so', async () => {
        const r = await move(authA, 'stay-up', SPAWN_ONLY);
        assert(r.status === 200, `move ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.run_mode === 'spawn', `the answer carries the run mode it has now, got ${JSON.stringify(r.body.data.run_mode)}`);
        assert(r.body.data.run_mode_corrected?.asked === 'resident' && typeof r.body.data.run_mode_corrected?.reason === 'string',
            `and says what it was and why, got ${JSON.stringify(r.body.data.run_mode_corrected)}`);
        assert((await recordOf('stay-up'))?.run_mode === 'spawn', 'the record is spawn, so the connector\'s spawner serves it');
        const back = await move(authA, 'stay-up', ALWAYS);
        assert(back.status === 200 && back.body.data.run_mode === 'spawn' && back.body.data.run_mode_corrected === null,
            `moving back changes nothing more: nobody asked for resident again, got ${JSON.stringify(back.body?.data)}`);
    });

    await test('a definition that listens for direct messages with no reply tool is proposed with a warning, and one that can answer is not', async () => {
        // Measured on aimeat.io on 2026-10-11: such an agent read its first message and sent nothing.
        const deaf = await propose('hears-only', { crew_def: { ...DEF, listen_for: ['tasks', 'dms'] } });
        assert(deaf.status === 201, `a warning refuses nothing: got ${deaf.status} ${JSON.stringify(deaf.body?.error)}`);
        const codes = (deaf.body.data.proposal.warnings as any[]).map(w => w.code);
        assert(codes.includes('DM_WITHOUT_REPLY_TOOL'), `the proposal says it cannot answer, got ${JSON.stringify(deaf.body.data.proposal.warnings)}`);
        const able = await propose('hears-and-answers', {
            crew_def: { ...DEF, listen_for: ['tasks', 'dms'], agents: [{ ...DEF.agents[0], tools: ['memory', 'dm'] }] },
        });
        assert(able.status === 201 && (able.body.data.proposal.warnings as any[]).length === 0,
            `a member with the dm tool leaves nothing to warn about, got ${JSON.stringify(able.body?.data?.proposal?.warnings)}`);
        const quiet = await propose('tasks-only', {});
        assert((quiet.body.data.proposal.warnings as any[]).length === 0, 'a definition that listens for tasks only has no warning');
        for (const p of [deaf, able, quiet]) {
            await json(`/v1/agents/v2/agent-proposals/${p.body.data.proposal.id}/decline`, { method: 'POST', headers: authA, body: '{}' });
        }
    });

    await test('the agent list names the connector each agent is on, for the owner and the owner\'s agents only', async () => {
        const rows = (await json('/v1/agents?owner=' + a.owner, { headers: authA })).body.data.agents as any[];
        const at = (name: string) => rows.find(x => x.name === name)?.install_id;
        assert(at('stay-up') === ALWAYS, `stay-up is on the connector it was last moved to, got ${JSON.stringify(at('stay-up'))}`);
        assert(at('laptop-watcher') === SERVER, `laptop-watcher is on the server since its move, got ${JSON.stringify(at('laptop-watcher'))}`);
        const asAgent = (await json('/v1/agents?owner=' + a.owner, { headers: { Authorization: `Bearer ${seatServer.token}` } })).body.data.agents as any[];
        assert(asAgent.find(x => x.name === 'stay-up')?.install_id === ALWAYS, 'an agent of the owner reads the same placement: a runtime reads its roster this way');
        const eco = await mintEcoToken(a.owner, authA, 'roster-reader');
        const asApp = await json('/v1/agents?owner=' + a.owner, { headers: { Authorization: `Bearer ${eco}` } });
        const appRows = (asApp.body?.data?.agents ?? []) as any[];
        assert(appRows.every(x => x.install_id === null || x.install_id === undefined),
            `an ecosystem app learns no placement, got ${JSON.stringify(appRows.filter(x => x.install_id).map(x => x.name))}`);
        const other = (await json('/v1/agents?owner=' + b.owner, { headers: authB })).body.data.agents as any[];
        assert(!other.some(x => [ALWAYS, SPAWN_ONLY, SERVER, LAPTOP].includes(x.install_id)), 'another owner\'s list names none of these connectors');
    });

    dAlways.close();
    dSpawn.close();

    // ── 7. Forget ─────────────────────────────────────────────────────────────
    const forget = (auth: Record<string, string>, id: string) => json(`/v1/agents/v2/connectors/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth });

    await test('a connected machine cannot be forgotten', async () => {
        const r = await forget(authA, LAPTOP);
        assert(r.status === 409 && r.body?.error?.code === 'CONNECTOR_ONLINE',
            `expected 409 CONNECTOR_ONLINE, got ${r.status} ${r.body?.error?.code}`);
    });

    await test('forgetting is the owner in person, and never reaches another account', async () => {
        dLaptop.close();
        await until('the laptop to read as disconnected', async () => (await connectorOf(LAPTOP))?.online === false);
        const asAgent = await forget({ Authorization: `Bearer ${seatServer.token}` }, LAPTOP);
        assert(asAgent.status === 403, `an agent carrying the owner's name is not the owner: got ${asAgent.status}`);
        const asOther = await forget(authB, LAPTOP);
        assert(asOther.status === 404, `another owner must not learn it exists: got ${asOther.status}`);
        assert(!!(await connectorOf(LAPTOP)), 'and it is still listed');
    });

    // The laptop is disconnected from here on.
    await test('an agent with a key cannot move to a machine that is not connected', async () => {
        const key = keysByAgent.get('laptop-watcher')!;
        const r = await move(authA, 'laptop-watcher', LAPTOP);
        assert(r.status === 409 && r.body?.error?.code === 'DAEMON_NOT_CONNECTED',
            `expected 409 DAEMON_NOT_CONNECTED, got ${r.status} ${r.body?.error?.code}`);
        assert(await keyWorks(gaiiOf('laptop-watcher'), key), 'and its key on the server still works');
    });

    await test('an agent that waits for a machine is sent to another one instead', async () => {
        const p = await propose('retarget-watcher', { connector: LAPTOP });
        const approved = await approve(p.body.data.proposal.id);
        assert(approved.body?.data?.waiting_for_connector === true, 'setup: it waits for the laptop');
        heardServer.length = 0;
        const r = await move(authA, 'retarget-watcher', SERVER);
        assert(r.status === 200 && r.body.data.moved === true, `move ${r.status}: ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
        assert(heardServer.some(names => names.includes('retarget-watcher')), 'the server is asked to take it');
        assert(!!(await recordOf('retarget-watcher'))?.enrolled_at, 'and it holds a key now');
        const laptop = await connectorOf(LAPTOP);
        assert(!(laptop.waiting as string[]).includes('retarget-watcher'), 'the laptop no longer lists it as waiting');
    });

    await test('the owner forgets a disconnected machine, and its agents stay', async () => {
        const r = await forget(authA, LAPTOP);
        assert(r.status === 200, `forget ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(!(await connectorOf(LAPTOP)), 'it has left the list');
        assert(!!(await recordOf('late-watcher')), 'the agent that lived there still exists');
    });

    dServer.close();
    dB.close();
}

run().then(() => {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
    console.error('Suite crashed:', err);
    process.exit(1);
});
