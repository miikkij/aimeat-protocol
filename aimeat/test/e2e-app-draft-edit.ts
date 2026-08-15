/**
 * @file e2e-app-draft-edit.ts
 * @description E2E tests for incremental app-draft editing over REST: POST .../draft/write appends a
 *   piece (or replaces the slot), POST .../draft/replace does an exact old→new with a uniqueness
 *   rule, GET .../draft/lines returns a bounded range, and POST .../draft/seed copies a published
 *   version back into the slot.
 *
 *   These exist so a caller can build an app larger than one model response, so the cases that
 *   matter end-to-end are the ones that would corrupt a file quietly across many requests: pieces
 *   arriving out of order or twice, an oversized chunk truncating what was already there, a
 *   replacement aimed at text that appears three times, and a second owner reaching a draft that is
 *   not theirs.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-app-draft-edit
 * @version-history
 *   v1.0.0 — 2026-08-16 — initial: chunked build + publish, seed-then-edit round trip, uniqueness
 *     and lost-update refusals, bounded reads, cross-owner 403.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerAName = `dedita${Date.now() % 100000}`;
const ownerBName = `deditb${Date.now() % 100000}`;
const APP = 'pong-edit.html';
const COPY = 'pong-copy.html';

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

async function raw(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, opts);
    return { status: res.status, text: await res.text() };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

const b64 = (html: string) => Buffer.from(html, 'utf8').toString('base64');

let aToken = '';
let bToken = '';
function aAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${aToken}` } };
}
function bAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${bToken}` } };
}

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name} status ${reg.status}: ${JSON.stringify(reg.body)}`);
    const priv = reg.body.data.private_key;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(priv, name + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data?.token as string;
}

const write = (owner: string, file: string, body: unknown, authed: (o?: RequestInit) => RequestInit) =>
    json(`/v1/apps/${owner}/${file}/draft/write`, authed({ method: 'POST', body: JSON.stringify(body) }));

console.log('\n=== App Draft Incremental Editing E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register owner A + owner B', async () => {
    aToken = await registerOwner(ownerAName);
    bToken = await registerOwner(ownerBName);
    assert(!!aToken && !!bToken, 'both owner tokens issued');
});

// ── Phase 1: build an app across several calls ──
console.log('\nPhase 1: an app is built a piece at a time and published');

const PIECE_1 = '<!DOCTYPE html><html><head><title>Pong</title></head>\n';
const PIECE_2 = '<body><canvas id="board"></canvas>\n';
const PIECE_3 = '<script>const board = document.getElementById("board");</script></body></html>';

await test('The first write creates the draft (mode replace)', async () => {
    // The description is set here rather than at publish because publishing a NEW app refuses
    // without one, and the draft manifest is what the promotion reads.
    const { status, body } = await write(ownerAName, APP, {
        content: PIECE_1, mode: 'replace', name: 'Pong', description: 'Two paddles and a ball.',
    }, aAuthed);
    assert(status === 200, `write status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.size === Buffer.byteLength(PIECE_1, 'utf8'), `size is the first piece, got ${body.data?.size}`);
    assert(body.data?.has_live_version === false, 'nothing is live yet');
});

await test('Two more appends land in order', async () => {
    await write(ownerAName, APP, { content: PIECE_2 }, aAuthed);
    const { body } = await write(ownerAName, APP, { content: PIECE_3 }, aAuthed);
    const expected = Buffer.byteLength(PIECE_1 + PIECE_2 + PIECE_3, 'utf8');
    assert(body.data?.size === expected, `size is the sum of the pieces (${expected}), got ${body.data?.size}`);
});

await test('Reading the draft back gives exactly what was written', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed());
    assert(status === 200, `draft read status ${status}`);
    const text = Buffer.from(body.data.content, 'base64').toString('utf8');
    assert(text === PIECE_1 + PIECE_2 + PIECE_3, 'the pieces joined in order with nothing lost');
});

await test('The manifest name set on the first piece survived the appends', async () => {
    const { body } = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed());
    assert(body.data?.manifest?.name === 'Pong', `name is "Pong", got "${body.data?.manifest?.name}"`);
});

await test('Publishing the draft makes the assembled app live', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${APP}/publish-draft`, aAuthed({ method: 'POST' }));
    assert(status === 200 || status === 201, `publish status ${status}: ${JSON.stringify(body)}`);
    const live = await raw(`/v1/apps/${ownerAName}/${APP}?mode=inline`);
    assert(live.status === 200, `live fetch status ${live.status}`);
    assert(live.text.includes('<canvas id="board">'), 'the middle piece is in the live app');
    assert(live.text.includes('getElementById'), 'the last piece is in the live app');
});

// ── Phase 2: continue an app that is already live ──
console.log('\nPhase 2: a published app is seeded back into the draft and edited');

await test('POST .../draft/seed copies the live source into the slot', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${APP}/draft/seed`, aAuthed({ method: 'POST', body: '{}' }));
    assert(status === 200, `seed status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.seeded_version === 1, `seeded version 1, got ${body.data?.seeded_version}`);
    const read = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed());
    const text = Buffer.from(read.body.data.content, 'base64').toString('utf8');
    assert(text.includes('<canvas id="board">'), 'the seeded draft holds the published bytes');
});

await test('A targeted replacement changes only its target', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${APP}/draft/replace`, aAuthed({
        method: 'POST', body: JSON.stringify({ old_string: '<title>Pong</title>', new_string: '<title>Pong II</title>' }),
    }));
    assert(status === 200, `replace status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.replacements === 1, `one replacement, got ${body.data?.replacements}`);
    const read = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed());
    const text = Buffer.from(read.body.data.content, 'base64').toString('utf8');
    assert(text.includes('<title>Pong II</title>'), 'the title changed');
    assert(text.includes('<canvas id="board">'), 'everything else is untouched');
});

await test('The LIVE app is still the old title until the draft is published', async () => {
    const live = await raw(`/v1/apps/${ownerAName}/${APP}?mode=inline`);
    assert(live.text.includes('<title>Pong</title>'), 'live still has the original title');
    assert(!live.text.includes('Pong II'), 'the edit has not leaked to live');
});

await test('Seeding under a different filename copies the app', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${COPY}/draft/seed`, aAuthed({
        method: 'POST', body: JSON.stringify({ from_filename: APP }),
    }));
    assert(status === 200, `seed-as-copy status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.seeded_from === APP, `seeded_from names the source, got ${body.data?.seeded_from}`);
    const read = await json(`/v1/apps/${ownerAName}/${COPY}/draft`, aAuthed());
    assert(read.body.data?.manifest?.name === 'Pong', 'the source manifest came along');
});

// ── Phase 3: the refusals ──
console.log('\nPhase 3: refusals that keep a multi-call build honest');

await test('An ambiguous replacement is refused with the count, and writes nothing', async () => {
    await write(ownerAName, APP, { content: '<div>x</div>\n<div>x</div>\n<div>x</div>', mode: 'replace' }, aAuthed);
    const { status, body } = await json(`/v1/apps/${ownerAName}/${APP}/draft/replace`, aAuthed({
        method: 'POST', body: JSON.stringify({ old_string: '<div>x</div>', new_string: '<div>y</div>' }),
    }));
    assert(status === 409, `ambiguous replace is 409, got ${status}`);
    assert(body.error?.code === 'NOT_UNIQUE', `code NOT_UNIQUE, got ${body.error?.code}`);
    assert(String(body.error?.message).includes('3'), `the message names the count: ${body.error?.message}`);
    const read = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed());
    const text = Buffer.from(read.body.data.content, 'base64').toString('utf8');
    assert(!text.includes('<div>y</div>'), 'nothing was replaced');
});

await test('replace_all replaces every occurrence and says how many', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${APP}/draft/replace`, aAuthed({
        method: 'POST', body: JSON.stringify({ old_string: '<div>x</div>', new_string: '<div>y</div>', replace_all: true }),
    }));
    assert(status === 200, `replace_all status ${status}`);
    assert(body.data?.replacements === 3, `three replacements, got ${body.data?.replacements}`);
});

await test('Text that is not there is refused as NOT_FOUND', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${APP}/draft/replace`, aAuthed({
        method: 'POST', body: JSON.stringify({ old_string: '<h9>nope</h9>', new_string: 'x' }),
    }));
    assert(status === 404, `missing match is 404, got ${status}`);
    assert(body.error?.code === 'NOT_FOUND', `code NOT_FOUND, got ${body.error?.code}`);
});

await test('A wrong expected_size_bytes is refused and the draft is untouched', async () => {
    const before = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed());
    const beforeText = Buffer.from(before.body.data.content, 'base64').toString('utf8');

    const { status, body } = await write(ownerAName, APP, { content: 'TAIL', expected_size_bytes: 999999 }, aAuthed);
    assert(status === 409, `size mismatch is 409, got ${status}`);
    assert(body.error?.code === 'DRAFT_CHANGED', `code DRAFT_CHANGED, got ${body.error?.code}`);

    const after = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed());
    const afterText = Buffer.from(after.body.data.content, 'base64').toString('utf8');
    assert(afterText === beforeText, 'the refusal wrote nothing');
});

await test('The right expected_size_bytes goes through', async () => {
    const before = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed());
    const size = before.body.data.size as number;
    const { status } = await write(ownerAName, APP, { content: 'TAIL', expected_size_bytes: size }, aAuthed);
    assert(status === 200, `matching size writes, got ${status}`);
});

await test('Replacing in an app with no draft is refused as NO_DRAFT', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/never-staged.html/draft/replace`, aAuthed({
        method: 'POST', body: JSON.stringify({ old_string: 'a', new_string: 'b' }),
    }));
    assert(status === 404, `no draft is 404, got ${status}`);
    assert(body.error?.code === 'NO_DRAFT', `code NO_DRAFT, got ${body.error?.code}`);
});

await test('Seeding an app that was never published is refused', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/never-published.html/draft/seed`, aAuthed({
        method: 'POST', body: '{}',
    }));
    assert(status === 404, `nothing to seed is 404, got ${status}`);
    assert(body.error?.code === 'NOT_FOUND', `code NOT_FOUND, got ${body.error?.code}`);
});

// ── Phase 4: bounded reads ──
console.log('\nPhase 4: reads are bounded, so one call cannot pull a whole app');

await test('A line range returns exactly those lines with the totals around it', async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n');
    await write(ownerAName, APP, { content: lines, mode: 'replace' }, aAuthed);

    const { status, body } = await json(`/v1/apps/${ownerAName}/${APP}/draft/lines?offset=10&limit=3`, aAuthed());
    assert(status === 200, `lines status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.total_lines === 60, `total_lines 60, got ${body.data?.total_lines}`);
    assert(body.data?.from_line === 10 && body.data?.to_line === 12, `range 10..12, got ${body.data?.from_line}..${body.data?.to_line}`);
    assert(body.data?.content === 'line 10\nline 11\nline 12', `slice is exact, got ${JSON.stringify(body.data?.content)}`);
    assert(body.data?.has_more === true, 'has_more is true');
});

await test('A read with no range is bounded and says more remains', async () => {
    const lines = Array.from({ length: 1200 }, (_, i) => `row ${i + 1}`).join('\n');
    await write(ownerAName, APP, { content: lines, mode: 'replace' }, aAuthed);

    const { body } = await json(`/v1/apps/${ownerAName}/${APP}/draft/lines`, aAuthed());
    assert(body.data?.to_line < body.data?.total_lines, `bounded: returned up to ${body.data?.to_line} of ${body.data?.total_lines}`);
    assert(body.data?.has_more === true, 'has_more is true');
});

await test('A nonsense range is refused rather than guessed', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${APP}/draft/lines?offset=0`, aAuthed());
    assert(status === 400, `offset 0 is 400, got ${status}`);
    assert(body.error?.code === 'INVALID_RANGE', `code INVALID_RANGE, got ${body.error?.code}`);
});

// ── Phase 5: owner scoping ──
console.log('\nPhase 5: a draft belongs to one owner');

await test('Owner B writing into owner A\'s draft does not touch it', async () => {
    const before = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed());
    const beforeSize = before.body.data.size as number;

    // The owner is resolved from the token, never from the path, so B's call lands in B's own
    // bucket at worst — what must never happen is A's draft changing.
    await write(ownerAName, APP, { content: 'B WAS HERE', mode: 'replace' }, bAuthed);

    const after = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed());
    assert(after.body.data.size === beforeSize, `A's draft is unchanged (${beforeSize} -> ${after.body.data.size})`);
    const text = Buffer.from(after.body.data.content, 'base64').toString('utf8');
    assert(!text.includes('B WAS HERE'), 'B\'s bytes are not in A\'s draft');
});

await test('Owner B reading owner A\'s draft lines does not return A\'s content', async () => {
    const { body } = await json(`/v1/apps/${ownerAName}/${APP}/draft/lines?offset=1&limit=5`, bAuthed());
    const content = String(body.data?.content ?? '');
    assert(!content.includes('row 1'), 'B does not see A\'s draft content');
});

await test('An unauthenticated write is refused', async () => {
    const { status } = await json(`/v1/apps/${ownerAName}/${APP}/draft/write`, {
        method: 'POST', body: JSON.stringify({ content: 'anon' }),
    });
    assert(status === 401, `unauthenticated write is 401, got ${status}`);
});

// ── Phase 6: the size ceiling refuses before it writes ──
console.log('\nPhase 6: the ceiling refuses before it writes');

await test('An oversized append leaves the previous content intact', async () => {
    await write(ownerAName, APP, { content: 'KEEP ME', mode: 'replace' }, aAuthed);
    // The node default is 5 MB; 6 MB of text is over it on any sane configuration.
    const { status } = await write(ownerAName, APP, { content: 'x'.repeat(6 * 1024 * 1024) }, aAuthed);
    assert(status === 413 || status === 400, `oversized append is refused, got ${status}`);

    const after = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed());
    const text = Buffer.from(after.body.data.content, 'base64').toString('utf8');
    assert(text === 'KEEP ME', `the draft is untouched, got ${JSON.stringify(text.slice(0, 40))}`);
});

// ── Cleanup ──
console.log('\nCleanup');

await test('Discard the drafts and delete the apps', async () => {
    await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed({ method: 'DELETE' }));
    await json(`/v1/apps/${ownerAName}/${COPY}/draft`, aAuthed({ method: 'DELETE' }));
    await json(`/v1/apps/${ownerAName}/${APP}`, aAuthed({ method: 'DELETE' }));
    const gone = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed());
    assert(gone.status === 404, `the draft is gone, got ${gone.status}`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
