/**
 * @file test/unit/app-track-drift.test.ts
 * @description A publish says so when a build left the Atelier track, and stays quiet when it did
 *   not. The quiet cases matter as much as the loud ones: an owner with sixty Classic apps updates
 *   them every week, and a warning on each of those would teach everybody to stop reading hints.
 * @usage cd aimeat && pnpm vitest run test/unit/app-track-drift.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { trackDriftFindings } from '../../src/services/app-track-drift.js';

const base = { isUpdate: false, track: undefined, loadsAtelier: false, carriedAtelierToken: false } as const;

describe('a build that left the Atelier track', () => {
  it('read the Atelier specification and published a Classic app: the track changed mid-build', () => {
    const f = trackDriftFindings({ ...base, carriedAtelierToken: true });
    expect(f.map(x => x.pitfall)).toEqual(['track-drift']);
    expect(f[0].message).toMatch(/carried the Atelier/i);
    expect(f[0].message).toMatch(/owner/i);
  });

  it('says the same on an UPDATE, because the token is proof of which guide this session read', () => {
    expect(trackDriftFindings({ ...base, isUpdate: true, track: 'classic', carriedAtelierToken: true })).toHaveLength(1);
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
