# Templates & Packages System — Technical Specifications

**Date:** 2026-03-15
**Status:** Draft

---

## 1. Data Model

### 1.1 PackageRecord

One record per version. All versions of the same package share a `packageGroupId`.

```typescript
interface PackageRecord {
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

// Shared type alias for all component types
type ComponentType = 'csm' | 'extension' | 'cortex' | 'app' | 'msm' | 'memory' | 'translation';

interface PackageComponent {
  id: string;                      // "csm-signage", "app-kiosk", "cortex-signage"
  type: ComponentType;
  label: string;                   // human-readable "Kiosk Display App"
  content: string;                 // raw content (YAML, JS, HTML, JSON)
  contentHash: string;             // SHA-256 of content (for change detection)
  dependencies: string[];          // references to other component IDs ["csm-signage"]
}
```

**Version format:** `v{YYYY}-{MM}-{DD}-{HHmm}` — e.g., `v2026-03-15-1701`. Sorts lexicographically, human-readable, shows when it was created. If multiple versions same minute, append sequence: `v2026-03-15-1701-2`.

**packageGroupId:** `{name}::{author}` — e.g., `digital-signage::operator`. All versions of a package share this. Query "get all versions" = filter by packageGroupId, sort by version DESC.

**"Current version":** The latest record with `status: 'published'` for a given packageGroupId.

### 1.2 TemplateListingRecord

Social/discovery layer. One record per package (not per version).

```typescript
interface TemplateListingRecord {
  id: string;                      // UUID
  packageGroupId: string;          // links to PackageRecord group
  packageName: string;             // denormalized for queries
  packageAuthor: string;           // denormalized

  publishedBy: string;             // who created the listing (may differ from package author)
  publishedByGhii: string;        // publisher's GHII

  title: string;                   // display name "Building Digital Signage System"
  description: string;             // longer markdown description
  screenshots: string[];           // base64 data URIs or relative URLs
  category: string;                // gallery category
  tags: string[];                  // gallery tags

  featured: boolean;               // operator-promoted
  installCount: number;            // incremented on each install
  rating: number;                  // average 0.0–5.0 (denormalized, recalculated on review change)
  reviewCount: number;             // denormalized count

  status: 'listed' | 'unlisted' | 'moderated';
  createdAt: string;
  updatedAt: string;
}

// Reviews and discussions are stored in SEPARATE tables (not embedded)
// to avoid read-modify-write race conditions and unbounded record growth.

interface TemplateReview {
  id: string;                      // UUID
  listingId: string;               // FK to TemplateListingRecord.id
  authorGhii: string;             // reviewer's GHII
  authorName: string;              // display name
  rating: number;                  // 1–5
  comment: string;                 // review text
  createdAt: string;
}

interface TemplateDiscussion {
  id: string;                      // UUID
  listingId: string;               // FK to TemplateListingRecord.id
  authorGhii: string;
  authorName: string;
  message: string;                 // discussion message
  parentId?: string;               // for threading (reply to another message)
  createdAt: string;
}
```

### 1.3 PackageInstanceRecord

Tracks what was installed, where, and what was customized.

```typescript
interface PackageInstanceRecord {
  id: string;                      // UUID
  packageGroupId: string;          // which package group
  packageVersion: string;          // which version was installed
  packageRecordId: string;         // direct reference to the PackageRecord.id

  owner: string;                   // who installed it
  ownerGhii: string;              // installer's GHII

  label: string;                   // user's name for this instance "Meidän talon signage"

  installedComponents: InstalledComponent[];

  status: 'installed' | 'paused' | 'removed';
  installedAt: string;
  updatedAt: string;
}

interface InstalledComponent {
  componentId: string;             // original ID from package "app-kiosk"
  type: ComponentType;             // "app", "csm", "cortex", etc.
  registeredAs: string;            // actual name in system "signage-user1-app-kiosk"
  originalHash: string;            // SHA-256 at install time (for customization detection)
  customized: boolean;             // true if current hash differs from originalHash
  customizedAt?: string;           // when first customization was detected
}
```

---

## 2. API Specification

### 2.1 Package API

**Base path:** `/v1/packages`

#### Create Package (First Version)
```
POST /v1/packages
Auth: requireAuth(), requireRole(packageCreateRole)
Body: { name, description, category, tags, visibility, components[], manifest }
Response: 201 { PackageRecord }
```

#### Publish New Version
```
POST /v1/packages/:groupId/versions
Auth: requireAuth(), must be package author
Body: { changelog, components[], manifest, status }
Response: 201 { PackageRecord }
Notes: version auto-generated from current timestamp
```

#### List Packages
```
GET /v1/packages
Auth: none (public packages) or requireAuth() (includes own private)
Query: ?author=&category=&status=published&visibility=public&search=&limit=&offset=
Response: 200 { packages[], total }
```

#### Get Package (Latest Published Version)
```
GET /v1/packages/:groupId
Auth: none (if public) or requireAuth() (if private, must be author)
Response: 200 { PackageRecord }
```

#### List All Versions
```
GET /v1/packages/:groupId/versions
Auth: none (if public)
Query: ?limit=&offset=
Response: 200 { versions: PackageRecord[], total }
```

#### Get Specific Version
```
GET /v1/packages/:groupId/versions/:version
Auth: none (if public)
Response: 200 { PackageRecord }
```

#### Update Group Metadata
```
PATCH /v1/packages/:groupId
Auth: requireAuth(), must be package author
Body: { description?, tags?, visibility? }
Response: 200 { PackageRecord }
Notes: Updates shared metadata across ALL versions in this group.
       Does NOT change per-version fields (status, components, changelog).
```

#### Update Version Status
```
PATCH /v1/packages/:groupId/versions/:version
Auth: requireAuth(), must be package author
Body: { status: 'draft' | 'published' | 'archived' }
Response: 200 { PackageRecord }
Notes: Changes status of a SINGLE version only.
```

#### Archive Version
```
DELETE /v1/packages/:groupId/versions/:version
Auth: requireAuth(), must be package author
Response: 200 { archived: true }
Notes: Sets status to 'archived', does NOT delete the record
```

#### Export Package
```
GET /v1/packages/:groupId/export
Auth: none (if public)
Query: ?version= (optional, defaults to latest published)
Response: 200 YAML bundle (Content-Type: text/yaml)
```

#### Import Package
```
POST /v1/packages/import
Auth: requireAuth(), requireRole(packageCreateRole)
Body: YAML bundle string
Response: 201 { PackageRecord }
```

### 2.2 Instance API

#### Install Package
```
POST /v1/packages/:groupId/install
Auth: requireAuth()
Body: { label, version? }
Response: 201 { PackageInstanceRecord }
Notes: version defaults to latest published. Creates real component copies.
       Component names are prefixed: "{packageName}-{ownerName}-{componentId}"
       Owner identity: `req.auth!.owner` provides the owner name. GHII is looked up
       from IdentityRepository via `getIdentityByOwner(ownerName)` — same pattern as
       other owner-scoped endpoints (e.g., apps, extensions).
```

**Install Flow (internal):**
1. Fetch PackageRecord by groupId + version
2. Create PackageInstanceRecord
3. For each component in order (respecting dependencies):
   a. Generate unique name: `{packageName}-{ownerName}-{componentId}`
   b. Register via internal API call:
      - CSM: `POST /v1/csm`
      - Extension: `POST /v1/extensions` + `POST /v1/extensions/:name/activate`
      - Cortex: `POST /v1/cortex` + `POST /v1/cortex/:name/activate`
      - App: `POST /v1/apps`
      - MSM: `POST /v1/msm`
      - Memory: `POST /v1/memory` per key
      - Translation: merge into user's i18n namespace
   c. Record InstalledComponent with registeredAs and originalHash
4. If any component fails → **rollback**:
   a. For each already-created component (in reverse order), call native delete API:
      - CSM: `DELETE /v1/csm/:name`
      - Extension: `POST /v1/extensions/:name/deactivate` then `DELETE /v1/extensions/:name`
      - Cortex: `POST /v1/cortex/:name/deactivate` then `DELETE /v1/cortex/:name`
      - App: `DELETE /v1/apps/:filename`
      - MSM: `DELETE /v1/msm/:name`
      - Memory: `DELETE /v1/memory/:key` per created key
   b. Delete the PackageInstanceRecord (it was created in step 2 but install failed)
   c. If any rollback deletion itself fails, log the error but continue rolling back remaining components.
      Return error response with `partialRollback: true` and list of orphaned components for manual cleanup.
   d. Note: PackageInstanceRecord is created BEFORE component registration, so it always needs cleanup on failure.
5. Increment template install count (if template listing exists)
6. Return instance record

#### List My Instances
```
GET /v1/instances
Auth: requireAuth()
Query: ?status=installed&packageGroupId=&limit=&offset=
Response: 200 { instances: PackageInstanceRecord[], total }
```

#### Get Instance
```
GET /v1/instances/:id
Auth: requireAuth(), must be instance owner (or operator)
Response: 200 { PackageInstanceRecord }
```

#### Get Instance Component Status
```
GET /v1/instances/:id/status
Auth: requireAuth(), must be instance owner
Response: 200 {
  components: [{
    componentId, type, registeredAs, status,
    customized, currentHash, originalHash
  }]
}
Notes: Fetches each component from its native repo, computes current hash,
       compares with originalHash to detect customizations
```

#### Check for Updates
```
GET /v1/instances/:id/check-update
Auth: requireAuth(), must be instance owner
Response: 200 {
  currentVersion: "v2026-03-15-1701",
  latestVersion: "v2026-03-16-0930",
  updateAvailable: true,
  changelog: "Added sauna booking feature...",
  componentDiffs: [{
    componentId: "app-admin",
    type: "app",
    status: "unchanged" | "updated" | "new" | "removed",
    userCustomized: boolean,
    action: "no_change" | "safe_overwrite" | "migration_needed" | "install_new" | "remove"
  }]
}
```

#### Generate Migration Prompts
```
POST /v1/instances/:id/migration-prompt
Auth: requireAuth(), must be instance owner
Body: { components: ["app-admin", "cortex-signage"] }
Response: 200 {
  analyzePrompt: "...",    // Phase 1: analyze user's customizations
  migratePrompt: "..."     // Phase 2: merge template update with customizations
}
Notes: Only generates prompts for components with action "migration_needed".
       Components with "safe_overwrite" don't need prompts.
```

#### Apply Migration
```
POST /v1/instances/:id/apply-migration
Auth: requireAuth(), must be instance owner
Body: {
  targetVersion: "v2026-03-16-0930",
  components: [{
    componentId: "app-admin",
    action: "replace" | "skip" | "custom",
    content?: string    // new content (for "custom" action, from AI merge)
  }, {
    componentId: "app-kiosk",
    action: "replace",
    content: null        // null = use template's new version as-is
  }, {
    componentId: "ext-sauna",
    action: "install_new"
  }]
}
Response: 200 {
  migrated: true,
  updatedComponents: [...],
  newComponents: [...],
  skippedComponents: [...],
  newVersion: "v2026-03-16-0930"
}
Notes: Updates instance's packageVersion, refreshes originalHash for updated components
```

#### Remove Instance
```
DELETE /v1/instances/:id
Auth: requireAuth(), must be instance owner
Body: { removeComponents: boolean }
Response: 200 { removed: true, componentsRemoved?: number }
Notes: If removeComponents=true, deletes all installed components from their native repos.
       If false, just removes the instance tracking (components remain as standalone).
```

### 2.3 Template API

#### Create Listing
```
POST /v1/templates
Auth: requireAuth(), requireRole(packageCreateRole)
Body: { packageGroupId, title, description, screenshots, category, tags }
Response: 201 { TemplateListingRecord }
```

#### List Templates (Gallery)
```
GET /v1/templates
Auth: none
Query: ?category=&tags=&featured=true&sort=rating|installs|newest&search=&limit=&offset=
Response: 200 { templates: TemplateListingRecord[], total }
```

#### Get Template
```
GET /v1/templates/:id
Auth: none
Response: 200 { TemplateListingRecord }
```

#### Update Listing
```
PATCH /v1/templates/:id
Auth: requireAuth(), must be listing publisher (or operator)
Body: { title?, description?, screenshots?, category?, tags? }
Response: 200 { TemplateListingRecord }
```

#### Delete Listing
```
DELETE /v1/templates/:id
Auth: requireAuth(), must be listing publisher (or operator)
Response: 200 { deleted: true }
Notes: Removes the listing only. Package remains.
```

#### Add Review
```
POST /v1/templates/:id/review
Auth: requireAuth()
Body: { rating, comment }
Response: 201 { review }
Notes: One review per user per template. Updates if exists.
       Recalculates template rating average.
```

#### Add Discussion Message
```
POST /v1/templates/:id/discussion
Auth: requireAuth()
Body: { message, parentId? }
Response: 201 { discussion }
```

#### Toggle Featured
```
PATCH /v1/templates/:id/featured
Auth: requireAuth(), requireRole('operator')
Body: { featured: boolean }
Response: 200 { TemplateListingRecord }
```

---

## 3. Configuration

### 3.1 Environment Variables

```ini
# Package System
AIMEAT_PACKAGES_ENABLED=true              # Master switch
AIMEAT_PACKAGE_CREATE_ROLE=operator       # "operator" | "owner" — who can create packages
AIMEAT_PACKAGE_MAX_SIZE_MB=10             # Max total size of all components in a package
AIMEAT_PACKAGE_MAX_COMPONENTS=20          # Max components per package
AIMEAT_PACKAGE_MAX_PER_AUTHOR=50          # Max packages per author

# Template System
AIMEAT_TEMPLATES_ENABLED=true             # Master switch for template gallery
AIMEAT_TEMPLATE_REVIEWS_ENABLED=true      # Allow reviews
AIMEAT_TEMPLATE_DISCUSSIONS_ENABLED=true  # Allow discussions
```

### 3.2 Config Interface Additions

```typescript
// In AimeatConfig interface (src/config.ts)
packagesEnabled: boolean;
packageCreateRole: 'operator' | 'owner';
packageMaxSizeMb: number;
packageMaxComponents: number;
packageMaxPerAuthor: number;

templatesEnabled: boolean;
templateReviewsEnabled: boolean;
templateDiscussionsEnabled: boolean;
```

---

## 4. Storage Interface Additions

### 4.1 PackageRepository

```typescript
interface PackageRepository {
  createPackage(record: PackageRecord): Promise<PackageRecord>;
  getPackage(id: string): Promise<PackageRecord | null>;
  getPackageByGroupAndVersion(groupId: string, version: string): Promise<PackageRecord | null>;
  getLatestPublished(groupId: string): Promise<PackageRecord | null>;
  listPackages(filter: PackageFilter): Promise<{ packages: PackageRecord[]; total: number }>;
  listVersions(groupId: string, limit?: number, offset?: number): Promise<{ versions: PackageRecord[]; total: number }>;
  updatePackage(id: string, updates: Partial<PackageRecord>): Promise<PackageRecord | null>;
  archivePackage(id: string): Promise<boolean>;  // sets status to 'archived', never physically deletes
}

interface PackageFilter {
  author?: string;
  category?: string;
  status?: string;
  visibility?: string;
  limit?: number;
  offset?: number;
}
```

### 4.2 TemplateListingRepository

```typescript
interface TemplateListingRepository {
  createListing(record: TemplateListingRecord): Promise<TemplateListingRecord>;
  getListing(id: string): Promise<TemplateListingRecord | null>;
  getListingByPackage(packageGroupId: string): Promise<TemplateListingRecord | null>;
  listListings(filter: TemplateFilter): Promise<{ listings: TemplateListingRecord[]; total: number }>;
  updateListing(id: string, updates: Partial<TemplateListingRecord>): Promise<TemplateListingRecord | null>;
  deleteListing(id: string): Promise<boolean>;  // hard delete — listing only, package remains
  incrementInstallCount(listingId: string): Promise<void>;

  // Reviews (separate table)
  addReview(review: TemplateReview): Promise<TemplateReview>;
  getReviewsByListing(listingId: string, limit?: number, offset?: number): Promise<{ reviews: TemplateReview[]; total: number }>;
  getReviewByAuthor(listingId: string, authorGhii: string): Promise<TemplateReview | null>;
  updateReview(id: string, updates: Partial<TemplateReview>): Promise<TemplateReview | null>;
  deleteReview(id: string): Promise<boolean>;
  recalculateRating(listingId: string): Promise<{ rating: number; reviewCount: number }>;

  // Discussions (separate table)
  addDiscussion(discussion: TemplateDiscussion): Promise<TemplateDiscussion>;
  getDiscussionsByListing(listingId: string, limit?: number, offset?: number): Promise<{ discussions: TemplateDiscussion[]; total: number }>;
  deleteDiscussion(id: string): Promise<boolean>;
}

interface TemplateFilter {
  category?: string;
  tags?: string[];
  featured?: boolean;
  status?: string;
  sort?: 'rating' | 'installs' | 'newest';
  search?: string;
  limit?: number;
  offset?: number;
}
```

### 4.3 PackageInstanceRepository

```typescript
interface PackageInstanceRepository {
  createInstance(record: PackageInstanceRecord): Promise<PackageInstanceRecord>;
  getInstance(id: string): Promise<PackageInstanceRecord | null>;
  listInstances(filter: InstanceFilter): Promise<{ instances: PackageInstanceRecord[]; total: number }>;
  updateInstance(id: string, updates: Partial<PackageInstanceRecord>): Promise<PackageInstanceRecord | null>;
  deleteInstance(id: string): Promise<boolean>;
  listInstancesByPackage(packageGroupId: string): Promise<{ instances: PackageInstanceRecord[]; total: number }>;
}

interface InstanceFilter {
  owner?: string;
  ownerGhii?: string;
  packageGroupId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}
```

---

## 5. Migration Prompt Specification

### 5.1 Phase 1: Analyze Prompt

Generated by `POST /v1/instances/:id/migration-prompt`. Contains:

```
You are an AIMEAT migration assistant.

TASK: Analyze the user's customizations to identify what must be preserved during migration.

PACKAGE: {packageName} by {author}
CURRENT VERSION: {currentVersion}
TARGET VERSION: {targetVersion}

COMPONENT: {componentId} ({type})

--- ORIGINAL (installed from package) ---
{original content from PackageRecord at install version}
---

--- USER'S CURRENT VERSION ---
{fetched from the component's native repository in real-time}
---

INSTRUCTIONS:
1. Compare the two versions above
2. Identify CONTENT changes (data entries, text, names) — these do NOT affect migration
3. Identify FUNCTIONAL changes (code logic, configuration, layout structure, new features) — these MUST be preserved
4. List each functional change with its location and purpose

OUTPUT FORMAT (JSON):
{
  "contentChanges": [{ "description": "...", "location": "..." }],
  "functionalChanges": [{ "description": "...", "location": "...", "preserveReason": "..." }],
  "preserveList": ["concise summary of each thing to preserve"]
}
```

### 5.2 Phase 2: Migrate Prompt

```
You are an AIMEAT migration assistant.

TASK: Merge the template update with the user's customizations.

PACKAGE: {packageName} — updating {currentVersion} → {targetVersion}
COMPONENT: {componentId} ({type})

--- USER'S FUNCTIONAL CHANGES TO PRESERVE ---
{JSON output from Phase 1 analyze step}
---

--- NEW TEMPLATE VERSION ({targetVersion}) ---
{content from new PackageRecord}
---

RULES:
1. The user's functional changes listed above MUST be preserved in the output
2. The template's new features and fixes MUST be included
3. If a conflict cannot be resolved safely, DO NOT guess. Instead return:
   { "conflict": true, "options": ["Keep user version", "Take new template", "Manual merge needed"], "details": "..." }
4. Return the complete, ready-to-use component content

OUTPUT: The merged component content (full file, not a diff)
```

---

## 6. Package YAML Manifest Format

Human-readable manifest included with every PackageRecord:

```yaml
aimeat-package: "1.0"
name: "digital-signage"
author: "operator"
version: "v2026-03-15-1701"
description: "Managed corridor display system for residential buildings"
category: "signage"
tags: ["signage", "building", "kiosk", "display"]

components:
  - id: csm-signage
    type: csm
    label: "Signage Data Schema"
    file: csm-signage.yaml

  - id: memory-init
    type: memory
    label: "Initial Data Structure"
    file: memory-init.json

  - id: cortex-signage
    type: cortex
    label: "Signage Client Library"
    file: cortex-signage.yaml
    dependencies: [csm-signage]

  - id: app-admin
    type: app
    label: "Signage Admin Panel"
    file: app-admin.html
    dependencies: [cortex-signage]

  - id: app-kiosk
    type: app
    label: "Kiosk Display"
    file: app-kiosk.html
    dependencies: [cortex-signage]

  - id: translation-fi-en
    type: translation
    label: "Finnish & English Translations"
    file: translations.json

changelog: |
  Initial release with resident directory, announcements,
  advertisements, display configuration, and kiosk mode.
```

**Bundle format for export/import:** The YAML bundle is a single multi-document YAML file. The first document is the manifest (above). Subsequent documents are the component contents, each prefixed with a `--- # component: {id}` separator. The `file` field in the manifest is a display label only — all content is inline in the bundle, matching the `PackageComponent.content` field. Binary content (app HTML) is included as-is (YAML block scalar `|`).

**Translation component format:** The content is a JSON object with locale keys at the top level:
```json
{
  "en": { "signage.residents": "Residents", "signage.floor": "Floor", ... },
  "fi": { "signage.residents": "Asukkaat", "signage.floor": "Kerros", ... }
}
```
During install, keys are merged into the user's namespace. Key conflicts (user already has a key with the same name) are resolved by prefixing with the package name: `{packageName}.{key}`. The user is notified of any renames.

---

## 7. Security Considerations

1. **Package content validation** — All component content is validated through existing APIs (CSM parser, extension manifest validator, etc.) during install. No new validation needed.
2. **Role enforcement** — `packageCreateRole` config controls who can create packages. Install is always allowed for authenticated users.
3. **No arbitrary execution** — Package install uses the same API endpoints as manual creation. Extension sandboxing applies normally.
4. **Review moderation** — Operator can set listing status to 'moderated' to hide inappropriate content.
5. **Size limits** — `AIMEAT_PACKAGE_MAX_SIZE_MB` prevents storage abuse.
6. **No cross-user access** — Instance owner can only manage their own instances. Operator sees all in admin view.
7. **Rate limiting** — Review and discussion endpoints (`POST /v1/templates/:id/review`, `POST /v1/templates/:id/discussion`) use AIMEAT's existing rate limiting middleware to prevent abuse.
