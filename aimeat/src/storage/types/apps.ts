/**
 * @file src/storage/types/apps.ts
 * @description App, subdomain, CSM/MSM/schema, system-prompt, and package/template record types. Extracted from src/storage/interface.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/storage/interface.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — AppManifest gains `cortex.agents` (Agent-Bundled Apps Slice 1):
 *     declarative crew-defs an app ships, validated at publish (crew-def-schemas.ts).
 *   v1.3.0 — 2026-08-11 — AppManifest gains `specCheck`: the build-spec state of the last publish,
 *     stored only when it was not clean. Owner-only, on the manifest for the same reason aiPosture
 *     is — a JSON blob on both providers, so no migration and no second place to keep in sync.
 *   v1.2.0 — 2026-08-01 — AppManifest gains `aiPosture` (TARGET-058 Phase 5): the app's own AI
 *     transparency statement plus the publish check's finding. On the manifest, so it needs no
 *     storage migration and survives a fork.
 */
import type { SemanticAnnotation, SemanticContext } from './common.js';
import type { AppAiPosture } from '../../services/app-ai-posture.js';

/**
 * The `cortex` section of an app manifest. `agents` carries the DECLARATIVE crew-defs
 * the app ships (crewaimeat crew_def shape) — validated against CrewDefSchema at
 * publish, stored as data, NEVER executed by the node. The owner's own fleet reads
 * them back via app_get (`manifest.cortex.agents`) on a deploy-app-agent task.
 * Stored loosely typed so the storage layer stays decoupled from the Zod model.
 */
export interface AppManifestCortex {
  agents?: Record<string, unknown>[];
}

export interface AppManifest {
  name: string;
  description: string;
  // Per-locale descriptions (BCP-47-ish keys, e.g. 'en', 'fi'), extensible to more languages.
  // The catalogue shows the entry matching the viewer's UI language, falling back to `description`.
  // `description` stays the canonical/default; this map is purely additive. Mirrors the
  // `SystemPromptRecord.locales` convention in this file.
  descriptions?: Record<string, string>;
  version: string;              // semver string (display-only)
  category: string;
  tags: string[];
  icon?: string;
  authorDisplay: string;
  usesCortex: string[];         // cortex extension names used
  cortex?: AppManifestCortex;   // agent-bundled apps: declarative crew-defs (see above)
  priceMorsels?: number;        // 0 or absent = free
  licenseType?: 'single' | 'lifetime';
  // Provenance: when this app was created by forking another app, this records the
  // source it derived from (cross-owner). Set by the fork endpoint, never accepted
  // from the publish payload. Mirrors the Foundry packaging `forkedFrom` convention.
  forkedFrom?: {
    owner: string;              // source app's bare owner name
    filename: string;           // source filename
    version: number;            // source version that was forked
    node?: string;              // source node id (reserved for cross-node forks)
  };
  /**
   * What the app says about the AI inside it (TARGET-058): which modalities it generates, whether it
   * shows the user a label, and whether it publishes on matters of public interest — plus the
   * publish check's finding when the app requests `ai:use` and says nothing at all.
   *
   * On the MANIFEST deliberately: it is already a JSON blob on both storage providers, so this needs
   * no migration, no second place to keep in sync, and it travels with every mechanism that already
   * copies a manifest — an update, a FORK (a fork of a generative app is still a generative app), a
   * backup, a purchase snapshot. Optional everywhere: an app that declares nothing is `undefined`,
   * never a validation failure, because one bad manifest field silently delists every offering an
   * app has. See services/app-ai-posture.ts.
   */
  aiPosture?: AppAiPosture;
  /**
   * Present only when the LAST publish did not carry the build spec that was in force at the time
   * (services/app-spec-gate.ts). A clean publish stores nothing and clears whatever was here, so
   * this reads as "the state right now" rather than an accusation an app can never shed.
   *
   * OWNER-ONLY, like `aiPosture.gap`: the catalogue strips it for anybody else. It exists so a skip
   * the owner authorised is still visible to them a month later, which the publish response — read
   * once, by an agent — cannot be. Never accepted from a publish payload.
   */
  specCheck?: { status: 'stale' | 'missing' | 'skipped'; at: string };
  // Opt-in copy-protection applied to the app's inline (runnable) HTML at serve time.
  // All flags default OFF. HONEST LIMITS: client HTML a browser runs can always be
  // copied by anyone who can view it — these only raise the cost of casual theft
  // (obfuscate), deter rehosting (domainLock), remove the one-click source download
  // (noRawDownload), and make a leaked copy traceable (watermark). Real protection is
  // keeping value in a server-side extension. See docs/app-developer-ai-guide.md.
  protection?: AppProtection;
}

export interface AppProtection {
  obfuscate?: boolean;      // obfuscate the app's inline <script> blocks at serve time
  domainLock?: boolean;     // only run on this node's app origin (guard script)
  watermark?: boolean;      // embed an invisible, operator-decodable per-serve fingerprint
  noRawDownload?: boolean;  // block the raw attachment download — inline (runnable) only
}

export interface AppRecord {
  ownerGaii: string;
  ownerName: string;
  filename: string;
  versionNumber: number;        // auto-incremented per filename+owner
  manifest: AppManifest;
  mimeType: string;
  size: number;
  data: Buffer;
  accessCode?: string;
  createdAt: string;
  // Parked apps are hidden from the public catalogue/gallery/search but stay fully
  // usable by their owner (and the owner's agents). A property of the app
  // (owner+filename), mirrored onto every version row. Default false = published.
  parked?: boolean;
  // Fork permission: when true, ANY authenticated user may fork this app into their
  // own catalogue via POST /v1/apps/:owner/:filename/fork. When false (default), only
  // the owner and the owner's own agents (same owner component) — and operators — may
  // fork it. A property of the app (owner+filename), mirrored onto every version row.
  // Governs the sanctioned Fork feature + provenance; it does NOT prevent manual
  // copying of a viewable app's client HTML (see docs/app-developer-ai-guide.md).
  // Default false.
  forkable?: boolean;
  // Operator moderation: when true, the app is removed from EVERY public surface
  // (catalogue/gallery/search/discovery) AND from public download — only the owner
  // (who sees a "moderated by operator: hidden" badge) and operators can still see
  // it. Unlike `parked`, the OWNER cannot lift this; only an operator can. A
  // property of the app (owner+filename), mirrored onto every version row. The
  // audit fields record who hid it, when, and why. Default false = visible.
  operatorHidden?: boolean;
  operatorHiddenBy?: string;   // operator owner name who hid it
  operatorHiddenAt?: string;   // ISO timestamp
  operatorHideReason?: string; // optional operator-supplied reason (shown to owner)
  /**
   * The ATTACHED half of AI provenance (TARGET-058): the id of an `AiProvenanceRecordRow` describing
   * how this app's BYTES were produced. Absent means UNSTATED — never "a human wrote it".
   *
   * Per VERSION, not per app: each published version is its own content, so each carries its own
   * statement. It is also the link that makes the record publicly resolvable — a provenance record
   * is readable by anyone exactly while some public item points at it, and a parked, hidden or
   * access-coded app is not one.
   */
  aiProvenanceId?: string;
}

/**
 * A single, unpublished DRAFT of an app — the staging slot. At most one draft
 * exists per (ownerGaii, filename); saving again overwrites it. The live app
 * (its published versions) is untouched while a draft exists. Publishing the
 * draft promotes it to a new AppRecord version and clears the draft. A draft is
 * OWNER-ONLY: it is never listed, never public, and is served for preview only
 * against a short-lived signed draft-preview token on the isolated app origin.
 */
export interface AppDraftRecord {
  ownerGaii: string;
  ownerName: string;
  filename: string;
  manifest: AppManifest;
  mimeType: string;
  size: number;
  data: Buffer;
  updatedAt: string;
}

export interface AppListOptions {
  ownerGaii?: string;
  category?: string;
  q?: string;
  tag?: string;
  sort?: 'newest' | 'popular';
  limit?: number;
  offset?: number;
  freeOnly?: boolean;
  // When set, parked AND operator-hidden apps are excluded UNLESS they belong to
  // this GHII, so an owner sees their own parked / operator-hidden apps in listings
  // (the latter carrying operator_hidden=true so the client can badge it) while
  // everyone else does not. Decided purely from who is authenticated — no client
  // flag. Omitted = anonymous/public view: exclude every parked / hidden app.
  viewerGhii?: string;
  // Operator-only listing: when true, return EVERY app regardless of parked or
  // operator-hidden state (the admin moderation view). Bypasses both filters.
  adminView?: boolean;
}

// Subdomain → published-app / redirect mapping (operator-managed).
// kind 'app': target is "owner/filename.html" of a published app.
// kind 'redirect': target is an absolute http(s) URL.
export interface SubdomainSiteRecord {
  subdomain: string;            // primary key, lowercase
  kind: 'app' | 'redirect';
  target: string;
  enabled: boolean;
  createdBy: string;            // GHII of the operator who created the mapping
  createdAt: string;            // ISO timestamp
  updatedAt: string;            // ISO timestamp
}

// Phase E — App Marketplace purchase receipts (immutable, self-contained)
export interface AppPurchaseRecord {
  transactionId: string;          // "mktx_..."
  buyerGaii: string;
  buyerOwner: string;
  sellerGaii: string;
  sellerOwner: string;
  appFilename: string;
  appName: string;                // from manifest at purchase time
  appVersionNumber: number;
  licenseType: 'single' | 'lifetime';
  priceMorsels: number;
  transactionFeeMorsels: number;
  purchasedAt: string;            // ISO timestamp
  appContent: string;             // base64-encoded full app content
  appManifest: AppManifest;       // manifest snapshot at purchase time
  appScreenshot?: string;         // base64-encoded screenshot if any
  signature: string;              // Ed25519 signature over transaction fields
  nodeId: string;                 // originating node
  nodePublicKey: string;          // node public key for verification
}

// Fork lineage event — one immutable row per fork, the source of truth for fork
// statistics + the cross-owner lineage graph. Append-only (mirrors app_purchases).
// The child app may later be parked or deleted; this row survives so lineage keeps
// its edges even when a descendant no longer exists.
export interface AppForkRecord {
  id: string;                     // "fork_..."
  sourceOwnerGaii: string;        // canonical GHII of the source app owner
  sourceOwnerName: string;        // bare owner name of the source
  sourceFilename: string;
  sourceVersion: number;          // source version that was forked
  childOwnerGaii: string;         // canonical GHII of the new (forked) app owner
  childOwnerName: string;         // bare owner name of the fork
  childFilename: string;
  forkedByGaii: string;           // the GAII/GHII that performed the fork (audit)
  forkedAt: string;               // ISO timestamp
}

export interface CsmRecord {
  name: string;                  // unique service name (e.g. "hobby-directory")
  definition: Record<string, unknown>;  // Full CsmDefinition as JSON
  jsonSchemaKey: string;         // schema locking key: "csm.{name}"
  serviceType: string;           // directory | marketplace | forum | etc.
  registeredBy: string;          // owner name who registered this CSM
  registeredAt: string;          // ISO timestamp
  updatedAt: string;             // ISO timestamp
  semantic?: SemanticAnnotation;  // Phase 0.7 — JSON-LD-compatible semantic annotation from CSM service.semantic
  federate?: boolean;            // Phase 3.4 — auto-distribute to federation peers
}

// MSM — Machine Service Manifest (external API integrations)
export interface MsmRecord {
  name: string;                    // unique service name
  definition: Record<string, unknown>;  // Full MsmDefinition as JSON
  category: string;                // data | utility | image | communication | analytics | analysis
  authType: string;                // bearer | query_param | oauth2 | api_key | none
  actionsCount: number;            // number of actions defined
  registeredBy: string;            // owner name
  registeredAt: string;            // ISO timestamp
  updatedAt: string;               // ISO timestamp
  federate?: boolean;              // share across federation
}

export interface SchemaRecord {
  keyPattern: string;         // memory key name or prefix
  applyTo: 'exact' | 'prefix'; // 'exact' = this key only, 'prefix' = this and all sub-keys
  schemaJson: Record<string, unknown>; // JSON Schema object
  schemaMode: 'open' | 'strict';      // open = additionalProperties: true, strict = false
  lockedBy: string;           // GAII or GHII that set the schema
  setAt: string;              // ISO timestamp
  updatedAt: string;          // ISO timestamp
  semanticContext?: SemanticContext;  // Phase 0.7 — optional JSON-LD-compatible semantic type
}

// Node Portal (Site)
export interface SiteChangeLogEntry {
  id: string;
  action: 'template_upload' | 'template_delete' | 'import' | 'cache_invalidate' | 'app_publish' | 'app_update' | 'app_delete' | 'memory_set' | 'memory_delete';
  summary: string;
  changedBy: string;
  changedAt: string;
}

// ── System Prompts ──────────────────────────────────────────────────

export interface SystemPromptRecord {
  id: string;
  group: string;
  name: string;
  description: string;
  content: string;
  locales?: Record<string, string>;
  active: boolean;
  variables: string[];
  usedIn: string[];
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface SystemPromptVersionRecord {
  promptId: string;
  version: number;
  content: string;
  locales?: Record<string, string>;
  changedBy: string;
  changedAt: string;
  changeNote?: string;
}

// ── Packages & Templates ────────────────────────────────────────────

/** Shared type alias for all AIMEAT component types that can be included in a package. */
export type PackageComponentType = 'csm' | 'extension' | 'cortex' | 'app' | 'msm' | 'memory' | 'translation';

/** A single component within a package version. */
export interface PackageComponent {
  id: string;                      // "csm-signage", "app-kiosk", "cortex-signage"
  type: PackageComponentType;
  label: string;                   // human-readable "Kiosk Display App"
  content: string;                 // raw content (YAML, JS, HTML, JSON)
  contentHash: string;             // SHA-256 of content (for change detection)
  dependencies: string[];          // references to other component IDs ["csm-signage"]
}

/**
 * One record per package version. All versions of the same package share a packageGroupId.
 * Version format: v{YYYY}-{MM}-{DD}-{HHmm} — e.g. v2026-03-15-1701
 */
export interface PackageRecord {
  id: string;                      // UUID — unique per version
  packageGroupId: string;          // "{name}::{author}" — groups all versions
  name: string;                    // "digital-signage" (unique per author)
  author: string;                  // owner name or "operator"
  authorGhii: string;             // creator's GHII

  version: string;                 // "v2026-03-15-1701" (date-time sortable)
  changelog: string;               // what changed from previous version

  description: string;             // short description
  category: string;                // "signage" | "marketplace" | "iot" | "social" | "productivity" | "communication" | "other"
  tags: string[];                  // free-form tags for search
  visibility: 'private' | 'public';
  status: 'draft' | 'published' | 'archived';

  components: PackageComponent[];  // all components in this version
  manifest: string;                // full package YAML manifest (human-readable)

  createdAt: string;               // ISO 8601
  updatedAt: string;               // ISO 8601 — updated when metadata changes
}

export interface PackageFilter {
  author?: string;
  category?: string;
  status?: string;
  visibility?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

/** Social/discovery layer. One record per package group (not per version). */
export interface TemplateListingRecord {
  id: string;                      // UUID
  packageGroupId: string;          // links to PackageRecord group
  packageName: string;             // denormalized for queries
  packageAuthor: string;           // denormalized

  publishedBy: string;             // who created the listing
  publishedByGhii: string;        // publisher's GHII

  title: string;                   // display name
  description: string;             // longer markdown description
  screenshots: string[];           // base64 data URIs or relative URLs
  category: string;                // gallery category
  tags: string[];                  // gallery tags

  featured: boolean;               // operator-promoted
  installCount: number;            // incremented on each install
  rating: number;                  // average 0.0–5.0 (denormalized)
  reviewCount: number;             // denormalized count

  status: 'listed' | 'unlisted' | 'moderated' | 'pending_review' | 'rejected' | 'suspended';
  createdAt: string;
  updatedAt: string;

  // Moderation fields
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewComment?: string;
  proposedAt?: string;
  proposedBy?: string;
}

export interface TemplateReview {
  id: string;                      // UUID
  listingId: string;               // FK to TemplateListingRecord.id
  authorGhii: string;             // reviewer's GHII
  authorName: string;              // display name
  rating: number;                  // 1–5
  comment: string;                 // review text
  createdAt: string;
}

export interface TemplateDiscussion {
  id: string;                      // UUID
  listingId: string;               // FK to TemplateListingRecord.id
  authorGhii: string;
  authorName: string;
  message: string;                 // discussion message
  parentId?: string;               // for threading (reply to another message)
  createdAt: string;
}

export interface TemplateFilter {
  category?: string;
  tags?: string[];
  featured?: boolean;
  status?: string;
  sort?: 'rating' | 'installs' | 'newest';
  search?: string;
  limit?: number;
  offset?: number;
}

/** Tracks an installed copy of a package. */
export interface PackageInstanceRecord {
  id: string;                      // UUID
  packageGroupId: string;          // which package group
  packageVersion: string;          // which version was installed
  packageRecordId: string;         // direct reference to the PackageRecord.id

  owner: string;                   // who installed it
  ownerGhii: string;              // installer's GHII

  label: string;                   // user's name for this instance

  installedComponents: InstalledComponent[];

  status: 'installed' | 'paused' | 'removed';
  installedAt: string;
  updatedAt: string;
}

export interface InstalledComponent {
  componentId: string;             // original ID from package "app-kiosk"
  type: PackageComponentType;
  registeredAs: string;            // actual name in system "signage-user1-app-kiosk"
  originalHash: string;            // SHA-256 at install time (for customization detection)
  customized: boolean;             // true if current hash differs from originalHash
  customizedAt?: string;           // when first customization was detected
}

export interface InstanceFilter {
  owner?: string;
  ownerGhii?: string;
  packageGroupId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}
