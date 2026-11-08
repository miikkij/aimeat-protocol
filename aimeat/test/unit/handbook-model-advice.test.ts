/**
 * @file test/unit/handbook-model-advice.test.ts
 * @description The handbooks a builder reads first carry the model rule. Measured 2026-10-01 with the
 *   cold-agent task `build-app`: a lighter model skipped the specification's interview in 2 of 3
 *   runs, so a sentence placed only there was never read; every run read the handbook first. Since
 *   2026-11-08 the rule is by quality and names no model (Jouni: names change, and good models come
 *   from more than one vendor): the work needs a high-quality model, and when errors keep coming
 *   the person is told theirs seems too weak.
 * @usage cd aimeat && pnpm exec vitest run test/unit/handbook-model-advice.test.ts
 * @version-history
 *   v2.0.0 — 2026-11-08 — The rule by quality (MODEL_QUALITY_ADVICE), no model named anywhere it is said.
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { FULL_HANDBOOK } from '../../src/services/handbooks/full.js';
import { APPDEV_HANDBOOK } from '../../src/services/handbooks/appdev.js';
import { MODEL_QUALITY_ADVICE } from '../../src/services/model-recommendation.js';
import { buildAtelierPrompt } from '../../src/services/build-atelier-prompt.js';
import { APP_BUILDER_SKILL_ENTRY } from '../../src/data/builtin-skills.app-builder.js';
import type { AimeatConfig } from '../../src/config.js';

const NAMED = /Claude Opus|Claude Fable|\bSonnet\b|\bHaiku\b/;

describe('the model rule, wherever a builder reads it', () => {
    it('names no model and asks for quality', () => {
        expect(MODEL_QUALITY_ADVICE).not.toMatch(NAMED);
        expect(MODEL_QUALITY_ADVICE).toMatch(/high-quality model/);
        expect(MODEL_QUALITY_ADVICE).toMatch(/too weak to do this safely/);
    });

    it('full: the Apps line carries it', () => {
        const apps = FULL_HANDBOOK.slice(FULL_HANDBOOK.indexOf('- **Apps**'), FULL_HANDBOOK.indexOf('- **Organisms'));
        expect(apps).toContain(MODEL_QUALITY_ADVICE);
        expect(apps).not.toMatch(NAMED);
    });

    it('appdev: the build flow carries it at the track step', () => {
        const flow = APPDEV_HANDBOOK.slice(APPDEV_HANDBOOK.indexOf('0. THE TRACK'), APPDEV_HANDBOOK.indexOf('1. RESEARCH'));
        expect(flow).toContain(MODEL_QUALITY_ADVICE);
        expect(flow).not.toMatch(NAMED);
    });

    it('the Atelier specification and the Classic skill carry it, and name no model', () => {
        const spec = buildAtelierPrompt({ baseUrl: 'https://node.example', nodeId: 'n' } as unknown as AimeatConfig, { mode: 'new', lang: 'en' }).full;
        expect(spec).toContain(MODEL_QUALITY_ADVICE);
        expect(spec).not.toMatch(/Claude Opus or Claude Fable/);
        expect(APP_BUILDER_SKILL_ENTRY.skillMd).toContain(MODEL_QUALITY_ADVICE);
        expect(APP_BUILDER_SKILL_ENTRY.skillMd).not.toMatch(/Claude Opus or Claude Fable/);
    });
});
