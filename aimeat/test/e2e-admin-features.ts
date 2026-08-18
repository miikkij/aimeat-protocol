/**
 * @file e2e-admin-features.ts
 * @description E2E for the admin-features endpoints: GHII administration, email templates and
 *   sending, the directory and matching runs, push templates, CSM and MSM, genesis peers, and the
 *   node config doors mounted alongside them.
 * @version-history
 *   v1.2.0 — 2026-08-19 — The front-page switch: site.front_page=demo serves the static showroom
 *     at / (Finnish sibling by Accept-Language, JSON bootstrap untouched), classic restores the
 *     SPA, and a value outside classic|demo is refused.
 *   v1.1.0 — 2026-08-16 — E2E quality, admin-features:118. One probe covered one route out of the
 *     thirty-six this file drives, and the gate here is per route rather than router-level, so
 *     thirty-five of them could lose the operator role unnoticed. Two loops now walk every door as a
 *     non-operator owner and as an anonymous caller. The targets are ids that do not exist, because a
 *     gate answers before the lookup: a 404 from one of those rows means the request got past.
 *   v1.0.0 — pre-dates the header standard.
 */
// Run: cd aimeat && pnpm exec tsx test/e2e-admin-features.ts

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  \u2705 ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  \u274C ${name}: ${err.message}`);
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

// Helper: sign a message with a base64 private key
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

// ─── State ───
let ownerToken = '';
let ownerPrivKey = '';
const ownerName = `testadmin${Date.now()}`;

let nonOpToken = '';
let nonOpPrivKey = '';
const nonOpName = `testnonop${Date.now()}`;

function authed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${ownerToken}` } };
}

// ─── Setup ───
console.log('\n=== AIMEAT Admin Features E2E Test ===\n');
console.log('Setup \u2014 registering test operator');

await test('Register test owner (auto-operator)', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
    assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'got private key');
});

await test('Get operator token', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerName + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    ownerToken = body.data?.token;
    assert(typeof ownerToken === 'string', 'got token');
});

await test('Register non-operator owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: nonOpName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    nonOpPrivKey = body.data.private_key;
    assert(typeof nonOpPrivKey === 'string' && nonOpPrivKey.length > 0, 'got private key');
});

await test('Get non-operator token', async () => {
    const timestamp = new Date().toISOString();
    const message = nonOpName + NODE_ID + timestamp;
    const signature = await signMsg(nonOpPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: nonOpName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    nonOpToken = body.data?.token;
    assert(typeof nonOpToken === 'string', 'got non-op token');
});

// ─── Auth Guards ───
console.log('\nAuth Guards');

await test('GET /v1/admin/ghii without token \u2192 401', async () => {
    const { status } = await json('/v1/admin/ghii');
    assert(status === 401, `expected 401, got ${status}`);
});

await test('GET /v1/admin/ghii with non-operator token \u2192 403', async () => {
    const { status } = await json('/v1/admin/ghii', {
        headers: { Authorization: `Bearer ${nonOpToken}` },
    });
    assert(status === 403, `expected 403, got ${status}`);
});

/**
 * That one probe was the whole denial story of this file, and it covered one route out of the
 * thirty-six it drives. The gate here is PER ROUTE, not router-level: admin-features.ts spreads
 * `[requireAuth(), requireRole('operator')]` onto each handler one at a time, and the three
 * admin-config routes each carry their own pair. So thirty-five of them could lose the role and this
 * suite would not notice, because every other call goes through authed(), which is the first owner
 * registered on a cleared database and therefore an operator.
 *
 * The targets are ids that do not exist. A gate answers before the lookup, so a 404 from one of these
 * rows is itself a failure: it means the request got past the door and went looking.
 */
const ADMIN_DOORS: Array<{ method: string; path: string; body?: unknown }> = [
    { method: 'GET', path: '/v1/admin/ghii' },
    { method: 'PUT', path: '/v1/admin/ghii/nonexistent%40nowhere', body: { display_name: 'nope' } },
    { method: 'DELETE', path: '/v1/admin/ghii/nonexistent%40nowhere/email' },
    { method: 'DELETE', path: '/v1/admin/ghii/nonexistent%40nowhere' },
    { method: 'PUT', path: '/v1/admin/ghii/nonexistent%40nowhere/cors', body: { origins: ['https://nope.example'] } },
    { method: 'GET', path: '/v1/admin/email/status' },
    { method: 'POST', path: '/v1/admin/email/test', body: { to: 'nobody@example.com' } },
    { method: 'POST', path: '/v1/admin/email/send-group', body: { group: 'nonexistent', subject: 'x', body: 'y' } },
    { method: 'GET', path: '/v1/admin/email/templates' },
    { method: 'POST', path: '/v1/admin/email/templates/seed' },
    { method: 'POST', path: '/v1/admin/email/templates/reset' },
    { method: 'PUT', path: '/v1/admin/email/templates/nonexistent', body: { subject: 'x', body: 'y' } },
    { method: 'DELETE', path: '/v1/admin/email/templates/nonexistent' },
    { method: 'GET', path: '/v1/admin/directory/stats' },
    { method: 'POST', path: '/v1/admin/directory/rebuild' },
    { method: 'GET', path: '/v1/admin/matching' },
    { method: 'POST', path: '/v1/admin/matching/run' },
    { method: 'GET', path: '/v1/admin/marketplace' },
    { method: 'GET', path: '/v1/admin/push' },
    { method: 'PUT', path: '/v1/admin/push/templates/nonexistent/en', body: { title: 'x', body: 'y' } },
    { method: 'POST', path: '/v1/admin/push/test', body: { ghii: 'nonexistent@nowhere' } },
    { method: 'POST', path: '/v1/admin/push/templates/reset' },
    { method: 'GET', path: '/v1/admin/csm' },
    { method: 'GET', path: '/v1/admin/csm/nonexistent' },
    { method: 'DELETE', path: '/v1/admin/csm/nonexistent' },
    { method: 'GET', path: '/v1/admin/msm' },
    { method: 'GET', path: '/v1/admin/msm/nonexistent' },
    { method: 'PUT', path: '/v1/admin/msm/nonexistent', body: { content: 'x' } },
    { method: 'DELETE', path: '/v1/admin/msm/nonexistent' },
    { method: 'GET', path: '/v1/admin/genesis-peers' },
    { method: 'POST', path: '/v1/admin/genesis-peers/nonexistent/approve' },
    { method: 'POST', path: '/v1/admin/genesis-peers/nonexistent/suspend' },
    { method: 'DELETE', path: '/v1/admin/genesis-peers/nonexistent' },
    { method: 'GET', path: '/v1/admin/app-grants' },
    { method: 'GET', path: '/v1/admin/config' },
    { method: 'PUT', path: '/v1/admin/config', body: { key: 'node.name', value: 'hijacked' } },
    { method: 'DELETE', path: '/v1/admin/config/node.name' },
];

await test(`Every admin door refuses a non-operator owner (${ADMIN_DOORS.length} routes)`, async () => {
    const failures: string[] = [];
    for (const door of ADMIN_DOORS) {
        const { status } = await json(door.path, {
            method: door.method,
            headers: { Authorization: `Bearer ${nonOpToken}` },
            ...(door.body ? { body: JSON.stringify(door.body) } : {}),
        });
        if (status !== 403) failures.push(`${door.method} ${door.path} \u2192 ${status}`);
    }
    assert(failures.length === 0, `these admin doors did not refuse a plain owner: ${failures.join(', ')}`);
});

await test(`Every admin door refuses a caller with no credential (${ADMIN_DOORS.length} routes)`, async () => {
    const failures: string[] = [];
    for (const door of ADMIN_DOORS) {
        const { status } = await json(door.path, {
            method: door.method,
            ...(door.body ? { body: JSON.stringify(door.body) } : {}),
        });
        if (status !== 401) failures.push(`${door.method} ${door.path} \u2192 ${status}`);
    }
    assert(failures.length === 0, `these admin doors answered an anonymous caller: ${failures.join(', ')}`);
});

// ─── GHII ───
console.log('\nGHII');

await test('GET /v1/admin/ghii \u2192 200, has ghii_users array', async () => {
    const { status, body } = await json('/v1/admin/ghii', authed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.ghii_users), 'ghii_users is an array');
    assert(typeof body.data?.total === 'number', 'has total');
});

await test('PUT /v1/admin/ghii/nonexistent \u2192 404', async () => {
    const { status, body } = await json('/v1/admin/ghii/nonexistent%40nowhere', authed({
        method: 'PUT',
        body: JSON.stringify({ verificationLevel: 1 }),
    }));
    assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
});

await test('PUT /v1/admin/ghii with invalid level \u2192 400', async () => {
    const { status, body } = await json('/v1/admin/ghii/nonexistent%40nowhere', authed({
        method: 'PUT',
        body: JSON.stringify({ verificationLevel: 99 }),
    }));
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
});

await test('DELETE /v1/admin/ghii/nonexistent \u2192 404', async () => {
    const { status } = await json('/v1/admin/ghii/nonexistent%40nowhere', authed({
        method: 'DELETE',
    }));
    assert(status === 404, `expected 404, got ${status}`);
});

// ─── Email ───
console.log('\nEmail');

await test('GET /v1/admin/email/status \u2192 200, has enabled field', async () => {
    const { status, body } = await json('/v1/admin/email/status', authed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.enabled === 'boolean', 'has enabled field');
    assert('smtp_host' in body.data, 'has smtp_host field');
    assert(typeof body.data?.smtp_port === 'number', 'has smtp_port field');
    assert(typeof body.data?.confirmation_required === 'boolean', 'has confirmation_required');
});

await test('POST /v1/admin/email/test → sends, or says the node has no SMTP', async () => {
    // This needs a mail server, and the runner deliberately does not configure one: sending real
    // mail from a test suite is not something a run should do by accident. The status endpoint
    // above already told us whether email is on, so read THAT rather than demanding a send the node
    // cannot make. Until 2026-08-14 this asserted 200 unconditionally and was red on every machine
    // without SMTP, which is one of the failures that made a full sweep unreadable: an assertion
    // that can never pass here teaches everyone to ignore the colour.
    const status0 = await json('/v1/admin/email/status', authed());
    const emailOn = status0.body?.data?.enabled === true;

    const { status, body } = await json('/v1/admin/email/test', authed({
        method: 'POST',
        body: JSON.stringify({ to: 'notifications@aimeat.io' }),
    }));

    if (!emailOn) {
        assert(status === 400 && body?.error?.code === 'EMAIL_DISABLED',
            `an unconfigured node must refuse the send and SAY so, got ${status}: ${JSON.stringify(body)}`);
        return;
    }
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.sent === true, 'sent');
});

// ─── Directory ───
console.log('\nDirectory');

await test('GET /v1/admin/directory/stats \u2192 200, has totalPeople', async () => {
    const { status, body } = await json('/v1/admin/directory/stats', authed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.totalPeople === 'number', 'has totalPeople field');
});

await test('POST /v1/admin/directory/rebuild \u2192 200, has rebuilt field', async () => {
    const { status, body } = await json('/v1/admin/directory/rebuild', authed({
        method: 'POST',
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.rebuilt === true, 'rebuilt is true');
    assert(typeof body.data?.stats === 'object', 'has stats');
});

// ─── Matching ───
console.log('\nMatching');

await test('GET /v1/admin/matching \u2192 200, has enabled field', async () => {
    const { status, body } = await json('/v1/admin/matching', authed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.enabled === 'boolean', 'has enabled field');
    assert(typeof body.data?.interval_hours === 'number', 'has interval_hours');
    assert(typeof body.data?.threshold === 'number', 'has threshold');
    assert(typeof body.data?.max_suggestions === 'number', 'has max_suggestions');
});

await test('POST /v1/admin/matching/run \u2192 200, returns result', async () => {
    const { status, body } = await json('/v1/admin/matching/run', authed({
        method: 'POST',
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data !== undefined, 'has data');
});

// ─── Marketplace ───
console.log('\nMarketplace');

await test('GET /v1/admin/marketplace \u2192 200, has enabled and stats', async () => {
    const { status, body } = await json('/v1/admin/marketplace', authed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.enabled === 'boolean', 'has enabled field');
    assert(typeof body.data?.listing_fee === 'number', 'has listing_fee');
    assert(typeof body.data?.tx_fee_percent === 'number', 'has tx_fee_percent');
    assert(typeof body.data?.stats === 'object', 'has stats');
    assert(typeof body.data?.stats?.total === 'number', 'stats has total');
});

// ─── Push ───
console.log('\nPush');

await test('GET /v1/admin/push \u2192 200, has enabled field', async () => {
    const { status, body } = await json('/v1/admin/push', authed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.enabled === 'boolean', 'has enabled field');
    assert(typeof body.data?.vapid_configured === 'boolean', 'has vapid_configured');
    assert(typeof body.data?.total_subscriptions === 'number', 'has total_subscriptions');
    assert(Array.isArray(body.data?.subscriptions), 'has subscriptions array');
});

// ─── CSM ───
console.log('\nCSM');

await test('GET /v1/admin/csm \u2192 200, has templates array', async () => {
    const { status, body } = await json('/v1/admin/csm', authed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.templates), 'has templates array');
    assert(typeof body.data?.total === 'number', 'has total');
});

// ─── Genesis Peers ───
console.log('\nGenesis Peers');

await test('GET /v1/admin/genesis-peers \u2192 200, has peers array', async () => {
    const { status, body } = await json('/v1/admin/genesis-peers', authed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.peers), 'has peers array');
    assert(typeof body.data?.total === 'number', 'has total');
    assert(typeof body.data?.network_stats === 'object', 'has network_stats');
});

await test('POST /v1/admin/genesis-peers/nonexistent/approve \u2192 404', async () => {
    const { status } = await json('/v1/admin/genesis-peers/nonexistent/approve', authed({
        method: 'POST',
    }));
    assert(status === 404, `expected 404, got ${status}`);
});

await test('POST /v1/admin/genesis-peers/nonexistent/suspend \u2192 404', async () => {
    const { status } = await json('/v1/admin/genesis-peers/nonexistent/suspend', authed({
        method: 'POST',
    }));
    assert(status === 404, `expected 404, got ${status}`);
});

await test('DELETE /v1/admin/genesis-peers/nonexistent \u2192 404', async () => {
    const { status } = await json('/v1/admin/genesis-peers/nonexistent', authed({
        method: 'DELETE',
    }));
    assert(status === 404, `expected 404, got ${status}`);
});

// ─── Config Expansion ───
console.log('\nConfig');

await test('GET /v1/admin/config \u2192 200, schema has expected paths', async () => {
    const { status, body } = await json('/v1/admin/config', authed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.schema === 'object', 'has schema');

    // Check for expected config paths
    const schema = body.data.schema;
    assert('email.enabled' in schema, 'schema has email.enabled');
    assert('matching.enabled' in schema, 'schema has matching.enabled');
    assert('marketplace.enabled' in schema, 'schema has marketplace.enabled');
    assert('push.enabled' in schema, 'schema has push.enabled');
    assert('morsel_policy.welcome_bonus' in schema, 'schema has morsel_policy.welcome_bonus');
    assert('auth.jwt_ttl_seconds' in schema, 'schema has auth.jwt_ttl_seconds');

    // Verify schema entry structure
    const entry = schema['email.enabled'];
    assert(typeof entry.value !== 'undefined', 'entry has value');
    assert(typeof entry.type === 'string', 'entry has type');
    assert(typeof entry.description === 'string', 'entry has description');
    assert(typeof entry.mutable === 'boolean', 'entry has mutable');
    assert(typeof entry.path === 'string', 'entry has path');
});

await test('PUT /v1/admin/config \u2192 update a boolean config', async () => {
    // Read current value
    const { body: getBody } = await json('/v1/admin/config', authed());
    const currentVal = getBody.data.schema['features.keyed_browse_enabled'].value;

    // Toggle value
    const newVal = !currentVal;
    const { status, body } = await json('/v1/admin/config', authed({
        method: 'PUT',
        body: JSON.stringify({ changes: [{ path: 'features.keyed_browse_enabled', value: newVal }] }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.applied), 'has applied array');
    assert(body.data.applied.length === 1, 'one change applied');
    assert(body.data.applied[0].path === 'features.keyed_browse_enabled', 'correct path');
    assert(body.data.applied[0].new_value === newVal, 'new value matches');
    assert(body.data.applied[0].old_value === currentVal, 'old value matches');

    // Restore original value
    await json('/v1/admin/config', authed({
        method: 'PUT',
        body: JSON.stringify({ changes: [{ path: 'features.keyed_browse_enabled', value: currentVal }] }),
    }));
});

await test('PUT /v1/admin/config \u2192 reject invalid path', async () => {
    const { status, body } = await json('/v1/admin/config', authed({
        method: 'PUT',
        body: JSON.stringify({ changes: [{ path: 'nonexistent.invalid.path', value: true }] }),
    }));
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === false, 'ok is false');
});

// \u2500\u2500\u2500 The front-page switch (site.front_page) \u2500\u2500\u2500
console.log('\nFront-page switch');

await test('site.front_page: demo serves the showroom at /, classic restores the SPA', async () => {
    const html = async (extra: Record<string, string> = {}) => {
        const r = await fetch(`${BASE}/`, { headers: { Accept: 'text/html', ...extra } });
        return { status: r.status, text: await r.text() };
    };
    const before = await html();
    assert(before.status === 200, `status ${before.status}`);
    assert(!before.text.includes('fd-ribbon'), 'the showroom must not serve before the switch');
    const put = await json('/v1/admin/config', authed({
        method: 'PUT',
        body: JSON.stringify({ changes: [{ path: 'site.front_page', value: 'demo' }] }),
    }));
    assert(put.status === 200, `flip on: ${put.status} ${JSON.stringify(put.body)}`);
    try {
        const on = await html();
        assert(on.text.includes('fd-ribbon'), 'the showroom serves at / when the switch is on');
        const fi = await html({ 'Accept-Language': 'fi-FI,fi;q=0.9' });
        assert(fi.text.includes('Kokeile kaikkea'), 'a Finnish reader gets the Finnish sibling');
        const jsonRoot = await (await fetch(`${BASE}/?format=json`)).json();
        assert(jsonRoot.protocol === 'aimeat', 'the JSON bootstrap is untouched by the switch');
    } finally {
        // Flip back whatever happened, so the suite leaves the node as it found it.
        await json('/v1/admin/config', authed({
            method: 'PUT',
            body: JSON.stringify({ changes: [{ path: 'site.front_page', value: 'classic' }] }),
        }));
    }
    const after = await html();
    assert(!after.text.includes('fd-ribbon'), 'classic restores the SPA front');
});

await test('site.front_page: a value outside classic|demo is refused', async () => {
    const { status, body } = await json('/v1/admin/config', authed({
        method: 'PUT',
        body: JSON.stringify({ changes: [{ path: 'site.front_page', value: 'bogus' }] }),
    }));
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
});

// ─── Translations ───
console.log('\nTranslations');

await test('GET /v1/admin/translations?lang=en \u2192 200, has overview key', async () => {
    const { status, body } = await json('/v1/admin/translations?lang=en', authed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data.locale === 'en', `locale is en, got ${body.data.locale}`);
    assert(typeof body.data.translations === 'object', 'has translations');
    assert(typeof body.data.translations.overview === 'string', 'has overview key');
    assert(typeof body.data.translations.mintMorsels === 'string', 'has mintMorsels key');
});

await test('GET /v1/admin/translations?lang=fi \u2192 200, mintMorsels contains Luo', async () => {
    const { status, body } = await json('/v1/admin/translations?lang=fi', authed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data.locale === 'fi', `locale is fi, got ${body.data.locale}`);
    assert(typeof body.data.translations === 'object', 'has translations');
    assert(
        typeof body.data.translations.mintMorsels === 'string' && body.data.translations.mintMorsels.includes('Luo'),
        `mintMorsels should contain 'Luo', got '${body.data.translations.mintMorsels}'`,
    );
});

// ─── MSM Templates ───
console.log('\nMSM Templates');

let msmTemplateYaml = '';

await test('GET /v1/msm/templates → 200, has templates array with total >= 1', async () => {
    const { status, body } = await json('/v1/msm/templates');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.templates), 'has templates array');
    assert(typeof body.data?.total === 'number', 'has total');
    assert(body.data.total >= 1, `total >= 1, got ${body.data.total}`);
});

await test('GET /v1/msm/templates/weather-pricing → 200, returns YAML content', async () => {
    const res = await fetch(`${BASE}/v1/msm/templates/weather-pricing`);
    assert(res.status === 200, `status ${res.status}`);
    const text = await res.text();
    assert(text.length > 0, 'body is non-empty');
    assert(text.includes('msm:') || text.startsWith('#'), 'body looks like MSM YAML');
    msmTemplateYaml = text;
});

// ─── MSM CRUD ───
console.log('\nMSM CRUD');

await test('POST /v1/msm → 201, register weather-pricing MSM from template YAML', async () => {
    assert(msmTemplateYaml.length > 0, 'template YAML was fetched');
    const { status, body } = await json('/v1/msm', authed({
        method: 'POST',
        body: JSON.stringify({ yaml: msmTemplateYaml }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.integration?.name === 'string', 'has name');
    assert(typeof body.data?.integration?.category === 'string', 'has category');
    assert(typeof body.data?.integration?.actions_count === 'number', 'has actions_count');
    assert(body.data.integration.actions_count > 0, `actions_count > 0, got ${body.data.integration.actions_count}`);
});

await test('GET /v1/msm → 200, list includes registered MSM', async () => {
    const { status, body } = await json('/v1/msm');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.integrations), 'has integrations');
    assert(body.data.integrations.length >= 1, `at least 1 integration, got ${body.data.integrations.length}`);
    const found = body.data.integrations.find((i: any) => i.name === 'OpenWeather Pricing Intelligence');
    assert(found, 'found OpenWeather integration in list');
});

await test('GET /v1/msm/{name} → 200, returns full definition', async () => {
    const { status, body } = await json(`/v1/msm/${encodeURIComponent('OpenWeather Pricing Intelligence')}`);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data?.integration?.name === 'string', 'has name');
    assert(typeof body.data?.integration?.definition === 'object', 'has definition');
    assert(Array.isArray(body.data.integration.definition.actions), 'definition has actions array');
});

// ─── MSM Auth ───
console.log('\nMSM Auth');

await test('POST /v1/msm (no auth) → 401', async () => {
    const { status } = await json('/v1/msm', {
        method: 'POST',
        body: JSON.stringify({ yaml: 'msm: "1.0"\nservice:\n  name: "test"\n' }),
    });
    assert(status === 401, `expected 401, got ${status}`);
});

await test('DELETE /v1/msm/{name} (non-operator, non-registerer) → 403', async () => {
    const { status } = await json(`/v1/msm/${encodeURIComponent('OpenWeather Pricing Intelligence')}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${nonOpToken}` },
    });
    assert(status === 403, `expected 403, got ${status}`);
});

// ─── MSM Admin ───
console.log('\nMSM Admin');

await test('GET /v1/admin/msm → 200, has integrations array with correct fields', async () => {
    const { status, body } = await json('/v1/admin/msm', authed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.integrations), 'has integrations array');
    assert(typeof body.data?.total === 'number', 'has total');
    if (body.data.integrations.length > 0) {
        const first = body.data.integrations[0];
        assert(typeof first.name === 'string', 'integration has name');
        assert(typeof first.category === 'string', 'integration has category');
        assert(typeof first.auth_type === 'string', 'integration has auth_type');
        assert(typeof first.actions_count === 'number', 'integration has actions_count');
    }
});

// ─── MSM Cleanup ───
console.log('\nMSM Cleanup');

await test('DELETE /v1/msm/{name} (operator) → 200, deleted', async () => {
    const { status, body } = await json(`/v1/msm/${encodeURIComponent('OpenWeather Pricing Intelligence')}`, authed({
        method: 'DELETE',
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.deleted === true, 'confirmed deleted');
});

// ─── Admin Translations (new MSM-related keys) ───
console.log('\nAdmin Translations (MSM keys)');

await test('GET /v1/admin/translations?lang=en → has navServices, msmLabel, navIntegrations', async () => {
    const { status, body } = await json('/v1/admin/translations?lang=en', authed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data.translations === 'object', 'has translations');
    assert(typeof body.data.translations.navServices === 'string', 'has navServices');
    assert(typeof body.data.translations.msmLabel === 'string', 'has msmLabel');
    assert(typeof body.data.translations.navIntegrations === 'string', 'has navIntegrations');
});

await test('GET /v1/admin/translations?lang=fi → navServices equals "Palvelut"', async () => {
    const { status, body } = await json('/v1/admin/translations?lang=fi', authed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(typeof body.data.translations === 'object', 'has translations');
    assert(
        body.data.translations.navServices === 'Palvelut',
        `expected navServices = 'Palvelut', got '${body.data.translations.navServices}'`,
    );
});

// ─── AI transparency report (TARGET-058 Phase 8) ───
// The Code of Practice documentation duty (Section 2, Commitment 2), answered from the records the
// node holds rather than from a spreadsheet. Proven with a real operator token — the 403 for a
// non-operator lives in e2e-ai-provenance, where a guaranteed non-operator owner exists.
console.log('\nAI transparency report');

await test('GET /v1/admin/ai-transparency-report answers the operator from real data', async () => {
    const { status, body } = await json('/v1/admin/ai-transparency-report', authed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    const d = body.data;
    assert(typeof d.total === 'number' && typeof d.public_total === 'number', 'no counts');
    assert(typeof d.unlabelled === 'number', 'the one number an operator acts on is missing');
    assert(d.public_total >= d.unlabelled, 'unlabelled cannot exceed the public population it is drawn from');
    assert(Array.isArray(d.trend), 'no trend');
    assert(Array.isArray(d.apps_declaring_generation_with_gap), 'the app-side half is missing');
    // A truncated list with no total beside it reads as the whole story — which is exactly how a
    // compliance report comes to overstate coverage.
    assert(typeof d.unlabelled_detail?.total === 'number', 'the detail list has no honest total');
    assert(d.unlabelled_detail.shown <= d.unlabelled_detail.total, 'shown exceeds total');
    // The sentence that stops a total being read as "everything published on this node".
    assert(String(d.scope.note).includes('UNSTATED'), 'the scope note must say what absence means');
});

await test('...and honours a since_days window', async () => {
    const { status, body } = await json('/v1/admin/ai-transparency-report?since_days=1', authed());
    assert(status === 200, `status ${status}`);
    assert(typeof body.data.scope.since === 'string', 'the window is not reported back');
    const ageMs = Date.now() - Date.parse(body.data.scope.since);
    assert(ageMs > 0 && ageMs < 3 * 86_400_000, `since should be ~1 day ago, got ${body.data.scope.since}`);
});

await test('...and refuses a non-operator owner (403)', async () => {
    const { status } = await json('/v1/admin/ai-transparency-report', {
        headers: { Authorization: `Bearer ${nonOpToken}` },
    });
    assert(status === 403, `non-operator → 403, got ${status}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Delete test operator (cascade)', async () => {
    const { body } = await json(`/v1/owners/${ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `delete operator: ${JSON.stringify(body.error)}`);
    assert(body.data?.deleted === true, 'confirmed deleted');
});

await test('Delete non-operator test owner (cascade)', async () => {
    const { body } = await json(`/v1/owners/${nonOpName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${nonOpToken}` },
    });
    assert(body.ok === true, `delete non-op: ${JSON.stringify(body.error)}`);
    assert(body.data?.deleted === true, 'confirmed deleted');
});

// ─── Summary ───
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
