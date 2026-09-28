/**
 * @file extension.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The adapter for an extension provider (System 2 plan, V6; docs/internal/
 *   llmproviderintegrations/08, section 3): AI SDK model objects whose calls run the extension's
 *   `ai.<op>` actions through the target's runner (services/ai/extension-provider.ts), in the fixed
 *   input and output shapes the node defines. An extension does not invent its own shape.
 *
 *     ai.text       in  { model, messages: [{ role, content }], maxTokens, temperature, tools: [] }
 *                   out { text, finishReason?, usage?: { inputTokens?, outputTokens?, costUsd? } }
 *                   `content` is a string, or parts: { type: 'text', text } | { type: 'file' | 'image',
 *                   mediaType, data (base64) | url, filename? }
 *     ai.image      in  { model, prompt, size }          out { images: [{ data (base64), mimeType }], costUsd? }
 *     ai.transcribe in  { model, audio (base64), mimeType, filename, language? }
 *                   out { text, language?, durationSeconds?, costUsd? }
 *     ai.embed      in  { model, input: string[] }       out { embeddings: number[][], usage?: { inputTokens?, costUsd? } }
 *
 *   No streaming (plan 08, section 3): the sandbox returns one result, so doStream wraps the whole
 *   answer in one stream. An answer of the wrong shape is a 502 naming the action and the field.
 * @structure extensionLanguageModel · extensionImageModel · extensionTranscriptionModel · extensionEmbeddingModel
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V6 of the System 2 plan).
 */
import type {
  EmbeddingModelV4, ImageModelV4, LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import type { AiOp, AiTarget } from '../types.js';
import type { AimeatImageMetadata } from './image.js';
import type { AimeatTranscriptionModel, AimeatTranscriptionOptions } from './audio.js';

const PROVIDER = 'aimeat.extension';

function badAnswer(op: AiOp, field: string): Error {
  return Object.assign(new Error(`The extension's ai.${op} answered without a valid \`${field}\`.`), { status: 502 });
}

function runnerOf(target: AiTarget): NonNullable<AiTarget['runExtension']> {
  if (!target.runExtension) throw Object.assign(new Error('An extension provider was reached without its runner.'), { status: 500 });
  return target.runExtension;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
const base64Of = (d: Uint8Array | string): string => (typeof d === 'string' ? d : Buffer.from(d).toString('base64'));

/** A V4 prompt as the node's `messages`: text joined, files and pictures as parts, tool parts left out. */
function messagesOf(prompt: LanguageModelV4CallOptions['prompt']): Array<{ role: string; content: unknown }> {
  const out: Array<{ role: string; content: unknown }> = [];
  for (const m of prompt) {
    if (m.role === 'system') { out.push({ role: 'system', content: m.content }); continue; }
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const parts: Array<Record<string, unknown>> = [];
    for (const p of m.content as unknown as Array<Record<string, unknown>>) {
      if (p.type === 'text' && typeof p.text === 'string') parts.push({ type: 'text', text: p.text });
      else if (p.type === 'file') {
        const data = p.data as { type?: string; data?: Uint8Array | string; url?: URL } | Uint8Array | string | URL;
        const mediaType = String(p.mediaType ?? 'application/octet-stream');
        const kind = mediaType.startsWith('image/') ? 'image' : 'file';
        const named = typeof p.filename === 'string' ? { filename: p.filename } : {};
        if (data instanceof URL) parts.push({ type: kind, mediaType, url: data.href, ...named });
        else if (typeof data === 'string' || data instanceof Uint8Array) parts.push({ type: kind, mediaType, data: base64Of(data), ...named });
        else if (data?.type === 'url' && data.url) parts.push({ type: kind, mediaType, url: String(data.url), ...named });
        else if (data?.type === 'data' && data.data !== undefined) parts.push({ type: kind, mediaType, data: base64Of(data.data), ...named });
      }
    }
    out.push({ role: m.role, content: parts.every(p => p.type === 'text') ? parts.map(p => p.text).join('') : parts });
  }
  return out;
}

const FINISH: Record<string, 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'> = {
  stop: 'stop', end_turn: 'stop', length: 'length', max_tokens: 'length', 'content-filter': 'content-filter',
  content_filter: 'content-filter', 'tool-calls': 'tool-calls', tool_calls: 'tool-calls', error: 'error',
};

export function extensionLanguageModel(target: AiTarget, modelId: string): LanguageModelV4 {
  const run = runnerOf(target);
  const generate = async (o: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> => {
    const r = await run('text', {
      model: modelId, messages: messagesOf(o.prompt), tools: [],
      maxTokens: o.maxOutputTokens ?? null, temperature: o.temperature ?? null,
    }, o.abortSignal);
    if (typeof r.text !== 'string') throw badAnswer('text', 'text');
    const usage = (r.usage ?? {}) as Record<string, unknown>;
    const raw = typeof r.finishReason === 'string' ? r.finishReason : 'stop';
    const inTok = num(usage.inputTokens);
    const outTok = num(usage.outputTokens);
    const cost = num(usage.costUsd);
    return {
      content: [{ type: 'text', text: r.text }],
      finishReason: { unified: FINISH[raw] ?? 'other', raw },
      usage: {
        inputTokens: { total: inTok, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: outTok, text: outTok, reasoning: undefined },
      },
      // The gateway reads a reported charge from the response body (gateway.ts reportedCost).
      response: { modelId, body: { usage: cost !== undefined ? { cost } : {} } },
      warnings: [],
    };
  };
  return {
    specificationVersion: 'v4', provider: PROVIDER, modelId,
    // Every URL is passed on as it is: the extension, not the node, decides whether to fetch one.
    supportedUrls: { '*/*': [/^https?:\/\//] },
    doGenerate: generate,
    async doStream(o) {
      // One result, one stream (plan 08, section 3): the sandbox returns the whole answer at once.
      const r = await generate(o);
      const text = r.content.map(c => (c.type === 'text' ? c.text : '')).join('');
      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'response-metadata', modelId });
          controller.enqueue({ type: 'text-start', id: '0' });
          controller.enqueue({ type: 'text-delta', id: '0', delta: text });
          controller.enqueue({ type: 'text-end', id: '0' });
          controller.enqueue({ type: 'finish', usage: r.usage, finishReason: r.finishReason });
          controller.close();
        },
      });
      return { stream };
    },
  };
}

export function extensionImageModel(target: AiTarget, modelId: string): ImageModelV4 {
  const run = runnerOf(target);
  return {
    specificationVersion: 'v4', provider: PROVIDER, modelId, maxImagesPerCall: 1,
    async doGenerate(o) {
      const r = await run('image', { model: modelId, prompt: o.prompt ?? '', size: o.size ?? null }, o.abortSignal);
      const first = Array.isArray(r.images) ? r.images[0] as Record<string, unknown> | undefined : undefined;
      if (!first || typeof first.data !== 'string' || !first.data) throw badAnswer('image', 'images[0].data');
      const mime = typeof first.mimeType === 'string' && first.mimeType.startsWith('image/') ? first.mimeType : 'image/png';
      const meta: AimeatImageMetadata = { costUsd: num(r.costUsd) ?? null, mime, model: modelId };
      return {
        images: [new Uint8Array(Buffer.from(first.data, 'base64'))], warnings: [],
        response: { timestamp: new Date(), modelId, headers: undefined },
        providerMetadata: { aimeat: { images: [{ ...meta }] } },
      };
    },
  };
}

export function extensionTranscriptionModel(target: AiTarget, modelId: string): AimeatTranscriptionModel {
  const run = runnerOf(target);
  const model: AimeatTranscriptionModel = {
    specificationVersion: 'v4', provider: PROVIDER, modelId,
    async doGenerate(o) {
      const opts = (o.providerOptions?.aimeat ?? {}) as unknown as AimeatTranscriptionOptions;
      const r = await run('transcribe', {
        model: modelId, audio: base64Of(o.audio), mimeType: opts.mime ?? o.mediaType,
        filename: opts.filename ?? 'audio', ...(opts.language ? { language: opts.language } : {}),
      }, o.abortSignal);
      if (typeof r.text !== 'string') throw badAnswer('transcribe', 'text');
      const seconds = num(r.durationSeconds);
      const cost = num(r.costUsd);
      // The gateway answers a model named `aimeat.*` from `last`, which keeps an empty transcript.
      model.last = {
        text: r.text, model: modelId,
        ...(typeof r.language === 'string' ? { language: r.language } : {}),
        ...(seconds !== undefined || cost !== undefined ? { usage: { ...(seconds !== undefined ? { seconds } : {}), ...(cost !== undefined ? { cost_usd: cost } : {}) } } : {}),
      };
      return {
        text: r.text, segments: [], language: typeof r.language === 'string' ? r.language : undefined,
        durationInSeconds: seconds, warnings: [], response: { timestamp: new Date(), modelId },
      };
    },
  };
  return model;
}

export function extensionEmbeddingModel(target: AiTarget, modelId: string): EmbeddingModelV4 {
  const run = runnerOf(target);
  return {
    specificationVersion: 'v4', provider: PROVIDER, modelId, maxEmbeddingsPerCall: 256, supportsParallelCalls: false,
    async doEmbed(o) {
      const r = await run('embed', { model: modelId, input: o.values }, o.abortSignal);
      const vectors = r.embeddings;
      if (!Array.isArray(vectors) || vectors.length !== o.values.length
        || !vectors.every(v => Array.isArray(v) && v.every(n => typeof n === 'number' && Number.isFinite(n)))) {
        throw badAnswer('embed', 'embeddings');
      }
      const usage = (r.usage ?? {}) as Record<string, unknown>;
      const cost = num(usage.costUsd);
      const tokens = num(usage.inputTokens);
      return {
        embeddings: vectors as number[][], warnings: [],
        ...(tokens !== undefined ? { usage: { tokens } } : {}),
        response: { body: { usage: cost !== undefined ? { cost } : {} } },
      };
    },
  };
}
