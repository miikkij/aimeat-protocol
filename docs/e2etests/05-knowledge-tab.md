# E2E Test Plan: Knowledge Tab

## Overview

The Knowledge Tab (`public/views/profile/knowledge-tab.js`) provides knowledge package management for AIMEAT users. It enables importing AI-generated knowledge packages, browsing personal and discovered packages, cloning shared packages, and exporting/deleting owned packages.

## APIs Under Test

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/v1/templates/knowledge-packager-human` | Fetch human prompt template |
| GET | `/v1/templates/knowledge-packager-agent` | Fetch agent prompt template |
| POST | `/v1/packages/import` | Import a knowledge package from AI chat JSON |
| GET | `/v1/memory?prefix=packages/&tags=knowledge-package` | List user's packages |
| GET | `/v1/memory/:key` | Hydrate individual package manifest |
| GET | `/v1/packages/:id/export` | Export package as portable JSON |
| DELETE | `/v1/memory/:key` | Delete package entries (iterative) |
| POST | `/v1/packages/:id/clone` | Clone a discoverable package |
| GET | `/v1/catalogue/knowledge` | Discover public packages |
| GET | `/v1/packages/organism/:id` | List packages shared with an organism |

## Key Implementation Details

- Import supports both AI chat format (`{ aimeat_knowledge_package: true, package: {...} }`) and full manifest format.
- Import parser strips markdown code block wrappers (` ```json ... ``` `) before parsing.
- Default `sharing.allow_clone` is `false` on import; packages must explicitly set it to `true` to be cloneable.
- The clone endpoint (`POST /v1/packages/:id/clone`) uses `requireAuth()` without role restriction (was previously `requireRole('agent')` which blocked owner tokens -- fixed).
- Package deletion iterates over all memory keys under `packages/{id}/` and deletes each individually.
- GHII mismatch warning is shown when `target_ghii` in the imported JSON does not match the current user's GHII.
- Catalog listing toggle defaults to `pkg.sharing.catalog_listed ?? true` in the preview.
- Discovery results include a trust advisory warning on each card.

## Table of Contents

- [TC-K001: Import AI Chat Format Package](#tc-k001-import-ai-chat-format-package)
- [TC-K002: Import Full Manifest Format Package](#tc-k002-import-full-manifest-format-package)
- [TC-K003: List Packages After Import](#tc-k003-list-packages-after-import)
- [TC-K004: Expand Package Shows Entries and Metadata](#tc-k004-expand-package-shows-entries-and-metadata)
- [TC-K005: Export Package Copies JSON](#tc-k005-export-package-copies-json)
- [TC-K006: Delete Package Removes All Entries](#tc-k006-delete-package-removes-all-entries)
- [TC-K007: Clone Discoverable Package with allow_clone=true](#tc-k007-clone-discoverable-package-with-allow_clonetrue)
- [TC-K008: Copy Human Prompt Template](#tc-k008-copy-human-prompt-template)
- [TC-K009: Copy Agent Prompt Template](#tc-k009-copy-agent-prompt-template)
- [TC-K010: Discover Packages Listing](#tc-k010-discover-packages-listing)
- [TC-K011: Import Invalid JSON](#tc-k011-import-invalid-json)
- [TC-K012: Import Non-Knowledge-Package JSON](#tc-k012-import-non-knowledge-package-json)
- [TC-K013: Clone Package with allow_clone=false](#tc-k013-clone-package-with-allow_clonefalse)
- [TC-K014: Clone Non-Existent Package](#tc-k014-clone-non-existent-package)
- [TC-K015: Delete Non-Existent Package](#tc-k015-delete-non-existent-package)
- [TC-K016: Import with GHII Mismatch](#tc-k016-import-with-ghii-mismatch)
- [TC-K017: Unauthenticated Import](#tc-k017-unauthenticated-import)
- [TC-K018: Import with Code Block Wrapped JSON](#tc-k018-import-with-code-block-wrapped-json)
- [TC-K019: Package with 0 Entries](#tc-k019-package-with-0-entries)
- [TC-K020: Package with Very Long Entry Values](#tc-k020-package-with-very-long-entry-values)
- [TC-K021: Empty Discovery Results](#tc-k021-empty-discovery-results)
- [TC-K022: Organism Packages When User Has No Organisms](#tc-k022-organism-packages-when-user-has-no-organisms)

---

## Success Cases

### TC-K001: Import AI Chat Format Package
- **Precondition:** User is authenticated with a valid owner session. No packages exist yet.
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Paste a valid AI chat format JSON into the import textarea:
     ```json
     {
       "aimeat_knowledge_package": true,
       "package": {
         "type": "knowledge-package",
         "name": "Test Research",
         "version": "1.0.0",
         "content_type": "research",
         "language": "en",
         "tags": ["test"],
         "synthesis": { "level": "original", "description": "Test" },
         "sharing": { "catalog_listed": false, "allow_clone": false, "morsel_price": 0 },
         "entries": [
           { "key": "intro", "title": "Introduction", "value": "Hello world", "visibility": "private" }
         ]
       }
     }
     ```
  3. Verify preview section appears with package name, content type badge, synthesis badge, and entry list.
  4. Verify GHII confirmation message is shown (green, matching current user).
  5. Click "Confirm Import" button.
  6. Wait for import to complete.
- **Expected:** Toast shows success message. Import textarea clears. Preview disappears. Package list reloads and shows the newly imported package.
- **Type:** success

### TC-K002: Import Full Manifest Format Package
- **Precondition:** User is authenticated.
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Paste a full manifest JSON (without the `aimeat_knowledge_package` wrapper, just the `package` object with `type: "knowledge-package"`):
     ```json
     {
       "package": {
         "type": "knowledge-package",
         "name": "Full Manifest Test",
         "version": "1.0.0",
         "author": "testuser@node",
         "content_type": "document",
         "language": "en",
         "tags": ["docs"],
         "synthesis": { "level": "assisted", "description": "AI-assisted" },
         "sharing": { "catalog_listed": true, "allow_clone": true, "morsel_price": 0 },
         "entries": [
           { "key": "chapter1", "title": "Chapter 1", "value": "Content here", "visibility": "public" },
           { "key": "chapter2", "title": "Chapter 2", "value": "More content", "visibility": "private" }
         ],
         "references": [
           { "title": "Source A", "url": "https://example.com", "verified": true },
           { "title": "Source B", "url": "https://example2.com", "verified": false }
         ]
       }
     }
     ```
  3. Verify preview shows 2 entries with visibility badges, references section with verified/unverified indicators.
  4. Click "Confirm Import".
- **Expected:** Import succeeds. POST `/v1/packages/import` returns 201 with `package_id` and `entries_created: 2`. Package appears in "My Knowledge" list.
- **Type:** success

### TC-K003: List Packages After Import
- **Precondition:** User has imported at least one knowledge package.
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Wait for loading spinner to finish.
  3. Observe the "My Knowledge" section.
- **Expected:** Package cards are displayed with: name, content type badge, synthesis level badge, maturity badge, tags, entry count, and version. Each card has Export and Delete action buttons. The `onStats` callback is called with `{ knowledge: N }` where N is the package count.
- **Type:** success

### TC-K004: Expand Package Shows Entries and Metadata
- **Precondition:** User has at least one imported package with multiple entries and references.
- **Steps:**
  1. Navigate to the Knowledge tab and wait for packages to load.
  2. Click on a package card header to expand it.
  3. Observe the expanded detail view.
- **Expected:** Expanded view shows: synthesis description (if present), all entries with visibility badges (private/owner/public), entry keys, entry values (in `<pre>` block), references section with verified checkmarks or question marks, and metadata row with package ID, author, and catalog listing status. Clicking the header again collapses the view.
- **Type:** success

### TC-K005: Export Package Copies JSON
- **Precondition:** User has at least one package. Package is public (for export endpoint to find it).
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Click "Export" button on a package card.
  3. Observe the toast notification.
- **Expected:** GET `/v1/packages/:id/export` is called. The response JSON is stringified and copied to clipboard via `navigator.clipboard.writeText()`. Toast shows "Package JSON copied to clipboard". If the export endpoint fails (e.g., package is not public), the fallback exports the manifest already loaded in memory.
- **Type:** success

### TC-K006: Delete Package Removes All Entries
- **Precondition:** User has at least one imported package.
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Click "Delete" on a package card.
  3. Confirm the browser `confirm()` dialog.
  4. Wait for deletion to complete.
- **Expected:** The service calls `GET /v1/memory?prefix=packages/{id}/` to list all entries under the package, then issues `DELETE /v1/memory/:key` for each entry (including manifest). Toast shows "Package deleted". Package list reloads without the deleted package. The expanded state is cleared.
- **Type:** success

### TC-K007: Clone Discoverable Package with allow_clone=true
- **Precondition:** Another user has a public package with `sharing.allow_clone: true` and `sharing.catalog_listed: true`. Current user is authenticated.
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Scroll to the "Discover" section.
  3. Verify discoverable packages are displayed with name, content type, synthesis level, maturity, author, entry count, and tags.
  4. Click "Clone to Mine" on a package.
- **Expected:** POST `/v1/packages/:id/clone` returns 201 with `cloned_package_id`. Toast shows "Package cloned successfully!". Package list reloads with the cloned package. The cloned package has a `derived-from` link to the original.
- **Type:** success

### TC-K008: Copy Human Prompt Template
- **Precondition:** User is authenticated.
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Click the "Copy Human Prompt" button in the action bar.
- **Expected:** GET `/v1/templates/knowledge-packager-human` is called with auth header. The response `data.prompt` text (with `{ghii}`, `{node_url}`, `{node_id}` replaced) is copied to clipboard. Toast shows the copy confirmation message.
- **Type:** success

### TC-K009: Copy Agent Prompt Template
- **Precondition:** User is authenticated.
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Click the "Copy Agent Prompt" button in the action bar.
- **Expected:** GET `/v1/templates/knowledge-packager-agent` is called. The response prompt text (with placeholders replaced for `{ghii}`, `{node_url}`, `{node_id}`, `{agent_gaii}`, `{auth_endpoint}`, `{openapi_spec}`) is copied to clipboard. Toast shows the copy confirmation.
- **Type:** success

### TC-K010: Discover Packages Listing
- **Precondition:** At least one public, catalog-listed package exists on the node (from any user).
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Scroll to the "Discover" section.
  3. Wait for loading to complete.
- **Expected:** GET `/v1/catalogue/knowledge?sort=recent&limit=10` is called. Packages are displayed as cards with: name, content type badge, synthesis badge, maturity badge, author, entry count, tags, "Clone to Mine" button, and trust advisory text.
- **Type:** success

---

## Failure Cases

### TC-K011: Import Invalid JSON
- **Precondition:** User is authenticated.
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Paste invalid text into the import textarea: `this is not json {{{`.
- **Expected:** The client-side parser catches the `JSON.parse` error. An error message is displayed below the textarea: "Could not parse the pasted content as JSON. Make sure you copy the complete output from your AI chat." No preview is shown. No API call is made.
- **Type:** failure

### TC-K012: Import Non-Knowledge-Package JSON
- **Precondition:** User is authenticated.
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Paste valid JSON that is not a knowledge package: `{"name": "test", "type": "something-else"}`.
- **Expected:** The client-side check finds neither `aimeat_knowledge_package` nor `package` field. Error message shown: "This doesn't look like an AIMEAT knowledge package. Make sure you paste the complete JSON output." No preview, no API call.
- **Type:** failure

### TC-K013: Clone Package with allow_clone=false
- **Precondition:** A public package exists in discovery results where `sharing.allow_clone` is `false` (the default).
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Scroll to "Discover" section.
  3. Click "Clone to Mine" on a package that has `allow_clone: false`.
- **Expected:** POST `/v1/packages/:id/clone` returns 403 with error code `CLONE_DISABLED` and message "This package does not allow cloning". Toast shows "Clone failed".
- **Type:** failure

### TC-K014: Clone Non-Existent Package
- **Precondition:** User is authenticated.
- **Steps:**
  1. Programmatically call `knowledgeService.clonePackage('nonexistent-uuid', 'cloned')`.
- **Expected:** POST `/v1/packages/nonexistent-uuid/clone` returns 404 with error code `NOT_FOUND` and message "Source package not found or not public". Toast shows "Clone failed".
- **Type:** failure

### TC-K015: Delete Non-Existent Package
- **Precondition:** User is authenticated.
- **Steps:**
  1. Attempt to delete a package whose entries have already been removed (e.g., double-click delete, or package entries were already cleaned up).
- **Expected:** The `deletePackage` service calls `GET /v1/memory?prefix=packages/{id}/` which returns an empty list. No DELETE calls are issued. The UI handles this gracefully -- toast shows "Package deleted" or the list simply reloads without error. No crash.
- **Type:** failure

### TC-K016: Import with GHII Mismatch
- **Precondition:** User is authenticated as `alice@node1`.
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Paste a valid knowledge package JSON where `target_ghii` is set to `bob@node2`:
     ```json
     {
       "aimeat_knowledge_package": true,
       "target_ghii": "bob@node2",
       "package": {
         "type": "knowledge-package",
         "name": "Mismatch Test",
         "entries": [{ "key": "e1", "title": "E1", "value": "v1", "visibility": "private" }],
         "content_type": "document",
         "language": "en",
         "tags": [],
         "synthesis": { "level": "original", "description": "test" },
         "sharing": { "catalog_listed": false, "allow_clone": false, "morsel_price": 0 }
       }
     }
     ```
  3. Observe the preview section.
- **Expected:** The GHII mismatch warning is displayed (yellow/warning style) showing the mismatched GHII value `bob@node2`. The import can still proceed if the user clicks confirm, but the warning serves as an advisory.
- **Type:** failure

### TC-K017: Unauthenticated Import
- **Precondition:** No valid session/token.
- **Steps:**
  1. Call `POST /v1/packages/import` without an Authorization header.
- **Expected:** Server returns 401 Unauthorized. The profile page would not be accessible without login, but the API endpoint itself rejects unauthenticated requests via `requireAuth()` middleware.
- **Type:** failure

---

## Edge Cases

### TC-K018: Import with Code Block Wrapped JSON
- **Precondition:** User is authenticated.
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Paste JSON wrapped in markdown code fences:
     ````
     ```json
     {
       "aimeat_knowledge_package": true,
       "package": {
         "type": "knowledge-package",
         "name": "Code Block Test",
         "entries": [{ "key": "e1", "title": "E1", "value": "v1", "visibility": "private" }],
         "content_type": "research",
         "language": "en",
         "tags": [],
         "synthesis": { "level": "original", "description": "test" },
         "sharing": { "catalog_listed": false, "allow_clone": false, "morsel_price": 0 }
       }
     }
     ```
     ````
- **Expected:** The parser regex `/```(?:json)?\s*\n?([\s\S]*?)\n?```/` extracts the JSON from inside the code fences. Preview displays correctly. Import proceeds normally.
- **Type:** edge

### TC-K019: Package with 0 Entries
- **Precondition:** User is authenticated.
- **Steps:**
  1. Import a valid package with an empty entries array:
     ```json
     {
       "aimeat_knowledge_package": true,
       "package": {
         "type": "knowledge-package",
         "name": "Empty Package",
         "entries": [],
         "content_type": "idea",
         "language": "en",
         "tags": [],
         "synthesis": { "level": "original", "description": "Just an idea" },
         "sharing": { "catalog_listed": false, "allow_clone": false, "morsel_price": 0 }
       }
     }
     ```
  2. Confirm import.
  3. Expand the package in "My Knowledge".
- **Expected:** Import succeeds with `entries_created: 0`. Package card shows "0 entries" count. Expanded view shows the entries heading with count 0 and the message "No entries". No crash or rendering issue.
- **Type:** edge

### TC-K020: Package with Very Long Entry Values
- **Precondition:** User is authenticated.
- **Steps:**
  1. Import a package where one entry has a value exceeding 10,000 characters.
  2. Observe the preview before confirming.
  3. Confirm import and expand the package.
- **Expected:** In the preview, entry values are truncated to 120 characters with an ellipsis ("..."). In the expanded detail view, the full value is displayed in a `<pre>` block (which may scroll). The import API accepts the full content without truncation. No UI crash from large values.
- **Type:** edge

### TC-K021: Empty Discovery Results
- **Precondition:** No public, catalog-listed packages exist on the node.
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Scroll to the "Discover" section.
  3. Wait for loading to complete.
- **Expected:** GET `/v1/catalogue/knowledge?sort=recent&limit=10` returns an empty array. The empty state message from `t('knowledge.discover.empty')` is displayed. No "Clone to Mine" buttons are shown.
- **Type:** edge

### TC-K022: Organism Packages When User Has No Organisms
- **Precondition:** User is authenticated but has no organism memberships (`session.organisms` is empty or undefined).
- **Steps:**
  1. Navigate to the Knowledge tab.
  2. Observe the "Knowledge Organisms" section.
- **Expected:** The `loadOrganismPackages` callback returns early without making any API calls (guard: `if (!session?.organisms || session.organisms.length === 0) return`). The empty state message from `t('knowledge.organisms.empty')` is displayed. No errors in console.
- **Type:** edge
