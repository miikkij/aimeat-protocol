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
    close(): void;
}

function openDaemon(token: string): Promise<FakeDaemon> {
    return new Promise((resolve, reject) => {
        const wsUrl = BASE.replace(/^http/, 'ws') + '/v1/connect/tunnel';
        const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${token}` } });
        const daemon: FakeDaemon = { ws, onEnrol: null, close: () => { try { ws.close(); } catch { /* already gone */ } } };
        const timer = setTimeout(() => reject(new Error('tunnel did not welcome in time')), 10_000);
        ws.on('message', (data) => {
            let frame: any;
            try { frame = JSON.parse(data.toString()); } catch { return; }
            if (frame.type === 'welcome') { clearTimeout(timer); resolve(daemon); return; }
            if (frame.type === 'invoke' && frame.capability === ENROL_CAPABILITY) {
                const handler = daemon.onEnrol;
                const answer = handler
                    ? handler(frame.input)
                    : Promise.resolve({ ok: false, result: { code: 'NO_HANDLER', message: 'nothing listening' } });
                void answer.then(r => ws.send(JSON.stringify({ type: 'invoke_result', id: frame.id, ok: r.ok, result: r.result })));
            }
        });
        ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
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

    // ── 3. An agent of the owner cannot press the button ──────────────────────
    await test('an agent acting in the owner\'s name cannot press the button', async () => {
        const r = await json('/v1/agents/v2/basic-agents', { method: 'POST', headers: { Authorization: `Bearer ${daemonA.token}` } });
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

    await test('the card asked for the wildcard and was granted the template instead', async () => {
        const list = await json('/v1/agents?owner=' + a.owner, { headers: authA });
        const forge = (list.body.data.agents as any[]).find(x => x.name === 'crew-forge');
        assert(!forge.default_scopes.includes('*'), 'crew-forge must not hold the wildcard');
        assert(forge.default_scopes.includes('agent:write'), 'crew-forge should hold agent:write');
        assert(!forge.default_scopes.includes('agent:permissions'), 'crew-forge must not hold agent:permissions');
    });

    // ── 5. The card verifies from outside, using only the published JWKS ──────
    await test('each card verifies against its own published key set', async () => {
        for (const n of BASIC_NAMES) {
            const gaii = `${n}#${a.owner}@${NODE_ID}`;
            const cardRes = await fetch(`${BASE}/v1/agents/${encodeURIComponent(gaii)}/card`);
            assert(cardRes.status === 200, `${n} card ${cardRes.status}`);
            const jws = (await cardRes.text()).trim();

            const jwksRes = await fetch(`${BASE}/v1/agents/${encodeURIComponent(gaii)}/jwks.json`);
            assert(jwksRes.status === 200, `${n} jwks ${jwksRes.status}`);
            const jwks = await jwksRes.json() as { keys: any[] };
            assert(jwks.keys.length === 1, `${n} should publish exactly one key`);

            // Nothing but these two documents. No token, no lookup, no asking the node.
            const key = await importJWK(jwks.keys[0], 'EdDSA');
            const { payload } = await compactVerify(jws, key, { algorithms: ['EdDSA'] });
            const card = JSON.parse(new TextDecoder().decode(payload));
            assert(card.gaii === gaii, `${n} card identity mismatch`);
            assert(card.runMode === 'spawn', `${n} card run mode`);
        }
    });

    await test('both public documents are readable with no credential at all', async () => {
        const gaii = `concierge#${a.owner}@${NODE_ID}`;
        const r = await fetch(`${BASE}/v1/agents/${encodeURIComponent(gaii)}/card`);
        assert(r.status === 200, `unauthenticated card read ${r.status}`);
    });

    await test('an agent that never enrolled has no card and no key set', async () => {
        const r = await fetch(`${BASE}/v1/agents/${encodeURIComponent(daemonA.gaii)}/card`);
        assert(r.status === 404, `expected 404, got ${r.status}`);
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
}

run().then(() => {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
    console.error('Suite crashed:', err);
    process.exit(1);
});
