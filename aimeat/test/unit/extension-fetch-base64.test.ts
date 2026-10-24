/**
 * @file test/unit/extension-fetch-base64.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An extension reads a binary answer intact with `ctx.fetch(url, { responseType: 'base64' })`.
 *   The case that asked for it: Metsähallitus publishes each state hunting area's boundary only as a
 *   Garmin `.img` file on a public S3 bucket with no CORS, and ctx.fetch decoded every answer as
 *   UTF-8, so a 48 128-byte file came back as a 47 340-character string with U+FFFD where the bytes
 *   had been (jussil's riistakartta extension, support thread 2026-10-24). Proven here against the
 *   real ctx builder and the real sandbox:
 *     - the bytes come back exactly, as base64, with `text` empty, under the same ceiling;
 *     - `gunzip: true` inflates first, as it does for text;
 *     - an option the node does not know is refused by name rather than ignored;
 *     - what the node put into the request is removed from the bytes as it is from text;
 *     - the option travels through the sandbox bridge.
 *   FIRST FAIL: against the tree before this change `responseType` is ignored, so the answer has no
 *   `base64` and its `text` is the lossy decode, and `arraybuffer` is accepted without a word.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-fetch-base64.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (jussil riistakartta, support thread 1ac0a199).
 */
import { describe, it, expect, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

/** What the far side answers next. */
let answer: () => Response = () => new Response('');

vi.mock('../../src/utils/url-validator.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/url-validator.js')>();
    return { ...actual, safeFetch: vi.fn(async () => answer()) };
});

const { buildExtensionCtx } = await import('../../src/services/extension-ctx.js');
const { executeExtensionAction } = await import('../../src/services/extension-runtime.js');
const { scrubBytes, scrubFormsOf, SCRUB_PLACEHOLDER } = await import('../../src/services/extension-fetch-scrub.js');

const config = {
    nodeId: 'node-1', encryptionKey: null, totpSecretEncryptionKey: null,
    extensionMaxMemoryMb: 64, extensionTimeoutMs: 10_000, extensionMaxApiCalls: 10,
} as unknown as AimeatConfig;
const limits = { memoryMb: 64, timeoutMs: 10_000, maxApiCalls: 10 };
const URL_IMG = 'https://era-static.example/media/6643_parkano_garmin_kartta.img';

/** Every byte value, many times over: invalid UTF-8 at almost every position. */
const IMG = Buffer.from(Array.from({ length: 48_128 }, (_, i) => (i * 7 + (i >> 8)) & 0xff));

const bin = (bytes: Buffer, status = 200) => new Response(new Uint8Array(bytes), { status, headers: { 'content-type': 'application/octet-stream' } });

const ctxWith = (fetchMaxBytes?: number) => buildExtensionCtx({
    capabilities: { network: true, ai: false, email: false, payments: false, declared: true, ...(fetchMaxBytes ? { fetchMaxBytes } : {}) },
    config, storage: {} as Storage, extMemoryOwner: 'ext:riistakartta',
    caller: { gaii: 'alice@node-1', owner: 'alice', roles: ['owner'] }, extConfig: {}, logPrefix: '[ext:riistakartta]',
});

describe('ctx.fetch with responseType: base64', () => {
    it('answers the bytes exactly, as base64, with text empty', async () => {
        answer = () => bin(IMG);
        const res = await ctxWith().fetch(URL_IMG, { responseType: 'base64' });
        expect(res.ok).toBe(true);
        expect(res.text).toBe('');
        expect(typeof res.base64).toBe('string');
        expect(Buffer.from(res.base64!, 'base64').equals(IMG)).toBe(true);
    });

    it('without the option the answer is text, as before, and carries no base64', async () => {
        answer = () => bin(IMG);
        const res = await ctxWith().fetch(URL_IMG);
        expect('base64' in res).toBe(false);
        expect(Buffer.from(res.text, 'utf8').equals(IMG)).toBe(false);
        answer = () => bin(IMG);
        const asText = await ctxWith().fetch(URL_IMG, { responseType: 'text' });
        expect(asText.text).toBe(res.text);
    });

    it('a non-ok answer still comes back, status and bytes', async () => {
        answer = () => bin(Buffer.from('<Error><Code>NoSuchKey</Code></Error>'), 404);
        const res = await ctxWith().fetch(URL_IMG, { responseType: 'base64' });
        expect(res.status).toBe(404);
        expect(Buffer.from(res.base64!, 'base64').toString('utf8')).toContain('NoSuchKey');
    });

    it('gunzip inflates before the bytes are encoded', async () => {
        answer = () => bin(gzipSync(IMG));
        const res = await ctxWith().fetch(URL_IMG, { responseType: 'base64', gunzip: true });
        expect(Buffer.from(res.base64!, 'base64').equals(IMG)).toBe(true);
    });

    it('reads under the same ceiling: past it the call throws RESPONSE_TOO_LARGE', async () => {
        answer = () => bin(Buffer.alloc(5 * 1024 * 1024, 0xff));
        const failure = await ctxWith().fetch(URL_IMG, { responseType: 'base64' }).then(() => null, (err: Error) => err);
        expect(failure?.message ?? 'ctx.fetch answered').toMatch(/^RESPONSE_TOO_LARGE: The answer from era-static\.example is larger than 4 MB/);
    });

    it('refuses a responseType it does not know, naming the two it does', async () => {
        answer = () => bin(IMG);
        for (const bad of ['arraybuffer', 'latin1', 42]) {
            const failure = await ctxWith().fetch(URL_IMG, { responseType: bad as never }).then(() => null, (err: Error) => err);
            expect(failure?.message ?? `ctx.fetch accepted ${String(bad)}`).toMatch(/^Fetch refused: responseType .* 'text' or 'base64'/);
        }
    });

    it('the option travels through the sandbox bridge', async () => {
        answer = () => bin(IMG);
        const script = `export default async function (ctx) {
            const res = await ctx.fetch('${URL_IMG}', { responseType: 'base64' });
            return { status: res.status, text: res.text, base64: res.base64 };
        }`;
        const out = await executeExtensionAction(script, ctxWith(), {}, limits);
        expect(out.status).toBe(200);
        expect(out.text).toBe('');
        expect(Buffer.from(out.base64, 'base64').equals(IMG)).toBe(true);
    });
});

describe('scrubBytes', () => {
    it('removes every form of an inserted value from binary bytes and leaves the rest as it was', () => {
        const secret = 'sk-live-0123456789abcdef';
        const forms = scrubFormsOf([secret]);
        const head = Buffer.from([0x00, 0xff, 0xfe]);
        const tail = Buffer.from([0x80, 0x81, 0x00]);
        const echoed = Buffer.concat([head, Buffer.from(`key=${secret};b64=${Buffer.from(secret).toString('base64')}`), tail]);
        const out = scrubBytes(echoed, forms);
        expect(out.includes(Buffer.from(secret))).toBe(false);
        expect(out.includes(Buffer.from(Buffer.from(secret).toString('base64')))).toBe(false);
        expect(out.subarray(0, 3).equals(head)).toBe(true);
        expect(out.subarray(out.length - 3).equals(tail)).toBe(true);
        expect(out.toString('latin1')).toContain(`key=${SCRUB_PLACEHOLDER}`);
    });

    it('hands back the same buffer when there is nothing to remove', () => {
        expect(scrubBytes(IMG, [])).toBe(IMG);
        expect(scrubBytes(IMG, scrubFormsOf(['not-in-there-anywhere']))).toEqual(IMG);
    });
});
