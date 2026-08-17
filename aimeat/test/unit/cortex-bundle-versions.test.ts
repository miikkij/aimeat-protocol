/**
 * @file test/unit/cortex-bundle-versions.test.ts
 * @description Every bundled cortex pack's manifest version matches the code beside it.
 *
 *   WHY THIS EXISTS. The seeder refreshes an installed pack only when the bundled VERSION changed
 *   (`if (existing.version === ext.version) continue`), which is right: it must not overwrite a
 *   node's pack on every boot. The consequence is that editing a pack's JS without touching its
 *   YAML version ships a file that reaches a fresh node and never reaches an existing one.
 *
 *   Found on 2026-08-18 by probing production rather than by any test: the storage lib carried a
 *   change and the viewers pack did not, on the same deploy, because only one of them is versioned
 *   this way. The developer had been told the feature was there.
 *
 *   This test cannot know what a pack's version SHOULD be, so it checks the one thing it can: the
 *   version recorded here alongside a hash of the pack's bytes. Change the code and the hash moves,
 *   and this fails until the version is bumped with it.
 * @version-history
 *   v1.0.0 -- 2026-08-18 -- Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../public/cortex-bundled/', import.meta.url));

/**
 * pack name → [declared version, sha256 of the JS at that version].
 *
 * Bumping a pack means: edit the JS, bump `version` in its YAML, then put the new hash here. The
 * middle step is the one that gets forgotten, and it is the one that decides whether anybody but a
 * brand-new node ever sees the change.
 */
const KNOWN: Record<string, { version: string; sha256: string }> = {
    'aimeat-ui-viewers': {
        version: '1.1.0',
        sha256: 'd8085d04d0064238',
    },
};

function packs(): string[] {
    return readdirSync(dir).filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, ''));
}

function declaredVersion(name: string): string {
    const yaml = readFileSync(dir + name + '.yaml', 'utf8');
    return /^\s*version:\s*"?([^"\s]+)"?/m.exec(yaml)?.[1] ?? '';
}

function jsHash(name: string): string {
    return createHash('sha256').update(readFileSync(dir + name + '.js')).digest('hex').slice(0, 16);
}

describe('bundled cortex packs', () => {
    it('every pack declares a version, or the seeder cannot tell whether it changed', () => {
        for (const name of packs()) {
            expect(declaredVersion(name), `${name}.yaml has no version`).toMatch(/^\d+\.\d+\.\d+$/);
        }
    });

    it('every pack ships the JS its manifest names, or it is skipped in silence', () => {
        const files = new Set(readdirSync(dir));
        for (const name of packs()) {
            expect(files.has(name + '.js'), `${name}.yaml has no ${name}.js and the seeder skips it`).toBe(true);
        }
    });

    it('a pack whose code moved has had its version moved with it', () => {
        const drifted: string[] = [];
        for (const [name, known] of Object.entries(KNOWN)) {
            if (!packs().includes(name)) continue;
            const version = declaredVersion(name);
            const hash = jsHash(name);
            // A recorded hash that no longer matches, at a version that did not move, is the defect:
            // the code changed and every existing node will keep serving the old copy.
            if (known.sha256 && known.sha256 !== hash && known.version === version) {
                drifted.push(`${name}: code changed but version is still ${version} (bump the YAML, then update sha256 here to ${hash})`);
            }
        }
        expect(drifted, drifted.join('\n')).toEqual([]);
    });
});
