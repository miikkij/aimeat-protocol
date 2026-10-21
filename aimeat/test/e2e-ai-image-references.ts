/**
 * @file test/e2e-ai-image-references.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reference pictures and a mask on POST /v1/ai/image and aimeat_image_generate: what
 *   reaches each kind of provider, and what is refused before anything is sent.
 *
 *   WHAT IT PROVES. A comic character keeps its look only if the model SEES the earlier pictures,
 *   so each case reads the request the provider received and compares the bytes with the files the
 *   caller named: OpenRouter gets `input_references` on its documented `/images` endpoint (the mask
 *   as a last reference, explained in the prompt), the OpenAI type and an OpenAI-compatible server
 *   get the images API's `/images/edits` multipart with a real mask part. A call with no reference
 *   is the request it always was. The refusals (a missing key, a file that is not a picture, a mask
 *   without a picture or not a PNG, too many references, another person's file, an agent reaching
 *   its owner's file) each send nothing to the provider.
 *
 *   WHY IT OWNS ITS SERVER. The fixed address of the openrouter and openai provider types is a
 *   boot-time setting (AIMEAT_AI_FIXED_BASEURL_OVERRIDES), pointed at the fake provider here
 *   (test/helpers/fake-ai-provider.ts). It follows the runner's backend.
 * @structure
 *   - the node · helpers
 *   - Phase 0: owners, providers, pictures in storage, an agent
 *   - Phase 1: what each provider receives
 *   - Phase 2: refusals, nothing sent
 *   - Phase 3: an agent over MCP, reusing a picture it made; 3d a public picture with the gate off
 *   - Phase 4: the same node started again with AIMEAT_PUBLISH_GATE=agents: a public picture meets
 *     the publish gate on REST and over MCP
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ai-image-references
 * @version-history
 *   v1.1.0 — 2026-10-21 — 3d: with the gate off (the default) an agent's public picture is public at
 *     once on REST and over MCP. Phase 4, on the same node started again with the publish gate on:
 *     an agent without publish:public gets its public picture stored private, 202 with a file
 *     request on REST and the request in the MCP answer, no stranger reads it, the signed
 *     download_url loads it now, and the owner's approval makes it public; an agent holding
 *     publish:public and the owner in person get a public picture at once; a private picture is
 *     unchanged (secaudit 2026-10, ai-image public picture past the publish gate). 4f: a picture's
 *     request with no record to join stands alone with its own notification and item, as before.
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-1, A-2).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { startFakeAiProvider, imageJson, type FakeAiProvider, type RecordedRequest } from './helpers/fake-ai-provider.js';

// Its own port, below the lane's E2E port, on an offset no other suite takes.
const PORT = process.env.E2E_AI_IMAGE_REFS_PORT ?? String(Number(process.env.AIMEAT_TEST_PORT ?? '40251') - 207);
const BASE = `http://localhost:${PORT}`;

/** A PNG signature and IHDR chunk header: enough for the node's sniffer, and distinct per picture. */
function png(tag: number): Buffer {
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
        Buffer.from('IHDR', 'latin1'),
        Buffer.from([0, 0, 4, 0, 0, 0, 4, 0, 8, 6, 0, 0, 0, tag, tag, tag]),
    ]);
}
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5]);
const SHEET = png(1);
const SETTING = png(2);
const MASK = png(3);
const ANSWER = png(9);

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, token: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, {
        ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
    });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { status: res.status, body };
}

/** The bytes of a data: URL, or null when it is not one. */
function bytesOfDataUrl(url: unknown): Buffer | null {
    const m = /^data:image\/[a-z]+;base64,(.+)$/.exec(String(url));
    return m ? Buffer.from(m[1], 'base64') : null;
}

/** How many multipart parts of this name a request carried. */
function partsNamed(req: RecordedRequest, name: string): number {
    return req.bytes.toString('latin1').split(`name="${name}"`).length - 1;
}

// ── the node ──────────────────────────────────────────────────────────────────
const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-image-refs-'));
const DB_PATH = join(dbDir, 'image-refs.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

/** `extra` sets a node setting for one part of the suite: Phase 4 starts the same node on the same
 *  database with AIMEAT_PUBLISH_GATE=agents; Phases 0-3 run on the default. */
async function startNode(stub: FakeAiProvider, extra: Record<string, string> = {}): Promise<ChildProcess> {
    const target = PG_URL
        ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
        : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
    const closed = 'http://127.0.0.1:9/none';
    const env: Record<string, string | undefined> = {
        ...process.env,
        ...pinnedEnv(target),
        AIMEAT_DEV_MODE: 'true', AIMEAT_TEST_MODE: 'true', AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
        AIMEAT_RL_OPENROUTER: '1000', AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000', AIMEAT_DEFAULT_AGENT_SCOPES: '*',
        AIMEAT_OPENROUTER_INSTANCE_KEY: '',
        AIMEAT_AI_CATALOG_SOURCES: JSON.stringify({ modelsDev: closed, openRouter: closed, liteLlm: closed }),
        AIMEAT_AI_FIXED_BASEURL_OVERRIDES: JSON.stringify({ openai: `${stub.baseUrl}/openai`, openrouter: `${stub.baseUrl}/or` }),
        ...extra,
    };
    const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the image references node' });
}

async function stopNode(child: ChildProcess): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
        await once(child, 'exit');
        clearTimeout(timer);
    }
}

(async () => {
    console.log('\n── Reference pictures and a mask on the image AI (Comicland v3 A-1, A-2) ──');
    const stub = await startFakeAiProvider(0);
    stub.setDefault('images', imageJson({ b64: ANSWER.toString('base64'), cost: 0.05 }));
    let node = await startNode(stub);

    try {
        // ── Phase 0 ──
        const stamp = Date.now().toString(36).slice(-6);
        await registerOwner(BASE, `irop${stamp}`);               // the first account is the operator
        const alice = await registerOwner(BASE, `iralice${stamp}`);
        const bob = await registerOwner(BASE, `irbob${stamp}`);
        const put = async (id: string, body: Record<string, unknown>) => {
            const r = await json(`/v1/ai/providers/${id}`, alice.token, { method: 'PUT', body: JSON.stringify(body) });
            assert(r.status === 200, `provider ${id} ${r.status}: ${JSON.stringify(r.body?.error)}`);
            if ((body.auth as any)?.type !== 'none') {
                const k = await json(`/v1/ai/providers/${id}/key`, alice.token, { method: 'PUT', body: JSON.stringify({ api_key: `sk-${id}` }) });
                assert(k.status === 200, `key ${id} ${k.status}: ${JSON.stringify(k.body?.error)}`);
            }
        };
        await put('my-or', { title: 'My OpenRouter', type: 'openrouter', capabilities: { image: { enabled: true, model: 'google/gemini-2.5-flash-image', pool: true } } });
        await put('my-openai', { title: 'My OpenAI', type: 'openai', capabilities: { image: { enabled: true, model: 'gpt-image-1', pool: true } } });
        await put('my-custom', { title: 'My server', type: 'openai-compatible', baseUrl: `${stub.baseUrl}/custom`, auth: { type: 'key' }, capabilities: { image: { enabled: true, model: 'local-image', pool: true } } });
        const routing = await json('/v1/ai/routing', alice.token, { method: 'PUT', body: JSON.stringify({ routing: { rules: { onlyTested: false } } }) });
        assert(routing.status === 200, `routing ${routing.status}: ${JSON.stringify(routing.body?.error)}`);

        const store = async (token: string, key: string, data: Buffer, mime: string) => {
            const r = await json('/v1/storage', token, { method: 'POST', body: JSON.stringify({ key, data: data.toString('base64'), mime_type: mime, visibility: 'private' }) });
            assert(r.status === 200 || r.status === 201, `store ${key} ${r.status}: ${JSON.stringify(r.body?.error)}`);
        };
        await store(alice.token, 'comic/sheet.png', SHEET, 'image/png');
        await store(alice.token, 'comic/setting.png', SETTING, 'image/png');
        await store(alice.token, 'comic/mask.png', MASK, 'image/png');
        await store(alice.token, 'comic/panel.jpg', JPEG, 'image/jpeg');
        await store(alice.token, 'comic/script.txt', Buffer.from('Panel 1: the hero enters.'), 'text/plain');
        await store(bob.token, 'comic/bob-sheet.png', png(7), 'image/png');

        const image = (token: string, body: Record<string, unknown>) =>
            json('/v1/ai/image', token, { method: 'POST', body: JSON.stringify({ prompt: 'The hero walks into the harbour.', ...body }) });

        // ── Phase 1 ──
        console.log('\nPhase 1: what each provider receives');

        await test('1a. With no reference the OpenRouter call is the request it always was: /images/generations, no input_references', async () => {
            const r = await image(alice.token, { provider: 'my-or' });
            assert(r.status === 200, `${r.status}: ${JSON.stringify(r.body?.error)}`);
            const seen = stub.lastRequest('images')!;
            assert(seen.pathname.endsWith('/or/images/generations'), `path ${seen.pathname}`);
            assert((seen.json as any)?.input_references === undefined, 'no input_references on a plain call');
            assert(r.body.data.reference_count === 0 && r.body.data.mask_mode === undefined, `answer ${JSON.stringify(r.body.data)}`);
        });

        await test('1b. OpenRouter gets both references as input_references on /images, byte for byte, a stored key and a data: URL', async () => {
            const r = await image(alice.token, {
                provider: 'my-or',
                reference_images: [{ storage_key: 'comic/sheet.png' }, { data_url: `data:image/png;base64,${SETTING.toString('base64')}` }],
            });
            assert(r.status === 200, `${r.status}: ${JSON.stringify(r.body?.error)}`);
            const seen = stub.lastRequest('images')!;
            assert(seen.pathname.endsWith('/or/images'), `the documented endpoint, got ${seen.pathname}`);
            const refs = (seen.json as any)?.input_references as Array<{ type: string; image_url: { url: string } }>;
            assert(Array.isArray(refs) && refs.length === 2, `two references, got ${JSON.stringify(refs)?.slice(0, 200)}`);
            assert(refs.every(x => x.type === 'image_url'), 'each reference is an image_url part');
            assert(bytesOfDataUrl(refs[0].image_url.url)?.equals(SHEET), 'the first reference is the stored sheet, unchanged');
            assert(bytesOfDataUrl(refs[1].image_url.url)?.equals(SETTING), 'the second reference is the data: URL picture, unchanged');
            assert((seen.json as any)?.prompt === 'The hero walks into the harbour.', `the prompt is the caller's, got ${(seen.json as any)?.prompt}`);
            assert(r.body.data.reference_count === 2, `reference_count ${r.body.data.reference_count}`);
        });

        await test('1c. A mask on OpenRouter goes as a last reference and the prompt says what it is: mask_mode guided', async () => {
            const r = await image(alice.token, {
                provider: 'my-or', reference_images: [{ storage_key: 'comic/sheet.png' }], mask: { storage_key: 'comic/mask.png' },
            });
            assert(r.status === 200, `${r.status}: ${JSON.stringify(r.body?.error)}`);
            const seen = stub.lastRequest('images')!;
            const refs = (seen.json as any)?.input_references as Array<{ image_url: { url: string } }>;
            assert(refs.length === 2 && bytesOfDataUrl(refs[1].image_url.url)?.equals(MASK), 'the mask is the last reference');
            assert(String((seen.json as any)?.prompt).includes('The last reference image is a mask'), `the prompt explains the mask: ${(seen.json as any)?.prompt}`);
            assert(r.body.data.mask_mode === 'guided', `mask_mode ${r.body.data.mask_mode}`);
        });

        await test('1d. The OpenAI type gets /images/edits as multipart with both pictures and a mask part: mask_mode native', async () => {
            const r = await image(alice.token, {
                provider: 'my-openai',
                reference_images: [{ storage_key: 'comic/sheet.png' }, { storage_key: 'comic/panel.jpg' }], mask: { storage_key: 'comic/mask.png' },
            });
            assert(r.status === 200, `${r.status}: ${JSON.stringify(r.body?.error)}`);
            const seen = stub.lastRequest('images')!;
            assert(seen.pathname.endsWith('/openai/images/edits'), `path ${seen.pathname}`);
            const raw = seen.bytes;
            assert(raw.includes(SHEET) && raw.includes(JPEG) && raw.includes(MASK), 'the multipart body carries the three pictures');
            assert(partsNamed(seen, 'mask') === 1, `one mask part, got ${partsNamed(seen, 'mask')}`);
            assert(partsNamed(seen, 'image[]') + partsNamed(seen, 'image') === 2, 'two image parts');
            assert(r.body.data.mask_mode === 'native' && r.body.data.reference_count === 2, `answer ${JSON.stringify(r.body.data)}`);
        });

        await test('1e. An OpenAI-compatible server gets /images/edits multipart from the node transport, image[] per picture', async () => {
            const r = await image(alice.token, {
                provider: 'my-custom', reference_images: [{ storage_key: 'comic/sheet.png' }, { storage_key: 'comic/setting.png' }], mask: { storage_key: 'comic/mask.png' },
            });
            assert(r.status === 200, `${r.status}: ${JSON.stringify(r.body?.error)}`);
            const seen = stub.lastRequest('images')!;
            assert(seen.pathname.endsWith('/custom/images/edits'), `path ${seen.pathname}`);
            assert(partsNamed(seen, 'image[]') === 2 && partsNamed(seen, 'mask') === 1, 'two image[] parts and a mask part');
            assert(seen.bytes.includes(SHEET) && seen.bytes.includes(SETTING) && seen.bytes.includes(MASK), 'the bytes are the stored files');
            assert(r.body.data.mask_mode === 'native', `mask_mode ${r.body.data.mask_mode}`);
            // The picture landed and names its record, as every picture does.
            assert(r.body.meta?.provenance?.record?.attestation?.contentHash, 'the picture has its provenance record');
        });

        // ── Phase 2 ──
        console.log('\nPhase 2: refusals, nothing sent');
        const refused = async (body: Record<string, unknown>, status: number, code: string, token = alice.token) => {
            const heard = stub.requestsFor('images').length;
            const r = await image(token, { provider: 'my-or', ...body });
            assert(r.status === status && r.body.error?.code === code, `expected ${status} ${code}, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
            assert(stub.requestsFor('images').length === heard, 'nothing was sent to the provider');
            return r;
        };

        await test('2a. A key that is not in the caller\'s storage is 404 NOT_FOUND', async () => {
            await refused({ reference_images: [{ storage_key: 'comic/nothing.png' }] }, 404, 'NOT_FOUND');
        });
        await test('2b. Another person\'s picture is not found either: bob cannot name alice\'s sheet, alice cannot name bob\'s', async () => {
            await refused({ reference_images: [{ storage_key: 'comic/sheet.png' }] }, 404, 'NOT_FOUND', bob.token);
            await refused({ reference_images: [{ storage_key: 'comic/bob-sheet.png' }] }, 404, 'NOT_FOUND');
        });
        await test('2c. A file that is not a picture is 400 INVALID_BODY, whatever it is called', async () => {
            const r = await refused({ reference_images: [{ storage_key: 'comic/script.txt' }] }, 400, 'INVALID_BODY');
            assert(/not a PNG, JPEG, WebP or GIF/.test(r.body.error.message), r.body.error.message);
        });
        await test('2d. A mask without a picture to edit, and a mask that is not a PNG, are 400', async () => {
            await refused({ mask: { storage_key: 'comic/mask.png' } }, 400, 'INVALID_BODY');
            await refused({ reference_images: [{ storage_key: 'comic/sheet.png' }], mask: { storage_key: 'comic/panel.jpg' } }, 400, 'INVALID_BODY');
        });
        await test('2e. Seventeen references are one too many; an https URL is not accepted', async () => {
            await refused({ reference_images: Array.from({ length: 17 }, () => ({ storage_key: 'comic/sheet.png' })) }, 400, 'INVALID_BODY');
            await refused({ reference_images: [{ data_url: 'https://example.com/sheet.png' }] }, 400, 'INVALID_BODY');
        });

        // ── Phase 3 ──
        console.log('\nPhase 3: an agent over MCP');
        const agent = await makeAgent(BASE, alice, ['ai:use']);
        const s = await openSession(BASE, agent.token, 'image-refs-agent');

        let made = '';
        await test('3a. An agent makes a picture, then uses it as a reference: the picture is in its owner\'s storage and still the agent\'s to reuse', async () => {
            const first = await callTool(s, 'aimeat_image_generate', { prompt: 'The hero, front view.', provider: 'my-or' });
            assert(!first.isError, `first picture refused: ${first.text}`);
            made = first.data.storage_key;
            const second = await callTool(s, 'aimeat_image_generate', {
                prompt: 'The hero, side view.', provider: 'my-or', reference_images: [{ storage_key: made }],
            });
            assert(!second.isError, `reuse refused: ${second.text}`);
            assert(second.data.reference_count === 1, `reference_count ${second.data.reference_count}`);
            const refs = (stub.lastRequest('images')!.json as any)?.input_references;
            assert(Array.isArray(refs) && bytesOfDataUrl(refs[0].image_url.url)?.equals(ANSWER), 'the reference is the picture the agent made');
        });

        await test('3b. The same agent cannot name its owner\'s own files: alice\'s sheet is not found for it, and nothing is sent', async () => {
            const heard = stub.requestsFor('images').length;
            const r = await callTool(s, 'aimeat_image_generate', { prompt: 'x', provider: 'my-or', reference_images: [{ storage_key: 'comic/sheet.png' }] });
            assert(r.isError && /NOT_FOUND/.test(r.text), `expected NOT_FOUND, got ${r.text.slice(0, 200)}`);
            assert(stub.requestsFor('images').length === heard, 'nothing was sent');
        });

        await test('3c. Another agent of the same owner cannot reuse the first agent\'s picture', async () => {
            const other = await makeAgent(BASE, alice, ['ai:use']);
            const so = await openSession(BASE, other.token, 'image-refs-other');
            const r = await callTool(so, 'aimeat_image_generate', { prompt: 'x', provider: 'my-or', reference_images: [{ storage_key: made }] });
            assert(r.isError && /NOT_FOUND/.test(r.text), `expected NOT_FOUND, got ${r.text.slice(0, 200)}`);
        });

        // A public picture as a stranger reads it: 200 only once it is public.
        const anonPicture = (url: string) => fetch(url.startsWith('http') ? url : `${BASE}${url}`);
        const sameBytes = async (res: Response) => Buffer.from(await res.arrayBuffer()).equals(ANSWER);

        await test('3d. Gate off (the code default): an agent\'s public picture is public at once, on REST and over MCP', async () => {
            const r = await image(agent.token, { provider: 'my-or', public: true });
            assert(r.status === 200 && r.body.data.visibility === 'public' && !r.body.data.publish_request, `REST: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data?.visibility)}`);
            const anon = await anonPicture(r.body.data.url);
            assert(anon.status === 200 && await sameBytes(anon), `anonymous read of the REST picture ${anon.status}`);
            const m = await callTool(s, 'aimeat_image_generate', { prompt: 'The hero, waving.', provider: 'my-or', public: true });
            assert(!m.isError && m.data.visibility === 'public' && !m.data.publish_request, `MCP: ${m.text.slice(0, 200)}`);
            assert((await anonPicture(m.data.url)).status === 200, 'anonymous read of the MCP picture');
        });

        // ── Phase 4 ──
        // The same node, started again with AIMEAT_PUBLISH_GATE=agents. A picture asked public by an
        // agent without publish:public was stored public at once while every other public write of
        // the same agent waited for the owner (secaudit 2026-10, ai-image public picture past the
        // publish gate). It is stored private now, with a file request the owner approves.
        console.log('\nPhase 4: the publish gate on (AIMEAT_PUBLISH_GATE=agents)');
        await stopNode(node);
        node = await startNode(stub, { AIMEAT_PUBLISH_GATE: 'agents' });
        const publisher = await makeAgent(BASE, alice, ['ai:use', 'publish:public']);
        const approve = (id: string) => json(`/v1/publish-requests/${id}/decision`, alice.token, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) });

        await test('4a. REST: an agent without publish:public gets a private picture, 202 with a file request; approval makes it public', async () => {
            const r = await image(agent.token, { provider: 'my-or', public: true });
            assert(r.status === 202, `expected 202, got ${r.status}: ${JSON.stringify(r.body?.error ?? r.body?.data?.visibility)}`);
            const d = r.body.data;
            assert(d.visibility === 'private', `stored as ${d.visibility}`);
            const pr = d.publish_request;
            assert(pr && pr.kind === 'file' && pr.status === 'awaiting_owner' && typeof pr.approve_url === 'string', `request: ${JSON.stringify(pr)}`);
            assert(typeof d.url === 'string' && d.url.startsWith('/v1/pub/'), `the url is the address the approval opens: ${d.url}`);
            assert(r.body.meta?.provenance?.record?.attestation?.contentHash, 'the picture still has its provenance record');
            assert(typeof d.usage?.cost_usd === 'number', `cost reported: ${JSON.stringify(d.usage)}`);
            const before = await anonPicture(d.url);
            assert(before.status !== 200, `anyone reads the picture before the owner approved: ${before.status}`);
            const signed = await anonPicture(d.download_url);
            assert(signed.status === 200 && await sameBytes(signed), `the signed download_url loads it now: ${signed.status}`);
            const ok = await approve(pr.request_id);
            assert(ok.status === 200 && ok.body.data.request.state === 'approved', `approve: ${ok.status} ${JSON.stringify(ok.body?.error ?? ok.body?.data)}`);
            const after = await anonPicture(d.url);
            assert(after.status === 200 && await sameBytes(after), `anonymous read after approval: ${after.status}`);
        });

        await test('4b. MCP: aimeat_image_generate by the same agent stores it private with a file request; approval makes it public', async () => {
            const s4 = await openSession(BASE, agent.token, 'image-refs-gated');
            const m = await callTool(s4, 'aimeat_image_generate', { prompt: 'The hero, waving.', provider: 'my-or', public: true });
            assert(!m.isError, `refused: ${m.text.slice(0, 200)}`);
            assert(m.data.visibility === 'private' && m.data.publish_request?.kind === 'file', `answer: ${m.text.slice(0, 300)}`);
            assert(String(m.data.url).includes('/v1/pub/'), `the url is the address the approval opens: ${m.data.url}`);
            assert((await anonPicture(m.data.url)).status !== 200, 'anyone reads the picture before the owner approved');
            const ok = await approve(m.data.publish_request.request_id);
            assert(ok.status === 200, `approve: ${ok.status} ${JSON.stringify(ok.body?.error)}`);
            const after = await anonPicture(m.data.url);
            assert(after.status === 200 && await sameBytes(after), `anonymous read after approval: ${after.status}`);
        });

        await test('4c. An agent holding publish:public gets a public picture at once, as its upload would be', async () => {
            const r = await image(publisher.token, { provider: 'my-or', public: true });
            assert(r.status === 200 && r.body.data.visibility === 'public' && !r.body.data.publish_request, `${r.status}: ${JSON.stringify(r.body?.error ?? r.body?.data?.visibility)}`);
            assert((await anonPicture(r.body.data.url)).status === 200, 'anonymous read of the public picture');
        });

        await test('4d. The owner in person still gets a public picture at once, and nothing is asked', async () => {
            const r = await image(alice.token, { provider: 'my-or', public: true });
            assert(r.status === 200 && r.body.data.visibility === 'public' && !r.body.data.publish_request, `${r.status}: ${JSON.stringify(r.body?.error ?? r.body?.data?.visibility)}`);
            const anon = await anonPicture(r.body.data.url);
            assert(anon.status === 200 && await sameBytes(anon), `anonymous read ${anon.status}`);
        });

        await test('4f. A picture\'s request with no record to join stands alone, as before: its own notification and item, no link', async () => {
            const r = await image(agent.token, { provider: 'my-or', public: true });
            assert(r.status === 202, `expected 202, got ${r.status}`);
            const id = r.body.data.publish_request.request_id;
            const one = await json(`/v1/publish-requests/${id}`, alice.token);
            assert(one.status === 200 && !one.body.data.request.part_of && !one.body.data.request.parts, `request: ${JSON.stringify(one.body?.data?.request ?? one.body?.error)}`);
            const notifs = (await json('/v1/notifications?limit=200', alice.token)).body.data.notifications as any[];
            const mine = notifs.filter(n => (n.actions ?? []).some((a: any) => String(a.endpoint ?? '').includes(`/v1/publish-requests/${id}/decision`)));
            assert(mine.length === 1 && mine[0].i18n?.key === 'publish_request', `its own notification: ${JSON.stringify(mine.map(n => n.i18n))}`);
            const items = (await json('/v1/open-items', alice.token)).body.data.items as any[];
            assert(items.some(i => i.object?.type === 'publish-request' && i.object?.id === id), 'its own list item');
            assert((await json(`/v1/publish-requests/${id}/decision`, alice.token, { method: 'POST', body: JSON.stringify({ decision: 'decline' }) })).status === 200, 'decline');
            assert((await anonPicture(r.body.data.url)).status !== 200, 'a declined picture is readable');
        });

        await test('4e. A private picture is unchanged: 200, private, a download_url, no request', async () => {
            const r = await image(agent.token, { provider: 'my-or' });
            assert(r.status === 200 && r.body.data.visibility === 'private' && !r.body.data.publish_request, `${r.status}: ${JSON.stringify(r.body?.error ?? r.body?.data?.visibility)}`);
            assert(typeof r.body.data.download_url === 'string' && r.body.data.url.startsWith('/v1/storage/'), `answer ${JSON.stringify(r.body.data)}`);
        });
    } finally {
        await stopNode(node);
        await stub.close();
    }

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
