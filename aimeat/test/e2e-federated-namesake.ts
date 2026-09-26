/**
 * @file test/e2e-federated-namesake.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A visitor signed in from another node never reaches the mailbox of the LOCAL account
 *   that happens to share their name.
 *
 *   WHY. A federated login mints roles:['owner'] with `owner` set to the local part of the visitor's
 *   home GHII (routes/ghii/register-login.ts). Every door in routes/messages.ts derives the mailbox
 *   from that name, so `alice@other-node` signing in here was handed the mailbox of `alice@this-node`:
 *   her contact requests, her address book, and the power to accept, block, mark read and transcribe
 *   in it. requireRole('owner') admitted the session because its role says owner. A visitor has no
 *   mailbox on this node at all (their messages are addressed to their home GHII and delivered
 *   there), so every messages door now refuses a federated session with requireLocalSession().
 *
 *   The home node is served on loopback the way test/e2e-federated-session.ts serves it: an active
 *   peer registered through the real operator routes, answering the verify door with a SIGNED
 *   attestation. The runner pins AIMEAT_FEDERATION_AUTH_POLICY=all_peers and private egress.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-federated-namesake
 * @version-history
 *   v1.6.0 — 2026-09-26 — The GET sweep leaves out the two figures GET /v1/health moves on its own
 *     (uptime_seconds, memory_mb). The three asks run at once, and when they straddled a second the
 *     sweep read the tick as the visitor getting the namesake's answer: one run in six failed so,
 *     on a door that reads no caller at all. Measured while the suite earned the guard tier.
 *   v1.5.0 — 2026-09-24 — The ROOT, not the gates: verifyJWT reads the visitor as role 'federated'
 *     named by its home GHII, and the suite asks EVERY GET door in openapi.yaml whether a visitor
 *     named like the local account gets anything a visitor with a fresh name does not. Plus the four
 *     doors that decided on the role alone: the A2A account road, the AI-spend gate, device
 *     authorization's same-owner shortcut and the node-wide schema door. Each new case failed on the
 *     source (secaudit 2026-09: A3-1, A4-1, A4-2, A6-4, A1-1).
 *   v1.4.0 — 2026-09-24 — The GATES, not one door at a time: requireRole('owner'),
 *     requireOwnerPrincipal and requireOwnerSession admitted a federated session, so every owner
 *     door the door-by-door sweep did not name (agent rekey, passkey setup, the home step) was open
 *     to the namesake's visitor. Each of the three gates now refuses federated (secaudit 2026-09).
 *   v1.3.0 — 2026-09-14 — The doors that hand over the ACCOUNT, not just a read of it: the session
 *     refresh, the GDPR export and delete, the connectivity-key mint, and the file listing. Each
 *     one failed on the source with the harm in the message.
 *   v1.2.0 — 2026-09-13 — GET /v1/owners/:name: the visitor gets the namesake's public card, never
 *     its roles or its agent roster (the door compared the owner name).
 *   v1.1.0 — 2026-09-13 — The identity itself, which is the root: the visitor's session resolves to
 *     their HOME GHII, so it reads none of the namesake's memory (direct, ?owner_scope=true or a
 *     listing), writes into none of it, and GET /v1/ghii/me is not the namesake's profile.
 *   v1.0.0 — 2026-09-13 — Initial, with requireLocalSession on every door in routes/messages.ts.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as ed from '@noble/ed25519';
import { parse as parseYaml } from 'yaml';

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
const operatorName = `fednsop${stamp}`;
const namesake = `fednsalice${stamp}`;          // a LOCAL account, and the visitor's name on their home node
const bobName = `fednsbob${stamp}`;
const carolName = `fednscarol${stamp}`;
const homeNodeId = `aimeat-fake-home-ns-${stamp}`;

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

/** The home node: one door, the signed attestation register-login.ts verifies. It vouches for any
 *  name it is asked about, so a second visitor with a name no local account has is the control. */
function startHomeNode(): Promise<{ server: Server; url: string }> {
    const server = createServer((req, res) => {
        void (async () => {
            if (req.method === 'POST' && req.url === '/v1/federation/auth/verify') {
                const who = /"username"\s*:\s*"([^"]+)"/.exec(await readBody(req))?.[1] ?? namesake;
                const payload = {
                    verified: true,
                    ghii: `${who}@${homeNodeId}`,
                    display_name: 'A visitor who shares a local name',
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

async function sendDm(fromToken: string, to: string, body: string): Promise<{ id: string; conversationId: string }> {
    const r = await json('/v1/messages', as(fromToken, { method: 'POST', body: JSON.stringify({ to, body }) }));
    assert(r.status === 201, `send ${r.status}: ${JSON.stringify(r.body)}`);
    return { id: r.body.data.message.id, conversationId: r.body.data.message.conversationId };
}

console.log('\n=== A visitor from another node and the local account that shares their name ===\n');

let operator = { ghii: '', token: '' };
let alice = { ghii: '', token: '' };   // the local namesake
let bob = { ghii: '', token: '' };
let fedToken = '';
let fromBob = { id: '', conversationId: '' };
let fromCarol = { id: '', conversationId: '' };

async function run() {
    await test('Setup: an operator, the local namesake and two correspondents; a home node on loopback', async () => {
        operator = await registerOwner(operatorName);
        assert((claims(operator.token).roles ?? []).includes('operator'), 'this suite needs to be the first owner on a freshly deleted database');
        alice = await registerOwner(namesake);
        bob = await registerOwner(bobName);
        const carol = await registerOwner(carolName);
        fromBob = await sendDm(bob.token, alice.ghii, `bob to the local alice ${stamp}`);
        fromCarol = await sendDm(carol.token, alice.ghii, `carol to the local alice ${stamp}`);

        homeKeys = await newKeyPair();
        const started = await startHomeNode();
        home = started.server;
        homeUrl = started.url;
        const reg = await json('/v1/federation/peers', as(operator.token, { method: 'POST', body: JSON.stringify({ node_id: homeNodeId, url: homeUrl, public_key: homeKeys.publicKey }) }));
        assert(reg.status === 201, `peer register: ${reg.status} ${JSON.stringify(reg.body)}`);
        const act = await json(`/v1/federation/peers/${homeNodeId}`, as(operator.token, { method: 'PUT', body: JSON.stringify({ status: 'active' }) }));
        assert(act.status === 200, `peer activate: ${act.status} ${JSON.stringify(act.body)}`);
    });

    await test('The visitor signs in from the home node as a visitor: its home GHII, no local role', async () => {
        // Until 2026-09-24 the session carried the LOCAL name (the bare local part) and roles
        // ['owner'], which is the whole of this suite's subject. It is named by its home node now.
        const r = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: `${namesake}@${homeNodeId}`, password: 'the-home-node-decides' }) });
        assert(r.status === 200, `federated login: ${r.status} ${JSON.stringify(r.body)}`);
        fedToken = r.body.data.token;
        const c = claims(fedToken);
        assert(c.federated === true && c.owner === `${namesake}@${homeNodeId}` && JSON.stringify(c.roles) === '["federated"]',
            `the session this suite is about: ${JSON.stringify({ federated: c.federated, owner: c.owner, roles: c.roles })}`);
    });

    // ── The identity itself. Everything below follows from this one answer. ──
    await test('The visitor IS NOT the local namesake: their identity carries their HOME node', async () => {
        const me = await json('/v1/ghii/me', as(fedToken));
        const seen = me.body?.data?.ghii ?? '';
        assert(seen !== `${namesake}@${NODE_ID}`,
            `the visitor was handed the LOCAL account's identity: ${seen}`);
        assert(me.status === 404 || String(seen).endsWith(`@${homeNodeId}`),
            `a visitor is their home GHII or nothing here, got ${me.status} ${JSON.stringify(me.body?.data ?? me.body?.error).slice(0, 200)}`);
    });

    await test('GET /v1/owners/:name gives the visitor the namesake\'s public card, never its roles or agent roster', async () => {
        // "Is this you" was answered by comparing the session's owner NAME with the account, so a
        // visitor from another node was the local namesake at this door and saw who the operators are
        // and every agent GAII the account holds. Found 2026-09-13 reading the §83 shape door by door.
        const self = await json(`/v1/owners/${namesake}`, as(alice.token));
        assert(self.status === 200 && Array.isArray(self.body.data.roles) && Array.isArray(self.body.data.agents),
            `positive control: the local account sees its own roles and roster: ${JSON.stringify(self.body.data)}`);
        const seen = await json(`/v1/owners/${namesake}`, as(fedToken));
        assert(seen.status === 200, `the public card is public: ${seen.status}`);
        assert(seen.body.data.roles === undefined && seen.body.data.agents === undefined,
            `the visitor was shown the local account's roles or agents: ${JSON.stringify(seen.body.data)}`);
    });

    await test('The visitor cannot read the local namesake\'s PRIVATE memory', async () => {
        const w = await json('/v1/memory', as(alice.token, { method: 'POST', body: JSON.stringify({ key: 'namesake.private', value: { secret: `alice-${stamp}` }, visibility: 'private' }) }));
        assert(w.status === 201, `setup: the local account writes its own private record: ${w.status} ${JSON.stringify(w.body)}`);
        for (const path of ['/v1/memory/namesake.private', '/v1/memory/namesake.private?owner_scope=true']) {
            const r = await json(path, as(fedToken));
            const leaked = JSON.stringify(r.body?.data?.value ?? '');
            assert(!leaked.includes(`alice-${stamp}`),
                `the visitor read the local account's private memory via ${path}: ${r.status} ${leaked}`);
        }
        for (const path of ['/v1/memory', '/v1/memory?owner_scope=true', '/v1/memory?prefix=namesake.']) {
            const l = await json(path, as(fedToken));
            const seen = JSON.stringify(l.body?.data ?? l.body ?? '');
            assert(l.status < 500, `${path} broke for the visitor: ${l.status} ${seen.slice(0, 300)}`);
            assert(!seen.includes('namesake.private'), `the visitor listed the local account's keys via ${path}: ${seen.slice(0, 300)}`);
        }
    });

    await test('THE LEAK: the export, bundle, agent export and apps backup doors refuse the visitor', async () => {
        // These doors read the bare owner NAME (listOwnerScope, getAgentsByOwner, agent.owner), which
        // a federated session shares with the local account. The export handed the visitor every
        // record the namesake owns, private ones included.
        const ag = await json('/v1/agents', as(alice.token, { method: 'POST', body: JSON.stringify({ name: 'nsagent', owner: namesake, capabilities: ['social'] }) }));
        assert(ag.status === 201, `setup: the namesake's agent: ${ag.status} ${JSON.stringify(ag.body?.error)}`);
        const agentGaii = ag.body.data.agent.gaii as string;
        const doors: Array<[string, string, RequestInit]> = [
            ['GET /v1/memory/export', '/v1/memory/export', {}],
            ['POST /v1/memory/bundle', '/v1/memory/bundle', { method: 'POST', body: JSON.stringify({ items: [{ kind: 'memory', key: 'namesake.private', owner_gaii: alice.ghii }] }) }],
            ['POST /v1/agents/:gaii/export', `/v1/agents/${encodeURIComponent(agentGaii)}/export`, { method: 'POST' }],
            ['GET /v1/apps/backup', '/v1/apps/backup', {}],
        ];
        for (const [label, path, init] of doors) {
            const r = await json(path, as(fedToken, init));
            assert(r.status === 403, `${label} did not refuse the visitor: ${r.status}`);
            assert(!JSON.stringify(r.body ?? '').includes(`alice-${stamp}`), `${label} handed over the namesake's private record`);
        }
        const own = await json('/v1/memory/export', as(alice.token));
        assert(own.status === 200 && JSON.stringify(own.body).includes(`alice-${stamp}`), `positive control: the local account exports its own memory: ${own.status}`);
    });

    await test('THE ACCOUNT GATES: a federated session is not a local owner (rekey, passkey setup, the home step)', async () => {
        // The September remediation added requireLocalSession door by door, but left the GATES that
        // decide "is this an owner in person" — requireRole('owner'), requireOwnerPrincipal and
        // requireOwnerSession — admitting a federated session, whose role list is ['owner']. So every
        // owner door the door-by-door sweep did not name was still open to the namesake's visitor.
        // Three doors, one per gate. Each was proved handing the visitor the local account on the
        // source (secaudit 2026-09: A3-1, A3-3, A10-1).
        const made = await json('/v1/agents', as(alice.token, {
            method: 'POST', body: JSON.stringify({ name: `gate${stamp}`, owner: namesake, capabilities: ['*'] }),
        }));
        assert(made.status === 201, `setup: the namesake's agent: ${made.status} ${JSON.stringify(made.body?.error)}`);
        const g = made.body.data.agent.gaii as string;
        const before = await json(`/v1/agents/${encodeURIComponent(g)}`, as(alice.token));
        assert(before.status === 200, `setup: read the namesake's agent: ${before.status}`);
        const keyBefore = before.body.data.public_key as string;

        // requireRole('owner') — POST /v1/agents/:gaii/rekey. Currently 200, returning the local
        // agent's NEW private key to the visitor and invalidating the real owner's tokens.
        const rekey = await json(`/v1/agents/${encodeURIComponent(g)}/rekey`, as(fedToken, { method: 'POST' }));
        assert(rekey.status === 403, `rekey admitted the visitor: ${rekey.status} ${JSON.stringify(rekey.body?.data ?? rekey.body?.error).slice(0, 200)}`);

        // requireOwnerPrincipal — POST /v1/ghii/passkeys/register/options. Currently 200, letting the
        // visitor register their OWN authenticator against the local namesake's account.
        const passkey = await json('/v1/ghii/passkeys/register/options', as(fedToken, { method: 'POST', body: JSON.stringify({}) }));
        assert(passkey.status === 403, `passkey register admitted the visitor: ${passkey.status}`);

        // requireOwnerSession — GET /v1/home/state. Currently 200, the namesake's own home.
        const home = await json('/v1/home/state', as(fedToken));
        assert(home.status === 403, `the home step admitted the visitor: ${home.status}`);

        // The local agent's key is untouched: the visitor never rotated it.
        const seen = await json(`/v1/agents/${encodeURIComponent(g)}`, as(alice.token));
        assert(seen.status === 200 && seen.body.data.public_key === keyBefore,
            `the visitor rotated the local agent's key: ${seen.status} ${seen.body?.data?.public_key === keyBefore ? 'same' : 'CHANGED'}`);

        // Positive control: the account holder in person still passes every one of these gates.
        const ownRekey = await json(`/v1/agents/${encodeURIComponent(g)}/rekey`, as(alice.token, { method: 'POST' }));
        assert(ownRekey.status === 200, `positive control: the namesake cannot rekey her own agent: ${ownRekey.status} ${JSON.stringify(ownRekey.body?.error)}`);
        const ownHome = await json('/v1/home/state', as(alice.token));
        assert(ownHome.status === 200, `positive control: the namesake's own home step: ${ownHome.status}`);
    });

    // EVERY GET DOOR THE CONTRACT NAMES, NOT A HAND-PICKED LIST. Each September sweep named the doors
    // it had found and left the ones it had not: after the gates were closed, the agent roster, the
    // home feed, the chat instances and an app's member roster still answered the visitor with the
    // namesake's own data, because they sit behind requireAuth or a scope a visitor holds and key on
    // the session's owner NAME (secaudit 2026-09: A3-1, A6-4). So every GET door in openapi.yaml is
    // asked, with the namesake's data in place: a visitor named like the local account must get what
    // a visitor with a fresh name gets.
    await test('EVERY GET DOOR: the visitor named like the local account gets a stranger\'s answer, never hers', async () => {
        const strangerName = `fednsstranger${stamp}`;
        const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: `${strangerName}@${homeNodeId}`, password: 'the-home-node-decides' }) });
        assert(login.status === 200, `the control visitor's login: ${login.status} ${JSON.stringify(login.body?.error)}`);
        const strangerToken = login.body.data.token as string;

        const agentName = `sweep${stamp}`;
        const made = await json('/v1/agents', as(alice.token, { method: 'POST', body: JSON.stringify({ name: agentName, owner: namesake, capabilities: ['*'] }) }));
        assert(made.status === 201, `setup: the namesake's agent: ${made.status} ${JSON.stringify(made.body?.error)}`);
        const filename = `fedns-${stamp}.html`;
        const app = await json('/v1/apps', as(alice.token, { method: 'POST', body: JSON.stringify({
            filename, name: 'The namesake\'s app', description: 'Gives the app doors a path to fill', category: 'utility',
            content: Buffer.from('<!DOCTYPE html><html><body>the local alice</body></html>').toString('base64'),
        }) }));
        assert(app.status === 201, `setup: the namesake's app: ${app.status} ${JSON.stringify(app.body?.error)}`);

        const fill: Record<string, string> = {
            owner: namesake, name: namesake, username: namesake, ownerName: namesake,
            ghii: alice.ghii, gaii: made.body.data.agent.gaii as string, agent: agentName, agentName,
            filename, app: filename, appId: `${namesake}/${filename}`,
        };
        const spec = parseYaml(readFileSync(new URL('../../openapi.yaml', import.meta.url), 'utf8')) as { paths: Record<string, Record<string, unknown>> };
        const skip = /logout|revoke|signout|stream|events|sse|\/ws\b|download|callback|authorize|verify|confirm|unsubscribe/i;
        const names: Array<[string, string]> = [[`${namesake}@${homeNodeId}`, '<visitor>'], [`${strangerName}@${homeNodeId}`, '<visitor>'], [namesake, '<name>'], [strangerName, '<name>']];
        // What moves between two asks by itself is no answer to who asked: the envelope's timestamp and
        // request id, any datetime, and the process figures /v1/health reports.
        const norm = (s: string) => names.reduce((t, [from, to]) => t.split(from).join(to), s)
            .replace(/"timestamp":"[^"]*"|"request_id":"[^"]*"/g, '').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'T')
            .replace(/"(uptime_seconds|memory_mb)":\d+/g, '');
        const get = async (path: string, token: string): Promise<{ status: number; body: string }> => {
            const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual', signal: AbortSignal.timeout(10_000) })
                .catch((err: unknown) => ({ status: 0, text: async () => String(err) }));
            return { status: r.status, body: norm(await r.text()) };
        };
        const leaks: string[] = [];
        let asked = 0;
        for (const [route, ops] of Object.entries(spec.paths)) {
            if (!ops.get || skip.test(route)) continue;
            let fillable = true;
            const path = route.replace(/\{([^}]+)\}/g, (_, k: string) => {
                if (fill[k]) return encodeURIComponent(fill[k]);
                fillable = false;
                return '_';
            });
            if (!fillable) continue;
            asked++;
            const [visitor, own, stranger] = await Promise.all([get(path, fedToken), get(path, alice.token), get(path, strangerToken)]);
            if (visitor.status === 0 || visitor.status >= 300) continue;
            if (stranger.status >= 400) leaks.push(`GET ${route}: admitted the namesake's visitor (${visitor.status}) where a stranger gets ${stranger.status}`);
            else if (visitor.body === own.body && own.body !== stranger.body) leaks.push(`GET ${route}: answered the visitor with the namesake's own data`);
        }
        assert(asked > 100, `the sweep reached only ${asked} doors; the contract or the fill list is wrong`);
        assert(leaks.length === 0, `${leaks.length} door(s) treated the visitor as the local account:\n      ${leaks.join('\n      ')}`);
    });

    // THE DOORS THAT ASKED "IS THIS AN OWNER" OF THE ROLE ALONE, with no gate in front: the A2A
    // account road, the AI-spend gate, device authorization's same-owner shortcut and the
    // node-wide schema door. Each admitted the visitor on roles:['owner'] (secaudit 2026-09: A4-1,
    // A4-2, A1-1).
    await test('The A2A account road refuses the visitor: a visitor hires through the stranger road', async () => {
        const r = await json(`/v1/a2a/${encodeURIComponent(namesake)}/nsagent`, as(fedToken, {
            method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ListTasks', params: {} }),
        }));
        assert(r.status === 403, `the account road admitted the visitor: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    });

    await test('The AI doors ask the visitor for ai:use, as they ask any scoped principal', async () => {
        for (const path of ['/v1/ai/jobs', '/v1/ai/decide/settings']) {
            const r = await json(path, as(fedToken));
            assert(r.status === 403, `${path} admitted a visitor that holds no ai:use: ${r.status}`);
        }
        const own = await json('/v1/ai/jobs', as(alice.token));
        assert(own.status === 200, `positive control: the account holder's own AI jobs: ${own.status}`);
    });

    await test('A device authorization the visitor starts for the namesake waits for her; it is not auto-approved', async () => {
        const r = await json('/v1/agents/device-authorize', as(fedToken, {
            method: 'POST', body: JSON.stringify({ agent_name: `fedda${stamp}`, owner: namesake }),
        }));
        assert(r.status === 200, `device-authorize: ${r.status} ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.auto_approved === false,
            `the visitor made an agent in the local account with no approval: ${JSON.stringify(r.body.data).slice(0, 200)}`);
    });

    await test('The node-wide schema door refuses the visitor', async () => {
        // A schema governs every write that matches its key pattern, whoever writes, so a visitor
        // setting one reaches the local accounts' writes.
        const r = await json(`/v1/memory/${encodeURIComponent(`fedns.schema.${stamp}`)}/schema`, as(fedToken, {
            method: 'PUT', body: JSON.stringify({ schema: { type: 'object' }, apply_to: 'prefix', schema_mode: 'strict' }),
        }));
        assert(r.status === 403, `the visitor set a node-wide schema: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data).slice(0, 200)}`);
    });

    await test('A visitor\'s own write lands in THEIR namespace, never the namesake\'s', async () => {
        const vw = await json('/v1/memory', as(fedToken, { method: 'POST', body: JSON.stringify({ key: 'namesake.visitor', value: { by: `visitor-${stamp}` }, visibility: 'private' }) }));
        // The write is refused (no memory:write in this node's federated scopes) or it is stored
        // under the visitor's HOME identity. What it may never be is the namesake's namespace.
        if (vw.status === 201) {
            const landed = vw.body?.data?.owner_gaii ?? '';
            assert(landed !== `${namesake}@${NODE_ID}`, `the visitor wrote into the local account's namespace: ${landed}`);
        }
        const seen = await json('/v1/memory/namesake.visitor', as(alice.token));
        assert(!JSON.stringify(seen.body?.data?.value ?? '').includes(`visitor-${stamp}`),
            `the local account can see the visitor's write in its own namespace: ${JSON.stringify(seen.body?.data)}`);
    });

    await test('The local account itself still reads its own mailbox', async () => {
        const reqs = await json('/v1/messages/contacts', as(alice.token));
        assert(reqs.status === 200, `the namesake's own contacts: ${reqs.status}`);
        const inbox = await json('/v1/messages/overview', as(alice.token));
        assert(inbox.status === 200, `the namesake's own overview: ${inbox.status}`);
    });

    // Every door in routes/messages.ts, as the visitor. Each is refused with 403, and the ones that
    // would change something are checked afterwards from the local account's own session.
    const reads: Array<[string, () => string]> = [
        ['GET /v1/messages/requests', () => '/v1/messages/requests'],
        ['GET /v1/messages/contacts', () => '/v1/messages/contacts'],
        ['GET /v1/messages/inbox', () => '/v1/messages/inbox'],
        ['GET /v1/messages/conversations', () => '/v1/messages/conversations'],
        ['GET /v1/messages/overview', () => '/v1/messages/overview'],
        ['GET /v1/messages/conversations/:id', () => `/v1/messages/conversations/${encodeURIComponent(fromBob.conversationId)}`],
        ['GET /v1/messages/agent-inbox', () => '/v1/messages/agent-inbox'],
        ['GET /v1/messages/agent-thread/:id', () => `/v1/messages/agent-thread/${encodeURIComponent(fromBob.conversationId)}`],
        ['GET /v1/messages/broadcast/:id', () => '/v1/messages/broadcast/does-not-matter'],
    ];
    for (const [label, path] of reads) {
        await test(`${label} refuses the visitor`, async () => {
            const r = await json(path(), as(fedToken));
            assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`);
        });
    }

    await test('POST accept / block, and the local contact states do not move', async () => {
        const before = await json('/v1/messages/contacts', as(alice.token));
        const accept = await json(`/v1/messages/requests/${encodeURIComponent(bob.ghii)}/accept`, as(fedToken, { method: 'POST' }));
        assert(accept.status === 403, `accept: expected 403, got ${accept.status}: ${JSON.stringify(accept.body).slice(0, 300)}`);
        const block = await json(`/v1/messages/contacts/${encodeURIComponent(bob.ghii)}/block`, as(fedToken, { method: 'POST' }));
        assert(block.status === 403, `block: expected 403, got ${block.status}: ${JSON.stringify(block.body).slice(0, 300)}`);
        const after = await json('/v1/messages/contacts', as(alice.token));
        assert(JSON.stringify(after.body.data.contacts) === JSON.stringify(before.body.data.contacts),
            `the visitor changed the local account's contacts: ${JSON.stringify(before.body.data.contacts)} → ${JSON.stringify(after.body.data.contacts)}`);
    });

    await test('Marking read, one message or a whole thread, is refused and nothing is marked', async () => {
        const one = await json(`/v1/messages/${encodeURIComponent(fromCarol.id)}/read`, as(fedToken, { method: 'PATCH' }));
        assert(one.status === 403, `PATCH read: expected 403, got ${one.status}: ${JSON.stringify(one.body).slice(0, 300)}`);
        const thread = await json(`/v1/messages/conversations/${encodeURIComponent(fromBob.conversationId)}/read`, as(fedToken, { method: 'POST' }));
        assert(thread.status === 403, `POST thread read: expected 403, got ${thread.status}: ${JSON.stringify(thread.body).slice(0, 300)}`);
        for (const convo of [fromBob.conversationId, fromCarol.conversationId]) {
            const own = await json(`/v1/messages/conversations/${encodeURIComponent(convo)}`, as(alice.token));
            const inbound = (own.body.data.messages ?? []).filter((m: any) => m.direction === 'inbound');
            assert(inbound.length > 0, `setup: the local account should hold an inbound message in ${convo}`);
            assert(inbound.every((m: any) => !m.readAt), `the visitor marked the local account's messages read: ${JSON.stringify(inbound.map((m: any) => m.readAt))}`);
        }
    });

    await test('The address book doors (/v1/contacts) refuse the visitor, and nothing is saved', async () => {
        const list = await json('/v1/contacts', as(fedToken));
        assert(list.status === 403, `GET /v1/contacts: expected 403, got ${list.status}: ${JSON.stringify(list.body).slice(0, 300)}`);
        const save = await json('/v1/contacts', as(fedToken, { method: 'POST', body: JSON.stringify({ identity: bob.ghii, name: 'saved by the visitor' }) }));
        assert(save.status === 403, `POST /v1/contacts: expected 403, got ${save.status}: ${JSON.stringify(save.body).slice(0, 300)}`);
        const invite = await json('/v1/contacts/invite', as(fedToken, { method: 'POST', body: JSON.stringify({ email: 'nobody@example.invalid' }) }));
        assert(invite.status === 403, `POST /v1/contacts/invite: expected 403, got ${invite.status}`);
        const own = await json('/v1/contacts', as(alice.token));
        assert(own.status === 200, `the namesake's own address book: ${own.status}`);
        assert(!JSON.stringify(own.body.data).includes('saved by the visitor'), 'the visitor saved a contact into the local account');
    });

    await test('Transcribe, delete, send and broadcast refuse the visitor', async () => {
        const tr = await json(`/v1/messages/${encodeURIComponent(fromBob.id)}/attachments/none/transcribe`, as(fedToken, { method: 'POST', body: '{}' }));
        assert(tr.status === 403, `transcribe: expected 403, got ${tr.status}: ${JSON.stringify(tr.body).slice(0, 300)}`);
        const del = await json(`/v1/messages/${encodeURIComponent(fromBob.id)}`, as(fedToken, { method: 'DELETE' }));
        assert(del.status === 403, `delete: expected 403, got ${del.status}`);
        const sendAs = await json('/v1/messages', as(fedToken, { method: 'POST', body: JSON.stringify({ to: bob.ghii, body: 'not from the local alice' }) }));
        assert(sendAs.status === 403, `send: expected 403, got ${sendAs.status}`);
        const broad = await json('/v1/messages/broadcast', as(fedToken, { method: 'POST', body: JSON.stringify({ to: [bob.ghii], body: 'nor this' }) }));
        assert(broad.status === 403, `broadcast: expected 403, got ${broad.status}`);
    });

    await test('The refusal names the reason: a session from another node has no mailbox here', async () => {
        const r = await json('/v1/messages/requests', as(fedToken));
        assert(r.body?.error?.code === 'FORBIDDEN', `code: ${JSON.stringify(r.body?.error)}`);
    });

    // THE WORK DOORS DO NOT REFUSE — THEY ANSWER, AND THE ANSWER WAS THE NAMESAKE'S. Three of them
    // decide "is this an owner session" and then fan out over `getAgentsByOwner(req.auth.owner)`,
    // which for a visitor is the local part of THEIR name and so names the local account. inbox and
    // overview were given `&& !req.auth.federated` when that was found; /v1/work/sent was missed.
    // So this is asserted on CONTENT and not on a status code: the door answers 200 either way.
    await test("The visitor's sent work is their own, never the local namesake's", async () => {
        // An agent of alice's asks an agent of bob's for something. Both are needed: a work request
        // to yourself is refused (SELF_WORK). Without a row to find, an empty list proves nothing.
        const newAgent = async (ownerName: string, ownerTok: string, label: string) => {
            const made = await json('/v1/agents', as(ownerTok, {
                method: 'POST', body: JSON.stringify({ name: label, owner: ownerName, capabilities: ['*'], model: 'test' }),
            }));
            assert(made.status === 201, `agent ${label}: ${made.status} ${JSON.stringify(made.body?.error)}`);
            const g = made.body.data.agent.gaii as string;
            const ts = new Date().toISOString();
            const tok = await json('/v1/auth/token', {
                method: 'POST',
                body: JSON.stringify({ gaii: g, timestamp: ts, signature: await signMsg(made.body.data.private_key, g + ts) }),
            });
            assert(tok.status === 200, `agent token ${label}: ${tok.status} ${JSON.stringify(tok.body?.error)}`);
            return { gaii: g, token: tok.body.data.token as string };
        };
        const asker = await newAgent(namesake, alice.token, `fedask${stamp}`);
        const doer = await newAgent(bobName, bob.token, `feddo${stamp}`);

        const action = `fedwork-probe-${stamp}`;
        const pub = await json('/v1/actions', as(doer.token, {
            method: 'POST',
            body: JSON.stringify({
                id: action, display_name: 'Federated namesake probe', description: 'Gives /v1/work/sent a row to find',
                input_schema: { type: 'object', properties: { text: { type: 'string' } } },
                output_schema: { type: 'object', properties: { result: { type: 'string' } } },
                pricing: { base_morsels: 1 },
            }),
        }));
        assert(pub.status === 201, `publish action: ${pub.status} ${JSON.stringify(pub.body?.error)}`);

        const mint = await json('/v1/admin/mint', as(operator.token, {
            method: 'POST', body: JSON.stringify({ gaii: asker.gaii, amount: 100 }),
        }));
        assert(mint.status === 200, `mint: ${mint.status} ${JSON.stringify(mint.body?.error)}`);

        const work = await json('/v1/work', as(asker.token, {
            method: 'POST',
            body: JSON.stringify({ action_id: action, provider_gaii: doer.gaii, input: { text: 'probe' }, ttl_hours: 24 }),
        }));
        assert(work.status === 201, `work submit: ${work.status} ${JSON.stringify(work.body?.error)}`);
        const tc = work.body.data.tracking_code as string;

        // The reach of a federated session is the LOCAL operator's decision, never the home node's:
        // register-login.ts takes the scopes from this peer's row. The default set has no
        // `work:read`, so the door refuses before the handler runs and the hole is unreachable — on
        // a node whose operator never granted it. Granting it here is what puts the handler in
        // front of the visitor, which is the configuration the finding is about.
        const scoped = await json(`/v1/federation/peers/${homeNodeId}`, as(operator.token, {
            method: 'PUT', body: JSON.stringify({ federation_auth_scopes: ['memory:read', 'catalogue:read', 'work:read'] }),
        }));
        assert(scoped.status === 200, `granting the peer work:read: ${scoped.status} ${JSON.stringify(scoped.body?.error)}`);
        const relogin = await json('/v1/ghii/login', {
            method: 'POST', body: JSON.stringify({ username: `${namesake}@${homeNodeId}`, password: 'the-home-node-decides' }),
        });
        assert(relogin.status === 200, `federated re-login: ${relogin.status}`);
        const workToken = relogin.body.data.token as string;

        // The namesake sees their own, or the door would be broken in the other direction.
        const own = await json('/v1/work/sent', as(alice.token));
        assert(own.status === 200, `the namesake's own sent: ${own.status}`);
        assert((own.body.data.items as any[]).some(w => w.tracking_code === tc),
            `the namesake lost their own sent work: ${JSON.stringify(own.body.data.items).slice(0, 300)}`);

        // The visitor gets theirs, which is none: it passes the door as an outside principal holding
        // work:read, under its own home identity, and the namesake's work is not in the answer.
        for (const path of ['/v1/work/sent', '/v1/work/inbox', '/v1/work/overview']) {
            const r = await json(path, as(workToken));
            assert(r.status === 200, `${path}: ${r.status} ${JSON.stringify(r.body?.error)}`);
            assert(!JSON.stringify(r.body.data).includes(tc), `${path} handed the visitor the namesake's work`);
        }
    });

    // CORTEX WAS THE SAME NAME COMPARISON, ON THE WRITE SIDE TOO. Every ownership question in
    // services/cortex-lifecycle.ts is `ext.installedBy === caller.ownerName`, and callerOf() handed
    // it the bare owner name of a federated session — so the visitor did not merely READ the local
    // namesake's private cortexes, they owned them: update, deactivate, delete, and the namespace.
    await test("The local namesake's private cortex is not the visitor's to read or to delete", async () => {
        const cortexName = `fedns-private-${stamp}`;
        const manifest = `apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${cortexName}
  namespace: ${namesake}
  description: A private cortex of the LOCAL account
spec:
  version: "1.0.0"
  components:
    - type: lib
      name: greeter
      filename: greeter.js
      exports: [hello]
      api_surface: hello()
`;
        const install = await json('/v1/cortex', as(alice.token, {
            method: 'POST',
            body: JSON.stringify({ manifest, libs: { 'greeter.js': 'window.hello = () => "local alice only";' } }),
        }));
        assert(install.status === 201, `install: ${install.status} ${JSON.stringify(install.body?.error)}`);

        // The namesake sees it, so an empty answer below is a fence and not a missing record.
        const mine = await json('/v1/cortex', as(alice.token));
        assert((mine.body.data.extensions as any[]).some(e => e.name === cortexName),
            `the namesake lost their own cortex: ${JSON.stringify((mine.body.data.extensions as any[]).map(e => e.name))}`);

        // The same point as the work door above: what a visitor may reach is this node's decision,
        // so grant the peer the words the cortex doors ask for and put the handlers in front of it.
        const scoped = await json(`/v1/federation/peers/${homeNodeId}`, as(operator.token, {
            method: 'PUT', body: JSON.stringify({ federation_auth_scopes: ['memory:read', 'catalogue:read', 'cortex:write'] }),
        }));
        assert(scoped.status === 200, `granting the peer cortex:write: ${scoped.status} ${JSON.stringify(scoped.body?.error)}`);
        const relogin = await json('/v1/ghii/login', {
            method: 'POST', body: JSON.stringify({ username: `${namesake}@${homeNodeId}`, password: 'the-home-node-decides' }),
        });
        assert(relogin.status === 200, `federated re-login: ${relogin.status}`);
        const cortexToken = relogin.body.data.token as string;

        const enc = encodeURIComponent(cortexName);
        const listed = await json('/v1/cortex', as(cortexToken));
        assert(listed.status === 200, `the visitor's list: ${listed.status}`);
        assert(!(listed.body.data.extensions as any[]).some(e => e.name === cortexName),
            "the visitor was shown the local namesake's private cortex");

        const detail = await json(`/v1/cortex/${enc}`, as(cortexToken));
        assert(detail.status !== 200, `the visitor opened it: ${detail.status} ${JSON.stringify(detail.body?.data ?? null).slice(0, 200)}`);

        const gone = await json(`/v1/cortex/${enc}`, as(cortexToken, { method: 'DELETE' }));
        assert(gone.status !== 200 && gone.status !== 204, `the visitor deleted it: ${gone.status}`);
        const after = await json('/v1/cortex', as(alice.token));
        assert((after.body.data.extensions as any[]).some(e => e.name === cortexName),
            "the visitor's DELETE removed the namesake's cortex");
    });

    // THE ACCOUNT ITSELF. Everything above is about what a visitor may READ of the namesake's; these
    // are the doors that hand over the account. A federated login mints roles ['owner'], so
    // requireRole('owner') and even requireOwnerPrincipal() admit the visitor, and each door's own
    // check is a NAME comparison that then matches the local account. Found by the AI triage of
    // 2026-09-13, nine doors of one shape.
    await test('The visitor cannot renew their session into a LOCAL owner token', async () => {
        // The worst of them: the legacy refresh read the local account of the same name for its
        // roles and minted a token with them, carrying no `federated` marker and no federation
        // scopes. One call and the visitor WAS the local account — operator too, where it is one.
        const r = await json('/v1/auth/refresh', as(fedToken, { method: 'POST' }));
        assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    });

    await test('The visitor cannot erase or export the local namesake', async () => {
        const exported = await json(`/v1/owners/${encodeURIComponent(namesake)}/export`, as(fedToken));
        assert(exported.status === 403, `export: expected 403, got ${exported.status}`);

        const erased = await json(`/v1/owners/${encodeURIComponent(namesake)}`, as(fedToken, { method: 'DELETE' }));
        assert(erased.status === 403, `delete: expected 403, got ${erased.status}`);

        // And the account is still there, which is the assertion that matters.
        const still = await json('/v1/messages/overview', as(alice.token));
        assert(still.status === 200, `the namesake's account did not survive: ${still.status}`);
    });

    await test('The visitor cannot mint a key that creates an agent under the local account', async () => {
        // The key records `params.owner` from the caller's name, and the unauthenticated
        // /v1/agents/connect door then builds an agent under whatever account that names.
        const r = await json('/v1/auth/connectivity-key', as(fedToken, {
            method: 'POST', body: JSON.stringify({ agent_name: `fedns-intruder-${stamp}` }),
        }));
        assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    });

    await test("The visitor's file list is their own, never the local namesake's", async () => {
        // The namesake stores one first, so an empty answer below is a fence and not an empty node.
        const stored = await json('/v1/memory/files', as(alice.token, {
            method: 'POST',
            body: JSON.stringify({
                key: `fedns-private-file-${stamp}`,
                content: Buffer.from('the local alice wrote this').toString('base64'),
                mime_type: 'text/plain', visibility: 'private',
            }),
        }));
        assert(stored.status === 200 || stored.status === 201, `storing the namesake's file: ${stored.status} ${JSON.stringify(stored.body?.error)}`);
        const hers = await json('/v1/memory/files?count=true', as(alice.token));
        assert(hers.body.data.count >= 1, `the namesake cannot see her own file: ${JSON.stringify(hers.body?.data)}`);

        const scoped = await json(`/v1/federation/peers/${homeNodeId}`, as(operator.token, {
            method: 'PUT', body: JSON.stringify({ federation_auth_scopes: ['memory:read', 'catalogue:read', 'storage:read'] }),
        }));
        assert(scoped.status === 200, `granting the peer storage:read: ${scoped.status}`);
        const relogin = await json('/v1/ghii/login', {
            method: 'POST', body: JSON.stringify({ username: `${namesake}@${homeNodeId}`, password: 'the-home-node-decides' }),
        });
        assert(relogin.status === 200, `federated re-login: ${relogin.status}`);

        const r = await json('/v1/memory/files?count=true', as(relogin.body.data.token as string));
        // Either refused outright or answered with the visitor's own (empty) list — never the
        // namesake's. What must not happen is the owner branch running for a visitor.
        if (r.status === 200) {
            assert(r.body.data.count === 0, `the visitor was handed ${r.body.data.count} of the namesake's files`);
        }
    });
}

try {
    await run();
} finally {
    if (home) await new Promise<void>(r => home!.close(() => r()));
}
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
