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
 *   - every run of one size and theme has an account of its own, so a scenario that starts from the
 *     app's empty state passes at all eight, after another scenario has saved;
 *   - the throwaway member accounts are gone after the run;
 *   - another owner may not write the scenarios.
 *   A node with no headless browser (CI) answers ran:false with the reason, and the run cases skip.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-scenarios
 * @version-history
 *   v1.2.0 — 2026-11-27 — The run is started once and read with the same request: a run under way
 *     answers `running`, asking again reads the kept run, the node's note leaves the spec's revision
 *     alone, and changed scenarios start a new run (services/app/scenario-run.ts).
 *   v1.1.0 — 2026-11-27 — The scenario `fresh` and its case: seen red on the runner that kept one
 *     member for the whole run (it read the item `saves` had written), green with a member per run.
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
    '<input id="new" aria-label="Item"><button id="add">Add</button><p id="out"></p><p id="stored"></p>',
    '<script src="/v1/libs/aimeat-auth.js"></' + 'script>',
    '<script src="/v1/libs/aimeat-data.js"></' + 'script>',
    '<script>',
    'AIMEAT.auth.mountLoginButton("#login", { onSession: async function () {',
    '  document.getElementById("who").textContent = "Signed in";',
    '  var kept = null; try { kept = await AIMEAT.data.get("scen.item"); } catch (e) { kept = null; }',
    '  document.getElementById("stored").textContent = "Stored " + (kept && kept.title ? kept.title : "nothing");',
    '} });',
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
    // After `saves` has written an item: this one passes only when its account is not the one `saves` used,
    // and at every size only when no size inherits what the size before it wrote.
    { id: 'fresh', name: 'A member opens the app for the first time: nothing is stored yet, and then they save.', steps: [
        { do: 'expect_text', value: 'Stored nothing' },
        { do: 'fill', target: '#new', value: 'Tea' },
        { do: 'click', target: 'text=Add' },
        { do: 'expect_text', value: 'Saved Tea' },
    ] },
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

    await test('the four scenarios are stored', async () => {
        const r = await json(`${app}/design-spec/scenarios`, { method: 'PUT', headers: auth, body: JSON.stringify({ scenarios: SCENARIOS }) });
        assert(r.status === 200 && r.body.data.scenarios.length === 4, `stored: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data?.scenarios?.length)}`);
        assert(r.body.data.scenarios[0].signed_in === true && r.body.data.scenarios[2].signed_in === false, 'signed_in defaults to true and keeps false');
    });

    let run: any = null;
    await test('the playtest runs them: the signed-in save passes everywhere, the broken step is named, the visitor sees the signed-out line', async () => {
        // The call that starts the run waits for it a while; a run still going answers `running`, and
        // the same call reads it when it has ended.
        for (let i = 0; i < 12; i++) {
            const r = await json(`/v1/apps/me/${encodeURIComponent(f)}/audit?limit=5&playtest=true`, { headers: auth });
            assert(r.status === 200, `audit: ${r.status} ${JSON.stringify(r.body?.error)}`);
            run = r.body.data.live?.scenarios;
            assert(run, `the bundle carries scenarios: ${JSON.stringify(Object.keys(r.body.data.live ?? {}))}`);
            if (!run.running) break;
            assert(run.ran === false && typeof run.started_at === 'string' && /again/.test(run.reason), `a run under way says so: ${JSON.stringify(run).slice(0, 300)}`);
        }
        assert(!run.running, 'the run ended within the calls this test makes');
        if (!run.ran) skip(`no browser on this node: ${run.reason}`);
        // The run has 35 seconds. On a machine busy with other suites some runs may not start, and
        // the answer must then say so; the cases about what the runs showed need all of them.
        // A scenario that failed at the first two sizes is not run at the other six, and that is said too.
        const failedFirst = (s: any) => s.runs.some((x: any) => !x.ok);
        const left = (run.scenarios as any[]).filter(s => !failedFirst(s)).flatMap(s => s.not_run as string[]);
        const stopped = (run.scenarios as any[]).filter(failedFirst).flatMap(s => s.not_run as string[]);
        assert((left.length + stopped.length === 0) === (run.reason === undefined), `what did not run is said: ${JSON.stringify({ left, stopped })} / ${run.reason}`);
        if (left.length) { run = { ...run, incomplete: true }; skip(`${left.length} run(s) did not fit the deadline on this machine: ${run.reason}`); }
        const byId = new Map((run.scenarios as any[]).map(s => [s.id, s]));
        const saves = byId.get('saves');
        assert(saves.signed_in === true && saves.ok === true && saves.runs.length === 8, `saves: ${JSON.stringify({ ok: saves.ok, first: saves.runs.find((x: any) => !x.ok) ?? saves.runs[0], member: run.member })}`);
        assert(saves.runs.some((x: any) => x.size === '390x844' && x.theme === 'dark') && saves.runs.some((x: any) => x.size === '1920x1080' && x.theme === 'light'), 'every size and both themes ran');
        const broken = byId.get('broken');
        assert(broken.ok === false && broken.runs.every((x: any) => x.failed_step?.index === 0 && x.failed_step?.do === 'expect_text'), `the broken step is named: ${JSON.stringify(broken.runs[0])}`);
        // It failed at the phone and the desktop in the light theme, so the other six runs were left.
        assert(broken.runs.length === 2 && broken.runs.every((x: any) => x.theme === 'light') && broken.not_run.length === 6, `a failing scenario stops after the first two: ${JSON.stringify({ runs: broken.runs.map((x: any) => `${x.size} ${x.theme}`), not_run: broken.not_run.length })}`);
        assert(/were not started/.test(String(run.reason)), `and the answer says why: ${run.reason}`);
        const stranger = byId.get('stranger');
        assert(stranger.ok === true && stranger.signed_in === false, `the signed-out scenario: ${JSON.stringify(stranger.runs[0])}`);
        assert(String(run.member).includes('throwaway'), `the member is said: ${run.member}`);
    });

    await test('every run of a size and theme starts from an account that holds nothing', async () => {
        if (!run?.ran || run.incomplete) skip('no browser on this node, or the run did not fit the deadline');
        const fresh = (run.scenarios as any[]).find(s => s.id === 'fresh');
        assert(fresh.ok === true && fresh.runs.length === 8, `fresh: ${JSON.stringify({ ok: fresh.ok, first: fresh.runs.find((x: any) => !x.ok) ?? null, not_run: fresh.not_run })}`);
    });

    await test('asking again reads the run the node kept and starts no new one; changed scenarios start one', async () => {
        if (!run?.ran) skip('no browser on this node');
        const again = await json(`/v1/apps/me/${encodeURIComponent(f)}/audit?limit=5&playtest=true`, { headers: auth });
        const kept = again.body.data.live?.scenarios;
        assert(kept?.ran === true && kept.finished_at === run.finished_at && kept.started_at === run.started_at, `the same run is answered: ${JSON.stringify({ a: run.finished_at, b: kept?.finished_at, running: kept?.running })}`);
        // The builder reads the spec by its revision: the node's note of a run does not move it.
        const spec = await json(`${app}/design-spec`, { headers: auth });
        const before = spec.body.data.design_spec?.revision ?? spec.body.data.revision;
        const stranger = [SCENARIOS[2]];
        const w = await json(`${app}/design-spec/scenarios`, { method: 'PUT', headers: auth, body: JSON.stringify({ scenarios: stranger, expected_revision: before }) });
        assert(w.status === 200, `the revision the builder read is still the one stored: ${w.status} ${JSON.stringify(w.body?.error)}`);
        let next: any = null;
        for (let i = 0; i < 12; i++) {
            next = (await json(`/v1/apps/me/${encodeURIComponent(f)}/audit?limit=5&playtest=true`, { headers: auth })).body.data.live?.scenarios;
            if (!next?.running) break;
        }
        assert(next?.ran === true && next.started_at !== run.started_at && next.scenarios.length === 1 && next.scenarios[0].id === 'stranger', `a new run for the new list: ${JSON.stringify(next).slice(0, 300)}`);
    });

    await test('the passing scenario gives an evidence line for its criterion, and the throwaway account is gone', async () => {
        if (!run?.ran || run.incomplete) skip('no browser on this node, or the run did not fit the deadline');
        const ev = (run.criteria_evidence ?? []) as Array<{ id: string; evidence: string }>;
        assert(ev.length === 1 && ev[0].id === 'saves-item' && ev[0].evidence.includes('"saves"'), `evidence: ${JSON.stringify(ev)}`);
        // The node wrote that evidence itself: the criterion is evidenced with no criteria write from the builder.
        assert(JSON.stringify(run.criteria_evidenced) === '["saves-item"]', `the run names what it marked: ${JSON.stringify(run.criteria_evidenced)}`);
        const kept = JSON.stringify((await json(`${app}/design-spec`, { headers: auth })).body?.data ?? {});
        assert(/"status":"evidenced"/.test(kept) && kept.includes('node:playtest') && kept.includes('Playtest scenario'), `the criterion is evidenced in the spec: ${kept.slice(0, 400)}`);
        const owners = await json('/v1/admin/owners', { headers: auth });
        assert(owners.status === 200, `owners: ${owners.status}`);
        const names = JSON.stringify(owners.body?.data ?? {});
        assert(!/"playtest[0-9a-f]{12}"/.test(names), 'no throwaway account is left');
    });

    finish();
})();
