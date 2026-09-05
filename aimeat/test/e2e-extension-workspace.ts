/**
 * @file e2e-extension-workspace.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `ctx.workspace`: an extension acting on its CALLER's organism workspace, as the
 *   caller, through the same operations aimeat_workspace_read/_write/_publish perform. The happy
 *   path is one test; everything else is a refusal, and each refusal names the door it holds:
 *     - the manifest must declare it (no declaration → undefined; read-only → PERMISSION)
 *     - the caller must be an active member with a contributor grant (ACCESS_DENIED)
 *     - an agent token needs memory:write to write (SCOPE_DENIED) and organism:read to read
 *     - the locked schema applies (SCHEMA_VALIDATION_FAILED, nothing written)
 *     - ifVersion is a compare-and-swap (VERSION_CONFLICT, nothing written)
 *     - every call counts against maxApiCalls (API_LIMIT_EXCEEDED)
 *     - a scheduled run gets no ctx.workspace at all
 *   The record an extension writes is owned by the CALLER (not the installer), and the activity
 *   feed attributes it to the caller's agent.
 *
 *   FIRST FAIL. Against the tree before this capability every "declared" assertion fails the same
 *   way: `ctx.workspace` is undefined inside the sandbox, so a script calling it throws a TypeError
 *   and the route answers 500 EXTENSION_ERROR. The assertion that asserts the new hole is named in
 *   each test with `// HOLE:`. Two tests (no declaration, scheduled run) assert a GUARD the old tree
 *   satisfied trivially, and say so.
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=extension-workspace

const BASE = process.env.E2E_BASE ?? 'http://localhost:40254';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function setupOwner(label: string) {
    const name = `ews${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Ext WS', password: 'ExtWs12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body?.ok === true, `token: ${JSON.stringify(tok.body?.error)}`);
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

/** Device-auth (RFC 8628): an agent token for `owner` carrying exactly `scopes`. */
async function mintAgentToken(owner: { name: string; token: string }, agentName: string, scopes: string[]): Promise<string> {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: owner.name }) });
    assert(da.status === 200 && da.body?.ok, `device-authorize ${da.status}`);
    const approve = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: owner.token }),
    });
    assert(approve.status === 200 && approve.body?.ok, `approve ${approve.status} ${JSON.stringify(approve.body?.error)}`);
    const poll = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(poll.status === 200 && typeof poll.body?.token === 'string', `device-token ${poll.status}`);
    return poll.body.token as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== Extension ctx.workspace E2E ===\n');

// ── The three extensions: declared, undeclared, read-only. And one with a tiny API budget. ──
const STAMP = Date.now();
const EXT = `wsp${STAMP}`;      // workspace: { read, write }
const EXT_NONE = `wsn${STAMP}`; // no declaration
const EXT_READ = `wsr${STAMP}`; // workspace: { read }
const EXT_BUDGET = `wsb${STAMP}`; // read+write, max_api_calls at the floor

const SCRIPTS = {
    probe: `export default async function(ctx){
        var has = !!ctx.workspace;
        await ctx.memory.set('probe', { has: has, roles: ctx.caller.roles });
        return { has: has, keys: has ? Object.keys(ctx.workspace).sort() : [] };
    }`,
    // Write a claim, read it back, optionally publish. Opts only when the caller sent them, so the
    // default path is the unguarded write the MCP tool performs.
    claim: `export default async function(ctx, input){
        var opts = input.ifVersion === undefined ? undefined : { ifVersion: input.ifVersion };
        var written = await ctx.workspace.write(input.org, input.ws, 'claim', input.id, { id: input.id, port: input.port, by: ctx.caller.gaii }, opts);
        var got = await ctx.workspace.get(input.org, input.ws, [input.id]);
        var pub = input.publish ? await ctx.workspace.publish(input.org, input.ws, 'shared.claim', input.id) : null;
        return { written: written, got: got, pub: pub, caller: ctx.caller.gaii };
    }`,
    bad: `export default async function(ctx, input){
        return ctx.workspace.write(input.org, input.ws, 'claim', input.id, { id: input.id, port: 40254 });
    }`,
    index: `export default async function(ctx, input){ return ctx.workspace.index(input.org, input.ws); }`,
    doc: `export default async function(ctx, input){
        var w = await ctx.workspace.writeDoc(input.org, input.ws, 'handoff', { title: 'Hand-off', markdown: '# Hand-off\\n\\nport 40254 is yours' });
        var pub = await ctx.workspace.publish(input.org, input.ws, 'shared.handoff', w.id);
        return { written: w, pub: pub };
    }`,
    // A script that CATCHES the refusal sees the service's code and words.
    catchit: `export default async function(ctx, input){
        try { await ctx.workspace.write(input.org, input.ws, 'claim', input.id, { id: input.id, port: 'x' }); return { caught: null }; }
        catch (e) { return { caught: String(e && e.message ? e.message : e) }; }
    }`,
    burn: `export default async function(ctx, input){
        for (var i = 0; i < 11; i++) await ctx.workspace.index(input.org, input.ws);
        return { burned: 11 };
    }`,
};

const manifest = (name: string, extra: Record<string, unknown>, limits: Record<string, unknown> = { timeout_ms: 8000, max_api_calls: 50 }) => JSON.stringify({
    metadata: { name, version: '1.0.0', description: 'ctx.workspace e2e', author: 'e2e' },
    actions: Object.keys(SCRIPTS).map(id => ({ id, method: 'POST', path: `/${id}`, script: id })),
    config: { public_access: { default: true } },
    limits,
    ...extra,
});

let A!: Awaited<ReturnType<typeof setupOwner>>;   // installs the extensions, creates the organism
let B!: Awaited<ReturnType<typeof setupOwner>>;   // a member with a contributor grant; the CALLER
let D!: Awaited<ReturnType<typeof setupOwner>>;   // a stranger
let bAgentToken = '';      // B's agent, memory:write + organism:read
let bReaderToken = '';     // B's agent, organism:read only
const B_AGENT = 'wsagent';
let orgId = '';
const WS = 'wsclaims';
const root = () => `organism.${orgId}.w.${WS}`;

const invoke = (ext: string, action: string, token: string, input: Record<string, unknown> = {}) =>
    json(`/v1/ext/${ext}/${action}`, { method: 'POST', headers: auth(token), body: JSON.stringify({ org: orgId, ws: WS, ...input }) });

await test('Setup: three owners, B\'s two agents (one may write, one may only read)', async () => {
    A = await setupOwner('a'); B = await setupOwner('b'); D = await setupOwner('d');
    bAgentToken = await mintAgentToken(B, B_AGENT, ['memory:read', 'memory:write', 'organism:read']);
    bReaderToken = await mintAgentToken(B, 'wsreader', ['memory:read', 'organism:read']);
});

await test('Setup: A\'s organism, a workspace with a locked claim schema, B joins and gets contributor', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Coding Central e2e', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body?.error)}`); orgId = o.body.data.organism.id;
    const reg = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Claims', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    assert(reg.status === 201 || reg.status === 200, `registry ${reg.status}`);
    const man = {
        manifestVersion: '1.0', id: orgId, name: 'Claims', kind: 'project', status: 'active',
        objectTypes: [
            { name: 'claim', schemaRef: 'schema:claim@1', namespace: 'shared.claim', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: true },
            { name: 'handoff', schemaRef: 'schema:handoff@1', namespace: 'shared.handoff', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'document', versioned: true },
        ],
    };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: man, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
    // The claim schema: `port` is a string. A write carrying a number must be refused.
    const lock = await json(`/v1/memory/${encodeURIComponent(`${root()}.shared.claim`)}/schema`, {
        method: 'PUT', headers: auth(A.token),
        body: JSON.stringify({ apply_to: 'prefix', schema_mode: 'strict', schema: { type: 'object', required: ['id', 'port'], properties: { id: { type: 'string' }, port: { type: 'string' }, by: { type: 'string' } } } }),
    });
    assert(lock.status === 200 || lock.status === 201, `schema lock ${lock.status}: ${JSON.stringify(lock.body?.error)}`);
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(j.status === 201, `join ${j.status}: ${JSON.stringify(j.body?.error)}`);
    const g = await json(`/v1/organisms/${orgId}/workspace-access/grant`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ws: WS, grantee: B.name, role: 'contributor' }) });
    assert(g.status === 200, `grant ${g.status}: ${JSON.stringify(g.body?.error)}`);
});

await test('Install: a manifest with a mis-typed or unknown workspace field is refused (INVALID_MANIFEST)', async () => {
    const bad1 = await json('/v1/extensions', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ manifest: manifest(`wsx${STAMP}`, { workspace: { read: 'yes' } }), scripts: SCRIPTS }) });
    assert(bad1.status === 400 && bad1.body?.error?.code === 'INVALID_MANIFEST', `read:'yes' → ${bad1.status} ${JSON.stringify(bad1.body?.error)}`);
    const bad2 = await json('/v1/extensions', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ manifest: manifest(`wsy${STAMP}`, { workspace: { admin: true } }), scripts: SCRIPTS }) });
    assert(bad2.status === 400 && bad2.body?.error?.code === 'INVALID_MANIFEST', `admin:true → ${bad2.status} ${JSON.stringify(bad2.body?.error)}`);
});

await test('Install + activate: declared, undeclared, read-only and budget-capped extensions', async () => {
    for (const [name, extra, limits] of [
        [EXT, { workspace: { read: true, write: true } }, undefined],
        [EXT_NONE, {}, undefined],
        [EXT_READ, { workspace: { read: true } }, undefined],
        [EXT_BUDGET, { workspace: { read: true, write: true } }, { timeout_ms: 8000, max_api_calls: 1 }],
    ] as const) {
        const inst = await json('/v1/extensions', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ manifest: manifest(name, extra as Record<string, unknown>, limits as Record<string, unknown> | undefined), scripts: SCRIPTS }) });
        assert(inst.status === 201, `install ${name} ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
        const act = await json(`/v1/extensions/${name}/activate`, { method: 'POST', headers: auth(A.token) });
        assert(act.status === 200, `activate ${name} ${act.status}`);
    }
    const detail = await json(`/v1/extensions/${EXT}`);
    assert(detail.body?.data?.extension?.workspace?.read === true && detail.body.data.extension.workspace.write === true, `detail carries the declaration: ${JSON.stringify(detail.body?.data?.extension?.workspace)}`);
    const none = await json(`/v1/extensions/${EXT_NONE}`);
    assert(none.body?.data?.extension?.workspace === null, `undeclared reads back null: ${JSON.stringify(none.body?.data?.extension?.workspace)}`);
});

await test('Declaration: without it ctx.workspace is undefined; with it the five methods exist', async () => {
    const none = await invoke(EXT_NONE, 'probe', B.token);
    assert(none.status === 200, `probe none ${none.status}: ${JSON.stringify(none.body?.error)}`);
    // GUARD, not hole: the old tree had no ctx.workspace on any extension, so this held trivially.
    assert(none.body.data.has === false, 'an undeclared extension must see no ctx.workspace');
    const some = await invoke(EXT, 'probe', B.token);
    assert(some.status === 200, `probe ${some.status}: ${JSON.stringify(some.body?.error)}`);
    // HOLE: before this capability `has` was false here too.
    assert(some.body.data.has === true, 'a declared extension sees ctx.workspace');
    assert(JSON.stringify(some.body.data.keys) === JSON.stringify(['get', 'index', 'publish', 'write', 'writeDoc']), `surface: ${JSON.stringify(some.body.data.keys)}`);
});

await test('Happy path: B\'s agent writes a claim through A\'s extension, reads it back, publishes it', async () => {
    const r = await invoke(EXT, 'claim', bAgentToken, { id: 'c1', port: '40254', publish: true });
    // HOLE: 500 EXTENSION_ERROR (TypeError on ctx.workspace) before this capability.
    assert(r.status === 200, `claim ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const d = r.body.data;
    assert(d.written?.written === `${root()}.shared.claim.c1.draft`, `draft key: ${JSON.stringify(d.written)}`);
    assert(d.written?.mode === 'records' && d.written?.version === 1, `draft outcome: ${JSON.stringify(d.written)}`);
    assert(d.got?.items?.[0]?.value?.port === '40254' && d.got.items[0].value.by === `${B_AGENT}#${B.name}@${NODE_ID}`, `read back: ${JSON.stringify(d.got)}`);
    assert(d.got.items[0]._draftVersion === 1, `draft version on the opened record: ${JSON.stringify(d.got.items[0])}`);
    assert(d.pub?.published === `${root()}.shared.claim.c1` && d.pub.version === 1, `publish: ${JSON.stringify(d.pub)}`);
    assert(d.caller === `${B_AGENT}#${B.name}@${NODE_ID}`, `the sandbox ran as the caller: ${d.caller}`);
});

await test('Ownership: the published record is B\'s (the caller), not A\'s (the installer)', async () => {
    const mine = await json(`/v1/memory?prefix=${encodeURIComponent(`${root()}.shared.claim.c1.`)}`, { headers: auth(B.token) });
    assert(mine.status === 200, `B lists ${mine.status}`);
    const latest = (mine.body.data.items as any[]).find(i => i.key === `${root()}.shared.claim.c1.latest`);
    assert(!!latest && latest.value.port === '40254', `B owns .latest: ${JSON.stringify(mine.body.data.items?.map((i: any) => i.key))}`);
    assert(!(mine.body.data.items as any[]).some(i => i.key.endsWith('.draft')), 'the publish consumed the draft');
    const theirs = await json(`/v1/memory?prefix=${encodeURIComponent(`${root()}.shared.claim.c1.`)}`, { headers: auth(A.token) });
    assert((theirs.body.data.items as any[]).length === 0, `nothing landed under the installer: ${JSON.stringify(theirs.body.data.items?.map((i: any) => i.key))}`);
});

await test('Attribution: the activity feed credits B\'s agent, not the extension\'s installer', async () => {
    // Read as B: the feed read-authorizes per record, and these records are B's.
    const act = await json(`/v1/organisms/${orgId}/workspace/activity?ws=${WS}`, { headers: auth(B.token) });
    assert(act.status === 200, `activity ${act.status}`);
    const ev = (act.body.data.events as any[]).find(e => e.instance === 'c1' && e.action === 'publish');
    assert(!!ev, `no publish event for c1 in ${JSON.stringify(act.body.data.events)}`);
    assert(ev.actor === B.name && ev.agent === B_AGENT, `actor/agent: ${JSON.stringify(ev)}`);
});

await test('The owner in person (A, the creator) needs no scope', async () => {
    const r = await invoke(EXT, 'claim', A.token, { id: 'c-owner', port: '40255' });
    assert(r.status === 200, `owner claim ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.written?.version === 1, `written: ${JSON.stringify(r.body.data.written)}`);
});

await test('Refusal: a stranger (not a member) → 403 ACCESS_DENIED with the service\'s message', async () => {
    const r = await invoke(EXT, 'claim', D.token, { id: 'c-stranger', port: '1' });
    // HOLE: 500 EXTENSION_ERROR before; the route now answers with the service's status and code.
    assert(r.status === 403, `stranger ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body?.error?.code === 'ACCESS_DENIED' && /Not an active member/.test(r.body.error.message), `code/message: ${JSON.stringify(r.body?.error)}`);
    const none = await json(`/v1/memory?prefix=${encodeURIComponent(`${root()}.shared.claim.c-stranger`)}`, { headers: auth(D.token) });
    assert((none.body.data.items as any[]).length === 0, 'nothing was written for the stranger');
});

await test('Refusal: a script that CATCHES the refusal sees "CODE: message"', async () => {
    const r = await invoke(EXT, 'catchit', D.token, { id: 'c-caught' });
    assert(r.status === 200, `catchit ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(typeof r.body.data.caught === 'string' && r.body.data.caught.startsWith('ACCESS_DENIED: Not an active member'), `caught: ${JSON.stringify(r.body.data)}`);
});

await test('Refusal: B\'s agent WITHOUT memory:write may read (organism:read) and may not write → 403 SCOPE_DENIED', async () => {
    const idx = await invoke(EXT, 'index', bReaderToken);
    assert(idx.status === 200 && idx.body.data.mode === 'index', `reader index ${idx.status}: ${JSON.stringify(idx.body?.error ?? idx.body?.data?.mode)}`);
    assert(idx.body.data.index?.claim?.some((e: any) => e.id === 'c1'), `the index lists c1: ${JSON.stringify(idx.body.data.index)}`);
    assert(!!idx.body.data.schemas?.['shared.claim'], 'the index carries the locked schema');
    const w = await invoke(EXT, 'claim', bReaderToken, { id: 'c-noscope', port: '2' });
    // HOLE: the scope word memory:write is enforced on this door as on aimeat_workspace_write.
    assert(w.status === 403 && w.body?.error?.code === 'SCOPE_DENIED', `no scope ${w.status}: ${JSON.stringify(w.body?.error)}`);
    assert(/memory:write/.test(w.body.error.message), `names the word: ${w.body.error.message}`);
    const none = await json(`/v1/memory?prefix=${encodeURIComponent(`${root()}.shared.claim.c-noscope`)}`, { headers: auth(B.token) });
    assert((none.body.data.items as any[]).length === 0, 'nothing was written without the scope');
});

await test('Refusal: a read-only declaration lets index through and refuses write → 403 PERMISSION', async () => {
    const idx = await invoke(EXT_READ, 'index', bAgentToken);
    assert(idx.status === 200 && idx.body.data.mode === 'index', `read-only index ${idx.status}: ${JSON.stringify(idx.body?.error)}`);
    const w = await invoke(EXT_READ, 'claim', bAgentToken, { id: 'c-ro', port: '3' });
    // HOLE: the manifest's write flag is a door of its own.
    assert(w.status === 403 && w.body?.error?.code === 'PERMISSION', `read-only write ${w.status}: ${JSON.stringify(w.body?.error)}`);
});

await test('Refusal: a value the locked schema rejects → 422 SCHEMA_VALIDATION_FAILED, nothing written', async () => {
    const r = await invoke(EXT, 'bad', bAgentToken, { id: 'c-bad' });
    // HOLE: the same schema the MCP write validates against.
    assert(r.status === 422 && r.body?.error?.code === 'SCHEMA_VALIDATION_FAILED', `bad ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(/Draft rejected by schema/.test(r.body.error.message), `message: ${r.body.error.message}`);
    const none = await json(`/v1/memory?prefix=${encodeURIComponent(`${root()}.shared.claim.c-bad`)}`, { headers: auth(B.token) });
    assert((none.body.data.items as any[]).length === 0, 'the rejected draft was not written');
});

await test('ifVersion: 0 creates, a second 0 is refused (409 VERSION_CONFLICT) and changes nothing, the right version updates', async () => {
    const first = await invoke(EXT, 'claim', bAgentToken, { id: 'c2', port: 'p-first', ifVersion: 0 });
    assert(first.status === 200 && first.body.data.written?.version === 1, `first ${first.status}: ${JSON.stringify(first.body?.error ?? first.body.data.written)}`);
    const second = await invoke(EXT, 'claim', bAgentToken, { id: 'c2', port: 'p-second', ifVersion: 0 });
    // HOLE: compare-and-swap on the draft, refused with the service's code.
    assert(second.status === 409 && second.body?.error?.code === 'VERSION_CONFLICT', `second ${second.status}: ${JSON.stringify(second.body?.error)}`);
    const draft = await json(`/v1/memory?prefix=${encodeURIComponent(`${root()}.shared.claim.c2.`)}`, { headers: auth(B.token) });
    const rec = (draft.body.data.items as any[]).find(i => i.key === `${root()}.shared.claim.c2.draft`);
    assert(rec?.value?.port === 'p-first' && rec.version === 1, `the refused write changed nothing: ${JSON.stringify(rec)}`);
    const third = await invoke(EXT, 'claim', bAgentToken, { id: 'c2', port: 'p-third', ifVersion: 1 });
    assert(third.status === 200 && third.body.data.written?.version === 2, `third ${third.status}: ${JSON.stringify(third.body?.error ?? third.body.data.written)}`);
    assert(third.body.data.got.items[0]._draftVersion === 2, `draft version after the swap: ${JSON.stringify(third.body.data.got.items[0])}`);
});

await test('Documents: writeDoc files a draft document with a generated id, and it publishes', async () => {
    const r = await invoke(EXT, 'doc', bAgentToken);
    assert(r.status === 200, `doc ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.written?.mode === 'document' && typeof r.body.data.written.id === 'string', `doc outcome: ${JSON.stringify(r.body.data.written)}`);
    assert(r.body.data.pub?.published === `${root()}.shared.handoff.${r.body.data.written.id}`, `doc publish: ${JSON.stringify(r.body.data.pub)}`);
});

await test('Budget: every workspace call counts against maxApiCalls → API_LIMIT_EXCEEDED', async () => {
    const r = await invoke(EXT_BUDGET, 'burn', bAgentToken);
    // HOLE: a call that did not count would let 11 reads through a budget of 10 (the floor).
    assert(r.status === 500 && r.body?.error?.code === 'API_LIMIT_EXCEEDED', `burn ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('A scheduled run (nobody present) gets no ctx.workspace', async () => {
    const s = await json('/v1/schedules', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ name: `probe-${EXT}`, kind: 'extension', cron: '0 6 * * *', extension_name: EXT, action_id: 'probe' }),
    });
    assert(s.status === 201 || s.status === 200, `schedule ${s.status}: ${JSON.stringify(s.body?.error)}`);
    const scheduleId = s.body.data.schedule?.id ?? s.body.data.id;
    const t = await json(`/v1/schedules/${scheduleId}/trigger`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(t.status === 200 && t.body.data.schedule?.lastRunResult === 'success', `trigger ${t.status}: ${JSON.stringify(t.body?.data?.schedule?.lastRunError ?? t.body?.error)}`);
    const probe = await json(`/v1/memory/${encodeURIComponent(`ext:${EXT}`)}/probe`);
    assert(probe.status === 200, `probe readback ${probe.status}`);
    // GUARD, not hole: no road offered ctx.workspace before, so the old tree held this trivially.
    // What it asserts now is that the DECLARED extension, which has it on the HTTP road (see the
    // declaration test), does not get it on the clock.
    assert(probe.body.data.value?.has === false, `scheduled run saw ctx.workspace: ${JSON.stringify(probe.body.data.value)}`);
    assert(JSON.stringify(probe.body.data.value?.roles) === JSON.stringify(['operator']), `it was the unattended road: ${JSON.stringify(probe.body.data.value)}`);
    await json(`/v1/schedules/${scheduleId}`, { method: 'DELETE', headers: auth(A.token) });
});

await test('Cleanup: the four extensions are removed', async () => {
    for (const name of [EXT, EXT_NONE, EXT_READ, EXT_BUDGET]) {
        const del = await json(`/v1/extensions/${name}`, { method: 'DELETE', headers: auth(A.token) });
        assert(del.status === 200, `delete ${name} ${del.status}`);
    }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
