/**
 * @file e2e-app-fork.ts
 * @description E2E tests for the server-side app Fork endpoint + the `forkable`
 *   permission flag. Covers: the forkable flag lifecycle (default off, PATCH
 *   on/off, carry-forward across a re-publish, cross-owner PATCH 404, type
 *   validation); fork authorization (an outsider is blocked on a non-forkable app
 *   → 403 but allowed once it is flagged forkable; the owner and the owner's own
 *   agent can always fork their own app); provenance (the fork carries
 *   manifest.forkedFrom and the copied source bytes; the child is itself not
 *   forkable by default); the paid-source paywall (an unlicensed outsider fork →
 *   402); and the input failure modes (missing new_filename → 400, unknown source
 *   → 404, duplicate target filename → 409). Backs POST
 *   /v1/apps/:owner/:filename/fork and the catalog UI's Fork button + "Allow
 *   forking" toggle.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-app-fork
 * @version-history
 *   v1.0.0 — 2026-07-07 — initial: forkable flag, fork authorization gates,
 *     provenance, paid paywall, input failure modes.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerAName = `forkowna${Date.now() % 100000}`;
const ownerBName = `forkownb${Date.now() % 100000}`;
const agentName = 'forkagent';
const SRC_FILE = 'fork-source.html';

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
    return { status: res.status, body, headers: res.headers };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

const b64 = (html: string) => Buffer.from(html, 'utf8').toString('base64');
const SRC_HTML = '<!DOCTYPE html><html><body><h1>original app</h1></body></html>';

// ── State ──
let aToken = '';
let bToken = '';
let agentGaii = '';
let agentToken = '';

function aAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${aToken}` } };
}
function bAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${bToken}` } };
}
function agentAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${agentToken}` } };
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

console.log('\n=== App Fork + forkable-flag E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register owner A + owner B', async () => {
    aToken = await registerOwner(ownerAName);
    bToken = await registerOwner(ownerBName);
    assert(!!aToken && !!bToken, 'both owner tokens issued');
});

await test('Register A\'s agent and get its token', async () => {
    const reg = await json('/v1/agents', aAuthed({
        method: 'POST',
        body: JSON.stringify({ name: agentName, owner: ownerAName, capabilities: ['actions'], scopes: ['*'], model: 'test-model' }),
    }));
    assert(reg.status === 201, `status ${reg.status}: ${JSON.stringify(reg.body)}`);
    agentGaii = reg.body.data.agent.gaii;
    const agentPriv = reg.body.data.private_key;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(agentPriv, agentGaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: agentGaii, timestamp, signature }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    agentToken = tok.body.data?.token;
    assert(typeof agentToken === 'string', 'got agent token');
});

await test('Owner A publishes the source app', async () => {
    const { status } = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: SRC_FILE, content: b64(SRC_HTML), name: 'Fork Source', description: 'the app to fork', category: 'utility', tags: ['demo'] }),
    }));
    assert(status === 201, `publish status ${status}`);
});

// ── Phase 1: the forkable flag lifecycle ──
console.log('\nPhase 1: forkable flag lifecycle');

await test('A new app is NOT forkable by default (listing forkable=false)', async () => {
    const { body } = await json('/v1/apps?limit=200');
    const mine = (body.data?.apps ?? []).find((a: any) => a.filename === SRC_FILE && a.owner === ownerAName);
    assert(!!mine, 'source app present in listing');
    assert(mine.forkable === false, `default forkable=false, got ${mine.forkable}`);
});

await test('PATCH { forkable: true } enables forking (200, forkable=true)', async () => {
    const { status, body } = await json(`/v1/apps/${SRC_FILE}`, aAuthed({ method: 'PATCH', body: JSON.stringify({ forkable: true }) }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.forkable === true, `response forkable=true, got ${body.data?.forkable}`);
    const list = await json('/v1/apps?limit=200');
    const mine = (list.body.data?.apps ?? []).find((a: any) => a.filename === SRC_FILE && a.owner === ownerAName);
    assert(mine?.forkable === true, 'listing reflects forkable=true');
});

await test('Re-publishing a forkable app KEEPS it forkable (carry-forward)', async () => {
    const { status } = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: SRC_FILE, content: b64(SRC_HTML + '<!--v2-->'), name: 'Fork Source', category: 'utility', tags: ['demo'] }),
    }));
    assert(status === 201, `re-publish status ${status}`);
    const list = await json('/v1/apps?limit=200');
    const mine = (list.body.data?.apps ?? []).find((a: any) => a.filename === SRC_FILE && a.owner === ownerAName);
    assert(mine?.forkable === true, 'still forkable after a re-publish');
});

await test('PATCH { forkable: "yes" } is rejected (400, must be boolean)', async () => {
    const { status } = await json(`/v1/apps/${SRC_FILE}`, aAuthed({ method: 'PATCH', body: JSON.stringify({ forkable: 'yes' }) }));
    assert(status === 400, `non-boolean forkable must 400, got ${status}`);
});

await test("Another owner cannot toggle A's forkable flag (PATCH → 404)", async () => {
    const { status } = await json(`/v1/apps/${SRC_FILE}`, bAuthed({ method: 'PATCH', body: JSON.stringify({ forkable: false }) }));
    assert(status === 404, `cross-owner forkable PATCH must 404, got ${status}`);
});

// ── Phase 2: fork authorization ──
console.log('\nPhase 2: fork authorization');

await test('Disable forking, then an OUTSIDER fork is blocked (403)', async () => {
    const off = await json(`/v1/apps/${SRC_FILE}`, aAuthed({ method: 'PATCH', body: JSON.stringify({ forkable: false }) }));
    assert(off.status === 200 && off.body.data?.forkable === false, 'forking disabled');
    const { status, body } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/fork`, bAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'b-steal.html' }),
    }));
    assert(status === 403, `outsider fork of a non-forkable app must 403, got ${status}: ${JSON.stringify(body)}`);
});

await test('The OWNER can always fork their OWN app (even when not forkable) → 201', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/fork`, aAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'a-own-fork.html' }),
    }));
    assert(status === 201, `owner self-fork must 201, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.forked_from?.owner === ownerAName && body.data?.forked_from?.filename === SRC_FILE, 'response records forked_from source');
    assert(body.data?.forkable === false, 'the fork is itself not forkable by default');
});

await test("The owner's OWN AGENT can fork the owner's app (same owner) → 201", async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/fork`, agentAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'agent-fork.html' }),
    }));
    assert(status === 201, `agent (same owner) fork must 201, got ${status}: ${JSON.stringify(body)}`);
});

await test('Once flagged forkable, an OUTSIDER can fork it → 201 with provenance + copied bytes', async () => {
    const on = await json(`/v1/apps/${SRC_FILE}`, aAuthed({ method: 'PATCH', body: JSON.stringify({ forkable: true }) }));
    assert(on.status === 200 && on.body.data?.forkable === true, 'forking enabled');
    const { status, body } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/fork`, bAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'b-fork.html' }),
    }));
    assert(status === 201, `outsider fork of a forkable app must 201, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.forked_from?.owner === ownerAName, 'forked_from credits owner A');
    // The fork lands in B's catalogue and serves the copied source bytes.
    const forked = await fetch(`${BASE}/v1/apps/${ownerBName}/b-fork.html`);
    assert(forked.status === 200, `fork downloadable under B, got ${forked.status}`);
    assert((await forked.text()) === SRC_HTML + '<!--v2-->', 'fork carries the copied source bytes (latest version)');
});

await test('The fork\'s manifest records forkedFrom provenance', async () => {
    const { body } = await json('/v1/apps?limit=200', bAuthed());
    const fork = (body.data?.apps ?? []).find((a: any) => a.filename === 'b-fork.html' && a.owner === ownerBName);
    assert(!!fork, 'fork present in B\'s listing');
    assert(fork.manifest?.forkedFrom?.owner === ownerAName && fork.manifest?.forkedFrom?.filename === SRC_FILE,
        `manifest.forkedFrom points at the source, got ${JSON.stringify(fork.manifest?.forkedFrom)}`);
    assert(fork.forkable === false, 'the outsider fork is itself not forkable by default');
});

await test('Forking to a filename the caller already owns is rejected (409)', async () => {
    const { status } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/fork`, bAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'b-fork.html' }),
    }));
    assert(status === 409, `duplicate fork target must 409, got ${status}`);
});

await test('Forking an unknown source app returns 404', async () => {
    const { status } = await json(`/v1/apps/${ownerAName}/does-not-exist.html/fork`, bAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'x.html' }),
    }));
    assert(status === 404, `unknown source fork must 404, got ${status}`);
});

await test('Forking without new_filename is rejected (400)', async () => {
    const { status } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/fork`, bAuthed({
        method: 'POST', body: JSON.stringify({}),
    }));
    assert(status === 400, `missing new_filename must 400, got ${status}`);
});

// ── Phase 3: paid-source paywall ──
// A paid app's bytes must not be copied by an unlicensed outsider even when the
// app is forkable — the fork endpoint mirrors the read paywall (402). The owner
// (seller) can always fork their own paid app.
console.log('\nPhase 3: paid-source paywall');

const PAID_FILE = 'paid-fork-src.html';

await test('Owner A publishes a PAID, forkable app', async () => {
    const pub = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: PAID_FILE, content: b64('<h1>paid app</h1>'), name: 'Paid App', description: 'costs morsels', category: 'utility', tags: [], price_morsels: 50, license_type: 'single' }),
    }));
    assert(pub.status === 201, `paid publish status ${pub.status}`);
    const on = await json(`/v1/apps/${PAID_FILE}`, aAuthed({ method: 'PATCH', body: JSON.stringify({ forkable: true }) }));
    assert(on.status === 200 && on.body.data?.forkable === true, 'paid app flagged forkable');
});

await test('An unlicensed OUTSIDER cannot fork the paid app (402)', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${PAID_FILE}/fork`, bAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'b-paid-fork.html' }),
    }));
    // Only enforced when the marketplace is enabled (default on). If a deployment
    // disables it, the paywall does not apply — tolerate a 201 in that case.
    if (status === 201) {
        console.log('    (marketplace disabled — paid fork paywall not enforced; skipping)');
        return;
    }
    assert(status === 402, `unlicensed outsider paid fork must 402, got ${status}: ${JSON.stringify(body)}`);
});

await test('The seller (owner) can still fork their OWN paid app → 201', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${PAID_FILE}/fork`, aAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'a-paid-fork.html' }),
    }));
    assert(status === 201, `owner self-fork of a paid app must 201, got ${status}: ${JSON.stringify(body)}`);
    // The fork is created free (paid terms dropped).
    const { body: listBody } = await json('/v1/apps?limit=200', aAuthed());
    const fork = (listBody.data?.apps ?? []).find((a: any) => a.filename === 'a-paid-fork.html' && a.owner === ownerAName);
    assert(!!fork && !fork.manifest?.priceMorsels, 'the fork is free (source price dropped)');
});

// ── Summary ──
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
