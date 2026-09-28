/**
 * @file test/unit/ai-catalog-price.test.ts
 * @description What a call costs, in the order of plan 06 section 7 (local, the provider's own
 *   charge, the catalogue, the old table, the estimate, and nothing guessed for audio or pictures);
 *   which ids name one model across provider types; and when the scheduled refresh is due.
 * @usage pnpm test -- ai-catalog-price
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V4 of the System 2 plan).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { writeCatalog } from '../../src/services/ai/catalog/store.js';
import { callCost, servesCapability } from '../../src/services/ai/catalog/price.js';
import { canonicalModelKey, equivalentModels } from '../../src/services/ai/catalog/equivalence.js';
import { refreshDue, parsePriceOverrides } from '../../src/services/ai/catalog/refresh.js';
import type { CatalogMeta, CatalogModel, ModelCaps } from '../../src/services/ai/catalog/types.js';

const caps = (over: Partial<ModelCaps>): ModelCaps => ({
  textIn: false, imageIn: false, fileIn: false, audioIn: false, videoIn: false,
  textOut: false, imageOut: false, audioOut: false, tools: false, reasoning: false, structuredOutput: false,
  embeddings: false, speech: false, transcription: false, ...over,
});
const model = (m: Partial<CatalogModel> & Pick<CatalogModel, 'type' | 'id'>): CatalogModel => ({
  name: m.id, caps: caps({ textIn: true, textOut: true }), limits: {}, price: {}, status: 'active',
  sources: ['models.dev'], seenAt: '2026-09-28T00:00:00.000Z', ...m,
});
const config = { nodeId: 'unit-node', aiCatalogRefresh: 'weekly' } as unknown as AimeatConfig;
const meta: CatalogMeta = { snapshot: 'catalog@2026-09-28T00:00:00.000Z', refreshedAt: '2026-09-28T00:00:00.000Z', origin: 'refresh', sources: {}, sizes: {} };

beforeAll(async () => {
  const storage = new SqliteStorage(':memory:');
  await writeCatalog(storage as never, config, [
    model({ type: 'anthropic', id: 'claude-opus-5-5', price: { inPerMtok: 4, outPerMtok: 20 } }),
    model({ type: 'openrouter', id: 'anthropic/claude-opus-5.5', price: { inPerMtok: 4, outPerMtok: 20 } }),
    model({ type: 'openrouter', id: 'anthropic/claude-opus-4.1', status: 'retired' }),
    model({ type: 'openai', id: 'gpt-image-2', caps: caps({ textIn: true, imageOut: true }), price: { perImage: 0.04 } }),
    model({ type: 'openai', id: 'whisper-1', caps: caps({ audioIn: true, textOut: true, transcription: true }), price: { transcriptionPerSecond: 0.0001 } }),
    model({ type: 'openrouter', id: 'openai/whisper-1', caps: caps({ audioIn: true, textOut: true, transcription: true }), price: { raw: { prompt: 0.0001 } } }),
  ], meta);
});

describe('what a call costs', () => {
  it('a local provider costs nothing', () => {
    expect(callCost({ type: 'local', model: 'qwen3:8b', promptTokens: 1e6, completionTokens: 1e6 })).toMatchObject({ costUsd: 0, costSource: 'none' });
  });

  it('the provider\'s own charge wins and is exact', () => {
    expect(callCost({ type: 'anthropic', model: 'claude-opus-5-5', promptTokens: 1000, reported: 0.5 })).toMatchObject({ costUsd: 0.5, costSource: 'provider', exact: true });
  });

  it('then the catalogue, cited by its snapshot', () => {
    const p = callCost({ type: 'anthropic', model: 'claude-opus-5-5', promptTokens: 1000, completionTokens: 500 });
    expect(p).toMatchObject({ costSource: 'catalog', priceRef: meta.snapshot, exact: false });
    expect(p.costUsd).toBeCloseTo((1000 * 4 + 500 * 20) / 1e6, 12);
  });

  it('the answered id first, then the one asked for', () => {
    expect(callCost({ type: 'anthropic', model: 'claude-opus-5-5-20260921', requestedModel: 'claude-opus-5-5', promptTokens: 1e6 }).costUsd).toBe(4);
  });

  it('a picture and a transcription by their own unit', () => {
    expect(callCost({ type: 'openai', model: 'gpt-image-2', images: 1 }).costUsd).toBe(0.04);
    expect(callCost({ type: 'openai', model: 'whisper-1', seconds: 60 }).costUsd).toBeCloseTo(0.006, 12);
  });

  it('an audio price of uncertain unit is never turned into a rate', () => {
    expect(callCost({ type: 'openrouter', model: 'openai/whisper-1', seconds: 60 })).toMatchObject({ costUsd: 0, costSource: 'none' });
  });

  it('text the catalogue does not know falls to the old table, then to the estimate', () => {
    expect(callCost({ type: 'openai-compatible', model: 'claude-sonnet-4', promptTokens: 1e6 }).costSource).toBe('table');
    expect(callCost({ type: 'openai-compatible', model: 'stub/unknown', promptTokens: 1000, completionTokens: 1000 })).toMatchObject({ costSource: 'estimate', costUsd: 0.02 });
  });
});

describe('one model across provider types', () => {
  it('the vendor prefix, the dots, the case and a date do not make another model', () => {
    expect(canonicalModelKey('anthropic/claude-opus-5.5')).toBe('claude-opus-5-5');
    expect(canonicalModelKey('claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(canonicalModelKey('claude-opus-5-5-20260921')).toBe('claude-opus-5-5');
    expect(canonicalModelKey('deepseek/deepseek-v4-pro:free')).toBe('deepseek-v4-pro');
  });

  it('finds the same model at another type, never a retired one', () => {
    expect(equivalentModels('anthropic', 'claude-opus-5-5').map(m => `${m.type}:${m.id}`)).toEqual(['openrouter:anthropic/claude-opus-5.5']);
    expect(equivalentModels('anthropic', 'claude-opus-4-1')).toEqual([]);
  });

  it('a capability is read from the model\'s capabilities', () => {
    expect(servesCapability(model({ type: 'openai', id: 'x', caps: caps({ textIn: true, embeddings: true }) }), 'text')).toBe(false);
    expect(servesCapability(model({ type: 'openai', id: 'x', caps: caps({ textIn: true, embeddings: true }) }), 'embed')).toBe(true);
  });
});

describe('the scheduled refresh', () => {
  const at = (days: number) => Date.parse(meta.refreshedAt) + days * 86_400_000;
  it('weekly waits a week, daily a day, off never; a seed is refreshed at the first chance', () => {
    expect(refreshDue(config, meta, at(3))).toBe(false);
    expect(refreshDue(config, meta, at(7))).toBe(true);
    expect(refreshDue({ ...config, aiCatalogRefresh: 'daily' } as AimeatConfig, meta, at(1))).toBe(true);
    expect(refreshDue({ ...config, aiCatalogRefresh: 'off' } as AimeatConfig, meta, at(100))).toBe(false);
    expect(refreshDue(config, { ...meta, origin: 'seed' }, at(0))).toBe(true);
  });

  it('a price correction that does not read is left out, never an error', () => {
    expect(parsePriceOverrides('{"anthropic:x": {"inPerMtok": 3, "outPerMtok": "no"}, "bad": {"inPerMtok": 1}}')).toEqual({ 'anthropic:x': { inPerMtok: 3 } });
    expect(parsePriceOverrides('{not json')).toEqual({});
  });
});
