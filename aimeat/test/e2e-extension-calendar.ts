/**
 * @file e2e-extension-calendar.ts
 * @description E2E for `ctx.calendar`, the calendar library's computation as host calls of an
 *   extension (services/extension-calendar.ts). An extension's sandbox has no Intl and no
 *   time-zone data, so these are the only way it expands a recurrence or converts a zone.
 *
 *   What it holds: a weekly event at 09:00 in Europe/Helsinki keeps its wall clock across the
 *   autumn change (the offset moves from +03:00 to +02:00); a local time that does not exist in the
 *   zone is refused in the library's words under the CALENDAR prefix, which the script can catch;
 *   free time is what the busy intervals leave; an instant goes to a zone's local time and back;
 *   an ICS text goes to events and back; the host's own bounds refuse a call that is too large;
 *   and the calls exist for an extension that declares no capability at all, as another owner's
 *   extension too. Every case is a 500 "not a function" on the tree before this change, marked
 *   `// HOLE:` at the first.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=extension-calendar
 * @version-history
 *   2026-10-25 — Owner B and a signed-out caller name the extension by its full name, as names live
 *     in the owner's namespace (secaudit2026oct22).
 *   v1.1.0 — 2026-10-25 — Rules the recurrence engine could not finish answer with no occurrence,
 *     and the node keeps answering (secaudit2026oct22).
 *   v1.0.0 — 2026-10-13 — Initial (the October agents plan, brief 11).
 */
import { ownerSignIn } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

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
async function setupOwner(label: string) {
    const name = `excal${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Ext Calendar', password: 'ExtCal12345678' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await ownerSignIn(BASE, name, 'ExtCal12345678');
    assert(tok.body?.ok === true, `token: ${JSON.stringify(tok.body?.error)}`);
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== ctx.calendar: the calendar library as host calls of an extension E2E ===\n');

const EXT = `excal${Date.now()}`;
const SCRIPTS = {
    occurrences: `export default async function(ctx, input){ return { list: await ctx.calendar.occurrences(input.events, input.options) }; }`,
    free: `export default async function(ctx, input){ return { list: await ctx.calendar.freeSlots(input.busy, input.options) }; }`,
    zone: `export default async function(ctx, input){
        var instant = await ctx.calendar.toInstant(input.local, input.zone);
        return { instant: instant, back: await ctx.calendar.fromInstant(instant, input.zone), elsewhere: await ctx.calendar.fromInstant(instant, input.other) };
    }`,
    // The script catches the refusal and answers it, as a tool that says "that time does not exist" would.
    normalize: `export default async function(ctx, input){
        try { return { event: await ctx.calendar.normalize(input.event) }; } catch (e) { return { refused: String(e && e.message || e) }; }
    }`,
    ics: `export default async function(ctx, input){
        var text = await ctx.calendar.toICS(input.events, { name: 'E2E' });
        var back = await ctx.calendar.fromICS(text);
        return { text: text, back: back };
    }`,
    surface: `export default async function(ctx, input){ return { keys: Object.keys(ctx.calendar || {}).sort(), has: !!ctx.calendar }; }`,
};
// No capability, no workspace, no network: the calls need none.
const manifest = JSON.stringify({
    metadata: { name: EXT, version: '1.0.0', description: 'ctx.calendar e2e', author: 'e2e' },
    actions: Object.keys(SCRIPTS).map(id => ({ id, method: 'POST', path: `/${id}`, script: id })),
});

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
// The stored name is `<installer>/<short>`: A calls it by the short name, anybody else by the full one.
const extFull = () => `${A.name}/${EXT}`;
const invoke = (action: string, token: string, input: Record<string, unknown> = {}) =>
    json(`/v1/ext/${token === A.token ? EXT : encodeURIComponent(extFull())}/${action}`,{ method: 'POST', headers: auth(token), body: JSON.stringify(input) });

const WEEKLY = { id: 'standup', title: 'Standup', start: '2026-10-12T09:00:00', end: '2026-10-12T09:30:00', timeZone: 'Europe/Helsinki', rrule: 'FREQ=WEEKLY;COUNT=4' };

await test('Setup: two owners, and an extension that declares no capability', async () => {
    A = await setupOwner('a'); B = await setupOwner('b');
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ manifest, scripts: SCRIPTS }) });
    assert(inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(A.token) });
    assert(act.status === 200, `activate ${act.status}`);
});

await test('The seven calls exist with no capability declared', async () => {
    const r = await invoke('surface', A.token);
    assert(r.status === 200, `surface ${r.status}: ${JSON.stringify(r.body?.error)}`);
    // HOLE: `has` was false before this change, and every case below a 500 "not a function".
    assert(r.body.data.has === true, 'ctx.calendar exists');
    assert(JSON.stringify(r.body.data.keys) === JSON.stringify(['freeSlots', 'fromICS', 'fromInstant', 'normalize', 'occurrences', 'toICS', 'toInstant']), `surface: ${JSON.stringify(r.body.data.keys)}`);
});

await test('A weekly event keeps its wall clock across the autumn change: the offset moves, 09:00 does not', async () => {
    const r = await invoke('occurrences', A.token, { events: [WEEKLY], options: { from: '2026-10-12T00:00:00Z', to: '2026-11-09T00:00:00Z' } });
    assert(r.status === 200, `occurrences ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const list = r.body.data.list as Array<{ localStart: string; start: string; eventId: string }>;
    assert(list.length === 4 && list.every(o => o.eventId === 'standup' && o.localStart.endsWith('T09:00:00')), `four at 09:00 local: ${JSON.stringify(list.map(o => o.localStart))}`);
    // Summer time ends on 25 October 2026: 09:00 is 06:00Z before it and 07:00Z after.
    assert(list[0].start === '2026-10-12T06:00:00Z' && list[1].start === '2026-10-19T06:00:00Z', `before the change: ${list[0].start} ${list[1].start}`);
    assert(list[2].start === '2026-10-26T07:00:00Z' && list[3].start === '2026-11-02T07:00:00Z', `after the change: ${list[2].start} ${list[3].start}`);
});

await test('A range holds only what falls in it, and `limit` refuses in the library\'s words', async () => {
    const one = await invoke('occurrences', A.token, { events: [WEEKLY], options: { from: '2026-10-19T00:00:00Z', to: '2026-10-20T00:00:00Z' } });
    assert(one.status === 200 && one.body.data.list.length === 1 && one.body.data.list[0].start === '2026-10-19T06:00:00Z', `one in the day: ${JSON.stringify(one.body?.data ?? one.body?.error)}`);
    const over = await invoke('occurrences', A.token, { events: [WEEKLY], options: { from: '2026-10-12T00:00:00Z', to: '2026-11-09T00:00:00Z', limit: 2 } });
    assert(over.status >= 400 && /CALENDAR: Occurrence limit exceeded/.test(JSON.stringify(over.body)), `over the limit: ${over.status} ${JSON.stringify(over.body?.error)}`);
});

await test('A local time that does not exist in the zone is refused, and the script can catch it', async () => {
    // 28 March 2027, 03:00 to 04:00 does not exist in Helsinki.
    const gap = await invoke('normalize', A.token, { event: { id: 'x', start: '2027-03-28T03:30:00', end: '2027-03-28T04:30:00', timeZone: 'Europe/Helsinki' } });
    assert(gap.status === 200 && /^CALENDAR: Local time does not exist in Europe\/Helsinki/.test(gap.body.data.refused ?? ''), `the gap: ${JSON.stringify(gap.body?.data ?? gap.body?.error)}`);
    const fine = await invoke('normalize', A.token, { event: { id: 'x', start: '2027-03-28T04:30:00', end: '2027-03-28T05:30:00', timeZone: 'Europe/Helsinki' } });
    assert(fine.status === 200 && fine.body.data.event?.start === '2027-03-28T04:30:00' && fine.body.data.event?.allDay === false, `a time that exists: ${JSON.stringify(fine.body?.data)}`);
    const backwards = await invoke('normalize', A.token, { event: { id: 'x', start: '2027-03-29T10:00:00', end: '2027-03-29T09:00:00' } });
    assert(/^CALENDAR: Event end must follow start/.test(backwards.body.data?.refused ?? ''), `end before start: ${JSON.stringify(backwards.body?.data)}`);
});

await test('Free time is what the busy intervals leave, of at least the asked length', async () => {
    const r = await invoke('free', A.token, {
        busy: [{ start: '2026-10-12T06:00:00Z', end: '2026-10-12T06:30:00Z' }, { start: '2026-10-12T08:00:00Z', end: '2026-10-12T09:45:00Z' }, { start: '2026-10-12T10:00:00Z', end: '2026-10-12T11:00:00Z', transparent: true }],
        options: { from: '2026-10-12T05:00:00Z', to: '2026-10-12T12:00:00Z', minMinutes: 60 },
    });
    assert(r.status === 200, `free ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(JSON.stringify(r.body.data.list) === JSON.stringify([
        { start: '2026-10-12T05:00:00Z', end: '2026-10-12T06:00:00Z' }, { start: '2026-10-12T06:30:00Z', end: '2026-10-12T08:00:00Z' }, { start: '2026-10-12T09:45:00Z', end: '2026-10-12T12:00:00Z' },
    ]), `slots: ${JSON.stringify(r.body.data.list)}`);
});

await test('An instant goes to a zone\'s local time and back', async () => {
    const r = await invoke('zone', A.token, { local: '2026-10-26T09:00:00', zone: 'Europe/Helsinki', other: 'America/New_York' });
    assert(r.status === 200, `zone ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.instant === '2026-10-26T07:00:00Z' && r.body.data.back === '2026-10-26T09:00:00' && r.body.data.elsewhere === '2026-10-26T03:00:00', `conversion: ${JSON.stringify(r.body.data)}`);
});

await test('Events go to an ICS text and back as the same events', async () => {
    const r = await invoke('ics', A.token, { events: [WEEKLY, { id: 'trip', title: 'Trip', start: '2026-10-15', end: '2026-10-17', allDay: true }] });
    assert(r.status === 200, `ics ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const text = r.body.data.text as string;
    assert(text.startsWith('BEGIN:VCALENDAR') && text.includes('BEGIN:VTIMEZONE') && text.includes('RRULE:FREQ=WEEKLY;COUNT=4') && text.includes('DTSTART;VALUE=DATE:20261015'), `the text: ${text.slice(0, 200)}`);
    const back = (Array.isArray(r.body.data.back) ? r.body.data.back : r.body.data.back?.events) as Array<{ id: string; start: string; timeZone?: string; allDay?: boolean }>;
    const standup = back.find(e => e.id === 'standup'), trip = back.find(e => e.id === 'trip');
    assert(standup?.start === '2026-10-12T09:00:00' && standup.timeZone === 'Europe/Helsinki' && trip?.start === '2026-10-15' && trip.allDay === true, `read back: ${JSON.stringify(back)}`);
});

await test('The host\'s own bounds refuse a call that is too large, before the library runs', async () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({ id: `e${i}`, start: '2026-10-12T09:00:00', end: '2026-10-12T10:00:00' }));
    const r = await invoke('occurrences', A.token, { events: many, options: { from: '2026-10-12T00:00:00Z', to: '2026-10-13T00:00:00Z' } });
    assert(r.status >= 400 && /CALENDAR: at most 2000 event series in one call, got 2001/.test(JSON.stringify(r.body)), `2001 series: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const notList = await invoke('occurrences', A.token, { events: { id: 'x' }, options: { from: '2026-10-12T00:00:00Z', to: '2026-10-13T00:00:00Z' } });
    assert(notList.status >= 400 && /CALENDAR: event series must be an array/.test(JSON.stringify(notList.body)), `not a list: ${notList.status} ${JSON.stringify(notList.body?.error)}`);
    const noRange = await invoke('occurrences', A.token, { events: [WEEKLY], options: {} });
    assert(noRange.status >= 400 && /CALENDAR: from must be a string/.test(JSON.stringify(noRange.body)), `no range: ${noRange.status} ${JSON.stringify(noRange.body?.error)}`);
});

// secaudit2026oct22: a sub-daily rule whose BYHOUR the counter never reaches held the recurrence
// engine in an endless synchronous loop on the node's own thread, so every tenant waited.
await test('A rule the recurrence engine could not finish answers with no occurrence, and the node keeps answering', async () => {
    const events = [
        { id: 'never', start: '2026-10-12T00:00:00', end: '2026-10-12T00:30:00', timeZone: 'UTC', rrule: 'FREQ=HOURLY;BYHOUR=25' },
        { id: 'parity', start: '2026-10-12T00:00:00', end: '2026-10-12T00:30:00', timeZone: 'UTC', rrule: 'FREQ=HOURLY;INTERVAL=2;BYHOUR=1' },
        { id: 'feb30', start: '2026-10-12T09:00:00', end: '2026-10-12T09:30:00', timeZone: 'UTC', rrule: 'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30' },
    ];
    const r = await invoke('occurrences', A.token, { events: [...events, WEEKLY], options: { from: '2026-10-12T00:00:00Z', to: '2026-11-09T00:00:00Z' } });
    assert(r.status === 200, `occurrences ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ids = new Set((r.body.data.list as Array<{ eventId: string }>).map(o => o.eventId));
    assert(ids.size === 1 && ids.has('standup'), `only the weekly event occurs: ${JSON.stringify([...ids])}`);
    const build = await fetch(`${BASE}/v1/build`, { signal: AbortSignal.timeout(5000) });
    assert(build.ok, `GET /v1/build ${build.status}`);
});

await test('Another owner calling the extension gets the same computation, and no credential gets none', async () => {
    const other = await invoke('zone', B.token, { local: '2026-10-26T09:00:00', zone: 'Europe/Helsinki', other: 'UTC' });
    assert(other.status === 200 && other.body.data.instant === '2026-10-26T07:00:00Z', `owner B: ${other.status} ${JSON.stringify(other.body?.error)}`);
    const anonymous = await json(`/v1/ext/${encodeURIComponent(extFull())}/zone`,{ method: 'POST', body: JSON.stringify({ local: '2026-10-26T09:00:00', zone: 'Europe/Helsinki', other: 'UTC' }) });
    assert(anonymous.status === 401, `no credential: ${anonymous.status}`);
    const remove = await json(`/v1/extensions/${encodeURIComponent(extFull())}`, { method: 'DELETE', headers: auth(B.token) });
    assert(remove.status === 403 || remove.status === 404, `owner B cannot remove A's extension: ${remove.status}`);
});

await test('Cleanup: the extension', async () => {
    const r = await json(`/v1/extensions/${EXT}`, { method: 'DELETE', headers: auth(A.token) });
    assert(r.status === 200, `delete ${r.status}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
