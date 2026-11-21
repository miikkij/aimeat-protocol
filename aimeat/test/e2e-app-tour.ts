/**
 * @file test/e2e-app-tour.ts
 * @description An app's guided tour on the node (services/app/tour.ts, services/app/settings.ts
 *   `tour_invite`, utils/app-agent-discovery.ts).
 *
 *   WHAT IT PROVES. Publish refuses a tour block it cannot use and stores a good one on the manifest,
 *   where the owner's listing row and an AI read it. The owner switches the one-time invitation off
 *   and on; the served page carries `tour_invite: false` in #aimeat-app-ref only while it is off, a
 *   new version keeps the owner's choice, and a version without the block has no tour. A value that
 *   is not a boolean is refused, and another person cannot change the switch on someone else's app.
 * @structure
 *   - Phase 1: fixtures (owner, stranger)
 *   - Phase 2: the tour at publish
 *   - Phase 3: the invitation switch and the served page
 *   - Phase 4: refusals
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-tour
 * @version-history
 *   v1.0.0 — 2026-11-22 — Initial (wish-opastettu-kierros-sovelluksiin-monikielinen-tutorial-ja-oma-).
 */

import { ownerSignIn } from './helpers/owner-login.js';
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

async function makeOwner(name: string): Promise<{ token: string; owner: string }> {
    const owner = `${name}${Date.now().toString(36).slice(-6)}`;
    for (let attempt = 0; ; attempt++) {
        const reg = await json('/v1/ghii', {
            method: 'POST',
            body: JSON.stringify({ username: owner, display_name: owner, password: 'AppTourTest12345' }),
        });
        if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        const tok = await ownerSignIn(BASE, owner, 'AppTourTest12345');
        assert(tok.status === 200, `token failed: ${tok.status}`);
        return { token: tok.body.data.token as string, owner };
    }
}

const TOUR = {
    tours: [{
        id: 'first', title: { en: 'First tour', fi: 'Ensimmäinen kierros' },
        steps: [
            { title: { en: 'What this is', fi: 'Mikä tämä on' }, text: { en: 'It keeps your errands.', fi: 'Se pitää asiasi.' } },
            'add',
            { target: '#save', text: { en: 'Save the list.', fi: 'Tallenna lista.' }, do: 'click' },
        ],
    }],
};

const htmlWith = (title: string, tour: unknown): string =>
    `<!DOCTYPE html><html><head><title>${title}</title>`
    + (tour === undefined ? '' : `<script type="application/json" id="aimeat-tour">${typeof tour === 'string' ? tour : JSON.stringify(tour)}</script>`)
    + `</head><body><h1>${title}</h1><button data-ak-help="add" data-ak-help-title="Add">Add</button><button id="save">Save</button></body></html>`;

console.log('\nPhase 1 — Fixtures');
const owner = await makeOwner('tourown');
const stranger = await makeOwner('tourstr');
const tag = Date.now().toString(36).slice(-5);
const APP = `tour-${tag}.html`;

const publish = (filename: string, html: string, token = owner.token) => json('/v1/apps', {
    method: 'POST', headers: authed(token),
    body: JSON.stringify({ filename, content: b64(html), name: 'Tour fixture', description: 'A fixture for the guided tour suite', category: 'utility', tags: [] }),
});
const ownRow = async (filename: string): Promise<any> => {
    const { status, body } = await json('/v1/apps?own=true&limit=100', { headers: authed(owner.token) });
    assert(status === 200, `own listing: ${status}`);
    const rows = (body.data?.apps ?? body.data ?? []) as any[];
    const row = rows.find((r) => r.filename === filename);
    assert(row?.filename === filename, `no own row for ${filename}`);
    return row;
};
// ?mode=inline is the running page with the node's marks; without it the route answers the stored bytes.
const served = async (filename: string): Promise<string> => {
    const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(owner.owner)}/${encodeURIComponent(filename)}?mode=inline`, { headers: authed(owner.token) });
    assert(res.status === 200, `serve: ${res.status}`);
    return res.text();
};
const settings = (filename: string, body: Record<string, unknown>, token = owner.token) =>
    json(`/v1/apps/${encodeURIComponent(filename)}`, { method: 'PATCH', headers: authed(token), body: JSON.stringify(body) });

console.log('\nPhase 2 — The tour at publish');

await test('A tour block that is not JSON is refused at publish, naming the block', async () => {
    const res = await publish(`tour-broken-${tag}.html`, htmlWith('Broken', '{ "tours": [ '));
    expectRefusal(res, 422, 'APP_TOUR_INVALID');
    assert(/aimeat-tour/.test(res.body.error?.message ?? ''), `message: ${res.body.error?.message}`);
});

await test('A step that asks for a click with no place is refused at publish', async () => {
    const res = await publish(`tour-noplace-${tag}.html`, htmlWith('No place', { steps: [{ text: 'Press it', do: 'click' }] }));
    expectRefusal(res, 422, 'APP_TOUR_INVALID');
    assert(/needs a place/.test(res.body.error.message), `message: ${res.body.error.message}`);
});

await test('A good tour publishes, and the owner\'s row carries it with the invitation on', async () => {
    const { status, body } = await publish(APP, htmlWith('Errands', TOUR));
    assert(status === 201, `publish: ${status} ${JSON.stringify(body)}`);
    const row = await ownRow(APP);
    const tour = row.manifest?.tour;
    assert(tour?.tours?.length === 1, `manifest.tour: ${JSON.stringify(tour)}`);
    assert(tour.tours[0].steps.length === 3, `steps: ${JSON.stringify(tour.tours[0].steps)}`);
    assert(tour.tours[0].steps[1].help === 'add', `step 2: ${JSON.stringify(tour.tours[0].steps[1])}`);
    assert(JSON.stringify(tour.languages) === '["en","fi"]', `languages: ${JSON.stringify(tour.languages)}`);
    assert(row.tour_invite === true, `tour_invite: ${row.tour_invite}`);
});

console.log('\nPhase 3 — The invitation switch and the served page');

await test('The served page carries no tour_invite while the invitation is on', async () => {
    const html = await served(APP);
    assert(html.includes('id="aimeat-app-ref"'), 'no #aimeat-app-ref block');
    assert(!html.includes('"tour_invite"'), 'tour_invite written while on');
});

await test('The owner switches the invitation off; the answer and the served page say so', async () => {
    const { status, body } = await settings(APP, { tour_invite: false });
    assert(status === 200, `patch: ${status} ${JSON.stringify(body)}`);
    assert(body.data?.tour_invite === false && body.data?.has_tour === true, `answer: ${JSON.stringify(body.data)}`);
    const html = await served(APP);
    assert(html.includes('"tour_invite":false'), 'served page lacks tour_invite:false');
    assert((await ownRow(APP)).tour_invite === false, 'row still says on');
});

await test('A new version keeps the owner\'s choice', async () => {
    const { status } = await publish(APP, htmlWith('Errands v2', TOUR));
    assert(status === 201, `republish: ${status}`);
    assert((await ownRow(APP)).tour_invite === false, 'the new version invites again');
    assert((await served(APP)).includes('"tour_invite":false'), 'served page lost the switch');
});

await test('Switched on again, the served page no longer carries it', async () => {
    const { status, body } = await settings(APP, { tour_invite: true });
    assert(status === 200 && body.data?.tour_invite === true, `patch: ${status} ${JSON.stringify(body.data)}`);
    assert(!(await served(APP)).includes('"tour_invite"'), 'tour_invite still written');
});

await test('A version without the block has no tour', async () => {
    const { status } = await publish(APP, htmlWith('Errands v3', undefined));
    assert(status === 201, `republish: ${status}`);
    const row = await ownRow(APP);
    assert(!row.manifest?.tour, `tour carried forward: ${JSON.stringify(row.manifest?.tour)}`);
    const { body } = await settings(APP, { tour_invite: true });
    assert(body.data?.has_tour === false, `has_tour: ${body.data?.has_tour}`);
});

console.log('\nPhase 4 — Refusals');

await test('A tour_invite that is not a boolean is refused', async () => {
    const res = await settings(APP, { tour_invite: 'no' });
    expectRefusal(res, 400, 'INVALID_INPUT');
    assert(/tour_invite must be a boolean/.test(res.body.error?.message ?? ''), `message: ${res.body.error?.message}`);
});

await test('Another person cannot switch the invitation on someone else\'s app', async () => {
    await settings(APP, { tour_invite: false });
    const res = await json(`/v1/apps/${encodeURIComponent(APP)}`, {
        method: 'PATCH', headers: authed(stranger.token), body: JSON.stringify({ owner: owner.owner, tour_invite: true }),
    });
    // The body names the app's owner, so the route asks whether the stranger may act on that
    // owner's app (a delegated builder) and refuses: 403.
    expectRefusal(res, 403);
    assert((await ownRow(APP)).tour_invite === false, 'the stranger changed the switch');
});

finish();
