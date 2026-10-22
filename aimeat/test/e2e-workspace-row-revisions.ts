/**
 * @file e2e-workspace-row-revisions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A row replaced by another writer family is kept as a revision, and the delete
 *   authority lists and restores it, on REST and MCP (secaudit 2026-10, v80; developer ruling
 *   2026-10-22: no new refusal and no approval step).
 *
 *   THE HOLE. An append with a caller-chosen rowId replaces the stored row. B's agent held
 *   organism:write and a contributor grant, and not memory:purge: the row DELETE refused it, and the
 *   same agent then re-appended under A's rowId and removed A's content for good, with its own name
 *   in createdBy.
 *
 *   What it proves, the fix half (marked `// FIX:`, red with the fix disabled):
 *     - B's agent re-appending A's row over REST and over MCP still writes, and the answer names the
 *       row in revisions_kept; the row keeps A as createdBy and names the agent in updatedBy;
 *     - A lists the revision with A's original body, and restores it; the restore keeps the content
 *       it replaced in turn;
 *     - the agent without memory:purge is refused the list and the restore on REST and over MCP;
 *       a stranger in person is refused both; B's agent that holds memory:purge lists and restores
 *       over MCP;
 *     - a replacement inside one writer family keeps no revision; deleting a row takes its
 *       revisions with it.
 *   The uses half (marked `// USE:`, green with and without the fix):
 *     - an owner re-appends their own row, and their own agent re-appends it: replaced in place;
 *     - a team member's app moves a queue row that the owner's batch filed (AIMEAT.refinery move());
 *     - an app re-sends its own event with a stable rowId: one row, replaced.
 *   The extension re-ingest and the refinery batch are held by test/e2e-extension-rows.ts and
 *   test/e2e-refinery.ts, and the family rule for an extension by test/unit/workspace-row-revisions.test.ts.
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v80).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-row-revisions

import { createHash, randomBytes } from 'node:crypto';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const FILENAME = 'queue-demo.html';
const REDIRECT = 'http://localhost:9922/callback';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** The full app-grant flow, as a person approving `scopes` for the app `owner/FILENAME`. */
async function grantApp(personToken: string, appOwner: string, scopes: string[]): Promise<string> {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({
        app: `${appOwner}/${FILENAME}`, response_type: 'code', scope: scopes.join(' '),
        redirect_uri: REDIRECT, state: 'x', code_challenge: challenge, code_challenge_method: 'S256',
    });
    const auth = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    assert(auth.status === 302, `authorize: ${auth.status}`);
    const rid = decodeURIComponent(/req=([^&]+)/.exec(auth.headers.get('location') ?? '')![1]);
    const con = await json('/v1/app-grants/authorize-consent', {
        method: 'POST', headers: bearer(personToken), body: JSON.stringify({ request_id: rid }),
    });
    assert(con.status === 200 && con.body.ok, `consent: ${con.status} ${JSON.stringify(con.body)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }),
    });
    assert(tok.status === 200 && tok.body.ok, `token: ${tok.status} ${JSON.stringify(tok.body)}`);
    return tok.body.data.access_token as string;
}

console.log('\n=== Workspace row revisions E2E ===\n');

let A!: RegisteredOwner;     // the organism's creator, who wrote the rows
let B!: RegisteredOwner;     // a member with a contributor grant
let C!: RegisteredOwner;     // a stranger
let agentA!: McpAgent;       // A's own agent: the same writer family as A
let agentB!: McpAgent;       // B's agent without memory:purge: the record's attacker
let purgerB!: McpAgent;      // B's agent with memory:purge: whoever may remove rows
let sessionB!: McpSession;
let sessionPurger!: McpSession;
let appOfB = '';             // B's grant of A's app, organism:rows
let orgId = '';
let WS = '';

const logUrl = (suffix = '') => `/v1/organisms/${orgId}/workspace/rows/log${suffix}?ws=${WS}`;
const queueUrl = (suffix = '', qs = '') => `/v1/organisms/${orgId}/workspace/rows/queue${suffix}?ws=${WS}${qs}`;
const revisionsUrl = (space: string, rowId: string) => `/v1/organisms/${orgId}/workspace/rows/${space}/${rowId}/revisions?ws=${WS}`;
const restoreAs = (token: string, space: string, rowId: string, rev: string) =>
    json(`/v1/organisms/${orgId}/workspace/rows/${space}/${rowId}/revisions/${rev}/restore?ws=${WS}`, { method: 'POST', headers: bearer(token), body: '{}' });
const readRow = async (url: string) => {
    const r = await json(url, { headers: bearer(A.token) });
    assert(r.status === 200, `read ${url}: ${r.status} ${JSON.stringify(r.body.error ?? r.body)}`);
    return r.body.data.row as { rowId: string; createdBy: string; updatedBy?: string; body: Record<string, unknown>; createdAt: string };
};
const appendAs = (token: string, url: string, rowId: string, body: Record<string, unknown>) =>
    json(url, { method: 'POST', headers: bearer(token), body: JSON.stringify({ row_id: rowId, body }) });

await test('Setup: an organism with a row log and a queue the app may write, B a contributor, three agents and an app grant', async () => {
    A = await registerOwner(BASE, `rrva${Date.now() % 100000}`);
    B = await registerOwner(BASE, `rrvb${Date.now() % 100000}`);
    C = await registerOwner(BASE, `rrvc${Date.now() % 100000}`);
    const o = await json('/v1/organisms', {
        method: 'POST', headers: bearer(A.token),
        body: JSON.stringify({ name: 'Row Revisions', description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'private' }),
    });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body.error ?? o.body)}`);
    orgId = o.body.data.organism.id;
    const w = await json(`/v1/organisms/${orgId}/workspaces`, {
        method: 'POST', headers: bearer(A.token),
        body: JSON.stringify({ name: 'Revisions', manifest: { objectTypes: [
            { name: 'log', schemaRef: 'schema:log@1', namespace: 'ops.log', backing: 'rows', writeRole: 'member', mode: 'records', indexOn: ['stream'] },
            { name: 'queue', schemaRef: 'schema:queue@1', namespace: 'ops.queue', backing: 'rows', writeRole: 'member', mode: 'records',
              indexOn: ['queue'], apps: [`${A.name}/${FILENAME}`] },
        ] } }),
    });
    assert(w.status === 201, `workspace ${w.status}: ${JSON.stringify(w.body.error ?? w.body)}`);
    WS = w.body.data.ws;
    const add = await json(`/v1/organisms/${orgId}/members`, { method: 'POST', headers: bearer(A.token), body: JSON.stringify({ ghii: B.name }) });
    assert(add.status === 201, `add B: ${add.status} ${JSON.stringify(add.body.error ?? add.body)}`);
    const g = await json(`/v1/organisms/${orgId}/workspace-access/grant`, {
        method: 'POST', headers: bearer(A.token), body: JSON.stringify({ ws: WS, grantee: B.name, role: 'contributor' }),
    });
    assert(g.status === 200, `contributor grant ${g.status}: ${JSON.stringify(g.body.error ?? g.body)}`);
    const pub = await json('/v1/apps', {
        method: 'POST', headers: bearer(A.token),
        body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>queue</body></html>'), name: 'Queue Demo', description: 'queue rows', category: 'utility' }),
    });
    assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body.error ?? pub.body)}`);

    agentA = await makeAgent(BASE, A, ['organism:read', 'organism:write', 'memory:read', 'memory:write']);
    agentB = await makeAgent(BASE, B, ['organism:read', 'organism:write', 'memory:read', 'memory:write']);
    purgerB = await makeAgent(BASE, B, ['organism:read', 'organism:write', 'memory:read', 'memory:purge']);
    sessionB = await openSession(BASE, agentB.token, 'rowrev-b');
    sessionPurger = await openSession(BASE, purgerB.token, 'rowrev-purger');
    appOfB = await grantApp(B.token, A.name, ['memory:read', 'organism:rows']);

    const seeded = await appendAs(A.token, logUrl(), 'r-1', { stream: 's-1', msg: 'original written by A' });
    assert(seeded.status === 200 && seeded.body.data.written === 1, `seed ${seeded.status}: ${JSON.stringify(seeded.body.error ?? seeded.body)}`);
});

// ── The uses that must keep working, with and without the fix ─────────────────

await test('USE: the owner re-appends their own row, and it is replaced in place', async () => {
    const r = await appendAs(A.token, logUrl(), 'r-own', { stream: 's-1', msg: 'v1' });
    assert(r.status === 200, `first ${r.status}`);
    const again = await appendAs(A.token, logUrl(), 'r-own', { stream: 's-1', msg: 'v2' });
    assert(again.status === 200 && again.body.data.written === 1, `re-append ${again.status}: ${JSON.stringify(again.body.error ?? again.body)}`);
    const row = await readRow(logUrl('/r-own'));
    assert(row.body.msg === 'v2' && row.createdBy === A.ghii, `replaced in place by A: ${JSON.stringify(row)}`);
});

await test('USE: the owner\'s own agent re-appends the owner\'s row, and it is replaced in place', async () => {
    const r = await appendAs(agentA.token, logUrl(), 'r-own', { stream: 's-1', msg: 'v3 by A\'s agent' });
    assert(r.status === 200 && r.body.data.written === 1, `agent re-append ${r.status}: ${JSON.stringify(r.body.error ?? r.body)}`);
    const row = await readRow(logUrl('/r-own'));
    assert(row.body.msg === 'v3 by A\'s agent', `replaced: ${JSON.stringify(row.body)}`);
    // Within one writer family nothing about the row's author changed: the new writer is createdBy, as before.
    assert(row.createdBy === agentA.gaii, `createdBy within the family: ${row.createdBy}`);
});

await test('USE: a team member\'s app moves a queue row that the owner\'s batch filed', async () => {
    // The refinery batch writes a queue row as the owner GHII; AIMEAT.refinery move() re-appends the
    // same row id with the queue changed, from a member's browser on that member's app grant.
    const filed = await appendAs(A.token, queueUrl(), 'mail:m-1', { messageId: 'm-1', queue: 'review', status: 'review', subject: 'Invoice' });
    assert(filed.status === 200, `filed ${filed.status}: ${JSON.stringify(filed.body.error ?? filed.body)}`);
    const moved = await appendAs(appOfB, queueUrl(), 'mail:m-1', { messageId: 'm-1', queue: 'approved', status: 'approved', subject: 'Invoice' });
    assert(moved.status === 200 && moved.body.data.written === 1, `move ${moved.status}: ${JSON.stringify(moved.body.error ?? moved.body)}`);
    const row = await readRow(queueUrl('/mail:m-1'));
    assert(row.body.queue === 'approved', `the row is in its new queue: ${JSON.stringify(row.body)}`);
    const approved = await json(queueUrl('', '&queue=approved'), { headers: bearer(appOfB) });
    assert(approved.status === 200 && approved.body.data.rows.length === 1, `the app reads it in the approved queue: ${approved.status} ${JSON.stringify(approved.body.error ?? approved.body.data)}`);
});

await test('USE: an app re-sends its own event with a stable row id, and the space holds one row for it', async () => {
    const first = await appendAs(appOfB, queueUrl(), 'evt-1', { queue: 'log', kind: 'opened' });
    assert(first.status === 200, `first ${first.status}: ${JSON.stringify(first.body.error ?? first.body)}`);
    const again = await appendAs(appOfB, queueUrl(), 'evt-1', { queue: 'log', kind: 'opened again' });
    assert(again.status === 200 && again.body.data.written === 1, `again ${again.status}`);
    const page = await json(queueUrl('', '&queue=log'), { headers: bearer(appOfB) });
    assert(page.status === 200 && page.body.data.rows.length === 1 && page.body.data.rows[0].body.kind === 'opened again',
        `one row, replaced: ${JSON.stringify(page.body.data?.rows)}`);
});

// ── The hole, and the way back ─────────────────────────────────────────────────

await test('B\'s agent without memory:purge is refused the row delete (the control)', async () => {
    const del = await json(logUrl('/r-1'), { method: 'DELETE', headers: bearer(agentB.token) });
    assert(del.status === 403, `delete ${del.status}: ${JSON.stringify(del.body.error ?? del.body)}`);
    const row = await readRow(logUrl('/r-1'));
    assert(row.body.msg === 'original written by A', `A's row is unchanged: ${JSON.stringify(row.body)}`);
});

await test('B\'s agent re-appends A\'s row over REST: it is written, and the node keeps A\'s content', async () => {
    const r = await appendAs(agentB.token, logUrl(), 'r-1', { stream: 's-1', msg: 'replaced by B agent (REST)' });
    // The design keeps the replacement: no new refusal (developer ruling 2026-10-22).
    assert(r.status === 200 && r.body.data.written === 1, `append ${r.status}: ${JSON.stringify(r.body.error ?? r.body)}`);
    // FIX: the answer names the row whose content it kept.
    assert(JSON.stringify(r.body.data.revisions_kept) === JSON.stringify(['r-1']), `revisions_kept: ${JSON.stringify(r.body.data)}`);
    const row = await readRow(logUrl('/r-1'));
    assert(row.body.msg === 'replaced by B agent (REST)', `the row holds the new content: ${JSON.stringify(row.body)}`);
    // FIX: the row keeps its first author, and names the new writer.
    assert(row.createdBy === A.ghii, `createdBy stays A: ${row.createdBy}`);
    assert(row.updatedBy === agentB.gaii, `updatedBy names B's agent: ${row.updatedBy}`);
});

let firstRevision = '';
await test('A lists the row\'s revisions and finds the original content', async () => {
    const r = await json(revisionsUrl('log', 'r-1'), { headers: bearer(A.token) });
    // FIX: the route did not exist.
    assert(r.status === 200, `list ${r.status}: ${JSON.stringify(r.body.error ?? r.body)}`);
    const revs = r.body.data.revisions as Array<{ revisionId: string; body: { msg: string }; updatedBy: string; replacedBy: string; createdBy: string }>;
    assert(revs.length === 1, `one revision: ${JSON.stringify(revs)}`);
    assert(revs[0].body.msg === 'original written by A' && revs[0].updatedBy === A.ghii && revs[0].createdBy === A.ghii,
        `the original content, written by A: ${JSON.stringify(revs[0])}`);
    assert(revs[0].replacedBy === agentB.gaii, `replaced by B's agent: ${revs[0].replacedBy}`);
    firstRevision = revs[0].revisionId;
});

await test('The agent without memory:purge is refused the list and the restore, on REST and over MCP', async () => {
    const list = await json(revisionsUrl('log', 'r-1'), { headers: bearer(agentB.token) });
    assert(list.status === 403 && /memory:purge/.test(JSON.stringify(list.body.error)), `REST list: ${list.status} ${JSON.stringify(list.body.error ?? list.body)}`);
    const restore = await restoreAs(agentB.token, 'log', 'r-1', firstRevision || 'x');
    assert(restore.status === 403, `REST restore: ${restore.status} ${JSON.stringify(restore.body.error ?? restore.body)}`);
    const mcpList = await callTool(sessionB, 'aimeat_workspace_rows_revisions', { organism_id: orgId, ws: WS, space: 'log', row_id: 'r-1' });
    assert(mcpList.isError && !mcpList.text.includes('original written by A'), `MCP list: ${mcpList.text.slice(0, 200)}`);
    const mcpRestore = await callTool(sessionB, 'aimeat_workspace_rows_restore', { organism_id: orgId, ws: WS, space: 'log', row_id: 'r-1', revision_id: firstRevision || 'x' });
    assert(mcpRestore.isError, `MCP restore: ${mcpRestore.text.slice(0, 200)}`);
});

await test('A stranger in person is refused the list and the restore', async () => {
    const list = await json(revisionsUrl('log', 'r-1'), { headers: bearer(C.token) });
    assert(list.status === 403 || list.status === 404, `stranger list: ${list.status} ${JSON.stringify(list.body.error ?? list.body)}`);
    assert(!JSON.stringify(list.body).includes('original written by A'), 'no revision body rode the refusal');
    const restore = await restoreAs(C.token, 'log', 'r-1', firstRevision || 'x');
    assert(restore.status === 403 || restore.status === 404, `stranger restore: ${restore.status}`);
});

await test('A restores the original; the content it replaced is kept in turn', async () => {
    const r = await restoreAs(A.token, 'log', 'r-1', firstRevision);
    // FIX: the route did not exist.
    assert(r.status === 200 && r.body.data.restored === firstRevision && r.body.data.revision_kept === true,
        `restore ${r.status}: ${JSON.stringify(r.body.error ?? r.body)}`);
    const row = await readRow(logUrl('/r-1'));
    assert(row.body.msg === 'original written by A', `A's content is back: ${JSON.stringify(row.body)}`);
    assert(row.createdBy === A.ghii && row.updatedBy === A.ghii, `authors: ${row.createdBy} / ${row.updatedBy}`);
    const list = await json(revisionsUrl('log', 'r-1'), { headers: bearer(A.token) });
    const bodies = (list.body.data.revisions as Array<{ body: { msg: string } }>).map(v => v.body.msg);
    assert(bodies.length === 2 && bodies[0] === 'replaced by B agent (REST)', `the agent's content is kept too: ${JSON.stringify(bodies)}`);
    const s = await json(logUrl('/stats'), { headers: bearer(A.token) });
    assert(s.body.data.stats.rows === 2, `still two rows (r-1, r-own): ${s.body.data.stats.rows}`);
});

await test('B\'s agent re-appends A\'s row over MCP: written, and A\'s content is kept', async () => {
    const r = await callTool(sessionB, 'aimeat_workspace_rows_append', {
        organism_id: orgId, ws: WS, space: 'log', row_id: 'r-1', body: { stream: 's-1', msg: 'replaced by B agent (MCP)' },
    });
    assert(!r.isError && r.data.written === 1, `MCP append: ${r.text.slice(0, 200)}`);
    // FIX
    assert(JSON.stringify(r.data.revisions_kept) === JSON.stringify(['r-1']), `MCP revisions_kept: ${r.text.slice(0, 200)}`);
    const row = await readRow(logUrl('/r-1'));
    assert(row.createdBy === A.ghii && row.updatedBy === agentB.gaii, `authors after MCP: ${row.createdBy} / ${row.updatedBy}`);
});

await test('B\'s agent that holds memory:purge lists and restores over MCP', async () => {
    const list = await callTool(sessionPurger, 'aimeat_workspace_rows_revisions', { organism_id: orgId, ws: WS, space: 'log', row_id: 'r-1' });
    // FIX: the tool did not exist.
    assert(!list.isError && Array.isArray(list.data.revisions), `MCP list: ${list.text.slice(0, 300)}`);
    const original = (list.data.revisions as Array<{ revisionId: string; body: { msg: string } }>).find(v => v.body.msg === 'original written by A');
    assert(!!original, `A's content is listed: ${list.text.slice(0, 300)}`);
    const restored = await callTool(sessionPurger, 'aimeat_workspace_rows_restore', {
        organism_id: orgId, ws: WS, space: 'log', row_id: 'r-1', revision_id: original!.revisionId,
    });
    assert(!restored.isError && restored.data.restored === original!.revisionId, `MCP restore: ${restored.text.slice(0, 300)}`);
    const row = await readRow(logUrl('/r-1'));
    assert(row.body.msg === 'original written by A' && row.updatedBy === purgerB.gaii && row.createdBy === A.ghii,
        `restored over MCP: ${JSON.stringify(row)}`);
});

await test('A replacement inside one writer family keeps no revision', async () => {
    // FIX: the list route, and an empty answer for a row only A and A's agent wrote.
    const list = await json(revisionsUrl('log', 'r-own'), { headers: bearer(A.token) });
    assert(list.status === 200 && list.body.data.revisions.length === 0, `no revision of r-own: ${list.status} ${JSON.stringify(list.body.error ?? list.body.data)}`);
    const r = await appendAs(A.token, logUrl(), 'r-own', { stream: 's-1', msg: 'v4' });
    assert(r.status === 200 && JSON.stringify(r.body.data.revisions_kept) === '[]', `same family: ${JSON.stringify(r.body.data)}`);
});

await test('The app\'s move across families kept the batch\'s row, and the row keeps its first author', async () => {
    const row = await readRow(queueUrl('/mail:m-1'));
    // FIX
    assert(row.createdBy === A.ghii && row.updatedBy === B.ghii, `authors: ${row.createdBy} / ${row.updatedBy}`);
    const list = await json(revisionsUrl('queue', 'mail:m-1'), { headers: bearer(A.token) });
    assert(list.status === 200 && list.body.data.revisions.length === 1 && list.body.data.revisions[0].body.queue === 'review',
        `the filed content is kept: ${list.status} ${JSON.stringify(list.body.error ?? list.body.data)}`);
    // An app never lists or restores revisions, as it never removes rows.
    const byApp = await json(revisionsUrl('queue', 'mail:m-1'), { headers: bearer(appOfB) });
    assert(byApp.status === 403, `the app is refused the list: ${byApp.status}`);
});

await test('Deleting a row takes its revisions with it', async () => {
    const del = await json(logUrl('/r-1'), { method: 'DELETE', headers: bearer(A.token) });
    assert(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body.error ?? del.body)}`);
    const list = await json(revisionsUrl('log', 'r-1'), { headers: bearer(A.token) });
    // FIX
    assert(list.status === 200 && list.body.data.revisions.length === 0, `no revisions left: ${list.status} ${JSON.stringify(list.body.error ?? list.body.data)}`);
});

await test('Cleanup', async () => {
    if (orgId) await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: bearer(A.token) });
    for (const o of [A, B, C]) if (o) await json(`/v1/owners/${o.name}`, { method: 'DELETE', headers: bearer(o.token) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
