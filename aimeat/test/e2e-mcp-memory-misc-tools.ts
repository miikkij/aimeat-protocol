/**
 * @file test/e2e-mcp-memory-misc-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Nine tools of the node MCP endpoint that no suite called, outside the organism
 *   family: putting a binned record back, who wrote a key, an app's data map read and stated, the
 *   Design Book's propose and adopt, removing a contact, and the agent's own message inbox and
 *   history. Each is called once by the caller it is written for and once by a caller it must not
 *   serve, and the state is read back over REST where the tool changes something.
 *
 *   WHY THIS SUITE EXISTS. Each of these handlers resolves the caller from the MCP session and hands
 *   it to a service that decides on it (memory-bin restoreMemoryRecord, data-map stateProgramMap,
 *   design-book adopt, contacts removeContact). The REST suites drive the same services with a REST
 *   caller, so nothing proved that the MCP handler passes the session's own principal and owner
 *   rather than something wider. The refusal case here is always the next account over: another
 *   owner's agent holding the same words, which must reach only its own owner's data.
 *
 *   TWO TOOLS HAVE NO REFUSAL OF THEIR OWN. aimeat_message_inbox and aimeat_message_history read
 *   only the calling agent's own messages (storage.listPendingMessages(agentGaii),
 *   storage.listMessages(agentGaii)), take no organism or owner argument, and ask no scope word. What
 *   can go wrong there is a read that reaches another agent's thread, so the assertion is isolation:
 *   a second agent of the same owner, given the first agent's thread id, reads nothing of it. The
 *   history tool's input schema refusal (per_page over 100) is asserted as well, and is named as what
 *   it is. aimeat_memory_hands has no refusal path either (handsOnKey always answers); its refusals
 *   are the scope filter (no memory:read, not offered) and the same isolation.
 * @structure
 *   - Setup: owners A (first, operator) and B; agents of each with the words each case needs; an
 *     app of each owner
 *   - Memory: aimeat_memory_restore, aimeat_memory_hands
 *   - Data map: aimeat_datamap_set, aimeat_datamap_get
 *   - Design Book: aimeat_designbook_propose, aimeat_designbook_adopt
 *   - Contacts: aimeat_contact_remove
 *   - Messages: aimeat_message_inbox, aimeat_message_history
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-memory-misc-tools
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit W27).
 */

import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

const auth = (o: { token: string }): Record<string, string> => ({ Authorization: `Bearer ${o.token}` });
const TAG = Date.now().toString(36).slice(-5);

/** The words an agent of this suite holds; the cases differ by WHOSE agent calls, not by its words. */
const WORDS = ['memory:read', 'memory:write', 'memory:delete', 'messages:send', 'contacts:read'];

/** A page the Design Book can adopt into (the atelier track), from e2e-designbook.ts. */
const APP = (filename: string): string => [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<meta name="aimeat-app" content="${filename}">`,
    '<meta name="aimeat-track" content="atelier">',
    '<meta name="aimeat-register" content="genre-nightfloor">',
    '<link rel="stylesheet" href="/lib/aimeat-atelier.css">',
    '</head><body><script src="/v1/libs/aimeat-atelier.js"></' + 'script></body></html>',
].join('\n');

/** A fill part's body: three blocks of the mosaic vocabulary. */
const FILL_BODY = {
    v: 1,
    look: 'editorial',
    blocks: [
        { id: 'top', component: 'hero', props: { title: '<App name>', sub: '<One line on what it is>' } },
        { id: 'items', component: 'list', props: { source: '<prefix>.items' }, span: 'main' },
        { id: 'kpis', component: 'statRow', props: { source: '<prefix>.stats' }, span: 'side' },
    ],
};

/** A complete data map, from e2e-data-map.ts. */
const GOOD_MAP = {
    spec: 'aimeat.datamap/2',
    what: `A shared book ${TAG}.`,
    usedFor: 'Keeping everyone looking at the same list.',
    form: 'group',
    arrangement: 'One workspace inside the team organism.',
    machinery: [],
    leaves: [],
    held: [{
        what: 'book.entries', holds: 'the entries', kind: 'register', usedFor: 'to-share-with-others',
        where: 'organism-workspace', whereExactly: 'org/ws-test/book', owner: 'organism',
        readers: 'organism-members', writers: ['person-in-the-ui'], shape: 'collection-under-one-key',
        keptFor: 'until-deleted', lossRisk: 'only-copy', personalData: 'no',
        why: 'The book belongs to the team, not to whoever typed the entry.',
    }],
    elsewhere: [],
};

let A!: RegisteredOwner, B!: RegisteredOwner;
let aAgent!: McpAgent, aOther!: McpAgent;
let aS!: McpSession, aOtherS!: McpSession, bS!: McpSession, aReadlessS!: McpSession;
const aApp = `mma${TAG}.html`;
const bApp = `mmb${TAG}.html`;
const PART = `mcp-fill-${TAG}`;

async function publish(o: RegisteredOwner, filename: string): Promise<void> {
    const r = await json('/v1/apps', {
        method: 'POST', headers: auth(o),
        body: JSON.stringify({ filename, mime_type: 'text/html', content: Buffer.from(APP(filename)).toString('base64'), name: 'Misc', description: 'MCP misc tools test app.' }),
    });
    assert(r.status === 201, `publish ${filename}: ${r.status} ${JSON.stringify(r.body?.error)}`);
}

/** How many blocks the app's adopted layout holds, read over REST (0 when it has none). */
async function layoutBlocks(o: RegisteredOwner, filename: string): Promise<number> {
    const ui = await json(`/v1/apps/${o.name}/${filename}/ui`);
    return ui.status === 200 ? (ui.body.data.layout?.blocks?.length ?? 0) : 0;
}

console.log('\n=== MCP memory and misc tools: called and refused ===\n');

await test('Setup: two owners, their agents, and an app of each', async () => {
    A = await registerOwner(BASE, `mmaa${TAG}`);
    B = await registerOwner(BASE, `mmbb${TAG}`);
    aAgent = await makeAgent(BASE, A, WORDS);
    aOther = await makeAgent(BASE, A, WORDS);
    aS = await openSession(BASE, aAgent.token, 'mm-a');
    aOtherS = await openSession(BASE, aOther.token, 'mm-a2');
    bS = await openSession(BASE, (await makeAgent(BASE, B, WORDS)).token, 'mm-b');
    aReadlessS = await openSession(BASE, (await makeAgent(BASE, A, ['messages:send'])).token, 'mm-a-readless');
    await publish(A, aApp);
    await publish(B, bApp);
    assert(aAgent.gaii.endsWith(`#${A.name}@${aAgent.gaii.split('@')[1]}`) && aOther.gaii !== aAgent.gaii, `two agents of A: ${aAgent.gaii} ${aOther.gaii}`);
});

// ── Memory ───────────────────────────────────────────────────────────────────────────────────

const BIN_KEY = `notes.binprobe${TAG}`;
await test('aimeat_memory_restore: another owner\'s agent cannot put A\'s agent\'s binned record back; A\'s agent can', async () => {
    const w = await callTool(aS, 'aimeat_memory_write', { key: BIN_KEY, value: { n: 1, word: 'kept' } });
    assert(!w.isError, `write: ${w.text}`);
    const d = await callTool(aS, 'aimeat_memory_delete', { key: BIN_KEY });
    assert(!d.isError && d.data.deleted === true, `delete: ${d.text}`);
    const gone = await callTool(aS, 'aimeat_memory_read', { key: BIN_KEY });
    assert(gone.isError, `the binned record still reads: ${gone.text}`);

    const refused = await callTool(bS, 'aimeat_memory_restore', { key: BIN_KEY });
    assert(refused.offered && refused.isError && refused.data.error === 'NOT_RESTORABLE', `B's agent restored A's agent's record: ${refused.text}`);
    const stillGone = await callTool(aS, 'aimeat_memory_read', { key: BIN_KEY });
    assert(stillGone.isError, `the refused restore brought it back: ${stillGone.text}`);

    const r = await callTool(aS, 'aimeat_memory_restore', { key: BIN_KEY });
    assert(!r.isError && r.data.restored === true, `restore: ${r.text}`);
    const back = await callTool(aS, 'aimeat_memory_read', { key: BIN_KEY });
    assert(!back.isError && JSON.stringify(back.data).includes('kept'), `the record came back whole: ${back.text}`);
});

await test('aimeat_memory_restore: owner_scope on the owner\'s own binned record is refused without memory:write-as-owner', async () => {
    const key = `notes.ownerbin${TAG}`;
    const w = await json('/v1/memory', { method: 'POST', headers: auth(A), body: JSON.stringify({ key, value: { owner: 'wrote this' }, visibility: 'private' }) });
    assert(w.status === 201, `owner write: ${w.status} ${JSON.stringify(w.body?.error)}`);
    const d = await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'DELETE', headers: auth(A) });
    assert(d.status === 200, `owner delete: ${d.status}`);
    // The bin answers the same refusal for "never deleted", "not yours to reach" and "gone for good"
    // (services/memory-bin.ts restoreMemoryRecord), as POST /v1/memory/:key/restore answers 404.
    const refused = await callTool(aS, 'aimeat_memory_restore', { key, owner_scope: true });
    assert(refused.isError && refused.data.error === 'NOT_RESTORABLE', `the agent restored the owner's record without the word: ${refused.text}`);
    const still = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: auth(A) });
    assert(still.status === 404, `the owner's record came back: ${still.status}`);
});

await test('aimeat_memory_hands: A\'s agent sees who wrote its key; B\'s agent sees no hands on it; an agent without memory:read is not offered it', async () => {
    const key = `notes.hands${TAG}`;
    for (let i = 0; i < 2; i++) {
        const w = await callTool(aS, 'aimeat_memory_write', { key, value: { i } });
        assert(!w.isError, `write ${i}: ${w.text}`);
    }
    // The first sighting of a (key, writer) pair is written through at once as a floating promise,
    // and the counts after it are buffered for up to 15 s (services/data-map/write-tally-buffer.ts),
    // so this waits for the hand to exist and asserts the hand, not the count.
    let r = await callTool(aS, 'aimeat_memory_hands', { key });
    for (let i = 0; i < 20 && !r.isError && !(r.data.hands ?? []).some((h: any) => h.writer === aAgent.gaii); i++) {
        await new Promise((res) => setTimeout(res, 500));
        r = await callTool(aS, 'aimeat_memory_hands', { key });
    }
    assert(!r.isError && Array.isArray(r.data.hands), `hands: ${r.text}`);
    const mine = r.data.hands.find((h: any) => h.writer === aAgent.gaii);
    assert(mine && mine.writes >= 1, `A's agent is not named as a hand on its own key: ${r.text}`);
    assert(Array.isArray(r.data.not_covered), 'the answer says what it does not cover');

    const theirs = await callTool(bS, 'aimeat_memory_hands', { key });
    assert(!theirs.isError && theirs.data.hands.length === 0, `B's agent sees hands on A's key: ${theirs.text}`);
    const refused = await callTool(aReadlessS, 'aimeat_memory_hands', { key });
    assert(refused.isError && !refused.offered, `an agent without memory:read read the hands: ${refused.text}`);
});

// ── Data map ─────────────────────────────────────────────────────────────────────────────────

await test('aimeat_datamap_set: B\'s agent cannot state A\'s app\'s map; A\'s agent states it', async () => {
    const refused = await callTool(bS, 'aimeat_datamap_set', { app: `${A.name}/${aApp}`, data_map: { ...GOOD_MAP, what: 'B wrote this.' } });
    assert(refused.offered && refused.isError && /another account/.test(refused.text), `B's agent stated A's map: ${refused.text}`);
    const before = await json(`/v1/datamap/apps/${A.name}/${aApp}`, { headers: auth(A) });
    assert(!JSON.stringify(before.body).includes('B wrote this.'), 'B\'s map landed');

    const r = await callTool(aS, 'aimeat_datamap_set', { app: `${A.name}/${aApp}`, data_map: GOOD_MAP });
    assert(!r.isError && r.data.data_map?.what === GOOD_MAP.what, `set: ${r.text.slice(0, 300)}`);
    const after = await json(`/v1/datamap/apps/${A.name}/${aApp}`, { headers: auth(A) });
    assert(after.status === 200 && JSON.stringify(after.body).includes(GOOD_MAP.what), `the map read back: ${after.status}`);
});

await test('aimeat_datamap_get: an app that does not exist is refused; A\'s agent reads the map with its findings, B\'s agent without them', async () => {
    const refused = await callTool(aS, 'aimeat_datamap_get', { app: `${A.name}/no-such-app-${TAG}.html` });
    assert(refused.offered && refused.isError && /No app/.test(refused.text), `a missing app answered: ${refused.text}`);
    const r = await callTool(aS, 'aimeat_datamap_get', { app: `${A.name}/${aApp}` });
    assert(!r.isError && r.data.data_map?.what === GOOD_MAP.what && Array.isArray(r.data.findings), `get: ${r.text.slice(0, 300)}`);
    const theirs = await callTool(bS, 'aimeat_datamap_get', { app: `${A.name}/${aApp}` });
    assert(!theirs.isError && theirs.data.data_map?.what === GOOD_MAP.what, `B's agent reads the public map: ${theirs.text.slice(0, 200)}`);
    assert(theirs.data.findings === undefined && theirs.data.stamp?.gap === undefined, `B's agent got A's findings: ${theirs.text.slice(0, 300)}`);
});

// ── Design Book ──────────────────────────────────────────────────────────────────────────────

await test('aimeat_designbook_propose: A\'s agent proposes a part; B\'s agent cannot take its id', async () => {
    const r = await callTool(aS, 'aimeat_designbook_propose', { part: { id: PART, kind: 'fill', title: 'MCP fill', summary: 'A cover over a list with side counts, proposed over MCP.', body: FILL_BODY } });
    assert(!r.isError && r.data.status === 'proposed', `propose: ${r.text.slice(0, 300)}`);
    const read = await json(`/v1/designbook/${PART}`, { headers: auth(A) });
    assert(read.status === 200 && read.body.data.part.title === 'MCP fill', `the part reads back: ${read.status}`);

    const refused = await callTool(bS, 'aimeat_designbook_propose', { part: { id: PART, kind: 'fill', title: 'Taken', summary: 'Trying to take the address over MCP.', body: FILL_BODY } });
    assert(refused.offered && refused.isError && /^ID_TAKEN/.test(refused.text), `B's agent took the id: ${refused.text}`);
    const still = await json(`/v1/designbook/${PART}`, { headers: auth(A) });
    assert(still.body.data.part.title === 'MCP fill', `the part changed: ${JSON.stringify(still.body.data.part.title)}`);
});

await test('aimeat_designbook_adopt: B\'s agent cannot adopt A\'s unpublished part; A\'s agent adopts it into A\'s app', async () => {
    const refused = await callTool(bS, 'aimeat_designbook_adopt', { id: PART, filename: bApp });
    assert(refused.offered && refused.isError && /^NOT_PUBLISHED/.test(refused.text), `B's agent adopted an unpublished part: ${refused.text}`);
    assert(await layoutBlocks(B, bApp) === 0, 'B\'s app holds the layout after the refusal');

    const r = await callTool(aS, 'aimeat_designbook_adopt', { id: PART, filename: aApp });
    assert(!r.isError && r.data.kind === 'fill', `adopt: ${r.text.slice(0, 300)}`);
    assert(await layoutBlocks(A, aApp) === 3, 'A\'s app does not hold the adopted layout');
});

// ── Contacts ─────────────────────────────────────────────────────────────────────────────────

await test('aimeat_contact_remove: B\'s agent removes nothing from A\'s book; A\'s agent removes the contact', async () => {
    const saved = await callTool(aS, 'aimeat_contact_add', { contact_id: B.name });
    assert(!saved.isError && typeof saved.data.contact_id === 'string', `save: ${saved.text}`);
    const id = saved.data.contact_id as string;
    const book = async (): Promise<any[]> => {
        const r = await json('/v1/contacts', { headers: auth(A) });
        assert(r.status === 200, `contacts read: ${r.status}`);
        return r.body.data.contacts as any[];
    };
    assert((await book()).some((c) => c.contact_id === id && c.origin === 'saved'), `the contact is in A's book: ${id}`);

    const refused = await callTool(bS, 'aimeat_contact_remove', { contact_id: id });
    assert(refused.offered && refused.isError && /No such contact|NOT_FOUND/.test(refused.text), `B's agent removed from A's book: ${refused.text}`);
    assert((await book()).some((c) => c.contact_id === id && c.origin === 'saved'), 'the contact left A\'s book after B\'s refusal');

    const r = await callTool(aS, 'aimeat_contact_remove', { contact_id: id });
    assert(!r.isError && r.data.status === 'removed', `remove: ${r.text}`);
    assert(!(await book()).some((c) => c.contact_id === id && c.origin === 'saved'), 'the contact is still in A\'s book');
});

// ── Messages ─────────────────────────────────────────────────────────────────────────────────

let threadId = '';
await test('aimeat_message_inbox: the agent the owner wrote to reads the message; the owner\'s other agent does not', async () => {
    const sent = await json(`/v1/agents/${aAgent.name}/messages`, {
        method: 'POST', headers: auth(A), body: JSON.stringify({ direction: 'inbound', content: `Please file the report ${TAG}.` }),
    });
    assert(sent.status === 201, `owner sends: ${sent.status} ${JSON.stringify(sent.body?.error)}`);
    threadId = sent.body.data.message.threadId;
    const r = await callTool(aS, 'aimeat_message_inbox', {});
    assert(!r.isError && r.data.pending_messages.some((m: any) => m.thread_id === threadId && m.content.includes(TAG)), `inbox: ${r.text.slice(0, 300)}`);
    const other = await callTool(aOtherS, 'aimeat_message_inbox', {});
    assert(!other.isError && !other.text.includes(TAG) && other.data.count === 0, `the other agent read the message: ${other.text.slice(0, 300)}`);
});

await test('aimeat_message_history: the agent reads its thread; the other agent given the thread id reads nothing; per_page over 100 is refused by the input schema', async () => {
    const reply = await callTool(aS, 'aimeat_message_send', { content: `Filed ${TAG}.`, thread_id: threadId });
    assert(!reply.isError, `reply: ${reply.text}`);
    const r = await callTool(aS, 'aimeat_message_history', { thread_id: threadId });
    assert(!r.isError && r.data.messages.length === 2, `history: ${r.text.slice(0, 300)}`);
    assert(r.data.messages[0].direction === 'inbound' && r.data.messages[1].direction === 'outbound', `oldest first: ${r.text.slice(0, 300)}`);
    const other = await callTool(aOtherS, 'aimeat_message_history', { thread_id: threadId });
    assert(!other.isError && other.data.messages.length === 0 && !other.text.includes(TAG), `the other agent read the thread: ${other.text.slice(0, 300)}`);
    const tooMany = await callTool(aS, 'aimeat_message_history', { thread_id: threadId, per_page: 101 });
    assert(tooMany.isError, `per_page 101 was accepted: ${tooMany.text.slice(0, 200)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
