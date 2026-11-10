/**
 * @file test/e2e-live-catchup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A page whose live stream was cut reloads only what changed while it was away. Each
 *   stream opens with `event: hello` carrying the journal's position (`at`); reopened with
 *   `since=<position>`, it sends one `event: catchup` frame with the domains that changed after it,
 *   through the same owner and scope tests a live frame passes: another owner's change is not in it.
 *   A position the node cannot answer for gives `domains: null`, which makes the page reload
 *   everything, as every reopen did before (performance work 2026-11, architecture item 6).
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial.
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
  return { status: res.status, body };
}

const stamp = Date.now();
const A = { name: `lcowner${stamp}`, token: '' };
const B = { name: `lcother${stamp}`, token: '' };
const password = 'LiveCatchup123!';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Open a stream for `token` (with `since` when given), read until `until` names a frame or `ms`
 * passes, and close it. Returns the frames as { event, data } with data parsed.
 */
async function openStream(token: string, since: string | null, until: (f: { event: string; data: any }) => boolean, ms = 4000) {
  const t = await json('/v1/events/ticket', { method: 'POST', headers: auth(token) });
  assert(t.status === 200, `ticket ${t.status}`);
  const ac = new AbortController();
  const res = await fetch(`${BASE}/v1/events?ticket=${encodeURIComponent(t.body.data.ticket)}${since ? `&since=${encodeURIComponent(since)}` : ''}`, { signal: ac.signal });
  assert(res.status === 200, `stream ${res.status}`);
  const frames: Array<{ event: string; data: any }> = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      let hit = false;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!block.trim() || block.startsWith(':') || block.startsWith('retry:')) continue;
        const event = (block.match(/^event: (.*)$/m)?.[1] ?? 'message').trim();
        const raw = block.match(/^data: (.*)$/m)?.[1] ?? '';
        let data: any = raw;
        try { data = JSON.parse(raw); } catch { /* not JSON */ }
        const f = { event, data };
        frames.push(f);
        if (until(f)) hit = true;
      }
      if (hit) break;
    }
  } catch { /* aborted at the end of the window */ }
  clearTimeout(timer);
  ac.abort();
  return frames;
}

const helloAt = (frames: Array<{ event: string; data: any }>) => frames.find(f => f.event === 'hello')?.data?.at as string | undefined;
const catchupOf = (frames: Array<{ event: string; data: any }>) => frames.find(f => f.event === 'catchup')?.data;

console.log(`\n=== Live catch-up E2E ===\n`);
console.log(`Server: ${BASE}`);

await test('Two owners register and log in', async () => {
  for (const who of [A, B]) {
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: who.name, display_name: who.name, password }) });
    assert(reg.body.ok === true, `registration failed: ${JSON.stringify(reg.body.error)}`);
    const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: who.name, password }) });
    who.token = login.body.data?.token;
    assert(typeof who.token === 'string' && who.token.length > 0, 'missing token');
  }
});

let at = '';

await test('A stream opens with hello carrying the position, and without since it sends no catch-up', async () => {
  const frames = await openStream(A.token, null, f => f.event === 'hello', 3000);
  at = helloAt(frames) ?? '';
  assert(/^[^.]+\.\d+$/.test(at), `hello.at ${JSON.stringify(frames.map(f => f.event))} ${at}`);
  assert(!catchupOf(frames), 'no catch-up without since');
});

await test("Another owner's change while the stream is away is not in the catch-up", async () => {
  const w = await json('/v1/memory', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ key: `lc.other.${stamp}`, value: 1, visibility: 'private' }) });
  assert(w.status === 201, `B write ${w.status}`);
  await sleep(300);
  const frames = await openStream(A.token, at, f => f.event === 'catchup');
  const c = catchupOf(frames);
  assert(c && Array.isArray(c.domains) && !c.domains.includes('memory'), `catch-up after another owner's write: ${JSON.stringify(c)}`);
});

await test('The owner\'s own change while away comes back as its domain', async () => {
  const w = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `lc.mine.${stamp}`, value: 1, visibility: 'private' }) });
  assert(w.status === 201, `A write ${w.status}`);
  await sleep(300);
  const frames = await openStream(A.token, at, f => f.event === 'catchup');
  const c = catchupOf(frames);
  assert(c && Array.isArray(c.domains) && c.domains.includes('memory'), `catch-up after the owner's write: ${JSON.stringify(c)}`);
});

await test('A position the node cannot answer for says reload everything (domains null)', async () => {
  for (const since of ['someotherboot.5', `${at.split('.')[0]}.999999999`, 'garbage']) {
    const frames = await openStream(A.token, since, f => f.event === 'catchup');
    const c = catchupOf(frames);
    assert(c && c.domains === null, `since=${since}: ${JSON.stringify(c)}`);
  }
});

await test("Another owner cannot read the owner's private key (403)", async () => {
  const r = await json(`/v1/memory/${encodeURIComponent(`${A.name}@${NODE_ID}`)}/${encodeURIComponent(`lc.mine.${stamp}`)}`, { headers: auth(B.token) });
  assert(r.status === 403, `refused: ${r.status}`);
});

await test('Clean up', async () => {
  const a = await json(`/v1/memory/${encodeURIComponent(`lc.mine.${stamp}`)}`, { method: 'DELETE', headers: auth(A.token) });
  const b = await json(`/v1/memory/${encodeURIComponent(`lc.other.${stamp}`)}`, { method: 'DELETE', headers: auth(B.token) });
  assert(a.status === 200 && b.status === 200, `deletes ${a.status} ${b.status}`);
});

console.log(`\n=== Live catch-up: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
