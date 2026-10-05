/**
 * @file test/unit/validate-formats.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AIMEAT value formats are right, and the node and the browser agree on them.
 *
 *   WHY THIS FILE COMPARES TWO COPIES. The served aimeat-validate library checks formats in the
 *   browser (src/static/sdk-libs/validate/formats.js) and the node checks the same formats in its
 *   schema locks (src/services/input-formats.ts). The node cannot import the served file, so it
 *   carries a copy. A value the browser accepts and the node refuses is a form that says "right"
 *   and a save that fails, so every value below must get the same verdict from both.
 *
 *   The second half proves the node's schema-lock validator knows the formats and the x- keywords:
 *   before input-formats.ts, Ajv's strict mode refused a schema that named fi-business-id at all.
 * @usage cd aimeat && pnpm exec vitest run test/unit/validate-formats.test.ts
 * @version-history
 *   v1.0.0 - 2026-10-05 - Initial (wish-sy-tteiden-validointi-sovelluksiin-yksi-json-schema-ui-lle-a).
 */
import { describe, it, expect } from 'vitest';
import { FORMAT_TESTS } from '../../src/static/sdk-libs/validate/formats.js';
import { INPUT_FORMATS } from '../../src/services/input-formats.js';
import { validateValueAgainstSchema, validateSchemaItself } from '../../src/services/schema-validator.js';

/** name → [value, the verdict both copies must give]. */
const CASES: Record<string, Array<[string, true | string]>> = {
  'fi-business-id': [
    ['0737546-2', true], ['0737546-3', 'check'], ['1572860-0', true], ['0737546', 'shape'],
    ['737546-2', 'shape'], [' 0737546-2 ', true], ['abcdefg-1', 'shape'], ['0000001-1', 'check'],
  ],
  'fi-personal-id': [
    ['131052-308T', true], ['131052-308t', true], ['131052-308A', 'check'], ['310252-308T', 'date'],
    ['290200A123R', 'check'], ['131052+308T', true], ['131052Y308T', true], ['131052X308T', true],
    ['131052-308', 'shape'], ['13105-308T', 'shape'], ['290201A1234', 'date'], ['131052-308Z', 'shape'],
  ],
  iban: [
    ['FI21 1234 5600 0007 85', true], ['FI2112345600000785', true], ['fi21 1234 5600 0007 85', true],
    ['FI21 1234 5600 0007 84', 'check'], ['FI21 1234 5600 0007 8', 'length'], ['DE89 3704 0044 0532 0130 00', true],
    ['GB82 WEST 1234 5698 7654 32', true], ['NO93 8601 1117 947', true], ['XX', 'shape'], ['1234', 'shape'],
  ],
  'fi-postal-code': [['00100', true], ['99999', true], ['0010', 'shape'], ['001000', 'shape'], ['0010A', 'shape']],
  phone: [
    ['+358 40 123 4567', true], ['040-1234567', true], ['(09) 123 456', true], ['12345', 'shape'],
    ['+358 40 abc', 'shape'], ['+1234567890123456', 'shape'],
  ],
};

describe('the AIMEAT formats', () => {
  for (const [name, cases] of Object.entries(CASES)) {
    it(`${name}: each value gets the expected verdict in the browser copy`, () => {
      for (const [value, verdict] of cases) expect([value, FORMAT_TESTS[name](value)]).toEqual([value, verdict]);
    });
  }

  it('the two copies name the same formats', () => {
    expect(Object.keys(FORMAT_TESTS).sort()).toEqual(Object.keys(INPUT_FORMATS).sort());
  });

  it('the two copies give the same verdict on every listed value and on generated ones', () => {
    const values = Object.values(CASES).flat().map(([v]) => v);
    // Every one-character change of a valid value: a slip of one key is the mistake a person makes.
    for (const [, cases] of Object.entries(CASES)) {
      for (const [v, verdict] of cases) {
        if (verdict !== true) continue;
        for (let i = 0; i < v.length; i++) for (const ch of '0189AX-+ ') values.push(v.slice(0, i) + ch + v.slice(i + 1));
      }
    }
    for (const name of Object.keys(FORMAT_TESTS)) {
      for (const v of values) expect([name, v, INPUT_FORMATS[name](v)]).toEqual([name, v, FORMAT_TESTS[name](v)]);
    }
  });
});

describe('the node schema lock knows the formats and the x- keywords', () => {
  const schema = {
    type: 'object',
    properties: {
      ytunnus: { type: 'string', format: 'fi-business-id', 'x-hint': { fi: 'Y-tunnus', en: 'Business ID' }, 'x-messages': { format: 'Tarkista.' } },
      iban: { type: 'string', format: 'iban' },
      email: { type: 'string', format: 'email' },
      email2: { type: 'string', 'x-same-as': 'email' },
    },
  };

  it('accepts a schema that names them', () => {
    expect(validateSchemaItself(schema)).toBeNull();
  });

  it('accepts right values and refuses wrong ones, naming the field', () => {
    expect(validateValueAgainstSchema({ ytunnus: '0737546-2', iban: 'FI21 1234 5600 0007 85', email: 'a@b.fi', email2: 'a@b.fi' }, schema).ok).toBe(true);
    const bad = validateValueAgainstSchema({ ytunnus: '0737546-3' }, schema);
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).toContain('ytunnus');
    expect(validateValueAgainstSchema({ iban: 'FI21 1234 5600 0007 84' }, schema).ok).toBe(false);
  });

  it('x-same-as refuses a value that differs from its sibling', () => {
    expect(validateValueAgainstSchema({ email: 'a@b.fi', email2: 'a@b.fi' }, schema).ok).toBe(true);
    expect(validateValueAgainstSchema({ email: 'a@b.fi', email2: 'c@b.fi' }, schema).ok).toBe(false);
  });
});
