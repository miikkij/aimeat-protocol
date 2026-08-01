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
 *   `ownerGhii` decides who may resolve a record privately, and `contentHash` is the join key a
 *   third party can use without us having given them an identifier. Only `contentHash` is
 *   duplicated out of the document, and it is projected from it on write so the two cannot disagree.
 *
 *   THERE IS NO `visibility` COLUMN, DELIBERATELY. Provenance visibility FOLLOWS THE CONTENT: a
 *   record is resolvable by anyone exactly when some item that points at it is itself publicly
 *   readable, and it stops being resolvable the moment that item stops being public. Storing a flag
 *   would create a second visibility concept that has to be kept in sync with the first, and letting
 *   a caller set one would be a way to publish a statement about content nobody may read. The link
 *   direction is item → record (`MemoryRecord.aiProvenanceId`, `AppRecord.aiProvenanceId`), so the
 *   question is answered by ONE query — see publiclyLinkedProvenanceIds() in the repository.
 * @structure
 *   - AiProvenanceRecordRow — one stored provenance record
 *   - AiProvenanceHashQuery — the filter for the public hash lookup
 * @usage
 *   import type { AiProvenanceRecordRow } from '../storage/interface.js';
 * @version-history
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 2. `visibility` removed: it is derived from the linked
 *     content, not stored and never caller-settable.
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
  /** Copied out of the document for ordering/index purposes. */
  generatedAt: string;
  /** When the ROW was written, which is not necessarily when the content was generated. */
  createdAt: string;
  /** The canonical `aimeat.provenance/v1` document, served verbatim. */
  record: AiProvenance;
}

/** Filter for the hash lookup. `ownerGhii` widens a public-only read to include the caller's own. */
export interface AiProvenanceHashQuery {
  /** Restrict to records the caller owns, in ADDITION to every publicly linked one. Omit for public-only. */
  ownerGhii?: string;
  limit?: number;
}
