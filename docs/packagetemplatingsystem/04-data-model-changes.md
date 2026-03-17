# Data Model Changes & API Surface

**Date:** 2026-03-17
**Purpose:** Document all data model extensions and API changes needed for the bridge.

---

## 1. Generator Project Metadata Extensions

The generator project record (stored at `generator.{projectId}.project` in Memory API) needs these new optional fields:

```typescript
interface GeneratorProject {
  // ... existing fields ...
  projectId: string;
  name: string;
  description: string;
  status: 'new' | 'interview' | 'blueprint' | 'components' | 'registered' | 'archived';
  blueprint: Blueprint | null;
  createdAt: string;
  updatedAt: string;

  // NEW: Package link fields
  packageGroupId?: string;         // Link to package group (e.g., "halytyskartta::owner1")
  lastPackagedVersion?: string;    // Last version created (e.g., "v2026-03-17-1430")
  lastPackagedAt?: string;         // ISO 8601 timestamp
  sourceVersion?: string;          // If imported from package: which version
  sourcePackageGroupId?: string;   // If imported: original package group ID
}
```

**Impact:** Memory API only — no storage interface changes. These fields are stored as part of the JSON value in `generator.{projectId}.project`.

---

## 2. Generator Component Extensions

Generator components (stored at `generator.{projectId}.component.{id}`) need minimal additions:

```typescript
interface GeneratorComponent {
  // ... existing fields ...
  id: string;
  type: PackageComponentType;
  label: string;
  status: string;
  result: string | null;
  validationErrors: string[];
  validationWarnings: string[];
  registeredAs: string | null;
  history: ComponentHistoryEntry[];
  _version: number;

  // NEW: Dependency tracking (optional, inferred at packaging time)
  dependencies?: string[];         // Component IDs this depends on
}
```

**Impact:** Minimal — dependencies are inferred automatically during packaging. The field is optional and only used when explicitly set by the user.

---

## 3. No Backend Data Model Changes

The existing `PackageRecord`, `PackageComponent`, `PackageInstanceRecord`, and `TemplateListingRecord` interfaces in `src/storage/interface.ts` are **sufficient as-is**. No changes needed because:

- `PackageComponent.content` accepts any string (already handles all types)
- `PackageComponent.contentHash` is already SHA-256
- `PackageComponent.dependencies` is already `string[]`
- `PackageRecord.manifest` accepts any YAML string
- `PackageRecord.changelog` accepts free text

---

## 4. New Frontend Service: generator-packaging.js

**File:** `public/js/services/generator-packaging.js`

### Exports:

```javascript
// Content normalization
export function normalizeContent(type, result)        // Generator result → package content string
export function denormalizeContent(type, content)      // Package content → generator result
export async function computeContentHash(content)     // SHA-256 via Web Crypto API

// Packaging
export async function packageProject(projectId, options)          // Create new package from generator
export async function updatePackageVersion(projectId, options)    // New version of existing package
export async function detectChanges(generatorComponents, pkgComponents) // Diff

// Import
export async function importPackageToGenerator(groupId, version)  // Package → new generator project

// Publishing
export async function publishToGallery(projectId, options)        // Create template listing

// Helpers
export function inferDependencies(component, allComponents)       // Dependency inference
export function buildManifestYaml(project, components)            // YAML manifest generation
export function buildChangelog(changes, note)                     // Changelog from diff
export function reconstructBlueprint(components)                  // Blueprint from package
export function slugify(name)                                     // Name → slug
```

---

## 5. Content Normalization Matrix

How each component type is transformed between generator and package format:

### Generator → Package (normalizeContent)

| Type | Generator `result` | Transformation | Package `content` |
|------|-------------------|----------------|-------------------|
| CSM | YAML string (may have markdown fences) | Strip fences, clean YAML | Clean YAML string |
| MSM | YAML string (may have markdown fences) | Strip fences, clean YAML | Clean YAML string |
| Extension | Text with manifest + scripts blocks | Extract manifest + scripts via validator | `JSON.stringify({ manifest: "yaml", scripts: { "name": "code" } })` |
| Cortex | Text with manifest + lib blocks | Extract manifest + libs via validator | `JSON.stringify({ manifest: "yaml", libs: { "file.js": "code" } })` |
| App | HTML string (may have markdown fences) | Strip fences | Clean HTML string |
| Memory | JSON object `{ key: value }` | Wrap in entries format | `JSON.stringify({ entries: [{ key, value }] })` |
| Translation | JSON `{ locale: { strings } }` | Already correct format | `JSON.stringify(translations)` |

### Package → Generator (denormalizeContent)

| Type | Package `content` | Transformation | Generator `result` |
|------|-------------------|----------------|-------------------|
| CSM | YAML string | Pass through | YAML string |
| MSM | YAML string | Pass through | YAML string |
| Extension | JSON `{ manifest, scripts }` | Parse, reconstruct markdown format | Text with manifest + scripts blocks |
| Cortex | JSON `{ manifest, libs }` | Parse, reconstruct markdown format | Text with manifest + lib blocks |
| App | HTML string | Pass through | HTML string |
| Memory | JSON `{ entries: [...] }` | Parse, convert to `{ key: value }` | JSON object |
| Translation | JSON `{ locale: { strings } }` | Parse | JSON object |

---

## 6. Dependency Inference Rules

When packaging, dependencies are automatically inferred based on component types and relationships:

```
CSM         → no dependencies (foundation)
MSM         → depends on CSM (references schema)
Extension   → depends on CSM (validates against schema)
Memory      → depends on Extension (populated by extension)
Cortex      → depends on Extension (reads extension data)
App         → depends on Cortex (uses cortex library)
Translation → no dependencies (standalone i18n)
```

More specific rules:
1. If component's result references another component's `registeredAs` name → dependency
2. If blueprint specifies explicit dependencies → use those
3. Multiple components of same type → no inter-dependency

---

## 7. Manifest YAML Format

The packaging function generates a YAML manifest that serves as the package's metadata document:

```yaml
# Package manifest — auto-generated by AIMEAT Generator
name: halytyskartta
description: Finnish emergency alert monitoring and mapping service
author: owner1
category: public-safety
tags:
  - alerts
  - maps
  - finland
  - emergency
version: v2026-03-17-1430

components:
  - id: csm-1
    type: csm
    label: Alert Schema CSM
    dependencies: []

  - id: ext-ingest
    type: extension
    label: Alert RSS Ingest Extension
    dependencies:
      - csm-1

  - id: mem-config
    type: memory
    label: Alert Configuration Data
    dependencies:
      - ext-ingest

  - id: cortex-1
    type: cortex
    label: Alert Cortex Library
    dependencies:
      - ext-ingest

  - id: app-1
    type: app
    label: Alert Map Application
    dependencies:
      - cortex-1

  - id: i18n-1
    type: translation
    label: Alert Translations (EN/FI)
    dependencies: []

# Generator metadata (preserved for round-trip)
generator:
  projectId: prj-abc123
  interviewSpecVersion: 2
  blueprintVersion: 3
  generatedAt: "2026-03-17T14:30:00.000Z"
```

The `generator` section preserves metadata for round-trip editing. When importing a package into the generator, this section helps reconstruct the project state.

---

## 8. Changelog Format

Auto-generated changelogs from diff:

```
## v2026-03-17-1600

### Changes
- **Modified:** ext-ingest — Alert RSS Ingest Extension (content hash changed)
- **Added:** mem-geocoding — Geocoding Configuration
- **Removed:** mem-old-config — Old Configuration Data

### Notes
User-provided changelog note goes here.
```

---

## 9. SPA Importmap Entry

The new `generator-packaging.js` file needs an importmap entry in `public/spa.html`:

```json
"/js/services/generator-packaging.js": "/js/services/generator-packaging.js"
```

This ensures cache-busting via `BUILD_ID` stamping (per existing convention).

---

## 10. API Calls Used

All operations use **existing** API endpoints — no new backend routes:

| Operation | API Call | Existing? |
|-----------|----------|-----------|
| Create package | `POST /v1/bundles` | Yes |
| Create version | `POST /v1/bundles/{groupId}/versions` | Yes |
| Get package | `GET /v1/bundles/{groupId}` | Yes |
| Get version | `GET /v1/bundles/{groupId}/versions/{version}` | Yes |
| List packages | `GET /v1/bundles` | Yes |
| Create template | `POST /v1/templates` | Yes |
| Update template | `PATCH /v1/templates/{id}` | Yes |
| Get template by package | `GET /v1/templates?packageGroupId=...` | Needs filter |
| Save generator state | `POST/PUT /v1/memory` | Yes |
| Read generator state | `GET /v1/memory/{key}` | Yes |

### One potential backend addition:

The template listing API may need a `packageGroupId` filter parameter to check if a listing already exists for a package:

```typescript
// In TemplateFilter (src/storage/interface.ts):
export interface TemplateFilter {
  // ... existing fields ...
  packageGroupId?: string;  // NEW: filter by package group
}
```

This is a minor addition to the existing filter. Alternatively, the frontend can fetch all listings and filter client-side if the volume is low.
