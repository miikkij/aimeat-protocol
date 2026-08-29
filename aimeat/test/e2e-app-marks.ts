/**
 * @file e2e-app-marks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E: an app owner's marks (the badge and install-chip switches) and the named
 *   reviewer, through PATCH /v1/apps/:filename, and what the served bytes and the listing then
 *   carry.
 *
 *   What it proves:
 *     - the badge is on by default and comes off the served inline HTML when the owner says so;
 *     - the switches are independent and an unknown mark is refused by name;
 *     - the reviewer's name is reserved to the OWNER PRINCIPAL: the owner's own agent, holding
 *       every scope, is refused with 403 (the owner name is not a principal), while the same
 *       agent may flip the badge;
 *     - a declaration lands in the served head as `<meta name="author">` and
 *       `<meta name="aimeat-reviewed-by">`, is appended to the log with the declaring GHII, and
 *       a withdrawal removes the tags and appends a second entry;
 *     - the listing shows the reviewer's NAME to everyone and the LOG only to the owner;
 *     - a republish carries the declaration forward;
 *     - a different owner cannot reach the app (404), and the name is bounded.
 *
 *   Runs against a live server (E2E_BASE, default http://localhost:40251). No AI provenance
 *   record is minted here, so the visible-label half is proven in test/unit/app-marks.test.ts.
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerAName = `marksowna${Date.now() % 100000}`;
const ownerBName = `marksownb${Date.now() % 100000}`;
const agentName = 'marksagent';
const FILE = 'marks-app.html';
const REVIEWER = 'Maija Meikäläinen';

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
const HTML_V1 = '<!DOCTYPE html><html><head><title>Marks</title></head><body><h1>marks app</h1></body></html>';
const HTML_V2 = '<!DOCTYPE html><html><head><title>Marks 2</title></head><body><h1>marks app, second version</h1></body></html>';

let aToken = '';
let bToken = '';
let agentToken = '';

const bearer = (tok: string) => (opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${tok}` } });
const aAuthed = (o: RequestInit = {}) => bearer(aToken)(o);
const bAuthed = (o: RequestInit = {}) => bearer(bToken)(o);
const agentAuthed = (o: RequestInit = {}) => bearer(agentToken)(o);

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

async function servedInline(): Promise<string> {
    const res = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE}?mode=inline`);
    assert(res.status === 200, `inline serve status ${res.status}`);
    return res.text();
}

async function patchA(body: unknown) {
    return json(`/v1/apps/${FILE}`, aAuthed({ method: 'PATCH', body: JSON.stringify(body) }));
}

async function listingRow(token: string) {
    const { body } = await json('/v1/apps?limit=200', bearer(token)());
    const apps: any[] = body?.data?.apps ?? [];
    return apps.find((a) => a.filename === FILE && a.owner === ownerAName);
}

console.log('\n=== App marks + named reviewer E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register owner A + owner B', async () => {
    aToken = await registerOwner(ownerAName);
    bToken = await registerOwner(ownerBName);
    assert(!!aToken && !!bToken, 'both owner tokens issued');
});

await test('Register A\'s agent (every scope) and get its token', async () => {
    const reg = await json('/v1/agents', aAuthed({
        method: 'POST',
        body: JSON.stringify({ name: agentName, owner: ownerAName, capabilities: ['actions'], scopes: ['*'], model: 'test-model' }),
    }));
    assert(reg.status === 201, `status ${reg.status}: ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    agentToken = tok.body.data?.token;
    assert(typeof agentToken === 'string', 'got agent token');
});

await test('Owner A publishes the app', async () => {
    const { status, body } = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: FILE, content: b64(HTML_V1), name: 'Marks App', description: 'the app with marks', category: 'utility', tags: ['demo'] }),
    }));
    assert(status === 201, `publish status ${status}: ${JSON.stringify(body)}`);
});

console.log('\nPhase 1: the badge and install switches');

await test('Served inline HTML carries the badge by default', async () => {
    const html = await servedInline();
    assert(html.includes('id="aimeat-app-badge"'), 'badge present on a fresh app');
    assert(!html.includes('aimeat-reviewed-by'), 'no reviewer tag before a declaration');
});

await test('PATCH marks {badge:false} takes the badge off the served bytes', async () => {
    const { status, body } = await patchA({ marks: { badge: false } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.marks.badge === false, 'response says badge off');
    assert(body.data.marks.install === true, 'install untouched (still on)');
    assert(/badge is no longer shown/.test(body.data.note), `note: ${body.data.note}`);
    const html = await servedInline();
    assert(!html.includes('id="aimeat-app-badge"'), 'badge gone from the served HTML');
});

await test('PATCH marks {install:false} is independent of the badge', async () => {
    const { status, body } = await patchA({ marks: { install: false } });
    assert(status === 200, `status ${status}`);
    assert(body.data.marks.install === false && body.data.marks.badge === false, 'both off, each by its own call');
});

await test('An unknown mark is refused by name', async () => {
    const { status, body } = await patchA({ marks: { sticker: true } });
    assert(status === 400, `status ${status}`);
    assert(/marks\.sticker/.test(body.error?.message ?? ''), `message: ${body.error?.message}`);
});

await test('A non-boolean mark is refused', async () => {
    const { status } = await patchA({ marks: { badge: 'no' } });
    assert(status === 400, `status ${status}`);
});

await test('The owner\'s agent may put the badge back (marks are the owner\'s catalogue)', async () => {
    const { status, body } = await json(`/v1/apps/${FILE}`, agentAuthed({ method: 'PATCH', body: JSON.stringify({ marks: { badge: true } }) }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.marks.badge === true, 'badge back on');
    const html = await servedInline();
    assert(html.includes('id="aimeat-app-badge"'), 'badge served again');
});

console.log('\nPhase 2: the named reviewer');

await test('The owner\'s agent, holding every scope, is refused the declaration (403)', async () => {
    const { status, body } = await json(`/v1/apps/${FILE}`, agentAuthed({ method: 'PATCH', body: JSON.stringify({ author: REVIEWER }) }));
    assert(status === 403, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'ACCESS_DENIED', `code ${body.error?.code}`);
    const html = await servedInline();
    assert(!html.includes('aimeat-reviewed-by'), 'nothing was written before the refusal');
});

await test('The account holder declares the reviewer', async () => {
    const { status, body } = await patchA({ author: `  ${REVIEWER}  ` });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.authorship?.name === REVIEWER, `name trimmed and stored: ${JSON.stringify(body.data.authorship)}`);
    assert(body.data.authorship.declaredBy === `${ownerAName}@${NODE_ID}`, `declaredBy is the owner GHII: ${body.data.authorship.declaredBy}`);
    assert(Array.isArray(body.data.authorshipLog) && body.data.authorshipLog.length === 1, 'one log entry');
    assert(body.data.authorshipLog[0].action === 'declared' && body.data.authorshipLog[0].name === REVIEWER, 'log entry says declared + name');
    assert(/answers for this app/.test(body.data.note), `note: ${body.data.note}`);
});

await test('The served head carries the name, machine-readable', async () => {
    const html = await servedInline();
    const head = html.slice(0, html.search(/<\/head\s*>/i));
    assert(head.includes(`<meta name="author" content="${REVIEWER}">`), 'meta author in head');
    assert(head.includes(`<meta name="aimeat-reviewed-by" content="${REVIEWER}">`), 'meta aimeat-reviewed-by in head');
});

await test('Declaring the same name again changes nothing and adds no log entry', async () => {
    const { status, body } = await patchA({ author: REVIEWER });
    assert(status === 200, `status ${status}`);
    assert(body.data.authorshipLog.length === 1, 'still one entry');
    assert(/Nothing changed/.test(body.data.note), `note: ${body.data.note}`);
});

await test('The listing: the name is public, the log is the owner\'s', async () => {
    const asB = await listingRow(bToken);
    assert(!!asB, 'B sees the app');
    assert(asB.manifest?.authorship?.name === REVIEWER, 'B sees the reviewer name');
    assert(asB.manifest?.authorshipLog === undefined, 'B does not see the log');
    const asA = await listingRow(aToken);
    assert(Array.isArray(asA.manifest?.authorshipLog) && asA.manifest.authorshipLog.length === 1, 'A sees the log');
    assert(asA.manifest?.marks?.install === false, 'A sees the install switch state');
});

await test('A republish carries the declaration and the switches forward', async () => {
    const { status } = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: FILE, content: b64(HTML_V2), name: 'Marks App', description: 'the app with marks, v2', category: 'utility', tags: ['demo'] }),
    }));
    assert(status === 201 || status === 200, `republish status ${status}`);
    const row = await listingRow(aToken);
    assert(row.version_number >= 2, `version bumped: ${row.version_number}`);
    assert(row.manifest?.authorship?.name === REVIEWER, 'reviewer survived the republish');
    assert(row.manifest?.marks?.install === false, 'install switch survived the republish');
    const html = await servedInline();
    assert(html.includes('second version') && html.includes('aimeat-reviewed-by'), 'new bytes, same reviewer tag');
});

await test('Withdrawing removes the tags and appends a second log entry', async () => {
    const { status, body } = await patchA({ author: null });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.authorship === null, 'no reviewer now');
    assert(body.data.authorshipLog.length === 2, 'two entries');
    assert(body.data.authorshipLog[1].action === 'cleared' && body.data.authorshipLog[1].name === REVIEWER, 'second entry says withdrawn + the name that came off');
    const html = await servedInline();
    assert(!html.includes('aimeat-reviewed-by') && !html.includes('<meta name="author"'), 'tags gone');
});

await test('An empty string withdraws too, and withdrawing twice is not a change', async () => {
    const { status, body } = await patchA({ author: '' });
    assert(status === 200, `status ${status}`);
    assert(body.data.authorshipLog.length === 2, 'no third entry');
});

console.log('\nPhase 3: bounds and other owners');

await test('A name over 120 characters is refused', async () => {
    const { status } = await patchA({ author: 'x'.repeat(121) });
    assert(status === 400, `status ${status}`);
});

await test('A name with a line break is refused', async () => {
    const { status } = await patchA({ author: 'Maija\nMeikäläinen' });
    assert(status === 400, `status ${status}`);
});

await test('A non-string author is refused', async () => {
    const { status } = await patchA({ author: 42 });
    assert(status === 400, `status ${status}`);
});

await test('Owner B cannot reach A\'s app (404)', async () => {
    const { status } = await json(`/v1/apps/${FILE}`, bAuthed({ method: 'PATCH', body: JSON.stringify({ author: 'Somebody Else' }) }));
    assert(status === 404, `status ${status}`);
    const { status: s2 } = await json(`/v1/apps/${FILE}`, bAuthed({ method: 'PATCH', body: JSON.stringify({ marks: { badge: false } }) }));
    assert(s2 === 404, `marks status ${s2}`);
});

await test('Unauthenticated PATCH is refused', async () => {
    const { status } = await json(`/v1/apps/${FILE}`, { method: 'PATCH', body: JSON.stringify({ marks: { badge: false } }) });
    assert(status === 401, `status ${status}`);
});

console.log('\nCleanup');
await test('Delete the app', async () => {
    const { status } = await json(`/v1/apps/${FILE}`, aAuthed({ method: 'DELETE' }));
    assert(status === 200, `delete status ${status}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
