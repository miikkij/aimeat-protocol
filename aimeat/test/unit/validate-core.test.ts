/**
 * @file test/unit/validate-core.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT.validate's core says per field, in the person's language, what is wrong:
 *   a missing field, a field required because another is filled in, a wrong format by its reason,
 *   a length, a range, a box that must be ticked, a repeated value that differs, a choice between
 *   fields, and a field's own words from x-messages. An empty answer counts as no answer.
 *   ready() and missing() answer the step question over named fields. The Atelier form's
 *   schemaFromFields folds a form's fields into the schema the same core reads.
 * @usage cd aimeat && pnpm exec vitest run test/unit/validate-core.test.ts
 * @version-history
 *   v1.0.0 - 2026-10-05 - Initial (wish-sy-tteiden-validointi-sovelluksiin-yksi-json-schema-ui-lle-a).
 */
import { describe, it, expect } from 'vitest';
import { compile, check, hint, addFormat, formats } from '../../src/static/sdk-libs/validate/core.js';
import { schemaFromFields } from '../../src/static/sdk-libs/atelier/form-check.js';
import { MESSAGES, FORMAT_HINTS, FORMAT_MESSAGES } from '../../src/static/sdk-libs/validate/messages.js';

const SCHEMA = {
  type: 'object',
  required: ['name', 'ytunnus'],
  properties: {
    name: { type: 'string', title: 'Nimi', minLength: 2, maxLength: 5 },
    ytunnus: { type: 'string', title: 'Y-tunnus', format: 'fi-business-id' },
    company: { type: 'boolean', title: 'Yritys' },
    iban: { type: 'string', title: 'IBAN', format: 'iban' },
    age: { type: 'integer', title: 'Ikä', minimum: 18 },
    email: { type: 'string', title: 'Sähköposti', format: 'email' },
    email2: { type: 'string', title: 'Sähköposti uudelleen', 'x-same-as': 'email' },
    terms: { type: 'boolean', const: true },
    code: { type: 'string', pattern: '^[A-Z]{3}$', 'x-messages': { pattern: { fi: 'Kolme isoa kirjainta.', en: 'Three capital letters.' } }, 'x-hint': { fi: 'Esimerkiksi ABC.', en: 'Such as ABC.' } },
  },
  dependencies: { company: ['iban'] },
};

const OK = { name: 'Ab', ytunnus: '0737546-2' };

describe('check: one message per problem, next to its field', () => {
  const v = compile(SCHEMA);

  it('a right value has no problems', () => {
    const r = v.check(OK, { lang: 'fi' });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('a missing required field says to fill it in, in the language asked', () => {
    expect(v.check({}, { lang: 'fi' }).fields.name.message).toBe('Täytä tämä kenttä.');
    expect(v.check({}, { lang: 'en' }).fields.name.message).toBe('Fill in this field.');
    expect(v.check({}, { lang: 'es' }).fields.name.message).toBe('Completa este campo.');
  });

  it('an empty string is no answer: required says missing, an optional empty field passes', () => {
    const r = v.check({ name: '', ytunnus: '0737546-2', iban: '' }, { lang: 'fi' });
    expect(r.fields.name.rule).toBe('required');
    expect(r.fields.iban).toBeUndefined();
    expect(v.check({ name: '', ytunnus: '0737546-2' }, { lang: 'fi', keepEmpty: true }).fields.name.rule).toBe('minLength');
  });

  it('a wrong format says why, by the reason the test gave', () => {
    expect(v.check({ ...OK, ytunnus: '0737546-3' }, { lang: 'fi' }).fields.ytunnus.message).toBe(FORMAT_MESSAGES.fi['fi-business-id'].check);
    expect(v.check({ ...OK, ytunnus: '123' }, { lang: 'fi' }).fields.ytunnus.message).toBe(FORMAT_MESSAGES.fi['fi-business-id'].shape);
    expect(v.check({ ...OK, iban: 'FI21 1234 5600 0007 8' }, { lang: 'en' }).fields.iban.params).toEqual({ format: 'iban', reason: 'length' });
  });

  it('a field required because another is filled in names the other one', () => {
    const r = v.check({ ...OK, company: true }, { lang: 'fi' });
    expect(r.fields.iban.message).toBe('Täytä myös tämä, koska Yritys on täytetty.');
    expect(r.fields.iban.params).toEqual({ because: 'company' });
  });

  it('lengths, ranges, types and a box that must be ticked', () => {
    const r = v.check({ name: 'Abcdefg', ytunnus: '0737546-2', age: 12, terms: false }, { lang: 'fi' });
    expect(r.fields.name.message).toBe('Enintään 5 merkkiä. Nyt merkkejä on 7.');
    expect(r.fields.age.message).toBe('Pienin sallittu arvo on 18.');
    expect(r.fields.terms.message).toBe(MESSAGES.fi.constTrue);
    expect(v.check({ ...OK, age: 18.5 }, { lang: 'fi' }).fields.age.message).toBe('Kirjoita tähän kokonaisluku.');
    expect(v.check({ name: 'A', ytunnus: '0737546-2' }, { lang: 'en' }).fields.name.message).toBe('Write at least 2 characters.');
  });

  it('x-same-as names the field the value must equal, by its label', () => {
    expect(v.check({ ...OK, email: 'a@b.fi', email2: 'a@c.fi' }, { lang: 'fi' }).fields.email2.message).toBe('Tämä ei ole sama kuin kentässä Sähköposti.');
    expect(v.check({ ...OK, email: 'a@b.fi', email2: 'a@b.fi' }).valid).toBe(true);
  });

  it("a field's own words in x-messages win, per language", () => {
    expect(v.check({ ...OK, code: 'ab' }, { lang: 'fi' }).fields.code.message).toBe('Kolme isoa kirjainta.');
    expect(v.check({ ...OK, code: 'ab' }, { lang: 'es' }).fields.code.message).toBe('Three capital letters.');
  });

  it('labels given by the caller replace the schema titles in a message', () => {
    const r = v.check({ ...OK, company: true }, { lang: 'en', labels: { company: 'Company' } });
    expect(r.fields.iban.message).toBe('Fill in this field too, because Company is filled in.');
  });

  it('problems come in the order of the schema properties', () => {
    expect(v.check({ name: 'A', age: 1 }, { lang: 'en' }).errors.map((e: any) => e.field)).toEqual(['name', 'ytunnus', 'age']);
  });
});

describe('a choice between fields', () => {
  const v = compile({
    type: 'object',
    properties: { phone: { type: 'string', title: 'Puhelin' }, email: { type: 'string', title: 'Sähköposti' } },
    anyOf: [{ required: ['phone'] }, { required: ['email'] }],
  });

  it('anyOf names the fields, and the problem belongs to the whole form', () => {
    const r = v.check({ phone: '' }, { lang: 'fi' });
    expect(r.form).toHaveLength(1);
    expect(r.form[0].message).toBe('Täytä ainakin yksi näistä: Puhelin tai Sähköposti.');
    expect(r.form[0].fields).toEqual(['phone', 'email']);
    expect(v.check({ email: 'a@b.fi' }).valid).toBe(true);
  });

  it('oneOf with both filled in says only one', () => {
    const one = compile({ type: 'object', properties: { a: { type: 'string', title: 'A' }, b: { type: 'string', title: 'B' } }, oneOf: [{ required: ['a'] }, { required: ['b'] }] });
    expect(one.check({ a: 'x', b: 'y' }, { lang: 'en' }).form[0].message).toBe('Fill in only one of these: A or B.');
  });
});

describe('ready and missing: the step question', () => {
  const v = compile(SCHEMA);

  it('ready is true only when every named field is right', () => {
    expect(v.ready({ name: 'Ab' }, ['name'])).toBe(true);
    expect(v.ready({ name: 'Ab' }, ['name', 'ytunnus'])).toBe(false);
    expect(v.ready(OK)).toBe(true);
  });

  it('missing lists the named fields still wrong, in the order of the form', () => {
    expect(v.missing({ name: 'A', ytunnus: '1' }, ['ytunnus', 'name'])).toEqual(['name', 'ytunnus']);
  });
});

describe('hints', () => {
  it('a format field expects what its format looks like; x-hint wins', () => {
    expect(hint(SCHEMA, 'ytunnus', 'fi')).toBe(FORMAT_HINTS.fi['fi-business-id']);
    expect(hint(SCHEMA, 'code', 'fi')).toBe('Esimerkiksi ABC.');
    expect(hint(SCHEMA, 'name', 'fi')).toBe('');
  });

  it('every language has the same message keys and format hints', () => {
    for (const l of ['fi', 'es']) {
      expect(Object.keys(MESSAGES[l]).sort()).toEqual(Object.keys(MESSAGES.en).sort());
      expect(Object.keys(FORMAT_HINTS[l]).sort()).toEqual(Object.keys(FORMAT_HINTS.en).sort());
      expect(Object.keys(FORMAT_MESSAGES[l]).sort()).toEqual(Object.keys(FORMAT_MESSAGES.en).sort());
    }
  });
});

describe('a format of the page', () => {
  it('addFormat checks it, with its own words', () => {
    addFormat('three-letters', (v: string) => /^[a-z]{3}$/.test(v), { hint: { en: 'Three letters.' }, message: { en: 'Use three letters.' } });
    expect(formats()).toContain('three-letters');
    const s = { type: 'object', properties: { t: { type: 'string', format: 'three-letters' } } };
    expect(check(s, { t: 'abcd' }, { lang: 'en' }).fields.t.message).toBe('Use three letters.');
    expect(check(s, { t: 'abc' }).valid).toBe(true);
    expect(hint(s, 't', 'en')).toBe('Three letters.');
  });
});

describe('schemaFromFields: a form\'s fields as one schema', () => {
  it('folds each declaration into the property and keeps the host schema as the base', () => {
    const s = schemaFromFields([
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'web', label: 'Web', type: 'url' },
      { name: 'tel', label: 'Phone', type: 'tel' },
      { name: 'n', label: 'N', type: 'number', min: 1, max: 9 },
      { name: 'ok', label: 'Accept', type: 'checkbox', required: true },
      { name: 'again', label: 'Again', sameAs: 'email', messages: { sameAs: 'Must match.' } },
      { name: 'y', label: 'Y', format: 'fi-business-id' },
    ], { properties: { y: { type: 'string', 'x-hint': 'Own hint' } }, anyOf: [{ required: ['email'] }, { required: ['tel'] }] });
    expect(s.required).toEqual(['email', 'ok']);
    expect(s.properties.email).toEqual({ title: 'Email', type: 'string', format: 'email' });
    expect(s.properties.web.format).toBe('uri');
    expect(s.properties.tel.format).toBe('phone');
    expect(s.properties.n).toMatchObject({ type: 'number', minimum: 1, maximum: 9 });
    expect(s.properties.ok).toMatchObject({ type: 'boolean', const: true });
    expect(s.properties.again).toMatchObject({ 'x-same-as': 'email', 'x-messages': { sameAs: 'Must match.' } });
    expect(s.properties.y).toMatchObject({ format: 'fi-business-id', 'x-hint': 'Own hint' });
    expect(s.anyOf).toHaveLength(2);
    const r = compile(s).check({ email: 'a@b.fi', ok: false, again: 'x' }, { lang: 'en' });
    expect(r.fields.ok.message).toBe('Tick this to continue.');
    expect(r.fields.again.message).toBe('Must match.');
  });
});
