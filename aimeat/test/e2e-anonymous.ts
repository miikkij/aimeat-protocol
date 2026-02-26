// E2E tests for Anonymous Node Mode (MEAT_ANONYMOUS=true)
// Requires server running with MEAT_ANONYMOUS=true on port 40251
// Run: cd aimeat && MEAT_ANONYMOUS=true PORT=40251 npx tsx src/index.ts
// Then: cd aimeat && npx tsx test/e2e-anonymous.ts

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'meat-local-001-dev';

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
    const { status, body } = await json('/');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, 'Expected ok: true');
});

await test('Anonymous agent exists in agent list', async () => {
    const { status, body } = await json(`/v1/agents/${encodeURIComponent(ANON_GAII)}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.gaii === ANON_GAII, `Expected gaii ${ANON_GAII}, got ${body.data.gaii}`);
    assert(body.data.display_name === 'Shared Anonymous Agent', `Unexpected display_name: ${body.data.display_name}`);
});

// ─── Phase 2: Memory CRUD without auth ───
console.log('\nPhase 2 — Memory CRUD (no auth)');

const testKey = `anon-test-${Date.now()}`;

await test('Write memory without auth', async () => {
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        body: JSON.stringify({ key: testKey, value: { message: 'hello from anonymous' }, visibility: 'public', tags: ['test'] }),
    });
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data.key === testKey, `Expected key ${testKey}`);
    assert(body.data.version === 1, 'Expected version 1');
    assert(body.data.created_at !== undefined, 'Expected created_at');
    assert(body.data.updated_at !== undefined, 'Expected updated_at');
});

await test('Read memory without auth', async () => {
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(testKey)}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.key === testKey, `Expected key ${testKey}`);
    assert(body.data.value.message === 'hello from anonymous', 'Expected correct value');
    assert(body.data.version === 1, 'Expected version 1');
});

await test('List memory without auth', async () => {
    const { status, body } = await json('/v1/memory');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.items.length > 0, 'Expected at least one memory entry');
    const found = body.data.items.find((it: any) => it.key === testKey);
    assert(found, `Expected to find key ${testKey} in list`);
});

await test('Search memory without auth', async () => {
    const { status, body } = await json(`/v1/memory/search?q=anonymous`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.results !== undefined, 'Expected results array');
});

await test('Update memory with PUT without auth', async () => {
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(testKey)}`, {
        method: 'PUT',
        body: JSON.stringify({ value: { message: 'updated anonymous data' }, version: 1 }),
    });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data.version === 2, 'Expected version 2');
});

await test('Delete memory without auth', async () => {
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(testKey)}`, {
        method: 'DELETE',
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.deleted === true, 'Expected deleted: true');
});

await test('Deleted memory returns 404', async () => {
    const { status } = await json(`/v1/memory/${encodeURIComponent(testKey)}`);
    assert(status === 404, `Expected 404, got ${status}`);
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

await test('Modify micro-memory entry without OTK', async () => {
    const { status, body } = await json(`/v1/mm?op=mod&set=${mmSet}&key=greeting&value=world`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.op === 'mod', 'Expected op: mod');
});

await test('Batch add micro-memory without OTK', async () => {
    const { status, body } = await json(`/v1/mm?op=batch&set=${mmSet}&key0=a&value0=alpha&key1=b&value1=beta`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.op === 'batch', 'Expected op: batch');
    assert(body.data.count === 2, 'Expected count 2');
});

await test('Delete micro-memory entry without OTK', async () => {
    const { status, body } = await json(`/v1/mm?op=del&set=${mmSet}&key=greeting`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data.op === 'del', 'Expected op: del');
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
    assert(body.data.boot_sequence.length === 5, `Expected 5 boot steps, got ${body.data.boot_sequence.length}`);
    assert(body.data.key_conventions['context/latest'] !== undefined, 'Expected context/latest in key_conventions');
    assert(body.data.key_conventions['handoff/pending'] !== undefined, 'Expected handoff/pending in key_conventions');
    assert(body.data.key_conventions['agents/roster'] !== undefined, 'Expected agents/roster in key_conventions');
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
    assert(body.data.share_prompt.includes('handoff/pending'), 'Share prompt should include handoff convention');
    assert(body.data.share_prompt.includes('context/latest'), 'Share prompt should include context convention');
    assert(body.data.gaii === ANON_GAII, `Expected gaii ${ANON_GAII}`);
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
