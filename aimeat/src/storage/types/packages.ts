/**
 * @file src/storage/types/packages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Package, template-listing and package-instance record types. Moved unchanged out of
 *   src/storage/types/apps.ts, which had passed the 800-line limit; re-exported from
 *   src/storage/interface.ts like every other types file.
 * @version-history
 *   v1.1.0 — 2026-09-30 — PackageComponentType gains `skill`: a package carries the skills bound to its
 *     apps (wish-a-package-carries-the-skills-bound-to-its-apps).
 *   v1.0.0 — 2026-09-28 — Pure extraction from src/storage/types/apps.ts (max-file-lines), in the
 *     change that gave PackageInstanceRecord `mode` and `forkedAt`.
 */

// ── Packages & Templates ────────────────────────────────────────────

/** Shared type alias for all AIMEAT component types that can be included in a package. */
/**
 * `skill`: an app's operating guide, a SKILL.md pack bound to one app component of the same package
 * (services/package-skill-component.ts). The installer publishes it in their own skill registry,
 * bound to their installed copy of that app.
 */
export type PackageComponentType = 'csm' | 'extension' | 'cortex' | 'app' | 'msm' | 'memory' | 'translation' | 'skill';

/**
 * What an `app` component carries besides its bytes, so an installed app is not a nameless blob.
 *
 * ONLY THE FIELDS AN APP NEEDS TO LOOK LIKE ITSELF. Everything else on `AppManifest` is deliberately
 * absent, and the absences are the design rather than an oversight: `seo` (an operator's search
 * approval must not ride into another owner's copy), `marks`/`authorship`/`legal` (the named human
 * who answers for the app — carrying them puts one person's name and legal statements on another
 * person's copy), `aiPosture`/`track`/`specCheck` (re-derived from the bytes at publish),
 * `protection`/`priceMorsels`/`licenseType`/`forkedFrom`/`aiProvenanceId` (the source owner's own
 * commercial decisions and the provenance of the version published THERE).
 *
 * THE DATA MAP IS THE ONE THAT TRAVELS AS A DOCUMENT RATHER THAN A STAMP. `AppManifest.dataMap` is
 * a summary whose `docKey` addresses `apps.<id>.datamap`, and the installed copy's id is not the
 * author's, so the stamp would point at a record that does not exist on this node — which is why it
 * was left out entirely, and why every packaged app installed as having no map at all. `datamap`
 * here is the MAP, the paragraph about what the app is for and the row-by-row account of where its
 * data goes; the installer writes it under the name this node gave the app and stamps the manifest
 * from what it wrote. The promise the app makes about its data is the author's to make, and it is
 * the first thing an AI opening an unknown app reads.
 */
export interface PackageAppMeta {
  name?: string;
  description?: string;
  descriptions?: Record<string, string>;
  version?: string;                // the display semver, not the identity
  category?: string;
  tags?: string[];
  icon?: string;
  usesCortex?: string[];
  /**
   * The app's data map, spec `aimeat.datamap/2` (services/data-map/data-map-types.ts).
   *
   * Typed loosely HERE and nowhere else: a storage type may not import a service's, and a package is
   * somebody else's file besides. The installer validates the spec and every field before a byte is
   * written, and a map of an unknown spec is dropped rather than coerced.
   */
  datamap?: Record<string, unknown>;
}

/** A single component within a package version. */
export interface PackageComponent {
  id: string;                      // "csm-signage", "app-kiosk", "cortex-signage"
  type: PackageComponentType;
  label: string;                   // human-readable "Kiosk Display App"
  content: string;                 // raw content (YAML, JS, HTML, JSON)
  contentHash: string;             // SHA-256 of content (for change detection)
  dependencies: string[];          // references to other component IDs ["csm-signage"]
  /**
   * Per-component metadata that travels with the bytes. `meta.app` is a PackageAppMeta.
   *
   * WHY A FIELD AND NOT MORE HTML. Until this existed `content` was the only thing the ZIP round
   * trip carried, so a packaged app arrived named "Installed from package" with no icon and no
   * category. The alternative — encoding it in the HTML — is what bundled crews had to do, and it
   * means the installer must parse an app's source to render a listing row.
   *
   * Optional on purpose: a package written before this field, or by another node, has none, and
   * every reader falls back to what it did before.
   */
  meta?: Record<string, unknown>;
}

/**
 * Where a package came from, when it was pulled off another node.
 *
 * WHY THE PUBLISHED INSTANT AND NOT THE VERSION. `v{YYYY}-{MM}-{DD}-{HHmm}` happens to sort
 * lexicographically for versions this node generated, but it is a local convention: a peer on other
 * code, a package imported from a ZIP with an arbitrary version string, and the same-minute `-2`
 * suffix all break it, and nothing validates the string on import. `version` is therefore kept for
 * EQUALITY and display only, and `publishedAt` — taken from inside the signature — is what decides
 * whether a later pull is newer.
 *
 * `publicKey` is pinned on the first pull, so a later pull from the same source signed by a
 * different key is a refusal rather than a silent downgrade. `verifiedAt` is null for a package
 * whose signature could not be checked against a key this node knows, which the manual import road
 * allows and the federation road does not.
 */
export interface UpstreamRef {
  node: string;
  url: string;
  groupId: string;
  version: string;
  publishedAt: string;
  authorGhii: string;
  publicKey: string;
  verifiedAt: string | null;
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
  /** `beta`: released on a repository's beta channel only (services/package-entitlements.ts). */
  status: 'draft' | 'published' | 'beta' | 'archived';

  components: PackageComponent[];  // all components in this version
  manifest: string;                // full package YAML manifest (human-readable)

  /** Set when this version was pulled from another node. Absent on a package made here. */
  upstream?: UpstreamRef;

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
  /**
   * How the owner may change what this install registered.
   *
   * `managed`: the code and layout of every component come from the package. A local edit is refused
   * (services/package-managed.ts) and an update replaces every component. The owner still changes the
   * settings: an app's name, description, access code, parking, search visibility and legal texts.
   * `editable`: the owner may edit anything, and an update keeps what they edited.
   *
   * Absent reads as `editable`: every instance installed before the field existed was one, and
   * nothing already installed changes behaviour.
   */
  mode?: 'managed' | 'editable';
  /**
   * When the owner forked a managed install: it became `editable` in place, kept every address and
   * every record, and stopped receiving updates from its package. Absent when never forked.
   */
  forkedAt?: string;
  /**
   * Whether the daily package check (services/package-upstream-refresh.ts) updates this install by
   * itself when its source has a newer version (true), or tells the owner an update is ready (false).
   * Configurable (Jouni, 2026-09-28): an install sets it; managed installs default to true.
   */
  autoUpdate?: boolean;
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
  /**
   * The SHORT name a cortex or extension component was registered under, as the app components of
   * this instance address it in their rewritten source.
   *
   * WHY IT IS KEPT. An app component's source is rewritten at install time so `/v1/cortex/<name>/`
   * points at THIS instance's copy (component-registrar.ts). A later update re-registers the app
   * from the package's original bytes, and without this map the rewrite cannot be repeated: the
   * updated app would keep the package author's cortex name and 404 its own library. Recovered by
   * re-parsing the package manifest for instances installed before this field existed.
   */
  originalShortName?: string;
}

export interface InstanceFilter {
  owner?: string;
  ownerGhii?: string;
  packageGroupId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}
