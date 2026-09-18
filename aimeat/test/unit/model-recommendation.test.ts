/**
 * @file model-recommendation.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one model recommendation, and that the setup steps read it.
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { MODEL_RECOMMENDATION, MODEL_REVIEW_MAX_AGE_DAYS, modelReviewAgeDays } from '../../src/services/model-recommendation.js';
import { buildAiToolSetup } from '../../src/services/ai-tool-setup.js';

const config = { baseUrl: 'https://node.example', nodeId: 'node-example' } as never;

describe('the model recommendation', () => {
  it('carries a review date that is a real day', () => {
    expect(MODEL_RECOMMENDATION.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(MODEL_RECOMMENDATION.reviewedOn))).toBe(false);
  });

  it('counts whole days from the review, so the gate can refuse a stale one', () => {
    const reviewed = new Date(MODEL_RECOMMENDATION.reviewedOn + 'T00:00:00Z');
    expect(modelReviewAgeDays(reviewed)).toBe(0);
    const later = new Date(reviewed.getTime() + (MODEL_REVIEW_MAX_AGE_DAYS + 1) * 86_400_000);
    expect(modelReviewAgeDays(later)).toBe(MODEL_REVIEW_MAX_AGE_DAYS + 1);
  });

  it('is what the setup steps name, in both languages', () => {
    for (const lang of ['en', 'fi']) {
      const text = JSON.stringify(buildAiToolSetup(config, { lang }));
      expect(text, lang).toContain(MODEL_RECOMMENDATION.claude);
      expect(text, lang).toContain(MODEL_RECOMMENDATION.chatgpt);
    }
  });
});
