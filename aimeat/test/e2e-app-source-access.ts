/**
 * @file test/e2e-app-source-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every route that hands an app's source, or its page, to another person asks the app's
 *   audience the same question the app read asks (feature audit 2026-11-19, 1.1 and 1.2).
 *
 *   ONE FIXTURE. alice publishes a page with a look of its own, opens it for forking, says it turned
 *   out well, opens it only to her organism, and offers it as a Design Book genre. bob is a member of
 *   that organism; carol is not. Before the fix a forkable app opened to one organism gave its whole
 *   source to carol through POST .../fork and aimeat_app_fork, and the genre that grew out of it
 *   handed carol the same page through every template route.
 *
 *   ONE LIST. ROUTES below is every route this suite knows that gives the source, the page or the
 *   offer of it. Each entry is run as carol (refused, or the app is not there), as bob (gets it) and as
 *   alice (gets it). A later route that gives an app's source joins with one line.
 *
 *   THEN THE DESIGNED USE: opened to anyone again, carol forks it and the genre is offered to her, as
 *   before the fix. And a caller with no account gets nothing of an organism's app.
 * @structure fixture · ROUTES · the audience loop · the frame token · public again · no account
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-source-access
 * @version-history
 *   v1.1.0 — 2026-11-19 — The signed-in outsider's refusal of the app read and the fork is held to
 *     403 ACCESS_DENIED in its own test, beside the anonymous 401.
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 1.1 and 1.2).
 */
import { assert, BASE, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpSession } from './helpers/mcp-session.js';

const stamp = Date.now() % 100000;
const FILE = `srcaccess${stamp}.html`;
const GENRE = `genre-srcaccess-${stamp}`;
const MARK = `SOURCE-ACCESS-MARK-${stamp}`;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const PAGE = [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<meta name="aimeat-app" content="${FILE}">`,
    '<meta name="aimeat-track" content="atelier">',
    '<meta name="aimeat-register" content="custom:srcaccess">',
    '<meta name="aimeat-light" content="follows">',
    '<link rel="stylesheet" href="/lib/aimeat-atelier.css">',
    // The build notes a kept page carries (POST /v1/designbook/keep refuses a page without them).
    `<script type="application/json" id="aimeat-build-notes">${JSON.stringify({ made: [{ name: 'entry-page', what: 'one page of entries', why: 'no genre is a page of entries' }] })}</` + 'script>',
    `</head><body><main class="srcaccess-page">${MARK}</main><script src="/v1/libs/aimeat-atelier.js"></` + 'script></body></html>',
].join('\n');

/** One person: the account, a session of their agent on the node MCP. */
interface Who { label: 'alice' | 'bob' | 'carol'; owner: RegisteredOwner; mcp: McpSession }

/** What a route answered for one person: whether they got the source (or the offer of it), and what came back. */
interface Seen { saw: boolean; detail: string; refusedAs?: string }

let forks = 0;
const forkName = (who: Who) => `srcfork-${who.label}-${stamp}-${++forks}.html`;
const refusalCode = (body: any): string | undefined => body?.error?.code ?? body?.code;

/**
 * Every route that hands an app's source, its page or the offer of it to another person. `refuses`
 * names the refusal code an outsider gets where the route refuses rather than leaves the app out.
 */
const ROUTES: Array<{ name: string; refuses?: string; run: (who: Who) => Promise<Seen> }> = [
    { name: 'GET /v1/apps/:owner/:filename (the app read)', refuses: 'ACCESS_DENIED', run: async (who) => {
        const r = await json(`/v1/apps/${alice.owner.name}/${FILE}`, { headers: auth(who.owner.token) });
        return { saw: r.status === 200 && JSON.stringify(r.body).includes(MARK), detail: `${r.status}`, refusedAs: refusalCode(r.body) };
    } },
    { name: 'GET /v1/apps/:owner/:filename?format=md', refuses: 'ACCESS_DENIED', run: async (who) => {
        const r = await json(`/v1/apps/${alice.owner.name}/${FILE}?format=md`, { headers: auth(who.owner.token) });
        return { saw: r.status === 200 && JSON.stringify(r.body).includes(MARK), detail: `${r.status}`, refusedAs: refusalCode(r.body) };
    } },
    { name: 'POST /v1/apps/:owner/:filename/fork', refuses: 'ACCESS_DENIED', run: async (who) => {
        const target = forkName(who);
        const r = await json(`/v1/apps/${alice.owner.name}/${FILE}/fork`, { method: 'POST', headers: auth(who.owner.token), body: JSON.stringify({ new_filename: target }) });
        if (r.status !== 200 && r.status !== 201) return { saw: false, detail: `${r.status} ${JSON.stringify(r.body?.error)}`, refusedAs: refusalCode(r.body) };
        const copy = await json(`/v1/apps/${who.owner.name}/${target}`, { headers: auth(who.owner.token) });
        return { saw: JSON.stringify(copy.body).includes(MARK), detail: `${r.status}, the copy ${copy.status}` };
    } },
    { name: 'MCP aimeat_app_fork', refuses: 'ACCESS_DENIED', run: async (who) => {
        const target = forkName(who);
        const r = await callTool(who.mcp, 'aimeat_app_fork', { owner: alice.owner.name, filename: FILE, new_filename: target });
        if (r.isError) return { saw: false, detail: r.text.slice(0, 200), refusedAs: /^([A-Z_]+):/.exec(r.text)?.[1] };
        const copy = await json(`/v1/apps/${who.owner.name}/${target}`, { headers: auth(who.owner.token) });
        return { saw: JSON.stringify(copy.body).includes(MARK), detail: `forked, the copy ${copy.status}` };
    } },
    { name: 'GET /v1/app-templates/:id (the grown genre, whole)', run: async (who) => {
        const r = await json(`/v1/app-templates/${GENRE}`, { headers: auth(who.owner.token) });
        return { saw: r.status === 200 && String(r.body?.data?.template?.content ?? '').includes(MARK), detail: `${r.status}` };
    } },
    { name: 'GET /v1/app-templates?kind=genre (the index offers it)', run: async (who) => {
        const r = await json('/v1/app-templates?kind=genre', { headers: auth(who.owner.token) });
        return { saw: (r.body?.data?.templates ?? []).some((t: any) => t.id === GENRE), detail: `${r.status}` };
    } },
    { name: 'GET /v1/appdev/templates/:id (the connector\'s template route)', run: async (who) => {
        const r = await json(`/v1/appdev/templates/${GENRE}`, { headers: auth(who.owner.token) });
        return { saw: r.status === 200 && String(r.body?.data?.template?.content ?? '').includes(MARK), detail: `${r.status}` };
    } },
    { name: 'GET /v1/appdev/templates (node_templates offers it)', run: async (who) => {
        const r = await json('/v1/appdev/templates', { headers: auth(who.owner.token) });
        return { saw: (r.body?.data?.node_templates ?? []).some((t: any) => t.id === GENRE), detail: `${r.status}` };
    } },
    { name: 'MCP aimeat_app_template_get', run: async (who) => {
        const r = await callTool(who.mcp, 'aimeat_app_template_get', { id: GENRE });
        return { saw: !r.isError && String(r.data?.content ?? '').includes(MARK), detail: r.text.slice(0, 120) };
    } },
    { name: 'MCP aimeat_app_template_list (node_templates offers it)', run: async (who) => {
        const r = await callTool(who.mcp, 'aimeat_app_template_list', {});
        return { saw: !r.isError && (r.data?.node_templates ?? []).some((t: any) => t.id === GENRE), detail: r.text.slice(0, 120) };
    } },
    { name: 'GET /v1/designbook?view=map', run: async (who) => {
        const r = await json('/v1/designbook?view=map', { headers: auth(who.owner.token) });
        return { saw: String(r.body?.data?.map ?? '').includes('`' + GENRE + '`'), detail: `${r.status}` };
    } },
    { name: 'GET /v1/designbook?kind=genre (the shelf lists it)', run: async (who) => {
        const r = await json('/v1/designbook?kind=genre&limit=200', { headers: auth(who.owner.token) });
        return { saw: (r.body?.data?.parts ?? []).some((p: any) => p.id === GENRE), detail: `${r.status}` };
    } },
    { name: 'GET /v1/designbook/:id (the part read)', run: async (who) => {
        const r = await json(`/v1/designbook/${GENRE}`, { headers: auth(who.owner.token) });
        return { saw: r.status === 200 && r.body?.data?.part?.id === GENRE, detail: `${r.status}` };
    } },
    { name: 'GET /v1/designbook/:id/preview (the redirect to the app)', run: async (who) => {
        const r = await fetch(`${BASE}/v1/designbook/${GENRE}/preview`, { redirect: 'manual', headers: auth(who.owner.token) });
        await r.arrayBuffer();
        return { saw: r.status === 302 && (r.headers.get('location') ?? '').includes(FILE), detail: `${r.status}` };
    } },
    { name: 'MCP aimeat_designbook_search { view: "map" }', run: async (who) => {
        const r = await callTool(who.mcp, 'aimeat_designbook_search', { view: 'map' });
        return { saw: !r.isError && r.text.includes('`' + GENRE + '`'), detail: r.text.slice(0, 80) };
    } },
    { name: 'GET /v1/prompts/build-app-atelier/sections/book (the build spec\'s map)', run: async (who) => {
        const r = await json('/v1/prompts/build-app-atelier/sections/book', { headers: auth(who.owner.token) });
        return { saw: String(r.body?.data?.prompt ?? '').includes('`' + GENRE + '`'), detail: `${r.status}` };
    } },
];

let alice: Who, bob: Who, carol: Who;
let orgId = '';

async function person(label: Who['label']): Promise<Who> {
    const owner = await registerOwner(BASE, `${label}src${stamp}`);
    const agent = await makeAgent(BASE, owner, ['app:write', 'memory:read']);
    return { label, owner, mcp: await openSession(BASE, agent.token, `src-access-${label}`) };
}

console.log('\n=== Who gets an app\'s source ===\n');

await test('fixture: alice\'s forkable app, open to her organism only, offered as a genre; bob is a member, carol is not', async () => {
    alice = await person('alice');
    bob = await person('bob');
    carol = await person('carol');
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(alice.owner.token), body: JSON.stringify({ name: `Source Team ${stamp}`, type: 'team', join_policy: 'open', visibility: 'private' }) });
    assert(o.status === 201, `organism ${o.status} ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(bob.owner.token), body: '{}' });
    // An open organism takes bob in at once: 201, a membership made (202 would be a request waiting).
    assert(j.status === 201, `join ${j.status} ${JSON.stringify(j.body?.error)}`);

    const pub = await json('/v1/apps', { method: 'POST', headers: auth(alice.owner.token), body: JSON.stringify({ filename: FILE, mime_type: 'text/html', content: b64(PAGE), name: 'Source Access', description: 'A page with a look of its own.' }) });
    assert(pub.status === 201, `publish ${pub.status} ${JSON.stringify(pub.body?.error)}`);
    const keep = await json('/v1/designbook/keep', { method: 'POST', headers: auth(alice.owner.token), body: JSON.stringify({ filename: FILE }) });
    assert(keep.status === 200, `keep ${keep.status} ${JSON.stringify(keep.body?.error)}`);
    const set = await json(`/v1/apps/${FILE}`, { method: 'PATCH', headers: auth(alice.owner.token), body: JSON.stringify({ forkable: true, open_to: `organism:${orgId}` }) });
    assert(set.status === 200 && set.body.data.open_to === `organism:${orgId}`, `settings ${set.status} ${JSON.stringify(set.body?.data ?? set.body?.error)}`);
    const genre = await json('/v1/designbook', { method: 'POST', headers: auth(alice.owner.token), body: JSON.stringify({ part: {
        id: GENRE, kind: 'genre', title: 'Source Access', summary: 'A page with a look of its own, for the source access suite.',
        body: { app: { owner: alice.owner.name, filename: FILE }, judgement: { reach: 'general', why: 'Any app that shows one page of entries can start from this page.' } },
    } }) });
    assert([200, 201].includes(genre.status) && genre.body.data.status === 'published',
        `the genre earns the shelf for its owner: ${genre.status} ${JSON.stringify(genre.body?.data?.publishing ?? genre.body?.error)}`);
});

for (const route of ROUTES) {
    await test(`FAILURE: carol (not in the organism) does not get it: ${route.name}`, async () => {
        const seen = await route.run(carol);
        assert(!seen.saw, `carol got the source: ${seen.detail}`);
        // A route that refuses names its code; a route that leaves the app out names none.
        assert(seen.refusedAs === route.refuses, `carol is refused with ${route.refuses ?? 'nothing (left out)'}: ${seen.detail} ${seen.refusedAs ?? ''}`);
    });
    await test(`bob (a member) gets it: ${route.name}`, async () => {
        const seen = await route.run(bob);
        assert(seen.saw, `bob did not get it: ${seen.detail}`);
    });
    await test(`alice (the owner) gets it: ${route.name}`, async () => {
        const seen = await route.run(alice);
        assert(seen.saw, `alice did not get it: ${seen.detail}`);
    });
}

await test('FAILURE: carol, signed in but not in the organism, is refused the app read and the fork with 403', async () => {
    const read = await json(`/v1/apps/${alice.owner.name}/${FILE}`, { headers: auth(carol.owner.token) });
    expectRefusal(read, 403, 'ACCESS_DENIED');
    const fork = await json(`/v1/apps/${alice.owner.name}/${FILE}/fork`, { method: 'POST', headers: auth(carol.owner.token), body: JSON.stringify({ new_filename: `refused-${stamp}.html` }) });
    expectRefusal(fork, 403, 'ACCESS_DENIED');
});

await test('a member\'s gallery frame opens the genre preview with the listed token and no session', async () => {
    const r = await json('/v1/designbook?kind=genre&limit=200', { headers: auth(bob.owner.token) });
    const row = (r.body?.data?.parts ?? []).find((p: any) => p.id === GENRE);
    assert(row && String(row.preview_url).includes('?t='), `listed with a token: ${JSON.stringify(row)}`);
    const frame = await fetch(`${BASE}${row.preview_url}`, { redirect: 'manual' });
    await frame.arrayBuffer();
    assert(frame.status === 302, `the frame opens it: ${frame.status}`);
    const bare = await fetch(`${BASE}/v1/designbook/${GENRE}/preview`, { redirect: 'manual' });
    await bare.arrayBuffer();
    assert(bare.status === 404, `without the token or a session it has nothing to show: ${bare.status}`);
});

await test('FAILURE: a caller with no account gets neither the app nor its genre', async () => {
    const read = await json(`/v1/apps/${alice.owner.name}/${FILE}`);
    expectRefusal(read, 401, 'SIGN_IN_REQUIRED');
    const tpl = await json(`/v1/app-templates/${GENRE}`);
    expectRefusal(tpl, 404, 'NOT_FOUND');
    const index = await json('/v1/app-templates?kind=genre');
    assert(!(index.body?.data?.templates ?? []).some((t: any) => t.id === GENRE), 'the index offers it to nobody signed out');
    const map = await json('/v1/designbook?view=map');
    assert(!String(map.body?.data?.map ?? '').includes('`' + GENRE + '`'), 'the map lists it to nobody signed out');
});

await test('opened to anyone again, carol forks it and every route offers her the genre, as before', async () => {
    const set = await json(`/v1/apps/${FILE}`, { method: 'PATCH', headers: auth(alice.owner.token), body: JSON.stringify({ open_to: 'anyone' }) });
    assert(set.status === 200 && set.body.data.open_to === 'anyone', `open to anyone: ${set.status} ${JSON.stringify(set.body?.data?.open_to ?? set.body?.error)}`);
    for (const route of ROUTES) {
        const seen = await route.run(carol);
        assert(seen.saw, `carol does not get it from ${route.name} on a public forkable app: ${seen.detail}`);
    }
    const anon = await json(`/v1/app-templates/${GENRE}`);
    assert(anon.status === 200 && String(anon.body.data.template.content).includes(MARK), `a public genre is handed over signed out, as before: ${anon.status}`);
});

await test('cleanup: the forks, the genre and the app', async () => {
    for (const who of [alice, bob, carol]) {
        const list = await json(`/v1/apps?owner=${who.owner.name}&limit=200`, { headers: auth(who.owner.token) });
        for (const a of list.body?.data?.apps ?? []) {
            if (typeof a.filename === 'string' && a.filename.startsWith(`srcfork-${who.label}-${stamp}`)) {
                await json(`/v1/apps/${a.filename}`, { method: 'DELETE', headers: auth(who.owner.token) });
            }
        }
    }
    await json(`/v1/designbook/${GENRE}`, { method: 'DELETE', headers: auth(alice.owner.token) });
    const del = await json(`/v1/apps/${FILE}`, { method: 'DELETE', headers: auth(alice.owner.token) });
    assert(del.status === 200, `delete the app: ${del.status}`);
});

finish();
