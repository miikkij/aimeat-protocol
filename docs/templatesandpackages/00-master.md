# Templates & Packages System — Master Document

**Date:** 2026-03-15
**Status:** Draft
**System:** AIMEAT Protocol Reference Implementation

---

## Executive Summary

This document suite describes the design and implementation plan for AIMEAT's **Templates & Packages System** — a three-tier architecture enabling bundled, versioned, installable service packages with an optional discovery gallery.

**The problem:** AIMEAT has powerful building blocks (CSM, Extensions, Cortex, Apps, Memory, MSM, Translations) but no way to bundle them into a single installable unit. Users must manually create each component to deploy a complete service.

**The solution:** Three new systems:

1. **Package System** — Versioned bundles of AIMEAT components. Each version is an immutable record. Operators (and optionally owners) create packages. Users install packages as instances — real copies of all components, fully owned and customizable.

2. **Template System** — A social/discovery layer on top of packages. Gallery with ratings, reviews, discussions, screenshots, featured listings. Separate from packages — packages can be used without templates.

3. **Instance System** — Tracks installed copies of packages. Links back to the source package and version. Detects user customizations via content hashing. Supports two-phase AI-assisted migration when package authors publish updates.

**First example:** A "Digital Signage" package for residential building corridor displays — resident directory, announcements with QR codes, advertisements, configurable display rotation, kiosk mode. 6 components, 0 extensions (all client-side via Memory API + Cortex).

---

## Document Index

| # | Document | Purpose |
|---|----------|---------|
| 01 | [Requirements](./01-requirements.md) | Problem statement, goals, user stories, scope, non-functional requirements, digital signage example |
| 02 | [Analysis](./02-analysis.md) | Existing systems inventory, gap analysis, storage architecture decision, component relationship map, decision framework, risks |
| 03 | [Specifications](./03-specifications.md) | Data model, API endpoints, configuration, storage interfaces, migration prompt spec, YAML manifest format, security |
| 04 | [Implementation Plan](./04-implementation-plan.md) | 6-phase plan with tasks, files, SQL schemas, testing strategy |

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage approach | Own repositories (not Memory-based) | Proper queries, transactions, follows established pattern |
| Repository count | 3 separate (Package, Template, Instance) | Clear separation of concerns: technical, social, tracking |
| Version storage | One PackageRecord per version, grouped by packageGroupId | Immutable history, no data loss, easy rollback |
| Version format | `v{YYYY}-{MM}-{DD}-{HHmm}` | Sortable, human-readable, shows creation time |
| Instance model | Real copies (fork, not reference) | User fully owns components, can modify freely |
| Migration approach | Two-phase AI prompts (analyze → merge) | Preserves user customizations, handles conflicts gracefully |
| Extension inclusion | Only when server-only work needed | Follows generator decision framework: "Extension = server-only work" |
| Role access | Configurable via `AIMEAT_PACKAGE_CREATE_ROLE` | Operator always, owner if configured |

---

## Governing Documents & Rules

This system MUST comply with all rules and guidelines defined in the project. Key references:

### CLAUDE.md Mandatory Rules

| Rule | Application to This System |
|------|---------------------------|
| **Rule 1: E2E Tests** | All phases must include E2E tests. Run `pnpm test:e2e:mongodb` and `pnpm test:e2e:sqlite` after each phase. New features must include quality E2E tests. |
| **Rule 1b: Playwright Tests** | After frontend phase (Phase 6), run `npx playwright test`. New tabs must have browser tests. |
| **Rule 2: File Headers** | All new `.ts`, `.js`, `.css` files must have `@file`, `@description`, `@version-history` headers. |
| **Rule 3: OpenAPI Sync** | All new API endpoints must be documented in `openapi.yaml` in the same phase they are implemented. |
| **Rule 4: i18n Sync** | All new translation keys in both `locales/en.json` and `locales/fi.json` simultaneously. |
| **Rule 5: Dependencies** | Check license before adding any new npm package. Prefer existing dependencies. |
| **Rule 6: ESLint** | All code must pass `pnpm lint`. |

### Coding Guidelines

| Guide | Application |
|-------|------------|
| [Architecture](../coding-guidelines/architecture.md) | New repositories follow existing storage layer patterns |
| [Storage Sync](../coding-guidelines/storage-sync.md) | SQLite + MongoDB implementations required for all new repos |
| [Code Style](../coding-guidelines/code-style.md) | TypeScript strict mode, ESM imports with `.js` extensions |
| [Security](../coding-guidelines/security.md) | Auth middleware on protected endpoints, input validation |
| [Testing Requirements](../coding-guidelines/testing-requirements.md) | Multi-backend testing, test isolation, GDPR compliance |
| [Frontend Guide](../frontend-development-guide.md) | Preact + HTM, admin `adm-*` CSS prefix, tab conventions |

### Existing Design Documents

| Document | Relationship |
|----------|-------------|
| [Generator V2 Interview & Cortex](../plans/2026-03-14-generator-v2-interview-cortex.md) | Generator could output packages in future |
| [Generator Prompt Hardening](../plans/2026-03-15-generator-prompt-hardening.md) | Extension vs Cortex decision framework applies to packages |
| [CSM-Driven Services](../plans/2026-03-04-csm-driven-services-and-node-extensions-design.md) | CSM as foundation for service packages |
| [Cortex Extensions V2](../plans/2026-03-05-cortex-extensions-v2-design.md) | Cortex manifest format used in packages |
| [Service Extensions & Marketplace](../plans/2026-03-07-service-extensions-and-marketplace.md) | Extension multi-instance pattern |

### Backend Architecture Rule

**No SSR in routes.** Package and template routes return JSON only. All UI is in the Preact SPA (`public/views/`). This is consistent with the backend architecture rule in CLAUDE.md.

### Naming Convention

All new types use `Aimeat` prefix where applicable. No `Meat` prefix. GHII for human identifiers, GAII for agent identifiers.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                            │
│  ┌────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ Profile Tab:   │  │ Admin Tab:       │  │ Template        │  │
│  │ My Instances   │  │ All Packages     │  │ Gallery         │  │
│  │ Available Pkgs │  │ Template Mgmt    │  │ (within profile │  │
│  │ Manage/Migrate │  │ All Instances    │  │  or standalone) │  │
│  └───────┬────────┘  │ Configuration    │  └────────┬────────┘  │
│          │           └───────┬──────────┘           │           │
└──────────┼───────────────────┼──────────────────────┼───────────┘
           │                   │                      │
           ▼                   ▼                      ▼
┌──────────────────────────────────────────────────────────────────┐
│                          API LAYER                                │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ /v1/packages    │  │ /v1/instances    │  │ /v1/templates  │  │
│  │ CRUD + versions │  │ install, status  │  │ gallery, reviews│  │
│  │ export, import  │  │ migrate, remove  │  │ discussions    │  │
│  └────────┬────────┘  └────────┬─────────┘  └───────┬────────┘  │
└───────────┼────────────────────┼────────────────────┼────────────┘
            │                    │                     │
            ▼                    ▼                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                        STORAGE LAYER                              │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ Package         │  │ PackageInstance  │  │ TemplateListing│  │
│  │ Repository      │  │ Repository      │  │ Repository     │  │
│  └─────────────────┘  └──────────────────┘  └────────────────┘  │
│                                                                   │
│  Backends: SQLite (personal/dev) | MongoDB (production)           │
└──────────────────────────────────────────────────────────────────┘
            │
            │ Install flow uses existing component APIs:
            ▼
┌──────────────────────────────────────────────────────────────────┐
│                    EXISTING COMPONENT APIS                         │
│  POST /v1/csm  │  POST /v1/extensions  │  POST /v1/cortex       │
│  POST /v1/apps │  POST /v1/msm         │  POST /v1/memory       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Implementation Order

```
Phase 1: Storage ──► Phase 2: Package API ──► Phase 3: Instance API
                                │                      │
                                ▼                      ▼
                          Phase 5: Template API  Phase 4: Migration API
                                │                      │
                                └──────────┬───────────┘
                                           ▼
                                    Phase 6: Frontend
                                           │
                                           ▼
                                 Post-launch: Digital
                                 Signage Example Package
```

---

## Success Criteria

1. **Package round-trip works:** Create package → publish version → install instance → all components functional
2. **Version immutability:** Every version permanently stored, no overwrites
3. **Customization detection:** System correctly identifies which components user has modified
4. **Migration prompts are accurate:** Analyze-prompt correctly identifies user changes, migrate-prompt produces valid merge
5. **Template gallery functions:** Listings, search, filter, sort, reviews, discussions all work
6. **Role enforcement:** `packageCreateRole` correctly restricts package creation
7. **Both backends pass:** All E2E tests pass on both SQLite and MongoDB
8. **Digital signage works end-to-end:** Install → configure → kiosk mode → update → migrate
