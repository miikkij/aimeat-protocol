/**
 * @file test/e2e-app-rollback.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for putting an earlier version of an app back in one call
 *   (POST /v1/apps/:owner/:filename/rollback, services/app/rollback-ops.ts):
 *   - version 1 comes back as version 3 with its own bytes, version 2 stays in the history;
 *   - the rollback goes through while the app owes its design spec, where an ordinary update is
 *     refused with APP_OWES_ITEMS, and the answer names what the app owes;
 *   - the audit log records version.rollback with the reason, and the audit answer counts the
 *     failed change against the changes of the last 90 days;
 *   - refusals: no reason, a version that is not earlier, the bytes already live, and another
 *     owner, who may not roll back somebody else's app.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-rollback
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-app-rollback-in-one-call-and-a-count-of-failed-changes-per-a).
 */
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

/** A quick prototype that reads only, so the one item it owes on an update is its design spec. */
const page = (filename: string, word: string) => [
    '<!DOCTYPE html><html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content">',
    `<meta name="aimeat-app" content="${filename}">`,
    '<meta name="aimeat-level" content="proto">',
    '<meta name="aimeat-scopes" content="memory:read">',
    '<meta name="aimeat-locales" content="en fi">',
    '<link rel="stylesheet" href="/lib/aimeat-theme.css">',
    '<style>.card{background:var(--color-base-200);display:grid;grid-template-columns:minmax(0,1fr)}.card>*{min-width:0}</style>',
    `</head><body style="overflow-x:clip"><div id="login"></div><div class="card">${word}</div>`,
    '<script src="/v1/libs/aimeat-auth.js"></' + 'script>',
    '<script>AIMEAT.auth.mountLoginButton("#login", { onLogin: () => {} });</' + 'script></body></html>',
].join('\n');

(async () => {
    console.log('\n── App rollback: an earlier version back in one call ──');
    const alice = await registerOwner(BASE, `rollbacka${Date.now()}`);
    const auth = { Authorization: `Bearer ${alice.token}` };
    const f = `rollback${Date.now()}.html`;
    const app = `/v1/apps/${encodeURIComponent(alice.name)}/${encodeURIComponent(f)}`;
    const publish = (word: string) => json('/v1/apps', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ filename: f, mime_type: 'text/html', content: b64(page(f, word)), name: 'Rollback', description: 'An app rolled back.', roadmap: `The page now says ${word}.` }),
    });
    const rollback = (body: Record<string, unknown>, headers: Record<string, string> = auth) =>
        json(`${app}/rollback`, { method: 'POST', headers, body: JSON.stringify(body) });

    // apps.owed_on_publish = refuse, as production runs it; the runner pins it to warn. The first owner
    // on the suite's fresh node is its operator, so alice switches it, and the end switches it back.
    const owed = (value: string) => json('/v1/admin/config', { method: 'PUT', headers: auth, body: JSON.stringify({ changes: [{ path: 'apps.owed_on_publish', value }] }) });

    await test('setup: the gate as production runs it, version 1, a design spec, version 2, and the spec taken away again', async () => {
        const on = await owed('refuse');
        assert(on.status === 200, `the operator turns the owed gate on: ${on.status} ${JSON.stringify(on.body?.error)}`);
        const v1 = await publish('first-good-version');
        assert(v1.status === 201, `v1: ${v1.status} ${JSON.stringify(v1.body?.error)}`);
        const spec = await json(`${app}/design-spec`, { method: 'PUT', headers: auth, body: JSON.stringify({ markdown: '# Design spec\n\n## Purpose\nA test app.\n' }) });
        assert(spec.status === 201, `spec: ${spec.status} ${JSON.stringify(spec.body?.error)}`);
        const v2 = await publish('second-broken-version');
        assert(v2.status === 201 && v2.body.data.version_number === 2, `v2: ${v2.status} ${JSON.stringify(v2.body?.error ?? v2.body?.data?.version_number)}`);
        const gone = await json(`${app}/design-spec`, { method: 'DELETE', headers: auth });
        assert(gone.status === 200, `spec delete: ${gone.status}`);
    });

    await test('an ordinary update is now refused with APP_OWES_ITEMS: that is the gate a rollback does not wait for', async () => {
        expectRefusal(await publish('third-would-be-version'), 422, 'APP_OWES_ITEMS');
    });

    await test('a rollback names why: without note, or with a blank one, it is refused', async () => {
        // The contract's body check answers a missing field first; the service answers a blank one.
        expectRefusal(await rollback({ version: 1 }), 400);
        expectRefusal(await rollback({ version: 1, note: '   ' }), 400, 'INVALID_INPUT');
    });

    await test('a rollback to the live version or a later one is refused', async () => {
        expectRefusal(await rollback({ version: 2, note: 'not earlier' }), 400, 'INVALID_INPUT');
        expectRefusal(await rollback({ version: 9, note: 'not there' }), 400, 'INVALID_INPUT');
    });

    await test('another owner cannot roll back this owner\'s app', async () => {
        const bob = await registerOwner(BASE, `rollbackb${Date.now()}`);
        const r = await json(`/v1/apps/${encodeURIComponent(alice.name)}/${encodeURIComponent(f)}/rollback`, {
            method: 'POST', headers: { Authorization: `Bearer ${bob.token}` }, body: JSON.stringify({ version: 1, note: 'not mine' }),
        });
        expectRefusal(r, 403);
    });

    await test('version 1 comes back as version 3 with its own bytes, and the answer names what the app owes', async () => {
        const r = await rollback({ version: 1, note: 'version 2 broke the list' });
        assert(r.status === 201, `rollback: ${r.status} ${JSON.stringify(r.body?.error)}`);
        const d = r.body.data;
        assert(d.rolled_back_to === 1 && d.replaced_version === 2 && d.version_number === 3, `numbers: ${JSON.stringify(d)}`);
        assert(d.reason === 'version 2 broke the list', `reason: ${d.reason}`);
        assert((d.owes ?? []).some((o: any) => o.item === 'design_spec'), `the answer must name the owed design spec: ${JSON.stringify(d.owes)}`);
        const live = await (await fetch(`${BASE}${app}?version=3`)).text();
        assert(live.includes('first-good-version') && !live.includes('second-broken-version'), 'version 3 must carry the bytes of version 1');
        const versions = await json(`${app}/versions`, { headers: auth });
        assert(versions.body?.data?.total === 3, `all three versions kept: ${JSON.stringify(versions.body?.data?.total)}`);
    });

    await test('rolling back again to the bytes that are live is refused with ALREADY_LIVE', async () => {
        expectRefusal(await rollback({ version: 1, note: 'again' }), 409, 'ALREADY_LIVE');
    });

    await test('the audit log has version.rollback with the reason, and the audit counts one failed change in 90 days', async () => {
        const a = await json(`/v1/apps/me/${encodeURIComponent(f)}/audit?limit=50`, { headers: auth });
        assert(a.status === 200, `audit: ${a.status} ${JSON.stringify(a.body?.error)}`);
        const row = (a.body.data.entries ?? []).find((e: any) => e.action === 'version.rollback');
        assert(row && row.detail?.reason === 'version 2 broke the list' && row.detail?.to === 1 && row.detail?.from === 2, `audit row: ${JSON.stringify(row)}`);
        const c = a.body.data.changes;
        assert(c && c.window_days === 90 && c.failed === 1 && c.changes === 2 && c.change_failure_rate === 0.5, `changes: ${JSON.stringify(c)}`);
    });

    await owed('warn');
    finish();
})();
