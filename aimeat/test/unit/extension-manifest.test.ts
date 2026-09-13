/**
 * @file extension-manifest.test.ts
 * @description The extension manifest builder (routes/extensions/manifest.ts) and the package ZIP
 *   manifest parse (services/package-zip.ts), on the two traps appdev builders were told to work
 *   around on 2026-09-13:
 *     - a description with an unquoted `: ` breaks the YAML, and both doors threw the parser's line
 *       and column away, answering "Failed to parse manifest YAML" / "manifest.yaml is not valid YAML";
 *     - a `type: secret` config field written without a `default` was stored as its own descriptor
 *       object, which the sandbox then read as a truthy ctx.config value.
 * @usage pnpm exec vitest run test/unit/extension-manifest.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial: YAML error position on both doors; an unset secret is not stored.
 */
import { describe, it, expect } from 'vitest';
import { ZipArchive } from 'archiver';
import { buildExtensionRecordFromManifest } from '../../src/routes/extensions/manifest.js';
import { parseZip, ZipValidationError } from '../../src/services/package-zip.js';
import { SECRET_KEYS_FIELD } from '../../src/services/extension-secrets.js';
import type { AimeatConfig } from '../../src/config.js';

const config = {
    nodeId: 'test-node',
    extensionMaxCodeSizeKb: 512,
    extensionMaxMemoryMb: 64,
    extensionTimeoutMs: 30_000,
    extensionMaxApiCalls: 100,
    extensionMaxDebitPerCall: 100,
    extensionMaxPayMorsels: 1000,
} as unknown as AimeatConfig;

const SCRIPTS = { 'lookup.js': 'export default async function (ctx, input) { return { ok: true }; }' };

function manifest(extra: string): string {
    return [
        'metadata:',
        '  name: colon-probe',
        '  version: 1.0.0',
        '  description: A probe',
        '  author: alice',
        extra,
        'actions:',
        '  - id: lookup',
        '    method: POST',
        '    path: /lookup',
        '    script: lookup.js',
    ].join('\n');
}

function build(yaml: string) {
    return buildExtensionRecordFromManifest(yaml, SCRIPTS, config, 'alice', '2026-09-13T00:00:00.000Z');
}

async function zipOf(entries: Record<string, string>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const archive = new ZipArchive({ zlib: { level: 0 } });
        const chunks: Buffer[] = [];
        archive.on('data', (d: Buffer) => chunks.push(d));
        archive.on('end', () => resolve(Buffer.concat(chunks)));
        archive.on('error', reject);
        for (const [name, content] of Object.entries(entries)) archive.append(content, { name });
        void archive.finalize();
    });
}

describe('a manifest that is not valid YAML says where', () => {
    it('the extension door names the line and column of the unquoted colon', () => {
        const yaml = [
            'metadata:',
            '  name: colon-probe',
            '  version: 1.0.0',
            '  description: Grid steps per axis: 4-72 for surfaces',
        ].join('\n');
        const out = build(yaml);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.code).toBe('INVALID_MANIFEST');
        expect(out.message).toMatch(/line 4/);
        expect(out.message).toMatch(/column/);
    });

    it('the package ZIP door names the line and column too', async () => {
        const buf = await zipOf({
            'manifest.yaml': 'name: pkg\nauthor: alice\nversion: v1\ndescription: Filter to one group: classic | waves\ncategory: other\n',
        });
        const err = await parseZip(buf, { maxSizeMb: 5 }).then(() => null, (e: unknown) => e);
        expect(err).toBeInstanceOf(ZipValidationError);
        expect((err as ZipValidationError).code).toBe('INVALID_MANIFEST');
        expect((err as ZipValidationError).message).toMatch(/line 4/);
    });
});

describe('a secret config field with no default is not stored as its descriptor', () => {
    it('leaves the value out and keeps the field listed as a secret', () => {
        const out = build(manifest([
            'config:',
            '  apiKey:',
            '    type: secret',
            '    description: The upstream API key',
            '  region:',
            '    type: string',
            '    default: eu',
        ].join('\n')));
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect('apiKey' in out.record.config).toBe(false);
        expect(out.record.config[SECRET_KEYS_FIELD]).toEqual(['apiKey']);
        expect(out.record.config.region).toBe('eu');
    });

    it('still stores a secret that has a default, for the write path to encrypt', () => {
        const out = build(manifest([
            'config:',
            '  apiKey:',
            '    type: secret',
            '    default: sk-test-value',
        ].join('\n')));
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.record.config.apiKey).toBe('sk-test-value');
    });
});
