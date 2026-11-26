/**
 * @file test/e2e-owner-export-job.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the data export as a background job (routes/owners/exports.ts,
 *   services/owner-export/):
 *   - the plan names the parts with their sizes on the account;
 *   - two starts at the same moment: one is queued, the other is refused 409 EXPORT_RUNNING;
 *   - the export becomes ready, and its ZIP holds account.json, the memory record as an NDJSON line,
 *     the file's own bytes and manifest.json; a Range request answers 206 with those bytes;
 *   - an agent may plan, start and read the state, and never gets a download link; an agent with read
 *     access only may not start one; another owner and a caller with no credential are refused;
 *   - a link that is not the node's is refused, and a removed export's link answers 404;
 *   - the JSON export still answers, with the same record in it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=owner-export-job
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-owner-data-export-as-a-chosen-parts-background-job).
 */
import yauzl from 'yauzl';
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';
import { connectAgentByDevice } from './helpers/agent-device.js';
import { openSession, callTool } from './helpers/mcp-session.js';

/** A link the node gave, on the node under test (the link carries the node's base URL). */
const onNode = (url: string): string => `${BASE}${new URL(url).pathname}`;

/** Every entry of a ZIP as name → bytes. */
function unzip(buf: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) { reject(err ?? new Error('no zip')); return; }
      const out = new Map<string, Buffer>();
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (e, s) => {
          if (e || !s) { reject(e ?? new Error('no stream')); return; }
          const parts: Buffer[] = [];
          s.on('data', (c: Buffer) => parts.push(c));
          s.on('end', () => { out.set(entry.fileName, Buffer.concat(parts)); zip.readEntry(); });
        });
      });
      zip.on('end', () => resolve(out));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

(async () => {
  console.log('\n── The data export as a background job: chosen parts, ZIP files, links for the person only ──');
  const alice = await registerOwner(BASE, `expj${Date.now()}`);
  const auth = { Authorization: `Bearer ${alice.token}` };
  const at = `/v1/owners/${alice.name}/exports`;
  const FILE_KEY = `docs/export-proof-${Date.now()}.txt`;
  const FILE_BYTES = 'the bytes of the person\'s own file, exported whole';
  const MEMORY_KEY = `notes.export-proof-${Date.now()}`;

  const waitReady = async (headers: Record<string, string>) => {
    for (let i = 0; i < 120; i++) {
      const c = await json(`${at}/current`, { headers });
      const st = c.body?.data?.export?.state;
      if (st && st !== 'queued' && st !== 'running') return c.body.data.export;
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('the export did not finish in 30 seconds');
  };

  await test('setup: a memory record and a file of the person', async () => {
    const m = await json('/v1/memory', { method: 'POST', headers: auth, body: JSON.stringify({ key: MEMORY_KEY, value: { said: 'export me' }, visibility: 'private' }) });
    assert(m.status === 201, `memory: ${m.status} ${JSON.stringify(m.body?.error)}`);
    const f = await json('/v1/storage', { method: 'POST', headers: auth, body: JSON.stringify({ key: FILE_KEY, data: Buffer.from(FILE_BYTES).toString('base64'), mime_type: 'text/plain', visibility: 'private' }) });
    assert(f.status === 201, `file: ${f.status} ${JSON.stringify(f.body?.error)}`);
  });

  await test('the plan names the parts with their sizes on this account', async () => {
    const p = await json(`${at}/plan`, { headers: auth });
    assert(p.status === 200, `plan: ${p.status} ${JSON.stringify(p.body?.error)}`);
    const parts = Object.fromEntries((p.body.data.parts as any[]).map(x => [x.id, x]));
    assert(parts.memories.count >= 1 && parts.memories.bytes > 0, `memories: ${JSON.stringify(parts.memories)}`);
    // A new account may hold a file of its own already (its welcome page), so the proof file is one of them.
    assert(parts.files.count >= 1 && parts.files.bytes >= FILE_BYTES.length, `files: ${JSON.stringify(parts.files)}`);
    assert(parts.files_own_store.default === false && parts.memories.default === true, 'the own store is out by default');
    assert(p.body.data.current === null, 'no export yet');
  });

  let first: any;
  await test('two starts at the same moment: one is queued, the other is refused 409 EXPORT_RUNNING', async () => {
    const body = JSON.stringify({ parts: ['memories', 'files'] });
    const [a, b] = await Promise.all([
      json(at, { method: 'POST', headers: auth, body }),
      json(at, { method: 'POST', headers: auth, body }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert(statuses[0] === 202 && statuses[1] === 409, `one start and one refusal: ${a.status} ${b.status}`);
    const refused = a.status === 409 ? a : b;
    expectRefusal(refused, 409, 'EXPORT_RUNNING');
    first = (a.status === 202 ? a : b).body.data.export;
    assert(first.state === 'queued' && first.parts.join() === 'memories,files', `queued: ${JSON.stringify(first)}`);
  });

  let ready: any;
  await test('the export becomes ready, and its ZIP holds the account, the record, the file and the manifest', async () => {
    ready = await waitReady(auth);
    assert(ready.state === 'ready' && ready.id === first.id, `ready: ${JSON.stringify(ready)}`);
    assert(ready.files.length === 1 && typeof ready.files[0].url === 'string', `one file with a link: ${JSON.stringify(ready.files)}`);
    const res = await fetch(onNode(ready.files[0].url));
    assert(res.status === 200 && res.headers.get('content-type')?.includes('zip'), `download: ${res.status} ${res.headers.get('content-type')} ${res.status === 200 ? '' : await res.text()}`);
    assert(res.headers.get('x-accel-buffering') === 'no', 'a buffering proxy is told to pass it on');
    const buf = Buffer.from(await res.arrayBuffer());
    assert(buf.length === ready.files[0].bytes, `size: ${buf.length} vs ${ready.files[0].bytes}`);
    const entries = await unzip(buf);
    const names = [...entries.keys()];
    const account = JSON.parse(entries.get('account.json')!.toString('utf8'));
    assert(account.owner?.name === alice.name && !('memories' in account) && !('ai_provenance' in account), `account.json: ${Object.keys(account).join(',')}`);
    const lines = names.filter(n => n.startsWith('memories/you-')).flatMap(n => entries.get(n)!.toString('utf8').trim().split('\n')).map(l => JSON.parse(l));
    assert(lines.some(l => l.key === MEMORY_KEY && l.value?.said === 'export me'), `the record is a line: ${names.join(',')}`);
    const file = entries.get(`files/you/${FILE_KEY}`);
    assert(file?.toString('utf8') === FILE_BYTES, `the file's own bytes: ${names.join(',')}`);
    const manifest = JSON.parse(entries.get('manifest.json')!.toString('utf8'));
    assert(manifest.parts.join() === 'memories,files' && manifest.written.files >= 1, `manifest: ${JSON.stringify(manifest)}`);
    assert(!names.some(n => n.startsWith('ai-provenance/') || n.startsWith('apps/')), 'parts not chosen are not in it');
  });

  await test('a Range request answers 206 with those bytes, so a broken download resumes', async () => {
    const res = await fetch(onNode(ready.files[0].url), { headers: { Range: 'bytes=0-3' } });
    const bytes = Buffer.from(await res.arrayBuffer());
    assert(res.status === 206 && bytes.length === 4 && bytes.readUInt32LE(0) === 0x04034b50, `range: ${res.status} ${bytes.toString('hex')}`);
  });

  await test('an agent plans, starts and reads the state over MCP, and never gets a link', async () => {
    const bot = await connectAgentByDevice(BASE, { owner: alice.name, ownerToken: alice.token, name: 'exportbot', scopes: ['memory:read', 'memory:write'] });
    const session = await openSession(BASE, bot.token, 'owner-export');
    const plan = await callTool(session, 'aimeat_account_export', { action: 'plan' });
    assert(!plan.isError && JSON.parse(plan.text).parts.length === 5, `plan: ${plan.text.slice(0, 200)}`);
    const st = await callTool(session, 'aimeat_account_export', { action: 'status' });
    const view = JSON.parse(st.text).export;
    assert(!st.isError && view.state === 'ready' && view.files.length === 1 && !('url' in view.files[0]), `no link for an agent: ${st.text.slice(0, 300)}`);
    const started = await callTool(session, 'aimeat_account_export', { action: 'start', parts: ['memories'] });
    assert(!started.isError && JSON.parse(started.text).export.state === 'queued', `start: ${started.text.slice(0, 200)}`);
    const done = await waitReady({ Authorization: `Bearer ${bot.token}` });
    assert(done.state === 'ready' && done.files.every((f: any) => !('url' in f)), `the agent reads ready, still without links: ${JSON.stringify(done)}`);
  });

  await test('the earlier export\'s link stops working once a new export replaced it', async () => {
    const res = await fetch(onNode(ready.files[0].url));
    assert(res.status === 404, `the replaced export: ${res.status}`);
  });

  await test('an agent with read access only may read the plan but not start an export', async () => {
    const reader = await connectAgentByDevice(BASE, { owner: alice.name, ownerToken: alice.token, name: 'exportreader', scopes: ['memory:read'] });
    const h = { Authorization: `Bearer ${reader.token}` };
    assert((await json(`${at}/plan`, { headers: h })).status === 200, 'the plan reads');
    const r = await json(`/v1/owners/${alice.name}/exports`, { method: 'POST', headers: h, body: '{}' });
    assert(r.status === 403, `refused without memory:write: ${r.status} ${JSON.stringify(r.body?.error)}`);
  });

  await test('another owner and a caller with no credential are refused', async () => {
    const bob = await registerOwner(BASE, `expjb${Date.now()}`);
    const hb = { Authorization: `Bearer ${bob.token}` };
    expectRefusal(await json(`/v1/owners/${alice.name}/exports/plan`, { headers: hb }), 403, 'ACCESS_DENIED');
    expectRefusal(await json(`/v1/owners/${alice.name}/exports/current`, { headers: hb }), 403, 'ACCESS_DENIED');
    expectRefusal(await json(`/v1/owners/${alice.name}/exports`, { method: 'POST', headers: hb, body: '{}' }), 403, 'ACCESS_DENIED');
    expectRefusal(await json(`/v1/owners/${alice.name}/exports/current`, { method: 'DELETE', headers: hb }), 403, 'ACCESS_DENIED');
    assert((await json(`/v1/owners/${alice.name}/exports/plan`)).status === 401, 'no credential');
  });

  await test('a link the node did not sign is refused', async () => {
    const r = await json('/v1/exports/download/not-a-token');
    assert(r.status === 401 && r.body?.error?.code === 'TOKEN_INVALID', `forged: ${r.status} ${JSON.stringify(r.body?.error)}`);
  });

  await test('the owner removes the finished export: its link answers 404, a second remove says there is none', async () => {
    const cur = (await json(`${at}/current`, { headers: auth })).body.data.export;
    assert(cur.state === 'ready' && cur.files[0].url, `ready with a link: ${JSON.stringify(cur)}`);
    const del = await json(`${at}/current`, { method: 'DELETE', headers: auth });
    assert(del.status === 200 && del.body.data.export.was === 'ready', `remove: ${del.status} ${JSON.stringify(del.body?.data ?? del.body?.error)}`);
    expectRefusal(await json(new URL(cur.files[0].url).pathname), 404, 'NOT_FOUND');
    expectRefusal(await json(`${at}/current`, { method: 'DELETE', headers: auth }), 404, 'NO_EXPORT');
  });

  await test('the JSON export still answers, with the record in it', async () => {
    const e = await json(`/v1/owners/${alice.name}/export`, { headers: auth });
    assert(e.status === 200 && e.body.ok === true, `export: ${e.status}`);
    assert((e.body.data.memories as any[]).some(m => m.key === MEMORY_KEY), 'the record is in the JSON export');
    assert(Array.isArray(e.body.data.ai_provenance) && Array.isArray(e.body.data.agents), 'the lists are arrays');
  });
  finish();
})();
