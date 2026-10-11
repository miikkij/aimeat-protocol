/**
 * @file msm-templates.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ten MSM examples the node serves at GET /v1/msm/templates (docs/msm-examples at the
 *   repository root, copied into dist/docs for a package). Each one must parse and validate through the
 *   same parseMsm/validateMsm the POST /v1/msm route runs, so a person who starts from a template can
 *   register it unchanged.
 *
 *   A morsel paces use and is never a price (decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-
 *   arvoa). The route serves each template's raw YAML, so a `base_morsels` price in a template reached
 *   every client as advice. An action's pacing amount is `pricing.toll_morsels`, the field the action
 *   catalogue reads (models/schemas.ts ActionPricingSchema); the 3.x names are refused from 4.0.0
 *   (config-pacing.ts MORSEL_PRICE_FIELDS_REMOVED_IN), so no template may carry one.
 * @usage cd aimeat && pnpm exec vitest run test/unit/msm-templates.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (docs audit phase 2: the examples follow the pacing model).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseMsm, validateMsm } from '../../src/services/msm-parser.js';

const MSM_DIR = join(import.meta.dirname, '../../../docs/msm-examples');
const files = readdirSync(MSM_DIR).filter(f => f.endsWith('.msm.yaml')).sort();

/** The 3.x morsel price names, refused from 4.0.0 on every surface that reads pricing. */
const LEGACY_PRICE_KEYS = ['base_morsels', 'price_morsels', 'priceMorsels', 'payMorsels', 'pay_morsels', 'morsels_per_1000'];

describe('MSM templates (docs/msm-examples/)', () => {
    it('ships ten templates', () => {
        expect(files).toHaveLength(10);
    });

    for (const file of files) {
        it(`${file} parses and validates as POST /v1/msm would`, () => {
            const def = parseMsm(readFileSync(join(MSM_DIR, file), 'utf-8'));
            expect(validateMsm(def), file).toEqual([]);
            expect(def.service.name, file).toBeTruthy();
            expect(def.actions.length, file).toBeGreaterThan(0);
        });

        it(`${file} states pacing as pricing.toll_morsels and carries no morsel price`, () => {
            const raw = readFileSync(join(MSM_DIR, file), 'utf-8');
            for (const key of LEGACY_PRICE_KEYS) {
                expect(raw, `${file}: ${key}`).not.toContain(key);
            }
            expect(raw, `${file}: escrow`).not.toMatch(/escrow/i);
            const doc = parseYaml(raw) as { actions?: Array<{ id: string; pricing?: Record<string, unknown> }> };
            for (const action of doc.actions ?? []) {
                if (!action.pricing) continue;
                expect(Object.keys(action.pricing), `${file} ${action.id}`).toEqual(['toll_morsels']);
                const toll = action.pricing.toll_morsels;
                expect(Number.isInteger(toll) && (toll as number) >= 0 && (toll as number) <= 100, `${file} ${action.id}: ${String(toll)}`).toBe(true);
            }
        });
    }
});
