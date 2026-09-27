/**
 * @file audio.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Transcription as an AI SDK transcription model, over the node's own multipart
 *   transport (services/openrouter.ts transcribe).
 *
 *   The own adapter is the plan's decision P2 (docs/internal/llmproviderintegrations/03): the
 *   OpenRouter AI SDK package has no speech and no transcription model, although OpenRouter lists
 *   24 transcription models, and the OpenAI-compatible package has neither either. The node's
 *   transport already speaks the OpenAI-compatible `/audio/transcriptions` form, which reaches
 *   OpenRouter and a self-hosted whisper.cpp alike, and reports the provider's own cost, which for
 *   audio is the only trustworthy price.
 *
 *   The caller's media type and file name ride in `providerOptions.aimeat`, because the AI SDK
 *   guesses a media type from the bytes and falls back to audio/wav, where the node has always sent
 *   the type the recording was made in.
 * @structure
 *   - transcriptionModel() — a TranscriptionModelV4 that keeps the transport's whole result
 *   - AimeatTranscriptionOptions — what the gateway passes in providerOptions.aimeat
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial, with the gateway (V1 of the System 2 plan).
 */
import type { TranscriptionModelV4 } from '@ai-sdk/provider';
import type { AiTarget } from '../types.js';
import { transcribe, type TranscriptionResult } from '../../openrouter.js';

export interface AimeatTranscriptionOptions {
  mime: string;
  filename: string;
  language?: string;
  verbose?: boolean;
  temperature?: number;
}

/**
 * The model, plus the transport's whole answer after the call. The gateway reads `last` rather than
 * the AI SDK's result for one reason: the AI SDK's transcribe() throws on an empty transcript, and
 * an empty transcript of a silent recording is an answer the node returns (and pays for).
 */
export type AimeatTranscriptionModel = TranscriptionModelV4 & { last?: TranscriptionResult };

export function transcriptionModel(target: AiTarget, modelId: string): AimeatTranscriptionModel {
  const model: AimeatTranscriptionModel = {
    specificationVersion: 'v4',
    provider: `aimeat.${target.type}`,
    modelId,
    async doGenerate(options) {
      const opts = (options.providerOptions?.aimeat ?? {}) as unknown as Partial<AimeatTranscriptionOptions>;
      const data = typeof options.audio === 'string'
        ? Buffer.from(options.audio, 'base64')
        : Buffer.from(options.audio.buffer, options.audio.byteOffset, options.audio.byteLength);
      const r = await transcribe(target.key, modelId, {
        data,
        mime: opts.mime ?? options.mediaType,
        filename: opts.filename ?? 'audio',
      }, target.baseUrl, {
        ...(opts.language ? { language: opts.language } : {}),
        ...(opts.verbose ? { verbose: true } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(options.abortSignal ? { signal: options.abortSignal } : {}),
      });
      model.last = r;
      return {
        text: r.text,
        segments: [],
        language: r.language,
        durationInSeconds: r.usage?.seconds,
        warnings: [],
        response: { timestamp: new Date(), modelId: r.model },
        providerMetadata: { aimeat: { costUsd: r.usage?.cost_usd ?? null, seconds: r.usage?.seconds ?? null } },
      };
    },
  };
  return model;
}
