/**
 * @file test/e2e-app-publish-generated-code.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the two publish checks on the faults of generated code
 *   (src/services/app/generated-code-lint.ts), through POST /v1/apps:
 *   - a page that carries an API key is refused with APP_ARTIFACT_BROKEN and the key-in-page-source
 *     finding, which names the key's start and never the key, and leaves no catalogue row; the same
 *     page with a placeholder publishes;
 *   - a page that writes values from stored data into innerHTML with nothing escaped publishes with
 *     the html-built-from-values warning, and the same page escaping with AIMEAT.escapeHtml publishes
 *     without it.
 *   Each refusal is paired with the case that publishes, as the publish-gate suite does, because a
 *   check that blocks a working app teaches people to route around it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-publish-generated-code
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-publish-lint-checks-for-the-faults-of-generated-code).
 */
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

/** An app that follows the spec, with one line of code put in where `/*CODE*\/` is. */
const appWith = (filename: string, code: string) => [
    '<!DOCTYPE html><html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content">',
    `<meta name="aimeat-app" content="${filename}">`,
    '<meta name="aimeat-scopes" content="memory:read memory:write">',
    '<meta name="aimeat-locales" content="en fi">',
    '<link rel="stylesheet" href="/lib/aimeat-theme.css">',
    '<style>.card{background:var(--color-base-200);display:grid;grid-template-columns:minmax(0,1fr)}.card>*{min-width:0}</style>',
    '</head><body style="overflow-x:clip"><div id="login"></div><div class="card">ok</div>',
    '<script src="/v1/libs/aimeat-auth.js"></' + 'script>',
    '<script>',
    'AIMEAT.auth.mountLoginButton("#login", { onLogin: start });',
    'async function start() {',
    '  const { items } = await AIMEAT.data.list({ prefix: "gate.", ownerScope: true, meta: true });',
    `  ${code}`,
    '}',
    '</' + 'script></body></html>',
].join('\n');

(async () => {
    console.log('\n── App publish: the faults of generated code ──');
    const o = await registerOwner(BASE, `gencode${Date.now()}`);
    const auth = { Authorization: `Bearer ${o.token}` };
    const publish = (filename: string, html: string) => json('/v1/apps', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ filename, mime_type: 'text/html', content: b64(html), name: 'Generated code', description: 'A page the lint reads.' }),
    });
    const listed = async (filename: string) => {
        const r = await json(`/v1/apps?q=${encodeURIComponent(filename)}&limit=200`, { headers: auth });
        return (r.body?.data?.apps ?? []).some((a: any) => a.owner === o.name && a.filename === filename);
    };

    const keyed = `genkey${Date.now()}.html`;
    // Put together at run time, so the source holds no whole key (push protection reads it).
    const key = 'sk-proj-' + '4fQ9xT2LmZ7bW1cV8nR3kJ6h';

    await test('a page with an API key is refused, the finding names the key\'s start and never the key, and nothing is listed', async () => {
        const r = await publish(keyed, appWith(keyed, `const OPENAI_KEY = "${key}"; await AIMEAT.data.set("gate.seen", items.length);`));
        expectRefusal(r, 422, 'APP_ARTIFACT_BROKEN');
        const hit = (r.body.error?.details?.findings ?? []).find((f: any) => f.pitfall === 'key-in-page-source');
        assert(hit && hit.url === '/v1/appdev/pitfalls/key-in-page-source', `the refusal must carry key-in-page-source: ${JSON.stringify(r.body.error?.details)}`);
        assert(String(hit.message).includes('sk-proj-'), `the finding must name the key's start: ${hit.message}`);
        assert(!JSON.stringify(r.body).includes(key), 'the refusal must never echo the whole key');
        assert(!await listed(keyed), 'the refused app is in the catalogue');
        const entry = await json('/v1/appdev/pitfalls/key-in-page-source');
        assert(entry.status === 200, `the finding's address must open its entry: ${entry.status}`);
    });

    await test('the same page with a placeholder where the key was publishes', async () => {
        const r = await publish(keyed, appWith(keyed, 'const OPENAI_KEY = "sk-xxxxxxxxxxxxxxxxxxxxxxxx"; await AIMEAT.data.set("gate.seen", items.length);'));
        assert(r.status === 201, `a placeholder must not refuse: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    const hintsOf = (r: any) => ((r.body?.data?.app_hints ?? []) as any[]).filter(h => h.pitfall === 'html-built-from-values');

    await test('values from stored data written into innerHTML unescaped publish with the html-built-from-values warning', async () => {
        const f = `gensink${Date.now()}.html`;
        const r = await publish(f, appWith(f, 'document.querySelector(".card").innerHTML = `<ul>${items.map(i => "<li>" + i.value.title + "</li>").join("")}</ul>`;'));
        assert(r.status === 201, `a warning must not refuse: ${r.status} ${JSON.stringify(r.body?.error)}`);
        const h = hintsOf(r);
        assert(h.length === 1 && String(h[0].message).includes('AIMEAT.escapeHtml'), `expected the html-built-from-values hint: ${JSON.stringify(r.body.data.app_hints)}`);
    });

    await test('the same page escaping each value with AIMEAT.escapeHtml publishes without the warning', async () => {
        const f = `gensafe${Date.now()}.html`;
        const r = await publish(f, appWith(f, 'document.querySelector(".card").innerHTML = `<ul>${items.map(i => "<li>" + AIMEAT.escapeHtml(i.value.title) + "</li>").join("")}</ul>`;'));
        assert(r.status === 201, `escaped publish: ${r.status} ${JSON.stringify(r.body?.error)}`);
        assert(hintsOf(r).length === 0, `an escaped page must not warn: ${JSON.stringify(r.body.data.app_hints)}`);
    });

    await test('another owner cannot publish a draft into this owner\'s app: the lint runs only for the app\'s own builders', async () => {
        const bob = await registerOwner(BASE, `gencodeb${Date.now()}`);
        const r = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(keyed)}/publish-draft`, {
            method: 'POST', headers: { Authorization: `Bearer ${bob.token}` }, body: JSON.stringify({}),
        });
        expectRefusal(r, 403);
    });

    finish();
})();
