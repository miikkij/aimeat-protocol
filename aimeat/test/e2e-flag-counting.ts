/**
 * @file test/e2e-flag-counting.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a flag changes for readers (secaudit2026oct31w2 round 10, W2-8 and W2-9).
 *     - A board post: one person and their own agents count as one reporter toward the node's
 *       auto-hide threshold. Five flags from one owner's session and four of their agents leave the
 *       post in the anonymous listing and the summary says it is not hidden; five owners hide it, and
 *       the author still sees it.
 *     - A memory record: one unreviewed flag from another account leaves the record in its owner's
 *       discovery and librarian search, and the counter the owner sees still says 1. A flag the
 *       operator actions hides it; the same flag dismissed brings it back. The reporter cannot action
 *       their own flag (403), so a review stays somebody else's decision.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-flag-counting
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (secaudit2026oct31w2 round 10, W2-8 and W2-9).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, type McpAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any }> {
    const { token, ...rest } = opts;
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...rest,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

const short = (v: unknown) => JSON.stringify(v).slice(0, 240);
const stamp = Date.now().toString(36).slice(-5);

let operator: RegisteredOwner;
let poster: RegisteredOwner;
let reporter: RegisteredOwner;
let reporterAgents: McpAgent[] = [];
let boardId = '';
let postId = '';

const flagAs = (token: string, targetType: string, targetId: string) => json('/v1/flags', {
    method: 'POST', token, body: JSON.stringify({ targetType, targetId, reason: 'spam', description: 'raised by the flag counting suite' }),
});

const anonymousSeesPost = async (): Promise<boolean> => {
    const r = await json(`/v1/boards/${boardId}/posts?limit=100`);
    assert(r.status === 200, `anonymous listing: ${r.status} ${short(r.body)}`);
    return (r.body.data.posts as any[]).some((p) => p.id === postId);
};

console.log('\n=== FLAG COUNTING E2E (board auto-hide, memory discovery) ===\n');
console.log('Phase 1 — a board post');

await test('fixture: the operator\'s public board, a post by another owner, a reporter with four agents', async () => {
    operator = await registerOwner(BASE, `fcop${stamp}`);
    poster = await registerOwner(BASE, `fcpo${stamp}`);
    reporter = await registerOwner(BASE, `fcre${stamp}`);
    const board = await json('/v1/boards', { method: 'POST', token: operator.token, body: JSON.stringify({ name: `Flag counting ${stamp}`, visibility: 'public' }) });
    assert(board.status === 201, `board: ${board.status} ${short(board.body)}`);
    boardId = board.body.data.id;
    const post = await json(`/v1/boards/${boardId}/posts`, { method: 'POST', token: poster.token, body: JSON.stringify({ title: 'A notice', body: 'Somebody will report this.' }) });
    assert(post.status === 201, `post: ${post.status} ${short(post.body)}`);
    postId = post.body.data.id;
    reporterAgents = [];
    for (let i = 0; i < 4; i++) reporterAgents.push(await makeAgent(BASE, reporter, ['social:write', 'social:read']));
    assert(await anonymousSeesPost(), 'the new post is in the anonymous listing');
});

await test('one owner and four of their agents: five flags are taken, and the post stays in the anonymous listing', async () => {
    for (const [i, token] of [reporter.token, ...reporterAgents.map((a) => a.token)].entries()) {
        const r = await flagAs(token, 'board_post', postId);
        assert(r.status === 201, `flag ${i + 1}: ${r.status} ${short(r.body)}`);
    }
    assert(await anonymousSeesPost(), 'one person and their own agents hid the post alone');
});

await test('the public summary counts that person once: five flags, not hidden', async () => {
    const s = await json(`/v1/flags/summary/board_post/${postId}`);
    assert(s.status === 200 && s.body.data.hidden === false, `summary: ${s.status} ${short(s.body.data)}`);
});

await test('usage: five different owners hide the post from everyone but its author and the board owner', async () => {
    for (let i = 0; i < 4; i++) {
        const other = await registerOwner(BASE, `fcx${i}${stamp}`);
        const r = await flagAs(other.token, 'board_post', postId);
        assert(r.status === 201, `owner ${i + 1}: ${r.status} ${short(r.body)}`);
    }
    assert(!(await anonymousSeesPost()), 'five owners did not hide the post');
    const author = await json(`/v1/boards/${boardId}/posts?limit=100`, { token: poster.token });
    assert((author.body.data.posts as any[]).some((p) => p.id === postId), 'the author no longer sees their own post');
    const s = await json(`/v1/flags/summary/board_post/${postId}`);
    assert(s.body.data.hidden === true, `summary after five owners: ${short(s.body.data)}`);
});

console.log('\nPhase 2 — a memory record');

let owner: RegisteredOwner;
let flagger: RegisteredOwner;
const WORD = `flagword${stamp}`;
const KEY = `notes.flagcount-${stamp}`;
let memoryFlagId = '';

const ownerFinds = async (): Promise<{ discover: boolean; librarian: boolean }> => {
    const d = await json(`/v1/discover?q=${WORD}&per_page=50`, { token: owner.token });
    assert(d.status === 200, `discover: ${d.status} ${short(d.body)}`);
    const l = await json(`/v1/librarian/search?q=${WORD}`, { token: owner.token });
    assert(l.status === 200, `librarian: ${l.status} ${short(l.body)}`);
    return { discover: JSON.stringify(d.body.data.entries).includes(KEY), librarian: JSON.stringify(l.body.data).includes(KEY) };
};

const review = (status: string) => json(`/v1/flags/${encodeURIComponent(memoryFlagId)}`, { method: 'PUT', token: operator.token, body: JSON.stringify({ status }) });

await test('fixture: an owner\'s private record that their discovery and librarian find', async () => {
    owner = await registerOwner(BASE, `fcow${stamp}`);
    flagger = await registerOwner(BASE, `fcfl${stamp}`);
    const w = await json('/v1/memory', { method: 'POST', token: owner.token, body: JSON.stringify({ key: KEY, value: { text: `A note about ${WORD} and nothing else.` }, visibility: 'private' }) });
    assert(w.status === 201, `write: ${w.status} ${short(w.body)}`);
    const found = await ownerFinds();
    assert(found.discover && found.librarian, `before any flag: ${short(found)}`);
});

await test('one unreviewed flag from another account leaves the record in its owner\'s discovery and librarian search', async () => {
    const r = await flagAs(flagger.token, 'memory', `${owner.name}@${NODE_ID}::${KEY}`);
    assert(r.status === 201, `flag: ${r.status} ${short(r.body)}`);
    memoryFlagId = r.body.data.id;
    const found = await ownerFinds();
    assert(found.discover, 'one unreviewed flag removed the record from its owner\'s discovery');
    assert(found.librarian, 'one unreviewed flag removed the record from its owner\'s librarian search');
});

await test('the reporter cannot action their own flag to hide the record: 403', async () => {
    const r = await json(`/v1/flags/${encodeURIComponent(memoryFlagId)}`, { method: 'PUT', token: flagger.token, body: JSON.stringify({ status: 'actioned' }) });
    assert(r.status === 403, `the reporter reviewing their own flag: ${r.status} ${short(r.body)}`);
    const found = await ownerFinds();
    assert(found.discover, 'the record left discovery after a refused review');
});

await test('usage: the counter on the record still says 1 to its owner', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(KEY)}`, { token: owner.token });
    assert(r.status === 200, `read: ${r.status} ${short(r.body)}`);
    assert(r.body.data?._ddc?.flagCount === 1 || r.body.data?.flagCount === 1, `flagCount: ${short(r.body.data?._ddc ?? r.body.data)}`);
});

await test('usage: the operator actions the flag, and the record leaves discovery and the librarian', async () => {
    const a = await review('actioned');
    assert(a.status === 200 && a.body.data?.status === 'actioned', `actioned: ${a.status} ${short(a.body)}`);
    const found = await ownerFinds();
    assert(!found.discover && !found.librarian, `after the review: ${short(found)}`);
});

await test('the same flag dismissed: the record is found again', async () => {
    const d = await review('dismissed');
    assert(d.status === 200 && d.body.data?.status === 'dismissed', `dismissed: ${d.status} ${short(d.body)}`);
    const found = await ownerFinds();
    assert(found.discover && found.librarian, `after the dismissal: ${short(found)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
