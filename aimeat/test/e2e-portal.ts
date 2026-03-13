// E2E test for AIMEAT Onboarding Portal
// Run: cd aimeat && npx tsx test/e2e-portal.ts

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

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

console.log('\n=== AIMEAT Portal E2E Test ===\n');

// ─── GET /v1/portal — SPA shell ───
await test('GET /v1/portal — returns HTML', async () => {
    const res = await fetch(`${BASE}/v1/portal`);
    assert(res.status === 200, `status ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('text/html'), `content-type: ${ct}`);
    const html = await res.text();
    assert(html.includes('<title>'), 'missing title tag');
    assert(html.includes('AIME'), 'missing AIME in title');
    assert(html.includes('<div id="app"'), 'missing SPA mount point');
});

// ─── GET /v1/portal/platforms — JSON ───
await test('GET /v1/portal/platforms — returns platform list', async () => {
    const res = await fetch(`${BASE}/v1/portal/platforms`);
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.ok === true, 'ok should be true');
    assert(body.protocol === 'aimeat', `protocol: ${body.protocol}`);
    assert(Array.isArray(body.data.platforms), 'platforms should be array');
    assert(body.data.platforms.length >= 8, `expected >= 8 platforms, got ${body.data.platforms.length}`);

    const chatgpt = body.data.platforms.find((p: any) => p.id === 'chatgpt');
    assert(chatgpt, 'ChatGPT platform missing');
    assert(chatgpt.variants.length >= 3, `ChatGPT should have >= 3 variants, got ${chatgpt.variants.length}`);

    const claude = body.data.platforms.find((p: any) => p.id === 'claude');
    assert(claude, 'Claude platform missing');
    assert(claude.vendor === 'Anthropic', `Claude vendor: ${claude.vendor}`);
});

// ─── Platform variants have correct structure ───
await test('Platform variants have id, name, tier, path', async () => {
    const res = await fetch(`${BASE}/v1/portal/platforms`);
    const body = await res.json() as any;
    for (const platform of body.data.platforms) {
        for (const variant of platform.variants) {
            assert(typeof variant.id === 'string', `${platform.id}: variant missing id`);
            assert(typeof variant.name === 'string', `${platform.id}: variant missing name`);
            assert(['A', 'B', 'C', 'D'].includes(variant.tier), `${platform.id}/${variant.id}: invalid tier ${variant.tier}`);
            assert(['mcp', 'api', 'browse', 'prompt-package'].includes(variant.path), `${platform.id}/${variant.id}: invalid path ${variant.path}`);
        }
    }
});

// ─── GET /v1/portal/prompt — MCP path ───
await test('GET /v1/portal/prompt/claude-pro — returns MCP instructions', async () => {
    const res = await fetch(`${BASE}/v1/portal/prompt/claude-pro`);
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.ok === true, 'ok');
    assert(body.data.platform === 'Claude', `platform: ${body.data.platform}`);
    assert(body.data.tier === 'A', `tier: ${body.data.tier}`);
    assert(body.data.path === 'mcp', `path: ${body.data.path}`);
    assert(body.data.prompt.includes('/v1/mcp'), 'MCP prompt should reference /v1/mcp');
});

// ─── GET /v1/portal/prompt — API path ───
await test('GET /v1/portal/prompt/grok-api — returns API instructions', async () => {
    const res = await fetch(`${BASE}/v1/portal/prompt/grok-api`);
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.ok === true, 'ok');
    assert(body.data.tier === 'B', `tier: ${body.data.tier}`);
    assert(body.data.path === 'api', `path: ${body.data.path}`);
    assert(body.data.prompt.includes('/v1/owners'), 'API prompt should reference registration');
});

// ─── GET /v1/portal/prompt — Browse path ───
await test('GET /v1/portal/prompt/chatgpt-free — returns browse instructions', async () => {
    const res = await fetch(`${BASE}/v1/portal/prompt/chatgpt-free`);
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.ok === true, 'ok');
    assert(body.data.tier === 'C', `tier: ${body.data.tier}`);
    assert(body.data.path === 'browse', `path: ${body.data.path}`);
    assert(body.data.prompt.includes('/v1/catalogue'), 'Browse prompt should reference catalogue');
});

// ─── GET /v1/portal/prompt — Prompt package path with goal ───
await test('GET /v1/portal/prompt/deepseek-chat?goal=notes — returns prompt package', async () => {
    const res = await fetch(`${BASE}/v1/portal/prompt/deepseek-chat?goal=notes`);
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.ok === true, 'ok');
    assert(body.data.tier === 'D', `tier: ${body.data.tier}`);
    assert(body.data.path === 'prompt-package', `path: ${body.data.path}`);
    assert(body.data.goal === 'notes', `goal: ${body.data.goal}`);
    assert(body.data.prompt.includes('AIMEAT Application Builder'), 'should contain app builder prompt');
    assert(body.data.prompt.includes('Note-Taking App'), 'should include notes goal description');
    assert(body.data.prompt.includes('Ed25519'), 'should include Ed25519 signing instructions');
    assert(body.data.prompt.includes('/v1/memory'), 'should reference memory API');
});

// ─── 404 for unknown platform ───
await test('GET /v1/portal/prompt/nonexistent — returns 404', async () => {
    const res = await fetch(`${BASE}/v1/portal/prompt/nonexistent-variant`);
    assert(res.status === 404, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.ok === false, 'ok should be false');
    assert(body.error.code === 'NOT_FOUND', `error code: ${body.error?.code}`);
});

// ─── Bootstrap includes portal link ───
await test('GET / — bootstrap hints include portal', async () => {
    const res = await fetch(`${BASE}/?format=json`);
    const body = await res.json() as any;
    assert(body.ok === true, 'ok');
    // Portal is referenced in discovery_and_meta.endpoints or as a hint
    const hints = body.hints?.next_actions ?? body.hints;
    const portalHint = Array.isArray(hints) ? hints.find((h: any) => h.url === '/v1/portal') : null;
    assert(portalHint, 'hints should include portal link');
});

// ─── Summary ───
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
