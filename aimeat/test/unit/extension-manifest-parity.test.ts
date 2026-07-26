/**
 * @file test/unit/extension-manifest-parity.test.ts
 * @description Locks the two properties that let a broken extension install look like a working one.
 *
 *   1. SHAPE ERRORS ARE 400s, NOT CRASHES. Every manifest field the builder later reads as a string
 *      is type-checked first. `(a.method as string).toUpperCase()` used to run unchecked, so a
 *      mis-typed field threw a TypeError out of the builder — and on the presigned ZIP path the
 *      router's catch-all turned that into a bare `500 PROCESSING_FAILED` that never mentioned the
 *      manifest. A malformed manifest is the author's mistake and must be named.
 *
 *   2. THE ZIP PATH BUILDS THE SAME RECORD AS THE INLINE PATH. parseExtensionZip carried its own
 *      thinner copy of the builder, which silently dropped per-action pricing (tollMorsels /
 *      commercial / ODPS) and the `type: secret` config marker — a priced EXCHANGE capability
 *      became a free one purely by being installed as a ZIP. One builder, asserted here on both.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-manifest-parity.test.ts
 * @version-history
 *   v1.0.0 — 2026-07-26 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { deflateRawSync, crc32 } from 'node:zlib';
import { buildExtensionRecordFromManifest } from '../../src/routes/extensions/manifest.js';
import { parseExtensionZip } from '../../src/services/upload-zip.js';
import type { AimeatConfig } from '../../src/config.js';

const config = {
    extensionMaxCodeSizeKb: 512,
    extensionMaxMemoryMb: 64,
    extensionTimeoutMs: 30_000,
    extensionMaxApiCalls: 20,
} as unknown as AimeatConfig;

const SCRIPT = 'export default async function (ctx, input) { return { ok: true }; }';
const SCRIPTS = { 'ping.js': SCRIPT };

/** Minimal deflated ZIP writer — same fixture shape as test/e2e-presigned-meta.ts. */
function makeZip(files: Record<string, string>): Buffer {
    const locals: Buffer[] = [], centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const nameBuf = Buffer.from(name, 'utf8');
        const raw = Buffer.from(content, 'utf8');
        const comp = deflateRawSync(raw);
        const crc = crc32(raw) >>> 0;
        const lf = Buffer.alloc(30);
        lf.writeUInt32LE(0x04034b50, 0); lf.writeUInt16LE(20, 4); lf.writeUInt16LE(0, 6);
        lf.writeUInt16LE(8, 8); lf.writeUInt16LE(0, 10); lf.writeUInt16LE(0, 12);
        lf.writeUInt32LE(crc, 14); lf.writeUInt32LE(comp.length, 18); lf.writeUInt32LE(raw.length, 22);
        lf.writeUInt16LE(nameBuf.length, 26); lf.writeUInt16LE(0, 28);
        const local = Buffer.concat([lf, nameBuf, comp]);
        locals.push(local);
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
        cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24);
        cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
        cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38);
        cd.writeUInt32LE(offset, 42);
        centrals.push(Buffer.concat([cd, nameBuf]));
        offset += local.length;
    }
    const cdBuf = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
    end.writeUInt16LE(centrals.length, 8); end.writeUInt16LE(centrals.length, 10);
    end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
    return Buffer.concat([...locals, cdBuf, end]);
}

const GOOD_MANIFEST = `metadata:
  name: parityext
  version: "1.0.0"
  description: "Parity fixture"
  author: parityowner
actions:
  - id: ping
    method: post
    path: /ping
    script: ping.js
    input: { type: object }
    output: { type: object }
`;

/** A priced EXCHANGE provider — every one of these fields used to vanish on the ZIP path. */
const PRICED_MANIFEST = `metadata:
  name: pricedext
  version: "1.0.0"
  description: "Priced fixture"
  author: parityowner
config:
  apiKey:
    type: secret
    default: ""
actions:
  - id: ping
    method: POST
    path: /ping
    script: ping.js
    tollMorsels: 3
    commercial:
      payMorsels: 10
      exchange: true
      payMoney: { amount: 500000, currency: EUR }
`;

describe('manifest shape validation', () => {
    it('refuses a mis-typed action field with a 400 naming the field, instead of throwing', () => {
        const manifest = GOOD_MANIFEST.replace('method: post', 'method: { a: 1 }');
        const built = buildExtensionRecordFromManifest(manifest, SCRIPTS, config, 'o', 'now');
        expect(built.ok).toBe(false);
        if (built.ok) return;
        expect(built.status).toBe(400);
        expect(built.message).toContain('method');
        expect(built.message).toContain('a map');
    });

    it('refuses a mis-typed metadata field rather than storing a non-string', () => {
        const manifest = GOOD_MANIFEST.replace('description: "Parity fixture"', 'description: { text: a, b }');
        const built = buildExtensionRecordFromManifest(manifest, SCRIPTS, config, 'o', 'now');
        expect(built.ok).toBe(false);
        if (built.ok) return;
        expect(built.message).toContain('metadata.description');
    });

    it('refuses an input schema the YAML turned into a non-map, and points at the comma', () => {
        const manifest = GOOD_MANIFEST.replace('input: { type: object }', 'input: "type: object"');
        const built = buildExtensionRecordFromManifest(manifest, SCRIPTS, config, 'o', 'now');
        expect(built.ok).toBe(false);
        if (built.ok) return;
        expect(built.message).toContain('input');
        expect(built.message).toContain('flow map');
    });

    it('accepts a numeric version (YAML `version: 1.0`) by coercing it to a string', () => {
        const manifest = GOOD_MANIFEST.replace('version: "1.0.0"', 'version: 1.0');
        const built = buildExtensionRecordFromManifest(manifest, SCRIPTS, config, 'o', 'now');
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        expect(typeof built.record.version).toBe('string');
    });

    it('a ZIP with a mis-typed field returns a validation result, never a thrown error', async () => {
        const manifest = GOOD_MANIFEST.replace('method: post', 'method: { a: 1 }');
        const parsed = await parseExtensionZip(makeZip({ 'manifest.yaml': manifest, 'scripts/ping.js': SCRIPT }), config);
        expect(parsed.ok).toBe(false);
        expect(parsed.code).toBe('INVALID_MANIFEST');
        expect(parsed.error).toContain('method');
    });
});

describe('ZIP install builds the same record as the inline install', () => {
    it('carries per-action pricing (tollMorsels, commercial, payMoney, exchange)', async () => {
        const parsed = await parseExtensionZip(makeZip({ 'manifest.yaml': PRICED_MANIFEST, 'scripts/ping.js': SCRIPT }), config);
        expect(parsed.ok).toBe(true);
        const action = parsed.record!.actions[0];
        expect(action.tollMorsels).toBe(3);
        expect(action.commercial?.payMorsels).toBe(10);
        expect(action.commercial?.exchange).toBe(true);
        expect(action.commercial?.payMoney).toEqual({ amount: 500_000, currency: 'EUR' });
    });

    it('marks `type: secret` config so the value is encrypted at rest', async () => {
        const parsed = await parseExtensionZip(makeZip({ 'manifest.yaml': PRICED_MANIFEST, 'scripts/ping.js': SCRIPT }), config);
        expect(parsed.ok).toBe(true);
        expect(parsed.record!.config.__secretKeys).toEqual(['apiKey']);
    });

    it('produces a record identical to the inline builder, field for field', async () => {
        const inline = buildExtensionRecordFromManifest(PRICED_MANIFEST, SCRIPTS, config, 'upload', 'FIXED');
        const parsed = await parseExtensionZip(makeZip({ 'manifest.yaml': PRICED_MANIFEST, 'scripts/ping.js': SCRIPT }), config);
        expect(inline.ok).toBe(true);
        expect(parsed.ok).toBe(true);
        if (!inline.ok) return;
        // installedAt is stamped at build time on each path; everything else must match exactly.
        expect({ ...parsed.record!, installedAt: 'FIXED' }).toEqual(inline.record);
    });

    it('rejects invalid pricing on the ZIP path too (it used to skip the validator entirely)', async () => {
        const manifest = PRICED_MANIFEST.replace('payMorsels: 10', 'payMorsels: -5');
        const parsed = await parseExtensionZip(makeZip({ 'manifest.yaml': manifest, 'scripts/ping.js': SCRIPT }), config);
        expect(parsed.ok).toBe(false);
        expect(parsed.error).toContain('payMorsels');
    });
});
