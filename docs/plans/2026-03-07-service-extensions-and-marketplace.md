# Implementation Plan: Service Extensions Multi-Instance + Marketplace

**Date:** 2026-03-07
**Status:** Draft
**Depends on:** Extension runtime (implemented), Actions system (implemented), Work Queue (implemented)

## Overview

Extend the existing V8 sandbox extension system to support **multi-instance services**, then build the marketplace and matching services as the first two real extensions using this system. This also includes a new admin tab for managing service instances and a new public-facing marketplace SPA.

## Current State

### Already Implemented
- V8 sandbox runtime (`src/services/extension-runtime.ts`) — full ctx API proxy
- Extension management routes (`src/routes/extensions.ts`) — install, activate, deactivate, uninstall, execute
- Dynamic action execution at `POST /v1/ext/:extName/:actionId`
- Extension memory namespace (`ext:{name}`)
- ExtensionRecord storage interface + implementations (memory, MongoDB, SQLite)
- Marketplace-behaviors extension.yaml manifest (purchase, deliver, rate)
- Membership-behaviors extension.yaml manifest (join, invite, leave, promote, review-request)
- Actions system — publish, discover, execute via work queue
- Matching service (`src/services/matching.ts`) — algorithm + scheduler (will be migrated to extension)

### Not Yet Implemented
- Multi-instance support (instance CRUD, per-instance config, per-instance memory namespace)
- Instance-scoped action execution (`POST /v1/ext/:extName/:instanceId/:actionId`)
- Marketplace action scripts (the actual JavaScript for purchase.js, deliver.js, rate.js, create-listing.js)
- Additional marketplace actions (create-listing, update-listing, browse, search, delist)
- Admin tab for service instance management
- New marketplace public SPA (multi-instance aware)
- Matching extension action scripts

## Phase 1: Multi-Instance Extension Runtime

**Goal:** Extend the existing extension system to support multiple instances per extension.

### Task 1.1: ExtensionInstance Storage Interface

Add to `src/storage/interface.ts`:

```typescript
export interface ExtensionInstanceRecord {
  id: string;                          // Instance identifier (e.g., "city-flea-market")
  extensionName: string;               // Parent extension name
  config: Record<string, unknown>;     // Per-instance configuration
  status: 'active' | 'paused';
  createdBy: string;                   // Operator who created it
  createdAt: string;
  updatedAt: string;
}
```

Add to `Storage` interface:
```typescript
createExtensionInstance(record: ExtensionInstanceRecord): Promise<ExtensionInstanceRecord>;
getExtensionInstance(extensionName: string, instanceId: string): Promise<ExtensionInstanceRecord | null>;
listExtensionInstances(extensionName: string): Promise<ExtensionInstanceRecord[]>;
updateExtensionInstance(extensionName: string, instanceId: string, updates: Partial<ExtensionInstanceRecord>): Promise<ExtensionInstanceRecord | null>;
deleteExtensionInstance(extensionName: string, instanceId: string): Promise<boolean>;
```

**Files:** `src/storage/interface.ts`, `src/storage/providers/memory/index.ts`, `src/storage/providers/mongodb/index.ts`, `src/storage/providers/sqlite/index.ts`

### Task 1.2: Instance-Scoped Action Execution Route

Add new route in `src/routes/extensions.ts`:

```
POST /v1/ext/:extName/:instanceId/:actionId
```

This route:
1. Looks up the extension (must be active)
2. Looks up the instance (must exist and be active)
3. Finds the action in the extension
4. Builds `ExtensionCtx` with instance-scoped memory namespace: `ext:{extName}.{instanceId}`
5. Adds `ctx.instance = { id, config }` to the context
6. Executes the action in the V8 sandbox

The existing single-instance route (`POST /v1/ext/:extName/:actionId`) continues to work for extensions that don't use instances.

**Files:** `src/routes/extensions.ts`, `src/services/extension-runtime.ts`

### Task 1.3: Update ExtensionCtx Interface

Add `instance` to the ctx:

```typescript
export interface ExtensionCtx {
  // ... existing fields ...
  instance?: {
    id: string;
    config: Record<string, unknown>;
  };
}
```

Update the `buildIsolateScript()` function to serialize instance data alongside caller and config.

**Files:** `src/services/extension-runtime.ts`

### Task 1.4: Instance Management Routes

Add to `src/routes/extensions.ts`:

```
POST   /v1/extensions/:name/instances              — Create instance (operator)
GET    /v1/extensions/:name/instances              — List instances
GET    /v1/extensions/:name/instances/:instanceId  — Get instance detail
PATCH  /v1/extensions/:name/instances/:instanceId  — Update instance config (operator)
DELETE /v1/extensions/:name/instances/:instanceId  — Delete instance (operator)
```

**Files:** `src/routes/extensions.ts`

### Task 1.5: Update Extension Manifest Validation

When installing an extension, validate the `instances` section if present:
- Check `instances.supported` boolean
- Validate `instances.config_per_instance` schema definitions
- Store instance config schema in the ExtensionRecord for validation when creating instances

**Files:** `src/routes/extensions.ts`

### Task 1.6: Type Check + Test

Run `npx tsc --noEmit` to verify compilation. Run E2E tests to ensure existing extension functionality is not broken.

---

## Phase 2: Marketplace Extension Scripts

**Goal:** Write the actual JavaScript action scripts for the marketplace-behaviors extension.

### Task 2.1: Expand Marketplace Manifest

Update `docs/extensions/marketplace-behaviors/extension.yaml` to add:
- `create-listing` action — create a new listing in a marketplace instance
- `update-listing` action — update listing details (seller only)
- `delist` action — remove a listing (seller or operator)
- `browse` action — list available listings with filters (category, price range, status)
- Instance support configuration (visibility, password, allowed_users, categories, fee settings)

### Task 2.2: Write Action Scripts

Create action scripts in `docs/extensions/marketplace-behaviors/actions/`:

**create-listing.js** (~60 lines):
- Validate instance access (public/password/invite check)
- Validate category exists in instance config
- Charge listing fee via `ctx.wallet.consume()`
- Generate listing ID
- Store listing in memory: `listing.{id}`
- Return listing ID

**purchase.js** (~80 lines):
- Validate instance access
- Read listing from memory, verify status is 'active'
- Verify buyer is not the seller
- Calculate total: price + fee
- Debit buyer via `ctx.wallet.consume()`
- Create purchase record in memory: `purchase.{id}`
- Update listing status to 'reserved'
- Return purchase ID and total

**deliver.js** (~40 lines):
- Read purchase from memory
- Verify caller is the seller
- Update purchase status to 'delivered'
- Return status

**rate.js** (~50 lines):
- Read purchase from memory
- Verify caller is the buyer
- Verify purchase status is 'delivered'
- Store rating in memory: `rating.{purchaseId}`
- Update purchase status to 'completed'
- Return rated: true

**update-listing.js** (~40 lines):
- Read listing from memory
- Verify caller is the seller
- Verify listing status allows updates (active or paused)
- Update fields
- Return updated listing

**delist.js** (~30 lines):
- Read listing from memory
- Verify caller is seller OR caller has operator role
- Set listing status to 'delisted'
- Return status

**browse.js** (~40 lines):
- Validate instance access
- Search memory with `listing.` prefix
- Filter by category, price range, status
- Sort by date (newest first)
- Return paginated results

### Task 2.3: Test Marketplace Extension

Install the marketplace extension on a running dev node, create instances, and test the full purchase flow:
1. Create a public marketplace instance
2. Create a listing
3. Browse listings
4. Purchase a listing
5. Deliver
6. Rate
7. Test password-protected instance
8. Test invite-only instance

---

## Phase 3: Admin Tab — Service Instances

**Goal:** Build the admin dashboard tab for managing service extension instances.

### Task 3.1: Admin API Endpoints

Add to admin API service layer for the dashboard to consume:

```
GET  /v1/admin/extensions                                    — All extensions with stats
GET  /v1/admin/extensions/:name/instances                    — Instances for an extension
POST /v1/admin/extensions/:name/instances                    — Create instance
PATCH /v1/admin/extensions/:name/instances/:id               — Update instance config
DELETE /v1/admin/extensions/:name/instances/:id              — Delete instance
GET  /v1/admin/extensions/:name/instances/:id/listings       — Browse instance data (marketplace)
POST /v1/admin/extensions/:name/instances/:id/bulk-action    — Bulk operations (delist, feature, etc.)
```

These wrap the extension routes with operator-level access and additional admin-only capabilities (view all instances, moderate content, bulk actions).

**Files:** `src/routes/admin-dashboard.ts` or new `src/routes/admin-extensions.ts`

### Task 3.2: Admin API Service (Frontend)

Add to `public/js/services/admin.js`:

```javascript
export const getExtensions = () => apiGet('/v1/admin/extensions');
export const getExtensionInstances = (name) => apiGet(`/v1/admin/extensions/${name}/instances`);
export const createExtensionInstance = (name, config) => apiPost(`/v1/admin/extensions/${name}/instances`, config);
export const updateExtensionInstance = (name, id, config) => apiPut(`/v1/admin/extensions/${name}/instances/${id}`, config);
export const deleteExtensionInstance = (name, id) => apiDelete(`/v1/admin/extensions/${name}/instances/${id}`);
export const getInstanceListings = (name, id, opts) => apiGet(`/v1/admin/extensions/${name}/instances/${id}/listings`, opts);
export const instanceBulkAction = (name, id, action, ids) => apiPost(`/v1/admin/extensions/${name}/instances/${id}/bulk-action`, { action, ids });
```

**Files:** `public/js/services/admin.js`

### Task 3.3: Services Admin Tab

Replace the current `marketplace-tab.js` with a new `services-tab.js` (or rename) that manages ALL service extensions, not just marketplace.

**Tab views:**

1. **Overview** — List of installed extensions with instance counts, status badges, action counts
2. **Extension detail** — Instances list for a selected extension, create/delete instances
3. **Instance detail** — Configuration editor, stats (listing count, transaction count, revenue), recent activity
4. **Instance moderation** — Browse listings/data, flag/delist/feature actions, bulk operations
5. **Instance config** — Edit visibility, categories, fee settings, allowed users

**Patterns:** Follow existing admin tab patterns (DataTable, StatsGrid, ExpandableHelp, form pattern from boards-tab.js).

**Files:** `public/views/admin/services-tab.js` (new), update `public/views/admin.js` to register the tab

### Task 3.4: i18n Keys

Add `dashboard.services*` keys to `locales/en.json` and `locales/fi.json` for all tab UI text.

**Files:** `locales/en.json`, `locales/fi.json`

### Task 3.5: Data Loading

Add extensions + instances data to admin.js Phase 3 data loading:

```javascript
// Phase 3
const extensions = await getExtensions();
```

**Files:** `public/views/admin.js`

---

## Phase 4: Marketplace Public SPA

**Goal:** Replace the existing single-marketplace SPA with a multi-instance-aware frontend.

### Task 4.1: New Marketplace SPA

Create `public/views/marketplace.js` (replaces existing file) with these views:

1. **Marketplace selector** — List available marketplace instances the user can access (public ones + instances they're invited to)
2. **Instance home** — Category grid, recent listings, stats for a specific marketplace
3. **Browse/search** — Filter by category, keyword, price range, location within an instance
4. **Listing detail** — Full listing view with purchase flow
5. **Create listing** — Form to create a new listing (category from instance config, price, description, images)
6. **My listings** — Seller's listings across all instances
7. **My purchases** — Buyer's purchase history with rating flow

**Key difference from current SPA:** All API calls go through extension action endpoints (`POST /v1/ext/marketplace-behaviors/{instanceId}/{action}`) instead of dedicated marketplace routes.

**Files:** `public/views/marketplace.js` (rewrite)

### Task 4.2: Marketplace CSS

Update `public/css/views/marketplace.css` — keep `mk-*` prefix, add styles for instance selector, multi-instance navigation.

**Files:** `public/css/views/marketplace.css`

### Task 4.3: i18n Updates

Update `mkt.*` keys in locales for multi-instance UI (instance selector, access prompts, password input).

**Files:** `locales/en.json`, `locales/fi.json`

---

## Phase 5: Matching as Extension (Migration)

**Goal:** Migrate the existing built-in matching service to an extension.

### Task 5.1: Matching Extension Manifest

Create `docs/extensions/matching-behaviors/extension.yaml` with actions:
- `create-profile` — Register for matching in an instance
- `update-profile` — Update interests, location, seeking criteria
- `run-matching` — Execute matching algorithm (operator/scheduled)
- `respond` — Accept or dismiss a match suggestion
- `get-suggestions` — View current match suggestions

Instance config: name, visibility, max_distance_km, match_threshold, max_suggestions, cooldown_days.

### Task 5.2: Matching Action Scripts

Port logic from `src/services/matching.ts` into extension action scripts. The scoring algorithm (shared interests 40%, distance 25%, activity 20%, compatibility 15%) stays the same but operates through `ctx.memory` instead of direct storage access.

### Task 5.3: Deprecation Path

Keep the existing `src/services/matching.ts` and `src/routes/matches.ts` working but mark them as deprecated. Document migration path for operators: install matching-behaviors extension, create instance, migrate profiles from old memory keys to new namespaced keys.

---

## Phase 6: Cleanup and Documentation

### Task 6.1: Remove Old Marketplace Tab

Delete `public/views/admin/marketplace-tab.js` once the services tab is complete and tested.

### Task 6.2: Remove Old Marketplace Routes

The listing marketplace routes in `src/routes/marketplace.ts` (app marketplace) remain — they handle app purchases, not listing marketplace. The listing-specific types (`ListingRecord`, `PurchaseRecord`) in `src/storage/interface.ts` can be deprecated since listings now live in extension memory.

### Task 6.3: Update OpenAPI Spec

Add extension instance management endpoints to `openapi.yaml`. Mark old `/v1/marketplace/listings/*` endpoints as deprecated in favor of extension action endpoints.

### Task 6.4: Update CLAUDE.md

Add service extensions section documenting the multi-instance pattern, new admin tab, and extension development workflow.

### Task 6.5: Update Frontend Guide

Update `docs/frontend-development-guide.md` with the new services tab patterns and marketplace SPA architecture.

---

## Implementation Order

```
Phase 1 (Foundation)     — Multi-instance runtime
  1.1 Storage interface
  1.2 Instance-scoped action route
  1.3 ExtensionCtx update
  1.4 Instance management routes
  1.5 Manifest validation
  1.6 Type check + test

Phase 2 (First Service)  — Marketplace extension scripts
  2.1 Expand manifest
  2.2 Write action scripts
  2.3 Test marketplace extension

Phase 3 (Admin UI)       — Service instance management
  3.1 Admin API endpoints
  3.2 Admin API service (frontend)
  3.3 Services admin tab
  3.4 i18n keys
  3.5 Data loading

Phase 4 (Public UI)      — Marketplace SPA
  4.1 New marketplace SPA
  4.2 CSS updates
  4.3 i18n updates

Phase 5 (Second Service) — Matching migration
  5.1 Matching manifest
  5.2 Action scripts
  5.3 Deprecation path

Phase 6 (Cleanup)        — Docs and deprecations
  6.1 Remove old marketplace tab
  6.2 Deprecate old types
  6.3 Update OpenAPI
  6.4 Update CLAUDE.md
  6.5 Update frontend guide
```

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| V8 sandbox API too limited for marketplace | High | Phase 2 will reveal gaps early. Extend ctx API if needed (e.g., wallet.hold/release for proper escrow) |
| Memory search performance with many listings | Medium | Memory search uses prefix matching. May need pagination support in ctx.memory.search() |
| Multi-instance memory isolation bugs | Medium | Strict namespace prefixing in runtime. Unit test namespace boundaries |
| Existing marketplace SPA users disrupted | Low | Phase 4 replaces the SPA cleanly. Old endpoints deprecated, not removed immediately |
| Action script size limit (256 KB) too small | Low | Each action is a separate script. 256 KB per script is generous for validation/orchestration logic |

## Open Questions

1. **Wallet escrow**: The current ctx.wallet only has `consume()` (debit) and `getBalance()`. For proper marketplace escrow, we may need `hold()` and `release()` — or use the Work Queue's built-in escrow. Decision needed in Phase 2.

2. **Scheduled actions**: The matching extension needs periodic execution (run matching rounds). Should extensions be able to register scheduled actions, or should the operator set up external cron triggers? Decision needed in Phase 5.

3. **Extension marketplace/registry**: Should there be a central registry where operators can browse and install community extensions? Out of scope for this plan but worth considering for a future phase.

4. **Image storage**: Listings need images. Currently images would need to be stored as base64 in memory or referenced by external URL. Should the ctx API expose a file/blob storage API? Decision needed in Phase 2.
