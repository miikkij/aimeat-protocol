/**
 * @file test/unit/page-build-id.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The stamp the served pages carry names the code, not the process. Until 2026-11-04 it
 *   was Date.now() per process (routes/portal-spa.ts), so every restart on the same code reloaded
 *   every open page, and a page whose live stream reached a second process reloaded each time. A
 *   source checkout and a dirty build keep the per-process value, so a restart there still busts
 *   the browser's module cache.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item A7).
 */
import { describe, it, expect } from 'vitest';
import { pageBuildId, type RunningBuild } from '../../src/utils/build-stamp.js';

const COMMIT = '4bb12e4dd0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BUILT_AT = '2026-11-04T08:00:00.000Z';

function build(overrides: Partial<RunningBuild> = {}): RunningBuild {
  return { commit: COMMIT, commit_source: 'stamp', dirty: false, built_at: BUILT_AT, state: 'fresh', ...overrides };
}

describe('pageBuildId', () => {
  it('gives two processes of one clean stamped build the same stamp', () => {
    const a = pageBuildId(build(), Date.UTC(2026, 10, 4, 9).toString(36));
    const b = pageBuildId(build(), Date.UTC(2026, 10, 4, 10).toString(36));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-z.]+$/);
    expect(a.startsWith(COMMIT.slice(0, 12))).toBe(true);
  });

  it('gives a new build of the same commit a new stamp, so a deploy still reloads the page', () => {
    const before = pageBuildId(build(), 'p1');
    const after = pageBuildId(build({ built_at: '2026-11-04T09:00:00.000Z' }), 'p1');
    expect(after).not.toBe(before);
  });

  it('keeps the per-process stamp for a source checkout, a dirty build and an install with no commit', () => {
    expect(pageBuildId(build({ commit_source: 'git', dirty: null }), 'proc')).toBe('proc');
    expect(pageBuildId(build({ dirty: true }), 'proc')).toBe('proc');
    expect(pageBuildId(build({ commit: null, commit_source: null }), 'proc')).toBe('proc');
    expect(pageBuildId(build({ built_at: null }), 'proc')).toBe('proc');
  });
});
