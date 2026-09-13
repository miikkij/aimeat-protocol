/**
 * @file cortex-manifest.test.ts
 * @description parseCortexManifest on a lib component whose discovery fields have the wrong shape.
 *   `api_surface` written as a YAML list of {name, signature} objects reached `apiSurface.trim()` and
 *   threw a TypeError, so the install failed as a processing error that named no field; a non-list
 *   `exports` was silently read as "no exports". Both are the author's mistake and must come back as
 *   a validation error naming the field (appdev pitfall cortex/cortex-manifest-field-names-and-serve-path,
 *   2026-09-13).
 * @usage pnpm exec vitest run test/unit/cortex-manifest.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial: api_surface must be a string, exports a list of strings.
 */
import { describe, it, expect } from 'vitest';
import { parseCortexManifest } from '../../src/services/cortex-manifest.js';

function manifestWithLib(libFields: string[]): string {
    return [
        'apiVersion: cortex.aimeat.org/v1',
        'kind: Extension',
        'metadata:',
        '  name: laake',
        '  namespace: alice',
        'spec:',
        '  version: 1.0.0',
        '  components:',
        '    - type: lib',
        '      name: laake',
        '      filename: laake.js',
        ...libFields.map(l => `      ${l}`),
    ].join('\n');
}

describe('parseCortexManifest: lib discovery fields', () => {
    it('refuses api_surface written as a list, naming the field, instead of throwing', () => {
        const yaml = manifestWithLib([
            'exports: [lookup]',
            'api_surface:',
            '  - name: lookup',
            '    signature: lookup(id)',
        ]);
        const out = parseCortexManifest(yaml, 'alice', { 'laake.js': '(function(){})();' });
        expect(out.ok).toBe(false);
        expect(out.errors?.join('\n')).toMatch(/components\[0\]: api_surface must be a string/);
    });

    it('refuses exports that is not a list of strings', () => {
        const asString = parseCortexManifest(manifestWithLib(['exports: lookup', 'api_surface: lookup(id)']), 'alice');
        expect(asString.ok).toBe(false);
        expect(asString.errors?.join('\n')).toMatch(/components\[0\]: exports must be a list of strings/);

        const withObject = parseCortexManifest(manifestWithLib(['exports: [{ name: lookup }]', 'api_surface: lookup(id)']), 'alice');
        expect(withObject.ok).toBe(false);
        expect(withObject.errors?.join('\n')).toMatch(/exports must be a list of strings/);
    });

    it('still installs a lib with a block-scalar api_surface and a list of exports', () => {
        const out = parseCortexManifest(manifestWithLib([
            'exports: [lookup]',
            'api_surface: |',
            '  AIMEAT.laake.lookup(id) -> { name } | null',
        ]), 'alice');
        expect(out.ok).toBe(true);
        const lib = out.extension?.components[0] as { exports: string[]; api_surface: string };
        expect(lib.exports).toEqual(['lookup']);
        expect(lib.api_surface).toContain('AIMEAT.laake.lookup');
    });

    it('keeps missing exports and api_surface as warnings, as before', () => {
        const out = parseCortexManifest(manifestWithLib([]), 'alice');
        expect(out.ok).toBe(true);
        expect(out.warnings?.join('\n')).toMatch(/declares no exports/);
        expect(out.warnings?.join('\n')).toMatch(/has no api_surface/);
    });
});
