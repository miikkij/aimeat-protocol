/**
 * @file test/e2e-live-page-events.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The four pages that asked the node again on a timer now read on the live stream
 *   (feature audit 2026-11-19, 4.6; CLAUDE.md: live data arrives as an event, never by polling).
 *   This suite holds the event each one waits for, on a real stream (GET /v1/events):
 *     1. the front page's counters: a visitor's stream (no account, no app) hears `node-totals` when
 *        a public app is published, and no other domain; an owner's stream hears it too
 *        (services/live/node-totals.ts, routes/sse.ts PUBLIC_STREAM_DOMAINS);
 *     2. the admin's operator channel: a post to a board is `boards` on the stream;
 *     3. the crew trial: a trial run that ends is `crew-try` on its owner's stream and on nobody
 *        else's (services/crews/ops.ts);
 *     4. the home's connect-an-agent step: an agent's device authorization request is `agents` on
 *        the owner's stream.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=live-page-events
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, item 4.6).
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';
import { TunnelClient } from './helpers/tunnel-harness.js';
import { BASE, assert, finish, json, test } from './helpers/harness.js';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const stamp = Date.now().toString(36);

interface Stream { domains(): string[]; waitFor(domain: string, ms: number): Promise<void>; close(): void }

/** Open a stream on a ticket (an account's, or a visitor's when `token` is null) and collect its domain frames. */
async function openStream(token: string | null): Promise<Stream> {
  const t = token
    ? await json('/v1/events/ticket', { method: 'POST', headers: auth(token) })
    : await json('/v1/events/visitor-ticket', { method: 'POST', body: '{}' });
  assert(t.status === 200 && typeof t.body.data?.ticket === 'string', `ticket: ${t.status} ${JSON.stringify(t.body)}`);
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/v1/events?ticket=${encodeURIComponent(t.body.data.ticket)}`, { signal: ctrl.signal });
  assert(res.status === 200, `stream: ${res.status}`);
  let buf = '';
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  void (async () => {
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); } }
    catch { /* closed */ }
  })();
  const domains = (): string[] => buf.split('\n').filter((l) => l.startsWith('data: ')).flatMap((l) => {
    try { const p = JSON.parse(l.slice(6)); return Array.isArray(p.domains) ? p.domains as string[] : []; } catch { return []; }
  });
  return {
    domains,
    async waitFor(domain, ms) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (domains().includes(domain)) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`no "${domain}" within ${ms} ms; heard ${JSON.stringify(domains())}`);
    },
    close: () => ctrl.abort(),
  };
}

console.log('\n=== The live events the four pages read on ===\n');

let alice!: { name: string; token: string };
let bob!: { name: string; token: string };

await test('Setup: two owners', async () => {
  const a = await registerOwner(BASE, `liveev${stamp}`);
  alice = { name: a.name, token: a.token };
  const b = await registerOwner(BASE, `liveevb${stamp}`);
  bob = { name: b.name, token: b.token };
  assert(alice.name !== bob.name, 'two different owners');
});

console.log('\n1. The front page\'s counters');
await test('1a. A visitor\'s stream hears `node-totals` when a public app is published, and no other domain', async () => {
  const visitor = await openStream(null);
  const owner = await openStream(alice.token);
  try {
    await new Promise((r) => setTimeout(r, 500));
    const pub = await json('/v1/apps', {
      method: 'POST', headers: auth(alice.token),
      body: JSON.stringify({ filename: `live-${stamp}.html`, name: 'Live counters', description: 'counts', category: 'utility',
        content: Buffer.from('<!DOCTYPE html><html><body>live</body></html>', 'utf8').toString('base64') }),
    });
    assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body?.error)}`);
    await visitor.waitFor('node-totals', 20_000);
    const others = visitor.domains().filter((d) => d !== 'node-totals');
    assert(others.length === 0, `a visitor's stream carried other domains: ${JSON.stringify(others)}`);
    await owner.waitFor('node-totals', 5_000);
  } finally { visitor.close(); owner.close(); }
});

await test('1b. FAILURE: a write that moves no public counter tells a visitor nothing', async () => {
  const visitor = await openStream(null);
  try {
    const w = await json('/v1/memory', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ key: `live.private.${stamp}`, value: { n: 1 }, visibility: 'private' }) });
    assert(w.body?.ok === true, `write: ${w.status} ${JSON.stringify(w.body?.error)}`);
    await new Promise((r) => setTimeout(r, 7_000));
    assert(visitor.domains().length === 0, `a private write reached a visitor: ${JSON.stringify(visitor.domains())}`);
  } finally { visitor.close(); }
});

console.log('\n2. The operator channel');
await test('2. A post to a board is `boards` on the stream', async () => {
  const agent = await makeAgent(BASE, alice, ['*'], 'liveboards');
  const b = await json('/v1/boards', { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ name: `ops:live-${stamp}`, visibility: 'shared' }) });
  assert(b.status === 201, `board: ${b.status} ${JSON.stringify(b.body?.error)}`);
  const s = await openStream(alice.token);
  try {
    await new Promise((r) => setTimeout(r, 1_200));
    const p = await json(`/v1/boards/${b.body.data.id}/posts`, { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ title: 'hello', body: 'a post' }) });
    assert(p.status === 201, `post: ${p.status} ${JSON.stringify(p.body?.error)}`);
    await s.waitFor('boards', 5_000);
  } finally { s.close(); }
});

console.log('\n3. The crew trial');
await test('3. A trial run that ends is `crew-try` on its owner\'s stream and on nobody else\'s', async () => {
  const agent = await makeAgent(BASE, alice, ['*'], 'livecrew');
  const tunnel = await TunnelClient.connect(BASE, agent.token);
  await tunnel.waitForBacklog(1000);
  tunnel.onInvoke((f) => (f.capability === 'crew.try'
    ? { ok: true, result: { output: `ran with ${String((f as { input?: { prompt?: string } }).input?.prompt)}`, duration_ms: 3 } }
    : { ok: false, result: { code: 'UNSUPPORTED', message: 'no' } }));
  const mine = await openStream(alice.token);
  const theirs = await openStream(bob.token);
  try {
    const doc = {
      agent_name: 'livecrew',
      agents: [{ name: 'r', role: 'Researcher', goal: 'Find', backstory: 'Reads', tools: ['web'], allow_delegation: false }],
      tasks: [{ id: 'research', description: 'Do this: {{ctx.prompt}}', expected_output: 'A brief', agent: 'r', context: [], async: false }],
    };
    const start = await json('/v1/agents/livecrew/crew/try', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ doc, prompt: 'cats' }) });
    assert(start.status === 202, `try: ${start.status} ${JSON.stringify(start.body?.error)}`);
    await mine.waitFor('crew-try', 10_000);
    const read = await json(`/v1/agents/livecrew/crew/try/${start.body.data.try_id}`, { headers: auth(alice.token) });
    assert(read.body.data?.status === 'done', `the result is there when the event arrives: ${JSON.stringify(read.body.data)}`);
    await new Promise((r) => setTimeout(r, 1_200));
    assert(!theirs.domains().includes('crew-try'), 'another owner heard the trial end');
  } finally { mine.close(); theirs.close(); await tunnel.close(); }
});

console.log('\n4. The connect-an-agent step');
await test('4. An agent\'s device authorization request is `agents` on its owner\'s stream', async () => {
  const s = await openStream(alice.token);
  try {
    await new Promise((r) => setTimeout(r, 1_200));
    const r = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: 'knocker', owner: alice.name }) });
    assert(r.status === 200 && typeof r.body.data?.user_code === 'string', `authorize: ${r.status} ${JSON.stringify(r.body?.error)}`);
    await s.waitFor('agents', 5_000);
    const pending = await json('/v1/agents/device-authorize/pending', { headers: auth(alice.token) });
    assert((pending.body.data.requests as any[]).some((x) => x.user_code === r.body.data.user_code), 'the step reads the knock on that event');
  } finally { s.close(); }
});

finish();
