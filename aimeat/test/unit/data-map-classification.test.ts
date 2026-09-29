/**
 * @file test/unit/data-map-classification.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A data-map row's optional `classification`: the label id the app expects for that key
 *   family by default. It is checked for shape and reported as a finding; it never refuses a map and
 *   it never changes the spec version.
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V5.
 */
import { describe, it, expect } from 'vitest';
import { checkMap, FINDING_CODES } from '../../src/services/data-map/data-map-check.js';
import { DATA_MAP_SPEC, type DataMap, type DataMapRow } from '../../src/services/data-map/data-map-types.js';

const AT = '2026-09-29T00:00:00.000Z';

const row = (over: Partial<DataMapRow> & Record<string, unknown> = {}): DataMapRow => ({
  what: 'notes.*', holds: 'notes', kind: 'user-written', usedFor: 'user-returns-to-read',
  where: 'owner-memory-private', owner: 'person', readers: 'owner-only',
  writers: ['the-app-for-the-person'], shape: 'one-record', keptFor: 'until-deleted',
  lossRisk: 'only-copy', personalData: 'no', why: 'They are one person\'s own notes.', ...over,
} as DataMapRow);

const map = (held: DataMapRow[]): DataMap => ({
  spec: DATA_MAP_SPEC, what: 'A notebook.', usedFor: 'Writing notes.', form: 'one-person',
  arrangement: 'One record in your own memory.', machinery: [], leaves: [], held, elsewhere: [],
  source: 'declared', at: AT,
});

const codes = (m: DataMap): string[] => checkMap(m, AT).findings.map(f => f.code);

describe('a held row may say which classification the app expects', () => {
  it('the spec version is unchanged, because the field is optional', () => {
    expect(DATA_MAP_SPEC).toBe('aimeat.datamap/2');
  });

  it('a row without the field is a complete row', () => {
    expect(codes(map([row()]))).toEqual([]);
  });

  it.each(['luottamuksellinen', 'erittain-luottamuksellinen', 'julkinen', 'top-secret', 'l2', 'a', 'a'.repeat(40)])(
    'accepts the label id %s', id => {
      expect(codes(map([row({ classification: id })]))).toEqual([]);
    });

  it.each([
    ['upper case', 'Luottamuksellinen'],
    ['a space', 'top secret'],
    ['an underscore', 'top_secret'],
    ['a letter outside a-z', 'erittäin'],
    ['an empty string', ''],
    ['41 characters', 'a'.repeat(41)],
    ['a leading dash', '-internal'],
    ['a number', 20],
    ['null', null],
    ['an object', { id: 'luottamuksellinen' }],
  ])('reports %s as a finding', (_label, value) => {
    const check = checkMap(map([row({ what: 'secrets.*', classification: value as string })]), AT);
    const found = check.findings.find(f => f.code === 'DATAMAP_ROW_BAD_CLASSIFICATION');
    expect(found).toBeDefined();
    expect(found!.message).toContain('secrets.*');
  });

  it('counts only the rows that are wrong', () => {
    const m = map([
      row({ what: 'a.*', classification: 'luottamuksellinen' }),
      row({ what: 'b.*', classification: 'Bad Label' }),
      row({ what: 'c.*' }),
    ]);
    const found = checkMap(m, AT).findings.find(f => f.code === 'DATAMAP_ROW_BAD_CLASSIFICATION');
    expect(found!.message).toMatch(/^1 of 3 rows/);
    expect(found!.message).toContain('b.*');
    expect(found!.message).not.toContain('a.*');
  });

  it('is the least severe finding, so a missing why stays the gap a list shows', () => {
    expect(FINDING_CODES[FINDING_CODES.length - 1]).toBe('DATAMAP_ROW_BAD_CLASSIFICATION');
    const check = checkMap(map([row({ why: '', classification: 'NOPE' })]), AT);
    expect(check.findings.map(f => f.code)).toEqual(['DATAMAP_ROW_NO_WHY', 'DATAMAP_ROW_BAD_CLASSIFICATION']);
    expect(check.gap?.code).toBe('DATAMAP_ROW_NO_WHY');
  });
});
