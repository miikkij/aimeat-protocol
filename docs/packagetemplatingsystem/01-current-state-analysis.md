# Current State Analysis: Packages, Templates & Generator

**Date:** 2026-03-17
**Purpose:** Map the existing systems and identify the gap between generator output and package input.

---

## 1. Three Existing Systems

### 1.1 Generator (Client-Side Project Builder)

The generator is an AI-assisted service builder that creates complete AIMEAT services through an 8-phase pipeline:

1. **Project** — Name + description → metadata stored in Memory API
2. **Interview** — AI-driven requirements gathering → JSON spec
3. **Blueprint** — AI analyzes spec → component list + data model
4. **Component Generation** — Per-type prompt → AI produces code/YAML
5. **Validation** — Client-side extraction + error detection
6. **Fixing** — Retry with error context
7. **Task Queue** — Optional agent delegation via SSE
8. **Registration** — Components installed on AIMEAT node via native APIs

**Key characteristics:**
- Entirely client-side (no backend routes)
- State stored in Memory API at `generator.{projectId}.*` keys
- Supports 7 component types: CSM, MSM, Extension, Cortex, App, Memory, Translation
- Each component has: `id`, `type`, `label`, `status`, `result`, `validationErrors`, `registeredAs`
- Lifecycle management: activate/deactivate/remove/re-register

**Storage format (Memory keys):**
```
generator.{projectId}.project              → { projectId, name, description, status, blueprint, ... }
generator.{projectId}.interview-spec       → JSON spec
generator.{projectId}.component.blueprint  → { components: [], phases: [], dataModel: {} }
generator.{projectId}.component.{id}       → { id, type, label, status, result, registeredAs, ... }
```

### 1.2 Package System (Versioned Bundles)

Packages are versioned bundles of components stored in a dedicated storage layer:

**Data model (`PackageRecord`):**
- `id` (UUID per version), `packageGroupId` (`{name}::{author}`)
- `name`, `author`, `authorGhii`, `version` (`v{YYYY-MM-DD-HHmm}`)
- `description`, `category`, `tags`, `visibility`, `status`
- `components[]` — array of `PackageComponent` (id, type, label, content, contentHash, dependencies)
- `manifest` — full YAML bundle string
- `changelog`

**API routes (at `/v1/bundles/`):**
- CRUD for packages, versions, import/export
- Version lifecycle: draft → published → archived
- YAML export/import for portability
- Limits: max 10MB, max 20 components, max 50 per author

**Key characteristics:**
- Backend storage (SQLite + MongoDB)
- Versioned with date-time stamps
- Content hashing for change detection
- YAML export/import format
- Role-based creation (operator or owner)

### 1.3 Instance System (Installation Tracking)

Instances track installed copies of packages:

**Data model (`PackageInstanceRecord`):**
- Links to: `packageGroupId`, `packageVersion`, `packageRecordId`
- `owner`, `ownerGhii`, `label`
- `installedComponents[]` — maps componentId → registeredAs name, tracks originalHash + customized flag
- `status`: installed/paused/removed

**Key features:**
- Dependency-sorted installation via `component-registrar.ts`
- Customization detection (hash comparison)
- Update checking (current vs latest version diff)
- AI-assisted migration (two-phase prompt generation)
- Rollback on failure

### 1.4 Template System (Gallery Layer)

Templates are social/discovery listings for packages:

**Data model (`TemplateListingRecord`):**
- Links to `packageGroupId`
- `title`, `description`, `screenshots`, `category`, `tags`
- `featured`, `installCount`, `rating`, `reviewCount`
- Reviews and discussions (threaded)

---

## 2. The Gap

### What exists:
- **Generator** can create complete projects with all components and register them on a node
- **Package system** can store, version, export/import bundles and install them
- **Template system** can list packages for discovery

### What's missing:
1. **No bridge from generator → package** — A generated project cannot be packaged into a bundle
2. **No easy package creation UI** — Creating packages requires direct API calls with JSON/YAML
3. **No package update workflow** — Editing an existing package's components requires manual bundle assembly
4. **No round-trip** — Can't open a package back in the generator for editing
5. **No generator awareness of packages** — Generator doesn't know about the package system at all

### The vision:
Generator becomes the authoring tool for packages. The flow becomes:

```
Generator → Create Project → Generate Components → Register & Test
                ↓
         Package Project (new)
                ↓
    Template Gallery (publish for others)
                ↓
    Update Project → Re-package (version bump)
```

---

## 3. Data Format Comparison

### Generator component storage (Memory API):

```javascript
// generator.{projectId}.component.{id}
{
  id: "ext-ingest",
  type: "extension",
  label: "Alert Ingest Extension",
  status: "done",
  result: "--- manifest YAML + JS scripts ---",  // raw AI output
  validationErrors: [],
  registeredAs: "halytyskartta-owner1-ext-ingest",
  history: [{ action: "registered", at: "2026-03-16T..." }],
  _version: 5
}
```

### Package component storage (PackageRecord):

```typescript
// PackageComponent
{
  id: "ext-ingest",
  type: "extension",          // same type enum
  label: "Alert Ingest Extension",
  content: "{ manifest, scripts }", // processed content string
  contentHash: "sha256...",
  dependencies: ["csm-1"]
}
```

### Key differences:
| Aspect | Generator | Package |
|--------|-----------|---------|
| Storage | Memory API (key-value) | Dedicated repository |
| Content format | Raw AI output (`result`) | Processed content string |
| Versioning | Implicit (overwrite) | Explicit (date-time versions) |
| Dependencies | Not tracked | Explicit `dependencies[]` |
| Hashing | Not computed | SHA-256 `contentHash` |
| Metadata | `registeredAs`, `status`, `history` | `manifest` (YAML bundle) |
| Blueprint/spec | Separate memory keys | Not stored |

### What needs transformation:
1. Generator `result` (raw AI output) → Package `content` (processed string)
2. Add dependency tracking to generator components
3. Generate `contentHash` from processed content
4. Build `manifest` YAML from project metadata + components
5. Map generator `status` to package `status` (done → draft/published)

---

## 4. Component Registration Comparison

Both systems register components the same way (via `component-registrar.ts` / generator's `registerComponent()`), but with different formats:

| Type | Generator format | Package format |
|------|-----------------|----------------|
| CSM | YAML string | YAML or JSON string |
| MSM | YAML string | YAML or JSON string |
| Extension | `{ manifest: YAML, scripts: { name: code } }` parsed from result | JSON string of same structure |
| Cortex | `{ manifest: YAML, libs: [{ filename, code }] }` | JSON string of same structure |
| App | HTML string | HTML string |
| Memory | `{ key: value }` entries | `{ entries: [{ key, value, visibility }] }` |
| Translation | `{ locale: { key: value } }` | JSON string of same |

The generator already has validators (`generator-validate.js`) that extract and normalize content — this extraction step is the natural point for the bridge.

---

## 5. Existing Integration Points

### Shared infrastructure:
- Both use the same component types: `csm | extension | cortex | app | msm | memory | translation`
- Both store content as strings
- Both track component identity (id, type, label)
- Both systems live in the same SPA (profile view tabs)

### component-registrar.ts:
- Used by the instance system for package installation
- Could be reused by a generator → package bridge
- Already handles all 7 component types
- Already computes hashes

### YAML export/import:
- Package system already has a YAML bundle format
- Generator produces YAML for CSM, MSM, Extension manifests
- Import endpoint (`POST /v1/bundles/import`) can parse multi-document YAML

---

## 6. Summary of Findings

The generator and package system are **complementary but disconnected**. They share the same component model and registration mechanism, but operate in isolation. The generator is the natural authoring tool that the package system lacks, and the package system provides the versioning, distribution, and discovery features that the generator lacks. Bridging them is architecturally sound and doesn't require fundamental changes to either system.
