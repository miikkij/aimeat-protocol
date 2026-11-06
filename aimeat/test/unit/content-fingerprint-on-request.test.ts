/**
 * @file test/unit/content-fingerprint-on-request.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fingerprint (the profile stage) runs only when a caller names it, and the content
 *   pipeline never reads its own output. On 2026-11-03 an owner turned stages.profile on to try the
 *   fingerprint on two records; every text any of their agents wrote was then fingerprinted on arrival,
 *   and every fingerprint's sections file (`contentclass-profile/<hash>.json`) arrived as a new file and
 *   was fingerprinted in turn: 4601 of 4654 fingerprints in three days were of the pipeline's own files.
 * @structure stagesToRun · contentAfterStore
 * @usage cd aimeat && pnpm exec vitest run test/unit/content-fingerprint-on-request.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-06 — Initial.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { stagesToRun } from '../../src/services/content/pipeline.js';
import { contentAfterStore, flushContentIntake, pendingContentIntake } from '../../src/services/content/intake.js';
import { DEFAULT_SETTINGS, type ContentSettings } from '../../src/services/content/types.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const everyStageOn: ContentSettings = {
  ...DEFAULT_SETTINGS,
  stages: { technical: true, describe: true, classify: true, extract: true, propose: true, profile: true },
};

describe('stagesToRun', () => {
  it('never runs the profile stage on arrival, whatever the settings say', () => {
    const stages = stagesToRun(everyStageOn, undefined, true);
    expect(stages).not.toContain('profile');
    expect(stages).toEqual(['technical', 'describe', 'classify', 'extract', 'propose']);
  });

  it('never runs the profile stage when the caller named no stages (an inspect or a scan on the settings)', () => {
    expect(stagesToRun(everyStageOn, undefined, false)).not.toContain('profile');
  });

  it('runs the profile stage when the caller names it', () => {
    expect(stagesToRun(DEFAULT_SETTINGS, ['profile'], false)).toEqual(['profile']);
  });
});

describe('contentAfterStore', () => {
  // A storage that answers nothing: an item that is queued is read by the worker, fails, and is logged.
  const deps = {
    storage: {} as unknown as Storage,
    config: { nodeId: 'node-1', contentClassMode: 'on' } as unknown as AimeatConfig,
  };

  afterEach(async () => { await flushContentIntake(); });

  it('does not queue the pipeline\'s own fingerprint sections file', () => {
    contentAfterStore(deps, 'alice@node-1', 'contentclass-profile/219c28787cbeae17aaf11135.json');
    expect(pendingContentIntake()).toBe(0);
  });

  it('does not queue the pipeline\'s own text file', () => {
    contentAfterStore(deps, 'alice@node-1', 'contentclass-text/219c28787cbeae17aaf11135.txt');
    expect(pendingContentIntake()).toBe(0);
  });

  it('queues an ordinary file', () => {
    contentAfterStore(deps, 'alice@node-1', 'docs/report.pdf');
    // The queued item, and the worker started for it.
    expect(pendingContentIntake()).toBeGreaterThan(0);
  });
});
