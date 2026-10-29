/**
 * @file test/e2e-designbook-ornaments.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Design Book's ornament kind and the Atelier kit's ornaments
 *   (data/atelier-ornaments.ts, services/design-book/ornament.ts, sdk-libs/atelier/ornament*.js;
 *   wish-kasvavat-koristeet-atelieriin-ja-design-bookiin). This suite holds:
 *     1. the node seeds the 23 figures published, the shelf map names the group, and a part reads
 *        back as { ornament };
 *     2. each preview page draws its figure through the kit on the element it was drawn for;
 *     3. a proposal inside the bounds lands as proposed, keeping only the knobs that differ; a figure
 *        the kit does not draw, a knob the figure does not take and a number past its bounds are
 *        refused in words;
 *     4. adopting answers the one line to call and writes nothing; another account can neither take
 *        a proposed ornament before it is published nor propose under its id; an anonymous adopt is
 *        refused;
 *     5. the kit bundle, its stylesheet and the library catalogue carry the ornaments.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=designbook-ornaments
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial.
 */
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const me = await registerOwner(BASE, `orn${Date.now()}`);

console.log('\n1. The seeded figures');
await test('The node seeds the 23 ornament figures, published', async () => {
  const r = await json('/v1/designbook?kind=ornament');
  const parts = r.body.data?.parts ?? [];
  assert(r.status === 200 && parts.length === 23, `23 ornaments: ${r.status} ${parts.length}`);
  assert(parts.every((p: any) => p.kind === 'ornament' && p.status === 'published'), 'all published');
  assert(parts.some((p: any) => p.id === 'ornament-vine-bar'), 'the vine bar is among them');
});
await test('A part reads back as the figure it names, and the shelf map has the group', async () => {
  const one = await json('/v1/designbook/ornament-frame');
  assert(one.status === 200 && one.body.data?.part?.body?.ornament === 'frame', `read ${one.status} ${JSON.stringify(one.body.data?.part?.body)}`);
  const map = await json('/v1/designbook?view=map');
  assert(String(map.body.data?.map ?? '').includes('ORNAMENTS'), 'the map names ORNAMENTS');
});

console.log('\n2. The previews');
await test('Each preview draws its figure through the kit on its element', async () => {
  for (const [id, figure, element] of [['ornament-frame', 'frame', 'orn-card'], ['ornament-vine-bar', 'vine-bar', 'role="progressbar"'], ['ornament-flourish', 'flourish', 'orn-heading']] as const) {
    const r = await fetch(`${BASE}/v1/designbook/${id}/preview`);
    const html = await r.text();
    assert(r.status === 200, `${id}: ${r.status}`);
    assert(html.includes('/v1/libs/aimeat-atelier.js') && html.includes('AIMEAT.atelier.ornament(host'), `${id}: the kit draws it`);
    assert(html.includes(`"id":"${figure}"`) && html.includes(element), `${id}: on its element`);
  }
});

console.log('\n3. Proposing one');
const lushId = `orn-lush-${Date.now()}`;
await test('A proposal inside the bounds lands as proposed and keeps only what differs', async () => {
  const id = lushId;
  const r = await json('/v1/designbook', {
    method: 'POST', headers: auth(me.token),
    body: JSON.stringify({ part: { id, kind: 'ornament', title: 'Lush frame', summary: 'The engraved frame with every leaf it can carry.', body: { ornament: 'frame', params: { leaves: 2, speed: 1 }, look: 'lounge' }, tags: ['ornament'] } }),
  });
  assert(r.status === 201 || r.status === 200, `propose ${r.status} ${JSON.stringify(r.body.error)}`);
  const back = await json(`/v1/designbook/${id}`, { headers: auth(me.token) });
  assert(back.body.data?.part?.status === 'proposed', `status ${back.body.data?.part?.status}`);
  assert(JSON.stringify(back.body.data?.part?.body) === JSON.stringify({ ornament: 'frame', params: { leaves: 2 }, look: 'lounge' }), `body ${JSON.stringify(back.body.data?.part?.body)}`);
});
await test('A figure the kit does not draw, a knob it does not take and a number past its bounds are refused in words', async () => {
  const propose = (body: unknown) => json('/v1/designbook', {
    method: 'POST', headers: auth(me.token),
    body: JSON.stringify({ part: { id: `orn-bad-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind: 'ornament', title: 'Bad one', summary: 'An ornament part the bench must refuse.', body } }),
  });
  const unknown = await propose({ ornament: 'trellis' });
  assert(unknown.status === 422 && /frame/.test(unknown.body.error?.message ?? ''), `unknown figure: ${unknown.status} ${unknown.body.error?.message}`);
  const knob = await propose({ ornament: 'dinkus', params: { leaves: 1 } });
  assert(knob.status === 422 && /"leaves" is none of them/.test(knob.body.error?.message ?? ''), `knob: ${knob.status} ${knob.body.error?.message}`);
  const bound = await propose({ ornament: 'rope', params: { strands: 7 } });
  assert(bound.status === 422 && /from 2 to 4/.test(bound.body.error?.message ?? ''), `bound: ${bound.status} ${bound.body.error?.message}`);
  const script = await propose({ ornament: 'frame', html: '<script>alert(1)</script>' });
  assert(script.status === 422 && /"html" is not part of it/.test(script.body.error?.message ?? ''), `extra field: ${script.status} ${script.body.error?.message}`);
});

console.log('\n4. Taking one');
await test('Adopting an ornament answers the one line to call and writes nothing', async () => {
  const r = await json('/v1/designbook/ornament-rope/adopt', { method: 'POST', headers: auth(me.token), body: JSON.stringify({ filename: 'not-yet.html' }) });
  assert(r.status === 200, `adopt ${r.status} ${JSON.stringify(r.body.error)}`);
  assert(r.body.data?.ornament?.code === "AIMEAT.atelier.ornament(el, 'rope');", `code: ${r.body.data?.ornament?.code}`);
  assert(r.body.data?.replaced_version === null, 'nothing was replaced');
});
await test('Another account cannot take my proposed ornament, nor propose under its id', async () => {
  const other = await registerOwner(BASE, `orno${Date.now()}`);
  const take = await json(`/v1/designbook/${lushId}/adopt`, { method: 'POST', headers: auth(other.token), body: JSON.stringify({ filename: 'x.html' }) });
  assert(take.status === 403 && take.body.error?.code === 'NOT_PUBLISHED', `adopt before publish: ${take.status} ${take.body.error?.code}`);
  const same = await json('/v1/designbook', {
    method: 'POST', headers: auth(other.token),
    body: JSON.stringify({ part: { id: lushId, kind: 'ornament', title: 'Taken', summary: 'An id another account already holds.', body: { ornament: 'rope' } } }),
  });
  assert(same.status === 409 && same.body.error?.code === 'ID_TAKEN', `same id: ${same.status} ${same.body.error?.code}`);
});
await test('An anonymous caller cannot adopt', async () => {
  const r = await json('/v1/designbook/ornament-rope/adopt', { method: 'POST', body: JSON.stringify({ filename: 'x.html' }) });
  assert(r.status === 401, `anonymous adopt: ${r.status}`);
});

console.log('\n5. The kit');
await test('The kit bundle, its stylesheet and the library catalogue carry the ornaments', async () => {
  const js = await fetch(`${BASE}/v1/libs/aimeat-atelier.js`);
  const src = await js.text();
  assert(js.status === 200 && src.includes('ak-orn-layer') && src.includes('vine-bar'), 'the bundle draws them');
  const css = await fetch(`${BASE}/lib/aimeat-atelier/ornaments.css`);
  assert(css.status === 200 && (await css.text()).includes('.ak-orn-grow'), `the stylesheet: ${css.status}`);
  const kit = await fetch(`${BASE}/lib/aimeat-atelier.css`);
  assert((await kit.text()).includes("aimeat-atelier/ornaments.css"), 'the kit stylesheet imports it');
  const pack = await json('/v1/library-packs/aimeat-atelier');
  assert(JSON.stringify(pack.body).includes('ORNAMENTS (0.67.0)'), `the catalogue describes them: ${pack.status}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
