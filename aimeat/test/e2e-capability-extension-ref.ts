/**
 * @file test/e2e-capability-extension-ref.ts
 * @description E2E for the source ref of an extension-backed capability (secaudit2026oct22,
 *   capability-invoke:extension-ref-unvalidated-in-loopback-url).
 *
 *   WHAT THIS PROVES. An extension-backed capability is invoked as a loopback POST to
 *   /v1/ext/<name>/<action> with the CALLER's bearer token. The ref `ext:<name>:<action>` was stored
 *   as given and split into that path, so a ref whose segments were not an extension name and an
 *   action id made the loopback request reach another REST route of the node with the caller's
 *   token. POST and PUT /v1/capabilities now refuse such a ref with 400, and invoke resolves the
 *   extension and the action before it sends any request.
 *
 *   AND WHAT STAYS. A capability over a real extension action, written by its owner and invoked by
 *   another owner, still runs the action, also when the ref pins a version (`name@1.0.0`).
 * @usage
 *   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-capability-extension-ref
 * @version-history
 *   v1.2.0 — 2026-10-25 — Names live in the owner's namespace: a bare name in a ref is the registrant's
 *     own extension, and a capability over another account's extension names that account
 *     (owner namespaces wish, secaudit2026oct22).
 *   v1.0.0 — 2026-10-24 — Initial (secaudit2026oct22).
 *   v1.1.0 — 2026-10-25 — Another account's capability over the caller's own extension is 403
 *     EXTENSION_CAPABILITY_NOT_YOURS; the caller's own capability over it runs (secaudit2026oct22).
 */
import { registerOwner } from './helpers/owner-login.js';

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
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const suffix = Math.random().toString(36).slice(2, 8);
const registrantName = `capref-a-${suffix}`;
const callerName = `capref-b-${suffix}`;
let registrant = '';
let caller = '';

console.log('\n=== Capability extension refs ===\n');

await test('Setup: two owners', async () => {
    registrant = (await registerOwner(BASE, registrantName)).token;
    caller = (await registerOwner(BASE, callerName)).token;
    assert(!!registrant && !!caller, 'both owners have a token');
});

/** A capability every signed-in owner may invoke ('owner' visibility; the node runs self_only). */
function capBody(id: string, ref: string) {
    return {
        id, name: `Ref ${id}`, summary: 'extension ref fixture', visibility: 'owner', status: 'active',
        callable: true, source: { type: 'extension', ref, version: '1.0.0' },
    };
}

console.log('Refusals');

await test('POST a capability whose ref is not ext:<name>:<action> is 400, and invoking it writes nothing as the caller', async () => {
    const id = `capref-dots-${suffix}`;
    const probeKey = `capref.probe-${suffix}`;
    const created = await json('/v1/capabilities', {
        method: 'POST', headers: auth(registrant), body: JSON.stringify(capBody(id, 'ext:..:memory')),
    });
    if (created.status !== 400) {
        // The ref was stored: show what another owner's invocation does with it.
        await json(`/v1/capabilities/${id}/invoke`, {
            method: 'POST', headers: auth(caller),
            body: JSON.stringify({ input: { key: probeKey, value: { written: 'by the registrant\'s ref' } } }),
        });
        const probe = await json(`/v1/memory/${encodeURIComponent(probeKey)}`, { headers: auth(caller) });
        throw new Error(`expected 400, got ${created.status}; the caller's memory record ${probeKey} answers ${probe.status}`);
    }
    assert(created.body.error?.code === 'INVALID_INPUT', `code: ${created.body.error?.code}`);
    const back = await json(`/v1/capabilities/${id}`, { headers: auth(registrant) });
    assert(back.status === 404, `nothing is stored, got ${back.status}`);
});

await test('PUT a source with such a ref onto an existing capability is 400, and the stored source stays', async () => {
    const id = `capref-put-${suffix}`;
    const created = await json('/v1/capabilities', {
        method: 'POST', headers: auth(registrant),
        body: JSON.stringify({ id, name: 'Manual', summary: 'manual fixture', visibility: 'owner', source: { type: 'manual', ref: 'manual', version: '1.0.0' } }),
    });
    assert(created.status === 201, `create: ${created.status} ${JSON.stringify(created.body.error)}`);
    const put = await json(`/v1/capabilities/${id}`, {
        method: 'PUT', headers: auth(registrant),
        body: JSON.stringify({ callable: true, source: { type: 'extension', ref: 'ext:..:memory', version: '1.0.0' } }),
    });
    assert(put.status === 400 && put.body.error?.code === 'INVALID_INPUT',
        `expected 400 INVALID_INPUT, got ${put.status} ${put.body.error?.code ?? JSON.stringify(put.body.data?.source)}`);
    const back = await json(`/v1/capabilities/${id}`, { headers: auth(registrant) });
    assert(back.body.data?.source?.type === 'manual' && back.body.data?.source?.ref === 'manual',
        `source must stay manual, got ${JSON.stringify(back.body.data?.source)}`);
});

await test('Another owner may not PUT a source onto the registrant\'s capability: 403, and the source stays', async () => {
    const id = `capref-put-${suffix}`;
    const put = await json(`/v1/capabilities/${id}`, {
        method: 'PUT', headers: auth(caller),
        body: JSON.stringify({ source: { type: 'extension', ref: `ext:no-such-ext-${suffix}:echo`, version: '1.0.0' } }),
    });
    assert(put.status === 403 && put.body.error?.code === 'FORBIDDEN', `expected 403 FORBIDDEN, got ${put.status} ${put.body.error?.code}`);
    const back = await json(`/v1/capabilities/${id}`, { headers: auth(registrant) });
    assert(back.body.data?.source?.type === 'manual', `source must stay manual, got ${JSON.stringify(back.body.data?.source)}`);
});

await test('Invoking a capability over an extension that does not exist is 404 EXTENSION_NOT_FOUND', async () => {
    const id = `capref-none-${suffix}`;
    const created = await json('/v1/capabilities', {
        method: 'POST', headers: auth(registrant), body: JSON.stringify(capBody(id, `ext:no-such-ext-${suffix}:echo`)),
    });
    assert(created.status === 201, `create: ${created.status} ${JSON.stringify(created.body.error)}`);
    const inv = await json(`/v1/capabilities/${id}/invoke`, {
        method: 'POST', headers: auth(caller), body: JSON.stringify({ input: {} }),
    });
    assert(inv.status === 404 && inv.body.error?.code === 'EXTENSION_NOT_FOUND',
        `expected 404 EXTENSION_NOT_FOUND, got ${inv.status} ${inv.body.error?.code}`);
});

console.log('Designed use');

const extName = `capref-ext-${suffix}`;
const manifest = `metadata:
  name: ${extName}
  version: 1.0.0
  description: "Capability ref fixture"
  author: ${registrantName}

actions:
  - id: echo
    method: POST
    path: /echo
    script: actions/echo.js
    description: "Echo the message"
    auth: authenticated
`;
const script = 'export default async function(ctx, input){ return { echoed: "Echo: " + (input.message || "") }; }';

await test('The registrant installs and activates an extension with an echo action', async () => {
    const inst = await json('/v1/extensions', {
        method: 'POST', headers: auth(registrant),
        body: JSON.stringify({ manifest, scripts: { 'actions/echo.js': script } }),
    });
    assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body.error)}`);
    const act = await json(`/v1/extensions/${extName}/activate`, { method: 'POST', headers: auth(registrant) });
    assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body.error)}`);
});

for (const [label, ref] of [['a plain ref', `ext:${extName}:echo`], ['a version-pinned ref', `ext:${extName}@1.0.0:echo`]] as const) {
    await test(`Another owner invokes the registrant's capability over ${label} and the action runs`, async () => {
        const id = `capref-ok-${label.length}-${suffix}`;
        const created = await json('/v1/capabilities', {
            method: 'POST', headers: auth(registrant), body: JSON.stringify(capBody(id, ref)),
        });
        assert(created.status === 201, `create: ${created.status} ${JSON.stringify(created.body.error)}`);
        const inv = await json(`/v1/capabilities/${id}/invoke`, {
            method: 'POST', headers: auth(caller), body: JSON.stringify({ input: { message: 'hi' } }),
        });
        assert(inv.status === 200, `invoke ${inv.status}: ${JSON.stringify(inv.body.error)}`);
        assert(inv.body.data?.result?.echoed === 'Echo: hi', `result: ${JSON.stringify(inv.body.data?.result)}`);
    });
}

console.log('A capability over the caller\'s own extension');

const ownExt = `capref-own-${suffix}`;
const ownManifest = manifest.replace(`name: ${extName}`, `name: ${ownExt}`).replace(`author: ${registrantName}`, `author: ${callerName}`);

await test('The caller installs and activates an extension of its own', async () => {
    const inst = await json('/v1/extensions', {
        method: 'POST', headers: auth(caller),
        body: JSON.stringify({ manifest: ownManifest, scripts: { 'actions/echo.js': script } }),
    });
    assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body.error)}`);
    const act = await json(`/v1/extensions/${ownExt}/activate`, { method: 'POST', headers: auth(caller) });
    assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body.error)}`);
});

await test('Another account\'s capability over the caller\'s own extension does not run for the caller: 403', async () => {
    const id = `capref-front-${suffix}`;
    const created = await json('/v1/capabilities', {
        // The caller's extension is named with its owner (services/component-address.ts); a bare name
        // in the registrant's ref would name the registrant's own.
        method: 'POST', headers: auth(registrant), body: JSON.stringify(capBody(id, `ext:${callerName}/${ownExt}:echo`)),
    });
    assert(created.status === 201, `create: ${created.status} ${JSON.stringify(created.body.error)}`);
    const inv = await json(`/v1/capabilities/${id}/invoke`, {
        method: 'POST', headers: auth(caller), body: JSON.stringify({ input: { message: 'chosen by the registrant' } }),
    });
    assert(inv.status === 403 && inv.body.error?.code === 'EXTENSION_CAPABILITY_NOT_YOURS',
        `expected 403 EXTENSION_CAPABILITY_NOT_YOURS, got ${inv.status} ${inv.body.error?.code ?? JSON.stringify(inv.body.data?.result)}`);
});

await test('The caller\'s own capability over its own extension runs', async () => {
    const id = `capref-mine-${suffix}`;
    const created = await json('/v1/capabilities', {
        method: 'POST', headers: auth(caller), body: JSON.stringify(capBody(id, `ext:${ownExt}:echo`)),
    });
    assert(created.status === 201, `create: ${created.status} ${JSON.stringify(created.body.error)}`);
    const inv = await json(`/v1/capabilities/${id}/invoke`, {
        method: 'POST', headers: auth(caller), body: JSON.stringify({ input: { message: 'mine' } }),
    });
    assert(inv.status === 200 && inv.body.data?.result?.echoed === 'Echo: mine', `invoke ${inv.status}: ${JSON.stringify(inv.body.error ?? inv.body.data)}`);
});

await test('Cleanup', async () => {
    for (const id of [`capref-put-${suffix}`, `capref-none-${suffix}`, `capref-dots-${suffix}`, `capref-front-${suffix}`]) {
        await json(`/v1/capabilities/${id}`, { method: 'DELETE', headers: auth(registrant) });
    }
    await json(`/v1/capabilities/capref-mine-${suffix}`, { method: 'DELETE', headers: auth(caller) });
    await json(`/v1/extensions/${ownExt}/deactivate`, { method: 'POST', headers: auth(caller) });
    await json(`/v1/extensions/${ownExt}`, { method: 'DELETE', headers: auth(caller) });
    await json(`/v1/extensions/${extName}/deactivate`, { method: 'POST', headers: auth(registrant) });
    const del = await json(`/v1/extensions/${extName}`, { method: 'DELETE', headers: auth(registrant) });
    assert(del.status === 200, `delete extension: ${del.status}`);
    for (const [name, token] of [[registrantName, registrant], [callerName, caller]]) {
        await json(`/v1/owners/${name}`, { method: 'DELETE', headers: auth(token) });
    }
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
