/**
 * @file e2e-ai-provenance-served.ts
 * @description The disclosure a reader is served is decided for the item as it is served, and its
 *   words follow the record's medium. Reported by originalmiskate.com on 2026-10-08: a public speech
 *   clip's record read "This text was written by AI", and a record minted while its item was private
 *   kept `required: false` after the item went public.
 *
 *   Real node, a loopback provider for speech and images, no external calls:
 *   1. a speech record says it is audio, and resolves anonymously with the audio sentence once a
 *      public item points at it (the readable page too, in Finnish);
 *   2. an image record says it is an image, and a public image owes its label at once;
 *   3. a memory record an agent wrote privately, made public by a visibility-only update, is served
 *      with `required: true` on the public read, the resolve route and the hash lookup, and counts as
 *      labelled in the transparency report; made private again it owes nothing and resolves 404;
 *   4. the declaration takes `mediaKind` and `resemblesReal` on REST and `media_kind` over MCP, and
 *      refuses an unknown medium.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-ai-provenance-served
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
ed.hashes.sha512 = m => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (error) { failed++; console.error(`  ❌ ${name}: ${(error as Error).message}`); }
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

// The sentences the node ships, read from the same locale files, so a reworded string does not
// break the suite while a wrong KEY does.
const en = (await import('../locales/en.json', { with: { type: 'json' } })).default.aiLabel as any;
const fi = (await import('../locales/fi.json', { with: { type: 'json' } })).default.aiLabel as any;

async function call(path: string, body?: unknown, token?: string, method = body === undefined ? 'GET' : 'POST', headers: Record<string, string> = {}) {
  const response = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, text, data };
}
async function sign(key: string, text: string) {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(text), Buffer.from(key, 'base64'))).toString('base64');
}
async function owner(prefix: string) {
  const name = prefix + Date.now();
  const registration = await call('/v1/owners', { name, public_key: 'placeholder' });
  assert(registration.status === 201, registration.text);
  const timestamp = new Date().toISOString();
  const token = await call('/v1/auth/token', { owner: name, timestamp, signature: await sign(registration.data.data.private_key, name + NODE + timestamp) });
  assert(token.status === 200, token.text);
  return { name, token: token.data.data.token as string };
}
async function agent(o: { name: string; token: string }, agentName: string, scopes: string[]) {
  const started = await call('/v1/agents/device-authorize', { agent_name: agentName, owner: o.name });
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
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Provenance served', version: '1' } });
  return (name: string, args: object) => rpc('tools/call', { name, arguments: args });
}

// A one-pixel PNG's magic bytes are enough: the node sniffs the type, it does not decode.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]).toString('base64');
const peer = createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
  if (req.url?.endsWith('/audio/speech')) {
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.from('ID3-provenance-served-' + Date.now()));
  } else if (req.url?.endsWith('/images/generations')) {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ b64_json: PNG }], usage: { cost: 0.01 } }));
  } else { res.writeHead(404); res.end(); }
});
await new Promise<void>(resolve => peer.listen(0, '127.0.0.1', resolve));
const peerPort = (peer.address() as { port: number }).port;

console.log('\n=== AI provenance decided when served E2E ===\n');
try {
  const alice = await owner('provsrv');
  const aliceGhii = `${alice.name}@${NODE}`;
  const resolveAnon = (id: string) => call(`/v1/provenance/${id}`);
  /** Attach a record to a public memory key of the owner's, the way a person publishes it. */
  async function publishWith(key: string, id: string) {
    // A new key every time, so the write is a create.
    const put = await call('/v1/memory', { key, value: `published ${key}`, visibility: 'public', ai_provenance_id: id }, alice.token);
    assert(put.status === 201, put.text);
  }

  await test('Setup: the owner points the node at the loopback provider', async () => {
    const r = await call('/v1/openrouter/settings', { provider: 'custom', baseUrl: `http://127.0.0.1:${peerPort}`, model: 'reply', imageModel: 'img' }, alice.token, 'PUT');
    assert(r.status === 200, r.text);
  });

  let speechId = '';
  await test('1a. A speech record says it is audio, of the type the provider sent', async () => {
    const r = await call('/v1/ai/speak?json=1', { app_id: `${alice.name}/voice.html`, model: 'speech', input: 'Hei maailma', voice: 'test', response_format: 'mp3' }, alice.token);
    assert(r.status === 200, r.text);
    const prov = r.data.data.provenance;
    assert(typeof prov?.id === 'string' && prov.id.length > 0, `the speech carries its record: ${r.text}`);
    speechId = prov.id;
    assert(prov.record.mediaKind === 'audio', `mediaKind audio, got ${prov.record.mediaKind}`);
    assert(prov.record.mediaType === 'audio/mpeg', `mediaType audio/mpeg, got ${prov.record.mediaType}`);
    assert(prov.record.disclosure.long.en === en.syntheticAudioLong, `audio words, got ${prov.record.disclosure.long.en}`);
    assert(prov.record.disclosure.required === false, 'a private clip owes no label yet');
  });

  await test('1b. Published, the speech record resolves anonymously with the audio label, never "This text"', async () => {
    assert(speechId.length > 0, 'needs 1a');
    assert((await resolveAnon(speechId)).status === 404, 'private until something public points at it');
    await publishWith(`clip-${Date.now()}`, speechId);
    const r = await resolveAnon(speechId);
    assert(r.status === 200, r.text);
    const d = r.data.data.provenance.disclosure;
    assert(d.required === true, `required when public, got ${JSON.stringify(d)}`);
    assert(d.reason === 'art50_4_precautionary', `nobody said it resembles a real voice, got ${d.reason}`);
    assert(d.long.en === en.syntheticAudioLong && !/text/i.test(d.long.en), `audio sentence, got ${d.long.en}`);
    assert(r.data.data.provenance.mediaKind === 'audio', 'the medium is served to a non-owner too');
  });

  await test('1c. The readable record page says it in the reader\'s language', async () => {
    const page = await fetch(`${BASE}/v1/provenance/${speechId}`, { headers: { Accept: 'text/html', 'Accept-Language': 'fi' } });
    const html = await page.text();
    assert(page.status === 200, html.slice(0, 200));
    assert(html.includes(fi.syntheticAudioLong), 'the Finnish audio sentence is on the page');
    assert(html.includes(fi.page.media.audio), 'the medium row is on the page');
  });

  await test('2. A public image says it is an image and owes its label at once', async () => {
    const r = await call('/v1/ai/image', { prompt: 'a red bicycle', model: 'img', public: true }, alice.token);
    assert(r.status === 200, r.text);
    const rec = r.data.meta?.provenance?.record;
    assert(rec?.mediaKind === 'image' && rec.mediaType === 'image/png', `image/png, got ${rec?.mediaKind} ${rec?.mediaType}`);
    assert(rec.disclosure.required === true, `a public image owes the label, got ${JSON.stringify(rec.disclosure)}`);
    assert(rec.disclosure.long.en === en.syntheticImageLong, `image words, got ${rec.disclosure.long.en}`);
    await publishWith(`img-${Date.now()}`, r.data.meta.provenance.id);
    const anon = await resolveAnon(r.data.meta.provenance.id);
    assert(anon.status === 200 && anon.data.data.provenance.disclosure.long.en === en.syntheticImageLong, anon.text);
  });

  const agentName = `provsrvagent${Date.now()}`;
  const agentGaii = `${agentName}#${aliceGhii}`;
  const key = `notes-${Date.now()}`;
  let memoryId = '';
  let memoryVersion = 0;
  let agentToken = '';
  await test('3a. An agent\'s private note is stamped, and owes nothing while private', async () => {
    const token = await agent(alice, agentName, ['memory:read', 'memory:write', 'provenance:write']);
    agentToken = token;
    const w = await call('/v1/memory', { key, value: 'An agent wrote this note.', visibility: 'private' }, token);
    assert(w.status === 201, w.text);
    const read = await call(`/v1/memory/${encodeURIComponent(key)}?agent=${encodeURIComponent(agentGaii)}`, undefined, alice.token);
    assert(read.status === 200, read.text);
    const prov = read.data.meta?.provenance;
    assert(typeof prov?.id === 'string' && prov.id.length > 0, `Mint-3 stamped the agent's write: ${read.text.slice(0, 400)}`);
    memoryId = prov.id;
    assert(prov.record.mediaKind === 'text', `a string is text, got ${prov.record.mediaKind}`);
    assert(prov.record.disclosure.required === false, 'private: nothing owed');
    // Made public by a visibility-only update: no new value, so no new record.
    const vis = await call(`/v1/memory/${encodeURIComponent(key)}`, { visibility: 'public', version: read.data.data.version }, token, 'PUT');
    assert(vis.status === 200, vis.text);
    const after = await call(`/v1/memory/${encodeURIComponent(key)}?agent=${encodeURIComponent(agentGaii)}`, undefined, alice.token);
    assert(after.data?.meta?.provenance?.id === memoryId, 'a visibility-only update keeps the record');
    memoryVersion = after.data.data.version;
  });

  await test('3b. Made public by a visibility-only update, it is served with required: true everywhere', async () => {
    assert(memoryId.length > 0, 'needs 3a');
    const pub = await call(`/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(key)}`);
    assert(pub.status === 200, pub.text);
    assert(pub.data.meta?.provenance?.id === memoryId, `the same record, got ${pub.data.meta?.provenance?.id}`);
    assert(pub.data.meta.provenance.record.disclosure.required === true, `the public read owes the label: ${JSON.stringify(pub.data.meta.provenance.record.disclosure)}`);
    const anon = await resolveAnon(memoryId);
    assert(anon.status === 200 && anon.data.data.provenance.disclosure.required === true, anon.text);
    assert(anon.data.data.provenance.disclosure.long.en === en.publicText, 'text keeps its words');
    const hash = String(anon.data.data.content_hash).replace('sha256:', '');
    const byHash = await call(`/v1/provenance/by-hash/${hash}`);
    const row = byHash.data?.data?.records?.find((x: any) => x.id === memoryId);
    assert(row?.provenance?.disclosure?.required === true, `the hash lookup decides it too: ${byHash.text.slice(0, 300)}`);
  });

  await test('3c. The transparency report counts it as labelled, not as unlabelled', async () => {
    const r = await call('/v1/ai-transparency/mine', undefined, alice.token);
    assert(r.status === 200, r.text);
    assert(r.data.data.unlabelled === 0, `nothing public goes unlabelled, got ${r.data.data.unlabelled}`);
    assert(r.data.data.labelled >= 3, `the note, the clip and the image are labelled, got ${r.data.data.labelled}`);
    assert(r.data.data.unlabelled_detail.total === 0, `the detail agrees, got ${r.data.data.unlabelled_detail.total}`);
  });

  await test('3d. Made private again it owes nothing, and an anonymous resolve is the identical 404', async () => {
    // The owner's PUT finds the key in the agent's namespace (routes/memory/key.ts).
    const vis = await call(`/v1/memory/${encodeURIComponent(key)}`, { visibility: 'private', version: memoryVersion }, alice.token, 'PUT');
    assert(vis.status === 200, vis.text);
    const anon = await resolveAnon(memoryId);
    const missing = await resolveAnon('00000000-0000-4000-8000-000000000000');
    assert(anon.status === 404 && anon.text.replace(/"(timestamp|request_id|requestId)":"[^"]*"/g, '') === missing.text.replace(/"(timestamp|request_id|requestId)":"[^"]*"/g, ''),
      `the same 404 as a missing id: ${anon.text} vs ${missing.text}`);
    const own = await call(`/v1/provenance/${memoryId}`, undefined, alice.token);
    assert(own.status === 200 && own.data.data.provenance.disclosure.required === false, own.text);
  });

  await test('4a. A declaration states the medium and whether it resembles something real', async () => {
    const pubKey = `video-${Date.now()}`;
    const w = await call('/v1/memory', { key: pubKey, value: 'a video note', visibility: 'public' }, alice.token);
    assert(w.status === 201, w.text);
    const r = await call('/v1/provenance', {
      level: 'ai-generated', humanInvolvement: 'editorial-control', mediaKind: 'video', mediaType: 'video/mp4',
      resemblesReal: 'yes', content: 'video bytes stand-in', attachToMemoryKey: pubKey,
    }, alice.token);
    assert(r.status === 201, r.text);
    const p = r.data.data.provenance;
    assert(p.mediaKind === 'video' && p.mediaType === 'video/mp4' && p.resemblesReal === 'yes', JSON.stringify(p));
    assert(p.disclosure.required === true && p.disclosure.reason === 'art50_4_deepfake', `a reviewed deep fake is still labelled: ${JSON.stringify(p.disclosure)}`);
    assert(p.disclosure.long.en === en.syntheticVideoLong, p.disclosure.long.en);
  });

  await test('4b. An unknown medium is refused, and nothing is minted', async () => {
    const r = await call('/v1/provenance', { level: 'ai-generated', humanInvolvement: 'none', mediaKind: 'hologram', content: 'x' }, alice.token);
    assert(r.status === 400 && r.text.includes('mediaKind'), r.text);
  });

  await test('4c. Over MCP, ai_provenance.media_kind reaches the record', async () => {
    assert(agentToken.length > 0, 'needs 3a');
    const invoke = await mcp(agentToken);
    const mkey = `table-${Date.now()}`;
    const out = await invoke('aimeat_memory_write', { key: mkey, value: { rows: [1, 2, 3] }, ai_provenance: { level: 'ai-generated', media_kind: 'data' } });
    assert(out.result && !out.result.isError, JSON.stringify(out));
    const read = await call(`/v1/memory/${encodeURIComponent(mkey)}?agent=${encodeURIComponent(agentGaii)}`, undefined, alice.token);
    assert(read.data?.meta?.provenance?.record?.mediaKind === 'data', read.text.slice(0, 400));
    const bad = await invoke('aimeat_memory_write', { key: mkey, value: 'x', ai_provenance: { level: 'ai-generated', media_kind: 'hologram' } });
    // The tool's input schema is the catalog's, so the SDK refuses the call before the handler runs.
    assert(bad.result?.isError === true && JSON.stringify(bad).includes('media_kind'), `an unknown medium is refused over MCP: ${JSON.stringify(bad)}`);
  });
} finally {
  peer.closeAllConnections(); await new Promise<void>(resolve => peer.close(() => resolve()));
}
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exitCode = failed ? 1 : 0;
