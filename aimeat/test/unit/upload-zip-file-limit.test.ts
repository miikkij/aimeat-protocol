/**
 * @file test/unit/upload-zip-file-limit.test.ts
 * @description Locks the file cap of the presigned extension ZIP. It was a fixed 50, so an extension
 *   built from a route table (one script per action) with 130 actions, 131 files with its manifest,
 *   was refused with "ZIP contains more than 50 files" although each script was within its size cap
 *   and the inline install door has no file cap. The cap is now config.extensionZipMaxFiles
 *   (AIMEAT_EXT_ZIP_MAX_FILES, default 1000), and a refusal names the setting.
 * @usage cd aimeat && pnpm exec vitest run test/unit/upload-zip-file-limit.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-06 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { deflateRawSync, crc32 } from 'node:zlib';
import { parseExtensionZip, DEFAULT_ZIP_MAX_FILES } from '../../src/services/upload-zip.js';
import type { AimeatConfig } from '../../src/config.js';

const baseConfig = {
    extensionMaxCodeSizeKb: 256,
    extensionMaxMemoryMb: 64,
    extensionTimeoutMs: 30_000,
    extensionMaxApiCalls: 20,
} as unknown as AimeatConfig;

/** Minimal deflated ZIP writer, the same fixture shape as extension-manifest-parity.test.ts. */
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

/** An extension with `n` actions, one script each, as a route-table build emits it. */
function routeTableExtension(n: number): Record<string, string> {
    const ids = Array.from({ length: n }, (_, i) => `a${String(i).padStart(3, '0')}`);
    const actions = ids.map((id) => `  - id: ${id}
    method: post
    path: /${id}
    script: ${id}.js
    input: { type: object }
    output: { type: object }`).join('\n');
    const files: Record<string, string> = {
        'manifest.yaml': `metadata:
  name: routetable
  version: "1.0.0"
  description: "One script per action"
  author: alice
actions:
${actions}
`,
    };
    for (const id of ids) {
        files[`scripts/${id}.js`] = `const SPEC = { path: '/${id}' };\nexport default async function (ctx, input) { return { ok: true, path: SPEC.path }; }`;
    }
    return files;
}

describe('presigned extension ZIP file cap', () => {
    it('installs a 130-action extension (131 files) under the default cap', async () => {
        const parsed = await parseExtensionZip(makeZip(routeTableExtension(130)), baseConfig, 'alice');
        expect(parsed.error).toBeUndefined();
        expect(parsed.ok).toBe(true);
        expect(parsed.record?.actions).toHaveLength(130);
    });

    it('defaults to 1000 files when the setting is absent', () => {
        expect(DEFAULT_ZIP_MAX_FILES).toBe(1000);
    });

    it('refuses a ZIP over the configured cap and names the setting', async () => {
        const config = { ...baseConfig, extensionZipMaxFiles: 50 } as unknown as AimeatConfig;
        const parsed = await parseExtensionZip(makeZip(routeTableExtension(50)), config, 'alice');
        expect(parsed.ok).toBe(false);
        expect(parsed.error).toContain('more than 50 files');
        expect(parsed.error).toContain('AIMEAT_EXT_ZIP_MAX_FILES');
    });

    it('takes exactly the cap', async () => {
        const config = { ...baseConfig, extensionZipMaxFiles: 50 } as unknown as AimeatConfig;
        const parsed = await parseExtensionZip(makeZip(routeTableExtension(49)), config, 'alice');
        expect(parsed.ok).toBe(true);
    });
});
