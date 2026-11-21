/**
 * @file test/unit/gate-text-tests.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate selects a unit test that READS a changed file (scripts/lib/gate-text-tests.ts),
 *   which `vitest --changed` cannot see (docs/pitfalls.md §108 until 2026-11-21). A fixture tree holds
 *   tests that name a file by a relative URL, by an aimeat-relative path, by a folder and by a tail.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { testsNamingChanged } from '../../scripts/lib/gate-text-tests.js';

const repo = mkdtempSync(join(tmpdir(), 'aimeat-gate-text-'));
const aimeat = join(repo, 'aimeat');
afterAll(() => rmSync(repo, { recursive: true, force: true }));

function put(path: string, text: string): void {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
}
put('aimeat/test/unit/recipe.test.ts', "readFileSync(new URL('../../src/static/sdk-libs/atelier/describe-data.js', import.meta.url));");
put('aimeat/test/unit/packs.test.ts', "const dir = fileURLToPath(new URL('../../public/cortex-bundled/', import.meta.url));");
put('aimeat/test/unit/plain.test.ts', "readFileSync(join(AIMEAT, 'src/data/public-pages.ts'));");
put('aimeat/test/unit/tail.test.ts', '// holds the spec to sdk-libs/living/describe-data.js');
put('aimeat/test/unit/spec.test.ts', "readFileSync(new URL('../../../openapi.yaml', import.meta.url));");
put('aimeat/test/unit/unrelated.test.ts', "import { x } from '../../src/services/x.js'; // index.ts");
put('aimeat/src/services/__tests__/inner.test.ts', "readFileSync('src/services/board-ttl.ts');");

describe('the gate runs the unit tests that read a changed file', () => {
    it('selects a test that reads the file by a relative URL', () => {
        expect(testsNamingChanged(aimeat, ['aimeat/src/static/sdk-libs/atelier/describe-data.js'])).toEqual(['test/unit/recipe.test.ts']);
    });
    it('selects a test that reads the folder the file is in', () => {
        expect(testsNamingChanged(aimeat, ['aimeat/public/cortex-bundled/aimeat-dag.js'])).toEqual(['test/unit/packs.test.ts']);
    });
    it('selects by an aimeat-relative path, a tail, a file above aimeat/, and inside src/**/__tests__', () => {
        expect(testsNamingChanged(aimeat, ['aimeat/src/data/public-pages.ts'])).toEqual(['test/unit/plain.test.ts']);
        expect(testsNamingChanged(aimeat, ['aimeat/src/static/sdk-libs/living/describe-data.js'])).toEqual(['test/unit/tail.test.ts']);
        expect(testsNamingChanged(aimeat, ['openapi.yaml'])).toEqual(['test/unit/spec.test.ts']);
        expect(testsNamingChanged(aimeat, ['aimeat/src/services/board-ttl.ts'])).toEqual(['src/services/__tests__/inner.test.ts']);
    });
    it('selects nothing for a file no test names, for a bare file name, or for a top folder alone', () => {
        expect(testsNamingChanged(aimeat, ['aimeat/src/routes/memory.ts'])).toEqual([]);
        expect(testsNamingChanged(aimeat, ['aimeat/src/index.ts'])).toEqual([]);
        expect(testsNamingChanged(aimeat, [])).toEqual([]);
    });
    it('leaves a changed test file to vitest --changed', () => {
        expect(testsNamingChanged(aimeat, ['aimeat/test/unit/recipe.test.ts'])).toEqual([]);
    });
});
