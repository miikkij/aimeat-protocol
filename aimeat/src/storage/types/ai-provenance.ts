/**
 * @file src/storage/types/ai-provenance.ts
 * @description The stored form of an AI provenance record — the ADDRESSABLE half of the two-layer
 *   design. The other half is ATTACHED: `MemoryRecord.aiProvenanceId` points at a row here, so the
 *   statement travels with the item as well as living outside it. Both exist deliberately: strip the
 *   served document and the addressable record survives; take the record offline and the in-band
 *   reference survives. That redundancy is the Code of Practice's two-layer logic and also plain
 *   resilience — picking only one is the expensive mistake.
 *
 *   The canonical DOCUMENT is `record` (an `aimeat.provenance/v1`, camelCase, served verbatim). The
 *   columns beside it are AIMEAT's own authorization + lookup metadata, NOT part of the spec:
 *   `ownerGhii` decides who may resolve a private record, `visibility` decides whether an anonymous
 *   reader may, and `contentHash` is the join key a third party can use without us having given
 *   them an identifier. Only `contentHash` is duplicated out of the document, and it is projected
 *   from it on write so the two cannot disagree.
 * @structure
 *   - AiProvenanceRecordRow — one stored provenance record
 *   - AiProvenanceHashQuery — the filter for the public hash lookup
 * @usage
 *   import type { AiProvenanceRecordRow } from '../storage/interface.js';
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1.
 */
import type { AiProvenance } from '../../models/ai-provenance-schemas.js';

export interface AiProvenanceRecordRow {
  /** Node-local id. A convenience handle — the content hash is the real join key. */
  id: string;
  /** Whose account this belongs to (always a GHII). The authorization key for a private resolve. */
  ownerGhii: string;
  /** The principal the generation ran for, or that declared it: GHII | GAII | GEAI. */
  principal: string;
  /** `sha256:<64 lower-case hex>` of the exact bytes, or null when the declarer supplied none. */
  contentHash: string | null;
  /**
   * `public` ONLY when the content this describes is itself public. It gates the anonymous read on
   * both resolve endpoints; a private record answers an anonymous caller with the same 404 a
   * non-existent one does, so the endpoint discloses no existence.
   */
  visibility: 'public' | 'private';
  /** Copied out of the document for ordering/index purposes. */
  generatedAt: string;
  /** When the ROW was written, which is not necessarily when the content was generated. */
  createdAt: string;
  /** The canonical `aimeat.provenance/v1` document, served verbatim. */
  record: AiProvenance;
}

/** Filter for the hash lookup. `ownerGhii` widens a public-only read to include the caller's own. */
export interface AiProvenanceHashQuery {
  /** Restrict to records the caller owns, in ADDITION to every public one. Omit for public-only. */
  ownerGhii?: string;
  limit?: number;
}
