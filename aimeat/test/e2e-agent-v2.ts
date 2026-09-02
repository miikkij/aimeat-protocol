/**
 * @file test/e2e-agent-v2.ts
 * @description Agent v2: the key-and-card identity, and the one button that proves it.
 *
 *   THE ACCEPTANCE TEST IS THE BUTTON. An owner whose `connect serve` is already connected presses
 *   once and has three working agents, having pasted nothing and restarted nothing. Everything else
 *   here is either a step of that or a refusal that has to hold while it happens.
 *
 *   THIS SUITE OPENS A REAL TUNNEL. The enrolment path is defined by the fact that the daemon is
 *   ALREADY connected — that is the whole reason it exists, because the alternative is a restart
 *   that drops every other agent. A mock would prove the handler and not the thing. So the test
 *   opens a WebSocket to /v1/connect/tunnel with an agent's bearer, receives the node's `invoke`
 *   offer on it, acts as the daemon (a keypair and a signed card per agent), and answers.
 *
 *   THE REFUSALS COME FIRST in the order that matters: a daemon cannot enrol for another owner,
 *   cannot get more scope than the template grants, cannot spend a grant twice, cannot submit a card
 *   signed by a key other than the one it carries, and cannot press the button at all without being
 *   the account holder. An agent granted `agent:write` cannot create one for anybody else.
 *
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-v2
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial, with the feature.
 */
import { WebSocket } from 'ws';
import { CompactSign, importJWK, exportJWK, generateKeyPair, calculateJwkThumbprint, compactVerify } from 'jose';
import * as ed from '@noble/ed25519';
import { createHash, randomUUID } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ENROL_CAPABILITY = 'aimeat.agents.enrol';
const KEY_GRANT = 'urn:aimeat:params:oauth:grant-type:agent-key';
const BASIC_NAMES = ['concierge', 'workflow-manager'];

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
    const owner = `av2${label}${Date.now().toString(36)}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'AgentV2Pass12345' }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'AgentV2Pass12345' }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await signOwner(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    return { owner, ownerToken: tok.body.data.token as string };
}

/** A v1 agent — the kind that exists today, and the kind whose socket the daemon holds. */
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

// ── The daemon, as a socket ──────────────────────────────────────────────────

interface FakeDaemon {
    ws: WebSocket;
    /** Called with the enrolment offer; whatever it returns is sent back as the invoke_result. */
    onEnrol: ((offer: any) => Promise<{ ok: boolean; result: unknown }>) | null;
    /** Any other capability the node invokes on this principal (crew.validate and friends). */
    onInvoke: ((capability: string, input: any) => Promise<{ ok: boolean; result: unknown }>) | null;
    close(): void;
}

function openDaemon(token: string, installId?: string): Promise<FakeDaemon> {
    return new Promise((resolve, reject) => {
        const wsUrl = BASE.replace(/^http/, 'ws') + '/v1/connect/tunnel';
        // The install id says which MACHINE this socket is on. A real connector always sends one;
        // omitting it here is how the suite also exercises the pre-2026-09-01 shape.
        const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
        if (installId) headers['X-AIMEAT-Install'] = installId;
        const ws = new WebSocket(wsUrl, { headers });
        const daemon: FakeDaemon = { ws, onEnrol: null, onInvoke: null, close: () => { try { ws.close(); } catch { /* already gone */ } } };
        const timer = setTimeout(() => reject(new Error('tunnel did not welcome in time')), 10_000);
        ws.on('message', (data) => {
            let frame: any;
            try { frame = JSON.parse(data.toString()); } catch { return; }
            if (frame.type === 'welcome') { clearTimeout(timer); resolve(daemon); return; }
            if (frame.type !== 'invoke') return;
            const answer = frame.capability === ENROL_CAPABILITY
                ? (daemon.onEnrol
                    ? daemon.onEnrol(frame.input)
                    : Promise.resolve({ ok: false, result: { code: 'NO_HANDLER', message: 'nothing listening' } }))
                : (daemon.onInvoke
                    ? daemon.onInvoke(frame.capability, frame.input)
                    : Promise.resolve({ ok: false, result: { code: 'NO_HANDLER', message: 'nothing listening' } }));
            void answer.then(r => ws.send(JSON.stringify({ type: 'invoke_result', id: frame.id, ok: r.ok, result: r.result })));
        });
        ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
}

/**
 * A GEAI token for this owner: the cheapest real principal of a class that is NOT an agent, and it
 * takes the same handler branch an app grant does. Three calls and no app to publish.
 */
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

// ── Keys and cards ───────────────────────────────────────────────────────────

interface TestKey { privateKey: string; publicKey: string; kid: string }

async function makeKey(): Promise<TestKey> {
    const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
    const priv = await exportJWK(pair.privateKey);
    const pub = await exportJWK(pair.publicKey);
    const kid = await calculateJwkThumbprint({ kty: 'OKP', crv: 'Ed25519', x: pub.x! }, 'sha256');
    return { privateKey: priv.d!, publicKey: pub.x!, kid };
}

async function signWith(payload: unknown, key: TestKey, headerKid?: string): Promise<string> {
    const jwk = await importJWK({ kty: 'OKP', crv: 'Ed25519', d: key.privateKey, x: key.publicKey }, 'EdDSA');
    return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
        .setProtectedHeader({ alg: 'EdDSA', kid: headerKid ?? key.kid })
        .sign(jwk);
}

function cardFor(offered: any, owner: string, key: TestKey, overrides: Record<string, unknown> = {}) {
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
        ...overrides,
    };
}

async function signAssertion(gaii: string, key: TestKey, over: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    return signWith({ sub: gaii, aud: NODE_ID, iat: now, exp: now + 60, jti: randomUUID(), ...over }, key);
}

console.log('\n=== Agent v2: key, card, and the basic-agents button ===\n');

async function run() {
    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const c = await setupOwner('c');
    const authA = { Authorization: `Bearer ${a.ownerToken}` };
    const authB = { Authorization: `Bearer ${b.ownerToken}` };
    const authC = { Authorization: `Bearer ${c.ownerToken}` };

    // The v1 agent whose socket IS the daemon. Its own path must be untouched by all of this.
    const daemonA = await addV1Agent(a.owner, a.ownerToken, 'serve-daemon');
    const daemonB = await addV1Agent(b.owner, b.ownerToken, 'serve-daemon-b');
    const daemonC = await addV1Agent(c.owner, c.ownerToken, 'serve-daemon-c');
    // Connected to nothing: proves the "you are not holding a tunnel" refusal.
    const offlineA = await addV1Agent(a.owner, a.ownerToken, 'never-connected');

    const keysByAgent = new Map<string, TestKey>();

    // ── 1. No daemon: say so, create nothing ──────────────────────────────────
    await test('pressing the button with no connector connected refuses and creates nothing', async () => {
        const r = await json('/v1/agents/v2/basic-agents', { method: 'POST', headers: authA });
        assert(r.status === 409, `expected 409, got ${r.status}`);
        assert(r.body?.error?.code === 'NO_DAEMON', `expected NO_DAEMON, got ${r.body?.error?.code}`);
        const list = await json('/v1/agents?owner=' + a.owner, { headers: authA });
        const names = (list.body.data.agents as any[]).map(x => x.name);
        for (const n of BASIC_NAMES) assert(!names.includes(n), `${n} should not exist after a refused press`);
    });

    await test('the preview says a connector is not connected', async () => {
        const r = await json('/v1/agents/v2/basic-agents', { headers: authA });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert(r.body.data.daemon_connected === false, 'daemon_connected should be false');
        assert((r.body.data.agents as any[]).length === BASIC_NAMES.length, 'the preview should name the whole set');
        assert((r.body.data.agents as any[]).every(x => x.exists === false), 'nothing should exist yet');
    });

    // ── 2. Connect the daemon ─────────────────────────────────────────────────
    const dA = await openDaemon(daemonA.token);
    const dB = await openDaemon(daemonB.token);
    const dC = await openDaemon(daemonC.token);

    await test('the preview sees the connected connector', async () => {
        const r = await json('/v1/agents/v2/basic-agents', { headers: authA });
        assert(r.body.data.daemon_connected === true, 'daemon_connected should be true once the tunnel is up');
        assert((r.body.data.connected_principals as string[]).includes(daemonA.gaii), 'the connected principal should be named');
    });

    // ── 3. An agent of the owner may READ, and may not press ──────────────────
    await test('an agent acting in the owner\'s name cannot press the button', async () => {
        const r = await json('/v1/agents/v2/basic-agents', { method: 'POST', headers: { Authorization: `Bearer ${daemonA.token}` } });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('an agent of the owner CAN read what the button would do, and where to send the person', async () => {
        const r = await json('/v1/agents/v2/basic-agents', { headers: { Authorization: `Bearer ${daemonA.token}` } });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert((r.body.data.agents as any[]).length === BASIC_NAMES.length, 'the agent should see the whole set');
        assert(r.body.data.daemon_connected === true, 'and the state of its own connector');
        assert(typeof r.body.data.approval_url === 'string' && r.body.data.approval_url.includes('tab=agents'),
            'the answer should carry the page the owner opens');
        assert(typeof r.body.data.next_step === 'string' && r.body.data.next_step.length > 0,
            'and a sentence the agent can say to the person');
    });

    await test('an agent reading this sees its OWN account and no other', async () => {
        const mine = await json('/v1/agents/v2/basic-agents', { headers: { Authorization: `Bearer ${daemonB.token}` } });
        assert(mine.status === 200, `expected 200, got ${mine.status}`);
        // Owner B has no basic agents; owner A's state must not leak into the answer.
        assert((mine.body.data.agents as any[]).every(x => x.exists === false),
            'another owner\'s agents must not appear here');
        assert((mine.body.data.connected_principals as string[]).every(p => p.includes(`#${b.owner}@`)),
            'only this account\'s own connected principals');
    });

    await test('an unauthenticated caller cannot read it at all', async () => {
        const r = await json('/v1/agents/v2/basic-agents');
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });

    await test('an outside app of the same owner cannot read how their agents are set up', async () => {
        // The read is open to the owner and their own agents, and to nothing else.
        const tok = await mintEcoToken(a.owner, authA, 'nosy-app');
        const r = await json('/v1/agents/v2/basic-agents', { headers: { Authorization: `Bearer ${tok}` } });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    // ── 3b. The agent asks, and the ask lands where the person looks ──────────
    let askedItemId = '';
    await test('an agent asks its owner for the basic agents, and it lands on their open items', async () => {
        const r = await json('/v1/agents/v2/basic-agents/request', {
            method: 'POST', headers: { Authorization: `Bearer ${daemonA.token}` },
            body: JSON.stringify({ note: 'you asked me to route things' }),
        });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.requested === true, 'the first ask should be recorded');
        askedItemId = r.body.data.item_id;
        assert(!!askedItemId, 'and it should name the item');

        const items = await json('/v1/open-items', { headers: authA });
        const mine = (items.body.data.items as any[]).find(i => i.id === askedItemId);
        assert(!!mine, 'the owner should see it on their own list');
        assert(mine.by === 'ai', 'and see that their AI put it there, not them');
        assert(mine.title.includes('you asked me to route things'), 'the note reaches the person');
        assert(mine.satisfied === false, 'it is still open, because nothing has been pressed');
    });

    await test('asking twice does not print a second line', async () => {
        const r = await json('/v1/agents/v2/basic-agents/request', {
            method: 'POST', headers: { Authorization: `Bearer ${daemonA.token}` }, body: JSON.stringify({}),
        });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert(r.body.data.requested === false, 'the second ask writes nothing');
        assert(r.body.data.reason === 'already_asked', `expected already_asked, got ${r.body.data.reason}`);
        assert(r.body.data.item_id === askedItemId, 'and points at the standing one');
    });

    await test('an outside app cannot ask for agents in your name', async () => {
        const tok = await mintEcoToken(a.owner, authA, 'nosy-asker');
        const r = await json('/v1/agents/v2/basic-agents/request', {
            method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify({}),
        });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    // ── 4. The button ─────────────────────────────────────────────────────────
    let pressBody: any;
    await test('one press, the whole basic set, nothing pasted and nothing restarted', async () => {
        dA.onEnrol = async (offer) => {
            const cards: string[] = [];
            for (const offered of offer.agents) {
                const key = await makeKey();
                keysByAgent.set(offered.name, key);
                // The card ASKS for the wildcard. The node must ignore that and grant the template.
                cards.push(await signWith(cardFor(offered, a.owner, key, { requestedScopes: ['*'] }), key));
            }
            const res = await json('/v1/agents/v2/enrol', {
                method: 'POST', headers: { Authorization: `Bearer ${daemonA.token}` },
                body: JSON.stringify({ grant_id: offer.grant_id, cards }),
            });
            if (res.status !== 200) return { ok: false, result: res.body?.error ?? null };
            return { ok: true, result: { attached: (res.body.data.enrolled as any[]).map(e => e.name) } };
        };
        const r = await json('/v1/agents/v2/basic-agents', { method: 'POST', headers: authA });
        pressBody = r.body;
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert((r.body.data.created as string[]).length === BASIC_NAMES.length, `expected ${BASIC_NAMES.length} created, got ${JSON.stringify(r.body.data.created)}`);
        assert((r.body.data.enrolled as any[]).length === BASIC_NAMES.length, `expected ${BASIC_NAMES.length} enrolled, got ${JSON.stringify(r.body.data.enrolled)}`);
    });

    await test('the ask retires itself once the person has pressed, with nobody ticking it off', async () => {
        const items = await json('/v1/open-items', { headers: authA });
        const mine = (items.body.data.items as any[]).find(i => i.id === askedItemId);
        // Either the list no longer offers it, or it is there marked satisfied. Both mean the same
        // thing to the person: it is not something waiting for them any more.
        assert(!mine || mine.satisfied === true,
            `the request should have answered itself, got ${JSON.stringify(mine)}`);
    });

    await test('and asking again now says they are already there, without writing anything', async () => {
        const r = await json('/v1/agents/v2/basic-agents/request', {
            method: 'POST', headers: { Authorization: `Bearer ${daemonA.token}` }, body: JSON.stringify({}),
        });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert(r.body.data.requested === false && r.body.data.reason === 'already_there',
            `expected already_there, got ${JSON.stringify(r.body.data.reason)}`);
    });

    await test('the other agent on that daemon never lost its connection', async () => {
        assert(dA.ws.readyState === WebSocket.OPEN, 'the daemon socket should still be open');
        const r = await json(`/v1/agents/${encodeURIComponent(daemonA.gaii)}`, { headers: authA });
        assert(r.status === 200, `the v1 agent should still answer, got ${r.status}`);
    });

    await test('the basic agents are listed with their run mode and credential state', async () => {
        const list = await json('/v1/agents?owner=' + a.owner, { headers: authA });
        for (const n of BASIC_NAMES) {
            const rec = (list.body.data.agents as any[]).find(x => x.name === n);
            assert(!!rec, `${n} missing from the list`);
            // concierge is `resident` on crewaimeat's measurement: ~4 s of cold start before the
            // model is even called is the wrong floor under a front door. The other two are bursty.
            const expected = n === 'concierge' ? 'resident' : 'spawn';
            assert(rec.run_mode === expected, `${n} run_mode should be ${expected}, got ${rec.run_mode}`);
            assert(rec.identity_version === 2, `${n} should be a v2 identity`);
            assert(rec.card_enrolled === true, `${n} should be enrolled`);
        }
    });

    // The question crewaimeat asked back: is run_mode there for a v2 agent the moment it enrols?
    await test('run_mode is on a v2 agent the moment it is enrolled, and a roster read can filter on it', async () => {
        const all = await json('/v1/agents?owner=' + a.owner, { headers: authA });
        const spawn = await json('/v1/agents?run_mode=spawn', { headers: authA });
        const names = (spawn.body.data.agents as any[]).map(x => x.name).sort();
        const expectSpawn = BASIC_NAMES.filter(n => n !== 'concierge').sort();
        assert(JSON.stringify(names) === JSON.stringify(expectSpawn),
            `the filter should return exactly the spawn agents, got ${JSON.stringify(names)}`);
        // And the filter genuinely separates them: the resident one is absent from that answer and
        // present in its own, which is the property the roster read depends on.
        const resident = await json('/v1/agents?run_mode=resident', { headers: authA });
        const residentNames = (resident.body.data.agents as any[]).map(x => x.name);
        assert(residentNames.includes('concierge'), `concierge should be in the resident answer, got ${JSON.stringify(residentNames)}`);
        assert(!names.includes('concierge'), 'and not in the spawn one');
        assert((all.body.data.agents as any[]).length > names.length, 'and the unfiltered list is bigger');
        // A v1 agent has no run mode, and absence is not 'spawn'.
        const v1 = (all.body.data.agents as any[]).find(x => x.name === daemonA.name);
        assert(v1.run_mode === null, `a v1 agent should report null, got ${v1.run_mode}`);
        const none = await json('/v1/agents?run_mode=nonsense', { headers: authA });
        assert((none.body.data.agents as any[]).length === 0, 'an unknown run mode returns nothing, never everything');
    });

    // ── The definitions: every basic agent has something to BE ─────────────────
    //
    // crewaimeat measured the deadlock: publish needs a runtime, a runtime needs a definition, a
    // definition would need publishing. So the definition has to exist before first start, and the
    // only party who can write it then is the creator. These assert it did.

    await test('each of the three has a readable definition where its runtime looks for it', async () => {
        for (const n of BASIC_NAMES) {
            const gaii = `${n}#${a.owner}@${NODE_ID}`;
            // The same read the runtime does: the agent's OWN namespace, not the owner's. A plain
            // memory write would land under the writer and be invisible here, which is exactly what
            // memory-write.ts refuses and why the seed goes through crew-ops.
            const r = await json(`/v1/memory/${encodeURIComponent(gaii)}/crews.registry.${n}`, { headers: authA });
            assert(r.status === 200, `${n}: no definition at crews.registry.${n} (${r.status})`);
            const env = r.body.data.value ?? r.body.data.memory?.value;
            assert(env?.agent_name === n, `${n}: envelope should name the agent, got ${JSON.stringify(env?.agent_name)}`);
            assert(env?.revision === 1, `${n}: a seed is revision 1, got ${env?.revision}`);
            assert(typeof env?.doc === 'object' && env.doc !== null, `${n}: envelope carries no doc`);
        }
    });

    await test('and each definition is the shape the runtime validates, with the agent named from the record', async () => {
        for (const n of BASIC_NAMES) {
            const gaii = `${n}#${a.owner}@${NODE_ID}`;
            const r = await json(`/v1/memory/${encodeURIComponent(gaii)}/crews.registry.${n}`, { headers: authA });
            const doc = (r.body.data.value ?? r.body.data.memory?.value).doc;
            // The contract crewaimeat's validator applies, and the one this repo's own shipped
            // definitions use: named agents by role, tasks that reference those roles, and a
            // dependency graph that points only backwards.
            assert(doc.agent_name === n, `${n}: agent_name is stamped from the record, got ${doc.agent_name}`);
            assert(Array.isArray(doc.agents) && doc.agents.length > 0, `${n}: needs at least one agent`);
            assert(Array.isArray(doc.tasks) && doc.tasks.length > 0, `${n}: needs at least one task`);
            assert(doc.process === 'sequential' || doc.process === 'hierarchical', `${n}: process ${doc.process}`);
            const roles = new Set(doc.agents.map((x: any) => x.role));
            for (const ag of doc.agents) {
                for (const f of ['role', 'goal', 'backstory']) {
                    assert(typeof ag[f] === 'string' && ag[f].length > 0, `${n}: agent missing ${f}`);
                }
                assert(typeof ag.allow_delegation === 'boolean', `${n}: agent missing allow_delegation`);
            }
            const seen = new Set<string>();
            for (const t of doc.tasks) {
                for (const f of ['id', 'description', 'expected_output', 'agent']) {
                    assert(typeof t[f] === 'string' && t[f].length > 0, `${n}: task missing ${f}`);
                }
                assert(roles.has(t.agent), `${n}: task ${t.id} names ${t.agent}, which is not one of its agents`);
                for (const dep of (t.context ?? [])) {
                    assert(seen.has(dep), `${n}: task ${t.id} depends on ${dep}, which does not come before it`);
                }
                seen.add(t.id);
            }

            // The rule this block did NOT have, and the one that mattered: a tag must match
            // [a-z0-9._-]. Everything above was checked and correct while all six seeded
            // definitions carried `crew:basic` and were refused by the runtime, because `:` is
            // reserved there for versioned capability ids. The node accepted them and answered
            // ok — it validates tags nowhere, so that was silence and not a second opinion.
            // check:crew-defs proves the TEMPLATES; this proves what actually reached the store.
            for (const tag of (doc.tags ?? [])) {
                assert(/^[a-z0-9._-]+$/.test(tag), `${n}: seeded definition carries the tag "${tag}", which the runtime refuses`);
            }
            const rec = (await json('/v1/agents?owner=' + a.owner, { headers: authA }))
                .body.data.agents.find((x: any) => x.name === n);
            for (const tag of (rec?.tags ?? [])) {
                assert(/^[a-z0-9._-]+$/.test(tag), `${n}: the agent record carries the tag "${tag}", which the runtime refuses`);
            }

            // The agent must be able to ACT, not merely be well formed. A crew with no tools is a
            // valid definition that does nothing: workflow-manager was sold as ordering work from
            // other agents and had no delegation tool, so it planned jobs and sent nothing.
            const tools = new Set<string>(doc.agents.flatMap((x: any) => x.tools ?? []));
            assert(tools.has('memory'), `${n}: cannot read what the account holds`);
            if (n === 'concierge' || n === 'workflow-manager') {
                assert(tools.has('delegate'), `${n}: its description is about handing work on, and it declares no delegation tool`);
            }

            // And a spawn agent's work must start without a person: the node auto-activates a
            // queued task only for a task-runner, so any other mode leaves every task in `queued`.
            if (rec?.run_mode === 'spawn') {
                assert(rec.mode === 'task-runner',
                    `${n}: runs on spawn, so its mode must be task-runner or its tasks never start — got ${rec.mode}`);
            }

            // The mode and the definition must agree about how work ARRIVES. An `interactive`
            // agent's queued tasks are deliberately not auto-activated, so a definition that
            // listens only for tasks waits for the one thing that will never come.
            assert(Array.isArray(doc.listen_for) && doc.listen_for.length > 0,
                `${n}: listen_for must be stated, not left to default to ["tasks"]`);
            if (rec?.mode === 'interactive') {
                assert(doc.listen_for.some((s: string) => s !== 'tasks'),
                    `${n}: interactive, so nothing will auto-activate its tasks — it listens for ${JSON.stringify(doc.listen_for)} and will never wake`);
            }
        }
    });

    await test('pressing again does not duplicate or clobber a definition the owner has edited', async () => {
        const gaii = `concierge#${a.owner}@${NODE_ID}`;
        // The owner changes what their agent is, the ordinary way — through publish, whose runtime
        // check the daemon answers.
        dA.onInvoke = async (capability: string) => (capability === 'crew.validate'
            ? { ok: true, result: { errors: [] } }
            : { ok: false, result: { code: 'NO_HANDLER' } });
        const edited = await json(`/v1/agents/concierge/crew/publish`, {
            method: 'POST', headers: authA,
            body: JSON.stringify({ doc: { agents: [{ role: 'Mine', goal: 'g', backstory: 'b', allow_delegation: false }], tasks: [{ id: 't', description: 'd', expected_output: 'e', agent: 'Mine' }], process: 'sequential', tags: ['mine'], readme_md: '# Mine' } }),
        });
        // Whether the edit landed depends on the daemon answering validate; if it did not, the
        // point of this test is unchanged — the press must not overwrite whatever is there.
        const before = await json(`/v1/memory/${encodeURIComponent(gaii)}/crews.registry.concierge`, { headers: authA });
        const beforeEnv = before.body.data.value ?? before.body.data.memory?.value;

        const again = await json('/v1/agents/v2/basic-agents', { method: 'POST', headers: authA });
        assert(again.status === 200, `second press ${again.status}: ${JSON.stringify(again.body?.error)}`);

        const after = await json(`/v1/memory/${encodeURIComponent(gaii)}/crews.registry.concierge`, { headers: authA });
        const afterEnv = after.body.data.value ?? after.body.data.memory?.value;
        assert(afterEnv.revision === beforeEnv.revision,
            `the press must not write a new revision, was ${beforeEnv.revision} now ${afterEnv.revision}`);
        assert(JSON.stringify(afterEnv.doc) === JSON.stringify(beforeEnv.doc),
            'and must not change the document');
        assert(edited.status === 200 || edited.status >= 400, 'publish either worked or was refused; either way the press left it alone');
    });

    await test('an agent created by any other path gets no definition invented for it', async () => {
        // The seed is the button's, not the node's opinion about agents in general.
        const made = await json('/v1/agents', {
            method: 'POST', headers: authA,
            body: JSON.stringify({ name: 'plain-agent', owner: a.owner, capabilities: [] }),
        });
        assert(made.status === 201, `create ${made.status}: ${JSON.stringify(made.body?.error)}`);
        const gaii = made.body.data.agent.gaii as string;
        const r = await json(`/v1/memory/${encodeURIComponent(gaii)}/crews.registry.plain-agent`, { headers: authA });
        assert(r.status === 404, `a plain agent should have no definition, got ${r.status}`);
    });

    await test('the card asked for the wildcard and was granted the template instead', async () => {
        // The template's scopes win over anything the card asked for. `workflow-manager` is the one
        // to read here now: it coordinates, so it carries work and workflow words, and deliberately
        // not the wildcard. (This used to read crew-forge, which left the basic set on 2026-09-02.)
        const list = await json('/v1/agents?owner=' + a.owner, { headers: authA });
        const wm = (list.body.data.agents as any[]).find(x => x.name === 'workflow-manager');
        assert(!wm.default_scopes.includes('*'), 'workflow-manager must not hold the wildcard');
        assert(wm.default_scopes.includes('work:request'), 'workflow-manager should hold work:request');
        assert(!wm.default_scopes.includes('agent:permissions'), 'no basic agent may hold agent:permissions');
    });

    // ── 5. The card verifies from outside, using only the published JWKS ──────
    await test('each agent\'s own card verifies against its own published key set', async () => {
        for (const n of BASIC_NAMES) {
            const gaii = `${n}#${a.owner}@${NODE_ID}`;
            // The EXTENDED card is the agent's own bytes; it is what the agent's JWKS verifies.
            const cardRes = await fetch(`${BASE}/v1/agents/${encodeURIComponent(gaii)}/card/extended`, { headers: authA });
            assert(cardRes.status === 200, `${n} extended card ${cardRes.status}`);
            const jws = (await cardRes.text()).trim();

            const jwksRes = await fetch(`${BASE}/v1/agents/${encodeURIComponent(gaii)}/jwks.json`);
            assert(jwksRes.status === 200, `${n} jwks ${jwksRes.status}`);
            const jwks = await jwksRes.json() as { keys: any[] };
            assert(jwks.keys.length === 1, `${n} should publish exactly one key`);

            // Nothing but these two documents. No lookup, no asking the node what to believe.
            const key = await importJWK(jwks.keys[0], 'EdDSA');
            const { payload } = await compactVerify(jws, key, { algorithms: ['EdDSA'] });
            const card = JSON.parse(new TextDecoder().decode(payload));
            assert(card.gaii === gaii, `${n} card identity mismatch`);
            // The card carries what the OFFER said, which is the roster's value for that agent.
            assert(card.runMode === (n === 'concierge' ? 'resident' : 'spawn'), `${n} card run mode: ${card.runMode}`);
            assert(Array.isArray(card.requestedScopes), `${n} extended card should carry requestedScopes`);
        }
    });

    // ── 5b. The public / extended split ───────────────────────────────────────
    await test('an anonymous reader gets the public card and cannot see what the agent asked for', async () => {
        const gaii = `concierge#${a.owner}@${NODE_ID}`;
        const r = await fetch(`${BASE}/v1/agents/${encodeURIComponent(gaii)}/card`);
        assert(r.status === 200, `unauthenticated card read ${r.status}`);
        const body = (await r.text()).trim();
        assert(!body.includes('requestedScopes'), 'the raw response must not carry the field at all');

        const parts = body.split('.');
        assert(parts.length === 3, 'the public card should be a compact JWS');
        const card = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
        assert(card.spec === 'aimeat.agent-card-public/v1', `expected the public spec, got ${card.spec}`);
        assert(card.requestedScopes === undefined, 'requestedScopes must not reach an anonymous reader');
        assert(card.webhookUrl === undefined, 'webhookUrl must not reach an anonymous reader');
        assert(card.description === undefined, 'description must not reach an anonymous reader');
        assert(card.gaii === gaii && typeof card.runMode === 'string', 'the public card should still identify the agent');
        assert(typeof card.nodeKeyUri === 'string', 'the public card should say where its signing key is published');
    });

    await test('the public card is signed by the NODE, and the node key is the one already published', async () => {
        const gaii = `concierge#${a.owner}@${NODE_ID}`;
        const jws = (await (await fetch(`${BASE}/v1/agents/${encodeURIComponent(gaii)}/card`)).text()).trim();

        const wk = await (await fetch(`${BASE}/.well-known/aimeat`)).json() as any;
        const nodeKeyB64 = wk.data.public_key as string;
        assert(!!nodeKeyB64, 'the node should publish its public key at /.well-known/aimeat');
        const x = Buffer.from(nodeKeyB64, 'base64').toString('base64url');
        const nodeKey = await importJWK({ kty: 'OKP', crv: 'Ed25519', x }, 'EdDSA');
        const { payload } = await compactVerify(jws, nodeKey, { algorithms: ['EdDSA'] });
        assert(JSON.parse(new TextDecoder().decode(payload)).gaii === gaii, 'the node-signed projection should name the agent');

        // And it is NOT the agent's key: the two signatures say different things.
        const jwks = await (await fetch(`${BASE}/v1/agents/${encodeURIComponent(gaii)}/jwks.json`)).json() as { keys: any[] };
        assert(jwks.keys[0].x !== x, 'the agent key and the node key must be different keys');
    });

    await test('the owner in person gets the extended card', async () => {
        const gaii = `concierge#${a.owner}@${NODE_ID}`;
        const r = await fetch(`${BASE}/v1/agents/${encodeURIComponent(gaii)}/card/extended`, { headers: authA });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        const card = JSON.parse(Buffer.from((await r.text()).trim().split('.')[1], 'base64url').toString('utf-8'));
        assert(card.spec === 'aimeat.agent-card/v1', 'the extended card is the agent\'s own card');
        assert(Array.isArray(card.requestedScopes), 'the owner may see what the agent asked for');
    });

    await test('a same-owner agent principal gets the extended card', async () => {
        const gaii = `concierge#${a.owner}@${NODE_ID}`;
        const r = await fetch(`${BASE}/v1/agents/${encodeURIComponent(gaii)}/card/extended`,
            { headers: { Authorization: `Bearer ${daemonA.token}` } });
        assert(r.status === 200, `expected 200, got ${r.status}`);
    });

    await test('another owner gets the public card only', async () => {
        const gaii = `concierge#${a.owner}@${NODE_ID}`;
        const pub = await fetch(`${BASE}/v1/agents/${encodeURIComponent(gaii)}/card`, { headers: authB });
        assert(pub.status === 200, `the public card should still be readable, got ${pub.status}`);
        const ext = await fetch(`${BASE}/v1/agents/${encodeURIComponent(gaii)}/card/extended`, { headers: authB });
        assert(ext.status === 403, `expected 403 on the extended card, got ${ext.status}`);
        const extAgent = await fetch(`${BASE}/v1/agents/${encodeURIComponent(gaii)}/card/extended`,
            { headers: { Authorization: `Bearer ${daemonB.token}` } });
        assert(extAgent.status === 403, `another owner's agent should be refused too, got ${extAgent.status}`);
    });

    await test('card/info says which half it gave you, and withholds accordingly', async () => {
        const gaii = `concierge#${a.owner}@${NODE_ID}`;
        const anon = await json(`/v1/agents/${encodeURIComponent(gaii)}/card/info`);
        assert(anon.status === 200, `anonymous info ${anon.status}`);
        assert(anon.body.data.extended === false, 'an anonymous reader is not extended');
        assert(anon.body.data.card.requestedScopes === undefined, 'requestedScopes must not leak through info');

        const owner = await json(`/v1/agents/${encodeURIComponent(gaii)}/card/info`, { headers: authA });
        assert(owner.body.data.extended === true, 'the owner is extended');
        assert(Array.isArray(owner.body.data.card.requestedScopes), 'the owner sees the full card');
    });

    await test('an agent that never enrolled has no card, and neither half says which', async () => {
        const r = await fetch(`${BASE}/v1/agents/${encodeURIComponent(daemonA.gaii)}/card`);
        assert(r.status === 404, `expected 404, got ${r.status}`);
        const ext = await fetch(`${BASE}/v1/agents/${encodeURIComponent(daemonA.gaii)}/card/extended`, { headers: authA });
        assert(ext.status === 404, `expected 404 on the extended card too, got ${ext.status}`);
        const nobody = await fetch(`${BASE}/v1/agents/${encodeURIComponent(`ghost#${a.owner}@${NODE_ID}`)}/card`);
        assert(nobody.status === 404, `a name that does not exist answers the same 404, got ${nobody.status}`);
    });

    // ── 6. The credential: minted per use, spent once ─────────────────────────
    let mintedToken = '';
    await test('an agent turns its key into a working short-lived credential', async () => {
        const gaii = `concierge#${a.owner}@${NODE_ID}`;
        const assertion = await signAssertion(gaii, keysByAgent.get('concierge')!);
        const r = await json('/v1/agents/v2/token', { method: 'POST', body: JSON.stringify({ grant_type: KEY_GRANT, assertion }) });
        assert(r.status === 200, `token ${r.status}: ${JSON.stringify(r.body)}`);
        assert(r.body.expires_in <= 3600, 'the credential should be short-lived');
        assert(r.body.gaii === gaii, 'the credential should be for the agent that signed');
        assert(!r.body.scopes.includes('*'), 'the minted scopes must be the template, not the wildcard');
        mintedToken = r.body.access_token;

        const use = await json('/v1/memory', { headers: { Authorization: `Bearer ${mintedToken}` } });
        assert(use.status === 200, `the minted credential should work, got ${use.status}`);
    });

    await test('the same assertion cannot be spent twice', async () => {
        const gaii = `workflow-manager#${a.owner}@${NODE_ID}`;
        const assertion = await signAssertion(gaii, keysByAgent.get('workflow-manager')!);
        const first = await json('/v1/agents/v2/token', { method: 'POST', body: JSON.stringify({ grant_type: KEY_GRANT, assertion }) });
        assert(first.status === 200, `first mint ${first.status}`);
        const second = await json('/v1/agents/v2/token', { method: 'POST', body: JSON.stringify({ grant_type: KEY_GRANT, assertion }) });
        assert(second.status === 401, `expected 401 on replay, got ${second.status}`);
        assert(second.body?.error?.code === 'ASSERTION_REPLAYED', `expected ASSERTION_REPLAYED, got ${second.body?.error?.code}`);
    });

    await test('an assertion for another node is refused here', async () => {
        const gaii = `concierge#${a.owner}@${NODE_ID}`;
        const assertion = await signAssertion(gaii, keysByAgent.get('concierge')!, { aud: 'aimeat-elsewhere-001-dev' });
        const r = await json('/v1/agents/v2/token', { method: 'POST', body: JSON.stringify({ grant_type: KEY_GRANT, assertion }) });
        assert(r.status === 400, `expected 400, got ${r.status}`);
    });

    await test('a long-lived assertion is refused: that would be the bearer token again', async () => {
        const gaii = `concierge#${a.owner}@${NODE_ID}`;
        const now = Math.floor(Date.now() / 1000);
        const assertion = await signAssertion(gaii, keysByAgent.get('concierge')!, { exp: now + 86_400 });
        const r = await json('/v1/agents/v2/token', { method: 'POST', body: JSON.stringify({ grant_type: KEY_GRANT, assertion }) });
        assert(r.status === 400, `expected 400, got ${r.status}`);
    });

    await test('an assertion signed by a key nobody pinned is refused', async () => {
        const gaii = `concierge#${a.owner}@${NODE_ID}`;
        const stranger = await makeKey();
        const assertion = await signAssertion(gaii, stranger);
        const r = await json('/v1/agents/v2/token', { method: 'POST', body: JSON.stringify({ grant_type: KEY_GRANT, assertion }) });
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });

    await test('a v1 agent cannot mint on this path', async () => {
        const stranger = await makeKey();
        const assertion = await signAssertion(daemonA.gaii, stranger);
        const r = await json('/v1/agents/v2/token', { method: 'POST', body: JSON.stringify({ grant_type: KEY_GRANT, assertion }) });
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });

    // ── 7. A grant left unspent, for the refusal tests ────────────────────────
    let grantC = '';
    let offerC: any = null;
    await test('a connector that answers no leaves the grant unspent, and the button says so', async () => {
        dC.onEnrol = async (offer) => { offerC = offer; return { ok: false, result: { code: 'NOT_TODAY', message: 'declined for the test' } }; };
        const r = await json('/v1/agents/v2/basic-agents', { method: 'POST', headers: authC });
        assert(r.status === 502, `expected 502, got ${r.status}`);
        grantC = r.body?.error?.details?.grant_id ?? '';
        assert(!!grantC, 'the refusal should name the grant so a retry is possible');
        assert(!!offerC, 'the offer should have reached the daemon');
    });

    await test('a daemon of another owner cannot spend this grant', async () => {
        const key = await makeKey();
        const cards = await Promise.all(offerC.agents.map((o: any) => signWith(cardFor(o, c.owner, key), key)));
        const r = await json('/v1/agents/v2/enrol', {
            method: 'POST', headers: { Authorization: `Bearer ${daemonB.token}` },
            body: JSON.stringify({ grant_id: grantC, cards }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}`);
        assert(r.body?.error?.code === 'ACCESS_DENIED', `expected ACCESS_DENIED, got ${r.body?.error?.code}`);
    });

    await test('a credential with no live tunnel cannot enrol', async () => {
        const r = await json('/v1/agents/v2/enrol', {
            method: 'POST', headers: { Authorization: `Bearer ${offlineA.token}` },
            body: JSON.stringify({ grant_id: grantC, cards: ['x.y.z'] }),
        });
        assert(r.status === 409, `expected 409, got ${r.status}`);
        assert(r.body?.error?.code === 'NOT_CONNECTED', `expected NOT_CONNECTED, got ${r.body?.error?.code}`);
    });

    await test('the owner in person cannot enrol: this is the daemon\'s door', async () => {
        const r = await json('/v1/agents/v2/enrol', {
            method: 'POST', headers: authC,
            body: JSON.stringify({ grant_id: grantC, cards: ['x.y.z'] }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('an invalid card is refused with a list of exactly what is missing', async () => {
        const key = await makeKey();
        const broken = await signWith(cardFor(offerC.agents[0], c.owner, key, { runMode: undefined, skills: undefined }), key);
        const rest = await Promise.all(offerC.agents.slice(1).map(async (o: any) => {
            const k = await makeKey();
            return signWith(cardFor(o, c.owner, k), k);
        }));
        const r = await json('/v1/agents/v2/enrol', {
            method: 'POST', headers: { Authorization: `Bearer ${daemonC.token}` },
            body: JSON.stringify({ grant_id: grantC, cards: [broken, ...rest] }),
        });
        assert(r.status === 422, `expected 422, got ${r.status}`);
        const fields = (r.body?.error?.details?.rejected?.[0]?.defects ?? []).map((d: any) => d.field);
        assert(fields.includes('runMode'), `the refusal should name runMode, got ${JSON.stringify(fields)}`);
        assert(fields.includes('skills'), `the refusal should name skills, got ${JSON.stringify(fields)}`);
    });

    await test('a card for an agent the grant does not cover is refused', async () => {
        const key = await makeKey();
        const intruder = await signWith(cardFor({
            name: daemonC.name, gaii: daemonC.gaii, run_mode: 'spawn', scopes: [],
            jwks_url: 'https://x/jwks.json', card_url: 'https://x/card',
        }, c.owner, key), key);
        const r = await json('/v1/agents/v2/enrol', {
            method: 'POST', headers: { Authorization: `Bearer ${daemonC.token}` },
            body: JSON.stringify({ grant_id: grantC, cards: [intruder] }),
        });
        assert(r.status === 422, `expected 422, got ${r.status}`);
        const reasons = JSON.stringify(r.body?.error?.details ?? {});
        assert(reasons.includes('does not cover'), `the refusal should say the grant does not cover it: ${reasons}`);
    });

    await test('a card whose header names a different key than it carries is refused', async () => {
        const carried = await makeKey();
        const signer = await makeKey();
        const mismatched = await signWith(cardFor(offerC.agents[0], c.owner, carried), signer);
        const r = await json('/v1/agents/v2/enrol', {
            method: 'POST', headers: { Authorization: `Bearer ${daemonC.token}` },
            body: JSON.stringify({ grant_id: grantC, cards: [mismatched] }),
        });
        assert(r.status === 422, `expected 422, got ${r.status}`);
        assert(JSON.stringify(r.body?.error?.details ?? {}).includes('names a different key'),
            `expected the kid defect, got ${JSON.stringify(r.body?.error?.details)}`);
    });

    await test('a card signed by a key other than the one it carries is refused', async () => {
        const carried = await makeKey();
        const signer = await makeKey();
        // The header AGREES with the card, so the only thing left to catch this is the signature
        // check itself: the bytes were signed by `signer`, and the card offers `carried`'s key.
        const forged = await signWith(cardFor(offerC.agents[0], c.owner, carried), signer, carried.kid);
        const rest = await Promise.all(offerC.agents.slice(1).map(async (o: any) => {
            const k = await makeKey();
            return signWith(cardFor(o, c.owner, k), k);
        }));
        const r = await json('/v1/agents/v2/enrol', {
            method: 'POST', headers: { Authorization: `Bearer ${daemonC.token}` },
            body: JSON.stringify({ grant_id: grantC, cards: [forged, ...rest] }),
        });
        assert(r.status === 422, `expected 422, got ${r.status}`);
        assert(JSON.stringify(r.body?.error?.details ?? {}).includes('not signed by the key it carries'),
            `expected the signature defect, got ${JSON.stringify(r.body?.error?.details)}`);
    });

    await test('a card claiming another owner is refused', async () => {
        const key = await makeKey();
        const wrongOwner = await signWith(cardFor(offerC.agents[0], b.owner, key), key);
        const r = await json('/v1/agents/v2/enrol', {
            method: 'POST', headers: { Authorization: `Bearer ${daemonC.token}` },
            body: JSON.stringify({ grant_id: grantC, cards: [wrongOwner] }),
        });
        assert(r.status === 422, `expected 422, got ${r.status}`);
    });

    await test('every refusal so far left the grant unspent and nothing enrolled', async () => {
        const list = await json('/v1/agents?owner=' + c.owner, { headers: authC });
        for (const n of BASIC_NAMES) {
            const rec = (list.body.data.agents as any[]).find(x => x.name === n);
            assert(!!rec, `${n} should exist (the press created it)`);
            assert(rec.card_enrolled === false, `${n} must not be enrolled after a refused submission`);
        }
    });

    await test('a complete, valid submission enrols', async () => {
        const cards = await Promise.all(offerC.agents.map(async (o: any) => {
            const k = await makeKey();
            return signWith(cardFor(o, c.owner, k), k);
        }));
        const r = await json('/v1/agents/v2/enrol', {
            method: 'POST', headers: { Authorization: `Bearer ${daemonC.token}` },
            body: JSON.stringify({ grant_id: grantC, cards }),
        });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert((r.body.data.enrolled as any[]).length === BASIC_NAMES.length, `all ${BASIC_NAMES.length} should come back`);
    });

    await test('the same grant cannot be spent again', async () => {
        const cards = await Promise.all(offerC.agents.map(async (o: any) => {
            const k = await makeKey();
            return signWith(cardFor(o, c.owner, k), k);
        }));
        const r = await json('/v1/agents/v2/enrol', {
            method: 'POST', headers: { Authorization: `Bearer ${daemonC.token}` },
            body: JSON.stringify({ grant_id: grantC, cards }),
        });
        assert(r.status === 409, `expected 409, got ${r.status}`);
        assert(r.body?.error?.code === 'ALREADY_USED', `expected ALREADY_USED, got ${r.body?.error?.code}`);
    });

    // -- 8. The agent:write fence on the auto-approve branch ------------------
    //
    // These used to be driven by `crew-forge`, which held `agent:write` and was one of the three
    // basic agents. It LEFT the basic set on 2026-09-02 (see the tombstone in data/basic-agents.ts):
    // creation moved to a proposal the owner approves, because an agent that creates agents adds a
    // hop, spends the owner's tokens, and takes the person out of the moment their account gains a
    // principal.
    //
    // THE FENCE STAYS, and so do these tests. It is correct regardless of who knocks, and the
    // branch is still reachable by any agent an owner grants `agent:write` -- so the tests now make
    // such an agent instead of relying on one shipping by default. What they assert is unchanged:
    // holding the word settles a registration on the spot, and not holding it never does.
    // `memory:write` because proposing an agent IS a memory write — the proposal record and the row
    // on the owner's list — and the propose route is gated on it in middleware. `agent:write` is
    // what the auto-approve fence below reads. Deliberately NOT the wildcard: the escalation tests
    // need a proposer with a real ceiling to exceed.
    const writer = await addV1Agent(a.owner, a.ownerToken, 'fence-writer', ['agent:write', 'memory:read', 'memory:write']);

    await test('an agent with agent:write cannot create for a DIFFERENT owner', async () => {
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: { Authorization: `Bearer ${writer.token}` },
            body: JSON.stringify({ agent_name: 'forged-sibling', owner: b.owner, scopes: ['memory:read'] }),
        });
        // The cross-owner case falls through to the ordinary pending flow: no auto-approval, no
        // agent, and no credential for anyone to collect.
        assert(r.body?.data?.auto_approved !== true, 'a cross-owner registration must never be auto-approved');
        const list = await json('/v1/agents?owner=' + b.owner, { headers: authB });
        const names = (list.body.data.agents as any[]).map(x => x.name);
        assert(!names.includes('forged-sibling'), 'no agent may appear under the other owner');
    });

    await test('and cannot hand a sibling more than it holds itself', async () => {
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: { Authorization: `Bearer ${writer.token}` },
            body: JSON.stringify({ agent_name: 'over-reacher', owner: a.owner, scopes: ['account:security'] }),
        });
        assert(r.body?.data?.auto_approved !== true, 'an escalating registration must wait for the owner');
    });

    // -- 8a. Holding the word is what decides it ------------------------------
    const mintFor = async (name: string, owner: string) => {
        const assertion = await signAssertion(`${name}#${owner}@${NODE_ID}`, keysByAgent.get(name)!);
        const mint = await json('/v1/agents/v2/token', { method: 'POST', body: JSON.stringify({ grant_type: KEY_GRANT, assertion }) });
        assert(mint.status === 200, `${name} mint ${mint.status}`);
        return mint.body.access_token as string;
    };

    await test('an agent holding agent:write settles its registration on the spot', async () => {
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: { Authorization: `Bearer ${writer.token}` },
            body: JSON.stringify({ agent_name: 'forged-by-writer', owner: a.owner, scopes: ['memory:read'] }),
        });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert(r.body?.data?.auto_approved === true, 'holding agent:write is what may do this');
        const list = await json('/v1/agents?owner=' + a.owner, { headers: authA });
        assert((list.body.data.agents as any[]).some(x => x.name === 'forged-by-writer'), 'the agent should exist');

        // `registeredBy` named the writer -- proven through the gate that READS it rather than a
        // listing field. A sibling holding the same delete word may not end what it did not make.
        const sibling = await addV1Agent(a.owner, a.ownerToken, 'not-the-registrar', ['agent:delete']);
        const bySibling = await json('/v1/agents/forged-by-writer', {
            method: 'DELETE', headers: { Authorization: `Bearer ${sibling.token}` },
        });
        assert(bySibling.status === 403, `a sibling that did not register it must be refused, got ${bySibling.status}`);
        const byOwner = await json('/v1/agents/forged-by-writer', { method: 'DELETE', headers: authA });
        assert(byOwner.status === 200, `the owner may end it, got ${byOwner.status}`);
    });

    for (const name of BASIC_NAMES) {
        await test(`${name} does not hold agent:write, and is told which permission is missing`, async () => {
            const r = await json('/v1/agents/device-authorize', {
                method: 'POST', headers: { Authorization: `Bearer ${await mintFor(name, a.owner)}` },
                body: JSON.stringify({ agent_name: `forged-by-${name}`, owner: a.owner, scopes: ['memory:read'] }),
            });
            assert(r.status === 200, `expected 200, got ${r.status}`);
            assert(r.body?.data?.auto_approved !== true, `${name} must not settle this itself`);

            // Refusing is a fall-through, not a failure: the request is still there for the owner.
            assert(r.body?.data?.status === 'pending', `expected pending, got ${r.body?.data?.status}`);
            assert(typeof r.body?.data?.user_code === 'string' && r.body.data.user_code.length > 0,
                'a code the owner can approve must still come back');

            const said = String(r.body?.data?.user_instructions ?? '');
            assert(said.includes('agent:write'), `the refusal must name the scope: ${said}`);
            assert(/profile/i.test(said), `and where the owner approves it: ${said}`);

            const list = await json('/v1/agents?owner=' + a.owner, { headers: authA });
            assert(!(list.body.data.agents as any[]).some(x => x.name === `forged-by-${name}`),
                'no agent may exist before the owner approves');
        });
    }

    await test('the owner\'s own session is unaffected by any of this', async () => {
        // The owner holds no scopes at all -- their session IS the permission -- so a rule about
        // scopes must not reach them.
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: authA,
            body: JSON.stringify({ agent_name: 'made-by-the-owner', owner: a.owner, scopes: ['memory:read'] }),
        });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert(r.body?.data?.auto_approved === true, 'an owner registering their own agent is still immediate');
    });

    // ── 8c. An agent proposes an agent; the owner approves it ────────────────
    //
    // This is what replaced crew-forge on 2026-09-02. Creating an agent is two data writes and does
    // not need an agent of its own; writing a GOOD definition is a reasoning task, best done by the
    // model the owner is already talking to. So an agent PROPOSES, and the owner — in person, on
    // their own session — is what turns a proposal into a principal.
    const PROPOSED_DEF = {
        readme_md: '# Reader',
        tags: ['role.reader'],
        process: 'sequential' as const,
        listen_for: ['tasks'],
        agents: [{ role: 'Reader', goal: 'read', backstory: 'You read.', allow_delegation: false, tools: ['memory'] }],
        tasks: [{ id: 'read', description: 'Read this: {{ctx.prompt}}', expected_output: 'notes', agent: 'Reader' }],
    };

    let proposalId = '';
    await test('an agent proposes an agent, and NOTHING is created', async () => {
        const r = await json('/v1/agents/v2/agent-proposals', {
            method: 'POST', headers: { Authorization: `Bearer ${writer.token}` },
            body: JSON.stringify({
                name: 'proposed-reader', display_name: 'Reader',
                purpose: 'Reads long documents and answers questions about them.',
                scopes: ['memory:read'], mode: 'task-runner', run_mode: 'spawn',
                crew_def: PROPOSED_DEF,
            }),
        });
        assert(r.status === 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.created === false, 'a proposal must create nothing');
        proposalId = r.body.data.proposal.id;

        // The whole point: the account does not have this agent yet.
        const list = await json('/v1/agents?owner=' + a.owner, { headers: authA });
        assert(!(list.body.data.agents as any[]).some(x => x.name === 'proposed-reader'),
            'the proposed agent must not exist before the owner approves');
    });

    await test('the owner sees it waiting', async () => {
        const r = await json('/v1/agents/v2/agent-proposals', { headers: authA });
        assert(r.status === 200, `list ${r.status}`);
        const mine = (r.body.data.proposals as any[]).find(p => p.id === proposalId);
        assert(!!mine && mine.state === 'proposed', `expected a waiting proposal, got ${JSON.stringify(mine?.state)}`);
        assert(mine.proposed_by === writer.gaii, `it should name who asked, got ${mine.proposed_by}`);
    });

    await test('an agent cannot approve its own proposal — that gate is the owner in person', async () => {
        const r = await json(`/v1/agents/v2/agent-proposals/${proposalId}/approve`, {
            method: 'POST', headers: { Authorization: `Bearer ${writer.token}` },
        });
        assert(r.status === 403, `expected 403, got ${r.status}`);
        const list = await json('/v1/agents?owner=' + a.owner, { headers: authA });
        assert(!(list.body.data.agents as any[]).some(x => x.name === 'proposed-reader'), 'still nothing created');
    });

    await test('the owner approves, and the agent exists WITH its definition', async () => {
        const r = await json(`/v1/agents/v2/agent-proposals/${proposalId}/approve`, { method: 'POST', headers: authA });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.created === true && r.body.data.seeded === true, 'created and seeded together');

        const gaii = `proposed-reader#${a.owner}@${NODE_ID}`;
        const rec = (await json('/v1/agents?owner=' + a.owner, { headers: authA }))
            .body.data.agents.find((x: any) => x.name === 'proposed-reader');
        assert(!!rec, 'the agent should exist now');
        assert(rec.mode === 'task-runner' && rec.run_mode === 'spawn', 'it carries what was proposed');

        // Seeded in the AGENT's own namespace, the same read the runtime does.
        const def = await json(`/v1/memory/${encodeURIComponent(gaii)}/crews.registry.proposed-reader`, { headers: authA });
        assert(def.status === 200, `the definition should be there, got ${def.status}`);
    });

    await test('and approving twice is refused rather than creating a second one', async () => {
        const r = await json(`/v1/agents/v2/agent-proposals/${proposalId}/approve`, { method: 'POST', headers: authA });
        assert(r.status === 409, `expected 409, got ${r.status}`);
    });

    await test('a proposal cannot ask for more scope than the proposer holds', async () => {
        const r = await json('/v1/agents/v2/agent-proposals', {
            method: 'POST', headers: { Authorization: `Bearer ${writer.token}` },
            body: JSON.stringify({
                name: 'too-wide', purpose: 'Would hold more than the agent proposing it.',
                scopes: ['account:security'],
            }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}`);
        assert(r.body?.error?.code === 'SCOPE_ESCALATION', `got ${r.body?.error?.code}`);
    });

    await test('a proposal cannot name another owner', async () => {
        const r = await json('/v1/agents/v2/agent-proposals', {
            method: 'POST', headers: { Authorization: `Bearer ${writer.token}` },
            body: JSON.stringify({
                name: 'for-somebody-else', purpose: 'Belongs to a different account entirely.',
                scopes: ['memory:read'], for_owner: b.owner,
            }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}`);
        const list = await json('/v1/agents?owner=' + b.owner, { headers: authB });
        assert(!(list.body.data.agents as any[]).some(x => x.name === 'for-somebody-else'), 'nothing under the other owner');
    });

    await test('an ecosystem principal cannot propose an agent', async () => {
        const ecoToken = await mintEcoToken(a.owner, authA, `propose-eco-${Date.now().toString(36)}`);
        const r = await json('/v1/agents/v2/agent-proposals', {
            method: 'POST', headers: { Authorization: `Bearer ${ecoToken}` },
            body: JSON.stringify({ name: 'eco-made', purpose: 'An app should not add principals.', scopes: [] }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}`);
        assert(r.body?.error?.code === 'ACCESS_DENIED', `got ${r.body?.error?.code}`);
    });

    await test('a definition that could not run is refused at PROPOSAL time, not at approval', async () => {
        // The seed door validates nothing and cannot: there is no runtime to ask, which is the
        // circle that ended crew-forge. So an empty definition would be written down happily and
        // refused by the runtime at first start — the "agent with nothing to be" the seed exists to
        // remove. Catching it here means the owner is never shown a proposal that could not work.
        const bad = await json('/v1/agents/v2/agent-proposals', {
            method: 'POST', headers: { Authorization: `Bearer ${writer.token}` },
            body: JSON.stringify({
                name: 'doomed-agent', purpose: 'Its definition has no agents and no tasks.',
                scopes: ['memory:read'],
                crew_def: { readme_md: '', tags: [], process: 'sequential', listen_for: [], agents: [], tasks: [] },
            }),
        });
        assert(bad.status === 400, `expected 400, got ${bad.status}: ${JSON.stringify(bad.body?.data)}`);
        assert(bad.body?.error?.code === 'INVALID_CREW_DEF', `got ${bad.body?.error?.code}`);

        const list = await json('/v1/agents?owner=' + a.owner, { headers: authA });
        assert(!(list.body.data.agents as any[]).some(x => x.name === 'doomed-agent'), 'nothing created');
        const props = await json('/v1/agents/v2/agent-proposals', { headers: authA });
        assert(!(props.body.data.proposals as any[]).some(p => p.name === 'doomed-agent'),
            'and it never reached the owner\'s list');
    });

    await test('a task naming an agent the definition does not have is refused too', async () => {
        const r = await json('/v1/agents/v2/agent-proposals', {
            method: 'POST', headers: { Authorization: `Bearer ${writer.token}` },
            body: JSON.stringify({
                name: 'orphan-task', purpose: 'Its one task names a role that does not exist.',
                scopes: ['memory:read'],
                crew_def: {
                    readme_md: '# x', tags: [], process: 'sequential', listen_for: ['tasks'],
                    agents: [{ role: 'Reader', goal: 'g', backstory: 'b', allow_delegation: false }],
                    tasks: [{ id: 't', description: 'do {{ctx.prompt}}', expected_output: 'e', agent: 'Nobody' }],
                },
            }),
        });
        assert(r.status === 400 && r.body?.error?.code === 'INVALID_CREW_DEF', `got ${r.status} ${r.body?.error?.code}`);
    });

    // ── 8b. A first crew definition for an agent that has no runtime ─────────
    // The chicken and egg: publish asks the TARGET's runtime to validate, and a brand-new agent
    // has none, because what it would load is the definition being published.
    const DOC = { agents: [{ name: 'writer', role: 'writes' }], tasks: [{ id: 'go', agent: 'writer', description: 'do {{ctx.prompt}}' }] };

    await test('the old path is unchanged: publishing to an agent with no runtime still refuses', async () => {
        const r = await json(`/v1/agents/${offlineA.name}/crew/publish`, {
            method: 'POST', headers: authA, body: JSON.stringify({ doc: DOC }),
        });
        assert(r.status === 409, `expected 409, got ${r.status}`);
        assert(r.body?.error?.code === 'AGENT_OFFLINE', `expected AGENT_OFFLINE, got ${r.body?.error?.code}`);
    });

    await test('seed gives that agent a first definition, checked by a connected sibling', async () => {
        dA.onInvoke = async (capability, input) => capability === 'crew.validate'
            ? { ok: true, result: { valid: true, errors: [], doc_seen: !!(input as any)?.doc } }
            : { ok: false, result: { code: 'NO_HANDLER' } };
        const r = await json(`/v1/agents/${offlineA.name}/crew/seed`, {
            method: 'POST', headers: authA, body: JSON.stringify({ doc: DOC }),
        });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.revision === 1, `a seed is revision 1, got ${r.body.data.revision}`);
        assert(r.body.data.validated_by === daemonA.gaii, `the sibling that checked it should be named, got ${r.body.data.validated_by}`);
    });

    await test('who validated is recorded, so a sibling\'s verdict never reads as the agent\'s own', async () => {
        const r = await json(`/v1/agents/${offlineA.name}/crew`, { headers: authA });
        assert(r.status === 200, `crew read ${r.status}`);
        assert(r.body.data.published?.validatedBy === daemonA.gaii,
            `the envelope should carry validatedBy, got ${JSON.stringify(r.body.data.published?.validatedBy)}`);
        assert(r.body.data.published?.revision === 1, 'and revision 1');
    });

    await test('seeding twice is refused: this door only ever adds a first definition', async () => {
        const r = await json(`/v1/agents/${offlineA.name}/crew/seed`, {
            method: 'POST', headers: authA, body: JSON.stringify({ doc: DOC }),
        });
        assert(r.status === 409, `expected 409, got ${r.status}`);
        assert(r.body?.error?.code === 'ALREADY_DEFINED', `expected ALREADY_DEFINED, got ${r.body?.error?.code}`);
    });

    await test('the validator\'s errors come back verbatim and nothing is written', async () => {
        const fresh = await addV1Agent(a.owner, a.ownerToken, 'needs-a-def');
        dA.onInvoke = async () => ({ ok: true, result: { valid: false, errors: ["agents[0]: unknown tool 'nope'"] } });
        const r = await json(`/v1/agents/${fresh.name}/crew/seed`, {
            method: 'POST', headers: authA, body: JSON.stringify({ doc: DOC }),
        });
        assert(r.status === 422, `expected 422, got ${r.status}`);
        assert(JSON.stringify(r.body?.error?.details?.errors ?? []).includes('unknown tool'), 'the runtime\'s own message, verbatim');
        const after = await json(`/v1/agents/${fresh.name}/crew`, { headers: authA });
        assert(after.body.data.published === null, 'a refused seed writes nothing');
        dA.onInvoke = async () => ({ ok: true, result: { valid: true, errors: [] } });
    });

    await test('a named validator that is not connected is refused by name', async () => {
        const fresh = await addV1Agent(a.owner, a.ownerToken, 'needs-a-def-two');
        const r = await json(`/v1/agents/${fresh.name}/crew/seed`, {
            method: 'POST', headers: authA,
            body: JSON.stringify({ doc: DOC, validate_with: offlineA.name }),
        });
        assert(r.status === 409, `expected 409, got ${r.status}`);
        assert(r.body?.error?.code === 'AGENT_OFFLINE', `expected AGENT_OFFLINE, got ${r.body?.error?.code}`);
    });

    await test('another owner cannot seed your agent', async () => {
        const gaii = `${offlineA.name}#${a.owner}@${NODE_ID}`;
        const r = await json(`/v1/agents/${encodeURIComponent(gaii)}/crew/seed`, {
            method: 'POST', headers: authB, body: JSON.stringify({ doc: DOC }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('with nothing of the owner\'s connected, seed says so plainly', async () => {
        const d = await setupOwner('d');
        const lonely = await addV1Agent(d.owner, d.ownerToken, 'all-alone');
        const r = await json(`/v1/agents/${lonely.name}/crew/seed`, {
            method: 'POST', headers: { Authorization: `Bearer ${d.ownerToken}` },
            body: JSON.stringify({ doc: DOC }),
        });
        assert(r.status === 409, `expected 409, got ${r.status}`);
        assert(r.body?.error?.code === 'NO_VALIDATOR', `expected NO_VALIDATOR, got ${r.body?.error?.code}`);
    });

    // ── 8c. Credential health: the reading the Agents section is built around ─
    await test('the fleet says which agents can still sign in, and which cannot', async () => {
        const r = await json('/v1/agents?include=credentials', { headers: authA });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        const list = r.body.data.agents as any[];

        const concierge = list.find(x => x.name === 'concierge');
        assert(concierge.credential.kind === 'key-and-card', `a v2 agent is key-and-card, got ${concierge.credential.kind}`);
        assert(concierge.credential.state === 'ok', `and fine, got ${concierge.credential.state}`);
        assert(concierge.credential.key_pinned === true, 'with a pinned key');
        assert(concierge.credential.card_valid === true, 'and a card that reads');
        assert(concierge.credential.expires_at === null, 'and no expiry to report: it mints per use');

        const v1 = list.find(x => x.name === daemonA.name);
        assert(v1.credential.kind === 'device-token', `a v1 agent is device-token, got ${v1.credential.kind}`);
        // These test tokens are one-hour /v1/auth/token sessions, so `expiring` is the RIGHT answer
        // for them and a real ninety-day device credential reads `ok`. Both mean it can sign in.
        assert(['ok', 'expiring'].includes(v1.credential.state), `it can sign in, got ${v1.credential.state}`);
        assert(typeof v1.credential.expires_at === 'string', 'with a date, because that is what runs out');
        assert(v1.credential.summary.length > 0, 'and a sentence a person can act on');
    });

    await test('a revoked sign-in shows as dead, which is the state nothing used to report', async () => {
        const victim = await addV1Agent(a.owner, a.ownerToken, 'about-to-die');
        const before = await json('/v1/agents?include=credentials', { headers: authA });
        const was = (before.body.data.agents as any[]).find(x => x.name === victim.name).credential.state;
        assert(['ok', 'expiring'].includes(was), `it starts out able to sign in, got ${was}`);

        // Sign that one agent out. The others must be untouched: revoked by session, not by owner.
        const out = await json('/v1/auth/revoke', { method: 'POST', headers: { Authorization: `Bearer ${victim.token}` } });
        assert(out.status === 200 || out.status === 204, `revoke ${out.status}: ${JSON.stringify(out.body?.error)}`);

        const after = await json('/v1/agents?include=credentials', { headers: authA });
        const dead = (after.body.data.agents as any[]).find(x => x.name === victim.name);
        assert(dead.credential.state === 'dead', `expected dead, got ${dead.credential.state}`);
        assert(dead.credential.summary.toLowerCase().includes('connect'), 'and it should say what to do');
        const sibling = (after.body.data.agents as any[]).find(x => x.name === daemonA.name);
        assert(['ok', 'expiring'].includes(sibling.credential.state), 'and no sibling was taken down with it');
    });

    await test('an agent that never connected says so, rather than claiming its sign-in ran out', async () => {
        // Registration stamps `lastSeen` alongside `createdAt`, so "has a lastSeen" is true of an
        // agent created a second ago. Reading it as evidence of a connection told every unconnected
        // agent to reconnect something it had never connected. Create one and do not sign it in.
        const born = await json('/v1/agents', {
            method: 'POST', headers: authA,
            body: JSON.stringify({ name: 'never-ran', owner: a.owner, capabilities: [], mode: 'interactive', scopes: ['memory:read'] }),
        });
        assert(born.status === 201, `agent ${born.status}`);

        const r = await json('/v1/agents?include=credentials', { headers: authA });
        const fresh = (r.body.data.agents as any[]).find(x => x.name === 'never-ran');
        assert(fresh.credential.state === 'never', `expected never, got ${fresh.credential.state}`);
        assert(fresh.credential.expires_at === null, 'and nothing to expire');
        assert(fresh.credential.days_left === null, 'and no countdown');
    });

    await test('the fleet counts what needs attention without the reader scanning rows', async () => {
        const r = await json('/v1/agents?include=credentials', { headers: authA });
        const s = r.body.data.credential_summary;
        assert(!!s, 'the summary should be there when credentials were asked for');
        assert(s.dead >= 1, `at least the one we just killed, got ${s.dead}`);
        assert(s.never >= 1, `and the one that never connected, got ${s.never}`);
        assert(s.ok + s.expiring >= 1, 'and the ones that can still sign in counted separately');
    });

    await test('credential health is opt-in: the old listing is byte-for-byte what it was', async () => {
        const plain = await json('/v1/agents', { headers: authA });
        assert(plain.status === 200, `expected 200, got ${plain.status}`);
        assert((plain.body.data.agents as any[]).every(x => x.credential === undefined),
            'nothing extra without the include');
        assert(plain.body.data.credential_summary === undefined, 'and no summary either');
    });

    // ── 9. Run mode is readable and settable, and fenced ─────────────────────
    await test('the owner can set an agent resident, and read it back', async () => {
        const r = await json(`/v1/agents/concierge/run-mode`, {
            method: 'PATCH', headers: authA, body: JSON.stringify({ run_mode: 'resident' }),
        });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert(r.body.data.run_mode === 'resident', `expected resident, got ${r.body.data.run_mode}`);
        const list = await json('/v1/agents?owner=' + a.owner, { headers: authA });
        const rec = (list.body.data.agents as any[]).find(x => x.name === 'concierge');
        assert(rec.run_mode === 'resident', 'the list should show the new run mode');
    });

    await test('a nonsense run mode is refused', async () => {
        const r = await json(`/v1/agents/concierge/run-mode`, {
            method: 'PATCH', headers: authA, body: JSON.stringify({ run_mode: 'whenever' }),
        });
        assert(r.status === 400, `expected 400, got ${r.status}`);
    });

    await test('another owner cannot change your agent\'s run mode', async () => {
        const gaii = `concierge#${a.owner}@${NODE_ID}`;
        const r = await json(`/v1/agents/${encodeURIComponent(gaii)}/run-mode`, {
            method: 'PATCH', headers: authB, body: JSON.stringify({ run_mode: 'resident' }),
        });
        assert(r.status === 403 || r.status === 404, `expected a refusal, got ${r.status}`);
    });

    // ── 10. Pressing twice is safe ────────────────────────────────────────────
    await test('pressing the button again changes nothing', async () => {
        const r = await json('/v1/agents/v2/basic-agents', { method: 'POST', headers: authA });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert((r.body.data.created as string[]).length === 0, 'nothing should be created the second time');
        assert((r.body.data.skipped as any[]).length === BASIC_NAMES.length, `all ${BASIC_NAMES.length} should be reported as already there`);
    });

    // ── 11. The v1 path is untouched ──────────────────────────────────────────
    await test('the v1 agent still authenticates, polls and is listed as before', async () => {
        const me = await json(`/v1/agents/${encodeURIComponent(daemonA.gaii)}`, { headers: { Authorization: `Bearer ${daemonA.token}` } });
        assert(me.status === 200, `v1 agent read ${me.status}`);
        const mem = await json('/v1/memory', { headers: { Authorization: `Bearer ${daemonA.token}` } });
        assert(mem.status === 200, `v1 agent memory read ${mem.status}`);
        const list = await json('/v1/agents?owner=' + a.owner, { headers: authA });
        const rec = (list.body.data.agents as any[]).find(x => x.name === daemonA.name);
        assert(rec.identity_version === 1, 'a v1 agent should still report identity_version 1');
        assert(rec.card_enrolled === false, 'a v1 agent has no card');
    });

    dA.close(); dB.close(); dC.close();
    void pressBody;
    // ── The migration: the twelve dead-token agents, rehearsed on throwaways ──
    //
    // Proven LOCALLY ONLY, against agents put into the same state as the real ones: registered,
    // v1, a session that no longer signs in, no live tunnel of their own. Nothing on aimeat.io is
    // touched by anything here.
    await test('a stuck v1 agent moves to a key and a card, and keeps everything else', async () => {
        const mig = await setupOwner('mig');
        const authMig = { Authorization: `Bearer ${mig.ownerToken}` };

        // The daemon that will hold the new keys. Its own credential stays a v1 one: the machine is
        // not what is being migrated.
        const daemon = await addV1Agent(mig.owner, mig.ownerToken, 'mig-daemon');
        const dMig = await openDaemon(daemon.token, 'install-mig');

        try {
            // Two agents in the state the real twelve are in: they signed in once, and cannot now.
            const stuck = await addV1Agent(mig.owner, mig.ownerToken, 'stuck-one', ['memory:read']);
            const alsoStuck = await addV1Agent(mig.owner, mig.ownerToken, 'stuck-two', ['memory:read', 'memory:write']);
            for (const victim of [stuck, alsoStuck]) {
                const out = await json('/v1/auth/revoke', { method: 'POST', headers: { Authorization: `Bearer ${victim.token}` } });
                assert(out.status === 200 || out.status === 204, `revoke ${out.status}`);
            }

            // Give one of them a tag, so "it keeps everything else" is measured rather than hoped.
            await json(`/v1/agents/${stuck.name}/tags`, {
                method: 'PATCH', headers: authMig, body: JSON.stringify({ tags: ['keep-me'] }),
            });

            const before = await json('/v1/agents?include=credentials', { headers: authMig });
            const beforeStuck = (before.body.data.agents as any[]).find(x => x.name === 'stuck-one');
            assert(beforeStuck.credential.state === 'dead', `it starts stuck, got ${beforeStuck.credential.state}`);

            // What WOULD move, before anything does. The daemon's own agent is not stuck, so it is
            // not in the list: the button does not sweep up whatever it can reach.
            const preview = await json('/v1/agents/v2/migrate', { headers: authMig });
            assert(preview.status === 200, `preview ${preview.status}`);
            const names = (preview.body.data.would_move as any[]).map(x => x.name).sort();
            assert(JSON.stringify(names) === JSON.stringify(['stuck-one', 'stuck-two']),
                `exactly the stuck ones, got ${JSON.stringify(names)}`);
            assert(preview.body.data.next_step.includes('connector is running'), 'and the sentence says it can go ahead');

            // The daemon answers the offer exactly as it answers the basic-agents one: same
            // capability, same cards, no new connector code.
            let offered: string[] = [];
            dMig.onEnrol = async (offer) => {
                offered = (offer.agents as any[]).map(x => x.name);
                const cards: string[] = [];
                for (const one of offer.agents) {
                    const key = await makeKey();
                    cards.push(await signWith(cardFor(one, mig.owner, key), key));
                }
                const res = await json('/v1/agents/v2/enrol', {
                    method: 'POST', headers: { Authorization: `Bearer ${daemon.token}` },
                    body: JSON.stringify({ grant_id: offer.grant_id, cards }),
                });
                if (res.status !== 200) return { ok: false, result: res.body?.error ?? null };
                return { ok: true, result: { attached: (res.body.data.enrolled as any[]).map(e => e.name) } };
            };

            const r = await json('/v1/agents/v2/migrate', { method: 'POST', headers: authMig });
            assert(r.status === 200, `migrate ${r.status}: ${JSON.stringify(r.body?.error)}`);
            assert(JSON.stringify((r.body.data.moved as string[]).sort()) === JSON.stringify(['stuck-one', 'stuck-two']),
                `both moved, got ${JSON.stringify(r.body.data.moved)}`);
            assert((r.body.data.still_stuck as string[]).length === 0, 'and none left behind');
            assert(offered.length === 2, 'the daemon was offered exactly those two');

            // What they became, and what they kept.
            const after = await json('/v1/agents?include=credentials', { headers: authMig });
            const one = (after.body.data.agents as any[]).find(x => x.name === 'stuck-one');
            assert(one.identity_version === 2, `now a key-and-card agent, got ${one.identity_version}`);
            assert(one.credential.kind === 'key-and-card', `and the fleet reads it as one, got ${one.credential.kind}`);
            assert(one.credential.state === 'ok', `and it can sign in, got ${one.credential.state}`);
            assert(one.gaii === stuck.gaii, 'the identity is the same identity');
            assert((one.tags ?? []).includes('keep-me'), `and the tags survived, got ${JSON.stringify(one.tags)}`);
            const two = (after.body.data.agents as any[]).find(x => x.name === 'stuck-two');
            assert(JSON.stringify(two.scopes ?? two.default_scopes ?? []) !== '["*"]',
                'a migration changes how an agent proves who it is, not what it may do');

            // It really can sign in now: a fresh assertion against the pinned key mints a token.
            // (The daemon holds those keys; here the proof is that the node reports it can.)
            const settled = await json('/v1/agents/v2/migrate', { headers: authMig });
            assert((settled.body.data.would_move as any[]).length === 0, 'and there is nothing left to move');
            assert(settled.body.data.next_step.includes('nothing to move'), 'which the sentence says');
        } finally {
            dMig.close();
        }
    });

    await test('a migration that fails leaves the agent exactly as it was', async () => {
        const mig = await setupOwner('migfail');
        const authMig = { Authorization: `Bearer ${mig.ownerToken}` };
        const daemon = await addV1Agent(mig.owner, mig.ownerToken, 'failing-daemon');
        const dFail = await openDaemon(daemon.token, 'install-fail');
        try {
            const victim = await addV1Agent(mig.owner, mig.ownerToken, 'stays-put', ['memory:read']);
            await json('/v1/auth/revoke', { method: 'POST', headers: { Authorization: `Bearer ${victim.token}` } });

            const before = (await json(`/v1/agents/${encodeURIComponent(victim.gaii)}`, { headers: authMig })).body;

            // The connector refuses. This is the case that must not leave a half-migrated row.
            dFail.onEnrol = async () => ({ ok: false, result: { code: 'NOPE', message: 'not signing that' } });
            const r = await json('/v1/agents/v2/migrate', { method: 'POST', headers: authMig });
            assert(r.status === 502, `expected 502, got ${r.status}`);
            assert(String(r.body?.error?.message).includes('Nothing changed'), 'and it says so plainly');

            const after = await json('/v1/agents?include=credentials', { headers: authMig });
            const still = (after.body.data.agents as any[]).find(x => x.name === 'stays-put');
            assert((still.identity_version ?? 1) !== 2, `still v1, got ${still.identity_version}`);
            assert(!still.enrolled_at, 'with nothing pinned');
            assert(still.credential.kind === 'device-token', `and read as what it is, got ${still.credential.kind}`);
            assert(still.credential.state === 'dead', 'still stuck, which is honest');
            void before;

            // And pressing again is allowed: the spent grant does not lock the owner out.
            dFail.onEnrol = async () => ({ ok: false, result: { code: 'NOPE', message: 'again' } });
            const twice = await json('/v1/agents/v2/migrate', { method: 'POST', headers: authMig });
            assert(twice.status === 502, `a second press is a fresh grant, got ${twice.status}`);
        } finally {
            dFail.close();
        }
    });

    await test('with no connector running, the move refuses and writes nothing', async () => {
        const mig = await setupOwner('migoff');
        const authMig = { Authorization: `Bearer ${mig.ownerToken}` };
        const victim = await addV1Agent(mig.owner, mig.ownerToken, 'no-daemon-here', ['memory:read']);
        await json('/v1/auth/revoke', { method: 'POST', headers: { Authorization: `Bearer ${victim.token}` } });

        const preview = await json('/v1/agents/v2/migrate', { headers: authMig });
        assert((preview.body.data.would_move as any[]).length === 1, 'the preview still says what would move');
        assert(preview.body.data.next_step.includes('aimeat connect serve'),
            `and tells the person what to start, got ${preview.body.data.next_step}`);

        const r = await json('/v1/agents/v2/migrate', { method: 'POST', headers: authMig });
        assert(r.status === 409, `expected 409, got ${r.status}`);
        assert(r.body?.error?.code === 'NO_DAEMON', `with a code that says which, got ${r.body?.error?.code}`);

        const after = await json('/v1/agents?include=credentials', { headers: authMig });
        const still = (after.body.data.agents as any[]).find(x => x.name === 'no-daemon-here');
        assert((still.identity_version ?? 1) !== 2, 'and the agent is untouched');
    });

    await test('an agent acting in the owner\'s name cannot move the fleet', async () => {
        // The same gate the basic-agents button takes: this replaces a credential, and
        // req.auth.owner carries the human's name on an agent token too.
        const r = await json('/v1/agents/v2/migrate', {
            method: 'POST', headers: { Authorization: `Bearer ${daemonA.token}` },
        });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('another account cannot move this one\'s agents', async () => {
        const r = await json('/v1/agents/v2/migrate', { method: 'POST', headers: authB });
        // B has agents of its own; what matters is that nothing of A's is in the answer.
        assert(!JSON.stringify(r.body ?? {}).includes('stuck-one'), 'no sight of another account\'s agents');
    });

    await test('two machines are two daemons, and the press can name which one', async () => {
        // The V1 report carried this as a stated limitation: one `connect serve` holds one socket
        // per agent, so two laptops looked like one set of principals and the offer went to
        // whichever sorted first — possibly the machine the person was not sitting at.
        // Its OWN owner: this press creates the basic agents, and doing that on the shared owner
        // would leave nothing for the acceptance test above to create.
        const m = await setupOwner('m');
        const authM = { Authorization: `Bearer ${m.ownerToken}` };
        const laptop = await addV1Agent(m.owner, m.ownerToken, 'two-machines-laptop');
        const server = await addV1Agent(m.owner, m.ownerToken, 'two-machines-server');
        const dLaptop = await openDaemon(laptop.token, 'install-laptop');
        const dServer = await openDaemon(server.token, 'install-server');
        try {
            // Each machine answers only for itself, so the node can tell them apart.
            const heard: string[] = [];
            dLaptop.onEnrol = async () => { heard.push('laptop'); return { ok: false, result: { code: 'NO', message: 'not me' } }; };
            dServer.onEnrol = async () => { heard.push('server'); return { ok: false, result: { code: 'NO', message: 'not me' } }; };

            // Naming a machine that is not connected is refused rather than served by the other:
            // "run this on my laptop" answered by the server is not a smaller version of the ask.
            const nowhere = await json('/v1/agents/v2/basic-agents', {
                method: 'POST', headers: authM, body: JSON.stringify({ install_id: 'install-nowhere' }),
            });
            assert(nowhere.status === 409, `expected 409 for an absent machine, got ${nowhere.status}`);
            assert(nowhere.body?.error?.code === 'DAEMON_NOT_CONNECTED', `and a code that says so, got ${nowhere.body?.error?.code}`);
            assert(heard.length === 0, `and nothing was offered to anybody, got ${JSON.stringify(heard)}`);

            // Naming one that IS connected reaches that one.
            await json('/v1/agents/v2/basic-agents', {
                method: 'POST', headers: authM, body: JSON.stringify({ install_id: 'install-server' }),
            });
            assert(heard.length === 1 && heard[0] === 'server',
                `the named machine should be the one asked, got ${JSON.stringify(heard)}`);
        } finally {
            dLaptop.close();
            dServer.close();
        }
    });

    // ── Two owners on one connector home ─────────────────────────────────────
    //
    // Stage A of the isolation test, pinned. The connector holds both owners' agents in one
    // process and one directory; the node is what has to keep them apart, and these are the
    // doors that were actually walked with a live daemon on 2026-09-01.
    //
    // Both owners press the button, so both have a `concierge` and a `workflow-manager` — the same
    // NAMES under two accounts, which is the shape that makes a bare-name assumption anywhere in
    // the stack visible.
    console.log('\n=== Agent v2: two owners, the same agent names ===\n');
    {
        const one = await setupOwner('iso1');
        const two = await setupOwner('iso2');
        const auth1 = { Authorization: `Bearer ${one.ownerToken}` };
        const auth2 = { Authorization: `Bearer ${two.ownerToken}` };
        const d1 = await openDaemon((await addV1Agent(one.owner, one.ownerToken, 'iso-daemon-1')).token, 'install-iso-1');
        const d2 = await openDaemon((await addV1Agent(two.owner, two.ownerToken, 'iso-daemon-2')).token, 'install-iso-2');
        // Neither daemon has a crew runtime attached, and the button does not need one: the node
        // seeds the definitions itself and the offer is what the daemon would answer.
        d1.onEnrol = async () => ({ ok: false, result: { code: 'NO_RUNTIME', message: 'node-side test' } });
        d2.onEnrol = async () => ({ ok: false, result: { code: 'NO_RUNTIME', message: 'node-side test' } });

        try {
            await json('/v1/agents/v2/basic-agents', { method: 'POST', headers: auth1 });
            await json('/v1/agents/v2/basic-agents', { method: 'POST', headers: auth2 });

            await test('each owner gets their own three, and neither roster shows the other\'s', async () => {
                for (const [who, auth, other] of [[one, auth1, two], [two, auth2, one]] as const) {
                    const r = await json(`/v1/agents?owner=${who.owner}`, { headers: auth });
                    const names = (r.body.data.agents as any[]).map(x => x.name);
                    for (const n of BASIC_NAMES) assert(names.includes(n), `${who.owner} is missing ${n}`);
                    // Every row is this owner's. A name appearing twice would mean the listing had
                    // merged two accounts that happen to share it.
                    const gaiis = (r.body.data.agents as any[]).map(x => x.gaii as string);
                    assert(gaiis.every(g => g.endsWith(`#${who.owner}@${NODE_ID}`)),
                        `${who.owner}'s roster carries a foreign identity: ${JSON.stringify(gaiis)}`);
                    assert(!gaiis.some(g => g.includes(`#${other.owner}@`)), `${other.owner} appears on ${who.owner}'s roster`);
                }
            });

            await test('and their own three crew definitions, under their own agent\'s identity', async () => {
                for (const [who, auth] of [[one, auth1], [two, auth2]] as const) {
                    for (const n of BASIC_NAMES) {
                        const gaii = `${n}#${who.owner}@${NODE_ID}`;
                        const r = await json(`/v1/memory/${encodeURIComponent(gaii)}/crews.registry.${n}`, { headers: auth });
                        assert(r.status === 200, `${who.owner}/${n}: no definition (${r.status})`);
                    }
                }
            });

            await test('one owner cannot read the other\'s identical definition', async () => {
                // Same key, same agent name, different owner: the only thing separating them is
                // the identity in the address, so this is the test that a shared NAME shares nothing.
                const theirs = `concierge#${two.owner}@${NODE_ID}`;
                const r = await json(`/v1/memory/${encodeURIComponent(theirs)}/crews.registry.concierge`, { headers: auth1 });
                assert(r.status === 403 || r.status === 404, `expected a refusal, got ${r.status}`);
            });

            await test('naming the other owner on a listing is ignored, not honoured', async () => {
                // These answer 200. What matters is WHOSE rows come back: a query parameter is not
                // a principal, and the resolved identity is what the store is read with.
                const r = await json(`/v1/agents?owner=${two.owner}`, { headers: auth1 });
                assert(r.status === 200, `expected the caller's own listing, got ${r.status}`);
                const gaiis = (r.body.data.agents as any[]).map(x => x.gaii as string);
                assert(gaiis.every(g => g.endsWith(`#${one.owner}@${NODE_ID}`)),
                    `?owner= reached another account: ${JSON.stringify(gaiis)}`);
            });

            await test('the only door that answers across owners is the public card, and it stays public', async () => {
                // This one is 200 BY DESIGN — it is the directory entry, the same view the
                // catalogue serves, and it needs the full GAII (a bare name is 404). It is here so
                // that a field which is not directory material cannot be added to it unnoticed.
                const theirs = `concierge#${two.owner}@${NODE_ID}`;
                const r = await json(`/v1/agents/${encodeURIComponent(theirs)}`, { headers: auth1 });
                assert(r.status === 200, `the public card should be readable, got ${r.status}`);
                const allowed = new Set(['gaii', 'display_name', 'description', 'capabilities', 'trust',
                    'actions_published', 'tags', 'federate', 'home_node', 'created_at', 'last_seen']);
                const extra = Object.keys(r.body.data).filter(k => !allowed.has(k));
                assert(extra.length === 0, `the public card grew a field: ${JSON.stringify(extra)}`);
                // Named explicitly, because these are the ones that would matter if they appeared.
                for (const secret of ['scopes', 'registeredBy', 'run_mode', 'console_url', 'token', 'publicKey']) {
                    assert(!(secret in r.body.data), `the public card exposes ${secret}`);
                }
            });

            await test('an agent of one owner is refused at every door that changes it', async () => {
                const theirs = `concierge#${two.owner}@${NODE_ID}`;
                const doors: Array<[string, string, RequestInit]> = [
                    ['change its run mode', `/v1/agents/${encodeURIComponent(theirs)}/run-mode`,
                        { method: 'PATCH', headers: auth1, body: JSON.stringify({ run_mode: 'resident' }) }],
                    ['change its console url', `/v1/agents/${encodeURIComponent(theirs)}/console-url`,
                        { method: 'PATCH', headers: auth1, body: JSON.stringify({ console_url: 'http://x' }) }],
                    ['end it', `/v1/agents/${encodeURIComponent(theirs)}`, { method: 'DELETE', headers: auth1 }],
                ];
                for (const [what, path, opts] of doors) {
                    const r = await json(path, opts);
                    assert(r.status === 403 || r.status === 404, `${what}: expected a refusal, got ${r.status}`);
                }
                // And it is still there afterwards, which is what makes the DELETE refusal mean
                // something rather than merely answering with an error code.
                const still = await json(`/v1/agents/${encodeURIComponent(theirs)}`, { headers: auth2 });
                assert(still.status === 200, `the other owner's concierge should be untouched, got ${still.status}`);
            });

            await test('an agent holding agent:delete may end only what it registered', async () => {
                // The scope word alone is not the permission: `registeredBy` is the second half,
                // and without it one owner's forge could clear away that owner's whole roster.
                // The OWNER creates the target, because there is no agent-callable creation door
                // at all — POST /v1/agents reads no scope. That gap is the Stage A finding.
                const made = await json('/v1/agents', {
                    method: 'POST', headers: auth1,
                    body: JSON.stringify({ name: 'iso-extra', owner: one.owner, capabilities: [] }),
                });
                assert(made.status === 201, `create ${made.status}`);

                const deleter1 = await addV1Agent(one.owner, one.ownerToken, 'iso-deleter-1', ['agent:delete']);
                const deleter2 = await addV1Agent(two.owner, two.ownerToken, 'iso-deleter-2', ['agent:delete']);

                // Its own owner's agent, and it still may not: it did not register this one.
                const mine = await json('/v1/agents/iso-extra', { method: 'DELETE', headers: { Authorization: `Bearer ${deleter1.token}` } });
                assert(mine.status === 403, `expected the registeredBy fence, got ${mine.status}`);

                // The other owner's deleter does not get a different error that would tell it the
                // agent exists. It is not an oracle.
                const theirs = await json('/v1/agents/iso-extra', { method: 'DELETE', headers: { Authorization: `Bearer ${deleter2.token}` } });
                assert(theirs.status === 404, `expected 404 across owners, got ${theirs.status}`);

                // Still there, and the owner who made it can end it.
                const gone = await json('/v1/agents/iso-extra', { method: 'DELETE', headers: auth1 });
                assert(gone.status === 200, `the owner may end their own agent, got ${gone.status}`);
            });
        } finally {
            d1.close();
            d2.close();
        }
    }

}

run().then(() => {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
    console.error('Suite crashed:', err);
    process.exit(1);
});
