/**
 * @file test/e2e-app-freshness.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for one answer to "what beside this app has gone stale"
 *   (GET /v1/apps/:owner/:filename/freshness, services/app/freshness.ts):
 *   - a new app owes its design spec and data map, and says so;
 *   - after a publish the spec reads as written against the older version, and a criterion
 *     evidenced at that version is named for a re-check;
 *   - a bound skill that matched the app's tools is named once the tools change under it, and the
 *     next publish answer carries the same finding (next_steps.bound_skill_issues);
 *   - another owner may not read it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-freshness
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-one-freshness-answer-per-app-spec-skill-pitfalls-behind-the-).
 */
import { BASE, assert, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

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
    console.log('\n── App freshness: what beside the app is behind it ──');
    const alice = await registerOwner(BASE, `fresha${Date.now()}`);
    const auth = { Authorization: `Bearer ${alice.token}` };
    const base = `fresh${Date.now()}`;
    const f = `${base}.html`;
    const app = `/v1/apps/${encodeURIComponent(alice.name)}/${encodeURIComponent(f)}`;
    const publish = (word: string) => json('/v1/apps', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ filename: f, mime_type: 'text/html', content: b64(page(f, word)), name: 'Fresh', description: 'An app read for freshness.', roadmap: `The page says ${word}.` }),
    });
    const freshness = () => json(`${app}/freshness`, { headers: auth });
    const items = (r: any) => ((r.body?.data?.behind ?? []) as Array<{ item: string; what: string }>);
    const tools = (field: string) => json('/v1/memory', {
        method: 'POST', headers: auth,
        body: JSON.stringify({
            key: `apps.${base}.tools`, visibility: 'public',
            value: { version: 1, tools: [{ name: 'record', action_id: 'ext:none:record', inputSchema: { type: 'object', additionalProperties: false, properties: { [field]: { type: 'string' } } } }] },
        }),
    });

    await test('a new app owes its design spec and its data map, and the answer says so', async () => {
        assert((await publish('first')).status === 201, 'v1');
        const r = await freshness();
        assert(r.status === 200, `freshness: ${r.status} ${JSON.stringify(r.body?.error)}`);
        const names = items(r).map(b => b.item);
        assert(names.includes('design_spec') && names.includes('data_map'), `owed: ${JSON.stringify(items(r))}`);
        assert(r.body.data.app_version === 1 && r.body.data.design_spec.present === false, `spec absent at v1: ${JSON.stringify(r.body.data.design_spec)}`);
    });

    await test('after a publish the spec is behind, and a criterion evidenced at the older version is named', async () => {
        const spec = await json(`${app}/design-spec`, { method: 'PUT', headers: auth, body: JSON.stringify({ markdown: '# Design spec\n\nA page.\n' }) });
        assert(spec.status === 201, `spec: ${spec.status}`);
        const c = await json(`${app}/design-spec/criteria`, { method: 'PUT', headers: auth, body: JSON.stringify({ criteria: [{ id: 'says-word', text: 'The page shows its word.', check: 'screenshot', status: 'evidenced', evidence: 'screenshot at v1' }] }) });
        assert(c.status === 200, `criteria: ${c.status} ${JSON.stringify(c.body?.error)}`);
        assert(!items(await freshness()).some(b => b.item === 'design_spec'), 'a spec written at the live version is not behind');
        assert((await publish('second')).status === 201, 'v2');
        const r = await freshness();
        assert(r.body.data.design_spec.stale === true, `stale after v2: ${JSON.stringify(r.body.data.design_spec)}`);
        const ev = r.body.data.criteria.evidenced_before;
        assert(ev.length === 1 && ev[0].id === 'says-word' && ev[0].evidenced_version === 1, `the old evidence is named: ${JSON.stringify(ev)}`);
    });

    await test('a bound skill that matched the tools is named once the tools change under it, and the publish answer says so too', async () => {
        assert((await tools('title')).status === 201, 'tools with title');
        const skillMd = ['---', `name: fresh-guide-${Date.now().toString(36).slice(-6)}`, 'description: How the fresh app records a line.',
            'metadata:', `  binding: "app:${alice.name}/${f}"`, '---', '', '# Recording', '', 'Call `record { title }` once per line.', ''].join('\n');
        const s = await json('/v1/skills', { method: 'POST', headers: auth, body: JSON.stringify({ skill_md: skillMd }) });
        assert(s.status === 201 && (s.body.data.skill.toolFieldIssues ?? []).length === 0, `the skill matches at publish: ${s.status} ${JSON.stringify(s.body?.data?.skill?.toolFieldIssues ?? s.body?.error)}`);
        assert(!items(await freshness()).some(b => b.item === 'bound_skill'), 'a matching skill is not behind');
        const changed = await tools('name');
        assert(changed.status === 200 || changed.status === 201, `tools change: ${changed.status} ${JSON.stringify(changed.body?.error)}`);
        const r = await freshness();
        const skill = (r.body.data.bound_skills ?? [])[0];
        assert(skill && skill.tool_field_issues.length === 1 && skill.tool_field_issues[0].field === 'title', `the broken call is named: ${JSON.stringify(r.body.data.bound_skills)}`);
        assert(items(r).some(b => b.item === 'bound_skill'), `listed as behind: ${JSON.stringify(items(r))}`);
        const v3 = await publish('third');
        const named = (v3.body.data?.next_steps?.bound_skill_issues ?? []) as any[];
        assert(v3.status === 201 && named.length === 1 && named[0].tool_field_issues[0].field === 'title', `the publish answer names it: ${JSON.stringify(v3.body?.data?.next_steps?.bound_skill_issues)}`);
    });

    await test('another owner may not read this app\'s freshness', async () => {
        const bob = await registerOwner(BASE, `freshb${Date.now()}`);
        const r = await json(`/v1/apps/${encodeURIComponent(alice.name)}/${encodeURIComponent(f)}/freshness`, { headers: { Authorization: `Bearer ${bob.token}` } });
        assert(r.status === 403, `another owner is refused: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    finish();
})();
