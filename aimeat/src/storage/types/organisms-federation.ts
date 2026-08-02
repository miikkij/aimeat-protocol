/**
 * @file src/storage/types/organisms-federation.ts
 * @description Organism, federation/peering, notification, extension, scheduler, cortex, and knowledge record types. Extracted from src/storage/interface.ts to satisfy max-file-lines.
 * @version-history
 *   v1.2.0 — 2026-08-01 — KnowledgeSynthesisLevel now aliases AiProvenanceLevel rather than
 *     re-spelling the four strings (TARGET-058: one definition of the vocabulary).
 *   v1.1.0 — 2026-07-25 — Extension action commercial gains `provenance` + `odps` (ODPS v4.0 adoption,
 *     TARGET-045 §4): the source of a projected EXCHANGE listing carries its own descriptor data.
 *   v1.0.0 — 2026-07-13 — Extracted from src/storage/interface.ts (max-file-lines)
 */
import type { Provenance, OdpsExtras } from '../../models/odps-schemas.js';
import type { AiProvenanceLevel } from '../../models/ai-provenance-schemas.js';

export interface PeeringRequestRecord {
  id: string;
  fromNodeUrl: string;
  fromNodeId?: string;
  toNodeId?: string;
  targetUrl?: string;
  publicKey?: string;
  message?: string;
  status: 'pending' | 'approved' | 'rejected' | 'auto_approved';
  createdAt: string;
  updatedAt: string;
}

// Phase 2.2 — Organisms (groups/communities)
export interface OrganismRecord {
  id: string;
  name: string;
  description: string;
  type: 'community' | 'team' | 'club' | 'cooperative' | 'project';
  location?: {
    city?: string;
    area?: string;
    country?: string;
    geo?: [number, number];
  };
  interests: string[];
  creatorGhii: string;
  admins: string[];
  members: string[];
  agentGaiis: string[];
  boardId: string;
  joinPolicy: 'open' | 'approval_required' | 'invite_only';
  maxMembers: number;
  visibility: 'public' | 'listed' | 'private';
  /** Who may see the member ROSTER (the members[]/agentGaiis fields + the /members listing):
   *  'public' = anyone incl. anonymous (deliberate opt-in), 'authenticated' = any signed-in caller
   *  (the DEFAULT when unset — anonymous internet never sees rosters), 'members' = active members,
   *  'admins' = creator/admins only. Creator + admins stay visible regardless (accountability),
   *  and operators/admins always see the full roster. Presentation-layer privacy: content
   *  ATTRIBUTION (comments, versions, activity) is a separate concern and unaffected. */
  memberVisibility?: 'public' | 'authenticated' | 'members' | 'admins';
  moderationConfig: {
    flagsEnabled: boolean;
    autoHideThreshold: number;
    appealsEnabled: boolean;
  };
  memoryNamespace: string;
  semantic?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** Archive flag (organism archive feature). When true the organism is read-only and its content is
   *  excluded from AI-facing materials by default; its workspaces/records are cascade-archived. */
  archived?: boolean;
  /** ISO timestamp the organism was archived. */
  archivedAt?: string;
  /** Identity (GHII/GAII) that archived the organism. */
  archivedBy?: string;
}

export interface OrganismMembershipRecord {
  id: string;
  organismId: string;
  ghii: string;
  role: 'creator' | 'admin' | 'member';
  /**
   * - `active`  : a full member
   * - `pending` : legacy/reserved (join requests are tracked separately as JoinRequestRecord)
   * - `invited` : creator/admin invited this owner; awaiting their accept/decline (invite_only flow)
   * - `banned`  : removed-and-blocked; cannot re-join or be re-invited until the ban is lifted
   */
  status: 'active' | 'pending' | 'invited' | 'banned';
  joinedAt: string;
  invitedBy?: string;
  /** Workspace grants selected at invite time (status `invited` only). Applied via
   *  `applyInvitationWorkspaceGrants` when the invitee accepts, then cleared. */
  invitedWorkspaces?: InvitedWorkspaceGrant[];
}

/** A per-workspace role chosen at invite/direct-add time (same shape as the email-invite grants). */
export interface InvitedWorkspaceGrant {
  ws: string;
  role: 'viewer' | 'contributor';
}

export interface JoinRequestRecord {
  id: string;
  organismId: string;
  ghii: string;
  message?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  createdAt: string;
  reviewedAt?: string;
}

/**
 * Phase 4 — Gate primitive. A durable human-approval checkpoint for a consequential action an
 * agent (or the flow) wants to take inside an organism workspace. Created when a gate's
 * condition fires (or an `alwaysGate` action is requested); resolved by an approver. Every
 * resolution writes a decision-log entry + audit. `arguments` holds the proposed change
 * (e.g. the data model, the email payload, the plan diff) so the approver can view/edit it.
 */
export interface PendingApprovalRecord {
  id: string;
  organismId: string;
  flowGateId?: string;        // gate id from manifest flow.gates[] (omitted for ad-hoc gates)
  stageId?: string;           // the guarded flow stage id, if any
  actor: string;              // GAII/identity that requested the action
  action: string;             // e.g. 'flow:advance' | 'data-model-change' | 'deliverable:accept' | 'egress' | 'spend'
  arguments?: Record<string, unknown>;  // the proposed change payload (viewed/edited by the approver)
  risk: 'low' | 'medium' | 'high';
  approverRole: 'owner' | 'admin' | 'member';
  prompt?: string;            // human-facing question
  status: 'pending' | 'approved' | 'rejected' | 'edited';
  decidedBy?: string;         // owner name / GHII that resolved it
  decidedAt?: string;
  resolutionNote?: string;
  deadline?: string;          // ISO; durable pause — on expiry the expiry job escalates it
  createdAt: string;
  updatedAt: string;
}

// Phase 3.1 — Push Subscriptions (PWA)
export interface PushSubscriptionRecord {
  ownerName: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  createdAt: string;
  lastUsedAt: string;
}

// Phase 3.2 — Notification Templates (editable, per-locale)
export interface NotificationTemplateRecord {
  id: string;              // "web_push_mailbox", "email_mailbox"
  locale: string;          // "en", "fi"
  fields: {
    title?: string;        // web push title (null for email)
    body: string;          // web push body or email body
    subject?: string;      // email subject (null for web push)
  };
  placeholders: string[];  // informational: ["{count}", "{type}", "{nodeId}", "{age}"]
  updatedAt: string;
  updatedBy: string;       // operator owner name
}

// Phase 3.4 — Genesis Peering (Cross-Federation)
export interface GenesisPeerRecord {
  id: string;
  genesisNodeId: string;
  genesisUrl: string;
  publicKey: string;
  status: 'pending' | 'active' | 'suspended';
  lastSyncAt: string;
  catalogueHash: string;
  createdAt: string;
  updatedAt: string;
}

// Federation Peers — persisted active peer connections
export interface FederationPeerRecord {
  nodeId: string;
  url: string;
  publicKey: string;
  status: string;
  addedAt: string;
  lastSeen: string;
  shareCatalogue: boolean;
  replicateMemory: boolean;
  allowRouting: boolean;
  peerMode: 'federation' | 'private';
  allowFederatedAuth: boolean;
  federationAuthScopes: string[];
  /** Trust tier: 'genesis' | 'member' | 'visiting'. Absent (legacy rows) → 'member'. */
  tier?: 'genesis' | 'member' | 'visiting';
  /** Availability label from heartbeat uptime (Phase B): 'temporary' | 'permanent' | 'unknown'. */
  availability?: 'temporary' | 'permanent' | 'unknown' | null;
  /** Optional expiry for time-limited visiting peers (Phase B). */
  expiresAt?: string | null;
  /** Lifetime successful heartbeats (Phase B uptime). */
  heartbeatOk?: number;
  /** Lifetime attempted heartbeats (Phase B uptime). */
  heartbeatTotal?: number;
  /** JSON ring of daily heartbeat buckets `{ days: [{ d, ok, total }] }` over the availability window. */
  availabilityWindow?: string | null;
  /** Computed availability % over the window (denormalized for cheap reads). */
  availabilityPct?: number | null;
  /** Peer's AIMEAT software version (from heartbeat). */
  softwareVersion?: string | null;
  /** Hash of the peer's node-card, for federation-book change detection. */
  nodeCardHash?: string | null;
}

// Phase B.1 — Replication Queue (federation data sync)
export interface ReplicationQueueEntry {
  id: string;
  type: 'catalogue_sync' | 'memory_replicate' | 'trust_advisory';
  targetPeers: string[];    // peer IDs to send to
  payload: unknown;          // serialized sync payload
  createdAt: string;         // ISO timestamp
  attempts: number;
  lastAttemptAt: string | null;
  status: 'pending' | 'sent' | 'failed';
}

// Phase 3.4 — Organism Reputation
export interface OrganismReputationRecord {
  organismId: string;
  score: number;
  breakdown: {
    memberScore: number;
    activityScore: number;
    trustScore: number;
    ageScore: number;
    flagScore: number;
  };
  calculatedAt: string;
}

// Realtime P2P rooms
export interface RealtimeRoomRecord {
  id: string;
  appType: string;
  name: string;
  createdBy: string;
  maxPeers: number;
  isPublic: boolean;
  tags: string[];
  peerCount: number;
  createdAt: string;
  lastActivityAt: string;
}

// ── Node Extensions (Sandboxed) ────────────────────────────────────

export interface ExtensionRecord {
  name: string;                        // Unique name: "marketplace-behaviors"
  version: string;
  description: string;
  author: string;
  status: 'inactive' | 'active';
  requiredApis: string[];              // ['wallet', 'memory', 'consent', 'trust']
  actions: Array<{
    id: string;
    method: string;
    path: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    scriptContent: string;
    /**
     * Anti-abuse toll in morsels, per non-owner call — ALWAYS a burn (debit caller, never credit
     * owner). Worthless friction that caps runaway/accidental use. Independent of `commercial`;
     * may sit on top of any payment mode. Absent/0 = no toll. (Design: notes doc-r6tyr3o, M1.)
     */
    tollMorsels?: number;
    /**
     * Priced raw call. Present => a non-owner caller must pay the owner per call (owner is always
     * free). Absent => free (the script's `public_access` decides who may call). Invariant C1:
     * `payMorsels > 0` OR `payMoney` set. `payMorsels` is the ONLY place morsels count as REVENUE
     * (credited to the owner); everywhere else morsels are burned (M1).
     */
    commercial?: {
      payMorsels: number;                                    // morsels credited to owner (0 = money-only)
      payMoney?: { amount: number; currency: string };       // 6-decimal micro-units, PSP-settled to owner
      /**
       * Optional EXCHANGE pricing PLANS the provider offers beyond the base per-call price (TARGET-045
       * Phase B). A consumer accepts one by `plan_id`; amounts are in the action's unit (morsels when
       * payMorsels>0, else payMoney micros). Absent => only the base per-call plan is available.
       *   - bundle:       { id, model:'bundle', blockSize, blockPrice }               — N calls for a price
       *   - subscription: { id, model:'subscription', periodSeconds, periodPrice,     — flat fee per period,
       *                     callsPerWindow, windowSeconds }                             rate-limited N/window
       */
      plans?: Array<
        | { id: string; model: 'bundle'; blockSize: number; blockPrice: number }
        | { id: string; model: 'subscription'; periodSeconds: number; periodPrice: number; callsPerWindow: number; windowSeconds: number }
      >;
      /**
       * Additional money prices, one per currency (TARGET-050) — the action sells in EUR *and* USD.
       * `payMoney` stays the primary (all existing readers unchanged); this is the full set the
       * EXCHANGE projection lists from.
       */
      pricesMoney?: Array<{ amount: number; currency: string }>;
      /**
       * List this action publicly on EXCHANGE (TARGET-050). The extension record is the SOURCE OF TRUTH
       * for its marketplace listing: flag on + a price → projected onto the market, price/labels track
       * this action; flag off → the projected listing is delisted. CONTRACTS are never affected.
       */
      exchange?: boolean;
      /** Usage licence surfaced on the projected offering (required to list — the legibility gate). */
      usageTerms?: { derivatives?: boolean; resale?: boolean; attribution?: boolean; note?: string };
      /** Provenance attestation carried onto the projected offering + its ODPS v4.0 document. */
      provenance?: Provenance;
      /** ODPS fields the node cannot derive (value proposition, SLA/quality commitments, data holder…). */
      odps?: OdpsExtras;
    };
  }>;
  config: Record<string, unknown>;
  limits: {
    memoryMb: number;
    timeoutMs: number;
    maxApiCalls: number;
  };
  federation: {
    advertise: boolean;
    capabilities: string[];
  };
  instances?: {
    supported: boolean;
    configSchema?: Record<string, unknown>;  // JSON Schema for per-instance config
  };
  installedBy: string;
  installedAt: string;
  activatedAt?: string;
}

// ── Scheduled Jobs ────────────────────────────────────────────────

/**
 * A single budget/run guard attached to a schedule. Extensible: new guard
 * `type`s only need a registry entry in services/schedule-constraints.ts plus a
 * UI toggle — no schema change (constraints are stored as a JSON array).
 * `enabled` defaults to false so guards are strictly opt-in.
 */
export interface ScheduleConstraint {
  type: string;                          // e.g. 'max_runs' | 'daily_limit'
  enabled: boolean;                      // opt-in; off by default
  params: Record<string, unknown>;       // e.g. { limit: 7 }
  state?: Record<string, unknown>;       // accumulator state (e.g. spent today)
}

export interface ScheduledJobRecord {
  id: string;
  name: string;
  /**
   * 'core'/'extension' are the original server-run kinds. 'ai' runs a
   * server-side OpenRouter completion (zero agent involvement); 'agent_task'
   * materialises an AgentTaskRecord into the target agent's queue on each fire.
   * 'eco-capability' invokes a connected ecosystem app's (GEAI) capability over
   * the connect-tunnel on each fire — its `input` is
   * `{ app: string; capability_id: string; input?: Record<string,unknown> }`.
   * 'connections-publish' posts to one of the owner's OWN connected accounts —
   * its `input` is `{ connection_id, caption?, storage_key?, params?, ref? }`.
   * A one-shot ("post this on Tuesday at 09:00") is this kind plus a
   * max_runs:1 constraint, which the scheduler already auto-disables after the
   * fire; there is deliberately no second queue table beside this one.
   */
  type: 'extension' | 'core' | 'ai' | 'agent_task' | 'workflow' | 'eco-capability' | 'connections-publish';
  extensionName?: string;
  instanceId?: string;
  actionId?: string;
  coreHandler?: string;
  cron: string;
  enabled: boolean;
  /**
   * Kind-specific config (round-tripped as JSON):
   *  - extension: scheduler input passed to the action (existing behaviour)
   *  - ai:        { inputKeys: string[]; inputNamespaces?: string[]; prompt: string;
   *                 systemPrompt?: string; model?: string; outputKey?: string;
   *                 outputVisibility?: 'private'|'owner'|'public' }
   *  - agent_task:{ taskTemplate: { title; description; scope?; rules?; verification?; resources? } }
   */
  input?: Record<string, unknown>;
  lastRunAt?: string;
  lastRunResult?: 'success' | 'error' | 'skipped';
  lastRunError?: string;
  lastRunDurationMs?: number;
  nextRunAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // ── Agent-scheduler additions (all optional / additive) ──
  ownerScope?: string;       // GHII owner — scopes the profile scheduler + authz
  agentName?: string;        // target/associated agent (agent_task; optional otherwise)
  agentGaii?: string;        // resolved GAII of the target agent
  createdByAgent?: boolean;  // true = created via MCP by an agent
  displayName?: string;      // human label ("Morning news translation")
  description?: string;      // human description
  purpose?: string;          // why this runs (shown in the master scheduler)
  timezone?: string;         // IANA tz, e.g. "Europe/Helsinki" (DST-correct via croner)
  constraints?: ScheduleConstraint[];  // budget/run guards (opt-in)
  runCount?: number;         // lifetime successful fires (constraint state)
}

// ── Execution Log (Scheduler Run History) ────────────────────────────

export interface ExecutionLogEntry {
  id: string;
  jobId: string;
  jobName: string;
  /** Mirrors ScheduledJobRecord['type'] — a run log that cannot name a kind cannot explain it. */
  type: 'extension' | 'core' | 'ai' | 'agent_task' | 'workflow' | 'eco-capability' | 'connections-publish';
  extensionName?: string;
  actionId?: string;
  trigger: 'cron' | 'manual' | 'activate';
  result: 'success' | 'error' | 'skipped';
  errorMessage?: string;
  durationMs: number;
  memoryReads: string[];   // memory keys read during execution
  memoryWrites: string[];  // memory keys written during execution
  taskId?: string;         // agent_task fires: the spawned AgentTaskRecord id
  createdAt: string;
}

// ── Extension Instances ──────────────────────────────────────────────

export interface ExtensionInstanceRecord {
  id: string;
  extensionName: string;
  config: Record<string, unknown>;
  status: 'active' | 'paused';
  /** Per-locale translation overrides: { "en": { "mkt.cat.foo": "Foo" }, "fi": { ... } } */
  translations?: Record<string, Record<string, string>>;
  createdBy: string;
  createdByAgent?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Cortex Extensions (Manifest-based) ────────────────────────────

export interface CortexSchemaComponent {
  type: 'schema';
  name: string;
  key_pattern: string;
  apply_to: 'prefix' | 'exact';
  schema: Record<string, unknown>;
}

export interface CortexPromptComponent {
  type: 'prompt';
  name: string;
  content: string;
  variables?: string[];
}

export interface CortexActionComponent {
  type: 'action';
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface CortexBoardTemplateComponent {
  type: 'board-template';
  name: string;
  title: string;
  description: string;
  visibility: 'public' | 'private' | 'shared';
  seed_posts?: Array<{ title: string; body: string }>;
}

export interface CortexOntologyComponent {
  type: 'ontology';
  name: string;
  description: string;
  concepts: Record<string, {
    label: Record<string, string>;
    properties?: string[];
    broader?: string;
    related_to?: string;
    values?: string[];
  }>;
}

export interface CortexSeedDataComponent {
  type: 'seed-data';
  entries: Array<{ key: string; value: unknown }>;
}

export interface CortexLibComponent {
  type: 'lib';
  name: string;
  filename: string;
  exports: string[];
  api_surface: string;
}

export type CortexComponent =
  | CortexSchemaComponent
  | CortexPromptComponent
  | CortexActionComponent
  | CortexBoardTemplateComponent
  | CortexOntologyComponent
  | CortexSeedDataComponent
  | CortexLibComponent;

export interface CortexActivationArtifacts {
  schemaKeys: string[];
  promptKeys: string[];
  actionIds: string[];
  boardIds: string[];
  seedDataKeys: string[];
  ontologyKeys: string[];
  libFiles: string[];
}

export interface CortexExtensionRecord {
  name: string;
  namespace: string;
  shortName: string;
  apiVersion: string;
  version: string;
  description: string;
  author: string;
  license?: string;
  tags: string[];
  labels: Record<string, string>;
  aimeatCompat?: string;
  status: 'inactive' | 'active';
  visibility: 'private' | 'public';
  installedAt: string;
  activatedAt?: string;
  installedBy: string;
  manifest: string;  // raw YAML string
  components: CortexComponent[];
  activationArtifacts: CortexActivationArtifacts;
}

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
  visibility: 'private' | 'owner' | 'group' | 'public';
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
  license?: string;
  morsel_price: number;       // 0 = free
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

export interface MemoryLinkRecord {
  source: string;             // Source memory key
  target: string;             // Target memory key
  relation: KnowledgeLinkRelation;
  description: string;
  linked_at: string;          // ISO 8601
  linked_by: string;          // GHII of who created the link
}

export type OperatorReviewReason =
  | 'routine_review' | 'legal_compliance' | 'community_report'
  | 'content_quality' | 'storage_issue' | 'custom';

export type OperatorReviewAction = 'approve' | 'flag' | 'delist' | 'restrict' | 'note';

export interface OperatorReviewRecord {
  id: string;                 // UUID
  packageId: string;          // The packages/{uuid}/manifest key
  operatorGaii: string;       // Operator who reviewed
  reason: OperatorReviewReason;
  customText?: string;        // For 'custom' reason
  action: OperatorReviewAction;
  timestamp: string;          // ISO 8601
}
