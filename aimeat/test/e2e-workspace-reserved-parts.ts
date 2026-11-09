/**
 * @file e2e-workspace-reserved-parts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node keeps records of its own under a workspace root: the share record with its
 *   password hash (`meta.share`), other accounts' access requests (`access.request.<name>`), intake form
 *   configs (`meta.intake.<id>`), the shared fingerprints of documents (`meta.fingerprint.<ns>~<id>`) and
 *   the workspace's own manifest, readme and rules. A workspace manager could declare a space over one of
 *   these parts (namespace `meta`, `access.request`, `meta.fingerprint`), and every reader of the
 *   workspace then got those records as rows of that space, unmasked (secaudit2026nov08 round 14,
 *   workspace-content:reserved-workspace-records-served-through-declared-namespace-unmasked and
 *   n809-content:workspace-read-surfaces-shared-fingerprint-via-manifest-meta-namespace).
 *
 *   Now a manifest write refuses a new space over a node-reserved part and names it; a space the project
 *   shape declares under `meta.` (meta.goals, meta.plans, meta.decisions) is not reserved and is taken as
 *   before. A manifest that already declares such a space keeps loading, and its own rows still list;
 *   the node-reserved keys are never a row of any space, and every value passes the credential mask.
 *
 *   The MCP workspace access tools name the workspace creator from the registry copy that counts, as the
 *   REST gate does (mcp/workspaces.ts:findWsEntry:first-store-order-registry-copy).
 *
 *   FIRST FAIL. On the tree before the fix every "Refused:" test fails; every "Usage:" test passes on
 *   both trees.
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-reserved-parts
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { openSession, callTool, makeAgent } from './helpers/mcp-session.js';

/** An MCP session of an agent of `owner` holding `scopes`. */
const agentSession = async (owner: RegisteredOwner, scopes: string[], label: string) =>
    openSession(BASE, (await makeAgent(BASE, owner, scopes)).token, label);

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, token?: string, body?: unknown) {
    const res = await fetch(`${BASE}${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    const parsed = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body: parsed };
}
const show = (r: { status: number; body: any }) => `${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data ?? r.body).slice(0, 400)}`;

const stamp = Date.now().toString(36);
const SHARE_PW = `share-pw-${stamp}`;
const REQUEST_MESSAGE = `carol-asks-${stamp}`;
const FP_SECRET = `fingerprint-claim-${stamp}`;
let alice!: RegisteredOwner, bob!: RegisteredOwner, carol!: RegisteredOwner;
let orgId = '', WS = '';
const root = () => `organism.${orgId}.w.${WS}`;
const baseTypes = [
    { name: 'note', namespace: 'notes', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:note@1' },
    { name: 'goal', namespace: 'meta.goals', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:goal@1' },
];

console.log('\n=== Workspace: the node-reserved parts are no space of any manifest ===\n');

await test('Setup: alice\'s organism and workspace, bob a viewer, carol asks for access, a password share', async () => {
    alice = await registerOwner(BASE, `rpa${stamp}`);
    bob = await registerOwner(BASE, `rpb${stamp}`);
    carol = await registerOwner(BASE, `rpc${stamp}`);
    const o = await call('POST', '/v1/organisms', alice.token, { name: `Reserved ${stamp}`, description: 'x', type: 'project', join_policy: 'open', visibility: 'public' });
    assert(o.status === 201, `organism ${show(o)}`);
    orgId = o.body.data.organism.id;
    for (const who of [bob, carol]) {
        const j = await call('POST', `/v1/organisms/${orgId}/join`, who.token, {});
        assert(j.status === 200 || j.status === 201, `join ${who.name}: ${show(j)}`);
    }
    const w = await call('POST', `/v1/organisms/${orgId}/workspaces`, alice.token, { name: 'Reserved', manifest: { objectTypes: baseTypes } });
    assert(w.status === 201, `workspace ${show(w)}`);
    WS = w.body.data.ws;
    const g = await call('POST', `/v1/organisms/${orgId}/workspace-access/grant`, alice.token, { ws: WS, grantee: bob.name, role: 'viewer' });
    assert(g.status === 200, `grant ${show(g)}`);
    const ask = await call('POST', `/v1/organisms/${orgId}/workspace-access`, carol.token, { ws: WS, message: REQUEST_MESSAGE });
    assert(ask.status === 201, `carol asks ${show(ask)}`);
    const share = await call('PUT', `/v1/organisms/${orgId}/workspace/share?ws=${WS}`, alice.token, { spaces: { note: true }, access: 'password', password: SHARE_PW });
    assert(share.status === 200, `share ${show(share)}`);
    const note = await call('POST', `/v1/organisms/${orgId}/workspace/drafts`, alice.token, { ws: WS, space: 'note', id: 'n1', value: { title: 'First note' } });
    assert(note.status === 200, `note draft ${show(note)}`);
    const pub = await call('POST', `/v1/organisms/${orgId}/publish`, alice.token, { ws: WS, namespace: 'notes', id: 'n1' });
    assert(pub.status === 200, `note publish ${show(pub)}`);
});

await test('Refused: add_spaces over a node-reserved part is refused, and the refusal names the part', async () => {
    for (const namespace of ['meta', 'access.request', 'meta.fingerprint', 'meta.share', 'skills', 'meta.intake']) {
        const r = await call('PUT', `/v1/organisms/${orgId}/workspace?ws=${WS}`, alice.token, { add_spaces: [{ name: `x${namespace.replace(/\W/g, '')}`, namespace }] });
        assert(r.status === 400 && r.body?.error?.code === 'INVALID_MANIFEST', `add_spaces "${namespace}" was taken: ${show(r)}`);
        assert(String(r.body?.error?.message ?? '').includes(`"${namespace}"`), `the refusal names "${namespace}": ${show(r)}`);
    }
});

await test('Refused: a full manifest replace or a new workspace that adds a node-reserved space is refused', async () => {
    const cur = await call('GET', `/v1/memory/${encodeURIComponent(`${root()}.meta.manifest`)}`, alice.token);
    assert(cur.status === 200, `manifest read ${show(cur)}`);
    const manifest = { ...cur.body.data.value, objectTypes: [...cur.body.data.value.objectTypes, { name: 'req', namespace: 'access.request', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:req@1' }] };
    const put = await call('PUT', `/v1/organisms/${orgId}/workspace?ws=${WS}`, alice.token, { manifest });
    assert(put.status === 400 && put.body?.error?.code === 'INVALID_MANIFEST', `the replace was taken: ${show(put)}`);
    const made = await call('POST', `/v1/organisms/${orgId}/workspaces`, alice.token, { name: 'Bad', manifest: { objectTypes: [...baseTypes, { name: 'all', namespace: 'meta', mode: 'records' }] } });
    assert(made.status === 400, `a workspace with a "meta" space was made: ${show(made)}`);
});

await test('Usage: a space under meta. that the node does not keep (meta.plans) is added and used as before', async () => {
    const r = await call('PUT', `/v1/organisms/${orgId}/workspace?ws=${WS}`, alice.token, { add_spaces: [{ name: 'plan', namespace: 'meta.plans' }] });
    assert(r.status === 200 && (r.body.data.added ?? []).includes('plan'), `meta.plans: ${show(r)}`);
    for (const [space, ns] of [['goal', 'meta.goals'], ['plan', 'meta.plans']] as const) {
        const d = await call('POST', `/v1/organisms/${orgId}/workspace/drafts`, alice.token, { ws: WS, space, id: `${space}1`, value: { title: `A ${space}` } });
        assert(d.status === 200, `${space} draft ${show(d)}`);
        const p = await call('POST', `/v1/organisms/${orgId}/publish`, alice.token, { ws: WS, namespace: ns, id: `${space}1` });
        assert(p.status === 200, `${space} publish ${show(p)}`);
    }
    const read = await call('GET', `/v1/organisms/${orgId}/workspace?ws=${WS}`, bob.token);
    assert(read.status === 200, `bob reads ${show(read)}`);
    const objects = read.body.data.objects;
    assert((objects.goal ?? []).some((g: any) => g.title === 'A goal'), `goal listed: ${JSON.stringify(objects.goal)}`);
    assert((objects.plan ?? []).some((g: any) => g.title === 'A plan'), `plan listed: ${JSON.stringify(objects.plan)}`);
    assert((objects.note ?? []).some((g: any) => g.title === 'First note'), `note listed: ${JSON.stringify(objects.note)}`);
});

// A manifest written before the fix may already declare such a space. It is stored here the way it was
// stored then, with a plain memory write of the manifest, so the read side is what is tested.
await test('Setup: a manifest already declares spaces over meta, access.request and meta.fingerprint, with one row of its own', async () => {
    const cur = await call('GET', `/v1/memory/${encodeURIComponent(`${root()}.meta.manifest`)}`, alice.token);
    assert(cur.status === 200, `manifest read ${show(cur)}`);
    const manifest = cur.body.data.value;
    manifest.objectTypes = [...manifest.objectTypes,
        { name: 'metaall', namespace: 'meta', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:metaall@1' },
        { name: 'requests', namespace: 'access.request', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:requests@1' },
        { name: 'fps', namespace: 'meta.fingerprint', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:fps@1' },
    ];
    const put = await call('PUT', `/v1/memory/${encodeURIComponent(`${root()}.meta.manifest`)}`, alice.token, { value: manifest, version: cur.body.data.version });
    assert(put.status === 200, `manifest write ${show(put)}`);
    // A row the manager wrote into the declared `meta` space, and one at a fingerprint key.
    const own = await call('POST', '/v1/memory', alice.token, { key: `${root()}.meta.kept1.latest`, value: { title: 'Kept row' }, visibility: 'private' });
    assert(own.status === 201 || own.status === 200, `own row ${show(own)}`);
    const fp = await call('POST', '/v1/memory', alice.token, { key: `${root()}.meta.fingerprint.notes~n1`, value: { doc: 'n1', sections: [{ heading: 'h', claims: [FP_SECRET] }] }, visibility: 'private' });
    assert(fp.status === 201 || fp.status === 200, `fingerprint-shaped row ${show(fp)}`);
});

await test('Refused: the workspace read gives no reserved record as a row: no share hash, no access request, no fingerprint', async () => {
    for (const [who, token] of [['bob (viewer)', bob.token], ['alice (creator)', alice.token]] as const) {
        const r = await call('GET', `/v1/organisms/${orgId}/workspace?ws=${WS}`, token);
        assert(r.status === 200, `${who} reads ${show(r)}`);
        const text = JSON.stringify(r.body.data.objects);
        assert(!text.includes('passwordHash') && !text.includes('icsKeyHash'), `${who}: the share record's hash is a row`);
        assert(!text.includes(REQUEST_MESSAGE), `${who}: carol's access request is a row`);
        assert(!text.includes(FP_SECRET), `${who}: a fingerprint is a row`);
        assert(!JSON.stringify(r.body.data.objects.metaall ?? []).includes('"objectTypes"'), `${who}: the manifest is a row of the meta space`);
    }
});

await test('Refused: opening a reserved record by id answers it missing, on the index read and on MCP', async () => {
    const one = await call('GET', `/v1/organisms/${orgId}/workspace/index?ws=${WS}&ids=share,manifest&space=metaall`, alice.token);
    assert(one.status === 200, `index read ${show(one)}`);
    assert(!JSON.stringify(one.body.data.items ?? []).includes('passwordHash'), `the share record opened by id: ${JSON.stringify(one.body.data.items).slice(0, 300)}`);
    assert((one.body.data.missing ?? []).includes('share'), `share is missing: ${JSON.stringify(one.body.data)}`);
    const session = await agentSession(bob, ['organism:read'], 'reserved-parts');
    const t = await callTool(session, 'aimeat_workspace_read', { organism_id: orgId, ws: WS, ids: [carol.name], space: 'requests' });
    assert(!t.text.includes(REQUEST_MESSAGE), `MCP opened carol's request: ${t.text.slice(0, 300)}`);
    const fp = await callTool(session, 'aimeat_workspace_read', { organism_id: orgId, ws: WS, ids: ['notes~n1'], space: 'fps' });
    assert(!fp.text.includes(FP_SECRET), `MCP opened the fingerprint: ${fp.text.slice(0, 300)}`);
});

await test('Usage: the declared space\'s own row and the other spaces still read; the workspace keeps working', async () => {
    const r = await call('GET', `/v1/organisms/${orgId}/workspace?ws=${WS}`, bob.token);
    assert(r.status === 200, `bob reads ${show(r)}`);
    const objects = r.body.data.objects;
    assert((objects.metaall ?? []).some((x: any) => x.title === 'Kept row'), `the meta space's own row: ${JSON.stringify(objects.metaall)}`);
    assert((objects.note ?? []).some((x: any) => x.title === 'First note'), `note: ${JSON.stringify(objects.note)}`);
    assert(typeof r.body.data.manifest === 'object' && Array.isArray(r.body.data.manifest?.objectTypes), 'the manifest still answers');
    const one = await call('GET', `/v1/organisms/${orgId}/workspace/index?ws=${WS}&ids=kept1&space=metaall`, alice.token);
    assert(one.status === 200 && (one.body.data.items ?? []).some((i: any) => i.value?.title === 'Kept row'), `kept1 opens: ${show(one)}`);
    // The access request is still the creator's to see, on its own door.
    const reqs = await call('GET', `/v1/organisms/${orgId}/workspace-access?ws=${WS}`, alice.token);
    assert(reqs.status === 200 && JSON.stringify(reqs.body.data).includes(REQUEST_MESSAGE), `the access request list: ${show(reqs)}`);
    // The share still opens with its password.
    const unlock = await call('POST', `/v1/organisms/${orgId}/workspace/share/unlock`, undefined, { ws: WS, password: SHARE_PW });
    assert(unlock.status === 200, `share unlock ${show(unlock)}`);
});

// ── The MCP access tools and the registry copy that counts (mcp/workspaces.ts findWsEntry) ──
console.log('\nMCP access tools: the workspace creator is the one the REST gate names');

let zorg!: RegisteredOwner, aadm!: RegisteredOwner, dan!: RegisteredOwner;
let zOrg = '', zWs = '';

await test('Setup: zorg\'s workspace; aadm, an admin, writes a registry copy naming himself and is demoted; dan asks for access', async () => {
    // aadm's name sorts before zorg's, so the first copy in store order is aadm's.
    zorg = await registerOwner(BASE, `zrp${stamp}`);
    aadm = await registerOwner(BASE, `arp${stamp}`);
    dan = await registerOwner(BASE, `drp${stamp}`);
    const o = await call('POST', '/v1/organisms', zorg.token, { name: `Copies ${stamp}`, type: 'project', join_policy: 'invite_only', visibility: 'private' });
    assert(o.status === 201, `organism ${show(o)}`);
    zOrg = o.body.data.organism.id;
    const w = await call('POST', `/v1/organisms/${zOrg}/workspaces`, zorg.token, { name: 'Notes', manifest: { objectTypes: [baseTypes[0]] } });
    assert(w.status === 201, `workspace ${show(w)}`);
    zWs = w.body.data.ws;
    for (const who of [aadm, dan]) {
        const add = await call('POST', `/v1/organisms/${zOrg}/members`, zorg.token, { ghii: who.name });
        assert(add.status === 201, `add ${who.name}: ${show(add)}`);
    }
    const promote = await call('POST', `/v1/organisms/${zOrg}/admins`, zorg.token, { target_ghii: aadm.name });
    assert(promote.status === 200 || promote.status === 201, `promote ${show(promote)}`);
    const reg = await call('POST', '/v1/memory', aadm.token, { key: `organism.${zOrg}.meta.workspaces`, value: { workspaces: [{ id: zWs, name: 'Notes', createdBy: aadm.name }] }, visibility: 'private' });
    assert(reg.status === 201 || reg.status === 200, `aadm's registry copy ${show(reg)}`);
    const demote = await call('DELETE', `/v1/organisms/${zOrg}/admins/${aadm.name}`, zorg.token);
    assert(demote.status === 200, `demote ${show(demote)}`);
    const ask = await call('POST', `/v1/organisms/${zOrg}/workspace-access`, dan.token, { ws: zWs, message: `dan-asks-${stamp}` });
    assert(ask.status === 201 && ask.body.data.workspace_creator === zorg.name, `dan asks ${show(ask)}`);
    // The control: the REST door refuses aadm.
    const rest = await call('GET', `/v1/organisms/${zOrg}/workspace-access?ws=${zWs}`, aadm.token);
    assert(rest.status === 403, `REST lets aadm list: ${show(rest)}`);
});

await test('Refused: on MCP the demoted admin neither lists the requests nor decides one', async () => {
    const session = await agentSession(aadm, ['organism:read', 'organism:invite'], 'reserved-parts-aadm');
    const list = await callTool(session, 'aimeat_workspace_access', { organism_id: zOrg, ws: zWs, action: 'list' });
    assert(list.isError && !list.text.includes(`dan-asks-${stamp}`), `MCP let aadm list: ${list.text.slice(0, 300)}`);
    const decide = await callTool(session, 'aimeat_workspace_access', { organism_id: zOrg, ws: zWs, action: 'decide', requester: dan.name, decision: 'deny' });
    assert(decide.isError, `MCP let aadm decide: ${decide.text.slice(0, 300)}`);
    const req = await call('GET', `/v1/organisms/${zOrg}/workspace-access?ws=${zWs}`, zorg.token);
    const dans = (req.body.data.requests ?? []).find((r: any) => r.requester === dan.name);
    assert(dans && dans.status === 'pending', `dan's request was decided: ${JSON.stringify(dans)}`);
});

await test('Usage: the workspace creator lists the requests on MCP as before', async () => {
    const session = await agentSession(zorg, ['organism:read', 'organism:invite'], 'reserved-parts-zorg');
    const list = await callTool(session, 'aimeat_workspace_access', { organism_id: zOrg, ws: zWs, action: 'list' });
    assert(!list.isError && list.text.includes(`dan-asks-${stamp}`), `zorg lists: ${list.text.slice(0, 300)}`);
});

// Before the fix the MCP door named aadm the creator, so the approval wrote dan's role under aadm,
// where the access layer does not look: the approval said yes and dan still read nothing.
await test('Refused: the creator\'s MCP approval no longer lands under a creator the access layer does not read; dan reads', async () => {
    const session = await agentSession(zorg, ['organism:read', 'organism:invite'], 'reserved-parts-zorg2');
    const decide = await callTool(session, 'aimeat_workspace_access', { organism_id: zOrg, ws: zWs, action: 'decide', requester: dan.name, decision: 'approve', role: 'viewer' });
    assert(!decide.isError, `zorg decides: ${decide.text.slice(0, 300)}`);
    const read = await call('GET', `/v1/organisms/${zOrg}/workspace?ws=${zWs}`, dan.token);
    assert(read.status === 200 && read.body.data.manifest, `dan reads after the approval: ${show(read)}`);
    const members = await callTool(session, 'aimeat_workspace_members', { organism_id: zOrg, ws: zWs });
    assert(!members.isError && members.text.includes(dan.name), `members: ${members.text.slice(0, 300)}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
