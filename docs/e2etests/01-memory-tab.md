# Memory Tab - E2E Test Cases

## Overview

The Memory Tab provides key-value memory storage with file management capabilities. Users can create, read, update, delete, and search memory entries, as well as upload and manage files. The tab has two sub-tabs: **Entries** and **Files**.

### Components

- **MemoryTab** (`public/views/profile/memory-tab.js`) - Main tab component
- **MemoryForm** - Create new memory entry form (key, value, visibility, tags)
- **EditMemoryModal** - Modal for editing existing entry values
- **FileUploadForm** - Drag-and-drop / click file upload with multi-file support

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/memory` | List all memory entries |
| GET | `/v1/memory/search?q=...` | Search memory entries |
| POST | `/v1/memory` | Create a new memory entry |
| PUT | `/v1/memory/:key` | Update a memory entry value |
| DELETE | `/v1/memory/:key` | Delete a memory entry |
| GET | `/v1/memory/files` | List uploaded files |
| POST | `/v1/memory/files` | Upload a file (base64-encoded) |
| DELETE | `/v1/memory/files/:key` | Delete a file |
| GET | `/v1/permissions/memory/:key` | Get sharing rules for a key |

### Service Layer (`public/js/services/memory.js`)

- `listMemories()` - Returns array of entries from `data.entries` or `data`
- `searchMemory(query)` - Returns array of results from `data.results` or `data`
- `createMemory(key, value, visibility, tags)` - POST with key, value, visibility, parsed tags
- `updateMemory(key, value)` - PUT with new value only
- `deleteMemory(key)` - DELETE by key
- `listFiles()` - Returns array from `data.files` or `data`
- `uploadFile(key, base64Content, mimeType, visibility)` - POST base64 file
- `deleteFile(key)` - DELETE file by key

---

## Table of Contents

- [Memory Entry CRUD](#memory-entry-crud)
  - [TC-MEM-001: Create a memory entry with all fields](#tc-mem-001-create-a-memory-entry-with-all-fields)
  - [TC-MEM-002: Read / list memory entries](#tc-mem-002-read--list-memory-entries)
  - [TC-MEM-003: Update a memory entry via edit modal](#tc-mem-003-update-a-memory-entry-via-edit-modal)
  - [TC-MEM-004: Delete a memory entry](#tc-mem-004-delete-a-memory-entry)
  - [TC-MEM-005: Full CRUD cycle](#tc-mem-005-full-crud-cycle)
- [Search](#search)
  - [TC-MEM-006: Search finds matching entry](#tc-mem-006-search-finds-matching-entry)
  - [TC-MEM-007: Search with no results shows empty state](#tc-mem-007-search-with-no-results-shows-empty-state)
  - [TC-MEM-008: Clear search restores full list](#tc-mem-008-clear-search-restores-full-list)
- [Visibility](#visibility)
  - [TC-MEM-009: Create entry with private visibility](#tc-mem-009-create-entry-with-private-visibility)
  - [TC-MEM-010: Create entry with shared visibility](#tc-mem-010-create-entry-with-shared-visibility)
  - [TC-MEM-011: Create entry with public visibility](#tc-mem-011-create-entry-with-public-visibility)
- [Tags](#tags)
  - [TC-MEM-012: Tags are saved and displayed](#tc-mem-012-tags-are-saved-and-displayed)
- [File Management](#file-management)
  - [TC-MEM-013: Upload a single file](#tc-mem-013-upload-a-single-file)
  - [TC-MEM-014: List uploaded files](#tc-mem-014-list-uploaded-files)
  - [TC-MEM-015: Delete a file](#tc-mem-015-delete-a-file)
  - [TC-MEM-016: Upload multiple files at once](#tc-mem-016-upload-multiple-files-at-once)
  - [TC-MEM-017: Drag-and-drop file upload](#tc-mem-017-drag-and-drop-file-upload)
- [Permissions Popover](#permissions-popover)
  - [TC-MEM-018: View key permissions popover](#tc-mem-018-view-key-permissions-popover)
- [Sub-Tab Navigation](#sub-tab-navigation)
  - [TC-MEM-019: Switch between entries and files sub-tabs](#tc-mem-019-switch-between-entries-and-files-sub-tabs)
- [Failure Cases](#failure-cases)
  - [TC-MEM-020: Create entry with empty key](#tc-mem-020-create-entry-with-empty-key)
  - [TC-MEM-021: Create entry with empty value](#tc-mem-021-create-entry-with-empty-value)
  - [TC-MEM-022: Create entry with duplicate key](#tc-mem-022-create-entry-with-duplicate-key)
  - [TC-MEM-023: Delete non-existent entry](#tc-mem-023-delete-non-existent-entry)
  - [TC-MEM-024: Upload file exceeding size limit](#tc-mem-024-upload-file-exceeding-size-limit)
  - [TC-MEM-025: Unauthenticated access to memory API](#tc-mem-025-unauthenticated-access-to-memory-api)
- [Edge Cases](#edge-cases)
  - [TC-MEM-026: Special characters in memory key](#tc-mem-026-special-characters-in-memory-key)
  - [TC-MEM-027: Very long memory value](#tc-mem-027-very-long-memory-value)
  - [TC-MEM-028: Object value displayed as formatted JSON](#tc-mem-028-object-value-displayed-as-formatted-json)
  - [TC-MEM-029: Concurrent edits (version conflict)](#tc-mem-029-concurrent-edits-version-conflict)
  - [TC-MEM-030: Empty entries list shows empty state](#tc-mem-030-empty-entries-list-shows-empty-state)
  - [TC-MEM-031: Empty files list shows empty state](#tc-mem-031-empty-files-list-shows-empty-state)
  - [TC-MEM-032: File key can be edited before upload](#tc-mem-032-file-key-can-be-edited-before-upload)
  - [TC-MEM-033: Duplicate files are deduplicated in upload form](#tc-mem-033-duplicate-files-are-deduplicated-in-upload-form)
  - [TC-MEM-034: Dismiss edit modal by clicking overlay](#tc-mem-034-dismiss-edit-modal-by-clicking-overlay)

---

## Memory Entry CRUD

### TC-MEM-001: Create a memory entry with all fields
- **Precondition:** User is authenticated and on the Memory tab, Entries sub-tab.
- **Steps:**
  1. Click the "New" button to open the create form.
  2. Enter `test-key` in the Key field.
  3. Enter `test-value` in the Value textarea.
  4. Select `shared` from the Visibility dropdown.
  5. Enter `tag1, tag2, tag3` in the Tags field.
  6. Click the "Save" button.
- **Expected:** A success toast "Saved" is displayed. The form closes. The new entry `test-key` appears in the entries list with a `shared` visibility badge.
- **Type:** success

### TC-MEM-002: Read / list memory entries
- **Precondition:** User is authenticated. At least one memory entry exists.
- **Steps:**
  1. Navigate to the Memory tab.
  2. Ensure the "Entries" sub-tab is active.
- **Expected:** The entries list loads and displays all existing memory entries. Each entry shows the key, visibility badge (private/shared/public), and a shield icon for permissions. A loading spinner is shown briefly during fetch.
- **Type:** success

### TC-MEM-003: Update a memory entry via edit modal
- **Precondition:** User is authenticated. A memory entry with key `test-key` exists.
- **Steps:**
  1. Click on the `test-key` entry to expand it.
  2. Click the "Edit" button in the expanded detail section.
  3. The edit modal opens pre-filled with the current value.
  4. Change the value to `updated-value`.
  5. Click the "Save" button.
- **Expected:** A PUT request is sent to `/v1/memory/test-key`. A success toast "Updated" is displayed. The modal closes. The entry list reloads and shows the updated value when expanded.
- **Type:** success

### TC-MEM-004: Delete a memory entry
- **Precondition:** User is authenticated. A memory entry with key `test-key` exists.
- **Steps:**
  1. Click on the `test-key` entry to expand it.
  2. Click the "Delete" button.
  3. A browser confirm dialog appears asking to confirm deletion.
  4. Click "OK" to confirm.
- **Expected:** A DELETE request is sent to `/v1/memory/test-key`. A success toast "Deleted" is displayed. The expanded view closes. The entry disappears from the list.
- **Type:** success

### TC-MEM-005: Full CRUD cycle
- **Precondition:** User is authenticated and on the Memory tab.
- **Steps:**
  1. Create a new entry with key `crud-test`, value `original`, visibility `private`.
  2. Verify the entry appears in the list.
  3. Click the entry to expand it and confirm the value is `original`.
  4. Click "Edit", change value to `modified`, save.
  5. Expand the entry again and confirm value is `modified`.
  6. Click "Delete" and confirm.
  7. Verify the entry no longer appears in the list.
- **Expected:** Each step completes successfully with appropriate toast messages. The entry goes through create, read, update, and delete without errors.
- **Type:** success

---

## Search

### TC-MEM-006: Search finds matching entry
- **Precondition:** User is authenticated. Memory entries exist, including one with key `recipe-pasta`.
- **Steps:**
  1. Type `pasta` in the search input field.
  2. Press Enter or click the search button.
- **Expected:** A GET request is sent to `/v1/memory/search?q=pasta`. The entries list updates to show only entries matching `pasta`. The `recipe-pasta` entry is visible.
- **Type:** success

### TC-MEM-007: Search with no results shows empty state
- **Precondition:** User is authenticated. No entries match `xyznonexistent`.
- **Steps:**
  1. Type `xyznonexistent` in the search input field.
  2. Click the search button.
- **Expected:** The entries list shows the empty state message. No error is displayed.
- **Type:** edge

### TC-MEM-008: Clear search restores full list
- **Precondition:** User is authenticated. A search has been performed and results are filtered.
- **Steps:**
  1. Click the "Clear" button next to the search bar.
- **Expected:** The search input is cleared. The full unfiltered list of entries is loaded via `GET /v1/memory`. All entries are visible again.
- **Type:** success

---

## Visibility

### TC-MEM-009: Create entry with private visibility
- **Precondition:** User is authenticated and on the Memory tab.
- **Steps:**
  1. Open the create form.
  2. Enter key `private-entry`, value `secret data`.
  3. Leave visibility as `private` (default).
  4. Click Save.
- **Expected:** Entry is created. The entry appears in the list with a muted-colored `private` badge.
- **Type:** success

### TC-MEM-010: Create entry with shared visibility
- **Precondition:** User is authenticated and on the Memory tab.
- **Steps:**
  1. Open the create form.
  2. Enter key `shared-entry`, value `team data`.
  3. Select `shared` from the visibility dropdown.
  4. Click Save.
- **Expected:** Entry is created with `visibility: "shared"`. The entry appears with a blue-tinted `shared` badge (`badge-info`).
- **Type:** success

### TC-MEM-011: Create entry with public visibility
- **Precondition:** User is authenticated and on the Memory tab.
- **Steps:**
  1. Open the create form.
  2. Enter key `public-entry`, value `open data`.
  3. Select `public` from the visibility dropdown.
  4. Click Save.
- **Expected:** Entry is created with `visibility: "public"`. The entry appears with a green `public` badge (`badge-success`).
- **Type:** success

---

## Tags

### TC-MEM-012: Tags are saved and displayed
- **Precondition:** User is authenticated and on the Memory tab.
- **Steps:**
  1. Open the create form.
  2. Enter key `tagged-item`, value `some value`.
  3. Enter `cooking, italian, easy` in the Tags field.
  4. Click Save.
  5. Click on the `tagged-item` entry to expand it.
- **Expected:** The expanded detail section shows the tags `cooking, italian, easy` in a muted text line below the value. The tags were sent as an array `["cooking", "italian", "easy"]` in the POST request body.
- **Type:** success

---

## File Management

### TC-MEM-013: Upload a single file
- **Precondition:** User is authenticated. The Files sub-tab is active.
- **Steps:**
  1. Click the "Upload" button to open the upload form.
  2. Click the drop zone area to open the file picker.
  3. Select a small text file (e.g., `notes.txt`, 1 KB).
  4. Verify the file appears in the upload list with its name as the key and size displayed.
  5. Leave visibility as `private`.
  6. Click the "Upload" button.
- **Expected:** A POST request is sent to `/v1/memory/files` with the base64-encoded file content, key `notes.txt`, mime type, and visibility `private`. A success toast "Uploaded" is shown. The form closes. The file appears in the files grid with the correct icon, name, size, and visibility.
- **Type:** success

### TC-MEM-014: List uploaded files
- **Precondition:** User is authenticated. At least one file has been uploaded.
- **Steps:**
  1. Navigate to the Memory tab.
  2. Click the "Files" sub-tab.
- **Expected:** A GET request is sent to `/v1/memory/files`. The files grid displays all uploaded files. Each file card shows an appropriate icon (image/PDF/generic), the file name/key, size in KB, visibility, a "Download" link, and a "Delete" button.
- **Type:** success

### TC-MEM-015: Delete a file
- **Precondition:** User is authenticated. A file with key `notes.txt` exists in the files list.
- **Steps:**
  1. On the Files sub-tab, locate the `notes.txt` file card.
  2. Click the "Delete" button on the card.
  3. A browser confirm dialog appears.
  4. Click "OK" to confirm.
- **Expected:** A DELETE request is sent to `/v1/memory/files/notes.txt`. A success toast "Deleted" is shown. The file disappears from the grid.
- **Type:** success

### TC-MEM-016: Upload multiple files at once
- **Precondition:** User is authenticated. The file upload form is open.
- **Steps:**
  1. Click the drop zone and select 3 files in the file picker.
  2. Verify all 3 files appear in the upload list with individual key inputs and sizes.
  3. Click the "Upload (3)" button.
- **Expected:** Three sequential POST requests are sent to `/v1/memory/files`. A success toast indicates `3 files uploaded`. The form closes. All 3 files appear in the files grid.
- **Type:** success

### TC-MEM-017: Drag-and-drop file upload
- **Precondition:** User is authenticated. The file upload form is open.
- **Steps:**
  1. Drag a file from the OS file manager into the drop zone area.
  2. Observe the drop zone gains a `dragover` visual state.
  3. Drop the file.
- **Expected:** The dragover state clears. The file is added to the upload list with its filename as the default key. The file is ready for upload.
- **Type:** success

---

## Permissions Popover

### TC-MEM-018: View key permissions popover
- **Precondition:** User is authenticated. A memory entry `shared-data` exists with sharing rules configured.
- **Steps:**
  1. In the entries list, locate the `shared-data` entry.
  2. Click the shield icon next to the entry (without expanding the entry itself).
- **Expected:** A GET request is sent to `/v1/permissions/memory/shared-data`. A popover appears below the entry showing the visibility level and a list of sharing rules, each displaying the recipient badge, data pattern, and scope. A close button is available.
- **Type:** success

---

## Sub-Tab Navigation

### TC-MEM-019: Switch between entries and files sub-tabs
- **Precondition:** User is authenticated and on the Memory tab.
- **Steps:**
  1. Verify the "Entries" sub-tab is active by default.
  2. Click the "Files" sub-tab.
  3. Verify the files grid is shown.
  4. Click the "Entries" sub-tab.
  5. Verify the entries list is shown again.
- **Expected:** Sub-tab switching is immediate. The active sub-tab button has the `active` class. Content area toggles between the entries list and files grid without page reload.
- **Type:** success

---

## Failure Cases

### TC-MEM-020: Create entry with empty key
- **Precondition:** User is authenticated. The create form is open.
- **Steps:**
  1. Leave the Key field empty.
  2. Enter `some value` in the Value field.
  3. Click the "Save" button.
- **Expected:** The form's client-side guard (`if (!key || !value) return`) prevents the API call. No request is sent. The form remains open. No toast is shown.
- **Type:** failure

### TC-MEM-021: Create entry with empty value
- **Precondition:** User is authenticated. The create form is open.
- **Steps:**
  1. Enter `test-key` in the Key field.
  2. Leave the Value field empty.
  3. Click the "Save" button.
- **Expected:** The form's client-side guard prevents the API call. No request is sent. The form remains open.
- **Type:** failure

### TC-MEM-022: Create entry with duplicate key
- **Precondition:** User is authenticated. A memory entry with key `existing-key` already exists.
- **Steps:**
  1. Open the create form.
  2. Enter `existing-key` in the Key field.
  3. Enter `new value` in the Value field.
  4. Click Save.
- **Expected:** A POST request is sent to `/v1/memory`. The server responds with an error (e.g., 409 Conflict). The response has `ok: false`. A failure toast "Save failed" is displayed. The form remains open.
- **Type:** failure

### TC-MEM-023: Delete non-existent entry
- **Precondition:** User is authenticated. The key `ghost-key` does not exist on the server (e.g., deleted by another session).
- **Steps:**
  1. Trigger a delete for `ghost-key` (e.g., entry was visible from stale list).
  2. Confirm the deletion dialog.
- **Expected:** A DELETE request is sent to `/v1/memory/ghost-key`. The server responds with 404. The response has `ok: false` with an error message. An error toast is displayed with the server's error message. The entries list reloads.
- **Type:** failure

### TC-MEM-024: Upload file exceeding size limit
- **Precondition:** User is authenticated. The file upload form is open. The server has a file size limit configured.
- **Steps:**
  1. Select a file larger than the server's maximum allowed size (e.g., 50 MB).
  2. Click Upload.
- **Expected:** The POST request is sent but the server rejects it with an error (e.g., 413 Payload Too Large). The fail counter increments. A failure toast shows `1 upload failed`. The form remains open.
- **Type:** failure

### TC-MEM-025: Unauthenticated access to memory API
- **Precondition:** User is not logged in or the session token has expired.
- **Steps:**
  1. Navigate to the Memory tab (or trigger any memory API call).
- **Expected:** The API calls to `/v1/memory` and `/v1/memory/files` return 401 Unauthorized. The `catch` blocks in `loadMemories()` and `loadFiles()` handle the error gracefully, setting empty arrays. The tab shows empty state for both entries and files.
- **Type:** failure

---

## Edge Cases

### TC-MEM-026: Special characters in memory key
- **Precondition:** User is authenticated and on the Memory tab.
- **Steps:**
  1. Open the create form.
  2. Enter `my/key with spaces & symbols!` as the Key.
  3. Enter `test value` as the Value.
  4. Click Save.
- **Expected:** The key is sent as-is in the POST body. The server either accepts it (and the key is properly URL-encoded via `encodeURIComponent` for subsequent GET/PUT/DELETE operations) or rejects it with a validation error. If accepted, the entry is displayed with the key escaped via `escHtml()`.
- **Type:** edge

### TC-MEM-027: Very long memory value
- **Precondition:** User is authenticated and on the Memory tab.
- **Steps:**
  1. Open the create form.
  2. Enter `long-value-key` as the Key.
  3. Paste a 100,000-character string into the Value textarea.
  4. Click Save.
- **Expected:** The POST request is sent with the full value. If the server accepts it, the entry appears in the list. When expanded, the value is rendered in a `<pre>` block. The browser handles the large content without crashing (may scroll). If the server has a payload limit, an appropriate error is returned.
- **Type:** edge

### TC-MEM-028: Object value displayed as formatted JSON
- **Precondition:** User is authenticated. A memory entry has a JSON object as its value (stored server-side as an object, not a string).
- **Steps:**
  1. Expand the entry with the object value.
- **Expected:** The value is displayed as pretty-printed JSON (`JSON.stringify(value, null, 2)`) inside a `<pre>` block, since the code checks `typeof m.value === 'object'`.
- **Type:** edge

### TC-MEM-029: Concurrent edits (version conflict)
- **Precondition:** User is authenticated. Two browser tabs are open on the Memory tab. Entry `shared-doc` exists.
- **Steps:**
  1. In Tab A, expand `shared-doc` and click Edit. The modal shows value `v1`.
  2. In Tab B, expand `shared-doc`, click Edit, change value to `v2`, and save.
  3. In Tab A, change value to `v3` and click Save.
- **Expected:** If the server implements optimistic concurrency (e.g., ETag/version checks), Tab A's PUT request may return a 409 Conflict, and an error toast is displayed. If the server does not implement versioning, Tab A's save overwrites Tab B's change silently (last-write-wins). The entries list reloads to show the current state.
- **Type:** edge

### TC-MEM-030: Empty entries list shows empty state
- **Precondition:** User is authenticated. No memory entries exist.
- **Steps:**
  1. Navigate to the Memory tab, Entries sub-tab.
- **Expected:** The entries area shows the empty state message. The search bar and "New" button are still visible and functional.
- **Type:** edge

### TC-MEM-031: Empty files list shows empty state
- **Precondition:** User is authenticated. No files have been uploaded.
- **Steps:**
  1. Navigate to the Memory tab, Files sub-tab.
- **Expected:** The files area shows the empty state message. The "Upload" button and size limit hint are still visible.
- **Type:** edge

### TC-MEM-032: File key can be edited before upload
- **Precondition:** User is authenticated. The file upload form is open.
- **Steps:**
  1. Select a file named `photo.jpg`.
  2. The file appears in the upload list with key defaulting to `photo.jpg`.
  3. Change the key input to `vacation-2026`.
  4. Click Upload.
- **Expected:** The file is uploaded with key `vacation-2026` instead of the original filename. The file appears in the files grid under the custom key.
- **Type:** edge

### TC-MEM-033: Duplicate files are deduplicated in upload form
- **Precondition:** User is authenticated. The file upload form is open.
- **Steps:**
  1. Select `file-a.txt` via the file picker.
  2. Click the drop zone again and select `file-a.txt` again (same name and size).
- **Expected:** The second selection is ignored because `addFiles()` checks for duplicates using `file.name + file.size`. Only one instance of `file-a.txt` appears in the upload list.
- **Type:** edge

### TC-MEM-034: Dismiss edit modal by clicking overlay
- **Precondition:** User is authenticated. The edit modal is open for a memory entry.
- **Steps:**
  1. Click on the dark overlay area outside the modal dialog.
- **Expected:** The `modal-overlay` click handler calls `onCancel()`. The modal closes without saving. The entry value remains unchanged.
- **Type:** edge
