/**
 * @file app-catalog-atelier-guide.test.ts
 * @description The old /app-catalog.html prompt builder and the node's answer to
 *   GET /v1/prompts/build-app-atelier. The cases are the instruction audit re-check of 2026-11-08:
 *   every answer but a 404 switched a new app to Classic with no word to the person.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-catalog-atelier-guide.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { atelierGuideOutcome } from '../../src/static/app-catalog/js/atelier-guide.js';

const guide = { ok: true, data: { prompt: '## First, a short interview' } };

describe('atelierGuideOutcome', () => {
    it('uses the guide on a 200 that carries it', () => {
        expect(atelierGuideOutcome(200, guide)).toBe('ok');
    });

    it('falls back to Classic only on a 404: the node has no Atelier track', () => {
        expect(atelierGuideOutcome(404, { ok: false, error: { code: 'NOT_FOUND' } })).toBe('absent');
        expect(atelierGuideOutcome(404, null)).toBe('absent');
    });

    it('keeps Atelier and reports a failure on every other answer', () => {
        expect(atelierGuideOutcome(401, { ok: false })).toBe('error');
        expect(atelierGuideOutcome(403, { ok: false })).toBe('error');
        expect(atelierGuideOutcome(500, { ok: false })).toBe('error');
        expect(atelierGuideOutcome(0, null)).toBe('error'); // network failure
        expect(atelierGuideOutcome(200, null)).toBe('error'); // a body that is not JSON
        expect(atelierGuideOutcome(200, { ok: true, data: {} })).toBe('error'); // no prompt in it
        expect(atelierGuideOutcome(200, { ok: true, data: { prompt: '   ' } })).toBe('error');
    });
});
