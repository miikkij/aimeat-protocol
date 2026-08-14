# E2E Test Plan: Extensions Tab

**Tab key:** `extensions`
**Component:** `ExtensionsTab`
**Props:** `{ session, showToast }`

## Overview

Install, activate, deactivate, and uninstall Cortex extensions. View extension details, manage visibility, install bundled extensions, and use AI prompts for creation.

## Preconditions

- User is authenticated
- Tab is switched to "Extensions"

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Extensions tab

**Expected:**
- Spinner while `listExtensions()` loads
- Disappears when data arrives

---

### TC-02: Hero section renders

**Steps:**
1. Wait for tab to load

**Expected:**
- Hero section (`.ext-hero`) with description
- "Install" button visible
- "Create with AI" button visible (🤖)

---

### TC-03: Copy AI creation prompt

**Steps:**
1. Click "Create with AI" button

**Expected:**
- Cortex scaffolding prompt copied to clipboard
- Toast: "Prompt copied"

---

### TC-04: Installed extensions grid

**Steps:**
1. Have at least one installed extension
2. View the extensions grid (`.ext-grid`)

**Expected:**
- Extension cards (`.ext-card`) show:
  - Name, version
  - Visibility badge (public/private)
  - Description
  - Component tags (colored based on type)
  - Status dot (active/inactive)
  - Footer with status text

---

### TC-05: View extension detail

**Steps:**
1. Click on an extension card

**Expected:**
- Detail view replaces grid
- Back button visible
- Full extension info: name, version, description, status, visibility
- Sections for: components, libraries, prompts
- Action buttons: Activate/Deactivate, Publish/Unpublish, Uninstall

---

### TC-06: Activate extension

**Steps:**
1. Open detail of an inactive extension
2. Click "Activate" button

**Expected:**
- API call to activate
- Toast: "Activated"
- Status updates to active
- Status dot changes color

---

### TC-07: Deactivate extension

**Steps:**
1. Open detail of an active extension
2. Click "Deactivate" button

**Expected:**
- Toast: "Deactivated"
- Status updates to inactive

---

### TC-08: Toggle visibility (publish/unpublish)

**Steps:**
1. In extension detail, click publish/unpublish toggle

**Expected:**
- Visibility badge updates
- Toast confirms change

---

### TC-09: Uninstall extension

**Steps:**
1. In extension detail, click "Uninstall" button (red/danger)
2. Accept confirmation dialog

**Expected:**
- Confirm dialog appears
- Toast: "Uninstalled"
- Returns to grid view
- Extension no longer in list

---

### TC-10: Install extension — file upload

**Steps:**
1. Click "Install" button
2. Modal opens
3. Select "upload" manifest mode
4. Choose a YAML manifest file
5. Optionally upload JS library files
6. Submit form

**Expected:**
- Modal (`.modal`) with form
- File input accepts manifest
- On success: Toast "Installed", modal closes, extension appears in grid

---

### TC-11: Install extension — paste manifest

**Steps:**
1. Open install modal
2. Select "paste" manifest mode
3. Paste YAML manifest in textarea
4. Submit

**Expected:**
- Textarea visible for pasting
- Same success flow as TC-10

---

### TC-12: Install bundled extension

**Steps:**
1. Find bundled extensions section (`.ext-bundled-grid`)
2. Click install button on a bundled card

**Expected:**
- Button shows spinner while installing
- Toast: "Installed"
- Extension moves from bundled to installed grid

---

### TC-13: Navigate back from detail

**Steps:**
1. Open extension detail
2. Click back button

**Expected:**
- Returns to grid view
- Grid intact
