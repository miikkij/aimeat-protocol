/**
 * @file test/e2e-app-criteria.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the acceptance criteria inside an app's design spec
 *   (PUT /v1/apps/:owner/:filename/design-spec/criteria, services/app/acceptance-criteria.ts):
 *   - the list needs a spec first, and refuses an evidenced line without evidence;
 *   - at the finest level an update with an open line is refused (APP_OWES_ITEMS, item criteria),
 *     and goes through once each line is evidenced or waived;
 *   - a write of the prose keeps the criteria, and the publish answer counts them;
 *   - a quick prototype with an open line publishes, and the answer counts it;
 *   - another owner may not write the list, and a builder of another account may not waive a line;
 *   - a page that declares a session need with AIMEAT.atelier.requires is offered the criterion and
 *     scenario pair that proves it (services/app/declared-needs.ts), a page that declares nothing is
 *     offered nothing, and the pair is not offered again once it is in the list.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-criteria
 * @version-history
 *   v1.1.0 — 2026-11-27 — The publish answer's ready-made proof of a declared need
 *     (wish-atelier-contextual-templates-pyynt-lohko-ask).
 *   v1.0.0 — 2026-11-26 — Initial (wish-acceptance-criteria-in-the-design-spec-checked-at-publish).
 */
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

/** A page that reads only and has no AI path, so on an update it owes its spec, a roadmap line and its criteria. */
const page = (filename: string, word: string, level?: 'proto') => [
    '<!DOCTYPE html><html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content">',
    `<meta name="aimeat-app" content="${filename}">`,
    ...(level ? [`<meta name="aimeat-level" content="${level}">`] : []),
    '<meta name="aimeat-ai-path" content="none">',
    '<meta name="aimeat-scopes" content="memory:read">',
    '<meta name="aimeat-locales" content="en fi">',
    '<link rel="stylesheet" href="/lib/aimeat-theme.css">',
    '<style>.card{background:var(--color-base-200);display:grid;grid-template-columns:minmax(0,1fr)}.card>*{min-width:0}</style>',
    `</head><body style="overflow-x:clip"><div id="login"></div><div class="card">${word}</div>`,
    '<script src="/v1/libs/aimeat-auth.js"></' + 'script>',
    '<script>AIMEAT.auth.mountLoginButton("#login", { onLogin: () => {} });</' + 'script></body></html>',
].join('\n');

const LINES = [
    { id: 'empty-state', text: 'An empty list says how to add the first item.', check: 'screenshot' },
    { id: 'phone', text: 'Every screen works at 390 px without sideways scrolling.', check: 'scenario' },
];

(async () => {
    console.log('\n── App acceptance criteria: written with the spec, held at publish ──');
    const alice = await registerOwner(BASE, `crita${Date.now()}`);
    const bob = await registerOwner(BASE, `critb${Date.now()}`);
    const auth = { Authorization: `Bearer ${alice.token}` };
    const asBob = { Authorization: `Bearer ${bob.token}` };
    const owed = (value: string) => json('/v1/admin/config', { method: 'PUT', headers: auth, body: JSON.stringify({ changes: [{ path: 'apps.owed_on_publish', value }] }) });
    const publish = (f: string, word: string, level?: 'proto') => json('/v1/apps', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ filename: f, mime_type: 'text/html', content: b64(page(f, word, level)), name: 'Criteria', description: 'An app with criteria.', roadmap: `The page says ${word}.` }),
    });
    const f = `crit${Date.now()}.html`;
    const app = `/v1/apps/${encodeURIComponent(alice.name)}/${encodeURIComponent(f)}`;
    const setCriteria = (criteria: unknown[], headers = auth) =>
        json(`${app}/design-spec/criteria`, { method: 'PUT', headers, body: JSON.stringify({ criteria }) });

    await test('setup: the owed gate as production runs it, and version 1', async () => {
        const on = await owed('refuse');
        assert(on.status === 200, `the operator turns the owed gate on: ${on.status} ${JSON.stringify(on.body?.error)}`);
        const v1 = await publish(f, 'first');
        assert(v1.status === 201, `v1: ${v1.status} ${JSON.stringify(v1.body?.error)}`);
        const c = v1.body.data.next_steps;
        assert(c?.criteria_counts?.total === 0 && String(c?.criteria).includes('criteria_set'), `a new app is told how to write criteria: ${JSON.stringify(c?.criteria)}`);
    });

    await test('the criteria need a design spec first', async () => {
        expectRefusal(await setCriteria(LINES), 409, 'NO_DESIGN_SPEC');
    });

    await test('with a spec, two open lines are written, and an evidenced line without evidence is refused', async () => {
        const spec = await json(`${app}/design-spec`, { method: 'PUT', headers: auth, body: JSON.stringify({ markdown: '# Design spec\n\n## Purpose\nA list.\n' }) });
        assert(spec.status === 201, `spec: ${spec.status} ${JSON.stringify(spec.body?.error)}`);
        const w = await setCriteria(LINES);
        assert(w.status === 200 && w.body.data.counts.open === 2, `two open lines: ${w.status} ${JSON.stringify(w.body?.data?.counts ?? w.body?.error)}`);
        expectRefusal(await setCriteria([{ ...LINES[0], status: 'evidenced' }]), 400, 'INVALID_INPUT');
    });

    await test('another owner may not write this app\'s criteria', async () => {
        const r = await json(`/v1/apps/${encodeURIComponent(alice.name)}/${encodeURIComponent(f)}/design-spec/criteria`, { method: 'PUT', headers: asBob, body: JSON.stringify({ criteria: LINES }) });
        assert(r.status === 403, `another owner is refused with 403: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('at the finest level an update with open lines is refused, naming the item and the ids', async () => {
        const r = await publish(f, 'second');
        expectRefusal(r, 422, 'APP_OWES_ITEMS');
        assert((r.body.error.details?.missing ?? []).includes('criteria'), `criteria owed: ${JSON.stringify(r.body.error.details)}`);
        const how = String(r.body.error.details?.how?.criteria ?? '');
        assert(how.includes('empty-state') && how.includes('phone'), `the ids are named: ${how}`);
    });

    await test('a builder of another account may evidence a line but not waive one', async () => {
        const grant = await json(`${app}/dev-grants/${encodeURIComponent(bob.name)}`, { method: 'PUT', headers: auth, body: JSON.stringify({ level: 'publisher' }) });
        assert(grant.status === 200 || grant.status === 201, `grant: ${grant.status} ${JSON.stringify(grant.body?.error)}`);
        const waive = await setCriteria([LINES[0], { ...LINES[1], status: 'waived', waived_reason: 'Phones later.' }], asBob);
        assert(waive.status === 403, `a builder's waiver is refused: ${waive.status} ${JSON.stringify(waive.body?.error)}`);
        const ev = await setCriteria([{ ...LINES[0], status: 'evidenced', evidence: 'screenshot of the empty list at /v1/apps/x/screenshot' }, LINES[1]], asBob);
        assert(ev.status === 200 && ev.body.data.counts.evidenced === 1, `a builder evidences: ${ev.status} ${JSON.stringify(ev.body?.data?.counts ?? ev.body?.error)}`);
        assert(String(ev.body.data.criteria[0].evidencedBy).includes(bob.name), `stamped with the builder: ${JSON.stringify(ev.body.data.criteria[0])}`);
    });

    await test('the owner waives the last line, the prose write keeps the list, and the update goes through', async () => {
        const spec = await json(`${app}/design-spec`, { headers: auth });
        const kept = spec.body.data.design_spec.criteria;
        const w = await setCriteria([
            { id: kept[0].id, text: kept[0].text, check: kept[0].check, status: 'evidenced', evidence: kept[0].evidence },
            { ...LINES[1], status: 'waived', waived_reason: 'Phones come in the next release.' },
        ]);
        assert(w.status === 200 && w.body.data.counts.open === 0, `none open: ${JSON.stringify(w.body?.data?.counts ?? w.body?.error)}`);
        assert(String(w.body.data.criteria[0].evidencedBy).includes(bob.name), 'an unchanged evidenced line keeps who evidenced it');
        const prose = await json(`${app}/design-spec`, { method: 'PUT', headers: auth, body: JSON.stringify({ markdown: '# Design spec\n\n## Purpose\nA list, now longer.\n' }) });
        assert(prose.status === 200 && (prose.body.data.design_spec.criteria ?? []).length === 2, `the prose write keeps the criteria: ${JSON.stringify(prose.body?.data?.design_spec?.criteria)}`);
        const v2 = await publish(f, 'second');
        assert(v2.status === 201, `v2: ${v2.status} ${JSON.stringify(v2.body?.error)}`);
        const counts = v2.body.data.next_steps?.criteria_counts;
        assert(counts?.evidenced === 1 && counts?.waived === 1 && counts?.open === 0, `the answer counts them: ${JSON.stringify(counts)}`);
    });

    await test('a quick prototype with an open line publishes, and the answer counts it', async () => {
        const p = `critproto${Date.now()}.html`;
        const papp = `/v1/apps/${encodeURIComponent(alice.name)}/${encodeURIComponent(p)}`;
        assert((await publish(p, 'one', 'proto')).status === 201, 'proto v1');
        await json(`${papp}/design-spec`, { method: 'PUT', headers: auth, body: JSON.stringify({ markdown: '# Design spec\n\nA prototype.\n' }) });
        const w = await json(`${papp}/design-spec/criteria`, { method: 'PUT', headers: auth, body: JSON.stringify({ criteria: [LINES[0]] }) });
        assert(w.status === 200, `proto criteria: ${w.status}`);
        const v2 = await publish(p, 'two', 'proto');
        assert(v2.status === 201, `a prototype is not held to its criteria: ${v2.status} ${JSON.stringify(v2.body?.error)}`);
        assert(v2.body.data.next_steps?.criteria_counts?.open === 1, `the answer counts the open line: ${JSON.stringify(v2.body.data.next_steps?.criteria_counts)}`);
    });

    await test('a page that declares a session need is offered its proof, and not again once the pair is in the list', async () => {
        const n = `critneeds${Date.now()}.html`;
        const napp = `/v1/apps/${encodeURIComponent(alice.name)}/${encodeURIComponent(n)}`;
        const declares = '<div id="area"></div><script>AIMEAT.atelier.requires({ target: "#area", needs: ["session"], render: function (host) { host.textContent = "in"; } });</' + 'script>';
        const put = (word: string) => json('/v1/apps', {
            method: 'POST', headers: auth,
            body: JSON.stringify({
                filename: n, mime_type: 'text/html', name: 'Needs', description: 'An app that declares a need.', roadmap: `The page says ${word}.`,
                content: b64(page(n, word, 'proto').replace('<div id="login"></div>', `<div id="login"></div>${declares}<script src="/v1/libs/aimeat-atelier.js"></` + 'script>')),
            }),
        });
        const v1 = await put('one');
        assert(v1.status === 201, `v1: ${v1.status} ${JSON.stringify(v1.body?.error)}`);
        const steps = v1.body.data.next_steps;
        assert(Array.isArray(steps?.declared_needs) && steps.declared_needs.includes('session'), `the answer names the declared need: ${JSON.stringify(steps?.declared_needs)}`);
        const ready = steps?.needs_proof_ready;
        assert(ready?.criteria?.length === 2 && ready?.scenarios?.length === 2, `the pair is ready-made: ${JSON.stringify(ready)}`);
        assert(ready.scenarios[0].steps[0].target === '[data-ak-requires][data-ak-state="signIn"]', `the signed-out scenario reads the kit's state: ${JSON.stringify(ready.scenarios[0])}`);

        // A page that declares nothing is offered nothing.
        const plain = await publish(`critplain${Date.now()}.html`, 'plain', 'proto');
        assert(plain.status === 201 && plain.body.data.next_steps?.needs_proof === undefined, `no offer without a declaration: ${JSON.stringify(plain.body.data.next_steps?.needs_proof)}`);

        // The ready-made criteria are taken as they are; the next publish does not offer them again.
        await json(`${napp}/design-spec`, { method: 'PUT', headers: auth, body: JSON.stringify({ markdown: '# Design spec\n\nA page with one area for a signed-in person.\n' }) });
        const w = await json(`${napp}/design-spec/criteria`, { method: 'PUT', headers: auth, body: JSON.stringify({ criteria: ready.criteria }) });
        assert(w.status === 200, `the ready-made criteria are accepted as they are: ${w.status} ${JSON.stringify(w.body?.error)}`);
        const v2 = await put('two');
        assert(v2.status === 201, `v2: ${v2.status} ${JSON.stringify(v2.body?.error)}`);
        assert(v2.body.data.next_steps?.needs_proof === undefined, `not offered twice: ${JSON.stringify(v2.body.data.next_steps?.needs_proof)}`);
    });

    await owed('warn');
    finish();
})();
