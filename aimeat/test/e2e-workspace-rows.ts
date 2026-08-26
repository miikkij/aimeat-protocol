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
 *   v1.0.0 — 2026-08-26 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-rows

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

/** An owner with a token. Two of them, because half of what this suite proves is the boundary. */
async function setupOwner(label: string) {
    const ownerName = `wsrow${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'WS Rows', password: 'WsRow12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body)}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(priv, ownerName + NODE_ID + ts) }) });
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

await test('Cleanup', async () => {
    await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: authA() });
    await json(`/v1/owners/${A.ownerName}`, { method: 'DELETE', headers: authA() });
    await json(`/v1/owners/${B.ownerName}`, { method: 'DELETE', headers: authB() });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
