/**
 * @file image.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Image generation as an AI SDK image model, over the node's own transport
 *   (services/openrouter.ts generateImage).
 *
 *   WHY NOT THE OPENROUTER PACKAGE'S IMAGE MODEL. Measured on @openrouter/ai-sdk-provider 3.1.0: it
 *   posts to `{baseURL}/images` where the node has always posted to `/images/generations`, it drops
 *   the `usage.cost` the provider reports (the only exact price an image has), and it accepts only
 *   `b64_json`, where some providers answer with a `data:` URL. The node's transport also retries a
 *   moderation refusal three times, because some providers refuse an ordinary prompt and pass it on
 *   the next attempt. So this adapter implements the AI SDK's ImageModelV4 over that transport, the
 *   same way the audio adapter does for speech and transcription, and the gateway still calls the
 *   AI SDK's generateImage like it calls generateText.
 * @structure
 *   - imageModel() — an ImageModelV4 for any target the node's transport reaches
 *   - AimeatImageMetadata — what the adapter reports beside the bytes
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial, with the gateway (V1 of the System 2 plan).
 */
import type { ImageModelV4 } from '@ai-sdk/provider';
import type { AiTarget } from '../types.js';
import { generateImage } from '../../openrouter.js';

/** Filed under `providerMetadata.aimeat.images[0]` for the one image a call makes. */
export interface AimeatImageMetadata {
  /** The provider's reported charge in USD, or null when it said nothing. Never estimated here. */
  costUsd: number | null;
  /** The format sniffed from the bytes, not the one the provider claimed. */
  mime: string;
  /** The model the provider says answered. */
  model: string;
}

export function imageModel(target: AiTarget, modelId: string): ImageModelV4 {
  return {
    specificationVersion: 'v4',
    provider: `aimeat.${target.type}`,
    modelId,
    // The node asks for one picture per call; the transport has never sent `n`.
    maxImagesPerCall: 1,
    async doGenerate(options) {
      const r = await generateImage(target.key, modelId, options.prompt ?? '', target.baseUrl, {
        ...(options.size ? { size: options.size } : {}),
        ...(options.abortSignal ? { signal: options.abortSignal } : {}),
      });
      const meta: AimeatImageMetadata = { costUsd: r.costUsd ?? null, mime: r.mime, model: r.model };
      return {
        images: [new Uint8Array(r.data)],
        warnings: [],
        response: { timestamp: new Date(), modelId: r.model, headers: undefined },
        // An image model's metadata is per image: the AI SDK keeps only the `images` array of each
        // provider's entry, so the cost lives inside it rather than beside it.
        providerMetadata: { aimeat: { images: [{ ...meta }] } },
      };
    },
  };
}
