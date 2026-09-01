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
 *   the account holder. crew-forge, the agent that creates agents, cannot create one for anybody
 *   else.
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
const BASIC_NAMES = ['concierge', 'crew-forge', 'workflow-manager'];

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
    await test('one press, three agents, nothing pasted and nothing restarted', async () => {
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
        assert((r.body.data.created as string[]).length === 3, `expected 3 created, got ${JSON.stringify(r.body.data.created)}`);
        assert((r.body.data.enrolled as any[]).length === 3, `expected 3 enrolled, got ${JSON.stringify(r.body.data.enrolled)}`);
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

    await test('the three agents are listed with their run mode and credential state', async () => {
        const list = await json('/v1/agents?owner=' + a.owner, { headers: authA });
        for (const n of BASIC_NAMES) {
            const rec = (list.body.data.agents as any[]).find(x => x.name === n);
            assert(!!rec, `${n} missing from the list`);
            assert(rec.run_mode === 'spawn', `${n} run_mode should be spawn, got ${rec.run_mode}`);
            assert(rec.identity_version === 2, `${n} should be a v2 identity`);
            assert(rec.card_enrolled === true, `${n} should be enrolled`);
        }
    });

    // The question crewaimeat asked back: is run_mode there for a v2 agent the moment it enrols?
    await test('run_mode is on a v2 agent the moment it is enrolled, and a roster read can filter on it', async () => {
        const all = await json('/v1/agents?owner=' + a.owner, { headers: authA });
        const spawn = await json('/v1/agents?run_mode=spawn', { headers: authA });
        const names = (spawn.body.data.agents as any[]).map(x => x.name).sort();
        assert(JSON.stringify(names) === JSON.stringify([...BASIC_NAMES].sort()),
            `the filter should return exactly the spawn agents, got ${JSON.stringify(names)}`);
        assert((all.body.data.agents as any[]).length > names.length, 'and the unfiltered list is bigger');
        // A v1 agent has no run mode, and absence is not 'spawn'.
        const v1 = (all.body.data.agents as any[]).find(x => x.name === daemonA.name);
        assert(v1.run_mode === null, `a v1 agent should report null, got ${v1.run_mode}`);
        const none = await json('/v1/agents?run_mode=nonsense', { headers: authA });
        assert((none.body.data.agents as any[]).length === 0, 'an unknown run mode returns nothing, never everything');
    });

    await test('the card asked for the wildcard and was granted the template instead', async () => {
        const list = await json('/v1/agents?owner=' + a.owner, { headers: authA });
        const forge = (list.body.data.agents as any[]).find(x => x.name === 'crew-forge');
        assert(!forge.default_scopes.includes('*'), 'crew-forge must not hold the wildcard');
        assert(forge.default_scopes.includes('agent:write'), 'crew-forge should hold agent:write');
        assert(!forge.default_scopes.includes('agent:permissions'), 'crew-forge must not hold agent:permissions');
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
            assert(card.runMode === 'spawn', `${n} card run mode`);
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
        assert(card.gaii === gaii && card.runMode === 'spawn', 'the public card should still identify the agent');
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
        assert((r.body.data.enrolled as any[]).length === 3, 'all three should come back');
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

    // ── 8. crew-forge creates agents for its owner and for nobody else ────────
    await test('crew-forge cannot create an agent for a different owner', async () => {
        const gaii = `crew-forge#${a.owner}@${NODE_ID}`;
        const assertion = await signAssertion(gaii, keysByAgent.get('crew-forge')!);
        const mint = await json('/v1/agents/v2/token', { method: 'POST', body: JSON.stringify({ grant_type: KEY_GRANT, assertion }) });
        assert(mint.status === 200, `crew-forge mint ${mint.status}`);
        const forgeToken = mint.body.access_token as string;

        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: { Authorization: `Bearer ${forgeToken}` },
            body: JSON.stringify({ agent_name: 'forged-sibling', owner: b.owner, scopes: ['memory:read'] }),
        });
        // The cross-owner case falls through to the ordinary pending flow: no auto-approval, no
        // agent, and no credential for anyone to collect.
        assert(r.body?.data?.auto_approved !== true, 'a cross-owner registration must never be auto-approved');
        const list = await json('/v1/agents?owner=' + b.owner, { headers: authB });
        const names = (list.body.data.agents as any[]).map(x => x.name);
        assert(!names.includes('forged-sibling'), 'no agent may appear under the other owner');
    });

    await test('crew-forge cannot hand a sibling more than it holds itself', async () => {
        const gaii = `crew-forge#${a.owner}@${NODE_ID}`;
        const assertion = await signAssertion(gaii, keysByAgent.get('crew-forge')!);
        const mint = await json('/v1/agents/v2/token', { method: 'POST', body: JSON.stringify({ grant_type: KEY_GRANT, assertion }) });
        const forgeToken = mint.body.access_token as string;
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: { Authorization: `Bearer ${forgeToken}` },
            body: JSON.stringify({ agent_name: 'over-reacher', owner: a.owner, scopes: ['account:security'] }),
        });
        assert(r.body?.data?.auto_approved !== true, 'an escalating registration must wait for the owner');
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
        assert((r.body.data.skipped as any[]).length === 3, 'all three should be reported as already there');
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

}

run().then(() => {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
    console.error('Suite crashed:', err);
    process.exit(1);
});
