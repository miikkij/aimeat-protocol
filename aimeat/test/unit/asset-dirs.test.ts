/**
 * @file test/unit/asset-dirs.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Resolves the three served asset trees against REAL throwaway directories shaped
 *   like each layout the node runs in: the dev checkout, a compiled tree inside that checkout, an
 *   npm install (dist/ and nothing else), and a scaffolded CWD. The npm case is the one that was
 *   wrong in production on aimeat@3.13.1 — the static/ tree resolved to nothing, so
 *   /app-catalog.html, /manifest.json, /app-silent.html and /app-login.js were all 404 — and it
 *   fails on the candidate list this replaced.
 * @usage pnpm test -- asset-dirs
 * @version-history
 *   v1.0.0 -- 2026-09-08 -- Initial, with the four layouts.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetDirCandidates, resolveAssetDir } from '../../src/server-bootstrap/asset-dirs.js';

const scratch = mkdtempSync(join(tmpdir(), 'aimeat-asset-dirs-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Build one package tree under the scratch dir and hand back its root. */
function layout(name: string, dirs: string[]): string {
    const root = join(scratch, name);
    for (const d of dirs) mkdirSync(join(root, ...d.split('/')), { recursive: true });
    return root;
}

/** A directory carrying nothing, to stand in for a CWD that must not answer. */
const elsewhere = layout('elsewhere', ['.']);

const SOURCE_TREE = ['src/server-bootstrap', 'public', 'locales', 'src/static'];
const PACKAGE_TREE = ['dist/src/server-bootstrap', 'dist/public', 'dist/locales', 'dist/static'];

describe('asset tree resolution, per install layout', () => {
    it('dev checkout run through tsx: the source tree', () => {
        const root = layout('dev', SOURCE_TREE);
        const serverDir = join(root, 'src', 'server-bootstrap');
        expect(resolveAssetDir('public', serverDir, elsewhere)).toBe(join(root, 'public'));
        expect(resolveAssetDir('locales', serverDir, elsewhere)).toBe(join(root, 'locales'));
        expect(resolveAssetDir('static', serverDir, elsewhere)).toBe(join(root, 'src', 'static'));
    });

    it('npm install: dist/ is all there is, and static/ lives there too', () => {
        const root = layout('npm', PACKAGE_TREE);
        const serverDir = join(root, 'dist', 'src', 'server-bootstrap');
        expect(resolveAssetDir('public', serverDir, elsewhere)).toBe(join(root, 'dist', 'public'));
        expect(resolveAssetDir('locales', serverDir, elsewhere)).toBe(join(root, 'dist', 'locales'));
        // The one that was missing: src/static is copied to dist/static, so a candidate written as
        // <serverDir>/../../src/static reads dist/src/static, which no layout has ever had.
        expect(resolveAssetDir('static', serverDir, elsewhere)).toBe(join(root, 'dist', 'static'));
    });

    it('compiled tree inside the checkout: the packaged copy, matching the code that is running', () => {
        const root = layout('built', [...SOURCE_TREE, ...PACKAGE_TREE]);
        const serverDir = join(root, 'dist', 'src', 'server-bootstrap');
        expect(resolveAssetDir('public', serverDir, elsewhere)).toBe(join(root, 'dist', 'public'));
        expect(resolveAssetDir('locales', serverDir, elsewhere)).toBe(join(root, 'dist', 'locales'));
        expect(resolveAssetDir('static', serverDir, elsewhere)).toBe(join(root, 'dist', 'static'));
    });

    it('scaffolded: the operator\'s own working directory wins over everything', () => {
        const root = layout('scaffold-pkg', PACKAGE_TREE);
        const cwd = layout('scaffold-cwd', ['public', 'locales', 'static']);
        const serverDir = join(root, 'dist', 'src', 'server-bootstrap');
        expect(resolveAssetDir('public', serverDir, cwd)).toBe(join(cwd, 'public'));
        expect(resolveAssetDir('locales', serverDir, cwd)).toBe(join(cwd, 'locales'));
        expect(resolveAssetDir('static', serverDir, cwd)).toBe(join(cwd, 'static'));
    });

    it('a tree that was never shipped resolves to nothing rather than a wrong guess', () => {
        const root = layout('bare', ['dist/src/server-bootstrap']);
        const serverDir = join(root, 'dist', 'src', 'server-bootstrap');
        expect(resolveAssetDir('static', serverDir, elsewhere)).toBeUndefined();
    });
});

describe('the candidate lists themselves', () => {
    it('name the packaged location of every tree', () => {
        const serverDir = join('/pkg', 'dist', 'src', 'server-bootstrap');
        for (const tree of ['public', 'locales', 'static'] as const) {
            expect(assetDirCandidates(tree, serverDir, '/cwd'))
                .toContain(join('/pkg', 'dist', tree));
        }
    });

    it('carry no duplicate, so public/ and locales/ do not try the same path twice', () => {
        for (const tree of ['public', 'locales', 'static'] as const) {
            const candidates = assetDirCandidates(tree, '/pkg/src/server-bootstrap', '/cwd');
            expect(new Set(candidates).size).toBe(candidates.length);
        }
    });
});
