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
 *   v1.1.0 -- 2026-09-12 -- Two holes, both found by the defect happening again. The ledger held one
 *     pack of fifteen and the drift check only read what was listed, so fourteen were unguarded;
 *     every pack is in it now and a missing one fails. And the check compared hashes only while the
 *     two versions AGREED, so a half-finished bump — the exact state it exists to catch — said
 *     nothing. Both fields are held against the tree now.
 *   v1.0.0 -- 2026-08-18 -- Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../public/cortex-bundled/', import.meta.url));

/**
 * pack name → [declared version, sha256 of the JS at that version]. EVERY pack, not a selection.
 *
 * Bumping a pack means: edit the JS, bump `version` in its YAML, then put the new hash here. The
 * middle step is the one that gets forgotten, and it is the one that decides whether anybody but a
 * brand-new node ever sees the change.
 *
 * IT HELD ONE ENTRY UNTIL 2026-09-12, and the drift check only looked at what was listed — so
 * fourteen of the fifteen packs were unguarded and the defect this file was written for happened
 * again, to aimeat-i18n: a hundred and seventy-eight lines of new library shipped at an unchanged
 * version, and the node went on serving the old 6 kB file. A ledger that covers some of the thing
 * it guards is a ledger that will be wrong about the rest, so a pack with no entry is now a
 * failure rather than a silence.
 *
 * WHAT SEEDING THIS COULD NOT ANSWER. The entries below record the tree as it is TODAY, so they
 * declare every pack correct by construction and can say nothing about a change that shipped
 * unbumped in the past. That question was answered from git instead — for every commit touching a
 * pack's JS, whether the same commit moved its manifest version — and it found one still open:
 * aimeat-canvas, three code-review fixes on 2026-03-05 that landed after the bump to 1.0.0 and
 * were never delivered. It is 1.0.1 here. Re-seeding these hashes forgives the same way, so it is
 * a decision and not maintenance.
 */
const KNOWN: Record<string, { version: string; sha256: string }> = {
    'aimeat-canvas': { version: '1.0.1', sha256: '297f5f807074e0dd' },
    'aimeat-charts': { version: '1.1.2', sha256: '691ad8f365372b03' },
    'aimeat-dag': { version: '1.1.4', sha256: '56fff8df06d77259' },
    'aimeat-flow': { version: '1.0.1', sha256: '1634ee00cbb0099d' },
    'aimeat-i18n': { version: '1.3.0', sha256: '569dd2ee1025fc8b' },
    'aimeat-input': { version: '1.0.0', sha256: '5968dddac74e78aa' },
    'aimeat-surface': { version: '1.1.1', sha256: '367836dc60ac1981' },
    'aimeat-ui-dialogs': { version: '1.0.1', sha256: '70a017c3b69a64ce' },
    'aimeat-ui-forms': { version: '1.0.0', sha256: 'edc35e2d8441c1a0' },
    'aimeat-ui-layout': { version: '1.0.0', sha256: 'ae25d30f8878f8dd' },
    'aimeat-ui-motion': { version: '1.0.1', sha256: '5e8431824cf8babf' },
    'aimeat-ui-nav': { version: '1.0.0', sha256: '949dcbde43c6bf61' },
    'aimeat-ui-viewers': { version: '1.1.0', sha256: 'd8085d04d0064238' },
    'aimeat-viewport': { version: '1.0.4', sha256: '1d215dd00655b1a8' },
    'aimeat-vocab': { version: '1.0.0', sha256: 'a151786d13fe2291' },
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

    it('every pack is in the ledger, because an unlisted one is not checked at all', () => {
        // The gap that let the same defect happen twice: the drift check below reads the ledger, so
        // a pack missing from it is not guarded and nothing says so.
        const missing = packs().filter((name) => !KNOWN[name]);
        expect(missing, `add these to KNOWN with their current version and sha256: ${missing.join(', ')}`).toEqual([]);
    });

    it('a pack whose code moved has had its version moved with it', () => {
        /*
         * THE LEDGER AND THE FILES AGREE ON BOTH HALVES, OR THIS FAILS. The earlier version only
         * compared hashes `&& known.version === version`, so the moment the two versions disagreed
         * it said nothing at all — which is exactly the state a half-finished bump leaves behind.
         * Both fields are checked against the tree now, and the message says which one moved.
         */
        const wrong: string[] = [];
        for (const name of packs()) {
            const known = KNOWN[name];
            if (!known) continue;   // reported by the test above
            const version = declaredVersion(name);
            const hash = jsHash(name);
            if (known.sha256 !== hash && known.version === version) {
                wrong.push(`${name}: the code changed and the version did not (still ${version}). Bump the YAML, then record ${hash} here.`);
            } else if (known.version !== version) {
                wrong.push(`${name}: the YAML says ${version} and this ledger says ${known.version}. Record { version: '${version}', sha256: '${hash}' }.`);
            } else if (known.sha256 !== hash) {
                wrong.push(`${name}: the recorded hash is stale. Record ${hash}.`);
            }
        }
        expect(wrong, wrong.join('\n')).toEqual([]);
    });
});
