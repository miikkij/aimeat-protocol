/**
 * @file test/unit/npm-shrinkwrap.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The published npm package carries npm-shrinkwrap.json, and the rules it is held to
 *   (scripts/lib/npm-shrinkwrap.mjs) refuse a tree that breaks a pnpm.overrides rule or differs from
 *   pnpm-lock.yaml. npm reads neither pnpm-lock.yaml nor the `pnpm` block, so before this `npx aimeat`
 *   resolved every range fresh and applied none of the advisory overrides (secaudit2026oct26 round 8c,
 *   operator-01). Also held here: the npm `overrides` field mirrors pnpm.overrides, and both release
 *   paths (prepublishOnly and the nightly pack-smoke job) write the shrinkwrap before packing.
 * @usage pnpm exec vitest run test/unit/npm-shrinkwrap.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-29 -- Initial (secaudit2026oct26 round 8c, operator-01).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    npmOverridesFromPnpm, overrideViolations, parseOverrides, pnpmMismatches, pnpmProduction, satisfies, serveLikeRegistry, shrinkwrapProblems, tarballUrl,
} from '../../scripts/lib/npm-shrinkwrap.mjs';

const AIMEAT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(AIMEAT, 'package.json'), 'utf8')) as {
    name: string; version: string; scripts: Record<string, string>; files: string[];
    overrides: Record<string, unknown>; pnpm: { overrides: Record<string, string> };
};
const OVERRIDES = pkg.pnpm.overrides;

type Entry = { version: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; resolved?: string; integrity?: string };
const at = (version: string, extra: Partial<Entry> = {}): Entry => ({ version, ...extra });

/** A tree that holds every rule in today's pnpm.overrides. */
function goodTree(): Record<string, Entry> {
    return {
        '': at(pkg.version),
        'node_modules/hono': at('4.13.13'),
        'node_modules/zod': at('4.6.7'),
        'node_modules/cbor-x': at('1.6.8'),
        'node_modules/readdir-glob': at('3.0.0', { dependencies: { minimatch: '^10.2.2' } }),
        'node_modules/minimatch': at('10.2.5'),
        'node_modules/multimatch/node_modules/minimatch': at('3.1.5'),
        'node_modules/qs': at('6.16.1'),
    };
}

describe('version ranges (the semver subset the check reads)', () => {
    it.each([
        ['4.13.7', '>=4.13.7', true], ['4.13.6', '>=4.13.7', false],
        ['10.7.0', '>=10.0.0 <10.7.1', true], ['10.7.1', '>=10.0.0 <10.7.1', false],
        ['3.1.9', '^3.1.7', true], ['4.0.0', '^3.1.7', false], ['0.2.9', '^0.2.3', true], ['0.3.0', '^0.2.3', false],
        ['1.2.9', '~1.2.3', true], ['1.3.0', '~1.2.3', false],
        ['3.0.0', '3', true], ['3.9.9', '3', true], ['4.0.0', '3', false], ['3.0.0-rc.1', '3', false],
        ['5.1.8', '5.1.8', true], ['5.1.9', '5.1.8', false],
        ['20.1.0', '18 || 20 || >=22', true], ['21.0.0', '18 || 20 || >=22', false],
    ])('%s satisfies %s: %s', (version, range, want) => {
        expect(satisfies(version, range)).toBe(want);
    });

    it('throws on a range it cannot read, so a new override in another syntax fails loudly', () => {
        expect(() => satisfies('1.0.0', '1.0.0 - 2.0.0')).toThrow(/hyphen/);
        expect(() => satisfies('1.0.0', 'latest')).toThrow(/unsupported/);
    });
});

describe('pnpm.overrides as rules', () => {
    it('splits a parent rule at its ">", and keeps the ">" of a range inside the selector', () => {
        const rules = parseOverrides({ 'readdir-glob@3>minimatch': '10.2.5', 'ip-address@>=10.0.0 <10.7.1': '>=10.7.1', 'cbor-x>cbor-extract': '-' });
        expect(rules[0]).toMatchObject({ parent: { name: 'readdir-glob', range: '3' }, target: { name: 'minimatch', range: null }, value: '10.2.5' });
        expect(rules[1]).toMatchObject({ parent: null, target: { name: 'ip-address', range: '>=10.0.0 <10.7.1' } });
        expect(rules[2]).toMatchObject({ parent: { name: 'cbor-x' }, target: { name: 'cbor-extract' }, value: '-' });
    });

    it('reads every rule in package.json', () => {
        expect(parseOverrides(OVERRIDES)).toHaveLength(Object.keys(OVERRIDES).length);
    });
});

describe('overrideViolations: a shrinkwrap version that breaks an override is refused', () => {
    it('a tree that holds every rule passes', () => {
        expect(overrideViolations(goodTree(), OVERRIDES)).toEqual([]);
    });

    it('a version below an advisory floor', () => {
        const tree = { ...goodTree(), 'node_modules/hono': at('4.13.6') };
        expect(overrideViolations(tree, OVERRIDES)).toEqual(['node_modules/hono is 4.13.6; override "hono" requires >=4.13.7']);
    });

    it('a version inside a ranged rule\'s selector, and a nested copy too', () => {
        const tree = { ...goodTree(), 'node_modules/@vercel/cli-config/node_modules/zod': at('4.1.11') };
        expect(overrideViolations(tree, OVERRIDES)).toEqual(['node_modules/@vercel/cli-config/node_modules/zod is 4.1.11; override "zod@>=4.0.0 <4.6.6" requires ^4.6.7']);
    });

    it('a parent rule: what readdir-glob@3 resolves (its own nested copy first) must be the pinned minimatch', () => {
        const tree = { ...goodTree(), 'node_modules/readdir-glob/node_modules/minimatch': at('10.2.6') };
        expect(overrideViolations(tree, OVERRIDES)).toEqual([
            'node_modules/readdir-glob reaches node_modules/readdir-glob/node_modules/minimatch 10.2.6; override "readdir-glob@3>minimatch" requires 10.2.5',
        ]);
    });

    it('the removal cbor-x>cbor-extract: a declaration or a reachable copy is refused', () => {
        const tree = {
            ...goodTree(),
            'node_modules/cbor-x': at('1.6.8', { optionalDependencies: { 'cbor-extract': '^2.2.0' } }),
            'node_modules/cbor-extract': at('2.2.2'),
        };
        expect(overrideViolations(tree, OVERRIDES)).toEqual([
            'node_modules/cbor-x still declares cbor-extract; override "cbor-x>cbor-extract" removes it',
            'node_modules/cbor-x reaches node_modules/cbor-extract 2.2.2; override "cbor-x>cbor-extract" removes it',
        ]);
    });
});

describe('pnpmMismatches: the tree is the one pnpm-lock.yaml pins', () => {
    const integrity = (n: string) => `sha512-${n}`;
    const lock = {
        lockfileVersion: '9.0',
        importers: { '.': { dependencies: { a: { specifier: '^1.0.0', version: '1.0.0' }, debug: { specifier: '^4', version: '4.4.3(supports-color@10.2.2)' } } } },
        packages: {
            'a@1.0.0': { resolution: { integrity: integrity('a') } },
            'b@1.0.0': { resolution: { integrity: integrity('b1') } },
            'b@2.0.0': { resolution: { integrity: integrity('b2') } },
            'debug@4.4.3': { resolution: { integrity: integrity('debug') }, peerDependencies: { 'supports-color': '*' }, peerDependenciesMeta: { 'supports-color': { optional: true } } },
            'supports-color@10.2.2': { resolution: { integrity: integrity('sc') } },
        },
        snapshots: {
            'a@1.0.0': { dependencies: { b: '2.0.0' } },
            'b@2.0.0': {},
            'debug@4.4.3(supports-color@10.2.2)': { optionalDependencies: { 'supports-color': '10.2.2' } },
            'supports-color@10.2.2': {},
        },
    };
    const production = pnpmProduction(lock);
    const tree = (): Record<string, Entry> => ({
        '': at('1.0.0'),
        'node_modules/a': at('1.0.0', { integrity: integrity('a') }),
        'node_modules/a/node_modules/b': at('2.0.0', { integrity: integrity('b2') }),
        'node_modules/debug': at('4.4.3', { integrity: integrity('debug') }),
    });

    it('the pinned tree passes, without the optional peer pnpm added on its own', () => {
        expect(production.get('supports-color@10.2.2')?.optionalPeerOnly).toBe(true);
        expect(pnpmMismatches(tree(), production)).toEqual([]);
    });

    it('a version pnpm does not pin, and the one it pins missing', () => {
        const t = tree();
        t['node_modules/a/node_modules/b'] = at('2.0.1');
        expect(pnpmMismatches(t, production)).toEqual([
            'node_modules/a resolves its dependencies differently from pnpm-lock.yaml: b -> b@2.0.1, pnpm: b@2.0.0',
            'node_modules/a/node_modules/b 2.0.1 is not in pnpm-lock.yaml\'s production set',
            'b@2.0.0 is in pnpm-lock.yaml\'s production set and missing from the tree',
        ]);
    });

    it('a dependency Node\'s lookup resolves to another copy than pnpm chose', () => {
        const t = tree();
        delete t['node_modules/a/node_modules/b'];
        t['node_modules/b'] = at('2.0.0');
        expect(pnpmMismatches(t, production)).toEqual([]);
        t['node_modules/a/node_modules/b'] = at('1.0.0');
        expect(pnpmMismatches(t, production)[0]).toBe('node_modules/a resolves its dependencies differently from pnpm-lock.yaml: b -> b@1.0.0, pnpm: b@2.0.0');
    });

    it('an integrity that differs from pnpm-lock.yaml', () => {
        const t = tree();
        t['node_modules/a'] = at('1.0.0', { integrity: 'sha512-other' });
        expect(pnpmMismatches(t, production)).toEqual(['node_modules/a has integrity sha512-other; pnpm-lock.yaml pins sha512-a']);
    });

    it('shrinkwrapProblems also asks for a registry address and integrity on every entry', () => {
        const t = tree();
        const sw = { lockfileVersion: 3, packages: { ...t, '': { name: pkg.name, version: pkg.version } } };
        const problems = shrinkwrapProblems(sw, { ...pkg, pnpm: { overrides: {} } }, lock);
        expect(problems).toContain('node_modules/a has no resolved address');
        expect(tarballUrl('@scope/name', '1.2.3')).toBe('https://registry.npmjs.org/@scope/name/-/name-1.2.3.tgz');
    });
});

describe('serveLikeRegistry: pack-smoke installs the tarball the way the registry serves it', () => {
    it('serves the packed version marked as carrying a shrinkwrap, the bytes behind it, and redirects the rest to npmjs.org', async () => {
        const tarball = Buffer.from('not really a tarball');
        const front = await serveLikeRegistry({ manifest: { name: 'aimeat', version: '9.9.9', dependencies: { yaml: '^2' } }, tarball });
        try {
            const doc = await (await fetch(`${front.url}aimeat`)).json() as { versions: Record<string, { _hasShrinkwrap: boolean; dist: { tarball: string; integrity: string } }> };
            const v = doc.versions['9.9.9'];
            expect(v._hasShrinkwrap).toBe(true);
            expect(v.dist.integrity).toBe(`sha512-${createHash('sha512').update(tarball).digest('base64')}`);
            expect(Buffer.from(await (await fetch(v.dist.tarball)).arrayBuffer())).toEqual(tarball);
            const other = await fetch(`${front.url}@scope%2fname`, { redirect: 'manual' });
            expect(other.status).toBe(302);
            expect(other.headers.get('location')).toBe('https://registry.npmjs.org/@scope%2fname');
            expect(front.requests).toEqual(['/aimeat', '/aimeat/-/aimeat-9.9.9.tgz', '/@scope/name']);
        } finally {
            await front.close();
        }
    });
});

describe('the package and its release paths', () => {
    it('the npm `overrides` field mirrors pnpm.overrides, so a plain npm install honours them too', () => {
        const { overrides, skipped } = npmOverridesFromPnpm(OVERRIDES);
        expect(pkg.overrides).toEqual(overrides);
        // npm has no removal; the shrinkwrap carries it (gen-shrinkwrap.mjs drops the declaration).
        expect(skipped.map(s => s.key)).toEqual(['cbor-x>cbor-extract']);
    });

    it('prepublishOnly writes npm-shrinkwrap.json after the build and before the tarball is packed', () => {
        const steps = pkg.scripts.prepublishOnly.split('&&').map(s => s.trim());
        const gen = steps.indexOf('pnpm gen:shrinkwrap');
        expect(gen).toBeGreaterThan(steps.indexOf('pnpm build'));
        expect(gen).toBeLessThan(steps.indexOf('node scripts/pack-smoke.mjs'));
        expect(pkg.scripts['gen:shrinkwrap']).toBe('node scripts/gen-shrinkwrap.mjs');
    });

    it('`files` names the shrinkwrap: npm 11 packs it only when listed beside dist/', () => {
        expect(pkg.files).toContain('npm-shrinkwrap.json');
    });

    it('the nightly pack-smoke job writes it too before packing', () => {
        const text = readFileSync(join(AIMEAT, '..', '.github', 'workflows', 'e2e-full.yml'), 'utf8');
        const job = text.slice(text.indexOf('\n  pack-smoke:'));
        expect(job.indexOf('run: pnpm gen:shrinkwrap')).toBeGreaterThan(0);
        expect(job.indexOf('run: pnpm gen:shrinkwrap')).toBeLessThan(job.indexOf('run: node scripts/pack-smoke.mjs'));
    });

    it('the generated file is not tracked: every publish writes it from the lock of that commit', () => {
        const ignore = readFileSync(join(AIMEAT, '..', '.gitignore'), 'utf8');
        expect(ignore.split(/\r?\n/)).toContain('aimeat/npm-shrinkwrap.json');
    });
});
