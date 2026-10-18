/**
 * @file test/e2e-provenance-embed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/provenance/embed: a person stores an exported page, names the provenance
 *   record its picture was made from, and gets a marked copy beside it that carries the IPTC digital
 *   source type and the record's address, with the original left as it was. Another person's private
 *   record, a missing file, a file of an unknown type and a caller without storage:write are refused,
 *   and nothing is written.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=provenance-embed
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-8).
 */
import { deflateSync, crc32 } from 'node:zlib';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
const PAGE = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, 9, 9, 9, 255]))), chunk('IEND', Buffer.alloc(0))]);

console.log('\n=== AI provenance written into exported files (Comicland v3 A-8) ===\n');
const stamp = Date.now().toString(36);
const alice = await registerOwner(BASE, `embalice${stamp}`);
const bob = await registerOwner(BASE, `embbob${stamp}`);

const store = (token: string, key: string, data: Buffer, mime: string) =>
  json('/v1/storage', { method: 'POST', headers: auth(token), body: JSON.stringify({ key, data: data.toString('base64'), mime_type: mime, visibility: 'private' }) });
const declare = async (token: string, content: Buffer) => {
  const r = await json('/v1/provenance', { method: 'POST', headers: auth(token), body: JSON.stringify({
    level: 'ai-generated', humanInvolvement: 'light-review', mediaKind: 'image', mediaType: 'image/png',
    content: content.toString('base64'), generator: { model: 'google/gemini-2.5-flash-image' },
  }) });
  assert(r.status === 201, `declare ${r.status}: ${JSON.stringify(r.body?.error)}`);
  return r.body.data.id as string;
};
const embed = (token: string, body: Record<string, unknown>) =>
  json('/v1/provenance/embed', { method: 'POST', headers: auth(token), body: JSON.stringify(body) });

let aliceRecord = '';
let bobRecord = '';
await test('Setup: a stored page and its picture\'s record for each person', async () => {
  assert((await store(alice.token, 'comic/ep3/001.png', PAGE, 'image/png')).status === 201, 'alice page');
  assert((await store(alice.token, 'comic/ep3/notes.txt', Buffer.from('lettering notes'), 'text/plain')).status === 201, 'alice notes');
  aliceRecord = await declare(alice.token, PAGE);
  bobRecord = await declare(bob.token, Buffer.from('bob picture'));
});

await test('The marked copy carries the digital source type and the record address; the original is unchanged', async () => {
  const r = await embed(alice.token, { storage_key: 'comic/ep3/001.png', provenance_ids: [aliceRecord] });
  assert(r.status === 200, `${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.storage_key === 'comic/ep3/001.marked.png' && r.body.data.format === 'png' && r.body.data.records === 1, `answer ${JSON.stringify(r.body.data)}`);
  assert(/trainedAlgorithmicMedia$/.test(r.body.data.digital_source_type), `one AI picture: ${r.body.data.digital_source_type}`);
  const marked = Buffer.from(await (await fetch(`${BASE}/v1/storage/comic/ep3/001.marked.png`, { headers: auth(alice.token) })).arrayBuffer());
  const text = marked.toString('utf8');
  assert(text.includes('Iptc4xmpExt:DigitalSourceType') && text.includes(`/v1/provenance/${aliceRecord}`), 'the XMP packet with the record address is inside the file');
  const original = Buffer.from(await (await fetch(`${BASE}/v1/storage/comic/ep3/001.png`, { headers: auth(alice.token) })).arrayBuffer());
  assert(original.equals(PAGE), 'the original is left as it was');
});

await test('A page combined from several records says composite, and an output key is honoured', async () => {
  const second = await declare(alice.token, Buffer.from('second picture'));
  const r = await embed(alice.token, { storage_key: 'comic/ep3/001.png', provenance_ids: [aliceRecord, second], output_key: 'exports/ep3-page1.png' });
  assert(r.status === 200 && r.body.data.storage_key === 'exports/ep3-page1.png', `${r.status}: ${JSON.stringify(r.body)}`);
  assert(/compositeWithTrainedAlgorithmicMedia$/.test(r.body.data.digital_source_type), r.body.data.digital_source_type);
});

await test('Another person\'s private record is refused, and nothing is written', async () => {
  const r = await embed(alice.token, { storage_key: 'comic/ep3/001.png', provenance_ids: [bobRecord], output_key: 'exports/should-not-exist.png' });
  assert(r.status === 404 && r.body.error?.code === 'NOT_FOUND', `${r.status}: ${JSON.stringify(r.body?.error)}`);
  const none = await fetch(`${BASE}/v1/storage/exports/should-not-exist.png`, { headers: auth(alice.token) });
  assert(none.status === 404, `no file was written: ${none.status}`);
});

await test('Another person cannot mark a file that is not in their storage', async () => {
  const r = await embed(bob.token, { storage_key: 'comic/ep3/001.png', provenance_ids: [bobRecord] });
  assert(r.status === 404, `${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('A file of an unknown type is 415, and a body without records is 400', async () => {
  const t = await embed(alice.token, { storage_key: 'comic/ep3/notes.txt', provenance_ids: [aliceRecord] });
  assert(t.status === 415 && t.body.error?.code === 'UNSUPPORTED_FORMAT', `${t.status}: ${JSON.stringify(t.body?.error)}`);
  const b = await embed(alice.token, { storage_key: 'comic/ep3/001.png', provenance_ids: [] });
  assert(b.status === 400, `${b.status}`);
});

await test('An agent without storage:write is refused', async () => {
  const agent = await makeAgent(BASE, alice, ['memory:read']);
  const r = await embed(agent.token, { storage_key: 'comic/ep3/001.png', provenance_ids: [aliceRecord] });
  assert(r.status === 403, `${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('Over MCP: an agent with storage:write marks a file of its own with its owner\'s record, and reads its owner\'s adult status', async () => {
  const agent = await makeAgent(BASE, alice, ['storage:write', 'storage:read', 'memory:read']);
  assert((await store(agent.token, 'agent/page.png', PAGE, 'image/png')).status === 201, 'agent page');
  const s = await openSession(BASE, agent.token, 'embed-agent');
  const r = await callTool(s, 'aimeat_provenance_embed', { storage_key: 'agent/page.png', provenance_ids: [aliceRecord] });
  assert(!r.isError && r.data.storage_key === 'agent/page.marked.png' && r.data.format === 'png', `embed: ${r.text.slice(0, 300)}`);
  const refused = await callTool(s, 'aimeat_provenance_embed', { storage_key: 'agent/page.png', provenance_ids: [bobRecord] });
  assert(refused.isError && /NOT_FOUND/.test(refused.text), `another person's record: ${refused.text.slice(0, 200)}`);
  const adult = await callTool(s, 'aimeat_adult_status', {});
  assert(!adult.isError && adult.data.verified === false && adult.data.method === null, `adult: ${adult.text.slice(0, 200)}`);
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
