/**
 * @file test/e2e-admin-cortex-page.ts
 * @description E2E for the reads and writes behind the admin Cortex extensions page: the listing
 *   the whole page is arranged by, the detail behind one opened cortex, what a deactivation takes
 *   and what it leaves, and the refusals.
 *
 *   THE ASSERTION THAT MATTERS is that the listing says how many apps load each cortex, and names
 *   them. The page sorts by that number, groups by it, and puts it in the confirmation before it
 *   switches anything off. It was in the answer for months while the page threw it away and offered
 *   Deactivate as a one-click button.
 *
 *   THE SECOND ONE is what survives a deactivation. The page tells an operator that the files and
 *   the data the extension wrote stay put, so turning it back on restores everything. That is a
 *   promise made on screen, and this suite holds the server to it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=admin-cortex-page
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

console.log('\n🧪 Admin Cortex extensions page — the listing every switch-off decision is made from\n');

const stamp = Date.now();
const operatorName = `cxop${stamp}`;
const makerName = `cxmaker${stamp}`;
const strangerName = `cxother${stamp}`;
const CX = `suitecx${stamp}`;
const APP = 'cortex-reader.html';
const SEED_KEY = `suite-seed-${stamp}`;

let operatorToken = '';
let makerToken = '';
let strangerToken = '';

/** One cortex with four kinds of piece in it, which is what the detail screen has rows for. */
const manifest = (namespace: string) => `apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${CX}
  namespace: ${namespace}
  description: Fixture for the admin cortex page suite.
  author: ${namespace}
  tags: [suite, fixture]
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: schema
      name: suite-shape
      key_pattern: "suite-cx:*"
      apply_to: prefix
      schema:
        type: object
        properties:
          note:
            type: string
    - type: prompt
      name: suite-instruction
      content: |
        A written instruction the page shows as one of the pieces.
    - type: seed-data
      entries:
        - key: "${SEED_KEY}"
          value:
            note: written when the extension was turned on
    - type: lib
      name: suitelib
      filename: suite.js
      exports: [hello]
      api_surface: hello()
`;

const cortexOf = (body: any) => (body.data?.extensions as any[]).find(e => e.name === CX);

await test('Register the operator, the person who installs, and a bystander', async () => {
    operatorToken = await owner(operatorName);
    makerToken = await owner(makerName);
    strangerToken = await owner(strangerName);
    const roles = (tok: string) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).roles as string[];
    assert(roles(operatorToken).includes('operator'), 'the first owner is the operator');
    assert(!roles(makerToken).includes('operator'), 'the second is not');
});

await test('The cortex installs with its four kinds of piece, and is off until it is turned on', async () => {
    const res = await json('/v1/cortex', {
        method: 'POST',
        headers: auth(makerToken),
        body: JSON.stringify({ manifest: manifest(makerName), libs: { 'suite.js': 'window.AIMEAT = window.AIMEAT || {}; AIMEAT.suite = { hello: () => "hi" };' } }),
    });
    assert(res.status === 201, `install: ${res.status} ${JSON.stringify(res.body.error)}`);
    assert(res.body.data.component_count === 4, `four pieces, got ${res.body.data.component_count}`);
    assert(res.body.data.status === 'inactive', 'installing does not turn it on, which is why the page has an On column');
});

// ── What the listing carries, and why every arrangement on the page depends on it ────────────

await test('The listing carries what the page sorts, groups and counts by', async () => {
    const act = await json(`/v1/cortex/${encodeURIComponent(CX)}/activate`, { method: 'POST', headers: auth(makerToken) });
    assert(act.status === 200, `activate: ${act.status} ${JSON.stringify(act.body.error)}`);

    const { status, body } = await json('/v1/cortex', { headers: auth(operatorToken) });
    assert(status === 200, `status ${status}`);
    const row = cortexOf(body);
    assert(!!row, 'the cortex just installed is listed to the operator');
    assert(row.used_by && typeof row.used_by.apps === 'number' && Array.isArray(row.used_by.app_names),
        'used_by is the number the page sorts by and the names it prints under each row');
    assert(row.installed_by === makerName, 'who installed it, which is how the page tells this site\'s own kit from a person\'s');
    assert(typeof row.installed_at === 'string', 'the install day, which is what groups a batch installed in one sitting');
    assert(Array.isArray(row.component_types) && row.component_types.includes('lib'),
        'the kinds of piece, printed in the last column');
    assert(row.status === 'active' && row.visibility === 'private' && row.version === '1.0.0',
        'status, who may read it, and the version');
});

await test('Nothing loads it yet, which is the page\'s whole third section', async () => {
    const { body } = await json('/v1/cortex', { headers: auth(operatorToken) });
    assert(cortexOf(body).used_by.apps === 0, 'no app asks for it');
});

await test('An app that loads it is counted, and named', async () => {
    const html = `<!doctype html><title>Reader</title><body>`
        + `<script src="/v1/cortex/${CX}/libs/suite.js"></script></body>`;
    const pub = await json('/v1/apps', {
        method: 'POST',
        headers: auth(makerToken),
        body: JSON.stringify({
            filename: APP,
            content: Buffer.from(html, 'utf8').toString('base64'),
            description: 'An app published by the cortex-page suite so one cortex has a dependant.',
            manifest: { name: 'Cortex Reader' },
        }),
    });
    assert(pub.status === 200 || pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body.error)}`);

    const { body } = await json('/v1/cortex', { headers: auth(operatorToken) });
    const row = cortexOf(body);
    assert(row.used_by.apps === 1, `one app loads it, got ${row.used_by.apps}`);
    assert(row.used_by.app_names.includes(`${makerName}/${APP}`),
        `the confirmation names the app it would break, got ${JSON.stringify(row.used_by.app_names)}`);
});

// ── One cortex opened ────────────────────────────────────────────────────────────────────────

await test('The detail carries the pieces, what turning it on put here, and the versions kept', async () => {
    const { status, body } = await json(`/v1/cortex/${encodeURIComponent(CX)}`, { headers: auth(operatorToken) });
    assert(status === 200, `status ${status}`);
    const ext = body.data;
    const kinds = (ext.components as any[]).map(c => c.type).sort();
    assert(JSON.stringify(kinds) === JSON.stringify(['lib', 'prompt', 'schema', 'seed-data']),
        `four kinds of piece, got ${JSON.stringify(kinds)}`);
    const lib = (ext.components as any[]).find(c => c.type === 'lib');
    assert(lib.filename === 'suite.js' && Array.isArray(lib.exports),
        'the file and what it gives an app, which is the line the page prints under a file');
    const schema = (ext.components as any[]).find(c => c.type === 'schema');
    assert(schema.key_pattern === 'suite-cx:*', 'the keys a shape is checked against');

    const a = ext.activation_artifacts;
    assert(a && a.promptKeys.length === 1 && a.schemaKeys.length === 1,
        'turning it on put an instruction and a shape here');
    assert(a.seedDataKeys.includes(SEED_KEY), 'and wrote one record into memory');
    assert(a.libFiles.includes('suite.js'), 'and started serving one file');
    assert(Array.isArray(ext.versions) && ext.versions.length === 1 && ext.versions[0].version === '1.0.0',
        'one copy kept, which is what an app pinning a version by name keeps getting');
});

// ── The promise the page makes about turning one off ─────────────────────────────────────────

await test('Turning it off takes the instruction and the shape back out', async () => {
    const res = await json(`/v1/cortex/${encodeURIComponent(CX)}/deactivate`, { method: 'POST', headers: auth(operatorToken) });
    assert(res.status === 200, `deactivate: ${res.status} ${JSON.stringify(res.body.error)}`);
    const { body } = await json(`/v1/cortex/${encodeURIComponent(CX)}`, { headers: auth(operatorToken) });
    assert(body.data.status === 'inactive', 'it is off');
    assert(body.data.activation_artifacts.promptKeys.length === 0
        && body.data.activation_artifacts.schemaKeys.length === 0,
        'the instruction and the shape are gone, which is what the page says goes');
});

await test('...and leaves the file and the data it wrote, which is what the page says stays', async () => {
    const { body } = await json(`/v1/cortex/${encodeURIComponent(CX)}`, { headers: auth(operatorToken) });
    const a = body.data.activation_artifacts;
    assert(a.seedDataKeys.includes(SEED_KEY),
        'the record it wrote belongs to whoever owns that memory now, and no switch here takes it back');
    assert(a.libFiles.includes('suite.js'), 'the file is still stored, so turning it back on needs no re-upload');
});

await test('Turning it back on puts everything back', async () => {
    const res = await json(`/v1/cortex/${encodeURIComponent(CX)}/activate`, { method: 'POST', headers: auth(operatorToken) });
    assert(res.status === 200, `activate: ${res.status} ${JSON.stringify(res.body.error)}`);
    const { body } = await json(`/v1/cortex/${encodeURIComponent(CX)}`, { headers: auth(operatorToken) });
    assert(body.data.status === 'active', 'on again');
    assert(body.data.activation_artifacts.promptKeys.length === 1
        && body.data.activation_artifacts.schemaKeys.length === 1,
        'the pieces are back, which is why off is a decision an operator can take back');
});

// ── Who may read the insides, and who may change them ────────────────────────────────────────

await test('A private cortex is not readable by a bystander, and says only that it is not there', async () => {
    const { status } = await json(`/v1/cortex/${encodeURIComponent(CX)}`, { headers: auth(strangerToken) });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('Making it public lets anyone signed in read it, and the listing says so', async () => {
    const res = await json(`/v1/cortex/${encodeURIComponent(CX)}/visibility`, {
        method: 'POST', headers: auth(operatorToken), body: JSON.stringify({ visibility: 'public' }),
    });
    assert(res.status === 200, `visibility: ${res.status} ${JSON.stringify(res.body.error)}`);
    const { body } = await json('/v1/cortex', { headers: auth(operatorToken) });
    assert(cortexOf(body).visibility === 'public', 'the word on the row changed');
    const asStranger = await json(`/v1/cortex/${encodeURIComponent(CX)}`, { headers: auth(strangerToken) });
    assert(asStranger.status === 200, `a bystander may now read it, got ${asStranger.status}`);
});

await test('A bystander still cannot switch it off or throw it away', async () => {
    const off = await json(`/v1/cortex/${encodeURIComponent(CX)}/deactivate`, { method: 'POST', headers: auth(strangerToken) });
    assert(off.status === 403, `deactivate expected 403, got ${off.status}`);
    const gone = await json(`/v1/cortex/${encodeURIComponent(CX)}`, { method: 'DELETE', headers: auth(strangerToken) });
    assert(gone.status === 403, `delete expected 403, got ${gone.status}`);
});

await test('Nobody at all may throw one away without a session', async () => {
    const { status } = await json(`/v1/cortex/${encodeURIComponent(CX)}`, { method: 'DELETE' });
    assert(status === 401, `expected 401, got ${status}`);
});

await test('The operator removes it for good, and the listing no longer has it', async () => {
    const res = await json(`/v1/cortex/${encodeURIComponent(CX)}`, { method: 'DELETE', headers: auth(operatorToken) });
    assert(res.status === 200, `delete: ${res.status} ${JSON.stringify(res.body.error)}`);
    const { body } = await json('/v1/cortex', { headers: auth(operatorToken) });
    assert(!cortexOf(body), 'gone, which is why this one sits behind a typed name on the page');
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
