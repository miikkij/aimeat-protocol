/**
 * @file e2e-anonymous-member-reads.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app listed to this node's members (listing 'community') is read by signed-in
 *   members and their agents, and not by the shared anonymous credential, on MCP as on REST
 *   (secaudit2026oct26, aimeat_datamap_get minted-anonymous-token-counted-as-member). The minted
 *   anonymous token is an agent session on MCP, and aimeat_datamap_get and aimeat_app_get counted it
 *   as a member. The uses that stay: the anonymous token reads an app listed to everyone and its data
 *   map, and writes its own anonymous.* memory; another owner's agent reads the community app and its
 *   map.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-anonymous-member-reads
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36);
const ownerA = `anmra${stamp}`;
const ownerB = `anmrb${stamp}`;
const COMMUNITY = 'members-map.html';
const LISTED = 'everyone-map.html';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

const as = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

const MAP = {
    spec: 'aimeat.datamap/2', what: 'A page that shows a note.', usedFor: 'Reading one note.', form: 'one-person',
    arrangement: 'It reads one record of the person and keeps nothing else.', machinery: [], leaves: [], elsewhere: [],
    held: [{
        what: 'the note', holds: 'one short text', kind: 'user-written', usedFor: 'user-returns-to-read',
        where: 'owner-memory-private', owner: 'person', readers: 'owner-only', writers: ['the-person'],
        shape: 'one-per-thing', keptFor: 'until-deleted', lossRisk: 'only-copy', personalData: 'no',
        why: 'The page shows what the person wrote.',
    }],
};

console.log('\n=== The anonymous credential and apps listed to members (MCP and REST) ===\n');

let tokenA = '';
let anonToken = '';
let anonMcp: Awaited<ReturnType<typeof openSession>> | null = null;
let memberMcp: Awaited<ReturnType<typeof openSession>> | null = null;

await test('fixture: a community app and an everyone app with data maps, an agent of another owner, a minted anonymous token', async () => {
    tokenA = (await registerOwner(BASE, ownerA)).token;
    const b = await registerOwner(BASE, ownerB);
    for (const [file, listing] of [[COMMUNITY, 'community'], [LISTED, 'listed']] as const) {
        const pub = await json('/v1/apps', as(tokenA, {
            method: 'POST',
            body: JSON.stringify({ filename: file, content: Buffer.from(`<h1>${file}</h1>`).toString('base64'), name: file, description: 'A page that shows one note.', category: 'utility', tags: [] }),
        }));
        assert(pub.status === 201, `publish ${file}: ${pub.status} ${JSON.stringify(pub.body?.error)}`);
        const patch = await json(`/v1/apps/${file}`, as(tokenA, { method: 'PATCH', body: JSON.stringify({ listing }) }));
        assert(patch.status === 200 && patch.body.data?.listing === listing, `listing ${file}: ${patch.status} ${JSON.stringify(patch.body?.error ?? patch.body?.data)}`);
        const put = await json(`/v1/datamap/apps/${ownerA}/${file}`, as(tokenA, { method: 'PUT', body: JSON.stringify(MAP) }));
        assert(put.status === 200, `map ${file}: ${put.status} ${JSON.stringify(put.body?.error)}`);
    }
    const agent = await makeAgent(BASE, { name: ownerB, token: b.token }, ['memory:read', 'memory:write', 'apps:read']);
    memberMcp = await openSession(BASE, agent.token, 'e2e-anon-member-reads-member');
    const anon = await json('/v1/auth/anonymous', { method: 'POST' });
    assert(anon.status === 200 && typeof anon.body.data?.token === 'string', `anonymous token: ${anon.status} (anonymous mode must be on)`);
    anonToken = anon.body.data.token;
    anonMcp = await openSession(BASE, anonToken, 'e2e-anon-member-reads-anon');
});

await test('REST GET /v1/datamap/apps of a community app: the minted token gets 404 (the rule MCP must follow)', async () => {
    const r = await json(`/v1/datamap/apps/${ownerA}/${COMMUNITY}`, as(anonToken));
    assert(r.status === 404, `minted token REST map: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data).slice(0, 200)}`);
});

await test('MCP aimeat_datamap_get of a community app: the minted anonymous token is answered as not found', async () => {
    const r = await callTool(anonMcp!, 'aimeat_datamap_get', { app: `${ownerA}/${COMMUNITY}` });
    assert(r.offered, `the tool is offered to the anonymous token: ${r.text.slice(0, 200)}`);
    assert(r.isError && r.data?.data_map === undefined, `minted token MCP map: ${r.text.slice(0, 200)}`);
});

await test('MCP aimeat_app_get of a community app: the minted anonymous token is answered as not found', async () => {
    const r = await callTool(anonMcp!, 'aimeat_app_get', { owner: ownerA, filename: COMMUNITY });
    assert(r.isError && /not found/i.test(r.text), `minted token MCP app: ${r.text.slice(0, 200)}`);
});

const listedNames = async (session: Awaited<ReturnType<typeof openSession>>) => {
    const r = await callTool(session, 'aimeat_app_list', { search: 'map', limit: 200 });
    assert(!r.isError, `app list: ${r.text.slice(0, 200)}`);
    return ((r.data?.apps ?? []) as any[]).filter(a => a.owner === ownerA).map(a => a.filename as string);
};

await test('MCP aimeat_app_list: the minted anonymous token does not list the community app', async () => {
    const names = await listedNames(anonMcp!);
    assert(!names.includes(COMMUNITY), `minted token lists: ${names.join(', ')}`);
});

await test('usage: MCP aimeat_app_list lists the everyone app to the anonymous token, and both apps to a member\'s agent', async () => {
    const anon = await listedNames(anonMcp!);
    assert(anon.includes(LISTED), `minted token lists: ${anon.join(', ')}`);
    const member = await listedNames(memberMcp!);
    assert(member.includes(LISTED) && member.includes(COMMUNITY), `member agent lists: ${member.join(', ')}`);
});

await test('usage: the minted anonymous token still reads an app listed to everyone and its map over MCP', async () => {
    const map = await callTool(anonMcp!, 'aimeat_datamap_get', { app: `${ownerA}/${LISTED}` });
    assert(!map.isError && map.data?.data_map?.spec === 'aimeat.datamap/2', `listed map: ${map.text.slice(0, 200)}`);
    const app = await callTool(anonMcp!, 'aimeat_app_get', { owner: ownerA, filename: LISTED });
    assert(!app.isError, `listed app: ${app.text.slice(0, 200)}`);
});

await test('usage: an agent of another signed-in owner still reads the community app and its map over MCP', async () => {
    const map = await callTool(memberMcp!, 'aimeat_datamap_get', { app: `${ownerA}/${COMMUNITY}` });
    assert(!map.isError && map.data?.data_map?.spec === 'aimeat.datamap/2', `member map: ${map.text.slice(0, 200)}`);
    const app = await callTool(memberMcp!, 'aimeat_app_get', { owner: ownerA, filename: COMMUNITY });
    assert(!app.isError, `member app: ${app.text.slice(0, 200)}`);
});

await test('usage: the minted anonymous token still writes and reads its own anonymous.* memory over MCP', async () => {
    const key = `anonymous.member-reads-${stamp}`;
    const w = await callTool(anonMcp!, 'aimeat_memory_write', { key, value: { n: 1 } });
    assert(!w.isError, `anonymous write: ${w.text.slice(0, 200)}`);
    const r = await callTool(anonMcp!, 'aimeat_memory_read', { key });
    assert(!r.isError && /"n"\s*:\s*1/.test(r.text), `anonymous read: ${r.text.slice(0, 200)}`);
});

console.log('\n' + '─'.repeat(40));
console.log(`Anonymous member reads E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
