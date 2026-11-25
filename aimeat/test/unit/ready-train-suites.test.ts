/**
 * @file test/unit/ready-train-suites.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How pnpm ready's batch hands its suites to the E2E runner (scripts/lib/ready-train.ts
 *   suiteArgs): a short list as `--test=` arguments, a long one as a `--tests-file=` the runner reads,
 *   because 758 `--test=` arguments made a command line Windows refused.
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { suiteArgs } from '../../scripts/lib/ready-train.js';

const dir = mkdtempSync(path.join(tmpdir(), 'aimeat-ready-suites-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the suites a batch hands to the runner', () => {
  it('names a short list on the command line', () => {
    expect(suiteArgs(dir, 'test-results/ready-batch/x', ['e2e-a', 'e2e-b'])).toEqual(['--test=e2e-a', '--test=e2e-b']);
  });

  it('writes a long list to a file the runner reads, one name a line', () => {
    const names = Array.from({ length: 758 }, (_, i) => `e2e-suite-${i}`);
    const args = suiteArgs(dir, 'test-results/ready-batch/sqlite', names);
    expect(args).toEqual(['--tests-file=test-results/ready-batch/sqlite.suites.txt']);
    expect(readFileSync(path.join(dir, 'test-results/ready-batch/sqlite.suites.txt'), 'utf-8').trim().split('\n')).toEqual(names);
  });
});
