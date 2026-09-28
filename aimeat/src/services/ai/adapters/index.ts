/**
 * @file index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The adapter registry: adapter type → the model builders for each operation it can do.
 *   A new provider of an existing type is a record; a new type is one entry here, and no caller of
 *   the gateway changes (docs/internal/llmproviderintegrations/03, section 3).
 * @structure
 *   - AiAdapter — which operations a type does, and the builder for each
 *   - adapterFor() — the adapter for a type, never undefined
 *   - openAiChat() — an OpenAI chat-completions answer from a type that does not speak that dialect
 *   - speaksOpenAiChat() — whether a type's own API is OpenAI chat completions, byte for byte
 * @version-history
 *   v1.3.0 — 2026-09-28 — The extension type (V6): text, image, transcription and embeddings through
 *     the extension's `ai.<op>` actions; it does not speak OpenAI chat, so the proxy converts.
 *   v1.2.0 — 2026-09-28 — Embeddings (System 2 plan, V5): openrouter, openai, mistral, local and
 *     openai-compatible, through their AI SDK packages.
 *   v1.1.0 — 2026-09-28 — The direct types of V3: openai (text, image, transcription), anthropic
 *     (text), xai (text, image, transcription) and mistral (text, transcription), through their own
 *     packages; openAiChat() for the proxy and the voice stream on an Anthropic provider.
 *   v1.0.0 — 2026-09-28 — Initial, with the gateway (V1 of the System 2 plan): openrouter, local and
 *     openai-compatible; text through the AI SDK packages, image and transcription through the
 *     node's own transport.
 */
import type { EmbeddingModelV4, ImageModelV4, LanguageModelV4, TranscriptionModelV4 } from '@ai-sdk/provider';
import type { AiAdapterType, AiOp, AiTarget } from '../types.js';
import { embeddingModel, languageModel, sdkImageModel, sdkTranscriptionModel } from './sdk.js';
import { imageModel } from './image.js';
import { transcriptionModel, type AimeatTranscriptionModel } from './audio.js';
import { openAiChatResponse, type OpenAiChatBody } from './openai-chat.js';
import {
  extensionEmbeddingModel, extensionImageModel, extensionLanguageModel, extensionTranscriptionModel,
} from './extension.js';

export interface AiAdapter {
  type: AiAdapterType;
  /** What this type can do at all. Which MODEL can do it is the catalogue's answer (V4). */
  ops: ReadonlySet<AiOp>;
  language?(target: AiTarget, modelId: string): LanguageModelV4;
  image?(target: AiTarget, modelId: string): ImageModelV4;
  transcription?(target: AiTarget, modelId: string): AimeatTranscriptionModel | TranscriptionModelV4;
  embedding?(target: AiTarget, modelId: string): EmbeddingModelV4;
}

/** The types that speak the OpenAI-compatible protocol: images and transcription through the node's own transport. */
function compatibleAdapter(type: AiAdapterType): AiAdapter {
  return {
    type,
    ops: new Set<AiOp>(['text', 'image', 'transcribe', 'embed']),
    language: languageModel,
    image: imageModel,
    transcription: transcriptionModel,
    embedding: embeddingModel,
  };
}

const ADAPTERS: Record<AiAdapterType, AiAdapter> = {
  openrouter: compatibleAdapter('openrouter'),
  local: compatibleAdapter('local'),
  'openai-compatible': compatibleAdapter('openai-compatible'),
  openai: { type: 'openai', ops: new Set<AiOp>(['text', 'image', 'transcribe', 'embed']), language: languageModel, image: sdkImageModel, transcription: sdkTranscriptionModel, embedding: embeddingModel },
  anthropic: { type: 'anthropic', ops: new Set<AiOp>(['text']), language: languageModel },
  xai: { type: 'xai', ops: new Set<AiOp>(['text', 'image', 'transcribe']), language: languageModel, image: sdkImageModel, transcription: sdkTranscriptionModel },
  mistral: { type: 'mistral', ops: new Set<AiOp>(['text', 'transcribe', 'embed']), language: languageModel, transcription: sdkTranscriptionModel, embedding: embeddingModel },
  // An installed extension's `ai.<op>` actions (V6). Which ops it has is its manifest's answer,
  // checked by the runner; speech runs in services/ai-voice.ts, as for every type.
  extension: {
    type: 'extension', ops: new Set<AiOp>(['text', 'image', 'transcribe', 'embed']),
    language: extensionLanguageModel, image: extensionImageModel,
    transcription: extensionTranscriptionModel, embedding: extensionEmbeddingModel,
  },
};

export function adapterFor(type: AiAdapterType): AiAdapter {
  return ADAPTERS[type];
}

/**
 * Whether a type's own chat API is OpenAI chat completions, so the proxy and the voice stream can
 * pass its bytes on unchanged (services/openrouter.ts chatCompletionRaw). Anthropic is the one that
 * is not; openAiChat() answers for it.
 */
export function speaksOpenAiChat(type: AiAdapterType): boolean {
  return type !== 'anthropic' && type !== 'extension';
}

/** An OpenAI chat-completions Response (JSON or SSE) from this target, through its AI SDK model. */
export function openAiChat(target: AiTarget, modelId: string, body: OpenAiChatBody, signal?: AbortSignal): Promise<Response> {
  const build = ADAPTERS[target.type].language ?? languageModel;
  return openAiChatResponse(build(target, modelId), body, signal);
}
