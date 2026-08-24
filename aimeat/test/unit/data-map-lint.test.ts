/**
 * @file test/unit/data-map-lint.test.ts
 * @description The publish-time data-map check.
 *
 *   The first property asserted is the one most likely to be quietly broken later: this check NEVER
 *   refuses. A gate that refused on a missing map would break the next publish of all 169 apps in
 *   production, and the developer decided on 2026-08-24 that it warns and stamps instead. That is a
 *   claim about behaviour, so it is a test and not a comment.
 *
 *   The second is that exactly ONE gap is stored while every finding reaches the hints. The gap is a
 *   single field on the manifest, mirroring aiPosture; a check that quietly dropped the other
 *   findings would leave a builder fixing one thing per publish round-trip.
 * @usage pnpm test -- data-map-lint
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 5.
 */
import { describe, it, expect } from 'vitest';
import { lintDataMap, DATA_MAP_GAP_CODES } from '../../src/services/data-map/data-map-lint.js';
import { DATA_MAP_SPEC, emptyDataMap, publicDataMap, type DataMap, type DataMapRow } from '../../src/services/data-map/data-map-types.js';

const AT = '2026-08-24T12:00:00.000Z';

function row(over: Partial<DataMapRow> = {}): DataMapRow {
  return {
    grant: { area: 'memory', pattern: 'cadence.*', rights: ['read', 'write'] },
    basis: { tier: 'declared-space', by: 'app:cadence' },
    why: 'Campaigns belong to the customer, not to whoever sent them.',
    ownership: 'owner',
    readers: { visibility: 'owner' },
    deletion: { effect: 'gone', says: 'Deleting removes the record.' },
    retention: { kind: 'until-deleted' },
    personalData: 'no',
    source: 'declared',
    ...over,
  };
}

function map(over: Partial<DataMap> = {}): DataMap {
  return { spec: DATA_MAP_SPEC, form: 'single-person', held: [row()], elsewhere: [], source: 'declared', at: AT, ...over };
}

describe('it never refuses — the decision, asserted', () => {
  it('returns a map and hints for the worst case there is', () => {
    const result = lintDataMap({
      map: emptyDataMap('single-person', AT),
      scopes: ['memory:write', 'memory:delete', 'organism:write'],
      programId: 'cadence', at: AT, declaresNothing: true,
    });
    expect(result.map).toBeDefined();
    expect(result.map.gap!.code).toBe('DATAMAP_MISSING');
    expect(result.hints.length).toBeGreaterThan(0);
  });

  it('has no way of signalling a refusal at all', () => {
    const result = lintDataMap({ map: map(), scopes: [], programId: 'cadence', at: AT, declaresNothing: false });
    expect(Object.keys(result).sort()).toEqual(['hints', 'map']);
  });
});

describe('one gap is stored, every finding reaches the hints', () => {
  it('picks the worst code when several fire', () => {
    const result = lintDataMap({
      map: map({
        held: [row({ grant: { area: 'memory', pattern: 'openrouter.settings', rights: ['write'] }, why: '' })],
      }),
      scopes: ['memory:write', 'storage:write'],
      programId: 'cadence', at: AT, declaresNothing: false,
    });
    // reserved-claim outranks the unmapped storage scope and the missing why, both of which also fired.
    expect(result.map.gap!.code).toBe('DATAMAP_RESERVED_CLAIM');
    expect(result.hints.length).toBeGreaterThan(1);
  });

  it('stores no gap on a map with nothing wrong with it', () => {
    const result = lintDataMap({
      map: map(), scopes: ['memory:read', 'memory:write'], programId: 'cadence', at: AT, declaresNothing: false,
    });
    expect(result.map.gap).toBeUndefined();
  });

  it('every code in the severity list is a real string, in order', () => {
    expect(new Set(DATA_MAP_GAP_CODES).size).toBe(DATA_MAP_GAP_CODES.length);
    expect(DATA_MAP_GAP_CODES[0]).toBe('DATAMAP_MISSING');
    expect(DATA_MAP_GAP_CODES.at(-1)).toBe('DATAMAP_DERIVED_UNCONFIRMED');
  });
});

describe('each finding', () => {
  it('DATAMAP_RESERVED_CLAIM: a row claiming a place only the node writes', () => {
    const result = lintDataMap({
      map: map({ held: [row({ grant: { area: 'memory', pattern: 'commerce.psp', rights: ['write'] } })] }),
      scopes: ['memory:write'], programId: 'x', at: AT, declaresNothing: false,
    });
    expect(result.map.gap!.code).toBe('DATAMAP_RESERVED_CLAIM');
    expect(result.hints.join(' ')).toContain('commerce.');
  });

  it('DATAMAP_SCOPE_UNMAPPED: asks for a permission no row uses', () => {
    const result = lintDataMap({
      map: map(), scopes: ['memory:write', 'storage:write'], programId: 'x', at: AT, declaresNothing: false,
    });
    expect(result.map.gap!.code).toBe('DATAMAP_SCOPE_UNMAPPED');
    expect(result.hints.join(' ')).toMatch(/did not need to give/);
  });

  it('DATAMAP_ROW_UNSCOPED: a row promising a write the app never asked for', () => {
    const result = lintDataMap({
      map: map(), scopes: ['memory:read'], programId: 'x', at: AT, declaresNothing: false,
    });
    expect(result.map.gap!.code).toBe('DATAMAP_ROW_UNSCOPED');
  });

  it('DATAMAP_DELETION_UNANSWERED: the question a deletion request arrives asking', () => {
    const result = lintDataMap({
      map: map({ held: [row({ deletion: { effect: 'unknown', says: '' } })] }),
      scopes: ['memory:read', 'memory:write'], programId: 'x', at: AT, declaresNothing: false,
    });
    expect(result.map.gap!.code).toBe('DATAMAP_DELETION_UNANSWERED');
  });

  it('DATAMAP_FORM_INCOMPLETE: a one-person program claiming an organism area', () => {
    const result = lintDataMap({
      map: map({
        form: 'single-person',
        held: [row({ grant: { area: 'organisms', pattern: 'organism.o.w.ws-x.s.*', rights: ['read'] }, ownership: 'organism', readers: { visibility: 'workspace' } })],
      }),
      scopes: ['organism:read'], programId: 'x', at: AT, declaresNothing: false,
    });
    expect(result.map.gap!.code).toBe('DATAMAP_FORM_INCOMPLETE');
    expect(result.hints.join(' ')).toMatch(/one of the two is wrong/i);
  });

  it('DATAMAP_NO_WHY: a row that says where and not why', () => {
    const result = lintDataMap({
      map: map({ held: [row({ why: '   ' })] }),
      scopes: ['memory:read', 'memory:write'], programId: 'x', at: AT, declaresNothing: false,
    });
    expect(result.map.gap!.code).toBe('DATAMAP_NO_WHY');
  });

  it('DATAMAP_DERIVED_UNCONFIRMED is last, because on day one it is true of everything', () => {
    const result = lintDataMap({
      map: map({ source: 'derived' }),
      scopes: ['memory:read', 'memory:write'], programId: 'x', at: AT, declaresNothing: false,
    });
    expect(result.map.gap!.code).toBe('DATAMAP_DERIVED_UNCONFIRMED');
  });

  it('a program that stores nothing and asks for nothing is finished, not unfinished', () => {
    const result = lintDataMap({
      map: emptyDataMap('single-person', AT), scopes: [], programId: 'x', at: AT, declaresNothing: true,
    });
    expect(result.map.gap).toBeUndefined();
  });
});

describe('the gap is the owner\'s business', () => {
  it('publicDataMap strips it and leaves the rows, which are the promise', () => {
    const withGap = lintDataMap({
      map: map({ source: 'derived' }), scopes: ['memory:read', 'memory:write'],
      programId: 'x', at: AT, declaresNothing: false,
    }).map;
    const shown = publicDataMap(withGap);
    expect(shown.gap).toBeUndefined();
    expect(shown.held).toHaveLength(1);
    expect(withGap.gap).toBeDefined();   // the original is untouched
  });
});
