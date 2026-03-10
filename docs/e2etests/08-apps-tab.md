# E2E Test Plan: Apps Tab

## Overview

The Apps Tab (`public/views/profile/apps-tab.js`) provides app management for AIMEAT users. Users can upload HTML apps (with optional screenshots and access codes), browse their own apps, view a gallery of all apps on the node, manage access code protection, and launch apps via the AIMEAT OS launcher.

## APIs Under Test

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/v1/apps` | Upload a new app (base64-encoded HTML + optional screenshot + access code) |
| GET | `/v1/apps` | List all apps on the node |
| DELETE | `/v1/apps/:filename` | Delete an app by filename |
| PATCH | `/v1/apps/:filename` | Update app metadata (access code) |

## Key Implementation Details

- Upload reads the file as base64 via `FileReader.readAsDataURL()`, splitting on the comma to get the base64 portion.
- The upload form only accepts `.html` and `.htm` files (enforced by `accept=".html,.htm"` on the file input).
- Screenshot upload is optional; accepted types are any image (`accept="image/*"`).
- Access code can be set during upload or edited later via PATCH.
- Clearing the access code (saving an empty value) sends `{ access_code: null }` to remove protection.
- "My Apps" section filters `allApps` by `a.owner === session.owner`.
- The gallery section shows all apps from all owners with screenshot thumbnails.
- Protected apps display a lock badge in the card header.
- Download links follow the pattern `/v1/apps/:owner/:filename`.
- The launcher link points to `/v1/aimeat-os`.
- App size is displayed in KB (rounded via `Math.round(size / 1024)`).

## Table of Contents

- [TC-AP001: Upload HTML App, List, Verify](#tc-ap001-upload-html-app-list-verify)
- [TC-AP002: Upload App with Access Code Shows Lock Badge](#tc-ap002-upload-app-with-access-code-shows-lock-badge)
- [TC-AP003: Delete App](#tc-ap003-delete-app)
- [TC-AP004: Edit Access Code Save and Cancel](#tc-ap004-edit-access-code-save-and-cancel)
- [TC-AP005: App Launcher Link Works](#tc-ap005-app-launcher-link-works)
- [TC-AP006: Upload Non-HTML File](#tc-ap006-upload-non-html-file)
- [TC-AP007: Upload Duplicate Filename](#tc-ap007-upload-duplicate-filename)
- [TC-AP008: Delete Non-Existent App](#tc-ap008-delete-non-existent-app)
- [TC-AP009: Delete Another User's App](#tc-ap009-delete-another-users-app)
- [TC-AP010: Unauthenticated Access](#tc-ap010-unauthenticated-access)
- [TC-AP011: Empty Apps List](#tc-ap011-empty-apps-list)
- [TC-AP012: App with Very Long Filename](#tc-ap012-app-with-very-long-filename)
- [TC-AP013: App with Screenshot](#tc-ap013-app-with-screenshot)
- [TC-AP014: Remove Access Code](#tc-ap014-remove-access-code)

---

## Success Cases

### TC-AP001: Upload HTML App, List, Verify
- **Precondition:** User is authenticated. No apps uploaded yet.
- **Steps:**
  1. Navigate to the Apps tab.
  2. Click the "Upload" button to show the upload form.
  3. Select an HTML file (e.g., `my-app.html`) via the file input.
  4. Leave screenshot empty.
  5. Leave access code empty.
  6. Click the "Save" / upload button.
  7. Wait for upload to complete.
  8. Observe the "My Apps" section.
- **Expected:** POST `/v1/apps` is called with `{ filename: "my-app.html", content: "<base64>", mime_type: "text/html" }`. Toast shows upload success message. Upload form hides. App list reloads. The new app appears in "My Apps" with: filename, content type badge ("html"), download link, size in KB, "Edit Access Code" button, and "Delete" button. The app also appears in the gallery section. `onStats` is called with `{ apps: 1 }`.
- **Type:** success

### TC-AP002: Upload App with Access Code Shows Lock Badge
- **Precondition:** User is authenticated.
- **Steps:**
  1. Click the "Upload" button.
  2. Select an HTML file.
  3. Enter an access code: `secret123`.
  4. Click save.
  5. Observe the app card.
- **Expected:** POST `/v1/apps` includes `access_code: "secret123"` in the body. The app card in "My Apps" shows a lock badge emoji next to the content type badge (rendered when `a.protected` is true). In the gallery, the app shows the lock indicator and "Protected" text in the metadata line.
- **Type:** success

### TC-AP003: Delete App
- **Precondition:** User has at least one uploaded app.
- **Steps:**
  1. Navigate to the Apps tab.
  2. Click "Delete" on an app card.
  3. Confirm the browser `confirm()` dialog.
  4. Wait for deletion.
- **Expected:** DELETE `/v1/apps/:filename` returns success. Toast shows "App deleted" message. App list reloads. The deleted app no longer appears in "My Apps" or the gallery.
- **Type:** success

### TC-AP004: Edit Access Code Save and Cancel
- **Precondition:** User has an uploaded app.
- **Steps:**
  1. Navigate to the Apps tab.
  2. Click "Edit Access Code" on an app card.
  3. Observe the inline edit form appears with an input field and Save/Cancel buttons.
  4. Type a new access code: `newcode`.
  5. Click "Save".
  6. Wait for update.
  7. Repeat steps 2-3 for another edit.
  8. Click "Cancel".
- **Expected:**
  - Step 5: PATCH `/v1/apps/:filename` is called with `{ access_code: "newcode" }`. Toast shows "App updated". Edit form closes. App list reloads and the app now shows a lock badge.
  - Step 8: Edit form closes without any API call. No changes are persisted. The `editingApp` and `editCode` state reset.
- **Type:** success

### TC-AP005: App Launcher Link Works
- **Precondition:** User is authenticated.
- **Steps:**
  1. Navigate to the Apps tab.
  2. Locate the "Launcher" card at the top.
  3. Click the launcher link/button.
- **Expected:** The link navigates to `/v1/aimeat-os` in a new tab (`target="_blank"`). The launcher page loads, providing a UI to browse and run uploaded apps.
- **Type:** success

---

## Failure Cases

### TC-AP006: Upload Non-HTML File
- **Precondition:** User is authenticated.
- **Steps:**
  1. Click the "Upload" button.
  2. Attempt to select a `.png` or `.js` file via the file input.
- **Expected:** The file input has `accept=".html,.htm"` which filters the file picker to only show HTML files in the OS dialog. If the user bypasses the filter (e.g., selects "All Files") and picks a non-HTML file, the server should reject it based on content type validation. The server response with an error causes a toast: "Upload failed".
- **Type:** failure

### TC-AP007: Upload Duplicate Filename
- **Precondition:** User has already uploaded an app named `my-app.html`.
- **Steps:**
  1. Click "Upload" button.
  2. Select another file also named `my-app.html`.
  3. Click save.
- **Expected:** The server returns an error (duplicate filename for the same owner). Toast shows "Upload failed". The existing app remains unchanged.
- **Type:** failure

### TC-AP008: Delete Non-Existent App
- **Precondition:** User is authenticated.
- **Steps:**
  1. Programmatically call `deleteApp('nonexistent-file.html')`.
- **Expected:** DELETE `/v1/apps/nonexistent-file.html` returns 404. Toast shows the error message from the response or "Delete failed" fallback.
- **Type:** failure

### TC-AP009: Delete Another User's App
- **Precondition:** User `alice` is authenticated. User `bob` has an uploaded app visible in the gallery.
- **Steps:**
  1. Programmatically call `deleteApp('bobs-app.html')` while authenticated as `alice`.
- **Expected:** DELETE `/v1/apps/bobs-app.html` returns 403 Forbidden (ownership check fails on the server). Toast shows "Delete failed" with the server error message. The app remains in the gallery.
- **Type:** failure

### TC-AP010: Unauthenticated Access
- **Precondition:** No valid session/token.
- **Steps:**
  1. Call `POST /v1/apps` without an Authorization header.
  2. Call `DELETE /v1/apps/test.html` without an Authorization header.
  3. Call `PATCH /v1/apps/test.html` without an Authorization header.
- **Expected:** All mutation endpoints return 401 Unauthorized. GET `/v1/apps` may or may not require auth depending on configuration, but the profile tab itself requires login.
- **Type:** failure

---

## Edge Cases

### TC-AP011: Empty Apps List
- **Precondition:** User is authenticated. No apps have been uploaded by anyone on the node.
- **Steps:**
  1. Navigate to the Apps tab.
  2. Observe the "My Apps" section.
  3. Observe the "Gallery" section.
- **Expected:** "My Apps" shows the empty state message from `t('profile.apps.empty')`. Gallery shows the empty state from `t('profile.apps.galleryEmpty')`. The upload button, launcher card, and create guide card are still visible and functional. `onStats` is called with `{ apps: 0 }`.
- **Type:** edge

### TC-AP012: App with Very Long Filename
- **Precondition:** User is authenticated.
- **Steps:**
  1. Upload an HTML file with a very long filename (e.g., 200 characters): `aaaa...aaaa.html`.
  2. Observe the app card rendering.
- **Expected:** The filename is displayed in the card title via `escHtml()`. The card layout may wrap or truncate depending on CSS, but no JavaScript error occurs. The download link correctly encodes the long filename via `encodeURIComponent()`. Delete and edit operations work with the long filename.
- **Type:** edge

### TC-AP013: App with Screenshot
- **Precondition:** User is authenticated.
- **Steps:**
  1. Click "Upload" button.
  2. Select an HTML file.
  3. Select a PNG screenshot via the screenshot file input.
  4. Click save.
  5. Observe the gallery section.
- **Expected:** POST `/v1/apps` includes `screenshot` (base64) and `screenshot_mime_type: "image/png"` fields. After upload, the gallery card for this app shows the screenshot image via `<img>` tag with `src` set to `NODE_URL + a.screenshot_url`. If the image fails to load, the `handleImgError` function is invoked (graceful fallback). Apps without screenshots show a placeholder icon instead.
- **Type:** edge

### TC-AP014: Remove Access Code
- **Precondition:** User has an app with an access code set (shows lock badge).
- **Steps:**
  1. Click "Edit Access Code" on the protected app.
  2. Clear the access code input field (leave it empty).
  3. Observe the hint text: "Save empty to remove access code protection".
  4. Click "Save".
- **Expected:** PATCH `/v1/apps/:filename` is called with `{ access_code: null }` (when `editCode.trim()` is empty, the body sends `null`). Toast shows "App updated". App card reloads without the lock badge. The app is no longer protected.
- **Type:** edge
