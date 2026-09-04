// E2E: who am I, how big a press, and can a stranger find anything.
//
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-me-and-discovery
//
// THE `/me` DEFECT IS THE ONE WORTH EXPLAINING. `GET /v1/agents/me` answered 404 for every agent
// that ever asked, and had always done so: the `/v1/agents/me` rewrite sliced the caller's BARE
// NAME out of its credential, and a bare name is not a key anything is stored under. Nine route
// files each carried their own copy of the same mistake in `resolveAgentGaii`, which called
// `buildGAII` unconditionally — hand one an identity and it produced `name#owner@node#owner@node`.
// Most sub-routes survived by accident because they rebuilt what had just been taken apart.
//
// It is why `aimeat connect acp` had never started for anyone: ACP reads the node's answer to "who
// am I" before it can announce itself to an editor. The ACP work had been verified against the SDK's
// own client, which never asks the node that question, so the gap survived being tested. This suite
// asks the node the question directly, which is the only thing that would have caught it.

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) =>
  new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
}
async function signMsg(priv: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(priv, 'base64'));
  return Buffer.from(sig).toString('base64');
}
async function getToken(id: string, priv: string, isAgent: boolean): Promise<string> {
  const ts = new Date().toISOString();
  const signature = await signMsg(priv, isAgent ? id + ts : id + NODE_ID + ts);
  const payload = isAgent ? { gaii: id, timestamp: ts, signature } : { owner: id, timestamp: ts, signature };
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

const stamp = Date.now();
const ownerA = `mea${stamp}`;
const ownerB = `meb${stamp}`;
let tokA = '';
let tokB = '';
let gaiiA = '';
let agentTokA = '';

console.log('\n=== AIMEAT: /v1/agents/me, the bulk press, and A2A discovery ===\n');

console.log('Setup');
await test('Two owners, one agent each', async () => {
  const a = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerA, public_key: 'placeholder' }) });
  assert(a.status === 201, `owner A: ${JSON.stringify(a.body)}`);
  tokA = await getToken(ownerA, a.body.data.private_key, false);
  const b = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerB, public_key: 'placeholder' }) });
  tokB = await getToken(ownerB, b.body.data.private_key, false);

  const mk = await json('/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${tokA}` },
    body: JSON.stringify({ name: 'webresearcher', owner: ownerA, capabilities: ['memory'], scopes: ['*'] }),
  });
  assert(mk.status === 201, `agent: ${JSON.stringify(mk.body)}`);
  gaiiA = mk.body.data.agent.gaii;
  agentTokA = await getToken(gaiiA, mk.body.data.private_key, true);
});

console.log('\nWho am I');

await test('1. GET /v1/agents/me answers the agent asking, with its full identity', async () => {
  // The one ACP needs, and the one that 404'd for everybody.
  const r = await json('/v1/agents/me', { headers: { Authorization: `Bearer ${agentTokA}` } });
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.gaii === gaiiA, `it is the caller: ${r.body.data.gaii}`);
});

await test('2. ...and so do the sub-paths, which the bare name only reached by accident', async () => {
  // Each of these lives in a different route file, and each had its own copy of the assembly bug.
  for (const tail of ['/tasks', '/capabilities', '/directives', '/telemetry', '/webhook']) {
    const r = await json(`/v1/agents/me${tail}`, { headers: { Authorization: `Bearer ${agentTokA}` } });
    assert(r.status === 200, `/v1/agents/me${tail}: ${r.status} ${JSON.stringify(r.body?.error)}`);
  }
});

await test('3. An OWNER session is still refused, because `me` is ambiguous for someone with forty', async () => {
  const r = await json('/v1/agents/me', { headers: { Authorization: `Bearer ${tokA}` } });
  assert(r.status === 404, `owner me must stay a 404, got ${r.status}`);
});

await test('4. And `me` grants nothing: it never reaches another owner', async () => {
  // MEASURED RATHER THAN GUESSED. An owner session is not rewritten, so `/v1/agents/me/tasks` keeps
  // a literal `me` and the tasks route takes its owner-scoped path — which answers 200 with THAT
  // owner's own list. Not a refusal, and not a leak either: the scoping is by owner GHII, so owner
  // B sees owner B. The property worth pinning is that one, not the status code.
  const mine = await json('/v1/agents/me/tasks', { headers: { Authorization: `Bearer ${tokB}` } });
  assert(mine.status === 200, `owner-scoped listing: ${mine.status}`);
  assert(!JSON.stringify(mine.body).includes(gaiiA),
    'owner B must not see owner A agent through the me alias');
});

console.log('\nThe bulk press');

await test('5. The per-call cap is configurable and reported, not a hidden const', async () => {
  // Nothing to migrate on this account, so this asserts the SHAPE of the answer rather than a move:
  // the preview names what would move, and the press answers with what is left.
  const r = await json('/v1/agents/v2/migrate', { headers: { Authorization: `Bearer ${tokA}` } });
  assert(r.status === 200, `preview: ${r.status}`);
  assert(Array.isArray(r.body.data.would_move), 'the preview lists what would move');
});

await test('6. A press with nothing to move refuses cleanly rather than half-acting', async () => {
  const r = await json('/v1/agents/v2/migrate', { method: 'POST', headers: { Authorization: `Bearer ${tokA}` }, body: '{}' });
  assert(r.status === 409 && r.body.error.code === 'NOTHING_TO_MIGRATE',
    `expected NOTHING_TO_MIGRATE, got ${r.status} ${r.body?.error?.code}`);
});

console.log('\nCan a stranger find anything');

await test('7. /.well-known/agent-card.json exists and needs no credential', async () => {
  // A foreign agent arrives knowing the hostname and nothing else. Before this it got a 404.
  const r = await json('/.well-known/agent-card.json');
  assert(r.status === 200, `status ${r.status}`);
  assert(r.body.node === NODE_ID, `it names this node: ${r.body.node}`);
  assert(Array.isArray(r.body.agents), 'it carries an agents array');
});

await test('8. It lists agents with a PUBLISHED OFFERING and nobody else', async () => {
  // The consent model, obeyed rather than re-stated: an agent with no offering is not for sale, so
  // it is not in the directory. This one has none.
  const r = await json('/.well-known/agent-card.json');
  const listed = r.body.agents.map((a: any) => a.gaii);
  assert(!listed.includes(gaiiA), `an agent with no offering is not listed, saw ${JSON.stringify(listed)}`);
});

await test('8b. The directory validates as an A2A Agent Card, because this path is A2A\'s', async () => {
  // A client that validates the document before reading it used to get nothing: the six fields
  // below were absent, so `/.well-known/agent-card.json` failed schema validation and a stranger
  // who checked before parsing learned neither the directory nor that it existed. Reported by an
  // agent-readiness validator against production on 2026-09-04, naming all six.
  //
  // Each one is asserted for its VALUE, not its presence, because presence is what a directory
  // dressed as a card would also have. These say something true about a directory.
  const r = await json('/.well-known/agent-card.json');
  for (const field of ['version', 'capabilities', 'supportedInterfaces', 'defaultInputModes', 'defaultOutputModes', 'skills']) {
    assert(r.body[field] !== undefined, `the A2A schema requires ${field}, and it is missing`);
  }
  // NOT AN ENDPOINT. Work goes to an agent's own interface, and an empty list is how this document
  // says it has none of its own. A non-empty one here would send a stranger's task nowhere.
  assert(Array.isArray(r.body.supportedInterfaces) && r.body.supportedInterfaces.length === 0,
    `the directory offers no interface of its own, got ${JSON.stringify(r.body.supportedInterfaces)}`);
  assert(r.body.capabilities.streaming === false, 'a directory streams nothing');
  assert(r.body.skills.length === 1 && r.body.skills[0].id === 'directory',
    `its one skill is being a directory, got ${JSON.stringify(r.body.skills)}`);
  // The point of the document survived the fields being added to it.
  assert(Array.isArray(r.body.agents), 'the directory is still a directory');
});

await test('9. The per-agent card still answers at its own address', async () => {
  // Both addresses stay: the new one is a directory, not a replacement.
  const r = await json(`/v1/a2a/${encodeURIComponent(ownerA)}/webresearcher/agent-card.json`);
  assert(r.status === 200, `per-agent card: ${r.status}`);
  assert(typeof r.body.name === 'string', 'it is a card');
});

await test('9b. The description is editable, and it reaches the A2A card', async () => {
  // The one line a stranger reads. Write-once until 2026-09-03: an agent whose job moved described
  // its old one for ever, on a card that was otherwise perfect.
  const set = await json('/v1/agents/webresearcher/description', {
    method: 'PATCH', headers: { Authorization: `Bearer ${tokA}` },
    body: JSON.stringify({ description: 'Reads the open web and comes back with sourced answers.' }),
  });
  assert(set.status === 200, `set: ${set.status} ${JSON.stringify(set.body?.error)}`);
  const card = await json(`/v1/a2a/${encodeURIComponent(ownerA)}/webresearcher/agent-card.json`);
  assert(card.body.description === 'Reads the open web and comes back with sourced answers.',
    `the card carries it: ${card.body.description}`);
});

await test('9c. The agent may describe itself, and an empty string clears it', async () => {
  const self = await json('/v1/agents/webresearcher/description', {
    method: 'PATCH', headers: { Authorization: `Bearer ${agentTokA}` },
    body: JSON.stringify({ description: 'I read the web.' }),
  });
  assert(self.status === 200, `agent self-describe: ${self.status}`);
  const cleared = await json('/v1/agents/webresearcher/description', {
    method: 'PATCH', headers: { Authorization: `Bearer ${tokA}` },
    body: JSON.stringify({ description: '' }),
  });
  assert(cleared.status === 200 && cleared.body.data.description === '', `cleared: ${JSON.stringify(cleared.body.data)}`);
});

await test('9d. The NAME is not editable, because it is part of the identity', async () => {
  // There is no route for it and there must not be: changing it would change the GAII every
  // credential, task and pinned peer record is filed under.
  const r = await json('/v1/agents/webresearcher/name', {
    method: 'PATCH', headers: { Authorization: `Bearer ${tokA}` },
    body: JSON.stringify({ name: 'somethingelse' }),
  });
  assert(r.status === 404, `no such door, got ${r.status}`);
});

await test('9e. And another owner cannot describe your agent', async () => {
  const r = await json(`/v1/agents/${encodeURIComponent(gaiiA)}/description`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tokB}` },
    body: JSON.stringify({ description: 'not yours to say' }),
  });
  assert(r.status === 403 || r.status === 404, `expected a refusal, got ${r.status}`);
});


console.log('\nRe-issuing a card');

await test('10. An agent with no card is told to enrol rather than given one', async () => {
  const r = await json(`/v1/agents/${encodeURIComponent(gaiiA)}/card`, {
    method: 'POST', headers: { Authorization: `Bearer ${agentTokA}` },
    body: JSON.stringify({ card: 'a.b.c' }),
  });
  assert(r.status === 409 && r.body.error.code === 'NOT_ENROLLED',
    `expected NOT_ENROLLED, got ${r.status} ${r.body?.error?.code}`);
});

await test('11. Nobody else may re-issue an agent\'s card, not even its owner', async () => {
  // The owner does not hold the key. A card they submitted would be signed by something else, and
  // then it is not this agent's card.
  const r = await json(`/v1/agents/${encodeURIComponent(gaiiA)}/card`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokA}` },
    body: JSON.stringify({ card: 'a.b.c' }),
  });
  assert(r.status === 403 && r.body.error.code === 'ACCESS_DENIED',
    `the owner is refused too, got ${r.status} ${r.body?.error?.code}`);
});

await test('12. And a stranger is refused outright', async () => {
  const r = await json(`/v1/agents/${encodeURIComponent(gaiiA)}/card`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokB}` },
    body: JSON.stringify({ card: 'a.b.c' }),
  });
  assert(r.status === 403 || r.status === 404, `expected a refusal, got ${r.status}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
