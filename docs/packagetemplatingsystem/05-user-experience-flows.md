# User Experience Flows

**Date:** 2026-03-17
**Purpose:** Describe the end-to-end user journeys for creating, updating, and sharing packages via the generator.

---

## Flow 1: First-Time Packaging

**Scenario:** User has created a service in the generator and wants to share it as a template.

### Steps:

1. **User completes a generator project**
   - All components show green "done" status
   - Components are registered and working on the node

2. **User clicks "Package as Template"** button (visible when all components are done)
   - Location: generator detail view, next to existing "Activate All" / "Deactivate All" buttons

3. **Packaging dialog appears:**
   ```
   ┌─────────────────────────────────────────────┐
   │  Package: Hälytyskartta                      │
   │                                              │
   │  Category: [public-safety ▼]                 │
   │  Tags:     [alerts] [maps] [finland] [+]     │
   │  Visibility: ○ Private  ● Public             │
   │                                              │
   │  Components to include (5):                  │
   │  ☑ csm-1      Alert Schema CSM               │
   │  ☑ ext-ingest Alert RSS Extension             │
   │  ☑ cortex-1   Alert Cortex Library            │
   │  ☑ app-1      Alert Map Application           │
   │  ☑ i18n-1     Alert Translations              │
   │                                              │
   │  [Cancel]              [Create Package]       │
   └─────────────────────────────────────────────┘
   ```

4. **User confirms** → package created (status: draft)

5. **Success message with next steps:**
   ```
   ✓ Package created: halytyskartta v2026-03-17-1430

   Next steps:
   • [Publish Package] — make it installable by others
   • [Add to Template Gallery] — list in the community gallery
   • [Export YAML] — download bundle for offline sharing
   ```

6. **Optional: User clicks "Add to Template Gallery"**
   - Pre-filled template listing form
   - User can add screenshots, adjust description
   - Listing created → visible in gallery

---

## Flow 2: Updating an Existing Package

**Scenario:** User modified components in the generator and wants to publish an update.

### Steps:

1. **User edits a component** in the generator
   - Uses "Paste result" → "Validate" → "Re-register" flow

2. **"Update Package" button appears** (replaces "Package as Template" when `packageGroupId` exists)
   - Button shows indicator: "3 changes detected" or "No changes"

3. **User clicks "Update Package"**

4. **Change diff dialog:**
   ```
   ┌─────────────────────────────────────────────┐
   │  Update Package: Hälytyskartta               │
   │  Current version: v2026-03-17-1430           │
   │                                              │
   │  Changes detected:                           │
   │  🟡 Modified: ext-ingest (content changed)    │
   │  🟢 Added: mem-geocoding (new component)      │
   │  ⚪ Unchanged: csm-1, cortex-1, app-1, i18n-1│
   │                                              │
   │  Changelog note (optional):                  │
   │  ┌──────────────────────────────────────────┐│
   │  │ Fixed RSS parsing, added geocoding config ││
   │  └──────────────────────────────────────────┘│
   │                                              │
   │  [Cancel]              [Publish Update]       │
   └─────────────────────────────────────────────┘
   ```

5. **User confirms** → new version created

6. **Success message:**
   ```
   ✓ Package updated: halytyskartta v2026-03-17-1600

   Changelog: Fixed RSS parsing, added geocoding config
   Existing instances can check for updates.
   ```

---

## Flow 3: Opening a Package in Generator

**Scenario:** User wants to edit a package they found in the browse/gallery view.

### Steps:

1. **User is in packages-tab.js → "Browse Packages" or "Template Gallery"**

2. **Package card shows "Open in Generator" button:**
   ```
   ┌─────────────────────────────────────────────┐
   │  📦 Hälytyskartta                             │
   │  Finnish emergency alert monitoring           │
   │  v2026-03-17-1600 • by owner1                │
   │  ★★★★☆ (12 installs)                        │
   │                                              │
   │  [Install]  [Open in Generator]  [Export]     │
   └─────────────────────────────────────────────┘
   ```

3. **User clicks "Open in Generator"**
   - Confirmation: "This will create a new generator project from this package. Continue?"

4. **Generator project created → user navigated to generator tab**
   - Project shows all components as "done"
   - Blueprint reconstructed from package
   - Each component shows its content in the result area
   - Header shows: "Imported from: halytyskartta v2026-03-17-1600"

5. **User edits components as needed**
   - Can re-generate prompts, paste new AI results, validate, re-register

6. **When done editing → "Update Package" flow** (same as Flow 2)

---

## Flow 4: Forking a Package

**Scenario:** User wants to create their own version of someone else's package.

### Steps:

1. **User opens someone else's public package in generator** (same as Flow 3)
   - Project is NOT linked to original package (different author)
   - Shows: "Forked from: halytyskartta by owner1"

2. **User customizes components**

3. **User clicks "Package as Template"** (not "Update" — it's a new package)
   - New package created with the user as author
   - Different `packageGroupId` (new name or same name + different author)

4. **Result:** Two independent packages exist:
   - `halytyskartta::owner1` (original)
   - `halytyskartta::owner2` (fork)

---

## Flow 5: Complete Lifecycle

**The full journey:**

```
1. Describe service idea
   ↓
2. AI interview → requirements spec
   ↓
3. AI blueprint → component list
   ↓
4. Generate each component (AI + validation)
   ↓
5. Register on node → test & verify
   ↓
6. Package as Template (private draft)
   ↓
7. Publish package (status: published)
   ↓
8. Add to Template Gallery (optional)
   ↓
9. Others discover & install from gallery
   ↓
10. User gets feedback, makes improvements
   ↓
11. Update components in generator
   ↓
12. Update Package → new version
   ↓
13. Instance holders see "update available"
   ↓
14. Repeat from step 10
```

---

## UI Integration Points

### Generator Tab (generator-tab.js)

**New elements in component detail view:**

```
┌───────────────────────────────────────────────────────────┐
│  Project: Hälytyskartta                                    │
│  Status: All components registered                         │
│  Package: halytyskartta v2026-03-17-1430 (linked)          │
│                                                            │
│  [Activate All] [Deactivate All] [Update Package ↑3]       │
│                                                            │
│  Components:        │  ext-ingest — Alert RSS Extension     │
│  ● csm-1      done  │  Status: done (modified since v1)    │
│  ● ext-ingest done  │  Type: extension                      │
│  ● cortex-1   done  │  [Generate Prompt] [Paste Result]    │
│  ● app-1      done  │  [Validate] [Re-register]            │
│  ● i18n-1     done  │                                      │
│                     │  Result: (YAML manifest + scripts)    │
│                     │  ┌───────────────────────────────┐   │
│                     │  │ metadata:                     │   │
│                     │  │   name: alert-ingest          │   │
│                     │  │ ...                           │   │
│                     │  └───────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### Packages Tab (packages-tab.js)

**New elements in browse view:**

Each package card gains an "Open in Generator" button alongside existing "Install" button. For the user's own packages, this becomes "Edit in Generator".

### Navigation

When importing a package into the generator:
1. Create generator project
2. Call `switchPage('generator')` to navigate to generator tab
3. Auto-select the newly created project

When packaging from generator:
1. After successful packaging, show link to packages tab
2. User can navigate to see the package in the browse view

---

## Edge Cases

### No components ready
- "Package as Template" button is disabled
- Tooltip: "Complete at least one component before packaging"

### Some components failed
- Dialog shows which components will be excluded
- User can choose to package without failed components

### Package name collision
- If `{name}::{author}` already exists and is a different project:
  - Error: "A package with this name already exists"
  - User can rename in the dialog

### Import of non-owned package
- Creates a fork (new `packageGroupId`)
- No link to original package's update chain
- "Forked from: {original}" shown in project header

### Stale generator project
- If components were modified on the node (outside generator):
  - "Update Package" warns: "Components may have been modified outside the generator"
  - User should re-register from generator to ensure consistency
