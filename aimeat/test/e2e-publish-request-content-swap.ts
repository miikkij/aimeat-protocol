/**
 * @file test/e2e-publish-request-content-swap.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A skill or cortex publish request publishes only the content the owner was asked
 *   about, also when the content behind it is swapped under the same version.
 *
 *   WHY THIS SUITE EXISTS. Both appliers bound an approval to the version alone. A user skill deleted
 *   and published again under the same name starts at 1.0.0 again, so a sibling agent swapped the
 *   text behind a waiting request and the owner's approval made the new text public (secaudit 2026-10,
 *   apply-skill.ts:applySkillPublish:semver-restarts-on-delete-recreate). A cortex took a new manifest
 *   under the same version through PUT, and an uninstall and install again at the same version
 *   brought other libraries, and the approval published either (apply-cortex.ts:applyCortexPublish:
 *   version-not-bound-to-manifest-or-reinstalled-libs). The gate asks the owner only on a node with
 *   AIMEAT_PUBLISH_GATE=agents, so this suite starts one.
 *
 *   WHAT IS PROVEN. The delete (DELETE /v1/skills/:name, DELETE /v1/cortex/:name) settles the waiting
 *   request `outdated` at once; the content digest the request was filed with refuses the approval of
 *   a cortex whose manifest changed under the same version (409 OUTDATED). Each time the swapped
 *   content stays unreadable to anyone else. The uses that stay: an unchanged request applies, a
 *   cortex re-sent with identical bytes or activated while the request waits still applies, a skill
 *   republished by the asker files again and that request applies, and the owner in person and an
 *   agent holding publish:public publish at once. A request filed before the digest existed is
 *   test/unit/publish-request-content-binding.test.ts.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-publish-request-content-swap
 * @version-history
 *   2026-10-25 — Another account reads A's cortex by its full name `<A>/<short>`, as names live in the
 *     owner's namespace (secaudit2026oct22).
 *   2026-10-22 — The asking agent and a sibling without publish:public are refused the approval with a
 *     403, and the request still waits (check:denial-coverage).
 *   2026-10-22 — Initial (secaudit 2026-10, apply-skill.ts:applySkillPublish:semver-restarts-on-delete-recreate,
 *     apply-cortex.ts:applyCortexPublish:version-not-bound-to-manifest-or-reinstalled-libs).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';

const PORT = process.env.E2E_CONTENT_SWAP_PORT ?? '40954';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-publish-request-content-swap.db');
const STAMP = Date.now().toString(36).slice(-6);

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const short = (v: unknown): string => String(JSON.stringify(v) ?? v).slice(0, 300);

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<{ status: number; body: Body }> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}

function cleanupDb(): void {
    for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const db = await ownNodeDb('publish-content-swap', { sqlitePath: DB_PATH });
    const env = {
        ...process.env, ...db.env,
        AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_PUBLISH_GATE: 'agents',
        // ON, because the skill proof is an anonymous read: with it off every unauthenticated read is
        // 401 whatever the skill's level, which proves nothing here.
        AIMEAT_ANONYMOUS_MODE: 'true',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_GHII: '1000',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the publish content-swap node' });
}

console.log('\n=== A skill or cortex publish request publishes only what the owner was asked about ===\n');
console.log('Phase 1: the node, owner A with three agents, owner B');

const server = await startServer();

let A!: Awaited<ReturnType<typeof registerOwner>>;
let B!: Awaited<ReturnType<typeof registerOwner>>;
let asker!: Awaited<ReturnType<typeof makeAgent>>;
let sibling!: Awaited<ReturnType<typeof makeAgent>>;
let publisher!: Awaited<ReturnType<typeof makeAgent>>;
const WORDS = ['memory:read', 'memory:write', 'cortex:write'];

await test('owner A with an asking agent, a sibling agent (neither holds publish:public) and a publishing agent; owner B', async () => {
    A = await registerOwner(BASE, `pcsa${STAMP}`);
    B = await registerOwner(BASE, `pcsb${STAMP}`);
    asker = await makeAgent(BASE, A, WORDS);
    sibling = await makeAgent(BASE, A, WORDS);
    publisher = await makeAgent(BASE, A, [...WORDS, 'publish:public']);
});

const approve = (id: string) => call(`/v1/publish-requests/${id}/decision`, { token: A.token, method: 'POST', body: { decision: 'approve' } });
const requestState = async (id: string): Promise<string | undefined> =>
    (await call(`/v1/publish-requests/${id}`, { token: A.token })).body?.data?.request?.state;

/** A publish request answer: 202, the request waiting for the owner. Returns its id. */
function asked(r: { status: number; body: Body }, what: string): string {
    assert(r.status === 202, `${what}: ${r.status} ${short(r.body.error ?? r.body.data)}`);
    const pr = r.body.data?.publish_request;
    assert(pr?.status === 'awaiting_owner' && typeof pr.request_id === 'string', `${what}: no request ${short(pr)}`);
    return pr.request_id as string;
}

const skillMd = (name: string, line: string) => `---
name: ${name}
description: How to write a short brief for this team. Use when asked to draft a brief.
---

# Brief

${line}
`;
const anonSkill = (name: string) => call(`/v1/skills/${name}?scope=user&owner=${encodeURIComponent(A.name)}`);
const publishSkill = (token: string, name: string, line: string, visibility?: string) =>
    call('/v1/skills', { token, body: { skill_md: skillMd(name, line), ...(visibility ? { visibility } : {}) } });

console.log('\nPhase 2: user skills');

await test('POSITIVE CONTROL: the owner approves an unchanged skill request, and anyone reads the skill', async () => {
    const name = `pcs-ok-${STAMP}`;
    const id = asked(await publishSkill(asker.token, name, 'The approved text.', 'public'), 'publish');
    assert((await anonSkill(name)).status !== 200, 'anonymous reads the waiting skill');
    const d = await approve(id);
    assert(d.status === 200 && d.body.data?.request?.state === 'approved', `approve: ${d.status} ${short(d.body)}`);
    const anon = await anonSkill(name);
    assert(anon.status === 200 && JSON.stringify(anon.body).includes('The approved text.'), `anonymous read: ${anon.status} ${short(anon.body)}`);
});

await test('SECURITY: a sibling agent deletes the skill and publishes other text under its name: the request is outdated and the approval publishes nothing', async () => {
    const name = `pcs-swap-${STAMP}`;
    const id = asked(await publishSkill(asker.token, name, 'The approved text.', 'public'), 'publish');
    const del = await call(`/v1/skills/${name}`, { token: sibling.token, method: 'DELETE' });
    assert(del.status === 200, `delete: ${del.status} ${short(del.body)}`);
    assert(await requestState(id) === 'outdated', `the delete settles the waiting request: ${await requestState(id)}`);
    const re = await publishSkill(sibling.token, name, 'SWAPPED text nobody approved.');
    assert(re.status === 201 && re.body.data?.skill?.version === '1.0.0' && re.body.data?.skill?.visibility === 'owner',
        `re-create at 1.0.0: ${re.status} ${short(re.body.data ?? re.body.error)}`);
    const d = await approve(id);
    assert(d.status === 409, `the approval of the old request: ${d.status} ${short(d.body)}`);
    const anon = await anonSkill(name);
    assert(anon.status !== 200, `the swapped skill went public: ${anon.status} ${short(anon.body)}`);
});

await test('KEPT: the asker republishes the skill while its request waits, asks again, and that request applies', async () => {
    const name = `pcs-again-${STAMP}`;
    const first = asked(await publishSkill(asker.token, name, 'The first text.', 'public'), 'publish');
    const second = asked(await publishSkill(asker.token, name, 'The second text.', 'public'), 'republish');
    assert(second === first, `the same principal asking again moves its standing request: ${first} vs ${second}`);
    const d = await approve(second);
    assert(d.status === 200 && d.body.data?.request?.state === 'approved', `approve: ${d.status} ${short(d.body)}`);
    const anon = await anonSkill(name);
    assert(anon.status === 200 && JSON.stringify(anon.body).includes('The second text.'), `anonymous read: ${anon.status} ${short(anon.body)}`);
});

await test('SECURITY: the asking agent cannot approve its own request and the sibling without publish:public cannot approve it (403 each); the request still waits', async () => {
    const name = `pcs-self-${STAMP}`;
    const id = asked(await publishSkill(asker.token, name, 'The asked text.', 'public'), 'publish');
    const decide = (token: string) => call(`/v1/publish-requests/${id}/decision`, { token, method: 'POST', body: { decision: 'approve' } });
    const own = await decide(asker.token);
    assert(own.status === 403 && own.body.error?.code === 'OWN_REQUEST', `the asker's own approval: ${own.status} ${short(own.body)}`);
    const sib = await decide(sibling.token);
    assert(sib.status === 403 && sib.body.error?.code === 'SCOPE_DENIED', `the sibling's approval: ${sib.status} ${short(sib.body)}`);
    assert(await requestState(id) === 'awaiting_owner', `the request after the refusals: ${await requestState(id)}`);
    assert((await anonSkill(name)).status !== 200, 'the skill went public');
});

await test('KEPT: the owner in person and the agent holding publish:public publish a skill public at once', async () => {
    const o = await publishSkill(A.token, `pcs-own-${STAMP}`, 'Owner text.', 'public');
    assert(o.status === 201 && o.body.data?.skill?.visibility === 'public', `owner: ${o.status} ${short(o.body.error)}`);
    const p = await publishSkill(publisher.token, `pcs-pub-${STAMP}`, 'Publisher text.', 'public');
    assert(p.status === 201 && p.body.data?.skill?.visibility === 'public', `publisher: ${p.status} ${short(p.body.error)}`);
});

console.log('\nPhase 3: cortex libraries');

const cortexManifest = (name: string, description: string, visibility = 'public') => `apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${name}
  namespace: ${A.name}
  description: ${description}
  visibility: ${visibility}
spec:
  version: "1.0.0"
  components:
    - type: lib
      name: helper
      filename: helper.js
      exports: [hello]
      api_surface: hello()
`;
const lib = (word: string) => ({ 'helper.js': `export function hello() { return "${word}"; }` });
const install = (token: string, name: string, description: string, word = 'hi') =>
    call('/v1/cortex', { token, method: 'POST', body: { manifest: cortexManifest(name, description), libs: lib(word) } });
/** The cortex as another account reads it, by the full name `<A>/<short>`: 200 only when it is public. */
const otherReads = (name: string) => call(`/v1/cortex/${encodeURIComponent(`${A.name}/${name}`)}`, { token: B.token });

await test('POSITIVE CONTROL: the owner approves an unchanged cortex request, and another account reads it', async () => {
    const name = `pcs-cx-ok-${STAMP}`;
    const id = asked(await install(asker.token, name, 'ORIGINAL'), 'install');
    assert((await otherReads(name)).status === 404, 'another account sees the waiting cortex');
    const d = await approve(id);
    assert(d.status === 200 && d.body.data?.request?.state === 'approved', `approve: ${d.status} ${short(d.body)}`);
    const other = await otherReads(name);
    assert(other.status === 200 && JSON.stringify(other.body).includes('ORIGINAL'), `another account: ${other.status} ${short(other.body)}`);
});

await test('KEPT: a cortex re-sent with identical bytes and activated while its request waits still approves', async () => {
    const name = `pcs-cx-same-${STAMP}`;
    const id = asked(await install(asker.token, name, 'ORIGINAL'), 'install');
    const put = await call(`/v1/cortex/${name}`, { token: asker.token, method: 'PUT', body: { manifest: cortexManifest(name, 'ORIGINAL'), libs: lib('hi') } });
    assert(put.status === 200 && put.body.data?.action === 'unchanged', `identical PUT: ${put.status} ${short(put.body.data ?? put.body.error)}`);
    const act = await call(`/v1/cortex/${name}/activate`, { token: A.token, method: 'POST', body: {} });
    assert(act.status === 200, `activate: ${act.status} ${short(act.body.error ?? act.body.data)}`);
    const d = await approve(id);
    assert(d.status === 200 && d.body.data?.request?.state === 'approved', `approve: ${d.status} ${short(d.body)}`);
    assert((await otherReads(name)).status === 200, 'another account reads the approved cortex');
});

await test('SECURITY: a new manifest under the same version while the request waits: the approval answers 409 OUTDATED', async () => {
    const name = `pcs-cx-put-${STAMP}`;
    const id = asked(await install(asker.token, name, 'ORIGINAL'), 'install');
    // Private in the new manifest, so the PUT asks nothing and only swaps the content under 1.0.0.
    const put = await call(`/v1/cortex/${name}`, { token: sibling.token, method: 'PUT', body: { manifest: cortexManifest(name, 'REPLACED', 'private'), libs: lib('hi') } });
    assert(put.status === 200 && put.body.data?.action === 'updated', `same-version PUT: ${put.status} ${short(put.body.data ?? put.body.error)}`);
    assert(await requestState(id) === 'awaiting_owner', `this path leaves the request waiting: ${await requestState(id)}`);
    const d = await approve(id);
    assert(d.status === 409 && d.body.error?.code === 'OUTDATED', `the approval: ${d.status} ${short(d.body)}`);
    assert((await otherReads(name)).status === 404, 'the replaced cortex went public');
});

await test('SECURITY: uninstalled and installed again at the same version with other libraries: the request is outdated and the approval publishes nothing', async () => {
    const name = `pcs-cx-re-${STAMP}`;
    const id = asked(await install(asker.token, name, 'ORIGINAL'), 'install');
    const del = await call(`/v1/cortex/${name}`, { token: sibling.token, method: 'DELETE' });
    assert(del.status === 200, `uninstall: ${del.status} ${short(del.body)}`);
    assert(await requestState(id) === 'outdated', `the uninstall settles the waiting request: ${await requestState(id)}`);
    const again = await call('/v1/cortex', { token: sibling.token, method: 'POST', body: { manifest: cortexManifest(name, 'REINSTALLED', 'private'), libs: lib('swapped') } });
    assert(again.status === 201, `install again: ${again.status} ${short(again.body.error)}`);
    const d = await approve(id);
    assert(d.status === 409, `the approval of the old request: ${d.status} ${short(d.body)}`);
    assert((await otherReads(name)).status === 404, 'the reinstalled cortex went public');
});

await test('KEPT: the owner in person and the agent holding publish:public install a cortex public at once', async () => {
    const o = await install(A.token, `pcs-cx-own-${STAMP}`, 'OWNER');
    assert(o.status === 201 && o.body.data?.visibility === 'public', `owner: ${o.status} ${short(o.body.error)}`);
    const p = await install(publisher.token, `pcs-cx-pub-${STAMP}`, 'PUBLISHER');
    assert(p.status === 201 && p.body.data?.visibility === 'public', `publisher: ${p.status} ${short(p.body.error)}`);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
server.kill();
await new Promise<void>(r => setTimeout(r, 300));
cleanupDb();
process.exit(failed > 0 ? 1 : 0);
