/**
 * @file e2e-voice.ts
 * @description Real node, owner/app grants and local protocol peer: stream, speech, scope isolation,
 *   app attribution and concurrent accounting. No external provider calls or paid AI settings.
 * @version-history v1.0.0 - 2026-09-19 - Voice pipeline API integration contract.
 */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import * as ed from '@noble/ed25519';
ed.hashes.sha512 = m => new Uint8Array(createHash('sha512').update(m).digest());
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
let passed = 0, failed = 0, providerCalls = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${String(error)}`); }
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function sign(key: string, text: string) { return Buffer.from(await ed.signAsync(new TextEncoder().encode(text), Buffer.from(key, 'base64'))).toString('base64'); }
async function call(path: string, body?: unknown, token?: string, method = 'POST') {
  const response = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  return { status: response.status, text, data: response.headers.get('content-type')?.includes('json') && !response.headers.get('content-type')?.includes('ndjson') ? JSON.parse(text) : null };
}
async function owner(prefix: string) {
  const name = prefix + Date.now(); const registration = await call('/v1/owners', { name, public_key: 'placeholder' });
  assert(registration.status === 201, registration.text);
  const timestamp = new Date().toISOString();
  const token = await call('/v1/auth/token', { owner: name, timestamp, signature: await sign(registration.data.data.private_key, name + NODE + timestamp) });
  assert(token.status === 200, token.text); return { name, token: token.data.data.token as string };
}
const peer = createServer(async (req, res) => {
  providerCalls++;
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
  if (req.url === '/chat/completions') {
    const input = JSON.parse(Buffer.concat(chunks).toString());
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Ensimmäinen lause. ' } }] }) + '\n\n');
    await new Promise(r => setTimeout(r, 30));
    if (input.messages[0].content === 'fail') { res.end(); return; }
    res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Toinen lause.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 8, cost: 0.001 } }) + '\n\ndata: [DONE]\n\n');
  } else if (req.url === '/audio/speech') {
    const input = JSON.parse(Buffer.concat(chunks).toString());
    if (input.voice === 'error') { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"bad voice"}'); return; }
    res.writeHead(200, { 'Content-Type': 'audio/pcm' }); res.write(Buffer.alloc(2400));
    await new Promise(r => setTimeout(r, 20)); res.end(Buffer.alloc(2400));
  } else if (req.url === '/audio/transcriptions') {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ text: 'Hei maailma', usage: { seconds: 1, cost: 0.002 } }));
  } else { res.writeHead(404); res.end(); }
});
await new Promise<void>(resolve => peer.listen(0, '127.0.0.1', resolve));
const peerPort = (peer.address() as { port: number }).port;
try {
  const alice = await owner('voicea'); const bob = await owner('voiceb'); const app = `${alice.name}/voice.html`;
  await test('Owner configures a local protocol peer', async () => {
    const result = await call('/v1/openrouter/settings', { provider: 'custom', baseUrl: `http://127.0.0.1:${peerPort}`, model: 'reply', sttModel: 'stt' }, alice.token, 'PUT');
    assert(result.status === 200, result.text);
  });
  const request = { app_id: app, messages: [{ role: 'user', content: 'hello' }], model: 'reply', temperature: 0.2, max_tokens: 128 };
  const speech = { app_id: app, model: 'speech', input: 'Hei maailma', voice: 'test', response_format: 'pcm' };
  await test('Anonymous caller is refused before provider access', async () => {
    const before = providerCalls; const result = await call('/v1/ai/speak', speech); assert(result.status === 401, result.text); assert(providerCalls === before, 'provider called');
  });
  await test('Text streams as separate frames with final usage', async () => {
    const result = await call('/v1/ai/stream', request, alice.token); assert(result.status === 200, result.text);
    const frames = result.text.trim().split('\n').map(line => JSON.parse(line));
    assert(frames.filter(row => row.type === 'text').length === 2, result.text);
    assert(frames.at(-1).type === 'done' && frames.at(-1).cost_exact, result.text);
  });
  await test('PCM stream carries audio, terminal metadata and no provider key', async () => {
    const result = await call('/v1/ai/speak', speech, alice.token); assert(result.status === 200, result.text);
    const frames = result.text.trim().split('\n').map(line => JSON.parse(line));
    const bytes = frames.filter(row => row.type === 'audio').reduce((sum, row) => sum + Buffer.from(row.data, 'base64').length, 0);
    assert(bytes === 4800 && frames.at(-1).syntheticAudio, result.text); assert(!result.text.includes('apiKey'), 'key leaked');
    assert(!frames.at(-1).provenance || JSON.stringify(frames.at(-1).provenance).includes(createHash('sha256').update(Buffer.alloc(4800)).digest('hex')), 'Provenance must identify the generated audio, not the input text');
  });
  await test('Provider failures and incomplete streams never become successful turns', async () => {
    const bad = await call('/v1/ai/speak', { ...speech, voice: 'error' }, alice.token); assert(bad.status === 502, bad.text);
    const cut = await call('/v1/ai/stream', { ...request, messages: [{ role: 'user', content: 'fail' }] }, alice.token);
    assert(cut.text.includes('"type":"error"') && !cut.text.includes('"type":"done"'), cut.text);
  });
  await test('Unknown parameters are refused', async () => {
    const result = await call('/v1/ai/speak', { ...speech, baseUrl: 'https://attacker.invalid' }, alice.token); assert(result.status === 400, result.text);
  });
  await test('A different owner cannot spend Alice\'s key or read her usage', async () => {
    const before = providerCalls; const result = await call('/v1/ai/stream', request, bob.token);
    assert(result.status !== 200, result.text); assert(providerCalls === before, 'cross-owner provider call');
    const usage = await call('/v1/ai/usage', undefined, bob.token, 'GET'); assert(!usage.text.includes(app), 'Alice usage leaked');
  });
  let appToken = '';
  async function grant(scope: string) {
    const verifier = randomBytes(32).toString('base64url'); const redirect = 'http://localhost:9911/callback';
    const query = new URLSearchParams({ app, response_type: 'code', scope, redirect_uri: redirect,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    const auth = await fetch(BASE + '/v1/app-grants/authorize?' + query, { redirect: 'manual' });
    const match = /req=([^&]+)/.exec(auth.headers.get('location') || ''); assert(match !== null, 'missing consent redirect');
    const consent = await call('/v1/app-grants/authorize-consent', { request_id: decodeURIComponent(match[1]) }, alice.token);
    assert(consent.status === 200, consent.text);
    const code = new URL(consent.data.data.redirect_url).searchParams.get('code');
    const token = await call('/v1/app-grants/token', { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect });
    assert(token.status === 200, token.text); return token.data.data.access_token;
  }
  await test('App without ai:use receives 403', async () => {
    const html = '<!doctype html><title>Voice test</title>';
    const saved = await call('/v1/apps', { filename: 'voice.html', description: 'Local voice pipeline integration test.', content: Buffer.from(html).toString('base64'), visibility: 'public' }, alice.token);
    assert([200, 201].includes(saved.status), saved.text);
    const token = await grant('memory:read'); const result = await call('/v1/ai/speak', speech, token); assert(result.status === 403, result.text);
  });
  await test('App with ai:use cannot spoof another app attribution', async () => {
    appToken = await grant('ai:use'); const before = providerCalls;
    for (const path of ['/v1/ai/speak', '/v1/ai/stream', '/v1/ai/transcribe']) {
      const body = path.endsWith('speak') ? speech : path.endsWith('stream') ? request : { audio_base64: 'AA==', model: 'stt' };
      const result = await call(path, { ...body, app_id: 'other/app' }, appToken); assert(result.status === 403, result.text);
    }
    assert(providerCalls === before, 'spoofed app called provider');
  });
  await test('Parallel STT, text and speech all remain in the shared usage counter', async () => {
    const before = await call('/v1/ai/usage', undefined, alice.token, 'GET');
    const results = await Promise.all([
      call('/v1/ai/stream', request, appToken), call('/v1/ai/speak', speech, appToken),
      call('/v1/ai/transcribe', { app_id: app, audio_base64: 'AA==', model: 'stt', temperature: 0 }, appToken),
    ]);
    for (const result of results) assert(result.status === 200, result.text);
    const after = await call('/v1/ai/usage', undefined, alice.token, 'GET');
    const prior = before.data.data.usage ?? before.data.data; const next = after.data.data.usage ?? after.data.data;
    assert(next.total_calls - prior.total_calls === 3, JSON.stringify({ prior, next }));
  });
} finally { peer.closeAllConnections(); await new Promise<void>(resolve => peer.close(() => resolve())); }
console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
