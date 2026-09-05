/**
 * @file test/unit/living-text.test.ts
 * @description The sentence that changes with the state: the template parser, the conditionals,
 *   the formats, and the two rules a caption depends on — a quantity prints as its NUMBER
 *   (because the author has already typed the unit into the sentence around it) and the output is
 *   TEXT, never markup.
 * @usage cd aimeat && pnpm vitest run test/unit/living-text.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { describe, it, expect } from 'vitest';
import { parseTemplate, renderTemplate, symbolsOfTemplate, formatValue } from '../../src/static/sdk-libs/living/text.js';
import { parseUnit } from '../../src/static/sdk-libs/living/units.js';
import { isError } from '../../src/static/sdk-libs/living/formula-eval.js';

function scopeOf(map: Record<string, unknown>) {
  return { get: (id: string) => (Object.prototype.hasOwnProperty.call(map, id) ? map[id] : undefined) };
}
function q(n: number, unit: string) { return { n, u: parseUnit(unit) }; }
function render(src: string, map: Record<string, unknown> = {}) {
  return renderTemplate(parseTemplate(src) as never, scopeOf(map));
}

describe('parseTemplate', () => {
  it('keeps the words between the tags', () => {
    expect(render('Nothing to fill in.')).toBe('Nothing to fill in.');
  });

  it('names every node the template reads', () => {
    const parts = parseTemplate('{{ t }} and {{ if t > s }}{{ note }}{{ end }}');
    expect(symbolsOfTemplate(parts as never).sort()).toEqual(['note', 's', 't']);
  });

  it('refuses a tag that never closes, an {{ end }} with no {{ if }}, and an if with no end', () => {
    expect(isError(parseTemplate('a {{ t'))).toBe(true);
    expect(isError(parseTemplate('a {{ end }}'))).toBe(true);
    expect(isError(parseTemplate('{{ if t > 1 }}yes'))).toBe(true);
  });

  it('says which tag would not parse', () => {
    const bad = parseTemplate('{{ 2 * * 3 }}') as { error: string };
    expect(bad.error).toContain('2 * * 3');
  });
});

describe('renderTemplate: what goes in the braces is a formula', () => {
  it('a bare name prints that node', () => {
    expect(render('It is {{ t }}.', { t: 22 })).toBe('It is 22.');
  });

  it('an expression works, without a second syntax for it', () => {
    expect(render('{{ round(t, 1) }}', { t: 3.14159 })).toBe('3.1');
    expect(render('{{ a + b }}', { a: 2, b: 3 })).toBe('5');
  });

  it('a quantity prints as its number, and | unit prints both', () => {
    expect(render('{{ t }} °C', { t: q(22.5, '°C') })).toBe('22.5 °C');
    expect(render('{{ t | unit }}', { t: q(22.5, '°C') })).toBe('22.5 °C');
  });

  it('a refusal shows up where it happened, in words', () => {
    expect(render('{{ ghost }}', {})).toMatch(/nothing called "ghost"/);
  });
});

describe('renderTemplate: conditionals', () => {
  it('picks the branch the condition asks for', () => {
    const src = 'Lämpötila on {{ t }} °C, {{ if t > 30 }}liian kuuma{{ else }}hyvä{{ end }}.';
    expect(render(src, { t: q(22, '°C') })).toBe('Lämpötila on 22 °C, hyvä.');
    expect(render(src, { t: q(31, '°C') })).toBe('Lämpötila on 31 °C, liian kuuma.');
  });

  it('an if with no else prints nothing when it is false', () => {
    expect(render('a{{ if t > 30 }} — hot{{ end }}.', { t: 12 })).toBe('a.');
    expect(render('a{{ if t > 30 }} — hot{{ end }}.', { t: 42 })).toBe('a — hot.');
  });

  it('an if inside an if works', () => {
    const src = '{{ if a }}A{{ if b }}B{{ else }}b{{ end }}{{ else }}none{{ end }}';
    expect(render(src, { a: true, b: true })).toBe('AB');
    expect(render(src, { a: true, b: false })).toBe('Ab');
    expect(render(src, { a: false, b: true })).toBe('none');
  });

  it('the condition can compare text, which is how a machine state reads', () => {
    expect(render('{{ if state = "hot" }}kuuma{{ else }}ok{{ end }}', { state: 'hot' })).toBe('kuuma');
    expect(render('{{ if state = "hot" }}kuuma{{ else }}ok{{ end }}', { state: 'fine' })).toBe('ok');
  });
});

describe('formatValue: the ways a value is written out', () => {
  it('a bare number after the bar is that many decimals', () => {
    expect(render('{{ t | 2 }}', { t: 3.14159 })).toBe('3.14');
    expect(render('{{ t | 0 }}', { t: 3.7 })).toBe('4');
  });

  it('int, percent, upper and lower', () => {
    expect(formatValue(3.6, 'int')).toBe('4');
    expect(formatValue(0.256, 'percent')).toBe('25.6 %');
    expect(formatValue('hyvä', 'upper')).toBe('HYVÄ');
    expect(formatValue('Hyvä', 'lower')).toBe('hyvä');
  });

  it('a bar inside a text literal is not a format bar', () => {
    expect(render('{{ "a|b" }}')).toBe('a|b');
  });

  it('a list reads as its members', () => {
    expect(render('{{ readings }}', { readings: [1, 2, 3] })).toBe('1, 2, 3');
  });
});

describe('renderTemplate: it is text, never markup', () => {
  it('hands back the angle brackets as characters, for whoever renders to set as text', () => {
    expect(render('{{ note }}', { note: '<b>x</b>' })).toBe('<b>x</b>');
  });
});
