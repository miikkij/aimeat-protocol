/**
 * @file test/unit/app-tools-manifest-safety.test.ts
 * @description The app-tools manifest is ALL-OR-NOTHING: one field a validator rejects silently
 *   delists EVERY offering that app has. These tests widen a REAL, live manifest (fetched from
 *   aimeat.io on 2026-08-01 and kept as `test/fixtures/app-tools-manifest-live.json`) with the two
 *   things TARGET-058 Phase 8 step 0c adds — the Rule 11b provider identity and an
 *   `aimeat.provenance/v1` block describing the OUTPUT — and prove the offering count does not move.
 *
 *   A real manifest rather than a hand-written one on purpose. A fixture I invent is a fixture that
 *   agrees with me; this one was authored by somebody else, months ago, and contains whatever it
 *   contains.
 * @usage pnpm test -- app-tools-manifest-safety
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 8 step 0c.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AppToolsDocSchema } from '../../src/models/app-tool-schemas.js';
import { desiredFromAppTools } from '../../src/services/exchange-projection.js';
import { inheritAiProvenance, offeringToOdps } from '../../src/services/exchange-odps.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import type { Offering } from '../../src/services/exchange-market.js';

const LIVE = JSON.parse(readFileSync(
  fileURLToPath(new URL('../fixtures/app-tools-manifest-live.json', import.meta.url)), 'utf8')) as Record<string, unknown>;

const OWNER = 'happydude500001';
const OWNER_GHII = `${OWNER}@aimeat-finland-001-genesis`;
const APP_ID = 'laimeat-sanomat.html';

/** Rule 11b — the provider identity the ODPS descriptor asks for, stated once per app. */
const RULE_11B_ODPS = {
  dataHolder: {
    legalName: 'Overscale Solutions Oy',
    businessID: '3323553-5',
    URL: 'https://www.overscalesolutions.com',
    addressCountry: 'FI',
    addressLocality: 'Espoo',
  },
  license: { geographicalArea: ['Worldwide'], applicableLaws: 'Finnish law' },
};

/** An app-level statement about what these capabilities RETURN. */
const APP_AI_PROVENANCE = {
  spec: 'aimeat.provenance/v1',
  level: 'ai-generated',
  humanInvolvement: 'none',
  generatedAt: '2026-08-01T00:00:00.000Z',
  generator: { model: 'anthropic/claude-opus-5', pipeline: 'sanomat-evening-crew' },
};

/** Just enough Storage for desiredFromAppTools: one manifest record, and no agents. */
function fakeStorage(manifest: unknown): Storage {
  const rec = {
    key: `apps.${APP_ID}.tools`, ownerGaii: OWNER_GHII, value: manifest,
    visibility: 'public', tags: ['app-tools'], version: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as MemoryRecord;
  return {
    getMemory: async () => rec,
    listMemory: async () => [rec],
    listAgents: async () => [],
    // The projection pins an interface version; in dry-run mode it only READS one.
    getMemoryVersions: async () => [],
    listAllMemory: async () => ({ items: [], total: 0 }),
  } as unknown as Storage;
}

async function listingsFor(manifest: unknown) {
  return desiredFromAppTools(fakeStorage(manifest), OWNER_GHII, OWNER, APP_ID, [], true);
}

describe('the live manifest, widened', () => {
  it('the fixture is the real thing: it validates and lists offerings as-is', async () => {
    expect(AppToolsDocSchema.safeParse(LIVE).success).toBe(true);
    const before = await listingsFor(LIVE);
    expect(before.length).toBeGreaterThan(0);
  });

  it('adding the Rule 11b identity and an aiProvenance block delists nothing', async () => {
    const before = await listingsFor(LIVE);
    const widened = { ...LIVE, odps: RULE_11B_ODPS, aiProvenance: APP_AI_PROVENANCE };

    expect(AppToolsDocSchema.safeParse(widened).success).toBe(true);
    const after = await listingsFor(widened);

    // THE assertion this file exists for: same offerings, same coordinates, same prices.
    expect(after.length).toBe(before.length);
    expect(after.map(l => l.key).sort()).toEqual(before.map(l => l.key).sort());
    expect(after.map(l => l.basePrice)).toEqual(before.map(l => l.basePrice));
  });

  it('the identity and the AI provenance reach every projected listing', async () => {
    const widened = { ...LIVE, odps: RULE_11B_ODPS, aiProvenance: APP_AI_PROVENANCE };
    const after = await listingsFor(widened);
    for (const l of after) {
      expect(l.odps?.dataHolder?.legalName).toBe('Overscale Solutions Oy');
      expect(l.odps?.dataHolder?.businessID).toBe('3323553-5');
      expect(l.odps?.license?.applicableLaws).toBe('Finnish law');
      expect(l.aiProvenance?.spec).toBe('aimeat.provenance/v1');
    }
  });

  it('and through into the ODPS document a buyer actually reads', async () => {
    const widened = { ...LIVE, odps: RULE_11B_ODPS, aiProvenance: APP_AI_PROVENANCE };
    const [first] = await listingsFor(widened);
    const offering = {
      offeringId: 'off-test', providerGhii: OWNER_GHII, providerOwner: OWNER,
      kind: first.kind, ext: first.ext, action: first.action, surface: first.surface,
      title: first.title, description: first.description,
      unit: first.unit, basePrice: first.basePrice, currency: first.currency, plans: first.plans,
      provenance: first.provenance, odps: first.odps, aiProvenance: first.aiProvenance,
      usageTerms: first.usageTerms, tags: first.tags, state: 'listed' as const,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Offering;

    const doc = offeringToOdps({ offering, rakePercent: 10, baseUrl: 'https://aimeat.io', nodeId: 'n' });
    const holder = doc.product.dataHolder as Record<string, unknown>;
    expect(holder.legalName).toBe('Overscale Solutions Oy');
    expect(holder.businessID).toBe('3323553-5');
    const ext = doc.product['x-aimeat'] as Record<string, unknown>;
    const ai = ext.ai_provenance as Record<string, unknown>;
    expect(ai.level).toBe('ai-generated');
    // The note travels WITH the block, because an agent that finds no block must read that as
    // unstated rather than as "a person wrote it".
    expect(String(ai['x-note'])).toContain('unstated');
  });

  it('the source hash moves when aiProvenance is added, so the listing is actually re-projected', async () => {
    const before = await listingsFor(LIVE);
    const after = await listingsFor({ ...LIVE, aiProvenance: APP_AI_PROVENANCE });
    expect(after[0].sourceHash).not.toBe(before[0].sourceHash);
  });
});

describe('an unparseable aiProvenance block must not delist anything', () => {
  it('drops the block and keeps every offering', async () => {
    const before = await listingsFor(LIVE);
    // A block from a spec version this node does not know, or simply mis-typed.
    const broken = { ...LIVE, aiProvenance: { spec: 'aimeat.provenance/v99', level: 'invented-level' } };

    expect(AppToolsDocSchema.safeParse(broken).success).toBe(true);
    const after = await listingsFor(broken);
    expect(after.length).toBe(before.length);
    for (const l of after) expect(l.aiProvenance).toBeNull();
  });

  it('inheritAiProvenance: a tool statement replaces the app default rather than merging with it', () => {
    const app = { ...APP_AI_PROVENANCE, notes: 'app level' };
    const tool = {
      spec: 'aimeat.provenance/v1', level: 'original', humanInvolvement: 'full-human',
      generatedAt: '2026-08-01T00:00:00.000Z',
    };
    const merged = inheritAiProvenance(app, tool);
    expect(merged?.level).toBe('original');
    // Half a v1 record laid over half of another is a document that claims to be something it is not.
    expect(merged?.notes).toBeUndefined();
    expect(merged?.generator).toBeUndefined();
  });

  it('inheritAiProvenance: the app default applies to a tool that states nothing', () => {
    expect(inheritAiProvenance(APP_AI_PROVENANCE, undefined)?.level).toBe('ai-generated');
    expect(inheritAiProvenance(undefined, undefined)).toBeNull();
    expect(inheritAiProvenance({}, {})).toBeNull();
  });
});
