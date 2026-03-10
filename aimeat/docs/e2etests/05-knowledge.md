# E2E Test Plan: Knowledge Tab

**Tab key:** `knowledge`
**Component:** `KnowledgeTab`
**Props:** `{ session, showToast, onStats }`

## Overview

Full knowledge package lifecycle: import via paste, manage packages (expand, export, delete), sharing settings, entry visibility editing, discovery catalogue with cloning, and organism contributions.

## Preconditions

- User is authenticated
- Tab is switched to "Knowledge"

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Knowledge tab

**Expected:**
- Data loads (my packages + discover packages)
- No infinite spinner

---

### TC-02: Action bar renders

**Steps:**
1. Wait for tab to load

**Expected:**
- "Copy Human Prompt" button (`.kpkg-btn.kpkg-btn-primary`) visible
- "Copy Agent Prompt" button (`.kpkg-btn.kpkg-btn-secondary`) visible
- Description text explaining knowledge packages

---

### TC-03: Copy human prompt

**Steps:**
1. Click "Copy Human Prompt" button

**Expected:**
- Template fetched from `/v1/templates/knowledge-packager-human`
- Toast with checkmark appears
- Clipboard contains the human packager prompt (includes JSON template with `references` array)

---

### TC-04: Copy agent prompt

**Steps:**
1. Click "Copy Agent Prompt" button

**Expected:**
- Template fetched from `/v1/templates/knowledge-packager-agent`
- Toast appears
- Clipboard contains the agent prompt

---

### TC-05: Import — paste valid JSON

**Steps:**
1. Paste valid knowledge package JSON into import textarea (`.kpkg-import-textarea`):
   ```json
   {
     "aimeat_knowledge_package": true,
     "name": "Test Package",
     "content_type": "factual",
     "synthesis_level": "curated",
     "entries": [
       { "key": "entry1", "value": "test data", "visibility": "public" }
     ]
   }
   ```

**Expected:**
- Preview section appears (`.kpkg-preview`)
- Package name shown
- Content type and synthesis level badges visible
- Entry count shown (1 entry)
- GHII match indicator (green check if matches, orange warning if not)
- "Confirm Import" button visible
- "Catalog Listed" checkbox visible (default: checked)

---

### TC-06: Import — paste invalid JSON

**Steps:**
1. Paste invalid text (not JSON, no package markers) into import textarea

**Expected:**
- Error message shown (`.kpkg-error`)
- No preview section
- No confirm button

---

### TC-07: Import — paste code block with JSON

**Steps:**
1. Paste a markdown code block containing JSON:
   ````
   ```json
   { "aimeat_knowledge_package": true, "name": "Test", "entries": [] }
   ```
   ````

**Expected:**
- Parser extracts JSON from code block
- Preview renders correctly (same as TC-05)

---

### TC-08: Confirm import

**Steps:**
1. Paste valid package JSON (TC-05)
2. Click "Confirm Import" button (`.kpkg-btn.kpkg-btn-primary`)

**Expected:**
- Button shows "..." while importing
- On success:
  - Toast confirms import
  - Import textarea clears
  - Preview disappears
  - New package appears in "My Knowledge" section

---

### TC-09: Import error handling

**Steps:**
1. Paste package JSON that will fail server-side (e.g., missing required fields)
2. Click "Confirm Import"

**Expected:**
- Error toast with server error message
- Import form is NOT cleared (user can retry)
- Button reverts from "..."

---

### TC-10: My Knowledge — package card render

**Steps:**
1. Have at least one imported package
2. Check My Knowledge section

**Expected:**
- Package card visible (`.kpkg-card`)
- Shows: expand icon (▶), name, content type badge, synthesis badge, maturity badge
- Tags row (if package has tags)
- Entry count, version info
- Export and Delete buttons visible

---

### TC-11: Expand package card

**Steps:**
1. Click package card header (`.kpkg-card-clickable`)

**Expected:**
- Card gets `.kpkg-card-expanded`
- Expand icon changes ▶ → ▼
- Detail section (`.kpkg-detail`) appears with:
  - Synthesis description (if exists)
  - Sharing settings section
  - Entries list
  - References (if any)
  - Package ID and author metadata

---

### TC-12: Sharing settings — toggle catalog listed

**Steps:**
1. Expand a package
2. Find sharing settings section (`.kpkg-sharing-settings`)
3. Toggle "Catalog Listed" checkbox

**Expected:**
- API call to `PATCH /v1/packages/{id}/sharing` with `{ catalog_listed: true/false }`
- Checkbox disabled while saving
- Toast on success: "Saved"
- On error: error toast, checkbox reverts

---

### TC-13: Sharing settings — toggle allow clone

**Steps:**
1. Expand a package
2. Toggle "Allow Clone" checkbox

**Expected:**
- API call with `{ allow_clone: true/false }`
- Same UX as TC-12

---

### TC-14: Entry visibility editing

**Steps:**
1. Expand a package
2. Find an entry in the entries list
3. Change the visibility select (`.kpkg-vis-select`) from "public" to "private"

**Expected:**
- API call to `PATCH /v1/packages/{id}/entries/{key}/visibility` with `{ visibility: "private" }`
- Select background color changes to reflect new visibility
- Toast on success
- Entry visibility updates in the UI immediately

---

### TC-15: Export package

**Steps:**
1. Click "Export" button on a package card (`.kpkg-btn.kpkg-btn-secondary`)

**Expected:**
- Full package JSON fetched from API
- JSON copied to clipboard
- Toast: "Package JSON copied"

---

### TC-16: Delete package — confirm

**Steps:**
1. Click "Delete" button on a package card (`.kpkg-btn.kpkg-btn-danger`)
2. Accept the confirmation dialog

**Expected:**
- Button shows "..." while deleting
- On success:
  - Package card disappears
  - Toast confirms deletion
  - Package list reloads

---

### TC-17: Delete package — cancel

**Steps:**
1. Click "Delete" button
2. Cancel the confirmation dialog

**Expected:**
- No API call
- Package remains in list

---

### TC-18: Discover section renders

**Steps:**
1. Scroll to Discover section

**Expected:**
- Discovery packages listed (from `/v1/catalogue/knowledge`)
- Each card shows: name, type/synthesis badges, author, entry count, tags
- Trust advisory text visible (orange)

---

### TC-19: Clone from discovery — allowed

**Steps:**
1. Find a discoverable package with cloning allowed (`allow_clone !== false`)
2. Click "Clone" button

**Expected:**
- API call to clone the package
- Toast on success
- Cloned package appears in My Knowledge section

---

### TC-20: Clone from discovery — disabled

**Steps:**
1. Find a discoverable package with `allow_clone: false`

**Expected:**
- No Clone button visible
- Instead: disabled message text (`.kpkg-clone-disabled`)

---

### TC-21: References display

**Steps:**
1. Import a package that includes references
2. Expand the package

**Expected:**
- References section visible (`.kpkg-detail-refs`)
- Each reference shows:
  - Verified badge (✓) or unverified (?)
  - Link (clickable, opens in new tab) if URL provided
  - Reference type (if available)
