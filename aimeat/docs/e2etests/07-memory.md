# E2E Test Plan: Memory Tab

**Tab key:** `memory`
**Component:** `MemoryTab`
**Props:** `{ session, showToast, onStats }`

## Overview

Key-value memory storage with two sub-tabs: Entries (text data) and Files (binary uploads). Full CRUD for both, plus search, tag filtering, edit modal, sharing rules popover, and drag-and-drop file upload.

## Preconditions

- User is authenticated
- Tab is switched to "Memory"

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Memory tab

**Expected:**
- Spinner visible while `listMemories()` and `listFiles()` load
- Spinner disappears when both complete

---

### TC-02: Sub-tab switching

**Steps:**
1. Click "Files" sub-tab (`.sub-tab`)
2. Click "Entries" sub-tab

**Expected:**
- Active sub-tab gets `.active` class
- Content switches between entries view and files view
- Only one sub-tab active at a time

---

## Entries Sub-Tab

### TC-03: Create memory entry

**Steps:**
1. Click "New" button (`.btn-primary`)
2. In the form:
   - Enter key: "test-key"
   - Enter value: "test-value"
   - Select visibility: "private"
   - Enter tags: "tag1, tag2"
3. Click "Save" (`.btn-primary`)

**Expected:**
- Form validates: key and value must not be empty
- On success:
  - Toast: "Saved" (or `profile.memory.saved`)
  - Form closes
  - New entry appears in memory list
  - Entry shows key, visibility badge, value preview

---

### TC-04: Create memory — empty key validation

**Steps:**
1. Open create form
2. Leave key empty, enter a value
3. Click "Save"

**Expected:**
- Validation error (form doesn't submit)
- No API call

---

### TC-05: Cancel create form

**Steps:**
1. Open create form
2. Click "Cancel" (`.btn-outline`)

**Expected:**
- Form closes
- No API call

---

### TC-06: Search memories

**Steps:**
1. Enter "test" in search bar
2. Click "Search" button

**Expected:**
- Memory list filters to show matching entries
- API call to `searchMemory("test")`
- Results update in the list

---

### TC-07: Clear search

**Steps:**
1. Perform a search (TC-06)
2. Click "Clear" button

**Expected:**
- Search input clears
- Full memory list restores (reloads all)

---

### TC-08: Expand memory entry

**Steps:**
1. Click on a memory item (`.mem-item`)

**Expected:**
- Detail section expands showing:
  - Full value in `<pre>` (JSON-formatted if object)
  - Tags
  - Visibility badge

---

### TC-09: Edit memory value

**Steps:**
1. Expand a memory entry
2. Click "Edit" button
3. In the modal (`.modal`):
   - Modify the value text
   - Click "Save" (`.btn-primary`)

**Expected:**
- Modal overlay appears (`.modal-overlay`)
- Heading shows the memory key
- Textarea pre-filled with current value
- On save:
  - Toast: "Updated"
  - Modal closes
  - Entry value updates in the list

---

### TC-10: Close edit modal without saving

**Steps:**
1. Open edit modal
2. Click "Cancel" or click the overlay

**Expected:**
- Modal closes
- Value unchanged

---

### TC-11: Delete memory entry

**Steps:**
1. Expand a memory entry
2. Click "Delete" button (`.btn-danger`)
3. Accept confirmation dialog

**Expected:**
- Confirm dialog: "Delete: {key}?"
- Toast: "Deleted"
- Entry disappears from list

---

### TC-12: View sharing rules (shield icon)

**Steps:**
1. Click the shield icon (🛡️) on a memory entry

**Expected:**
- Sharing rules popover (`.key-rules-box`) appears
- Shows: recipient badges, data patterns, scopes
- Close button (X) dismisses the popover

---

## Files Sub-Tab

### TC-13: Upload file

**Steps:**
1. Switch to Files sub-tab
2. Click "Upload" button (`.btn-primary`)
3. In the form:
   - Click dropzone to open file picker
   - Select an HTML file
   - Set visibility to "public"
   - Add tag "test-tag" and click "+"
4. Click "Upload" (`.btn-primary`)

**Expected:**
- File appears in the file items list with editable key/name
- Tag appears in tag cloud below input
- Upload button shows count (e.g., "Upload (1)")
- On success:
  - Toast: "1 files uploaded"
  - Form closes
  - File appears in file grid

---

### TC-14: Drag and drop file upload

**Steps:**
1. Open file upload form
2. Drag a file onto the dropzone (`.file-dropzone`)

**Expected:**
- Dropzone gets `.dragover` class while dragging over it
- File is added to the upload list on drop
- `.dragover` class removed after drop

---

### TC-15: Remove file from upload list

**Steps:**
1. Add files to upload form
2. Click X button on a file item

**Expected:**
- File removed from the list
- Upload button count decreases

---

### TC-16: Tag filtering

**Steps:**
1. Have files with different tags uploaded
2. Click a tag in the tag cloud (`.file-tag-btn`)

**Expected:**
- Tag gets `.active` class
- File grid filters to show only files with that tag
- Other files hidden

---

### TC-17: Clear tag filter

**Steps:**
1. Apply a tag filter (TC-16)
2. Click "Clear" (X) button in tag cloud

**Expected:**
- All tag buttons lose `.active` class
- All files shown again

---

### TC-18: No matching files after filter

**Steps:**
1. Apply a tag filter that matches no files

**Expected:**
- Different empty message shown (not the generic "no files" message)

---

### TC-19: File card display

**Steps:**
1. Upload a file and view it in the grid

**Expected:**
- File card (`.file-card`) shows:
  - File icon (emoji based on mime type)
  - Filename
  - Size in KB
  - Visibility indicator
  - Tags
  - "Download" button/link
  - "Delete" button

---

### TC-20: Delete file

**Steps:**
1. Click "Delete" on a file card (`.btn-danger`)
2. Accept confirmation dialog

**Expected:**
- Confirm dialog appears
- Toast: "Deleted"
- File card disappears from grid

---

### TC-21: Copy file URLs

**Steps:**
1. Have multiple files uploaded
2. Click copy URLs action (if available)

**Expected:**
- Clipboard contains URLs for all files
- Toast: "URLs copied" (`profile.files.urlsCopied`)
