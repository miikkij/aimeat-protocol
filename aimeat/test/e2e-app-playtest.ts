/**
 * @file test/e2e-app-playtest.ts
 * @description E2E for the game playtest bench: GET /v1/apps/:owner/:filename/audit?playtest=true
 *   opens a published app in a headless browser and answers with the eight checks, or with
 *   ran:false and the reason on a machine that has no browser. Both are the contract, so the suite
 *   asserts the SHAPE and the sentence rather than assuming a browser exists.
 *
 *   The bench has to be able to refuse, so a second app is published that draws one flat colour on
 *   its canvas — the black screen a player calls broken — and the `paints` check is asserted to
 *   fail on it. A bench that has never failed anything has proven nothing.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=app-playtest
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial (the game playtest bench).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function setupOwner(label: string) {
    const name = `pt${label}${Date.now()}`.toLowerCase();
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Pt', password: 'PlaytestBench1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Pt', password: 'PlaytestBench1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

/** A canvas app built the way a small game is: one file, no outside assets, a thumb-sized control. */
function goodApp(filename: string): string {
    return [
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        `<meta name="aimeat-app" content="${filename}">`,
        '<meta name="aimeat-scopes" content="memory:read memory:write">',
        '<meta name="aimeat-locales" content="en">',
        '<title>Playtest target</title>',
        '<style>',
        'html,body{margin:0;background:#101014;color:#eeeeee;font-family:system-ui,sans-serif}',
        'main{display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px;box-sizing:border-box}',
        'canvas{width:100%;height:auto;display:block}',
        'button{min-height:44px;min-width:96px;font-size:16px}',
        '</style></head><body><main>',
        '<canvas id="stage" width="320" height="180"></canvas>',
        '<button id="go" type="button">Start</button>',
        '</main><script>',
        'var c=document.getElementById("stage");var g=c.getContext("2d");',
        'function draw(){g.fillStyle="#1b2a4a";g.fillRect(0,0,320,180);',
        'g.fillStyle="#ffcc33";g.fillRect(20,20,60,60);',
        'g.fillStyle="#33ddaa";g.fillRect(140,80,80,40);}',
        'draw();document.getElementById("go").addEventListener("click",draw);',
        '</' + 'script></body></html>',
    ].join('\n');
}

/** The same app with the game missing: a canvas filled with one flat colour and nothing on it. */
function blackScreenApp(filename: string): string {
    return [
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        `<meta name="aimeat-app" content="${filename}">`,
        '<title>Black screen</title>',
        '<style>html,body{margin:0}canvas{width:100%;height:auto;display:block}</style>',
        '</head><body><canvas id="stage" width="320" height="180"></canvas><script>',
        'var g=document.getElementById("stage").getContext("2d");',
        'g.fillStyle="#000000";g.fillRect(0,0,320,180);',
        '</' + 'script></body></html>',
    ].join('\n');
}

const CHECK_IDS = ['boots', 'paints', 'clean-console', 'resizes', 'audio-gated', 'touch-targets', 'saves', 'reduced-motion'];

(async () => {
    console.log('\n── The game playtest bench: eight checks, or the worded unavailable ──');

    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const good = `ptgood${Date.now()}.html`;
    const dark = `ptdark${Date.now()}.html`;

    await test('setup: two canvas apps are published, one that draws and one that does not', async () => {
        for (const [file, html] of [[good, goodApp(good)], [dark, blackScreenApp(dark)]] as const) {
            const r = await json('/v1/apps', {
                method: 'POST', headers: auth(a.token),
                body: JSON.stringify({ filename: file, mime_type: 'text/html', content: b64(html), name: 'Playtest', description: 'A canvas app for the playtest bench.' }),
            });
            assert(r.status === 201, `publish ${file}: ${r.status} ${JSON.stringify(r.body?.error)}`);
        }
    });

    await test('without the flag the audit read is the log alone: no browser is started', async () => {
        const r = await json(`/v1/apps/me/${good}/audit`, { headers: auth(a.token) });
        assert(r.status === 200, `audit ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.live === undefined, `no live run without the flag, got ${JSON.stringify(r.body.data.live)}`);
    });

    await test('?playtest=false is not a yes', async () => {
        const r = await json(`/v1/apps/me/${good}/audit?playtest=false`, { headers: auth(a.token) });
        assert(r.status === 200, `audit ${r.status}`);
        assert(r.body.data.live === undefined, 'the word false must not read as true because the string is not empty');
    });

    // Both outcomes are the contract. On a machine with a browser the eight checks come back with
    // their sentences; on a CI box with none it says so. A silent 500 or a pass it did not earn is
    // neither, and that is what these assertions hold.
    let ran = false;
    await test('the playtest answers its contract: eight checks with sentences, or the worded unavailable', async () => {
        const r = await json(`/v1/apps/me/${good}/audit?playtest=true`, { headers: auth(a.token) });
        assert(r.status === 200, `playtest ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const live = r.body.data.live;
        assert(!!live, 'the live run comes back with the log');
        assert(Array.isArray(live.artifact?.blocking) && Array.isArray(live.artifact?.warnings),
            `the bytes check runs first, got ${JSON.stringify(live.artifact)}`);
        const pt = live.playtest;
        assert(typeof pt?.ran === 'boolean' && typeof pt.at === 'string', `ran and at are always there, got ${JSON.stringify(pt)}`);
        ran = pt.ran === true;
        // One assertion covering both outcomes, so neither branch can pass by not being tested:
        // a run brings the eight checks, an unavailable one brings a sentence saying why.
        assert(ran
            ? Array.isArray(pt.checks) && pt.checks.length === CHECK_IDS.length
            : typeof pt.reason === 'string' && pt.reason.length > 20,
        `a run answers with ${CHECK_IDS.length} checks and an unavailable one with a reason, got ${JSON.stringify({ ran, reason: pt.reason, checks: pt.checks?.length })}`);
        if (!ran) {
            console.log(`     (no browser on this machine: "${pt.reason}")`);
            return;
        }
        for (const id of CHECK_IDS) {
            const c = pt.checks.find((x: any) => x.id === id);
            assert(!!c, `the ${id} check is present`);
            assert(typeof c.ok === 'boolean' && (c.severity === 'must' || c.severity === 'info'), `${id} carries ok and severity`);
            assert(typeof c.detail === 'string' && /[a-z]{4,}.*\./i.test(c.detail), `${id} says something in a sentence, got "${c.detail}"`);
        }
        assert(pt.checks.find((c: any) => c.id === 'saves').severity === 'info', 'the save round-trip is reported as information');
        assert(Array.isArray(pt.console?.errors) && typeof pt.console.warnings === 'number', 'the console comes back counted');
        assert(pt.screenshots === undefined, 'no images are stored or returned');
        assert(typeof pt.summary?.ok === 'boolean' && typeof pt.summary.failed === 'number', 'a summary a caller can branch on');
        const failing = pt.checks.filter((c: any) => c.severity === 'must' && !c.ok);
        assert(pt.summary.failed === failing.length, `the summary counts the must checks that failed, got ${pt.summary.failed} against ${failing.length}`);
        assert(pt.summary.ok === true,
            `a canvas app that draws, fits both screens and asks for no sound passes; it failed: ${JSON.stringify(failing.map((c: any) => c.detail))}`);
    });

    await test('the bench can refuse: a canvas of one flat colour fails the black-screen check', async () => {
        if (!ran) { console.log('     (skipped: no browser on this machine)'); return; }
        const r = await json(`/v1/apps/me/${dark}/audit?playtest=true`, { headers: auth(a.token) });
        assert(r.status === 200, `playtest ${r.status}`);
        const pt = r.body.data.live?.playtest;
        assert(pt?.ran === true, `the run happened, got ${JSON.stringify(pt?.reason)}`);
        const paints = pt.checks.find((c: any) => c.id === 'paints');
        assert(paints.ok === false, `one flat colour is a black screen, got "${paints.detail}"`);
        assert(/one colour/i.test(paints.detail), `the sentence names what is wrong, got "${paints.detail}"`);
        assert(pt.summary.ok === false && pt.summary.failed >= 1, `the summary carries the failure, got ${JSON.stringify(pt.summary)}`);
    });

    await test('a stranger cannot play another owner\'s app through this door, and nor can anyone anonymous', async () => {
        const path = `/v1/apps/${a.name}/${good}/audit?playtest=true`;
        const stranger = await json(path, { headers: auth(b.token) });
        assert(stranger.status === 404, `a stranger gets the same refusal the log gives, got ${stranger.status}`);
        assert(stranger.body?.data?.live === undefined, 'and nothing about the app comes back with it');
        const anon = await json(path);
        assert(anon.status === 401, `anonymous 401, got ${anon.status}`);
    });

    console.log('\nCleanup');
    await test('Delete both apps', async () => {
        for (const file of [good, dark]) {
            const r = await json(`/v1/apps/${file}`, { method: 'DELETE', headers: auth(a.token) });
            assert(r.status === 200, `delete ${file}: ${r.status}`);
        }
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
})();
