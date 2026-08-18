/**
 * @file src/storage/types/ai-provenance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   - PUBLICLY_LINKED_CONTAINERS — the containers the derived-visibility rule must cover
 *   - AiProvenanceRecordRow — one stored provenance record
 *   - AiProvenanceHashQuery — the filter for the public hash lookup
 * @usage
 *   import type { AiProvenanceRecordRow } from '../storage/interface.js';
 * @version-history
 *   v1.3.0 — 2026-08-01 — TARGET-058 Phase 9 step 0. `board_posts` joins the list: a post on a public
 *     board is served unauthenticated, so leaving it out meant the one surface an anonymous visitor
 *     reads had a record that would not resolve for them. Agent messages got the same column in the
 *     same change and deliberately did NOT join the list — they are private, like direct messages.
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 8. PUBLICLY_LINKED_CONTAINERS: the maintenance obligation
 *     the derived-visibility design created, written down where `pnpm check:ai-disclosure` enforces it.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 2. `visibility` removed: it is derived from the linked
 *     content, not stored and never caller-settable.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1.
 */
import type { AiProvenance } from '../../models/ai-provenance-schemas.js';

/**
 * THE list of containers that can make content publicly readable, and therefore the list the
 * derived-visibility rule has to cover.
 *
 * This is the maintenance obligation that "visibility follows the content" creates, written down
 * where it can be enforced. A record is anonymously resolvable exactly when some item pointing at it
 * is public — so a NEW publishing route whose table is not in this list leaves every provenance
 * record it produces silently private. Nothing breaks; the label simply fails to resolve, which
 * reads to a visitor as "no provenance", which is the one thing this programme exists to prevent.
 *
 * `pnpm check:ai-disclosure` asserts that BOTH storage providers' `PUBLICLY_LINKED` predicates cover
 * exactly these containers, and that the two agree with each other. Adding a publishing route means
 * adding an entry here and a clause in both predicates, in the same change.
 */
export const PUBLICLY_LINKED_CONTAINERS = [
  {
    /** Memory records — and so also workspace records, agent faces and WebMCP tool manifests. */
    name: 'memory',
    sqliteTable: 'memory',
    postgresTable: '"Memory"',
    publicWhen: "visibility = 'public'",
  },
  {
    /** Published apps: served to anyone who asks, so not parked, not operator-hidden, no access code. */
    name: 'apps',
    sqliteTable: 'apps',
    postgresTable: '"App"',
    publicWhen: 'not parked, not operator-hidden, no access code',
  },
  {
    /**
     * Board posts and replies on a PUBLIC board. `GET /v1/boards/:boardId/posts` takes no auth, so a
     * post there is readable by a stranger and its provenance must resolve for that same stranger.
     * The visibility lives on the BOARD, not on the post, so the predicate joins.
     */
    name: 'board_posts',
    sqliteTable: 'board_posts',
    postgresTable: '"BoardPost"',
    publicWhen: "the post's board has visibility = 'public'",
  },
] as const;

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

/** Shared filters for the report/sweep/owner reads. Every field narrows; omit all for the whole node. */
export interface AiProvenanceFacetQuery {
  /** Restrict to one account — the per-owner view. */
  ownerGhii?: string;
  /** ISO timestamp; records generated at or after it. The trend window. */
  since?: string;
}

/** One distinct combination of what a record says, and how many records fall in it. */
export interface AiProvenanceFacet {
  /** `none` | `light-review` | `editorial-control` | `full-human`, as stored in the document. */
  humanInvolvement: string;
  /** `original` | `assisted` | `synthesized` | `ai-generated`. */
  level: string;
  /** `YYYY-MM-DD` of `generatedAt` — the trend axis. */
  day: string;
  /** Is the content this record describes readable by an anonymous visitor right now? */
  publiclyLinked: boolean;
  /** Does the record's pre-rendered `disclosure` block say a label was required? */
  disclosureRequired: boolean;
  count: number;
}

export interface AiProvenanceListQuery extends AiProvenanceFacetQuery {
  /**
   * Only records whose content is public, where nobody reviewed the substance, and whose disclosure
   * block does not say a label was required — the sweep's population, and the case nobody thought of.
   */
  unlabelledPublicOnly?: boolean;
  limit?: number;
  offset?: number;
}

/** Filter for the hash lookup. `ownerGhii` widens a public-only read to include the caller's own. */
export interface AiProvenanceHashQuery {
  /** Restrict to records the caller owns, in ADDITION to every publicly linked one. Omit for public-only. */
  ownerGhii?: string;
  limit?: number;
}
