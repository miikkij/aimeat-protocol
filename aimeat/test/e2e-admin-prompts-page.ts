/**
 * @file test/e2e-admin-prompts-page.ts
 * @description E2E for the reads and writes behind the System Prompts page. The page's first
 *   section answers "is anything here different from what the software ships, and what will an
 *   update do to it", and neither question can be answered from a prompt record alone: the version
 *   number rises when a prompt is PUT BACK as well as when it is changed, so v3 says nothing about
 *   whose text is stored.
 *
 *   THE ASSERTION THAT MATTERS is the round trip: change a prompt, see `differs_from_default` turn
 *   true, take the current version, and see it turn false again WHILE THE VERSION NUMBER RISES.
 *   That is the exact case the old page could not tell apart, and the reason the field exists.
 *
 *   The group reset is the page's everyday button, so what it does besides replacing text is
 *   asserted too: it switches a prompt that was off back on, and it says so in its answer.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=admin-prompts-page
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

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

console.log('\n🧪 Admin System Prompts page — who owns a prompt, and what a take does\n');

const operatorName = `pr-op-${Date.now()}`;
const memberName = `pr-member-${Date.now()}`;
let operatorToken = '';
let memberToken = '';
/** A prompt that is the operator's to keep, and one the software rewrites on every boot. */
let mine = '';
let codeOwned = '';
let mineGroup = '';

await test('Register the operator and an ordinary member', async () => {
    operatorToken = await owner(operatorName);
    memberToken = await owner(memberName);
    const roles = (tok: string) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).roles as string[];
    assert(roles(operatorToken).includes('operator'), `the first owner is the operator, got ${JSON.stringify(roles(operatorToken))}`);
    assert(!roles(memberToken).includes('operator'), 'the second owner is an ordinary member');
});

// ── Section 01: the two fields the page cannot work out for itself ───────────

await test('Every row says whose text it is and what an update will do to it', async () => {
    const { status, body } = await json('/v1/admin/prompts', { headers: auth(operatorToken) });
    assert(status === 200, `status ${status}`);
    const prompts = body.data.prompts as any[];
    assert(prompts.length > 0, 'the node seeded its prompts');
    for (const p of prompts) {
        assert(['code', 'yours', 'orphan'].includes(p.source_kind),
            `${p.id} has no source_kind, so the page cannot say whether an edit survives an update`);
        assert(typeof p.differs_from_default === 'boolean',
            `${p.id} has no differs_from_default, so the first section cannot count the changed ones`);
    }
    const yours = prompts.find(p => p.source_kind === 'yours');
    const code = prompts.find(p => p.source_kind === 'code');
    assert(!!yours && !!code, 'both kinds exist on a fresh node');
    mine = yours.id; mineGroup = yours.group; codeOwned = code.id;
});

await test('A freshly seeded node reports nothing changed here', async () => {
    const { body } = await json('/v1/admin/prompts', { headers: auth(operatorToken) });
    const changed = (body.data.prompts as any[]).filter(p => p.differs_from_default);
    assert(changed.length === 0, `expected nothing changed, got ${changed.map(p => p.id).join(', ')}`);
});

await test('The single read carries the same two fields, for the open prompt', async () => {
    const { status, body } = await json(`/v1/admin/prompts/${mine}`, { headers: auth(operatorToken) });
    assert(status === 200, `status ${status}`);
    assert(body.data.prompt.source_kind === 'yours', `source_kind ${body.data.prompt.source_kind}`);
    assert(body.data.prompt.differs_from_default === false, 'unchanged');
});

// ── The round trip the version number cannot describe ────────────────────────

await test('An edit turns differs_from_default true', async () => {
    const before = await json(`/v1/admin/prompts/${mine}`, { headers: auth(operatorToken) });
    const patched = await json(`/v1/admin/prompts/${mine}`, {
        method: 'PATCH',
        headers: auth(operatorToken),
        body: JSON.stringify({ content: before.body.data.prompt.content + '\n\nOne line the operator added.', changeNote: 'e2e' }),
    });
    assert(patched.status === 200, `status ${patched.status}: ${JSON.stringify(patched.body.error)}`);
    assert(patched.body.data.prompt.differs_from_default === true, 'the page would now mark this one Changed');
    assert(patched.body.data.prompt.version === before.body.data.prompt.version + 1, 'the version rose');
});

await test('Taking the current version turns it false again, WHILE the version rises', async () => {
    const before = await json(`/v1/admin/prompts/${mine}`, { headers: auth(operatorToken) });
    const reset = await json(`/v1/admin/prompts/${mine}/reset`, { method: 'POST', headers: auth(operatorToken) });
    assert(reset.status === 200, `status ${reset.status}`);
    const after = reset.body.data.prompt;
    assert(after.differs_from_default === false,
        'the stored text is the shipped one again, which is what the page must say');
    assert(after.version === before.body.data.prompt.version + 1,
        `the version rose to ${after.version}: this is why the number cannot answer "is this mine"`);
});

await test('The operator\'s text is still in the version list after taking the current one', async () => {
    const { status, body } = await json(`/v1/admin/prompts/${mine}/versions`, { headers: auth(operatorToken) });
    assert(status === 200, `status ${status}`);
    const notes = (body.data.versions as any[]).map(v => v.changeNote ?? '');
    assert(notes.some(n => n === 'e2e'), `the edit is kept, so it can be put back: ${JSON.stringify(notes)}`);
});

// ── The group take: the everyday button, and what else it does ───────────────

await test('A group take reports how many it switched back on', async () => {
    const off = await json(`/v1/admin/prompts/${mine}`, {
        method: 'PATCH', headers: auth(operatorToken), body: JSON.stringify({ active: false }),
    });
    assert(off.status === 200 && off.body.data.prompt.active === false, 'the prompt is switched off');

    const group = await json(`/v1/admin/prompts/reset-group/${mineGroup}`, { method: 'POST', headers: auth(operatorToken) });
    assert(group.status === 200, `status ${group.status}`);
    assert(group.body.data.switchedOn >= 1,
        `the answer names what else it did, got switchedOn=${group.body.data.switchedOn}`);
    assert(typeof group.body.data.localesDropped === 'number', 'and how many translations went with it');
    const again = await json(`/v1/admin/prompts/${mine}`, { headers: auth(operatorToken) });
    assert(again.body.data.prompt.active === true, 'a prompt that was off is on again, which the page says before it runs');
});

await test('A group the software does not ship is refused by name', async () => {
    const { status, body } = await json('/v1/admin/prompts/reset-group/not-a-group', { method: 'POST', headers: auth(operatorToken) });
    assert(status === 404, `expected 404, got ${status}`);
    assert(body.error?.code === 'NOT_FOUND', `code ${body.error?.code}`);
});

await test('A prompt the software no longer ships cannot be taken back', async () => {
    const { status, body } = await json('/v1/admin/prompts/seeded-by-a-version-that-is-gone/reset', {
        method: 'POST', headers: auth(operatorToken),
    });
    assert(status === 404, `expected 404, got ${status}`);
    assert(body.error?.code === 'NOT_FOUND', `code ${body.error?.code}`);
});

// ── Switching one off is not "use the shipped text" ──────────────────────────

await test('A prompt that is switched off is served to nobody', async () => {
    const target = await json(`/v1/admin/prompts/${codeOwned}`, { headers: auth(operatorToken) });
    const servedAt = (target.body.data.prompt.usedIn ?? []).find((u: string) => u.startsWith('/v1/prompts/'));
    if (!servedAt) return;   // this prompt is not reachable by a public address; nothing to prove here
    await json(`/v1/admin/prompts/${codeOwned}`, {
        method: 'PATCH', headers: auth(operatorToken), body: JSON.stringify({ active: false }),
    });
    const asVisitor = await json(servedAt);
    assert(asVisitor.status === 404, `expected the caller to be told it is not available, got ${asVisitor.status}`);
    await json(`/v1/admin/prompts/${codeOwned}`, {
        method: 'PATCH', headers: auth(operatorToken), body: JSON.stringify({ active: true }),
    });
});

// ── The refusals ─────────────────────────────────────────────────────────────

await test('An ordinary member is refused the list', async () => {
    const { status } = await json('/v1/admin/prompts', { headers: auth(memberToken) });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('An ordinary member cannot change a prompt', async () => {
    const { status } = await json(`/v1/admin/prompts/${mine}`, {
        method: 'PATCH', headers: auth(memberToken), body: JSON.stringify({ content: 'mine now' }),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('An ordinary member cannot take a group back', async () => {
    const { status } = await json(`/v1/admin/prompts/reset-group/${mineGroup}`, { method: 'POST', headers: auth(memberToken) });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('Nobody at all may do it without a session', async () => {
    const { status } = await json('/v1/admin/prompts/reset-all', { method: 'POST' });
    assert(status === 401, `expected 401, got ${status}`);
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
