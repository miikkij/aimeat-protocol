/**
 * @file e2e-calendar-feed.ts
 * @description E2E for a workspace calendar as an ICS feed a calendar program subscribes to:
 *   GET /v1/organisms/:id/workspace/public/records?ws=&space=&format=ics. Covers: nothing shared
 *   answers 404; a records space the share opens answers text/calendar with one VEVENT per record
 *   that is a calendar event, a recurring one with its RRULE, and a record that is no event left
 *   out; only the event's own fields are in the feed, never another field of the record; a share
 *   that asks for an account or a password refuses the feed without the feed key; the feed key is
 *   made by the workspace's creator or an admin only, is shown once, opens the feed and nothing
 *   else (not the JSON read, not a space the share does not open, not another workspace), and stops
 *   opening it when it is made again or cleared; the share state never shows the key or its hash.
 *   Run:
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-calendar-feed
 * @version-history
 *   v1.0.0 — 2026-10-13 — Written before the code: on the node as it stood, format=ics answered
 *     JSON and ics_key was not a field of the share.
 */
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function call(path: string, opts: RequestInit = {}): Promise<{ status: number; type: string; body: any; text: string }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const type = res.headers.get('content-type') ?? '';
  const text = await res.text();
  let body: any = {};
  if (type.includes('json')) { try { body = JSON.parse(text); } catch { body = {}; } }
  return { status: res.status, type, body, text };
}

type Auth = Record<string, string>;
const stamp = Date.now();
let A: Auth = {};
let B: Auth = {};
let aName = '';
let orgId = '';
const WS = 'ws-cal';
const WS2 = 'ws-other';
const root = (ws = WS) => `organism.${orgId}.w.${ws}`;
const feed = (qs = '', ws = WS) => `/v1/organisms/${orgId}/workspace/public/records?ws=${ws}${qs}`;
const share = (auth: Auth, body: unknown, ws = WS) =>
  call(`/v1/organisms/${orgId}/workspace/share?ws=${ws}`, { method: 'PUT', headers: auth, body: JSON.stringify(body) });
const write = (auth: Auth, key: string, value: unknown) =>
  call('/v1/memory', { method: 'POST', headers: auth, body: JSON.stringify({ key, value, visibility: 'private' }) });
const events = (ics: string): number => (ics.match(/BEGIN:VEVENT/g) ?? []).length;

async function run() {
  console.log('\n=== AIMEAT Calendar Feed E2E ===\n');

  await test('Setup: the creator, a plain member, an organism and a workspace with an event space and a note space', async () => {
    const a = await registerOwner(BASE, `cala${stamp}`);
    aName = a.name;
    A = { Authorization: `Bearer ${a.token}` };
    B = { Authorization: `Bearer ${(await registerOwner(BASE, `calb${stamp}`)).token}` };
    const o = await call('/v1/organisms', { method: 'POST', headers: A, body: JSON.stringify({ name: `Cal Org ${stamp}`, description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}: ${o.text}`);
    orgId = o.body.data.organism.id;
    const j = await call(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: B, body: '{}' });
    assert(j.status === 201, `B joins ${j.status}`);
    const now = new Date().toISOString();
    await write(A, `organism.${orgId}.meta.workspaces`, { workspaces: [{ id: WS, name: 'Bookings', createdAt: now, createdBy: aName }, { id: WS2, name: 'Other', createdAt: now, createdBy: aName }] });
    for (const ws of [WS, WS2]) {
      const m = await write(A, `${root(ws)}.meta.manifest`, {
        manifestVersion: '1.0', id: orgId, name: ws === WS ? 'Bookings' : 'Other', kind: 'project', status: 'active',
        objectTypes: [
          { name: 'event', schemaRef: 'schema:event@1', namespace: 'shared.events', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' },
          { name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' },
        ],
      });
      assert(m.status === 201, `manifest ${ws} ${m.status}: ${m.text}`);
    }
    const pub = (ns: string, id: string, value: unknown, ws = WS) => write(A, `${root(ws)}.${ns}.${id}.latest`, value);
    await pub('shared.events', 'visit', { id: 'visit', title: 'Site visit; bring keys', start: '2026-11-03T09:00', end: '2026-11-03T10:30', timeZone: 'Europe/Helsinki', location: 'Hämeentie 1', customerEmail: 'private.person@example.com', internalNote: 'do not show this' });
    await pub('shared.events', 'weekly', { id: 'weekly', title: 'Weekly check', start: '2026-11-02T08:00', end: '2026-11-02T08:30', timeZone: 'Europe/Helsinki', rrule: 'FREQ=WEEKLY;COUNT=4' });
    await pub('shared.events', 'holiday', { id: 'holiday', title: 'Closed', start: '2026-12-24', end: '2026-12-25', allDay: true });
    await pub('shared.events', 'broken', { id: 'broken', title: 'No times at all' });
    await pub('shared.notes', 'n1', { id: 'n1', title: 'A note', start: '2026-11-05T12:00', end: '2026-11-05T13:00' });
    await pub('shared.events', 'elsewhere', { id: 'elsewhere', title: 'In the other workspace', start: '2026-11-06T12:00', end: '2026-11-06T13:00' }, WS2);
  });

  await test('nothing shared: the feed answers 404', async () => {
    const r = await call(feed('&space=event&format=ics'));
    assert(r.status === 404, `expected 404, got ${r.status}`);
  });

  await test('a plain member cannot open the space to the public', async () => {
    const r = await share(B, { spaces: { event: true } });
    assert(r.status === 403, `expected 403, got ${r.status}: ${r.text}`);
  });

  let openIcs = '';
  await test('an open share: the feed is text/calendar with one VEVENT per record that is an event', async () => {
    const s = await share(A, { spaces: { event: true } });
    assert(s.status === 200, `share ${s.status}: ${s.text}`);
    const r = await call(feed('&space=event&format=ics'));
    assert(r.status === 200, `feed ${r.status}: ${r.text.slice(0, 300)}`);
    assert(r.type.startsWith('text/calendar'), `content type, got ${r.type}`);
    openIcs = r.text;
    assert(openIcs.startsWith('BEGIN:VCALENDAR') && openIcs.trimEnd().endsWith('END:VCALENDAR'), 'a whole VCALENDAR');
    assert(events(openIcs) === 3, `three events (the record with no times is left out), got ${events(openIcs)}`);
    assert(openIcs.includes('UID:visit') && openIcs.includes('UID:weekly') && openIcs.includes('UID:holiday'), 'the three ids');
    assert(!openIcs.includes('UID:broken'), 'the record that is no event is not in the feed');
    assert(openIcs.includes('SUMMARY:Site visit\\; bring keys'), 'the title, escaped');
    assert(openIcs.includes('RRULE:FREQ=WEEKLY;COUNT=4'), 'the recurrence rule');
    assert(openIcs.includes('DTSTART;VALUE=DATE:20261224'), 'the all-day event as a date');
    assert(openIcs.includes('X-WR-CALNAME:Bookings'), 'the calendar is named after the workspace');
  });

  await test('only the event\'s own fields are in the feed', async () => {
    assert(openIcs.includes('LOCATION:Hämeentie 1'), 'the location is an event field and is there');
    assert(!openIcs.includes('private.person@example.com') && !openIcs.includes('do not show this'), 'no other field of the record is in the feed');
  });

  await test('format=ics names one space: without space it answers 400, and a space the share does not open answers 404', async () => {
    const none = await call(feed('&format=ics'));
    assert(none.status === 400, `no space: expected 400, got ${none.status}`);
    const closed = await call(feed('&space=note&format=ics'));
    assert(closed.status === 404, `a space that is not shared: expected 404, got ${closed.status}`);
  });

  await test('a share that asks for a password refuses the feed, and the share state shows no key', async () => {
    const s = await share(A, { access: 'password', password: 'calendar-pass-1' });
    assert(s.status === 200, `share ${s.status}: ${s.text}`);
    assert(s.body.data.share.has_ics_key === false, `no feed key yet, got ${JSON.stringify(s.body.data.share)}`);
    const r = await call(feed('&space=event&format=ics'));
    assert(r.status === 401, `expected 401, got ${r.status}`);
    assert(!r.text.includes('BEGIN:VEVENT'), 'and no event leaves with the refusal');
  });

  await test('a plain member cannot make a feed key', async () => {
    const r = await share(B, { ics_key: true });
    assert(r.status === 403, `expected 403, got ${r.status}: ${r.text}`);
  });

  let key = '';
  await test('the creator makes a feed key: it is shown once and opens the feed', async () => {
    const s = await share(A, { ics_key: true });
    assert(s.status === 200, `share ${s.status}: ${s.text}`);
    key = s.body.data.ics_key;
    assert(typeof key === 'string' && key.length >= 40, `a long key, got ${JSON.stringify(key)}`);
    assert(s.body.data.share.has_ics_key === true, 'the share says it has a feed key');
    assert(!JSON.stringify(s.body.data.share).includes(key), 'the share state does not carry the key');
    const again = await call(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { headers: A });
    assert(again.status === 200 && again.body.data.share.has_ics_key === true, 'a later read says there is a key');
    assert(!again.text.includes(key) && !/icsKeyHash|ics_key_hash/.test(again.text), 'and shows neither the key nor its hash');
    const r = await call(feed(`&space=event&format=ics&key=${key}`));
    assert(r.status === 200 && events(r.text) === 3, `the feed with the key: ${r.status}, ${events(r.text)} events`);
  });

  await test('the feed key opens the feed and nothing else', async () => {
    const wrong = await call(feed(`&space=event&format=ics&key=${key.slice(0, -2)}xx`));
    assert(wrong.status === 401, `a wrong key: expected 401, got ${wrong.status}`);
    const jsonRead = await call(feed(`&space=event&key=${key}`));
    assert(jsonRead.status === 401, `the JSON read with the key: expected 401, got ${jsonRead.status}`);
    const closed = await call(feed(`&space=note&format=ics&key=${key}`));
    assert(closed.status === 404, `a space the share does not open: expected 404, got ${closed.status}`);
    const s2 = await share(A, { spaces: { event: true }, access: 'password', password: 'calendar-pass-2' }, WS2);
    assert(s2.status === 200, `share of the other workspace ${s2.status}`);
    const other = await call(feed(`&space=event&format=ics&key=${key}`, WS2));
    assert(other.status === 401, `another workspace with this key: expected 401, got ${other.status}`);
  });

  await test('a new key ends the old one, and clearing it ends the feed', async () => {
    const s = await share(A, { ics_key: true });
    const next = s.body.data.ics_key as string;
    assert(s.status === 200 && next && next !== key, 'a different key');
    const old = await call(feed(`&space=event&format=ics&key=${key}`));
    assert(old.status === 401, `the old key: expected 401, got ${old.status}`);
    const fresh = await call(feed(`&space=event&format=ics&key=${next}`));
    assert(fresh.status === 200, `the new key: expected 200, got ${fresh.status}`);
    // A change that does not name the key keeps it.
    const keep = await share(A, { spaces: { note: false } });
    assert(keep.status === 200 && keep.body.data.share.has_ics_key === true && keep.body.data.ics_key === undefined, 'another change keeps the key and shows none');
    assert((await call(feed(`&space=event&format=ics&key=${next}`))).status === 200, 'and the key still opens the feed');
    const cleared = await share(A, { ics_key: null });
    assert(cleared.status === 200 && cleared.body.data.share.has_ics_key === false, 'cleared');
    const after = await call(feed(`&space=event&format=ics&key=${next}`));
    assert(after.status === 401, `after clearing: expected 401, got ${after.status}`);
  });

  await test('a signed-in member reads the feed of a password share without a key', async () => {
    const r = await call(feed('&space=event&format=ics'), { headers: B });
    assert(r.status === 200 && events(r.text) === 3, `a member: ${r.status}, ${events(r.text)} events`);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
