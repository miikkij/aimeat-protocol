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
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial, with the gateway (V1 of the System 2 plan): openrouter, local and
 *     openai-compatible; text through the AI SDK packages, image and transcription through the
 *     node's own transport.
 */
import type { ImageModelV4, LanguageModelV4 } from '@ai-sdk/provider';
import type { AiAdapterType, AiOp, AiTarget } from '../types.js';
import { languageModel } from './sdk.js';
import { imageModel } from './image.js';
import { transcriptionModel, type AimeatTranscriptionModel } from './audio.js';

export interface AiAdapter {
  type: AiAdapterType;
  /** What this type can do at all. Which MODEL can do it is the catalogue's answer (V4). */
  ops: ReadonlySet<AiOp>;
  language?(target: AiTarget, modelId: string): LanguageModelV4;
  image?(target: AiTarget, modelId: string): ImageModelV4;
  transcription?(target: AiTarget, modelId: string): AimeatTranscriptionModel;
}

/** The three types the owner's settings can name today speak the same OpenAI-compatible protocol. */
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
};

export function adapterFor(type: AiAdapterType): AiAdapter {
  return ADAPTERS[type];
}
