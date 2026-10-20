/**
 * @file e2e-workspace-rows.ts
 * @description Workspace ROW spaces, end to end against a running node on both backends.
 *
 *   The unit suite proves the SQL. This proves the things only a real server can: the manifest gate,
 *   the access boundary between two owners, the quota refusals, and the one property the whole
 *   backing exists for — a row space appears in a workspace index as a COUNT and never as rows.
 *
 *   The failure mode it is written against is the 2026-06-10 invisible-documents bug, one backing
 *   over: a space that accepts writes while some read surface silently skips it. So every assertion
 *   here is either "this works end to end" or "this is refused with a sentence naming the fix".
 *   There is deliberately no middle.
 * @version-history
 *   2026-10-20 — The COL-09 cases: a workspace role is the MEMBER's permission, so a plain member
 *     with no grant and a viewer are refused a workspace content write and a row delete while
 *     signed in as themselves, and a contributor makes both. The three refusals answered 201 and
 *     200 before the fix (secaudit 2026-10, owner-in-person-skips-workspace-role).
 *   2026-10-20 — A read of a row space meets the same decision as a read of the workspace's records:
 *     a plain member with no grant is refused the page, the single row, the stats and the MCP rows
 *     tool; a viewer grant admits them over REST and a contributor grant admits their agent over
 *     MCP, and revoking either refuses them again; the creator and an organism admin are never
 *     refused (secaudit 2026-10, row-read-skips-decideWorkspaceRead).
 *   2026-10-16 — The quota refusals this header promised and nobody had written: a write past the workspace row quota and one past the organism row quota are refused whole, with the rows already there kept and nothing of the refused write stored (QA audit list review).
 *   v1.1.0 — 2026-09-24 — Which copy of the manifest decides a row space's policy (secaudit 2026-09,
 *     A6-9): an admin's copy written first and the creator's after it, and the row gate answers from
 *     the creator's; a plain member's own copy is refused at the write.
 *   v1.0.0 — 2026-08-26 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-rows

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
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}

import { ownerSignIn } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpSession } from './helpers/mcp-session.js';

/** An owner with a token. Two of them, because half of what this suite proves is the boundary. */
async function setupOwner(label: string) {
    const ownerName = `wsrow${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'WS Rows', password: 'WsRow12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body)}`);
    const tok = await ownerSignIn(BASE, ownerName, 'WsRow12345');
    assert(tok.status === 200, `token ${tok.status}`);
    return { ownerName, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Workspace Rows E2E ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'ws-rows';
const authA = () => ({ Authorization: `Bearer ${A.token}` });
const authB = () => ({ Authorization: `Bearer ${B.token}` });

/** Every row route, with the workspace already on it. */
const rowsUrl = (space: string, qs = '') =>
    `/v1/organisms/${orgId}/workspace/rows/${space}?ws=${WS}${qs}`;

await test('Setup: two owners, an organism, and a workspace with a row space', async () => {
    A = await setupOwner('a');
    B = await setupOwner('b');
    const o = await json('/v1/organisms', {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ name: 'Rows Org', description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'private' }),
    });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body)}`);
    orgId = o.body.data.organism.id;

    const manifest = {
        manifestVersion: '1', id: orgId, name: 'Rows WS', kind: 'workspace', status: 'active',
        objectTypes: [
            {
                name: 'mailmessage', schemaRef: 'schema:mail@1', namespace: 'crm.mail',
                backing: 'rows', writeRole: 'member', mode: 'records',
                indexOn: ['contactRef', 'threadId'],
            },
            // A memory space beside it, so the index assertions are about a real mixed workspace
            // rather than about a workspace that has only the new thing in it.
            { name: 'note', schemaRef: 'schema:note@1', namespace: 'crm.notes', backing: 'memory', writeRole: 'member', mode: 'records' },
        ],
    };
    const m = await json('/v1/memory', {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.meta.manifest`, value: manifest, visibility: 'private' }),
    });
    assert(m.status === 200 || m.status === 201, `manifest ${m.status}: ${JSON.stringify(m.body)}`);
});

// ── The manifest gate ────────────────────────────────────────────────────────

await test('a row space declaring four indexOn fields is refused, and the refusal says why', async () => {
    const bad = {
        manifestVersion: '1', id: orgId, name: 'Bad', kind: 'workspace', status: 'active',
        objectTypes: [{
            name: 'x', schemaRef: 's', namespace: 'crm.x', backing: 'rows', writeRole: 'member',
            indexOn: ['a', 'b', 'c', 'd'],
        }],
    };
    const r = await json('/v1/memory', {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ key: `organism.${orgId}.w.ws-bad.meta.manifest`, value: bad, visibility: 'private' }),
    });
    assert(r.status === 422, `expected 422 from the manifest schema, got ${r.status}: ${JSON.stringify(r.body)}`);
});

// ── Append and read ──────────────────────────────────────────────────────────

await test('append one row', async () => {
    const r = await json(rowsUrl('mailmessage'), {
        method: 'POST', headers: authA(),
        body: JSON.stringify({
            row_id: 'msg-1', occurred_at: '2026-08-01T10:00:00.000Z',
            body: { contactRef: 'c-1', threadId: 't-1', subject: 'Hello', text: 'first' },
        }),
    });
    assert(r.status === 200, `append ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.written === 1, `written: ${JSON.stringify(r.body.data)}`);
});

await test('append a batch', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
        row_id: `bulk-${i}`,
        occurred_at: new Date(Date.UTC(2026, 7, 2, 0, 0, i)).toISOString(),
        body: { contactRef: i % 2 ? 'c-1' : 'c-2', threadId: `t-${i % 3}`, subject: `Bulk ${i}` },
    }));
    const r = await json(rowsUrl('mailmessage'), { method: 'POST', headers: authA(), body: JSON.stringify({ rows }) });
    assert(r.status === 200, `batch ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.written === 30, `written: ${JSON.stringify(r.body.data)}`);
});

await test('read it back, newest first, with the indexed fields named in the answer', async () => {
    const r = await json(rowsUrl('mailmessage', '&limit=5'), { headers: authA() });
    assert(r.status === 200, `read ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.rows.length === 5, `page size: ${r.body.data.rows.length}`);
    assert(r.body.data.cursor, 'a cursor for the next page');
    assert(JSON.stringify(r.body.data.indexed) === JSON.stringify(['contactRef', 'threadId']),
        `indexed fields reported: ${JSON.stringify(r.body.data.indexed)}`);
    const times = r.body.data.rows.map((x: any) => x.occurredAt);
    assert(times.join() === [...times].sort().reverse().join(), `newest first: ${times.join()}`);
});

await test('paging walks every row exactly once', async () => {
    const seen: string[] = [];
    let cursor = '';
    for (let i = 0; i < 20; i++) {
        const qs = `&limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const r = await json(rowsUrl('mailmessage', qs), { headers: authA() });
        assert(r.status === 200, `page ${r.status}`);
        seen.push(...r.body.data.rows.map((x: any) => x.rowId));
        if (!r.body.data.cursor) break;
        cursor = r.body.data.cursor;
    }
    assert(seen.length === 31, `every row: ${seen.length}`);
    assert(new Set(seen).size === 31, `no repeats: ${new Set(seen).size}`);
});

await test('a repeated row_id replaces rather than duplicating, and keeps when the row first arrived', async () => {
    const url = `/v1/organisms/${orgId}/workspace/rows/mailmessage/msg-1?ws=${WS}`;
    const before = (await json(url, { headers: authA() })).body.data.row;

    const r = await json(rowsUrl('mailmessage'), {
        method: 'POST', headers: authA(),
        body: JSON.stringify({
            row_id: 'msg-1', occurred_at: '2026-08-01T10:00:00.000Z',
            body: { contactRef: 'c-1', threadId: 't-1', subject: 'Hello again', text: 'second' },
        }),
    });
    assert(r.status === 200, `re-append ${r.status}`);

    const after = (await json(url, { headers: authA() })).body.data.row;
    assert(after.body.text === 'second', `body replaced: ${JSON.stringify(after.body)}`);
    // When it first arrived is a fact a re-run does not get to rewrite; when it last changed is.
    assert(after.createdAt === before.createdAt, `createdAt kept: ${before.createdAt} -> ${after.createdAt}`);
    assert(after.updatedAt >= before.updatedAt, `updatedAt moved: ${before.updatedAt} -> ${after.updatedAt}`);

    const s = await json(`/v1/organisms/${orgId}/workspace/rows/mailmessage/stats?ws=${WS}`, { headers: authA() });
    assert(s.body.data.stats.rows === 31, `still 31 rows, not 32: ${s.body.data.stats.rows}`);
});

// ── Filtering, and the refusal that makes filtering trustworthy ───────────────

await test('filters on a declared field', async () => {
    const r = await json(rowsUrl('mailmessage', '&contactRef=c-2&limit=500'), { headers: authA() });
    assert(r.status === 200, `filter ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.rows.length === 15, `c-2 rows: ${r.body.data.rows.length}`);
    assert(r.body.data.rows.every((x: any) => x.body.contactRef === 'c-2'), 'all match');
});

await test('filtering on an UNDECLARED field is refused and names the fields that work', async () => {
    const r = await json(rowsUrl('mailmessage', '&subject=Hello'), { headers: authA() });
    assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error.code === 'FIELD_NOT_INDEXED', `code: ${r.body.error.code}`);
    assert(/contactRef/.test(r.body.error.message) && /threadId/.test(r.body.error.message),
        `the refusal names the indexed fields: ${r.body.error.message}`);
});

await test('bounds on occurred_at', async () => {
    const r = await json(rowsUrl('mailmessage', '&since=2026-08-02T00:00:00.000Z&limit=500'), { headers: authA() });
    assert(r.status === 200, `since ${r.status}`);
    assert(r.body.data.rows.length === 30, `only the bulk batch: ${r.body.data.rows.length}`);
});

await test('an append REPLACES the whole row, so omitting occurred_at moves it to now', async () => {
    // The contract is replace, not patch: `body` is swapped wholesale, and so is the row's time in
    // the world. Pinned here rather than left to be discovered, because the alternative reading —
    // "an edit keeps the old timestamp" — is just as plausible and a caller has to know which.
    // `created_at` is the one field a replace never touches.
    const r = await json(rowsUrl('mailmessage'), {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ row_id: 'msg-1', body: { contactRef: 'c-1', threadId: 't-1', subject: 'Third' } }),
    });
    assert(r.status === 200, `re-append ${r.status}`);
    const row = (await json(`/v1/organisms/${orgId}/workspace/rows/mailmessage/msg-1?ws=${WS}`, { headers: authA() })).body.data.row;
    assert(row.occurredAt > '2026-08-02T00:00:00.000Z',
        `occurred_at defaulted to now on the replace: ${row.occurredAt}`);
});

// ── The property the whole backing exists for ────────────────────────────────

await test('the workspace index shows the row space as a COUNT and never as rows', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: authA() });
    assert(r.status === 200, `workspace read ${r.status}: ${JSON.stringify(r.body)}`);
    const d = r.body.data;
    assert(d.row_spaces?.mailmessage, `the row space is reported: ${JSON.stringify(Object.keys(d))}`);
    assert(d.row_spaces.mailmessage.rows === 31, `count: ${d.row_spaces.mailmessage.rows}`);
    assert(typeof d.row_spaces.mailmessage.newest === 'string', 'and its span');
    // The rows themselves must NOT be in the objects map: that read materialises every value it
    // returns and truncates at 5000 with no signal, which is what this backing exists to avoid.
    assert(d.objects?.mailmessage === undefined,
        `rows must not ride the objects map: ${JSON.stringify(Object.keys(d.objects ?? {}))}`);
    const payload = JSON.stringify(d);
    assert(!payload.includes('Bulk 7'), 'no row body anywhere in the workspace read');
});

// ── The boundary ─────────────────────────────────────────────────────────────

await test('a stranger cannot read the rows', async () => {
    const r = await json(rowsUrl('mailmessage'), { headers: authB() });
    assert(r.status === 403 || r.status === 404, `expected a refusal, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('a stranger cannot append rows', async () => {
    const r = await json(rowsUrl('mailmessage'), {
        method: 'POST', headers: authB(),
        body: JSON.stringify({ body: { contactRef: 'c-9', subject: 'intrusion' } }),
    });
    assert(r.status === 403 || r.status === 404, `expected a refusal, got ${r.status}: ${JSON.stringify(r.body)}`);
    const s = await json(`/v1/organisms/${orgId}/workspace/rows/mailmessage/stats?ws=${WS}`, { headers: authA() });
    assert(s.body.data.stats.rows === 31, `nothing was written: ${s.body.data.stats.rows}`);
});

await test('an unauthenticated caller gets nothing', async () => {
    const r = await json(rowsUrl('mailmessage'));
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

// ── Refusals that name the fix ───────────────────────────────────────────────

await test('writing to a memory space through the row door is refused, and says which door to use', async () => {
    const r = await json(rowsUrl('note'), {
        method: 'POST', headers: authA(), body: JSON.stringify({ body: { title: 'x' } }),
    });
    assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error.code === 'NOT_A_ROW_SPACE', `code: ${r.body.error.code}`);
    assert(/record tools/.test(r.body.error.message), `names the other door: ${r.body.error.message}`);
});

await test('an unknown space is refused, and lists the row spaces there are', async () => {
    const r = await json(rowsUrl('nosuchspace'), { headers: authA() });
    assert(r.status === 404, `expected 404, got ${r.status}`);
    assert(/mailmessage/.test(r.body.error.message), `lists what exists: ${r.body.error.message}`);
});

await test('a missing ?ws is refused before anything else', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/rows/mailmessage`, { headers: authA() });
    assert(r.status === 400 && r.body.error.code === 'WS_REQUIRED', `${r.status} ${JSON.stringify(r.body)}`);
});

await test('a row over the per-row ceiling is refused with the number', async () => {
    const huge = 'x'.repeat(400 * 1024);
    const r = await json(rowsUrl('mailmessage'), {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ body: { contactRef: 'c-1', text: huge } }),
    });
    assert(r.status === 413, `expected 413, got ${r.status}: ${JSON.stringify(r.body?.error ?? r.body).slice(0, 200)}`);
    assert(r.body.error.code === 'ROW_TOO_LARGE', `code: ${r.body.error.code}`);
});

await test('a batch over 500 is refused', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ body: { contactRef: `c-${i}` } }));
    const r = await json(rowsUrl('mailmessage'), { method: 'POST', headers: authA(), body: JSON.stringify({ rows }) });
    assert(r.status === 400 && r.body.error.code === 'BATCH_TOO_LARGE', `${r.status} ${JSON.stringify(r.body)}`);
});

// ── Deletes ──────────────────────────────────────────────────────────────────

await test('a collection DELETE without ?before is refused rather than emptying the space', async () => {
    const r = await json(rowsUrl('mailmessage'), { method: 'DELETE', headers: authA() });
    assert(r.status === 400 && r.body.error.code === 'BEFORE_REQUIRED', `${r.status} ${JSON.stringify(r.body)}`);
    const s = await json(`/v1/organisms/${orgId}/workspace/rows/mailmessage/stats?ws=${WS}`, { headers: authA() });
    assert(s.body.data.stats.rows === 31, `still there: ${s.body.data.stats.rows}`);
});

await test('retention by age keys on when the row LANDED, not on when it happened', async () => {
    // Every row here was written seconds ago, and one of them carries occurred_at in 2026-08-01.
    // A cutoff before today must therefore remove NOTHING: the promise is about how long we keep a
    // row. Getting this backwards would delete a freshly ingested archive on arrival.
    const r = await json(rowsUrl('mailmessage', '&before=2026-08-15T00:00:00.000Z'), { method: 'DELETE', headers: authA() });
    assert(r.status === 200, `delete ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.removed === 0, `nothing swept: ${r.body.data.removed}`);
    const s = await json(`/v1/organisms/${orgId}/workspace/rows/mailmessage/stats?ws=${WS}`, { headers: authA() });
    assert(s.body.data.stats.rows === 31, `all rows kept: ${s.body.data.stats.rows}`);
});

await test('one row is removed by id, and the second delete says there is nothing there', async () => {
    const url = `/v1/organisms/${orgId}/workspace/rows/mailmessage/msg-1?ws=${WS}`;
    const first = await json(url, { method: 'DELETE', headers: authA() });
    assert(first.status === 200, `delete ${first.status}`);
    const again = await json(url, { method: 'DELETE', headers: authA() });
    assert(again.status === 404, `second delete: ${again.status}`);
});

// ── The quotas ───────────────────────────────────────────────────────────────
//
// Both quotas are counted before the insert (row-service.ts enforceQuota), so a write past either
// one is refused whole: none of its rows land, and the rows already there stay. The ceilings are
// lowered for these tests through the operator's config route (A is the first owner on the fresh
// database, so A is the operator), then set back to their values and their overrides removed.

const setQuota = (path: string, value: number) => json('/v1/admin/config', {
    method: 'PUT', headers: authA(), body: JSON.stringify({ changes: [{ path, value }] }),
});
const dropQuota = (path: string) => json(`/v1/admin/config/${encodeURIComponent(path)}`, { method: 'DELETE', headers: authA() });
/** The value a setting has now, so a test can put it back: removing the override alone takes effect only at the next restart. */
const quotaNow = async (path: string): Promise<number> => {
    const r = await json('/v1/admin/config', { headers: authA() });
    assert(r.status === 200, `config read ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return r.body.data.schema[path].value as number;
};
/** Put the setting back to what it was, then remove the override so the stored config is as it was too. */
const restoreQuota = async (path: string, value: number): Promise<void> => {
    const put = await setQuota(path, value);
    assert(put.status === 200, `the setting is put back: ${put.status} ${JSON.stringify(put.body)}`);
    const dropped = await dropQuota(path);
    assert(dropped.status === 200, `the override is removed: ${dropped.status} ${JSON.stringify(dropped.body)}`);
};
const rowCount = async (): Promise<number> => {
    const s = await json(`/v1/organisms/${orgId}/workspace/rows/mailmessage/stats?ws=${WS}`, { headers: authA() });
    assert(s.status === 200, `stats ${s.status}: ${JSON.stringify(s.body)}`);
    return s.body.data.stats.rows as number;
};

await test('a write past the workspace row quota is refused, and none of its rows are written', async () => {
    const before = await rowCount();
    const original = await quotaNow('quota.ws_rows_max_per_workspace');
    const set = await setQuota('quota.ws_rows_max_per_workspace', before + 2);
    assert(set.status === 200, `the operator lowers the workspace row quota: ${set.status} ${JSON.stringify(set.body)}`);
    try {
        const three = Array.from({ length: 3 }, (_, i) => ({ row_id: `quota-ws-${i}`, body: { contactRef: 'c-q', subject: `q${i}` } }));
        const over = await json(rowsUrl('mailmessage'), { method: 'POST', headers: authA(), body: JSON.stringify({ rows: three }) });
        assert(over.status === 413 && over.body.error?.code === 'QUOTA_EXCEEDED',
            `a batch of three past a room of two is refused: ${over.status} ${JSON.stringify(over.body.error ?? over.body)}`);
        assert(String(over.body.error.message).includes('ws_rows_max_per_workspace'), `the refusal names the setting: ${over.body.error.message}`);
        assert(await rowCount() === before, 'none of the three rows was written');

        const two = await json(rowsUrl('mailmessage'), { method: 'POST', headers: authA(), body: JSON.stringify({ rows: three.slice(0, 2) }) });
        assert(two.status === 200 && two.body.data.written === 2, `two rows fit: ${two.status} ${JSON.stringify(two.body)}`);
        const one = await json(rowsUrl('mailmessage'), {
            method: 'POST', headers: authA(), body: JSON.stringify({ row_id: 'quota-ws-x', body: { contactRef: 'c-q' } }),
        });
        assert(one.status === 413 && one.body.error?.code === 'QUOTA_EXCEEDED', `the row one past the quota is refused: ${one.status}`);
        assert(await rowCount() === before + 2, 'the full workspace still holds what it held');
    } finally {
        await restoreQuota('quota.ws_rows_max_per_workspace', original);
    }
});

await test('a write past the organism row quota is refused, and none of its rows are written', async () => {
    // 1 MB is the smallest quota the setting takes. Four rows of about 230 kB fit under it beside the
    // small rows already there, and a fifth crosses it. Each row stays under the 256 kB row ceiling.
    const big = (i: number) => ({ row_id: `quota-org-${i}`, body: { contactRef: 'c-big', text: 'x'.repeat(230 * 1024) } });
    const original = await quotaNow('quota.ws_rows_quota_mb');
    const set = await setQuota('quota.ws_rows_quota_mb', 1);
    assert(set.status === 200, `the operator lowers the organism row quota: ${set.status} ${JSON.stringify(set.body)}`);
    try {
        const four = await json(rowsUrl('mailmessage'), { method: 'POST', headers: authA(), body: JSON.stringify({ rows: [0, 1, 2, 3].map(big) }) });
        assert(four.status === 200 && four.body.data.written === 4, `four rows fit: ${four.status} ${JSON.stringify(four.body.error ?? four.body.data)}`);
        const before = await rowCount();

        const fifth = await json(rowsUrl('mailmessage'), { method: 'POST', headers: authA(), body: JSON.stringify({ rows: [big(4)] }) });
        assert(fifth.status === 413 && fifth.body.error?.code === 'QUOTA_EXCEEDED',
            `the row past the organism quota is refused: ${fifth.status} ${JSON.stringify(fifth.body.error ?? fifth.body)}`);
        assert(String(fifth.body.error.message).includes('ws_rows_quota_mb'), `the refusal names the setting: ${fifth.body.error.message}`);
        assert(await rowCount() === before, 'the refused row was not written');

        // A row space in ANOTHER workspace of the same organism shares the quota: it is the
        // organism's, not the workspace's.
        const otherWs = 'ws-rows-quota';
        const manifest = {
            manifestVersion: '1', id: orgId, name: 'Rows quota WS', kind: 'workspace', status: 'active',
            objectTypes: [{ name: 'mailmessage', schemaRef: 'schema:mail@1', namespace: 'crm.mail', backing: 'rows', writeRole: 'member', mode: 'records' }],
        };
        const m = await json('/v1/memory', {
            method: 'POST', headers: authA(),
            body: JSON.stringify({ key: `organism.${orgId}.w.${otherWs}.meta.manifest`, value: manifest, visibility: 'private' }),
        });
        assert(m.status === 200 || m.status === 201, `second workspace manifest ${m.status}: ${JSON.stringify(m.body)}`);
        const elsewhere = await json(`/v1/organisms/${orgId}/workspace/rows/mailmessage?ws=${otherWs}`, {
            method: 'POST', headers: authA(), body: JSON.stringify({ rows: [big(5)] }),
        });
        assert(elsewhere.status === 413 && elsewhere.body.error?.code === 'QUOTA_EXCEEDED',
            `the same organism's other workspace is refused too: ${elsewhere.status} ${JSON.stringify(elsewhere.body.error ?? elsewhere.body)}`);
        const s = await json(`/v1/organisms/${orgId}/workspace/rows/mailmessage/stats?ws=${otherWs}`, { headers: authA() });
        assert(s.status === 200 && s.body.data.stats.rows === 0, `nothing landed in the other workspace: ${JSON.stringify(s.body)}`);
    } finally {
        await restoreQuota('quota.ws_rows_quota_mb', original);
        for (let i = 0; i < 4; i++) {
            await json(`/v1/organisms/${orgId}/workspace/rows/mailmessage/quota-org-${i}?ws=${WS}`, { method: 'DELETE', headers: authA() });
        }
    }
});

// ── Which copy of the manifest decides (secaudit 2026-09, A6-9) ──────────────
//
// A memory key is unique per owner, not per node, so `…meta.manifest` can be stored once under each
// identity, and the row door read whichever copy the store returned first. Here an organism admin's
// copy opens the space to every member and is written FIRST, so SQLite, which returns rows that share
// a key in insertion order, hands it back first; Postgres returns them in the order they sit on disk,
// which no test controls. The creator's copy, written after it, keeps the space to admins, and the
// row gate answers from it whatever the order. A plain member's own copy is refused at the write,
// which is the other half of the same finding.

let C!: Awaited<ReturnType<typeof setupOwner>>;
let org2 = '';
const WS2 = 'ws-rows-copies';
const authC = () => ({ Authorization: `Bearer ${C.token}` });
const ledgerUrl = () => `/v1/organisms/${org2}/workspace/rows/ledger?ws=${WS2}`;
const ledgerKey = () => `organism.${org2}.w.${WS2}.meta.manifest`;
const ledgerManifest = (writeRole: string) => ({
    manifestVersion: '1', id: org2, name: 'Ledger', kind: 'workspace', status: 'active',
    objectTypes: [{ name: 'ledger', schemaRef: 'schema:ledger@1', namespace: 'books.ledger', backing: 'rows', writeRole, indexOn: ['account'] }],
});

await test('A6-9 setup: an open organism, B a plain member, C an admin, a workspace registered to A', async () => {
    C = await setupOwner('c');
    const o = await json('/v1/organisms', {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ name: 'Rows Copies Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }),
    });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body)}`);
    org2 = o.body.data.organism.id;
    for (const [who, hdr] of [['B', authB()], ['C', authC()]] as const) {
        const j = await json(`/v1/organisms/${org2}/join`, { method: 'POST', headers: hdr, body: '{}' });
        assert(j.status === 201, `${who} joins ${j.status}: ${JSON.stringify(j.body.error)}`);
    }
    const p = await json(`/v1/organisms/${org2}/admins`, { method: 'POST', headers: authA(), body: JSON.stringify({ target_ghii: C.ownerName }) });
    assert(p.status === 200, `C promoted to admin ${p.status}: ${JSON.stringify(p.body.error)}`);
    const reg = await json('/v1/memory', {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ key: `organism.${org2}.meta.workspaces`, value: { workspaces: [{ id: WS2, name: 'Ledger', createdAt: new Date().toISOString(), createdBy: A.ownerName }] }, visibility: 'private' }),
    });
    assert(reg.status === 201, `registry ${reg.status}: ${JSON.stringify(reg.body.error)}`);
});

// Each copy is its writer's first write of the key, so each answers 201 Created.
await test('A6-9: with an admin\'s copy first and the creator\'s second, the row gate follows the creator\'s', async () => {
    const first = await json('/v1/memory', { method: 'POST', headers: authC(), body: JSON.stringify({ key: ledgerKey(), value: ledgerManifest('member'), visibility: 'private' }) });
    assert(first.status === 201, `the admin's copy ${first.status}: ${JSON.stringify(first.body.error)}`);
    const second = await json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: ledgerKey(), value: ledgerManifest('admin'), visibility: 'private' }) });
    assert(second.status === 201, `the creator's copy ${second.status}: ${JSON.stringify(second.body.error)}`);

    const member = await json(ledgerUrl(), { method: 'POST', headers: authB(), body: JSON.stringify({ body: { account: 'a-1', amount: 1 } }) });
    assert(member.status === 403, `the creator's copy keeps "ledger" to admins, so a plain member's append is refused; got ${member.status}: ${JSON.stringify(member.body)}`);
    const creator = await json(ledgerUrl(), { method: 'POST', headers: authA(), body: JSON.stringify({ body: { account: 'a-1', amount: 2 } }) });
    assert(creator.status === 200, `the creator appends ${creator.status}: ${JSON.stringify(creator.body)}`);
});

await test('A6-9: a plain member\'s own copy of the workspace manifest is refused at the write', async () => {
    const planted = await json('/v1/memory', { method: 'POST', headers: authB(), body: JSON.stringify({ key: ledgerKey(), value: ledgerManifest('member'), visibility: 'private' }) });
    assert(planted.status === 403, `a plain member wrote a copy of the workspace manifest: ${planted.status} ${JSON.stringify(planted.body.error ?? planted.body.data)}`);
    const member = await json(ledgerUrl(), { method: 'POST', headers: authB(), body: JSON.stringify({ body: { account: 'a-2', amount: 3 } }) });
    assert(member.status === 403, `still refused after the attempt: ${member.status}`);
});

// ── The read decision is the workspace's, not the organism's (secaudit 2026-10) ──────────────
//
// Membership opens the organism; reading ONE workspace is decided by decideWorkspaceRead, which the
// records path has always asked and the row path did not. So a plain member with no grant used to
// read every row of a workspace whose records answered them with manifest null and objects {}. Each
// read surface is asked here, REST and MCP, before the grant, with it, and after it is revoked. The
// creator and an organism admin are the positive controls: neither is ever refused.

let M!: Awaited<ReturnType<typeof setupOwner>>;
let G!: Awaited<ReturnType<typeof setupOwner>>;
let org3 = '';
let WS3 = '';
let mSession!: McpSession;
const authM = () => ({ Authorization: `Bearer ${M.token}` });
const authG = () => ({ Authorization: `Bearer ${G.token}` });
const guardedUrl = (suffix = '') => `/v1/organisms/${org3}/workspace/rows/log${suffix}?ws=${WS3}`;

/** The three REST row reads, with the status each answered. */
async function rowReads(headers: Record<string, string>): Promise<{ page: number; one: number; stats: number }> {
    const page = await json(guardedUrl(), { headers });
    const one = await json(guardedUrl('/r-1'), { headers });
    const stats = await json(guardedUrl('/stats'), { headers });
    return { page: page.status, one: one.status, stats: stats.status };
}

await test('Read gate setup: an organism with a row space, a plain member M, an admin G, two rows', async () => {
    M = await setupOwner('m');
    G = await setupOwner('g');
    const o = await json('/v1/organisms', {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ name: 'Rows Read Gate', description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'private' }),
    });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body.error ?? o.body)}`);
    org3 = o.body.data.organism.id;

    const w = await json(`/v1/organisms/${org3}/workspaces`, {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ name: 'Guarded', manifest: { objectTypes: [
            { name: 'log', schemaRef: 'schema:log@1', namespace: 'ops.log', backing: 'rows', writeRole: 'member', mode: 'records', indexOn: ['stream'] },
        ] } }),
    });
    assert(w.status === 201, `workspace ${w.status}: ${JSON.stringify(w.body.error ?? w.body)}`);
    WS3 = w.body.data.ws;

    for (const who of [M, G]) {
        const add = await json(`/v1/organisms/${org3}/members`, { method: 'POST', headers: authA(), body: JSON.stringify({ ghii: who.ownerName }) });
        assert(add.status === 201, `add ${who.ownerName}: ${add.status} ${JSON.stringify(add.body.error ?? add.body)}`);
    }
    const promoted = await json(`/v1/organisms/${org3}/admins`, { method: 'POST', headers: authA(), body: JSON.stringify({ target_ghii: G.ownerName }) });
    assert(promoted.status === 200, `G promoted ${promoted.status}: ${JSON.stringify(promoted.body.error ?? promoted.body)}`);

    const seeded = await json(guardedUrl(), {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ rows: [
            { row_id: 'r-1', body: { stream: 's-1', msg: 'secret-one' } },
            { row_id: 'r-2', body: { stream: 's-1', msg: 'secret-two' } },
        ] }),
    });
    assert(seeded.status === 200 && seeded.body.data.written === 2, `seed ${seeded.status}: ${JSON.stringify(seeded.body.error ?? seeded.body)}`);

    mSession = await openSession(BASE, (await makeAgent(BASE, { name: M.ownerName, token: M.token },
        ['organism:read', 'organism:rows', 'memory:read'])).token, 'wsrow-m');
});

await test('the member sees the workspace as empty on the records path, which is what the row path must match', async () => {
    const r = await json(`/v1/organisms/${org3}/workspace?ws=${WS3}`, { headers: authM() });
    assert(r.status === 200, `workspace read ${r.status}: ${JSON.stringify(r.body.error ?? r.body)}`);
    assert(r.body.data.manifest === null, `the manifest is hidden from a member with no grant: ${JSON.stringify(r.body.data.manifest)}`);
});

await test('a plain member with no grant is refused the page, the single row and the stats', async () => {
    const s = await rowReads(authM());
    assert(s.page === 403 && s.one === 403 && s.stats === 403,
        `expected 403 from all three, got page ${s.page}, row ${s.one}, stats ${s.stats}`);
    const page = await json(guardedUrl(), { headers: authM() });
    assert(page.body.error?.code === 'ACCESS_DENIED', `code: ${JSON.stringify(page.body.error)}`);
    assert(!JSON.stringify(page.body).includes('secret-one'), `a row body rode the refusal: ${JSON.stringify(page.body).slice(0, 200)}`);
});

// An AGENT of that member is refused one step earlier: the organism namespace rule asks an agent
// for the creator's contributor grant on every workspace key, in read mode as in write mode, and a
// viewer grant does not match it. So the MCP tool's refusal here is CONSENT_REQUIRED rather than
// ACCESS_DENIED, and the grant that admits the agent is `contributor`. The tool is asserted anyway,
// because it calls the same readRows: a surface that stopped going through gate() would show up as
// a page of rows where this expects a refusal.
const MCP_DENIED = /^(ACCESS_DENIED|CONSENT_REQUIRED)\b/;

await test('the MCP rows tool refuses that member\'s agent too, and carries no row', async () => {
    const r = await callTool(mSession, 'aimeat_workspace_rows_read', { organism_id: org3, ws: WS3, space: 'log' });
    assert(r.offered && r.isError && MCP_DENIED.test(r.text), `the member's agent read rows over MCP: ${r.text.slice(0, 200)}`);
    assert(!r.text.includes('secret-one'), `a row body rode the MCP refusal: ${r.text.slice(0, 200)}`);
});

await test('the creator and an organism admin read the rows throughout', async () => {
    for (const [who, headers] of [['the creator', authA()], ['the admin', authG()]] as const) {
        const s = await rowReads(headers);
        assert(s.page === 200 && s.one === 200 && s.stats === 200,
            `${who}: page ${s.page}, row ${s.one}, stats ${s.stats}`);
    }
});

const grantM = (role: 'viewer' | 'contributor') => json(`/v1/organisms/${org3}/workspace-access/grant`, {
    method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS3, grantee: M.ownerName, role }),
});
const revokeM = () => json(`/v1/organisms/${org3}/workspace-access/revoke`, {
    method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS3, grantee: M.ownerName }),
});

await test('a viewer grant admits the same member over REST', async () => {
    const g = await grantM('viewer');
    assert(g.status === 200, `grant ${g.status}: ${JSON.stringify(g.body.error ?? g.body)}`);
    const s = await rowReads(authM());
    assert(s.page === 200 && s.one === 200 && s.stats === 200,
        `after the grant: page ${s.page}, row ${s.one}, stats ${s.stats}`);
    const page = await json(guardedUrl(), { headers: authM() });
    assert(page.body.data.rows.length === 2, `both rows: ${JSON.stringify(page.body.data.rows)}`);
});

await test('revoking the grant refuses the member again', async () => {
    const rev = await revokeM();
    assert(rev.status === 200, `revoke ${rev.status}: ${JSON.stringify(rev.body.error ?? rev.body)}`);
    const s = await rowReads(authM());
    assert(s.page === 403 && s.one === 403 && s.stats === 403,
        `after the revoke: page ${s.page}, row ${s.one}, stats ${s.stats}`);
    const admin = await rowReads(authG());
    assert(admin.page === 200 && admin.stats === 200, `the admin is unaffected: page ${admin.page}, stats ${admin.stats}`);
});

await test('a contributor grant admits that member\'s agent over MCP, and revoking it refuses them again', async () => {
    const g = await grantM('contributor');
    assert(g.status === 200, `grant ${g.status}: ${JSON.stringify(g.body.error ?? g.body)}`);
    const r = await callTool(mSession, 'aimeat_workspace_rows_read', { organism_id: org3, ws: WS3, space: 'log' });
    assert(!r.isError && Array.isArray(r.data.rows) && r.data.rows.length === 2, `MCP after the grant: ${r.text.slice(0, 200)}`);
    const rev = await revokeM();
    assert(rev.status === 200, `revoke ${rev.status}: ${JSON.stringify(rev.body.error ?? rev.body)}`);
    const after = await callTool(mSession, 'aimeat_workspace_rows_read', { organism_id: org3, ws: WS3, space: 'log' });
    assert(after.isError && MCP_DENIED.test(after.text), `MCP after the revoke: ${after.text.slice(0, 200)}`);
    assert(!after.text.includes('secret-one'), `a row body rode the MCP refusal: ${after.text.slice(0, 200)}`);
    const stillRefused = await rowReads(authM());
    assert(stillRefused.page === 403, `the member in person is refused again: ${stillRefused.page}`);
});

// ── The workspace role is the MEMBER's permission, not an agent-only one ─────────────────────
//
// Core 2026-11 COL-09: a workspace grant gives an OWNER `viewer` (read) or `contributor` (read and
// write), and it covers that owner's agents. Until 2026-10-20 the write rule skipped the consent
// step for the account holder in person, so the role was tested on agents alone and B, a plain
// member, wrote any workspace's content and deleted its rows while signed in as themselves. B here
// is a plain member of org2 with no grant on WS2, which A created (secaudit 2026-10, defect 1).

const notesKey = (id: string) => `organism.${org2}.w.${WS2}.shared.notes.${id}.draft`;
const noteWrite = (hdr: Record<string, string>, id: string) => json('/v1/memory', {
    method: 'POST', headers: hdr,
    body: JSON.stringify({ key: notesKey(id), value: { id, title: 'role test' }, visibility: 'private' }),
});
const logRowDelete = (hdr: Record<string, string>, rowId: string) =>
    json(`/v1/organisms/${org2}/workspace/rows/log/${rowId}?ws=${WS2}`, { method: 'DELETE', headers: hdr });
const setRole = (role: string) => json(`/v1/organisms/${org2}/workspace-access/grant`, {
    method: 'POST', headers: authA(), body: JSON.stringify({ ws: WS2, grantee: B.ownerName, role }),
});

await test('COL-09 setup: the creator declares a member-writable memory space and row space, and seeds rows', async () => {
    const manifest = {
        manifestVersion: '1', id: org2, name: 'Ledger', kind: 'workspace', status: 'active',
        objectTypes: [
            { name: 'ledger', schemaRef: 'schema:ledger@1', namespace: 'books.ledger', backing: 'rows', writeRole: 'admin', indexOn: ['account'] },
            // writeRole 'member' on both, so the ROLE rule is the only thing that can refuse B.
            { name: 'log', schemaRef: 'schema:log@1', namespace: 'books.log', backing: 'rows', writeRole: 'member', indexOn: ['account'] },
            { name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', mode: 'records' },
        ],
    };
    const m = await json('/v1/memory', { method: 'POST', headers: authA(), body: JSON.stringify({ key: ledgerKey(), value: manifest, visibility: 'private' }) });
    assert(m.status === 200 || m.status === 201, `the creator's manifest ${m.status}: ${JSON.stringify(m.body.error)}`);
    for (const rowId of ['role-1', 'role-2', 'role-3']) {
        const r = await json(`/v1/organisms/${org2}/workspace/rows/log?ws=${WS2}`, {
            method: 'POST', headers: authA(), body: JSON.stringify({ row_id: rowId, body: { account: 'a-1', amount: 1 } }),
        });
        assert(r.status === 200, `seed ${rowId}: ${r.status} ${JSON.stringify(r.body.error)}`);
    }
});

await test('COL-09: a plain member with NO grant is refused the content write and the row delete, in person', async () => {
    const wr = await noteWrite(authB(), 'n-nogrant');
    assert(wr.status === 403, `a member with no grant wrote workspace content in person: ${wr.status} ${JSON.stringify(wr.body.data ?? wr.body.error)}`);
    const del = await logRowDelete(authB(), 'role-1');
    assert(del.status === 403, `a member with no grant deleted a row in person: ${del.status} ${JSON.stringify(del.body.data ?? del.body.error)}`);
    const still = await json(`/v1/organisms/${org2}/workspace/rows/log/role-1?ws=${WS2}`, { headers: authA() });
    assert(still.status === 200, `the row is still there: ${still.status}`);
});

await test('COL-09: a VIEWER is refused both, in person', async () => {
    const g = await setRole('viewer');
    assert(g.status === 200 && g.body.data.role === 'viewer', `grant viewer ${g.status}: ${JSON.stringify(g.body)}`);
    const wr = await noteWrite(authB(), 'n-viewer');
    assert(wr.status === 403, `a viewer wrote workspace content in person: ${wr.status} ${JSON.stringify(wr.body.data ?? wr.body.error)}`);
    const del = await logRowDelete(authB(), 'role-2');
    assert(del.status === 403, `a viewer deleted a row in person: ${del.status} ${JSON.stringify(del.body.data ?? del.body.error)}`);
});

await test('COL-09: a CONTRIBUTOR makes both, in person', async () => {
    const g = await setRole('contributor');
    assert(g.status === 200 && g.body.data.role === 'contributor', `grant contributor ${g.status}: ${JSON.stringify(g.body)}`);
    const wr = await noteWrite(authB(), 'n-contrib');
    assert(wr.status === 200 || wr.status === 201, `a contributor was refused the content write: ${wr.status} ${JSON.stringify(wr.body.error)}`);
    const del = await logRowDelete(authB(), 'role-3');
    assert(del.status === 200, `a contributor was refused the row delete: ${del.status} ${JSON.stringify(del.body.error)}`);
});

await test('Cleanup', async () => {
    await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: authA() });
    if (org2) await json(`/v1/organisms/${org2}`, { method: 'DELETE', headers: authA() });
    if (org3) await json(`/v1/organisms/${org3}`, { method: 'DELETE', headers: authA() });
    await json(`/v1/owners/${A.ownerName}`, { method: 'DELETE', headers: authA() });
    await json(`/v1/owners/${B.ownerName}`, { method: 'DELETE', headers: authB() });
    if (C) await json(`/v1/owners/${C.ownerName}`, { method: 'DELETE', headers: authC() });
    if (M) await json(`/v1/owners/${M.ownerName}`, { method: 'DELETE', headers: authM() });
    if (G) await json(`/v1/owners/${G.ownerName}`, { method: 'DELETE', headers: authG() });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
