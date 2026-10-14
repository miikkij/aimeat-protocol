/**
 * @file test/e2e-home-ideas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/prompts/home-ideas, the ideas the home offers (services/home-ideas.ts), read
 *   from the managed prompt `home-ideas` the node seeds and the operator edits.
 *
 *   Happy path: the seeded list in Finnish, Spanish and English, the language chosen by ?lang= and
 *   by the Accept-Language header, English for a language the record has no text for, and the app
 *   ideas naming agent ideas the list has.
 *   Failure modes: an ordinary member cannot edit the list; an operator who saves text that is not
 *   JSON gets an empty list with the reason, and the languages the edit did not touch keep theirs;
 *   an entry that lacks a field is left out and named while the rest still shows.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=home-ideas
 * @version-history
 *   v1.0.0 — 2026-10-14 — Initial (wish-esimerkit-agenteista-ja-sovelluksista-kotiruudulle-mielikuvi).
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const body = await res.json().catch(() => ({})) as any;
    return { status: res.status, body };
}

import { ownerSignIn } from './helpers/owner-login.js';

async function owner(label: string): Promise<string> {
    const name = `ideas${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Ideas', password: 'IdeasPw12345' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Ideas', password: 'IdeasPw12345' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body)}`);
    const tok = await ownerSignIn(BASE, name, 'IdeasPw12345');
    assert(tok.status === 200, `token ${tok.status}: ${JSON.stringify(tok.body)}`);
    return tok.body.data.token as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Home ideas E2E (GET /v1/prompts/home-ideas) ===\n');

let operator = '';
let member = '';
let seededContent = '';

await test('Setup: the first owner is the operator, the second an ordinary member', async () => {
    operator = await owner('op');
    member = await owner('mem');
    const seeded = await json('/v1/admin/prompts/home-ideas', { headers: auth(operator) });
    assert(seeded.status === 200, `the node seeded home-ideas: ${seeded.status} ${JSON.stringify(seeded.body.error)}`);
    seededContent = seeded.body.data.prompt.content;
});

await test('Finnish: ten agent ideas, six app ideas, six groups, no problems', async () => {
    const { status, body } = await json('/v1/prompts/home-ideas?lang=fi');
    assert(status === 200, `status ${status}`);
    const d = body.data;
    assert(d.lang === 'fi', `served in fi, got ${d.lang}`);
    assert(d.agents.length === 10 && d.apps.length === 6 && d.groups.length === 6, `counts ${d.agents.length}/${d.apps.length}/${d.groups.length}`);
    assert(d.problems.length === 0, `no problems: ${JSON.stringify(d.problems)}`);
    const minutes = d.agents.find((a: any) => a.id === 'minutes');
    assert(minutes?.name === 'Kokouskirjuri' && minutes.app === 'MUISTIO' && minutes.when === 'records', `minutes: ${JSON.stringify(minutes)}`);
    assert(/MUISTIOon/.test(minutes.say), 'the sentence is the Finnish one it was made from');
    assert(!d.agents.some((a: any) => a.id === 'messages'), 'the idea that never ran is not offered');
});

await test('Every app idea names an agent idea the list has, or none', async () => {
    const { body } = await json('/v1/prompts/home-ideas?lang=en');
    const ids = new Set(body.data.agents.map((a: any) => a.id));
    for (const app of body.data.apps) assert(app.agent === null || ids.has(app.agent), `${app.id} names ${app.agent}`);
    assert(body.data.apps.filter((a: any) => a.ready_app).length === 3, 'three app ideas are apps that exist');
    assert(/aimeat_agent_propose/.test(body.data.about), 'the list tells an AI how to use it');
});

await test('Spanish by ?lang=, Finnish by Accept-Language, English for a language it lacks', async () => {
    const es = await json('/v1/prompts/home-ideas?lang=es');
    assert(es.body.data.lang === 'es' && es.body.data.agents.find((a: any) => a.id === 'desk').name === 'Recepción', `es: ${es.body.data.lang}`);
    const fi = await json('/v1/prompts/home-ideas', { headers: { 'Accept-Language': 'fi-FI,fi;q=0.9,en;q=0.8' } });
    assert(fi.body.data.lang === 'fi', `Accept-Language gave ${fi.body.data.lang}`);
    const de = await json('/v1/prompts/home-ideas?lang=de');
    assert(de.body.data.lang === 'en' && de.body.data.agents.find((a: any) => a.id === 'desk').name === 'Front desk', `de falls back to en: ${de.body.data.lang}`);
});

await test('Refused: an ordinary member cannot edit the list', async () => {
    const { status } = await json('/v1/admin/prompts/home-ideas', {
        method: 'PATCH', headers: auth(member), body: JSON.stringify({ content: '{}', changeNote: 'e2e' }),
    });
    assert(status === 403, `member PATCH answered ${status}`);
    const after = await json('/v1/prompts/home-ideas?lang=en');
    assert(after.body.data.agents.length === 10, 'the list is unchanged');
});

await test('An operator\'s text that is not JSON: an empty list with the reason, the other languages untouched', async () => {
    const patched = await json('/v1/admin/prompts/home-ideas', {
        method: 'PATCH', headers: auth(operator), body: JSON.stringify({ content: '{ "agents": [ oops', changeNote: 'e2e broken' }),
    });
    assert(patched.status === 200, `operator PATCH ${patched.status}: ${JSON.stringify(patched.body.error)}`);
    const en = await json('/v1/prompts/home-ideas?lang=en');
    assert(en.status === 200, `still answers: ${en.status}`);
    assert(en.body.data.agents.length === 0 && en.body.data.apps.length === 0, 'nothing to show');
    assert(/not JSON/.test(en.body.data.problems[0] ?? ''), `the reason: ${JSON.stringify(en.body.data.problems)}`);
    const fi = await json('/v1/prompts/home-ideas?lang=fi');
    assert(fi.body.data.agents.length === 10, 'the Finnish text is its own and still shows');
});

await test('An entry that lacks a field is left out and named; the rest still shows', async () => {
    const doc = JSON.parse(seededContent);
    delete doc.agents[0].say;
    doc.agents[1].when = 'sometimes';
    const patched = await json('/v1/admin/prompts/home-ideas', {
        method: 'PATCH', headers: auth(operator), body: JSON.stringify({ content: JSON.stringify(doc), changeNote: 'e2e one entry' }),
    });
    assert(patched.status === 200, `operator PATCH ${patched.status}`);
    const { body } = await json('/v1/prompts/home-ideas?lang=en');
    assert(body.data.agents.length === 8, `two left out, eight shown: ${body.data.agents.length}`);
    assert(body.data.problems.some((p: string) => /"minutes" lacks say/.test(p)), `names the missing field: ${JSON.stringify(body.data.problems)}`);
    assert(body.data.problems.some((p: string) => /"desk": when is "sometimes"/.test(p)), 'names the wrong value');
    const meeting = body.data.apps.find((a: any) => a.id === 'meeting-notes');
    assert(meeting && meeting.agent === null, 'an app idea whose agent idea was left out names none');
});

await test('Cleanup: the operator puts the seeded text back', async () => {
    const patched = await json('/v1/admin/prompts/home-ideas', {
        method: 'PATCH', headers: auth(operator), body: JSON.stringify({ content: seededContent, changeNote: 'e2e restore' }),
    });
    assert(patched.status === 200, `restore ${patched.status}`);
    const { body } = await json('/v1/prompts/home-ideas?lang=en');
    assert(body.data.agents.length === 10 && body.data.problems.length === 0, 'back as seeded');
});

console.log(`\nHome ideas: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);
