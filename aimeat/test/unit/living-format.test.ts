/**
 * @file test/unit/living-format.test.ts
 * @description `format`: how a living document says what a number should LOOK like, without
 *   changing what the number IS.
 *
 *   The defect this file was written for: `format` was documented on the formula, value and
 *   source node types and nothing read it, so a dew point printed as 15.7529759484 and the only
 *   way out was round(expr, 1) in the record — which put the rounding into the maths and made the
 *   typeset formula say something its author did not mean. So the two halves asserted here are
 *   the printing AND the untouched value flowing on to whatever stands on that node.
 *
 *   The vocabulary is deliberately the sentence template's: {{ t | 1 }} and "format": 1 are the
 *   same instruction, so two places reading one node cannot print it differently.
 * @usage cd aimeat && pnpm exec vitest run test/unit/living-format.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (living 0.3.0: format is read).
 */
import { describe, it, expect } from 'vitest';
import {
  parseFormat, formatError, formatNumber, formatParts, formatValue,
} from '../../src/static/sdk-libs/living/format.js';
import { createGraph } from '../../src/static/sdk-libs/living/graph.js';
import { parseUnit } from '../../src/static/sdk-libs/living/units.js';
import { asText } from '../../src/static/sdk-libs/living/formula-eval.js';

function q(n: number, unit: string) { return { n, u: parseUnit(unit) }; }

/** The number the finding was reported with: a dew point nobody wants eleven digits of. */
const DEW = 15.7529759484;

describe('format: the words', () => {
  it('a bare number is that many decimals, and it is the same instruction as the template bar', () => {
    expect(formatNumber(DEW, 1)).toBe('15.8');
    expect(formatNumber(DEW, '1')).toBe('15.8');
    expect(formatNumber(DEW, 3)).toBe('15.753');
  });

  it('int rounds, and the default keeps the number as a person would write it', () => {
    expect(formatNumber(3.6, 'int')).toBe('4');
    expect(formatNumber(DEW, null)).toBe('15.7529759484');
    expect(formatNumber(21, null)).toBe('21');
  });

  it('unit puts the unit after the number, and plain leaves it out', () => {
    expect(formatValue(q(22.5, '°C'), 'unit')).toBe('22.5 °C');
    expect(formatValue(q(22.5, '°C'), 'plain')).toBe('22.5');
    // The default leaves the unit to whoever is drawing, which is why it comes back on its own.
    expect(formatParts(q(22.5, '°C'), null)).toMatchObject({ number: '22.5', unit: '°C', place: 'none' });
  });

  it('percent reads a fraction of one as a percentage', () => {
    expect(formatValue(0.256, 'percent')).toBe('25.6 %');
  });

  it('upper and lower act on the words, not on a number', () => {
    expect(formatValue('hyvä', 'upper')).toBe('HYVÄ');
    expect(formatValue('Hyvä', 'lower')).toBe('hyvä');
  });

  it('a refusal prints as its own words, whatever the format asked for', () => {
    expect(formatValue({ error: 'no such node' }, 1)).toBe('no such node');
    expect(formatParts({ error: 'no such node' }, 1).refused).toBe(true);
  });
});

describe('format: the long form', () => {
  it('groups thousands only when asked, and the default stays locale-free', () => {
    expect(formatNumber(1234567.5, { decimals: 1 })).toBe('1234567.5');
    expect(formatNumber(1234567.5, { decimals: 1, group: true, locale: 'en-GB' })).toBe('1,234,567.5');
  });

  it('a locale is the moment the local convention takes over', () => {
    // Intl groups Finnish with a non-breaking or a narrow no-break space depending on the ICU
    // build, so what is asserted is the comma and the grouping, not which space landed.
    const written = formatNumber(1234.5, { decimals: 1, locale: 'fi-FI', group: true });
    expect(written.replace(/\s/gu, ' ')).toBe('1 234,5');
  });

  it('a currency is written by Intl, in the code the spec names', () => {
    expect(formatNumber(12, { style: 'currency', currency: 'EUR', locale: 'en-GB' })).toBe('€12.00');
  });

  it('maxDecimals is an upper bound, so a round number keeps no trailing zeros', () => {
    expect(formatNumber(15.75, { maxDecimals: 1 })).toBe('15.8');
    expect(formatNumber(15, { maxDecimals: 2 })).toBe('15');
  });

  it('the unit goes where the spec says, and the caller is told so', () => {
    expect(formatValue(q(22.5, '°C'), { decimals: 1, unit: 'after' })).toBe('22.5 °C');
    expect(formatValue(q(22.5, '°C'), { decimals: 1, unit: 'before' })).toBe('°C 22.5');
    expect(formatParts(q(22.5, '°C'), { unit: 'after' }).place).toBe('after');
  });

  it('prefix and suffix are literal text around the number', () => {
    expect(formatNumber(12, { prefix: '≈ ', suffix: ' /h', decimals: 0 })).toBe('≈ 12 /h');
  });
});

describe('format: a spec this build does not know is refused by name', () => {
  it('names the bad word and lists what it does know', () => {
    const said = formatError('fancy');
    expect(said).toContain('"fancy"');
    expect(said).toContain('int');
    expect(formatError(1)).toBe(null);
    expect(formatError({ decimals: 2 })).toBe(null);
    expect(formatError(null)).toBe(null);
  });

  it('a currency format with no code cannot be honoured, and says so', () => {
    expect(formatError({ style: 'currency' })).toMatch(/currency/);
  });

  it('a node carrying one refuses when the document is read, before anything renders', () => {
    const doc = {
      v: 1, layout: { v: 1, blocks: [] },
      model: { nodes: { t: { type: 'value', value: 1, format: 'fancy' } } },
    };
    const said = createGraph(doc).errors.join(' ');
    expect(said).toContain('"fancy"');
    expect(said).toContain('Node "t"');
  });

  it('parseFormat comes back with nothing for the empty cases, so the default stands', () => {
    expect(parseFormat(null)).toBe(null);
    expect(parseFormat('')).toBe(null);
    expect(parseFormat('text')).toBe(null);
  });
});

/**
 * The whole point: printing is not computing. The document below is the one the finding came
 * from — a dew point off a temperature and a humidity — and the number that flows on to the node
 * standing on it is the full one, whatever the printed one looks like.
 */
describe('format on a node: what is printed, and what flows on', () => {
  const doc = {
    v: 1,
    layout: { v: 1, blocks: [] },
    model: {
      nodes: {
        t: { type: 'value', value: 22, unit: '°C' },
        rh: { type: 'value', value: 72, unit: '%' },
        gamma: { type: 'formula', expr: 'ln(fraction(rh)) + 17.27 * t / (237.7 + t)' },
        dew: { type: 'formula', expr: '237.7 * gamma / (17.27 - gamma)', unit: '°C', format: 1, label: 'Kastepiste' },
        // Stands on the dew point, and must see every digit of it.
        gap: { type: 'formula', expr: 't - dew', unit: '°C' },
      },
    },
  };

  it('the answer is printed the way the node asked for', () => {
    const g = createGraph(doc);
    g.refresh();
    expect(g.errors).toEqual([]);
    expect(formatValue(g.valueOf('dew'), doc.model.nodes.dew.format)).toBe('16.7');
  });

  it('and the value itself is untouched, so what stands on it is not rounded', () => {
    const g = createGraph(doc);
    g.refresh();
    expect((g.valueOf('dew') as { n: number }).n).toBeCloseTo(16.712747525980333, 12);
    // 22 − 16.712747… , not 22 − 16.7. This is what round(expr, 1) in the record cost.
    expect((g.valueOf('gap') as { n: number }).n).toBeCloseTo(5.287252474019667, 12);
    expect(asText(g.valueOf('dew'))).toContain('16.7127');
  });

  it('a value node prints through its own format too, and still holds the number it held', () => {
    const one = {
      v: 1, layout: { v: 1, blocks: [] },
      model: { nodes: { p: { type: 'value', value: 1234.5678, unit: 'Pa', format: { decimals: 2 } } } },
    };
    const g = createGraph(one);
    g.refresh();
    expect(formatValue(g.valueOf('p'), one.model.nodes.p.format)).toBe('1234.57');
    expect((g.valueOf('p') as { n: number }).n).toBe(1234.5678);
  });
});
