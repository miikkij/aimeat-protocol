/**
 * @file e2e-audio-speech.ts
 * @description E2E tests for aimeat-audio.js and aimeat-speech.js library endpoints and samples.
 * @version-history
 *   v1.0.0 — 2026-04-30 — Initial implementation
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

console.log(`\n=== AIMEAT Audio & Speech Libraries E2E Test ===\n`);
console.log(`Server: ${BASE}\n`);

// ── Audio library endpoint ──

console.log('Audio Library');

await test('GET /v1/libs/aimeat-audio.js returns JavaScript', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-audio.js`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    assert(ct.includes('javascript'), `Expected JS content-type, got: ${ct}`);
    const body = await res.text();
    assert(body.includes('AIMEAT.audio'), 'Should contain AIMEAT.audio');
    assert(body.includes('play'), 'Should contain play function');
    assert(body.includes('piano'), 'Should contain piano instrument');
    assert(body.includes('drums'), 'Should contain drums instrument');
    assert(body.includes('synth'), 'Should contain synth builder');
    assert(body.includes('soundboard'), 'Should contain soundboard');
    assert(body.includes('connectRealtime'), 'Should contain realtime bridge');
    assert(body.length > 10000, `Expected >10KB, got ${body.length} bytes`);
});

await test('audio.js is valid JavaScript (IIFE structure)', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-audio.js`);
    const body = await res.text();
    assert(body.trim().endsWith(');'), 'Should end with );');
    assert(body.includes('(function(global)'), 'Should start with IIFE');
});

// ── Speech library endpoint ──

console.log('\nSpeech Library');

await test('GET /v1/libs/aimeat-speech.js returns JavaScript', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-speech.js`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    assert(ct.includes('javascript'), `Expected JS content-type, got: ${ct}`);
    const body = await res.text();
    assert(body.includes('AIMEAT.speech'), 'Should contain AIMEAT.speech');
    assert(body.includes('say'), 'Should contain say function');
    assert(body.includes('listen'), 'Should contain listen function');
    assert(body.includes('voices'), 'Should contain voices function');
    assert(body.includes('use'), 'Should contain use (provider) function');
    assert(body.length > 3000, `Expected >3KB, got ${body.length} bytes`);
});

// ── Library listing ──

console.log('\nLibrary Listing');

await test('GET /v1/libs includes audio and speech', async () => {
    const res = await fetch(`${BASE}/v1/libs`);
    const data = await res.json() as any;
    assert(data.ok === true, 'Expected ok: true');
    const names = data.libraries.map((l: any) => l.name);
    assert(names.includes('aimeat-audio'), 'Should list aimeat-audio');
    assert(names.includes('aimeat-speech'), 'Should list aimeat-speech');
});

// ── Sample files ──

console.log('\nSample Files');

await test('Piano samples are accessible', async () => {
    const notes = ['A2', 'C4', 'A4', 'C7'];
    for (const note of notes) {
        const res = await fetch(`${BASE}/lib/samples/piano/${note}.mp3`);
        assert(res.status === 200, `Piano ${note}.mp3: expected 200, got ${res.status}`);
        const ct = res.headers.get('content-type') || '';
        assert(ct.includes('audio') || ct.includes('mpeg') || ct.includes('octet'), `Piano ${note}.mp3: expected audio content-type, got ${ct}`);
    }
});

await test('Sample LICENSE.md exists', async () => {
    const res = await fetch(`${BASE}/lib/samples/LICENSE.md`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.text();
    assert(body.includes('Salamander'), 'Should mention Salamander');
    assert(body.includes('CC BY 3.0'), 'Should mention CC BY 3.0');
});

// ── Summary ──

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
