/**
 * @file test/unit/kyc-screening.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sanctions screening (src/services/kyc/screening): both list parsers on hand-written
 *   samples of the real formats (test/fixtures/kyc, invented names only), the input refusals, the
 *   list version, the name matcher's cases (exact, reordered, diacritics, alias, entity legal form,
 *   a near name below the threshold, a differing birth year) and the speed on a 50 000-entry list.
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  jaroWinkler, listOf, listVersion, normaliseName, parseEuFsf, parseUnConsolidated, screen,
  type SanctionsEntry, type SanctionsList,
} from '../../src/services/kyc/screening/index.js';
import { _clearScreeningCache } from '../../src/services/kyc/screening/match.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/kyc/${name}`, import.meta.url)), 'utf8');
const EU_XML = fixture('eu-fsf-sample.xml');
const UN_XML = fixture('un-consolidated-sample.xml');

beforeEach(() => _clearScreeningCache());

describe('parseEuFsf', () => {
  const entries = parseEuFsf(EU_XML);
  const byId = (id: string): SanctionsEntry => entries.find((e) => e.id === id)!;

  it('reads every sanctionEntity by localName under the default namespace', () => {
    expect(entries.map((e) => e.id)).toEqual(['900101', '900102', '900103']);
    expect(entries.every((e) => e.source === 'eu-fsf')).toBe(true);
  });

  it('reads kind, names in order, birth dates, countries, programme and listing date', () => {
    const ivan = byId('900101');
    expect(ivan.kind).toBe('person');
    expect(ivan.names).toEqual(['Ivan Petrovski', 'Иван Петровский', 'Ivan Petrovskiy']);
    expect(ivan.birthDates).toEqual(['1971-04-12']);
    expect(ivan.countries).toEqual(['RU']);
    expect(ivan.programme).toBe('RUS');
    expect(ivan.listedOn).toBe('2022-03-15');

    const ship = byId('900102');
    expect(ship.kind).toBe('entity');
    expect(ship.names).toEqual(['DARKWATER SHIPPING LLC', 'Darkwater Maritime Ltd.']);
    expect(ship.countries).toEqual(['AE']);
    expect(ship.birthDates).toEqual([]);

    const sasha = byId('900103');
    expect(sasha.names).toHaveLength(3);
    expect(sasha.birthDates).toEqual(['1965']);
    expect(sasha.countries).toEqual(['BY']);
    expect(sasha.programme).toBe('BLR');
  });
});

describe('parseUnConsolidated', () => {
  const entries = parseUnConsolidated(UN_XML);

  it('reads individuals then entities, with REFERENCE_NUMBER or DATAID as id', () => {
    expect(entries.map((e) => [e.id, e.kind])).toEqual([
      ['KPi.901', 'person'], ['7000102', 'person'], ['KPe.901', 'entity'],
    ]);
  });

  it('joins the name parts, keeps aliases, skips empty aliases, reads DATE, YEAR and a year range', () => {
    const [petar, volk, lantern] = entries;
    expect(petar.names).toEqual(['PETAR STEFAN DRAGIĆ', 'Petar Dragic', 'Steve Dragic']);
    expect(petar.birthDates).toEqual(['1968-09-30', '1967']);
    expect(petar.countries).toEqual(['Serbia']);
    expect(petar.programme).toBe('DPRK');
    expect(petar.listedOn).toBe('2017-06-02');
    expect(volk.birthDates).toEqual(['1964', '1965', '1966']);
    expect(lantern.names).toEqual(['Northern Lantern Trading Company', 'N.L. Trading Co.', 'Severny Fonar']);
    expect(lantern.birthDates).toEqual([]);
  });
});

describe('input refusals and version', () => {
  it('refuses a DOCTYPE and an ENTITY declaration', () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE export [<!ENTITY a "aaaa">]><export>&a;</export>';
    expect(() => parseEuFsf(bomb)).toThrow(/DOCTYPE/);
    expect(() => listOf('un', '<!ENTITY x "y"><CONSOLIDATED_LIST/>')).toThrow(/ENTITY/);
  });

  it('refuses a wrong root element and malformed XML', () => {
    expect(() => parseEuFsf(UN_XML)).toThrow(/root element/);
    expect(() => parseUnConsolidated('<CONSOLIDATED_LIST><INDIVIDUALS>')).toThrow();
  });

  it('gives the same version for the same bytes and another for different bytes', () => {
    const a = listOf('eu-fsf', Buffer.from(EU_XML, 'utf8'), '2026-11-19T00:00:00Z');
    const b = listOf('eu-fsf', EU_XML);
    expect(a.version).toMatch(/^[0-9a-f]{16}$/);
    expect(b.version).toBe(a.version);
    expect(a.fetchedAt).toBe('2026-11-19T00:00:00Z');
    expect(a.entries).toHaveLength(3);
    expect(listVersion(EU_XML.replace('900101', '900109'))).not.toBe(a.version);
  });
});

describe('normaliseName and jaroWinkler', () => {
  it('folds diacritics, transliteration variants and punctuation', () => {
    expect(normaliseName('  Petrovskí,  JÖRG-Łukasz ')).toBe('petrovski jorg lukasz');
    expect(normaliseName('Straße Ærø Đorđe O\'Neil')).toBe('strasse aero dorde oneil');
  });

  it('drops legal forms only when asked, and never to nothing', () => {
    expect(normaliseName('Darkwater Shipping Oy')).toBe('darkwater shipping oy');
    expect(normaliseName('Darkwater Shipping Oy', { dropLegalForms: true })).toBe('darkwater shipping');
    expect(normaliseName('L.L.C. Co.', { dropLegalForms: true })).toBe('llc co');
  });

  it('matches the textbook Jaro-Winkler values', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3);
    expect(jaroWinkler('dixon', 'dicksonx')).toBeCloseTo(0.813, 3);
    expect(jaroWinkler('abc', 'abc')).toBe(1);
    expect(jaroWinkler('', 'abc')).toBe(0);
  });
});

describe('screen', () => {
  const lists: SanctionsList[] = [listOf('eu-fsf', EU_XML), listOf('un', UN_XML)];

  it('scores an exact name 1', () => {
    const hits = screen({ kind: 'person', name: 'Ivan Petrovski' }, lists);
    expect(hits[0]).toMatchObject({ source: 'eu-fsf', id: '900101', score: 1, listedName: 'Ivan Petrovski', programme: 'RUS' });
    expect(hits[0].reasons).toContain('name exact');
  });

  it('scores reordered tokens 0.97', () => {
    const hits = screen({ kind: 'person', name: 'Volkonov Sasha' }, lists);
    expect(hits[0]).toMatchObject({ id: '900103', listedName: 'Sasha Volkonov', score: 0.97 });
    expect(hits[0].reasons).toEqual(['name tokens reordered']);
  });

  it('keeps the higher similarity when a near alias outscores the reordered name', () => {
    // "Petrovski Ivan" is a reordering of "Ivan Petrovski" (0.97) and one letter from the alias
    // "Ivan Petrovskiy" in sorted-token form, which Jaro-Winkler scores higher.
    const hits = screen({ kind: 'person', name: 'Petrovski Ivan' }, lists);
    expect(hits[0]).toMatchObject({ id: '900101', listedName: 'Ivan Petrovskiy' });
    expect(hits[0].score).toBeGreaterThan(0.97);
  });

  it('matches through diacritics', () => {
    const hits = screen({ kind: 'person', name: 'Iván Petrovskí' }, lists);
    expect(hits[0]).toMatchObject({ id: '900101', score: 1 });
    const un = screen({ kind: 'person', name: 'Petar Stefan Dragic' }, lists);
    expect(un[0]).toMatchObject({ source: 'un', id: 'KPi.901', score: 1 });
  });

  it('matches a listed alias and a subject alias', () => {
    const listed = screen({ kind: 'person', name: 'Sasha Volkonov' }, lists);
    expect(listed.find((h) => h.id === '900103')).toMatchObject({ listedName: 'Sasha Volkonov', score: 1 });
    const own = screen({ kind: 'person', name: 'John Smith', aliases: ['Steve Dragic'] }, lists);
    expect(own[0]).toMatchObject({ id: 'KPi.901', matchedName: 'Steve Dragic', score: 1 });
  });

  it('ignores the legal form of an entity, and never matches across kinds', () => {
    const hits = screen({ kind: 'entity', name: 'Darkwater Shipping Oy' }, lists);
    expect(hits[0]).toMatchObject({ id: '900102', kind: 'entity', listedName: 'DARKWATER SHIPPING LLC', score: 1 });
    expect(hits[0].reasons).toEqual(['name exact', 'legal form ignored']);
    expect(screen({ kind: 'person', name: 'Darkwater Shipping LLC' }, lists)).toEqual([]);
  });

  it('scores a misspelling by similarity and returns it above the threshold', () => {
    const hits = screen({ kind: 'person', name: 'Ivan Petrovsky' }, lists);
    expect(hits[0].id).toBe('900101');
    expect(hits[0].score).toBeGreaterThanOrEqual(0.88);
    expect(hits[0].score).toBeLessThan(1);
    expect(hits[0].reasons[0]).toMatch(/^name similar 0\.\d\d$/);
  });

  it('does not return a different person with a similar name', () => {
    expect(screen({ kind: 'person', name: 'Igor Petrenko' }, lists)).toEqual([]);
    expect(screen({ kind: 'person', name: 'Ivana Pedersen' }, lists)).toEqual([]);
  });

  it('raises an equal birth date and lowers a differing birth year by 0.15', () => {
    const equal = screen({ kind: 'person', name: 'Ivan Petrovsky', birthDate: '1971-04-12', country: 'RU' }, lists);
    expect(equal[0]).toMatchObject({ id: '900101', score: 0.99 });
    expect(equal[0].reasons).toEqual(expect.arrayContaining(['birth date equal', 'country listed']));

    const differs = screen({ kind: 'person', name: 'Sasha Volkonov', birthDate: '1980-02-02' }, lists);
    expect(differs).toEqual([]);
    const low = screen({ kind: 'person', name: 'Sasha Volkonov', birthDate: '1980-02-02' }, lists, { threshold: 0.8 });
    expect(low.find((h) => h.id === '900103')).toMatchObject({ score: 0.85, reasons: ['name exact', 'birth year differs'] });

    const sameYear = screen({ kind: 'person', name: 'Sasha Volkonov', birthDate: '1965' }, lists);
    expect(sameYear.find((h) => h.id === '900103')?.reasons).toEqual(['name exact', 'birth year equal']);
  });

  it('returns the best hit per entry, sorted by score', () => {
    const hits = screen({ kind: 'person', name: 'Aleksandr Volkonov', aliases: ['Alexander Volkonov'] }, lists);
    expect(hits.map((h) => h.id)).toEqual(['7000102', '900103']);
    expect(hits[0].score).toBe(1);
    expect(new Set(hits.map((h) => `${h.source}:${h.id}`)).size).toBe(hits.length);
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
  });

  it('screens a 50 000-entry list with three names each in under 2 s', () => {
    const syllables = ['ka', 'lo', 'mi', 'ne', 'ru', 'sa', 'to', 'vi', 'ze', 'da', 'ri', 'po', 'gu', 'he', 'bo'];
    let seed = 42;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    const word = (): string => {
      const n = 2 + (rnd() % 3);
      let w = '';
      for (let i = 0; i < n; i++) w += syllables[rnd() % syllables.length];
      return w[0].toUpperCase() + w.slice(1);
    };
    const entries: SanctionsEntry[] = [];
    for (let i = 0; i < 50_000; i++) {
      const first = word();
      const last = word();
      entries.push({
        source: 'eu-fsf', id: `gen-${i}`, kind: 'person',
        names: [`${first} ${last}`, `${last} ${first}`, `${first} ${word()} ${last}`],
        birthDates: [`${1940 + (i % 60)}`], countries: [], programme: 'TEST',
      });
    }
    entries.push({
      source: 'eu-fsf', id: 'needle', kind: 'person', names: ['Ivan Petrovski'],
      birthDates: ['1971-04-12'], countries: ['RU'], programme: 'TEST',
    });
    const big: SanctionsList = { source: 'eu-fsf', version: 'generated000001', entries };

    const t0 = performance.now();
    const hits = screen({ kind: 'person', name: 'Ivan Petrovski', aliases: ['I. Petrovski'], birthDate: '1971-04-12' }, [big]);
    const cold = performance.now() - t0;
    const t1 = performance.now();
    screen({ kind: 'person', name: 'Rumika Tolosa' }, [big]);
    const warm = performance.now() - t1;

    expect(hits[0]).toMatchObject({ id: 'needle', score: 1 });
    expect(cold).toBeLessThan(2000);
    expect(warm).toBeLessThan(2000);
    console.info(`[kyc-screening] 50 000 entries x 3 names: first screen ${cold.toFixed(0)} ms (prepares), second ${warm.toFixed(0)} ms (cached)`);
  });
});
