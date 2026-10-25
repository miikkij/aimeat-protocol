/**
 * @file e2e-subdomains.ts
 * @description E2E tests for subdomain routing: operator-only management CRUD
 *   (/v1/admin/subdomains — auth guards, validation, reserved names, duplicates,
 *   enable/disable, redirect targets) and root serving via the X-Subdomain header
 *   (app HTML, markdown Agent Face negotiation, apex passthrough, uniform 404s).
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=subdomains
 * @version-history
 *   v1.2.0 — 2026-10-25 — Every subdomain request addresses a real `<sub>.<apex>` Host through
 *     helpers/host-request.ts (fetch drops Host). X-Subdomain on the apex Host, or naming another
 *     site than the Host, no longer chooses the site: the redirect site's 301 on the apex was the
 *     approved assertion change (secaudit2026oct22, subdomain-label-from-client-headers).
 *   v1.1.0 — 2026-07-14 — Agent Face: subdomain root with Accept: text/markdown serves the
 *     converted app markdown + the agent-affordances footer (file header added, campsite rule)
 *   v1.0.0 — 2026-06-12 — Initial: management CRUD + serving
 */

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
        redirect: 'manual',
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

import { registerOwner, ownerSignIn } from './helpers/owner-login.js';
import { hostRequest } from './helpers/host-request.js';

/**
 * A request the way nginx delivers one for an operator subdomain: the Host names `<sub>.<apex>` and
 * X-Subdomain names the same label. `fetch` drops a Host header, and since 2026-10-25 the node
 * honours X-Subdomain only when it equals the label of the Host (middleware/subdomain.ts), so the
 * request goes over node:http (helpers/host-request.ts). `label` overrides the header alone, to
 * send one that disagrees with the Host.
 */
const APEX = new URL(BASE).hostname;
const PORT = new URL(BASE).port || '80';
async function onSub(path: string, sub: string, extra: Record<string, string> = {}, label: string | null = sub, host = `${sub.toLowerCase()}.${APEX}:${PORT}`) {
    const headers: Record<string, string> = { ...extra };
    if (label !== null) headers['x-subdomain'] = label;
    const res = await hostRequest(BASE, path, host, { headers });
    const ct = res.header('content-type') ?? '';
    const body = ct.includes('json') ? JSON.parse(res.body) as any : { _raw: res.body, _ct: ct };
    return { status: res.status, body, headers: { get: (name: string) => res.header(name) } };
}

// ─── State ───
let opToken = '';
let opPrivKey = '';
const opName = `testsubop${Date.now()}`;

let nonOpToken = '';
let nonOpPrivKey = '';
const nonOpName = `testsubuser${Date.now()}`;

const APP_FILENAME = 'sub-e2e-app.html';
const APP_HTML = '<!doctype html><html><head><title>Sub E2E</title></head><body><h1>subdomain-e2e-marker</h1></body></html>';
const SUB = 'sube2etest';
const REDIR_SUB = 'sube2eredir';

function authed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${opToken}` } };
}

// ─── Setup ───
console.log('\n=== AIMEAT Subdomain Routing E2E Test ===\n');
console.log('Setup');

await test('Register test owner (auto-operator)', async () => {
    const owner = await registerOwner(BASE, opName);
    opPrivKey = owner.privateKey;
    assert(typeof opPrivKey === 'string' && opPrivKey.length > 0, 'got private key');
});

await test('Get operator token', async () => {
    const { body } = await ownerSignIn(BASE, opName);
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    opToken = body.data?.token;
    assert(typeof opToken === 'string', 'got token');
});

await test('Register non-operator owner', async () => {
    const owner = await registerOwner(BASE, nonOpName);
    nonOpPrivKey = owner.privateKey;
});

await test('Get non-operator token', async () => {
    const { body } = await ownerSignIn(BASE, nonOpName);
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    nonOpToken = body.data?.token;
});

await test('Publish a test app', async () => {
    const { status, body } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({
            filename: APP_FILENAME,
            content: Buffer.from(APP_HTML).toString('base64'),
            name: 'Sub E2E App',
            description: 'E2E fixture app for subdomain mapping tests.',
        }),
    }));
    assert(status === 201 || status === 200, `publish status ${status}: ${JSON.stringify(body)}`);
});

// ─── Auth guards ───
console.log('\nAuth guards');

await test('GET /v1/admin/subdomains without token → 401', async () => {
    const { status } = await json('/v1/admin/subdomains');
    assert(status === 401, `expected 401, got ${status}`);
});

await test('GET /v1/admin/subdomains with non-operator token → 403', async () => {
    const { status } = await json('/v1/admin/subdomains', {
        headers: { Authorization: `Bearer ${nonOpToken}` },
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('POST /v1/admin/subdomains with non-operator token → 403', async () => {
    const { status } = await json('/v1/admin/subdomains', {
        method: 'POST',
        headers: { Authorization: `Bearer ${nonOpToken}` },
        body: JSON.stringify({ subdomain: 'hacker', kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

// ─── Validation ───
console.log('\nValidation');

await test('Reserved subdomain rejected (www) → 400', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: 'www', kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    }));
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error?.code === 'RESERVED_SUBDOMAIN', `code ${body.error?.code}`);
});

await test('Reserved subdomain rejected (mcp) → 400', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: 'mcp', kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    }));
    assert(status === 400 && body.error?.code === 'RESERVED_SUBDOMAIN', `${status} ${body.error?.code}`);
});

await test('Invalid subdomain name rejected → 400', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: 'Bad_Sub!', kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    }));
    assert(status === 400 && body.error?.code === 'INVALID_SUBDOMAIN', `${status} ${body.error?.code}`);
});

await test('Single-char subdomain rejected → 400', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: 'a', kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    }));
    assert(status === 400 && body.error?.code === 'INVALID_SUBDOMAIN', `${status} ${body.error?.code}`);
});

await test('Nonexistent app target rejected → 404', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: 'ghostapp', kind: 'app', target: `${opName}/no-such-app.html` }),
    }));
    assert(status === 404 && body.error?.code === 'APP_NOT_FOUND', `${status} ${body.error?.code}`);
});

await test('Invalid redirect target rejected → 400', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: 'badredir', kind: 'redirect', target: 'not-a-url' }),
    }));
    assert(status === 400 && body.error?.code === 'INVALID_TARGET', `${status} ${body.error?.code}`);
});

// ─── CRUD + serving ───
console.log('\nCRUD + serving');

await test('Create app mapping → 201', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: SUB, kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.site?.subdomain === SUB, 'site echoed');
    assert(body.data?.site?.enabled === true, 'enabled by default');
});

await test('Duplicate mapping → 409', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: SUB, kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    }));
    assert(status === 409 && body.error?.code === 'ALREADY_EXISTS', `${status} ${body.error?.code}`);
});

await test('Uppercase subdomain input normalized to lowercase', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: SUB.toUpperCase(), kind: 'app', target: `${opName}/${APP_FILENAME}` }),
    }));
    // Normalizes to the same lowercase subdomain → conflict, not a parallel entry
    assert(status === 409, `expected 409 for uppercase duplicate, got ${status}: ${JSON.stringify(body)}`);
});

await test('List mappings includes the new one', async () => {
    const { status, body } = await json('/v1/admin/subdomains', authed());
    assert(status === 200, `status ${status}`);
    const subs = (body.data?.sites ?? []).map((s: any) => s.subdomain);
    assert(subs.includes(SUB), `sites: ${subs.join(',')}`);
});

await test('Subdomain root serves the app HTML', async () => {
    const { status, body, headers } = await onSub('/', SUB);
    assert(status === 200, `status ${status}`);
    assert((headers.get('content-type') ?? '').includes('text/html'), `content-type ${headers.get('content-type')}`);
    assert(typeof body._raw === 'string' && body._raw.includes('subdomain-e2e-marker'), 'app HTML served');
});

await test('The app origin answers the WebMCP tool listing, not only the apex', async () => {
    // An agent lands on the app's own origin: the page, llms.txt, the MCP card and the RFC 9728
    // document are all served there. The tools were on the apex alone, so the app's own agent
    // document had to point away from the origin the agent was already on, and a POST here 404'd.
    const { status, body } = await onSub('/webmcp', SUB);
    assert(status === 200, `expected the tool listing on the app origin, got ${status}`);
    const d = body.data ?? body;
    assert(Array.isArray(d.tools), `the listing carries its tools: ${JSON.stringify(d).slice(0, 200)}`);
});

await test('Subdomain root negotiates text/markdown (Agent Face fallback + affordances footer)', async () => {
    const { status, body, headers } = await onSub('/', SUB, { 'Accept': 'text/markdown' });
    assert(status === 200, `status ${status}`);
    assert((headers.get('content-type') ?? '').startsWith('text/markdown'), `content-type ${headers.get('content-type')}`);
    assert((headers.get('vary') ?? '').toLowerCase().includes('accept'), `Vary includes Accept, got ${headers.get('vary')}`);
    assert(typeof body._raw === 'string' && body._raw.includes('subdomain-e2e-marker'), 'converted markdown carries the app content');
    assert(body._raw.includes('## Agent affordances'), 'affordances footer present');
    assert(body._raw.includes('/auth.md'), 'footer links agent registration');
});

await test('X-Subdomain header is case-insensitive', async () => {
    const { status, body } = await onSub('/', SUB, {}, SUB.toUpperCase());
    assert(status === 200, `status ${status}`);
    assert(body._raw?.includes('subdomain-e2e-marker'), 'app HTML served');
});

await test('Apex GET / behaves exactly as before (no subdomain)', async () => {
    const { status, body } = await json('/', { headers: { 'Accept': 'application/json' } });
    assert(status === 200 || status === 302, `status ${status}`);
    if (status === 200 && !body._raw) {
        assert(body.ok === true, `apex envelope: ${JSON.stringify(body.error)}`);
    }
});

await test('Unknown subdomain → 404', async () => {
    const { status } = await onSub('/', 'nosuchsubdomain');
    assert(status === 404, `expected 404, got ${status}`);
});

await test('Reserved subdomain www → 301 to apex', async () => {
    const { status, headers } = await onSub('/', 'www');
    assert(status === 301, `expected 301, got ${status}`);
    const loc = headers.get('location') ?? '';
    assert(loc.length > 0, 'has Location header');
});

await test('Reserved subdomain (non-www) → 404', async () => {
    const { status } = await onSub('/', 'admin');
    assert(status === 404, `expected 404, got ${status}`);
});

await test('Disable mapping → subdomain 404s', async () => {
    const { status, body } = await json(`/v1/admin/subdomains/${SUB}`, authed({
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
    }));
    assert(status === 200 && body.data?.site?.enabled === false, `patch: ${status} ${JSON.stringify(body.data)}`);
    const served = await onSub('/', SUB);
    assert(served.status === 404, `expected 404 after disable, got ${served.status}`);
});

await test('Re-enable mapping → serves again', async () => {
    const { status } = await json(`/v1/admin/subdomains/${SUB}`, authed({
        method: 'PATCH',
        body: JSON.stringify({ enabled: true }),
    }));
    assert(status === 200, `patch status ${status}`);
    const served = await onSub('/', SUB);
    assert(served.status === 200 && served.body._raw?.includes('subdomain-e2e-marker'), 'served after re-enable');
});

await test('Redirect mapping → 301 with Location', async () => {
    const { status } = await json('/v1/admin/subdomains', authed({
        method: 'POST',
        body: JSON.stringify({ subdomain: REDIR_SUB, kind: 'redirect', target: 'https://example.com/landing' }),
    }));
    assert(status === 201, `create redirect status ${status}`);
    const served = await onSub('/', REDIR_SUB);
    assert(served.status === 301, `expected 301, got ${served.status}`);
    assert(served.headers.get('location') === 'https://example.com/landing', `location ${served.headers.get('location')}`);
});

// Approved behaviour change (Jouni, 2026-10-25): X-Subdomain counts only when it equals the label of
// the Host. It used to answer this request with the redirect site's 301, on the apex URL, from the
// header alone (secaudit2026oct22, subdomain-label-from-client-headers).
await test('X-Subdomain on the apex Host is ignored: no redirect site answers the apex', async () => {
    const onApex = await onSub('/', REDIR_SUB, { Accept: 'application/json' }, REDIR_SUB, `${APEX}:${PORT}`);
    assert(onApex.status !== 301, `the apex must not answer with the redirect site, got ${onApex.status} ${onApex.headers.get('location')}`);
    assert(onApex.headers.get('location') !== 'https://example.com/landing', 'no redirect to the site target');
});

await test('X-Subdomain naming another site than the Host is ignored; the Host label stands', async () => {
    const r = await onSub('/', SUB, {}, REDIR_SUB);
    assert(r.status === 200 && r.body._raw?.includes('subdomain-e2e-marker'), `the Host's own site must answer, got ${r.status} ${r.headers.get('location')}`);
});

await test('X-Forwarded-Host does not choose the site', async () => {
    const r = await onSub('/', REDIR_SUB, { Accept: 'application/json', 'X-Forwarded-Host': `${REDIR_SUB}.${APEX}` }, null, `${APEX}:${PORT}`);
    assert(r.status !== 301, `X-Forwarded-Host must not choose the redirect site, got ${r.status}`);
});

await test('PATCH unknown subdomain → 404', async () => {
    const { status } = await json('/v1/admin/subdomains/nosuch', authed({
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
    }));
    assert(status === 404, `expected 404, got ${status}`);
});

await test('DELETE mapping → subdomain 404s', async () => {
    const { status, body } = await json(`/v1/admin/subdomains/${SUB}`, authed({ method: 'DELETE' }));
    assert(status === 200 && body.data?.deleted === true, `delete: ${status}`);
    const served = await onSub('/', SUB);
    assert(served.status === 404, `expected 404 after delete, got ${served.status}`);
});

await test('DELETE again → 404', async () => {
    const { status } = await json(`/v1/admin/subdomains/${SUB}`, authed({ method: 'DELETE' }));
    assert(status === 404, `expected 404, got ${status}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Delete redirect mapping', async () => {
    const { status } = await json(`/v1/admin/subdomains/${REDIR_SUB}`, authed({ method: 'DELETE' }));
    assert(status === 200, `status ${status}`);
});

await test('Delete test app', async () => {
    const { body } = await json(`/v1/apps/${APP_FILENAME}`, authed({ method: 'DELETE' }));
    assert(body.ok === true, `delete app: ${JSON.stringify(body.error)}`);
});

await test('Delete test operator (cascade)', async () => {
    const { body } = await json(`/v1/owners/${opName}`, authed({ method: 'DELETE' }));
    assert(body.ok === true, `delete operator: ${JSON.stringify(body.error)}`);
});

await test('Delete non-operator test owner (cascade)', async () => {
    const { body } = await json(`/v1/owners/${nonOpName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${nonOpToken}` },
    });
    assert(body.ok === true, `delete non-op: ${JSON.stringify(body.error)}`);
});

// ─── Summary ───
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
