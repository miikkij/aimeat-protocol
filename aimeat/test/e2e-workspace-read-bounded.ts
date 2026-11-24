/**
 * @file e2e-workspace-read-bounded.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E: aimeat_workspace_read answers inside the size of one tool answer at the size
 *   production has, and nothing is lost by the limit.
 *
 *   WHY THIS EXISTS. On 2026-11-24 a workspace of 1040 records answered aimeat_workspace_read with a
 *   375 kB index, and a batch-open of 60 records with 171 kB. A client accepts about 50 kB in one
 *   answer, so every such read ended in a file the agent then had to parse. Every functional suite
 *   was green, because a test workspace holds a handful of records: the size of the answer grows
 *   with the data and only production had the data. This suite seeds a workspace of that size, with
 *   ids and titles as long as production's, and reads it over MCP.
 *
 *   What it proves:
 *     - the index of WISHES + BRIEFS records is one answer of at most TOOL_ANSWER_BUDGET_CHARS, shows
 *       one page per space, and says in `counts` and `page.more` what it did not show;
 *     - aimeat_workspace_overview, the same index as a Markdown map, is inside the budget as well
 *       (it listed every entry until this suite was written);
 *     - paging one space with `space` and `cursor` reaches every record once, each page inside the
 *       budget, also when the page asked for is larger than the budget allows;
 *     - `q` finds one record by its title in one call;
 *     - a batch-open of 60 records stops at the budget, names the rest in `not_opened`, and asking
 *       for those ids continues until every record was opened once, in the order asked. Every seeded
 *       value carries a long run of one letter, which the content risk rules mark as an encoded
 *       block, so each opened record also carries a mark of 1.7 kB: the budget holds with the marks;
 *     - refused: a cursor this read did not give, a cursor without its space, a space the workspace
 *       does not have (INVALID_INPUT), and over REST a limit that is not a number (400);
 *     - GET .../workspace/index without the bounded parameters still answers with every entry, the
 *       read a page of the web app and the extension sandbox make, and with bounded=true the page;
 *     - the usage report of the person names the tool with the size of its largest answer, inside
 *       the budget, and no answer over it.
 *
 *   The seed goes straight into the server's database (setMemory): a thousand writes over HTTP would
 *   measure the write path. The READ is the real MCP tool. On the in-memory backend the suite skips,
 *   since a second handle would open a different, empty database.
 *
 *   Runs against a live server (E2E_BASE, default http://localhost:40251).
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-read-bounded
 * @version-history
 *   2026-11-24 — Initial.
 */
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import type { Storage } from '../src/storage/interface.js';
import { TOOL_ANSWER_BUDGET_CHARS, ANSWER_PAGE_DEFAULT, ANSWER_PAGE_MAX } from '../src/models/answer-budget.js';
import { pinnedSqlitePath, serverDbUrl } from './helpers/server-db.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpSession } from './helpers/mcp-session.js';
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';

/** Production on 2026-11-24: 1040 wishes and 95 briefs in one workspace. */
const WISHES = Number(process.env.SCALE_WISHES ?? 1100);
const BRIEFS = Number(process.env.SCALE_BRIEFS ?? 120);
const WS = 'wsbounded';
/** An index entry of the production workspace was about 240 characters: a slug id and a sentence. */
const idOf = (space: string, i: number): string => `${space}-a-request-written-as-its-own-sentence-number-${String(i).padStart(4, '0')}`;
const titleOf = (space: string, i: number): string => `${space} ${i}: a title as long as the ones a person writes when they ask for something`;
const NEEDLE = 777;
const NEEDLE_TITLE = 'Heliotrope: the one record a session is looking for';

console.log('\n=== AIMEAT Workspace Read Inside One Tool Answer E2E Test ===\n');

const provider = (process.env.AIMEAT_STORAGE ?? process.env.AIMEAT_DB ?? 'sqlite') as StorageProvider;
const sqlitePath = pinnedSqlitePath();
const dbUrl = serverDbUrl();
if (!((provider === 'sqlite' && sqlitePath) || (provider === 'postgres-kysely' && dbUrl))) {
    console.log(`  ⏭  skipped: the ${provider} backend keeps its data inside the server process`);
    console.log(`\n📊 Results: 0 passed, 0 failed, 1 skipped\n`);
    process.exit(0);
}

const name = `bounded${Date.now() % 1_000_000}`;
let owner!: Awaited<ReturnType<typeof registerOwner>>;
let orgId = '';
let session!: McpSession;
let storage!: Storage;
const keys: string[] = [];

const auth = (): Record<string, string> => ({ Authorization: `Bearer ${owner.token}` });
const read = (args: Record<string, unknown> = {}) => callTool(session, 'aimeat_workspace_read', { organism_id: orgId, ws: WS, ...args });

await test('Setup: an owner, an organism and a workspace with two record spaces', async () => {
    owner = await registerOwner(BASE, name);
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Bounded Org', type: 'project', join_policy: 'invite', visibility: 'private' }) });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body.error)}`);
    orgId = o.body.data.organism.id;
    const ts = new Date().toISOString();
    await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Wish bucket', createdAt: ts, createdBy: name }] }, visibility: 'private' }) });
    const space = (n: string) => ({ name: n, schemaRef: `schema:${n}@1`, namespace: `shared.${n}`, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: false });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Wish bucket', kind: 'project', status: 'active', objectTypes: [space('wish'), space('brief')] };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(), body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
    // The reader is the person's own agent with the one word the tool asks, as a connected AI is.
    const agent = await makeAgent(BASE, owner, ['organism:read']);
    session = await openSession(BASE, agent.token, 'workspace-read-bounded');
});

await test(`Seed: ${WISHES} wishes and ${BRIEFS} briefs, each changed at its own second`, async () => {
    storage = await createStorage({ provider, sqlitePath, dbUrl });
    const base = Date.parse('2026-11-24T12:00:00.000Z');
    const seed = async (spaceName: string, count: number) => {
        for (let i = 0; i < count; i++) {
            // Record 0 is the newest, so the index order is the seeding order.
            const at = new Date(base - i * 1000).toISOString();
            const id = idOf(spaceName, i);
            const key = `organism.${orgId}.w.${WS}.shared.${spaceName}.${id}.latest`;
            keys.push(key);
            await storage.setMemory({
                key, ownerGaii: owner.ghii, visibility: 'private', tags: [], ttlHours: null,
                version: 1, createdAt: at, updatedAt: at,
                // About the size of a production wish (2 to 4 kB).
                value: { id, title: spaceName === 'wish' && i === NEEDLE ? NEEDLE_TITLE : titleOf(spaceName, i), status: i % 3 === 0 ? 'done' : 'new', ask: 'a'.repeat(1600), notes: 'n'.repeat(900) },
            });
        }
    };
    await seed('wish', WISHES);
    await seed('brief', BRIEFS);
});

await test('The index is one answer inside the budget: one page per space, and what is left is named', async () => {
    const r = await read();
    assert(!r.isError, `index: ${r.text.slice(0, 300)}`);
    assert(r.text.length <= TOOL_ANSWER_BUDGET_CHARS, `the index is ${r.text.length} characters, over the ${TOOL_ANSWER_BUDGET_CHARS} of one answer`);
    const d = r.data;
    assert(d.mode === 'index', `mode ${d.mode}`);
    assert(d.counts.wish === WISHES && d.counts.brief === BRIEFS, `counts hold the totals: ${JSON.stringify(d.counts)}`);
    assert(d.index.wish.length === ANSWER_PAGE_DEFAULT, `wish shows ${d.index.wish.length}, expected ${ANSWER_PAGE_DEFAULT}`);
    assert(d.index.wish[0].id === idOf('wish', 0), `the newest wish is first: ${d.index.wish[0].id}`);
    assert(d.page.shown.wish === ANSWER_PAGE_DEFAULT && d.page.limit === ANSWER_PAGE_DEFAULT, `page: ${JSON.stringify(d.page).slice(0, 300)}`);
    assert(d.page.more.wish.remaining === WISHES - ANSWER_PAGE_DEFAULT, `wish has ${d.page.more.wish.remaining} left`);
    assert(typeof d.page.more.wish.next_cursor === 'string' && d.page.more.wish.next_cursor.length > 0, 'wish has no next_cursor');
    // Both spaces together: what brief shows and what it has left add up to all of it.
    assert(d.page.shown.brief + (d.page.more.brief?.remaining ?? 0) === BRIEFS, `brief: ${JSON.stringify(d.page)}`);
    assert(/next_cursor/.test(d.hint), `the hint says how to read on: ${d.hint}`);
});

await test('The Markdown map of the workspace is inside the budget too, and says what it left and how to read it', async () => {
    const r = await callTool(session, 'aimeat_workspace_overview', { organism_id: orgId, ws: WS });
    assert(!r.isError, `overview: ${r.text.slice(0, 300)}`);
    assert(r.text.length <= TOOL_ANSWER_BUDGET_CHARS, `the map is ${r.text.length} characters, over the ${TOOL_ANSWER_BUDGET_CHARS} of one answer`);
    assert(r.text.includes(`${ANSWER_PAGE_DEFAULT} of ${WISHES} shown`), `the map says how many of the wishes it shows: ${r.text.slice(0, 400)}`);
    assert(r.text.includes(idOf('wish', 0)) && !r.text.includes(idOf('wish', ANSWER_PAGE_DEFAULT)), 'the map lists the newest entries and stops at the page');
    assert(/aimeat_workspace_read/.test(r.text) && /cursor/.test(r.text), 'the map says how to read the rest');
});

await test(`Paging one space reaches all ${WISHES} records once, each page inside the budget`, async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
        // The largest page a caller may ask for: at this entry size it is over the budget, so the
        // budget cuts it and the cursor continues from where the answer stopped.
        const r = await read({ space: 'wish', limit: ANSWER_PAGE_MAX, ...(cursor ? { cursor } : {}) });
        assert(!r.isError, `page ${pages}: ${r.text.slice(0, 300)}`);
        assert(r.text.length <= TOOL_ANSWER_BUDGET_CHARS, `page ${pages} is ${r.text.length} characters`);
        assert(r.data.index.brief === undefined, 'a page of one space shows that space alone');
        const entries = r.data.index.wish as Array<{ id: string }>;
        assert(entries.length > 0, `page ${pages} is empty with ${WISHES - seen.length} records left`);
        for (const e of entries) seen.push(e.id);
        pages++;
        cursor = r.data.page.more.wish?.next_cursor;
        if (!cursor) break;
        assert(pages < 100, 'paging does not end');
    }
    assert(seen.length === WISHES, `read ${seen.length} entries, expected ${WISHES}`);
    assert(new Set(seen).size === WISHES, 'an entry came twice');
    assert(seen.every((id, i) => id === idOf('wish', i)), 'the pages are in the index order, newest first');
    console.log(`     ${pages} pages`);
});

await test('`q` finds one record by its title in one call', async () => {
    const r = await read({ q: 'heliotrope' });
    assert(!r.isError, `q: ${r.text.slice(0, 300)}`);
    assert(r.data.page.matched.wish === 1 && r.data.page.matched.brief === 0, `matched: ${JSON.stringify(r.data.page.matched)}`);
    assert(r.data.index.wish.length === 1 && r.data.index.wish[0].id === idOf('wish', NEEDLE), `found: ${JSON.stringify(r.data.index.wish).slice(0, 200)}`);
    // The totals stay the workspace's, whatever the filter.
    assert(r.data.counts.wish === WISHES, `counts under q: ${JSON.stringify(r.data.counts)}`);
});

await test('A batch-open of 60 records stops at the budget and names the rest; asking again opens them all once', async () => {
    const asked = Array.from({ length: 60 }, (_, i) => idOf('wish', i * 7));
    const opened: string[] = [];
    let ids = asked;
    let calls = 0;
    while (ids.length) {
        const r = await read({ ids, space: 'wish' });
        assert(!r.isError, `open: ${r.text.slice(0, 300)}`);
        // The ids left over are part of the answer, so they are inside the budget as well.
        assert(r.text.length <= TOOL_ANSWER_BUDGET_CHARS, `call ${calls} is ${r.text.length} characters`);
        const got = (r.data.items as Array<{ id: string; value: { ask: string } }>);
        assert(got.length > 0, 'a call opened nothing');
        assert(got.every(it => it.value.ask.length === 1600), 'an opened record carries its whole value');
        for (const it of got) opened.push(it.id);
        const rest = (r.data.not_opened ?? []) as string[];
        assert(got.length + rest.length === ids.length, `opened ${got.length} and left ${rest.length} of ${ids.length}`);
        assert(rest.every((id, i) => id === ids[got.length + i]), 'not_opened is the rest of what was asked, in order');
        if (rest.length) assert(typeof r.data.not_opened_note === 'string', 'not_opened comes with its note');
        ids = rest;
        calls++;
        assert(calls < 30, 'the batch does not end');
    }
    assert(calls > 1, `60 records of 2.6 kB do not fit one answer, yet one call opened them all`);
    assert(opened.length === asked.length && opened.every((id, i) => id === asked[i]), 'every record opened once, in the order asked');
    console.log(`     ${calls} calls`);
});

await test('Refused: a cursor this read did not give, a cursor without its space, a space that does not exist', async () => {
    const bad = await read({ space: 'wish', cursor: 'not-a-cursor' });
    assert(bad.isError && /next_cursor/.test(bad.text), `a made-up cursor: ${bad.text.slice(0, 200)}`);
    const first = await read();
    const noSpace = await read({ cursor: first.data.page.more.wish.next_cursor });
    assert(noSpace.isError && /space/.test(noSpace.text), `a cursor without space: ${noSpace.text.slice(0, 200)}`);
    const unknown = await read({ space: 'nosuchspace' });
    assert(unknown.isError && /nosuchspace/.test(unknown.text) && /wish/.test(unknown.text), `an unknown space names the real ones: ${unknown.text.slice(0, 200)}`);
});

await test('REST: the index without the bounded parameters is whole; with bounded=true it is the page', async () => {
    const whole = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}`, { headers: auth() });
    assert(whole.status === 200, `whole ${whole.status}`);
    assert(whole.body.data.index.wish.length === WISHES && whole.body.data.page === undefined, `the whole read lists every entry: ${whole.body.data.index.wish.length}`);
    const paged = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}&bounded=true`, { headers: auth() });
    assert(paged.status === 200 && paged.body.data.index.wish.length === ANSWER_PAGE_DEFAULT, `bounded=true: ${paged.status} ${paged.body.data?.index?.wish?.length}`);
    assert(paged.body.data.page.more.wish.remaining === WISHES - ANSWER_PAGE_DEFAULT, 'bounded=true names what is left');
    const ten = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}&space=brief&limit=10`, { headers: auth() });
    assert(ten.status === 200 && ten.body.data.index.brief.length === 10 && ten.body.data.index.wish === undefined, `limit=10 of one space: ${ten.status}`);
    expectRefusal(await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}&limit=many`, { headers: auth() }), 400, 'INVALID_INPUT');
    expectRefusal(await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}&space=wish&cursor=not-a-cursor`, { headers: auth() }), 400, 'INVALID_INPUT');
});

await test('The usage report names the tool with the size of its largest answer, and none over the budget', async () => {
    const r = await json('/v1/usage/summary?report=tool', { headers: auth() });
    assert(r.status === 200, `usage ${r.status}: ${JSON.stringify(r.body.error)}`);
    const tool = (r.body.data.groups as Array<Record<string, any>>).find(g => g.dims?.coordinate === 'aimeat_workspace_read');
    assert(tool, `no row for aimeat_workspace_read: ${JSON.stringify(r.body.data.groups.map((g: any) => g.key))}`);
    assert(tool.answer_chars_max > 10_000, `the largest answer was measured: ${tool.answer_chars_max}`);
    assert(tool.answer_chars_max <= TOOL_ANSWER_BUDGET_CHARS, `the largest answer is ${tool.answer_chars_max} characters`);
    assert(tool.answers_over_budget === 0, `${tool.answers_over_budget} answer(s) over the budget`);
    assert(tool.answer_chars_avg > 0 && tool.answer_chars_avg <= tool.answer_chars_max, `average ${tool.answer_chars_avg}`);
    console.log(`     aimeat_workspace_read: ${tool.calls} calls, largest ${tool.answer_chars_max}, average ${tool.answer_chars_avg}, over the budget ${tool.answers_over_budget}`);
});

await test('Cleanup: the seeded records are removed', async () => {
    for (const key of keys) await storage.deleteMemory(owner.ghii, key);
    await storage.close?.();
});

finish();
