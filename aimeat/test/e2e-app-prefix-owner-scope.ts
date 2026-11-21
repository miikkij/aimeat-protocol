/**
 * @file test/e2e-app-prefix-owner-scope.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent's memory write under a key prefix one of its owner's apps keeps in the
 *   owner's memory, and a skill bound to that app that tells the AI to write those keys.
 *
 *   The agent's write lands in its own namespace unless it says owner_scope, and the app keeps the
 *   keys in the owner's memory, so the agent saves data the app does not show. Before 2026-11-21 the
 *   write said so only once an owner copy existed (SHADOWED_BY_OWNER_COPY). Now the answer carries
 *   APP_READS_OWNER_NAMESPACE with the owner_scope fix from the first write, on POST /v1/memory and
 *   on aimeat_memory_write with the same text, and the write itself is unchanged. The skill publish
 *   answer names the paragraph that writes the app's keys without owner_scope (ownerScopeIssues).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-prefix-owner-scope
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const TAG = Date.now().toString(36).slice(-6);
const APP = `quiz${TAG}.html`;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const appWarning = (warnings: any[] | undefined) => (warnings ?? []).find(w => w.code === 'APP_READS_OWNER_NAMESPACE');

console.log('\nAn agent write under an app key prefix, and the bound skill that teaches it');

const alice = await registerOwner(BASE, `alice${TAG}`);
const bob = await registerOwner(BASE, `bob${TAG}`);
const agent = await makeAgent(BASE, alice, ['memory:read', 'memory:write']);
const bobAgent = await makeAgent(BASE, bob, ['memory:read', 'memory:write']);

const row = (what: string, extra: Record<string, unknown> = {}) => ({
    what, holds: 'quiz results', kind: 'user-written', usedFor: 'shown-as-a-list', where: 'owner-memory-private',
    owner: 'person', readers: 'owner-and-their-agents', writers: ['an-agent'], shape: 'one-per-thing',
    keptFor: 'until-deleted', lossRisk: 'only-copy', personalData: 'no', why: 'The page lists them.', ...extra,
});
const dataMap = (held: unknown[]) => ({
    spec: 'aimeat.datamap/2', what: 'A quiz.', usedFor: 'Playing rounds.', form: 'one-person', arrangement: 'Results in the owner\'s memory.',
    machinery: [], leaves: [], elsewhere: [], held,
});

await test('setup: the owner publishes the app and states where its data is', async () => {
    const pub = await json('/v1/apps', {
        method: 'POST', headers: auth(alice.token),
        body: JSON.stringify({ filename: APP, content: Buffer.from('<html><body>quiz</body></html>').toString('base64'), mime_type: 'text/html', name: 'Quiz', description: 'E2E' }),
    });
    assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const put = await json(`/v1/datamap/apps/${alice.name}/${APP}`, {
        method: 'PUT', headers: auth(alice.token),
        body: JSON.stringify(dataMap([row(`scores${TAG}.<round>`), row(`news${TAG}.*`, { agent: agent.name })])),
    });
    assert(put.status === 200, `datamap ${put.status}: ${JSON.stringify(put.body?.error)}`);
});

let restFix = '';
await test('POSITIVE: an agent write under the prefix is stored as before and names the owner_scope fix', async () => {
    const key = `scores${TAG}.r1`;
    const r = await json('/v1/memory', { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ key, value: { points: 3 } }) });
    assert(r.status === 201, `write ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const w = appWarning(r.body.data.warnings);
    assert(w?.code === 'APP_READS_OWNER_NAMESPACE', `APP_READS_OWNER_NAMESPACE missing: ${JSON.stringify(r.body.data.warnings)}`);
    assert(w.app === APP && w.prefix === `scores${TAG}.`, `app and prefix: ${JSON.stringify(w)}`);
    assert(String(w.how_to_fix).includes('owner_scope: true'), `how_to_fix: ${w.how_to_fix}`);
    assert(String(w.message).includes(agent.gaii), `the message names where it landed: ${w.message}`);
    restFix = String(w.how_to_fix);
    const read = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: auth(agent.token) });
    assert(read.status === 200 && read.body.data.value?.points === 3, `the write itself landed in the agent's namespace: ${read.status}`);
});

await test('POSITIVE: aimeat_memory_write answers the same warning with the same text', async () => {
    const s = await openSession(BASE, agent.token, 'app-prefix');
    const r = await callTool(s, 'aimeat_memory_write', { key: `scores${TAG}.r2`, value: { points: 5 } });
    assert(!r.isError, `tool refused: ${r.text.slice(0, 300)}`);
    const w = appWarning(r.data.warnings);
    assert(w?.code === 'APP_READS_OWNER_NAMESPACE', `APP_READS_OWNER_NAMESPACE missing on MCP: ${r.text.slice(0, 400)}`);
    assert(w.how_to_fix === restFix && w.app === APP, `same text on both doors: ${JSON.stringify(w)}`);
});

await test('FAILURE CASE: a key under no prefix of the app, and a row that names the agent, carry no such warning', async () => {
    for (const key of [`notes${TAG}.today`, `news${TAG}.today`]) {
        const r = await json('/v1/memory', { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ key, value: 'x' }) });
        assert(r.status === 201, `${key}: ${r.status} ${JSON.stringify(r.body?.error)}`);
        assert(!appWarning(r.body.data.warnings), `${key} warned: ${JSON.stringify(r.body.data.warnings)}`);
    }
});

await test('FAILURE CASE: another owner\'s agent writing the same key hears nothing about this owner\'s app', async () => {
    const r = await json('/v1/memory', { method: 'POST', headers: auth(bobAgent.token), body: JSON.stringify({ key: `scores${TAG}.r1`, value: 1 }) });
    assert(r.status === 201, `bob's agent: ${r.status} ${JSON.stringify(r.body?.error)}`);
    assert(!appWarning(r.body.data.warnings), `another owner's app was named: ${JSON.stringify(r.body.data.warnings)}`);
});

await test('REFUSAL: another owner cannot rewrite the map the warning is read from', async () => {
    const put = await json(`/v1/datamap/apps/${alice.name}/${APP}`, {
        method: 'PUT', headers: auth(bob.token), body: JSON.stringify(dataMap([row(`other${TAG}.*`)])),
    });
    expectRefusal(put, 403, 'FORBIDDEN');
    const r = await json('/v1/memory', { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ key: `scores${TAG}.r4`, value: 4 }) });
    assert(appWarning(r.body.data.warnings)?.prefix === `scores${TAG}.`, `the owner's map still holds: ${JSON.stringify(r.body.data.warnings)}`);
});

await test('EDGE: the owner\'s own write is not warned, and once the owner copy exists the agent hears the shadow warning only', async () => {
    const key = `scores${TAG}.r3`;
    const own = await json('/v1/memory', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ key, value: { points: 1 } }) });
    assert(own.status === 201 && !appWarning(own.body.data.warnings), `owner write: ${own.status} ${JSON.stringify(own.body.data?.warnings)}`);
    const r = await json('/v1/memory', { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ key, value: { points: 2 } }) });
    const codes = (r.body.data.warnings ?? []).map((w: any) => w.code);
    assert(r.status === 201 && codes.includes('SHADOWED_BY_OWNER_COPY') && !codes.includes('APP_READS_OWNER_NAMESPACE'), `codes: ${codes.join(',')}`);
});

const skillMd = (name: string, body: string[]) => [
    '---', `name: ${name}`, 'description: How the quiz keeps its rounds.',
    'metadata:', `  binding: "app:${alice.name}/${APP}"`, '---', '', '# Rounds', '', ...body, '',
].join('\n');

await test('POSITIVE: a bound skill that writes the app\'s keys without owner_scope is told so at publish', async () => {
    const md = skillMd(`quiz-guide-${TAG}`, [`Save each round with \`aimeat_memory_write { key: "scores${TAG}.<round>", value }\`.`]);
    const r = await json('/v1/skills', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ skill_md: md }) });
    assert(r.status === 201, `skill publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const issues = r.body.data.skill.ownerScopeIssues as Array<{ path: string; prefix: string; message: string }> | undefined;
    assert(Array.isArray(issues) && issues.length === 1 && issues[0].prefix === `scores${TAG}.` && issues[0].path === 'SKILL.md',
        `ownerScopeIssues: ${JSON.stringify(issues)}`);
    assert(issues[0].message.includes('owner_scope: true'), `the fix: ${issues[0].message}`);
});

await test('FAILURE CASE: the same skill with owner_scope in the call is quiet, and the publish stood both times', async () => {
    const md = skillMd(`quiz-guide-ok-${TAG}`, [`Save each round with \`aimeat_memory_write { key: "scores${TAG}.<round>", value, owner_scope: true }\`.`]);
    const r = await json('/v1/skills', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ skill_md: md }) });
    assert(r.status === 201 && r.body.data.skill.ownerScopeIssues === undefined, `${r.status}: ${JSON.stringify(r.body.data?.skill?.ownerScopeIssues)}`);
});

await test('EDGE: a skill bound to no app is not read for it', async () => {
    const md = [
        '---', `name: free-guide-${TAG}`, 'description: Not bound to any app.', '---', '',
        `Save with \`aimeat_memory_write { key: "scores${TAG}.r1" }\`.`, '',
    ].join('\n');
    const r = await json('/v1/skills', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ skill_md: md }) });
    assert(r.status === 201 && r.body.data.skill.ownerScopeIssues === undefined, `${r.status}: ${JSON.stringify(r.body.data?.skill)}`);
});

finish();
