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
 *   2026-11-01 — Skills at 'members' and the board roster: aimeat_skill_list, aimeat_skill_get and
 *     aimeat_board_list answer the minted anonymous token what GET /v1/skills, GET /v1/skills/:name
 *     and GET /v1/boards answer it (secaudit2026oct31w2 round 11).
 *   2026-10-31 — A Design Book part in proposal: aimeat_designbook_search and aimeat_designbook_get answer
 *     the minted anonymous token as the REST reads do (secaudit2026oct31w2 round 10, W2-3).
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, mcpRpc } from './helpers/mcp-session.js';

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

// ─── A Design Book part still in proposal (secaudit2026oct31w2 round 10, W2-3) ───
// REST shows a part that is not published only to a signed-in reader (routes/designbook.ts isSignedIn),
// and the minted anonymous token is not one. aimeat_designbook_search and aimeat_designbook_get must
// answer that token the same.
const proposedPart = `anon-mr-proposed-${stamp}`;
const partBody = {
    v: 1, look: 'editorial',
    blocks: [
        { id: 'top', component: 'hero', props: { title: '<App name>', sub: '<One line on what it is>' } },
        { id: 'items', component: 'list', props: { source: '<prefix>.items' }, span: 'main' },
    ],
};

await test('fixture: an owner proposes a Design Book part, and REST hides it from the minted token (404)', async () => {
    const own = await json('/v1/designbook', as(tokenA, {
        method: 'POST',
        body: JSON.stringify({ part: { id: proposedPart, kind: 'fill', title: 'Anon member reads fill', summary: 'A cover over a list.', body: partBody } }),
    }));
    assert(own.status === 201 && own.body.data?.part?.status !== 'published', `owner propose: ${own.status} ${JSON.stringify(own.body?.error ?? own.body?.data?.part?.status)}`);
    const rest = await json(`/v1/designbook/${proposedPart}`, as(anonToken));
    assert(rest.status === 404, `minted token REST get: ${rest.status}`);
});

await test('MCP aimeat_designbook_get of a part in proposal: the minted anonymous token is answered NOT_FOUND, as on REST', async () => {
    const r = await callTool(anonMcp!, 'aimeat_designbook_get', { id: proposedPart });
    assert(r.offered, `the tool is offered to the anonymous token: ${r.text.slice(0, 200)}`);
    assert(r.isError && /^NOT_FOUND: /.test(r.text) && !r.text.includes('Anon member reads fill'), `minted token MCP get: ${r.text.slice(0, 200)}`);
});

await test('MCP aimeat_designbook_search: the minted anonymous token finds no part in proposal, by word or by status', async () => {
    const byWord = await callTool(anonMcp!, 'aimeat_designbook_search', { q: proposedPart });
    assert(!byWord.text.includes(proposedPart), `minted token search by word: ${byWord.text.slice(0, 200)}`);
    const byStatus = await callTool(anonMcp!, 'aimeat_designbook_search', { status: 'proposed', limit: 200 });
    assert(!byStatus.text.includes(proposedPart), `minted token search by status: ${byStatus.text.slice(0, 200)}`);
    const parts = (byStatus.data?.parts ?? []) as any[];
    assert(parts.every(p => p.status === 'published'), `minted token sees a part not published: ${JSON.stringify(parts.map(p => p.status))}`);
});

await test('usage: an agent of another signed-in owner still reads and finds the part in proposal over MCP', async () => {
    const r = await callTool(memberMcp!, 'aimeat_designbook_get', { id: proposedPart });
    assert(!r.isError && r.text.includes(proposedPart), `member agent get: ${r.text.slice(0, 200)}`);
    const s = await callTool(memberMcp!, 'aimeat_designbook_search', { status: 'proposed', q: proposedPart });
    assert(!s.isError && s.text.includes(proposedPart), `member agent search: ${s.text.slice(0, 200)}`);
});

await test('usage: the minted anonymous token still reads the published shelf, a published part and the reasons over MCP', async () => {
    const map = await callTool(anonMcp!, 'aimeat_designbook_search', {});
    assert(!map.isError && map.text.length > 0, `map view: ${map.text.slice(0, 200)}`);
    const pub = await callTool(anonMcp!, 'aimeat_designbook_search', { status: 'published', limit: 5 });
    const first = ((pub.data?.parts ?? []) as any[])[0];
    assert(!pub.isError && first?.id, `published search: ${pub.text.slice(0, 200)}`);
    const one = await callTool(anonMcp!, 'aimeat_designbook_get', { id: first.id });
    assert(!one.isError && one.text.includes(first.id), `published get: ${one.text.slice(0, 200)}`);
    const reasons = await callTool(anonMcp!, 'aimeat_designbook_search', { view: 'reasons' });
    assert(!reasons.isError, `reasons view: ${reasons.text.slice(0, 200)}`);
    await json(`/v1/designbook/${proposedPart}`, as(tokenA, { method: 'DELETE' }));
});

// ─── Skills at 'members' (secaudit2026oct31w2 round 11, mcp-skills) ───
// GET /v1/skills and GET /v1/skills/:name read the minted anonymous token as a reader with no account
// (routes/skills.ts accessorOf), so a node skill or a user skill at 'members' is not shown to it.
// aimeat_skill_list and aimeat_skill_get must answer that token the same.
const membersSkill = `anon-mr-members-${stamp}`;
const publicSkill = `anon-mr-public-${stamp}`;
const skillText = (name: string) => `---\nname: ${name}\ndescription: A skill for the anonymous member reads suite. Use when testing.\n---\n\n# ${name}\n\nNothing to do.\n`;
let membersNodeSkill = '';
const libraryNodeNames = (lib: any): string[] => ((lib?.node ?? []) as any[]).map(s => s.name as string).sort();

await test('fixture: an owner publishes a skill at members and one at public; REST hides the members ones from the minted token', async () => {
    for (const [name, visibility] of [[membersSkill, 'members'], [publicSkill, 'public']] as const) {
        const r = await json('/v1/skills', as(tokenA, { method: 'POST', body: JSON.stringify({ skill_md: skillText(name), visibility }) }));
        assert(r.status === 201 || r.status === 200, `publish ${name}: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data).slice(0, 200)}`);
    }
    const hidden = await json(`/v1/skills/${membersSkill}?scope=user&owner=${ownerA}`, as(anonToken));
    assert(hidden.status !== 200, `minted token REST get of a members skill: ${hidden.status}`);
    const shown = await json(`/v1/skills/${publicSkill}?scope=user&owner=${ownerA}`, as(anonToken));
    assert(shown.status === 200, `minted token REST get of a public skill: ${shown.status} ${JSON.stringify(shown.body?.error)}`);
    const anonLib = await json('/v1/skills', as(anonToken));
    const memberLib = await json('/v1/skills', as(tokenA));
    const anonNames = libraryNodeNames(anonLib.body.data?.library);
    membersNodeSkill = libraryNodeNames(memberLib.body.data?.library).find(n => !anonNames.includes(n)) ?? '';
    assert(membersNodeSkill !== '', `a node skill at members exists (built-ins are seeded at members): ${anonNames.join(', ')}`);
});

await test('MCP aimeat_skill_get of a user skill and a node skill at members: the minted anonymous token gets neither', async () => {
    const user = await callTool(anonMcp!, 'aimeat_skill_get', { ref: `user:${ownerA}/${membersSkill}` });
    assert(user.offered, `the tool is offered to the anonymous token: ${user.text.slice(0, 200)}`);
    assert(user.isError && !user.text.includes('Nothing to do.'), `minted token MCP get of a user members skill: ${user.text.slice(0, 200)}`);
    const node = await callTool(anonMcp!, 'aimeat_skill_get', { ref: `node:${membersNodeSkill}` });
    assert(node.isError && node.data?.skill === undefined, `minted token MCP get of a node members skill: ${node.text.slice(0, 200)}`);
    const byName = await callTool(anonMcp!, 'aimeat_skill_get', { name: membersNodeSkill });
    assert(byName.isError && byName.data?.skill === undefined, `minted token MCP get by name: ${byName.text.slice(0, 200)}`);
});

await test('MCP aimeat_skill_list: the minted anonymous token lists the node skills GET /v1/skills lists it, no members one', async () => {
    const r = await callTool(anonMcp!, 'aimeat_skill_list', { view: 'library' });
    assert(!r.isError, `minted token MCP library: ${r.text.slice(0, 200)}`);
    const mcpNames = libraryNodeNames(r.data?.library);
    const rest = libraryNodeNames((await json('/v1/skills', as(anonToken))).body.data?.library);
    assert(!mcpNames.includes(membersNodeSkill), `minted token MCP library lists a members node skill: ${membersNodeSkill}`);
    assert(JSON.stringify(mcpNames) === JSON.stringify(rest), `MCP ${mcpNames.join(', ')} vs REST ${rest.join(', ')}`);
});

await test('usage: the minted anonymous token still reads a public skill over MCP, and still cannot publish', async () => {
    const r = await callTool(anonMcp!, 'aimeat_skill_get', { ref: `user:${ownerA}/${publicSkill}` });
    assert(!r.isError && r.data?.skill?.name === publicSkill, `minted token MCP get of a public skill: ${r.text.slice(0, 200)}`);
    const pub = await callTool(anonMcp!, 'aimeat_skill_publish', { skill_md: skillText(`anon-mr-try-${stamp}`) });
    assert(pub.isError && /AUTH_REQUIRED/.test(pub.text), `minted token MCP publish: ${pub.text.slice(0, 200)}`);
});

await test('usage: an agent of another signed-in owner still lists and reads both members skills over MCP', async () => {
    const user = await callTool(memberMcp!, 'aimeat_skill_get', { ref: `user:${ownerA}/${membersSkill}` });
    assert(!user.isError && user.data?.skill?.name === membersSkill, `member agent get of a user members skill: ${user.text.slice(0, 200)}`);
    const node = await callTool(memberMcp!, 'aimeat_skill_get', { ref: `node:${membersNodeSkill}` });
    assert(!node.isError && node.data?.skill?.name === membersNodeSkill, `member agent get of a node members skill: ${node.text.slice(0, 200)}`);
    const lib = await callTool(memberMcp!, 'aimeat_skill_list', { view: 'library' });
    assert(!lib.isError && libraryNodeNames(lib.data?.library).includes(membersNodeSkill), `member agent library: ${lib.text.slice(0, 200)}`);
    for (const name of [membersSkill, publicSkill]) await json(`/v1/skills/${name}`, as(tokenA, { method: 'DELETE' }));
});

// ─── The board roster (secaudit2026oct31w2 round 11, mcp-boards) ───
// GET /v1/boards treats the minted anonymous token as signed out: it lists public and system boards
// only, without owner_gaii and allowed_gaiis. aimeat_board_list must answer that token the same.
let rosterPublicBoard = '';
let anonAllowedBoard = '';
let memberAgentGaii = '';

await test('fixture: an owner opens a public board with an allowed list and a private board that names the anonymous agent', async () => {
    const helper = await makeAgent(BASE, { name: ownerA, token: tokenA }, ['memory:read']);
    memberAgentGaii = helper.gaii;
    const nodeId = helper.gaii.split('@')[1];
    const boards = [
        ['public', [memberAgentGaii]],
        ['private', [`shared#anonymous@${nodeId}`]],
    ] as const;
    for (const [visibility, allowed] of boards) {
        const r = await json('/v1/boards', as(tokenA, { method: 'POST', body: JSON.stringify({ name: `anon-mr-${visibility}-${stamp}`, visibility, allowed_gaiis: allowed }) }));
        assert(r.status === 201, `create ${visibility} board: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data).slice(0, 200)}`);
        if (visibility === 'public') rosterPublicBoard = r.body.data.id; else anonAllowedBoard = r.body.data.id;
    }
});

await test('MCP aimeat_board_list: the minted anonymous token gets no roster and only the boards GET /v1/boards lists it', async () => {
    const r = await callTool(anonMcp!, 'aimeat_board_list', {});
    assert(r.offered && !r.isError && Array.isArray(r.data), `minted token MCP board list: ${r.text.slice(0, 200)}`);
    const listed = r.data as any[];
    const pub = listed.find(b => b.id === rosterPublicBoard);
    assert(pub !== undefined, `the public board is listed to the minted token over MCP`);
    const withRoster = listed.filter(b => b.owner_gaii !== undefined || b.allowed_gaiis !== undefined);
    assert(withRoster.length === 0, `roster handed to the minted token: ${JSON.stringify(withRoster.slice(0, 2))}`);
    assert(!listed.some(b => b.id === anonAllowedBoard), 'a private board is listed to the minted token over MCP');
    const rest = ((await json('/v1/boards', as(anonToken))).body.data?.boards ?? []) as any[];
    const ids = (xs: any[]) => xs.map(b => b.id as string).sort();
    assert(JSON.stringify(ids(listed)) === JSON.stringify(ids(rest)), `MCP ${ids(listed).length} boards vs REST ${ids(rest).length}`);
});

await test('MCP board posts resource of the private board: the minted anonymous token is refused, as on REST', async () => {
    const rest = await json(`/v1/boards/${anonAllowedBoard}/posts`, as(anonToken));
    assert(rest.status === 401, `minted token REST posts: ${rest.status}`);
    const body = await mcpRpc(anonMcp!, 'resources/read', { uri: `aimeat://boards/${encodeURIComponent(anonAllowedBoard)}` });
    const text = String(body?.result?.contents?.[0]?.text ?? JSON.stringify(body?.error ?? body));
    assert(/ACCESS_DENIED|not shared with you/i.test(text) || body?.error !== undefined, `minted token MCP resource: ${text.slice(0, 200)}`);
});

await test('usage: the minted anonymous token still reads the public board\'s posts over MCP', async () => {
    const body = await mcpRpc(anonMcp!, 'resources/read', { uri: `aimeat://boards/${encodeURIComponent(rosterPublicBoard)}` });
    const text = String(body?.result?.contents?.[0]?.text ?? '');
    assert(body?.error === undefined && text.trim().startsWith('['), `minted token MCP public board posts: ${text.slice(0, 200)}`);
});

await test('usage: an agent of a signed-in owner still gets the roster over MCP', async () => {
    const r = await callTool(memberMcp!, 'aimeat_board_list', {});
    const pub = ((r.data ?? []) as any[]).find(b => b.id === rosterPublicBoard);
    assert(!r.isError && pub && typeof pub.owner_gaii === 'string' && Array.isArray(pub.allowed_gaiis) && pub.allowed_gaiis.includes(memberAgentGaii),
        `member agent board list: ${JSON.stringify(pub ?? r.text.slice(0, 200))}`);
    for (const id of [rosterPublicBoard, anonAllowedBoard]) await json(`/v1/boards/${id}`, as(tokenA, { method: 'DELETE' }));
});

console.log('\n' + '─'.repeat(40));
console.log(`Anonymous member reads E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
