/**
 * @file src/storage/types/commerce.ts
 * @description Memory, action/work/wallet, boards, disputes, files, marketplace, flags, and escrow record types. Extracted from src/storage/interface.ts to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-07-27 — WalletTransaction.initiatorGaii: `gaii` is the payer and can only be a human,
 *     so without a second column the ledger could not say whether a charge came from the person, an
 *     agent, or an app they once connected.
 *   v1.0.0 — 2026-07-13 — Extracted from src/storage/interface.ts (max-file-lines)
 */
import type { SemanticAnnotation } from './common.js';
export interface MemoryRecord {
  key: string;
  ownerGaii: string;    // the agent GAII that owns this memory
  value: unknown;
  // 'members'   = readable by any authenticated user of this node (NOT the shared anonymous identity).
  // 'workspace' = readable by members of the organism workspace named in `workspaceRef` (org/ws) —
  //               node-local (DMZ), never federated; the read is gated by canReadWorkspace().
  // Ordering low→high reach: private < owner < group < workspace < members < public.
  visibility: 'private' | 'owner' | 'group' | 'workspace' | 'members' | 'public';
  groupId?: string;
  /** For visibility 'workspace': a SPACE-SEPARATED list of one or more "<organismId>/<workspaceId>"
   *  bindings whose members may read this — a file/record shared into several workspaces is readable
   *  by members of ANY of them. */
  workspaceRef?: string;
  tags: string[];
  ttlHours: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  flagCount?: number;   // Phase 1.5 — moderation flag counter
  allowedOrigins?: string[];  // CORS — per-key origin restrictions (Phase 4)
  /** Opt-in version tracking: when true, the PREVIOUS value is archived to the memory_history table on
   *  overwrite (latest stays here, history queried via listMemoryHistory). Default/absent = false. */
  trackable?: boolean;
  /**
   * Archive flag (organism archive feature). When true the record is read-only and EXCLUDED from the
   * bulk read/search primitives (listMemory/listAllMemory/searchText/searchMemory/countMemory) by
   * default — so it drops out of every AI-facing material assembly — yet stays resolvable by key via
   * getMemory and findable via an explicit archive search (`archived: 'only'|'include'`). Default
   * /absent = false (active). See src/services/archive.ts.
   */
  archived?: boolean;
  /** ISO timestamp the record was archived (set with `archived`). */
  archivedAt?: string;
  /** Identity (GHII/GAII) that archived the record. */
  archivedBy?: string;
  /**
   * The "archive root" — the id/key of the thing whose archival flagged this record. For a directly
   * archived single record this is its own key; for cascade archival (a record-table, workspace, or
   * organism) it is that container's ref. Unarchiving a root restores ONLY records carrying that root
   * (smart restore): a record independently archived earlier keeps its own root and stays archived.
   */
  archivedRoot?: string;
  /**
   * The ATTACHED half of AI provenance (TARGET-058): the id of an `AiProvenanceRecordRow` describing
   * how this record's VALUE was produced. Absent means UNSTATED — never "a human wrote it".
   *
   * Write-through, deliberately NOT inherited on overwrite: a new value is new content, and carrying
   * the old id forward would make the record assert something about bytes that no longer exist. A
   * writer that still means it re-supplies the id.
   */
  aiProvenanceId?: string;
}

/**
 * How the memory read/search primitives treat archived rows.
 * - `exclude` (default): active rows only — the AI working set.
 * - `include`: active + archived together.
 * - `only`: archived rows only — backs "archive search".
 */
export type ArchiveFilter = 'exclude' | 'include' | 'only';

export interface ActionRecord {
  id: string;
  providerGaii: string;
  displayName: string;
  description: string;
  category?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  pricing: { baseMorsels: number; perUnit?: { unit: string; morselsPer1000: number } };
  estimatedTimeSeconds?: number;
  maxInputSizeBytes?: number;
  tags: string[];
  webhookUrl?: string;
  createdAt: string;
  updatedAt: string;
  semantic?: SemanticAnnotation;
  federate?: boolean;
}

export interface WorkRecord {
  trackingCode: string;
  status: string;
  actionId: string;
  providerGaii: string;
  requesterGaii: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  cost: { basePrice: number; networkFee: number; total: number; inEscrow: number };
  ttlExpiresAt: string;
  callbackUrl?: string;
  rating?: { score: number; comment?: string };
  createdAt: string;
  updatedAt: string;
}

export interface WalletTransaction {
  id: string;
  /** Whose BALANCE moved. Always a human's GHII — agents and apps hold no balance of their own. */
  gaii: string;
  type: string;
  amount: number;
  counterpartyGaii?: string;
  trackingCode?: string;
  /**
   * Who actually made the call, when that is not the human themselves: an agent's GAII, an
   * ecosystem app's GEAI, or the owner GHII an app grant presents.
   *
   * `gaii` answers who PAYS and can only ever be the owner, so without this the ledger cannot say
   * whether a charge came from the person, one of their agents, or an app they once connected —
   * and after the fact nobody can tell them. Absent when the owner called directly.
   */
  initiatorGaii?: string;
  timestamp: string;
}

export interface BoardRecord {
  id: string;
  name: string;
  description?: string;
  visibility: 'private' | 'shared' | 'public' | 'system';
  ownerGaii: string;
  allowedGaiis: string[];
  createdAt: string;
  semantic?: SemanticAnnotation;
  federate?: boolean;
}

export interface BoardPostRecord {
  id: string;
  boardId: string;
  authorGaii: string;
  title: string;
  body: string;
  category?: string;
  tags: string[];
  ttlExpiresAt?: string;
  reactions: Record<string, string[]>; // emoji -> gaiis
  replyTo?: string;
  createdAt: string;
  semantic?: SemanticAnnotation;  // Phase 0.7b
}

export interface DisputeRecord {
  id: string;
  trackingCode: string;
  status: 'open' | 'contested' | 'escalated' | 'resolved';
  openedBy: string;        // GAII
  reason: string;
  ruling?: { ruling: string; distribution: { toRequester: number; toProvider: number; burned: number }; reason?: string };
  createdAt: string;
  updatedAt: string;
}

export interface DisputeAuditEntry {
  sequence: number;
  event: string;
  actor: string;
  timestamp: string;
  data: Record<string, unknown>;
  hash: string;
  previousHash: string;
}

export interface MicroMemoryRecord {
  gaii: string;
  set: string;
  entries: Record<string, string>;
  visibility: 'private' | 'public_read' | 'shared_read' | 'shared_write' | 'public_write';
  accessCode?: string;    // required for shared_read / shared_write
  updatedAt: string;
}

export interface StorageFileRecord {
  key: string;
  ownerGaii: string;
  // Same tiers as MemoryRecord (files were lagging): 'members' = any authenticated node user;
  // 'workspace' = members of the organism workspace in `workspaceRef`. Both gated by the SAME
  // authorizeRead() core as memory, so a file authorizes identically to a memory record.
  visibility: 'private' | 'owner' | 'group' | 'workspace' | 'members' | 'public';
  groupId?: string;
  /** For visibility 'workspace': a SPACE-SEPARATED list of one or more "<organismId>/<workspaceId>"
   *  bindings whose members may read this file (a file shared into several workspaces is readable by
   *  members of ANY of them). */
  workspaceRef?: string;
  mimeType: string;
  size: number;
  data: Buffer;
  accessCode?: string;
  tags?: string[];
  createdAt: string;
  federate?: boolean;
}

export interface ChunkedUploadRecord {
  uploadId: string;
  ownerGaii: string;
  key: string;
  mimeType: string;
  visibility: 'private' | 'owner' | 'group' | 'public';
  chunkSize: number;
  totalChunks?: number;
  receivedChunks: Map<number, Buffer>;
  createdAt: string;
  expiresAt: string;   // 6 hours after creation
}

export interface BoardSubscriptionRecord {
  id: string;
  boardId: string;
  gaii: string;
  callbackUrl?: string;
  filters?: { categories?: string[]; tags?: string[] };
  createdAt: string;
}

export interface FlagRecord {
  id: string;
  targetType: 'memory' | 'board_post' | 'action' | 'agent';
  targetId: string;
  flaggedBy: string;
  reason: 'unreliable' | 'inappropriate' | 'illegal' | 'spam' | 'other';
  description?: string;
  status: 'active' | 'dismissed' | 'actioned';
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface FlagSummary {
  targetType: string;
  targetId: string;
  totalFlags: number;
  byReason: Record<string, number>;
  latestFlag: string;
  hidden?: boolean;  // Phase 2.4 — auto-hide when flag count >= threshold
}

export interface MatchRecord {
  id: string;
  profileA: string;       // GHII of suggestion recipient
  profileB: string;       // GHII of matched profile
  score: number;          // 0.0-1.0
  breakdown: {
    sharedInterests: string[];
    distanceKm: number | null;
    activityDays: number;
    sharedInterestsScore: number;
    distanceScore: number;
    activityScore: number;
    compatibilityScore: number;
  };
  status: 'suggested' | 'notified' | 'accepted' | 'dismissed' | 'expired';
  notifiedAt: string | null;
  respondedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

// Phase 2.6 — Marketplace (DEPRECATED: listings now live in extension memory via marketplace-behaviors extension)
/** @deprecated Use marketplace-behaviors extension instead */
export interface ListingRecord {
  id: string;
  ownerName: string;        // Seller's owner name
  sellerGhii: string;       // Seller's GHII
  title: string;
  description: string;
  category: 'palvelut' | 'tuotteet' | 'data' | 'osaaminen' | 'muu';
  priceMorsels: number;
  condition?: 'new' | 'used' | 'digital';
  availability?: 'immediate' | 'on_request' | 'scheduled';
  location?: { city?: string; area?: string };
  tags?: string[];
  images?: string[];
  status: 'active' | 'sold' | 'expired' | 'hidden' | 'delisted';
  memoryKey: string;        // marketplace.{owner}.listing.{id}
  flagCount: number;
  createdAt: string;
  updatedAt: string;
  semantic?: Record<string, unknown>;
}

/** @deprecated Use marketplace-behaviors extension instead */
export interface PurchaseRecord {
  id: string;
  listingId: string;
  buyerOwner: string;
  sellerOwner: string;
  priceMorsels: number;
  transactionFeeMorsels: number;
  totalCostMorsels: number;
  status: 'pending_delivery' | 'delivered' | 'disputed' | 'completed' | 'cancelled';
  rating?: { score: number; comment?: string };
  trackingCode: string;
  createdAt: string;
  completedAt?: string;
}

// Phase 2.4 — Appeals (Advanced Moderation)
export interface AppealRecord {
  id: string;
  flagId: string;
  appealedBy: string;       // Content owner's GAII/GHII
  reason: string;
  status: 'pending' | 'upheld' | 'overturned';
  reviewedBy?: string;
  reviewNote?: string;
  createdAt: string;
  reviewedAt?: string;
}

// ── Generic Escrow ─────────────────────────────────────────────────

export interface EscrowHoldRecord {
  holdId: string;
  fromGaii: string;
  amount: number;
  reason: string;
  status: 'held' | 'released' | 'disputed' | 'refunded';
  extensionName: string;
  createdAt: string;
  releasedAt?: string;
  releasedTo?: string;
}
