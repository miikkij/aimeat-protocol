# Templates & Packages System — Implementation Plan

**Date:** 2026-03-15
**Status:** Draft
**Estimated Phases:** 6

---

## Phase Overview

| Phase | Name | Description | Dependencies |
|-------|------|-------------|-------------|
| 1 | Storage Layer | PackageRepository, TemplateListingRepository, PackageInstanceRepository for SQLite + MongoDB | None |
| 2 | Package API | CRUD routes, version management, export/import | Phase 1 |
| 3 | Instance API | Install flow, component status, remove | Phase 2 |
| 4 | Migration API | Check-update, migration-prompt generation, apply-migration | Phase 3 |
| 5 | Template API | Gallery listings, reviews, discussions, featured | Phase 2 |
| 6 | Frontend | Profile tab (packages), Admin tab (packages), Template gallery view | Phases 2–5 |

**Post-launch:** Digital signage example package (uses all of the above)

---

## Phase 1: Storage Layer

### Task 1.1: Storage Interface

**Files to modify:**
- `src/storage/interface.ts`

**Changes:**
- Add `PackageRecord`, `PackageComponent`, `PackageVersion` types
- Add `TemplateListingRecord`, `TemplateReview`, `TemplateDiscussion` types
- Add `PackageInstanceRecord`, `InstalledComponent` types
- Add `PackageRepository` interface
- Add `TemplateListingRepository` interface
- Add `PackageInstanceRepository` interface
- Add `PackageFilter`, `TemplateFilter`, `InstanceFilter` interfaces
- Compose new repositories into `Storage` interface

### Task 1.2: SQLite Implementation

**Files to create:**
- `src/storage/repositories/package.repository.ts`
- `src/storage/repositories/template-listing.repository.ts`
- `src/storage/repositories/package-instance.repository.ts`

**Files to modify:**
- `src/storage/providers/sqlite/index.ts` — add tables, compose repositories

**Tables:**
```sql
CREATE TABLE packages (
  id TEXT PRIMARY KEY,
  package_group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  author TEXT NOT NULL,
  author_ghii TEXT NOT NULL,
  version TEXT NOT NULL,
  changelog TEXT DEFAULT '',
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'other',
  tags TEXT DEFAULT '[]',           -- JSON array
  visibility TEXT DEFAULT 'private',
  status TEXT DEFAULT 'draft',
  components TEXT NOT NULL,          -- JSON array of PackageComponent
  manifest TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(package_group_id, version)
);
CREATE INDEX idx_packages_group ON packages(package_group_id);
CREATE INDEX idx_packages_author ON packages(author);
CREATE INDEX idx_packages_status ON packages(status);

CREATE TABLE template_listings (
  id TEXT PRIMARY KEY,
  package_group_id TEXT NOT NULL UNIQUE,
  package_name TEXT NOT NULL,
  package_author TEXT NOT NULL,
  published_by TEXT NOT NULL,
  published_by_ghii TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  screenshots TEXT DEFAULT '[]',     -- JSON array
  category TEXT DEFAULT 'other',
  tags TEXT DEFAULT '[]',
  featured INTEGER DEFAULT 0,
  install_count INTEGER DEFAULT 0,
  rating REAL DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  reviews TEXT DEFAULT '[]',         -- JSON array of TemplateReview
  discussions TEXT DEFAULT '[]',     -- JSON array of TemplateDiscussion
  status TEXT DEFAULT 'listed',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_template_listings_category ON template_listings(category);
CREATE INDEX idx_template_listings_featured ON template_listings(featured);

CREATE TABLE package_instances (
  id TEXT PRIMARY KEY,
  package_group_id TEXT NOT NULL,
  package_version TEXT NOT NULL,
  package_record_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  owner_ghii TEXT NOT NULL,
  label TEXT DEFAULT '',
  installed_components TEXT NOT NULL, -- JSON array of InstalledComponent
  status TEXT DEFAULT 'active',
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_package_instances_owner ON package_instances(owner);
CREATE INDEX idx_package_instances_package ON package_instances(package_group_id);
```

### Task 1.3: MongoDB Implementation

**Files to modify:**
- `src/storage/providers/mongodb/index.ts` — add collections, compose repositories
- `prisma/schema.prisma` — add models (if Prisma is used for MongoDB)

**Collections:** `packages`, `templateListings`, `packageInstances`

Indexes mirror SQLite indexes above.

### Task 1.4: E2E Tests for Storage

**Files to create:**
- `test/e2e-packages.ts` — Package CRUD, version management
- `test/e2e-templates.ts` — Template listing CRUD, reviews, discussions
- `test/e2e-package-instances.ts` — Install, status, remove

**Run against both backends:**
```bash
pnpm test:e2e:mongodb  # includes new test files
pnpm test:e2e:sqlite   # includes new test files
```

---

## Phase 2: Package API

### Task 2.1: Package Routes

**Files to create:**
- `src/routes/packages.ts`

**Endpoints:**
- `POST /v1/packages` — create package (first version)
- `POST /v1/packages/:groupId/versions` — add new version
- `GET /v1/packages` — list packages
- `GET /v1/packages/:groupId` — get latest published
- `GET /v1/packages/:groupId/versions` — list all versions
- `GET /v1/packages/:groupId/versions/:version` — get specific version
- `PATCH /v1/packages/:groupId` — update metadata
- `DELETE /v1/packages/:groupId/versions/:version` — archive version
- `GET /v1/packages/:groupId/export` — export as YAML bundle
- `POST /v1/packages/import` — import from YAML bundle

### Task 2.2: Configuration

**Files to modify:**
- `src/config.ts` — add package config fields to `AimeatConfig`
- `.env.example` — add env vars with defaults and comments
- `src/utils/env-config.ts` — display in `aimeat config`
- `src/utils/env-validator.ts` — validation rules

### Task 2.3: Server Registration

**Files to modify:**
- `src/server.ts` — mount `packageRouter(config, storage)`

### Task 2.4: OpenAPI Spec

**Files to modify:**
- `openapi.yaml` — add all package endpoints

### Task 2.5: i18n

**Files to modify:**
- `locales/en.json` — add `packages.*` keys
- `locales/fi.json` — add `packages.*` keys (Finnish translations or `[TODO:fi]` placeholders)

---

## Phase 3: Instance API

### Task 3.1: Install Flow

**Files to modify:**
- `src/routes/packages.ts` — add install endpoint

**Logic:**
1. Validate package exists and version is published
2. Create PackageInstanceRecord
3. For each component (dependency-ordered):
   - Generate unique name
   - Call internal registration function (reuse existing route logic)
   - Record InstalledComponent
4. Rollback on failure
5. Increment template install count (if template listing exists)

### Task 3.2: Instance Management Routes

**Files to modify:**
- `src/routes/packages.ts` — add instance endpoints

**Endpoints:**
- `GET /v1/instances` — list my instances
- `GET /v1/instances/:id` — get instance
- `GET /v1/instances/:id/status` — component status with hash comparison
- `DELETE /v1/instances/:id` — remove instance

### Task 3.3: Component Hash Computation

**Files to create:**
- `src/services/package-hash.ts` — utility to compute SHA-256 hash of any component type

**Logic per type:**
- CSM: hash the YAML definition
- Extension: hash manifest + all action scripts concatenated
- Cortex: hash manifest + all lib files concatenated
- App: hash the HTML content
- MSM: hash the YAML definition
- Memory: hash JSON.stringify of all key-value pairs sorted
- Translation: hash JSON.stringify of translations sorted

---

## Phase 4: Migration API

### Task 4.1: Check-Update Endpoint

**Files to modify:**
- `src/routes/packages.ts`

**Logic:**
1. Get instance's current version
2. Get latest published version for the packageGroupId
3. If same → no update
4. Compare component lists (old vs new): unchanged, updated, new, removed
5. For updated components: check if user customized (hash comparison)
6. Return diff with recommended actions

### Task 4.2: Migration Prompt Generation

**Files to create:**
- `src/services/migration-prompt.ts` — builds analyze and migrate prompts

**Logic:**
1. For each component needing migration:
   a. Fetch original content from installed PackageRecord
   b. Fetch user's current content from native repository
   c. Fetch new version's content from target PackageRecord
   d. Build analyze prompt (original vs current)
   e. Build migrate prompt (current changes + new version)
2. Return both prompts

### Task 4.3: Apply Migration Endpoint

**Files to modify:**
- `src/routes/packages.ts`

**Logic:**
1. For each component action:
   - `replace` with content: update component via native API
   - `replace` without content (null): use target version's content as-is
   - `skip`: do nothing
   - `install_new`: register new component
2. Update InstalledComponent hashes
3. Update instance's packageVersion
4. Return migration report

---

## Phase 5: Template API

### Task 5.1: Template Routes

**Files to create or modify:**
- `src/routes/templates.ts` (or extend `src/routes/packages.ts`)

**Endpoints:**
- `POST /v1/templates` — create listing
- `GET /v1/templates` — gallery with filters/sort
- `GET /v1/templates/:id` — single listing
- `PATCH /v1/templates/:id` — update
- `DELETE /v1/templates/:id` — remove listing
- `POST /v1/templates/:id/review` — add/update review
- `POST /v1/templates/:id/discussion` — add message
- `PATCH /v1/templates/:id/featured` — toggle featured (operator only)

### Task 5.2: Server Registration

**Files to modify:**
- `src/server.ts` — mount `templateRouter(config, storage)` (if separate file)

### Task 5.3: i18n

**Files to modify:**
- `locales/en.json` — add `templates.*` keys
- `locales/fi.json` — add `templates.*` keys

---

## Phase 6: Frontend

### Task 6.1: Profile Tab — Packages

**Files to create:**
- `public/views/profile/packages-tab.js`

**Features:**
- My Instances section (cards with status, update badge, manage button)
- Available Packages section (search, category filter, install button)
- Instance management view (components list, check updates, migration, remove)
- Create Package button (if permitted by role)

**Files to modify:**
- `public/views/profile.js` — add packages tab to TABS array
- `public/js/services/packages.js` — API service layer (new file)
- `public/css/views/profile.css` — packages tab styles (or separate file)

### Task 6.2: Admin Dashboard Tab — Packages

**Files to create:**
- `public/views/admin/packages-tab.js`

**Features:**
- Sub-tabs: All Packages, Templates, All Instances, Config
- Package management (create, version, archive)
- Template gallery management (create listing, feature, moderate)
- Instance overview across all users
- Config panel (role settings, limits)

**Files to modify:**
- `public/views/admin.js` — add packages tab
- `public/js/services/admin.js` — add package admin API calls
- `public/css/views/admin.css` — admin packages styles

### Task 6.3: Template Gallery View

Could be either:
- A section within the profile packages tab (simpler, start here)
- A standalone SPA route `/v1/templates` (richer, add later if needed)

### Task 6.4: Importmap Updates

**Files to modify:**
- `public/spa.html` — add importmap entries for new JS modules

### Task 6.5: i18n for UI

**Files to modify:**
- `locales/en.json` — add `profile.packages.*`, `dashboard.packages.*` keys
- `locales/fi.json` — same keys with Finnish translations

---

## Post-Launch: Digital Signage Example Package

### Task 7.1: Create CSM Component

Write `csm-signage.yaml` with data schemas for residents, announcements, ads.

### Task 7.2: Create Memory Init Component

Write `memory-init.json` with initial data structure (meta, config, indexes).

### Task 7.3: Create Cortex Component

Write `cortex-signage.yaml` + `signage.js` client library:
- `getSlides(displayId)`, `getResidents()`, `addResident()`, etc.
- Wraps Memory API calls into clean domain methods

### Task 7.4: Create Admin App

Write `app-admin.html`:
- Display management (static/rotating, interval)
- Resident CRUD (floor, apartment, surname)
- Announcement CRUD (title, content, QR URL, validity)
- Ad CRUD (title, content, QR URL)
- Preview kiosk button

### Task 7.5: Create Kiosk App

Write `app-kiosk.html`:
- Fullscreen kiosk mode
- Slide rotation with configurable interval
- QR code generation (CDN library)
- Auto-refresh from memory

### Task 7.6: Create Translations

Write `translations.json` with `en` and `fi` keys for all UI strings.

### Task 7.7: Bundle as Package

Use `POST /v1/packages` or `POST /v1/packages/import` to register the complete package.

### Task 7.8: Create Template Listing

Create gallery listing with screenshots, description, tags.

---

## Testing Strategy

### E2E Tests (per CLAUDE.md Rule 1)

Each phase includes E2E tests run against both SQLite and MongoDB:

| Test Suite | Phase | Coverage |
|-----------|-------|----------|
| `e2e-packages.ts` | 1–2 | Package CRUD, versioning, export/import, role enforcement |
| `e2e-templates.ts` | 5 | Template CRUD, reviews, discussions, gallery queries |
| `e2e-package-instances.ts` | 3–4 | Install, status, customization detection, migration, remove |

### Playwright Tests (per CLAUDE.md Rule 1b)

After Phase 6 frontend:
- Profile packages tab renders and navigates
- Admin packages tab renders and navigates
- Install flow works end-to-end
- Migration prompt display works

### Build Verification

After each phase:
```bash
npx tsc --noEmit          # Type check
pnpm lint                 # ESLint (Rule 6)
pnpm test:e2e:mongodb     # E2E MongoDB
pnpm test:e2e:sqlite      # E2E SQLite
```

---

## File Headers (per CLAUDE.md Rule 2)

All new files must include `@file`, `@description`, `@structure`, `@usage`, `@version-history` headers.

## OpenAPI Sync (per CLAUDE.md Rule 3)

All new endpoints must be documented in `openapi.yaml` in the same phase they are implemented.

## i18n Sync (per CLAUDE.md Rule 4)

All new translation keys must be added to both `locales/en.json` and `locales/fi.json` simultaneously.

## Storage Sync (per `docs/coding-guidelines/storage-sync.md`)

All new repository interfaces must have implementations for both SQLite and MongoDB backends.
