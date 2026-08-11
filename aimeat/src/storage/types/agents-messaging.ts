/**
 * @file src/storage/types/agents-messaging.ts
 * @description Capability, agent-task, directive, sharing, usage-ledger, and messaging record types. Extracted from src/storage/interface.ts to satisfy max-file-lines.
 * @version-history
 *   v1.2.0 — 2026-08-01 — The Capability Layer moved to ./capabilities.ts (max-file-lines) and is
 *     re-exported from here, so nothing that imported it has to change. Pure extraction — a
 *     capability is not a message, and it was the block least tied to this file's name.
 *   v1.0.0 — 2026-07-13 — Extracted from src/storage/interface.ts (max-file-lines)
 */
// ── Capability Layer — extracted to ./capabilities.ts, re-exported here ──
export * from './capabilities.js';

// ── Agent Tasks (Phase 1) ──

export interface AgentTaskScope {
  name: string;
  value: string;
  type: 'text' | 'url' | 'memory_key' | 'number' | 'cron';
  description?: string;
}

export interface AgentTaskTodo {
  id: string;
  order: number;
  title: string;
  description: string;
  environment: 'aimeat' | 'agent';
  environmentReason?: string;
  verification: string;
  estimateMinutes?: number;
  // 'outdated' (since 1.14.5): the todo was part of a previous propose_todos
  // proposal that the owner rejected via /request-changes. The todo is kept
  // for history (so the agent and owner can see what was proposed before)
  // but is not part of the current active plan.
  status: 'pending' | 'active' | 'done' | 'failed' | 'skipped' | 'outdated';
  completedAt?: string;
}

/**
 * Context dimension a task rating is scored against. Fixed-but-extensible enum
 * (vs free-text) so ratings stay comparable across agents — no ad-hoc
 * fragmentation. Maps onto the crew "dimension" concept. The factual family
 * (factual/research/code/summarization) must be source-grounded — see
 * RATING_CONTEXTS_REQUIRING_GROUNDING and the rate endpoint.
 */
export type RatingContext =
  | 'factual' | 'creative' | 'code' | 'planning'
  | 'summarization' | 'research' | 'communication' | 'other';

/** Contexts whose ratings must be checked against sources/inputs, not output-alone. */
export const RATING_CONTEXTS_REQUIRING_GROUNDING: ReadonlySet<RatingContext> =
  new Set<RatingContext>(['factual', 'research', 'code', 'summarization']);

/**
 * Who produced a rating. Used to weight human judgement higher and to mark
 * ungrounded agent ratings as uncertain in the rollup. A source-grounded-agent
 * checked the deliverable against its inputs/spec (e.g. crew verify=factcheck).
 */
export type RaterType = 'human-owner' | 'agent' | 'source-grounded-agent';

/**
 * Peer/owner review attached to a completed task. Tamper integrity comes from
 * the recompute endpoint (anyone can recompute rollups from the tasks), not from
 * where this is stored.
 */
export interface AgentTaskRating {
  stars: number;            // 1–5
  context: RatingContext;
  comment?: string;
  ratedBy: string;          // GHII (owner) or GAII (agent) of the rater
  raterType: RaterType;
  sourceGrounded: boolean;  // was the rating checked against inputs/sources?
  unsupported?: number;     // optional: # unsupported claims (from factcheck)
  evaluatedModel?: string;  // model that PRODUCED the deliverable (baseline stamp)
  // Optional free-form evaluation context for later slicing (e.g. temperature,
  // top_p, max_tokens, tokensIn/Out, cost). Stored as-is, not aggregated yet —
  // the schema stays fixed while this side-channel grows. Capped on write.
  metadata?: Record<string, unknown>;
  ratedAt: string;
}

/**
 * One file attached to a task. `ref` is the canonical "<ownerGaii>/<key>" reference (see
 * services/file-refs.ts) — the same form ctx.files.read and the DM attachment view use.
 */
export interface AgentTaskFileRef {
  ref: string;
  mime: string;
  size: number;
  name?: string;
}

/**
 * The task statuses that count as an OPEN commission: the work is queued, being planned, running, or
 * paused. Used by the one-live-commission guard (the partial unique index on agent_tasks.dedupeKey
 * covers exactly these, and findLiveTaskByDedupeKey filters by them). 'stalled' is deliberately NOT
 * here — an agent that went quiet must not block the owner from ordering the job again.
 */
export const LIVE_TASK_STATUSES = ['draft', 'queued', 'revision_requested', 'active', 'paused'] as const;

export interface AgentTaskRecord {
  id: string;
  agentGaii: string;
  ownerGaii: string;
  title: string;
  description: string;
  scope: AgentTaskScope[];
  rules: string[];
  verification: {
    userExpects: string;
    technicalChecks: string[];
  };
  resources?: {
    knowledgePackages?: string[];
    memoryKeys?: string[];
    memoryPrefixes?: string[];
    /**
     * FILES the agent needs in order to do the task — an invoice PDF, a form, a dataset. Each entry is
     * a reference to a stored file, never its bytes; the agent turns one into a presigned URL through
     * aimeat_storage_download / GET /v1/pub. mime + size are filled SERVER-SIDE from the stored file at
     * create time (a client-supplied size or type is not trusted), and the read is authorized as the
     * READING agent every time — assigning a task grants no bytes by itself. Rides in the existing
     * `resources` JSON column, so both storage backends carry it without a migration.
     */
    files?: AgentTaskFileRef[];
  };
  todos: AgentTaskTodo[];
  // 'revision_requested' (since 1.14.5): the owner saw the agent's proposed
  // todos and asked for a different plan via POST /tasks/:id/request-changes.
  // The agent should read the latest 'revision_requested' event for the
  // owner's message, then call aimeat_task_propose_todos again. Old todos are
  // kept marked 'outdated' for context.
  status: 'draft' | 'queued' | 'revision_requested' | 'active' | 'paused' | 'stalled' | 'done' | 'failed';
  /**
   * Commission fingerprint — the server-side half of the "one click, one run" guard. Set by
   * POST /v1/agents/:name/tasks from the caller's `idempotency_key` or, failing that, derived from
   * agent + title + description. A partial UNIQUE index over (agentGaii, dedupeKey) covering only
   * LIVE statuses makes a second identical commission impossible while the first is still open —
   * the browser guard cannot see across a reload or a second tab, this can. Once the task reaches
   * done/failed/stalled it drops out of the index and the same job is commissionable again.
   */
  dedupeKey?: string;
  parentTaskId?: string;
  workTrackingCode?: string;
  telemetry?: {
    aiCalls?: number;
    tokensIn?: number;
    tokensOut?: number;
    durationSeconds?: number;
  };
  lastEventAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  // Memory key under the agent's namespace where the task's deliverable was
  // published (set by the agent on /complete). The owner UI links to it; if the
  // entry no longer exists, the UI shows that it's gone.
  deliverableKey?: string;
  // Peer/owner review of this task's deliverable (set via POST /tasks/:id/rate).
  // Feeds the per-context quality rollup computed by GET /agents/:name/statistics.
  rating?: AgentTaskRating;
  // Triage bucket for the Tasks tab (set via PATCH /tasks/:id/triage):
  //   'kept'     -> owner promoted it to the Keep tab; never auto-archived
  //   'archived' -> owner archived it (or it auto-fell when older than the window)
  //   undefined  -> default: shown in Recent, auto-archives by age if enabled
  triage?: 'kept' | 'archived';
  // Provenance + routing when this task was materialised by an ecosystem-app
  // automation recipe (features B5/B6). Tells the agent WHERE to write its report
  // (organism) and carries the downstream toggles the completion hook reads
  // (email the owner, gate behind approval). Absent for normal/scheduled tasks.
  automation?: {
    recipeId: string;
    app: string;
    organism?: string | null;
    email?: boolean;
    requireApproval?: boolean;
  };
}

export interface AgentTaskEventRecord {
  id: string;
  taskId: string;
  // 'revision_requested' (since 1.14.5): logged when the owner sends a
  // change-request message about a proposed todo list. The `message` field
  // is the owner's free-text request; the `details` field stores the count
  // of todos that were transitioned to 'outdated' by the request.
  // 'rating' (Quality tab): logged when a task's deliverable is reviewed via
  // POST /tasks/:id/rate. `details` carries { stars, context, raterType,
  // sourceGrounded }.
  type: 'started' | 'progress' | 'todo_completed' | 'todo_failed' |
        'memory_write' | 'extension_install' | 'app_publish' |
        'verification' | 'completed' | 'failed' | 'message' |
        'revision_requested' | 'rating';
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

// ── Agent Directives (Phase 1) ──

export interface DirectiveRule {
  id: string;
  description: string;
  details?: string;
}

export interface DirectiveMemoryArea {
  keyPrefix: string;
  description: string;
  schema?: Record<string, unknown>;
  csmId?: string;
}

export interface DirectiveResource {
  type: 'knowledge_package' | 'memory_key';
  reference: string;
  description: string;
}

export interface BudgetLimits {
  maxTokensPerTask?: number;
  maxTokensPerDay?: number;
  maxTasksPerDay?: number;
  alertThreshold?: number;
}

export interface AgentDirectivesRecord {
  agentGaii: string;
  purpose: string;
  rules: DirectiveRule[];
  memoryAreas: DirectiveMemoryArea[];
  resources: DirectiveResource[];
  budgetLimits?: BudgetLimits;
  updatedAt: string;
}

export interface OwnerAgentDefaults {
  ownerGaii: string;
  rules: DirectiveRule[];
  defaultTokenBudget?: number;
  defaultMemoryAreas?: DirectiveMemoryArea[];
  updatedAt: string;
}

// ── Sharing Groups (Phase 1) ──

export interface SharingGroupMember {
  identifier: string;
  identifierType: 'gaii' | 'ghii';
  permissions: {
    read: boolean;
    write: boolean;
  };
  addedAt: string;
  addedBy: string;
}

export interface SharingGroupRecord {
  id: string;
  name: string;
  description?: string;
  ownerGaii: string;
  members: SharingGroupMember[];
  defaultPermissions: {
    read: boolean;
    write: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

// ── Agent LLM Usage Ledger (LEDGER / TARGET-016) ──

/**
 * One append-only usage event per agent LLM call. This is the ledger's source of
 * truth — daily aggregates (AgentUsageDailyRecord) are derived from these and can be
 * rebuilt. Retained for billing audit (TARGET-019), so writes are reliable, not
 * best-effort like the telemetry-buffer counters.
 *
 * Cost is `null` (not 0) when no price was available — a missing price stays visible
 * and is never guessed (see llm-pricing.ts). Context fields (organism/workspace/
 * capability) are in the schema from v1 but only filled once TARGET-018 wires context
 * through the run — nullable to avoid a later migration.
 */
export interface AgentUsageEvent {
  id: string;
  /** ISO timestamp the call was recorded. */
  ts: string;
  /** Who consumed — full GAII (or GHII for owner-direct calls). */
  agentGaii: string;
  /** Whose account pays (budget/billing key) — filled from v1 (TARGET-017/019). */
  ownerGhii: string;
  /** Run/task id, ties the call back to a deliverable (born_from chain). */
  runId?: string;
  model: string;
  /** anthropic | openai | openrouter | local | ... */
  provider: string;
  promptTokens: number;
  completionTokens: number;
  /** Locked at record time; null = unpriced (never coerced to 0). */
  costUsd: number | null;
  /** Which price version produced costUsd (e.g. `provider:openrouter`, `poi003@2026-07-10`, `local`). */
  priceRef: string | null;
  /** Ingest source: crewaimeat | ai-complete | ... */
  source: string;
  /** self-host (owner's own key, not billed) vs hosted (node key, billed) — TARGET-019. */
  apiKeyScope: 'own' | 'node';
  /** Context — filled from TARGET-018. */
  organismId?: string;
  workspaceId?: string;
  capabilityId?: string;
  /**
   * The AI provenance record this spend PRODUCED (TARGET-058), when there is one. Optional, so no
   * existing ingest path changes. It makes "what did this money buy?" answerable in one join, and
   * it is the only link between the two ledgers — cost stays out of the provenance record (that is
   * this table's job) and prompt text stays out of it too (that is this table's job as well).
   */
  provenanceId?: string;
  /** For capability calls (TARGET-018 double-entry): the GHII that INVOKED the capability
   *  (the consumer). The producer is agentGaii/ownerGhii above. Lets the producer see who
   *  called each capability and what the real compute cost, alongside the morsel escrow. */
  consumerGhii?: string;
}

/**
 * Daily rollup of usage, upsert-incremented per (date × agent × owner × keyscope ×
 * model × provider × organism × workspace). Context dims are `''` (not null) when
 * unattributed so the composite key stays NULL-free for ON CONFLICT upsert.
 */
export interface AgentUsageDailyRecord {
  /** UTC date YYYY-MM-DD. */
  date: string;
  agentGaii: string;
  ownerGhii: string;
  apiKeyScope: string;
  model: string;
  provider: string;
  /** '' = unattributed (filled from TARGET-018). */
  organismId: string;
  workspaceId: string;
  promptTokens: number;
  completionTokens: number;
  /** Sum of priced calls only. */
  costUsd: number;
  calls: number;
  /** Calls whose costUsd was null (unpriced) — keeps "missing price" visible. */
  unpricedCalls: number;
}

/** Filter for reading daily usage aggregates. Always owner-scoped. */
export interface UsageDailyFilter {
  ownerGhii: string;
  agentGaii?: string;
  organismId?: string;
  workspaceId?: string;
  /** Inclusive YYYY-MM-DD bounds. */
  from?: string;
  to?: string;
}

/** Filter for reading raw usage events (per-run drill-down). Always owner-scoped. */
export interface UsageEventFilter {
  ownerGhii: string;
  agentGaii?: string;
  runId?: string;
  /** Only events carrying a capabilityId (TARGET-018 capability view). */
  hasCapability?: boolean;
  capabilityId?: string;
  /** Inclusive ISO bounds. */
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Filter for the OPERATOR cross-owner daily aggregate — deliberately NOT owner-scoped.
 * The route (`GET /v1/admin/ledger`) MUST gate this on the operator role; nothing here restricts
 * the caller, so it must never be reachable by a non-operator.
 */
export interface AdminUsageDailyFilter {
  /** Inclusive YYYY-MM-DD bounds. */
  from?: string;
  to?: string;
}

// ── Agent Messages (Phase 3) ──

export interface AgentMessageRecord {
  id: string;
  agentGaii: string;
  threadId: string;
  direction: 'inbound' | 'outbound';
  senderGaii: string;
  content: string;
  status: 'pending' | 'processing' | 'delivered' | 'error';
  linkedTaskId?: string;
  metadata?: {
    tokensUsed?: number;
    processingMs?: number;
    proposedTask?: {
      title: string;
      description: string;
    };
    // Single-select option-prompt attached to an outbound (agent->owner)
    // message. The UI renders `options` as chips + an implicit "Other".
    prompt?: {
      promptId: string;
      question: string;
      options: string[];
      allowOther: boolean;
    };
    // Owner's reply to a prompt, on an inbound (owner->agent) message.
    // `promptId` correlates back to the prompt above.
    promptAnswer?: {
      promptId: string;
      choice: string;
      isOther: boolean;
    };
  };
  /**
   * TARGET-058: the provenance record describing this message's `content`.
   *
   * The outbound direction is the one that matters: an agent writes prose straight into the owner's
   * chat, and the owner reads it as a message from their agent. Without this the reader has no way
   * to tell an agent's own words from a model completion the agent forwarded. `metadata` is machine
   * plumbing and is deliberately outside the hash. Absent means UNSTATED, never "a human wrote it".
   */
  aiProvenanceId?: string;
  createdAt: string;
  processedAt?: string;
}

// ── Direct Messages (human↔human GHII messaging + federation) ──

/**
 * A media object referenced by a direct message — inline in the markdown body via cid:{id}
 * or appended as a plain attachment. Every referenced storage object is one entry here: the
 * single source of truth for the duplication / grant / quota / ownership lifecycle.
 */
export interface DirectMessageAttachment {
  /** Short id used by cid:{id} inline references in the markdown body. */
  id: string;
  /** true = embedded in the body via cid:; false = appended attachment. */
  inline: boolean;
  /** Storage key at the origin (sender's node). */
  storageKey: string;
  /** Owner (sender) GHII that holds the original bytes. */
  ownerGhii: string;
  /** Node hosting the original bytes. */
  originNodeId: string;
  /** How the recipient accesses it. duplicate = the norm; reference = transient (pending/awaiting quota). */
  mode: 'reference' | 'duplicate';
  /** Recipient-side storage key, set once the attachment has been duplicated locally. */
  localKey?: string;
  /** Set when a held (reference) attachment was never duplicated within the retry TTL and was dropped. */
  expired?: boolean;
  mime: string;
  size: number;
  /** Original filename / caption. */
  name?: string;
  kind: 'image' | 'audio' | 'video' | 'file';
  /** Playing length of audio/video, measured when it was recorded. Lets the thread show a duration
   *  before the bytes are fetched. */
  durationSeconds?: number;
  /**
   * Text of a spoken attachment.
   *
   * `by: 'sender'` arrived with the message and is identical in both mailbox copies. `by: 'recipient'`
   * was produced locally with the reader's own key and lives ONLY in their copy — updateMessageAttachments
   * is keyed by owner, so there is no path for it to reach the other party.
   */
  transcript?: {
    text: string;
    by: 'sender' | 'recipient';
    model?: string;
    lang?: string;
    seconds?: number;
    /** ISO timestamp of when the transcription ran. */
    at: string;
  };
}

/** One option in an interactive question. `id` is stable; `label` is the human-facing text. */
export interface InteractiveOption {
  id: string;
  label: string;
}

/** A single structured question carried by an interactive message (mirrors the AskUserQuestion shape). */
export interface InteractiveQuestion {
  id: string;
  /** Short chip label (≈ ≤12 chars). */
  header: string;
  /** The full question text. */
  prompt: string;
  options: InteractiveOption[];
  /** true → the human may pick multiple options (checkboxes); false → single-select (radio). */
  multiSelect?: boolean;
  /** true (default) → also offer a freeform "Other" answer. */
  allowOther?: boolean;
  /** true → the human must answer before the reply can be sent (UI-gated). */
  required?: boolean;
}

/** The human's answer to one question: the chosen option ids plus an optional freeform "Other" value. */
export interface InteractiveAnswer {
  selected: string[];
  other?: string | null;
}

/**
 * Optional structured payload on a direct message — a federated AskUserQuestion. Discriminated by `role`:
 *  - `questions`: an agent asks the human a set of option-based questions (rendered as a form in the inbox).
 *  - `answers`: the human's reply, carrying machine-readable picks keyed by question id (the message body
 *    still holds a human-readable summary so the thread reads naturally on any peer).
 */
export type InteractivePayload =
  | { role: 'questions'; v: number; questions: InteractiveQuestion[]; submitLabel?: string }
  | { role: 'answers'; v: number; answersFor: string; answers: Record<string, InteractiveAnswer> };

/**
 * One mailbox copy of a direct message. Both sides store their own row (classic mailbox model):
 * the sender keeps an `outbound` row, the recipient an `inbound` row, sharing `id`/`conversationId`
 * so receipts and replies correlate. `ownerGhii` is whose mailbox this copy belongs to.
 */
export interface DirectMessageRecord {
  id: string;
  /** Whose mailbox copy this row is (sender's copy or recipient's copy). */
  ownerGhii: string;
  /** Groups a thread on both nodes. By default derived from the sorted GHII pair (one thread per pair);
   *  a subject thread instead uses a freshly minted id carried in the federation payload. */
  conversationId: string;
  /** Optional thread subject — set on the message that opens a new subject thread; lets a pair have
   *  more than one thread (e.g. per topic) instead of a single endless conversation. */
  subject?: string;
  senderGhii: string;
  recipientGhii: string;
  /** GFM markdown; inline media referenced as cid:{attachmentId}. May be empty if attachment-only. */
  body: string;
  attachments?: DirectMessageAttachment[];
  /** Optional structured payload — a federated AskUserQuestion (the question spec, or the human's answers). */
  interactive?: InteractivePayload;
  /** Set when this message is one copy of a broadcast (send-to-many) — groups the copies for results. */
  broadcastId?: string;
  /** false = an announcement (recipients cannot reply); omitted/true = a normal message. Travels with the
   *  message (incl. cross-node) so the recipient's node can enforce/hide replies. */
  respondable?: boolean;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'undeliverable';
  direction: 'inbound' | 'outbound';
  /** Message this is a reply to (same conversationId). */
  replyToId?: string;
  origin: 'local' | 'federation';
  /** Node that created (sent) the message. */
  originNodeId: string;
  /** Last delivery error, if status is failed/undeliverable. */
  error?: string;
  /**
   * TARGET-058: the provenance record describing this message's body — how much of it a model wrote,
   * and whether a person read the substance before it was sent.
   *
   * Both mailbox copies carry the SAME id: the statement is about the bytes, not about whose row it
   * is. Absent means UNSTATED, which is never "a human wrote it" — a message that arrived from a
   * peer node that strips provenance is unstated, not human-authored.
   */
  aiProvenanceId?: string;
  createdAt: string;
  deliveredAt?: string;
  readAt?: string;
}

/**
 * A conversation with MORE than two participants.
 *
 * A two-party thread has no record: its id is derived from the sorted pair (conversationIdFor), so
 * both nodes agree on it without storing anything. The absence of a record IS the statement "this is
 * a pair", which is why adding groups migrated nothing.
 *
 * `participants` is the MEMBERSHIP, not a delivery list. Every participant still holds their own
 * mailbox copy of each message, so read state, deletion and federation stay per person rather than
 * per thread — the same model a pair thread uses, applied to n people.
 */
export interface ConversationRecord {
  /** The conversationId every message in this thread carries. */
  id: string;
  kind: 'group';
  /** Thread title. A group without one is a group nobody can tell apart in a list. */
  subject?: string;
  /** Identities that may read and write here: GHII, GAII or GEAI. */
  participants: string[];
  /** Who opened it (an identity, not necessarily a human — an agent may open a support thread). */
  createdBy: string;
  /**
   * The named address this thread was opened through, when it was opened through one.
   *
   * `support@operators` resolves to whoever holds the operator role AT THAT MOMENT, and that set
   * changes. Keeping the alias records what the sender actually addressed, which stays true even
   * after the membership does not.
   */
  alias?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Operator-facing delivery telemetry for one direct-message send attempt. Deliberately carries NO
 * message content and NO participant identities — only the routing/outcome metadata an operator
 * needs to see whether sends succeed or pile up in errors (status, target node, http/error, latency).
 */
export interface MessageDeliveryLog {
  id: string;
  /** The message's uuid (correlation only — not content). */
  messageId: string;
  origin: 'local' | 'federation';
  /** Recipient's node id (where it was being delivered). */
  targetNodeId: string;
  status: 'delivered' | 'queued' | 'failed' | 'undeliverable';
  httpStatus?: number;
  errorMessage?: string;
  latencyMs: number;
  createdAt: string;
}

/** Aggregated delivery stats for the operator dashboard. */
export interface MessageDeliveryStats {
  total: number;
  total24h: number;
  byStatus: Record<string, number>;
  byStatus24h: Record<string, number>;
  topTargetNodes: Array<{ nodeId: string; total: number; failed: number }>;
}

/**
 * Per-pair first-contact consent state, stored under the recipient's namespace. Drives the
 * first-contact gate: no record → pending request; accepted → free-flowing; blocked → rejected.
 */
export interface ContactConsentRecord {
  /** The human who owns this contact list (recipient side). */
  ownerGhii: string;
  /** The other party: GHII | GAII | GEAI. */
  contactId: string;
  state: 'pending' | 'accepted' | 'blocked';
  /** How the row came to exist: 'message' = created reactively by the first-contact DM gate
   *  (default); 'saved' = explicitly added to the owner's address book via the contacts API. */
  origin?: 'message' | 'saved';
  /** The request message that opened the relationship, if any. */
  firstMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Telemetry + Webhook Delivery Log (Phase A) ──

export interface TelemetryEvent {
  id: string;
  agentGaii: string;
  type: 'llm_call' | 'tool_call' | 'agent_report';
  data: Record<string, unknown>;
  sessionId?: string;
  taskId?: string;
  createdAt: string;
}

export interface WebhookDeliveryLog {
  id: string;
  agentGaii: string;
  event: string;
  payload: Record<string, unknown>;
  status: 'success' | 'failed';
  httpStatus?: number;
  errorMessage?: string;
  attemptCount: number;
  latencyMs: number;
  createdAt: string;
}

// ── Agent Onboarding (Phase B Hello Integration) ──

export interface AgentOnboardingStep {
  id: string;
  order: number;
  title: string;
  description: string;
  status: 'pending' | 'passed' | 'failed' | 'skipped';
  required: boolean;
  validatedAt?: string;
  validationMethod: 'automatic' | 'api_call' | 'owner_confirm';
  details?: Record<string, unknown>;
  failureReason?: string;
}

export interface AgentOnboardingRecord {
  agentGaii: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  steps: AgentOnboardingStep[];
  readinessScore?: number;
  readinessLevel?: 'basic' | 'standard' | 'full' | 'expert';
  detectedPlatform?: string;
  installedRuntime?: string;
  onboardingBaseline?: number;
  operationalHealth?: number;
  healthComponents?: {
    deliveryHealth: number;
    telemetryContinuity: number;
    taskCompletion: number;
  };
  healthRecalculatedAt?: string;
  readinessOverride?: {
    level: 'basic' | 'standard' | 'full' | 'expert';
    setBy: string;
    setAt: string;
    expiresAt: string;
    reason?: string;
  };
}

