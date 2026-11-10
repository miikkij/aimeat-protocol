/**
 * @file e2e-memory-tab-summary.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Memory page without every key: GET /v1/memory/tab?summary=true says what the cover
 *   shows (the key spaces with their counts, sizes and newest key, the newest changes, the stale keys,
 *   the public and members counts) and nothing else, and it says the same as the full answer it
 *   replaces; GET /v1/memory?include=meta takes sort and offset, and walking the pages of a key space
 *   returns every key of it once. Without the new parameters both answers are what they were; a
 *   caller without a token is refused, and one owner's summary holds nothing of another's.
 *   At a heavy account's size the full answer was 6.4 MB on every mount (performance work 2026-11).
 * @version-history
 *   v1.1.0 — 2026-11-10 — Files a page at a time: files_limit and files_exclude_prefix on the mount,
 *     limit, offset and exclude_prefix on GET /v1/memory/files, paging reaches every file once.
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
const A = { name: `mtsowner${stamp}`, token: '' };
const B = { name: `mtsother${stamp}`, token: '' };
const password = 'MemoryTab123!';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const SPACE = `mts${stamp}`;
const at = (m: any) => m.updated_at || m.created_at || '';
const spaceOf = (k: string) => (k.startsWith('organism.') ? 'organism.' + (k.split('.')[1] || '') : k.indexOf('.') < 0 ? '_other' : k.slice(0, k.indexOf('.')));
const hourAgo = new Date(Date.now() - 3600_000).toISOString();

console.log(`\n=== Memory tab summary E2E ===\n`);
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

await test('The owner writes five keys in one key space (one public, one for members) and one key without a dot', async () => {
  const writes: Array<[string, unknown, string]> = [
    [`${SPACE}.alpha`, { n: 1 }, 'private'],
    [`${SPACE}.bravo`, { text: 'x'.repeat(400) }, 'public'],
    [`${SPACE}.charlie`, { n: 3 }, 'members'],
    [`${SPACE}.delta`, { n: 4, more: 'y'.repeat(50) }, 'private'],
    [`${SPACE}.echo`, { n: 5 }, 'private'],
    [`nodot${stamp}`, { n: 6 }, 'private'],
  ];
  for (const [key, value, visibility] of writes) {
    const r = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key, value, visibility }) });
    assert(r.status === 200 || r.status === 201, `write ${key}: ${r.status} ${JSON.stringify(r.body.error)}`);
  }
});

await test('GET /v1/memory/tab?summary=true sends no rows and says what the full answer gives', async () => {
  const full = await json('/v1/memory/tab', { headers: auth(A.token) });
  assert(full.status === 200, `full ${full.status}`);
  const sum = await json(`/v1/memory/tab?summary=true&today_from=${encodeURIComponent(hourAgo)}`, { headers: auth(A.token) });
  assert(sum.status === 200, `summary ${sum.status}: ${JSON.stringify(sum.body.error)}`);
  const items: any[] = full.body.data.memory.items;
  const m = sum.body.data.memory;
  const s = m.summary;
  assert(Array.isArray(m.items) && m.items.length === 0, `no rows in the summary answer, got ${m.items.length}`);
  assert(m.total === full.body.data.memory.total && m.total === items.length, `total ${m.total} vs ${items.length}`);
  assert(JSON.stringify(m.quota) === JSON.stringify(full.body.data.memory.quota), 'the same quota');
  assert(!full.body.data.memory.summary, 'the full answer carries no summary (the old answer)');
  const spaces = new Map<string, any>();
  for (const it of items) {
    const id = spaceOf(it.key);
    const x = spaces.get(id) ?? { count: 0, bytes: 0, pub: 0, mem: 0, latest: '' };
    x.count++; x.bytes += it.bytes || 0;
    if (it.visibility === 'public') x.pub++;
    if (it.visibility === 'members') x.mem++;
    if (at(it) > x.latest) x.latest = at(it);
    spaces.set(id, x);
  }
  assert(s.spaces.length === spaces.size, `spaces ${s.spaces.length} vs ${spaces.size}`);
  for (const x of s.spaces) {
    const y = spaces.get(x.id);
    assert(!!y && y.count === x.count && y.bytes === x.bytes && y.pub === x.public_n && y.mem === x.members_n && y.latest === at(x.latest), `space ${x.id}: ${JSON.stringify(x).slice(0, 200)}`);
  }
  const mine = s.spaces.find((x: any) => x.id === SPACE);
  assert(mine && mine.kind === 'plain' && mine.count === 5 && mine.public_n === 1 && mine.members_n === 1, `the written space: ${JSON.stringify(mine)}`);
  assert(s.spaces.some((x: any) => x.id === '_other' && x.kind === 'other'), 'a key without a dot is in _other');
  const recent = [...items].sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0)).slice(0, 5).map(at);
  assert(JSON.stringify(s.recent.map(at)) === JSON.stringify(recent), 'the five newest changes');
  assert(s.public.count === items.filter(i => i.visibility === 'public').length && s.public.keys.includes(`${SPACE}.bravo`), `public ${JSON.stringify(s.public)}`);
  assert(s.members.count === items.filter(i => i.visibility === 'members').length, `members ${s.members.count}`);
  assert(s.changed_today === items.filter(i => at(i) >= hourAgo).length && s.changed_today >= 6, `changed since an hour ago: ${s.changed_today}`);
  assert(s.stale.count === 0 && s.stale.items.length === 0, 'nothing stale on a new account');
});

await test('A key space a page at a time: sort and offset reach every key once', async () => {
  const all = await json(`/v1/memory?include=meta&prefix=${SPACE}.`, { headers: auth(A.token) });
  assert(all.body.data.total === 5 && !('offset' in all.body.data), `the unpaged answer: ${all.body.data.total}`);
  const first = await json(`/v1/memory?include=meta&prefix=${SPACE}.&sort=key&limit=2`, { headers: auth(A.token) });
  assert(first.body.data.items.map((i: any) => i.key).join() === `${SPACE}.alpha,${SPACE}.bravo`, `first page ${JSON.stringify(first.body.data.items.map((i: any) => i.key))}`);
  assert(first.body.data.total === 5 && first.body.data.truncated === true, 'the total counts every match');
  const walked: string[] = [];
  for (let offset = 0; offset < 5; offset += 2) {
    const page = await json(`/v1/memory?include=meta&prefix=${SPACE}.&sort=key&limit=2&offset=${offset}`, { headers: auth(A.token) });
    if (offset) assert(page.body.data.offset === offset, `offset echoed: ${page.body.data.offset}`);
    walked.push(...page.body.data.items.map((i: any) => i.key));
  }
  assert(walked.join() === ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map(k => `${SPACE}.${k}`).join(), `walked ${walked.join()}`);
  const bySize = await json(`/v1/memory?include=meta&prefix=${SPACE}.&sort=size&limit=1`, { headers: auth(A.token) });
  assert(bySize.body.data.items[0].key === `${SPACE}.bravo`, `largest first: ${bySize.body.data.items[0].key}`);
  const byTime = await json(`/v1/memory?include=meta&prefix=${SPACE}.&sort=updated`, { headers: auth(A.token) });
  const times = byTime.body.data.items.map(at);
  assert(times.every((t: string, i: number) => i === 0 || times[i - 1] >= t), 'newest change first');
});

await test('Files a page at a time: the mount carries the first ones and the count of all, the listing pages the rest', async () => {
  for (const name of ['a', 'b', 'c']) {
    const f = await json('/v1/memory/files', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${SPACE}/file-${name}.txt`, content: Buffer.from(`file ${name}`).toString('base64'), mime_type: 'text/plain', visibility: 'private' }) });
    assert(f.status === 201, `upload ${name}: ${f.status} ${JSON.stringify(f.body.error ?? '')}`);
  }
  const hidden = await json('/v1/memory/files', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `contentclass-text/${SPACE}.txt`, content: Buffer.from('words').toString('base64'), mime_type: 'text/plain', visibility: 'private' }) });
  assert(hidden.status === 201, `upload the excluded one: ${hidden.status}`);
  const all = await json('/v1/memory/files', { headers: auth(A.token) });
  const every: string[] = all.body.data.files.map((f: any) => f.key);
  assert(all.body.data.total === every.length && every.includes(`contentclass-text/${SPACE}.txt`) && !('limit' in all.body.data), 'without the new parameters the answer is every file');
  const counted = await json('/v1/memory/files?count=true', { headers: auth(A.token) });
  assert(counted.body.data.count === every.length, `count=true counts the same files: ${counted.body.data.count} vs ${every.length}`);
  const countedLess = await json(`/v1/memory/files?count=true&exclude_prefix=${encodeURIComponent('contentclass-text/')}`, { headers: auth(A.token) });
  assert(countedLess.body.data.count === every.filter(k => !k.startsWith('contentclass-text/')).length, `count=true leaves the prefix out: ${countedLess.body.data.count}`);
  const wanted = every.filter(k => !k.startsWith('contentclass-text/'));
  const mount = await json(`/v1/memory/tab?summary=true&files_limit=2&files_exclude_prefix=${encodeURIComponent('contentclass-text/')}`, { headers: auth(A.token) });
  assert(mount.body.data.files.files.length === 2 && mount.body.data.files.total === wanted.length, `mount: ${mount.body.data.files.files.length} of ${mount.body.data.files.total}, want 2 of ${wanted.length}`);
  const walked: string[] = mount.body.data.files.files.map((f: any) => f.key);
  for (let offset = 2; offset < wanted.length; offset += 2) {
    const page = await json(`/v1/memory/files?limit=2&offset=${offset}&exclude_prefix=${encodeURIComponent('contentclass-text/')}`, { headers: auth(A.token) });
    assert(page.body.data.offset === offset && page.body.data.total === wanted.length, `page at ${offset}: ${JSON.stringify(page.body.data).slice(0, 200)}`);
    walked.push(...page.body.data.files.map((f: any) => f.key));
  }
  assert(walked.join() === wanted.join(), `paging reaches every file once, in order: ${walked.join()} vs ${wanted.join()}`);
  const other = await json(`/v1/memory/files?limit=50&exclude_prefix=${encodeURIComponent('contentclass-text/')}`, { headers: auth(B.token) });
  assert(!other.body.data.files.some((f: any) => String(f.key).startsWith(`${SPACE}/`)), "another owner's page holds none of the owner's files");
});

await test('An unreadable today_from counts nothing as changed today, and the summary refuses without a token', async () => {
  const r = await json('/v1/memory/tab?summary=true&today_from=yesterday', { headers: auth(A.token) });
  assert(r.status === 200 && r.body.data.memory.summary.changed_today === 0, `changed_today ${r.body.data?.memory?.summary?.changed_today}`);
  const anon = await json('/v1/memory/tab?summary=true');
  assert(anon.status === 401, `without a token: ${anon.status}`);
});

await test("Another owner's summary holds none of the owner's keys", async () => {
  const r = await json('/v1/memory/tab?summary=true', { headers: auth(B.token) });
  assert(r.status === 200, `other summary ${r.status}`);
  const s = r.body.data.memory.summary;
  assert(!s.spaces.some((x: any) => x.id === SPACE), "the owner's key space is not in the other owner's summary");
  assert(!s.public.keys.includes(`${SPACE}.bravo`), "the owner's public key is not counted as the other's");
  const page = await json(`/v1/memory?include=meta&prefix=${SPACE}.&sort=key&limit=10`, { headers: auth(B.token) });
  assert(page.body.data.total === 0, `the other owner pages nothing of it: ${page.body.data.total}`);
  const asOwner = await json(`/v1/memory?include=meta&prefix=${SPACE}.&sort=key&limit=10&agent=${encodeURIComponent(`${A.name}@${NODE_ID}`)}`, { headers: auth(B.token) });
  assert(asOwner.status === 403, `the other owner naming the owner as the identity to page is refused: ${asOwner.status}`);
});

await test('Clean up: the written keys are deleted', async () => {
  for (const key of ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map(k => `${SPACE}.${k}`).concat(`nodot${stamp}`)) {
    const r = await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(r.status === 200 || r.status === 204, `delete ${key}: ${r.status}`);
  }
  for (const key of ['a', 'b', 'c'].map(n => `${SPACE}/file-${n}.txt`).concat(`contentclass-text/${SPACE}.txt`)) {
    const r = await json(`/v1/memory/files/${encodeURIComponent(key)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(r.status === 200 || r.status === 204, `delete file ${key}: ${r.status}`);
  }
});

console.log(`\n=== Memory tab summary: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
