/**
 * @file test/e2e-trust-score.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rules of an agent's trust score (services/trust.ts calculateTrustScore), on the
 *   score the node stores and lists, through the work routes a provider and its requesters use.
 *   test/unit/trust.test.ts holds the formula on hand-made rows, and e2e-disputes.ts holds the one
 *   number a single delivery gives (40); nothing held the rules between them on a real node:
 *     1. with fewer than three different requesters the score stays at 40 however good the work
 *        is, so one colluding party cannot raise it;
 *     2. the third different requester lifts that ceiling, and the agent's first seven days hold the
 *        score at 65 (the blend would be 73);
 *     3. a declined request and a dispute the provider lost bring the blend under 65 (62), so the
 *        failures are counted, not only the successes;
 *     4. the agent's export, which computes the score afresh, gives the score the listings store.
 *   The inactivity decay (one point per 30 days without activity) needs an agent last seen a month
 *   ago, which no route can make; it is held nowhere yet, and this suite does not claim it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=trust-score
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, item 4.5).
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, type McpAgent } from './helpers/mcp-session.js';
import { BASE, assert, finish, json, test } from './helpers/harness.js';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const ACTION = 'trust-test-action';
const stamp = Date.now().toString(36);

let provOwner!: { name: string; token: string };
let reqOwner!: { name: string; token: string };
let provider!: McpAgent;
const requesters: McpAgent[] = [];

/** The provider's score as the owner's agent list stores it (no recomputation on this read). */
async function storedScore(): Promise<number> {
  const r = await json(`/v1/owners/${provOwner.name}`, { headers: auth(provOwner.token) });
  assert(r.status === 200, `owner read: ${r.status}`);
  const row = (r.body.data.agents as any[]).find((a) => a.gaii === provider.gaii);
  return Number(row?.trust_score);
}

/** One request from `requester` to the provider, accepted and delivered. Returns the tracking code. */
async function deliveredWork(requester: McpAgent): Promise<string> {
  const sub = await json('/v1/work', {
    method: 'POST', headers: auth(requester.token),
    body: JSON.stringify({ action_id: ACTION, provider_gaii: provider.gaii, input: { text: 'x' } }),
  });
  assert(sub.body?.ok === true, `submit: ${sub.status} ${JSON.stringify(sub.body?.error)}`);
  const tc = sub.body.data.tracking_code as string;
  const acc = await json(`/v1/work/${tc}/accept`, { method: 'POST', headers: auth(provider.token) });
  assert(acc.body?.ok === true, `accept: ${acc.status} ${JSON.stringify(acc.body?.error)}`);
  const del = await json(`/v1/work/${tc}/deliver`, { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ output: { result: 'done' } }) });
  assert(del.body?.ok === true, `deliver: ${del.status} ${JSON.stringify(del.body?.error)}`);
  return tc;
}
async function ratePositive(requester: McpAgent, tc: string): Promise<void> {
  const r = await json(`/v1/work/${tc}/rate`, { method: 'POST', headers: auth(requester.token), body: JSON.stringify({ rating: 'positive' }) });
  assert(r.status === 200, `rate: ${r.status} ${JSON.stringify(r.body?.error)}`);
}

console.log('\n=== The trust score rules on a real node ===\n');
const codes: string[] = [];

console.log('Setup');
await test('A provider agent with a priced action, and three agents of another owner that request it', async () => {
  const p = await registerOwner(BASE, `trustprov${stamp}`);
  provOwner = { name: p.name, token: p.token };
  const q = await registerOwner(BASE, `trustreq${stamp}`);
  reqOwner = { name: q.name, token: q.token };
  provider = await makeAgent(BASE, provOwner, ['*'], 'provider');
  for (const n of ['req1', 'req2', 'req3']) requesters.push(await makeAgent(BASE, reqOwner, ['*'], n));
  const act = await json('/v1/actions', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({
      id: ACTION, display_name: 'Trust Test Action', description: 'For the trust score rules',
      input_schema: { type: 'object', properties: { text: { type: 'string' } } },
      output_schema: { type: 'object', properties: { result: { type: 'string' } } },
      pricing: { toll_morsels: 1 },
    }),
  });
  assert(act.status === 201, `action: ${act.status} ${JSON.stringify(act.body?.error)}`);
  assert(await storedScore() === 50, `a new agent starts at 50: ${await storedScore()}`);
});

console.log('\n1. Fewer than three different requesters');
await test('1a. One requester, delivered and rated positive: the score is 40', async () => {
  codes.push(await deliveredWork(requesters[0]));
  await ratePositive(requesters[0], codes[0]);
  const s = await storedScore();
  assert(s === 40, `one requester: ${s}`);
});

await test('1b. The same requester again: still 40, however good the work', async () => {
  const tc = await deliveredWork(requesters[0]);
  await ratePositive(requesters[0], tc);
  assert(await storedScore() === 40, `the same requester twice: ${await storedScore()}`);
});

await test('1c. A second different requester: still 40 (the blend would be over 70)', async () => {
  codes.push(await deliveredWork(requesters[1]));
  await ratePositive(requesters[1], codes[1]);
  assert(await storedScore() === 40, `two requesters: ${await storedScore()}`);
});

console.log('\n2. The third requester and the first week');
await test('2. A third different requester lifts the 40, and the first seven days hold the score at 65', async () => {
  codes.push(await deliveredWork(requesters[2]));
  await ratePositive(requesters[2], codes[2]);
  // 4 delivered of 4, all positive, an agent younger than a day, no dispute: 30 + 25 + 0 + 3.83 + 15 =
  // 73, held at 65.
  assert(await storedScore() === 65, `three requesters in the first week: ${await storedScore()}`);
});

console.log('\n3. Failures count');
await test('3a. A declined request is counted, and the score stays under the first-week ceiling', async () => {
  const sub = await json('/v1/work', {
    method: 'POST', headers: auth(requesters[0].token),
    body: JSON.stringify({ action_id: ACTION, provider_gaii: provider.gaii, input: { text: 'decline me' } }),
  });
  assert(sub.body?.ok === true, `submit: ${sub.status}`);
  const rej = await json(`/v1/work/${sub.body.data.tracking_code}/reject`, { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ reason: 'busy' }) });
  assert(rej.status === 200, `reject: ${rej.status} ${JSON.stringify(rej.body?.error)}`);
  // 4 delivered of 5: 24 + 25 + 0 + 3.83 + 15 = 67, still held at 65.
  assert(await storedScore() === 65, `after one decline: ${await storedScore()}`);
});

await test('3b. A dispute the provider lost brings the blend under the ceiling: 62', async () => {
  const open = await json(`/v1/work/${codes[1]}/dispute`, { method: 'POST', headers: auth(requesters[1].token), body: JSON.stringify({ reason: 'not what I asked' }) });
  assert(open.status === 201, `dispute: ${open.status} ${JSON.stringify(open.body?.error)}`);
  const fault = await json(`/v1/work/${codes[1]}/accept-fault`, { method: 'POST', headers: auth(provider.token) });
  assert(fault.status === 200 && fault.body.data.status === 'resolved', `accept-fault: ${fault.status} ${JSON.stringify(fault.body)}`);
  // 4 delivered of 5 (a disputed item still counts as delivered, and keeps its rating), one lost
  // dispute: 24 + 25 + 0 + 3.83 + 10.05 = 62.
  const s = await storedScore();
  assert(s === 62, `after a lost dispute: ${s}`);
});

console.log('\n4. The agent\'s own page');
await test('4. The agent\'s export computes the same score the listing stores', async () => {
  // The agent's export computes the score afresh (calculateTrustScore); the listing reads the stored one.
  const r = await json(`/v1/agents/${encodeURIComponent(provider.gaii)}/export`, { method: 'POST', headers: auth(provOwner.token), body: '{}' });
  assert(r.status === 200, `export: ${r.status} ${JSON.stringify(r.body?.error)}`);
  const computed = Number(r.body.data?.agent?.trust_score);
  assert(computed === await storedScore(), `computed ${computed}, stored ${await storedScore()}`);
});

finish();
