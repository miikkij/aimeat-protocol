/**
 * @file test/e2e-admin-memory-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's memory doors: `/v1/admin/memory`, its search, one record, and the
 *   bin. The route an operator deletes anybody's data through had no test at all before this file.
 *
 *   WHAT THIS ASSERTS THAT NOTHING DID. That the listing carries the AUDIENCE and not just the
 *   visibility word; that it sends no values, which is the difference between a page and fifty
 *   megabytes; that the content search reaches every owner and says where it matched; that a delete
 *   records WHO deleted it and how long it can be taken back; and that all of it is refused to a
 *   caller who is not an operator.
 * @structure
 *   - Setup: an operator, a plain owner, and records under both with five of the six audiences
 *   - Section A: the listing — every field, no value, the filters, the node-wide breakdown
 *   - Section B: the search — cross-owner, ranked, with the excerpt, and narrowed
 *   - Section C: one record — the value, the kept versions, 404 on a key that is not there
 *   - Section D: the bin — delete stamps the operator, restore brings it back, the window is said
 *   - Section E: the refusals — every door answers 403 to a plain owner and 401 to nobody
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts \
 *     --test=e2e-admin-memory-page
 * @version-history
 *   v1.0.0 — 2026-09-12 — Written with the page rebuilt around the question.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body };
}

ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function ownerTokenFor(name: string, privateKeyB64: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const priv = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(name + NODE_ID + timestamp), priv);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp, signature: Buffer.from(sig).toString('base64') }),
    });
    assert(body.ok === true, `token for ${name}: ${JSON.stringify(body.error)}`);
    return body.data.token as string;
}

// ─── State ───
const stamp = Date.now();
const opName = `memop${stamp}`;
const plainName = `memplain${stamp}`;
const PREFIX = `e2emem${stamp}.`;

let opToken = '';
let plainToken = '';
let opGhii = '';
let plainGhii = '';

const op = (o: RequestInit = {}): RequestInit =>
    ({ ...o, headers: { ...((o.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${opToken}` } });
const plain = (o: RequestInit = {}): RequestInit =>
    ({ ...o, headers: { ...((o.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${plainToken}` } });

/** One record written as its owner, so the operator's reads are genuinely cross-owner. */
async function write(token: string, key: string, value: unknown, visibility = 'private', extra: Record<string, unknown> = {}) {
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key, value, visibility, ...extra }),
    });
    assert(status === 201 || status === 200, `write ${key}: ${status} ${JSON.stringify(body.error ?? body)}`);
}

const enc = encodeURIComponent;
const recPath = (owner: string, key: string) => `/v1/admin/memory/${enc(owner)}/${enc(key)}`;

console.log('\n=== AIMEAT Admin Memory page E2E ===\n');
console.log('Setup');

await test('An operator, through the admin-password door', async () => {
    const { status, body } = await json('/v1/admin/setup/register', {
        method: 'POST',
        headers: { 'X-Admin-Password': ADMIN_PW },
        body: JSON.stringify({ name: opName }),
    });
    assert(status === 200, `register ${opName}: ${status} ${JSON.stringify(body)}`);
    assert(body.owner?.roles?.includes('operator'), 'the first registration is not an operator');
    opToken = await ownerTokenFor(opName, body.private_key);
    opGhii = `${opName}@${NODE_ID}`;
});

await test('A plain owner, who must be refused every door below', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: plainName, public_key: 'placeholder' }),
    });
    assert(status === 201, `register ${plainName}: ${status} ${JSON.stringify(body)}`);
    assert(!(body.data.owner?.roles ?? []).includes('operator'),
        `the second owner came out an operator, so the refusals below prove nothing: ${JSON.stringify(body.data.owner?.roles)}`);
    plainToken = await ownerTokenFor(plainName, body.data.private_key);
    plainGhii = `${plainName}@${NODE_ID}`;
});

await test('Records under both owners, across the audiences', async () => {
    await write(opToken, `${PREFIX}public`, { note: 'a lycopodium spore under glass' }, 'public');
    await write(opToken, `${PREFIX}members`, { note: 'readable by everyone signed in' }, 'members');
    await write(opToken, `${PREFIX}private`, { note: 'nobody else' }, 'private');
    await write(plainToken, `${PREFIX}theirs`, { note: 'a record the plain owner wrote' }, 'private');
    // A value stored as a STRING of JSON — the shape the old page printed as one escaped line.
    await write(opToken, `${PREFIX}asstring`, JSON.stringify({ spec: 'wrapped', lycopodium: true }), 'private');
});

// ─── Section A: the listing ───
console.log('\nSection A — the listing');

await test('1. The listing reaches every owner, not just the operator', async () => {
    const { status, body } = await json(`/v1/admin/memory?prefix=${enc(PREFIX)}&limit=200`, op());
    assert(status === 200, `list: ${status} ${JSON.stringify(body.error)}`);
    const owners = new Set((body.data.items as any[]).map(i => i.owner_gaii));
    assert(owners.has(opGhii), 'the operator\'s own records are missing');
    assert(owners.has(plainGhii), 'the other owner\'s record is missing: the listing is not cross-owner');
    assert(body.data.total === 5, `expected the five seeded records, got ${body.data.total}`);
});

await test('2. NO VALUES: the listing carries metadata only, whatever the value is worth', async () => {
    const { body } = await json(`/v1/admin/memory?prefix=${enc(PREFIX)}&limit=200`, op());
    const withValue = (body.data.items as any[]).filter(i => 'value' in i);
    assert(withValue.length === 0,
        `${withValue.length} rows carried their value; a page of 200 of those is how a listing becomes megabytes`);
});

await test('3. Every row says who can reach it, not only the visibility word', async () => {
    const { body } = await json(`/v1/admin/memory?prefix=${enc(PREFIX)}&limit=200`, op());
    const row = (body.data.items as any[]).find(i => i.key === `${PREFIX}public`);
    assert(!!row, 'the public record is missing from the listing');
    for (const field of ['group_id', 'workspace_ref', 'allowed_origins', 'ai_provenance_id',
        'byte_size', 'ttl_hours', 'flag_count', 'archived', 'tags', 'version']) {
        assert(field in row, `the row does not carry ${field}`);
    }
    assert(row.byte_size > 0, 'byte_size came back zero, so the stored size is not being read');
});

await test('4. The audience filter takes all six settings, not four', async () => {
    for (const [vis, expected] of [['public', 1], ['members', 1], ['private', 3],
        ['workspace', 0], ['group', 0], ['owner', 0]] as const) {
        const { status, body } = await json(`/v1/admin/memory?prefix=${enc(PREFIX)}&visibility=${vis}&limit=200`, op());
        assert(status === 200, `visibility=${vis}: ${status}`);
        assert(body.data.total === expected, `visibility=${vis}: expected ${expected}, got ${body.data.total}`);
    }
});

await test('5. The breakdown is counted across the whole filter, not tallied from the page', async () => {
    const { body } = await json(`/v1/admin/memory?prefix=${enc(PREFIX)}&counts=1&limit=1`, op());
    assert(!!body.data.counts, 'counts=1 returned no breakdown');
    assert((body.data.items as any[]).length === 1, 'the page itself should still be one row');
    assert(body.data.counts.public === 1 && body.data.counts.members === 1 && body.data.counts.private === 3,
        `the breakdown counted the page, not the set: ${JSON.stringify(body.data.counts)}`);
    assert(typeof body.data.counts.with_origins === 'number', 'with_origins is missing from the breakdown');
});

await test('6. The listing says the ceiling and the grace window rather than the page guessing them', async () => {
    const { body } = await json(`/v1/admin/memory?prefix=${enc(PREFIX)}&limit=1`, op());
    assert(typeof body.data.max_keys_per_principal === 'number', 'the key ceiling is not in the response');
    assert(typeof body.data.grace_days === 'number', 'the grace window is not in the response');
});

// ─── Section B: the search ───
console.log('\nSection B — searching what is written');

await test('7. The search reaches every owner and finds a word inside a value', async () => {
    const { status, body } = await json(`/v1/admin/memory/search?q=lycopodium&prefix=${enc(PREFIX)}&limit=50`, op());
    assert(status === 200, `search: ${status} ${JSON.stringify(body.error)}`);
    const keys = (body.data.items as any[]).map(i => i.key);
    assert(keys.includes(`${PREFIX}public`), `the record holding the word is not in the hits: ${keys.join(', ')}`);
});

await test('8. A hit says WHERE it matched, so a result explains itself', async () => {
    const { body } = await json(`/v1/admin/memory/search?q=lycopodium&prefix=${enc(PREFIX)}&limit=50`, op());
    const hit = (body.data.items as any[]).find(i => i.key === `${PREFIX}public`);
    assert(!!hit.excerpt, 'the hit carries no excerpt');
    assert(/lycopodium/i.test(hit.excerpt.hit), `the excerpt does not point at the term: ${JSON.stringify(hit.excerpt)}`);
    assert(typeof hit.score === 'number', 'the hit carries no score, so nothing is ranked');
});

await test('9. A search narrowed to one owner stops at that owner', async () => {
    const { body } = await json(
        `/v1/admin/memory/search?q=record&prefix=${enc(PREFIX)}&owner=${enc(plainGhii)}&limit=50`, op());
    const owners = new Set((body.data.items as any[]).map(i => i.owner_gaii));
    assert(!owners.has(opGhii), 'the owner filter leaked another owner\'s records into the hits');
});

await test('10. A search with nothing to search for is refused rather than listing everything', async () => {
    const { status } = await json('/v1/admin/memory/search', op());
    assert(status === 400, `expected 400 for a missing query, got ${status}`);
});

// ─── Section C: one record ───
console.log('\nSection C — one record, whole');

await test('11. One record comes back with its value and every field', async () => {
    const { status, body } = await json(recPath(opGhii, `${PREFIX}public`), op());
    assert(status === 200, `read: ${status} ${JSON.stringify(body.error)}`);
    assert(body.data.value?.note?.includes('lycopodium'), 'the value did not come back');
    for (const field of ['trackable', 'archived_at', 'archived_by', 'archived_root', 'history',
        'group_id', 'workspace_ref', 'allowed_origins', 'ai_provenance_id']) {
        assert(field in body.data, `the record does not carry ${field}`);
    }
});

await test('12. A value stored as a string of JSON comes back as the string it is', async () => {
    const { body } = await json(recPath(opGhii, `${PREFIX}asstring`), op());
    assert(typeof body.data.value === 'string', 'the stored string was parsed by the route; the page opens it, not this');
    assert(body.data.value.includes('lycopodium'), 'the wrapped value lost its contents');
});

await test('13. A key that is not there answers 404, and does not say whose it would be', async () => {
    const { status } = await json(recPath(opGhii, `${PREFIX}nosuchkey`), op());
    assert(status === 404, `expected 404, got ${status}`);
});

await test('14. A key with slashes survives the round trip', async () => {
    const slashed = `${PREFIX}with/slashes/in/it`;
    await write(opToken, slashed, { note: 'keys really do contain slashes' });
    const { status, body } = await json(recPath(opGhii, slashed), op());
    assert(status === 200, `a slashed key could not be read back: ${status}`);
    assert(body.data.key === slashed, `the key came back mangled: ${body.data.key}`);
});

// ─── Section D: the bin ───
console.log('\nSection D — the bin, and who put it there');

await test('15. A delete says how long it can be taken back', async () => {
    const { status, body } = await json(recPath(plainGhii, `${PREFIX}theirs`), { ...op(), method: 'DELETE' });
    assert(status === 200, `delete: ${status} ${JSON.stringify(body.error)}`);
    assert(body.data.deleted === true, 'the delete did not report itself done');
    assert(!!body.data.restorable_until, 'the answer carried no restore deadline');
    assert(typeof body.data.grace_days === 'number', 'the answer carried no grace window');
});

await test('16. THE OPERATOR IS RECORDED AS THE DELETER — the field that answers "who do I ask"', async () => {
    const { status, body } = await json(`/v1/admin/memory?bin=1&owner=${enc(plainGhii)}`, op());
    assert(status === 200, `bin: ${status} ${JSON.stringify(body.error)}`);
    const row = (body.data.items as any[]).find(i => i.key === `${PREFIX}theirs`);
    assert(!!row, 'the deleted record is not in its owner\'s bin');
    assert(row.deleted_by === opGhii,
        `expected the operator stamped on it, got ${row.deleted_by}; the delete went around the bin service`);
    assert(!!row.restorable_until, 'the bin row does not say how long is left');
});

await test('17. …and it has left every ordinary read', async () => {
    const { status } = await json(recPath(plainGhii, `${PREFIX}theirs`), op());
    assert(status === 404, `a deleted record still answers by key: ${status}`);
    const list = await json(`/v1/admin/memory?prefix=${enc(PREFIX)}&limit=200`, op());
    assert(!(list.body.data.items as any[]).some(i => i.key === `${PREFIX}theirs`),
        'a deleted record is still in the listing');
});

await test('18. Restore brings it back whole', async () => {
    const { status, body } = await json(`${recPath(plainGhii, `${PREFIX}theirs`)}/restore`, { ...op(), method: 'POST' });
    assert(status === 200, `restore: ${status} ${JSON.stringify(body.error)}`);
    const read = await json(recPath(plainGhii, `${PREFIX}theirs`), op());
    assert(read.status === 200, `the restored record does not answer: ${read.status}`);
    assert(read.body.data.value?.note?.includes('plain owner'), 'the restored value is not the one that went in');
});

await test('19. Restoring something that was never deleted is refused, and says which of three it is', async () => {
    const { status, body } = await json(`${recPath(opGhii, `${PREFIX}public`)}/restore`, { ...op(), method: 'POST' });
    assert(status === 404, `expected 404, got ${status}`);
    assert(/never deleted|removed for good/i.test(body.error?.message ?? ''),
        `the refusal does not say what happened: ${body.error?.message}`);
});

await test('20. The bin without an owner is refused rather than answered empty', async () => {
    const { status } = await json('/v1/admin/memory?bin=1', op());
    assert(status === 400, `expected 400 for a bin read with no owner, got ${status}`);
});

// ─── Section E: the refusals ───
console.log('\nSection E — what a caller who is not an operator gets');

/** The five doors, so the two sweeps below cannot drift apart on which ones they cover. */
const DOORS = (): [string, string][] => [
    ['GET', '/v1/admin/memory'],
    ['GET', '/v1/admin/memory/search?q=lycopodium'],
    ['GET', recPath(opGhii, `${PREFIX}public`)],
    ['DELETE', recPath(opGhii, `${PREFIX}public`)],
    ['POST', `${recPath(opGhii, `${PREFIX}public`)}/restore`],
];

await test('21. A SECOND PRINCIPAL, reading somebody else\'s memory: the listing refuses them', async () => {
    const { status } = await json('/v1/admin/memory', plain());
    assert(status === 403, `a plain owner read every record on the node: ${status}`);
});

await test('22. …and so does every other door on this surface', async () => {
    const bad: string[] = [];
    for (const [method, path] of DOORS()) {
        const { status } = await json(path, plain({ method }));
        if (status !== 403) bad.push(`${method} ${path} → ${status}`);
    }
    assert(bad.length === 0, `these doors admitted a plain owner: ${bad.join(', ')}`);
});

await test('23. Nobody at all is refused too, on the listing…', async () => {
    const { status } = await json('/v1/admin/memory');
    assert(status === 401, `the listing answered without a credential: ${status}`);
});

await test('24. …and on every door', async () => {
    const bad: string[] = [];
    for (const [method, path] of DOORS()) {
        const { status } = await json(path, { method });
        if (status !== 401) bad.push(`${method} ${path} → ${status}`);
    }
    assert(bad.length === 0, `these doors answered without a credential: ${bad.join(', ')}`);
});

await test('25. And the refused delete left the record exactly where it was', async () => {
    const { status, body } = await json(recPath(opGhii, `${PREFIX}public`), op());
    assert(status === 200, `a refused delete removed the record: ${status}`);
    assert(body.data.value?.note?.includes('lycopodium'), 'a refused delete changed the value');
});

// ─── Summary ───
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
