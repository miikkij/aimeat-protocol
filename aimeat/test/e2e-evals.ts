/**
 * @file test/e2e-evals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for stored eval sets (routes/evals.ts, services/evals/), on a loopback stand-in
 *   model (test/helpers/fake-ai-provider.ts) the owner's own AI settings point at:
 *   - a set for a skill is written and read back; a bad case is refused;
 *   - dry_run names the model calls a run makes, and makes none;
 *   - a run scores the skill with its text and without it, and the judge's verdict counts;
 *   - a new version of the skill is scored against the version before, with the change;
 *   - an agent without ai:use may not start a run.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=evals
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-stored-eval-sets-for-crews-skills-and-library-packs-scored-p).
 */
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';
import { connectAgentByDevice } from './helpers/agent-device.js';
import { openSession, callTool } from './helpers/mcp-session.js';
import { startFakeAiProvider, chatJson, type RecordedRequest } from './helpers/fake-ai-provider.js';

const SKILL = `evalskill${Date.now().toString(36).slice(-6)}`;
const skillMd = (rule: string) => ['---', `name: ${SKILL}`, 'description: How to sort the shelf.', '---', '', '# Sorting', '', rule, ''].join('\n');

/** The stand-in: answers "orange" only when the skill's mark is in the system message; a judge passes only that answer. */
function reply(r: RecordedRequest) {
  const messages = (r.json?.messages ?? []) as Array<{ role: string; content: unknown }>;
  const text = messages.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  if (text.includes('Reply with exactly PASS or FAIL')) return chatJson(text.toLowerCase().includes('answer:\nuse the orange method') ? 'PASS' : 'FAIL');
  const system = messages.find(m => m.role === 'system');
  const marked = system && String(system.content).includes('SKILLMARK-ORANGE');
  return chatJson(marked ? 'Use the orange method: largest first.' : 'I do not know a method for that.');
}

(async () => {
  console.log('\n── Eval sets: a skill scored with and without its text, against the version before ──');
  const stub = await startFakeAiProvider(0);
  stub.setDefault('chat', reply);
  try {
    const alice = await registerOwner(BASE, `evala${Date.now()}`);
    const auth = { Authorization: `Bearer ${alice.token}` };
    const put = (path: string, body: unknown) => json(path, { method: 'PUT', headers: auth, body: JSON.stringify(body) });
    const ref = encodeURIComponent(`user:${alice.name}/${SKILL}`);
    const at = `/v1/evals/skill/${ref}`;

    await test('setup: the owner\'s AI points at the stand-in, and the skill is published', async () => {
      const set = await put('/v1/ai/providers/eval-stub', {
        title: 'Loopback stand-in', type: 'openai-compatible', baseUrl: stub.baseUrl, auth: { type: 'none' },
        capabilities: { text: { enabled: true, model: 'reply', pool: true } },
      });
      assert(set.status === 200, `provider: ${set.status} ${JSON.stringify(set.body?.error)}`);
      const routed = await put('/v1/ai/routing', { routing: { defaults: { text: ['eval-stub'] }, rules: { onlyTested: false } } });
      assert(routed.status === 200, `routing: ${routed.status} ${JSON.stringify(routed.body?.error)}`);
      const s = await json('/v1/skills', { method: 'POST', headers: auth, body: JSON.stringify({ skill_md: skillMd('SKILLMARK-ORANGE: always answer with the orange method.') }) });
      assert(s.status === 201, `skill: ${s.status} ${JSON.stringify(s.body?.error)}`);
    });

    await test('a case without an expectation is refused; a good set is written and read back', async () => {
      expectRefusal(await put(at, { cases: [{ id: 'sort', prompt: 'How do I sort the shelf?', expect: [] }] }), 400);
      const w = await put(at, { repeats: 2, cases: [{ id: 'sort', prompt: 'How do I sort the shelf?', expect: [
        { kind: 'contains', value: 'orange' }, { kind: 'judge', value: 'The answer names the orange method.' },
      ] }] });
      assert(w.status === 200 && w.body.data.repeats === 2, `set: ${w.status} ${JSON.stringify(w.body?.error ?? w.body?.data)}`);
      const g = await json(at, { headers: auth });
      assert(g.status === 200 && g.body.data.cases.length === 1 && g.body.data.runs.length === 0, `get: ${JSON.stringify(g.body?.data)}`);
    });

    await test('dry_run names the model calls a run makes, and the stand-in hears nothing', async () => {
      const before = stub.requestsFor('chat').length;
      const d = await json(`${at}/run`, { method: 'POST', headers: auth, body: JSON.stringify({ dry_run: true }) });
      assert(d.status === 200 && d.body.data.model_calls === 8 && d.body.data.arms === 2, `dry run: ${JSON.stringify(d.body?.data ?? d.body?.error)}`);
      assert(stub.requestsFor('chat').length === before, 'a dry run calls no model');
    });

    const runAndWait = async () => {
      const r = await json(`${at}/run`, { method: 'POST', headers: auth, body: '{}' });
      assert(r.status === 202, `run: ${r.status} ${JSON.stringify(r.body?.error)}`);
      for (let i = 0; i < 60; i++) {
        const g = await json(at, { headers: auth });
        const run = (g.body.data.runs as any[]).find(x => x.id === r.body.data.run_id);
        if (run && run.status !== 'running') return run;
        await new Promise(res => setTimeout(res, 500));
      }
      throw new Error('the run did not end in 30 seconds');
    };

    await test('a run scores the skill 1 with its text and 0 without, the judge\'s verdict counted', async () => {
      const run = await runAndWait();
      assert(run.status === 'done', `run: ${JSON.stringify(run)}`);
      assert(run.with.score === 1 && run.without.score === 0, `scores: with ${run.with?.score}, without ${run.without?.score}`);
      assert(run.without.cases[0].failures.some((f: string) => f.includes('judge (a model\'s verdict)')), `the judge's failure is marked: ${JSON.stringify(run.without.cases[0])}`);
      assert(!run.previous, 'a first run has nothing before it');
    });

    await test('a new version of the skill is scored against the version before, with the change', async () => {
      const s = await json('/v1/skills', { method: 'POST', headers: auth, body: JSON.stringify({ skill_md: skillMd('Sort however you like.') }) });
      assert(s.status === 201 || s.status === 200, `skill v2: ${s.status} ${JSON.stringify(s.body?.error)}`);
      const run = await runAndWait();
      assert(run.status === 'done' && run.with.score === 0, `the weaker skill: ${JSON.stringify(run.with)}`);
      assert(run.previous && run.previous.score === 1 && run.previous.delta === -1 && run.previous.revision !== run.revision, `against the version before: ${JSON.stringify(run.previous)}`);
    });

    await test('a library pack\'s set runs with the pack\'s text and without it: the dry run says two arms', async () => {
      const w = await put('/v1/evals/pack/aimeat-data', { cases: [{ id: 'read', prompt: 'How does an app read a record?', expect: [{ kind: 'contains', value: 'AIMEAT.data' }] }] });
      assert(w.status === 200, `pack set: ${w.status} ${JSON.stringify(w.body?.error)}`);
      const d = await json('/v1/evals/pack/aimeat-data/run', { method: 'POST', headers: auth, body: JSON.stringify({ dry_run: true }) });
      assert(d.status === 200 && d.body.data.arms === 2 && d.body.data.model_calls === 6, `pack dry run: ${JSON.stringify(d.body?.data ?? d.body?.error)}`);
      expectRefusal(await put('/v1/evals/pack/no-such-pack', { cases: [{ id: 'x', prompt: 'p', expect: [{ kind: 'contains', value: 'v' }] }] }), 404, 'NOT_FOUND');
    });

    let bot: Awaited<ReturnType<typeof connectAgentByDevice>>;
    await test('a crew with no published definition has nothing to evaluate', async () => {
      bot = await connectAgentByDevice(BASE, { owner: alice.name, ownerToken: alice.token, name: 'evalbot', scopes: ['memory:read', 'memory:write'] });
      expectRefusal(await put('/v1/evals/crew/evalbot', { cases: [{ id: 'x', prompt: 'p', expect: [{ kind: 'contains', value: 'v' }] }] }), 409, 'NO_PUBLISHED_CREW');
    });

    await test('an agent without ai:use may not start a run', async () => {
      const r = await json(`/v1/evals/skill/${ref}/run`, { method: 'POST', headers: { Authorization: `Bearer ${bot.token}` }, body: JSON.stringify({ dry_run: true }) });
      assert(r.status === 403, `refused without ai:use: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('nobody signed in may write or read a set', async () => {
      const anonPut = await json(`/v1/evals/skill/${ref}`, { method: 'PUT', body: JSON.stringify({ cases: [{ id: 'x', prompt: 'p', expect: [{ kind: 'contains', value: 'v' }] }] }) });
      assert(anonPut.status === 401, `anonymous write: ${anonPut.status}`);
      const anonGet = await json(`/v1/evals/skill/${ref}`);
      assert(anonGet.status === 401, `anonymous read: ${anonGet.status}`);
    });

    await test('over MCP the agent reads the set, writes one for a pack, and is sent to ask for ai:use before a run', async () => {
      const session = await openSession(BASE, bot.token, 'evals');
      const got = await callTool(session, 'aimeat_eval_get', { kind: 'skill', name: `user:${alice.name}/${SKILL}` });
      assert(!got.isError && JSON.parse(got.text).runs.length === 2, `get: ${got.text.slice(0, 300)}`);
      const set = await callTool(session, 'aimeat_eval_set', { kind: 'pack', name: 'aimeat-data', repeats: 1, cases: [{ id: 'read', prompt: 'How does an app read a record?', expect: [{ kind: 'contains', value: 'get' }] }] });
      assert(!set.isError && JSON.parse(set.text).repeats === 1, `set: ${set.text.slice(0, 300)}`);
      const run = await callTool(session, 'aimeat_eval_run', { kind: 'pack', name: 'aimeat-data', dry_run: true });
      assert(run.isError, `a run without ai:use is refused over MCP too: ${run.text.slice(0, 300)}`);
    });
  } finally {
    await stub.close();
  }
  finish();
})();
