/**
 * @file test/unit/app-track-drift.test.ts
 * @description A publish says so when a build left the Atelier track, and stays quiet when it did
 *   not. The quiet cases matter as much as the loud ones: an owner with sixty Classic apps updates
 *   them every week, and a warning on each of those would teach everybody to stop reading hints.
 * @usage cd aimeat && pnpm vitest run test/unit/app-track-drift.test.ts
 * @version-history
 *   v2.0.0 — 2026-11-19 — One track: a new non-Atelier page is named whatever token it carried, and an
 *     update of a Classic app is quiet with the Atelier token too (track-drift.ts v2.0.0).
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { trackDriftFindings } from '../../src/services/app/track-drift.js';

const base = { isUpdate: false, track: undefined, loadsAtelier: false, carriedAtelierToken: false } as const;

// One track since 2026-11-19 (track-drift.ts v2.0.0): the retired Classic address hands out the
// Atelier token too, so the token no longer says which guide a build read.
describe('a new app that is not an Atelier app', () => {
  it('is named whichever token it carried, with the shell and custom:<name> for a page of its own', () => {
    const f = trackDriftFindings({ ...base, carriedAtelierToken: true });
    expect(f.map(x => x.pitfall)).toEqual(['track-drift']);
    expect(f[0].message).toMatch(/owner/i);
    expect(f[0].message).toMatch(/shell-atelier/);
    expect(f[0].message).toMatch(/custom:<name>/);
  });

  it('an UPDATE of a Classic app stays quiet even with the Atelier token', () => {
    expect(trackDriftFindings({ ...base, isUpdate: true, track: 'classic', carriedAtelierToken: true })).toEqual([]);
  });

  it('a NEW app on Classic is named, once, with what to tell the owner', () => {
    const f = trackDriftFindings({ ...base, track: 'classic' });
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('warn');
    expect(f[0].message).toMatch(/new app/i);
    expect(f[0].message).toMatch(/build-app-atelier/);
  });

  it('a new app that declares nothing is Classic too', () => {
    expect(trackDriftFindings(base)).toHaveLength(1);
  });
});

describe('what stays quiet', () => {
  it('a new Atelier app', () => {
    expect(trackDriftFindings({ ...base, track: 'atelier', loadsAtelier: true, carriedAtelierToken: true })).toEqual([]);
  });
  it('an app that loads the kit and forgot the declaration: the track-mixing check owns that', () => {
    expect(trackDriftFindings({ ...base, loadsAtelier: true })).toEqual([]);
  });
  it('an update of an app that is already Classic', () => {
    expect(trackDriftFindings({ ...base, isUpdate: true, track: 'classic' })).toEqual([]);
    expect(trackDriftFindings({ ...base, isUpdate: true })).toEqual([]);
  });
});
