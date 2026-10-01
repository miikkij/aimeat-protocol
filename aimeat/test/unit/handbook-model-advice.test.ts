/**
 * @file test/unit/handbook-model-advice.test.ts
 * @description The handbooks a builder reads first tell it to say, before it builds, which models
 *   build the better app. Measured 2026-10-01 with the cold-agent task `build-app`: Sonnet 5.5 (the
 *   model of claude.ai's free plan) skipped the specification's interview in 2 of 3 runs, so a
 *   sentence placed there was never said. Every run read the handbook first.
 * @usage cd aimeat && pnpm exec vitest run test/unit/handbook-model-advice.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { FULL_HANDBOOK } from '../../src/services/handbooks/full.js';
import { APPDEV_HANDBOOK } from '../../src/services/handbooks/appdev.js';

/** The handbooks wrap their lines, so every space in the sentence may be a line break. */
const ADVICE = new RegExp('Unless you are Claude Opus or Claude Fable[^.]*before you build[^.]*Claude Opus or Claude Fable turn out noticeably better'.replace(/ /g, '\\s+'));

describe('the handbooks a builder reads first', () => {
    it('full: the Apps line says which models build the better app', () => {
        const apps = FULL_HANDBOOK.slice(FULL_HANDBOOK.indexOf('- **Apps**'), FULL_HANDBOOK.indexOf('- **Organisms'));
        expect(apps).toMatch(ADVICE);
    });

    it('appdev: the build flow says it at the track step', () => {
        const flow = APPDEV_HANDBOOK.slice(APPDEV_HANDBOOK.indexOf('0. THE TRACK'), APPDEV_HANDBOOK.indexOf('1. RESEARCH'));
        expect(flow).toMatch(ADVICE);
    });
});
