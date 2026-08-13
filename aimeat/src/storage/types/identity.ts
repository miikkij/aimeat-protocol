/**
 * @file src/storage/types/identity.ts
 * @description Identity + principal record types (owners, agents, ecosystem apps, GHII, sessions, personal nodes, agent activity). Extracted from src/storage/interface.ts to satisfy max-file-lines.
 * @version-history
 *   v1.2.0 — 2026-08-13 — AgentRecord.registeredBy: who asked for this agent. The node recorded it
 *     on the device-authorization record and swept that record on expiry, so the answer survived
 *     about half an hour. Creation ledger, and the fence on agent-initiated deletion.
 *   v1.1.0 — 2026-08-13 — AgentRecord.consoleUrl: where the agent's HOST manages it. The node knows
 *     an agent exists and had no way to send its owner to the place it actually runs.
 *   v1.0.0 — 2026-07-13 — Extracted from src/storage/interface.ts (max-file-lines)
 */
import type { SemanticAnnotation } from './common.js';
import type { ScheduleConstraint } from './organisms-federation.js';
export interface OwnerRecord {
  name: string;
  displayName?: string;
  publicKey: string;   // base64 Ed25519 public key
  roles: string[];     // ['owner'] or ['owner', 'operator']
  createdAt: string;
}

export interface AgentRecord {
  name: string;
  owner: string;
  gaii: string;
  displayName?: string;
  description?: string;
  capabilities: string[];
  publicKey: string;
  trustScore: number;
  morselBalance: number;
  createdAt: string;
  lastSeen: string;
  semantic?: SemanticAnnotation;  // Phase 0.7b
  defaultScopes?: string[];      // REQ-006 — scopes assigned at registration
  allowedOrigins?: string[];     // CORS — per-agent origin restrictions (Phase 3)
  dailySpendLimit?: number | null;
  /**
   * Default budget/run guards applied to this agent's schedules at creation
   * time (opt-in; the owner toggles these in the Agent Config tab). A schedule
   * inherits these and may override per-schedule. See ScheduleConstraint.
   */
  scheduleConstraintDefaults?: ScheduleConstraint[];
  federate?: boolean;
  technicalCapabilities?: AgentTechnicalCapability[];
  domainCapabilities?: string[];
  /** BCP-47 language codes the agent supports (kept separate from domainCapabilities). */
  languages?: string[];
  activityStats?: AgentActivityStats;
  modulesLoaded?: string[];
  agentLimitations?: string[];
  // Webhook delivery (Phase A push layer)
  webhookUrl?: string;
  webhookSecret?: string;
  webhookEnabled?: boolean;
  webhookLastSuccess?: string;
  webhookLastFailure?: string;
  webhookFailCount?: number;
  // Platform identification (Phase B prep)
  platform?: string;
  platformVersion?: string;
  platformDetectedBy?: 'auto' | 'self_report' | 'message_reply';
  /**
   * The primary LLM model driving this agent (e.g. 'claude-haiku-4.5', 'kimi-k2.6').
   * INDICATIVE, not a guarantee: self-reported, and coding platforms delegate to
   * subagents on cheaper models mid-session. Used for attribution/filtering
   * (model-keyed knowledge, pitfall stats) — never for auditing.
   */
  model?: string;
  modelDetectedBy?: 'self_report';
  // Tags for inter-agent data sharing + UI grouping (crew:*, source:*, role:*, project:*)
  tags?: string[];
  /**
   * Agent operational mode. Affects how Hello Integration is gated:
   * - `autonomous`  : runs continuously, full 13-step Hello Integration
   * - `interactive` : responds to user requests, full 13-step Hello Integration (default)
   * - `task-runner` : triggered/ephemeral, reduced 7-step flow (no commands, no messages; keeps test task)
   * - `coordinator`: orchestrates other agents, treated like `interactive` for onboarding
   * - `workstation`: node-visiting agent in the user's own env (VSCode, Claude Desktop), uses MCP
   *                  directly; not node-resident, so narrowest 4-step flow (auth + platform +
   *                  capabilities + directives)
   */
  mode?: 'autonomous' | 'interactive' | 'task-runner' | 'coordinator' | 'workstation';
  /**
   * How many tasks the agent's runner may process concurrently. Default 1 =
   * serial (the current behaviour, safe for any engine). >1 requires an engine
   * that can run a per-task liaison/worker pool (e.g. a CrewAI daemon); the
   * runner reads this value and scales its worker pool. AIMEAT only stores and
   * exposes the number — it does not enforce concurrency server-side.
   */
  maxConcurrentTasks?: number;
  /**
   * Where this agent is managed by whatever HOSTS it: the settings or brain page in the fleet
   * runtime it lives in (an agent hatchery instance, a CrewAI cockpit, a self-hosted daemon's UI).
   *
   * The node cannot know this address and must not guess it, so the host reports it: the owner, or a
   * same-owner sibling such as the concierge agent that created this one, writes it once. It exists
   * because the person who asked a chat for an agent gets told the agent is running and then has
   * nowhere to go to look at it. Display only, never fetched by the node — an http(s) URL is the
   * whole contract, checked where it is written (services/agent-profile-write.ts).
   */
  consoleUrl?: string | null;
  /**
   * Who authorized this agent's registration: the owner's bare name when a person approved it, or
   * the approving sibling's GAII when same-owner auto-approval did (a hatchery concierge creating
   * the agent it was asked for).
   *
   * Written once, at creation, and never rewritten. Re-running device authorization is a normal
   * event — a token expires, a machine is reinstalled — and letting a later approver take the entry
   * over would move the right to delete this agent along with it.
   *
   * Two jobs. It is the creation ledger: without it, "where did these forty agents come from" has no
   * answer, because `approvedBy` lives on the device-authorization record and those are swept when
   * they expire. And it is the fence on agent-initiated deletion: a sibling may end an agent only if
   * it is the one that asked for it.
   */
  registeredBy?: string | null;
}

/**
 * A data-area grant captured at GEAI approval time. Expressed in the existing consent grammar
 * (recipient + key/scope pattern + read/write rights) so a later capability/data-access chunk can
 * enforce it with the same machinery agents use. In chunk 1 this is STORED ONLY — not enforced
 * beyond standard requireScope.
 */
export interface EcoDataAreaGrant {
  /** What the grant targets: 'memory' | 'storage' | 'knowledge' | 'organisms' (free-form for now). */
  area: string;
  /** Key prefix / bucket / topic / workspace id pattern this grant covers (e.g. "support.*"). */
  pattern: string;
  /** Rights granted on the target. */
  rights: ('read' | 'write')[];
}

/**
 * EcosystemAppRecord — the GEAI principal, a near-copy of AgentRecord MINUS task/agent-only fields
 * (no mode, no maxConcurrentTasks, no webhooks, no task queue) PLUS the ecosystem binding fields
 * (app, boundRef, dataAreas, status). One per (app, owner, node). The morsel balance is always 0 —
 * like agents, the human (GHII) holds the only balance.
 */
export interface EcosystemAppRecord {
  /** The ecosystem app's stable global short name (e.g. "zendesk"). */
  app: string;
  /** Bare owner name this connection belongs to (per-user). */
  owner: string;
  /** Full GEAI: eco:{app}#{owner}@{node}. */
  geai: string;
  displayName?: string;
  description?: string;
  /** The app's Ed25519 verification key, pinned TOFU at first connect (hello). */
  publicKey: string;
  /** Owner-approved scopes (same grammar + enforcement as agent scopes). */
  scopes: string[];
  /** Owner-selected data-area allowlist captured at approval (stored only in chunk 1). */
  dataAreas?: EcoDataAreaGrant[];
  /** Opaque ecosystem-side account reference — the per-user correspondence marker. Never interpreted by AIMEAT. */
  boundRef?: string;
  /** Connection lifecycle state. */
  status: 'validating' | 'pending' | 'approved' | 'active' | 'revoked';
  /** Always 0 — balance lives on the owner GHII (schema parity with AgentRecord). */
  morselBalance: number;
  /**
   * The app's declared capabilities, copied from the validated hello manifest at approval. Lets the
   * node enforce that a scheduled `eco-capability` job names a capability the app actually provides,
   * and lets the portal render the Automation controls. Stored as a JSON column in both backends.
   */
  capabilities?: { id: string; inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown> }[];
  /**
   * Optional automation hints from the manifest: which capabilities are schedulable (and at what
   * cadences) + an optional advisory sink + the agent(s) this app recommends. A HINT only — never
   * required for an owner to schedule. `recommended_agents` lets the portal mark the owner's matching
   * agents "★ Recommended" (by exact `name` and/or capability `match_tags`) and list them first.
   */
  automation?: {
    schedulable?: { id: string; produces?: string; produces_key?: string; cadences?: string[] }[];
    advisory_sink?: string;
    recommended_agents?: { name?: string; match_tags?: string[]; why: { fi: string; en: string } }[];
  };
  /**
   * The app's OWN bilingual Markdown setup guide for the owner, copied from the validated hello
   * manifest at approval. The portal renders the locale-appropriate guide in the app card (replacing
   * the old hardcoded playbook). Stored as a JSON column in both backends, mirroring `automation`.
   */
  setup?: { fi: string; en: string };
  createdAt: string;
  lastSeen: string;
}

/**
 * EcoAutomationRecipe — a per-(owner, app) automation rule (feature B4). When a connected ecosystem
 * app publishes refined data (a memory write whose key matches `trigger.keyGlob`), the recipe
 * materialises an agent task for EACH configured agent so the owner's agents reason over the fresh
 * data. The downstream fields (`organism`, `email`, `requireApproval`) are STORED here but their
 * enforcement is deferred to B5/B6/B7 — only the agent trigger is wired in B4. Keyed by bare owner
 * name + app (one recipe per app per owner). `trigger`/`agents` persist as JSON columns in both
 * backends, mirroring how EcosystemAppRecord.capabilities/automation are stored.
 */
export interface EcoAutomationRecipe {
  id: string;
  /** Bare owner name this recipe belongs to (membership/identity keyed by bare owner, per CLAUDE.md). */
  owner: string;
  /** The ecosystem app's {app} segment, e.g. 'feedback-desk'. */
  app: string;
  /** What fires the recipe: a memory write (the app's data deposit) matching `keyGlob`. */
  trigger: { kind: 'data-published'; keyGlob: string };
  /** Names of the owner's agents to run when the trigger fires. */
  agents: string[];
  /** B5 (deferred) — organism/workspace to route the agent's output to. Stored, not yet enforced. */
  organism?: string | null;
  /** B6 (deferred) — email the report to the owner. Stored, not yet enforced. */
  email?: boolean;
  /** B7 (deferred) — gate the agent's advisory output behind owner approval. Stored, not yet enforced. */
  requireApproval?: boolean;
  /** When false, the trigger never materialises tasks for this recipe. */
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GHIIRecord {
  username: string;               // e.g. "alice"
  nodeId: string;                 // home node ID
  ghii: string;                   // full identifier: "alice@node-id"
  displayName: string;
  bio?: string;
  avatar?: string;                // emoji or storage key
  locale?: string;                // preferred language
  passwordHash?: string;          // scrypt hash for cross-device login
  verificationLevel: 0 | 1 | 2 | 3;  // 0=none, 1=email, 2=eidas/ftn, 3=eudiw-wallet
  ownerName: string;              // links to OwnerRecord.name
  createdAt: string;
  updatedAt: string;
  // TOTP 2FA (Phase 0.5)
  totpSecret?: string;          // AES-256-GCM encrypted TOTP secret (Base32)
  totpEnabled: boolean;         // Is TOTP activated (default: false)
  totpBackupCodes?: string[];   // SHA-256 hashed backup codes
  totpLastUsedAt?: string;      // Last used code timestamp (replay protection)
  totpLastUsedCode?: string;    // Last used code (replay protection)
  totpFailedAttempts?: number;  // Failed attempts (rate limiting)
  totpLockedUntil?: string;     // Locked until (rate limiting)
  passwordFailedAttempts?: number;  // Failed password attempts (brute-force protection)
  passwordLockedUntil?: string;     // Password lockout expiry (brute-force protection)
  semantic?: SemanticAnnotation;  // Phase 0.7b
  // Phase 1.3 — Web registration & email verification
  emailHash?: string;           // SHA-256 of verified email
  emailVerifiedAt?: string;     // ISO timestamp
  verificationMethod?: 'email' | 'phone' | 'operator' | 'eidas';
  magicLinkEnabled?: boolean;
  notificationEmail?: string;       // plaintext email for users who opt in to notifications
  lastLoginAt?: string;
  loginCount?: number;
  // Phase 3.3 — EUDIW/VC identity verification
  verifiedAttributes?: string[];
  verificationIssuer?: string;
  verificationCredentialHash?: string;
  ftnVerified?: boolean;
  // Social login — stable provider subject for Google sign-in account linking
  googleSub?: string;               // Google OIDC `sub` (stable per-user id) — kept as a fast/back-compat mirror of externalIdentities.google
  // Social login — generic external-identity map: { providerId: stableSubject }, e.g.
  // { google: "1234...", casdoor: "abcd...", entra: "..." }. Lets one account link several IdPs.
  externalIdentities?: Record<string, string>;
  // Economy (documented in GHII plan, now implemented)
  trustScore?: number;              // Aggregate trust score (0-100)
  morselBalance?: number;           // Morsel wallet balance
  // CORS — per-GHII origin restrictions (Phase 2)
  allowedOrigins?: string[];        // undefined = inherit from node default
}

export interface ChatInstanceRecord {
  id: string;              // Full identifier: "claude-myapp#jouni@node" or "anon-claude-1709337600#anonymous@node"
  platform: string;        // "claude" | "chatgpt" | "grok" | "copilot" | "gemini" | ...
  appName: string;         // App name or "anon-<timestamp>" for anonymous
  ownerName: string;       // "anonymous" or username
  ghii: string;            // Always set: "anonymous@node" or "username@node"
  nodeId: string;          // Node where this instance operates
  isAnonymous: boolean;    // true = anonymous session
  createdAt: string;       // ISO timestamp — session start
  lastSeen: string;        // ISO timestamp — last activity
  agentGaii?: string;      // Which agent is bound to this session (MCP sessions)
  mcpClientId?: string;    // OAuth client ID for audit trail (MCP sessions)
}

export interface PersonalNodeRecord {
  nodeId: string;               // e.g. "personal-jouni-001"
  ownerName: string;            // links to OwnerRecord
  anchorNodeId: string;         // the operator node hosting this personal node
  publicKey: string;            // Ed25519 public key for tunnel auth
  status: 'online' | 'offline' | 'degraded' | 'detached';
  agentGaiis: string[];         // agents hosted on this personal node
  lastSeen: string;             // ISO timestamp
  mailboxQuotaBytes: number;    // allocated quota
  mailboxUsedBytes: number;     // current usage
  visibility: 'private' | 'public';  // federation directory visibility
  createdAt: string;
  updatedAt: string;
  semantic?: SemanticAnnotation;  // Phase 0.7b
}

export interface MailboxItemRecord {
  id: string;                   // unique message ID
  personalNodeId: string;       // target personal node
  type: 'action_request' | 'work_assignment' | 'board_notification' | 'federation_sync';
  fromGaii: string;             // sender GAII
  toGaii: string;               // target GAII on the personal node
  payload: string;              // encrypted JSON string
  sizeBytes: number;
  retentionDays: number;        // 7 for action/work, 3 for board, 7 for federation
  expiresAt: string;            // ISO timestamp
  createdAt: string;
}

// ── Personal Push Subscriptions (REQ-007) ──────────────────

export interface PersonalPushSubscriptionRecord {
  id: string;
  personalNodeId: string;
  ownerName: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  failureCount: number;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface NotificationPreferences {
  personalNodeId: string;
  enabled: boolean;
  channels: ('web_push' | 'email')[];
  notifyTypes: string[];
  cooldownMinutes: number;
  quietHoursUtc: { start: string; end: string } | null;
  email: string | null;
  locale?: string;  // defaults to "en"
}

export interface MaintenanceState {
  enabled: boolean;
  message: string;
  enabledAt: string | null;
  enabledBy: string | null;
}

// ── Agent Activity (Phase 2 prep) ──

export interface AgentTechnicalCapability {
  name: string;
  type: 'mcp' | 'skill' | 'tool';
  verified: boolean;
}

export interface AgentActivityStats {
  tasksCompleted: number;
  tasksFailed: number;
  tokensUsed30d: number;
  aiCalls30d: number;
  successRate: number;
  lastTaskAt?: string;
  extensionsCreated: number;
  appsPublished: number;
}

export interface AgentActivityRecord {
  agentGaii: string;
  date: string;
  hour: number;
  metric: string;
  value: number;
}
