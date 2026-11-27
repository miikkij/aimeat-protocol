/**
 * @file test/e2e-evals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for stored eval sets (routes/evals/evals.ts, services/evals/). The owner's AI points
 *   at a loopback stand-in model (test/helpers/fake-ai-provider.ts) only to prove the node never calls
 *   it: the caller's own AI answers and judges, and the test plays that caller.
 *   - a set for a skill is written and read back; a bad case is refused;
 *   - dry_run names the answers and verdicts a run asks, and the node calls no model;
 *   - a start hands out the exact text and the cases; the caller's answers and verdicts score the
 *     skill with its text and without it; incomplete or doubled results are refused; a finished run
 *     takes no second set of results;
 *   - a new version of the skill is scored against the version before, with the change;
 *   - a new start closes a run still waiting;
 *   - a crew's trials run on its own runtime, and the run waits for the caller's verdicts;
 *   - an agent with memory:write runs a set over MCP; one with read access only may not;
 *   - neither the unauthenticated caller nor the token POST /v1/auth/anonymous mints reaches a set;
 *   - the set is in the owner's data export, and is removed by its owner (REST and MCP), never by an
 *     agent without memory:write or by another owner.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=evals
 * @version-history
 *   v2.0.0 — 2026-11-27 — The caller's own AI answers and judges; the node calls no model
 *     (wish-eval-runs-answered-by-the-caller-s-own-ai-not-by-the-node). The minted anonymous token is
 *     refused (secaudit2026nov26, eval-ops.ts:evalCallerOf:minted-anonymous-token-read-as-agent).
 *   v1.1.0 — 2026-11-26 — Export and removal.
 *   v1.0.0 — 2026-11-26 — Initial (wish-stored-eval-sets-for-crews-skills-and-library-packs-scored-p).
 */
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';
import { connectAgentByDevice } from './helpers/agent-device.js';
import { openSession, callTool } from './helpers/mcp-session.js';
import { startFakeAiProvider, chatJson } from './helpers/fake-ai-provider.js';
import { TunnelClient } from './helpers/tunnel-harness.js';

const SKILL = `evalskill${Date.now().toString(36).slice(-6)}`;
const skillMd = (rule: string) => ['---', `name: ${SKILL}`, 'description: How to sort the shelf.', '---', '', '# Sorting', '', rule, ''].join('\n');

/** The caller's own AI, played here: it knows the orange method only when the text says so. */
const callerAnswer = (text: string | undefined) => (text?.includes('SKILLMARK-ORANGE') ? 'Use the orange method: largest first.' : 'I do not know a method for that.');
const callerJudge = (answer: string) => answer.toLowerCase().includes('orange method');

type StartData = { run_id: string; text: string; repeats: number; cases: Array<{ id: string; prompt: string; judges: string[] }> };
/** Every case, arm and repeat once, answered and judged as the caller's AI would. */
function resultsFor(start: StartData) {
  const out: Array<Record<string, unknown>> = [];
  for (const c of start.cases) {
    for (const arm of ['with', 'without'] as const) {
      for (let repeat = 1; repeat <= start.repeats; repeat++) {
        const answer = callerAnswer(arm === 'with' ? start.text : undefined);
        out.push({ case: c.id, arm, repeat, answer, verdicts: c.judges.map(() => callerJudge(answer)) });
      }
    }
  }
  return out;
}

(async () => {
  console.log('\n── Eval sets: the caller\'s own AI answers and judges, the node scores ──');
  const stub = await startFakeAiProvider(0);
  stub.setDefault('chat', () => chatJson('The node should never ask me.'));
  let tunnel: TunnelClient | null = null;
  try {
    const alice = await registerOwner(BASE, `evala${Date.now()}`);
    const auth = { Authorization: `Bearer ${alice.token}` };
    const put = (path: string, body: unknown) => json(path, { method: 'PUT', headers: auth, body: JSON.stringify(body) });
    const post = (path: string, body: unknown, headers: Record<string, string> = auth) => json(path, { method: 'POST', headers, body: JSON.stringify(body) });
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
      const s = await post('/v1/skills', { skill_md: skillMd('SKILLMARK-ORANGE: always answer with the orange method.') });
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

    await test('dry_run names the answers and verdicts the caller gives, and the node calls no model', async () => {
      const d = await post(`${at}/run`, { dry_run: true });
      assert(d.status === 200 && d.body.data.answers_to_write === 4 && d.body.data.verdicts_to_give === 4 && d.body.data.arms === 2, `dry run: ${JSON.stringify(d.body?.data ?? d.body?.error)}`);
      assert(d.body.data.node_model_calls === 0, `the node calls no model: ${d.body.data.node_model_calls}`);
    });

    let first: StartData;
    await test('a start hands the caller the exact text of the revision and the cases, and calls no model', async () => {
      const r = await post(`${at}/run`, {});
      assert(r.status === 201 && r.body.data.status === 'open', `start: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
      first = r.body.data;
      assert(first.text.includes('SKILLMARK-ORANGE') && first.cases[0].judges.length === 1, `text and judges: ${JSON.stringify(first).slice(0, 300)}`);
      const g = await json(at, { headers: auth });
      const run = g.body.data.runs.find((x: any) => x.id === first.run_id);
      assert(run?.status === 'open' && run.awaiting === 'answers', `the run waits for the caller: ${JSON.stringify(run)}`);
    });

    await test('results that leave a slot out, send one twice, or miscount the verdicts are refused', async () => {
      const all = resultsFor(first);
      const lacking = await post(`${at}/run`, { run_id: first.run_id, results: all.slice(1) });
      expectRefusal(lacking, 400, 'INVALID_INPUT');
      assert(String(lacking.body?.error?.message).includes('sort with 1'), `the missing slot is named: ${lacking.body?.error?.message}`);
      expectRefusal(await post(`${at}/run`, { run_id: first.run_id, results: [...all, all[0]] }), 400, 'INVALID_INPUT');
      expectRefusal(await post(`${at}/run`, { run_id: first.run_id, results: all.map(x => ({ ...x, verdicts: [] })) }), 400, 'INVALID_INPUT');
    });

    await test('the caller\'s answers score the skill 1 with its text and 0 without; its judge verdict is marked as its own', async () => {
      const r = await post(`${at}/run`, { run_id: first.run_id, model: 'claude-opus-5-5', results: resultsFor(first) });
      assert(r.status === 200 && r.body.data.status === 'done', `finish: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
      assert(r.body.data.with.score === 1 && r.body.data.without.score === 0, `scores: with ${r.body.data.with?.score}, without ${r.body.data.without?.score}`);
      assert(r.body.data.without.cases[0].failures.some((f: string) => f.includes('judge (the caller\'s verdict)')), `the judge's failure is marked: ${JSON.stringify(r.body.data.without.cases[0])}`);
      assert(!r.body.data.previous, 'a first run has nothing before it');
      const g = await json(at, { headers: auth });
      const run = g.body.data.runs.find((x: any) => x.id === first.run_id);
      assert(run.model === 'claude-opus-5-5' && run.answered_by && !JSON.stringify(run).includes('largest first'), `the model is kept and the answers are not: ${JSON.stringify(run)}`);
    });

    await test('a finished run takes no second set of results', async () => {
      expectRefusal(await post(`${at}/run`, { run_id: first.run_id, results: resultsFor(first) }), 409, 'EVAL_RUN_NOT_OPEN');
    });

    await test('a new version of the skill is scored against the version before, with the change', async () => {
      const s = await post('/v1/skills', { skill_md: skillMd('Sort however you like.') });
      assert(s.status === 201 || s.status === 200, `skill v2: ${s.status} ${JSON.stringify(s.body?.error)}`);
      const r = await post(`${at}/run`, {});
      assert(r.status === 201 && !r.body.data.text.includes('SKILLMARK-ORANGE'), `the new text is handed out: ${r.status}`);
      const done = await post(`${at}/run`, { run_id: r.body.data.run_id, results: resultsFor(r.body.data) });
      assert(done.status === 200 && done.body.data.with.score === 0, `the weaker skill: ${JSON.stringify(done.body?.data?.with ?? done.body?.error)}`);
      const prev = done.body.data.previous;
      assert(prev && prev.score === 1 && prev.delta === -1 && prev.revision !== done.body.data.revision, `against the version before: ${JSON.stringify(prev)}`);
    });

    await test('a new start closes a run still waiting: the caller that went away locks nothing', async () => {
      const a = await post(`${at}/run`, {});
      const b = await post(`${at}/run`, {});
      assert(a.status === 201 && b.status === 201, `two starts: ${a.status} ${b.status}`);
      const late = await post(`${at}/run`, { run_id: a.body.data.run_id, results: resultsFor(a.body.data) });
      expectRefusal(late, 409, 'EVAL_RUN_NOT_OPEN');
      assert(String(late.body?.error?.message).includes('Superseded'), `it says why: ${late.body?.error?.message}`);
    });

    await test('a library pack\'s set hands out the pack\'s text: the dry run says two arms', async () => {
      const w = await put('/v1/evals/pack/aimeat-data', { cases: [{ id: 'read', prompt: 'How does an app read a record?', expect: [{ kind: 'contains', value: 'AIMEAT.data' }] }] });
      assert(w.status === 200, `pack set: ${w.status} ${JSON.stringify(w.body?.error)}`);
      const d = await post('/v1/evals/pack/aimeat-data/run', { dry_run: true });
      assert(d.status === 200 && d.body.data.arms === 2 && d.body.data.answers_to_write === 6, `pack dry run: ${JSON.stringify(d.body?.data ?? d.body?.error)}`);
      // A served pack has no version number: its revision names a hash of the text the eval measures,
      // so a changed text is compared with the one before (it read "unversioned" for every run).
      assert(/^text:[0-9a-f]{12}$/.test(String(d.body.data.revision)), `the pack's revision names its text: ${d.body.data.revision}`);
      expectRefusal(await put('/v1/evals/pack/no-such-pack', { cases: [{ id: 'x', prompt: 'p', expect: [{ kind: 'contains', value: 'v' }] }] }), 404, 'NOT_FOUND');
    });

    let bot: Awaited<ReturnType<typeof connectAgentByDevice>>;
    await test('a crew with no published definition has nothing to evaluate', async () => {
      bot = await connectAgentByDevice(BASE, { owner: alice.name, ownerToken: alice.token, name: 'evalbot', scopes: ['memory:read', 'memory:write'] });
      expectRefusal(await put('/v1/evals/crew/evalbot', { cases: [{ id: 'x', prompt: 'p', expect: [{ kind: 'contains', value: 'v' }] }] }), 409, 'NO_PUBLISHED_CREW');
    });

    await test('a crew\'s trials run on its own runtime; with a judge the run waits for the caller\'s verdicts', async () => {
      tunnel = await TunnelClient.connect(BASE, bot.token);
      await tunnel.waitForBacklog(1000);
      tunnel.onInvoke((f: any) => {
        if (f.capability === 'crew.validate') return { ok: true, result: { errors: [] } };
        if (f.capability === 'crew.try') return { ok: true, result: { output: `crew says: ${f.input?.prompt}` } };
        return { ok: false, result: { code: 'UNSUPPORTED', message: `no ${f.capability}` } };
      });
      const doc = {
        agent_name: 'evalbot',
        agents: [{ name: 'r', role: 'Researcher', goal: 'Find', backstory: 'Reads', tools: ['web'], allow_delegation: false }],
        tasks: [{ id: 'research', description: 'Do this: {{ctx.prompt}}', expected_output: 'A brief', agent: 'r', context: [], async: false }],
      };
      const pub = await post('/v1/agents/evalbot/crew/publish', { doc });
      assert(pub.status === 200 || pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body?.error)}`);
      const cat = '/v1/evals/crew/evalbot';
      const w = await put(cat, { repeats: 1, cases: [{ id: 'echo', prompt: 'kissoista', expect: [{ kind: 'contains', value: 'kissoista' }, { kind: 'judge', value: 'It talks about cats.' }] }] });
      assert(w.status === 200, `crew set: ${w.status} ${JSON.stringify(w.body?.error)}`);
      const r = await post(`${cat}/run`, {});
      assert(r.status === 202, `crew start: ${r.status} ${JSON.stringify(r.body?.error)}`);
      let run: any;
      for (let i = 0; i < 60 && run?.status !== 'open'; i++) {
        await new Promise(res => setTimeout(res, 500));
        run = (await json(cat, { headers: auth })).body.data.runs.find((x: any) => x.id === r.body.data.run_id);
        assert(run?.status !== 'failed', `the crew run failed: ${JSON.stringify(run)}`);
      }
      assert(run?.status === 'open' && run.awaiting === 'verdicts' && String(run.pending?.[0]?.answer).includes('kissoista'), `waits with the crew's answer: ${JSON.stringify(run)}`);
      const done = await post(`${cat}/run`, { run_id: run.id, results: [{ case: 'echo', repeat: 1, verdicts: [true] }] });
      assert(done.status === 200 && done.body.data.with.score === 1 && !done.body.data.without, `scored on the caller's verdict: ${JSON.stringify(done.body?.data ?? done.body?.error)}`);
      const after = (await json(cat, { headers: auth })).body.data.runs.find((x: any) => x.id === run.id);
      assert(after.status === 'done' && !after.pending, `the crew's answers are not kept after the verdicts: ${JSON.stringify(after)}`);
      await tunnel.close();
      tunnel = null;
    });

    await test('an agent with read access only may not start a run', async () => {
      const reader = await connectAgentByDevice(BASE, { owner: alice.name, ownerToken: alice.token, name: 'evalreader', scopes: ['memory:read'] });
      const r = await json(`/v1/evals/skill/${ref}/run`, { method: 'POST', headers: { Authorization: `Bearer ${reader.token}` }, body: JSON.stringify({ dry_run: true }) });
      assert(r.status === 403, `refused without memory:write: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('nobody signed in may write or read a set', async () => {
      const anonPut = await json(at, { method: 'PUT', body: JSON.stringify({ cases: [{ id: 'x', prompt: 'p', expect: [{ kind: 'contains', value: 'v' }] }] }) });
      assert(anonPut.status === 401, `anonymous write: ${anonPut.status}`);
      const anonGet = await json(at);
      assert(anonGet.status === 401, `anonymous read: ${anonGet.status}`);
    });

    // secaudit2026nov26: the minted token has role agent and no signed anonymous claim, so evalCallerOf
    // took it for an agent of the shared account, which could then write, read, run and remove sets.
    await test('the token anonymous mode mints writes, reads, runs and removes no set', async () => {
      const minted = await json('/v1/auth/anonymous', { method: 'POST' });
      if (minted.status !== 200) { console.log(`    (anonymous mode is off on this node: ${minted.status}; nothing to mint)`); return; }
      const h = { Authorization: `Bearer ${minted.body.data.token}` };
      const body = JSON.stringify({ cases: [{ id: 'x', prompt: 'p', expect: [{ kind: 'contains', value: 'v' }] }] });
      const w = await json('/v1/evals/pack/aimeat-data', { method: 'PUT', headers: h, body });
      assert(w.status === 403 && w.body?.error?.code === 'FORBIDDEN', `write: ${w.status} ${JSON.stringify(w.body?.error)}`);
      const r = await json('/v1/evals/pack/aimeat-data', { method: 'GET', headers: h });
      assert(r.status === 403 && r.body?.error?.code === 'FORBIDDEN', `read: ${r.status} ${JSON.stringify(r.body?.error)}`);
      const run = await json('/v1/evals/pack/aimeat-data/run', { method: 'POST', headers: h, body: '{}' });
      assert(run.status === 403 && run.body?.error?.code === 'FORBIDDEN', `run: ${run.status} ${JSON.stringify(run.body?.error)}`);
      const d = await json('/v1/evals/pack/aimeat-data', { method: 'DELETE', headers: h });
      assert(d.status === 403 && d.body?.error?.code === 'FORBIDDEN', `remove: ${d.status} ${JSON.stringify(d.body?.error)}`);
    });

    await test('over MCP an agent with memory:write starts a run, answers it and is scored', async () => {
      const session = await openSession(BASE, bot.token, 'evals');
      const got = await callTool(session, 'aimeat_eval_get', { kind: 'skill', name: `user:${alice.name}/${SKILL}` });
      assert(!got.isError && JSON.parse(got.text).runs.length >= 2, `get: ${got.text.slice(0, 300)}`);
      const set = await callTool(session, 'aimeat_eval_set', { kind: 'pack', name: 'aimeat-data', repeats: 1, cases: [{ id: 'read', prompt: 'How does an app read a record?', expect: [{ kind: 'contains', value: 'get' }] }] });
      assert(!set.isError && JSON.parse(set.text).repeats === 1, `set: ${set.text.slice(0, 300)}`);
      const start = await callTool(session, 'aimeat_eval_run', { kind: 'pack', name: 'aimeat-data' });
      assert(!start.isError, `start over MCP: ${start.text.slice(0, 300)}`);
      const s = JSON.parse(start.text);
      assert(s.status === 'open' && typeof s.text === 'string' && s.text.length > 0, `the pack's text is handed out: ${start.text.slice(0, 200)}`);
      const results = [{ case: 'read', arm: 'with', repeat: 1, answer: 'Use AIMEAT.data.get(key).' }, { case: 'read', arm: 'without', repeat: 1, answer: 'No idea.' }];
      const done = await callTool(session, 'aimeat_eval_run', { kind: 'pack', name: 'aimeat-data', run_id: s.run_id, model: 'test-model', results });
      assert(!done.isError, `finish over MCP: ${done.text.slice(0, 300)}`);
      const d = JSON.parse(done.text);
      assert(d.with.score === 1 && d.without.score === 0, `scores over MCP: ${done.text.slice(0, 300)}`);
      const removed = await callTool(session, 'aimeat_eval_set', { kind: 'pack', name: 'aimeat-data', remove: true });
      assert(!removed.isError && JSON.parse(removed.text).removed === true, `remove over MCP: ${removed.text.slice(0, 300)}`);
      const gone = await callTool(session, 'aimeat_eval_get', { kind: 'pack', name: 'aimeat-data' });
      assert(gone.isError && gone.text.startsWith('NO_EVAL_SET'), `the removed set is gone: ${gone.text.slice(0, 200)}`);
    });

    await test('in the whole suite the node asked the owner\'s AI nothing', async () => {
      assert(stub.requestsFor('chat').length === 0, `the stand-in heard ${stub.requestsFor('chat').length} calls`);
    });

    await test('the set is the account\'s own record: the owner\'s data export carries it', async () => {
      const e = await json(`/v1/owners/${alice.name}/export`, { headers: auth });
      assert(e.status === 200, `export: ${e.status} ${JSON.stringify(e.body?.error)}`);
      const keys = JSON.stringify(e.body).match(/"key":"evalset\.[0-9a-f]+"/g) ?? [];
      assert(keys.length === 2, `the skill's and the crew's sets are in the export: ${keys.length}`);
    });

    await test('an agent with read access only may not remove a set', async () => {
      const reader = await connectAgentByDevice(BASE, { owner: alice.name, ownerToken: alice.token, name: 'evalreader2', scopes: ['memory:read'] });
      const r = await json(at, { method: 'DELETE', headers: { Authorization: `Bearer ${reader.token}` } });
      assert(r.status === 403, `refused without memory:write: ${r.status} ${JSON.stringify(r.body?.error)}`);
      assert((await json(at, { headers: auth })).status === 200, 'the set is still there');
    });

    await test('another owner removes nothing of this owner\'s: the same name is no set of theirs', async () => {
      const bob = await registerOwner(BASE, `evalb${Date.now()}`);
      expectRefusal(await json(at, { method: 'DELETE', headers: { Authorization: `Bearer ${bob.token}` } }), 404, 'NO_EVAL_SET');
      assert((await json(at, { headers: auth })).status === 200, 'alice\'s set is still there');
    });

    await test('the owner removes the sets with their runs; a second remove says there is none', async () => {
      const r = await json(at, { method: 'DELETE', headers: auth });
      assert(r.status === 200 && r.body.data.removed === true, `remove: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
      expectRefusal(await json(at, { headers: auth }), 404, 'NO_EVAL_SET');
      expectRefusal(await json(at, { method: 'DELETE', headers: auth }), 404, 'NO_EVAL_SET');
      const crew = await json('/v1/evals/crew/evalbot', { method: 'DELETE', headers: auth });
      assert(crew.status === 200, `the crew's set is removed: ${crew.status}`);
    });
  } finally {
    await tunnel?.close();
    await stub.close();
  }
  finish();
})();
