/**
 * @file test/unit/license-inventory-pnpm-reason.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the licence reader says when `pnpm licenses list` will not run.
 *
 *   THE FAILURE THIS PINS happened on a release day, 2026-09-09: `pnpm publish` stopped in
 *   prepublishOnly and the message said "It reads node_modules, so run pnpm install first". The
 *   directory was fine. pnpm's own answer was ERR_PNPM_MISSING_PACKAGE_INDEX_FILE for one package —
 *   the shared store was missing an index file, which no amount of looking at node_modules reveals,
 *   and which the same `pnpm install` happens to repair for an entirely different reason. A message
 *   that names the wrong cause is worse than one that names none, because it is followed.
 *
 *   pnpm reports the failure as JSON on STDOUT and exits non-zero, so `execSync` throws with the
 *   answer attached. These cases say the answer reaches the person.
 * @usage pnpm exec vitest run test/unit/license-inventory-pnpm-reason.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-09 — Initial, with the fix.
 */
import { describe, it, expect } from 'vitest';
import { pnpmReason } from '../../scripts/lib/license-inventory.js';

describe('a failed pnpm licenses list explains itself', () => {
    it('reports the store failure that actually stopped a release', () => {
        // Verbatim from the 2026-09-09 run, minus the absolute path.
        const err = Object.assign(new Error('Command failed: pnpm licenses list --prod --json'), {
            stdout: JSON.stringify({
                error: {
                    code: 'ERR_PNPM_MISSING_PACKAGE_INDEX_FILE',
                    message: "Failed to find package index file for nodemailer@9.1.1, please consider running 'pnpm install'",
                },
            }),
        });
        const said = pnpmReason(err);
        expect(said).toContain('ERR_PNPM_MISSING_PACKAGE_INDEX_FILE');
        expect(said).toContain('nodemailer@9.1.1');
    });

    it('reads a Buffer stdout, which is what execSync hands back without an encoding', () => {
        const err = Object.assign(new Error('Command failed'), {
            stdout: Buffer.from(JSON.stringify({ error: { code: 'ERR_PNPM_NO_LOCKFILE', message: 'no lockfile' } })),
        });
        expect(pnpmReason(err)).toContain('ERR_PNPM_NO_LOCKFILE');
    });

    it('falls back to stderr, so a pnpm that reports there does not go silent', () => {
        const err = Object.assign(new Error('Command failed'), {
            stdout: '',
            stderr: JSON.stringify({ error: { code: 'ERR_PNPM_FETCH_404', message: 'gone from the registry' } }),
        });
        expect(pnpmReason(err)).toContain('gone from the registry');
    });

    it('says what to try when pnpm gave no reason at all, and names BOTH halves', () => {
        // The old message named only node_modules. An incomplete store is the other half, and the
        // repair is the same command — which is exactly why naming one cause misleads.
        const said = pnpmReason(new Error('spawn ENOENT'));
        expect(said).toContain('pnpm install');
        expect(said).toContain('store');
    });

    it('does not pretend that unparseable output is a reason', () => {
        const err = Object.assign(new Error('Command failed'), { stdout: 'Debugger attached.\n' });
        expect(pnpmReason(err)).toContain('pnpm install');
    });
});
