/**
 * @file e2e-owner-load-limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What one owner may load the node's shared scheduler and realtime rooms with
 *   (secaudit2026oct31w2 round 10, f-2026aug-dos-ratelimit-2 and -3). Three operator settings, each
 *   with 0 for no limit and a default no real use reaches:
 *     - schedules.min_interval_seconds (default 60): a schedule made or re-timed runs at most once in
 *       that many seconds, through POST /v1/schedules, the MCP tool and a workflow's scheduled trigger.
 *       A schedule that exists keeps its time, and an edit that keeps it asks nothing.
 *     - schedules.max_per_owner (default 1000): the schedules one owner keeps, their agents' included.
 *     - realtime.rooms_per_owner (default 50): the rooms one owner and their agents hold open at once,
 *       inside realtime.max_rooms. Another owner still gets a room.
 *
 *   FIRST FAIL. On the tree before the limits every "Refused:" test fails: a per-second schedule and
 *   the schedule past the count are answered 201, and the room past the share 201. The "Usage:" tests
 *   pass on both trees: per-minute schedules, a daily workflow, the owner's agent's schedule, rooms
 *   under the share, and every limit at 0.
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (secaudit2026oct31w2 round 10).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=owner-load-limits
import { registerOwner, setupOperator } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!';

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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const stamp = Date.now().toString(36);
let operator = { name: '', token: '' };
let owner = { name: '', token: '' };
let other = { name: '', token: '' };
let agentToken = '';

async function setConfig(path: string, value: unknown) {
    const r = await json('/v1/admin/config', { method: 'PUT', headers: auth(operator.token), body: JSON.stringify({ changes: [{ path, value }] }) });
    if (r.body?.ok !== true) throw new Error(`config ${path}: ${r.status} ${JSON.stringify(r.body?.error ?? r.body)}`);
}
/** The running value of one setting, from GET /v1/admin/config (the row whose `path` is `path`). */
async function readConfig(path: string): Promise<unknown> {
    const r = await json(`/v1/admin/config?q=${encodeURIComponent(path)}`, { headers: auth(operator.token) });
    const find = (o: any): any => {
        if (!o || typeof o !== 'object') return undefined;
        if (o.path === path && 'value' in o) return o;
        for (const v of Object.values(o)) { const hit = find(v); if (hit) return hit; }
        return undefined;
    };
    return find(r.body?.data)?.value;
}

/** Made paused, so no schedule of this suite fires on the shared test node. */
const aiSchedule = (cron: string, name: string) => ({ kind: 'ai', cron, display_name: name, prompt: 'Say hello.', enabled: false });
const createSchedule = (token: string, body: Record<string, unknown>) =>
    json('/v1/schedules', { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
const createRoom = (token: string, name: string) =>
    json('/v1/realtime/rooms', { method: 'POST', headers: auth(token), body: JSON.stringify({ app_type: 'whiteboard', name }) });
const workflow = (cron: string) => ({
    title: { en_US: 'Load limit' }, description: { en_US: 'one human gate' },
    trigger: { kind: 'schedule', cron, timezone: 'Europe/Helsinki' }, on_step_fail: 'inspect', vars: [],
    steps: [{
        id: 'gate', description: { en_US: 'Look' }, required_to_function: 'none',
        action: { kind: 'human-input', question: { header: 'Load', prompt: 'Go?', options: [{ id: 'yes', label: 'Yes' }] }, answer_to_key: 'loadwf.{run}.decision' },
    }],
});

console.log('\n=== Owner load limits (schedules, realtime rooms) ===\n');

await test('Setup: an operator, two owners, an agent of the first', async () => {
    operator = await setupOperator(BASE, ADMIN_PW, `lloper${stamp}`);
    owner = await registerOwner(BASE, `llown${stamp}`);
    other = await registerOwner(BASE, `lloth${stamp}`);
    agentToken = (await makeAgent(BASE, owner, ['task:write', 'ai:use', 'social:write', 'memory:read', 'memory:write'])).token;
});

await test('Usage: the defaults are the documented ones (60 seconds, 1000 schedules, 50 rooms)', async () => {
    const want: Record<string, number> = { 'schedules.min_interval_seconds': 60, 'schedules.max_per_owner': 1000, 'realtime.rooms_per_owner': 50 };
    for (const [path, value] of Object.entries(want)) {
        const got = await readConfig(path);
        assert(got === value, `${path} is ${value} by default, got ${JSON.stringify(got)}`);
    }
});

// ── Schedules: the shortest gap ──

await test('Usage: a once-a-minute and a daily schedule are made as before (REST, owner)', async () => {
    for (const cron of ['* * * * *', '0 7 * * *', '*/5 * * * *']) {
        const r = await createSchedule(owner.token, aiSchedule(cron, `ok ${cron}`));
        assert(r.status === 201, `${cron}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    }
});

let perSecondId = '';
await test('Refused: a schedule that runs every second (REST, owner), with a message naming the setting', async () => {
    const r = await createSchedule(owner.token, aiSchedule('* * * * * *', 'every second'));
    assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
    assert(r.body?.error?.code === 'SCHEDULE_TOO_FREQUENT', `code ${r.body?.error?.code}`);
    assert(String(r.body?.error?.message).includes('schedules.min_interval_seconds'), `the message names the setting: ${r.body?.error?.message}`);
});

await test('Refused: an every-30-seconds schedule through the MCP tool (the owner\'s agent)', async () => {
    const s = await openSession(BASE, agentToken, 'load-limits');
    const r = await callTool(s, 'aimeat_schedule_create', { kind: 'ai', cron: '*/30 * * * * *', display_name: 'half-minute', prompt: 'Say hello.' });
    assert(r.isError && r.text.includes('SCHEDULE_TOO_FREQUENT'), `expected SCHEDULE_TOO_FREQUENT, got ${r.text.slice(0, 300)}`);
});

await test('Refused: an edit that gives a schedule a per-second time; Usage: an edit that keeps the time', async () => {
    const made = await createSchedule(owner.token, aiSchedule('0 8 * * *', 'to edit'));
    assert(made.status === 201, `create ${made.status}`);
    const id = made.body.data.schedule.id;
    const bad = await json(`/v1/schedules/${id}`, { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ cron: '*/10 * * * * *' }) });
    assert(bad.status === 400 && bad.body?.error?.code === 'SCHEDULE_TOO_FREQUENT', `re-time ${bad.status} ${JSON.stringify(bad.body?.error)}`);
    const ok = await json(`/v1/schedules/${id}`, { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ cron: '0 8 * * *', display_name: 'renamed' }) });
    assert(ok.status === 200, `same time ${ok.status} ${JSON.stringify(ok.body?.error)}`);
});

await test('Refused: a workflow whose scheduled trigger runs every second; Usage: a daily one is saved', async () => {
    const bad = await json(`/v1/workflows/loadwf-${stamp}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify(workflow('* * * * * *')) });
    assert(bad.status === 400 && JSON.stringify(bad.body).includes('schedules.min_interval_seconds'), `per-second workflow ${bad.status} ${JSON.stringify(bad.body).slice(0, 300)}`);
    const ok = await json(`/v1/workflows/loadwf-${stamp}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify(workflow('0 6 * * *')) });
    assert(ok.status === 200, `daily workflow ${ok.status} ${JSON.stringify(ok.body).slice(0, 300)}`);
    await json(`/v1/workflows/loadwf-${stamp}`, { method: 'DELETE', headers: auth(owner.token) });
});

await test('Usage: with the gap at 0 (no limit) a per-second schedule is made, and keeps its time after the gap returns', async () => {
    await setConfig('schedules.min_interval_seconds', 0);
    try {
        const r = await createSchedule(owner.token, aiSchedule('* * * * * *', 'every second, allowed'));
        assert(r.status === 201, `with no limit: ${r.status} ${JSON.stringify(r.body?.error)}`);
        perSecondId = r.body.data.schedule.id;
        await json(`/v1/schedules/${perSecondId}`, { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ enabled: false }) });
    } finally {
        await setConfig('schedules.min_interval_seconds', 60);
    }
    const keep = await json(`/v1/schedules/${perSecondId}`, { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ cron: '* * * * * *', display_name: 'kept' }) });
    assert(keep.status === 200, `an existing schedule keeps its time: ${keep.status} ${JSON.stringify(keep.body?.error)}`);
    await json(`/v1/schedules/${perSecondId}`, { method: 'DELETE', headers: auth(owner.token) });
});

// ── Schedules: how many one owner keeps ──

await test('Refused: a schedule past schedules.max_per_owner, the agent\'s counted with the owner\'s; Usage: another owner is not counted', async () => {
    const list = await json('/v1/schedules', { headers: auth(owner.token) });
    const held = (list.body?.data?.managed as unknown[] | undefined)?.length ?? 0;
    await setConfig('schedules.max_per_owner', held + 1);
    try {
        const s = await openSession(BASE, agentToken, 'load-limits-count');
        const viaAgent = await callTool(s, 'aimeat_schedule_create', { kind: 'ai', cron: '0 9 * * *', display_name: 'agent one', prompt: 'Say hello.' });
        assert(!viaAgent.isError, `the agent's schedule under the limit: ${viaAgent.text.slice(0, 300)}`);
        const past = await createSchedule(owner.token, aiSchedule('0 10 * * *', 'one too many'));
        assert(past.status === 409 && past.body?.error?.code === 'SCHEDULE_LIMIT', `past the limit ${past.status} ${JSON.stringify(past.body?.error)}`);
        assert(String(past.body?.error?.message).includes('schedules.max_per_owner'), 'the message names the setting');
        const theirs = await createSchedule(other.token, aiSchedule('0 10 * * *', 'another owner'));
        assert(theirs.status === 201, `another owner: ${theirs.status} ${JSON.stringify(theirs.body?.error)}`);
    } finally {
        await setConfig('schedules.max_per_owner', 1000);
    }
    const after = await createSchedule(owner.token, aiSchedule('0 10 * * *', 'after the limit is raised'));
    assert(after.status === 201, `under the default: ${after.status}`);
});

// ── Realtime rooms: one owner's share ──

await test('Refused: a room past realtime.rooms_per_owner, the agent\'s counted with the owner\'s; Usage: another owner gets one', async () => {
    const opened: Array<{ id: string; token: string }> = [];
    await setConfig('realtime.rooms_per_owner', 2);
    try {
        const a = await createRoom(owner.token, `ll-a-${stamp}`);
        assert(a.status === 201, `first ${a.status}`); opened.push({ id: a.body.data.id, token: owner.token });
        const b = await createRoom(agentToken, `ll-b-${stamp}`);
        assert(b.status === 201, `the agent's ${b.status} ${JSON.stringify(b.body?.error)}`); opened.push({ id: b.body.data.id, token: agentToken });
        const c = await createRoom(owner.token, `ll-c-${stamp}`);
        assert(c.status === 429 && c.body?.error?.code === 'OWNER_ROOM_LIMIT', `third ${c.status} ${JSON.stringify(c.body?.error)}`);
        assert(String(c.body?.error?.message).includes('realtime.rooms_per_owner'), 'the message names the setting');
        const d = await createRoom(other.token, `ll-d-${stamp}`);
        assert(d.status === 201, `another owner ${d.status} ${JSON.stringify(d.body?.error)}`); opened.push({ id: d.body.data.id, token: other.token });
        // Closing one frees the share.
        const closed = await json(`/v1/realtime/rooms/${opened[0].id}`, { method: 'DELETE', headers: auth(owner.token) });
        assert(closed.status === 200, `close ${closed.status}`); opened.shift();
        const e = await createRoom(owner.token, `ll-e-${stamp}`);
        assert(e.status === 201, `after closing one ${e.status}`); opened.push({ id: e.body.data.id, token: owner.token });
    } finally {
        await setConfig('realtime.rooms_per_owner', 50);
        for (const r of opened) await json(`/v1/realtime/rooms/${r.id}`, { method: 'DELETE', headers: auth(r.token) });
    }
});

await test('Usage: with the share at 0 (no separate limit) rooms are made as before', async () => {
    await setConfig('realtime.rooms_per_owner', 0);
    const ids: string[] = [];
    try {
        for (let i = 0; i < 3; i++) {
            const r = await createRoom(owner.token, `ll-free-${i}-${stamp}`);
            assert(r.status === 201, `room ${i}: ${r.status}`); ids.push(r.body.data.id);
        }
    } finally {
        await setConfig('realtime.rooms_per_owner', 50);
        for (const id of ids) await json(`/v1/realtime/rooms/${id}`, { method: 'DELETE', headers: auth(owner.token) });
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
