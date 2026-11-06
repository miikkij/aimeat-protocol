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
 *   v1.3.0 — 2026-11-06 — Jouni's rule of 2026-11-06: switching search on below 150 words of the app's
 *     own text is refused before anything is written (REST and MCP), the seo answer says the count,
 *     and an app in search whose text goes stays in search but leaves the sitemap index.
 *   v1.2.0 — 2026-11-06 — TARGET-093: the text about the app, set with aimeat_app_manage settings and
 *     PATCH, on the page under the description in its language, in and out of the SEO status's thin
 *     list, removed with an empty string, and refused to a second owner.
 *   v1.1.0 — 2026-11-06 — TARGET-092: the agent block's shape (one statement, at most 30 words, four
 *     links, no heading), the two head links, and the four linked addresses answering 200.
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
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

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
        /** Enough of the app's own text for search to be switched on (TARGET-093): 16 sentences, 160 words. */
        const SETUP_ABOUT = Array.from({ length: 16 }, () => 'The lab measures how far each paper plane flies and keeps it.').join('\n\n');
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
            // Search on needs 150 words of the app's own text (TARGET-093): this request brings the
            // text with it, and the route counts it before the first write.
            const r = await json(`/v1/apps/${FINDABLE.filename}`, token, 'PATCH', { about: SETUP_ABOUT, about_lang: 'en', seo: { index: true } });
            assert(r.status === 200, `seo on: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
        });

        await test('switching search on for an app with too little text of its own is refused, and nothing is written', async () => {
            const r = await json(`/v1/apps/${UNLISTED.filename}`, token, 'PATCH', { name: 'Renamed Unlisted', seo: { index: true } });
            assert(r.status === 400 && /150/.test(JSON.stringify(r.body)), `expected a 400 naming the 150-word floor, got ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
            const page = await on('app', '/', UNLISTED.sub);
            assert(/noindex/i.test(page.header('x-robots-tag') ?? ''), 'the thin app became search-visible');
            const list = await fetch(`${BASE}/v1/apps?limit=200`).then((x) => x.json()) as any;
            const row = (list.data?.apps ?? []).find((a: any) => a.filename === UNLISTED.filename);
            assert(row && row.manifest?.name === UNLISTED.name, `the refused request still renamed the app: ${row?.manifest?.name}`);
        });

        await test('the seo action over MCP says how many words the page has and how many it needs', async () => {
            const agent = await makeAgent(BASE, { name: owner, token }, ['app:write', 'app:read']);
            const s = await openSession(BASE, agent.token);
            const r = await callTool(s, 'aimeat_app_manage', { action: 'seo', filename: UNLISTED.filename });
            assert(!r.isError && /"own_words":\s*\d+/.test(r.text) && /"own_words_min":\s*150/.test(r.text), `answer: ${r.text.slice(0, 300)}`);
            const on2 = await callTool(s, 'aimeat_app_manage', { action: 'seo', filename: UNLISTED.filename, index: true });
            assert(on2.isError && /150/.test(on2.text), `switching on a thin app over MCP: ${on2.text.slice(0, 300)}`);
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

        await test('the agent block is one statement of at most 30 words with four links, and the head links stay (TARGET-092)', async () => {
            const r = await on('app', '/', FINDABLE.sub);
            const block = /<noscript id="aimeat-agent-discovery">([\s\S]*?)<\/noscript>/.exec(r.body)?.[1] ?? '';
            const text = block.replace(/<[^>]+>/g, '');
            assert(block !== '', 'no agent block');
            assert((text.match(/\S+/g) ?? []).length <= 30, `${(text.match(/\S+/g) ?? []).length} words: ${text}`);
            assert(!/FOR AN AGENT|READING THIS PAGE/i.test(text), `the old heading is still there: ${text}`);
            const hrefs = [...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
            assert(hrefs.length === 4 && hrefs[0] === '?format=md' && hrefs[3] === '/.well-known/mcp.json'
                && hrefs[1].endsWith(`/v1/apps/${owner}/${FINDABLE.filename}/webmcp`) && hrefs[2].endsWith(`/v1/apps/${owner}/${FINDABLE.filename}/skills`),
                `links ${JSON.stringify(hrefs)}`);
            assert(r.body.includes('<link rel="mcp-server" href="/.well-known/mcp.json">'), 'rel=mcp-server is missing');
            assert(r.body.includes('<link rel="alternate" type="text/markdown" href="?format=md"'), 'rel=alternate markdown is missing');
        });

        await test('the four addresses the agent block links answer 200', async () => {
            const md = await on('app', '/?format=md', FINDABLE.sub);
            assert(md.status === 200 && /markdown/.test(md.header('content-type') ?? ''), `?format=md: ${md.status} ${md.header('content-type')}`);
            const card = await on('app', '/.well-known/mcp.json', FINDABLE.sub);
            assert(card.status === 200, `mcp.json: ${card.status}`);
            for (const tail of ['webmcp', 'skills']) {
                const res = await fetch(`${BASE}/v1/apps/${owner}/${FINDABLE.filename}/${tail}`);
                assert(res.status === 200, `${tail}: ${res.status}`);
            }
        });

        // TARGET-093: the owner's text about the app.
        const ABOUT = Array.from({ length: 16 }, (_, i) =>
            `Paragraph ${i + 1} says what the paper plane lab measures and how a thrower uses it.`).join('\n\n');

        await test('an app in search whose text is taken off is listed as thin, stays in search, and leaves the sitemap index', async () => {
            const off = await json(`/v1/apps/${FINDABLE.filename}`, token, 'PATCH', { about: '' });
            assert(off.status === 200, `taking the text off: ${off.status}`);
            const page = await on('app', '/', FINDABLE.sub);
            assert(!/noindex/i.test(page.header('x-robots-tag') ?? ''), 'an app already in search was taken out of it');
            const index = await on('apex', '/sitemap-index.xml');
            assert(!index.body.includes(`${FINDABLE.sub}.${APP_HOST}`), 'a page under 150 words is still in the sitemap index');
            const r = await json('/v1/admin/seo/status', token);
            const thin = (r.body.data ?? r.body).apps.thin_text as Array<{ filename: string; words: number; has_about: boolean }>;
            const row = thin.find((a) => a.filename === FINDABLE.filename);
            assert(!!row && row.words < 150 && row.has_about === false, `thin_text ${JSON.stringify(thin)}`);
        });

        await test('an agent sets the text about the app with aimeat_app_manage settings', async () => {
            const agent = await makeAgent(BASE, { name: owner, token }, ['app:write', 'app:read']);
            const s = await openSession(BASE, agent.token);
            const r = await callTool(s, 'aimeat_app_manage', { action: 'settings', filename: FINDABLE.filename, about: ABOUT, about_lang: 'en' });
            assert(!r.isError, `the tool refused: ${r.text.slice(0, 300)}`);
            assert(r.text.includes('"about_lang":"en"') || r.text.includes('about_lang'), `the answer does not carry the text: ${r.text.slice(0, 300)}`);
        });

        await test('the page shows the text under the description, headed in its language, and states that language', async () => {
            const r = await on('app', '/', FINDABLE.sub);
            const at = r.body.indexOf('<div id="aimeat-app-body"');
            const block = r.body.slice(at, r.body.indexOf('</div>', at));
            assert(block.startsWith('<div id="aimeat-app-body" lang="en">'), `lang: ${block.slice(0, 60)}`);
            assert(block.indexOf(`<p>${FINDABLE.description}</p>`) < block.indexOf('<section><h2>About this app</h2>'), 'the section is not under the description');
            assert(block.includes('<p>Paragraph 16 says what the paper plane lab measures and how a thrower uses it.</p>'), 'the text is not on the page');
        });

        await test('the owner changes the language over REST, and the heading follows it', async () => {
            const r = await json(`/v1/apps/${FINDABLE.filename}`, token, 'PATCH', { about_lang: 'fi' });
            assert(r.status === 200 && r.body.data?.about_lang === 'fi', `PATCH: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
            const page = await on('app', '/', FINDABLE.sub);
            assert(page.body.includes('<div id="aimeat-app-body" lang="fi">') && page.body.includes('<h2>Tietoa sovelluksesta</h2>'), 'heading or lang did not follow');
            const bad = await json(`/v1/apps/${FINDABLE.filename}`, token, 'PATCH', { about: 'A new text with no language given at all.', about_lang: 'not a tag' });
            assert(bad.status === 400, `a malformed language got ${bad.status}`);
        });

        await test('the SEO status no longer lists the app once its text is set', async () => {
            const r = await json('/v1/admin/seo/status', token);
            const thin = (r.body.data ?? r.body).apps.thin_text as Array<{ filename: string }>;
            assert(!thin.some((a) => a.filename === FINDABLE.filename), `still thin: ${JSON.stringify(thin)}`);
        });

        await test('a second owner cannot set the text of the first owner\'s app', async () => {
            const other = (await registerOwner(BASE, `${owner}c`)).token;
            const r = await json(`/v1/apps/${FINDABLE.filename}`, other, 'PATCH', { about: 'Not yours.', about_lang: 'en' });
            assert(r.status === 404 || r.status === 403, `a second owner's PATCH got ${r.status}`);
            const page = await on('app', '/', FINDABLE.sub);
            assert(!page.body.includes('Not yours.'), 'the second owner\'s text reached the page');
        });

        await test('an empty text removes the section, and the block states no language', async () => {
            const r = await json(`/v1/apps/${FINDABLE.filename}`, token, 'PATCH', { about: '' });
            assert(r.status === 200 && r.body.data?.about === null, `PATCH: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
            const page = await on('app', '/', FINDABLE.sub);
            assert(page.body.includes('<div id="aimeat-app-body">') && !page.body.includes('<section><h2>'), 'the section is still there');
            // Put it back for the later tests that read the page.
            await json(`/v1/apps/${FINDABLE.filename}`, token, 'PATCH', { about: ABOUT, about_lang: 'en' });
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

        await test('the SEO status, which names other people\'s apps, is refused to a second owner and to nobody signed in', async () => {
            const other = (await registerOwner(BASE, `${owner}b`)).token;
            const second = await json('/v1/admin/seo/status', other);
            assert(second.status === 403, `a second owner got ${second.status}`);
            const anon = await fetch(`${BASE}/v1/admin/seo/status`);
            assert(anon.status === 401, `nobody signed in got ${anon.status}`);
            // Nor can the second owner switch search on for the first owner's app: the filename
            // names an app in their own account, where there is none.
            const steal = await json(`/v1/apps/${UNLISTED.filename}`, other, 'PATCH', { seo: { index: true } });
            assert(steal.status === 404 || steal.status === 403, `a second owner's PATCH got ${steal.status}`);
            const still = await on('app', '/', UNLISTED.sub);
            assert(!still.body.includes('aimeat-app-body') && /noindex/i.test(still.header('x-robots-tag') ?? ''), 'the first owner\'s app became search-visible');
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
