/**
 * @file test/unit/worksheet-evaluate.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a worksheet answers, and what it refuses. The fixture is the example from the
 *   wish: an outdoor reading, a target a person moves, the difference between them, and the power
 *   that follows — because the chain is the point, and because a temperature difference is the one
 *   place the maths library's own answer is wrong for a reader (21 degC − −12 degC is 33 K, not
 *   33 degC, and only the first converts to the 59.4 degrees of difference a Fahrenheit reader
 *   expects).
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { evaluateSheet, substitute, topologicalOrder, dependenciesOf } from '../../src/services/worksheet/evaluate.js';
import { knownUnit, differenceUnit, formatQuantity, tidy, unitExpr, unitJson } from '../../src/services/worksheet/units.js';
import type { Worksheet, WorksheetCell } from '../../src/models/worksheet-schemas.js';

const sheet = (cells: WorksheetCell[], extra: Partial<Worksheet> = {}): Worksheet => ({ cells, ...extra });
const cellOf = (out: ReturnType<typeof evaluateSheet>, id: string) => out.cells.find(c => c.id === id)!;

describe('units', () => {
  it('knows a real unit from a made-up one', () => {
    expect(knownUnit('degC')).toBe(true);
    expect(knownUnit('m')).toBe(true);
    expect(knownUnit('banana')).toBe(false);
    expect(knownUnit('')).toBe(false);
  });

  it('puts a difference of two affine readings on the absolute scale', () => {
    expect(differenceUnit('degC')).toBe('K');
    expect(differenceUnit('degF')).toBe('R');
    expect(differenceUnit('m')).toBe('m');
    expect(differenceUnit(null)).toBe(null);
  });

  it('drops the float dust an affine conversion leaves', () => {
    expect(tidy(211.99999999999994)).toBe(212);
    expect(tidy(-0)).toBe(0);
  });

  it('writes the number in the reader own language, with the unit symbol', () => {
    expect(formatQuantity({ value: 212, unit: 'degF' }, 'en')).toBe('212 °F');
    expect(formatQuantity({ value: 1.5, unit: null }, 'en')).toBe('1.5');
  });

  it('keeps a multi-letter unit whole, which the maths parser does not', () => {
    // ce.parse('km/h') reads k times m over h. The unit grammar reads one name.
    expect(unitExpr('km/h')).toEqual(['Divide', 'km', 'h']);
    expect(unitExpr('degC')).toBe('degC');
    expect(unitExpr('W/(m^2*K)')).toEqual(['Divide', 'W', ['Multiply', ['Power', 'm', 2], 'K']]);
    expect(knownUnit('km/h')).toBe(true);
    expect(knownUnit('W/(m^2*K)')).toBe(true);
    expect(unitExpr('m^')).toBe(null);
  });

  it('writes a compound unit the way it is written on paper', () => {
    expect(unitJson(['Divide', 'W', ['Multiply', 'K', ['Power', 'm', 2]]])).toBe('W/(K·m²)');
    expect(unitJson(['Power', 'm', 2])).toBe('m²');
    expect(unitJson('degC')).toBe('degC');
  });
});

describe('evaluateSheet — the chain', () => {
  const heating = sheet([
    { id: 'T_ulko', kind: 'quantity', value: -12, unit: 'degC', label: 'Outside' },
    { id: 'T_sisa', kind: 'input', value: 21, unit: 'degC', min: 5, max: 30 },
    { id: 'dT', kind: 'formula', math: ['Subtract', 'T_sisa', 'T_ulko'] },
    { id: 'U', kind: 'quantity', value: 0.24, unit: 'W/(m^2*K)' },
    { id: 'A', kind: 'quantity', value: 140, unit: 'm^2' },
    { id: 'teho', kind: 'formula', math: ['Multiply', 'U', 'A', 'dT'] },
  ]);

  it('reads the graph out of the formulas own names', () => {
    const out = evaluateSheet(heating);
    expect(cellOf(out, 'dT').dependsOn).toEqual(['T_sisa', 'T_ulko']);
    expect(cellOf(out, 'teho').dependsOn.sort()).toEqual(['A', 'U', 'dT']);
    expect(out.order.indexOf('dT')).toBeLessThan(out.order.indexOf('teho'));
  });

  it('answers the difference in kelvin, not in celsius', () => {
    const dT = cellOf(evaluateSheet(heating), 'dT');
    expect(dT.ok).toBe(true);
    expect(dT.value).toBe(33);
    expect(dT.unit).toBe('K');
  });

  it('carries a compound unit through the multiplication and answers in watts', () => {
    const teho = cellOf(evaluateSheet(heating), 'teho');
    expect(teho.ok).toBe(true);
    expect(teho.unit).toBe('W');
    expect(teho.formatted).toBe('1,108.8 W');
  });

  it('carries the chain through: moving the input moves what stands on it', () => {
    const cold = cellOf(evaluateSheet(heating), 'teho');
    expect(cold.ok).toBe(true);
    expect(cold.value).toBeCloseTo(0.24 * 140 * 33, 6);

    const warmer = heating.cells.map(c => (c.id === 'T_sisa' ? { ...c, value: 23 } : c)) as WorksheetCell[];
    const out = evaluateSheet(sheet(warmer));
    expect(cellOf(out, 'dT').value).toBe(35);
    expect(cellOf(out, 'teho').value).toBeCloseTo(0.24 * 140 * 35, 6);
    // Nothing that does not stand on the input moved.
    expect(cellOf(out, 'T_ulko').value).toBe(-12);
  });

  it('takes a live reading over the stored one', () => {
    const out = evaluateSheet(heating, { values: { T_ulko: -20 } });
    expect(cellOf(out, 'T_ulko').value).toBe(-20);
    expect(cellOf(out, 'dT').value).toBe(41);
  });
});

describe('evaluateSheet — units', () => {
  it('converts a reading to the unit the cell asks for', () => {
    const out = evaluateSheet(sheet([
      { id: 'boiling', kind: 'quantity', value: 100, unit: 'degC' },
      { id: 'inF', kind: 'formula', math: 'boiling', unit: 'degF' },
    ]));
    expect(cellOf(out, 'inF').value).toBe(212);
    expect(cellOf(out, 'inF').unit).toBe('degF');
    expect(cellOf(out, 'inF').formatted).toBe('212 °F');
  });

  it('adds lengths that agree', () => {
    const out = evaluateSheet(sheet([
      { id: 'a', kind: 'quantity', value: 12, unit: 'cm' },
      { id: 'b', kind: 'quantity', value: 1, unit: 'm' },
      { id: 'total', kind: 'formula', math: ['Add', 'a', 'b'] },
    ]));
    expect(cellOf(out, 'total').ok).toBe(true);
    expect(cellOf(out, 'total').value).toBe(1.12);
    expect(cellOf(out, 'total').unit).toBe('m');
  });

  it('refuses metres plus seconds, and says which two did not agree', () => {
    const out = evaluateSheet(sheet([
      { id: 'len', kind: 'quantity', value: 1, unit: 'm' },
      { id: 'dur', kind: 'quantity', value: 1, unit: 's' },
      { id: 'nope', kind: 'formula', math: ['Add', 'len', 'dur'] },
    ]));
    const nope = cellOf(out, 'nope');
    expect(nope.ok).toBe(false);
    expect(nope.error?.code).toBe('INCOMPATIBLE_UNITS');
    expect(nope.error?.names?.sort()).toEqual(['m', 's']);
    // The cells that do stand still stand.
    expect(cellOf(out, 'len').ok).toBe(true);
    expect(out.errors).toBe(1);
  });

  it('refuses a unit nothing is spelled', () => {
    const out = evaluateSheet(sheet([{ id: 'x', kind: 'quantity', value: 1, unit: 'banana' }]));
    expect(cellOf(out, 'x').error?.code).toBe('UNKNOWN_UNIT');
  });

  it('refuses a conversion between different things', () => {
    const out = evaluateSheet(sheet([
      { id: 'len', kind: 'quantity', value: 1, unit: 'm' },
      { id: 'asTime', kind: 'formula', math: 'len', unit: 's' },
    ]));
    expect(cellOf(out, 'asTime').error?.code).toBe('INCOMPATIBLE_UNITS');
  });
});

describe('evaluateSheet — what it refuses', () => {
  it('names a symbol no cell carries', () => {
    const out = evaluateSheet(sheet([{ id: 'x', kind: 'formula', math: ['Add', 'ghost', 1] }]));
    expect(cellOf(out, 'x').error?.code).toBe('UNKNOWN_SYMBOL');
    expect(cellOf(out, 'x').error?.names).toEqual(['ghost']);
  });

  it('names every cell standing in a cycle', () => {
    const out = evaluateSheet(sheet([
      { id: 'a', kind: 'formula', math: ['Add', 'b', 1] },
      { id: 'b', kind: 'formula', math: ['Add', 'a', 1] },
    ]));
    expect(cellOf(out, 'a').error?.code).toBe('CYCLE');
    expect(cellOf(out, 'b').error?.code).toBe('CYCLE');
    expect(cellOf(out, 'a').error?.names?.sort()).toEqual(['a', 'b']);
  });

  it('refuses a cell standing on itself', () => {
    const out = evaluateSheet(sheet([{ id: 'a', kind: 'formula', math: ['Add', 'a', 1] }]));
    expect(cellOf(out, 'a').ok).toBe(false);
  });

  it('says which dependency is missing rather than repeating its complaint', () => {
    const out = evaluateSheet(sheet([
      { id: 'src', kind: 'quantity', unit: 'degC', live: 'sensors.outside' },
      { id: 'twice', kind: 'formula', math: ['Multiply', 2, 'src'] },
    ]));
    expect(cellOf(out, 'src').error?.code).toBe('NO_VALUE');
    expect(cellOf(out, 'twice').error?.code).toBe('UPSTREAM');
    expect(cellOf(out, 'twice').error?.names).toEqual(['src']);
  });

  it('refuses a formula with nothing in it', () => {
    const out = evaluateSheet(sheet([{ id: 'a', kind: 'formula' }]));
    expect(cellOf(out, 'a').error?.code).toBe('NO_FORMULA');
  });

  it('reads a person typed maths, and refuses what does not parse', () => {
    const ok = evaluateSheet(sheet([
      { id: 'a', kind: 'quantity', value: 3 },
      { id: 'sq', kind: 'formula', latex: 'a^2' },
    ]));
    expect(cellOf(ok, 'sq').value).toBe(9);
    const bad = evaluateSheet(sheet([{ id: 'x', kind: 'formula', latex: '\\frac{' }]));
    expect(cellOf(bad, 'x').ok).toBe(false);
  });

  it('an empty sheet is a standing sheet', () => {
    const out = evaluateSheet(sheet([]));
    expect(out.cells).toEqual([]);
    expect(out.errors).toBe(0);
  });
});

describe('the pieces', () => {
  it('substitutes operands and never the operator', () => {
    const answers = new Map([['Add', { value: 5, unit: null }], ['x', { value: 2, unit: 'm' }]]);
    expect(substitute(['Add', 'x', 1], answers)).toEqual(['Add', ['Quantity', 2, 'm'], 1]);
  });

  it('orders what can be worked out and names what cannot', () => {
    const byId = new Map<string, WorksheetCell>([
      ['a', { id: 'a', kind: 'quantity', value: 1 }],
      ['b', { id: 'b', kind: 'formula', math: ['Add', 'a', 1] }],
      ['c', { id: 'c', kind: 'formula', math: ['Add', 'c', 1] }],
    ]);
    const deps = new Map([['a', []], ['b', ['a']], ['c', ['c']]]);
    const { order, cyclic } = topologicalOrder(byId, deps);
    expect(order).toEqual(['a', 'b']);
    expect(cyclic).toEqual(['c']);
  });

  it('a view stands on the cell it draws', () => {
    const byId = new Map<string, WorksheetCell>([['t', { id: 't', kind: 'quantity', value: 1 }]]);
    expect(dependenciesOf({ id: 'v', kind: 'view', as: 'gauge', of: 't' }, byId)).toEqual({ on: ['t'], unknown: [] });
    expect(dependenciesOf({ id: 'v', kind: 'view', as: 'gauge', of: 'nope' }, byId)).toEqual({ on: [], unknown: ['nope'] });
  });
});
