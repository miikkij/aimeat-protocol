/**
 * @file src/services/operator-place.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the privacy policy and the terms say the operator is. A company, an
 *   organisation or an association is named with its postal address. For a private person the pages
 *   give the email only: no postal address line and no "osoitteessa …" (Jouni, 2026-11-01 11.39,
 *   which replaced the "Maa: Suomi" line of 11.23). That holds even when an address is configured,
 *   because a store order sends the buyer's billing address as the operator's.
 *
 *   The country still appears where the pages state the governing law and where the node is run
 *   from. It is printed in the page's language: "Finland", "FI" and "Suomi" all read "Suomi" on a
 *   Finnish page and "Finland" on an English one. A value that names no country is printed as
 *   written. The Finnish pages inflect the country ("Suomen lakia", "Suomesta"), so the genitive and
 *   the elative come ready-made: a table for the countries a node is likely run from, and "maan X" /
 *   "maasta X" for any other, which is correct Finnish for every name.
 *
 * @structure
 *   - countryCodeOf(country): ISO 3166-1 alpha-2 code, or undefined when the value names no country
 *   - countryName(country, locale): the country in that language, else as written
 *   - operatorPlaceVars(operator, locale): the template variables portal.ts puts on the two pages
 *
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial: a private person's pages give the email only, not the address.
 */
import type { OperatorConfig } from '../config-types.js';
import type { Locale } from '../i18n.js';
import { jurisdictionOf } from './mydata-receipt.js';
import { escapeHtml } from '../utils/html-escape.js';

/** Region codes by their Finnish and Spanish names; English names are jurisdictionOf's. Built once. */
let codeByLocalName: Map<string, string> | null = null;
function localNames(): Map<string, string> {
  if (codeByLocalName) return codeByLocalName;
  codeByLocalName = new Map();
  for (const tag of ['fi', 'es']) {
    const names = new Intl.DisplayNames([tag], { type: 'region' });
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        const name = names.of(code);
        if (name && name !== code) codeByLocalName.set(name.toLowerCase(), code);
      }
    }
  }
  return codeByLocalName;
}

/** The ISO 3166-1 alpha-2 code the value names (a code, or a name in en, fi or es), or undefined. */
export function countryCodeOf(country: string | undefined): string | undefined {
  const c = (country ?? '').trim();
  if (!c) return undefined;
  // jurisdictionOf turns a code or an English name into a code, and returns anything else as written.
  const j = jurisdictionOf(c);
  if (/^[A-Z]{2}$/.test(j) && new Intl.DisplayNames(['en'], { type: 'region' }).of(j) !== j) return j;
  return localNames().get(c.toLowerCase());
}

/** The country in the page's language; a value that names no country is returned as written. */
export function countryName(country: string | undefined, locale: Locale): string {
  const c = (country ?? '').trim();
  const code = countryCodeOf(c);
  if (!code) return c;
  return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? c;
}

/** Finnish genitive and elative for the countries a node is likely run from. */
const FI_CASES: Record<string, { of: string; from: string }> = {
  FI: { of: 'Suomen', from: 'Suomesta' },
  SE: { of: 'Ruotsin', from: 'Ruotsista' },
  NO: { of: 'Norjan', from: 'Norjasta' },
  DK: { of: 'Tanskan', from: 'Tanskasta' },
  IS: { of: 'Islannin', from: 'Islannista' },
  EE: { of: 'Viron', from: 'Virosta' },
  LV: { of: 'Latvian', from: 'Latviasta' },
  LT: { of: 'Liettuan', from: 'Liettuasta' },
  DE: { of: 'Saksan', from: 'Saksasta' },
  FR: { of: 'Ranskan', from: 'Ranskasta' },
  ES: { of: 'Espanjan', from: 'Espanjasta' },
  IT: { of: 'Italian', from: 'Italiasta' },
  NL: { of: 'Alankomaiden', from: 'Alankomaista' },
  BE: { of: 'Belgian', from: 'Belgiasta' },
  AT: { of: 'Itävallan', from: 'Itävallasta' },
  CH: { of: 'Sveitsin', from: 'Sveitsistä' },
  IE: { of: 'Irlannin', from: 'Irlannista' },
  PT: { of: 'Portugalin', from: 'Portugalista' },
  PL: { of: 'Puolan', from: 'Puolasta' },
  GB: { of: 'Yhdistyneen kuningaskunnan', from: 'Yhdistyneestä kuningaskunnasta' },
  US: { of: 'Yhdysvaltojen', from: 'Yhdysvalloista' },
};

const ADDRESS_LABEL: Record<Locale, string> = { en: 'Postal address', fi: 'Postiosoite', es: 'Dirección postal' };

/**
 * The variables the privacy and terms templates read for the operator's place:
 * operatorCountry (in the page's language), operatorCountryOf and operatorCountryFrom (the Finnish
 * genitive and elative; the name itself in en and es), operatorAddressBlock (section 1's postal
 * address paragraph), operatorAddressContact (the contact section's postal address line, with the
 * line break before it) and operatorAddressClause (", located at …" after the operator's name).
 * The last three are empty for a private person.
 */
export function operatorPlaceVars(operator: OperatorConfig, locale: Locale): Record<string, string> {
  const person = operator.type === 'natural_person';
  const country = countryName(operator.country, locale);
  const code = countryCodeOf(operator.country);
  const fiCases = locale === 'fi'
    ? (code && FI_CASES[code]) || { of: `maan ${country}`, from: `maasta ${country}` }
    : { of: country, from: country };
  const address = person ? '' : escapeHtml((operator.address ?? '').trim());
  const label = ADDRESS_LABEL[locale];
  return {
    operatorCountry: country,
    operatorCountryOf: fiCases.of,
    operatorCountryFrom: fiCases.from,
    operatorAddressBlock: address ? `<p><strong>${label}:</strong> ${address}</p>` : '',
    operatorAddressContact: address ? `<br>\n    ${label}: ${address}` : '',
    operatorAddressClause: address
      ? { en: `, located at ${address}`, fi: ` osoitteessa ${address}`, es: `, con domicilio en ${address}` }[locale]
      : '',
  };
}
