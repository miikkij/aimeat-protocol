/**
 * @file test/unit/openrouter-pricing.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pricing and ranking rules behind the model pickers, against the two shapes the
 *   live catalogue produced on 2026-09-03 that the rules did not expect: a router priced -1 (which
 *   was printed as "$-1000000.000 / M in") and a music model with the largest context in its band
 *   (which topped the chat recommendations). Each case here failed before pricing.js v1.1.0.
 * @usage pnpm exec vitest run test/unit/openrouter-pricing.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { describe, it, expect } from 'vitest';
import {
  rankModels, chatPriceLabel, answersInText, answersOnlyInText, producesImages, priceVaries,
} from '../../public/views/profile/openrouter/pricing.js';

const t = (key: string, vars?: Record<string, string>) => {
  if (key.endsWith('.varies')) return 'price varies';
  if (key.endsWith('.free')) return 'free';
  if (key.endsWith('.perMillionIn')) return `${vars?.usd} / M in`;
  if (key.endsWith('.perMillionOut')) return `${vars?.usd} / M out`;
  return key;
};

const m = (id: string, prompt: string, completion: string, ctx: number, out?: string[], input?: string[]) => ({
  id, name: id, context_length: ctx, pricing: { prompt, completion },
  ...(out ? { output_modalities: out } : {}), ...(input ? { input_modalities: input } : {}),
});

const CATALOGUE = [
  m('openrouter/free', '0', '0', 200000, ['text'], ['text', 'image']),
  m('openrouter/auto', '-1', '-1', 2000000, ['text'], ['text', 'image', 'audio']),
  // As the catalogue really describes it on 2026-09-03: text AND audio out, free, 1 M context.
  m('google/lyria-3-pro-preview', '0', '0', 1049000, ['text', 'audio'], ['text', 'image']),
  m('google/gemma-4-31b-it:free', '0', '0', 262000, ['text'], ['text', 'image']),
  m('qwen/qwen3.7-plus', '0.00000032', '0.00000128', 1000000, ['text'], ['text', 'image']),
  m('x-ai/grok-4.20', '0.00000125', '0.0000025', 2000000, ['text'], ['text']),
  m('openai/gpt-image-2', '0.00001', '0.00004', 32000, ['image'], ['text', 'image']),
  m('some/undescribed-model', '0.000001', '0.000002', 8000),
];

describe('a router priced -1 ("varies")', () => {
  it('is labelled in words rather than multiplied into a negative million', () => {
    expect(priceVaries(CATALOGUE[1])).toBe(true);
    expect(chatPriceLabel(CATALOGUE[1], t)).toBe('price varies');
    expect(chatPriceLabel(CATALOGUE[4], t)).toBe('$0.320 / M in · $1.28 / M out');
  });
  it('is not the cheapest of any band, so it never leads the recommendations', () => {
    const ids = rankModels(CATALOGUE, 'chat').map((x) => x.id);
    expect(ids[0]).toBe('openrouter/free');
    expect(ids.indexOf('openrouter/auto')).toBe(-1);
  });
});

describe('a model that does not answer in text', () => {
  it('is recognised from what it declares, and only from that', () => {
    expect(answersInText(CATALOGUE[2])).toBe(true);        // it does answer in text…
    expect(answersOnlyInText(CATALOGUE[2])).toBe(false);   // …but it is a music model too
    expect(answersInText(CATALOGUE[6])).toBe(false);
    expect(answersInText(CATALOGUE[0])).toBe(true);
    expect(answersInText(CATALOGUE[7])).toBe(true);   // undescribed: taken at its word
    expect(producesImages(CATALOGUE[6])).toBe(true);
  });
  it('is left out of the chat and vision recommendations however large its context', () => {
    for (const modality of ['chat', 'vision']) {
      const ids = rankModels(CATALOGUE, modality).map((x) => x.id);
      expect(ids).not.toContain('google/lyria-3-pro-preview');
      expect(ids).not.toContain('openai/gpt-image-2');
    }
  });
  it('is the pool for the image role', () => {
    expect(rankModels(CATALOGUE, 'image').map((x) => x.id)).toEqual(['openai/gpt-image-2']);
  });
});

describe('the chat recommendations', () => {
  it('surface one sensible pick per price band, free router first', () => {
    const ids = rankModels(CATALOGUE, 'chat').map((x) => x.id);
    expect(ids[0]).toBe('openrouter/free');
    expect(ids).toContain('google/gemma-4-31b-it:free');
    expect(ids).toContain('qwen/qwen3.7-plus');
    expect(ids).toContain('x-ai/grok-4.20');
  });
});
