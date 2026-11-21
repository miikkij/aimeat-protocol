/**
 * @file e2e-app-publish-scope-words.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the publish refusal of an `<meta name="aimeat-scopes">` word no app grant can
 *   hold (services/app/artifact-lint.ts checkScopeVocabulary). One such word refuses the whole
 *   sign-in, so nobody could sign in to the app, its owner included; it warned until 2026-11-21 and
 *   such apps went live. Proven: the word is refused with APP_ARTIFACT_BROKEN and only that word is
 *   named; a property name of a plain object is not a scope word; grantable words publish; a refused
 *   update leaves the live version as it was; another owner cannot read the refused draft's place.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-publish-scope-words
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial.
 */
import { assert, expectRefusal, finish, json, test, BASE } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

/** A page that follows the build spec, with its aimeat-scopes words given. */
function page(filename: string, words: string): string {
    return [
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content">',
        `<meta name="aimeat-app" content="${filename}">`,
        `<meta name="aimeat-scopes" content="${words}">`,
        '<meta name="aimeat-locales" content="en fi">',
        '<link rel="stylesheet" href="/lib/aimeat-theme.css">',
        '</head><body><div id="login"></div><main>scope words</main>',
        '<script src="/v1/libs/aimeat-auth.js"></' + 'script>',
        '<script>AIMEAT.auth.mountLoginButton("#login", { onLogin: () => {}, onSession: () => {} });</' + 'script>',
        '</body></html>',
    ].join('\n');
}

const stamp = Date.now();
const alice = await registerOwner(BASE, `scopealice${stamp}`);
const bob = await registerOwner(BASE, `scopebob${stamp}`);
const filename = `scopewords${stamp}.html`;
const publish = (token: string, words: string, description = 'Scope words probe.') =>
    json('/v1/apps', { method: 'POST', headers: auth(token), body: JSON.stringify({
        filename, mime_type: 'text/html', content: b64(page(filename, words)), name: 'Scope words', description,
    }) });
const served = (token: string) => fetch(`${BASE}/v1/apps/${encodeURIComponent(alice.name)}/${encodeURIComponent(filename)}`, { headers: auth(token) });

await test('a word no app grant can hold is REFUSED, naming only that word and where the vocabulary is', async () => {
    const r = await publish(alice.token, 'memory:read storage:delete');
    expectRefusal(r, 422, 'APP_ARTIFACT_BROKEN');
    const hit = (r.body.error?.details?.findings ?? []).find((f: any) => f.pitfall === 'app-meta-declarations');
    assert(hit?.severity === 'critical', `a critical app-meta-declarations finding: ${JSON.stringify(r.body.error?.details)}`);
    assert(hit.message.includes('storage:delete') && !hit.message.includes('`memory:read`') && hit.message.includes('/v1/app-grants/scopes'),
        `the finding names the word and the vocabulary: ${hit.message}`);
    assert((await served(alice.token)).status === 404, 'the refused app was written');
});

await test('a property name of a plain object, comma-separated, is not a scope word and is refused too', async () => {
    const r = await publish(alice.token, 'memory:read,constructor');
    expectRefusal(r, 422, 'APP_ARTIFACT_BROKEN');
    assert(JSON.stringify(r.body.error?.details?.findings ?? []).includes('constructor'), `the word is named: ${JSON.stringify(r.body.error)}`);
});

await test('grantable words publish, and a later refused update leaves the live version as it was', async () => {
    const ok = await publish(alice.token, 'memory:read,storage:write');
    assert(ok.status === 201, `grantable words publish: ${ok.status} ${JSON.stringify(ok.body?.error)}`);
    const bad = await publish(alice.token, 'memory:read organism:admin', 'An update asking for a word the node cannot grant.');
    expectRefusal(bad, 422, 'APP_ARTIFACT_BROKEN');
    const text = await (await served(alice.token)).text();
    assert(text.includes('memory:read,storage:write') && !text.includes('organism:admin'), `the live version stays: ${text.slice(0, 300)}`);
});

await test('another owner cannot publish over the app, whatever words it asks for', async () => {
    const r = await json(`/v1/apps/${encodeURIComponent(alice.name)}/${encodeURIComponent(filename)}/publish-draft`, {
        method: 'POST', headers: auth(bob.token), body: JSON.stringify({}),
    });
    expectRefusal(r, 403, 'FORBIDDEN');
    const text = await (await served(alice.token)).text();
    assert(text.includes('memory:read,storage:write'), 'the live version is unchanged');
});

finish();
