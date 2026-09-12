/**
 * @file test/e2e-admin-msm-page.ts
 * @description E2E for the reads and writes behind the admin MSM page: the listing the page is
 *   arranged by, what the public answer keeps back, the detail an operator opens, the two things
 *   editing can change, and the refusals.
 *
 *   THE ASSERTION THAT MATTERS is that the operator's listing says WHERE each manifest points and
 *   WHAT it offers. The record has always held the whole definition and the answer threw it away,
 *   so five manifests describing one RSS feed read as five separate integrations and the page had
 *   no way to say otherwise. The page groups by exactly these two fields.
 *
 *   THE SECOND ONE is the auth variable. A manifest names the environment variable that holds the
 *   key, never the key. The operator is shown the name and the public answer is not, and both
 *   halves are held here: an operator who cannot see the name cannot tell whether the machine is
 *   set up, and a public answer that carries it hands out the shape of somebody's infrastructure.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=admin-msm-page
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

console.log('\n🧪 Admin MSM page — the listing the page is arranged by\n');

const stamp = Date.now();
const operatorName = `msmop${stamp}`;
const strangerName = `msmother${stamp}`;
const FEED_A = `Suite Feed A ${stamp}`;
const FEED_B = `Suite Feed B ${stamp}`;
const GEO = `Suite Geo ${stamp}`;
const KEY_VAR = 'SUITE_MSM_API_KEY';

let operatorToken = '';
let strangerToken = '';

/** One manifest, in the YAML the writing screen sends. */
function manifest(opts: { name: string; url: string; actionId: string; apiKey?: boolean }): string {
    return `version: "1.0"
service:
  name: ${opts.name}
  description: A fixture the admin MSM page suite registers.
  homepage: https://example.test/docs
  category: data
  tags: [suite, fixture]
auth:
${opts.apiKey ? `  type: api_key\n  env_var: ${KEY_VAR}\n  param_name: apikey` : '  type: none'}
actions:
  - id: ${opts.actionId}
    display_name: The one action
    description: Reads something from the other end.
    endpoint:
      method: GET
      url: ${opts.url}
    input:
      q:
        type: string
        required: true
    output:
      body:
        type: string
`;
}

const listed = (body: any, name: string) => (body.data.integrations as any[]).find(m => m.name === name);

await test('Register the operator and a bystander', async () => {
    operatorToken = await owner(operatorName);
    strangerToken = await owner(strangerName);
    const roles = (tok: string) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).roles as string[];
    assert(roles(operatorToken).includes('operator'), 'the first owner is the operator');
    assert(!roles(strangerToken).includes('operator'), 'the second is not');
});

await test('Three manifests register: two at one address, one that offers a shared action name', async () => {
    for (const m of [
        { name: FEED_A, url: 'https://feeds.suite.test/rss.xml', actionId: 'fetch-feed' },
        { name: FEED_B, url: 'https://feeds.suite.test/atom.xml', actionId: 'fetch-rss' },
        { name: GEO, url: 'https://geo.suite.test/search', actionId: 'fetch-feed', apiKey: true },
    ]) {
        const res = await json('/v1/msm', {
            method: 'POST',
            headers: auth(operatorToken),
            body: JSON.stringify({ yaml: manifest(m) }),
        });
        assert(res.status === 200 || res.status === 201,
            `register ${m.name}: ${res.status} ${JSON.stringify(res.body.error ?? res.body)}`);
    }
});

// ── What the page is arranged by ────────────────────────────────────────────────────────────

await test('The operator listing says where each manifest points and what it offers', async () => {
    const { status, body } = await json('/v1/admin/msm', { headers: auth(operatorToken) });
    assert(status === 200, `status ${status}`);
    const a = listed(body, FEED_A);
    assert(!!a, 'the manifest just registered is listed');
    assert(Array.isArray(a.hosts) && a.hosts.includes('feeds.suite.test'),
        `hosts is what the page groups five descriptions of one feed by, got ${JSON.stringify(a.hosts)}`);
    assert(Array.isArray(a.actions) && a.actions.includes('fetch-feed'),
        `actions is the other half of that rule, got ${JSON.stringify(a.actions)}`);
    assert(typeof a.description === 'string' && a.description.length > 0,
        'the description the page prints under each name');
    assert(typeof a.auth_type === 'string' && typeof a.federate === 'boolean' && typeof a.registered_by === 'string',
        'the key it wants, whether it travels, and who wrote it');
});

await test('Two manifests at one address can be told apart from one at another', async () => {
    const { body } = await json('/v1/admin/msm', { headers: auth(operatorToken) });
    const hostsOf = (name: string) => listed(body, name).hosts as string[];
    assert(hostsOf(FEED_A)[0] === hostsOf(FEED_B)[0],
        'the two feed manifests point at the same host, which is what puts them in one set');
    assert(hostsOf(GEO)[0] !== hostsOf(FEED_A)[0], 'the third points somewhere else');
    const actionsOf = (name: string) => listed(body, name).actions as string[];
    assert(actionsOf(GEO)[0] === actionsOf(FEED_A)[0],
        'and offers an action of the same name, which is the other way into a set');
});

// ── The key is a name, and who may read it ─────────────────────────────────────────────────

await test('The operator is told which variable holds the key', async () => {
    const { status, body } = await json(`/v1/admin/msm/${encodeURIComponent(GEO)}`, { headers: auth(operatorToken) });
    assert(status === 200, `status ${status}`);
    assert(body.data.definition?.auth?.envVar === KEY_VAR,
        'without the variable name an operator cannot tell whether the machine is set up for it');
    assert(body.data.auth_type === 'api_key', 'and the kind of key it wants');
    assert(Array.isArray(body.data.definition?.actions) && body.data.definition.actions[0].input?.q?.required === true,
        'the detail carries every action with the fields it takes, which is what the page prints');
});

await test('The public answer keeps the variable name back, and hands out the rest', async () => {
    const { status, body } = await json(`/v1/msm/${encodeURIComponent(GEO)}`);
    assert(status === 200, `a manifest is public: ${status}`);
    const def = body.data.integration.definition;
    // BOTH spellings: the YAML is written snake_case and parseMsm normalises it to camelCase, and
    // the filter that named only the first matched nothing for as long as it had existed.
    assert(def.auth.envVar === undefined && def.auth.env_var === undefined
        && def.auth.envVarSecret === undefined && def.auth.env_var_secret === undefined,
        `the variable name is somebody's infrastructure and is taken out, got ${JSON.stringify(def.auth)}`);
    assert(def.auth.type === 'api_key', 'that a key is needed is not a secret');
    assert(def.actions[0].endpoint.url.includes('geo.suite.test'),
        'the address an AI is told to call is public, which is the point of the manifest');
});

await test('The whole list is readable without signing in', async () => {
    const { status, body } = await json('/v1/msm');
    assert(status === 200, `status ${status}`);
    assert((body.data.integrations as any[]).some(m => m.name === FEED_A), 'and carries what is registered');
});

// ── The two things editing can change ──────────────────────────────────────────────────────

await test('Editing changes the description and whether it travels, and nothing else', async () => {
    const before = await json(`/v1/admin/msm/${encodeURIComponent(FEED_A)}`, { headers: auth(operatorToken) });
    const url = before.body.data.definition.actions[0].endpoint.url;

    const res = await json(`/v1/admin/msm/${encodeURIComponent(FEED_A)}`, {
        method: 'PUT',
        headers: auth(operatorToken),
        body: JSON.stringify({ description: 'Reworded by the suite.', federate: true }),
    });
    assert(res.status === 200, `edit: ${res.status} ${JSON.stringify(res.body.error)}`);

    const after = await json(`/v1/admin/msm/${encodeURIComponent(FEED_A)}`, { headers: auth(operatorToken) });
    assert(after.body.data.definition.service.description === 'Reworded by the suite.', 'the description moved');
    assert(after.body.data.federate === true, 'and it now travels to peers');
    assert(after.body.data.definition.actions[0].endpoint.url === url,
        'the address is the manifest itself and editing does not touch it');
    assert(after.body.data.updated_at !== after.body.data.registered_at,
        'the edit is stamped, which is what the page counts days of quiet from');
});

// ── The refusals ───────────────────────────────────────────────────────────────────────────

await test('A bystander cannot read the operator listing', async () => {
    const { status } = await json('/v1/admin/msm', { headers: auth(strangerToken) });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('A bystander cannot delete a manifest somebody else registered', async () => {
    const { status } = await json(`/v1/msm/${encodeURIComponent(FEED_B)}`, {
        method: 'DELETE', headers: auth(strangerToken),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('Nobody at all may delete one without a session', async () => {
    const { status } = await json(`/v1/msm/${encodeURIComponent(FEED_B)}`, { method: 'DELETE' });
    assert(status === 401, `expected 401, got ${status}`);
});

await test('A manifest whose shape is wrong is refused with the lines to fix', async () => {
    const res = await json('/v1/msm', {
        method: 'POST',
        headers: auth(operatorToken),
        body: JSON.stringify({ yaml: 'version: "1.0"\nservice:\n  name: Broken\n  category: nonsense\nauth:\n  type: none\nactions: []\n' }),
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
    const said = JSON.stringify(res.body.error ?? res.body);
    assert(said.includes('category') || said.includes('action'),
        `the refusal names what to fix, got ${said}`);
});

await test('The operator deletes one, and both listings stop carrying it', async () => {
    const res = await json(`/v1/admin/msm/${encodeURIComponent(FEED_B)}`, {
        method: 'DELETE', headers: auth(operatorToken),
    });
    assert(res.status === 200, `delete: ${res.status} ${JSON.stringify(res.body.error)}`);
    const admin = await json('/v1/admin/msm', { headers: auth(operatorToken) });
    assert(!listed(admin.body, FEED_B), 'gone from the operator listing');
    const pub = await json('/v1/msm');
    assert(!(pub.body.data.integrations as any[]).some(m => m.name === FEED_B), 'and from the public one');
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
