/**
 * @file src/services/ai/call-outcome.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a model call's settlement takes and gives back (completion.ts settleAiCall). Types
 *   only; completion.ts re-exports both names, so no importer changed.
 * @structure AiCallOutcome · AiCallSettlement
 * @usage import type { AiCallOutcome } from './completion.js';
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Moved here from completion.ts unchanged (max-file-lines; secaudit2026oct26).
 */
import type { AiProvenanceRecordRow } from '../../storage/interface.js';
import type { AiMediaKind, AiProvenanceMethod } from '../../models/ai-provenance-schemas.js';
import type { SurfaceContext } from '../ai-disclosure.js';
import type { UsageRecord } from '../ai-usage-record.js';
import type { CostSource } from './types.js';

export interface AiCallOutcome {
  /** The model that actually answered, which is not always the one that was asked for. */
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  /** The text the model produced, hashed into the provenance record. */
  content: string;
  /** Observed binary output, hashed incrementally without retaining the audio. */
  contentHash?: string;
  appId?: string;
  /** Where this call came from, for the usage record. */
  source: string;
  /** What was consumed besides tokens: audio seconds for a transcription, pictures for an image. */
  units?: { seconds?: number; images?: number };
  /** The output's medium for the record (text when there is `content` and nobody says), its IANA
   *  type, a method other than fully-generated (`transcribed`), and the surface it lands on. */
  media?: { mediaKind?: AiMediaKind; mediaType?: string; method?: AiProvenanceMethod; surface?: SurfaceContext };
  /** Where `costUsd` came from (services/ai/types.ts). Logged with the settlement. */
  costSource?: CostSource;
  /** What the ledger cites for the price: the catalogue snapshot, `estimate`, … (services/ai/catalog/price.ts). */
  priceRef?: string;
}

export interface AiCallSettlement {
  usage: UsageRecord;
  allowanceRemainingUsd?: number;
  provenance?: AiProvenanceRecordRow;
}
