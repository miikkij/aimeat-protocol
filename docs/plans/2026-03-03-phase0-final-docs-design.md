# Phase 0 Final Documentation Closure — Design

*2026-03-03 — Close the last 8% of Phase 0 with 4 documentation tasks*

---

## Goal

Phase 0 is functionally complete (all code, tests, endpoints working). Four documentation gaps remain. This plan closes them to bring Phase 0 to 100%.

## Tasks

### Task 1: OpenAPI Semantic Field Updates

**File:** `aimeat/openapi.yaml`

Add optional `semantic` field (referencing existing `SemanticAnnotation` schema) to:
- `MemoryEntry` response schema
- `BoardPost` response schema

Skip `ConsentRecord` — code doesn't support semantic on consents.

**Scope:** ~10 lines YAML

---

### Task 2: CSM Specification Document

**File:** `docs/csm-spec.md` (NEW, English, ~250 lines)

Formal CSM YAML reference derived from `src/services/csm-parser.ts` and `docs/plans/phase-0.2-csm.md`.

**Sections:**
1. Overview — what CSM is, purpose
2. YAML Structure — top-level keys (`csm`, `service`, `schema_mode`, `data_schema`, `consent_requirements`, `moderation`, `ui_hints`)
3. Service Types — 8 valid types: directory, marketplace, forum, dating, news, opinion, auction, media
4. Field Type System — CsmFieldDef: type, min, max, enum, format, items, properties, required
5. Consent Requirements — visibilityDefault, requiresConsent, consentPurpose, dataRetention
6. Moderation — flagsEnabled, autoHideThreshold, appealsEnabled
7. UI Hints — listView, detailView, searchFields, sortOptions, cardImageField
8. Semantic Annotations — optional @context, @type on service block
9. Validation Rules — summary of what `validateCsm()` enforces
10. Short example CSM

---

### Task 3: Interest Profile Specification

**File:** `docs/aimeat-interest-profile-spec.md` (NEW, English, ~150 lines)

Formal profile standard derived from `src/services/profile-schemas.ts`.

**Sections:**
1. Overview — standardized profile fields for AIMEAT nodes
2. Memory Key Pattern — `profile.{owner}.{field}`
3. Field Definitions — 6 fields: interests, location, bio, seeking, availability, languages (with JSON Schema constraints)
4. Schema Seeding — how `seedProfileSchemas()` locks fields at startup
5. Consent Model — granular vs full profile consent, scope options
6. Example — writing and reading a profile with consent

---

### Task 4: CSM Template Examples

**Directory:** `docs/csm-examples/` (NEW, 7 YAML files)

Templates from `docs/plans/phase-2.5-csm-templates.md` + manual:

| File | Service Type | Schema Mode |
|------|-------------|-------------|
| `hobby-directory.csm.yaml` | directory | open |
| `marketplace.csm.yaml` | marketplace | open |
| `dating-directory.csm.yaml` | dating | strict |
| `news-feed.csm.yaml` | news | open |
| `opinion-board.csm.yaml` | opinion | open |
| `auction.csm.yaml` | auction | strict |
| `video-directory.csm.yaml` | media | open |

Each ~60-80 lines, valid CSM YAML passing the parser.

---

## Execution Order

All 4 tasks are independent. Can run in parallel.

## Verification

After all tasks:
1. `cd aimeat && npx tsc --noEmit` — still clean
2. CSM examples should parse: quick sanity check via test or manual validation
