/**
 * @file e2e-intake-thread.ts
 * @description E2E for a conversation through a public intake form: a visitor who is not signed in
 *   starts one, writes more turns, reads the answers the owner's side wrote, and deletes it.
 *
 *   What it holds: the token is given once and its hash is the record id; two visitors cannot read
 *   each other's conversation; a wrong token, another form's token and an ordinary form all answer
 *   404; the turn cap, the length cap, the pace and the daily caps refuse before anything is
 *   written; a turn wakes an agent by one signal record, and writes none once a person has taken
 *   the conversation over or the form's agent turns for the day are spent; the visitor reads back
 *   only role, text and time; deleting removes all three records with their versions; a form whose
 *   spaces cannot hold the node's fields is refused when it is defined.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=intake-thread
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (the October agents plan, P4).
 */
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const owner = `thr${Date.now() % 100000}`;
const owner2 = `thr${(Date.now() + 13) % 100000}b`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: unknown) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as Record<string, unknown> : { _raw: await res.text() };
    return { status: res.status, body: body as { ok?: boolean; data?: any; error?: { code?: string; message?: string } } };
}

const space = (name: string, namespace: string) => ({ name, namespace, mode: 'records', backing: 'memory', writeRole: 'member', versioned: false, schemaRef: `schema:${name}@1` });
const MANIFEST = {
    manifestVersion: '1', name: 'Visitor chat', kind: 'project',
    objectTypes: [space('thread', 'chat.threads'), space('reply', 'chat.replies'), space('signal', 'chat.signals'), space('lead', 'chat.leads'), space('narrow', 'chat.narrow')],
};
const turn = { type: 'object', additionalProperties: false, required: ['text', 'at'], properties: { text: { type: 'string' }, at: { type: 'string' }, role: { type: 'string' } } };
const SCHEMAS = {
    'chat.threads': {
        type: 'object', additionalProperties: false, required: ['id', 'form_id', 'turns'],
        properties: { id: { type: 'string' }, form_id: { type: 'string' }, started_at: { type: 'string' }, updated_at: { type: 'string' }, signalled_turn: { type: 'number' }, turns: { type: 'array', items: turn } },
    },
    'chat.replies': {
        type: 'object', additionalProperties: false, required: ['id'],
        properties: { id: { type: 'string' }, handler: { type: 'string', enum: ['agent', 'person'] }, closed: { type: 'boolean' }, secret_note: { type: 'string' }, replies: { type: 'array', items: turn } },
    },
    'chat.signals': {
        type: 'object', additionalProperties: false, required: ['id', 'thread', 'turn'],
        properties: { id: { type: 'string' }, thread: { type: 'string' }, turn: { type: 'number' }, at: { type: 'string' } },
    },
    'chat.leads': { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' }, nimi: { type: 'string' } } },
    // A space that cannot hold a thread record: it lists no `turns`.
    'chat.narrow': { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' }, form_id: { type: 'string' } } },
};

async function main() {
    console.log('\n=== A conversation through a public intake form E2E ===\n');
    let ownerToken = '', owner2Token = '', orgId = '', ws = '';
    const auth = () => ({ Authorization: `Bearer ${ownerToken}` });
    const formPath = (formId: string) => `/v1/intake/${orgId}/${ws}/${formId}`;
    const say = (formId: string, text: unknown, token?: string, extra: Record<string, unknown> = {}) =>
        json(`${formPath(formId)}/thread`, { method: 'POST', body: JSON.stringify({ text, ...(token ? { token } : {}), ...extra }) });
    const read = (formId: string, token: unknown) => json(`${formPath(formId)}/thread/read`, { method: 'POST', body: JSON.stringify({ token }) });
    const forget = (formId: string, token: unknown) => json(`${formPath(formId)}/thread/forget`, { method: 'POST', body: JSON.stringify({ token }) });
    const record = async (namespace: string, id: string) => {
        const r = await json(`/v1/memory/${encodeURIComponent(`organism.${orgId}.w.${ws}.${namespace}.${id}.latest`)}`, { headers: auth() });
        return r.status === 200 ? r.body.data as { value: any; version: number } : null;
    };
    const ids = async (namespace: string): Promise<string[]> => {
        const r = await json(`/v1/organisms/${orgId}/workspace/index?ws=${ws}`, { headers: auth() });
        const name = MANIFEST.objectTypes.find((o) => o.namespace === namespace)!.name;
        return ((r.body.data?.index?.[name] ?? []) as Array<{ id: string }>).map((x) => x.id);
    };
    /** The id of the thread record whose first visitor turn is this text: a test knows a visitor's token, never the id. */
    const idByFirstText = async (text: string): Promise<string> => {
        for (const x of await ids('chat.threads')) if ((await record('chat.threads', x))?.value.turns?.[0]?.text === text) return x;
        throw new Error(`no thread record starts with "${text}"`);
    };
    /** The owner's side answers: a member writes the reply record through the ordinary publish. */
    const reply = async (id: string, value: Record<string, unknown>) => {
        const r = await json(`/v1/organisms/${orgId}/workspace/records/publish`, {
            method: 'POST', headers: auth(), body: JSON.stringify({ ws, namespace: 'chat.replies', records: [{ id, value: { id, ...value } }] }),
        });
        assert(r.status === 200 && (r.body.data?.results?.[0]?.ok ?? r.body.data?.published === 1), `reply publish: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    };
    const define = (body: Record<string, unknown>, token = ownerToken) =>
        json('/v1/intake/forms', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ organism_id: orgId, ws, ...body }) });
    const THREAD = { reply_namespace: 'chat.replies', signal_namespace: 'chat.signals' };

    await test('setup: two owners, an organism and a workspace with the three spaces', async () => {
        ownerToken = (await registerOwner(BASE, owner)).token;
        owner2Token = (await registerOwner(BASE, owner2)).token;
        const org = await json('/v1/organisms', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Chat Org', type: 'project', visibility: 'private' }) });
        assert(org.status === 201, `create org: ${org.status}`);
        orgId = org.body.data.organism.id;
        const w = await json(`/v1/organisms/${orgId}/workspaces`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Visitor chat', manifest: MANIFEST, schemas: SCHEMAS }) });
        assert(w.status === 201, `create ws: ${w.status} ${JSON.stringify(w.body.error)}`);
        ws = w.body.data.ws;
    });

    // ── 1. Defining a form that takes a conversation ──
    await test('1a. a form with `thread` is defined with no field list, and its public description says what a visitor may send', async () => {
        const r = await define({ namespace: 'chat.threads', form_id: 'chat', title: 'Ask us', honeypot_field: 'website', max_per_day: 4, thread: { ...THREAD, max_turns: 3, max_chars: 200, max_agent_turns_per_day: 6 } });
        assert(r.status === 200 && r.body.data.thread === true, `define: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
        const d = await json(formPath('chat'));
        assert(d.status === 200 && d.body.data.thread?.max_turns === 3 && d.body.data.thread?.max_chars === 200, `descriptor: ${JSON.stringify(d.body.data)}`);
        const text = JSON.stringify(d.body.data);
        assert(!text.includes('chat.replies') && !text.includes('chat.signals') && !text.includes('chat.threads'), `the description names no space: ${text}`);
    });

    await test('1b. the three spaces must be three, declared, and able to hold what the node writes', async () => {
        const same = await define({ namespace: 'chat.threads', form_id: 'same', thread: { reply_namespace: 'chat.threads', signal_namespace: 'chat.signals' } });
        assert(same.status === 400 && same.body.error?.code === 'INVALID_INPUT', `same space twice: ${same.status} ${same.body.error?.code}`);
        const missing = await define({ namespace: 'chat.threads', form_id: 'missing', thread: { reply_namespace: 'chat.replies' } });
        assert(missing.status === 400, `no signal space: ${missing.status}`);
        const undeclared = await define({ namespace: 'chat.threads', form_id: 'undeclared', thread: { reply_namespace: 'chat.replies', signal_namespace: 'chat.nowhere' } });
        assert(undeclared.status === 422 && undeclared.body.error?.code === 'UNDECLARED_SPACE', `undeclared signal space: ${undeclared.status} ${undeclared.body.error?.code}`);
        const narrow = await define({ namespace: 'chat.narrow', form_id: 'narrow', thread: THREAD });
        assert(narrow.status === 422 && narrow.body.error?.code === 'INTAKE_SCHEMA_MISMATCH' && String(narrow.body.error?.message).includes('"turns"'),
            `a thread space that cannot hold turns: ${narrow.status} ${narrow.body.error?.code} ${narrow.body.error?.message}`);
        const other = await define({ namespace: 'chat.threads', form_id: 'theirs', thread: THREAD }, owner2Token);
        assert(other.status === 403, `another owner defines a form here: ${other.status}`);
    });

    await test('1c. an ordinary form takes no conversation, and a conversation form takes no ordinary submit', async () => {
        const plain = await define({ namespace: 'chat.leads', form_id: 'plain', allowed_fields: ['nimi'] });
        assert(plain.status === 200, `define plain: ${plain.status} ${JSON.stringify(plain.body.error)}`);
        const a = await say('plain', 'hello');
        assert(a.status === 404, `a conversation on an ordinary form: ${a.status}`);
        const b = await json(formPath('chat'), { method: 'POST', body: JSON.stringify({ nimi: 'x' }) });
        assert(b.status === 400 && b.body.error?.code === 'THREAD_FORM', `an ordinary submit to a conversation form: ${b.status} ${b.body.error?.code}`);
        const c = await say('no-such-form', 'hello');
        assert(c.status === 404, `unknown form: ${c.status}`);
    });

    // ── 2. One conversation ──
    let token = '', id = '';
    await test('2a. the first message starts a conversation: a token once, one thread record, one signal', async () => {
        const r = await say('chat', '  Do you deliver to Tampere?\u0000 ');
        assert(r.status === 200 && r.body.data.ok === true, `start: ${r.status} ${JSON.stringify(r.body.error)}`);
        token = r.body.data.thread_token;
        assert(typeof token === 'string' && token.length === 43, `a token: ${token}`);
        assert(r.body.data.turn === 1 && r.body.data.turns_left === 2 && r.body.data.handler === 'agent', `answer: ${JSON.stringify(r.body.data)}`);
        const threads = await ids('chat.threads');
        assert(threads.length === 1, `one thread record: ${threads.join(',')}`);
        id = threads[0];
        assert(id !== token && !id.includes(token.slice(0, 12)), 'the record id is not the token');
        const t = await record('chat.threads', id);
        assert(t?.value.turns.length === 1 && t.value.turns[0].text === 'Do you deliver to Tampere?' && t.value.form_id === 'chat' && t.value.signalled_turn === 1,
            `thread record: ${JSON.stringify(t?.value)}`);
        assert(!JSON.stringify(t?.value).includes(token), 'the token is stored nowhere in the record');
        const s = await record('chat.signals', id);
        assert(s?.value.thread === id && s.value.turn === 1, `signal record: ${JSON.stringify(s?.value)}`);
    });

    await test('2b. the visitor reads both sides, and only role, text and time of each turn', async () => {
        await reply(id, { secret_note: 'the customer sounds impatient', replies: [{ text: 'Yes, on weekdays.', at: new Date(Date.now() + 1000).toISOString() }] });
        const r = await read('chat', token);
        assert(r.status === 200, `read: ${r.status} ${JSON.stringify(r.body.error)}`);
        const d = r.body.data;
        assert(d.turns.length === 2 && d.turns[0].role === 'visitor' && d.turns[1].role === 'agent' && d.turns[1].text === 'Yes, on weekdays.', `turns: ${JSON.stringify(d.turns)}`);
        assert(Object.keys(d.turns[1]).sort().join(',') === 'at,role,text', `a turn carries three fields: ${Object.keys(d.turns[1])}`);
        assert(d.handler === 'agent' && d.closed === false && d.turns_left === 2, `state: ${JSON.stringify(d)}`);
        assert(!JSON.stringify(d).includes('impatient') && !JSON.stringify(d).includes(id), 'nothing else of the reply record, and no record id');
    });

    await test('2c. a wrong token, no token, another form and another visitor all read nothing', async () => {
        const wrong = await read('chat', token.slice(0, 42) + (token.endsWith('A') ? 'B' : 'A'));
        const none = await read('chat', undefined);
        const shape = await read('chat', { $ne: '' });
        const byId = await read('chat', id);
        assert(wrong.status === 404 && none.status === 404 && shape.status === 404 && byId.status === 404, `got ${wrong.status} ${none.status} ${shape.status} ${byId.status}`);
        const second = await define({ namespace: 'chat.threads', form_id: 'chat-two', thread: THREAD });
        assert(second.status === 200, `define a second form: ${second.status}`);
        const otherForm = await read('chat-two', token);
        assert(otherForm.status === 404, `the token on another form: ${otherForm.status}`);
        const visitorB = await say('chat', 'Another visitor writes.');
        assert(visitorB.status === 200, `visitor B starts: ${visitorB.status}`);
        const b = await read('chat', visitorB.body.data.thread_token);
        assert(b.body.data.turns.length === 1 && b.body.data.turns[0].text === 'Another visitor writes.', `visitor B reads only their own: ${JSON.stringify(b.body.data.turns)}`);
        const append = await say('chat', 'x', token.slice(0, 42) + (token.endsWith('A') ? 'B' : 'A'));
        assert(append.status === 404 && append.body.error?.code === 'THREAD_NOT_FOUND', `a turn with a wrong token: ${append.status} ${append.body.error?.code}`);
    });

    await test('2d. the next message comes no sooner than two seconds, then is stored as turn 2 with a new signal', async () => {
        const fast = await say('chat', 'And on Saturdays?', token);
        assert(fast.status === 429 && fast.body.error?.code === 'THREAD_TOO_FAST', `too fast: ${fast.status} ${fast.body.error?.code}`);
        await sleep(2100);
        const r = await say('chat', 'And on Saturdays?', token);
        assert(r.status === 200 && r.body.data.turn === 2 && r.body.data.turns_left === 1 && !('thread_token' in r.body.data), `turn 2: ${r.status} ${JSON.stringify(r.body.data ?? r.body.error)}`);
        const t = await record('chat.threads', id);
        assert(t?.value.turns.length === 2 && t.value.signalled_turn === 2, `thread: ${JSON.stringify(t?.value)}`);
        assert((await record('chat.signals', id))?.value.turn === 2, 'the signal names turn 2');
    });

    await test('2e. an empty message, one past the length cap and a filled honeypot write nothing', async () => {
        const before = (await record('chat.threads', id))?.value.turns.length;
        await sleep(2100);
        const empty = await say('chat', '   ', token);
        const long = await say('chat', 'x'.repeat(201), token);
        const notText = await say('chat', { text: 'x' }, token);
        assert(empty.status === 400 && long.status === 400 && notText.status === 400, `got ${empty.status} ${long.status} ${notText.status}`);
        const bot = await say('chat', 'Buy this', undefined, { website: 'http://spam.example' });
        assert(bot.status === 200 && bot.body.data.thread_token === null, `a filled honeypot is answered and given no token: ${JSON.stringify(bot.body.data)}`);
        assert((await record('chat.threads', id))?.value.turns.length === before, 'the conversation is unchanged');
        assert((await ids('chat.threads')).length === 2, 'and the honeypot started no conversation');
    });

    await test('2f. once a person has taken the conversation over, a turn is stored and wakes no agent', async () => {
        await reply(id, { handler: 'person', replies: [{ text: 'Yes, on weekdays.', at: new Date().toISOString() }, { role: 'person', text: 'This is Jouni. Saturdays too.', at: new Date().toISOString() }] });
        const r = await say('chat', 'Thank you!', token);
        assert(r.status === 200 && r.body.data.turn === 3 && r.body.data.handler === 'person' && r.body.data.turns_left === 0, `turn 3: ${r.status} ${JSON.stringify(r.body.data ?? r.body.error)}`);
        const t = await record('chat.threads', id);
        assert(t?.value.turns.length === 3 && t.value.signalled_turn === 2, `stored, and the agent was last woken for turn 2: ${JSON.stringify(t?.value)}`);
        assert((await record('chat.signals', id))?.value.turn === 2, 'no new signal');
        const seen = await read('chat', token);
        assert(seen.body.data.handler === 'person' && seen.body.data.turns.some((x: any) => x.role === 'person'), `the visitor sees a person answers: ${JSON.stringify(seen.body.data)}`);
    });

    await test('2g. the conversation takes its three messages and no fourth', async () => {
        await sleep(2100);
        const r = await say('chat', 'One more?', token);
        assert(r.status === 429 && r.body.error?.code === 'THREAD_FULL', `turn 4: ${r.status} ${r.body.error?.code}`);
        assert((await record('chat.threads', id))?.value.turns.length === 3, 'nothing was written');
    });

    await test('2h. a closed conversation takes no message', async () => {
        const v = await say('chat', 'A third visitor.');
        assert(v.status === 200, `start: ${v.status} ${JSON.stringify(v.body.error)}`);
        await reply(await idByFirstText('A third visitor.'), { closed: true, replies: [] });
        await sleep(2100);
        const r = await say('chat', 'Hello again', v.body.data.thread_token);
        assert(r.status === 409 && r.body.error?.code === 'THREAD_CLOSED', `closed: ${r.status} ${r.body.error?.code}`);
        const seen = await read('chat', v.body.data.thread_token);
        assert(seen.status === 200 && seen.body.data.closed === true, 'the visitor can still read it, and sees it is closed');
    });

    // ── 3. The form's caps for a day ──
    await test('3a. the form starts four conversations in a day and refuses the fifth before writing', async () => {
        const fourth = await say('chat', 'Visitor four.');
        assert(fourth.status === 200, `the fourth start: ${fourth.status} ${JSON.stringify(fourth.body.error)}`);
        const before = (await ids('chat.threads')).length;
        const fifth = await say('chat', 'Visitor five.');
        assert(fifth.status === 429 && fifth.body.error?.code === 'INTAKE_DAILY_LIMIT', `the fifth start: ${fifth.status} ${fifth.body.error?.code}`);
        assert((await ids('chat.threads')).length === before, 'no record for the fifth');
    });

    await test('3b. when the agent turns for the day are spent, a message is stored and a person answers it', async () => {
        // The form allows six agent turns a day; 2a, 2c (visitor B), 2d, 2h and 3a used five.
        const d = await define({ namespace: 'chat.threads', form_id: 'tight', thread: { ...THREAD, max_agent_turns_per_day: 1 } });
        assert(d.status === 200, `define: ${d.status} ${JSON.stringify(d.body.error)}`);
        const first = await say('tight', 'First message of the day.');
        assert(first.status === 200 && first.body.data.handler === 'agent', `first: ${JSON.stringify(first.body.data ?? first.body.error)}`);
        const second = await say('tight', 'Second message of the day.');
        assert(second.status === 200 && second.body.data.handler === 'person', `second: ${JSON.stringify(second.body.data ?? second.body.error)}`);
        const stored = await idByFirstText('Second message of the day.');
        assert((await record('chat.threads', stored))?.value.signalled_turn === 0, 'stored with no agent woken');
        assert(!(await record('chat.signals', stored)), 'and no signal record for it');
    });

    // ── 4. Deleting ──
    await test('4a. the visitor deletes the conversation: thread, reply and signal are gone, and the token opens nothing', async () => {
        const wrong = await forget('chat', id);
        assert(wrong.status === 404, `the record id is not a token: ${wrong.status}`);
        const r = await forget('chat', token);
        assert(r.status === 200 && r.body.data.forgotten === true, `forget: ${r.status} ${JSON.stringify(r.body.error)}`);
        assert(!(await record('chat.threads', id)) && !(await record('chat.replies', id)) && !(await record('chat.signals', id)), 'all three records are gone');
        assert(!(await ids('chat.threads')).includes(id) && !(await ids('chat.replies')).includes(id), 'and the workspace index no longer lists it');
        const after = await read('chat', token);
        assert(after.status === 404, `the token after deleting: ${after.status}`);
        const again = await say('chat', 'Still there?', token);
        assert(again.status === 404, `a turn after deleting: ${again.status}`);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
