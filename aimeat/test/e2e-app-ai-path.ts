/**
 * @file test/e2e-app-ai-path.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish answer says how the person's own AI uses the app (`next_steps.ai_path`,
 *   services/app/ai-path-step.ts): an app with no bound skill and no tools is told so and pointed
 *   at the app-tools section, a tool manifest is counted, and a declared presentation and a quick
 *   prototype get no line. A recommendation: every publish here answers 201.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-ai-path
 * @version-history
 *   v1.2.0 — 2026-11-24 — apps.owed_on_publish = refuse: an update that owes items is refused, naming
 *     each, and goes through once they exist; a quick prototype owes no skill and no face.
 *   v1.1.0 — 2026-11-24 — Section server-side sends an MCP build to the extension skill, which answers.
 *   v1.0.0 — 2026-11-20 — Initial (wish-atelier-ohjaa-teko-lykiihdytykseen-skilli-suora-kirjoitus-ja).
 */
import { registerOwner, ownerSignIn } from './helpers/owner-login.js';
import { BASE, assert, expectRefusal, finish, json as request, test } from './helpers/harness.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

/** The harness request, signed in with `token`. */
function json(path: string, token: string, opts: RequestInit = {}) {
    return request(path, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers as Record<string, string> | undefined) } });
}
const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

/** A small app that keeps the person's notes in their own memory. */
const page = (filename: string, extraHead = '') => [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<meta name="aimeat-app" content="${filename}">`,
    '<meta name="aimeat-scopes" content="memory:read memory:write">',
    '<link rel="stylesheet" href="/lib/aimeat-theme.css">', extraHead,
    '</head><body><div id="login"></div>',
    '<script src="/v1/libs/aimeat-auth.js"></' + 'script>',
    '<script>AIMEAT.auth.mountLoginButton("#login", { onLogin: () => AIMEAT.data.set("notes.seen", 1) });</' + 'script>',
    '</body></html>',
].join('\n');

const stamp = Date.now().toString(36);
const ownerName = `aipath${stamp}`;
const file = `aipath${stamp}.html`;
let owner = '';

const publish = async (html: string) => {
    const r = await json('/v1/apps', owner, { method: 'POST', body: JSON.stringify({ filename: file, mime_type: 'text/html', content: b64(html), name: 'AI path app', description: 'Notes the person keeps through their AI.' }) });
    assert(r.status === 201, `publish ${r.status} ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.next_steps ?? {}) as Record<string, unknown>;
};

console.log('\n=== AIMEAT publish answer: how the person\'s own AI uses the app ===\n');

await test('setup: an owner', async () => {
    await registerOwner(BASE, ownerName);
    owner = (await ownerSignIn(BASE, ownerName)).body.data.token;
    assert(!!owner, 'owner token');
});

await test('an app with no bound skill and no tools is told no AI can work in it, and where app tools are', async () => {
    const s = await publish(page(file));
    assert(s.ai_path_tools_count === 0, `no tools counted: ${JSON.stringify(s.ai_path_tools_count)}`);
    assert(/No bound skill/.test(String(s.ai_path)) && String(s.ai_path).includes('build-app-atelier/app-tools'), `the line: ${JSON.stringify(s.ai_path)}`);
});

await test('a tool manifest is counted on the next publish', async () => {
    const tool = { name: 'note_add', description: 'Adds one note', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, outputSchema: { type: 'object' } };
    const w = await json('/v1/memory', owner, { method: 'POST', body: JSON.stringify({ key: `apps.${file}.tools`, visibility: 'public', value: { version: 1, tools: [tool] } }) });
    assert(w.status === 200 || w.status === 201, `tool manifest ${w.status} ${JSON.stringify(w.body?.error)}`);
    const s = await publish(page(file));
    assert(s.ai_path_tools_count === 1 && /1 app tool\(s\)/.test(String(s.ai_path)), `the tool is counted: ${JSON.stringify(s.ai_path)}`);
});

await test('a declared presentation and a quick prototype get no ai_path line, and still publish', async () => {
    const shown = await publish(page(file, '<meta name="aimeat-ai-path" content="none">'));
    assert(shown.ai_path === undefined && shown.ai_path_tools_count === undefined, `a presentation: ${JSON.stringify(shown.ai_path)}`);
    const proto = await publish(page(file, '<meta name="aimeat-level" content="proto">'));
    assert(proto.ai_path === undefined, `a quick prototype: ${JSON.stringify(proto.ai_path)}`);
});

// An app tool needs an extension, and section server-side names the extension specification. A cold
// build read the address as a handbook tier over MCP and was told "not found" (2026-11-24): the text
// says the skill is the specification over MCP, and the skill it names is there.
await test('section server-side sends an MCP build to the extension skill, which exists', async () => {
    const agent = await makeAgent(BASE, { name: ownerName, token: owner }, ['memory:read']);
    const session = await openSession(BASE, agent.token, 'ai-path');
    const section = await callTool(session, 'aimeat_handbook_get', { tier: 'build-app-atelier/server-side' });
    assert(!section.isError && /over MCP the skill is the specification/.test(section.text), `the section says it: ${section.text.slice(0, 300)}`);
    const skill = await callTool(session, 'aimeat_skill_get', { ref: 'node:aimeat-extension-builder', body_only: true });
    assert(!skill.isError && skill.text.length > 1000, `the skill it names answers: ${skill.text.slice(0, 200)}`);
});

// apps.owed_on_publish = refuse, as production runs it (owed-gate.ts). The first publish goes through
// because nothing can be written for an app that does not exist; the second is refused until the app
// has its design spec, its data map, its bound skill and agent face, and a roadmap line.
await test('an update of an app that owes items is refused, naming each, and goes through once they exist', async () => {
    const setting = (value: string) => json('/v1/admin/config', owner, { method: 'PUT', body: JSON.stringify({ changes: [{ path: 'apps.owed_on_publish', value }] }) });
    const on = await setting('refuse');
    assert(on.status === 200, `the operator turns the gate on: ${on.status} ${JSON.stringify(on.body?.error)}`);
    try {
        const f = `owed${stamp}.html`;
        const pub = (html: string, roadmap?: string) => json('/v1/apps', owner, { method: 'POST', body: JSON.stringify({ filename: f, mime_type: 'text/html', content: b64(html), name: 'Owed app', description: 'An app that keeps notes.', ...(roadmap ? { roadmap } : {}) }) });
        const first = await pub(page(f));
        assert(first.status === 201, `the first publish goes through: ${first.status} ${JSON.stringify(first.body?.error)}`);

        const bare = await pub(page(f));
        assert(bare.status === 422 && bare.body?.error?.code === 'APP_OWES_ITEMS', `the update is refused: ${bare.status} ${JSON.stringify(bare.body?.error)}`);
        const missing = (bare.body.error.details?.missing ?? []) as string[];
        for (const item of ['design_spec', 'data_map', 'bound_skill', 'agent_face', 'roadmap']) assert(missing.includes(item), `${item} is named: ${JSON.stringify(missing)}`);
        assert(/aimeat_datamap_set/.test(bare.body.error.message) && /spec_set/.test(bare.body.error.message), `the refusal says how: ${bare.body.error.message.slice(0, 300)}`);

        const spec = await json(`/v1/apps/${ownerName}/${f}/design-spec`, owner, { method: 'PUT', body: JSON.stringify({ markdown: '# Design spec\n\n## Purpose\nNotes the person keeps.\n' }) });
        assert(spec.status === 201 || spec.status === 200, `design spec: ${spec.status} ${JSON.stringify(spec.body?.error)}`);
        const map = await json(`/v1/datamap/apps/${ownerName}/${f}`, owner, { method: 'PUT', body: JSON.stringify({
            spec: 'aimeat.datamap/2', what: 'Notes.', usedFor: 'Proving the gate.', form: 'one-person', arrangement: 'One record in the owner\'s memory.', machinery: [], leaves: [], elsewhere: [],
            held: [{ what: 'notes.seen', holds: 'one flag', kind: 'user-written', usedFor: 'user-returns-to-read', where: 'owner-memory-private', owner: 'person', readers: 'owner-only', writers: ['person-in-the-ui'], shape: 'one-record', keptFor: 'until-deleted', lossRisk: 'user-can-rewrite', personalData: 'no', why: 'The person\'s own flag.' }],
        }) });
        assert(map.status === 200, `data map: ${map.status} ${JSON.stringify(map.body?.error)}`);

        const still = await pub(page(f), 'Second version.');
        const left = (still.body?.error?.details?.missing ?? []) as string[];
        assert(still.status === 422 && left.join() === 'bound_skill,agent_face', `only the skill and the face are left: ${still.status} ${JSON.stringify(left)}`);

        const proto = await pub(page(f, '<meta name="aimeat-level" content="proto">'), 'A quick prototype now.');
        assert(proto.status === 201, `a quick prototype owes no skill and no face: ${proto.status} ${JSON.stringify(proto.body?.error)}`);
    } finally {
        await setting('warn');
    }
});

// The skill and the publish answer send an AI to the data map to find where the data lives, so
// nobody but the app's own builders may rewrite it.
await test('another owner cannot rewrite the data map an AI reads to find this app\'s data', async () => {
    const otherName = `aipathx${stamp}`;
    await registerOwner(BASE, otherName);
    const other = (await ownerSignIn(BASE, otherName)).body.data.token;
    const r = await json(`/v1/datamap/apps/${ownerName}/${file}`, other, { method: 'PUT', body: JSON.stringify({ spec: 'aimeat.datamap/2', what: 'Moved.', held: [] }) });
    expectRefusal(r, 403);
});

finish();
