/**
 * @file test/e2e-public-feed-exposure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What reaches the anonymous public activity feed, and what a restore puts back in
 *   front of anonymous readers (secaudit 2026-10, three findings with one shape: something becomes
 *   public that nobody decided to make public).
 *
 *   THE CONTRACT the three share is in services/public-activity.ts: a caller emits an event only
 *   when the underlying thing is genuinely public, and the event carries already-public fields only.
 *
 *   WHAT IS PROVEN.
 *     - A workspace share announces itself only when it opens to anyone with the link. A share at
 *       access 'organism' and at 'password' turns the public flag on and opens nothing, and it used
 *       to put the workspace name, the organism name and both ids on the anonymous feed
 *       (workspace-share.ts:setWorkspaceShareOp:feed-newlyPublic-ignores-access). The same share
 *       changed to 'open' then produces exactly one entry.
 *     - A completed task puts no private text on the feed. The entry named the task title, which
 *       the person who commissioned the task wrote and which the assigned agent may change, and any
 *       public record in the agent's namespace unlocked it
 *       (agent-task-fanout.ts:afterTaskCompleted:feed-copies-task-title). The entry now names the
 *       public deliverable, and only a deliverable the task produced makes one.
 *     - Taking a public record out of the bin is making it public again, so it meets the publish
 *       gate (memory-bin.ts:restoreMemoryRecord:skips-publish-gate-and-cap). The agent is refused
 *       and the record stays unreadable; the owner in person puts it back as before.
 *
 *   The node is this suite's own, because the second and third need AIMEAT_PUBLISH_GATE=agents and
 *   the shared runner node has the gate off. Anonymous mode is on, because every assertion here is
 *   read as an anonymous caller. The label cap, the other half of the restore finding, is in
 *   test/unit/memory-restore-visibility-rules.test.ts, which needs classification on.
 * @structure
 *   - Phase 1 the node, the owner (its operator) and an agent without publish:public
 *   - Phase 2 the share feed: 'organism' and 'password' say nothing, 'open' says it once
 *   - Phase 3 the task feed: no private title, and no entry for an unrelated public record
 *   - Phase 4 the bin: the agent's restore of a public record is refused, the owner's is not
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-public-feed-exposure
 * @version-history
 *   2026-10-20 — Initial (secaudit 2026-10, the three public-exposure findings).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { ownerSignIn } from './helpers/owner-login.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_PUBLIC_FEED_PORT ?? '40497';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-public-feed-exposure.db');
const STAMP = Date.now().toString(36).slice(-6);

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const short = (v: unknown): string => String(JSON.stringify(v) ?? v).slice(0, 300);
const bearer = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body };
}

const sign = async (privB64: string, message: string): Promise<string> =>
    Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');

/**
 * The feed route caches ten seconds per (category, limit), so every read asks for a limit no other
 * read in this suite asks for. Returns the summaries of one category.
 */
let limitSeed = 60;
async function feedSummaries(category: 'organisms' | 'agents'): Promise<string[]> {
    limitSeed += 1;
    const r = await json(`/v1/public/activity-feed?category=${category}&limit=${limitSeed}`);
    assert(r.status === 200, `the anonymous feed answered ${r.status}: ${short(r.body)}`);
    return (r.body?.data?.items ?? []).map((it: { summary?: string }) => it.summary ?? '');
}
/** How many entries of this category name `needle`, read once the fan-out has had its time. */
async function countOnFeed(category: 'organisms' | 'agents', needle: string, attempts = 12): Promise<number> {
    let n = 0;
    for (let i = 0; i < attempts; i++) {
        n = (await feedSummaries(category)).filter(s => s.includes(needle)).length;
        if (n > 0) return n;
        await sleep(250);
    }
    return n;
}
/** The same read for an absence: it waits the whole time rather than stopping at the first miss. */
async function absentFromFeed(category: 'organisms' | 'agents', needle: string): Promise<boolean> {
    for (let i = 0; i < 8; i++) {
        if ((await feedSummaries(category)).some(s => s.includes(needle))) return false;
        await sleep(250);
    }
    return true;
}

function cleanupDb(): void {
    for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const db = await ownNodeDb('public-feed-exposure', { sqlitePath: DB_PATH });
    const env = {
        ...process.env, ...db.env,
        AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_PUBLISH_GATE: 'agents',
        // ON, because every assertion here reads as an anonymous caller: with it off the reads are
        // 401 before anything this suite tests is consulted.
        AIMEAT_ANONYMOUS_MODE: 'true',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_GHII: '1000',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the public-feed exposure node' });
}

console.log('\n=== What reaches the anonymous public feed, and what a restore puts back ===\n');
console.log('Phase 1 — the node, the owner and the scoped agent');

const server = await startServer();

const ownerName = `pfe${STAMP}`;
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
const agentName = 'pfeagent';

await test('the owner and an agent that holds no publish:public', async () => {
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'Public Feed', password: 'PubFeed1234' }),
    });
    assert(reg.status === 201, `register ${reg.status}: ${short(reg.body)}`);
    const tok = await ownerSignIn(BASE, ownerName, 'PubFeed1234');
    assert(tok.status === 200 && tok.body.data?.token, `owner token ${tok.status}: ${short(tok.body)}`);
    ownerToken = tok.body.data.token as string;

    const agent = await json('/v1/agents', {
        method: 'POST', headers: bearer(ownerToken),
        body: JSON.stringify({
            name: agentName, owner: ownerName, model: 'gpt-4o',
            scopes: ['memory:read', 'memory:write', 'memory:delete', 'task:write'],
        }),
    });
    assert(agent.status === 201, `agent ${agent.status}: ${short(agent.body)}`);
    agentGaii = agent.body.data.agent.gaii as string;
    const scopes = agent.body.data.agent.scopes ?? agent.body.data.agent.default_scopes ?? [];
    assert(!scopes.includes('publish:public'), `the agent must not hold publish:public: ${short(scopes)}`);
    const ts = new Date().toISOString();
    const at = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp: ts, signature: await sign(agent.body.data.private_key, agentGaii + ts) }),
    });
    assert(at.status === 200 && at.body.data?.token, `agent token ${at.status}: ${short(at.body)}`);
    agentToken = at.body.data.token as string;
});

await test('the control: a public memory write by this agent is held and asked about', async () => {
    const w = await json('/v1/memory', {
        method: 'POST', headers: bearer(agentToken),
        body: JSON.stringify({ key: 'pfe.control', value: { note: 'control' }, visibility: 'public' }),
    });
    assert(w.status === 202, `a held public write answers 202: ${w.status}: ${short(w.body)}`);
    assert(w.body.data?.publish_request?.status === 'awaiting_owner',
        `the gate is off on this node: no waiting publish_request: ${short(w.body.data)}`);
});

console.log('\nPhase 2 — a share announces itself only when it opens to anyone with the link');

const WS_NAME = `Hush Workspace ${STAMP}`;
let orgId = '';
let ws = '';

await test('a private organism with one workspace', async () => {
    const o = await json('/v1/organisms', {
        method: 'POST', headers: bearer(ownerToken),
        body: JSON.stringify({ name: `Hush Organism ${STAMP}`, visibility: 'private' }),
    });
    assert(o.status === 201, `organism ${o.status}: ${short(o.body)}`);
    orgId = o.body.data.organism.id as string;
    const w = await json(`/v1/organisms/${orgId}/workspaces`, {
        method: 'POST', headers: bearer(ownerToken),
        body: JSON.stringify({
            name: WS_NAME,
            manifest: {
                manifestVersion: '1', name: WS_NAME, kind: 'project',
                objectTypes: [{ name: 'pages', namespace: 'shared.pages', schemaRef: 'schema:page@1', mode: 'document', backing: 'memory', writeRole: 'member' }],
            },
        }),
    });
    assert(w.status === 201, `workspace ${w.status}: ${short(w.body)}`);
    ws = w.body.data.ws as string;
});

const share = (body: unknown) => json(`/v1/organisms/${orgId}/workspace/share?ws=${encodeURIComponent(ws)}`, {
    method: 'PUT', headers: bearer(ownerToken), body: JSON.stringify(body),
});

await test('a share to the organism\'s own members says nothing on the anonymous feed', async () => {
    const s = await share({ public: true, access: 'organism' });
    assert(s.status === 200, `share ${s.status}: ${short(s.body)}`);
    assert(s.body.data?.share?.access === 'organism', `access: ${short(s.body.data?.share)}`);
    assert(await absentFromFeed('organisms', WS_NAME),
        'a share only the organism\'s members can read was announced to anonymous readers');
});

await test('a password-protected share says nothing either', async () => {
    const s = await share({ public: true, access: 'password', password: 'sharepass' });
    assert(s.status === 200, `share ${s.status}: ${short(s.body)}`);
    assert(s.body.data?.share?.access === 'password', `access: ${short(s.body.data?.share)}`);
    assert(await absentFromFeed('organisms', WS_NAME),
        'a share behind a password was announced to anonymous readers');
});

await test('opening the same share to anyone with the link produces exactly one entry', async () => {
    const s = await share({ access: 'open' });
    assert(s.status === 200, `share ${s.status}: ${short(s.body)}`);
    assert(s.body.data?.share?.access === 'open', `access: ${short(s.body.data?.share)}`);
    const n = await countOnFeed('organisms', WS_NAME);
    assert(n === 1, `the open share produced ${n} feed entries, expected exactly one`);
});

console.log('\nPhase 3 — a completed task puts no private text on the feed');

const PRIVATE_TITLE = `PFE-PRIVATE-TITLE-${STAMP}`;
const OLD_KEY = `pfe.old.material.${STAMP}`;
const TASK_KEY = `pfe.task.material.${STAMP}`;

/** The owner in person writes a PUBLIC record into the agent's namespace (POST /v1/memory `agent`). */
const publicUnderAgent = (key: string) => json('/v1/memory', {
    method: 'POST', headers: bearer(ownerToken),
    body: JSON.stringify({ key, value: { note: key }, visibility: 'public', agent: agentGaii }),
});
async function taskFor(title: string): Promise<string> {
    const t = await json(`/v1/agents/${agentName}/tasks`, {
        method: 'POST', headers: bearer(ownerToken),
        body: JSON.stringify({ title, description: 'Do the work and name where you put it.' }),
    });
    assert(t.status === 201, `task ${t.status}: ${short(t.body)}`);
    const id = t.body.data?.task?.id as string;
    assert(typeof id === 'string' && id.length > 0, `no task id: ${short(t.body.data)}`);
    const s = await json(`/v1/agents/${agentName}/tasks/${id}/start`, { method: 'POST', headers: bearer(ownerToken) });
    assert(s.status === 200, `start ${s.status}: ${short(s.body)}`);
    return id;
}
const complete = (id: string, key: string) => json(`/v1/agents/${agentName}/tasks/${id}/complete`, {
    method: 'POST', headers: bearer(agentToken),
    body: JSON.stringify({ message: 'Done.', deliverable_key: key }),
});

await test('a task completed with an unrelated public record of the agent reaches no feed entry', async () => {
    const w = await publicUnderAgent(OLD_KEY);
    assert(w.status === 201, `the owner's public write under the agent ${w.status}: ${short(w.body)}`);
    assert(w.body.data?.visibility === 'public', `the owner's own write was not public: ${short(w.body.data)}`);
    // The record has to pre-date the task: that is the whole of "unrelated" the node can see.
    await sleep(1100);

    const id = await taskFor(PRIVATE_TITLE);
    const done = await complete(id, OLD_KEY);
    assert(done.status === 200, `complete ${done.status}: ${short(done.body)}`);

    assert(await absentFromFeed('agents', PRIVATE_TITLE),
        'the task title, which the owner wrote and the agent may rewrite, reached the anonymous feed');
    assert(await absentFromFeed('agents', OLD_KEY),
        'a public record the task did not produce put an entry on the anonymous feed');
});

await test('a deliverable the task produced is announced, by its key and not by the title', async () => {
    const title = `PFE-SECOND-TITLE-${STAMP}`;
    const id = await taskFor(title);
    const w = await publicUnderAgent(TASK_KEY);
    assert(w.status === 201, `the deliverable ${w.status}: ${short(w.body)}`);

    const done = await complete(id, TASK_KEY);
    assert(done.status === 200, `complete ${done.status}: ${short(done.body)}`);

    const n = await countOnFeed('agents', TASK_KEY);
    assert(n === 1, `the public deliverable produced ${n} feed entries, expected exactly one`);
    assert(await absentFromFeed('agents', title), `the second task's title reached the feed`);
});

console.log('\nPhase 4 — taking a public record out of the bin meets the publish gate');

const BIN_KEY = `pfe.binned.${STAMP}`;
const anonRead = () => json(`/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(BIN_KEY)}`);

await test('the owner writes a public record under the agent and bins it', async () => {
    const w = await publicUnderAgent(BIN_KEY);
    assert(w.status === 201, `write ${w.status}: ${short(w.body)}`);
    const before = await anonRead();
    assert(before.status === 200, `an anonymous reader could not read the public record: ${before.status} ${short(before.body)}`);

    const d = await json(`/v1/memory/${encodeURIComponent(BIN_KEY)}?owner_scope=true`, { method: 'DELETE', headers: bearer(ownerToken) });
    assert(d.status === 200, `delete ${d.status}: ${short(d.body)}`);
    const after = await anonRead();
    assert(after.status !== 200, `the binned record is still readable: ${after.status} ${short(after.body)}`);
});

await test('the agent\'s restore is refused, and the record stays unreadable', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(BIN_KEY)}/restore`, { method: 'POST', headers: bearer(agentToken) });
    assert(r.status === 403, `expected 403, got ${r.status}: ${short(r.body)}`);
    assert(r.body.error?.code === 'PUBLISH_NOT_ALLOWED', `code: ${short(r.body.error)}`);
    const anon = await anonRead();
    assert(anon.status !== 200, `the refused restore made the record public again: ${anon.status} ${short(anon.body)}`);
});

await test('the owner in person puts it back, and it is public again', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(BIN_KEY)}/restore?owner_scope=true`, { method: 'POST', headers: bearer(ownerToken) });
    assert(r.status === 200, `the owner's own restore was refused: ${r.status}: ${short(r.body)}`);
    const anon = await anonRead();
    assert(anon.status === 200, `the owner's restore did not bring the public record back: ${anon.status} ${short(anon.body)}`);
    assert(anon.body.data?.visibility === 'public', `visibility after the restore: ${short(anon.body.data)}`);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
server.kill();
await new Promise<void>(r => setTimeout(r, 300));
cleanupDb();
process.exit(failed > 0 ? 1 : 0);
