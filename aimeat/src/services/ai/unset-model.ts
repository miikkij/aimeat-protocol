/**
 * @file unset-model.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the node says when an operation has no model: neither the call, the owner nor
 *   the operator named one. A refusal rather than a fallback, because a chat model handed an image
 *   request or an audio file answers with prose or an opaque provider error, and the person is left
 *   without the name of the setting to fill in. A leaf, so the gate (services/ai-completion.ts) and
 *   the services that re-export the wording (ai-image.ts, ai-transcription.ts) share one copy.
 * @structure
 *   - IMAGE_UNSET_MESSAGE / STT_UNSET_MESSAGE — the wording, unchanged since 2026-08
 *   - UNSET_MODEL — the code and message per operation
 * @version-history
 *   v1.1.0 — 2026-09-28 — speak (NO_TTS_MODEL) and embed (NO_EMBED_MODEL), System 2 plan V5.
 *   v1.0.0 — 2026-09-28 — The two messages moved here from ai-image.ts and ai-transcription.ts,
 *     unchanged, when prepareAiCall took over choosing the model for images and transcription.
 */
import type { AiOp } from './types.js';

export const IMAGE_UNSET_MESSAGE =
  'No image model is configured. Choose one in Profile > OpenRouter (an image model, not a chat '
  + 'model), or ask the operator to set a default for this node.';

export const STT_UNSET_MESSAGE =
  'No transcription model selected. Choose one in Settings → OpenRouter (for example openai/whisper-large-v3).';

export const TTS_UNSET_MESSAGE =
  'No speech model is set. Name one in the call, set one for speech on one of your AI providers, '
  + 'or ask the operator to set a default for this node.';

export const EMBED_UNSET_MESSAGE =
  'No embedding model is set. Name one in the call, set one for embeddings on one of your AI providers, '
  + 'or ask the operator to set a default for this node.';

/** The refusal per operation that has no fallback model. Text falls back to the free router instead. */
export const UNSET_MODEL: Partial<Record<AiOp, { code: string; message: string }>> = {
  image: { code: 'NO_IMAGE_MODEL', message: IMAGE_UNSET_MESSAGE },
  transcribe: { code: 'NO_STT_MODEL', message: STT_UNSET_MESSAGE },
  speak: { code: 'NO_TTS_MODEL', message: TTS_UNSET_MESSAGE },
  embed: { code: 'NO_EMBED_MODEL', message: EMBED_UNSET_MESSAGE },
};
