/**
 * @file test/unit/ai-catalog-normalize.test.ts
 * @description The model catalogue's pure half, on samples cut from the real sources of 2026-09-28
 *   (test/fixtures/ai-catalog/):
 *   - models-dev.sample.json: openai gpt-5.4 (text, tools, vision), gpt-image-2 and gpt-image-1
 *     (image; the second deprecated and unpriced), text-embedding-3-small, gpt-realtime-2.1 (audio and
 *     text in); anthropic claude-opus-5-5; mistral voxtral-mini-tts-latest (speech),
 *     voxtral-mini-latest (transcription), voxtral-small-latest (audio and text in), mistral-embed;
 *     openrouter anthropic/claude-opus-5.5, google/gemini-2.5-flash, openai/gpt-audio; xai
 *     grok-imagine-image; deepseek deepseek-v4-flash; one google-vertex-anthropic model (not covered).
 *   - openrouter.sample.json: anthropic/claude-opus-5.5, microsoft/mai-image-2.6 (image),
 *     x-ai/grok-voice-tts-1.0 (speech, voices), openai/whisper-1 and openai/gpt-4o-transcribe
 *     (transcription), openai/text-embedding-3-small and google/gemini-embedding-2 (embeddings),
 *     google/gemini-2.5-flash (expiration_date), openai/gpt-audio, openrouter/auto ("-1" prices),
 *     black-forest-labs/flux-video-edit (video only) and qwen/qwen3-reranker-8b (rerank only).
 *   - litellm.sample.json: sample_spec, chat gpt-5.4, claude-opus-5-5, xai/grok-4.3,
 *     mistral/voxtral-small-latest, deepseek-v4-flash twice (with and without prefix); image
 *     gpt-image-2, gpt-image-1, xai/grok-imagine-image, low/1024-x-1024/gpt-image-1.5 (a size
 *     variant); speech tts-1, mistral/voxtral-mini-tts-latest; transcription whisper-1,
 *     mistral/voxtral-mini-latest, gpt-4o-transcribe; embeddings text-embedding-3-small,
 *     mistral/mistral-embed; skipped modes openai/sora-2, gpt-realtime, omni-moderation-latest,
 *     mistral/mistral-ocr-latest, babbage-002; codestral/codestral-latest; vertex_ai/claude-3-5-haiku.
 *   The last block runs on the full snapshots when the scratchpad that holds them is present.
 * @usage pnpm test -- ai-catalog-normalize
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V4 of the System 2 plan).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  fromModelsDev, fromOpenRouter, fromLiteLLM, liteLlmRef, mergeSources, applyLifecycle, recordSize, groupByType,
} from '../../src/services/ai/catalog/normalize.js';
import { CATALOG_TYPES, type CatalogModel } from '../../src/services/ai/catalog/types.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/ai-catalog/', import.meta.url));
const fixture = (name: string): unknown => JSON.parse(readFileSync(FIXTURES + name, 'utf8'));
const T = '2026-09-28T00:00:00.000Z';

const MD = fromModelsDev(fixture('models-dev.sample.json'), T);
const OR = fromOpenRouter(fixture('openrouter.sample.json'), T);
const LL = fromLiteLLM(fixture('litellm.sample.json'), T);

function find(list: CatalogModel[], ref: string): CatalogModel {
  const m = list.find((x) => `${x.type}:${x.id}` === ref);
  if (!m) throw new Error(`no ${ref}`);
  return m;
}
const has = (list: CatalogModel[], ref: string): boolean => list.some((x) => `${x.type}:${x.id}` === ref);
const onCaps = (m: CatalogModel): string[] =>
  Object.entries(m.caps).filter(([, v]) => v === true).map(([k]) => k).sort();

describe('models.dev', () => {
  it('reads only the covered providers', () => {
    expect(MD).toHaveLength(15);
    expect(new Set(MD.map((m) => m.type))).toEqual(new Set(['openai', 'anthropic', 'mistral', 'openrouter', 'xai', 'deepseek']));
  });

  it('a text model: caps from modalities and flags, prices already per M', () => {
    const m = find(MD, 'openai:gpt-5.4');
    expect(onCaps(m)).toEqual(['fileIn', 'imageIn', 'reasoning', 'structuredOutput', 'textIn', 'textOut', 'tools']);
    expect(m.price).toEqual({ inPerMtok: 2.5, outPerMtok: 15, cacheReadPerMtok: 0.25 });
    expect(m.limits).toEqual({ context: 1050000, output: 128000 });
    expect(m).toMatchObject({ family: 'gpt', released: '2026-03-05', status: 'active', sources: ['models.dev'], seenAt: T });
    const a = find(MD, 'anthropic:claude-opus-5-5');
    expect(a.price).toEqual({ inPerMtok: 4, outPerMtok: 20, cacheReadPerMtok: 0.2, cacheWritePerMtok: 5 });
    expect(a.family).toBe('claude-opus');
  });

  it('an image model: output price is an image-token price', () => {
    const m = find(MD, 'openai:gpt-image-2');
    expect(onCaps(m)).toEqual(['imageIn', 'imageOut', 'textIn']);
    expect(m.price).toEqual({ inPerMtok: 5, imageOutPerMtok: 30, cacheReadPerMtok: 1.25 });
    expect(m.limits).toEqual({});
    expect(find(MD, 'openai:gpt-image-1').status).toBe('retiring');
  });

  it('speech and transcription from modalities, unpriced', () => {
    const tts = find(MD, 'mistral:voxtral-mini-tts-latest');
    expect(onCaps(tts)).toEqual(['audioOut', 'speech', 'textIn']);
    expect(tts.price).toEqual({});
    const stt = find(MD, 'mistral:voxtral-mini-latest');
    expect(onCaps(stt)).toEqual(['audioIn', 'textOut', 'transcription']);
  });

  it('a chat model with audio and text in is not a transcription model', () => {
    expect(onCaps(find(MD, 'mistral:voxtral-small-latest'))).toEqual(['audioIn', 'textIn', 'textOut', 'tools']);
    const rt = find(MD, 'openai:gpt-realtime-2.1');
    expect(rt.caps.transcription).toBe(false);
    expect(rt.caps.speech).toBe(false);
    expect(rt.price).toMatchObject({ audioInPerMtok: 32, audioOutPerMtok: 64 });
  });

  it('an embedding model: from the family, no text out, no output limit', () => {
    const m = find(MD, 'openai:text-embedding-3-small');
    expect(onCaps(m)).toEqual(['embeddings', 'textIn']);
    expect(m.price).toEqual({ inPerMtok: 0.02, outPerMtok: 0 });
    expect(m.limits).toEqual({ context: 8191 });
    expect(onCaps(find(MD, 'mistral:mistral-embed'))).toEqual(['embeddings', 'textIn']);
  });
});

describe('OpenRouter', () => {
  it('skips a model with no output the node uses', () => {
    expect(OR).toHaveLength(10);
    expect(has(OR, 'openrouter:black-forest-labs/flux-video-edit')).toBe(false);
    expect(has(OR, 'openrouter:qwen/qwen3-reranker-8b')).toBe(false);
    expect(OR.every((m) => m.type === 'openrouter' && m.sources.join() === 'openrouter')).toBe(true);
  });

  it('a text model: caps from supported_parameters, $ per token × 1e6', () => {
    const m = find(OR, 'openrouter:anthropic/claude-opus-5.5');
    expect(onCaps(m)).toEqual(['fileIn', 'imageIn', 'reasoning', 'structuredOutput', 'textIn', 'textOut', 'tools']);
    expect(m.price).toEqual({ inPerMtok: 4, outPerMtok: 20, cacheReadPerMtok: 0.2, cacheWritePerMtok: 5 });
    expect(m.limits).toEqual({ context: 1000000, output: 128000 });
    expect(m.released).toBe('2026-09-22');
  });

  it('an image model: image_output per token → per M', () => {
    const m = find(OR, 'openrouter:microsoft/mai-image-2.6');
    expect(onCaps(m)).toEqual(['imageIn', 'imageOut', 'textIn']);
    expect(m.price).toEqual({ inPerMtok: 5, outPerMtok: 0, imageOutPerMtok: 38 });
  });

  it('a speech model: voices, and its price only in raw', () => {
    const m = find(OR, 'openrouter:x-ai/grok-voice-tts-1.0');
    expect(onCaps(m)).toEqual(['audioOut', 'speech', 'textIn']);
    expect(m.caps.voices).toEqual(['eve', 'ara', 'rex', 'sal', 'leo']);
    expect(m.price).toEqual({ raw: { prompt: 0.000015, completion: 0 } });
    expect(m.price.inPerMtok).toBeUndefined();
  });

  it('a transcription model: its price only in raw, never inPerMtok', () => {
    const w = find(OR, 'openrouter:openai/whisper-1');
    expect(onCaps(w)).toEqual(['audioIn', 'textOut', 'transcription']);
    expect(w.price).toEqual({ raw: { prompt: 0.0001, completion: 0 } });
    expect(w.caps.voices).toBeUndefined();
    expect(w.limits).toEqual({});
    const t = find(OR, 'openrouter:openai/gpt-4o-transcribe');
    expect(t.price).toEqual({ raw: { prompt: 0.0000025, completion: 0.00001 } });
    expect(t.price.inPerMtok).toBeUndefined();
    expect(t.price.outPerMtok).toBeUndefined();
  });

  it('an embedding model: per-image input price in raw, audio per token → per M', () => {
    const e = find(OR, 'openrouter:openai/text-embedding-3-small');
    expect(onCaps(e)).toEqual(['embeddings', 'textIn']);
    expect(e.price).toEqual({ inPerMtok: 0.02, outPerMtok: 0 });
    expect(e.limits).toEqual({ context: 8192 });
    const g = find(OR, 'openrouter:google/gemini-embedding-2');
    expect(onCaps(g)).toEqual(['audioIn', 'embeddings', 'fileIn', 'imageIn', 'textIn', 'videoIn']);
    expect(g.price).toEqual({ inPerMtok: 0.2, outPerMtok: 0, audioInPerMtok: 6.5, raw: { image: 0.00000045 } });
  });

  it('a chat model with audio and text in is not a transcription model', () => {
    const m = find(OR, 'openrouter:openai/gpt-audio');
    expect(onCaps(m)).toEqual(['audioIn', 'audioOut', 'structuredOutput', 'textIn', 'textOut', 'tools']);
    expect(m.price).toEqual({ inPerMtok: 2.5, outPerMtok: 10, audioInPerMtok: 32, audioOutPerMtok: 64 });
  });

  it('expiration_date → retiresAt; "-1" is left unset', () => {
    expect(find(OR, 'openrouter:google/gemini-2.5-flash').retiresAt).toBe('2026-10-20');
    const auto = find(OR, 'openrouter:openrouter/auto');
    expect(auto.price).toEqual({});
    expect(auto.limits).toEqual({ context: 2000000 });
  });
});

describe('LiteLLM', () => {
  it('liteLlmRef on measured keys', () => {
    expect(liteLlmRef('whisper-1', 'openai')).toEqual({ type: 'openai', id: 'whisper-1' });
    expect(liteLlmRef('claude-opus-5-5', 'anthropic')).toEqual({ type: 'anthropic', id: 'claude-opus-5-5' });
    expect(liteLlmRef('openai/sora-2', 'openai')).toEqual({ type: 'openai', id: 'sora-2' });
    expect(liteLlmRef('xai/grok-4.3', 'xai')).toEqual({ type: 'xai', id: 'grok-4.3' });
    expect(liteLlmRef('mistral/voxtral-mini-latest', 'mistral')).toEqual({ type: 'mistral', id: 'voxtral-mini-latest' });
    expect(liteLlmRef('deepseek/deepseek-v4-flash', 'deepseek')).toEqual({ type: 'deepseek', id: 'deepseek-v4-flash' });
    expect(liteLlmRef('deepseek-v4-flash', 'deepseek')).toEqual({ type: 'deepseek', id: 'deepseek-v4-flash' });
    expect(liteLlmRef('codestral/codestral-latest', 'codestral')).toEqual({ type: 'mistral', id: 'codestral-latest' });
    expect(liteLlmRef('low/1024-x-1024/gpt-image-1.5', 'openai')).toBeNull();
    expect(liteLlmRef('vertex_ai/claude-3-5-haiku', 'vertex_ai-anthropic_models')).toBeNull();
    expect(liteLlmRef('babbage-002', 'text-completion-openai')).toBeNull();
    expect(liteLlmRef('sample_spec', 'one of https://docs.litellm.ai/docs/providers')).toBeNull();
  });

  it('keeps the modes the node uses, and one row for a model named twice', () => {
    expect(LL.map((m) => `${m.type}:${m.id}`).sort()).toEqual([
      'anthropic:claude-opus-5-5', 'deepseek:deepseek-v4-flash', 'mistral:codestral-latest', 'mistral:mistral-embed',
      'mistral:voxtral-mini-latest', 'mistral:voxtral-mini-tts-latest', 'mistral:voxtral-small-latest', 'openai:gpt-4o-transcribe',
      'openai:gpt-5.4', 'openai:gpt-image-1', 'openai:gpt-image-2', 'openai:text-embedding-3-small', 'openai:tts-1',
      'openai:whisper-1', 'xai:grok-4.3', 'xai:grok-imagine-image',
    ]);
  });

  it('a text model: caps from supports_*, $ per token × 1e6', () => {
    const m = find(LL, 'openai:gpt-5.4');
    expect(onCaps(m)).toEqual(['fileIn', 'imageIn', 'reasoning', 'structuredOutput', 'textIn', 'textOut', 'tools']);
    expect(m.price).toEqual({ inPerMtok: 2.5, outPerMtok: 15, cacheReadPerMtok: 0.25 });
    expect(m.limits).toEqual({ context: 1050000, output: 128000 });
    expect(m.name).toBe('gpt-5.4');
  });

  it('image models: per image token → per M, per image kept as is', () => {
    const g = find(LL, 'openai:gpt-image-1');
    expect(onCaps(g)).toEqual(['imageIn', 'imageOut', 'textIn']);
    expect(g.price).toEqual({ inPerMtok: 5, cacheReadPerMtok: 1.25, imageOutPerMtok: 40 });
    expect(g.retiresAt).toBe('2026-10-23');
    const x = find(LL, 'xai:grok-imagine-image');
    expect(onCaps(x)).toEqual(['imageOut', 'textIn']);
    expect(x.price).toEqual({ perImage: 0.02 });
  });

  it('speech per character, transcription per second, kept as is', () => {
    const tts = find(LL, 'openai:tts-1');
    expect(onCaps(tts)).toEqual(['audioOut', 'speech', 'textIn']);
    expect(tts.price).toEqual({ speechPerChar: 0.000015 });
    const w = find(LL, 'openai:whisper-1');
    expect(onCaps(w)).toEqual(['audioIn', 'textOut', 'transcription']);
    expect(w.price).toEqual({ transcriptionPerSecond: 0.0001 });
    expect(w.retiresAt).toBe('2027-02-26');
  });

  it('an embedding model', () => {
    const m = find(LL, 'openai:text-embedding-3-small');
    expect(onCaps(m)).toEqual(['embeddings', 'textIn']);
    expect(m.price).toEqual({ inPerMtok: 0.02, outPerMtok: 0 });
    expect(m.limits).toEqual({ context: 8191 });
  });

  it('a chat model with audio and text in is not a transcription model', () => {
    const m = find(LL, 'mistral:voxtral-small-latest');
    expect(m.caps.transcription).toBe(false);
    expect(m.caps.audioIn).toBe(true);
  });
});

describe('mergeSources', () => {
  const merged = mergeSources({ modelsDev: MD, openRouter: OR, liteLlm: LL });

  it('one row per type:id, sorted by type then id', () => {
    expect(merged).toHaveLength(27);
    const refs = merged.map((m) => `${m.type}:${m.id}`);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs.slice(0, 3)).toEqual(['anthropic:claude-opus-5-5', 'deepseek:deepseek-v4-flash', 'mistral:codestral-latest']);
    expect(refs.at(-1)).toBe('xai:grok-imagine-image');
  });

  it('OpenRouter wins for an openrouter model; family and release date stay models.dev\'s', () => {
    const m = find(merged, 'openrouter:google/gemini-2.5-flash');
    expect(m.sources).toEqual(['models.dev', 'openrouter']);
    expect(m.price.cacheWritePerMtok).toBe(0.0833333333333);
    expect(m.price.audioInPerMtok).toBe(1);
    expect(m.retiresAt).toBe('2026-10-20');
    expect(m).toMatchObject({ family: 'gemini-flash', released: '2025-06-17' });
  });

  it('LiteLLM fills missing prices and does not overwrite a models.dev price', () => {
    const stt = find(merged, 'mistral:voxtral-mini-latest');
    expect(stt.price).toEqual({ transcriptionPerSecond: 0.00005 });
    expect(stt.sources).toEqual(['models.dev', 'litellm']);
    const img = find(merged, 'openai:gpt-image-1');
    expect(img.price).toEqual({ inPerMtok: 5, cacheReadPerMtok: 1.25, imageOutPerMtok: 40 });
    expect(img).toMatchObject({ status: 'retiring', retiresAt: '2026-10-23', family: 'gpt-image' });
    const chat = find(merged, 'mistral:voxtral-small-latest');
    expect(find(LL, 'mistral:voxtral-small-latest').price.outPerMtok).toBe(0.4);
    expect(chat.price.outPerMtok).toBe(0.3);
    expect(chat.limits).toEqual({ context: 32000, output: 32000 });
    expect(chat.caps.structuredOutput).toBe(true);
    expect(find(merged, 'xai:grok-imagine-image').price).toEqual({ perImage: 0.02 });
  });

  it('LiteLLM adds a model no other source had', () => {
    expect(find(merged, 'openai:whisper-1').sources).toEqual(['litellm']);
  });

  it('an operator override wins and is named in sources', () => {
    const over = mergeSources({ modelsDev: MD, openRouter: OR, liteLlm: LL }, {
      'openai:gpt-5.4': { inPerMtok: 2 },
      'openai:no-such-model': { inPerMtok: 1 },
    });
    const m = find(over, 'openai:gpt-5.4');
    expect(m.price).toEqual({ inPerMtok: 2, outPerMtok: 15, cacheReadPerMtok: 0.25 });
    expect(m.sources).toEqual(['models.dev', 'litellm', 'operator']);
    expect(has(over, 'openai:no-such-model')).toBe(false);
  });
});

describe('applyLifecycle', () => {
  const base = find(mergeSources({ modelsDev: MD, openRouter: OR, liteLlm: LL }), 'openai:gpt-5.4');
  const DAY = 24 * 60 * 60 * 1000;
  const at = (days: number): string => new Date(Date.parse(T) + days * DAY).toISOString();

  it('missing once → retiring with missingSince, seenAt kept', () => {
    const [m] = applyLifecycle([base], [], at(7), true);
    expect(m).toMatchObject({ status: 'retiring', missingSince: at(7), seenAt: T });
  });

  it('missing 28 days → retired', () => {
    const prev = { ...base, status: 'retiring' as const, missingSince: at(0) };
    expect(applyLifecycle([prev], [], at(27), true)[0].status).toBe('retiring');
    expect(applyLifecycle([prev], [], at(28), true)[0]).toMatchObject({ status: 'retired', missingSince: at(0), seenAt: T });
  });

  it('seen again → active, missingSince cleared, seenAt now', () => {
    const prev = { ...base, status: 'retired' as const, missingSince: at(0) };
    const [m] = applyLifecycle([prev], [base], at(40), true);
    expect(m.status).toBe('active');
    expect(m.missingSince).toBeUndefined();
    expect(m.seenAt).toBe(at(40));
  });

  it('retired more than 180 days → dropped', () => {
    const prev = { ...base, status: 'retired' as const, missingSince: at(0) };
    expect(applyLifecycle([prev], [], at(180), true)).toHaveLength(1);
    expect(applyLifecycle([prev], [], at(181), true)).toEqual([]);
  });

  it('retiresAt in the past → retired though still listed', () => {
    const listed = { ...base, retiresAt: '2026-09-01' };
    const [m] = applyLifecycle([], [listed], T, true);
    expect(m.status).toBe('retired');
    expect(m.missingSince).toBeUndefined();
    const future = { ...base, retiresAt: '2026-10-20' };
    expect(applyLifecycle([], [future], T, true)[0].status).toBe('active');
  });

  it('a source that did not answer leaves the catalogue as it was', () => {
    const prev = [base];
    expect(applyLifecycle(prev, [], at(90), false)).toBe(prev);
  });
});

describe('storage helpers', () => {
  it('groupByType and recordSize', () => {
    const merged = mergeSources({ modelsDev: MD, openRouter: OR, liteLlm: LL });
    const groups = groupByType(merged);
    expect(Object.keys(groups).sort()).toEqual(['anthropic', 'deepseek', 'mistral', 'openai', 'openrouter', 'xai']);
    expect(groups.openrouter).toHaveLength(10);
    const size = recordSize(groups.anthropic ?? []);
    expect(size).toBe(JSON.stringify({ type: 'anthropic', models: groups.anthropic, updatedAt: T }).length);
  });
});

const SNAP = 'C:/Users/mail/AppData/Local/Temp/claude/e--dev-GitHub-aimeat-protocol/ff67c2f1-c6fc-49b3-8b63-4f0abb07504b/scratchpad/catalog-src/';
const SNAP_FILES = ['models-dev.json', 'openrouter-models.json', 'litellm.json'];

describe('the full snapshots of 2026-09-28', () => {
  it.skipIf(!SNAP_FILES.every((f) => existsSync(SNAP + f)))('every type fits in one record', () => {
    const load = (f: string): unknown => JSON.parse(readFileSync(SNAP + f, 'utf8'));
    const modelsDev = fromModelsDev(load('models-dev.json'), T);
    const openRouter = fromOpenRouter(load('openrouter-models.json'), T);
    const liteLlm = fromLiteLLM(load('litellm.json'), T);
    console.log(`sources: models.dev ${modelsDev.length}, openrouter ${openRouter.length}, litellm ${liteLlm.length}`);
    const groups = groupByType(mergeSources({ modelsDev, openRouter, liteLlm }));
    for (const type of CATALOG_TYPES) {
      const models = groups[type] ?? [];
      const bytes = recordSize(models);
      console.log(`${type}: ${models.length} models, record ${bytes} bytes (${(bytes / 1024).toFixed(1)} kB)`);
      expect(bytes).toBeLessThan(1024 * 1024);
    }
  });
});
