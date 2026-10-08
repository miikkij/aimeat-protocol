/**
 * @file test/e2e-storage-file-provenance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A stored file carries its AI-provenance record, end to end, on the shared runner node
 *   with a local OpenAI-compatible peer standing in for the provider (no paid call, no key).
 *
 *   THE REPORTED FLOW (omnituinen, 2026-10-08). POST /v1/ai/speak?json=1 stores the clip privately
 *   with the record the node minted for its bytes; PATCH /v1/storage/ai-speech/<uuid>.mp3/visibility
 *   makes it public in place; an anonymous GET /v1/pub then carries AI-Disclosure and Link
 *   rel="ai-provenance", and the record answers anonymously at /v1/provenance/:id and by the SHA-256
 *   of the bytes. Before this change the PATCH answered 404 (single-segment key), /v1/pub sent no
 *   marks and the record stayed 404 for everyone but its owner.
 *
 *   ATTACHING A RECORD TO AN UPLOAD, on all three doors: POST /v1/storage inline, the presigned
 *   PUT /v1/upload/:token, and the node MCP aimeat_storage_upload. Refusals: another owner's record
 *   (404 NOT_FOUND, at the mint already for presigned), a record about other bytes (400
 *   PROVENANCE_HASH_MISMATCH, inline and at the presigned PUT), a declaration without
 *   provenance:write (403 SCOPE_DENIED, nothing stored). A private file keeps its record 404.
 *   An agent's undeclared upload is stamped by the node (Mint-3); a voice call an agent makes names
 *   the agent on its record (B11). The chunked complete and POST /v1/memory/files attach the same
 *   way; a data package descriptor's record is about its exact stored bytes (B8); an agent's
 *   portfolio page carries a record any visitor resolves (B10); a public generated picture is served
 *   with its record (B3).
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-storage-file-provenance
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI provenance for stored files, workstream B).
 */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import * as ed from '@noble/ed25519';

ed.hashes.sha512 = m => new Uint8Array(createHash('sha512').update(m).digest());
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
/** One transparent pixel, all an image answer needs to be stored. */
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (error) { failed++; console.error(`  ❌ ${name}: ${String((error as Error).message ?? error)}`); }
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

interface Answer { status: number; text: string; data: any; headers: Headers }
async function call(path: string, body?: unknown, token?: string, method = 'POST', headers: Record<string, string> = {}): Promise<Answer> {
  const response = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const json = (response.headers.get('content-type') ?? '').includes('application/json');
  return { status: response.status, text, data: json ? JSON.parse(text) : null, headers: response.headers };
}
async function sign(key: string, text: string) {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(text), Buffer.from(key, 'base64'))).toString('base64');
}
async function owner(prefix: string) {
  const name = prefix + Date.now() + randomBytes(2).toString('hex');
  const registration = await call('/v1/owners', { name, public_key: 'placeholder' });
  assert(registration.status === 201, registration.text);
  const timestamp = new Date().toISOString();
  const token = await call('/v1/auth/token', { owner: name, timestamp, signature: await sign(registration.data.data.private_key, name + NODE + timestamp) });
  assert(token.status === 200, token.text);
  return { name, ghii: `${name}@${NODE}`, token: token.data.data.token as string };
}
async function agent(o: { name: string; token: string }, scopes: string[]) {
  const started = await call('/v1/agents/device-authorize', { agent_name: 'prov' + randomBytes(3).toString('hex'), owner: o.name });
  assert(started.status === 200, started.text);
  const approved = await call('/v1/agents/verify', { user_code: started.data.data.user_code, action: 'approve', scopes, owner_token: o.token });
  assert(approved.status === 200, approved.text);
  const token = await call('/v1/agents/device-token', { device_code: started.data.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
  assert(token.status === 200, token.text);
  return token.data.token as string;
}
async function mcp(token: string) {
  let session = '', id = 0;
  async function rpc(method: string, params: object) {
    const response = await fetch(BASE + '/v1/mcp', { method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + token,
      ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-03-26' } : {}),
    }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    session = response.headers.get('mcp-session-id') ?? session;
    const raw = await response.text();
    assert(response.status === 200, raw);
    return response.headers.get('content-type')?.includes('text/event-stream')
      ? raw.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(row => row.id === id)
      : JSON.parse(raw);
  }
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Storage provenance', version: '1' } });
  return async (name: string, args: object) => {
    const r = await rpc('tools/call', { name, arguments: args });
    const text = r.result?.content?.[0]?.text ?? JSON.stringify(r.error ?? r);
    return { isError: !!r.result?.isError || !!r.error, text };
  };
}
const keyPath = (key: string) => key.split('/').map(encodeURIComponent).join('/');

// The provider: every speech answer is fresh bytes, so each record is about bytes only it describes.
const peer = createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
  if (req.url === '/audio/speech') {
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    res.end(Buffer.concat([Buffer.from('ID3'), randomBytes(2048)]));
  } else if (req.url === '/images/generations') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: PNG_1PX }] }));
  } else { res.writeHead(404); res.end(); }
});
await new Promise<void>(resolve => peer.listen(0, '127.0.0.1', resolve));
const peerPort = (peer.address() as { port: number }).port;

try {
  const alice = await owner('provfa');
  const bob = await owner('provfb');
  const app = `${alice.name}/voice.html`;
  const speech = { app_id: app, model: 'speech', input: 'Hei maailma', voice: 'test', response_format: 'mp3' };
  for (const o of [alice, bob]) {
    const set = await call('/v1/openrouter/settings', { provider: 'custom', baseUrl: `http://127.0.0.1:${peerPort}`, model: 'reply', imageModel: 'img' }, o.token, 'PUT');
    assert(set.status === 200, set.text);
  }

  // The clip the reported flow starts from, and its bytes as a listener downloads them.
  let clip: { key: string; id: string; recordUrl: string; bytes: Buffer } | undefined;

  await test('speak ?json=1 stores the clip with its record, and answers with the record\'s marks', async () => {
    const r = await call('/v1/ai/speak?json=1', speech, alice.token);
    assert(r.status === 200, r.text);
    const d = r.data.data;
    assert(typeof d.storage_key === 'string' && d.storage_key.startsWith('ai-speech/') && d.storage_key.endsWith('.mp3'), r.text);
    assert(d.provenance?.id && d.record_url === d.provenance.recordUrl, `record_url beside provenance: ${r.text}`);
    assert(r.data.meta?.provenance?.id === d.provenance.id, `meta.provenance: ${JSON.stringify(r.data.meta)}`);
    assert((r.headers.get('ai-disclosure') ?? '').includes('mode=machine-generated'), `AI-Disclosure: ${r.headers.get('ai-disclosure')}`);
    assert((r.headers.get('link') ?? '').includes(`/v1/provenance/${d.provenance.id}`), `Link: ${r.headers.get('link')}`);
    const own = await fetch(`${BASE}/v1/storage/${keyPath(d.storage_key)}`, { headers: { Authorization: `Bearer ${alice.token}` } });
    const bytes = Buffer.from(await own.arrayBuffer());
    assert(own.status === 200 && (own.headers.get('link') ?? '').includes(d.provenance.id), `own GET carries the record: ${own.status} ${own.headers.get('link')}`);
    assert(d.provenance.record.attestation.contentHash === `sha256:${sha256(bytes)}`, 'the record names the stored bytes');
    clip = { key: d.storage_key, id: d.provenance.id, recordUrl: d.record_url, bytes };
  });

  await test('a private clip keeps its record 404 for an anonymous reader, by id and by hash', async () => {
    assert(clip, 'no clip');
    const byId = await call(`/v1/provenance/${clip.id}`, undefined, undefined, 'GET');
    assert(byId.status === 404, `private record answered ${byId.status}`);
    const byHash = await call(`/v1/provenance/by-hash/${sha256(clip.bytes)}`, undefined, undefined, 'GET');
    assert(byHash.status === 200 && byHash.data.data.count === 0, `by-hash before publish: ${byHash.text}`);
    const pub = await call(`/v1/pub/${encodeURIComponent(alice.ghii)}/${keyPath(clip.key)}`, undefined, undefined, 'GET');
    assert(pub.status === 404, `private file on /v1/pub: ${pub.status}`);
  });

  await test('PATCH /v1/storage/ai-speech/<uuid>.mp3/visibility makes the clip public in place, record kept', async () => {
    assert(clip, 'no clip');
    const r = await call(`/v1/storage/${keyPath(clip.key)}/visibility`, { visibility: 'public' }, alice.token, 'PATCH');
    assert(r.status === 200 && r.data.data.visibility === 'public', `PATCH: ${r.status} ${r.text}`);
    assert(r.data.data.ai_provenance?.id === clip.id, `the file keeps its record: ${r.text}`);
  });

  await test('anonymous GET /v1/pub serves the clip with AI-Disclosure and Link, exposed to scripts', async () => {
    assert(clip, 'no clip');
    const res = await fetch(`${BASE}/v1/pub/${encodeURIComponent(alice.ghii)}/${keyPath(clip.key)}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert(res.status === 200 && bytes.equals(clip.bytes), `anonymous /v1/pub: ${res.status}`);
    assert((res.headers.get('ai-disclosure') ?? '').includes('mode=machine-generated'), `AI-Disclosure: ${res.headers.get('ai-disclosure')}`);
    assert((res.headers.get('link') ?? '').includes(`${clip.recordUrl}>; rel="ai-provenance"`), `Link: ${res.headers.get('link')}`);
    const exposed = res.headers.get('access-control-expose-headers') ?? '';
    assert(exposed.includes('AI-Disclosure') && exposed.includes('Link'), `exposed: ${exposed}`);
    const head = await fetch(`${BASE}/v1/pub/${encodeURIComponent(alice.ghii)}/${keyPath(clip.key)}`, { method: 'HEAD' });
    assert((head.headers.get('link') ?? '').includes(clip.id), 'HEAD carries the Link too');
    const handle = await call(`/v1/pub/${encodeURIComponent(alice.ghii)}/${keyPath(clip.key)}?mode=handle`, undefined, undefined, 'GET');
    assert(handle.status === 200 && handle.data.data.ai_provenance?.id === clip.id, `handle carries the record: ${handle.text}`);
    const dl = await fetch(handle.data.data.download_url);
    assert(dl.status === 200 && (dl.headers.get('link') ?? '').includes(clip.id), 'the download handle\'s bytes carry the Link');
  });

  await test('anonymous GET /v1/provenance/:id answers 200 for the public clip', async () => {
    assert(clip, 'no clip');
    const r = await call(`/v1/provenance/${clip.id}`, undefined, undefined, 'GET');
    assert(r.status === 200, `record: ${r.status} ${r.text.slice(0, 300)}`);
  });

  await test('anonymous by-hash with the SHA-256 of the bytes finds the record', async () => {
    assert(clip, 'no clip');
    const r = await call(`/v1/provenance/by-hash/${sha256(clip.bytes)}`, undefined, undefined, 'GET');
    assert(r.status === 200 && r.data.data.count >= 1, `by-hash: ${r.text.slice(0, 300)}`);
    assert(JSON.stringify(r.data.data.records).includes(clip.id), 'the clip\'s record is among the matches');
  });

  await test('REST upload of the same bytes with ai_provenance_id carries the record', async () => {
    assert(clip, 'no clip');
    const r = await call('/v1/storage', { key: 'copies/rest.mp3', data: clip.bytes.toString('base64'), mime_type: 'audio/mpeg', visibility: 'public', ai_provenance_id: clip.id }, alice.token);
    assert(r.status === 201 && r.data.data.ai_provenance?.id === clip.id, `REST attach: ${r.status} ${r.text}`);
    const res = await fetch(`${BASE}/v1/pub/${encodeURIComponent(alice.ghii)}/copies/rest.mp3`);
    assert(res.status === 200 && (res.headers.get('link') ?? '').includes(clip.id), 'the copy is served with the record');
  });

  await test('presigned upload carries ai_provenance_id in the token and attaches it to the bytes', async () => {
    assert(clip, 'no clip');
    const minted = await call('/v1/storage', { key: 'copies/presigned.mp3', mode: 'presigned', mime_type: 'audio/mpeg', visibility: 'public', ai_provenance_id: clip.id }, alice.token);
    assert(minted.status === 200 && minted.data.data.upload_url, `mint: ${minted.text}`);
    const put = await fetch(minted.data.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'audio/mpeg' }, body: clip.bytes });
    const body = await put.json() as any;
    assert(put.status === 200 && body.ai_provenance?.id === clip.id, `PUT: ${put.status} ${JSON.stringify(body)}`);
  });

  await test('the node MCP aimeat_storage_upload attaches the record for the owner\'s agent', async () => {
    assert(clip, 'no clip');
    const token = await agent(alice, ['storage:read', 'storage:write', 'ai:use']);
    const invoke = await mcp(token);
    const r = await invoke('aimeat_storage_upload', { key: 'copies/mcp.mp3', data_base64: clip.bytes.toString('base64'), mime_type: 'audio/mpeg', visibility: 'public', ai_provenance_id: clip.id });
    assert(!r.isError, r.text);
    assert(JSON.parse(r.text).ai_provenance?.id === clip.id, `MCP attach: ${r.text}`);
  });

  await test('another owner\'s record is refused 404 inline and at the presigned mint, and nothing is stored', async () => {
    assert(clip, 'no clip');
    const inline = await call('/v1/storage', { key: 'stolen/a.mp3', data: clip.bytes.toString('base64'), visibility: 'public', ai_provenance_id: clip.id }, bob.token);
    assert(inline.status === 404 && inline.text.includes('NOT_FOUND'), `inline: ${inline.status} ${inline.text}`);
    const stored = await call('/v1/storage/stolen/a.mp3', undefined, bob.token, 'GET');
    assert(stored.status === 404, 'a refused upload stored nothing');
    const mint = await call('/v1/storage', { key: 'stolen/b.mp3', mode: 'presigned', ai_provenance_id: clip.id }, bob.token);
    assert(mint.status === 404, `mint: ${mint.status} ${mint.text}`);
  });

  await test('a record about other bytes is refused 400 PROVENANCE_HASH_MISMATCH, inline and at the presigned PUT', async () => {
    assert(clip, 'no clip');
    const other = randomBytes(64);
    const inline = await call('/v1/storage', { key: 'mismatch/a.bin', data: other.toString('base64'), ai_provenance_id: clip.id }, alice.token);
    assert(inline.status === 400 && inline.text.includes('PROVENANCE_HASH_MISMATCH'), `inline: ${inline.status} ${inline.text}`);
    const minted = await call('/v1/storage', { key: 'mismatch/b.bin', mode: 'presigned', ai_provenance_id: clip.id }, alice.token);
    assert(minted.status === 200, minted.text);
    const put = await fetch(minted.data.data.upload_url, { method: 'PUT', body: other });
    const text = await put.text();
    assert(put.status === 400 && text.includes('PROVENANCE_HASH_MISMATCH'), `PUT: ${put.status} ${text}`);
    const stored = await call('/v1/storage/mismatch/b.bin', undefined, alice.token, 'HEAD');
    assert(stored.status === 404, 'a refused PUT stored nothing');
  });

  await test('an agent declaring without provenance:write is refused 403 SCOPE_DENIED before the write', async () => {
    const token = await agent(alice, ['storage:read', 'storage:write']);
    const r = await call('/v1/storage', { key: 'declared/a.txt', data: Buffer.from('made by a model').toString('base64'), ai_provenance: { level: 'ai-generated', model: 'm' } }, token);
    assert(r.status === 403 && r.text.includes('SCOPE_DENIED'), `${r.status} ${r.text}`);
    const stored = await call('/v1/storage/declared/a.txt', undefined, token, 'GET');
    assert(stored.status === 404, 'nothing stored');
  });

  await test('an agent with provenance:write declares; an agent saying nothing is stamped by the node', async () => {
    const token = await agent(alice, ['storage:read', 'storage:write', 'provenance:write']);
    const declared = await call('/v1/storage', { key: 'declared/b.txt', data: Buffer.from('a person wrote this').toString('base64'), ai_provenance: { level: 'original' } }, token);
    assert(declared.status === 201 && declared.data.data.ai_provenance?.record?.level === 'original', `declared: ${declared.text}`);
    assert(declared.data.data.ai_provenance.record.attestation.stampedBy === 'principal', 'a declaration is the principal\'s');
    const silent = await call('/v1/storage', { key: 'declared/c.txt', data: Buffer.from('no statement').toString('base64') }, token);
    assert(silent.status === 201 && silent.data.data.ai_provenance?.record?.attestation?.stampedBy === 'node', `Mint-3: ${silent.text}`);
    const own = await call('/v1/storage', { key: 'declared/d.txt', data: Buffer.from('the owner in person').toString('base64') }, alice.token);
    assert(own.status === 201 && !own.data.data.ai_provenance, `an owner's undeclared upload gets no record: ${own.text}`);
  });

  await test('an agent\'s speech names the agent on its record (B11)', async () => {
    const token = await agent(alice, ['ai:use', 'storage:read', 'storage:write']);
    const r = await call('/v1/ai/speak?json=1', speech, token);
    assert(r.status === 200, r.text);
    const principal = r.data.data.provenance?.record?.generator?.principal ?? '';
    assert(principal.includes('#') && principal.endsWith(alice.ghii), `the record names the agent: ${principal}`);
  });

  await test('the chunked complete and POST /v1/memory/files attach the record too', async () => {
    assert(clip, 'no clip');
    const init = await call('/v1/storage/upload/init', { key: 'copies/chunked.mp3', mime_type: 'audio/mpeg', visibility: 'public', chunk_size: 1024 * 1024, total_chunks: 1 }, alice.token);
    assert(init.status === 201, init.text);
    const id = init.data.data.upload_id;
    const chunk = await fetch(`${BASE}/v1/storage/upload/${id}/0`, { method: 'PUT', headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/octet-stream' }, body: clip.bytes });
    assert(chunk.status === 200, `chunk ${chunk.status}`);
    const done = await call(`/v1/storage/upload/${id}/complete`, { ai_provenance_id: clip.id }, alice.token);
    assert(done.status === 201 && done.data.data.ai_provenance?.id === clip.id, `chunked: ${done.status} ${done.text}`);
    const mem = await call('/v1/memory/files', { key: 'copies/memfile.mp3', content: clip.bytes.toString('base64'), mime_type: 'audio/mpeg', ai_provenance_id: clip.id }, alice.token);
    assert(mem.status === 201 && mem.data.data.ai_provenance?.id === clip.id, `memory files: ${mem.status} ${mem.text}`);
    const wrong = await call('/v1/memory/files', { key: 'copies/memfile2.bin', content: randomBytes(16).toString('base64'), ai_provenance_id: clip.id }, alice.token);
    assert(wrong.status === 400 && wrong.text.includes('PROVENANCE_HASH_MISMATCH'), `memory files mismatch: ${wrong.status} ${wrong.text}`);
  });

  await test('a data package descriptor\'s record is about the exact stored bytes (B8)', async () => {
    const token = await agent(alice, ['storage:read', 'storage:write', 'memory:read', 'memory:write']);
    const r = await call('/v1/datapackages', { name: 'prov-' + randomBytes(3).toString('hex'), changes: 'first', resources: [{ name: 'rows', rows: [{ a: 1, b: 'x' }, { a: 2, b: 'y' }] }] }, token);
    assert(r.status === 201, `publish: ${r.status} ${r.text.slice(0, 300)}`);
    const res = await fetch(r.data.data.descriptor_url);
    const bytes = Buffer.from(await res.arrayBuffer());
    const descriptor = JSON.parse(bytes.toString('utf8'));
    const id = descriptor.aimeat?.aiProvenanceId;
    assert(id && (res.headers.get('link') ?? '').includes(id), `descriptor served with its record: ${id} ${res.headers.get('link')}`);
    const byHash = await call(`/v1/provenance/by-hash/${sha256(bytes)}`, undefined, undefined, 'GET');
    assert(JSON.stringify(byHash.data?.data?.records ?? []).includes(id), `the descriptor bytes find the record: ${byHash.text.slice(0, 300)}`);
  });

  await test('an agent\'s portfolio page carries a record that resolves for any visitor (B10)', async () => {
    const token = await agent(alice, ['storage:read', 'storage:write', 'memory:read', 'memory:write']);
    const up = await call('/v1/portfolio/upload', { html: '<!doctype html><html><body><h1>Made by an agent</h1></body></html>', enable: true }, token, 'PUT');
    assert(up.status === 200, `upload: ${up.status} ${up.text}`);
    const pub = await call(`/v1/portfolio/data/${alice.name}`, undefined, undefined, 'GET');
    const id = pub.data?.data?.ai_provenance?.id;
    assert(pub.status === 200 && id, `the page names its record: ${pub.text.slice(0, 300)}`);
    assert(pub.data.data.ai_provenance.record.attestation.stampedBy === 'node', 'an undeclared agent page is stamped by the node');
    const rec = await call(`/v1/provenance/${id}`, undefined, undefined, 'GET');
    assert(rec.status === 200, `record: ${rec.status}`);
  });

  await test('a single-segment key still changes visibility', async () => {
    const up = await call('/v1/storage', { key: 'flat.png', data: Buffer.from(PNG_1PX, 'base64').toString('base64'), mime_type: 'image/png' }, alice.token);
    assert(up.status === 201, up.text);
    const r = await call('/v1/storage/flat.png/visibility', { visibility: 'public' }, alice.token, 'PATCH');
    assert(r.status === 200 && r.data.data.visibility === 'public', r.text);
  });

  await test('a public generated picture is served with its record, which resolves anonymously', async () => {
    const r = await call('/v1/ai/image', { prompt: 'a red bicycle', model: 'img', public: true, app_id: app }, alice.token);
    assert(r.status === 200, `image: ${r.status} ${r.text.slice(0, 300)}`);
    const id = r.data.meta?.provenance?.id;
    assert(id, `the picture has a record: ${JSON.stringify(r.data.meta)}`);
    const res = await fetch(`${BASE}${r.data.data.url}`);
    assert(res.status === 200 && (res.headers.get('link') ?? '').includes(id), `picture on /v1/pub: ${res.status} ${res.headers.get('link')}`);
    const rec = await call(`/v1/provenance/${id}`, undefined, undefined, 'GET');
    assert(rec.status === 200, `record: ${rec.status}`);
  });
} finally {
  peer.closeAllConnections();
  await new Promise<void>(resolve => peer.close(() => resolve()));
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
