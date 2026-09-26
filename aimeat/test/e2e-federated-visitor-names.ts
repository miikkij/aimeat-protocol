/**
 * @file test/e2e-federated-visitor-names.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A visitor signed in from another node keeps its own name on every road, and never
 *   becomes the LOCAL account that shares its local part.
 *
 *   WHY. Since 2026-09-24 the session itself names the visitor by its home GHII (`alice@home-node`),
 *   and test/e2e-federated-namesake.ts proves every door that reads the session. The doors here are
 *   the other half: code that took a whole identity and cut it to an account name at the '@', which
 *   turned `alice@home-node` back into `alice`, the local namesake. Each case asks the same thing of
 *   two visitors from the same home node, one named like the local account and one with a fresh name
 *   (the control): the namesake must get what the control gets, and the account holder in person
 *   must still pass.
 *
 *   The home node is served on loopback the way test/e2e-federated-namesake.ts serves it: an active
 *   peer registered through the real operator routes, answering the verify door with a SIGNED
 *   attestation. What a visitor may do here is the peer's scope list, set through the operator's
 *   peer door before the visitors sign in.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-federated-visitor-names
 * @version-history
 *   v1.1.0 — 2026-09-26 — A visitor saves and starts no workflow here, whatever its scopes (secaudit
 *     2026-09, A6-4).
 *   v1.0.0 — 2026-09-26 — Initial: a group's MCP server is attached and reached by its own members,
 *     never by a visitor named like one (secaudit 2026-09, a0ecb62eafb3).
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const as = (token: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
async function newKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    return { publicKey: Buffer.from(pub).toString('base64'), privateKey: Buffer.from(priv).toString('base64') };
}
function claims(token: string): Record<string, any> {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

const stamp = Date.now().toString(36);
const operatorName = `fedvnop${stamp}`;
const namesake = `fedvnalice${stamp}`;       // a LOCAL account, and the visitor's name on its home node
const strangerName = `fedvnstranger${stamp}`; // the control: a visitor no local account shares a name with
const homeNodeId = `aimeat-fake-home-vn-${stamp}`;

/** What the peer lets its visitors do here: the production visitor set, plus the words the cases below
 *  need so that each case is refused for the name and not for a missing scope. */
const VISITOR_SCOPES = [
    'memory:read', 'memory:write', 'catalogue:read', 'social:read', 'work:request', 'boards:read', 'social:write', 'boards:write',
    'mcp:read', 'mcp:manage', 'workflow:read', 'workflow:write',
];

let homeKeys = { publicKey: '', privateKey: '' };
let homeUrl = '';
let home: Server | null = null;

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => { let raw = ''; req.on('data', c => { raw += c.toString(); }); req.on('end', () => resolve(raw)); });
}
function send(res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

/** The home node: one door, the signed attestation the login verifies. It vouches for any name. */
function startHomeNode(): Promise<{ server: Server; url: string }> {
    const server = createServer((req, res) => {
        void (async () => {
            if (req.method === 'POST' && req.url === '/v1/federation/auth/verify') {
                const who = /"username"\s*:\s*"([^"]+)"/.exec(await readBody(req))?.[1] ?? namesake;
                const payload = {
                    verified: true,
                    ghii: `${who}@${homeNodeId}`,
                    display_name: 'A visitor',
                    home_node: homeNodeId,
                    home_url: homeUrl,
                    scopes: ['memory:read'],
                };
                send(res, 200, { ok: true, data: { ...payload, signature: await signMsg(homeKeys.privateKey, JSON.stringify(payload)) } });
                return;
            }
            send(res, 404, { ok: false, error: { code: 'NOT_FOUND' } });
        })();
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
    });
}

async function registerOwner(name: string): Promise<{ ghii: string; token: string }> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const sig = await signMsg(reg.body.data.private_key, name + NODE_ID + ts);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { ghii: `${name}@${NODE_ID}`, token: tok.body.data.token };
}

async function visitorLogin(name: string): Promise<string> {
    const r = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: `${name}@${homeNodeId}`, password: 'the-home-node-decides' }) });
    assert(r.status === 200, `federated login of ${name}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return r.body.data.token as string;
}

console.log('\n=== A visitor keeps its own name on every road ===\n');

let operator = { ghii: '', token: '' };
let alice = { ghii: '', token: '' };   // the local namesake
let visitorToken = '';                 // alice@home-node
let strangerToken = '';                // the control
let organismId = '';

async function run() {
    await test('Setup: an operator, the local namesake, a home node on loopback and its two visitors', async () => {
        operator = await registerOwner(operatorName);
        assert((claims(operator.token).roles ?? []).includes('operator'), 'this suite needs to be the first owner on a freshly deleted database');
        alice = await registerOwner(namesake);

        homeKeys = await newKeyPair();
        const started = await startHomeNode();
        home = started.server;
        homeUrl = started.url;
        const reg = await json('/v1/federation/peers', as(operator.token, { method: 'POST', body: JSON.stringify({ node_id: homeNodeId, url: homeUrl, public_key: homeKeys.publicKey }) }));
        assert(reg.status === 201, `peer register: ${reg.status} ${JSON.stringify(reg.body)}`);
        const act = await json(`/v1/federation/peers/${homeNodeId}`, as(operator.token, { method: 'PUT', body: JSON.stringify({ status: 'active', federation_auth_scopes: VISITOR_SCOPES }) }));
        assert(act.status === 200, `peer activate: ${act.status} ${JSON.stringify(act.body)}`);

        visitorToken = await visitorLogin(namesake);
        strangerToken = await visitorLogin(strangerName);
        const c = claims(visitorToken);
        assert(c.federated === true && c.owner === `${namesake}@${homeNodeId}` && JSON.stringify(c.roles) === '["federated"]',
            `the session this suite is about: ${JSON.stringify({ federated: c.federated, owner: c.owner, roles: c.roles })}`);
        for (const scope of ['memory:write', 'mcp:manage', 'workflow:write']) {
            assert((c.scopes ?? []).includes(scope), `the visitor needs ${scope} for the cases below: ${JSON.stringify(c.scopes)}`);
        }

        const org = await json('/v1/organisms', as(alice.token, { method: 'POST', body: JSON.stringify({
            name: `The namesake's group ${stamp}`, description: 'Owned by the local account',
            type: 'team', visibility: 'private', join_policy: 'invite_only',
        }) }));
        assert(org.status === 201, `setup: the namesake's organism: ${org.status} ${JSON.stringify(org.body?.error)}`);
        organismId = org.body.data.organism?.id as string;
        assert(!!organismId, `no organism id in ${JSON.stringify(org.body.data).slice(0, 200)}`);
    });

    // ── A group's MCP server (secaudit 2026-09, a0ecb62eafb3) ──
    // The door handed the service the caller's owner NAME and the service cut every name on the
    // group's rolls at the '@', so a visitor named like the group's owner attached a server to her
    // group, and one named like a member listed and used the group's servers.
    await test('A visitor named like the group\'s owner cannot attach an MCP server to her group; she can', async () => {
        const attach = (token: string, name: string) => json('/v1/mcp-servers/organism', as(token, {
            method: 'POST',
            // `auth: 'oauth'` defers the credential, so the answer is the authority alone and no
            // server has to be reachable.
            body: JSON.stringify({ organism_id: organismId, name, url: 'https://wiki.example/mcp', auth: 'oauth' }),
        }));
        const byNamesake = await attach(visitorToken, `vnwiki${stamp}`.slice(0, 32));
        assert(byNamesake.status === 403 && byNamesake.body?.error?.code === 'NOT_ALLOWED',
            `the visitor named like the owner attached a server to her group: ${byNamesake.status} ${JSON.stringify(byNamesake.body?.error ?? byNamesake.body?.data).slice(0, 200)}`);
        const byStranger = await attach(strangerToken, `vnwiki2${stamp}`.slice(0, 32));
        assert(byStranger.status === 403 && byStranger.body?.error?.code === 'NOT_ALLOWED',
            `the control visitor: ${byStranger.status} ${JSON.stringify(byStranger.body?.error)}`);

        const byOwner = await attach(alice.token, 'teamwiki');
        assert(byOwner.status === 201, `positive control: the group's owner in person attaches it: ${byOwner.status} ${JSON.stringify(byOwner.body?.error)}`);
    });

    await test('A visitor named like the group\'s owner does not see the group\'s server; she does', async () => {
        const seen = await json('/v1/mcp-servers', as(visitorToken));
        assert(seen.status === 200, `the visitor's own list answers: ${seen.status} ${JSON.stringify(seen.body?.error)}`);
        assert(!JSON.stringify(seen.body.data ?? '').includes('teamwiki'),
            `the visitor named like the owner was shown the group's server: ${JSON.stringify(seen.body.data).slice(0, 300)}`);
        const hers = await json('/v1/mcp-servers', as(alice.token));
        assert(hers.status === 200 && JSON.stringify(hers.body.data ?? '').includes('teamwiki'),
            `positive control: the owner sees her group's server: ${hers.status} ${JSON.stringify(hers.body?.data ?? hers.body?.error).slice(0, 300)}`);
    });

    // ── Workflows (secaudit 2026-09, A6-4) ──
    // A workflow is this node's own automation, stored and run under an account of this node. A
    // visitor has no account here, so saving or starting one is refused at the door, whatever words
    // the peer granted, before the body is read.
    await test('A visitor cannot save or start a workflow here, whatever its scopes; the owner reaches the door', async () => {
        const id = `vn-wf-${stamp}`;
        for (const [who, token] of [['the visitor named like the owner', visitorToken], ['the control visitor', strangerToken]] as const) {
            const save = await json(`/v1/workflows/${id}`, as(token, { method: 'PUT', body: JSON.stringify({}) }));
            assert(save.status === 403 && save.body?.error?.code === 'FORBIDDEN',
                `${who} reached the workflow save door: ${save.status} ${JSON.stringify(save.body?.error ?? save.body?.data).slice(0, 200)}`);
            const start = await json(`/v1/workflows/${id}/run`, as(token, { method: 'POST', body: JSON.stringify({}) }));
            assert(start.status === 403 && start.body?.error?.code === 'FORBIDDEN',
                `${who} reached the workflow start door: ${start.status} ${JSON.stringify(start.body?.error ?? start.body?.data).slice(0, 200)}`);
        }
        // Positive control: the owner in person passes the door, and meets the body check behind it.
        const own = await json(`/v1/workflows/${id}`, as(alice.token, { method: 'PUT', body: JSON.stringify({}) }));
        assert(own.status === 400, `positive control: the owner's empty save is refused for its body, not at the door: ${own.status} ${JSON.stringify(own.body?.error).slice(0, 200)}`);
    });
}

try {
    await run();
} finally {
    if (home) await new Promise<void>(r => home!.close(() => r()));
}
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
