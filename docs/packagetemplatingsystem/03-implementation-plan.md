# Implementation Plan: Generator ↔ Package Bridge

**Date:** 2026-03-17
**Purpose:** Step-by-step plan for implementing the bridge between generator and package systems.

---

## Phase 1: Content Normalization Layer

**Goal:** Extract and normalize generator component results into package-compatible content strings.

### Task 1.1: Export extraction functions from generator-validate.js

The validator already extracts structured data from raw AI output. Expose these as reusable functions:

**File:** `public/js/services/generator-validate.js`

```javascript
// Already exists internally — make exportable:
export function extractCsmContent(result) { ... }    // → clean YAML string
export function extractMsmContent(result) { ... }    // → clean YAML string
export function extractExtensionContent(result) { ... }  // → { manifest, scripts }
export function extractCortexContent(result) { ... }     // → { manifest, libs }
export function extractAppContent(result) { ... }        // → clean HTML string
export function extractMemoryContent(result) { ... }     // → { entries: [...] }
export function extractTranslationContent(result) { ... } // → { en: {...}, fi: {...} }
```

### Task 1.2: Create content normalizer

**File:** `public/js/services/generator-packaging.js` (new file)

```javascript
/**
 * Normalize a generator component result into a package content string.
 * Uses validator extraction + JSON.stringify for structured types.
 */
export function normalizeContent(type, result) { ... }

/**
 * Reverse: convert package content string back to generator result format.
 */
export function denormalizeContent(type, content) { ... }

/**
 * Compute SHA-256 hash of content string (browser crypto API).
 */
export async function computeContentHash(content) { ... }
```

**Estimated scope:** ~150 lines, new file

---

## Phase 2: Package Creation from Generator

**Goal:** Add "Package this project" functionality to the generator.

### Task 2.1: Add packaging function to generator-packaging.js

```javascript
/**
 * Package a generator project into a bundle.
 * @param {string} projectId
 * @param {object} options - { visibility, category, tags }
 * @returns {object} - created package data
 */
export async function packageProject(projectId, options = {}) {
  const project = await getProject(projectId);
  const components = await loadAllComponents(projectId);
  const packageable = components.filter(c => c.status === 'done' && c.result);

  if (packageable.length === 0) throw new Error('No completed components to package');

  // Normalize all components
  const pkgComponents = await Promise.all(packageable.map(async comp => {
    const content = normalizeContent(comp.type, comp.result);
    return {
      id: comp.id,
      type: comp.type,
      label: comp.label,
      content,
      contentHash: await computeContentHash(content),
      dependencies: inferDependencies(comp, packageable),
    };
  }));

  // Collect full generator context for prompt fidelity in forks
  const interviewSpec = await getInterviewSpec(projectId);
  const generatorMetadata = {
    projectId,
    generatedAt: new Date().toISOString(),
    description: project.description,
    blueprint: project.blueprint,
    interviewSpec: options.includeInterviewSpec !== false ? interviewSpec : null,
    forkedFrom: project.forkedFrom || null,
  };

  // Build manifest YAML with embedded generator context
  const manifest = buildManifestYaml(project, pkgComponents, generatorMetadata);

  // Create package via API
  const result = await createPackage({
    name: slugify(project.name),
    description: project.description,
    category: options.category || 'utility',
    tags: options.tags || [],
    visibility: options.visibility || 'private',
    components: pkgComponents,
    manifest,
  });

  // Link package to generator project
  await updateProject(projectId, {
    packageGroupId: result.data?.packageGroupId,
    lastPackagedVersion: result.data?.version,
    lastPackagedAt: new Date().toISOString(),
  });

  return result;
}
```

### Task 2.2: Add "Package" button to generator-tab.js

In the generator detail view, when all components are "done" and registered:

- Show "Package as Template" button
- If project already has `packageGroupId`: show "Update Package" button instead
- On click: show dialog with category/tags/visibility selection
- On confirm: call `packageProject()` or `updatePackageVersion()`
- On success: show link to the created package

### Task 2.3: Add i18n keys

```json
{
  "profile.generator.packageProject": "Package as Template",
  "profile.generator.updatePackage": "Update Package",
  "profile.generator.packageSuccess": "Package created successfully",
  "profile.generator.packageUpdateSuccess": "Package updated to version {version}",
  "profile.generator.packageCategory": "Category",
  "profile.generator.packageTags": "Tags",
  "profile.generator.packageVisibility": "Visibility",
  "profile.generator.noComponentsToPackage": "No completed components to package",
  "profile.generator.changesSummary": "Changes since last version",
  "profile.generator.changeAdded": "Added",
  "profile.generator.changeModified": "Modified",
  "profile.generator.changeRemoved": "Removed",
  "profile.generator.changeUnchanged": "Unchanged"
}
```

**Estimated scope:** ~100 lines in generator-packaging.js, ~80 lines in generator-tab.js, ~20 i18n keys

---

## Phase 3: Package Update from Generator

**Goal:** Allow updating existing packages when generator components change.

### Task 3.1: Add update function to generator-packaging.js

```javascript
/**
 * Create a new version of an existing package from generator project.
 * Shows diff of what changed since last packaged version.
 */
export async function updatePackageVersion(projectId, options = {}) {
  const project = await getProject(projectId);
  if (!project.packageGroupId) throw new Error('Project not linked to a package');

  const currentPkg = await getPackage(project.packageGroupId);
  const components = await loadAllComponents(projectId);
  const packageable = components.filter(c => c.status === 'done' && c.result);

  // Detect changes
  const changes = await detectChanges(packageable, currentPkg.components);

  // Build new components
  const pkgComponents = await buildPackageComponents(packageable);
  const manifest = buildManifestYaml(project, pkgComponents);
  const changelog = buildChangelog(changes, options.changelogNote);

  // Create new version
  const result = await createVersion(project.packageGroupId, {
    description: project.description,
    category: options.category || currentPkg.category,
    tags: options.tags || currentPkg.tags,
    components: pkgComponents,
    manifest,
    changelog,
  });

  await updateProject(projectId, {
    lastPackagedVersion: result.data?.version,
    lastPackagedAt: new Date().toISOString(),
  });

  return { result, changes };
}

/**
 * Compare generator components against packaged version.
 */
export async function detectChanges(generatorComponents, packageComponents) { ... }
```

### Task 3.2: Add change diff UI in generator-tab.js

When "Update Package" is clicked:
1. Call `detectChanges()` to get diff
2. Show summary: N added, N modified, N removed, N unchanged
3. User enters optional changelog note
4. Confirm → `updatePackageVersion()`

**Estimated scope:** ~80 lines in generator-packaging.js, ~60 lines in generator-tab.js

---

## Phase 4: Import Package into Generator

**Goal:** Open any package in the generator for editing.

### Task 4.1: Add import function to generator-packaging.js

```javascript
/**
 * Import a package into a new generator project.
 * @param {string} groupId - package group ID
 * @param {string} [version] - specific version (default: latest published)
 * @returns {string} - new project ID
 */
export async function importPackageToGenerator(groupId, version) {
  const pkg = version
    ? await getPackageVersion(groupId, version)
    : await getPackage(groupId);

  // Create generator project
  const projectId = genId();
  // Extract generator metadata from manifest (if present)
  const genMeta = parseGeneratorMetadata(pkg.manifest);

  const project = {
    projectId,
    name: pkg.name,
    description: genMeta?.description || pkg.description,
    status: 'components',
    blueprint: genMeta?.blueprint || reconstructBlueprint(pkg.components),
    // Only link to package if this is the author's own package
    // (fork = no link, edit = link)
    packageGroupId: isOwnPackage ? pkg.packageGroupId : undefined,
    sourceVersion: pkg.version,
    sourcePackageGroupId: pkg.packageGroupId,
    forkedFrom: isOwnPackage ? undefined : {
      packageGroupId: pkg.packageGroupId,
      version: pkg.version,
      author: pkg.author,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Restore interview spec if present in manifest
  if (genMeta?.interviewSpec) {
    await saveInterviewSpec(projectId, genMeta.interviewSpec);
  }

  await saveProject(project);

  // Create generator components
  for (const comp of pkg.components) {
    await saveComponent(projectId, {
      id: comp.id,
      type: comp.type,
      label: comp.label,
      status: 'done',
      result: denormalizeContent(comp.type, comp.content),
      validationErrors: [],
      validationWarnings: [],
      registeredAs: null,
      history: [{
        action: 'imported_from_package',
        at: new Date().toISOString(),
        by: 'system',
        meta: { packageGroupId: pkg.packageGroupId, version: pkg.version },
      }],
      _version: 0,
    });
  }

  return projectId;
}
```

### Task 4.2: Add "Open in Generator" button to packages-tab.js

In the packages browse view, for each package:
- Show "Open in Generator" action button
- On click: call `importPackageToGenerator()` → navigate to generator tab with new project

In the instances view, for each instance:
- Show "Edit in Generator" action button
- Same flow but also links to the instance for update tracking

### Task 4.3: Add i18n keys for import

```json
{
  "profile.packages.openInGenerator": "Open in Generator",
  "profile.packages.editInGenerator": "Edit in Generator",
  "profile.packages.importingPackage": "Importing package to generator...",
  "profile.packages.importSuccess": "Package imported as generator project"
}
```

**Estimated scope:** ~80 lines in generator-packaging.js, ~40 lines in packages-tab.js, ~5 i18n keys

---

## Phase 5: Publish to Template Gallery

**Goal:** Streamline the path from generator → package → template listing.

### Task 5.1: Add "Publish to Gallery" in packaging flow

After creating/updating a package, offer to create a template listing:

```javascript
/**
 * Create a template listing for a package, pre-populated from generator project.
 */
export async function publishToGallery(projectId, options = {}) {
  const project = await getProject(projectId);
  if (!project.packageGroupId) throw new Error('Package project first');

  // Check if listing already exists
  const existing = await getListingByPackage(project.packageGroupId);
  if (existing) {
    // Update existing listing
    return updateTemplate(existing.id, {
      description: options.description || project.description,
      tags: options.tags,
    });
  }

  // Create new listing
  return createTemplate({
    packageGroupId: project.packageGroupId,
    title: options.title || project.name,
    description: options.description || project.description,
    category: options.category || 'utility',
    tags: options.tags || [],
  });
}
```

### Task 5.2: Add publish step in generator packaging UI

After successful packaging:
- Show "Publish to Template Gallery?" option
- Pre-fill title, description from project
- User can edit before publishing
- On publish: package status changes to "published" + template listing created

**Estimated scope:** ~40 lines, minor UI additions

---

## Phase 6: Forking Support

**Goal:** Enable users to fork other people's packages with full generator context preservation.

### Task 6.1: Fork detection in import flow

When importing a package, detect whether this is the author's own package (edit) or someone else's (fork):

```javascript
export async function importPackageToGenerator(groupId, version, currentUser) {
  const pkg = version
    ? await getPackageVersion(groupId, version)
    : await getPackage(groupId);

  const isOwnPackage = pkg.author === currentUser;

  // ... project creation with fork/edit distinction ...
}
```

### Task 6.2: Generator context extraction from manifest

```javascript
/**
 * Parse generator metadata from a package manifest YAML string.
 * Returns { description, blueprint, interviewSpec, forkedFrom } or null.
 */
export function parseGeneratorMetadata(manifestYaml) {
  try {
    const manifest = YAML.parse(manifestYaml);
    if (!manifest?.generator) return null;
    return {
      description: manifest.generator.description || null,
      blueprint: manifest.generator.blueprint || null,
      interviewSpec: manifest.generator.interviewSpec || null,
      forkedFrom: manifest.generator.forkedFrom || null,
    };
  } catch {
    return null;
  }
}
```

### Task 6.3: Fork UI indicators

- Generator project header shows: "Forked from: {name} by {author}" with link
- Package dialog shows fork attribution
- Template listing can display "Based on {original}" lineage

### Task 6.4: Add i18n keys for forking

```json
{
  "profile.generator.forkedFrom": "Forked from {name} by {author}",
  "profile.generator.forkPackage": "Fork & Edit",
  "profile.generator.editOwn": "Edit in Generator",
  "profile.generator.forkConfirm": "This will create your own copy of this package for editing. Continue?",
  "profile.packages.forkedFrom": "Based on {name}"
}
```

**Estimated scope:** ~80 lines in generator-packaging.js, ~30 lines UI, ~5 i18n keys

---

## Phase 7: Testing

### E2E Tests (test/e2e-generator-packaging.ts)

1. **Package creation:** Create generator project → package → verify bundle contents
2. **Generator context in manifest:** Verify description, blueprint, interviewSpec, dataModel are embedded
3. **Package update:** Modify component → update package → verify new version + changelog
4. **Import to generator (own package):** Import → verify project linked to package
5. **Import to generator (fork):** Import other's package → verify forkedFrom, no packageGroupId link
6. **Fork context preservation:** Fork → verify interviewSpec + blueprint restored → generate prompt → verify prompt has full context
7. **Round-trip:** Generator → package → import → edit → update package → no phantom changes
8. **Template publishing:** Package → template listing → verify gallery entry

### Playwright Tests

1. **Package button visibility:** Only shown when all components are done
2. **Update button:** Shown when project has `packageGroupId`
3. **Open in Generator (own):** Shows "Edit in Generator", navigates correctly
4. **Open in Generator (other's):** Shows "Fork & Edit", creates fork with attribution
5. **Fork header:** Shows "Forked from" attribution in project header
6. **Change diff UI:** Shows added/modified/removed counts

**Estimated scope:** ~250 lines E2E, ~120 lines Playwright

---

## Implementation Order

| Order | Phase | Depends On | Estimated Effort |
|-------|-------|------------|-----------------|
| 1 | Phase 1: Content normalization | Nothing | Small |
| 2 | Phase 2: Package creation with context embedding | Phase 1 | Medium |
| 3 | Phase 3: Package update | Phase 1, 2 | Medium |
| 4 | Phase 4: Import to generator with context reconstruction | Phase 1 | Medium |
| 5 | Phase 5: Publish to gallery | Phase 2 | Small |
| 6 | Phase 6: Forking support | Phase 4 | Medium |
| 7 | Phase 7: Testing | All phases | Medium |

**Total new code:** ~700 lines of JavaScript (generator-packaging.js) + ~250 lines UI changes + ~50 i18n keys + ~370 lines tests

**No backend changes required.**
