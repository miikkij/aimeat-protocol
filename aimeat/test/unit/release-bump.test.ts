/**
 * @file test/unit/release-bump.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `pnpm release:bump` writes the version into each file that carries it and nothing else
 *   (the first `"version"` of a package.json, not a dependency's; openapi.yaml's info.version, not a
 *   schema's), refuses a version that is not newer, and picks the unit tests that read the node
 *   version by their text, including the two that turned a bump red (service-summary-form at 4.1.0,
 *   the release-following tests at 3.20.0). Each case runs against the repository's real files.
 * @usage cd aimeat && pnpm exec vitest run test/unit/release-bump.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (wish-one-release-bump-command-that-leaves-main-green).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setPackageVersion, setOpenapiVersion, setServerVersion, isNewer, versionReaders, porcelainPaths } from '../../scripts/release-bump.js';

const AIMEAT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = path.resolve(AIMEAT, '..');
const read = (f: string): string => readFileSync(path.join(REPO, f), 'utf-8');
const current = (JSON.parse(read('aimeat/package.json')) as { version: string }).version;

/** The lines two texts differ in. */
function changedLines(a: string, b: string): string[] {
    const x = a.split('\n');
    const y = b.split('\n');
    return y.filter((line, i) => line !== x[i]);
}

describe('release:bump', () => {
    it('changes exactly the version line of each package.json, never a dependency that has the same number', () => {
        for (const f of ['package.json', 'aimeat/package.json']) {
            const before = read(f);
            const after = setPackageVersion(before, '9.8.7');
            expect(changedLines(before, after)).toEqual(['  "version": "9.8.7",']);
            expect((JSON.parse(after) as { version: string }).version).toBe('9.8.7');
        }
    });

    it('changes only info.version in openapi.yaml', () => {
        const before = read('openapi.yaml');
        const after = setOpenapiVersion(before, '9.8.7');
        expect(changedLines(before, after)).toEqual(['  version: 9.8.7']);
        expect(before).toContain(`  version: ${current}`);
    });

    it('changes only the top-level version in server.json', () => {
        const before = read('server.json');
        const after = setServerVersion(before, '9.8.7');
        expect(changedLines(before, after)).toEqual(['  "version": "9.8.7",']);
    });

    it('takes only a newer x.y.z', () => {
        expect(isNewer('4.1.2', '4.1.1')).toBe(true);
        expect(isNewer('4.2.0', '4.1.9')).toBe(true);
        expect(isNewer('5.0.0', '4.12.3')).toBe(true);
        expect(isNewer('4.1.1', '4.1.1')).toBe(false);
        expect(isNewer('4.1.0', '4.1.1')).toBe(false);
        expect(isNewer('4.0.10', '4.1.0')).toBe(false);
    });

    it('picks the unit tests that read the node version, among them the ones that broke a bump', () => {
        const dir = path.join(AIMEAT, 'test', 'unit');
        const files = readdirSync(dir).filter(f => f.endsWith('.test.ts'))
            .map(f => ({ path: `test/unit/${f}`, text: readFileSync(path.join(dir, f), 'utf-8') }));
        const picked = versionReaders(files);
        for (const f of ['test/unit/service-summary-form.test.ts', 'test/unit/version-aware-suites.test.ts', 'test/unit/relay-claim-default-follows-the-release.test.ts', 'test/unit/feature-map-stamp.test.ts']) {
            expect(picked).toContain(f);
        }
        expect(picked).not.toContain('test/unit/check-unit-ports.test.ts');
        expect(picked.length).toBeLessThan(files.length / 4);
    });

    it('lists the changed files whole, the first one too (its status column starts with a space)', () => {
        expect(porcelainPaths(' M THIRD-PARTY-NOTICES.md\n M aimeat/package.json\nM  server.json\n'))
            .toEqual(['THIRD-PARTY-NOTICES.md', 'aimeat/package.json', 'server.json']);
    });

    it('refuses a file whose version line is missing rather than writing nothing', () => {
        expect(() => setOpenapiVersion('openapi: 3.1.0\npaths: {}\n', '9.8.7')).toThrow(/no info/);
        expect(() => setServerVersion('{ "name": "x" }', '9.8.7')).toThrow(/not found/);
    });
});
