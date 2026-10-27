/**
 * @file e2e-portfolio-memory-gate.ts
 * @description The welcome page's switch written through a memory door asks the publish gate as
 *   PUT /v1/portfolio/config does (secaudit2026oct26,
 *   services/portfolio-config.ts:portfolio.config:unreserved-key-bypasses-publish-gate). With the node's
 *   gate on, an agent without publish:public that writes `portfolio.config` with `enabled: true`
 *   through POST /v1/memory, PATCH /v1/memory/:key or POST /v1/memory/bulk gets 202 with the same
 *   one-press request, and the page is not served until the owner allows it. The owner in person, an
 *   agent holding publish:public, and every caller with the gate off write it at once, as before.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=portfolio-memory-gate
 * @version-history
 *   2026-10-27 -- Initial (secaudit2026oct26).
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<{ status: number; body: Body }> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}
const html = (s: string) => `<!DOCTYPE html><html><head><title>${s}</title></head><body><p>${s}</p></body></html>`;

let op!: Awaited<ReturnType<typeof registerOwner>>;
let A!: Awaited<ReturnType<typeof registerOwner>>;
let asker!: Awaited<ReturnType<typeof makeAgent>>;
let publisher!: Awaited<ReturnType<typeof makeAgent>>;
const SCOPES = ['memory:read', 'memory:write', 'storage:write'];
const setGate = (value: string) => call('/v1/admin/config', { token: op.token, method: 'PUT', body: { changes: [{ path: 'visibility.publish_gate', value }] } });
const anonPortfolio = async () => (await call(`/v1/portfolio/data/${encodeURIComponent(A.name)}`)).status;
const writeSwitch = (token: string, value: Body) => call('/v1/memory', { token, body: { key: 'portfolio.config', value, visibility: 'owner' } });
let firstRequest = '';

console.log('\n=== AIMEAT: the welcome page switch through a memory door ===\n');

await test('Setup: an operator, owner A with a stored page that is off, and two agents of A', async () => {
  op = await registerOwner(BASE, `pmgop${stamp}`);
  A = await registerOwner(BASE, `pmga${stamp}`);
  asker = await makeAgent(BASE, A, SCOPES, `pmgask${stamp.toString(36).slice(-5)}`);
  publisher = await makeAgent(BASE, A, [...SCOPES, 'publish:public'], `pmgpub${stamp.toString(36).slice(-5)}`);
  const up = await call('/v1/portfolio/upload', { token: A.token, method: 'PUT', body: { html: html(`page ${stamp}`) } });
  assert(up.status === 200, `upload: ${up.status} ${JSON.stringify(up.body.error)}`);
  assert(await anonPortfolio() === 404, 'the stored page is off');
  const g = await setGate('agents');
  assert(g.status === 200, `gate: ${g.status} ${JSON.stringify(g.body.error)}`);
});

await test('Usage, gate on: the owner in person switches the page on and off through the memory door at once', async () => {
  const on = await writeSwitch(A.token, { enabled: true });
  assert(on.status === 201 && !on.body.data.publish_request, `owner on: ${on.status} ${JSON.stringify(on.body.error ?? on.body.data?.publish_request)}`);
  assert(await anonPortfolio() === 200, 'served at once');
  const off = await writeSwitch(A.token, { enabled: false });
  assert(off.status === 200, `owner off: ${off.status}`);
  assert(await anonPortfolio() === 404, 'off at once');
});

await test('An agent without publish:public: POST /v1/memory portfolio.config enabled asks the owner, and the page stays off', async () => {
  const w = await writeSwitch(asker.token, { enabled: true, title: `T ${stamp}` });
  assert(w.status === 202 && w.body.data.publish_request?.kind === 'portfolio', `write: ${w.status} ${JSON.stringify(w.body.error ?? w.body.data)}`);
  firstRequest = w.body.data.publish_request.request_id;
  assert(await anonPortfolio() === 404, 'the page is not served');
  const stored = await call(`/v1/memory/portfolio.config?agent=${encodeURIComponent(asker.gaii)}`, { token: A.token });
  assert(stored.status === 200 && stored.body.data.value.title === `T ${stamp}` && stored.body.data.value.enabled === undefined, `the rest is stored: ${JSON.stringify(stored.body.data?.value)}`);
});

await test('The same through PATCH /v1/memory/:key and POST /v1/memory/bulk: 202 with the request, and the page stays off', async () => {
  const p = await call('/v1/memory/portfolio.config', { token: asker.token, method: 'PATCH', body: { patch: { enabled: true } } });
  assert(p.status === 202 && p.body.data.publish_request?.kind === 'portfolio', `patch: ${p.status} ${JSON.stringify(p.body.error ?? p.body.data)}`);
  assert(await anonPortfolio() === 404, 'not served after the patch');
  const b = await call('/v1/memory/bulk', { token: asker.token, body: { entries: [{ key: 'portfolio.config', value: { enabled: true }, visibility: 'owner' }] } });
  assert(b.status === 202 && (b.body.data.publish_requests ?? []).some((r: Body) => r.kind === 'portfolio'), `bulk: ${b.status} ${JSON.stringify(b.body.error ?? b.body.data)}`);
  assert(await anonPortfolio() === 404, 'not served after the batch');
});

await test('Usage: the owner allows the request with one press and the page is served', async () => {
  const d = await call(`/v1/publish-requests/${firstRequest}/decision`, { token: A.token, method: 'POST', body: { decision: 'approve' } });
  assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
  assert(await anonPortfolio() === 200, 'served after the approval');
  const off = await call('/v1/portfolio/config', { token: A.token, method: 'PUT', body: { enabled: false } });
  assert(off.status === 200, `owner off: ${off.status}`);
  assert(await anonPortfolio() === 404, 'off again');
});

await test('Usage: an agent holding publish:public switches the page on through the memory door at once', async () => {
  const w = await writeSwitch(publisher.token, { enabled: true });
  assert(w.status === 201 && !w.body.data.publish_request, `write: ${w.status} ${JSON.stringify(w.body.error ?? w.body.data?.publish_request)}`);
  assert(await anonPortfolio() === 200, 'served at once');
});

await test('Usage, gate off (the default): the agent without publish:public writes the switch at once', async () => {
  const g = await setGate('off');
  assert(g.status === 200, `gate off: ${g.status}`);
  const w = await writeSwitch(asker.token, { enabled: true });
  assert((w.status === 200 || w.status === 201) && !w.body.data.publish_request, `write: ${w.status} ${JSON.stringify(w.body.error ?? w.body.data?.publish_request)}`);
});

await test('Another account\'s agent cannot reach A\'s switch through the memory door', async () => {
  const B = await registerOwner(BASE, `pmgb${stamp}`);
  const r = await call(`/v1/memory/portfolio.config?agent=${encodeURIComponent(asker.gaii)}`, { token: B.token });
  assert(r.status === 403 || r.status === 404, `B reads A's agent's switch: ${r.status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
