/**
 * @file test/e2e-classification-containers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the classification of containers (plan doc-mvdipuyqraas, L1): an organism, a
 *   workspace, a board and an app carry a classification, and content reads as its EFFECTIVE one,
 *   the highest of its own and its containers'. Asserted over REST and the node MCP:
 *     - a workspace labelled Confidential makes its public record Confidential (`effective.from` is
 *       `workspace`), and an organism's label reaches every workspace in it (`organism`);
 *     - the federation exit (the genesis memory read, as an approved genesis peer) keeps a public
 *       record of a Confidential workspace on this node, and serves it before;
 *     - a container label hidden from AI hides the workspace's records from the owner's agent, and
 *       its reader audience hides them from a member it leaves out; the person in it still reads them;
 *     - a board's label reaches its posts (the agent reads none once it hides them from AI), and an
 *       app's label reaches the app's data (`from` is `app`);
 *     - the refusals: a member who is not the creator or an admin sets neither the organism's nor a
 *       workspace's label (403 NOT_ALLOWED), a non-member gets 404, another owner sets no board's label
 *       (403 on a board everyone can read), an AI's lowering of a container label waits and changes
 *       nothing, a person lowering it needs a reason and then it applies;
 *     - a detection rule written for boards raises a board by its name; the explorer lists containers.
 *   The operator (the suite's first account) turns classification on for every owner and off at the end.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-classification-containers
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L1.1-L1.6).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession } from './helpers/mcp-session.js';
import { genesisReadHeaders } from './helpers/genesis-read-headers.js';
import { generateKeyPair } from '../src/auth/keypair.js';
import * as ed from '@noble/ed25519';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
/** One request. `method` is always written out by the caller, so a refusal test names what it refuses. */
async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Body }> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
const labelOf = (token: string, target: Record<string, string>) => call('GET', `/v1/classification/label?${q(target)}`, token);
const setLabelAs = (token: string, target: Record<string, string>, label: string, extra: Record<string, unknown> = {}) =>
    call('PUT', '/v1/classification/label', token, { ...target, label, ...extra });

console.log('\n=== Classification of containers and the effective label (plan doc-mvdipuyqraas, L1) ===\n');

let op!: RegisteredOwner, alice!: RegisteredOwner, bob!: RegisteredOwner;
let bot!: McpAgent, botMcp!: McpSession;
let orgId = '', ws1 = '', ws2 = '';
let sharedBoard = '', publicBoard = '';
const ORG = () => ({ kind: 'organism', organism_id: orgId });
const WS = (ws: string) => ({ kind: 'workspace', organism_id: orgId, ws });
const REC = (ws: string, id: string) => ({ kind: 'memory', key: `organism.${orgId}.w.${ws}.shared.items.${id}` });
const MANIFEST = (name: string) => ({
    manifestVersion: '1', name, kind: 'project',
    objectTypes: [{ name: 'item', namespace: 'shared.items', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:item@1' }],
});
const recordsOf = async (token: string, ws: string): Promise<string[]> => {
    const r = await call('GET', `/v1/organisms/${orgId}/workspace/records?${q({ ws, space: 'item' })}`, token);
    assert(r.status === 200, `records of ${ws}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.records as Body[]).map(x => x.id as string);
};
const setSwitch = (mode: string) => call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.mode', value: mode }] });

await test('Setup: the operator turns classification on for every owner; alice keeps an organism with two workspaces that bob joins', async () => {
    op = await registerOwner(BASE, `clc${'op'}${stamp}`);
    alice = await registerOwner(BASE, `clcalice${stamp}`);
    bob = await registerOwner(BASE, `clcbob${stamp}`);
    const on = await setSwitch('all');
    assert(on.status === 200, `switch all: ${on.status} ${JSON.stringify(on.body?.error)}`);
    const o = await call('POST', '/v1/organisms', alice.token, { name: `Cls Containers ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' });
    assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const j = await call('POST', `/v1/organisms/${orgId}/join`, bob.token, {});
    assert(j.status === 201 && j.body.data.status === 'joined', `bob joins: ${j.status} ${JSON.stringify(j.body)}`);
    for (const [name, set] of [['Plans', (w: string) => { ws1 = w; }], ['Notes', (w: string) => { ws2 = w; }]] as const) {
        const w = await call('POST', `/v1/organisms/${orgId}/workspaces`, alice.token, { name, manifest: MANIFEST(name) });
        assert(w.status === 201 && typeof w.body?.data?.ws === 'string', `workspace ${name}: ${w.status} ${JSON.stringify(w.body?.error)}`);
        set(w.body.data.ws);
        // bob reads the workspace, so a refusal below is about its classification, not about his access.
        const g = await call('POST', `/v1/organisms/${orgId}/workspace-access/grant`, alice.token, { ws: w.body.data.ws, grantee: bob.name, role: 'viewer' });
        assert(g.status === 200, `bob reads ${name}: ${g.status} ${JSON.stringify(g.body?.error)}`);
    }
    for (const [ws, id] of [[ws1, 'r1'], [ws2, 'r2']]) {
        const p = await call('POST', `/v1/organisms/${orgId}/workspace/records/publish`, alice.token, { ws, namespace: 'shared.items', records: [{ id, value: { name: `record ${id}` } }] });
        assert(p.status === 200 && p.body.data.published === 1, `publish ${id}: ${p.status} ${JSON.stringify(p.body?.data ?? p.body?.error)}`);
    }
    bot = await makeAgent(BASE, alice, ['*'], `clcbot${stamp % 100000}`);
    botMcp = await openSession(BASE, bot.token, 'classification containers');
});

// ─── 1. The effective label ───
console.log('\nThe effective label: a workspace\'s and an organism\'s classification is the floor for their content');

await test('WORKSPACE: a public record of a workspace labelled Confidential reads Confidential, from the workspace', async () => {
    const own = await setLabelAs(alice.token, REC(ws1, 'r1'), 'julkinen');
    assert(own.status === 200 && own.body.data.applied === true, `own label: ${own.status} ${JSON.stringify(own.body?.error ?? own.body?.data)}`);
    const before = await labelOf(alice.token, REC(ws1, 'r1'));
    assert(before.status === 200 && before.body.data.effective?.label === 'julkinen' && before.body.data.effective?.from === 'own',
        `before: ${before.status} ${JSON.stringify(before.body?.data?.effective ?? before.body?.error)}`);
    const set = await setLabelAs(alice.token, WS(ws1), 'luottamuksellinen');
    assert(set.status === 200 && set.body.data.applied === true && set.body.data.locked === true, `workspace label: ${set.status} ${JSON.stringify(set.body?.error ?? set.body?.data)}`);
    const after = await labelOf(alice.token, REC(ws1, 'r1'));
    assert(after.status === 200 && after.body.data.label === 'julkinen', `own stays: ${JSON.stringify(after.body?.data?.label)}`);
    assert(after.body.data.effective?.label === 'luottamuksellinen' && after.body.data.effective?.from === 'workspace',
        `effective: ${JSON.stringify(after.body?.data?.effective)}`);
    const mcp = await callTool(botMcp, 'aimeat_classification', { action: 'get', ...REC(ws1, 'r1') });
    assert(!mcp.isError && mcp.data?.effective?.from === 'workspace', `node MCP: ${mcp.text.slice(0, 300)}`);
});

// ─── 2. The federation exit ───
console.log('\nThe federation exit: a public record of a Confidential workspace stays on this node');

const genesisPeerNodeId = `aimeat-clcpeer-${stamp % 100000}`;
const genesisPriv = ed.utils.randomSecretKey();
const genesisPrivB64 = Buffer.from(genesisPriv).toString('base64');
const genesisRead = async (gaii: string, key: string) =>
    call('GET', `/v1/federation/genesis-memory-read?${q({ gaii, key })}`, undefined, undefined, await genesisReadHeaders(genesisPrivB64, genesisPeerNodeId, NODE_ID, { gaii, key }));
const FED = (ws: string) => `organism.${orgId}.w.${ws}.shared.items.fed`;

await test('FEDERATION: a peer is served the public record of an unlabelled workspace and not the one of a Confidential workspace', async () => {
    const made = await call('POST', '/v1/federation/genesis-peer', op.token, {
        genesisNodeId: genesisPeerNodeId, genesisUrl: 'http://127.0.0.1:9', publicKey: Buffer.from(await ed.getPublicKeyAsync(genesisPriv)).toString('base64'),
    });
    assert(made.status === 201, `genesis peering: ${made.status} ${JSON.stringify(made.body?.error)}`);
    const ok = await call('PUT', `/v1/federation/genesis-peer/${made.body.data.peer?.id ?? made.body.data.id}/approve`, op.token);
    assert(ok.status === 200, `approve: ${ok.status} ${JSON.stringify(ok.body?.error)}`);
    for (const ws of [ws1, ws2]) {
        const w = await call('POST', '/v1/memory', alice.token, { key: FED(ws), value: { note: 'meant for the peer' }, visibility: 'public' });
        assert(w.status === 201 || w.status === 200, `write ${ws}: ${w.status} ${JSON.stringify(w.body?.error)}`);
        const back = await call('GET', `/v1/memory/${encodeURIComponent(FED(ws))}`, alice.token);
        assert(back.status === 200 && back.body.data.visibility === 'public', `stored public ${ws}: ${back.status} ${JSON.stringify(back.body?.data ?? back.body?.error).slice(0, 300)}`);
        const l = await setLabelAs(alice.token, { kind: 'memory', key: FED(ws) }, 'julkinen');
        assert(l.status === 200, `public label ${ws}: ${l.status} ${JSON.stringify(l.body?.error)}`);
    }
    const consent = await call('POST', '/v1/consent', alice.token, { data_pattern: `organism.${orgId}.**`, recipient: '*', purpose: 'containers federation probe', scope: 'federation' });
    assert(consent.status === 200 || consent.status === 201, `consent: ${consent.status} ${JSON.stringify(consent.body?.error)}`);
    const open = await genesisRead(alice.ghii, FED(ws2));
    assert(open.status === 200 && open.body.data.total === 1, `POSITIVE CONTROL, the record of the unlabelled workspace leaves: ${open.status} ${JSON.stringify(open.body?.data ?? open.body?.error)}`);
    const kept = await genesisRead(alice.ghii, FED(ws1));
    assert(kept.status === 200 && kept.body.data.total === 0 && kept.body.data.withheld?.count === 1,
        `the record of the Confidential workspace stays: ${kept.status} ${JSON.stringify(kept.body?.data ?? kept.body?.error)}`);
});

await test('ORGANISM: the organism\'s label reaches every workspace in it, and the peer is served nothing more', async () => {
    const set = await setLabelAs(alice.token, ORG(), 'erittain-luottamuksellinen');
    assert(set.status === 200 && set.body.data.applied === true, `organism label: ${set.status} ${JSON.stringify(set.body?.error ?? set.body?.data)}`);
    for (const t of [REC(ws1, 'r1'), REC(ws2, 'r2'), WS(ws2)]) {
        const r = await labelOf(alice.token, t);
        assert(r.status === 200 && r.body.data.effective?.label === 'erittain-luottamuksellinen' && r.body.data.effective?.from === 'organism',
            `${JSON.stringify(t)}: ${r.status} ${JSON.stringify(r.body?.data?.effective ?? r.body?.error)}`);
    }
    const memberReads = await labelOf(bob.token, ORG());
    assert(memberReads.status === 200 && memberReads.body.data.label === 'erittain-luottamuksellinen', `a member reads it: ${memberReads.status}`);
    const gone = await genesisRead(alice.ghii, FED(ws2));
    assert(gone.status === 200 && gone.body.data.total === 0, `the unlabelled workspace's record stays too: ${JSON.stringify(gone.body?.data)}`);
});

// ─── 3. Who may set a container's label ───
console.log('\nWho: the organism\'s creator or an admin, a board\'s owner');

await test('DENIAL: a member who is not the creator or an admin sets neither the organism\'s nor a workspace\'s label (403); a non-member gets 404', async () => {
    const org = await call('PUT', '/v1/classification/label', bob.token, { ...ORG(), label: 'julkinen', justification: 'bob tries' });
    assert(org.status === 403 && org.body?.error?.code === 'NOT_ALLOWED', `bob, the organism: ${org.status} ${JSON.stringify(org.body?.error)}`);
    const ws = await call('PUT', '/v1/classification/label', bob.token, { ...WS(ws1), label: 'julkinen', justification: 'bob tries' });
    assert(ws.status === 403 && ws.body?.error?.code === 'NOT_ALLOWED', `bob, the workspace: ${ws.status} ${JSON.stringify(ws.body?.error)}`);
    const outsider = await call('PUT', '/v1/classification/label', op.token, { ...ORG(), label: 'julkinen', justification: 'not a member' });
    assert(outsider.status === 404, `a non-member: ${outsider.status} ${JSON.stringify(outsider.body?.error)}`);
    const outsiderReads = await call('GET', `/v1/classification/label?${q(ORG())}`, op.token);
    assert(outsiderReads.status === 404, `a non-member reads: ${outsiderReads.status}`);
    const still = await labelOf(alice.token, ORG());
    assert(still.body?.data?.label === 'erittain-luottamuksellinen', `nothing changed: ${JSON.stringify(still.body?.data?.label)}`);
});

await test('DENIAL: an AI does not lower a container\'s label, over the node MCP or REST; the label stays', async () => {
    const mcp = await callTool(botMcp, 'aimeat_classification', { action: 'set', ...ORG(), label: 'julkinen', confidence: 1, reason: 'looks harmless' });
    assert(!mcp.isError && mcp.data?.applied === false && mcp.data?.label === 'erittain-luottamuksellinen' && typeof mcp.data?.pending === 'string',
        `node MCP: ${mcp.text.slice(0, 300)}`);
    const rest = await call('PUT', '/v1/classification/label', bot.token, { ...WS(ws1), label: 'julkinen', confidence: 1 });
    assert(rest.status === 200 && rest.body.data.applied === false && rest.body.data.label === 'luottamuksellinen', `REST: ${rest.status} ${JSON.stringify(rest.body?.data ?? rest.body?.error)}`);
    const still = await labelOf(alice.token, ORG());
    assert(still.body?.data?.label === 'erittain-luottamuksellinen', `the organism keeps its label: ${JSON.stringify(still.body?.data?.label)}`);
});

await test('The person lowers the organism\'s label: refused without a reason, applied with one', async () => {
    const bare = await call('PUT', '/v1/classification/label', alice.token, { ...ORG(), label: 'sisainen' });
    assert(bare.status === 400 && bare.body?.error?.code === 'JUSTIFICATION_REQUIRED', `no reason: ${bare.status} ${JSON.stringify(bare.body?.error)}`);
    const why = await call('PUT', '/v1/classification/label', alice.token, { ...ORG(), label: 'sisainen', justification: 'The organism holds only working notes now.' });
    assert(why.status === 200 && why.body.data.applied === true && why.body.data.from === 'erittain-luottamuksellinen' && why.body.data.label === 'sisainen',
        `with a reason: ${why.status} ${JSON.stringify(why.body?.data ?? why.body?.error)}`);
    const r = await labelOf(alice.token, REC(ws1, 'r1'));
    assert(r.body?.data?.effective?.label === 'luottamuksellinen' && r.body.data.effective.from === 'workspace', `the workspace decides again: ${JSON.stringify(r.body?.data?.effective)}`);
});

// ─── 4. What the reader does with a container's label ───
console.log('\nThe reader: a container label hidden from AI, and its reader audience');

await test('READER: a workspace labelled hidden from AI with an audience of alice hides its records from her agent and from bob; alice reads them', async () => {
    assert((await recordsOf(bob.token, ws2)).includes('r2'), 'POSITIVE CONTROL: bob reads r2 before');
    assert((await recordsOf(bot.token, ws2)).includes('r2'), 'POSITIVE CONTROL: the agent reads r2 before');
    const policy = await call('PUT', '/v1/classification/policy', alice.token, { level: 'organism', organism_id: orgId, policy: {
        enabled: true,
        labels: [{ id: 'johto', rank: 25, name: { en: 'Board only', fi: 'Hallitus', es: 'Junta' }, aiVisibility: 'hidden', audience: { people: [alice.name] } }],
    } });
    assert(policy.status === 200 && policy.body.data.applied === true, `organism policy: ${policy.status} ${JSON.stringify(policy.body?.error ?? policy.body?.data)}`);
    const set = await setLabelAs(alice.token, WS(ws2), 'johto');
    assert(set.status === 200 && set.body.data.applied === true, `workspace label: ${set.status} ${JSON.stringify(set.body?.error ?? set.body?.data)}`);
    assert(!(await recordsOf(bot.token, ws2)).includes('r2'), 'the agent still reads r2');
    assert(!(await recordsOf(bob.token, ws2)).includes('r2'), 'bob, outside the audience, still reads r2');
    assert((await recordsOf(alice.token, ws2)).includes('r2'), 'alice, in the audience, does not read r2');
});

// ─── 5. A board and an app ───
console.log('\nA board\'s label reaches its posts, an app\'s label its data');

await test('BOARD: a board labelled hidden from AI hides its posts from the owner\'s agent; the owner reads them', async () => {
    const owner = await call('PUT', '/v1/classification/policy', alice.token, { level: 'owner', policy: {
        enabled: true,
        labels: [{ id: 'piilossa', rank: 25, name: { en: 'Not for AI', fi: 'Ei tekoälylle', es: 'No para IA' }, aiVisibility: 'hidden' }],
        rules: [{ id: 'salainen-taulu', name: 'Secret board', kind: 'keyword', pattern: 'salainen', flags: '', minLabel: 'luottamuksellinen', enabled: true, appliesTo: { kinds: ['board'] } }],
    } });
    assert(owner.status === 200 && owner.body.data.applied === true, `owner policy: ${owner.status} ${JSON.stringify(owner.body?.error ?? owner.body?.data)}`);
    const b = await call('POST', '/v1/boards', alice.token, { name: `Cls board ${stamp}`, visibility: 'shared' });
    assert(b.status === 201, `board: ${b.status} ${JSON.stringify(b.body?.error)}`);
    sharedBoard = b.body.data.id;
    const p = await call('POST', `/v1/boards/${sharedBoard}/posts`, alice.token, { title: 'Plan', body: 'The plan for the quarter.' });
    assert(p.status === 201, `post: ${p.status} ${JSON.stringify(p.body?.error)}`);
    const before = await call('GET', `/v1/boards/${sharedBoard}/posts`, bot.token);
    assert(before.status === 200 && before.body.data.posts.length === 1, `POSITIVE CONTROL, the agent reads it: ${before.status} ${JSON.stringify(before.body?.data ?? before.body?.error)}`);
    const set = await setLabelAs(alice.token, { kind: 'board', board_id: sharedBoard }, 'piilossa');
    assert(set.status === 200 && set.body.data.applied === true, `board label: ${set.status} ${JSON.stringify(set.body?.error ?? set.body?.data)}`);
    const rest = await call('GET', `/v1/boards/${sharedBoard}/posts`, bot.token);
    assert(rest.status === 200 && rest.body.data.posts.length === 0, `REST, the agent: ${JSON.stringify(rest.body?.data)}`);
    const mcp = await callTool(botMcp, 'aimeat_board_read', { board_id: sharedBoard });
    assert(!mcp.isError && !mcp.text.includes('The plan for the quarter'), `node MCP, the agent: ${mcp.text.slice(0, 300)}`);
    const mine = await call('GET', `/v1/boards/${sharedBoard}/posts`, alice.token);
    assert(mine.status === 200 && mine.body.data.posts.length === 1, `the owner reads it: ${JSON.stringify(mine.body?.data)}`);
});

await test('DENIAL: another owner sets no label on a board everyone can read (403) and learns nothing of a private one (404)', async () => {
    const pub = await call('POST', '/v1/boards', alice.token, { name: `Cls public ${stamp}`, visibility: 'public' });
    assert(pub.status === 201, `public board: ${pub.status} ${JSON.stringify(pub.body?.error)}`);
    publicBoard = pub.body.data.id;
    const r = await call('PUT', '/v1/classification/label', bob.token, { kind: 'board', board_id: publicBoard, label: 'erittain-luottamuksellinen' });
    assert(r.status === 403 && r.body?.error?.code === 'NOT_ALLOWED', `bob, a public board: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const s = await call('PUT', '/v1/classification/label', bob.token, { kind: 'board', board_id: sharedBoard, label: 'julkinen' });
    assert(s.status === 404, `bob, alice's own board: ${s.status} ${JSON.stringify(s.body?.error)}`);
    const own = await labelOf(alice.token, { kind: 'board', board_id: publicBoard });
    assert(own.status === 200 && own.body.data.source === 'default', `POSITIVE CONTROL, nothing was set: ${JSON.stringify(own.body?.data ?? own.body?.error)}`);
});

await test('RULE: a detection rule written for boards raises a board by its name', async () => {
    const b = await call('POST', '/v1/boards', alice.token, { name: `Salainen suunnitelma ${stamp}`, visibility: 'shared' });
    assert(b.status === 201, `board: ${b.status} ${JSON.stringify(b.body?.error)}`);
    let view: Body = {};
    for (let i = 0; i < 20; i++) {
        view = (await labelOf(alice.token, { kind: 'board', board_id: b.body.data.id })).body;
        if (view?.data?.label === 'luottamuksellinen') break;
        await sleep(250);
    }
    assert(view?.data?.label === 'luottamuksellinen' && view.data.source === 'rule', `the rule: ${JSON.stringify(view?.data ?? view?.error)}`);
    const plain = await labelOf(alice.token, { kind: 'board', board_id: publicBoard });
    assert(plain.body?.data?.source === 'default', `POSITIVE CONTROL, a board without the word stays: ${JSON.stringify(plain.body?.data)}`);
});

await test('APP: an app\'s label reaches what the app keeps in its own namespace', async () => {
    const appName = `clcapp${stamp % 1000000}`;
    const keys = await generateKeyPair();
    const hello = await call('POST', '/v1/ecosystem-apps/hello', undefined, {
        owner: alice.name, app: appName, display_name: 'Cls app', public_key: keys.publicKey,
        scopes: ['memory:read', 'memory:write'], data_areas: [],
    });
    assert(hello.status === 200, `hello: ${hello.status} ${JSON.stringify(hello.body)}`);
    const approve = await call('POST', `/v1/ecosystem-apps/${hello.body.data.user_code}/approve`, alice.token, { action: 'approve', scopes: ['memory:read', 'memory:write'] });
    assert(approve.status === 200, `approve: ${approve.status} ${JSON.stringify(approve.body)}`);
    const geai = approve.body.data.geai as string;
    const tok = await call('POST', '/v1/ecosystem-apps/token', undefined, { device_code: hello.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    assert(tok.status === 200 && typeof tok.body.access_token === 'string', `token: ${tok.status} ${JSON.stringify(tok.body)}`);
    const w = await call('POST', '/v1/memory', tok.body.access_token, { key: 'tickets.today', value: { open: 3 }, visibility: 'private' });
    assert(w.status === 200 || w.status === 201, `the app writes: ${w.status} ${JSON.stringify(w.body?.error)}`);
    const data = { kind: 'memory', key: 'tickets.today', owner: geai };
    const before = await labelOf(alice.token, data);
    assert(before.status === 200 && before.body.data.effective?.from === 'own', `before: ${JSON.stringify(before.body?.data?.effective ?? before.body?.error)}`);
    const set = await setLabelAs(alice.token, { kind: 'app', app: appName }, 'piilossa');
    assert(set.status === 200 && set.body.data.applied === true, `app label: ${set.status} ${JSON.stringify(set.body?.error ?? set.body?.data)}`);
    const after = await labelOf(alice.token, data);
    assert(after.status === 200 && after.body.data.effective?.label === 'piilossa' && after.body.data.effective?.from === 'app',
        `after: ${JSON.stringify(after.body?.data?.effective ?? after.body?.error)}`);
    const unknown = await call('PUT', '/v1/classification/label', alice.token, { kind: 'app', app: `noapp${stamp}`, label: 'piilossa' });
    assert(unknown.status === 404, `an app alice does not have: ${unknown.status} ${JSON.stringify(unknown.body?.error)}`);
});

// ─── 6. The explorer ───
console.log('\nThe explorer lists the containers');

await test('EXPLORER: the creator lists the organism and its workspaces; the owner lists her boards and apps', async () => {
    const org = await call('GET', `/v1/classification/labels?${q({ level: 'organism', organism_id: orgId })}`, alice.token);
    assert(org.status === 200, `organism level: ${org.status} ${JSON.stringify(org.body?.error)}`);
    const kinds = (org.body.data.items as Body[]).map(i => `${i.kind}:${i.key}`);
    for (const want of [`organism:${orgId}`, `workspace:${ws1}`, `workspace:${ws2}`]) assert(kinds.includes(want), `${want} in ${JSON.stringify(kinds)}`);
    const boards = await call('GET', `/v1/classification/labels?${q({ kind: 'board' })}`, alice.token);
    assert(boards.status === 200 && (boards.body.data.items as Body[]).some(i => i.kind === 'board' && i.key === sharedBoard), `owner level: ${JSON.stringify(boards.body?.data?.items)}`);
    const apps = await callTool(botMcp, 'aimeat_classification', { action: 'explorer', kind: 'app' });
    assert(!apps.isError && (apps.data?.items as Body[]).every(i => i.kind === 'app'), `node MCP, kind app: ${apps.text.slice(0, 300)}`);
});

await test('Cleanup: the operator turns classification off', async () => {
    const r = await setSwitch('off');
    assert(r.status === 200, `switch off: ${r.status} ${JSON.stringify(r.body?.error)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
