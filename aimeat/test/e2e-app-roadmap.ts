/**
 * @file e2e-app-roadmap.ts
 * @description The app's roadmap, the publish gate that fills it, and the listing that answers
 *   "what am I helping build".
 *
 *   The gate is the interesting one and it is asserted from both sides, because the whole decision
 *   is that the two sides differ: publishing your own app without saying what changed is a HINT in
 *   the answer, and doing it to an app somebody else helps build is a REFUSAL. The reasoning is that
 *   D2 refuses to fail a publish over a practice whose only beneficiary is the publisher, and on a
 *   shared app the person who loses by the silence is somebody else.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-roadmap
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial. Phases 4, 5 and 6 of the shared-app work.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { registerAppsTools } from '../src/cli/connect/mcp/tools/apps.js';
import { appTools } from '../src/cli/connect/tool-call-defs-apps.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
ed.hashes.sha512 = m => new Uint8Array(createHash('sha512').update(m).digest());

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(label: string, fixedName?: string) {
    const name = fixedName ?? `rm${label}${Date.now().toString(36)}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'RM', password: 'RmTest1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1200));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'RM', password: 'RmTest1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: name, password: 'RmTest1234' }) });
    assert(tok.status === 200, `login ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

const html = (s: string) => Buffer.from(`<!doctype html><meta name="viewport" content="width=device-width"><h1>${s}</h1>`).toString('base64');

async function publish(token: string, filename: string, body: string, extra: Record<string, unknown> = {}) {
    return json('/v1/apps', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ filename, name: 'Roadmap demo', description: 'roadmap e2e', content: html(body), ...extra }),
    });
}

console.log('\n=== AIMEAT app roadmap E2E ===\n');

let owner: Awaited<ReturnType<typeof setupOwner>>;
let builder: Awaited<ReturnType<typeof setupOwner>>;
let stranger: Awaited<ReturnType<typeof setupOwner>>;
const APP = 'roadmap-demo.html';
const road = () => `/v1/apps/${owner.name}/${APP}/roadmap`;

await test('setup: an owner with an app, a builder and a stranger', async () => {
    owner = await setupOwner('own');
    builder = await setupOwner('bld');
    stranger = await setupOwner('str');
    const pub = await publish(owner.token, APP, 'v1');
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
});

// ── Publishing alone ──────────────────────────────────────────────────────────────────────────────

await test('publishing your own app without a line is allowed, and says so', async () => {
    const pub = await publish(owner.token, APP, 'v2');
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}`);
    assert(typeof pub.body.data.roadmap_hint === 'string', 'the answer carries a hint rather than a refusal');
    assert(pub.body.data.roadmap_hint.includes('required'), 'and it says where it WOULD be required');
});

await test('a line carried on the publish lands on the roadmap with its version', async () => {
    const pub = await publish(owner.token, APP, 'v3', { roadmap: 'The heading fits a phone now.' });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}`);
    assert(pub.body.data.roadmap_hint === undefined, 'and there is nothing left to hint about');

    const r = await json(road(), { headers: auth(owner.token) });
    assert(r.status === 200, `read ${r.status}`);
    const done = (r.body.data.roadmap.entries as any[]).filter(e => e.state === 'done');
    assert(done.length === 1, `one done line (got ${done.length})`);
    assert(done[0].what === 'The heading fits a phone now.', 'in the words that were sent');
    assert(done[0].version === pub.body.data.version_number, 'stamped with the version it became');
});

// ── Wishes ────────────────────────────────────────────────────────────────────────────────────────

await test('anybody signed in may leave a wish', async () => {
    const r = await json(road(), {
        method: 'POST', headers: auth(stranger.token),
        body: JSON.stringify({ what: 'It would be good if it remembered my last search.' }),
    });
    assert(r.status === 201, `wish ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('but nobody outside the build says a thing IS done', async () => {
    const r = await json(road(), {
        method: 'POST', headers: auth(stranger.token),
        body: JSON.stringify({ what: 'I fixed it myself.', state: 'done' }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('the wishes are the build\'s until the owner opens them', async () => {
    const outside = await json(road(), { headers: auth(stranger.token) });
    assert(outside.status === 200, `read ${outside.status}`);
    const states = (outside.body.data.roadmap.entries as any[]).map(e => e.state);
    assert(!states.includes('wanted'), 'a reader outside the build sees the changelog only');
    assert(states.includes('done'), 'and does see the changelog');

    const open = await json(road(), {
        method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ wanted_visibility: 'everyone' }),
    });
    assert(open.status === 200, `open ${open.status}`);
    const after = await json(road(), { headers: auth(stranger.token) });
    assert((after.body.data.roadmap.entries as any[]).some(e => e.state === 'wanted'), 'and now they see the wishes too');
});

await test('somebody may withdraw their own wish, and not somebody else\'s', async () => {
    const mine = await json(road(), {
        method: 'POST', headers: auth(stranger.token),
        body: JSON.stringify({ what: 'Actually never mind this one.' }),
    });
    const id = (mine.body.data.roadmap.entries as any[])[0].id;

    const notYours = await json(`${road()}/${id}`, { method: 'DELETE', headers: auth(builder.token) });
    assert(notYours.status === 403, `expected 403 for somebody else's wish, got ${notYours.status}`);

    const yours = await json(`${road()}/${id}`, { method: 'DELETE', headers: auth(stranger.token) });
    assert(yours.status === 200 && yours.body.data.removed === true, `withdraw ${yours.status}`);
});

await test('the owner prunes anything on the list', async () => {
    const left = await json(road(), {
        method: 'POST', headers: auth(stranger.token), body: JSON.stringify({ what: 'One more idea.' }),
    });
    const id = (left.body.data.roadmap.entries as any[])[0].id;
    const r = await json(`${road()}/${id}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(r.status === 200 && r.body.data.removed === true, `owner prune ${r.status}`);
});

// ── Publishing together ───────────────────────────────────────────────────────────────────────────

await test('once somebody else builds it, a publish with no line is REFUSED', async () => {
    const grant = await json(`/v1/apps/${owner.name}/${APP}/dev-grants/${builder.name}`, {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'publisher' }),
    });
    assert(grant.status === 200, `grant ${grant.status}`);

    const pub = await publish(owner.token, APP, 'v4');
    assert(pub.status === 400, `expected 400, got ${pub.status}`);
    assert(pub.body.error?.code === 'ROADMAP_REQUIRED', `and it says which gate (got ${pub.body.error?.code})`);
});

await test('the refusal happens before anything is published', async () => {
    const versions = await json(`/v1/apps/${owner.name}/${APP}/versions`, { headers: auth(owner.token) });
    const n = (versions.body.data.versions as any[]).length;
    await publish(owner.token, APP, 'v4 again');
    const after = await json(`/v1/apps/${owner.name}/${APP}/versions`, { headers: auth(owner.token) });
    assert((after.body.data.versions as any[]).length === n, 'no version appeared from a refused publish');
});

await test('the same publish with a line goes through', async () => {
    const pub = await publish(owner.token, APP, 'v4', { roadmap: 'Search remembers the last thing you typed.' });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
});

await test('and the builder publishing into the owner\'s app owes the same line', async () => {
    const bare = await json('/v1/apps', {
        method: 'POST', headers: auth(builder.token),
        body: JSON.stringify({ filename: APP, owner: owner.name, name: 'Roadmap demo', description: 'x', content: html('by the builder') }),
    });
    assert(bare.status === 400, `expected 400, got ${bare.status}`);

    const withLine = await json('/v1/apps', {
        method: 'POST', headers: auth(builder.token),
        body: JSON.stringify({
            filename: APP, owner: owner.name, name: 'Roadmap demo', description: 'x',
            content: html('by the builder'), roadmap: 'The empty state says what to do next.',
        }),
    });
    assert(withLine.status === 200 || withLine.status === 201, `with a line ${withLine.status}: ${JSON.stringify(withLine.body?.error)}`);

    const r = await json(road(), { headers: auth(owner.token) });
    const done = (r.body.data.roadmap.entries as any[]).filter(e => e.state === 'done');
    assert(done[0].what === 'The empty state says what to do next.', 'the owner reads what the builder did');
    assert(done[0].by === builder.name, 'the note identifies the actual builder, not the app owner');
});

// ── The listing ───────────────────────────────────────────────────────────────────────────────────

await test('the apps you help build are their own answer, never mixed into your own', async () => {
    const own = await json('/v1/apps?own=true', { headers: auth(builder.token) });
    assert(own.status === 200, `own list ${own.status}`);
    assert((own.body.data.apps as any[]).every(a => a.owner === builder.name),
        'the builder\'s own list has only their own apps');

    const building = await json('/v1/apps?building=true', { headers: auth(builder.token) });
    assert(building.status === 200, `building list ${building.status}`);
    const row = (building.body.data.apps as any[]).find(a => a.filename === APP);
    assert(!!row, 'the app they were invited to build is there');
    assert(row.building_for === owner.name, `and it says whose it is (got ${row.building_for})`);
    assert(row.dev_level_name === 'publisher', `and at which rung (got ${row.dev_level_name})`);
});

await test('somebody who builds nothing gets an empty answer, not everybody\'s apps', async () => {
    const r = await json('/v1/apps?building=true', { headers: auth(stranger.token) });
    assert(r.status === 200, `list ${r.status}`);
    assert((r.body.data.apps as any[]).length === 0, `expected nothing, got ${(r.body.data.apps as any[]).length}`);
});

await test('and it needs a signed-in caller', async () => {
    const r = await json('/v1/apps?building=true');
    assert(r.status === 401, `expected 401, got ${r.status}`);
});


await test('private roadmap POST never returns another person\'s wishes', async () => {
    await json(road(), { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ wanted_visibility: 'developers' }) });
    await json(road(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ what: 'Private implementation plan.' }) });
    const result = await json(road(), { method: 'POST', headers: auth(stranger.token), body: JSON.stringify({ what: 'An outside request.' }) });
    assert(result.status === 201, `POST ${result.status}`);
    assert(!result.body.data.roadmap.entries.some((e: any) => e.state === 'wanted'), 'POST applies the same redaction as GET');
    assert(result.body.data.entry.what === 'An outside request.', 'the author receives the id of their own new wish');
});

await test('roadmap writes require an existing app', async () => {
    const result = await json(`/v1/apps/${owner.name}/missing.html/roadmap`, {
        method: 'POST', headers: auth(owner.token), body: JSON.stringify({ what: 'Cannot create an orphan.' }),
    });
    assert(result.status === 404, `missing app ${result.status}`);
});

await test('punctuation collisions do not transfer development rights or roadmaps', async () => {
    for (const filename of ['a.b.html', 'a-b.html']) {
        const pub = await publish(owner.token, filename, filename);
        assert(pub.status === 201, `setup ${pub.status}`);
    }
    await json(`/v1/apps/${owner.name}/a.b.html/dev-grants/${builder.name}`, {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'publisher' }),
    });
    const escaped = await publish(builder.token, 'a-b.html', 'unauthorized', { owner: owner.name, roadmap: 'Should not land.' });
    assert(escaped.status === 403, `colliding grant ${escaped.status}`);
    await json(`/v1/apps/${owner.name}/a-b.html/roadmap`, {
        method: 'POST', headers: auth(owner.token), body: JSON.stringify({ what: 'Unshared private plan.' }),
    });
    const other = await json(`/v1/apps/${owner.name}/a.b.html/roadmap`, { headers: auth(builder.token) });
    assert(other.status === 200 && other.body.data.roadmap === null, 'other roadmap stays separate');
});

await test('colliding owner and filename boundaries stay isolated with real accounts', async () => {
    const other = await setupOwner('collision', `${owner.name}-team`);
    assert((await publish(owner.token, 'team-app.html', 'Victim')).status === 201, 'victim published');
    assert((await publish(other.token, 'app.html', 'Other owner')).status === 201, 'other app published');
    await json(`/v1/apps/${other.name}/app.html/dev-grants/${builder.name}`, {
        method: 'PUT', headers: auth(other.token), body: JSON.stringify({ level: 'full' }),
    });
    const escaped = await publish(builder.token, 'team-app.html', 'Must not land', { owner: owner.name, roadmap: 'Not authorized.' });
    assert(escaped.status === 403, 'grant does not cross the owner boundary');
    const victimRoad = `/v1/apps/${owner.name}/team-app.html/roadmap`;
    await json(victimRoad, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ what: 'Private across owner boundaries.' }) });
    const ownRoad = `/v1/apps/${other.name}/app.html/roadmap`;
    const read = await json(ownRoad, { headers: auth(other.token) });
    assert(read.body.data.roadmap === null, 'other owner cannot read the victim roadmap');
    await json(ownRoad, { method: 'PATCH', headers: auth(other.token), body: JSON.stringify({ wanted_visibility: 'everyone' }) });
    const victim = await json(victimRoad, { headers: auth(owner.token) });
    assert(victim.body.data.roadmap.wantedVisibility === 'developers', 'changing the own roadmap cannot open the victim');
});

await test('draft seed authorizes its source as well as its destination', async () => {
    const result = await json(`/v1/apps/${owner.name}/a.b.html/draft/seed`, {
        method: 'POST', headers: auth(builder.token), body: JSON.stringify({ from_filename: 'a-b.html' }),
    });
    assert(result.status === 403, `source ${result.status}`);
    const draft = await json(`/v1/apps/${owner.name}/a.b.html/draft`, { headers: auth(owner.token) });
    assert(draft.status === 404, 'no source bytes were copied');
});

await test('a shared app cannot mint a presigned publish without a note', async () => {
    const result = await json('/v1/apps', { method: 'POST', headers: auth(builder.token),
        body: JSON.stringify({ filename: APP, owner: owner.name, mode: 'presigned' }) });
    assert(result.status === 400 && result.body.error.code === 'ROADMAP_REQUIRED', `mint ${result.status}`);
});

await test('presigned upload keeps the note, version and actual author', async () => {
    const mint = await json('/v1/apps', { method: 'POST', headers: auth(builder.token),
        body: JSON.stringify({ filename: APP, owner: owner.name, mode: 'presigned', roadmap: 'Presigned release note.' }) });
    assert(mint.status === 200, `mint ${mint.status}`);
    const upload = await fetch(mint.body.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: Buffer.from(html('uploaded'), 'base64') });
    const body = await upload.json() as any;
    assert(upload.ok, `upload ${upload.status}: ${JSON.stringify(body)}`);
    const result = await json(road(), { headers: auth(owner.token) });
    const entry = result.body.data.roadmap.entries.find((e: any) => e.what === 'Presigned release note.');
    assert(entry?.by === builder.name, 'presigned author retained');
    assert(entry.version === body.version_number || entry.version === body.data?.version_number, 'presigned version retained');
});

await test('a token minted before sharing cannot bypass the roadmap gate at upload', async () => {
    const filename = 'shared-after-mint.html';
    const made = await publish(owner.token, filename, 'initial');
    assert(made.status === 201, 'initial app created');
    const mint = await json('/v1/apps', { method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename, mode: 'presigned' }) });
    assert(mint.status === 200, 'unshared app can mint without a note');
    await json(`/v1/apps/${owner.name}/${filename}/dev-grants/${stranger.name}`, {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'drafter' }),
    });
    const upload = await fetch(mint.body.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: Buffer.from(html('too late'), 'base64') });
    assert(upload.status === 400, `upload rechecks sharing: ${upload.status}`);
    const versions = await json(`/v1/apps/${owner.name}/${filename}/versions`, { headers: auth(owner.token) });
    assert(versions.body.data.versions.length === 1, 'refused upload creates no version');
});

await test('a publisher cannot change operation settings through publishing', async () => {
    for (const settings of [{ access_code: 'new-secret-code' }, { uses_cortex: ['unauthorized-cortex'] }]) {
        const result = await publish(builder.token, APP, 'operation bypass', { owner: owner.name, roadmap: 'Must be refused.', ...settings });
        assert(result.status === 403, `operation ${JSON.stringify(settings)}: ${result.status}`);
    }
});

await test('successful concurrent roadmap additions all survive', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => json(road(), {
        method: 'POST', headers: auth(owner.token), body: JSON.stringify({ what: `Concurrent audit wish ${i}.` }),
    })));
    assert(results.every(r => r.status === 201), 'all additions acknowledged');
    const result = await json(road(), { headers: auth(owner.token) });
    assert(result.body.data.roadmap.entries.filter((e: any) => e.what.startsWith('Concurrent audit wish ')).length === 8, 'none disappeared');
});

await test('shared listing paginates and exposes drafts only for authorized apps', async () => {
    await json(`/v1/apps/${owner.name}/${APP}/draft`, { method: 'PUT', headers: auth(builder.token), body: JSON.stringify({ content: html('draft') }) });
    const first = await json('/v1/apps?building=true&limit=1', { headers: auth(builder.token) });
    const second = await json('/v1/apps?building=true&limit=1&offset=1', { headers: auth(builder.token) });
    assert(first.body.data.apps.length === 1 && second.body.data.apps.length === 1, 'limit honored');
    assert(first.body.data.apps[0].filename !== second.body.data.apps[0].filename, 'offset honored');
    const all = await json('/v1/apps?building=true', { headers: auth(builder.token) });
    assert(all.body.data.apps.find((x: any) => x.filename === APP)?.has_draft, 'builder can discover pending work');
    const grants = await json('/v1/app-dev-grants?include_apps=true', { headers: auth(owner.token) });
    assert(grants.body.data.per_app[`${owner.name}/${APP}`].some((g: any) => g.account === builder.name), 'one aggregate answer retains per-app invitations');
});

await test('node MCP publishes and promotes shared apps with the person behind the agent', async () => {
    const agent = await json('/v1/agents', { method: 'POST', headers: auth(builder.token),
        body: JSON.stringify({ name: 'roadmap-builder', owner: builder.name, capabilities: ['appdev'] }) });
    assert(agent.status === 201, `agent ${agent.status}`);
    const gaii = agent.body.data.agent.gaii;
    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'roadmap-audit', redirect_uris: [] }) });
    const timestamp = new Date().toISOString();
    const signature = Buffer.from(await ed.signAsync(new TextEncoder().encode(gaii + NODE_ID + timestamp),
        Buffer.from(agent.body.data.private_key, 'base64'))).toString('base64');
    const params = new URLSearchParams({ response_type: 'code', client_id: reg.body.client_id, gaii, timestamp, signature });
    const approval = await json(`/v1/mcp/authorize?${params}`);
    const token = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({
        grant_type: 'authorization_code', code: approval.body.code, client_id: reg.body.client_id, client_secret: reg.body.client_secret,
    }) });
    assert(typeof token.body.access_token === 'string', 'MCP authorization succeeded');
    const client = new Client({ name: 'roadmap-audit', version: '1.0.0' });
    try {
        await client.connect(new StreamableHTTPClientTransport(new URL('/v1/mcp', BASE),
            { requestInit: { headers: auth(token.body.access_token) } }));
        const refused = await client.callTool({ name: 'aimeat_app_publish', arguments: { owner: owner.name, filename: APP, name: 'Roadmap demo', content_base64: html('mcp') } });
        assert(refused.isError === true, 'MCP requires a release note');
        const made = await client.callTool({ name: 'aimeat_app_publish', arguments: {
            owner: owner.name, filename: APP, name: 'Roadmap demo', content_base64: html('mcp'), roadmap: 'Node MCP inline release.',
        } });
        assert(!made.isError, `MCP publish ${JSON.stringify(made)}`);
        const deniedSeed = await client.callTool({ name: 'aimeat_app_draft_seed', arguments: {
            owner: owner.name, filename: APP, from_filename: 'a-b.html',
        } });
        assert(deniedSeed.isError === true, 'MCP authorizes the seed source separately');
        const staged = await client.callTool({ name: 'aimeat_app_draft_save', arguments: {
            owner: owner.name, filename: APP, content_base64: html('mcp draft'),
        } });
        assert(!staged.isError, 'MCP saved the shared draft');
        const promoted = await client.callTool({ name: 'aimeat_app_draft_publish', arguments: {
            owner: owner.name, filename: APP, roadmap: 'Node MCP draft release.',
        } });
        assert(!promoted.isError, `MCP promotion ${JSON.stringify(promoted)}`);
        const result = await json(road(), { headers: auth(owner.token) });
        for (const note of ['Node MCP inline release.', 'Node MCP draft release.']) {
            assert(result.body.data.roadmap.entries.some((e: any) => e.what === note && e.by === builder.name), 'MCP records the person behind the agent');
        }
    } finally { await client.close(); }
});

await test('connector and CLI draft publication reach the real authorized REST route', async () => {
    const liveClient = {
        post: async (path: string, body?: unknown) => (await json(path, { method: 'POST', headers: auth(builder.token), body: JSON.stringify(body) })).body,
    };
    const callbacks = new Map<string, (input: Record<string, unknown>) => Promise<any>>();
    registerAppsTools({ tool: (name: string, ...args: unknown[]) => callbacks.set(name, args.at(-1) as never) } as never,
        { resolve: () => ({ owner: builder.name, client: liveClient }) } as never);
    for (const surface of ['connector', 'CLI']) {
        const staged = await json(`/v1/apps/${owner.name}/${APP}/draft`, {
            method: 'PUT', headers: auth(builder.token), body: JSON.stringify({ content: html(surface) }),
        });
        assert(staged.status === 200, 'draft staged');
        const input = { owner: owner.name, filename: APP, roadmap: `${surface} release through real REST.` };
        const out = surface === 'connector'
            ? await callbacks.get('aimeat_app_draft_publish')!(input)
            : await appTools.find(t => t.name === 'aimeat_app_draft_publish')!.handler({ client: liveClient, config: { owner: builder.name } } as never, input);
        assert(out.isError !== true && out.ok !== false, `${surface}: ${JSON.stringify(out)}`);
        const result = await json(road(), { headers: auth(owner.token) });
        assert(result.body.data.roadmap.entries.some((e: any) => e.what === input.roadmap && e.by === builder.name), `${surface} preserved destination and author`);
    }
});

await test('a former builder can withdraw a wish but cannot erase a completed change', async () => {
    const mint = await json('/v1/apps', { method: 'POST', headers: auth(builder.token),
        body: JSON.stringify({ filename: APP, owner: owner.name, mode: 'presigned', roadmap: 'A token that will be revoked.' }) });
    assert(mint.status === 200, 'token issued while authorized');
    const entry = await json(road(), { method: 'POST', headers: auth(builder.token), body: JSON.stringify({ state: 'done', what: 'A completed change.' }) });
    const id = entry.body.data.roadmap.entries[0].id;
    await json(`/v1/apps/${owner.name}/${APP}/dev-grants/${builder.name}`, { method: 'DELETE', headers: auth(owner.token) });
    const upload = await fetch(mint.body.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: Buffer.from(html('revoked'), 'base64') });
    assert(upload.status === 403, 'old upload token stops working after revocation');
    const removed = await json(`${road()}/${id}`, { method: 'DELETE', headers: auth(builder.token) });
    assert(removed.status === 403, 'revoked author cannot delete a done entry');
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
