# Risks, Considerations & Open Questions

**Date:** 2026-03-17
**Purpose:** Identify risks, edge cases, and decisions that need resolution before implementation.

---

## 1. Risks

### 1.1 Content Format Drift

**Risk:** The generator's raw AI output format may evolve separately from the package system's expected content format, causing packaging failures.

**Mitigation:**
- The normalization layer (`normalizeContent`/`denormalizeContent`) acts as an adapter
- Validators are the single source of truth for extraction
- Both packaging and registration use the same extraction functions
- Test suite covers round-trip (generator → package → generator)

### 1.2 Large Content Size

**Risk:** AI-generated components (especially apps with embedded CSS/JS) may exceed the 10MB package limit.

**Mitigation:**
- Show size estimate in packaging dialog before creating
- Warn if approaching limit
- Content is stored as strings — no binary overhead
- Typical generator outputs: CSM ~5KB, Extension ~20KB, App ~50KB, total ~200KB

### 1.3 Hash Inconsistency

**Risk:** Hashing raw AI output vs normalized content could produce different hashes, causing false "modified" detections.

**Mitigation:**
- Always hash the **normalized** content, never the raw result
- Same normalization function used at packaging time and update-checking time
- Unit tests for hash consistency

### 1.4 Concurrent Editing

**Risk:** Two sessions could package the same project simultaneously, creating duplicate versions.

**Mitigation:**
- Package API already prevents same-minute versions
- Generator's optimistic versioning (_version field) prevents concurrent project edits
- The packaging UI disables the button during the operation

### 1.5 Broken Round-Trip

**Risk:** A package imported into the generator, re-packaged, and compared might show phantom changes due to normalization differences.

**Mitigation:**
- Round-trip test: package → import → re-package → compare hashes
- Normalization must be idempotent: `normalize(denormalize(normalize(x))) === normalize(x)`
- Use JSON.stringify with sorted keys for deterministic hashing

---

## 2. Considerations

### 2.1 Interview Spec and Blueprint Preservation

**Question:** Should the interview spec and blueprint be included in the package?

**Proposal:** Yes, store them in the manifest's `generator` section:

```yaml
generator:
  projectId: prj-abc123
  interviewSpec: { ... }   # Full interview JSON
  blueprint: { ... }        # Full blueprint JSON
```

**Pros:**
- Full round-trip fidelity — importing recreates the complete generator state
- Future AI tools can re-analyze the spec for improvements
- Other users can see the design rationale

**Cons:**
- Increases manifest size (interview spec can be 5-10KB)
- Contains potentially sensitive requirements details

**Decision:** Include blueprint in manifest, make interview spec opt-in (checkbox in packaging dialog).

### 2.2 Registered Names and Namespacing

**Question:** Package components use `registeredAs` names that include owner info (e.g., `halytyskartta-owner1-ext-ingest`). When another user installs, they get a different name. Should the package store original names or template names?

**Current behavior:** Package `content` stores raw component content. The `registeredAs` name is generated at installation time by `component-registrar.ts` using the pattern `{packageName}-{owner}-{shortId}-{componentId}`.

**Proposal:** No change needed. The content is owner-agnostic. The `registeredAs` name is an installation artifact, not a package property. This already works correctly.

### 2.3 Memory Key Namespacing

**Question:** Generator memory keys use `{serviceSlug}.{key}` format. Package memory components use explicit keys in `entries[]`. Should packaging preserve the generator's namespacing?

**Proposal:** Yes. When normalizing memory content:
1. Read the generator component's `result` (which is `{ key: value }`)
2. Preserve service-prefixed keys as-is
3. Package stores them in `{ entries: [{ key: "service.key", value: ... }] }`
4. On install, `component-registrar.ts` stores with the exact keys

This means memory keys installed from a package will use the package author's namespace, not the installing user's. This is intentional — it ensures the extension and cortex can find the data at the expected keys.

### 2.4 Translation Merging

**Question:** If a user already has translations at `i18n.en`, installing a package that writes to the same key could overwrite existing translations.

**Current behavior:** `component-registrar.ts` stores translation at `i18n.{registeredAs}` — the `registeredAs` name is unique per installation, preventing collisions.

**Generator behavior:** Stores at `{serviceSlug}.i18n.{locale}` — also namespaced.

**Proposal:** Consistent behavior. Packages should use service-scoped translation keys, not global `i18n.*` keys.

### 2.5 Version Numbering

**Question:** Should packages created from the generator use the same date-time version format, or a semantic version?

**Current:** Date-time format `v{YYYY-MM-DD-HHmm}` — auto-generated, no user input.

**Proposal:** Keep date-time versions. They're sortable, unique, and don't require users to decide semver bump levels. The `changelog` field provides human-readable change descriptions.

---

## 3. Open Questions

### Q1: Should packaging auto-publish?

**Options:**
- A) Package as draft → user manually publishes → then creates template listing
- B) Package and publish in one step → user opts into template listing
- C) Package, publish, and create listing in one step

**Recommendation:** Option A (safe default). User explicitly controls visibility. The UI makes it easy to publish and list as follow-up actions.

### Q2: What about packages that weren't created by the generator?

Packages can be created via:
1. Direct API (`POST /v1/bundles`)
2. YAML import (`POST /v1/bundles/import`)
3. Generator packaging (proposed)

Should "Open in Generator" work for all packages, even those not created by the generator?

**Recommendation:** Yes. The `denormalizeContent` function handles all content formats. Packages without generator metadata simply skip the interview/blueprint reconstruction — the user starts at the component editing phase.

### Q3: Should we track which generator project a package came from?

**Recommendation:** Yes, bidirectionally:
- Generator project stores `packageGroupId` (forward link)
- Package manifest's `generator.projectId` section stores project ID (backward link)

This enables "Edit in Generator" from the packages view — it can find an existing generator project instead of creating a new import every time.

### Q4: What about deleted generator projects?

If a user deletes the generator project but the package still exists, "Edit in Generator" should create a new import (same as Flow 3 in UX document). The package is self-contained.

### Q5: Should components track which AI model generated them?

**Recommendation:** Nice-to-have, not required. The generator history already tracks actions — could add `model` to history entries. Not needed for the packaging bridge.

---

## 4. What We're NOT Doing

To keep scope manageable, the following are explicitly out of scope:

1. **Backend changes** — No new routes, storage interfaces, or database migrations
2. **Collaborative editing** — Multi-user generator projects are not in scope
3. **Automatic updates** — Packages update manually; no auto-push to instances
4. **Package diffing UI** — Detailed line-by-line content diffs (just component-level add/modify/remove)
5. **Generator AI integration** — No changes to prompt generation or AI interaction
6. **Admin dashboard** — No admin-side packaging tools (admin already has package management)
7. **Federation** — No cross-node package sharing (existing federation handles this)
8. **Package signing** — No cryptographic package verification (future consideration)

---

## 5. Success Criteria

The implementation is successful when:

1. A user can create a complete service in the generator and package it with 3 clicks
2. A user can open any package in the generator and edit its components
3. A user can update an existing package after making changes in the generator
4. Round-trip works: generator → package → import → edit → update → no phantom changes
5. All existing E2E tests still pass (no regressions)
6. New E2E tests cover the packaging/import/update flows
7. No backend changes were required
