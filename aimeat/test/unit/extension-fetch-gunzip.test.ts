/**
 * @file test/unit/extension-fetch-gunzip.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An extension reads a gzipped answer, and reads one answer under its own ceiling.
 *   The case that asked for it: a national TV guide (XMLTV) is served only as `.xml.gz`, 1 MB on
 *   the wire and 6.5 MB inflated, and ctx.fetch read text under 4 MB with no inflate. Two additions
 *   are proven here against the real ctx builder and the real sandbox:
 *     - `ctx.fetch(url, { gunzip: true })` inflates before it decodes, under the ceiling in force,
 *       and a plain answer under the same flag comes back as it is;
 *     - a manifest's `limits.fetch_max_mb` becomes `limits.fetchMaxBytes` on the record (clamped to
 *       EXTENSION_FETCH_MAX_BYTES_CEILING, a non-positive value refused), rides the capability set,
 *       and is the ceiling ctx.fetch reads under; RESPONSE_TOO_LARGE names that ceiling.
 *   FIRST FAIL: against the tree before this change the inflate test reads the gzip bytes as text
 *   (a string of mojibake the length of the compressed body), the 6 MB answer under an 8 MB
 *   ceiling throws RESPONSE_TOO_LARGE naming 4 MB, and the manifest's limit is dropped.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-fetch-gunzip.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-tv-opas-ilmaisstreameille-ja-oma-tv-kalenteri).
 */
import { describe, it, expect, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const MB = 1024 * 1024;

/** What the far side answers next. */
let answer: () => Response = () => new Response('');

vi.mock('../../src/utils/url-validator.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/url-validator.js')>();
    return { ...actual, safeFetch: vi.fn(async () => answer()) };
});

const { EXTENSION_FETCH_MAX_BYTES_CEILING, OUTBOUND_READ_MAX_BYTES, inflateCapped, isGzip } = await import('../../src/utils/read-capped.js');
const { buildExtensionCtx } = await import('../../src/services/extension-ctx.js');
const { executeExtensionAction } = await import('../../src/services/extension-runtime.js');
const { buildExtensionRecordFromManifest } = await import('../../src/services/extension-manifest.js');
const { capabilitiesOfRecord } = await import('../../src/services/extension-capability-declaration.js');

const config = {
    nodeId: 'node-1', encryptionKey: null, totpSecretEncryptionKey: null,
    extensionMaxMemoryMb: 64, extensionTimeoutMs: 10_000, extensionMaxApiCalls: 10,
} as unknown as AimeatConfig;
const limits = { memoryMb: 64, timeoutMs: 10_000, maxApiCalls: 10 };
const URL_GUIDE = 'https://guide.example/epg_FI.xml.gz';

/** An XMLTV document a little over 6 MB, the size of a national guide inflated. */
const PROGRAMME = '<programme start="20261009180000 +0300" stop="20261009190000 +0300" channel="YLE.TV1.fi"><title lang="fi">Uutiset</title><desc lang="fi">Päivän uutiset ja sää.</desc></programme>\n';
const GUIDE_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n' + PROGRAMME.repeat(Math.ceil((6 * MB) / Buffer.byteLength(PROGRAMME))) + '</tv>\n';
const GUIDE_GZ = gzipSync(Buffer.from(GUIDE_XML));
/** A gzip bomb: 48 MB of zeros, under 50 kB on the wire. */
const BOMB_GZ = gzipSync(Buffer.alloc(48 * MB));

const gz = (bytes: Buffer) => new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'application/octet-stream' } });

const ctxWith = (fetchMaxBytes?: number) => buildExtensionCtx({
    capabilities: { network: true, ai: false, email: false, payments: false, declared: true, ...(fetchMaxBytes ? { fetchMaxBytes } : {}) },
    config, storage: {} as Storage, extMemoryOwner: 'ext:guide',
    caller: { gaii: 'alice@node-1', owner: 'alice', roles: ['owner'] }, extConfig: {}, logPrefix: '[ext:guide]',
});

describe('inflateCapped', () => {
    it('inflates gzip under the ceiling, answers null past it, and hands back plain bytes as they are', () => {
        expect(isGzip(GUIDE_GZ)).toBe(true);
        expect(inflateCapped(GUIDE_GZ, 8 * MB)?.toString('utf8')).toBe(GUIDE_XML);
        expect(inflateCapped(GUIDE_GZ, 4 * MB)).toBeNull();
        expect(inflateCapped(BOMB_GZ, 8 * MB)).toBeNull();
        const plain = Buffer.from('<tv/>');
        expect(inflateCapped(plain, 8 * MB)).toBe(plain);
    });

    it('the ceiling a manifest may ask for is one exported number, 32 MB, above the 4 MB default', () => {
        expect(EXTENSION_FETCH_MAX_BYTES_CEILING).toBe(32 * MB);
        expect(EXTENSION_FETCH_MAX_BYTES_CEILING).toBeGreaterThan(OUTBOUND_READ_MAX_BYTES);
    });
});

describe('ctx.fetch with gunzip', () => {
    it('inflates a gzipped guide under the extension\'s own ceiling and decodes it as UTF-8', async () => {
        answer = () => gz(GUIDE_GZ);
        const res = await ctxWith(8 * MB).fetch(URL_GUIDE, { gunzip: true });
        expect(res.ok).toBe(true);
        expect(res.text.length).toBe(GUIDE_XML.length);
        expect(res.text.startsWith('<?xml')).toBe(true);
        expect(res.text).toContain('Päivän uutiset ja sää');
    });

    it('under the default ceiling the same guide is refused once inflated, and the refusal names 4 MB', async () => {
        answer = () => gz(GUIDE_GZ);
        const failure = await ctxWith().fetch(URL_GUIDE, { gunzip: true }).then(() => null, (err: Error) => err);
        expect(failure?.message ?? 'ctx.fetch answered').toMatch(/^RESPONSE_TOO_LARGE: The answer from guide\.example is larger than 4 MB, .* once inflated\./);
        expect(failure?.message).toContain('limits.fetch_max_mb');
    });

    it('a gzip bomb stops at the ceiling, however small it was on the wire', async () => {
        answer = () => gz(BOMB_GZ);
        const failure = await ctxWith(8 * MB).fetch(URL_GUIDE, { gunzip: true }).then(() => null, (err: Error) => err);
        expect(failure?.message ?? 'ctx.fetch answered').toMatch(/^RESPONSE_TOO_LARGE: .* 8 MB, .* once inflated\./);
    });

    it('without the flag the gzip bytes are not inflated, and with the flag a plain answer is read as it is', async () => {
        answer = () => gz(GUIDE_GZ);
        const raw = await ctxWith(8 * MB).fetch(URL_GUIDE);
        expect(raw.text.startsWith('<?xml')).toBe(false);
        answer = () => new Response('<tv/>', { status: 404, headers: { 'content-type': 'application/xml' } });
        const plain = await ctxWith(8 * MB).fetch(URL_GUIDE, { gunzip: true });
        expect(plain.status).toBe(404);
        expect(plain.text).toBe('<tv/>');
    });

    it('the flag travels through the sandbox bridge: a script inflates the guide and reads it', async () => {
        answer = () => gz(GUIDE_GZ);
        const script = `export default async function (ctx) {
            const res = await ctx.fetch('${URL_GUIDE}', { gunzip: true });
            return { length: res.text.length, programmes: (res.text.match(/<programme /g) || []).length };
        }`;
        const out = await executeExtensionAction(script, ctxWith(8 * MB), {}, limits);
        expect(out.length).toBe(GUIDE_XML.length);
        expect(out.programmes).toBe(Math.ceil((6 * MB) / Buffer.byteLength(PROGRAMME)));
    });
});

describe('a manifest\'s limits.fetch_max_mb', () => {
    const manifest = (fetchMaxMb: unknown) => JSON.stringify({
        metadata: { name: 'guide', version: '1.0.0', description: 'guide', author: 't' },
        capabilities: ['network'],
        limits: { fetch_max_mb: fetchMaxMb },
        actions: [{ id: 'pull', method: 'POST', path: '/pull', script: 'pull' }],
    });
    const scripts = { pull: 'export default async function (ctx) { return {}; }' };
    const build = (mb: unknown) => buildExtensionRecordFromManifest(manifest(mb), scripts, config, 'alice', '2026-10-09T00:00:00Z');

    it('is stored in bytes on the record and rides the capability set ctx.fetch reads under', () => {
        const out = build(16);
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.record.limits.fetchMaxBytes).toBe(16 * MB);
        expect(capabilitiesOfRecord(out.record).fetchMaxBytes).toBe(16 * MB);
    });

    it('is clamped to the node\'s ceiling, and absent when the manifest names none', () => {
        const big = build(999);
        expect(big.ok && big.record.limits.fetchMaxBytes).toBe(EXTENSION_FETCH_MAX_BYTES_CEILING);
        const none = buildExtensionRecordFromManifest(JSON.stringify({ ...JSON.parse(manifest(1)), limits: undefined }), scripts, config, 'alice', '2026-10-09T00:00:00Z');
        expect(none.ok && 'fetchMaxBytes' in none.record.limits).toBe(false);
        expect(none.ok && capabilitiesOfRecord(none.record).fetchMaxBytes).toBeUndefined();
    });

    it('refuses a value that is not a positive number, naming the field', () => {
        for (const bad of [-1, 0, 'big', NaN]) {
            const out = build(bad);
            expect(out.ok).toBe(false);
            if (out.ok) continue;
            expect(out.status).toBe(400);
            expect(out.message).toContain('limits.fetch_max_mb');
        }
    });
});
