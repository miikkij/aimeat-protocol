/**
 * @file test/e2e-admin-doors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator doors the sweep reads but never WRITES through: the bundled-extension
 *   admin surface (src/routes/admin-extensions.ts, 13 % covered and touched by no other suite) and
 *   the write half of src/routes/admin-features.ts — email templates, the GHII CORS and email
 *   doors, push templates, CSM and MSM. Every write is followed by the read that proves it landed,
 *   because a 200 on its own says only that a handler returned.
 * @structure
 *   - Setup: an operator through /v1/admin/setup/register, a second plain owner through /v1/owners
 *   - Section A: admin-extensions — catalogue, install, scaffold, script edit, action add, reinstall
 *   - Section B: admin-features writes — email templates, GHII cors/email, push, CSM, MSM
 *   - Refusals: each section proves a plain owner gets 403 and an anonymous caller 401
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts \
 *     --test=e2e-admin-doors
 * @version-history
 *   v1.0.0 — 2026-09-08 — Written for the coverage work. admin-extensions.ts had no suite at all.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

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

ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const priv = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), priv);
    return Buffer.from(sig).toString('base64');
}

async function ownerTokenFor(name: string, privKey: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, name + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp, signature }),
    });
    assert(body.ok === true, `token for ${name}: ${JSON.stringify(body.error)}`);
    return body.data.token as string;
}

// ─── State ───
const stamp = Date.now();
const operatorName = `doorop${stamp}`;
const plainName = `doorplain${stamp}`;
const mailUser = `doormail${stamp}`;
const mailAddress = `${mailUser}@example.com`;
const scaffoldName = `doorscaf${stamp}`;

let operatorToken = '';
let plainToken = '';
let scaffoldDir = '';

function op(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${operatorToken}` } };
}
function plain(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${plainToken}` } };
}

console.log('\n=== AIMEAT Admin Doors E2E (extensions + features writes) ===\n');
console.log('Setup');

await test('POST /v1/admin/setup/register — an operator, and its token', async () => {
    const { status, body } = await json('/v1/admin/setup/register', {
        method: 'POST',
        headers: { 'X-Admin-Password': ADMIN_PW },
        body: JSON.stringify({ name: operatorName }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.owner?.roles?.includes('operator'), `no operator role: ${JSON.stringify(body.owner)}`);
    operatorToken = await ownerTokenFor(operatorName, body.private_key);
});

await test('POST /v1/owners — a second, plain owner (the node already has an operator)', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: plainName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(!(body.data.owner?.roles ?? []).includes('operator'),
        `the second owner must NOT be an operator: ${JSON.stringify(body.data.owner?.roles)}`);
    plainToken = await ownerTokenFor(plainName, body.data.private_key);
});

// ══════════════════════════════════════════════════════════════════════════
// Section A — src/routes/admin-extensions.ts
// ══════════════════════════════════════════════════════════════════════════
console.log('\nSection A — bundled extensions');

await test('GET /v1/admin/extensions/available → the four bundled extensions, none installed', async () => {
    const { status, body } = await json('/v1/admin/extensions/available', op());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const names = (body.data.extensions as any[]).map(e => e.name);
    for (const want of ['marketplace-behaviors', 'matching-behaviors', 'membership-behaviors', 'rest-connector']) {
        assert(names.includes(want), `bundled catalogue is missing ${want}: ${names.join(', ')}`);
    }
    assert(body.data.total === names.length, 'total does not match the list');
    const membership = (body.data.extensions as any[]).find(e => e.name === 'membership-behaviors');
    assert(membership.installed === false && membership.status === 'not_installed',
        `a fresh node must report membership-behaviors as not installed: ${JSON.stringify(membership)}`);
    const matching = (body.data.extensions as any[]).find(e => e.name === 'matching-behaviors');
    assert(matching.instancesSupported === true, 'matching-behaviors declares instances.supported: true');
    assert(matching.actionsCount >= 1, 'matching-behaviors has actions');
});

await test('POST .../available/membership-behaviors/install → 201, and the extension is really there', async () => {
    const { status, body } = await json('/v1/admin/extensions/available/membership-behaviors/install',
        op({ method: 'POST' }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.extension.name === 'membership-behaviors', 'name in the answer');
    assert(body.data.extension.status === 'active', 'a bundled install activates immediately');
    assert(body.data.extension.actionsCount === 5, `5 actions, got ${body.data.extension.actionsCount}`);

    const read = await json('/v1/extensions/membership-behaviors');
    assert(read.status === 200, `the installed extension must be readable: ${read.status}`);
    assert(read.body.data.extension.status === 'active', 'stored status is active');
    assert(read.body.data.extension.actions.length === 5, 'stored actions were written');
});

await test('...and the catalogue now says so', async () => {
    const { body } = await json('/v1/admin/extensions/available', op());
    const membership = (body.data.extensions as any[]).find(e => e.name === 'membership-behaviors');
    assert(membership.installed === true && membership.status === 'active',
        `catalogue still reports not installed: ${JSON.stringify(membership)}`);
});

await test('POST the same install a second time → 409 ALREADY_EXISTS', async () => {
    const { status, body } = await json('/v1/admin/extensions/available/membership-behaviors/install',
        op({ method: 'POST' }));
    assert(status === 409, `expected 409, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'ALREADY_EXISTS', `code ${body.error?.code}`);
});

await test('Installing matching-behaviors carries its config defaults, schedules and instance support', async () => {
    const { status, body } = await json('/v1/admin/extensions/available/matching-behaviors/install',
        op({ method: 'POST' }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    // A schedule that fails to register reaches the answer (admin-extensions v1.2.0). If this field
    // is ever present, the extension installed but nothing it declares on a schedule would run.
    assert(body.data.schedules_not_registered === undefined,
        `the manifest's schedules did not register: ${body.data.schedules_not_registered}`);

    const read = await json('/v1/extensions/matching-behaviors');
    assert(read.status === 200, `status ${read.status}`);
    const ext = read.body.data.extension;
    // config: a manifest entry shaped { type, default } is unwrapped to its default (:250-259).
    assert(ext.config.max_distance_km === 100, `max_distance_km default, got ${JSON.stringify(ext.config.max_distance_km)}`);
    assert(ext.config.match_threshold === 0.3, `match_threshold default, got ${JSON.stringify(ext.config.match_threshold)}`);
    // schedules ride in config.__schedules (:260), which is what the schedule builder reads.
    assert(Array.isArray(ext.config.__schedules) && ext.config.__schedules.some((s: any) => s.id === 'matching-round'),
        `__schedules missing the matching-round job: ${JSON.stringify(ext.config.__schedules)}`);
    // instances (:280-285) only appears when the manifest declares supported: true.
    assert(ext.instances?.supported === true, `instances.supported not carried: ${JSON.stringify(ext.instances)}`);
    assert(typeof ext.instances.configSchema === 'object', 'the per-instance config schema came with it');
});

await test('POST .../available/no-such-extension/install → 404', async () => {
    const { status, body } = await json('/v1/admin/extensions/available/no-such-extension/install',
        op({ method: 'POST' }));
    assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'NOT_FOUND', `code ${body.error?.code}`);
});

await test('A name that is not a plain lowercase segment is refused before any path is joined → 400', async () => {
    // isSafeSegment (:53) is the traversal guard: even on an operator-only route an unvalidated
    // :name joined into a path reads or WRITES outside docs/extensions/.
    for (const bad of ['..%2Fetc', 'Etc..Passwd', '%2E%2E%2Fetc']) {
        const { status, body } = await json(`/v1/admin/extensions/available/${bad}/install`, op({ method: 'POST' }));
        assert(status === 400, `${bad} → expected 400, got ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'VALIDATION_ERROR', `${bad} → code ${body.error?.code}`);
    }
});

await test('GET .../available/rest-connector/scripts/pull → the source on disk', async () => {
    const { status, body } = await json('/v1/admin/extensions/available/rest-connector/scripts/pull', op());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.actionId === 'pull', 'actionId echoed');
    assert(typeof body.data.scriptContent === 'string' && body.data.scriptContent.includes('pull.js'),
        'the answer carries the file rest-connector/actions/pull.js');
});

await test('GET a script that is not on disk → 404', async () => {
    const { status, body } = await json('/v1/admin/extensions/available/rest-connector/scripts/nosuchscript', op());
    assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
});

try {
    await test('POST /v1/admin/extensions/scaffold → 201, and the files exist on disk', async () => {
        const { status, body } = await json('/v1/admin/extensions/scaffold', op({
            method: 'POST',
            body: JSON.stringify({ name: scaffoldName, description: 'Throwaway scaffold for e2e-admin-doors' }),
        }));
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.name === scaffoldName, 'name echoed');
        assert(typeof body.data.directory === 'string' && basename(body.data.directory) === scaffoldName,
            `the directory answered must be the one asked for: ${body.data.directory}`);
        scaffoldDir = body.data.directory;
        assert(existsSync(join(scaffoldDir, 'extension.yaml')), 'extension.yaml was written');
        assert(existsSync(join(scaffoldDir, 'actions', 'list.js')), 'actions/list.js was written');
        assert(existsSync(join(scaffoldDir, 'actions', 'create.js')), 'actions/create.js was written');
        assert(readFileSync(join(scaffoldDir, 'extension.yaml'), 'utf-8').includes(scaffoldName),
            'the manifest names the extension');
    });

    await test('...and the catalogue picks the scaffolded extension up', async () => {
        const { body } = await json('/v1/admin/extensions/available', op());
        const mine = (body.data.extensions as any[]).find(e => e.name === scaffoldName);
        assert(!!mine, `the scaffolded extension is not in the catalogue: ${(body.data.extensions as any[]).map(e => e.name).join(', ')}`);
        assert(mine.actionsCount === 2, `scaffold ships list + create, got ${mine.actionsCount}`);
        assert(mine.installed === false, 'scaffolding writes files, it does not install');
    });

    await test('Scaffolding the same name twice → 409 ALREADY_EXISTS', async () => {
        const { status, body } = await json('/v1/admin/extensions/scaffold', op({
            method: 'POST',
            body: JSON.stringify({ name: scaffoldName }),
        }));
        assert(status === 409, `expected 409, got ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'ALREADY_EXISTS', `code ${body.error?.code}`);
    });

    await test('POST /v1/admin/extensions/scaffold with a name outside the shape → 400', async () => {
        const { status, body } = await json('/v1/admin/extensions/scaffold', op({
            method: 'POST',
            body: JSON.stringify({ name: 'No' }),
        }));
        assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    });

    await test('PUT .../scripts/list replaces the source, and the read gives back exactly that', async () => {
        const source = `export default async function(ctx, input) {\n  return { items: [], total: 0, marker: 'e2e-admin-doors-${stamp}' };\n}\n`;
        const { status, body } = await json(`/v1/admin/extensions/available/${scaffoldName}/scripts/list`, op({
            method: 'PUT',
            body: JSON.stringify({ scriptContent: source }),
        }));
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.saved === true, 'saved');

        const read = await json(`/v1/admin/extensions/available/${scaffoldName}/scripts/list`, op());
        assert(read.status === 200, `read back: ${read.status}`);
        assert(read.body.data.scriptContent === source, 'the file on disk is the source we sent');
        assert(readFileSync(join(scaffoldDir, 'actions', 'list.js'), 'utf-8') === source,
            'and the bytes on disk match too');
    });

    await test('PUT a script with no scriptContent → 400', async () => {
        const { status } = await json(`/v1/admin/extensions/available/${scaffoldName}/scripts/list`, op({
            method: 'PUT',
            body: JSON.stringify({}),
        }));
        assert(status === 400, `expected 400, got ${status}`);
    });

    await test('POST .../actions adds an action to the manifest AND writes its script', async () => {
        const { status, body } = await json(`/v1/admin/extensions/available/${scaffoldName}/actions`, op({
            method: 'POST',
            body: JSON.stringify({ id: 'ping', method: 'get', description: 'Say hello' }),
        }));
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.created === true, 'created');
        assert(body.data.method === 'GET', `the method is upper-cased, got ${body.data.method}`);

        const script = await json(`/v1/admin/extensions/available/${scaffoldName}/scripts/ping`, op());
        assert(script.status === 200, `the template script was not written: ${script.status}`);
        assert(script.body.data.scriptContent.includes('Action: ping'), 'the template names the action');

        const cat = await json('/v1/admin/extensions/available', op());
        const mine = (cat.body.data.extensions as any[]).find(e => e.name === scaffoldName);
        assert(mine.actionsCount === 3, `the manifest now declares 3 actions, got ${mine.actionsCount}`);
        assert(mine.actions.some((a: any) => a.id === 'ping' && a.method === 'GET'),
            `ping is not in the manifest: ${JSON.stringify(mine.actions)}`);
    });

    await test('POST .../actions with an id the manifest already has → 409 DUPLICATE', async () => {
        const { status, body } = await json(`/v1/admin/extensions/available/${scaffoldName}/actions`, op({
            method: 'POST',
            body: JSON.stringify({ id: 'list' }),
        }));
        assert(status === 409, `expected 409, got ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'DUPLICATE', `code ${body.error?.code}`);
    });

    await test('POST .../actions with an id outside the shape → 400', async () => {
        const { status } = await json(`/v1/admin/extensions/available/${scaffoldName}/actions`, op({
            method: 'POST',
            body: JSON.stringify({ id: 'Not An Id' }),
        }));
        assert(status === 400, `expected 400, got ${status}`);
    });

    await test('POST .../actions on an extension that is not on disk → 404', async () => {
        const { status } = await json('/v1/admin/extensions/available/no-such-extension/actions', op({
            method: 'POST',
            body: JSON.stringify({ id: 'ping' }),
        }));
        assert(status === 404, `expected 404, got ${status}`);
    });

    await test('POST .../reinstall on an installed extension → reinstalled: true', async () => {
        const { status, body } = await json('/v1/admin/extensions/available/membership-behaviors/reinstall',
            op({ method: 'POST' }));
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.reinstalled === true, 'it was already installed, so this is an update');
        assert(body.data.extension.actionsCount === 5, 'the actions came back from disk');
        const read = await json('/v1/extensions/membership-behaviors');
        assert(read.body.data.extension.status === 'active', 'still active after the update');
    });

    await test('POST .../reinstall on one that was never installed → reinstalled: false, and it lands', async () => {
        const before = await json('/v1/extensions/rest-connector');
        assert(before.status === 404, `rest-connector must not be installed yet, got ${before.status}`);
        const { status, body } = await json('/v1/admin/extensions/available/rest-connector/reinstall',
            op({ method: 'POST' }));
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.reinstalled === false, 'a fresh install reports reinstalled: false');
        const after = await json('/v1/extensions/rest-connector');
        assert(after.status === 200, `the fresh install is not readable: ${after.status}`);
        assert(after.body.data.extension.status === 'active', 'a disk install activates');
    });

    await test('POST .../reinstall on an extension that is not on disk → 404', async () => {
        const { status } = await json('/v1/admin/extensions/available/no-such-extension/reinstall',
            op({ method: 'POST' }));
        assert(status === 404, `expected 404, got ${status}`);
    });

    console.log('\nSection A — refusals');

    const EXT_DOORS: Array<{ method: string; path: string; body?: unknown }> = [
        { method: 'GET', path: '/v1/admin/extensions/available' },
        { method: 'POST', path: '/v1/admin/extensions/available/membership-behaviors/install' },
        { method: 'POST', path: '/v1/admin/extensions/scaffold', body: { name: 'never-scaffolded-here' } },
        { method: 'GET', path: `/v1/admin/extensions/available/${scaffoldName}/scripts/list` },
        { method: 'PUT', path: `/v1/admin/extensions/available/${scaffoldName}/scripts/list`, body: { scriptContent: 'hijacked' } },
        { method: 'POST', path: `/v1/admin/extensions/available/${scaffoldName}/actions`, body: { id: 'hijacked' } },
        { method: 'POST', path: '/v1/admin/extensions/available/rest-connector/reinstall' },
    ];

    await test('The catalogue itself: 401 with no credential, 403 for a plain owner', async () => {
        const anon = await json('/v1/admin/extensions/available');
        assert(anon.status === 401, `no credential → expected 401, got ${anon.status}`);
        const owner = await json('/v1/admin/extensions/available', plain());
        assert(owner.status === 403, `a plain owner → expected 403, got ${owner.status}`);
    });

    await test(`Every bundled-extension door refuses a plain owner (${EXT_DOORS.length} routes, 403)`, async () => {
        const bad: string[] = [];
        for (const door of EXT_DOORS) {
            const { status } = await json(door.path, plain({
                method: door.method,
                ...(door.body ? { body: JSON.stringify(door.body) } : {}),
            }));
            if (status !== 403) bad.push(`${door.method} ${door.path} → ${status}`);
        }
        assert(bad.length === 0, `these doors let a plain owner in: ${bad.join(', ')}`);
    });

    await test(`Every bundled-extension door refuses an anonymous caller (${EXT_DOORS.length} routes, 401)`, async () => {
        const bad: string[] = [];
        for (const door of EXT_DOORS) {
            const { status } = await json(door.path, {
                method: door.method,
                ...(door.body ? { body: JSON.stringify(door.body) } : {}),
            });
            if (status !== 401) bad.push(`${door.method} ${door.path} → ${status}`);
        }
        assert(bad.length === 0, `these doors answered without a credential: ${bad.join(', ')}`);
    });

    await test('The refused writes changed nothing on disk', async () => {
        assert(!existsSync(join(scaffoldDir, '..', 'never-scaffolded-here')),
            'a plain owner scaffolded a directory');
        assert(!readFileSync(join(scaffoldDir, 'actions', 'list.js'), 'utf-8').includes('hijacked'),
            'a refused PUT still wrote the script');
    });
} finally {
    // The scaffold route WRITES into docs/extensions/, which is a tracked directory. Take the
    // throwaway back out whatever happened above, and only ever the one this run created.
    if (scaffoldDir && basename(scaffoldDir) === scaffoldName && existsSync(scaffoldDir)) {
        rmSync(scaffoldDir, { recursive: true, force: true });
    }
}

// ══════════════════════════════════════════════════════════════════════════
// Section B — the write half of src/routes/admin-features.ts
// ══════════════════════════════════════════════════════════════════════════
console.log('\nSection B — email templates');

const CUSTOM_HTML = `<html><body><h1>e2e-admin-doors ${stamp}</h1></body></html>`;
const CUSTOM_TEXT = `e2e-admin-doors ${stamp}`;
let defaultNotificationHtml = '';

await test('GET /v1/admin/email/templates — a fresh node has no custom template', async () => {
    const { status, body } = await json('/v1/admin/email/templates', op());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.locale === 'en', 'the default locale is en');
    assert(body.data.seeded === false, 'nothing is stored yet');
    const ids = (body.data.templates as any[]).map(t => t.id);
    assert(ids.join(',') === 'verification,magic_link,notification', `template ids: ${ids.join(',')}`);
    const notif = (body.data.templates as any[]).find(t => t.id === 'notification');
    assert(notif.isCustom === false, 'the code default is what is served');
    assert(notif.preview === notif.defaultHtml, 'preview falls back to the default');
    defaultNotificationHtml = notif.defaultHtml;
});

await test('POST /v1/admin/email/templates/seed → three templates in each of the three languages', async () => {
    const { status, body } = await json('/v1/admin/email/templates/seed', op({ method: 'POST' }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.seeded === true, 'seeded');
    assert(body.data.count === 9, `3 templates x 3 locales = 9, got ${body.data.count}`);

    const after = await json('/v1/admin/email/templates', op());
    assert(after.body.data.seeded === true, 'the seed is now readable');
    assert((after.body.data.templates as any[]).every(t => t.isCustom === true),
        'every template now comes from memory');
});

await test('PUT /v1/admin/email/templates/notification stores my own copy, and the read returns it', async () => {
    const { status, body } = await json('/v1/admin/email/templates/notification', op({
        method: 'PUT',
        body: JSON.stringify({ locale: 'en', html: CUSTOM_HTML, text: CUSTOM_TEXT }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.saved === true && body.data.id === 'notification' && body.data.locale === 'en',
        `the answer does not name what was saved: ${JSON.stringify(body.data)}`);

    const read = await json('/v1/admin/email/templates', op());
    const notif = (read.body.data.templates as any[]).find(t => t.id === 'notification');
    assert(notif.preview === CUSTOM_HTML, 'the stored html is what is served');
    assert(notif.text === CUSTOM_TEXT, 'the stored text is what is served');
    assert(notif.defaultHtml !== CUSTOM_HTML, 'the code default is still there beside it');
});

await test('...and a Finnish reader still gets the Finnish default (the write was per locale)', async () => {
    const { body } = await json('/v1/admin/email/templates?locale=fi', op());
    const notif = (body.data.templates as any[]).find(t => t.id === 'notification');
    assert(notif.preview !== CUSTOM_HTML, 'the en write leaked into fi');
});

await test('PUT with a template id that does not exist → 400', async () => {
    const { status, body } = await json('/v1/admin/email/templates/nosuchtemplate', op({
        method: 'PUT',
        body: JSON.stringify({ locale: 'en', html: 'x', text: 'x' }),
    }));
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'INVALID_INPUT', `code ${body.error?.code}`);
});

await test('DELETE /v1/admin/email/templates/notification puts the code default back', async () => {
    const { status, body } = await json('/v1/admin/email/templates/notification?locale=en', op({ method: 'DELETE' }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.reset === true, 'reset');

    const read = await json('/v1/admin/email/templates', op());
    const notif = (read.body.data.templates as any[]).find(t => t.id === 'notification');
    assert(notif.preview === defaultNotificationHtml, 'the default is served again');
    // TODAY'S BEHAVIOUR, pinned rather than judged: the delete immediately re-seeds the default INTO
    // memory (:369-374), so the template stays isCustom even though its content is the default one.
    assert(notif.isCustom === true, 'delete re-seeds the default into memory, so isCustom stays true');
});

await test('POST /v1/admin/email/templates/reset clears the customs and seeds all nine again', async () => {
    await json('/v1/admin/email/templates/verification', op({
        method: 'PUT',
        body: JSON.stringify({ locale: 'en', html: CUSTOM_HTML, text: CUSTOM_TEXT }),
    }));
    const before = await json('/v1/admin/email/templates', op());
    assert((before.body.data.templates as any[]).find(t => t.id === 'verification').preview === CUSTOM_HTML,
        'setup: the custom verification template is in place');

    const { status, body } = await json('/v1/admin/email/templates/reset', op({ method: 'POST' }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.reset === true && body.data.count === 9, `reset count, got ${body.data.count}`);

    const after = await json('/v1/admin/email/templates', op());
    const verification = (after.body.data.templates as any[]).find(t => t.id === 'verification');
    assert(verification.preview === verification.defaultHtml, 'the custom copy is gone');
});

await test('POST /v1/admin/email/send-group with no subject → 400 before anything is sent', async () => {
    const { status, body } = await json('/v1/admin/email/send-group', op({
        method: 'POST',
        body: JSON.stringify({ group: 'all', body: 'a body with no subject' }),
    }));
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'VALIDATION_ERROR', `code ${body.error?.code}`);
});

await test('POST /v1/admin/email/send-group on a node with no SMTP → EMAIL_DISABLED', async () => {
    // The runner deliberately configures no mail server; read the status door rather than demanding
    // a send this node cannot make (the same reasoning as e2e-admin-features' email test).
    const st = await json('/v1/admin/email/status', op());
    const emailOn = st.body?.data?.enabled === true;
    const { status, body } = await json('/v1/admin/email/send-group', op({
        method: 'POST',
        body: JSON.stringify({ group: 'operators', subject: 'e2e', body: 'e2e' }),
    }));
    // One rule either way, so nothing here depends on which machine it runs on: the door never goes
    // quiet. Configured, it says how many messages went out; unconfigured, it refuses and names the
    // reason. AIMEAT_SMTP_HOST is not pinned by the runner, so both are reachable.
    assert(emailOn
        ? (status === 200 && typeof body.data.sent === 'number')
        : (status === 400 && body.error?.code === 'EMAIL_DISABLED'),
        `email is ${emailOn ? 'on' : 'off'} and the answer was ${status}: ${JSON.stringify(body)}`);
});

console.log('\nSection B — GHII administration');

let mailGhii = '';

await test('Setup: an account with a notification email', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({
            username: mailUser, display_name: 'Door Mail', password: 'DoorMail1234', email: mailAddress,
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    mailGhii = `${mailUser}@${NODE_ID}`;
});

await test('GET /v1/admin/ghii masks the address rather than serving it', async () => {
    const { status, body } = await json('/v1/admin/ghii', op());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const row = (body.data.ghii_users as any[]).find(u => u.ghii === mailGhii);
    assert(!!row, `the account is not in the list: ${(body.data.ghii_users as any[]).map(u => u.ghii).join(', ')}`);
    assert(row.masked_email === `${mailUser[0]}***@example.com`,
        `masked address, got ${row.masked_email}`);
    assert(!JSON.stringify(row).includes(mailAddress), 'the full address must not appear in the row');
    assert(row.email_verified === false, 'a registration email is unverified');
});

await test('PUT /v1/admin/ghii/:ghii/cors sets the origins, and the list shows them', async () => {
    const origins = ['https://door.example', 'https://door2.example'];
    const { status, body } = await json(`/v1/admin/ghii/${encodeURIComponent(mailGhii)}/cors`, op({
        method: 'PUT',
        body: JSON.stringify({ allowed_origins: origins }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(JSON.stringify(body.data.allowed_origins) === JSON.stringify(origins), 'the answer echoes the origins');

    const list = await json('/v1/admin/ghii', op());
    const row = (list.body.data.ghii_users as any[]).find(u => u.ghii === mailGhii);
    assert(JSON.stringify(row.allowed_origins) === JSON.stringify(origins), 'the stored record carries them');
});

await test('PUT .../cors refuses a value that is not an array, and an origin that is not a URL', async () => {
    const notArray = await json(`/v1/admin/ghii/${encodeURIComponent(mailGhii)}/cors`, op({
        method: 'PUT',
        body: JSON.stringify({ allowed_origins: 'https://door.example' }),
    }));
    assert(notArray.status === 400, `expected 400, got ${notArray.status}`);
    assert(notArray.body.error?.code === 'INVALID_INPUT', `code ${notArray.body.error?.code}`);

    const badOrigin = await json(`/v1/admin/ghii/${encodeURIComponent(mailGhii)}/cors`, op({
        method: 'PUT',
        body: JSON.stringify({ allowed_origins: ['ftp://door.example'] }),
    }));
    assert(badOrigin.status === 400, `expected 400, got ${badOrigin.status}`);

    const list = await json('/v1/admin/ghii', op());
    const row = (list.body.data.ghii_users as any[]).find(u => u.ghii === mailGhii);
    assert(row.allowed_origins.length === 2, 'a refused write must not have changed the record');
});

await test('PUT .../cors on a GHII that does not exist → 404', async () => {
    const { status } = await json('/v1/admin/ghii/nobody%40nowhere/cors', op({
        method: 'PUT',
        body: JSON.stringify({ allowed_origins: ['https://door.example'] }),
    }));
    assert(status === 404, `expected 404, got ${status}`);
});

await test("PUT .../cors with null clears the account's origin list", async () => {
    const { status, body } = await json(`/v1/admin/ghii/${encodeURIComponent(mailGhii)}/cors`, op({
        method: 'PUT',
        body: JSON.stringify({ allowed_origins: null }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const list = await json('/v1/admin/ghii', op());
    const row = (list.body.data.ghii_users as any[]).find(u => u.ghii === mailGhii);
    assert(row.allowed_origins === null,
        `the origins were not cleared: ${JSON.stringify(row.allowed_origins)}`);
});

await test('DELETE /v1/admin/ghii/:ghii/email takes the address off the account', async () => {
    const { status, body } = await json(`/v1/admin/ghii/${encodeURIComponent(mailGhii)}/email`, op({ method: 'DELETE' }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.deleted === true && body.data.ghii === mailGhii, 'the answer names what was deleted');

    const list = await json('/v1/admin/ghii', op());
    const row = (list.body.data.ghii_users as any[]).find(u => u.ghii === mailGhii);
    assert(row.masked_email === null, `the masked address is still there: ${row.masked_email}`);
    assert(row.email_hash === null, 'the hash went with it');
    assert(row.email_verified === false, 'and the verification mark');
    assert(row.verification_level === 0, 'the account drops back to level 0');
});

await test('DELETE the email of a GHII that does not exist → 404', async () => {
    const { status } = await json('/v1/admin/ghii/nobody%40nowhere/email', op({ method: 'DELETE' }));
    assert(status === 404, `expected 404, got ${status}`);
});

console.log('\nSection B — push templates');

const CUSTOM_PUSH_BODY = `e2e-admin-doors push body ${stamp}`;
let defaultPushBody = '';

await test('PUT /v1/admin/push/templates/web_push_mailbox/en stores the template', async () => {
    const before = await json('/v1/admin/push', op());
    const row0 = (before.body.data.templates as any[]).find(t => t.id === 'web_push_mailbox' && t.locale === 'en');
    assert(row0.is_default === true, 'nothing is stored on a fresh node');
    defaultPushBody = row0.fields.body;

    const { status, body } = await json('/v1/admin/push/templates/web_push_mailbox/en', op({
        method: 'PUT',
        body: JSON.stringify({ fields: { title: 'Door test', body: CUSTOM_PUSH_BODY } }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.template.fields.body === CUSTOM_PUSH_BODY, 'the answer carries the stored record');
    assert(body.data.template.updatedBy === operatorName, `the operator is recorded, got ${body.data.template.updatedBy}`);

    const after = await json('/v1/admin/push', op());
    const row = (after.body.data.templates as any[]).find(t => t.id === 'web_push_mailbox' && t.locale === 'en');
    assert(row.is_default === false, 'the row is no longer the code default');
    assert(row.fields.body === CUSTOM_PUSH_BODY, 'the stored body is served');
    assert(row.fields.title === 'Door test', 'and the title with it');
});

await test('PUT a push template refuses an unknown id, an unknown locale and a missing body', async () => {
    const badId = await json('/v1/admin/push/templates/no_such_template/en', op({
        method: 'PUT', body: JSON.stringify({ fields: { body: 'x' } }),
    }));
    assert(badId.status === 400, `unknown id → expected 400, got ${badId.status}`);

    const badLocale = await json('/v1/admin/push/templates/web_push_mailbox/xx', op({
        method: 'PUT', body: JSON.stringify({ fields: { body: 'x' } }),
    }));
    assert(badLocale.status === 400, `unknown locale → expected 400, got ${badLocale.status}`);

    const noBody = await json('/v1/admin/push/templates/web_push_mailbox/en', op({
        method: 'PUT', body: JSON.stringify({ fields: { title: 'no body here' } }),
    }));
    assert(noBody.status === 400, `missing fields.body → expected 400, got ${noBody.status}`);

    const after = await json('/v1/admin/push', op());
    const row = (after.body.data.templates as any[]).find(t => t.id === 'web_push_mailbox' && t.locale === 'en');
    assert(row.fields.body === CUSTOM_PUSH_BODY, 'a refused write must not have touched the record');
});

await test('POST /v1/admin/push/test with no subscription for this operator → 404', async () => {
    const { status, body } = await json('/v1/admin/push/test', op({ method: 'POST' }));
    assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'NOT_FOUND', `code ${body.error?.code}`);
});

await test('POST /v1/admin/push/templates/reset puts every locale back to its default', async () => {
    const { status, body } = await json('/v1/admin/push/templates/reset', op({ method: 'POST' }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.reset === true, 'reset');
    assert(body.data.count === 6, `2 template ids x 3 locales = 6, got ${body.data.count}`);

    const after = await json('/v1/admin/push', op());
    const row = (after.body.data.templates as any[]).find(t => t.id === 'web_push_mailbox' && t.locale === 'en');
    assert(row.fields.body === defaultPushBody, `the custom body survived the reset: ${row.fields.body}`);
});

console.log('\nSection B — CSM and MSM');

let csmName = '';

await test('Setup: register a CSM of my own from the hobby-directory template', async () => {
    const res = await fetch(`${BASE}/v1/csm/templates/hobby-directory`);
    assert(res.status === 200, `template fetch ${res.status}`);
    // The node seeds this template's own service at boot, so the name has to be made unique or the
    // registration is a 409 against the node's own copy rather than anything this suite did.
    const wanted = `Door Directory ${stamp}`;
    const yaml = (await res.text()).replace('"Harrastehakemisto"', JSON.stringify(wanted));
    const { status, body } = await json('/v1/csm', op({ method: 'POST', body: JSON.stringify({ yaml }) }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    csmName = body.data.csm.name;
    assert(csmName === wanted, `the service registered under the name given, got ${csmName}`);
});

await test('GET /v1/admin/csm and /v1/admin/csm/:name answer about the registered service', async () => {
    const list = await json('/v1/admin/csm', op());
    assert(list.status === 200, `status ${list.status}`);
    const row = (list.body.data.templates as any[]).find(t => t.name === csmName);
    assert(!!row, `the CSM is not in the admin list: ${(list.body.data.templates as any[]).map(t => t.name).join(', ')}`);
    assert(row.registered_by === operatorName, `registered_by, got ${row.registered_by}`);

    const one = await json(`/v1/admin/csm/${encodeURIComponent(csmName)}`, op());
    assert(one.status === 200, `status ${one.status}`);
    assert(typeof one.body.data.definition === 'object', 'the detail carries the definition');
    assert(typeof one.body.data.json_schema_key === 'string', 'and the schema key');
});

await test('DELETE /v1/admin/csm/:name removes the service, and the read then says so', async () => {
    const { status, body } = await json(`/v1/admin/csm/${encodeURIComponent(csmName)}`, op({ method: 'DELETE' }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.deleted === true && body.data.name === csmName, 'the answer names what went');

    const gone = await json(`/v1/admin/csm/${encodeURIComponent(csmName)}`, op());
    assert(gone.status === 404, `expected 404 after the delete, got ${gone.status}`);
    const list = await json('/v1/admin/csm', op());
    assert(!(list.body.data.templates as any[]).some(t => t.name === csmName), 'it is out of the list too');
});

await test('DELETE a CSM that does not exist → 404', async () => {
    const { status } = await json('/v1/admin/csm/no-such-service', op({ method: 'DELETE' }));
    assert(status === 404, `expected 404, got ${status}`);
});

let msmName = '';

await test('Setup: register an MSM from the weather-pricing template', async () => {
    const res = await fetch(`${BASE}/v1/msm/templates/weather-pricing`);
    assert(res.status === 200, `template fetch ${res.status}`);
    const yaml = await res.text();
    const { status, body } = await json('/v1/msm', op({ method: 'POST', body: JSON.stringify({ yaml }) }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    msmName = body.data.integration.name;
});

await test('PUT /v1/admin/msm/:name writes the description and the federate flag', async () => {
    const description = `Edited by e2e-admin-doors ${stamp}`;
    const { status, body } = await json(`/v1/admin/msm/${encodeURIComponent(msmName)}`, op({
        method: 'PUT',
        body: JSON.stringify({ description, federate: true }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.federate === true, 'the answer carries the flag');

    const one = await json(`/v1/admin/msm/${encodeURIComponent(msmName)}`, op());
    assert(one.status === 200, `status ${one.status}`);
    assert(one.body.data.federate === true, 'the stored record carries the flag');
    assert(one.body.data.definition.service.description === description,
        `the description went into the definition, got ${one.body.data.definition.service.description}`);
});

await test('PUT an MSM that does not exist → 404', async () => {
    const { status } = await json('/v1/admin/msm/no-such-integration', op({
        method: 'PUT', body: JSON.stringify({ federate: true }),
    }));
    assert(status === 404, `expected 404, got ${status}`);
});

await test('DELETE /v1/admin/msm/:name removes the integration', async () => {
    const { status, body } = await json(`/v1/admin/msm/${encodeURIComponent(msmName)}`, op({ method: 'DELETE' }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.deleted === true, 'deleted');

    const gone = await json(`/v1/admin/msm/${encodeURIComponent(msmName)}`, op());
    assert(gone.status === 404, `expected 404 after the delete, got ${gone.status}`);
});

console.log('\nSection B — refusals');

const FEATURE_WRITE_DOORS: Array<{ method: string; path: string; body?: unknown }> = [
    { method: 'POST', path: '/v1/admin/email/templates/seed' },
    { method: 'POST', path: '/v1/admin/email/templates/reset' },
    { method: 'PUT', path: '/v1/admin/email/templates/notification', body: { locale: 'en', html: 'hijacked', text: 'hijacked' } },
    { method: 'DELETE', path: '/v1/admin/email/templates/notification' },
    { method: 'POST', path: '/v1/admin/email/send-group', body: { group: 'all', subject: 'x', body: 'y' } },
    { method: 'PUT', path: `/v1/admin/ghii/${encodeURIComponent(`${operatorName}@${NODE_ID}`)}/cors`, body: { allowed_origins: ['https://hijacked.example'] } },
    { method: 'DELETE', path: `/v1/admin/ghii/${encodeURIComponent(`${operatorName}@${NODE_ID}`)}/email` },
    { method: 'PUT', path: '/v1/admin/push/templates/web_push_mailbox/en', body: { fields: { body: 'hijacked' } } },
    { method: 'POST', path: '/v1/admin/push/templates/reset' },
    { method: 'POST', path: '/v1/admin/push/test' },
];

await test(`Every admin-features write door refuses a plain owner (${FEATURE_WRITE_DOORS.length} routes, 403)`, async () => {
    const bad: string[] = [];
    for (const door of FEATURE_WRITE_DOORS) {
        const { status } = await json(door.path, plain({
            method: door.method,
            ...(door.body ? { body: JSON.stringify(door.body) } : {}),
        }));
        if (status !== 403) bad.push(`${door.method} ${door.path} → ${status}`);
    }
    assert(bad.length === 0, `these write doors let a plain owner in: ${bad.join(', ')}`);
});

await test(`Every admin-features write door refuses an anonymous caller (${FEATURE_WRITE_DOORS.length} routes, 401)`, async () => {
    const bad: string[] = [];
    for (const door of FEATURE_WRITE_DOORS) {
        const { status } = await json(door.path, {
            method: door.method,
            ...(door.body ? { body: JSON.stringify(door.body) } : {}),
        });
        if (status !== 401) bad.push(`${door.method} ${door.path} → ${status}`);
    }
    assert(bad.length === 0, `these write doors answered without a credential: ${bad.join(', ')}`);
});

await test('And none of those refused writes landed', async () => {
    const push = await json('/v1/admin/push', op());
    const row = (push.body.data.templates as any[]).find(t => t.id === 'web_push_mailbox' && t.locale === 'en');
    assert(row.fields.body !== 'hijacked', 'a refused push write landed');

    const tpl = await json('/v1/admin/email/templates', op());
    const notif = (tpl.body.data.templates as any[]).find(t => t.id === 'notification');
    assert(notif.preview !== 'hijacked', 'a refused email-template write landed');

    const ghii = await json('/v1/admin/ghii', op());
    const opRow = (ghii.body.data.ghii_users as any[]).find(u => u.ghii === `${operatorName}@${NODE_ID}`);
    assert(!(opRow?.allowed_origins ?? []).includes('https://hijacked.example'),
        "a refused CORS write reached the operator's own record");
});

// ─── Summary ───
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
