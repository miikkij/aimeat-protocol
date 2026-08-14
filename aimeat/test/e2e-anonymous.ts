// E2E tests for Anonymous Node Mode (AIMEAT_ANONYMOUS=true)
// Requires server running with AIMEAT_ANONYMOUS=true on port 40251
// Run: cd aimeat && AIMEAT_ANONYMOUS=true PORT=40251 npx tsx src/index.ts
// Then: cd aimeat && npx tsx test/e2e-anonymous.ts

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

// ─── Phase 3: Micro-memory without OTK ───
console.log('\nPhase 3 — Micro-Memory (no OTK)');

const mmSet = `anon-set-${Date.now()}`;

await test('Add micro-memory entry without OTK', async () => {
    const { status, body } = await json(`/v1/mm?op=add&set=${mmSet}&key=greeting&value=hello`);
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data.op === 'add', 'Expected op: add');
    assert(body.data.key === 'greeting', 'Expected key: greeting');
});

await test('List micro-memory set without OTK', async () => {
    const { status, body } = await json(`/v1/mm?op=list&set=${mmSet}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.entries.greeting === 'hello', 'Expected greeting=hello');
});

// `body.data.op` is the REQUEST PARAMETER echoed back, so asserting it proves only that the route
// parsed the query string. Every mutating op below reads the set back afterwards instead.
await test('Modify micro-memory entry without OTK — and the new value is stored', async () => {
    const { status, body } = await json(`/v1/mm?op=mod&set=${mmSet}&key=greeting&value=world`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.op === 'mod', 'Expected op: mod');
    const after = await json(`/v1/mm?op=list&set=${mmSet}`);
    assert(after.body.data.entries.greeting === 'world',
        `the modified value must be stored, got ${JSON.stringify(after.body.data.entries)}`);
});

await test('Batch add micro-memory without OTK — and both keys are stored', async () => {
    const { status, body } = await json(`/v1/mm?op=batch&set=${mmSet}&key0=a&value0=alpha&key1=b&value1=beta`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.op === 'batch', 'Expected op: batch');
    assert(body.data.count === 2, 'Expected count 2');
    const after = await json(`/v1/mm?op=list&set=${mmSet}`);
    assert(after.body.data.entries.a === 'alpha' && after.body.data.entries.b === 'beta',
        `both batched keys must be stored, got ${JSON.stringify(after.body.data.entries)}`);
});

await test('Delete micro-memory entry without OTK — and it is actually gone', async () => {
    const { status, body } = await json(`/v1/mm?op=del&set=${mmSet}&key=greeting`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.op === 'del', 'Expected op: del');
    assert(body.data.deleted === true, `Expected deleted: true, got ${JSON.stringify(body.data.deleted)}`);
    const after = await json(`/v1/mm?op=list&set=${mmSet}`);
    assert(after.body.data.entries.greeting === undefined,
        `the deleted key must be gone from the set, got ${JSON.stringify(after.body.data.entries)}`);
    // ...and the delete removed only what it was asked to.
    assert(after.body.data.entries.a === 'alpha' && after.body.data.entries.b === 'beta',
        `the other keys must survive the delete, got ${JSON.stringify(after.body.data.entries)}`);
});

await test('List all micro-memory sets without OTK', async () => {
    const { status, body } = await json('/v1/mm?op=list');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.sets.length > 0, 'Expected at least one set');
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
    assert(body.data.share_prompt.includes('/v1/mm'), 'Share prompt should include micro-memory endpoints');
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

    const { status: s05 } = await json('/v1/prompts/0.5');
    assert(s05 === 200, `Tier 0.5: Expected 200, got ${s05}`);
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
