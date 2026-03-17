# Forking & Generator Context Preservation

**Date:** 2026-03-17
**Purpose:** Define how forking works and why all generator context must travel inside the package to enable prompt-driven editing of forked packages.

---

## 1. The Problem

When a user opens someone else's package in the generator and wants to edit/improve it, the generator's prompt system needs **full project context** to produce correct AI prompts. Without this context, the prompts are blind — they don't know:

- What the service does (project description)
- What requirements were gathered (interview spec)
- What data shapes exist (blueprint with dataModel)
- How components depend on each other (produces/consumes graph)
- What data sources are involved (URLs, encodings, sample data)
- What scheduled jobs exist (cron schedules)
- What locale the service targets
- What completed components look like (for downstream prompts)

The prompt builder functions consume all of this:

| Prompt Function | Context Required |
|----------------|-----------------|
| `buildBlueprintPrompt()` | description, interviewSpec, availableCortexLibs |
| `buildInterviewPrompt()` | description, locale |
| `buildComponentPrompt()` | type, label, description, blueprint (components + dataModel), completedComponents (with full results for ext/cortex), interviewSpec (dataSources, locale, staticData) |
| `buildEditPrompt()` | type, label, currentCode, changeRequest, upstreamChanges |
| `buildImpactPrompt()` | changeRequest, blueprint (components with produces/consumes) |
| `buildFixPrompt()` | originalPrompt, failedResult, errors |

**If any of this context is missing, the generated prompts will be generic and low-quality — defeating the purpose of the generator.**

---

## 2. What Must Be Stored in the Package

The package's `manifest` field must carry all generator context needed to reconstruct a fully-functional generator project. This is the **generator metadata** section:

### 2.1 Required Context (must always be included)

```yaml
generator:
  # Project identity
  projectId: prj-abc123
  generatedAt: "2026-03-17T14:30:00.000Z"

  # Service description (used in all prompts)
  description: >
    Finnish emergency alert monitoring service that shows active alerts
    on a real-time map with filtering by region and severity.

  # Blueprint (component graph + data model)
  blueprint:
    components:
      - id: csm-1
        type: csm
        label: Alert Schema CSM
        produces: ["memory:alerts.schema"]
        consumes: []
      - id: ext-ingest
        type: extension
        label: Alert RSS Ingest Extension
        produces: ["memory:alerts.by-date.*", "memory:stats.daily"]
        consumes: ["memory:settings.config", "memory:lookup.regions"]
        schedules:
          - action: collect
            cron: "*/15 * * * *"
          - action: init
            cron: "@activate"
      - id: cortex-1
        type: cortex
        label: Alert Cortex Library
        produces: ["api:getAlerts", "api:getStats", "api:getRegions"]
        consumes: ["memory:alerts.by-date.*", "memory:lookup.regions", "memory:i18n.fi"]
      - id: app-1
        type: app
        label: Alert Map Application
        produces: []
        consumes: ["api:getAlerts", "api:getStats", "api:getRegions"]

    phases:
      - id: define
        label: Define Service
        componentIds: [csm-1]
      - id: seed
        label: Seed Data
        componentIds: [memory-1, memory-2, translation-1]
      - id: logic
        label: Build Logic
        componentIds: [ext-ingest]
      - id: connect
        label: Connect & Integrate
        componentIds: [cortex-1]
      - id: ui
        label: Build UI
        componentIds: [app-1]

    dataModel:
      alerts.by-date.YYYY-MM-DD:
        type: array
        items:
          type: object
          properties:
            id: { type: string }
            title: { type: string }
            severity: { type: string, enum: [low, medium, high, critical] }
            region: { type: string }
            coordinates: { type: object, properties: { latitude: { type: number }, longitude: { type: number } } }
            timestamp: { type: string }
        source: external
        producedBy: ext-ingest
        consumedBy: [cortex-1]
      settings.config:
        type: object
        properties:
          refreshMinutes: { type: number }
          defaultLocale: { type: string }
          feedUrl: { type: string }
        source: config
        producedBy: memory-2
        consumedBy: [ext-ingest, cortex-1]
      lookup.regions:
        type: array
        items:
          type: object
          properties:
            code: { type: string }
            name: { type: string }
        source: static
        producedBy: memory-1
        consumedBy: [ext-ingest, cortex-1]

  # Interview spec (gathered requirements)
  interviewSpec:
    locale: fi
    useCases:
      - View active emergency alerts on a map
      - Filter alerts by region and severity
      - See alert trends over time
    audience:
      type: multi-user
      scale: local
    dataSources:
      - name: Finnish Emergency Alerts
        type: rss
        url: "https://alerts.example.fi/feed.rss"
        encoding: UTF-8
        verifiedBy: user
        sampleEntry: |
          <item>
            <title>Tulvavaroitus — Uusimaa</title>
            <pubDate>Mon, 17 Mar 2026 10:30:00 +0200</pubDate>
            <category>Flood</category>
            <geo:lat>60.1699</geo:lat>
            <geo:long>24.9384</geo:long>
          </item>
      - name: Region lookup
        type: user-input
        staticData:
          - { code: "uusimaa", name: "Uusimaa" }
          - { code: "pirkanmaa", name: "Pirkanmaa" }
          - { code: "varsinais-suomi", name: "Varsinais-Suomi" }
    views:
      - type: map
        description: Real-time alert map with markers
      - type: list
        description: Filterable alert list
      - type: dashboard
        description: Alert statistics and trends
    constraints:
      realTime: true
      offlineSupport: false
      locales: [fi, en]
    style:
      theme: clean, professional
      primaryColor: "#0047AB"
```

### 2.2 Why Each Piece Matters

| Context | Used By | What Breaks Without It |
|---------|---------|----------------------|
| `description` | All prompts | AI doesn't know what the service does; generates generic code |
| `blueprint.components` | `buildComponentPrompt`, `buildImpactPrompt` | AI doesn't know sibling components; can't track produces/consumes |
| `blueprint.dataModel` | `buildComponentPrompt` | AI invents its own data shapes instead of following the contract; memory keys won't match between components |
| `blueprint.phases` | Generator UI | Components shown in flat list instead of logical phases |
| `blueprint.components[].schedules` | Extension prompt | Scheduled jobs missing from manifest; extension won't collect data |
| `blueprint.components[].produces/consumes` | All prompts | AI can't trace data flow; components won't connect properly |
| `interviewSpec.dataSources` | Extension prompt | AI doesn't know URLs, encodings, sample data; writes broken parsers |
| `interviewSpec.dataSources[].sampleEntry` | Extension prompt | Parser code guesses at XML/JSON structure; runtime failures |
| `interviewSpec.dataSources[].staticData` | Memory prompt | Static lookup tables missing; extension can't enrich data |
| `interviewSpec.locale` | All prompts | UI strings in wrong language; labels mismatch user expectations |
| `interviewSpec.views` | Blueprint prompt | If re-blueprinting, AI doesn't know what views to build |
| `interviewSpec.style` | App prompt | App styling doesn't match requirements |

---

## 3. Forking Flow (Detailed)

### Scenario: User B opens User A's package and creates a fork

```
User A creates "halytyskartta" → packages it → publishes
                                      ↓
User B browses gallery → opens "halytyskartta" in generator
                                      ↓
Generator creates new project:
  - name: "halytyskartta" (user can rename)
  - description: from package manifest generator.description
  - blueprint: from package manifest generator.blueprint
  - interviewSpec: from package manifest generator.interviewSpec
  - components: from package components (denormalized to generator format)
  - packageGroupId: NOT set (this is a fork, not an edit of the original)
  - forkedFrom: { packageGroupId: "halytyskartta::userA", version: "v2026-03-17-1430" }
                                      ↓
User B edits component ext-ingest:
  1. Clicks "Generate Prompt" on ext-ingest
  2. buildComponentPrompt() has FULL context:
     - description ✓ (from generator metadata)
     - blueprint with dataModel ✓ (from generator metadata)
     - completedComponents with results ✓ (from package components)
     - interviewSpec with sampleEntry ✓ (from generator metadata)
  3. AI prompt is context-rich and produces correct code
                                      ↓
User B clicks "Package as Template"
  - Creates NEW package: "halytyskartta::userB" (different author → different groupId)
  - Package manifest includes User B's updated generator metadata
  - forkedFrom preserved in manifest for attribution
                                      ↓
User C can later fork User B's version, with full context preserved
```

### Key Principle: Context Travels with the Package

Every fork carries the complete generator context. The chain of forks maintains full prompt fidelity:

```
Original (User A) → Fork (User B) → Fork (User C)
     ↑                    ↑                ↑
  Full context        Full context     Full context
  (original)       (B's edits)      (C's edits)
```

Each fork gets its own interview spec, blueprint, and description — the forking user can modify any of these to diverge from the original.

---

## 4. Updating the Interview Spec in a Fork

When editing a forked package, the user might need to change requirements:

### Option A: Re-Interview (full reset)
User runs a new interview from scratch. The blueprint and all components become stale.

### Option B: Edit Interview Spec (surgical)
The generator UI should allow direct editing of the interview spec JSON:
- Add/remove data sources
- Change locale
- Modify views
- Update constraints

After editing the spec, the user can:
1. Re-run blueprint generation (updates component graph)
2. Re-generate affected components (uses updated spec)

### Option C: Keep Spec, Edit Components Only
The user keeps the original spec and blueprint but edits individual component results directly. This is the most common fork scenario — changing implementation details without changing requirements.

---

## 5. Completed Components as Prompt Context

A critical detail: `buildComponentPrompt()` injects **full code of completed extension and cortex components** into downstream prompts. This is how the app prompt knows what cortex API methods exist, and how cortex knows what memory keys the extension writes.

When importing a package into the generator, ALL component results must be populated so that:

1. Editing `app-1` → prompt includes cortex-1's full code → AI knows exact API surface
2. Editing `cortex-1` → prompt includes ext-ingest's full code → AI knows exact memory keys
3. Editing `ext-ingest` → prompt includes dataModel → AI knows exact schemas

### Package → Generator component reconstruction:

```javascript
// When importing, populate ALL components as "done" with their content
for (const comp of pkg.components) {
  const result = denormalizeContent(comp.type, comp.content);
  await saveComponent(projectId, {
    id: comp.id,
    type: comp.type,
    label: comp.label,
    status: 'done',
    result,  // CRITICAL: this is what buildComponentPrompt reads for upstream context
    registeredAs: null,  // not installed yet on this node
    ...
  });
}
```

Without `result` populated, `buildComponentPrompt` has no upstream code to inject and the AI will generate components that don't match each other.

---

## 6. Manifest Size Implications

The generator metadata adds significant content to the package manifest:

| Section | Typical Size | Notes |
|---------|-------------|-------|
| `description` | 0.1-0.5 KB | Short text |
| `blueprint.components` | 1-3 KB | 5-10 components with produces/consumes |
| `blueprint.dataModel` | 2-10 KB | JSON Schema for all memory keys |
| `blueprint.phases` | 0.2 KB | Phase groupings |
| `interviewSpec` (without staticData) | 2-5 KB | Use cases, views, constraints, data sources |
| `interviewSpec.dataSources[].staticData` | 0-50 KB | Can be large for lookup tables |
| `interviewSpec.dataSources[].sampleEntry` | 0.1-2 KB | Sample XML/JSON per source |
| **Total generator metadata** | **5-70 KB** | Well within 10MB package limit |

### Optimization: Static Data

Large static datasets (`staticData` arrays with 100+ entries) could be stored as a separate package component (type: `memory`) rather than duplicated in both the manifest and the memory component content. The manifest would reference the component ID instead:

```yaml
dataSources:
  - name: Region lookup
    type: user-input
    staticDataComponent: memory-1  # reference instead of inline
```

This avoids duplicating large datasets in both `generator.interviewSpec.dataSources[].staticData` and the `memory-1` component content.

---

## 7. Updated Data Model for Forking

### Generator project additions:

```typescript
interface GeneratorProject {
  // ... existing fields ...

  // Package link (for owned packages)
  packageGroupId?: string;
  lastPackagedVersion?: string;
  lastPackagedAt?: string;

  // Fork tracking (for forked packages)
  forkedFrom?: {
    packageGroupId: string;   // original package group
    version: string;          // version that was forked
    author: string;           // original author
  };

  // Import source (for any package import)
  sourceVersion?: string;
  sourcePackageGroupId?: string;
}
```

### Package manifest generator section:

```yaml
generator:
  projectId: string             # generator project ID
  generatedAt: string           # ISO 8601
  description: string           # full project description
  blueprint: object             # full blueprint (components, phases, dataModel)
  interviewSpec: object | null  # full interview spec (opt-in at packaging time)
  forkedFrom:                   # if this package is a fork
    packageGroupId: string
    version: string
    author: string
```

---

## 8. Fork Attribution Chain

Each package manifest records its lineage. This enables:
- **Attribution:** "Based on halytyskartta by userA"
- **Discovery:** "See all forks of this package"
- **Diffing:** Compare a fork against its parent to see what changed

```yaml
# User A's original
generator:
  forkedFrom: null

# User B's fork of A
generator:
  forkedFrom:
    packageGroupId: "halytyskartta::userA"
    version: "v2026-03-17-1430"
    author: "userA"

# User C's fork of B
generator:
  forkedFrom:
    packageGroupId: "halytyskartta::userB"
    version: "v2026-03-18-0900"
    author: "userB"
```

### Future: Fork Graph API (out of scope for now)

A future API could traverse fork chains: `GET /v1/bundles/{groupId}/forks` → list all packages that declare `forkedFrom` pointing to this group. This is a read-only query over existing manifest data.

---

## 9. Edge Cases

### Missing generator metadata in older packages

Packages created before this feature won't have the `generator` section in their manifest. When importing:
- `description` → fall back to `PackageRecord.description`
- `blueprint` → reconstruct from component types (as described in architecture proposal)
- `interviewSpec` → null (prompts work without it, just less context-rich)
- Components still import correctly — only prompt quality is reduced

### Very large interview specs

If `interviewSpec` exceeds 50KB (e.g., massive static datasets):
- Strip `staticData` arrays from the manifest
- Store them as separate memory components
- Reference by component ID in the spec

### Forking a fork

Works identically — `forkedFrom` always points to the immediate parent, not the original ancestor. The full chain can be traversed by following `forkedFrom` pointers.

### Same-name fork collision

`packageGroupId` = `{name}::{author}` — different authors automatically get different group IDs. User B forking "halytyskartta" creates `halytyskartta::userB`, not a collision with `halytyskartta::userA`.

If the same user forks their own package (wanting a variant), they must rename: "halytyskartta-v2" → `halytyskartta-v2::userA`.

---

## 10. Summary

**The core insight:** The generator's prompt system is context-dependent. Without full context (description, blueprint, dataModel, interviewSpec, completed component results), the prompts degrade to generic instructions that produce components which don't fit together.

**The solution:** Store all generator context in the package manifest's `generator` section. When anyone — the original author or a forking user — opens the package in the generator, the full context is reconstructed and prompts work at full fidelity.

**The cost:** 5-70KB of additional manifest data. Well within limits.

**The benefit:** Packages become truly editable and forkable. The generator becomes the universal authoring tool for packages. Anyone can take any package, understand it, improve it, and re-publish — with AI-assisted prompts that have full context about what the service does and how its components connect.
