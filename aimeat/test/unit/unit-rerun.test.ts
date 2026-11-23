/**
 * @file test/unit/unit-rerun.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How pnpm gate and pnpm ready decide a red unit run (scripts/lib/unit-rerun.ts): the
 *   failed files run once more alone, a file red again refuses, a file green alone does not and is
 *   named. The process start is replaced by a function that writes the report vitest would write, so
 *   each case states which files failed in which run.
 * @version-history
 *   v1.0.0 — 2026-11-23 — Initial.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { MAX_RERUN_FILES, runUnitWithRerun, type RunCommand } from '../../scripts/lib/unit-rerun.js';

const CMD = ['pnpm', '-s', 'exec', 'vitest', 'run'];
const file = (n: string) => `C:\\dev\\repo\\aimeat\\test\\unit\\${n}.test.ts`;

/** A stand-in for the process start: one answer per run, in order. `failed: null` writes no report. */
function runs(...answers: Array<{ status: number; failed?: string[] | null }>): { run: RunCommand; calls: string[][] } {
    const calls: string[][] = [];
    const run: RunCommand = (cmd, args) => {
        calls.push([cmd, ...args]);
        const a = answers[calls.length - 1];
        const out = args.find(x => x.startsWith('--outputFile.json='))?.slice('--outputFile.json='.length);
        if (out && a.failed !== null) {
            const names = a.failed ?? [];
            writeFileSync(out, JSON.stringify({ testResults: [{ name: file('green'), status: 'passed' }, ...names.map(name => ({ name, status: 'failed' }))] }));
        }
        return a.status;
    };
    return { run, calls };
}

afterEach(() => vi.restoreAllMocks());

describe('a red unit run', () => {
    it('is green at once when the parallel run is green, and starts nothing more', () => {
        const { run, calls } = runs({ status: 0 });
        expect(runUnitWithRerun({ cwd: '.', cmd: CMD, tag: 'ready', run })).toEqual({ ok: true, passedAlone: [] });
        expect(calls).toHaveLength(1);
        expect(calls[0].slice(0, 5)).toEqual(CMD);
    });

    it('does not refuse when the failed files pass alone, and names them from the package folder', () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const { run, calls } = runs({ status: 1, failed: [file('slow-a'), file('slow-b')] }, { status: 0 });
        const r = runUnitWithRerun({ cwd: '.', cmd: CMD, tag: 'ready', run });
        expect(r).toEqual({ ok: true, passedAlone: ['test/unit/slow-a.test.ts', 'test/unit/slow-b.test.ts'] });
        // The second run is those files only, one at a time.
        expect(calls[1]).toEqual(['pnpm', '-s', 'exec', 'vitest', 'run', '--no-file-parallelism', file('slow-a'), file('slow-b')]);
    });

    it('refuses when a failed file is red alone too', () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const { run, calls } = runs({ status: 1, failed: [file('broken')] }, { status: 1 });
        expect(runUnitWithRerun({ cwd: '.', cmd: CMD, tag: 'ready', run })).toEqual({ ok: false, passedAlone: [] });
        expect(calls).toHaveLength(2);
    });

    it('refuses without a second run when the report names no failed file', () => {
        const { run, calls } = runs({ status: 1, failed: [] });
        expect(runUnitWithRerun({ cwd: '.', cmd: CMD, tag: 'ready', run }).ok).toBe(false);
        expect(calls).toHaveLength(1);
    });

    it('refuses without a second run when the report cannot be read', () => {
        const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { run, calls } = runs({ status: 1, failed: null });
        expect(runUnitWithRerun({ cwd: '.', cmd: CMD, tag: 'gate', run }).ok).toBe(false);
        expect(calls).toHaveLength(1);
        expect(String(said.mock.calls[0][0])).toContain('[gate] the unit report could not be read');
    });

    it('refuses without a second run when more files failed than the load explains', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const many = Array.from({ length: MAX_RERUN_FILES + 1 }, (_, i) => file(`f${i}`));
        const { run, calls } = runs({ status: 1, failed: many });
        expect(runUnitWithRerun({ cwd: '.', cmd: CMD, tag: 'ready', run }).ok).toBe(false);
        expect(calls).toHaveLength(1);
    });

    it('runs exactly the ceiling again', () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const atCeiling = Array.from({ length: MAX_RERUN_FILES }, (_, i) => file(`f${i}`));
        const { run, calls } = runs({ status: 1, failed: atCeiling }, { status: 0 });
        expect(runUnitWithRerun({ cwd: '.', cmd: CMD, tag: 'ready', run }).passedAlone).toHaveLength(MAX_RERUN_FILES);
        expect(calls).toHaveLength(2);
    });
});
