/**
 * @file e2e-workspace-publish-guard.ts
 * @description E2E for the workspace publish change-guard (A1) + the `versioned` objectType flag (A2),
 *   both on the REST POST /v1/organisms/:id/publish path:
 *   - Happy path: a genuine draft edit → publish still appends a new .version.N (history preserved).
 *   - A1: re-publishing a draft byte-identical to the live .latest is a NO-OP — the response reports
 *     `skipped:true`, no new .version.N is written, and the stale draft is consumed.
 *   - A2: a space declared `versioned:false` (e.g. a request queue) keeps only .latest — publishing it
 *     (even with real changes) never writes a .version.N.
 * @version-history
 *   v1.3.0 — 2026-10-31 — A viewer and a member with no grant cannot reopen a record by moving the
 *     first part of its namespace into ws (or the workspace into the namespace), on REST or over MCP
 *     (secaudit 2026-10-31 inv-06).
 *   v1.2.0 — 2026-10-24 — A member's workspace role decides who publishes and reopens: a viewer and a
 *     member with no grant are refused on REST, over MCP and through the batch route; the contributor,
 *     an admin and the creator's agent still publish (secaudit2026oct22).
 *   v1.1.0 — 2026-09-04 — Who else may publish. The organism here is public and open-join on
 *     purpose, so "public" and "may write" have to be different answers, and nothing had asked.
 *     One of the 34 seeded into security/denial-coverage-exemptions.json on 2026-08-15
 *     (quality plan stream B).
 *   v1.0.0 — 2026-07-01 — Initial: change-guard + versioned-flag coverage (Lanka A).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-publish-guard

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, ct };
}

import { ownerSignIn } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

async function setupOwner(label: string) {
    const name = `pg${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Pub', password: 'Pub12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const tok = await ownerSignIn(BASE, name, 'Pub12345');
    return { name, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Workspace Publish Change-Guard + versioned Flag E2E Test ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'wspub';
const root = () => `organism.${orgId}.w.${WS}`;
const auth = () => ({ Authorization: `Bearer ${A.token}` });

// Count published version rows under a record base via the owner memory list (?count=true).
async function versionCount(base: string): Promise<number> {
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(`${base}.version.`)}&count=true`, { headers: auth() });
    assert(r.status === 200, `versionCount ${r.status}`);
    return r.body.data.count as number;
}
async function latestValue(base: string): Promise<any> {
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(`${base}.`)}`, { headers: auth() });
    const rec = (r.body.data.items as any[]).find(i => i.key === `${base}.latest`);
    return rec?.value;
}
async function hasDraft(base: string): Promise<boolean> {
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(`${base}.`)}`, { headers: auth() });
    return (r.body.data.items as any[]).some(i => i.key === `${base}.draft`);
}

await test('Setup owner', async () => { A = await setupOwner('a'); });

await test('Create organism + workspace with a versioned `note` space and a versioned:false `req` space', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Publish Guard Org', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;

    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Main', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Main', kind: 'project', status: 'active',
        objectTypes: [
            { name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: true },
            { name: 'req', schemaRef: 'schema:req@1', namespace: 'shared.reqs', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: false },
        ],
    };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
});

// ── Happy path: a real edit still versions ──
await test('First publish of a versioned note creates .version.1 + .latest', async () => {
    const base = `${root()}.shared.notes.n1`;
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${base}.draft`, value: { id: 'n1', title: 'v1' }, visibility: 'private' }) });
    const pub = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(), body: JSON.stringify({ ws: WS, namespace: 'shared.notes', id: 'n1' }) });
    assert(pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    assert(pub.body.data.skipped !== true, 'first publish must not be skipped');
    assert(await versionCount(base) === 1, `expected 1 version, got ${await versionCount(base)}`);
    assert((await latestValue(base))?.title === 'v1', 'latest is v1');
    assert(!(await hasDraft(base)), 'draft consumed after publish');
});

await test('A genuine edit → publish appends .version.2 (history preserved)', async () => {
    const base = `${root()}.shared.notes.n1`;
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${base}.draft`, value: { id: 'n1', title: 'v2' }, visibility: 'private' }) });
    const pub = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(), body: JSON.stringify({ ws: WS, namespace: 'shared.notes', id: 'n1' }) });
    assert(pub.status === 200 && pub.body.data.skipped !== true, `changed publish not skipped: ${JSON.stringify(pub.body)}`);
    assert(await versionCount(base) === 2, `expected 2 versions, got ${await versionCount(base)}`);
    assert((await latestValue(base))?.title === 'v2', 'latest advanced to v2');
});

// ── A1: unchanged re-publish is a no-op ──
await test('A1: re-publishing a draft identical to .latest is skipped (no .version.3)', async () => {
    const base = `${root()}.shared.notes.n1`;
    // Write a draft byte-identical to the current .latest (title:'v2') and publish again.
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${base}.draft`, value: { id: 'n1', title: 'v2' }, visibility: 'private' }) });
    const pub = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(), body: JSON.stringify({ ws: WS, namespace: 'shared.notes', id: 'n1' }) });
    assert(pub.status === 200, `publish ${pub.status}`);
    assert(pub.body.data.skipped === true, `unchanged re-publish should report skipped:true, got ${JSON.stringify(pub.body.data)}`);
    assert(await versionCount(base) === 2, `no new version on no-op, still 2, got ${await versionCount(base)}`);
    assert(!(await hasDraft(base)), 'stale identical draft consumed even when skipped');
});

// ── A2: versioned:false keeps only .latest ──
await test('A2: publishing a versioned:false req writes .latest but NO .version.N', async () => {
    const base = `${root()}.shared.reqs.r1`;
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${base}.draft`, value: { id: 'r1', status: 'requested' }, visibility: 'private' }) });
    const pub = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(), body: JSON.stringify({ ws: WS, namespace: 'shared.reqs', id: 'r1' }) });
    assert(pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    assert(await versionCount(base) === 0, `versioned:false must create no versions, got ${await versionCount(base)}`);
    assert((await latestValue(base))?.status === 'requested', 'latest reflects requested');
});

await test('A2: advancing the req status re-publishes .latest and still writes no version', async () => {
    const base = `${root()}.shared.reqs.r1`;
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `${base}.draft`, value: { id: 'r1', status: 'done' }, visibility: 'private' }) });
    const pub = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(), body: JSON.stringify({ ws: WS, namespace: 'shared.reqs', id: 'r1' }) });
    assert(pub.status === 200 && pub.body.data.skipped !== true, `changed req publish not skipped: ${JSON.stringify(pub.body)}`);
    assert(await versionCount(base) === 0, `still no versions on versioned:false, got ${await versionCount(base)}`);
    assert((await latestValue(base))?.status === 'done', 'latest advanced to done');
});

// ── Who else may publish into this workspace ──
//
// Everything above is owner A publishing into owner A's organism, which proves the change-guard and
// the versioned flag and says nothing about the door. The organism above is deliberately public and
// open-join, so "public" and "may write" have to be different answers, and this is where that is
// asked. Publishing is what writes the .latest a reader sees, so a stranger who can publish can
// rewrite what an organism says about itself.

let B!: Awaited<ReturnType<typeof setupOwner>>;
const bAuth = () => ({ Authorization: `Bearer ${B.token}` });

await test('Setup owner B, who is not a member of A\'s organism', async () => {
    B = await setupOwner('b');
    assert(B.token.length > 0, 'owner B token');
});

await test('A stranger cannot publish into the workspace', async () => {
    const r = await json(`/v1/organisms/${orgId}/publish`, {
        method: 'POST', headers: bAuth(),
        body: JSON.stringify({ ws: WS, namespace: 'shared.notes', id: 'n1' }),
    });
    // 403 and not 404: the organism is deliberately PUBLIC here, so a stranger already knows it
    // exists and hiding it would be theatre. What must not happen is that they can write to it.
    // Pinned to the one status so "public but not writable" stays the tested answer.
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('An unauthenticated caller cannot publish into the workspace', async () => {
    const r = await json(`/v1/organisms/${orgId}/publish`, {
        method: 'POST', body: JSON.stringify({ ws: WS, namespace: 'shared.notes', id: 'n1' }),
    });
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('A stranger\'s memory listing does not carry the workspace records', async () => {
    // The records live under organism.<id>.w.<ws>.* in the OWNER's namespace, and /v1/memory is
    // resolved against the caller. A stranger asking for the same prefix must get their own empty
    // namespace back, not A's rows.
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(root() + '.')}`, { headers: bAuth() });
    assert(r.status === 200, `stranger list ${r.status}`);
    assert((r.body.data.items as any[]).length === 0,
        `stranger sees ${(r.body.data.items as any[]).length} of A's workspace rows`);
});

await test('POSITIVE CONTROL: owner A still publishes, and the guard still skips a no-op', async () => {
    // The three refusals above would pass against an organism whose publish route was broken for
    // everyone. This proves it still works for the one principal it is meant to work for, and it
    // writes its own draft first: the A2 test above consumed r1's, and a positive control that
    // depends on a leftover from another test proves whichever ran last.
    const base = `${root()}.shared.reqs.r1`;
    const live = await latestValue(base);
    assert(live?.status === 'done', `expected the A2 publish to have left status done, got ${JSON.stringify(live)}`);
    // Byte-identical to .latest, so the change-guard has something to refuse.
    await json('/v1/memory', {
        method: 'POST', headers: auth(),
        body: JSON.stringify({ key: `${base}.draft`, value: live, visibility: 'private' }),
    });
    const r = await json(`/v1/organisms/${orgId}/publish`, {
        method: 'POST', headers: auth(),
        body: JSON.stringify({ ws: WS, namespace: 'shared.reqs', id: 'r1' }),
    });
    assert(r.status === 200, `owner publish ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.skipped === true, `an unchanged republish must skip, got ${JSON.stringify(r.body.data)}`);
});

// ── A member's workspace role decides who publishes and reopens ──
//
// secaudit2026oct22, routes/organisms/gates.ts publish-draft-without-workspace-write-role. Writing a
// draft asks the workspace role (creator, organism admin, or the creator's contributor grant); the
// publish and the reopen asked only membership and the meta.* rule. So a member with a viewer grant,
// or with no grant, published another member's draft as their own and consumed it, and a viewer wrote
// a draft through the reopen. Both ask the write rule of the draft's key now, on REST and over MCP.

type Member = Awaited<ReturnType<typeof setupOwner>>;
let C!: Member, V!: Member, N!: Member, D!: Member;
const as = (m: Member) => ({ Authorization: `Bearer ${m.token}` });
const publishAs = (m: Member, id: string) => json(`/v1/organisms/${orgId}/publish`, {
    method: 'POST', headers: as(m), body: JSON.stringify({ ws: WS, namespace: 'shared.notes', id }),
});
const draftBy = async (m: Member, id: string, title: string) => {
    const r = await json('/v1/memory', { method: 'POST', headers: as(m), body: JSON.stringify({ key: `${root()}.shared.notes.${id}.draft`, value: { id, title }, visibility: 'private' }) });
    assert(r.status === 201 || r.status === 200, `draft ${id} by ${m.name}: ${r.status} ${JSON.stringify(r.body.error)}`);
};
const draftOwnedBy = async (m: Member, id: string): Promise<boolean> => {
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(`${root()}.shared.notes.${id}.`)}`, { headers: as(m) });
    return ((r.body.data?.items ?? []) as any[]).some(i => i.key === `${root()}.shared.notes.${id}.draft`);
};

await test('fixture: C (contributor), V (viewer), N (no grant) and D (admin) join A\'s organism', async () => {
    C = await setupOwner('c'); V = await setupOwner('v'); N = await setupOwner('n'); D = await setupOwner('d');
    for (const m of [C, V, N, D]) {
        const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: as(m), body: '{}' });
        assert(j.status === 200 || j.status === 201, `join ${m.name}: ${j.status} ${JSON.stringify(j.body.error)}`);
    }
    for (const [m, role] of [[C, 'contributor'], [V, 'viewer']] as const) {
        const g = await json(`/v1/organisms/${orgId}/workspace-access/grant`, { method: 'POST', headers: auth(), body: JSON.stringify({ ws: WS, grantee: m.name, role }) });
        assert(g.status === 200 || g.status === 201, `grant ${role}: ${g.status} ${JSON.stringify(g.body.error)}`);
    }
    const p = await json(`/v1/organisms/${orgId}/admins`, { method: 'POST', headers: auth(), body: JSON.stringify({ target_ghii: D.name }) });
    assert(p.status === 200, `promote D: ${p.status} ${JSON.stringify(p.body.error)}`);
});

await test('A viewer and a member with no grant cannot publish a contributor\'s draft (403), and the draft stays', async () => {
    await draftBy(C, 'c1', 'by C');
    for (const m of [V, N]) {
        const r = await publishAs(m, 'c1');
        assert(r.status === 403, `${m === V ? 'viewer' : 'no-grant member'} publish: expected 403, got ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    }
    assert(await draftOwnedBy(C, 'c1'), 'C\'s draft must still exist after the refused publishes');
});

await test('A viewer\'s agent cannot publish over MCP, nor through the batch route', async () => {
    const agent = await makeAgent(BASE, V, ['organism:read', 'organism:write']);
    const session = await openSession(BASE, agent.token, 'e2e-publish-guard-viewer');
    const r = await callTool(session, 'aimeat_workspace_publish', { organism_id: orgId, ws: WS, namespace: 'shared.notes', id: 'c1' });
    assert(r.isError, `MCP publish by a viewer's agent: expected a refusal, got ${r.text.slice(0, 200)}`);
    const b = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: as(V), body: JSON.stringify({ ws: WS, namespace: 'shared.notes', instances: ['c1'] }) });
    assert(b.status === 403, `batch publish by a viewer: expected 403, got ${b.status} ${JSON.stringify(b.body).slice(0, 200)}`);
    assert(await draftOwnedBy(C, 'c1'), 'C\'s draft must still exist');
});

await test('POSITIVE CONTROL: the contributor publishes their own draft', async () => {
    const r = await publishAs(C, 'c1');
    assert(r.status === 200, `contributor publish: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
});

await test('A viewer cannot reopen a published record into a draft, on REST or over MCP', async () => {
    const r = await json(`/v1/organisms/${orgId}/revert`, { method: 'POST', headers: as(V), body: JSON.stringify({ ws: WS, namespace: 'shared.notes', id: 'c1' }) });
    assert(r.status === 403, `viewer revert: expected 403, got ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    const agent = await makeAgent(BASE, V, ['organism:read', 'organism:write']);
    const session = await openSession(BASE, agent.token, 'e2e-publish-guard-viewer-revert');
    const m = await callTool(session, 'aimeat_workspace_revert_to_draft', { organism_id: orgId, ws: WS, namespace: 'shared.notes', id: 'c1' });
    assert(m.isError, `MCP revert by a viewer's agent: expected a refusal, got ${m.text.slice(0, 200)}`);
    assert(!(await draftOwnedBy(V, 'c1')), 'no draft may land under the viewer');
});

await test('A viewer and a member with no grant cannot reopen the record by moving part of its namespace into ws, on REST or over MCP', async () => {
    // The record's key is organism.<id>.w.<WS>.shared.notes.c1. A ws of `<WS>.shared` with the
    // namespace `notes`, or no ws with the namespace `w.<WS>.shared.notes`, builds the same key.
    for (const m of [N, V]) {
        const who = m === V ? 'viewer' : 'no-grant member';
        const dotted = await json(`/v1/organisms/${orgId}/revert`, { method: 'POST', headers: as(m), body: JSON.stringify({ ws: `${WS}.shared`, namespace: 'notes', id: 'c1' }) });
        // No workspace has the id `<WS>.shared`, so the read check answers as for a record not there.
        assert(dotted.status === 404, `${who} REST revert with a dotted ws: expected 404, got ${dotted.status} ${JSON.stringify(dotted.body).slice(0, 200)}`);
        const noWs = await json(`/v1/organisms/${orgId}/revert`, { method: 'POST', headers: as(m), body: JSON.stringify({ namespace: `w.${WS}.shared.notes`, id: 'c1' }) });
        assert(noWs.status === 422 && noWs.body.error?.code === 'UNDECLARED_SPACE', `${who} REST revert with the workspace in the namespace: expected 422 UNDECLARED_SPACE, got ${noWs.status} ${JSON.stringify(noWs.body).slice(0, 200)}`);
        const agent = await makeAgent(BASE, m, ['organism:read', 'organism:write']);
        const session = await openSession(BASE, agent.token, `e2e-publish-guard-dotted-${m === V ? 'v' : 'n'}`);
        const t = await callTool(session, 'aimeat_workspace_revert_to_draft', { organism_id: orgId, ws: `${WS}.shared`, namespace: 'notes', id: 'c1' });
        assert(t.isError, `${who}'s agent MCP revert with a dotted ws: expected a refusal, got ${t.text.slice(0, 200)}`);
        assert(!(await draftOwnedBy(m, 'c1')), `no draft may land under the ${who}`);
    }
});

await test('POSITIVE CONTROL: the contributor reopens, the admin publishes, the creator\'s agent publishes', async () => {
    const rv = await json(`/v1/organisms/${orgId}/revert`, { method: 'POST', headers: as(C), body: JSON.stringify({ ws: WS, namespace: 'shared.notes', id: 'c1' }) });
    assert(rv.status === 200, `contributor revert: ${rv.status} ${JSON.stringify(rv.body).slice(0, 200)}`);
    await draftBy(C, 'c1', 'by C, edited');
    const byAdmin = await publishAs(D, 'c1');
    assert(byAdmin.status === 200, `admin publish: ${byAdmin.status} ${JSON.stringify(byAdmin.body).slice(0, 200)}`);
    await draftBy(C, 'c2', 'second by C');
    const agent = await makeAgent(BASE, A, ['organism:read', 'organism:write']);
    const session = await openSession(BASE, agent.token, 'e2e-publish-guard-creator-agent');
    const r = await callTool(session, 'aimeat_workspace_publish', { organism_id: orgId, ws: WS, namespace: 'shared.notes', id: 'c2' });
    assert(!r.isError, `creator's agent MCP publish: ${r.text.slice(0, 200)}`);
});

await test('Cleanup owners C, V, N and D', async () => {
    for (const m of [C, V, N, D]) {
        const r = await json(`/v1/owners/${m.name}`, { method: 'DELETE', headers: as(m) });
        assert(r.status === 200, `del ${m.name} ${r.status}`);
    }
});

await test('Cleanup owner B', async () => { const r = await json(`/v1/owners/${B.name}`, { method: 'DELETE', headers: bAuth() }); assert(r.status === 200, `del ${r.status}`); });

await test('Cleanup owner A', async () => { const r = await json(`/v1/owners/${A.name}`, { method: 'DELETE', headers: auth() }); assert(r.status === 200, `del ${r.status}`); });

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
