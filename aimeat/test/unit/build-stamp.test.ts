/**
 * @file build-stamp.test.ts
 * @description Guards the stale-dist detector. The connector's consumers (crewaimeat, any CrewAI
 *   crew) never touch the node directly — they reach it only through `aimeat connect serve`, which
 *   runs from dist/. When dist/ is older than the source it was built from, nothing errors: a field
 *   added in source is silently absent from every write. That exact shape has cost three separate
 *   hunts (outbound writes dropped, inbound reads dropped the record, then `provider`), each ending
 *   at a build older than the merge. These tests lock the rules that make it announce itself.
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial: the four freshness states + the slack boundary.
 */
import { describe, it, expect } from 'vitest';
import { compareFreshness, describeRunningBuild, MTIME_SLACK_MS, type BuildStamp } from '../../src/utils/build-stamp.js';

const BUILT_FROM = Date.UTC(2026, 7, 2, 2, 57, 22);

function stamp(overrides: Partial<BuildStamp> = {}): BuildStamp {
  return {
    schema_version: 1,
    version: '2.5.0',
    commit: '45d95840aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    dirty: false,
    built_at: new Date(BUILT_FROM).toISOString(),
    newest_source_mtime: BUILT_FROM,
    source_dirs: ['src', 'bin', 'scripts'],
    ...overrides,
  };
}

describe('build freshness states', () => {
  it('reports `source` with no stamp — running via tsx, nothing can be stale', () => {
    const result = compareFreshness(null, 0);
    expect(result.state).toBe('source');
    expect(result.message).toBeNull();
  });

  it('reports `unknown`, never `fresh`, when there is no source to compare against', () => {
    // A published tarball ships dist/ only (package.json `files`), so every source dir scans to 0.
    // Claiming `fresh` there would assert a freshness nobody verified.
    const result = compareFreshness(stamp(), 0);
    expect(result.state).toBe('unknown');
  });

  it('reports `fresh` when source has not moved since the build', () => {
    expect(compareFreshness(stamp(), BUILT_FROM).state).toBe('fresh');
  });

  it('reports `stale` when source is newer than the build — the merged-but-not-built case', () => {
    // The reported incident, to scale: built 02:57:22, `provider` merged 03:44:27.
    const merged = Date.UTC(2026, 7, 2, 3, 44, 27);
    const result = compareFreshness(stamp(), merged);
    expect(result.state).toBe('stale');
    expect(result.message).toContain('running OLD code');
    expect(result.message).toContain('pnpm build');
  });
});

describe('mtime slack', () => {
  it('tolerates jitter within the slack window (filesystems that round mtimes)', () => {
    expect(compareFreshness(stamp(), BUILT_FROM + MTIME_SLACK_MS).state).toBe('fresh');
  });

  it('flags a gap just past the slack window', () => {
    expect(compareFreshness(stamp(), BUILT_FROM + MTIME_SLACK_MS + 1).state).toBe('stale');
  });

  it('does not flag source OLDER than the build', () => {
    expect(compareFreshness(stamp(), BUILT_FROM - 60_000).state).toBe('fresh');
  });
});

describe('which commit a process says it runs', () => {
  const HEAD = 'f'.repeat(40);
  const neverAsked = (): string | null => { throw new Error('the checkout was asked although the stamp names a commit'); };

  it('a built dist reports the commit it was BUILT from, and never asks the checkout', () => {
    const r = describeRunningBuild(compareFreshness(stamp({ dirty: true }), BUILT_FROM), neverAsked);
    expect(r).toEqual({
      commit: '45d95840aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', commit_source: 'stamp', dirty: true,
      built_at: new Date(BUILT_FROM).toISOString(), state: 'fresh',
    });
  });

  it('a pull without a rebuild shows the OLD commit and `stale`, which is the honest answer', () => {
    const r = describeRunningBuild(compareFreshness(stamp(), BUILT_FROM + 60_000), () => HEAD);
    expect(r.commit).toBe('45d95840aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(r.state).toBe('stale');
  });

  it('from source it reports the checkout\'s HEAD, and says it cannot know about uncommitted changes', () => {
    expect(describeRunningBuild(compareFreshness(null, 0), () => HEAD))
      .toEqual({ commit: HEAD, commit_source: 'git', dirty: null, built_at: null, state: 'source' });
  });

  it('a stamp made outside git falls back to the checkout, and with neither answers null', () => {
    const noCommit = compareFreshness(stamp({ commit: null, dirty: null }), 0);
    expect(describeRunningBuild(noCommit, () => HEAD)).toMatchObject({ commit: HEAD, commit_source: 'git', state: 'unknown' });
    expect(describeRunningBuild(noCommit, () => null)).toMatchObject({ commit: null, commit_source: null });
  });
});
