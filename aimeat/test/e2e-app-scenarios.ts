/**
 * @file test/e2e-app-scenarios.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the builder's playtest scenarios (PUT .../design-spec/scenarios, run by
 *   GET .../audit?playtest=true through services/app/playtest-scenarios.ts):
 *   - a scenario must name criteria the spec has;
 *   - a signed-in scenario writes to the node and sees its own write, at four sizes and both themes;
 *     a failing step is named; a signed-out scenario sees the signed-out page;
 *   - a scenario that passes everywhere gives an evidence line for its criterion;
 *   - the throwaway member account is gone after the run;
 *   - another owner may not write the scenarios.
 *   A node with no headless browser (CI) answers ran:false with the reason, and the run cases skip.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-scenarios
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-builder-scenarios-in-the-playtest-signed-in-four-widths-both).
 */
import { BASE, assert, expectRefusal, finish, json, skip, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

/** A page that says whether it is signed in, and saves what is typed to the node. */
const page = (filename: string) => [
    '<!DOCTYPE html><html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content">',
    `<meta name="aimeat-app" content="${filename}">`,
    '<meta name="aimeat-level" content="proto">',
    '<meta name="aimeat-scopes" content="memory:read memory:write">',
    '<meta name="aimeat-locales" content="en fi">',
    '<link rel="stylesheet" href="/lib/aimeat-theme.css">',
    '</head><body style="overflow-x:clip"><div id="login"></div><p id="who">Signed out</p>',
    '<input id="new" aria-label="Item"><button id="add">Add</button><p id="out"></p>',
    '<script src="/v1/libs/aimeat-auth.js"></' + 'script>',
    '<script src="/v1/libs/aimeat-data.js"></' + 'script>',
    '<script>',
    'AIMEAT.auth.mountLoginButton("#login", { onSession: function () { document.getElementById("who").textContent = "Signed in"; } });',
    'document.getElementById("add").addEventListener("click", async function () {',
    '  var v = document.getElementById("new").value;',
    '  await AIMEAT.data.set("scen.item", { title: v });',
    '  var back = await AIMEAT.data.get("scen.item");',
    '  document.getElementById("out").textContent = "Saved " + (back && back.title ? back.title : "nothing");',
    '});',
    '</' + 'script></body></html>',
].join('\n');

const SCENARIOS = [
    { id: 'saves', name: 'A signed-in member saves an item and sees it come back.', criteria: ['saves-item'], steps: [
        { do: 'expect_text', value: 'Signed in' },
        { do: 'fill', target: '#new', value: 'Milk' },
        { do: 'click', target: 'text=Add' },
        { do: 'expect_text', value: 'Saved Milk' },
    ] },
    { id: 'broken', name: 'A line the page never shows.', steps: [{ do: 'expect_text', value: 'Nothing like this', ms: 300 }] },
    { id: 'stranger', name: 'A visitor who is not signed in sees the signed-out line.', signed_in: false, steps: [{ do: 'expect_text', value: 'Signed out' }] },
];

(async () => {
    console.log('\n── App playtest scenarios: the builder\'s own steps, signed in, at every size ──');
    const alice = await registerOwner(BASE, `scena${Date.now()}`);
    const auth = { Authorization: `Bearer ${alice.token}` };
    const f = `scen${Date.now()}.html`;
    const app = `/v1/apps/${encodeURIComponent(alice.name)}/${encodeURIComponent(f)}`;

    await test('setup: the app, its spec and one open criterion', async () => {
        const v1 = await json('/v1/apps', { method: 'POST', headers: auth, body: JSON.stringify({ filename: f, mime_type: 'text/html', content: b64(page(f)), name: 'Scenarios', description: 'An app with scenarios.' }) });
        assert(v1.status === 201, `v1: ${v1.status} ${JSON.stringify(v1.body?.error)}`);
        assert((await json(`${app}/design-spec`, { method: 'PUT', headers: auth, body: JSON.stringify({ markdown: '# Design spec\n\nSaves an item.\n' }) })).status === 201, 'spec');
        const c = await json(`${app}/design-spec/criteria`, { method: 'PUT', headers: auth, body: JSON.stringify({ criteria: [{ id: 'saves-item', text: 'A member saves an item and sees it.', check: 'scenario' }] }) });
        assert(c.status === 200, `criteria: ${c.status}`);
    });

    await test('a scenario that names a criterion the spec does not have is refused', async () => {
        const r = await json(`${app}/design-spec/scenarios`, { method: 'PUT', headers: auth, body: JSON.stringify({ scenarios: [{ ...SCENARIOS[0], criteria: ['nope'] }] }) });
        expectRefusal(r, 400, 'INVALID_INPUT');
    });

    await test('another owner may not write this app\'s scenarios', async () => {
        const bob = await registerOwner(BASE, `scenb${Date.now()}`);
        const r = await json(`/v1/apps/${encodeURIComponent(alice.name)}/${encodeURIComponent(f)}/design-spec/scenarios`, { method: 'PUT', headers: { Authorization: `Bearer ${bob.token}` }, body: JSON.stringify({ scenarios: SCENARIOS }) });
        assert(r.status === 403, `another owner is refused: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('the three scenarios are stored', async () => {
        const r = await json(`${app}/design-spec/scenarios`, { method: 'PUT', headers: auth, body: JSON.stringify({ scenarios: SCENARIOS }) });
        assert(r.status === 200 && r.body.data.scenarios.length === 3, `stored: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data?.scenarios?.length)}`);
        assert(r.body.data.scenarios[0].signed_in === true && r.body.data.scenarios[2].signed_in === false, 'signed_in defaults to true and keeps false');
    });

    let run: any = null;
    await test('the playtest runs them: the signed-in save passes everywhere, the broken step is named, the visitor sees the signed-out line', async () => {
        const r = await json(`/v1/apps/me/${encodeURIComponent(f)}/audit?limit=5&playtest=true`, { headers: auth });
        assert(r.status === 200, `audit: ${r.status} ${JSON.stringify(r.body?.error)}`);
        run = r.body.data.live?.scenarios;
        assert(run, `the bundle carries scenarios: ${JSON.stringify(Object.keys(r.body.data.live ?? {}))}`);
        if (!run.ran) skip(`no browser on this node: ${run.reason}`);
        const byId = new Map((run.scenarios as any[]).map(s => [s.id, s]));
        const saves = byId.get('saves');
        assert(saves.signed_in === true && saves.ok === true && saves.runs.length === 8, `saves: ${JSON.stringify({ ok: saves.ok, first: saves.runs.find((x: any) => !x.ok) ?? saves.runs[0], member: run.member })}`);
        assert(saves.runs.some((x: any) => x.size === '390x844' && x.theme === 'dark') && saves.runs.some((x: any) => x.size === '1920x1080' && x.theme === 'light'), 'every size and both themes ran');
        const broken = byId.get('broken');
        assert(broken.ok === false && broken.runs.every((x: any) => x.failed_step?.index === 0 && x.failed_step?.do === 'expect_text'), `the broken step is named: ${JSON.stringify(broken.runs[0])}`);
        const stranger = byId.get('stranger');
        assert(stranger.ok === true && stranger.signed_in === false, `the signed-out scenario: ${JSON.stringify(stranger.runs[0])}`);
        assert(String(run.member).includes('throwaway'), `the member is said: ${run.member}`);
    });

    await test('the passing scenario gives an evidence line for its criterion, and the throwaway account is gone', async () => {
        if (!run?.ran) skip('no browser on this node');
        const ev = (run.criteria_evidence ?? []) as Array<{ id: string; evidence: string }>;
        assert(ev.length === 1 && ev[0].id === 'saves-item' && ev[0].evidence.includes('"saves"'), `evidence: ${JSON.stringify(ev)}`);
        const owners = await json('/v1/admin/owners', { headers: auth });
        assert(owners.status === 200, `owners: ${owners.status}`);
        const names = JSON.stringify(owners.body?.data ?? {});
        assert(!/"playtest[0-9a-f]{12}"/.test(names), 'no throwaway account is left');
    });

    finish();
})();
