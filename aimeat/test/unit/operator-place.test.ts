/**
 * @file test/unit/operator-place.test.ts
 * @description Where the privacy and terms pages say the operator is (services/operator-place.ts):
 *   a private person's pages give the email only, never the postal address, even when one is
 *   configured; a company's pages keep the address; the Finnish pages inflect the country
 *   correctly; and no template still reads the removed {{operatorAddress}}.
 * @usage pnpm test -- operator-place
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (Jouni, 11.39: email only, no address, no country line, no "osoitteessa …").
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countryName, operatorPlaceVars } from '../../src/services/operator-place.js';
import { missingOperatorConfig } from '../../src/config-operator.js';
import type { OperatorConfig } from '../../src/config-types.js';
import type { Locale } from '../../src/i18n.js';

const HOME = 'Kotikatu 1 A 2, 00100 Helsinki';

function operator(type: OperatorConfig['type'], country = 'Finland'): OperatorConfig {
  return {
    name: 'Testi Henkilö', type, businessId: '', address: HOME, country, email: 'owner@example.com',
    securityEmail: '', hostingName: 'Hetzner', hostingUrl: '', hostingLocation: 'Helsinki',
    supervisoryName: 'Tietosuojavaltuutettu', supervisoryUrl: 'https://tietosuoja.fi', effectiveDate: '2026-11-01',
  } as OperatorConfig;
}

/** A template with the operator-place variables filled in, as portal.ts does for these keys. */
function render(file: string, op: OperatorConfig, locale: Locale): string {
  const vars = operatorPlaceVars(op, locale);
  const html = readFileSync(join(__dirname, '../../public', file), 'utf-8');
  return html.replace(/\{\{(\w+)\}\}/g, (m, key: string) => vars[key] ?? m);
}

describe('countryName', () => {
  it('prints a country in the page language from an English name, a code or a Finnish name', () => {
    expect(countryName('Finland', 'fi')).toBe('Suomi');
    expect(countryName('FI', 'fi')).toBe('Suomi');
    expect(countryName('Suomi', 'en')).toBe('Finland');
    expect(countryName('Finland', 'es')).toBe('Finlandia');
  });
  it('prints a value that names no country as written', () => {
    expect(countryName('Ahvenanmaan saaristo', 'fi')).toBe('Ahvenanmaan saaristo');
  });
});

describe('a private person', () => {
  const person = operator('natural_person');

  it('is given with the email only: no postal address line and no country line, on every page in fi and en', () => {
    for (const [file, locale] of [['privacy.fi.html', 'fi'], ['terms.fi.html', 'fi'], ['privacy.html', 'en'], ['terms.html', 'en']] as const) {
      const page = render(file, person, locale);
      expect(page, file).not.toContain('Kotikatu');
      expect(page, file).not.toMatch(/Postiosoite|Postal address|Maa:|Country:/);
      expect(page, file).toContain('{{operatorEmail}}</a></p>');
    }
    // The terms name the operator with no "osoitteessa …" / ", located at …" after the type.
    expect(render('terms.fi.html', person, 'fi')).toContain('{{operatorBusinessIdClause}} ("ylläpitäjä"');
    expect(render('terms.html', person, 'en')).toContain('{{operatorBusinessIdClause}} ("Operator"');
  });

  it('is not asked for an address before the pages are served', () => {
    expect(missingOperatorConfig({ ...person, address: '' })).toEqual([]);
  });
});

describe('a company', () => {
  const company = operator('company');

  it('keeps its postal address on both pages', () => {
    expect(render('privacy.fi.html', company, 'fi')).toContain(`Postiosoite:</strong> ${HOME}`);
    expect(render('privacy.html', company, 'en')).toContain(`<br>\n    Postal address: ${HOME}</p>`);
    expect(render('terms.fi.html', company, 'fi')).toContain(`<br>\n    Postiosoite: ${HOME}</p>`);
    expect(render('terms.fi.html', company, 'fi')).toContain(` osoitteessa ${HOME} ("ylläpitäjä"`);
    expect(render('terms.html', company, 'en')).toContain(`, located at ${HOME} ("Operator"`);
  });

  it('must still give an address', () => {
    expect(missingOperatorConfig({ ...company, address: '' })).toEqual(['address']);
  });
});

describe('the Finnish pages inflect the country', () => {
  it('as Suomen and Suomesta, not Finlandn or Suomista', () => {
    const terms = render('terms.fi.html', operator('company'), 'fi');
    const privacy = render('privacy.fi.html', operator('company'), 'fi');
    expect(terms).toContain('sovelletaan Suomen lakia');
    expect(privacy).toContain('ylläpidetään Suomesta');
    expect(privacy).toContain('kuin Suomen kirjanpitolainsäädäntö');
  });
  it('says "maan X" for a country outside the table', () => {
    expect(render('terms.fi.html', operator('company', 'Japan'), 'fi')).toContain('sovelletaan maan Japani lakia');
  });
});

describe('the templates', () => {
  it('no longer read {{operatorAddress}}', () => {
    for (const file of ['privacy.html', 'privacy.fi.html', 'terms.html', 'terms.fi.html']) {
      expect(readFileSync(join(__dirname, '../../public', file), 'utf-8'), file).not.toContain('{{operatorAddress}}');
    }
  });
});
