/**
 * @file e2e-search-visibility.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a search engine gets from the node, on every host family, read the way Googlebot
 *   reads it: without JavaScript and with a crawler's User-Agent. Self-spawns its own node with the
 *   app origin and the portfolio origin provisioned, because the shared runner keeps both off.
 *
 *   TARGET-090 (JavaScript and CSS out of the search reports):
 *     - every .js, .mjs, .css and .map answer, on the apex, a per-app host, the bare app host and a
 *       portfolio host, says X-Robots-Tag: noindex, and robots.txt blocks none of them;
 *     - the shell tags each module and stylesheet with its own content hash, so the tag is the
 *       same on every request and differs between two files;
 *     - a request with an old tag answers the file, never a 5xx.
 *   TARGET-089 (apps in search engines):
 *     - a search-visible app's own address opens its body with the app's name as the h1 and the
 *       owner's description, plus the script that removes the block once the page is parsed;
 *     - an app nobody may find gets no block and stays out of the sitemap index (the failure mode);
 *     - the search-visible app is in the sitemap index and the SEO status counts it. The rule for
 *       an app with no description is unit-tested (test/unit/app-seo-listable.test.ts), because the
 *       API no longer lets anyone make one.
 *   TARGET-091: /index.html on the apex answers 301 to `/`.
 * @version-history
 *   v1.0.0 — 2026-11-06 — Initial (TARGET-090, TARGET-089, TARGET-091).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=search-visibility

import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hostRequest, type HostResponse } from './helpers/host-request.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';

const PORT = process.env.E2E_SEARCH_VISIBILITY_PORT ?? '28531';
const BASE = `http://localhost:${PORT}`;
const APP_HOST = 'apps.aimeat.test';
const PORTFOLIO_HOST = 'portfolio.aimeat.test';
const DB_PATH = resolve(process.cwd(), 'test/.test-search-visibility.db');
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** The tag utils/asset-version.ts computes, from the file on disk. */
const tagOf = (path: string) => createHash('sha256').update(readFileSync(join(process.cwd(), 'public', path))).digest('hex').slice(0, 10);

type Family = 'apex' | 'app' | 'bare-app' | 'portfolio';
/** A GET on one host family, the way nginx delivers it there, as Googlebot. */
function on(family: Family, path: string, label = ''): Promise<HostResponse> {
    const headers: Record<string, string> = { 'User-Agent': GOOGLEBOT, Accept: 'text/html,*/*' };
    let host = `localhost:${PORT}`;
    if (family === 'app') { host = `${label}.${APP_HOST}:${PORT}`; headers['x-app-origin'] = '1'; headers['x-subdomain'] = label; }
    if (family === 'bare-app') { host = `${APP_HOST}:${PORT}`; headers['x-app-origin'] = '1'; }
    if (family === 'portfolio') { host = `${label}.${PORTFOLIO_HOST}:${PORT}`; headers['x-portfolio-origin'] = '1'; headers['x-subdomain'] = label; }
    return hostRequest(BASE, path, host, { headers });
}

async function json(path: string, token: string, method = 'GET', body?: unknown) {
    const res = await fetch(`${BASE}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
    return { status: res.status, body: parsed };
}

function cleanupDb() {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* a file another run still holds is removed by the next */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const db = await ownNodeDb(PORT, { sqlitePath: DB_PATH });
    const env = {
        ...process.env,
        ...db.env,
        AIMEAT_PORT: PORT,
        AIMEAT_BASE_URL: BASE,
        AIMEAT_NODE_ID: 'aimeat-local-001-dev',
        AIMEAT_APP_HOST: APP_HOST,
        AIMEAT_APP_ORIGIN_ENABLED: 'true',
        AIMEAT_PORTFOLIO_HOST: PORTFOLIO_HOST,
        AIMEAT_PORTFOLIO_ORIGIN_ENABLED: 'true',
        AIMEAT_SEO_INDEXING: 'on',
        AIMEAT_SEO_ANNOUNCE_APPS: 'true',
        AIMEAT_APPS_SEO_MODE: 'owner',
        AIMEAT_INDEXNOW_KEY: '',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args],
        { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the search-visibility node' });
}

async function main() {
    const server = await startServer();
    try {
        const owner = `seovis${Date.now() % 100000}`;
        let token = '';
        const FINDABLE = { filename: 'findable-demo.html', sub: 'findable-demo', name: 'Findable Demo',
            description: 'Measures how far a paper plane flies and keeps every throw.' };
        const UNLISTED = { filename: 'unlisted-demo.html', sub: 'unlisted-demo', name: 'Unlisted Demo' };
        const HTML = '<!DOCTYPE html><html><head><title>x</title></head>\n<body><div id="root"></div>'
            + '<script>document.getElementById("root").textContent = "drawn";</script></body></html>';

        console.log(`\n🔎 Search visibility on every host family — ${BASE}\n`);
        console.log('Setup');

        // An app with no description of its own cannot be made through the API any more (a publish
        // and a settings change both refuse an empty one); it exists only as older data, as on
        // aimeat.io. The rule for it is proven in test/unit/app-seo-listable.test.ts.
        await test('register the operator and publish two apps', async () => {
            token = (await registerOwner(BASE, owner)).token;
            for (const [app, description] of [[FINDABLE, FINDABLE.description], [UNLISTED, 'Not asked to be found.']] as const) {
                const r = await json('/v1/apps', token, 'POST', {
                    filename: app.filename, content: b64(HTML), name: app.name, description, category: 'utility', tags: ['demo'],
                });
                assert(r.status === 201, `${app.filename}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
                // The per-app subdomain is assigned on the first open of the apex address.
                await fetch(`${BASE}/v1/apps/${owner}/${app.filename}?mode=inline`, { redirect: 'manual' });
            }
            const r = await json(`/v1/apps/${FINDABLE.filename}`, token, 'PATCH', { seo: { index: true } });
            assert(r.status === 200, `seo on: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
        });

        console.log('\nTARGET-089: the app\'s name and description in the document as sent');

        await test('a search-visible app opens its body with its name as the h1 and its description', async () => {
            const r = await on('app', '/', FINDABLE.sub);
            assert(r.status === 200, `status ${r.status}`);
            assert(!/noindex/i.test(r.header('x-robots-tag') ?? ''), `the app is search-visible, got X-Robots-Tag ${r.header('x-robots-tag')}`);
            const at = r.body.indexOf('<div id="aimeat-app-body"');
            assert(at > 0, 'no #aimeat-app-body in the document');
            assert(r.body.slice(0, at).trimEnd().endsWith('<body>'), `the block does not open the body: …${r.body.slice(Math.max(0, at - 80), at)}`);
            const block = r.body.slice(at, r.body.indexOf('</div>', at));
            assert(block.includes(`<h1>${FINDABLE.name}</h1>`), `h1 missing: ${block.slice(0, 400)}`);
            assert(block.includes(`<p>${FINDABLE.description}</p>`), `description missing: ${block.slice(0, 400)}`);
            assert(block.includes('<script src="/js/app-body.js" defer></script>'), 'the removal script is missing');
            assert(!/display:\s*none|visibility:\s*hidden|position:/i.test(block), `the block hides or positions itself: ${block.slice(0, 400)}`);
        });

        await test('an app nobody may find gets no block: its bytes stay as they were', async () => {
            const r = await on('app', '/', UNLISTED.sub);
            assert(r.status === 200, `status ${r.status}`);
            assert(/noindex/i.test(r.header('x-robots-tag') ?? ''), `expected noindex, got ${r.header('x-robots-tag')}`);
            assert(!r.body.includes('aimeat-app-body'), 'an app that is not search-visible got the block');
        });

        await test('the removal script is served on the app host, as JavaScript and noindex', async () => {
            const r = await on('app', '/js/app-body.js', FINDABLE.sub);
            assert(r.status === 200 && /javascript/.test(r.header('content-type') ?? ''), `${r.status} ${r.header('content-type')}`);
            assert(/noindex/i.test(r.header('x-robots-tag') ?? ''), `X-Robots-Tag ${r.header('x-robots-tag')}`);
            assert(r.body.includes("getElementById('aimeat-app-body')"), 'unexpected script body');
        });

        await test('the sitemap index lists the search-visible app and leaves out the other', async () => {
            const r = await on('apex', '/sitemap-index.xml');
            assert(r.status === 200, `status ${r.status}`);
            assert(r.body.includes(`${FINDABLE.sub}.${APP_HOST}/sitemap.xml`), `findable app missing: ${r.body}`);
            assert(!r.body.includes(UNLISTED.sub), `the app nobody may find is listed: ${r.body}`);
        });

        await test('the search-visible app serves its sitemap, and its robots.txt names it', async () => {
            const robots = await on('app', '/robots.txt', FINDABLE.sub);
            assert(/Sitemap: .*\/sitemap\.xml/.test(robots.body), robots.body);
            const sm = await on('app', '/sitemap.xml', FINDABLE.sub);
            assert(sm.status === 200 && sm.body.includes('<urlset'), `sitemap answered ${sm.status}: ${sm.body.slice(0, 200)}`);
        });

        await test('the operator\'s SEO status lists no app without a description and counts one app host', async () => {
            const r = await json('/v1/admin/seo/status', token);
            assert(r.status === 200, `status ${r.status}`);
            const data = r.body.data ?? r.body;
            assert(Array.isArray(data.apps.without_description) && data.apps.without_description.length === 0,
                `without_description ${JSON.stringify(data.apps.without_description)}`);
            assert(data.sitemap.app_host_count === 1, `app_host_count ${data.sitemap.app_host_count}`);
        });

        console.log('\nTARGET-090: JavaScript and CSS say noindex, and their tag follows their content');

        const families: Array<[Family, string]> = [['apex', ''], ['app', FINDABLE.sub], ['bare-app', ''], ['portfolio', owner]];
        const assets: Array<[string, number]> = [
            ['/components/Mark.js', 200], ['/lib/preact.mjs', 200], ['/css/poster.css', 200], ['/js/no-such-file.js.map', 404],
        ];
        for (const [family, label] of families) {
            for (const [path, expected] of assets) {
                await test(`${family}: ${path} answers ${expected} with X-Robots-Tag noindex`, async () => {
                    const r = await on(family, path, label);
                    assert(r.status === expected, `status ${r.status}, expected ${expected}`);
                    assert(!/^text\/html/i.test(r.header('content-type') ?? ''), `answered as HTML: ${r.header('content-type')}`);
                    assert(/\bnoindex\b/i.test(r.header('x-robots-tag') ?? ''), `X-Robots-Tag "${r.header('x-robots-tag')}"`);
                });
            }
        }

        await test('robots.txt blocks no script and no stylesheet, on the apex and on an app host', async () => {
            for (const r of [await on('apex', '/robots.txt'), await on('app', '/robots.txt', FINDABLE.sub)]) {
                const blocked = r.body.split('\n').filter((l) => /^Disallow:\s*\/(js|css|lib|components|views)\b|^Disallow:.*\.(m?js|css)/i.test(l.trim()));
                assert(blocked.length === 0, `robots.txt blocks: ${blocked.join(' | ')}`);
            }
        });

        await test('the shell tags each module and stylesheet with its own content hash, the same on every request', async () => {
            const one = (await on('apex', '/')).body;
            const two = (await on('apex', '/')).body;
            const mark = `/components/Mark.js?v=${tagOf('/components/Mark.js')}`;
            const poster = `/css/poster.css?v=${tagOf('/css/poster.css')}`;
            const landing = `/views/landing.js?v=${tagOf('/views/landing.js')}`;
            for (const want of [mark, poster, landing]) {
                assert(one.includes(`"${want}"`), `${want} not in the shell`);
                assert(two.includes(`"${want}"`), `${want} not in the second answer`);
            }
            const build = /<meta name="aimeat-build" content="([^"]+)">/.exec(one)?.[1] ?? '';
            const stamped = one.match(new RegExp(`"[^"]+\\.(?:m?js|css)\\?v=${build}"`, 'g')) ?? [];
            assert(build !== '' && stamped.length === 0, `assets still carry the build stamp ${build}: ${stamped.slice(0, 5).join(' ')}`);
            assert(!/import\('\/views\/[^']+'\s*\+/.test(one), 'a view is still imported with a query of its own');
        });

        await test('a request with an old tag answers the file, never a 5xx', async () => {
            const r = await on('apex', '/components/Mark.js?v=mvgzlhz9');
            assert(r.status === 200, `status ${r.status}`);
            const m = await on('app', '/css/poster.css?v=0000000000', FINDABLE.sub);
            assert(m.status === 200, `app host status ${m.status}`);
        });

        console.log('\nTARGET-091: one address for the front page');

        await test('/index.html on the apex answers 301 to /', async () => {
            const r = await on('apex', '/index.html');
            assert(r.status === 301, `status ${r.status}`);
            assert(r.header('location') === '/', `Location ${r.header('location')}`);
        });

        await test('/index.html on an app host is not sent to the apex front page', async () => {
            const r = await on('app', '/index.html', FINDABLE.sub);
            assert(!(r.status === 301 && r.header('location') === '/'), `status ${r.status}, Location ${r.header('location')}`);
        });
    } finally {
        server.kill('SIGTERM');
        cleanupDb();
    }

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
