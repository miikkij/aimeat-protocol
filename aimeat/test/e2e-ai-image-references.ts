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
 *   - Phase 3: an agent over MCP, reusing a picture it made
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ai-image-references
 * @version-history
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

async function startNode(stub: FakeAiProvider): Promise<ChildProcess> {
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
    const node = await startNode(stub);

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
    } finally {
        await stopNode(node);
        await stub.close();
    }

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
