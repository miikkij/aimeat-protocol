/**
 * @file test/e2e-admin-portal-page.ts
 * @description E2E for the reads the admin Portal page is built on. The page answers "what do
 *   visitors see right now" before it offers to change anything, and every fact in that answer
 *   comes from one of three doors: the site metadata (is there an HTML page of the operator's own,
 *   how stale may a visitor's copy be), the layout of the surface being arranged (the parts, their
 *   order, what is hidden, and whether this is the operator's arrangement or the built-in one), and
 *   the block catalogue (what each part IS, in the words the page prints under its name).
 *
 *   THE POINT OF THIS SUITE is that the page cannot say something true only because the browser
 *   guessed it. Each assertion names the sentence on screen that would go wrong: no cache number,
 *   no "60 s" in the strip; no `source`, no way to tell "Default" from "Yours"; no summary on a
 *   block, and every part on the page is a bare id with no explanation under it.
 *
 *   The failure mode is the one that matters on an operator page: an ordinary member holds a valid
 *   session and must still be refused every one of these doors.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=admin-portal-page
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the Portal page in the poster face.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

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

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

/** Register an owner and come back with a token. The first owner of a fresh node is the operator. */
async function owner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

console.log('\n🧪 Admin Portal page — the reads behind the answer\n');

const operatorName = `pt-op-${Date.now()}`;
const memberName = `pt-member-${Date.now()}`;
let operatorToken = '';
let memberToken = '';

await test('Register the operator and an ordinary member', async () => {
    operatorToken = await owner(operatorName);
    memberToken = await owner(memberName);
    const roles = (tok: string) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).roles as string[];
    assert(roles(operatorToken).includes('operator'), `the first owner is the operator, got ${JSON.stringify(roles(operatorToken))}`);
    assert(!roles(memberToken).includes('operator'), 'the second owner is an ordinary member');
});

// ── Section 01: what visitors see right now ──────────────────────────────────

await test('GET /v1/site — the page has every fact its first section states', async () => {
    const { status, body } = await json('/v1/site', { headers: auth(operatorToken) });
    assert(status === 200, `status ${status}`);
    const meta = body.data?.meta ?? body.data;
    assert(typeof meta.has_custom_template === 'boolean',
        'without has_custom_template the page cannot say whether visitors get an HTML page of yours');
    assert(Number.isFinite(meta.cache_ttl_seconds),
        'without cache_ttl_seconds the "60 s Delay" cell in the strip has no number to print');
    assert(typeof meta.base_url === 'string' && meta.base_url.length > 0,
        'the first row names the address a visitor types');
});

await test('A fresh node reports no HTML page of the operator\'s own', async () => {
    const { body } = await json('/v1/site', { headers: auth(operatorToken) });
    const meta = body.data?.meta ?? body.data;
    assert(meta.has_custom_template === false, 'nothing has been uploaded yet');
});

// ── Section 02: the parts, and what each one is ──────────────────────────────

await test('GET /v1/site/layout/portal — the parts, their order, and whose arrangement it is', async () => {
    const { status, body } = await json('/v1/site/layout/portal', { headers: auth(operatorToken) });
    assert(status === 200, `status ${status}`);
    assert(body.data.source === 'default',
        `source "${body.data.source}": without it the big word cannot be "Default" rather than "Yours"`);
    const blocks = body.data.layout.blocks;
    assert(Array.isArray(blocks) && blocks.length > 0, 'the built-in front page is not empty');
    assert(blocks.every((b: any) => typeof b.key === 'string' && typeof b.id === 'string'),
        'every part carries the key the row and the editor are addressed by');
    assert(Array.isArray(body.data.problems),
        'problems is the list the page prints as "Left out when the page was read"');
});

await test('GET /v1/site/blocks?surface=portal — every part says what it is', async () => {
    const { status, body } = await json('/v1/site/blocks?surface=portal', { headers: auth(operatorToken) });
    assert(status === 200, `status ${status}`);
    const blocks = body.data.blocks as any[];
    assert(blocks.length > 0, 'the catalogue is not empty');
    for (const b of blocks) {
        assert(typeof b.label_key === 'string' && b.label_key.startsWith('surface.blocks.'),
            `${b.id} has no label key, so its row would print a raw id`);
        assert(typeof b.summary === 'string' && b.summary.length > 10,
            `${b.id} has no summary, so its row would have no sentence under the name`);
    }
    const freeform = blocks.find(b => b.id === 'common.freeform');
    assert(!!freeform, 'the part an operator writes themselves is offered');
});

await test('A part\'s settings are declared, so the row can print them as chips', async () => {
    const { body } = await json('/v1/site/blocks?surface=portal', { headers: auth(operatorToken) });
    const hero = (body.data.blocks as any[]).find(b => b.id === 'portal.showroom-hero');
    assert(!!hero, 'the headline part is offered on the front page');
    assert(hero.props?.picture?.type === 'boolean',
        'the headline part declares its picture setting, which the row shows as "picture: on"');
    assert(typeof hero.max_per_surface === 'number',
        'without max_per_surface the picker cannot grey a part that is already here as often as allowed');
});

// ── The write the page's one dark button makes ───────────────────────────────

await test('PUT /v1/site/layout/portal — hiding a part and saving makes the page the operator\'s own', async () => {
    const read = await json('/v1/site/layout/portal', { headers: auth(operatorToken) });
    const blocks = read.body.data.layout.blocks.map((b: any, i: number) => (i === 1 ? { ...b, hidden: true } : b));
    const put = await json('/v1/site/layout/portal', {
        method: 'PUT',
        headers: auth(operatorToken),
        body: JSON.stringify({ v: 1, blocks }),
    });
    assert(put.status === 200, `status ${put.status}: ${JSON.stringify(put.body.error)}`);
    const after = await json('/v1/site/layout/portal', { headers: auth(operatorToken) });
    assert(after.body.data.source === 'stored', 'the page now says "Yours" rather than "Default"');
    assert(after.body.data.layout.blocks.filter((b: any) => b.hidden).length === 1,
        'exactly one part is hidden, which is the number the strip prints');
});

await test('DELETE /v1/site/layout/portal — back to the default layout', async () => {
    const del = await json('/v1/site/layout/portal', { method: 'DELETE', headers: auth(operatorToken) });
    assert(del.status === 200, `status ${del.status}`);
    const after = await json('/v1/site/layout/portal', { headers: auth(operatorToken) });
    assert(after.body.data.source === 'default', 'the big word is "Default" again');
    assert(after.body.data.layout.blocks.every((b: any) => !b.hidden), 'nothing is hidden any more');
});

// ── The refusal: a member holds a valid session and still gets none of it ────

// The site metadata is public on purpose — it is what the front page itself reads — so the refusals
// below are the doors that actually decide something: the catalogue and the write.
await test('The site metadata answers without a session, as the front page needs', async () => {
    const { status, body } = await json('/v1/site');
    assert(status === 200, `expected 200, got ${status}`);
    const meta = body.data?.meta ?? body.data;
    assert(Number.isFinite(meta.cache_ttl_seconds), 'the same fact, with or without a session');
});

await test('An ordinary member is refused the block catalogue', async () => {
    const { status } = await json('/v1/site/blocks?surface=portal', { headers: auth(memberToken) });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('An ordinary member cannot arrange the front page', async () => {
    const { status } = await json('/v1/site/layout/portal', {
        method: 'PUT',
        headers: auth(memberToken),
        body: JSON.stringify({ v: 1, blocks: [] }),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('Nobody at all may arrange it without a session', async () => {
    const { status } = await json('/v1/site/layout/portal', {
        method: 'PUT',
        body: JSON.stringify({ v: 1, blocks: [] }),
    });
    assert(status === 401, `expected 401, got ${status}`);
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
