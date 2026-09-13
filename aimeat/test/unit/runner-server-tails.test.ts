/**
 * @file test/unit/runner-server-tails.test.ts
 * @description Unit tests for keepTails() in test/run-e2e-server.ts — what the E2E runner quotes
 *   back when the shared test node dies on its way up.
 *
 *   WHAT THESE ARE FOR. The same thing the wait-for-server tests next door are for, one level up:
 *   the behaviour under test is what a failing CI run TELLS you, and a run cannot assert that about
 *   itself. On the nightly sweep of 2026-09-12 a lane's server exited 1 during startup and the
 *   runner printed the code, the signal and an empty line, because this node logs through Winston
 *   (stdout for every level) and the stdout listener discarded what it read. The lane ran none of
 *   its suites and the issue that opened had nothing in it to act on.
 * @usage cd aimeat && pnpm test -- runner-server-tails
 * @version-history
 *   v1.1.0 -- 2026-09-13 -- Assert line retention independently of OS pipe chunk boundaries.
 *   v1.0.0 — 2026-09-13 — Initial, with the stdout half of the fix.
 */
import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { keepTails } from '../run-e2e-server.js';

/** A child that runs one line of JavaScript, with both streams piped as the helper expects. */
const child = (code: string): ChildProcess =>
    spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });

/** Attach, let the child say its piece and exit, then read the tail. */
async function tailOf(code: string): Promise<string> {
    const c = child(code);
    const tail = keepTails(c);
    await new Promise<void>(r => c.once('close', () => r()));
    // 'close' fires once both streams are ended, so everything the child wrote has been delivered.
    return tail();
}

describe('keepTails', () => {
    it.each(['', '\n'])('keeps the same last 20 lines across chunk boundaries (ending %j)', ending => {
        const source = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + ending;
        const expected = '\n' + Array.from({ length: 20 }, (_, i) => `line ${i + 10}`).join('\n');
        for (const chunks of [[source], [...source]]) {
            const stdout = new PassThrough();
            const stderr = new PassThrough();
            const tail = keepTails({ stdout, stderr } as unknown as ChildProcess);
            for (const chunk of chunks) stdout.write(chunk);
            stdout.end();
            stderr.end();
            expect(tail()).toBe(expected);
        }
    });

    it('quotes what the node said on STDOUT, which is where Winston writes every level', async () => {
        const said = await tailOf(`console.log('{"level":"error","message":"Node key file is not valid JSON"}'); process.exit(1)`);
        expect(said).toContain('Node key file is not valid JSON');
    });

    it('quotes stderr too, and puts it first', async () => {
        const said = await tailOf(`console.log('a log line'); console.error('the crash'); process.exit(1)`);
        expect(said.indexOf('the crash')).toBeLessThan(said.indexOf('a log line'));
    });

    it('says so plainly when the node printed nothing at all', async () => {
        expect(await tailOf('process.exit(1)')).toContain('printed nothing on either stream');
    });

    it('keeps the END of a long stream, which is where the reason is', async () => {
        const said = await tailOf(`for (let i = 0; i < 200; i++) console.log('line ' + i); process.exit(1)`);
        expect(said).toContain('line 199');
        expect(said).not.toContain('line 0\n');
    });
});
