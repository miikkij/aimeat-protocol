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
import { compareFreshness, MTIME_SLACK_MS, type BuildStamp } from '../../src/utils/build-stamp.js';

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
