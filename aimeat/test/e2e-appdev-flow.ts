/**
 * @file e2e-appdev-flow.ts
 * @description E2E for the research-first flow surfaces (AppDev KB Phase 7):
 *   GET /v1/prompts/appdev-flow (json + txt, flow markers), the build-app prompt's new
 *   Step 0 Research + T1/T2/T3 decision tree + aimeat-iam + finish checklist markers,
 *   the llms.txt flow pointer, and the bootstrap app_building research/flow pointers.
 * @usage registered in test/run-e2e-ci.ts; run via the e2e harness
 *   (cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=appdev-flow).
 * @version-history v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 7).
 */

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

console.log('\n=== AIMEAT AppDev Flow Prompt E2E Test ===\n');

await test('GET /v1/prompts/appdev-flow serves the flow (json)', async () => {
    const res = await fetch(`${BASE}/v1/prompts/appdev-flow`);
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.data.id === 'appdev-flow', 'wrong id');
    const p = body.data.prompt as string;
    assert(/research → frame → propose → build → finish/.test(p), 'flow phases missing');
    assert(/node:aimeat-app-builder/.test(p), 'builder skill missing');
    assert(/aimeat_appdev_overview/.test(p), 'overview tool missing');
    assert(/aimeat_app_template_propose/.test(p), 'template propose missing');
    assert(/aimeat_appdev_pitfall_report/.test(p), 'pitfall report missing');
    assert(/just build it the usual way/.test(p), 'skip phrase missing');
});

await test('?format=txt returns text/plain', async () => {
    const res = await fetch(`${BASE}/v1/prompts/appdev-flow?format=txt`);
    assert(res.status === 200, `status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('text/plain'), 'not text/plain');
    const text = await res.text();
    assert(/research-first flow/.test(text), 'txt body wrong');
});

await test('build-app prompt gained Step 0 Research + skip clause', async () => {
    const res = await fetch(`${BASE}/v1/prompts/build-app?format=txt`);
    const p = await res.text();
    assert(/## Step 0 — Research first/.test(p), 'Step 0 missing');
    assert(/aimeat_appdev_overview/.test(p), 'overview call missing from Step 0');
    assert(/just build it the usual way/.test(p), 'skip clause missing');
    // Step 0 comes before Step 1
    assert(p.indexOf('Step 0') < p.indexOf('Step 1'), 'Step 0 not before Step 1');
});

await test('build-app prompt gained the T1/T2/T3 decision tree + aimeat-iam guidance', async () => {
    const res = await fetch(`${BASE}/v1/prompts/build-app?format=txt`);
    const p = await res.text();
    assert(/Choose the app's shape \(T1\/T2\/T3\)/.test(p), 'decision tree missing');
    assert(/T1 — pure client/.test(p) && /T3 — \+extension/.test(p), 'tier lines missing');
    assert(/aimeat-iam/.test(p), 'aimeat-iam guidance missing');
    assert(/FINISH \(after a successful publish/.test(p), 'finish checklist missing from MCP section');
});

await test('improve mode keeps the decision tree but no Step 0 interview header', async () => {
    const res = await fetch(`${BASE}/v1/prompts/build-app?format=txt&mode=improve`);
    const p = await res.text();
    assert(/Choose the app's shape/.test(p), 'decision tree missing in improve mode');
    assert(!/## Step 0 — Research first/.test(p), 'Step 0 leaked into improve mode');
});

await test('llms.txt points at the flow prompt + overview', async () => {
    const res = await fetch(`${BASE}/llms.txt`);
    const text = await res.text();
    assert(/\/v1\/prompts\/appdev-flow/.test(text), 'flow prompt pointer missing');
    assert(/aimeat_appdev_overview/.test(text), 'overview tool pointer missing');
});

await test('bootstrap app_building carries research_overview + flow_prompt + builder_skill', async () => {
    const res = await fetch(`${BASE}/?format=json`);
    const body = await res.json() as any;
    const app = body.data?.for_ai_assistants?.paths?.build_an_app?.app_building;
    assert(/aimeat_appdev_overview/.test(app?.research_overview ?? ''), 'research_overview missing');
    assert(/appdev-flow/.test(app?.flow_prompt ?? ''), 'flow_prompt missing');
    assert(/aimeat-app-builder/.test(app?.builder_skill ?? ''), 'builder_skill missing');
    assert(/appdev\/pitfalls/.test(app?.pitfalls_endpoint ?? ''), 'pitfalls_endpoint missing');
});

await test('unknown prompt id still rejects (route ordering intact)', async () => {
    // The /:tier fallback rejects unknown ids with 400 INVALID_TIER (pre-existing behavior);
    // the point here is that the new literal route did not shadow it into a 200.
    const res = await fetch(`${BASE}/v1/prompts/no-such-prompt-xyz`);
    assert(res.status === 400 || res.status === 404, `expected 400/404, got ${res.status}`);
});

console.log('\n' + '─'.repeat(40));
console.log(`AppDev flow E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All appdev-flow tests passed!\n');
