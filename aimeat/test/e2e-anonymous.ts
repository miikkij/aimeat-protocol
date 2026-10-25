// E2E tests for Anonymous Node Mode (AIMEAT_ANONYMOUS=true)
// Requires server running with AIMEAT_ANONYMOUS=true on port 40251
// Run: cd aimeat && AIMEAT_ANONYMOUS=true PORT=40251 npx tsx src/index.ts
// Then: cd aimeat && npx tsx test/e2e-anonymous.ts

import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

const ANON_GAII = `shared#anonymous@${NODE_ID}`;

console.log('\n=== AIMEAT Anonymous Mode E2E Test ===\n');
console.log(`Base: ${BASE}`);
console.log(`Expected GAII: ${ANON_GAII}\n`);

// ─── Phase 1: Bootstrap & Anonymous Identity ───
console.log('Phase 1 — Bootstrap & Anonymous Identity');

await test('Bootstrap endpoint works', async () => {
    // GET / content-negotiates: without an Accept: application/json it serves the SPA HTML, the
    // json() helper's ct.includes('json') branch never runs, and body.ok is undefined. The helper
    // only ever sent Content-Type, which says nothing about what the caller wants back.
    const { status, body } = await json('/', { headers: { Accept: 'application/json' } });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, `Expected ok: true — got ${JSON.stringify(body).slice(0, 120)}`);
    assert(body.protocol === 'aimeat', `Expected the AIMEAT bootstrap envelope, got protocol ${JSON.stringify(body.protocol)}`);
});

await test('Anonymous agent exists in agent list', async () => {
    const { status, body } = await json(`/v1/agents/${encodeURIComponent(ANON_GAII)}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.gaii === ANON_GAII, `Expected gaii ${ANON_GAII}, got ${body.data.gaii}`);
    assert(body.data.display_name === 'Shared Anonymous Agent', `Unexpected display_name: ${body.data.display_name}`);
});

// ─── Phase 2: Memory CRUD with anonymous auth ───
console.log('\nPhase 2 — Memory CRUD (anonymous auth)');

let anonToken = '';
await test('Get anonymous auth token', async () => {
    const { status, body } = await json('/v1/auth/anonymous', { method: 'POST' });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data.token === 'string', 'Expected anonymous JWT');
    anonToken = body.data.token;
});

function anonAuth(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${anonToken}` } };
}

const testKey = `anonymous.test-${Date.now()}`;

await test('Write memory with anonymous auth', async () => {
    const { status, body } = await json('/v1/memory', anonAuth({
        method: 'POST',
        body: JSON.stringify({ key: testKey, value: { message: 'hello from anonymous' }, visibility: 'public', tags: ['test'] }),
    }));
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data.key === testKey, `Expected key ${testKey}`);
    assert(body.data.version === 1, 'Expected version 1');
    assert(body.data.created_at !== undefined, 'Expected created_at');
    assert(body.data.updated_at !== undefined, 'Expected updated_at');
});

await test('Read memory with anonymous auth', async () => {
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(testKey)}`, anonAuth());
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.key === testKey, `Expected key ${testKey}`);
    assert(body.data.value.message === 'hello from anonymous', 'Expected correct value');
    assert(body.data.version === 1, 'Expected version 1');
});

await test('List memory with anonymous auth', async () => {
    const { status, body } = await json('/v1/memory', anonAuth());
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.items.length > 0, 'Expected at least one memory entry');
    const found = body.data.items.find((it: any) => it.key === testKey);
    assert(found, `Expected to find key ${testKey} in list`);
});

await test('Search memory with anonymous auth', async () => {
    const { status, body } = await json(`/v1/memory/search?q=anonymous`, anonAuth());
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.results !== undefined, 'Expected results array');
});

await test('Update memory with PUT and anonymous auth', async () => {
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(testKey)}`, anonAuth({
        method: 'PUT',
        body: JSON.stringify({ value: { message: 'updated anonymous data' }, version: 1 }),
    }));
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data.version === 2, 'Expected version 2');
});

await test('Delete memory with anonymous auth', async () => {
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(testKey)}`, anonAuth({
        method: 'DELETE',
    }));
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.deleted === true, 'Expected deleted: true');
});

await test('Deleted memory returns 404', async () => {
    const { status } = await json(`/v1/memory/${encodeURIComponent(testKey)}`, anonAuth());
    assert(status === 404, `Expected 404, got ${status}`);
});

// ─── Phase 2b: Storage namespace fence ───
// The shared anonymous identity may only write under anonymous/*. The fence must hold for BOTH
// upload representations: inline base64 AND the presigned mint. It used to be applied only after the
// presigned branch returned early, so asking for an upload URL walked straight past it — a gate on
// the write must not be skippable by choosing a different way to perform the same write.
console.log('\nPhase 2b — Storage namespace fence (anonymous/*)');

await test('Anonymous inline upload OUTSIDE anonymous/* → 403', async () => {
    const { status, body } = await json('/v1/storage', anonAuth({
        method: 'POST',
        body: JSON.stringify({ key: 'escaped/inline.txt', data: Buffer.from('nope').toString('base64'), mime_type: 'text/plain' }),
    }));
    assert(status === 403, `Expected 403, got ${status}: ${JSON.stringify(body)}`);
});

await test('Anonymous PRESIGNED mint OUTSIDE anonymous/* → 403, no token issued', async () => {
    const { status, body } = await json('/v1/storage', anonAuth({
        method: 'POST',
        body: JSON.stringify({ key: 'escaped/presigned.txt', mime_type: 'text/plain', mode: 'presigned' }),
    }));
    assert(status === 403, `Expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(!body.data?.upload_url, 'A refused mint must not hand back an upload_url');
});

await test('Anonymous PRESIGNED mint INSIDE anonymous/* still works end to end', async () => {
    const key = `anonymous/presigned-${Date.now()}.txt`;
    const mint = await json('/v1/storage', anonAuth({
        method: 'POST',
        body: JSON.stringify({ key, mime_type: 'text/plain', mode: 'presigned' }),
    }));
    assert(mint.status === 200, `Expected 200, got ${mint.status}: ${JSON.stringify(mint.body)}`);
    assert(mint.body.data?.upload_url, 'Expected an upload_url');
    const put = await fetch(mint.body.data.upload_url, {
        method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'allowed',
    });
    assert(put.status === 200, `Expected PUT 200, got ${put.status}`);
    const result = await put.json() as { success?: boolean; key?: string; size?: number };
    assert(result.success === true && result.key === key, `Expected the file stored under ${key}, got ${JSON.stringify(result)}`);
    assert(result.size === 7, `Expected 7 raw bytes (no base64 inflation), got ${result.size}`);
});

// ─── Phase 3: The people directory is for signed-in members ───
// secaudit 2026-10, jwt.ts:issueJWT:anonymous-claim-not-signed. The token POST /v1/auth/anonymous
// mints carries no anonymous claim, so requireAuth() took it for an ordinary agent, and with
// catalogue:read it listed the people directory, which the route keeps for signed-in members, on
// REST and over MCP. Both are refused now by the principal's identity; the memory flows above keep
// working with the same token, and a signed-in owner and their agent still read the directory.
console.log('\nPhase 3 — People directory (signed-in members only)');

const dirOwner = await (async () => {
    try { return await registerOwner(BASE, `anondir${Date.now().toString(36)}`); }
    catch (err) { console.error(`  fixture: ${(err as Error).message}`); return null; }
})();

await test('Anonymous token → GET /v1/catalogue/directory is 401 AUTH_REQUIRED', async () => {
    const { status, body } = await json('/v1/catalogue/directory?type=people', anonAuth());
    assert(status === 401, `Expected 401, got ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    assert(body.error?.code === 'AUTH_REQUIRED', `Expected AUTH_REQUIRED, got ${body.error?.code}`);
});

await test('A signed-in owner still reads the people directory (positive control)', async () => {
    assert(dirOwner !== null, 'owner fixture failed');
    const { status, body } = await json('/v1/catalogue/directory?type=people', {
        headers: { Authorization: `Bearer ${dirOwner!.token}` },
    });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    assert(Array.isArray(body.data?.entries), 'Expected an entries list');
});

await test('Anonymous token → MCP aimeat_catalogue_directory is refused AUTH_REQUIRED', async () => {
    const session = await openSession(BASE, anonToken, 'e2e-anonymous-directory');
    const r = await callTool(session, 'aimeat_catalogue_directory', {});
    assert(r.isError, `Expected a refusal, got ${r.text.slice(0, 200)}`);
    assert(/^AUTH_REQUIRED: /.test(r.text), `Expected AUTH_REQUIRED, got ${r.text.slice(0, 200)}`);
});

await test('An agent of a signed-in owner still lists the directory over MCP (positive control)', async () => {
    assert(dirOwner !== null, 'owner fixture failed');
    const agent = await makeAgent(BASE, dirOwner!, ['catalogue:read']);
    const session = await openSession(BASE, agent.token, 'e2e-anonymous-directory-member');
    const r = await callTool(session, 'aimeat_catalogue_directory', {});
    assert(!r.isError, `Expected the listing, got ${r.text.slice(0, 200)}`);
    assert(Array.isArray(r.data), `Expected a list, got ${r.text.slice(0, 200)}`);
});

await test('The anonymous token still writes its own memory after the refusals', async () => {
    const key = `anonymous.after-directory-${Date.now()}`;
    const { status, body } = await json('/v1/memory', anonAuth({
        method: 'POST',
        body: JSON.stringify({ key, value: { ok: true } }),
    }));
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    await json(`/v1/memory/${encodeURIComponent(key)}`, anonAuth({ method: 'DELETE' }));
});

// ─── Phase 3b: Every guard that asked only the anonymous flag ───
// Same root cause as Phase 3 (secaudit 2026-10, anonymous-claim-not-signed). Each guard below read
// `req.auth.anonymous`, which the minted token never carries, so each one took the shared anonymous
// principal for a signed-in caller. They ask isAnonymousPrincipal now. One assertion per guard: the
// minted token gets what the anonymous internet gets, and a signed-in owner keeps what it had.
console.log('\nPhase 3b — Signed-in-only guards refuse the minted token too');

const ownerAuth = (opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${dirOwner?.token ?? ''}` } });

let publicBoardId = '';
let privateBoardId = '';
await test('fixture: the owner opens a public and a private board', async () => {
    assert(dirOwner !== null, 'owner fixture failed');
    for (const visibility of ['public', 'private'] as const) {
        const r = await json('/v1/boards', ownerAuth({ method: 'POST', body: JSON.stringify({ name: `anon-guard-${visibility}-${Date.now()}`, visibility }) }));
        // 201: the owner in person opens it at once (202 would be a publish request, which this test does not want).
        assert(r.status === 201, `create ${visibility} board: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        const id = r.body.data?.id ?? r.body.data?.board?.id;
        assert(typeof id === 'string', `board id: ${JSON.stringify(r.body.data).slice(0, 200)}`);
        if (visibility === 'public') publicBoardId = id; else privateBoardId = id;
    }
});

await test('GET /v1/boards: the minted token gets no member roster, the owner does', async () => {
    const anon = await json('/v1/boards', anonAuth());
    const a = (anon.body.data?.boards ?? []).find((b: any) => b.id === publicBoardId);
    assert(a?.id === publicBoardId, `the public board is listed to the minted token: ${JSON.stringify(anon.body).slice(0, 200)}`);
    assert(a.owner_gaii === undefined && a.allowed_gaiis === undefined, `no roster for the minted token, got ${JSON.stringify(a)}`);
    const own = await json('/v1/boards', ownerAuth());
    const o = (own.body.data?.boards ?? []).find((b: any) => b.id === publicBoardId);
    assert(o && typeof o.owner_gaii === 'string', `the owner sees the roster: ${JSON.stringify(o)}`);
});

await test('GET /v1/boards/:private/posts: the minted token is 401, the owner reads', async () => {
    const anon = await json(`/v1/boards/${privateBoardId}/posts`, anonAuth());
    assert(anon.status === 401, `minted token on a private board: ${anon.status} ${JSON.stringify(anon.body.error)}`);
    const own = await json(`/v1/boards/${privateBoardId}/posts`, ownerAuth());
    assert(own.status === 200, `owner: ${own.status} ${JSON.stringify(own.body.error)}`);
});

await test('GET /v1/ghii/list: the minted token is 401, the owner lists', async () => {
    const anon = await json('/v1/ghii/list', anonAuth());
    assert(anon.status === 401 && anon.body.error?.code === 'AUTH_REQUIRED', `minted token: ${anon.status} ${JSON.stringify(anon.body.error)}`);
    const own = await json('/v1/ghii/list', ownerAuth());
    assert(own.status === 200, `owner: ${own.status} ${JSON.stringify(own.body.error)}`);
});

await test('GET /v1/ghii/anonymous@node: no agent roster for the minted token; the owner sees their own', async () => {
    const anon = await json(`/v1/ghii/${encodeURIComponent(`anonymous@${NODE_ID}`)}`, anonAuth());
    assert(anon.status === 200, `profile: ${anon.status}`);
    assert(anon.body.data?.agents === undefined, `the minted token is not the anonymous account's owner: ${JSON.stringify(anon.body.data?.agents)}`);
    const own = await json(`/v1/ghii/${encodeURIComponent(dirOwner!.ghii)}`, ownerAuth());
    assert(Array.isArray(own.body.data?.agents), `the owner sees their roster: ${JSON.stringify(own.body.data).slice(0, 200)}`);
});

await test('GET /v1/owners/anonymous: no roles or roster for the minted token; the owner sees their own', async () => {
    const anon = await json('/v1/owners/anonymous', anonAuth());
    assert(anon.status === 200, `owner card: ${anon.status}`);
    assert(anon.body.data?.roles === undefined && anon.body.data?.agents === undefined,
        `the minted token is not the anonymous account: ${JSON.stringify(anon.body.data)}`);
    const own = await json(`/v1/owners/${dirOwner!.name}`, ownerAuth());
    assert(Array.isArray(own.body.data?.roles), `the owner sees their roles: ${JSON.stringify(own.body.data)}`);
});

await test('GET /v1/apps?own=true: the minted token is 401, the owner lists', async () => {
    const anon = await json('/v1/apps?own=true', anonAuth());
    assert(anon.status === 401, `minted token: ${anon.status} ${JSON.stringify(anon.body.error)}`);
    const own = await json('/v1/apps?own=true', ownerAuth());
    assert(own.status === 200, `owner: ${own.status} ${JSON.stringify(own.body.error)}`);
});

await test('POST /v1/auth/refresh: the minted token is not renewed (401); an agent token is', async () => {
    const anon = await json('/v1/auth/refresh', anonAuth({ method: 'POST', body: '{}' }));
    assert(anon.status === 401, `minted token refresh: ${anon.status} ${JSON.stringify(anon.body).slice(0, 200)}`);
    const agent = await makeAgent(BASE, dirOwner!, ['memory:read']);
    const r = await json('/v1/auth/refresh', { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${agent.token}` } });
    assert(r.status === 200, `agent refresh: ${r.status} ${JSON.stringify(r.body.error)}`);
});

await test('GET /v1/ghii/cors (requireOwnerPrincipal): the minted token is 401, the owner reads', async () => {
    const anon = await json('/v1/ghii/cors', anonAuth());
    assert(anon.status === 401, `minted token: ${anon.status} ${JSON.stringify(anon.body.error)}`);
    const own = await json('/v1/ghii/cors', ownerAuth());
    assert(own.status === 200, `owner: ${own.status} ${JSON.stringify(own.body.error)}`);
});

await test('POST /v1/docsign/validate with a stored file: the minted token is 401, the owner is read as themself', async () => {
    const body = JSON.stringify({ storage_key: 'anonymous/no-such-file.pdf' });
    const anon = await json('/v1/docsign/validate', anonAuth({ method: 'POST', body }));
    assert(anon.status === 401, `minted token: ${anon.status} ${JSON.stringify(anon.body.error)}`);
    const own = await json('/v1/docsign/validate', ownerAuth({ method: 'POST', body: JSON.stringify({ storage_key: 'no-such-file.pdf' }) }));
    assert(own.status !== 401, `owner is not refused as signed out: ${own.status} ${JSON.stringify(own.body.error)}`);
});

// ─── Phase 3c: A members file over MCP aimeat_storage_download ───
// secaudit2026oct22, services/file-refs.ts resolveFileRef members-tier-admits-anonymous-identity.
// `members` means everyone with an account on this node. authorizeRead() allows the tier for any
// accessor and leaves the anonymous check to its caller; GET /v1/pub makes it, resolveFileRef did not,
// so the shared anonymous token read another owner's members file through the MCP download tool.
console.log('\nPhase 3c — A members file is not read by the shared anonymous token over MCP');

const sharedFileText = `members-only ${Date.now()}`;
const membersFileKey = `anon-guard-members-${Date.now()}.txt`;
const publicFileKey = `anon-guard-public-${Date.now()}.txt`;
const anonOwnFileKey = `anonymous/own-${Date.now()}.txt`;

await test('fixture: the owner uploads a members file and a public file; the anonymous token uploads its own file', async () => {
    assert(dirOwner !== null, 'owner fixture failed');
    const data = Buffer.from(sharedFileText).toString('base64');
    for (const [key, visibility] of [[membersFileKey, 'members'], [publicFileKey, 'public']] as const) {
        const r = await json('/v1/storage', ownerAuth({ method: 'POST', body: JSON.stringify({ key, data, mime_type: 'text/plain', visibility }) }));
        assert(r.status === 201, `upload ${visibility}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    }
    const own = await json('/v1/storage', anonAuth({ method: 'POST', body: JSON.stringify({ key: anonOwnFileKey, data, mime_type: 'text/plain', visibility: 'public' }) }));
    assert(own.status === 201, `anonymous own upload: ${own.status} ${JSON.stringify(own.body).slice(0, 200)}`);
});

await test('Anonymous token → MCP aimeat_storage_download of another owner\'s members file is refused (handle and inline)', async () => {
    const session = await openSession(BASE, anonToken, 'e2e-anonymous-members-file');
    for (const inline of [false, true]) {
        const r = await callTool(session, 'aimeat_storage_download', { key: membersFileKey, owner: dirOwner!.ghii, inline });
        assert(r.isError, `inline=${inline}: expected a refusal, got ${r.text.slice(0, 200)}`);
        assert(!r.text.includes(sharedFileText) && !r.text.includes('/v1/download/'), `inline=${inline}: the file leaked: ${r.text.slice(0, 200)}`);
        assert(r.data?.access === 'denied', `inline=${inline}: expected access denied, got ${r.text.slice(0, 200)}`);
    }
});

await test('Anonymous token still downloads a public file and its own anonymous/ file over MCP', async () => {
    const session = await openSession(BASE, anonToken, 'e2e-anonymous-public-file');
    const pub = await callTool(session, 'aimeat_storage_download', { key: publicFileKey, owner: dirOwner!.ghii, inline: true });
    assert(!pub.isError && pub.data?.content_text === sharedFileText, `public file: ${pub.text.slice(0, 200)}`);
    const own = await callTool(session, 'aimeat_storage_download', { key: anonOwnFileKey, inline: true });
    assert(!own.isError && own.data?.content_text === sharedFileText, `own anonymous/ file: ${own.text.slice(0, 200)}`);
});

await test('An agent of another signed-in owner still downloads the members file over MCP (positive control)', async () => {
    const other = await registerOwner(BASE, `anonmem${Date.now().toString(36)}`);
    const agent = await makeAgent(BASE, other, ['storage:read']);
    const session = await openSession(BASE, agent.token, 'e2e-anonymous-members-file-member');
    const r = await callTool(session, 'aimeat_storage_download', { key: membersFileKey, owner: dirOwner!.ghii, inline: true });
    assert(!r.isError && r.data?.content_text === sharedFileText, `signed-in member: ${r.text.slice(0, 200)}`);
});

// ─── Phase 3d: Writes outside the anonymous namespace ───
// secaudit2026oct22. The minted token passed requireAuth() and requireScope() as an ordinary agent,
// and the anonymous.* fence lives only in the memory and storage write paths. Document signing
// (create and sign), the Design Book, the portfolio page and knowledge packages persist elsewhere,
// so each one refuses the shared anonymous principal by identity now. The signed-in owner keeps
// every one of these writes, and the minted token keeps its anonymous.* memory write.
console.log('\nPhase 3d — Writes outside anonymous.* refuse the minted token');

const { createHash } = await import('node:crypto');
const s3c = Date.now().toString(36);
const docSha = createHash('sha256').update(`anon-docsign-${s3c}`).digest('hex');
const docBody = { sha256: docSha, name: `anon-${s3c}.txt`, size: 24 };

await test('POST /v1/docsign/requests: the minted token is 403, the owner creates (201)', async () => {
    assert(dirOwner !== null, 'owner fixture failed');
    const anon = await json('/v1/docsign/requests', anonAuth({ method: 'POST', body: JSON.stringify({ title: 'anon', document: docBody, parties: [ANON_GAII, dirOwner!.ghii] }) }));
    assert(anon.status === 403 && anon.body.error?.code === 'FORBIDDEN', `minted token create: ${anon.status} ${JSON.stringify(anon.body.error ?? anon.body.data).slice(0, 200)}`);
    const own = await json('/v1/docsign/requests', ownerAuth({ method: 'POST', body: JSON.stringify({ title: 'own', document: docBody, parties: [dirOwner!.ghii] }) }));
    assert(own.status === 201, `owner create: ${own.status} ${JSON.stringify(own.body.error)}`);
    await json(`/v1/docsign/requests/${own.body.data.request.id}`, ownerAuth({ method: 'DELETE' }));
});

await test('POST /v1/docsign/requests/:id/sign: the minted token is 403 as a named party, the owner signs (200)', async () => {
    assert(dirOwner !== null, 'owner fixture failed');
    const made = await json('/v1/docsign/requests', ownerAuth({ method: 'POST', body: JSON.stringify({ title: 'two parties', document: docBody, parties: [dirOwner!.ghii, ANON_GAII] }) }));
    assert(made.status === 201, `owner create: ${made.status} ${JSON.stringify(made.body.error)}`);
    const id = made.body.data.request.id;
    const anon = await json(`/v1/docsign/requests/${id}/sign`, anonAuth({ method: 'POST', body: JSON.stringify({ method: 'session' }) }));
    assert(anon.status === 403 && anon.body.error?.code === 'FORBIDDEN', `minted token sign: ${anon.status} ${JSON.stringify(anon.body.error ?? anon.body.data).slice(0, 200)}`);
    const own = await json(`/v1/docsign/requests/${id}/sign`, ownerAuth({ method: 'POST', body: JSON.stringify({ method: 'session' }) }));
    assert(own.status === 200, `owner sign: ${own.status} ${JSON.stringify(own.body.error)}`);
});

const ownPart = `anon-guard-own-${s3c}`;
const partBody = {
    v: 1, look: 'editorial',
    blocks: [
        { id: 'top', component: 'hero', props: { title: '<App name>', sub: '<One line on what it is>' } },
        { id: 'items', component: 'list', props: { source: '<prefix>.items' }, span: 'main' },
    ],
};
const partOf = (id: string) => ({ part: { id, kind: 'fill', title: 'Anon guard fill', summary: 'A cover over a list.', body: partBody } });

await test('POST /v1/designbook: the minted token is 401, the owner proposes (201)', async () => {
    assert(dirOwner !== null, 'owner fixture failed');
    const anon = await json('/v1/designbook', anonAuth({ method: 'POST', body: JSON.stringify(partOf(`anon-guard-anon-${s3c}`)) }));
    assert(anon.status === 401 && anon.body.error?.code === 'AUTH_REQUIRED', `minted token propose: ${anon.status} ${JSON.stringify(anon.body.error ?? anon.body.data).slice(0, 200)}`);
    const own = await json('/v1/designbook', ownerAuth({ method: 'POST', body: JSON.stringify(partOf(ownPart)) }));
    assert(own.status === 201, `owner propose: ${own.status} ${JSON.stringify(own.body.error)}`);
});

await test('POST /v1/designbook/:id/status: the minted token is 401, the proposer retires their own (200)', async () => {
    const anon = await json(`/v1/designbook/${ownPart}/status`, anonAuth({ method: 'POST', body: JSON.stringify({ status: 'retired' }) }));
    assert(anon.status === 401 && anon.body.error?.code === 'AUTH_REQUIRED', `minted token status: ${anon.status} ${JSON.stringify(anon.body.error ?? anon.body.data).slice(0, 200)}`);
    const own = await json(`/v1/designbook/${ownPart}/status`, ownerAuth({ method: 'POST', body: JSON.stringify({ status: 'retired' }) }));
    assert(own.status === 200, `owner retire: ${own.status} ${JSON.stringify(own.body.error)}`);
    await json(`/v1/designbook/${ownPart}`, ownerAuth({ method: 'DELETE' }));
});

await test('MCP aimeat_designbook_propose: the minted token is AUTH_REQUIRED, an agent of the owner proposes', async () => {
    assert(dirOwner !== null, 'owner fixture failed');
    const anonSession = await openSession(BASE, anonToken, 'e2e-anonymous-designbook');
    const anon = await callTool(anonSession, 'aimeat_designbook_propose', partOf(`anon-guard-mcp-${s3c}`));
    assert(anon.offered && anon.isError && /^AUTH_REQUIRED: /.test(anon.text), `minted token over MCP: ${anon.text.slice(0, 200)}`);
    const agent = await makeAgent(BASE, dirOwner!, ['memory:read', 'memory:write']);
    const session = await openSession(BASE, agent.token, 'e2e-anonymous-designbook-member');
    const agentPart = `anon-guard-agent-${s3c}`;
    const own = await callTool(session, 'aimeat_designbook_propose', partOf(agentPart));
    assert(!own.isError, `agent of the owner over MCP: ${own.text.slice(0, 200)}`);
    await json(`/v1/designbook/${agentPart}`, ownerAuth({ method: 'DELETE' }));
});

await test('PUT /v1/portfolio/upload: the minted token is 401, the owner uploads (200)', async () => {
    assert(dirOwner !== null, 'owner fixture failed');
    const page = JSON.stringify({ html: '<!doctype html><title>x</title><p>x</p>', enable: true });
    const anon = await json('/v1/portfolio/upload', anonAuth({ method: 'PUT', body: page }));
    assert(anon.status === 401 && anon.body.error?.code === 'AUTH_REQUIRED', `minted token upload: ${anon.status} ${JSON.stringify(anon.body.error ?? anon.body.data).slice(0, 200)}`);
    const own = await json('/v1/portfolio/upload', ownerAuth({ method: 'PUT', body: page }));
    assert(own.status === 200, `owner upload: ${own.status} ${JSON.stringify(own.body.error)}`);
});

await test('PUT /v1/portfolio/config and MCP aimeat_portfolio_publish: the minted token is refused', async () => {
    const cfg = await json('/v1/portfolio/config', anonAuth({ method: 'PUT', body: JSON.stringify({ enabled: true }) }));
    assert(cfg.status === 401 && cfg.body.error?.code === 'AUTH_REQUIRED', `minted token config: ${cfg.status} ${JSON.stringify(cfg.body.error ?? cfg.body.data).slice(0, 200)}`);
    const session = await openSession(BASE, anonToken, 'e2e-anonymous-portfolio');
    const r = await callTool(session, 'aimeat_portfolio_publish', { html: '<p>x</p>', enable: true });
    assert(r.offered && r.isError && /^AUTH_REQUIRED: /.test(r.text), `minted token over MCP: ${r.text.slice(0, 200)}`);
});

await test('POST /v1/knowledge/import: the minted token is 401, the owner imports (201)', async () => {
    assert(dirOwner !== null, 'owner fixture failed');
    const pkg = (name: string) => ({ package: { name, content_type: 'document', entries: [{ key: 'facts', title: 'Facts', visibility: 'owner', value: { text: 'A fact.' } }] } });
    const anon = await json('/v1/knowledge/import', anonAuth({ method: 'POST', body: JSON.stringify({ ...pkg(`anon-pack-${s3c}`), overrides: { catalog_listed: true } }) }));
    assert(anon.status === 401 && anon.body.error?.code === 'AUTH_REQUIRED', `minted token import: ${anon.status} ${JSON.stringify(anon.body.error ?? anon.body.data).slice(0, 200)}`);
    const own = await json('/v1/knowledge/import', ownerAuth({ method: 'POST', body: JSON.stringify(pkg(`own-pack-${s3c}`)) }));
    assert(own.status === 201, `owner import: ${own.status} ${JSON.stringify(own.body.error)}`);
    const id = own.body.data.package_id;
    const clone = await json(`/v1/knowledge/${id}/clone`, anonAuth({ method: 'POST', body: '{}' }));
    assert(clone.status === 401, `minted token clone: ${clone.status} ${JSON.stringify(clone.body.error)}`);
    const sharing = await json(`/v1/knowledge/${id}/sharing`, anonAuth({ method: 'PATCH', body: JSON.stringify({ catalog_listed: true }) }));
    assert(sharing.status === 401, `minted token sharing: ${sharing.status} ${JSON.stringify(sharing.body.error)}`);
    const entry = await json(`/v1/knowledge/${id}/entries/facts/visibility`, anonAuth({ method: 'PATCH', body: JSON.stringify({ visibility: 'public' }) }));
    assert(entry.status === 401, `minted token entry visibility: ${entry.status} ${JSON.stringify(entry.body.error)}`);
});

await test('The anonymous token still writes its own memory after the Phase 3d refusals', async () => {
    const key = `anonymous.after-writes-${s3c}`;
    const { status, body } = await json('/v1/memory', anonAuth({ method: 'POST', body: JSON.stringify({ key, value: { ok: true } }) }));
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    await json(`/v1/memory/${encodeURIComponent(key)}`, anonAuth({ method: 'DELETE' }));
});

// ─── Phase 3e: More writes outside the anonymous namespace ───
// secaudit2026oct22, round 5. Data packages, a memory copy, the shared agent's webhook, tags and
// capabilities (its public card), and a skill over MCP persisted outside anonymous.* for the minted
// token. Each refuses it now; a signed-in owner and their agent keep every one of these writes. The
// page open and the company page were already refused (requireRole('owner'), the company:write scope),
// and are asserted here so they stay refused.
console.log('\nPhase 3e — More writes outside anonymous.* refuse the minted token');

const s3e = `${s3c}e`;
const ownerAgent = await (async () => {
    if (!dirOwner) return null;
    try { return await makeAgent(BASE, dirOwner, ['memory:read', 'memory:write', 'storage:read', 'storage:write']); }
    catch (err) { console.error(`  fixture: ${(err as Error).message}`); return null; }
})();
const agentAuth = (opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${ownerAgent?.token ?? ''}` } });
const anonMcp = await openSession(BASE, anonToken, 'e2e-anonymous-3e');
const agentMcp = ownerAgent ? await openSession(BASE, ownerAgent.token, 'e2e-anonymous-3e-member') : null;
const isAuthRequired = (r: { status: number; body: any }) => r.status === 401 && r.body.error?.code === 'AUTH_REQUIRED';
const shown = (r: { status: number; body: any }) => `${r.status} ${JSON.stringify(r.body.error ?? r.body.data).slice(0, 200)}`;

await test('POST /v1/portfolio/:username/open: the minted token is refused, a signed-in person opens a signed-in page', async () => {
    assert(dirOwner !== null, 'owner fixture failed');
    const cfg = await json('/v1/portfolio/config', ownerAuth({ method: 'PUT', body: JSON.stringify({ enabled: true, access: 'signed-in' }) }));
    assert(cfg.status === 200, `owner config: ${shown(cfg)}`);
    const path = `/v1/portfolio/${encodeURIComponent(dirOwner!.name)}/open`;
    const anon = await json(path, anonAuth({ method: 'POST', body: '{}' }));
    assert(anon.status === 403 && !anon.body.data?.url, `minted token open: ${shown(anon)}`);
    const visitor = await registerOwner(BASE, `anonopen${s3e}`);
    const open = await json(path, { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${visitor.token}` } });
    assert(open.status === 200 && typeof open.body.data?.url === 'string', `signed-in open: ${shown(open)}`);
});

await test('Company page: the minted token is refused on REST and MCP, the owner publishes one', async () => {
    assert(dirOwner !== null, 'owner fixture failed');
    const anon = await json('/v1/companies', anonAuth({ method: 'POST', body: JSON.stringify({ name: `Anon Co ${s3e}` }) }));
    assert(anon.status === 403, `minted token company create: ${shown(anon)}`);
    const r = await callTool(anonMcp, 'aimeat_company_portfolio_publish', { company_id: 'x', html: '<p>x</p>' });
    assert(r.isError, `minted token over MCP: ${r.text.slice(0, 200)}`);
    const made = await json('/v1/companies', ownerAuth({ method: 'POST', body: JSON.stringify({ name: `Owner Co ${s3e}` }) }));
    assert(made.status === 201, `owner company create: ${shown(made)}`);
    const id = made.body.data.company.id;
    const anonPage = await json(`/v1/companies/${id}/portfolio`, anonAuth({ method: 'PUT', body: JSON.stringify({ html: '<p>x</p>' }) }));
    const anonDelete = await json(`/v1/companies/${id}`, anonAuth({ method: 'DELETE' }));
    assert(anonPage.status === 403 && anonDelete.status === 403, `minted token company page ${shown(anonPage)}; delete ${shown(anonDelete)}`);
    const page = await json(`/v1/companies/${id}/portfolio`, ownerAuth({ method: 'PUT', body: JSON.stringify({ html: '<!doctype html><title>x</title><p>x</p>' }) }));
    assert(page.status === 200 || page.status === 202, `owner company page: ${shown(page)}`);
    await json(`/v1/companies/${id}`, ownerAuth({ method: 'DELETE' }));
});

const pkgBody = (name: string) => ({ name, changes: 'First version.', visibility: 'members', resources: [{ name: 'rows', rows: [{ n: 1 }, { n: 2 }] }] });

await test('POST /v1/datapackages: the minted token is 401, the owner and their agent publish', async () => {
    assert(ownerAgent !== null, 'agent fixture failed');
    const anon = await json('/v1/datapackages', anonAuth({ method: 'POST', body: JSON.stringify(pkgBody(`anon-pkg-${s3e}`)) }));
    assert(isAuthRequired(anon), `minted token publish: ${shown(anon)}`);
    const own = await json('/v1/datapackages', ownerAuth({ method: 'POST', body: JSON.stringify(pkgBody(`own-pkg-${s3e}`)) }));
    assert(own.status === 201, `owner publish: ${shown(own)}`);
    const agent = await json('/v1/datapackages', agentAuth({ method: 'POST', body: JSON.stringify(pkgBody(`agent-pkg-${s3e}`)) }));
    assert(agent.status === 201, `agent publish: ${shown(agent)}`);
});

await test('MCP aimeat_datapackage_publish: the minted token is AUTH_REQUIRED, an agent of the owner publishes', async () => {
    assert(agentMcp !== null, 'agent fixture failed');
    const anon = await callTool(anonMcp, 'aimeat_datapackage_publish', pkgBody(`anon-mcp-pkg-${s3e}`));
    assert(anon.offered && anon.isError && /AUTH_REQUIRED/.test(anon.text), `minted token over MCP: ${anon.text.slice(0, 200)}`);
    const own = await callTool(agentMcp!, 'aimeat_datapackage_publish', pkgBody(`agent-mcp-pkg-${s3e}`));
    assert(!own.isError && typeof own.data?.package_id === 'string', `agent over MCP: ${own.text.slice(0, 200)}`);
});

await test('POST /v1/memory/copy: the minted token copies only into anonymous.*, an agent of the owner copies any public record', async () => {
    assert(dirOwner !== null && ownerAgent !== null, 'fixtures failed');
    const plainKey = `anon-copy-src-${s3e}`;
    const anonKey = `anonymous.copy-src-${s3e}`;
    for (const key of [plainKey, anonKey]) {
        const w = await json('/v1/memory', ownerAuth({ method: 'POST', body: JSON.stringify({ key, value: { text: 'public' }, visibility: 'public' }) }));
        assert(w.status === 201 || w.status === 200, `owner write ${key}: ${shown(w)}`);
    }
    // The copy keeps its default level (private): the fence is what is asked here, not the publish gate.
    const copy = (key: string) => JSON.stringify({ source_gaii: dirOwner!.ghii, key });
    const outside = await json('/v1/memory/copy', anonAuth({ method: 'POST', body: copy(plainKey) }));
    assert(outside.status === 403, `minted token copy outside anonymous.*: ${shown(outside)}`);
    const inside = await json('/v1/memory/copy', anonAuth({ method: 'POST', body: copy(anonKey) }));
    assert(inside.status === 200 || inside.status === 202, `minted token copy into anonymous.*: ${shown(inside)}`);
    await json(`/v1/memory/${encodeURIComponent(anonKey)}`, anonAuth({ method: 'DELETE' }));
    const agent = await json('/v1/memory/copy', agentAuth({ method: 'POST', body: copy(plainKey) }));
    assert(agent.status === 200 || agent.status === 202, `agent copy: ${shown(agent)}`);
});

const hook = JSON.stringify({ url: 'http://127.0.0.1:9/anon-hook' });
await test('The shared agent\'s webhook: the minted token is 401 on set, test and delete; an agent sets its own', async () => {
    assert(ownerAgent !== null, 'agent fixture failed');
    const set = await json('/v1/agents/shared/webhook', anonAuth({ method: 'PUT', body: hook }));
    const probe = await json('/v1/agents/shared/webhook/test', anonAuth({ method: 'POST', body: '{}' }));
    const del = await json('/v1/agents/shared/webhook', anonAuth({ method: 'DELETE' }));
    assert(isAuthRequired(set) && isAuthRequired(probe) && isAuthRequired(del), `minted token webhook: set ${shown(set)}; test ${shown(probe)}; delete ${shown(del)}`);
    const own = await json(`/v1/agents/${ownerAgent!.name}/webhook`, agentAuth({ method: 'PUT', body: hook }));
    assert(own.status === 200, `agent own webhook: ${shown(own)}`);
    await json(`/v1/agents/${ownerAgent!.name}/webhook`, agentAuth({ method: 'DELETE' }));
});

await test('The shared agent\'s public card: the minted token is refused on tags and capabilities (REST and MCP), an agent sets its own', async () => {
    assert(ownerAgent !== null && agentMcp !== null, 'agent fixture failed');
    const caps = JSON.stringify({ technical: [{ type: 'tool', name: 'anon-guard' }], domain: ['anon-guard'] });
    const tags = JSON.stringify({ tags: [`anon-guard-${s3e}`] });
    const restCaps = await json('/v1/agents/shared/capabilities', anonAuth({ method: 'PUT', body: caps }));
    const restTags = await json('/v1/agents/shared/tags', anonAuth({ method: 'PATCH', body: tags }));
    assert(isAuthRequired(restCaps) && isAuthRequired(restTags), `minted token REST: capabilities ${shown(restCaps)}; tags ${shown(restTags)}`);
    const mcpTags = await callTool(anonMcp, 'aimeat_agent_tags_set', { target_agent_name: 'shared', tags: [`anon-guard-${s3e}`] });
    const mcpCaps = await callTool(anonMcp, 'aimeat_agent_capabilities_report', { domain: ['anon-guard'] });
    assert(mcpTags.isError && /AUTH_REQUIRED/.test(mcpTags.text) && mcpCaps.isError && /AUTH_REQUIRED/.test(mcpCaps.text),
        `minted token MCP: tags ${mcpTags.text.slice(0, 160)}; capabilities ${mcpCaps.text.slice(0, 160)}`);
    const ownCaps = await json(`/v1/agents/${ownerAgent!.name}/capabilities`, agentAuth({ method: 'PUT', body: caps }));
    const ownTags = await json(`/v1/agents/${ownerAgent!.name}/tags`, agentAuth({ method: 'PATCH', body: tags }));
    assert(ownCaps.status === 200 && ownTags.status === 200, `agent own: capabilities ${shown(ownCaps)}; tags ${shown(ownTags)}`);
    const mcpOwn = await callTool(agentMcp!, 'aimeat_agent_tags_set', { target_agent_name: ownerAgent!.name, tags: [`anon-guard-${s3e}`] });
    assert(!mcpOwn.isError, `agent own tags over MCP: ${mcpOwn.text.slice(0, 200)}`);
});

const skillMd = (name: string) => `---\nname: ${name}\ndescription: A guard skill for the anonymous suite. Use when testing.\n---\n\n# Guard\n\nNothing to do.\n`;
await test('MCP aimeat_skill_publish and aimeat_skill_update: the minted token is AUTH_REQUIRED, an agent of the owner publishes', async () => {
    assert(agentMcp !== null, 'agent fixture failed');
    const name = `anon-guard-${s3e}`;
    const anon = await callTool(anonMcp, 'aimeat_skill_publish', { skill_md: skillMd(name), visibility: 'members' });
    assert(anon.isError && /AUTH_REQUIRED/.test(anon.text), `minted token publish: ${anon.text.slice(0, 200)}`);
    const upd = await callTool(anonMcp, 'aimeat_skill_update', { name, visibility: 'members' });
    assert(upd.isError && /AUTH_REQUIRED/.test(upd.text), `minted token update: ${upd.text.slice(0, 200)}`);
    const own = await callTool(agentMcp!, 'aimeat_skill_publish', { skill_md: skillMd(`own-${name}`), visibility: 'members' });
    assert(!own.isError, `agent publish: ${own.text.slice(0, 200)}`);
    await json(`/v1/skills/own-${name}`, ownerAuth({ method: 'DELETE' }));
});

await test('The anonymous token still writes its own memory after the Phase 3e refusals', async () => {
    const key = `anonymous.after-3e-${s3e}`;
    const { status, body } = await json('/v1/memory', anonAuth({ method: 'POST', body: JSON.stringify({ key, value: { ok: true } }) }));
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    await json(`/v1/memory/${encodeURIComponent(key)}`, anonAuth({ method: 'DELETE' }));
});

// ─── Phase 4: Anonymous Prompts ───
console.log('\nPhase 4 — Anonymous Prompts');

await test('Get anonymous prompt tier', async () => {
    const { status, body } = await json('/v1/prompts/anonymous');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.tier === 'anonymous', `Expected tier anonymous, got ${body.data.tier}`);
    assert(body.data.enabled === true, 'Expected enabled: true');
    assert(body.data.system_prompt.length > 500, 'Expected substantial system prompt (v2 is large)');
    assert(body.data.system_prompt.includes('BOOT SEQUENCE'), 'Expected boot sequence section');
    assert(body.data.system_prompt.includes('KEY NAMING CONVENTIONS'), 'Expected key naming section');
    assert(body.data.system_prompt.includes('SESSION CONTINUITY'), 'Expected session continuity section');
    assert(body.data.system_prompt.includes('GAII TRACKING'), 'Expected GAII tracking section');
    assert(body.data.system_prompt.includes('NODE ETIQUETTE'), 'Expected node etiquette section');
    assert(body.data.system_prompt.includes('BEYOND ANONYMOUS MODE'), 'Expected capability awareness section');
    assert(body.data.note.includes('alongside'), 'Expected co-existence note');
    // v2: structured metadata
    assert(Array.isArray(body.data.boot_sequence), 'Expected boot_sequence array');
    assert(body.data.boot_sequence.length === 6, `Expected 6 boot steps, got ${body.data.boot_sequence.length}`);
    assert(body.data.key_conventions['context.latest'] !== undefined, 'Expected context.latest in key_conventions');
    assert(body.data.key_conventions['handoff.pending'] !== undefined, 'Expected handoff.pending in key_conventions');
    assert(body.data.key_conventions['agents.roster'] !== undefined, 'Expected agents.roster in key_conventions');
});

await test('Get share prompt', async () => {
    const { status, body } = await json('/v1/prompts/anonymous/share');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.share_prompt.length > 200, 'Expected substantial share prompt');
    assert(body.data.share_prompt.includes(NODE_ID), 'Share prompt should include node ID');
    assert(body.data.share_prompt.includes('/v1/memory'), 'Share prompt should include memory endpoints');
    assert(body.data.share_prompt.includes('Orient Yourself'), 'Share prompt should include orientation');
    assert(body.data.share_prompt.includes('Session Continuity'), 'Share prompt should include session continuity');
    assert(body.data.share_prompt.includes('handoff.pending'), 'Share prompt should include handoff convention');
    assert(body.data.share_prompt.includes('context.latest'), 'Share prompt should include context convention');
    assert(body.data.gaii === ANON_GAII, `Expected gaii ${ANON_GAII}`);
});

await test('Get build-app prompt (canonical app-building prompt, public)', async () => {
    const { status, body } = await json('/v1/prompts/build-app');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.id === 'build-app', `Expected id build-app, got ${body.data.id}`);
    assert(body.data.mode === 'new', `Expected default mode new, got ${body.data.mode}`);
    assert(body.data.prompt.includes('Step 1 — Interview me first'), 'Expected the interview step in new mode');
    assert(body.data.prompt.includes('mountLoginButton'), 'Expected the login-bar auth pattern');
    assert(body.data.prompt.includes('/v1/libs/'), 'Expected the client-library catalog');
    assert(body.data.prompt.includes('how to publish'), 'Expected the publish walkthrough in new mode');
    assert(body.data.body.startsWith('## Step 2'), 'Expected body to start at the platform-instructions core');
    assert(body.data.prompt.includes(body.data.body), 'Expected the full prompt to contain the body core');
});

await test('build-app prompt improve mode omits interview + publish walkthrough', async () => {
    const { status, body } = await json('/v1/prompts/build-app?mode=improve');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.mode === 'improve', `Expected mode improve, got ${body.data.mode}`);
    assert(!body.data.prompt.includes('Interview me first'), 'Improve mode must not include the interview');
    assert(!body.data.prompt.includes('how to publish'), 'Improve mode must not include the publish walkthrough');
    assert(body.data.body.startsWith('## AIMEAT Platform Instructions'), 'Expected the improve-mode heading');
});

await test('build-app prompt embeds the idea and falls back to English on unknown lang', async () => {
    const { status, body } = await json('/v1/prompts/build-app?idea=' + encodeURIComponent('a poll app for friends') + '&lang=sv');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.prompt.includes('My initial idea: a poll app for friends'), 'Expected the idea embedded in the header');
    assert(body.data.prompt.includes('in English'), 'Unknown lang must fall back to English');
});

await test('app-grant scope vocabulary is served machine-readable', async () => {
    const { status, body } = await json('/v1/app-grants/scopes');
    assert(status === 200, `Expected 200, got ${status}`);
    const scopes = body.data.scopes as Array<{ scope: string; description: string; default: boolean }>;
    assert(Array.isArray(scopes) && scopes.length > 5, 'Expected a scope list');
    const byName = Object.fromEntries(scopes.map(s => [s.scope, s]));
    assert(byName['storage:write']?.default === true, 'storage:write must be a default scope');
    assert(byName['memory:delete']?.default === false, 'memory:delete must NOT be a default scope');
    assert(byName['storage:delete'] === undefined, 'storage:delete must not exist (delete is covered by storage:write)');
    assert(body.data.notes.some((n: string) => n.includes('storage:write')), 'Expected the write-covers-delete note');
});

await test('build-app prompt includes the scope vocabulary section', async () => {
    const { status, body } = await json('/v1/prompts/build-app');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.prompt.includes('App permissions (scopes)'), 'Expected the scopes section');
    assert(body.data.prompt.includes('aimeat-scopes'), 'Expected the meta-tag declaration');
    assert(body.data.prompt.includes('NO storage:delete'), 'Expected the write-covers-delete warning');
    assert(body.data.prompt.includes('memory:delete'), 'Expected memory:delete in the vocabulary');
});

await test('build-app prompt format=txt returns raw text/plain', async () => {
    const res = await fetch(`${BASE}/v1/prompts/build-app?format=txt`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('text/plain'), 'Expected text/plain');
    const text = await res.text();
    assert(text.includes('mountLoginButton'), 'Expected the auth pattern in the raw text');
});

await test('Normal tiers still work', async () => {
    const { status: s0, body: b0 } = await json('/v1/prompts/0');
    assert(s0 === 200, `Tier 0: Expected 200, got ${s0}`);
    assert(b0.data.tier === '0', 'Expected tier 0');

    // Tier 0.5 (keyed browse / micro-memory) was removed 2026-08-23 — the prompt tier is gone too.
    const { status: s05 } = await json('/v1/prompts/0.5');
    assert(s05 === 400 || s05 === 404, `Tier 0.5 should be gone, got ${s05}`);
});

// ─── Phase 5: Co-existence with authenticated mode ───
console.log('\nPhase 5 — Co-existence with Normal Auth');

await test('Auth endpoints still work (register owner)', async () => {
    // Owner registration requires a public_key — generate a dummy Ed25519 key
    const ownerName = `coex-${Date.now().toString(36)}`;
    const { status } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'dummypubkey123456789012345678901234567890ab', display_name: 'Co-existence Test' }),
    });
    // 201 = created successfully (even without auth, owner registration is open)
    assert(status === 201, `Expected 201, got ${status}`);
});

await test('Catalogue search works without auth', async () => {
    const { status, body } = await json('/v1/catalogue');
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
});

// ─── Cleanup & Summary ───
console.log('\n' + '─'.repeat(40));
console.log(`Anonymous Mode E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All anonymous mode tests passed!\n');
