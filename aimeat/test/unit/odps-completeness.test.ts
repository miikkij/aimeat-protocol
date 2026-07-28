/**
 * @file test/unit/odps-completeness.test.ts
 * @description Drift guard for the aimeat-exchange ODPS completeness meter. The meter counts the
 *   fields a PROVIDER authors on an ODPS v4.1 descriptor; the fields it names live in three server
 *   files (models/odps-schemas.ts, services/exchange-market.ts, services/exchange-odps.ts), so a
 *   rename there would silently turn a filled field into a permanent "missing" and a completeness
 *   bar that never reaches 100 no matter what the seller does. These tests fix that to the actual
 *   record shape: a maximally-authored offering must read 100%, an empty one 0%, and every field key
 *   must resolve against a real offering rather than a path nobody writes.
 *
 *   The module under test is deliberately dependency-free (no `window`, no fetch), which is what
 *   lets the browser bundle and this Node test exercise the same function.
 * @usage cd aimeat && pnpm exec vitest run test/unit/odps-completeness.test.ts
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 02 — the EXCHANGE browser library, gap G19).
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — the SDK libs are JSDoc-typed ESM, checked by tsconfig.sdk.json, not this project.
import { odpsCompleteness, ODPS_AUTHORED_FIELDS, valueAt } from '../../src/static/sdk-libs/exchange/odps-completeness.js';

interface Field { key: string; path: string; group: string; label: string }
const FIELDS = ODPS_AUTHORED_FIELDS as Field[];

/** An offering with every AUTHORED field filled — the ceiling the meter should read as 100%. */
const maximal = {
  offeringId: 'off-test', providerGhii: 'alice@aimeat-local-001-dev', providerOwner: 'alice',
  kind: 'ext-action', ext: 'prh-api', action: 'validate', surface: null,
  title: 'Y-tunnus validation',
  description: 'PRH company lookup, normalised.',
  unit: 'money', basePrice: 1_500_000, currency: 'EUR', plans: [],
  tags: ['prh', 'finland'],
  usageTerms: { derivatives: true, resale: false, attribution: true },
  provenance: {
    source: 'PRH open company register',
    legalBasis: 'Public register',
    consentStatus: 'not applicable',
    retention: '30 days',
    transformations: 'Normalised names, joined municipality codes.',
    snapshotHash: 'a'.repeat(64),
    lineage: [{ source: 'avoindata.prh.fi', transform: 'fetch' }],
    odpsVersion: '4.1',
  },
  odps: {
    language: 'en', productType: 'derived data', governanceProfile: 'audit_ready', portfolioPriority: 'high',
    valueProposition: 'Verified company identity in one call.',
    productSeries: 'Finnish registers', categories: ['company data'], standards: ['ISO 8000'],
    useCases: [{ title: 'KYB onboarding' }],
    outputFileFormats: ['JSON'], contentSample: 'https://example.org/sample.json',
    logoURL: 'https://example.org/logo.png', brandSlogan: 'Know your counterparty',
    productVersion: '2.1.0', versionNotes: 'Added municipality codes.', issues: 'None known.',
    documentationURL: 'https://example.org/docs', supportEmail: 'support@example.org', supportHours: '9-17 EET',
    valueAddedTaxIncluded: false, valueAddedTaxPercentage: 24,
    recommendedDataProducts: ['off-related-1'],
    sla: [{ dimension: 'uptime', objective: 99.5, unit: 'percent' }],
    dataQuality: [{ dimension: 'accuracy', objective: 99, unit: 'percentage' }],
    dataHolder: {
      legalName: 'Overscale Solutions Oy', businessID: '3323553-5', URL: 'https://www.overscalesolutions.com',
      addressCountry: 'FI', addressLocality: 'Espoo',
    },
    license: {
      geographicalArea: ['Worldwide'], exclusive: false, applicableLaws: 'Finnish law',
      terminationConditions: 'Either party, 30 days.',
    },
  },
  state: 'listed', createdAt: '2026-07-20T10:00:00.000Z', updatedAt: '2026-07-25T10:00:00.000Z',
};

/** The thinnest listing the node will actually accept: coordinate, title, usage terms. */
const minimal = {
  offeringId: 'off-thin', kind: 'ext-action', ext: 'x', action: 'y',
  title: '', description: '', tags: [], usageTerms: null, provenance: null, odps: null,
  state: 'listed',
};

describe('odpsCompleteness', () => {
  it('reads 100% on a maximally-authored offering — every named field is one a provider can fill', () => {
    const r = odpsCompleteness(maximal);
    // Name the stragglers: "97%" alone would not say WHICH key stopped resolving.
    expect(r.missing.map((m: Field) => m.key)).toEqual([]);
    expect(r.percent).toBe(100);
    expect(r.filled).toBe(FIELDS.length);
  });

  it('reads 0% on an empty listing, and every field is reported as missing with its ODPS path', () => {
    const r = odpsCompleteness({});
    expect(r.percent).toBe(0);
    expect(r.missing).toHaveLength(FIELDS.length);
    for (const m of r.missing as Field[]) {
      expect(m.path.startsWith('product.')).toBe(true);
      expect(m.label.length).toBeGreaterThan(0);
    }
  });

  it('a thin but valid listing scores low and names what to do next', () => {
    const r = odpsCompleteness(minimal);
    expect(r.percent).toBeLessThan(15);
    expect(r.missing.map((m: Field) => m.key)).toContain('odps.valueProposition');
    expect(r.missing.map((m: Field) => m.key)).toContain('odps.dataHolder.legalName');
    expect(r.missing.map((m: Field) => m.key)).toContain('usageTerms');
  });

  it('accepts the { offering } detail envelope as well as the bare record', () => {
    expect(odpsCompleteness({ offering: maximal }).percent).toBe(100);
  });

  it('counts `false` and `0` as STATED — an answered question is not a blank', () => {
    // A seller who declares "not exclusive, 0% VAT" has answered; telling them to go and fill in a
    // field they filled is the exact failure a naive truthiness check produces.
    const stated = { ...maximal, odps: { ...maximal.odps, valueAddedTaxPercentage: 0, license: { ...maximal.odps.license, exclusive: false } } };
    const r = odpsCompleteness(stated);
    expect(r.missing.map((m: Field) => m.key)).not.toContain('odps.valueAddedTaxPercentage');
    expect(r.missing.map((m: Field) => m.key)).not.toContain('odps.license.exclusive');
  });

  it('every field carries a distinct offering key and a per-group tally that adds up', () => {
    const keys = FIELDS.map(f => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    const r = odpsCompleteness(maximal);
    const summed = Object.values(r.byGroup as Record<string, { total: number }>).reduce((n, g) => n + g.total, 0);
    expect(summed).toBe(FIELDS.length);
  });

  it('valueAt walks a missing branch without throwing', () => {
    expect(valueAt({}, 'odps.dataHolder.legalName')).toBeUndefined();
    expect(valueAt({ odps: { dataHolder: { legalName: 'X' } } }, 'odps.dataHolder.legalName')).toBe('X');
  });
});
