# E2E Test Plan: Apps Tab

**Tab key:** `apps`
**Component:** `AppsTab`
**Props:** `{ session, showToast, onStats }`

## Overview

Upload HTML apps, manage access codes, view app gallery. Launcher and creation guide links.

## Preconditions

- User is authenticated
- Tab is switched to "Apps"

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Apps tab

**Expected:**
- Spinner while `listApps()` loads
- Disappears when data arrives

---

### TC-02: Static info cards render

**Steps:**
1. Wait for tab to load

**Expected:**
- Launcher card with "Open" button linking to `/v1/aimeat-os` (target="_blank")
- Create guide card with "Download" button

---

### TC-03: Upload app

**Steps:**
1. Click "Upload" button (`.btn-primary`)
2. Select an HTML file via file picker
3. Optionally add a screenshot image
4. Optionally enter access code: "secret123"
5. Click "Upload"

**Expected:**
- File appears in preview list with editable key/name
- On success:
  - Toast: "App uploaded"
  - Form closes
  - App appears in My Apps section

---

### TC-04: Upload validation — no file selected

**Steps:**
1. Open upload form
2. Click "Upload" without selecting a file

**Expected:**
- Toast error: "Select a file"
- No API call

---

### TC-05: App card display

**Steps:**
1. Have at least one uploaded app
2. View My Apps section

**Expected:**
- App card (`.card`) shows:
  - Filename (`.card-title`)
  - Content type badge
  - Protected badge (🔒) if access code set
  - Download link
  - File size in KB
  - "Edit Access Code" button
  - "Delete" button

---

### TC-06: Edit access code

**Steps:**
1. Click "Edit Access Code" on an app card
2. Enter new code: "newcode"
3. Click "Save"

**Expected:**
- Inline edit form appears with input and Save/Cancel buttons
- On save:
  - Toast: "App updated"
  - Edit form closes
  - Protected badge appears (🔒) if code was set

---

### TC-07: Remove access code

**Steps:**
1. Click "Edit Access Code" on a protected app
2. Clear the input (leave empty)
3. Click "Save"

**Expected:**
- Hint text visible: "Save empty to remove access code protection"
- On save:
  - Toast: "App updated"
  - Protected badge (🔒) disappears

---

### TC-08: Cancel access code edit

**Steps:**
1. Start editing access code
2. Click "Cancel"

**Expected:**
- Edit form closes
- No API call
- Access code unchanged

---

### TC-09: Delete app

**Steps:**
1. Click "Delete" on an app (`.btn-sm.btn-danger`)
2. Accept confirmation dialog

**Expected:**
- Confirm: "Delete this app?"
- Toast: "App deleted"
- App card disappears

---

### TC-10: App gallery

**Steps:**
1. Scroll to Gallery section

**Expected:**
- Grid layout (`.app-grid`) of all apps
- Each app card (`.app-card`) shows:
  - Screenshot image (or 🔱 placeholder)
  - Filename, owner, size
  - Protected indicator if applicable
  - Download link
