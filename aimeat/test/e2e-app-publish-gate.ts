/**
 * @file e2e-app-publish-gate.ts
 * @description E2E for the two things the node now checks when an app is published: whether the
 *   publisher carried the build spec, and whether the bytes can actually run.
 *
 *   THE PUBLISH THIS SUITE IS WRITTEN FROM (aimeat.io, 2026-08-11). An agent built and published an
 *   app without loading the `node:aimeat-app-builder` skill and without fetching
 *   GET /v1/prompts/build-app, modelling it on an old template it had lying around. It went live
 *   with three defects the spec answers in plain words:
 *     1. it loaded /lib/aimeat-auth.js and /lib/aimeat-data.js — both 404; the path is /v1/libs/,
 *     2. it hardcoded its colours past the platform theme tokens, so the login pill's light/dark
 *        switch and palette picker did nothing,
 *     3. it read agent-written data with no ownerScope, so the signed-in owner saw an empty screen.
 *   Nothing in the publish path looked at the file. The response said "published".
 *
 *   AND THE LESSON FROM THE SAME SESSION, which decides the SHAPE of everything below: both the MCP
 *   server instructions and the skill say to read the spec first, and both were skipped without
 *   consequence, while a machine-readable `mobile_hints` field in a publish response changed the
 *   agent's behaviour on the spot. Prose asks; a value that has to be carried is a gate. So the spec
 *   check reports a STATUS, and the two provable defects REFUSE the publish.
 *
 *   THE LINE THIS SUITE DEFENDS IN BOTH DIRECTIONS: an app that cannot run must not go live, and an
 *   app that is merely imperfect must still publish. A check that blocks a working app teaches
 *   people to route around the gate, and then the blocking half is worthless too — so every refusal
 *   case is paired with a "and this one publishes" case.
 * @structure owner + second owner · the spec token (ok/stale/missing/skipped, and where a skip is
 *   visible afterwards) · blocking artifacts on all three REST doors · the warnings · next_steps
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-publish-gate
 * @version-history
 *   v1.2.0 — 2026-09-05 — The REGISTER gate: an Atelier app with no `aimeat-register` meta, or
 *     with the shell's REPLACE-ME placeholder still in the head, is refused with the
 *     atelier-register finding; the same app naming `genre-nightfloor` publishes; a Classic app
 *     without the meta still publishes; the bare shell, published as served, is refused on
 *     purpose. The track-carry-forward fixture now names a register too: it was an Atelier app
 *     with no look, which is exactly what the gate refuses (pitfalls §19: setup no longer matched).
 *   v1.1.0 — 2026-08-27 — The Atelier track (TARGET-074): its own spec route and `atelier-`
 *     token satisfy the gate with an answer naming the track; `aimeat-track` lands on the
 *     manifest and carries forward through a silent update; an undeclared track stays absent;
 *     the shell-atelier template declares its track and points at its own guide.
 *   v1.0.0 — 2026-08-11 — initial.
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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

async function setupOwner(label: string) {
    const name = `gate${label}${Date.now()}`.toLowerCase();
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Gate', password: 'PublishGate1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Gate', password: 'PublishGate1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

/** An app that follows the spec: real library URLs, platform theme, the head declarations. */
const GOOD_APP = [
    '<!DOCTYPE html><html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content">',
    '<meta name="aimeat-app" content="APPFILE">',
    '<meta name="aimeat-scopes" content="memory:read memory:write">',
    '<meta name="aimeat-locales" content="en fi">',
    '<link rel="stylesheet" href="/lib/aimeat-theme.css">',
    '<style>.card{background:var(--color-base-200);display:grid;grid-template-columns:minmax(0,1fr)}.card>*{min-width:0}</style>',
    '</head><body style="overflow-x:clip"><div id="login"></div><div class="card">ok</div>',
    '<script src="/v1/libs/aimeat-auth.js"></' + 'script>',
    '<script>',
    'AIMEAT.auth.mountLoginButton("#login", { onLogin: start });',
    'async function start() {',
    '  const { items } = await AIMEAT.data.list({ prefix: "gate.", ownerScope: true, meta: true });',
    '  await AIMEAT.data.set("gate.seen", items.length);',
    '}',
    '</' + 'script></body></html>',
].join('\n');

const app = (filename: string, html = GOOD_APP) => html.split('APPFILE').join(filename);

/** The first defect from the incident: a library URL that does not exist on this node. */
const DEAD_URL_APP = GOOD_APP.replace('/v1/libs/aimeat-auth.js', '/lib/aimeat-auth.js');

/** An inline script the browser would stop at. */
const BROKEN_JS_APP = GOOD_APP.replace('const { items } =', 'const { items = =');

/** The second defect: its own light/dark, past the platform tokens. */
const HARDCODED_THEME_APP = GOOD_APP
    .replace('<link rel="stylesheet" href="/lib/aimeat-theme.css">', '')
    .replace('<style>.card{background:var(--color-base-200);',
        '<style>:root{--bg:#ffffff;--fg:#111111;--card:#f4f4f4;--line:#dddddd;--brand:#2266cc}'
        + '@media (prefers-color-scheme: dark){:root{--bg:#121212;--fg:#eeeeee;--card:#1e1e1e}}'
        + 'body{background:#ffffff;color:#111111}.card{background:#f4f4f4;');

/** Read one app back the way the owner's catalogue does. */
async function appRow(owner: string, filename: string, token?: string) {
    const r = await json(`/v1/apps?q=${encodeURIComponent(filename)}&limit=200`, token ? { headers: auth(token) } : {});
    assert(r.status === 200, `list ${r.status}`);
    return (r.body.data.apps ?? []).find((a: any) => a.owner === owner && a.filename === filename);
}

const publish = (token: string, body: Record<string, unknown>) =>
    json('/v1/apps', { method: 'POST', headers: auth(token), body: JSON.stringify(body) });

(async () => {
    console.log('\n── App publish gate: the build spec, and whether the bytes can run ──');

    const o = await setupOwner('o');
    const other = await setupOwner('x');

    // ── The spec token ────────────────────────────────────────────────────────────────────────

    let specToken = '';
    await test('GET /v1/prompts/build-app hands out a spec token, and the prompt itself names it', async () => {
        const r = await json('/v1/prompts/build-app');
        assert(r.status === 200, `build-app ${r.status}`);
        specToken = r.body.data.spec_token;
        assert(typeof specToken === 'string' && specToken.startsWith('spec-'),
            `no usable spec_token: ${JSON.stringify(specToken)}`);
        // The plain-text reader never sees the envelope, so the token has to be IN the prompt too.
        assert((r.body.data.prompt as string).includes(specToken),
            'the prompt text does not name its own token — a ?format=txt reader would never learn it exists');
        const txt = await fetch(`${BASE}/v1/prompts/build-app?format=txt`).then(x => x.text());
        assert(txt.includes(specToken), 'the text/plain form dropped the token');
    });

    await test('the token is stable across calls and across ?idea= / ?lang= — it digests the SPEC, not the request', async () => {
        const a = await json('/v1/prompts/build-app?lang=fi&idea=a%20recipe%20box');
        const b = await json('/v1/prompts/build-app?mode=improve');
        assert(a.body.data.spec_token === specToken && b.body.data.spec_token === specToken,
            `the token moved with the request: ${a.body.data.spec_token} / ${b.body.data.spec_token} vs ${specToken}`);
    });

    const missingName = `gatemissing${Date.now()}.html`;
    await test('publishing WITHOUT a token publishes, and says the token is missing', async () => {
        const r = await publish(o.token, {
            filename: missingName, mime_type: 'text/html', content: b64(app(missingName)),
            name: 'No token', description: 'Published without carrying the spec.',
        });
        assert(r.status === 201, `the spec check must never refuse — got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.spec_check?.status === 'missing',
            `expected spec_check.status "missing", got ${JSON.stringify(r.body.data.spec_check)}`);
        // The remedy has to be IN the answer, or the agent has to guess where the spec lives.
        assert((r.body.data.spec_check.message as string).includes('/v1/prompts/build-app'),
            'the message does not name the spec URL');
        assert(r.body.data.spec_check.skill === 'node:aimeat-app-builder',
            `the answer must name the skill: ${JSON.stringify(r.body.data.spec_check)}`);
    });

    await test('a token from an older spec answers "stale", and never leaks the current one', async () => {
        const r = await publish(o.token, {
            filename: `gatestale${Date.now()}.html`, mime_type: 'text/html', content: b64(app('x.html')),
            name: 'Stale token', description: 'Built against an older spec.', spec_token: 'spec-000000000000',
        });
        assert(r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.spec_check?.status === 'stale',
            `expected "stale", got ${JSON.stringify(r.body.data.spec_check)}`);
        // Echoing the expected token would let the next call satisfy the gate by copying a string
        // out of an error — which is exactly the "somebody once saw a document" proof it replaces.
        assert(!JSON.stringify(r.body.data.spec_check).includes(specToken),
            'the answer handed back the current token, so the gate can be satisfied without reading anything');
    });

    await test('the current token answers "ok"', async () => {
        const r = await publish(o.token, {
            filename: `gateok${Date.now()}.html`, mime_type: 'text/html', content: b64(app('x.html')),
            name: 'Current', description: 'Built against the current spec.', spec_token: specToken,
        });
        assert(r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.spec_check?.status === 'ok',
            `expected "ok", got ${JSON.stringify(r.body.data.spec_check)}`);
    });

    // ── The Atelier track (TARGET-074): its own spec, its own token, its own manifest mark ────

    let atelierToken = '';
    await test('the ATELIER track has its own spec and token, and the two tracks never collide', async () => {
        const r = await json('/v1/prompts/build-app-atelier');
        assert(r.status === 200, `build-app-atelier ${r.status}`);
        atelierToken = r.body.data.spec_token;
        assert(typeof atelierToken === 'string' && atelierToken.startsWith('atelier-'),
            `the Atelier token must be recognisable as the Atelier one: ${JSON.stringify(atelierToken)}`);
        assert(atelierToken !== specToken, 'the two specs share one token — the gate could not tell the tracks apart');
        const prompt = r.body.data.prompt as string;
        // The spec is self-contained for its track: it names its shell and its token, and it
        // never sends the builder to the Classic spec.
        assert(prompt.includes('shell-atelier'), 'the spec must name its shell');
        assert(prompt.includes(atelierToken), 'the prompt text must name its own token (the ?format=txt reader never sees the envelope)');
        const stable = await json('/v1/prompts/build-app-atelier?mode=improve');
        assert(stable.body.data.spec_token === atelierToken, 'the token moved with the request');
        const txt = await fetch(`${BASE}/v1/prompts/build-app-atelier?format=txt`).then(x => x.text());
        assert(txt.includes(atelierToken), 'the text/plain form dropped the token');
    });

    await test('the Atelier token answers "ok", and the answer names the track it proves', async () => {
        const r = await publish(o.token, {
            filename: `gateat${Date.now()}.html`, mime_type: 'text/html', content: b64(app('x.html')),
            name: 'Atelier current', description: 'Built against the Atelier spec.', spec_token: atelierToken,
        });
        assert(r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.spec_check?.status === 'ok',
            `expected "ok", got ${JSON.stringify(r.body.data.spec_check)}`);
        assert((r.body.data.spec_check.message as string).includes('ATELIER'),
            'an ok that does not say WHICH spec it proves lets the tracks blur');
    });

    const trackName = `gatetrack${Date.now()}.html`;
    await test('aimeat-track lands on the manifest, and survives an update that stops declaring it', async () => {
        const tracked = app(trackName).replace(
            '<meta name="aimeat-scopes"',
            '<meta name="aimeat-track" content="atelier">\n<meta name="aimeat-register" content="genre-receipt">\n<meta name="aimeat-scopes"');
        const first = await publish(o.token, {
            filename: trackName, mime_type: 'text/html', content: b64(tracked),
            name: 'Tracked', description: 'An Atelier-track app.', spec_token: atelierToken,
        });
        assert(first.status === 201, `publish ${first.status}: ${JSON.stringify(first.body?.error)}`);
        let row = await appRow(o.name, trackName, o.token);
        assert(row?.manifest?.track === 'atelier',
            `the manifest must record the track: ${JSON.stringify(row?.manifest?.track)}`);
        // A later version published WITHOUT the meta keeps the answer — an edit session months
        // from now must still learn which guide built this app.
        const update = await publish(o.token, {
            filename: trackName, mime_type: 'text/html', content: b64(app(trackName)),
            name: 'Tracked', description: 'An Atelier-track app.', spec_token: atelierToken,
        });
        assert(update.status === 201, `update ${update.status}: ${JSON.stringify(update.body?.error)}`);
        row = await appRow(o.name, trackName, o.token);
        assert(row?.manifest?.track === 'atelier',
            `the track must carry forward through a silent update: ${JSON.stringify(row?.manifest?.track)}`);
    });

    await test('an app that declares no track has no track — every pre-track app reads as classic', async () => {
        const row = await appRow(o.name, missingName, o.token);
        assert(row && row.manifest.track === undefined,
            `an undeclared track must stay absent, got ${JSON.stringify(row?.manifest?.track)}`);
    });

    await test('the Atelier shell is served, declares its track, and points at its own guide', async () => {
        const r = await json('/v1/app-templates/shell-atelier');
        assert(r.status === 200, `shell-atelier ${r.status}`);
        const content = r.body.data.template.content as string;
        assert(content.includes('name="aimeat-track" content="atelier"'), 'the shell must declare its track');
        assert(content.includes('/v1/prompts/build-app-atelier'), 'the shell must point at the Atelier guide');
        assert(content.includes('/lib/aimeat-boot.js'), 'the shell must use the served boot script, not an inline IIFE');
        assert(!content.includes('daisyui'), 'the Atelier shell must not load the Classic styling stack');
    });

    // ── The register: an Atelier app names the look it committed to ──────────────────────────
    // Every Atelier app built from the bare shell came out as stacked sections in the default
    // look, and the Design Book's genres exist so a page starts from a committed register
    // (docs/pitfalls.md §34). Nothing enforced that. Now the shell carries a placeholder the
    // builder has to replace, and the publish refuses the placeholder and the absence alike.

    /** An Atelier app in miniature: track declared, kit loaded, and the register line if given. */
    const atelierApp = (filename: string, register?: string) => [
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">',
        `<meta name="aimeat-app" content="${filename}">`,
        '<meta name="aimeat-track" content="atelier">',
        ...(register ? [`<meta name="aimeat-register" content="${register}">`] : []),
        '<meta name="aimeat-locales" content="en">',
        '<link rel="stylesheet" href="/lib/aimeat-atelier.css">',
        '</head><body><script src="/v1/libs/aimeat-atelier.js"></' + 'script></body></html>',
    ].join('\n');

    const registerless = `gatenoreg${Date.now()}.html`;
    await test('an Atelier app that names no register is REFUSED, and the refusal says where the genres are', async () => {
        const r = await publish(o.token, {
            filename: registerless, mime_type: 'text/html', content: b64(atelierApp(registerless)),
            name: 'No register', description: 'The bare shell with words in it.', spec_token: atelierToken,
        });
        assert(r.status === 422, `expected 422, got ${r.status}: ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
        assert(r.body.error?.code === 'APP_ARTIFACT_BROKEN', `error code ${r.body.error?.code}`);
        const hit = (r.body.error?.details?.findings ?? []).find((f: any) => f.pitfall === 'atelier-register');
        assert(!!hit, `the refusal must carry the atelier-register finding: ${JSON.stringify(r.body.error?.details)}`);
        assert((hit.message as string).includes('/v1/designbook?kind=genre') && (hit.message as string).includes('aimeat-register'),
            `the message must say where the genres are and what line to add: ${hit.message}`);
        assert(!await appRow(o.name, registerless, o.token), 'the refused app is in the catalogue');
    });

    await test('the shell\'s REPLACE-ME placeholder is refused the same way — the bare shell is a frame, not a page', async () => {
        const f = `gatereplaceme${Date.now()}.html`;
        const r = await publish(o.token, {
            filename: f, mime_type: 'text/html',
            content: b64(atelierApp(f, 'REPLACE-ME: fork a genre from the Design Book (GET /v1/designbook?kind=genre) or name your own register')),
            name: 'Placeholder', description: 'The shell line was never replaced.', spec_token: atelierToken,
        });
        assert(r.status === 422, `expected 422, got ${r.status}: ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
        assert((r.body.error?.details?.findings ?? []).some((f: any) => f.pitfall === 'atelier-register'),
            `expected the atelier-register finding: ${JSON.stringify(r.body.error?.details)}`);
        assert(!await appRow(o.name, f, o.token), 'the refused app is in the catalogue');
    });

    await test('the served Atelier shell carries the placeholder, so published AS IS it is refused on purpose', async () => {
        const t = await json('/v1/app-templates/shell-atelier');
        assert(t.status === 200, `shell-atelier ${t.status}`);
        const shell = t.body.data.template.content as string;
        assert(/<meta name="aimeat-register" content="REPLACE-ME[^"]*"/.test(shell),
            'the shell must carry the REPLACE-ME register line for the builder to replace');
        const f = `gatebareshell${Date.now()}.html`;
        const r = await publish(o.token, {
            filename: f, mime_type: 'text/html', content: b64(shell),
            name: 'Bare shell', description: 'The shell, untouched.', spec_token: atelierToken,
        });
        assert(r.status === 422, `the bare shell must not publish — got ${r.status}: ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
        assert((r.body.error?.details?.findings ?? []).some((f: any) => f.pitfall === 'atelier-register'),
            `expected the atelier-register finding on the bare shell: ${JSON.stringify(r.body.error?.details)}`);
    });

    await test('the SAME app naming genre-nightfloor publishes, with no register finding', async () => {
        const r = await publish(o.token, {
            filename: registerless, mime_type: 'text/html', content: b64(atelierApp(registerless, 'genre-nightfloor')),
            name: 'Night floor', description: 'Forked from a genre.', spec_token: atelierToken,
        });
        assert(r.status === 201, `an app with a register must publish — got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(!(r.body.data.app_hints ?? []).some((h: any) => h.pitfall === 'atelier-register'),
            `a named register must leave no register finding: ${JSON.stringify(r.body.data.app_hints)}`);
        assert(!!await appRow(o.name, registerless, o.token), 'the accepted app is not in the catalogue');
    });

    await test('a Classic app that names no register still publishes — the register is an Atelier commitment', async () => {
        const f = `gateclassicnoreg${Date.now()}.html`;
        const r = await publish(o.token, {
            filename: f, mime_type: 'text/html', content: b64(app(f)),
            name: 'Classic', description: 'Classic track, no register line.', spec_token: specToken,
        });
        assert(r.status === 201, `a Classic app must be untouched by the register gate — got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(!(r.body.data.app_hints ?? []).some((h: any) => h.pitfall === 'atelier-register'),
            `no register finding on a Classic app: ${JSON.stringify(r.body.data.app_hints)}`);
    });

    const skippedName = `gateskip${Date.now()}.html`;
    await test('an owner-declared skip is ANSWERED as skipped, not silently accepted', async () => {
        const r = await publish(o.token, {
            filename: skippedName, mime_type: 'text/html', content: b64(app(skippedName)),
            name: 'Skipped', description: 'The owner said to publish without the spec.',
            spec_ack: 'skipped-by-owner',
        });
        assert(r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.spec_check?.status === 'skipped',
            `expected "skipped", got ${JSON.stringify(r.body.data.spec_check)}`);
    });

    await test('...and it is still there a month later, on the app, where the OWNER can see it', async () => {
        const row = await appRow(o.name, skippedName, o.token);
        assert(!!row, 'the app is not in the owner\'s own listing');
        assert(row.manifest?.specCheck?.status === 'skipped',
            `the skip left no durable trace: ${JSON.stringify(row.manifest?.specCheck)}`);
        assert(typeof row.manifest.specCheck.at === 'string', 'the record does not say when');
    });

    await test('...and NOBODY ELSE sees it — how an owner works is not a public badge', async () => {
        for (const [who, token] of [['another owner', other.token], ['anonymous', undefined]] as const) {
            const row = await appRow(o.name, skippedName, token);
            assert(!!row, `${who} cannot see the app at all`);
            assert(!row.manifest?.specCheck,
                `${who} can read the owner-only spec-check note: ${JSON.stringify(row.manifest?.specCheck)}`);
            assert(!row.spec_check, `${who} can read spec_check on the row`);
        }
    });

    await test('a later clean publish CLEARS the note — it describes this version, not the app forever', async () => {
        const r = await publish(o.token, {
            filename: skippedName, mime_type: 'text/html', content: b64(app(skippedName)),
            description: 'Now built against the spec.', spec_token: specToken,
        });
        assert(r.status === 201, `update ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.spec_check?.status === 'ok', `expected "ok", got ${JSON.stringify(r.body.data.spec_check)}`);
        const row = await appRow(o.name, skippedName, o.token);
        assert(!row.manifest?.specCheck,
            `the note survived a clean publish: ${JSON.stringify(row.manifest?.specCheck)}`);
    });

    // ── The blocking half: an app that cannot run does not go live ─────────────────────────────

    const brokenJsName = `gatebrokenjs${Date.now()}.html`;
    await test('an app whose inline script does not parse is REFUSED, and nothing is written', async () => {
        const r = await publish(o.token, {
            filename: brokenJsName, mime_type: 'text/html', content: b64(app(brokenJsName, BROKEN_JS_APP)),
            name: 'Broken', description: 'The browser would stop at the syntax error.', spec_token: specToken,
        });
        assert(r.status === 422, `expected 422, got ${r.status}: ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
        assert(r.body.error?.code === 'APP_ARTIFACT_BROKEN', `error code ${r.body.error?.code}`);
        const ids = (r.body.error?.details?.findings ?? []).map((f: any) => f.pitfall);
        assert(ids.includes('inline-js-does-not-parse'),
            `the refusal must name the pitfall an agent can look up: ${JSON.stringify(r.body.error?.details)}`);
        // A refusal that half-published would be worse than no gate at all.
        assert(!await appRow(o.name, brokenJsName, o.token), 'THE BUG: the refused app is in the catalogue');
    });

    const deadUrlName = `gatedeadurl${Date.now()}.html`;
    await test('an app whose script URL this node answers 404 for is REFUSED (the incident case)', async () => {
        const r = await publish(o.token, {
            filename: deadUrlName, mime_type: 'text/html', content: b64(app(deadUrlName, DEAD_URL_APP)),
            name: 'Dead URL', description: 'Loads /lib/aimeat-auth.js, which does not exist.', spec_token: specToken,
        });
        assert(r.status === 422, `expected 422, got ${r.status}: ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
        const findings = r.body.error?.details?.findings ?? [];
        assert(findings.some((f: any) => f.pitfall === 'invented-lib-urls'),
            `expected the invented-lib-urls finding: ${JSON.stringify(findings)}`);
        assert(findings.some((f: any) => (f.message as string).includes('/lib/aimeat-auth.js')),
            `the refusal must name the URL that 404s: ${JSON.stringify(findings)}`);
        assert(!await appRow(o.name, deadUrlName, o.token), 'the refused app is in the catalogue');
    });

    await test('the pitfall id in a refusal resolves to a real entry', async () => {
        for (const id of ['inline-js-does-not-parse', 'invented-lib-urls', 'namespace-rule', 'app-meta-declarations', 'atelier-register']) {
            const r = await json(`/v1/appdev/pitfalls/${id}`);
            assert(r.status === 200 && r.body.data?.pitfall?.id === id,
                `GET /v1/appdev/pitfalls/${id} → ${r.status}; a finding pointing at nothing is worse than no pointer`);
        }
    });

    await test('the SAME app fixed publishes immediately — the gate is about broken, not about strict', async () => {
        const r = await publish(o.token, {
            filename: deadUrlName, mime_type: 'text/html', content: b64(app(deadUrlName)),
            name: 'Fixed', description: 'Same app with the real library URL.', spec_token: specToken,
        });
        assert(r.status === 201, `the fixed app must publish — got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    });

    // ── Every door, not just the one this was written on ───────────────────────────────────────

    await test('DOOR 2 — the presigned upload runs the same check and carries the same token', async () => {
        const f = `gatedoor2${Date.now()}.html`;
        const pre = await publish(o.token, {
            filename: f, mode: 'presigned', mime_type: 'text/html',
            name: 'Door 2', description: 'Presigned.', spec_token: specToken,
        });
        assert(pre.status === 200 || pre.status === 201, `presigned ${pre.status}: ${JSON.stringify(pre.body?.error)}`);
        const url = pre.body.data.upload_url as string;

        const bad = await fetch(url.startsWith('http') ? url : `${BASE}${url}`, {
            method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: app(f, DEAD_URL_APP),
        });
        assert(bad.status === 422, `the recommended door must refuse a broken app too — got ${bad.status}`);
        assert(!await appRow(o.name, f, o.token), 'the refused upload landed anyway');

        // A fresh token: the first is spent. The spec token stated at the handshake must survive.
        const pre2 = await publish(o.token, {
            filename: f, mode: 'presigned', mime_type: 'text/html',
            name: 'Door 2', description: 'Presigned.', spec_token: specToken,
        });
        const put = await fetch((pre2.body.data.upload_url as string).replace(/^(?!http)/, BASE), {
            method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: app(f),
        });
        assert(put.ok, `PUT ${put.status}`);
        const putBody = await put.json() as any;
        assert(putBody.spec_check?.status === 'ok',
            `the token stated at the handshake did not reach the publish: ${JSON.stringify(putBody.spec_check)}`);
    });

    await test('DOOR 3 — publish-draft refuses a broken draft AND leaves the draft in place to fix', async () => {
        const f = `gatedoor3${Date.now()}.html`;
        const save = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(f)}/draft`, {
            method: 'PUT', headers: auth(o.token),
            body: JSON.stringify({ content: b64(app(f, BROKEN_JS_APP)), mime_type: 'text/html', name: 'Door 3', description: 'Staged.' }),
        });
        assert(save.status === 200 || save.status === 201, `draft save ${save.status}: ${JSON.stringify(save.body?.error)}`);

        const pub = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(f)}/publish-draft`, {
            method: 'POST', headers: auth(o.token), body: JSON.stringify({ spec_token: specToken }),
        });
        assert(pub.status === 422, `expected 422, got ${pub.status}: ${JSON.stringify(pub.body?.error ?? pub.body?.data)}`);

        // Clearing the staging slot on a refusal would delete the only copy of the work.
        const draft = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(f)}/draft`, { headers: auth(o.token) });
        assert(draft.status === 200, `THE DRAFT WAS LOST on a refused promotion: ${draft.status}`);
    });

    // ── The warning half: everything else publishes, and says what is wrong ────────────────────

    await test('an app that hardcodes its colours publishes, with the hardcoded-theme-colors finding', async () => {
        const f = `gatetheme${Date.now()}.html`;
        const r = await publish(o.token, {
            filename: f, mime_type: 'text/html', content: b64(app(f, HARDCODED_THEME_APP)),
            name: 'Own colours', description: 'Paints its own light and dark.', spec_token: specToken,
        });
        assert(r.status === 201, `a warning must never refuse — got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const hints = r.body.data.app_hints ?? [];
        const hit = hints.find((h: any) => h.pitfall === 'hardcoded-theme-colors');
        assert(!!hit, `expected the hardcoded-theme-colors finding: ${JSON.stringify(hints)}`);
        assert(hit.severity === 'warn' && hit.url === '/v1/appdev/pitfalls/hardcoded-theme-colors',
            `the finding must carry its own lookup: ${JSON.stringify(hit)}`);
    });

    await test('a read-only app that names no namespace publishes, with the namespace-rule finding', async () => {
        const f = `gatens${Date.now()}.html`;
        const html = app(f).replace(
            'const { items } = await AIMEAT.data.list({ prefix: "gate.", ownerScope: true, meta: true });\n'
            + '  await AIMEAT.data.set("gate.seen", items.length);',
            'const { items } = await AIMEAT.data.list({ prefix: "gate." });\n  render(items);');
        const r = await publish(o.token, {
            filename: f, mime_type: 'text/html', content: b64(html),
            name: 'Unscoped', description: 'Reads what the agents wrote, without saying whose.', spec_token: specToken,
        });
        assert(r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert((r.body.data.app_hints ?? []).some((h: any) => h.pitfall === 'namespace-rule'),
            `expected the namespace-rule finding: ${JSON.stringify(r.body.data.app_hints)}`);
    });

    await test('an app that follows the spec gets NO artifact findings at all', async () => {
        const f = `gateclean${Date.now()}.html`;
        const r = await publish(o.token, {
            filename: f, mime_type: 'text/html', content: b64(app(f)),
            name: 'Clean', description: 'Follows the spec.', spec_token: specToken,
        });
        assert(r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(!r.body.data.app_hints,
            `a correct app must publish in silence, or the findings become noise: ${JSON.stringify(r.body.data.app_hints)}`);
    });

    // ── The reminder every door owes ───────────────────────────────────────────────────────────

    await test('every publish response names the agent face and the bound skill', async () => {
        const f = `gatenext${Date.now()}.html`;
        const r = await publish(o.token, {
            filename: f, mime_type: 'text/html', content: b64(app(f)),
            name: 'Next steps', description: 'Checks the reminder.', spec_token: specToken,
        });
        assert(r.status === 201, `publish ${r.status}`);
        const next = r.body.data.next_steps;
        assert(!!next, 'no next_steps in the REST publish response');
        assert(next.agent_face_present === false && /AIMEATAgentFace\.publish/.test(next.agent_face),
            `the face reminder must name the call: ${JSON.stringify(next.agent_face)}`);
        assert(next.bound_skills_count === 0 && /metadata\.binding/.test(next.bound_skill),
            `the skill reminder must name the binding: ${JSON.stringify(next.bound_skill)}`);
    });

    // ── How big it has become ──────────────────────────────────────────────────────────────────
    // An app on this node is one file, and a file has no natural brake: one reached 3.18 MB across
    // 369 publishes while its author only ever felt it as edits getting slower. The numbers travel
    // on every publish; the SENTENCE is spent only when it is earned, because a response that
    // lectures the median 39 kB app is a response people stop reading.

    await test('an ordinary app is weighed and told nothing', async () => {
        const f = `gatesize${Date.now()}.html`;
        const r = await publish(o.token, {
            filename: f, mime_type: 'text/html', content: b64(app(f)),
            name: 'Small', description: 'Ordinary size.', spec_token: specToken,
        });
        assert(r.status === 201, `publish ${r.status}`);
        const size = r.body.data.next_steps?.size;
        assert(!!size, 'next_steps.size missing from the publish response');
        assert(size.bytes > 0 && size.ceiling_bytes > size.bytes, `bytes/ceiling wrong: ${JSON.stringify(size)}`);
        assert(size.level === 'quiet', `a small app must stay quiet, got ${size.level}`);
        assert(size.note === undefined, `a small app must get no sentence: ${size.note}`);
    });

    await test('an app near the ceiling is told, in bytes and in words', async () => {
        const f = `gatebig${Date.now()}.html`;
        // Past 60% of the 5 MB ceiling. Filler inside a comment so the artifact checks still pass:
        // the point is the weight, not the content.
        const filler = '<!-- ' + 'x'.repeat(3_300_000) + ' -->';
        const r = await publish(o.token, {
            filename: f, mime_type: 'text/html', content: b64(app(f).replace('</body>', filler + '</body>')),
            name: 'Large', description: 'Near the ceiling.', spec_token: specToken,
        });
        assert(r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const size = r.body.data.next_steps?.size;
        assert(!!size, 'next_steps.size missing on the large publish');
        assert(size.share_of_ceiling >= 0.6, `share should be past 0.6, got ${size.share_of_ceiling}`);
        assert(size.level === 'warn' || size.level === 'at-the-wall', `a big app must speak, got ${size.level}`);
        assert(/storage/.test(size.note ?? ''), `the note must say where the weight goes: ${size.note}`);
        assert(/aimeat-app-workstation/.test(size.note ?? ''), `the note must name the skill: ${size.note}`);
    });

    // ── And who may knock at all ───────────────────────────────────────────────────────────────
    // Everything above is about what the gate SAYS to a publisher. This is the prior question: the
    // checks run behind the door, not in front of it, so an unauthenticated caller never reaches
    // them — no spec check, no artifact finding, no size line, and no row.

    await test('a publish with no token is refused at every door, and writes nothing', async () => {
        const f = `gatedenied${Date.now()}.html`;
        const body = JSON.stringify({
            filename: f, mime_type: 'text/html', content: b64(app(f)),
            name: 'Denied', description: 'No token.', spec_token: specToken,
        });
        const anon = await json('/v1/apps', { method: 'POST', body });
        assert(anon.status === 401 || anon.status === 403, `an unauthenticated publish must be refused, got ${anon.status}`);

        const anonDraft = await json(`/v1/apps/${o.name}/${f}/publish-draft`, { method: 'POST', body: '{}' });
        assert(anonDraft.status === 401 || anonDraft.status === 403,
            `an unauthenticated draft promotion must be refused, got ${anonDraft.status}`);

        assert(!(await appRow(o.name, f, o.token)), 'a refused publish still left a row behind');
    });

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
