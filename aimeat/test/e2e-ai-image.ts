/**
 * @file e2e-ai-image.ts
 * @description E2E tests for POST /v1/ai/image — image generation on the owner's key.
 *
 *   CI has no OpenRouter key, so no image is ever generated here and none of what follows pretends
 *   otherwise. What it does test is everything in FRONT of the provider, which is where the
 *   decisions live: who may ask, what happens with no model configured, what happens with no key,
 *   and that a refusal names itself instead of arriving as a 500. Those gates run in the same order
 *   for every AI capability on this node, and getting one of them wrong is how a route ends up
 *   spending someone else's budget.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-ai-image
 * @version-history
 *   v1.0.0 — 2026-08-16 — initial: auth, validation, the unset-model refusal, and the key refusal.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerName = `img${Date.now() % 100000}`;

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
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

async function signMsg(priv: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(priv, 'base64'));
    return Buffer.from(sig).toString('base64');
}

let token = '';
const authed = (o: RequestInit = {}): RequestInit =>
    ({ ...o, headers: { ...((o.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

const generate = (body: unknown) => json('/v1/ai/image', authed({ method: 'POST', body: JSON.stringify(body) }));

console.log('\n=== AI Image Generation E2E Tests ===\n');

await test('Setup: register an owner', async () => {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register status ${reg.status}: ${JSON.stringify(reg.body)}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(priv, ownerName + NODE_ID + ts) }),
    });
    token = tok.body.data?.token as string;
    assert(!!token, 'token issued');
});

await test('An unauthenticated request is refused', async () => {
    const { status } = await json('/v1/ai/image', { method: 'POST', body: JSON.stringify({ prompt: 'a red bicycle' }) });
    assert(status === 401, `unauthenticated is 401, got ${status}`);
});

await test('A missing prompt is refused as INVALID_BODY, before any provider is called', async () => {
    const { status, body } = await generate({});
    assert(status === 400, `missing prompt is 400, got ${status}`);
    assert(body.error?.code === 'INVALID_BODY', `code INVALID_BODY, got ${body.error?.code}`);
});

await test('An over-long prompt is refused locally rather than sent upstream', async () => {
    const { status, body } = await generate({ prompt: 'x'.repeat(5000) });
    assert(status === 400, `over-long prompt is 400, got ${status}`);
    assert(body.error?.code === 'PROMPT_TOO_LONG', `code PROMPT_TOO_LONG, got ${body.error?.code}`);
});

await test('With no image model configured it refuses by name, not by falling back to a chat model', async () => {
    // This is the whole reason the refusal exists: a chat model handed an image request answers with
    // prose, and the person is left with an opaque provider error instead of the setting to fill in.
    const { status, body } = await generate({ prompt: 'a red bicycle' });
    assert(status === 400, `unset model is 400, got ${status}: ${JSON.stringify(body.error)}`);
    assert(body.error?.code === 'NO_IMAGE_MODEL', `code NO_IMAGE_MODEL, got ${body.error?.code}`);
    assert(/Profile > OpenRouter/.test(String(body.error?.message)), 'the refusal names where to set it');
});

await test('Setting an image model moves the refusal on to the missing key', async () => {
    const put = await json('/v1/openrouter/settings', authed({
        method: 'PUT', body: JSON.stringify({ imageModel: 'some/image-model' }),
    }));
    assert(put.status === 200, `settings save status ${put.status}: ${JSON.stringify(put.body)}`);

    const read = await json('/v1/openrouter/settings', authed());
    assert(read.body.data?.imageModel === 'some/image-model', `imageModel round-trips, got ${read.body.data?.imageModel}`);

    // With a model but no key, the next gate in the same order is the key. Reaching it proves the
    // model gate passed rather than that nothing happened.
    const { status, body } = await generate({ prompt: 'a red bicycle' });
    assert(status !== 400 || body.error?.code !== 'NO_IMAGE_MODEL', 'the model gate no longer refuses');
    assert(['NO_API_KEY', 'INVALID_API_KEY', 'PROVIDER_ERROR', 'QUOTA_EXHAUSTED'].includes(body.error?.code),
        `a later gate answers, got ${status} ${body.error?.code}`);
});

await test('Clearing the image model puts the refusal back', async () => {
    const put = await json('/v1/openrouter/settings', authed({
        method: 'PUT', body: JSON.stringify({ imageModel: '' }),
    }));
    assert(put.status === 200, `clear status ${put.status}`);
    const { body } = await generate({ prompt: 'a red bicycle' });
    assert(body.error?.code === 'NO_IMAGE_MODEL', `cleared means unset, got ${body.error?.code}`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
