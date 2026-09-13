/**
 * @file test/unit/exchange-odps-length.test.ts
 * @description The node generates an ODPS v4.1 document for every EXCHANGE listing, and some of its text
 *   fields have a maxLength in the schema this repo vendors (`test/fixtures/odps-v4.1.schema.json`)
 *   while the authoring schemas accept far more. `license.scope.restrictions` is the one that bit: it is
 *   the node's own usage sentences (0 to 120 characters) joined with the provider's usageTerms.note and
 *   odps.license.restrictions, capped at 255, and an outside validator refused the document while the
 *   node said nothing. The 2026-09-13 default, open for the developer: warn, never refuse and never truncate. These tests hold the
 *   limits table to the vendored schema, the check to what a real JSON Schema validator refuses, and the
 *   warning to the reconcile report a publish reads.
 * @usage cd aimeat && pnpm exec vitest run test/unit/exchange-odps-length.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial (appdev pitfall usageterms-note-caps-at-156-not-255).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { Offering } from '../../src/services/exchange-market.js';
import { offeringToOdps, odpsLengthOverruns, ODPS_TEXT_LIMITS } from '../../src/services/exchange-odps.js';
import { reconcileOwnerOfferings } from '../../src/services/exchange-projection.js';

const schema = JSON.parse(readFileSync(new URL('../fixtures/odps-v4.1.schema.json', import.meta.url), 'utf8'));

/** Every maxLength in the vendored schema, as a path into the generated document. */
function schemaLimits(): Map<string, number> {
  const out = new Map<string, number>();
  const roots: Array<[string, string]> = [
    ['/properties/product/properties/details/patternProperties/^[a-z]{2}$', 'product.details.*'],
    ['/$defs/License', 'product.license'],
    ['/$defs/DataHolder', 'product.dataHolder'],
  ];
  const walk = (node: unknown, pointer: string): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (typeof n.maxLength === 'number') {
      const root = roots.find(([prefix]) => pointer.startsWith(`${prefix}/`));
      if (!root) throw new Error(`maxLength at ${pointer} has no mapping here: add it to ODPS_TEXT_LIMITS and to this test`);
      const rest = pointer.slice(root[0].length).split('/properties/').filter(Boolean).join('.');
      out.set(`${root[1]}.${rest}`, n.maxLength);
    }
    for (const [k, v] of Object.entries(n)) walk(v, `${pointer}/${k}`);
  };
  walk(schema, '');
  // The two $defs are reached from the product through a $ref; if that ever changes the mapping above lies.
  expect(schema.properties.product.properties.license.$ref).toBe('#/$defs/License');
  expect(schema.properties.product.properties.dataHolder.$ref).toBe('#/$defs/DataHolder');
  return out;
}

function offering(over: Partial<Offering> = {}): Offering {
  return {
    offeringId: 'off-test', providerGhii: 'seller@node-x', providerOwner: 'seller',
    kind: 'app-tool', ext: 'apptool:seller/shop.html', action: 'find',
    surface: { kind: 'app-tool', ownerName: 'seller', appId: 'shop.html', tool: 'find', ifaceVersion: 1 },
    title: 'shop.html · find', description: 'Finds things',
    unit: 'morsels', basePrice: 5, currency: null, plans: [],
    provenance: null, odps: null, usageTerms: { derivatives: true, resale: false, attribution: true },
    tags: [], state: 'listed', auto: true, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as Offering;
}

const doc = (o: Offering) => offeringToOdps({ offering: o, rakePercent: 5, baseUrl: 'https://node.test', nodeId: 'node-x' });

describe('the limits table', () => {
  it('is the vendored ODPS v4.1 schema, field for field', () => {
    const fromSchema = schemaLimits();
    const fromTable = new Map(ODPS_TEXT_LIMITS.map(l => [l.path, l.maxLength]));
    expect(Object.fromEntries(fromTable)).toEqual(Object.fromEntries(fromSchema));
  });
});

describe('odpsLengthOverruns', () => {
  it('reports nothing for a document inside every limit', () => {
    expect(odpsLengthOverruns(doc(offering({ usageTerms: { derivatives: true, resale: false, attribution: true, note: 'Attribute PRH.' } })))).toEqual([]);
  });

  it('names restrictions past 255, says what the node\'s own sentences took, and leaves the text whole', () => {
    const note = 'x'.repeat(200);
    const d = doc(offering({ usageTerms: { derivatives: true, resale: false, attribution: true, note } }));
    const restrictions = (d.product.license as { scope: { restrictions: string } }).scope.restrictions;
    // 57 + 1 + 40 characters of the node's own sentences, a joining space, then the note: never truncated.
    expect(restrictions.length).toBe(299);
    expect(restrictions.endsWith(note)).toBe(true);

    const overruns = odpsLengthOverruns(d);
    expect(overruns).toHaveLength(1);
    expect(overruns[0]).toMatchObject({ path: 'product.license.scope.restrictions', length: 299, maxLength: 255 });
    expect(overruns[0].message).toContain('255');
    expect(overruns[0].message).toContain('usageTerms.note');
    expect(overruns[0].message).toContain('99');
  });

  it('agrees with a real JSON Schema validator on which fields are too long', () => {
    const long = (n: number) => 'y'.repeat(n);
    const d = doc(offering({
      providerGhii: `${long(600)}@node-x`,
      usageTerms: { derivatives: false, resale: false, attribution: true, note: long(300) },
      odps: {
        valueProposition: long(600),
        dataHolder: { legalName: long(300), description: long(600), slogan: long(300) },
        license: {
          applicableLaws: long(600), warranties: long(600), damages: long(600), confidentiality: long(600),
          forceMajeure: long(600), terminationConditions: long(600), continuityConditions: long(600),
        },
      },
    }));
    const validatable = { ...d, product: { ...d.product } } as Record<string, unknown> & { product: Record<string, unknown> };
    // The published schema contradicts itself on these two (see e2e-exchange.ts); neither carries a maxLength.
    delete validatable.product.dataAccess;
    delete validatable.product.paymentGateways;
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.validate(schema, validatable);
    const refused = (ajv.errors ?? []).filter(e => e.keyword === 'maxLength')
      .map(e => e.instancePath.slice(1).split('/').join('.')).sort();
    expect(refused.length).toBeGreaterThan(10);
    expect(odpsLengthOverruns(d).map(o => o.path).sort()).toEqual(refused);
  });

  it('counts characters the way JSON Schema does, by code point', () => {
    const astral = '\u{1F600}'.repeat(256);          // 256 characters, 512 UTF-16 units
    const d = doc(offering({ odps: { dataHolder: { legalName: astral } } }));
    expect(odpsLengthOverruns(d)).toEqual([]);
  });
});

describe('the reconcile report a publish reads', () => {
  it('carries each overrun as a warning on the listing, and still lists it', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    const now = new Date().toISOString();
    await storage.setMemory({
      key: 'apps.shop.html.tools', ownerGaii: 'seller@node-x', visibility: 'public', tags: ['app-tools'],
      ttlHours: null, version: 1, createdAt: now, updatedAt: now,
      value: { version: 1, tools: [{
        name: 'find', action_id: 'ext:e:a', exchange: true, price: { morsels: 5 },
        inputSchema: { type: 'object', properties: { q: {} } }, outputSchema: { type: 'object', properties: { a: {} } },
        usageTerms: { derivatives: true, resale: false, attribution: true, note: 'z'.repeat(200) },
        odps: { valueProposition: 'v'.repeat(513) },
      }] },
    });
    const report = await reconcileOwnerOfferings(storage, 'seller@node-x', { appId: 'shop.html' });
    const created = report.changes.find(c => c.action === 'created');
    expect(created, 'a warning never stops the listing').toBeTruthy();
    const rows = report.changes.filter(c => c.action === 'warning');
    expect(rows.map(r => r.reason).sort()).toEqual([
      'ODPS_FIELD_TOO_LONG product.details.en.valueProposition',
      'ODPS_FIELD_TOO_LONG product.license.scope.restrictions',
    ]);
    const r = rows.find(x => String(x.reason).endsWith('restrictions'))!;
    expect(r).toMatchObject({ label: 'shop.html/find', offeringId: created!.offeringId });
    expect(r.odpsField).toEqual({ path: 'product.license.scope.restrictions', length: 299, maxLength: 255 });
    expect(report.warnings).toBe(2);
  });
});
