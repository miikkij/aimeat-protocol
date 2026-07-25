/**
 * @file tools/odps-coverage.ts
 * @description Coverage report for the EXCHANGE → ODPS v4.1 projection: walks every field the published
 *   ODPS v4.1 JSON Schema defines and reports which ones a MAXIMALLY-filled AIMEAT offering can populate,
 *   which the provider must author (and can, via the `odps` block), and which AIMEAT has no source for at
 *   all. Run it after changing services/exchange-odps.ts or models/odps-schemas.ts to see the honest gap.
 *   v4.1 keys `details` and `pricingPlans.declarative` by language, so the walker follows patternProperties
 *   and the probe treats a language key like an array member.
 * @usage cd aimeat && pnpm exec tsx tools/odps-coverage.ts
 * @version-history
 *   v1.1.0 — 2026-07-25 — Follows ODPS v4.1 (language-keyed details/pricing via patternProperties).
 *   v1.0.0 — 2026-07-25 — Initial coverage report (TARGET-045 §4 ODPS adoption).
 */
import { readFileSync } from 'node:fs';
import { offeringToOdps, ODPS_VERSION } from '../src/services/exchange-odps.js';
import type { Offering } from '../src/services/exchange-market.js';

const schema = JSON.parse(readFileSync(new URL('../test/fixtures/odps-v4.1.schema.json', import.meta.url), 'utf8'));

/** A listing with EVERY authorable field filled — the ceiling of what the projection can currently emit. */
const offering = {
  offeringId: 'off-coverage', providerGhii: 'alice@aimeat-local-001-dev', providerOwner: 'alice',
  kind: 'ext-action', ext: 'prh-api', action: 'validate', surface: null,
  title: 'Y-tunnus validation', description: 'PRH company lookup',
  unit: 'money', basePrice: 1_500_000, currency: 'EUR',
  plans: [
    { id: 'block-100', model: 'bundle', blockSize: 100, blockPrice: 100_000_000 },
    { id: 'monthly', model: 'subscription', periodSeconds: 2_592_000, periodPrice: 900_000_000, callsPerWindow: 1000, windowSeconds: 86_400 },
  ],
  provenance: {
    source: 'PRH', legalBasis: 'public register', consentStatus: 'n/a', retention: '30 days',
    transformations: 'normalised', snapshotHash: 'a'.repeat(64),
    lineage: [{ source: 'avoindata.prh.fi', transform: 'fetch' }], odpsVersion: '4.1',
  },
  usageTerms: { derivatives: true, resale: true, attribution: true, note: 'Attribute PRH.' },
  odps: {
    language: 'en', governanceProfile: 'audit_ready', portfolioPriority: 'high',
    productType: 'derived data', valueProposition: 'Verified company identity in one call.',
    productSeries: 'Finnish registers', categories: ['company data'], standards: ['ISO 8000'],
    useCases: [{ title: 'KYB onboarding', description: 'Verify a counterparty.', url: 'https://example.org/kyb' }],
    outputFileFormats: ['JSON'], contentSample: 'https://example.org/sample.json',
    logoURL: 'https://example.org/logo.png', brandSlogan: 'Know your counterparty',
    productVersion: '2.1.0', versionNotes: 'Added municipality codes.', issues: 'https://example.org/issues',
    documentationURL: 'https://example.org/docs', supportEmail: 'support@example.org', supportHours: '9-17 EET',
    valueAddedTaxIncluded: false, valueAddedTaxPercentage: 24,
    recommendedDataProducts: ['off-related-1'],
    sla: [{ dimension: 'uptime', objective: 99.5, unit: 'percent', description: 'Monthly availability' }],
    dataQuality: [{ dimension: 'accuracy', objective: 99, unit: 'percentage', description: 'Names match the register' }],
    dataHolder: { legalName: 'Overscale Solutions Oy', businessID: '3312345-6', email: 'sales@example.org',
      URL: 'https://example.org', telephone: '+358401234567', taxID: 'FI33123456', vatID: 'FI33123456',
      businessDomain: 'data services', description: 'Data provider', addressCountry: 'FI',
      contactName: 'Jouni Miikki', addressRegion: 'Uusimaa',
      addressLocality: 'Espoo', postalCode: '02100', streetAddress: 'Katu 1', logoURL: 'https://example.org/l.png',
      slogan: 'Data you can trust', parentOrganization: 'Overscale Group' },
    license: { geographicalArea: ['EU'], permanent: false, exclusive: false, restrictions: 'EU only',
      applicableLaws: 'Finnish law', warranties: 'As-is', damages: 'Capped at fees paid',
      confidentiality: 'Mutual NDA', forceMajeure: 'Standard', terminationNoticePeriodDays: 30,
      terminationConditions: 'Either party, 30 days', continuityConditions: 'Data export on exit' },
  },
  tags: ['prh', 'finland'], state: 'listed', auto: true, sourceHash: 'abc123',
  createdAt: '2026-07-20T10:00:00.000Z', updatedAt: '2026-07-25T10:00:00.000Z',
} as unknown as Offering;

const doc = offeringToOdps({
  offering,
  iface: { inputSchema: { type: 'object' }, outputSchema: { type: 'object' } },
  callRecipe: { method: 'POST', url: '/v1/ext/prh-api/validate', mcp: 'aimeat_extension_invoke {…}' },
  stats: { activeContracts: 2, totalContracts: 3, totalCalls: 40, totalSettledUnits: 60_000_000, consumers: 2,
    listedAt: offering.createdAt, lastUsedAt: offering.updatedAt },
  rakePercent: 10, baseUrl: 'https://aimeat.io', nodeId: 'aimeat-local-001-dev',
});

/** Every leaf path the schema defines, following $ref. */
function paths(node: any, prefix: string, out: string[], depth = 0): void {
  if (!node || depth > 6) return;
  const resolved = node.$ref ? { ...schema.$defs[String(node.$ref).split('/').pop()!], ...node } : node;
  // v4.1 language keys (`^[a-z]{2}$`) are a transparent level: walk through them, do not name them.
  if (resolved.patternProperties) {
    for (const v of Object.values<any>(resolved.patternProperties)) paths(v, prefix, out, depth + 1);
  }
  if (resolved.properties) {
    for (const [k, v] of Object.entries<any>(resolved.properties)) {
      const p = prefix ? `${prefix}.${k}` : k;
      const child = v.$ref ? { ...schema.$defs[String(v.$ref).split('/').pop()!], ...v } : v;
      if (child.properties || child.patternProperties || child.items?.properties || child.items?.$ref) { out.push(p); paths(child, p, out, depth + 1); }
      else out.push(p);
    }
  }
  if (resolved.items) paths(resolved.items, `${prefix}[]`, out, depth + 1);
}

const all: string[] = [];
paths(schema, '', all);

/** Resolve a schema path against the document. Arrays and named mappings are searched for ANY member that
 *  carries the field — a bundle-only field like `maxTransactionQuantity` counts as emitted. */
function get(obj: any, path: string): unknown {
  const step = (nodes: any[], key: string): any[] => {
    const out: any[] = [];
    for (const n of nodes) {
      if (n === undefined || n === null) continue;
      if (Array.isArray(n)) { for (const item of n) if (item?.[key] !== undefined) out.push(item[key]); continue; }
      if (n[key] !== undefined) { out.push(n[key]); continue; }
      // Named mappings — dataAccess/paymentGateways entries (default, mcp, …) and v4.1 language keys
      // (details.en, pricingPlans.declarative.fi) — are transparent: look inside every entry.
      if (typeof n === 'object') {
        for (const v of Object.values<any>(n)) {
          if (Array.isArray(v)) { for (const item of v) if (item?.[key] !== undefined) out.push(item[key]); continue; }
          if (v && typeof v === 'object' && v[key] !== undefined) out.push(v[key]);
        }
      }
    }
    return out;
  };
  let nodes: any[] = [obj];
  for (const raw of path.split('.')) {
    const key = raw.endsWith('[]') ? raw.slice(0, -2) : raw;
    if (key) nodes = step(nodes, key);
    if (raw.endsWith('[]')) nodes = nodes.flatMap(n => (Array.isArray(n) ? n : [n]));
    if (!nodes.length) return undefined;
  }
  return nodes.find(n => n !== undefined && n !== null && !(Array.isArray(n) && !n.length));
}

const filled: string[] = [], missing: string[] = [];
for (const p of all.filter(p => p.startsWith('product.'))) {
  const v = get(doc, p);
  (v === undefined || v === null || (Array.isArray(v) && !v.length) ? missing : filled).push(p);
}

console.log(`\nODPS v${ODPS_VERSION} coverage — ${filled.length} filled, ${missing.length} not emitted\n`);
console.log('FILLED:\n  ' + filled.join('\n  '));
console.log('\nNOT EMITTED:\n  ' + missing.join('\n  '));
console.log('\n--- generated document (maximally filled offering) ---');
console.log(JSON.stringify(doc, null, 1));
