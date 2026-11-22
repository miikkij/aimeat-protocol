/**
 * @file test/unit/data-map-shape.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A data map whose parts do not have the shape the page reads: a held row's value
 *   outside the closed vocabulary, a `leaves` entry written as a plain sentence or without where it
 *   goes and whether it can be recalled, and an `elsewhere` entry without a known status, where,
 *   controlledBy and deletion. Each is a finding that names the entries, never a refusal, and a
 *   complete map has none of them. Seen red first: the three codes did not exist.
 * @usage cd aimeat && pnpm exec vitest run test/unit/data-map-shape.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-22 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { checkMap, FINDING_CODES } from '../../src/services/data-map/data-map-check.js';
import { DATA_MAP_SPEC, type DataMap, type DataMapRow } from '../../src/services/data-map/data-map-types.js';

const AT = '2026-11-22T00:00:00.000Z';

const row = (over: Record<string, unknown> = {}): DataMapRow => ({
  what: 'notes.*', holds: 'notes', kind: 'user-written', usedFor: 'user-returns-to-read',
  where: 'owner-memory-private', owner: 'person', readers: 'owner-only',
  writers: ['the-app-for-the-person'], shape: 'one-record', keptFor: 'until-deleted',
  lossRisk: 'only-copy', personalData: 'no', why: 'They are one person\'s own notes.', ...over,
} as DataMapRow);

const map = (over: Record<string, unknown> = {}): DataMap => ({
  spec: DATA_MAP_SPEC, what: 'A notebook.', usedFor: 'Writing notes.', form: 'one-person',
  arrangement: 'One record in your own memory.', machinery: [], leaves: [], held: [row()], elsewhere: [],
  source: 'declared', at: AT, ...over,
} as DataMap);

const finding = (m: DataMap, code: string) => checkMap(m, AT).findings.find(f => f.code === code);
const SHAPE_CODES = ['DATAMAP_ROW_BAD_VALUE', 'DATAMAP_LEAVES_INCOMPLETE', 'DATAMAP_ELSEWHERE_INCOMPLETE'];

describe('the shape of a data map\'s parts', () => {
  it('finds nothing in a complete map', () => {
    const complete = map({
      leaves: [{ what: 'the invoice PDF', to: 'the customer\'s e-mail', recallable: false }],
      elsewhere: [{ what: 'a draft', status: 'work-in-progress', where: 'this browser', controlledBy: 'the person', deletion: 'Nothing else is lost.' }],
    });
    const codes = checkMap(complete, AT).findings.map(f => f.code);
    for (const code of SHAPE_CODES) expect(codes).not.toContain(code);
  });

  it('names a held row value outside the vocabulary, field by field, writers included', () => {
    const f = finding(map({ held: [row({ what: 'tiedot', usedFor: 'shown-in-the-app', lossRisk: 'can-be-rebuilt', writers: ['person-in-the-ui', 'a-robot'] })] }), 'DATAMAP_ROW_BAD_VALUE');
    expect(f?.message).toContain('tiedot (usedFor: shown-in-the-app, writers: a-robot, lossRisk: can-be-rebuilt)');
  });

  it('names a leaves entry written as a plain sentence, and one that leaves out recallable', () => {
    const f = finding(map({ leaves: ['Print via the browser', { what: 'a CSV file', to: 'the person\'s device' }] }), 'DATAMAP_LEAVES_INCOMPLETE');
    expect(f?.message).toMatch(/^2 of 2 entries/);
    expect(f?.message).toContain('Print via the browser; a CSV file');
  });

  it('names an elsewhere entry with a why instead of a status, where, controlledBy and deletion', () => {
    const f = finding(map({ elsewhere: [{ what: 'localStorage notes.lang', why: 'The language survives a reload.' }] }), 'DATAMAP_ELSEWHERE_INCOMPLETE');
    expect(f?.message).toContain('localStorage notes.lang');
  });

  it('ranks the three after the publishable finding and before the classification one, so the last four stay as they were', () => {
    const at = (c: string) => FINDING_CODES.indexOf(c as typeof FINDING_CODES[number]);
    for (const code of SHAPE_CODES) {
      expect(at(code)).toBeGreaterThan(at('DATAMAP_ROW_BAD_PUBLISHABLE'));
      expect(at(code)).toBeLessThan(at('DATAMAP_ROW_BAD_CLASSIFICATION'));
    }
    const check = checkMap(map({ held: [row({ why: '', kind: 'nonsense' })] }), AT);
    expect(check.gap?.code).toBe('DATAMAP_ROW_NO_WHY');
  });
});
