/**
 * @file test/unit/datapackage-dcat.test.ts
 * @description The pure parts of the DCAT feed (services/datapackage/dcat.ts): a cron gets an EU
 *   frequency word only when the word says exactly what the cron does, a Turtle literal and IRI are
 *   escaped so a title with quotes or a line break cannot break the document, and the JSON-LD and the
 *   Turtle are written from one graph.
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D1.3).
 */
import { describe, it, expect } from 'vitest';
import {
  accrualPeriodicityOf, turtleString, turtleIri, buildDcatGraph, dcatToJsonLd, dcatToTurtle,
} from '../../src/services/datapackage/dcat.js';
import type { DatasetFacts } from '../../src/services/datapackage/catalogue-facts.js';

describe('accrualPeriodicityOf', () => {
  it('names the cadences the EU vocabulary has a word for', () => {
    expect(accrualPeriodicityOf('0 6 * * *')).toBe('DAILY');
    expect(accrualPeriodicityOf('15 6 * * 1')).toBe('WEEKLY');
    expect(accrualPeriodicityOf('0 6 * * 1,4')).toBe('WEEKLY_2');
    expect(accrualPeriodicityOf('0 6 1 * *')).toBe('MONTHLY');
    expect(accrualPeriodicityOf('0 6 1 1 *')).toBe('ANNUAL');
    expect(accrualPeriodicityOf('0 6 1 */3 *')).toBe('QUARTERLY');
    expect(accrualPeriodicityOf('0 * * * *')).toBe('HOURLY');
    expect(accrualPeriodicityOf('0 6,18 * * *')).toBe('DAILY_2');
  });

  it('gives no word to a cron it cannot name exactly, and none to no schedule', () => {
    expect(accrualPeriodicityOf(undefined)).toBeNull();
    expect(accrualPeriodicityOf('*/5 * * * *')).toBeNull();
    expect(accrualPeriodicityOf('0 6 */3 * *')).toBeNull();
    expect(accrualPeriodicityOf('0 6 * * 1-5')).toBeNull();
    expect(accrualPeriodicityOf('0 6 * * 1,2,3,4')).toBeNull();
    expect(accrualPeriodicityOf('not a cron')).toBeNull();
  });
});

describe('Turtle escaping', () => {
  it('escapes quotes, backslashes and line breaks in a literal', () => {
    expect(turtleString('a "b" \\ c\nd')).toBe('"a \\"b\\" \\\\ c\\nd"');
  });
  it('percent-encodes what an IRI may not hold', () => {
    expect(turtleIri('https://x.example/a b<c>')).toBe('<https://x.example/a%20b%3Cc%3E>');
  });
});

describe('one graph, two serialisations', () => {
  const facts: DatasetFacts = {
    catalogueId: 'abc', manifestKey: 'packages/abc/manifest', packageId: 'pkg:alice/shortages', owner: 'alice',
    ownerGhii: 'alice@n', name: 'shortages', title: 'Shortages "weekly"', keywords: ['medicine'], schedule: '0 6 * * 1',
    audience: 'public', contentHash: 'sha256:00', descriptorUrl: 'https://n.example/v1/pub/alice%40n/datpkg/shortages/00/datapackage.json',
    resources: [{ name: 'items', rowCount: 3, fields: 2, bytes: 40, csvUrl: 'https://n.example/v1/pub/alice%40n/datpkg/shortages/00/data/items.csv' }],
    issued: '2026-10-01T00:00:00.000Z', modified: '2026-11-01T00:00:00.000Z',
  };
  const graph = buildDcatGraph({
    config: { baseUrl: 'https://n.example', nodeId: 'n', seoSiteName: 'N', seoSiteDescription: '', seoOrganizationName: '', seoOrganizationUrl: '' },
    facts: [facts], total: 1, page: 1, pageSize: 100, format: 'jsonld',
  });

  it('states the dataset with its weekly cadence in both forms', () => {
    const json = JSON.stringify(dcatToJsonLd(graph));
    const ttl = dcatToTurtle(graph);
    expect(json).toContain('http://publications.europa.eu/resource/authority/frequency/WEEKLY');
    expect(ttl).toContain('<http://publications.europa.eu/resource/authority/frequency/WEEKLY>');
    expect(ttl).toContain('dct:title "Shortages \\"weekly\\""');
    expect(ttl).toContain('dcat:byteSize "40"^^xsd:nonNegativeInteger');
  });

  it('writes a distribution once in Turtle, as its own subject', () => {
    const ttl = dcatToTurtle(graph);
    const csv = '<https://n.example/v1/pub/alice%40n/datpkg/shortages/00/data/items.csv>\n';
    expect(ttl.split(csv).length - 1).toBe(1);
  });
});
