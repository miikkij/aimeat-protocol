# Templates & Packages System — Analysis & Gap Analysis

**Date:** 2026-03-15
**Status:** Draft

---

## 1. Existing Systems Inventory

### 1.1 Component Systems (What Can Be Packaged)

| System | Storage | API | Creator Roles | Versioning | Notes |
|--------|---------|-----|---------------|------------|-------|
| **CSM** | CsmRepository | `/v1/csm` | owner | registeredAt/updatedAt | YAML manifest, creates schema locks |
| **Extensions** | ExtensionRepository | `/v1/extensions` | operator/owner (configurable) | version field in manifest | V8 sandbox, multi-instance support |
| **Cortex** | CortexExtensionRepository | `/v1/cortex` | owner | version field in manifest | YAML + JS libs, activation artifacts |
| **Apps** | AppRepository | `/v1/apps` | owner | Auto-incremented versionNumber | HTML binary, marketplace support |
| **MSM** | MsmRepository | `/v1/msm` | operator/owner (configurable) | registeredAt/updatedAt | External API integration manifests |
| **Memory** | MemoryRepository | `/v1/memory` | agent/owner | version field (optimistic locking) | Key-value with visibility zones |
| **Translations** | i18n files | `/v1/i18n` | system | N/A | en.json + fi.json locale files |

### 1.2 Distribution Systems (How Things Are Shared Today)

| System | Purpose | Mechanism |
|--------|---------|-----------|
| **CSM Templates** | Pre-built service definitions | YAML files in `docs/csm-examples/`, served via `GET /v1/csm/templates` |
| **Cortex Bundled** | Pre-built cortex extensions | YAML+JS in `public/cortex-bundled/`, installed at node setup |
| **App Store** | App catalog with purchases | `AppRepository` + `AppMarketplaceRepository`, morsel pricing |
| **Knowledge Packages** | Portable knowledge bundles | Memory-based (`packages/{uuid}/manifest`), clone/export/share |
| **Federation** | Cross-node discovery | Extensions/CSM/Cortex can advertise to federated peers |

### 1.3 Generator System (AI-Assisted Creation)

| Capability | Status | Relevance to Packaging |
|-----------|--------|----------------------|
| Interview → JSON Spec | Implemented (v2.0) | Captures requirements structured |
| Blueprint → Components | Implemented (v2.0) | Defines component list with dependencies |
| Per-component generation | Implemented (v3.0) | Generates CSM, Extension, Cortex, App, Memory, Translation |
| Component registration | Implemented (v3.1) | Registers each component via internal API calls |
| Lifecycle management | Implemented (v3.0) | Activate/deactivate/remove all components |
| Anti-pattern validation | Implemented (v4.0) | Catches mechanical bugs before install |
| Blueprint `produces`/`consumes` | Implemented (v3.1) | Dependency tracking between components |

### 1.4 Related Design Documents

| Document | Relevance |
|----------|-----------|
| `docs/plans/2026-03-07-scaffold-and-bundle-design.md` | npm packaging (scaffold files), not service packaging |
| `docs/plans/2026-03-07-service-extensions-and-marketplace.md` | Extension multi-instance + marketplace services |
| `docs/plans/2026-03-14-generator-v2-interview-cortex.md` | Generator improvements, cortex generation |
| `docs/plans/2026-03-15-generator-prompt-hardening.md` | Prompt quality, validation, lifecycle |
| `docs/plans/2026-03-05-cortex-extensions-v2-design.md` | Cortex manifest format, activation flow |
| `docs/plans/2026-03-04-csm-driven-services-and-node-extensions-design.md` | CSM → Extension → Service pipeline |

---

## 2. Gap Analysis

### 2.1 Critical Gaps (Must Have)

| # | Gap | Description | Impact |
|---|-----|-------------|--------|
| G1 | **No bundle format** | No way to group CSM + Cortex + App + Memory + Translation into a single distributable unit | Users must manually create each component |
| G2 | **No package versioning** | Individual components have versions, but there's no "package v2026-03-15-1701 contains these components at these versions" | No update path, no rollback |
| G3 | **No instance tracking** | When components are installed, there's no record of "these 6 components came from the same package" | No migration, no bulk management |
| G4 | **No one-click install** | Installing a complete service requires N API calls manually or via generator | High friction for new users |
| G5 | **No migration mechanism** | When a template author updates, users have no way to apply updates while keeping customizations | Stale installations, no improvement path |
| G6 | **No template discovery** | CSM templates exist as flat YAML files. No gallery, no ratings, no search, no screenshots | Users don't know what's available |
| G7 | **No package storage** | No `PackageRepository`, `TemplateListingRepository`, or `PackageInstanceRepository` in storage interface | Need new storage types for both SQLite and MongoDB |

### 2.2 Secondary Gaps (Should Have)

| # | Gap | Description | Impact |
|---|-----|-------------|--------|
| G8 | **No package import/export** | Can't move packages between nodes as files | Limits portability |
| G9 | **No package role configuration** | `.env` has `extInstallRole` and `msmInstallRole` but no `packageCreateRole` | Can't control who creates packages |
| G10 | **No UI for package management** | No profile tab or admin dashboard tab for packages | No user-facing interface |

### 2.3 Non-Gaps (Already Covered)

| Capability | Covered By | Notes |
|-----------|-----------|-------|
| Component registration APIs | CSM, Extension, Cortex, App, MSM, Memory routes | Package install uses these internally |
| Schema validation | Schema Locking system | CSM auto-creates schema locks |
| Extension sandboxing | V8 isolate runtime | Security already handled |
| App versioning | AppRepository auto-increment | App within package gets normal versioning |
| Federation advertising | Extension/CSM `federate` flag | Works per-component after install |
| Morsel economy | Wallet + App marketplace | Could extend to packages later |
| i18n infrastructure | `locales/en.json` + `fi.json` + `/js/i18n.js` | UI strings ready to add |
| Live updates (SSE) | `lib/live-updates.js` | Profile tabs can listen for changes |

---

## 3. Architectural Decision: Storage Approach

### Options Evaluated

| Option | Description | Verdict |
|--------|-------------|---------|
| **A) Own storage repositories** | New `PackageRepository`, `TemplateListingRepository`, `PackageInstanceRepository` | **Selected** |
| B) Memory-based | Store packages as memory entries under `__packages/` prefix | Rejected: poor query support, no transactions, quota issues |
| C) Hybrid | Metadata in own repo, content references existing repos | Rejected: instance creation needs stored originals for migration |

### Rationale for Option A

1. Every other major subsystem (Extension, Cortex, App, CSM) uses its own repository — this follows the established pattern
2. Package queries need proper filtering (by author, category, status, version) — key-value is insufficient
3. Instance tracking needs referential integrity (instance → package → version)
4. Version history requires each version to be a complete, immutable record
5. Template gallery needs structured data (ratings, reviews, discussions) that doesn't fit key-value well
6. The "eat your own dog food" argument for Memory-based was evaluated but rejected: it adds real technical debt (fragile multi-key transactions, poor query performance) for a conceptual benefit that is better demonstrated by the actual example packages

### Rationale for Separate Repositories (3 repos, not 1 or 2)

1. **PackageRepository** — Technical artifact. Stores component bundles and version history. Concerns: content integrity, versioning, authorship
2. **TemplateListingRepository** — Social/discovery layer. Stores ratings, reviews, discussions, screenshots. Concerns: moderation, ranking, discovery
3. **PackageInstanceRepository** — User-specific tracking. Stores what was installed, what was customized, migration state. Concerns: per-user state, customization detection

Mixing these would create a god-object that grows in all directions. Separating them allows each to evolve independently (e.g., template gallery can add features without touching package storage).

---

## 4. Component Relationship Map

```
                    ┌─────────────────────┐
                    │   PackageRecord     │
                    │   (versioned bundle)│
                    └──────────┬──────────┘
                               │ contains
                    ┌──────────▼──────────┐
                    │  PackageComponent[] │
                    │  (raw content per   │
                    │   component type)   │
                    └──────────┬──────────┘
                               │ installed as
                    ┌──────────▼──────────┐
                    │ PackageInstance     │
                    │ (user's copy)      │
                    └──────────┬──────────┘
                               │ creates real
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
         ┌─────────┐    ┌──────────┐    ┌────────────┐
         │ CsmRecord│    │AppRecord │    │CortexRecord│  ... etc
         │(existing)│    │(existing)│    │ (existing) │
         └─────────┘    └──────────┘    └────────────┘
```

### Key Insight: Packages USE Existing APIs, Don't Replace Them

The install flow calls the same `POST /v1/csm`, `POST /v1/extensions`, `POST /v1/apps` etc. that a user or generator would call manually. The package system is an orchestration layer, not a replacement for individual component management.

After installation, each component lives in its native repository and is managed through its native API. The `PackageInstanceRecord` only tracks provenance ("this CSM came from package X version Y") for migration purposes.

---

## 5. Decision Framework Usage

The generator's decision framework (from `generator-prompts.js`) applies to packages too:

> **EXTENSION = SERVER-ONLY WORK.** An extension MUST do something that a browser CANNOT do.

This means:
- **Most packages will NOT include extensions** — CRUD operations, data display, configuration are all client-side via Memory API + Cortex
- **Extensions are only needed for**: external API integration (CORS/auth), scheduled cron jobs, server-to-server communication
- **The digital signage example has 0 extensions** — all operations are Memory + Cortex + App
- **Package authors should follow the same framework** when deciding what components to include

---

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Package install fails midway (3 of 6 components created) | Medium | High — orphaned components | Transaction-like rollback: if any component fails, delete already-created ones |
| Migration prompt produces incorrect merge | Medium | Medium — user's customizations damaged | Two-phase approach (analyze first, then migrate). User reviews before applying. Original hash preserved for rollback |
| Package content too large for storage | Low | Medium | Config limit `AIMEAT_PACKAGE_MAX_SIZE_MB`, validated at upload |
| Template gallery spam (fake reviews) | Low | Low | Operator moderation, `status: 'moderated'` flag |
| Version explosion (hundreds of versions per package) | Low | Low | Each version is small (YAML/HTML text). No automatic cleanup needed |
