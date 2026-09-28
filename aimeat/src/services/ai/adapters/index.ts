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
 *   v1.1.0 — 2026-09-28 — The direct types of V3: openai (text, image, transcription), anthropic
 *     (text), xai (text, image, transcription) and mistral (text, transcription), through their own
 *     packages; openAiChat() for the proxy and the voice stream on an Anthropic provider.
 *   v1.0.0 — 2026-09-28 — Initial, with the gateway (V1 of the System 2 plan): openrouter, local and
 *     openai-compatible; text through the AI SDK packages, image and transcription through the
 *     node's own transport.
 */
import type { ImageModelV4, LanguageModelV4, TranscriptionModelV4 } from '@ai-sdk/provider';
import type { AiAdapterType, AiOp, AiTarget } from '../types.js';
import { languageModel, sdkImageModel, sdkTranscriptionModel } from './sdk.js';
import { imageModel } from './image.js';
import { transcriptionModel, type AimeatTranscriptionModel } from './audio.js';
import { openAiChatResponse, type OpenAiChatBody } from './openai-chat.js';

export interface AiAdapter {
  type: AiAdapterType;
  /** What this type can do at all. Which MODEL can do it is the catalogue's answer (V4). */
  ops: ReadonlySet<AiOp>;
  language?(target: AiTarget, modelId: string): LanguageModelV4;
  image?(target: AiTarget, modelId: string): ImageModelV4;
  transcription?(target: AiTarget, modelId: string): AimeatTranscriptionModel | TranscriptionModelV4;
}

/** The types that speak the OpenAI-compatible protocol: images and transcription through the node's own transport. */
function compatibleAdapter(type: AiAdapterType): AiAdapter {
  return {
    type,
    ops: new Set<AiOp>(['text', 'image', 'transcribe']),
    language: languageModel,
    image: imageModel,
    transcription: transcriptionModel,
  };
}

const ADAPTERS: Record<AiAdapterType, AiAdapter> = {
  openrouter: compatibleAdapter('openrouter'),
  local: compatibleAdapter('local'),
  'openai-compatible': compatibleAdapter('openai-compatible'),
  openai: { type: 'openai', ops: new Set<AiOp>(['text', 'image', 'transcribe']), language: languageModel, image: sdkImageModel, transcription: sdkTranscriptionModel },
  anthropic: { type: 'anthropic', ops: new Set<AiOp>(['text']), language: languageModel },
  xai: { type: 'xai', ops: new Set<AiOp>(['text', 'image', 'transcribe']), language: languageModel, image: sdkImageModel, transcription: sdkTranscriptionModel },
  mistral: { type: 'mistral', ops: new Set<AiOp>(['text', 'transcribe']), language: languageModel, transcription: sdkTranscriptionModel },
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
  return type !== 'anthropic';
}

/** An OpenAI chat-completions Response (JSON or SSE) from this target, through its AI SDK model. */
export function openAiChat(target: AiTarget, modelId: string, body: OpenAiChatBody, signal?: AbortSignal): Promise<Response> {
  return openAiChatResponse(languageModel(target, modelId), body, signal);
}
