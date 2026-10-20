/**
 * @file src/storage/types/knowledge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The knowledge-package record types: a manifest, its entries, the links between them,
 *   the synthesis statement and who may read it.
 *
 *   PURE EXTRACTION from types/organisms-federation.ts on 2026-10-20, when that file reached 816
 *   lines and the 800-line limit refused it. The block moved unchanged, comments and all, and it was
 *   the one that moved because it is the only group in that file whose types reference nothing above
 *   them: `AiProvenanceLevel` was imported there for `KnowledgeSynthesisLevel` alone, so the import
 *   came too and the original file lost it. `storage/interface.ts` re-exports both modules, so every
 *   consumer reads these names from the same place it always did.
 * @structure KnowledgeContentType · KnowledgeSynthesisLevel · KnowledgeMaturity ·
 *   KnowledgeLinkRelation · KnowledgeReference · KnowledgeEntryRelation · KnowledgeEntryDescriptor ·
 *   KnowledgeLink · KnowledgeSynthesis · KnowledgeSharing · KnowledgeManifest
 * @usage import type { KnowledgeManifest } from '../storage/interface.js';
 * @version-history
 *   v1.0.0 — 2026-10-20 — Extracted from types/organisms-federation.ts (max-file-lines). The version
 *     history of these types up to this date is in that file's header.
 */
import type { AiProvenanceLevel } from '../../models/ai-provenance-schemas.js';

// ── Knowledge System types ──────────────────────────────────────────

export type KnowledgeContentType =
  | 'idea' | 'research' | 'plan' | 'dataset' | 'document'
  | 'tutorial' | 'collection' | 'article' | 'story' | 'fiction';

/** The four synthesis levels. Defined once, in the provenance record's frozen vocabulary — a
 *  knowledge package's `synthesis.level` and an AI provenance record's `level` are the SAME
 *  vocabulary, so they must not drift apart into two spellings (TARGET-058). */
export type KnowledgeSynthesisLevel = AiProvenanceLevel;
export type KnowledgeMaturity = 'draft' | 'review' | 'published';
export type KnowledgeLinkRelation = 'related-to' | 'extends' | 'derived-from' | 'contradicts' | 'supersedes' | 'references';

export interface KnowledgeReference {
  url: string;
  title: string;
  accessed: string;           // ISO 8601
  verified: boolean;
  note?: string;
}

export interface KnowledgeEntryRelation {
  key: string;                              // Target entry key within same package
  relation: KnowledgeLinkRelation;          // How entries relate
}

export interface KnowledgeEntryDescriptor {
  key: string;
  title: string;
  visibility: 'private' | 'owner' | 'group' | 'members' | `organism:${string}` | 'public';
  schema?: string;
  references?: KnowledgeReference[];        // Per-entry citations (independent knowledge unit)
  related_entries?: KnowledgeEntryRelation[]; // Intra-package relationships
}

export interface KnowledgeLink {
  target: string;
  relation: KnowledgeLinkRelation;
  description: string;
  linked_at: string;          // ISO 8601
}

export interface KnowledgeSynthesis {
  level: KnowledgeSynthesisLevel;
  description: string;
  model?: string;
}

export interface KnowledgeSharing {
  catalog_listed: boolean;
  allow_clone: boolean;
  /** Who reads an unlisted package: 'owner' (default), 'members' or 'organism:<id>'. Listed is public. */
  audience?: 'owner' | 'members' | `organism:${string}` | 'public';
  license?: string;
  /**
   * The pacing amount in morsels; always 0 and never charged. A morsel is pacing, not a price
   * (ruling decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa).
   */
  toll_morsels: number;
  /**
   * DEPRECATED name of toll_morsels, accepted on a write with the Deprecation headers and stored as
   * toll_morsels; refused from MORSEL_PRICE_NAMES_REMOVED_IN (services/toll-morsels-names.ts). A
   * manifest stored before 4.0.0 may still hold it, and the knowledge routes answer it as toll_morsels.
   */
  morsel_price?: number;
}

export interface KnowledgeManifest {
  type: 'knowledge-package';
  name: string;
  version: string;
  author: string;             // GHII of the package creator
  created: string;            // ISO 8601
  updated: string;            // ISO 8601
  content_type: KnowledgeContentType;
  tags: string[];
  language: string;           // ISO 639-1
  maturity: KnowledgeMaturity;
  synthesis: KnowledgeSynthesis;
  references: KnowledgeReference[];
  entries: KnowledgeEntryDescriptor[];
  links: KnowledgeLink[];
  sharing: KnowledgeSharing;
}
