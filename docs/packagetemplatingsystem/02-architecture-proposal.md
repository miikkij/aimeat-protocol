# Architecture Proposal: Generator ↔ Package Bridge

**Date:** 2026-03-17
**Purpose:** Define how generator projects become packages and how packages re-open in the generator.

---

## 1. Core Concept

The generator becomes the **authoring environment** for packages. Two new flows are added:

### Flow A: Generator → Package ("Package This Project")

```
Generator Project (all components "done")
  ↓
[Package] button in generator UI
  ↓
Collect all component results → normalize content
  ↓
POST /v1/bundles (create package, status=draft)
  ↓
Package created → link stored in generator project
  ↓
User can publish, create template listing
```

### Flow B: Package → Generator ("Open in Generator")

```
Package (any version)
  ↓
[Open in Generator] button in packages UI
  ↓
Create new generator project from package components
  ↓
Populate: project metadata, blueprint, component results
  ↓
User edits components in generator workflow
  ↓
[Update Package] → POST /v1/bundles/{groupId}/versions (new version)
```

---

## 2. Data Flow: Packaging a Generator Project

### Step 1: Collect Components

Read all `generator.{projectId}.component.*` keys from Memory API. For each component with `status === 'done'` and a valid `result`:

```javascript
const components = await loadAllComponents(projectId);
const packageable = components.filter(c => c.status === 'done' && c.result);
```

### Step 2: Normalize Content

Transform generator `result` (raw AI output) into package `content` (clean, processed string). Use existing validators' extraction logic:

| Type | Generator `result` | Package `content` |
|------|-------------------|-------------------|
| CSM | YAML string | YAML string (cleaned) |
| MSM | YAML string | YAML string (cleaned) |
| Extension | Raw text with manifest + scripts | `JSON.stringify({ manifest, scripts })` |
| Cortex | Raw text with manifest + libs | `JSON.stringify({ manifest, libs })` |
| App | HTML string | HTML string |
| Memory | `{ key: value }` object | `JSON.stringify({ entries: [...] })` |
| Translation | `{ locale: { strings } }` | `JSON.stringify({ en: {...}, fi: {...} })` |

The validators (`generator-validate.js`) already extract `manifest`, `scripts`, `libs` etc. from raw results — reuse that extraction.

### Step 3: Build Package Components

```javascript
const packageComponents = packageable.map(comp => ({
  id: comp.id,
  type: comp.type,
  label: comp.label,
  content: normalizeContent(comp.type, comp.result),
  contentHash: sha256(normalizeContent(comp.type, comp.result)),
  dependencies: inferDependencies(comp, allComponents),
}));
```

### Step 4: Build Manifest

Generate a YAML manifest from the project metadata + blueprint:

```yaml
name: halytyskartta
description: Finnish emergency alert map service
category: utility
tags: [alerts, maps, finland]
version: v2026-03-17-1430
author: owner1

components:
  - id: csm-1
    type: csm
    label: Alert Schema CSM
  - id: ext-ingest
    type: extension
    label: Alert Ingest Extension
    dependencies: [csm-1]
  - id: cortex-1
    type: cortex
    label: Alert Cortex Library
  - id: app-1
    type: app
    label: Alert Map App
    dependencies: [cortex-1]

dataModel:
  alerts.by-date:
    type: object
    description: Daily alert entries
```

### Step 5: Create Package

```javascript
const packageData = {
  name: project.name,
  description: project.description,
  category: inferCategory(project),
  tags: extractTags(project),
  visibility: 'private',       // default to private
  components: packageComponents,
  manifest: buildManifestYaml(project, packageComponents),
};

const result = await createPackage(packageData);  // POST /v1/bundles
```

### Step 6: Link Package to Generator Project

Store the package group ID in the generator project metadata:

```javascript
await updateProject(projectId, {
  packageGroupId: result.data.packageGroupId,
  lastPackagedVersion: result.data.version,
  lastPackagedAt: new Date().toISOString(),
});
```

---

## 3. Data Flow: Opening a Package in Generator

### Step 1: Load Package

```javascript
const pkg = await getPackage(groupId);  // GET /v1/bundles/{groupId}
// or specific version:
const pkg = await getPackageVersion(groupId, version);
```

### Step 2: Create Generator Project

```javascript
const projectId = genId();
const project = {
  projectId,
  name: pkg.name,
  description: pkg.description,
  status: 'components',  // skip interview/blueprint phases
  blueprint: reconstructBlueprint(pkg.components),
  packageGroupId: pkg.packageGroupId,
  sourceVersion: pkg.version,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
await saveProject(project);
```

### Step 3: Populate Components

For each package component, create a generator component entry:

```javascript
for (const comp of pkg.components) {
  const genComponent = {
    id: comp.id,
    type: comp.type,
    label: comp.label,
    status: 'done',
    result: denormalizeContent(comp.type, comp.content),
    validationErrors: [],
    validationWarnings: [],
    registeredAs: null,  // not registered yet in this context
    history: [{
      action: 'imported_from_package',
      at: new Date().toISOString(),
      by: 'system',
      meta: { packageGroupId: pkg.packageGroupId, version: pkg.version }
    }],
    _version: 0,
  };
  await saveComponent(projectId, genComponent);
}
```

### Step 4: Reconstruct Blueprint

Build a blueprint from the package components (reverse of the packaging step):

```javascript
function reconstructBlueprint(components) {
  // Group by phase based on type
  const phaseMap = {
    csm: 'discovery',
    msm: 'registration',
    extension: 'data',
    cortex: 'processing',
    app: 'ui',
    memory: 'data',
    translation: 'registration',
  };

  return {
    components: components.map(c => ({
      id: c.id,
      type: c.type,
      label: c.label,
      phase: phaseMap[c.type] || 'data',
    })),
    phases: ['discovery', 'data', 'processing', 'ui', 'registration'],
    dataModel: {},  // not recoverable from package — user can re-interview if needed
  };
}
```

---

## 4. Data Flow: Updating a Package

When a generator project is already linked to a package (`project.packageGroupId` exists):

### Step 1: Detect Changes

Compare current generator component results against the last packaged version:

```javascript
const currentPkg = await getPackage(project.packageGroupId);
const currentComponents = currentPkg.components;

const changes = [];
for (const comp of generatorComponents) {
  const pkgComp = currentComponents.find(c => c.id === comp.id);
  const newContent = normalizeContent(comp.type, comp.result);
  const newHash = sha256(newContent);

  if (!pkgComp) {
    changes.push({ id: comp.id, action: 'added' });
  } else if (pkgComp.contentHash !== newHash) {
    changes.push({ id: comp.id, action: 'modified' });
  }
}

// Check for removed components
for (const pkgComp of currentComponents) {
  if (!generatorComponents.find(c => c.id === pkgComp.id)) {
    changes.push({ id: pkgComp.id, action: 'removed' });
  }
}
```

### Step 2: Show Change Summary

Display a diff summary to the user before creating a new version:
- Added components (green)
- Modified components (yellow)
- Removed components (red)
- Unchanged components (gray)

### Step 3: Create New Version

```javascript
const changelog = buildChangelog(changes);
const result = await createVersion(project.packageGroupId, {
  description: project.description,
  category: inferCategory(project),
  tags: extractTags(project),
  components: packageComponents,  // full component list
  manifest: buildManifestYaml(project, packageComponents),
  changelog,
});

// Update generator project with new version
await updateProject(projectId, {
  lastPackagedVersion: result.data.version,
  lastPackagedAt: new Date().toISOString(),
});
```

---

## 5. Where Changes Are Needed

### Frontend (client-side only — no backend changes required):

| File | Change | Purpose |
|------|--------|---------|
| `public/js/services/generator.js` | Add `packageProject()`, `updatePackage()`, `importFromPackage()` | Core bridge functions |
| `public/js/services/generator-validate.js` | Export `extractContent()` for each type | Reuse extraction for packaging |
| `public/views/profile/generator-tab.js` | Add "Package" and "Update Package" buttons | UI for packaging |
| `public/views/profile/packages-tab.js` | Add "Open in Generator" button | UI for editing |
| `locales/en.json` + `locales/fi.json` | Add i18n keys for new UI elements | Translations |

### No backend changes needed because:
- Package CRUD APIs already exist (`POST /v1/bundles`, `POST /v1/bundles/{groupId}/versions`)
- Generator state is stored in Memory API (no new storage)
- Content normalization happens client-side
- Linking is done via a `packageGroupId` field in generator project metadata (Memory API)

---

## 6. Dependency Inference

The generator doesn't currently track dependencies. For the packaging step, we can infer them:

```javascript
function inferDependencies(component, allComponents) {
  const deps = [];
  const type = component.type;

  // Apps depend on their cortex
  if (type === 'app') {
    const cortex = allComponents.find(c => c.type === 'cortex');
    if (cortex) deps.push(cortex.id);
  }

  // Extensions depend on CSM (schema validation)
  if (type === 'extension') {
    const csm = allComponents.find(c => c.type === 'csm');
    if (csm) deps.push(csm.id);
  }

  // Cortex depends on extension (data source)
  if (type === 'cortex') {
    const ext = allComponents.find(c => c.type === 'extension');
    if (ext) deps.push(ext.id);
  }

  // MSM depends on CSM
  if (type === 'msm') {
    const csm = allComponents.find(c => c.type === 'csm');
    if (csm) deps.push(csm.id);
  }

  return deps;
}
```

---

## 7. Security Considerations

### Content integrity:
- SHA-256 hashes computed at packaging time
- Hash comparison on update to detect actual changes
- No user content bypasses validation

### Visibility:
- New packages default to `private` — user must explicitly publish
- Generator projects remain in user's own memory namespace
- Package creation respects `packageCreateRole` config

### No new attack surface:
- All operations use existing APIs (Memory, Bundles)
- No new backend routes needed
- Client-side content normalization uses existing validators
