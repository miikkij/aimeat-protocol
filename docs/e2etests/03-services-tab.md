# Services Tab - E2E Test Cases

## Overview

The Services Tab allows users to publish their own services to the AIMEAT catalogue, manage existing services, and browse available services from other providers. It has two sub-tabs: **Mine** (my published services) and **Catalogue** (browse all services with category filtering).

### Components

- **ServicesTab** (`public/views/profile/services-tab.js`) - Main tab component
- **PublishForm** - Form to publish a new service (name, description, category, price, unit, webhook)
- **ServiceCard** - Expandable card displaying service summary
- **ServiceDetail** - Lazy-loaded detail panel fetched from API on expand
- **SchemaPreview** - Renders JSON schemas as formatted code blocks

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/catalogue?owner=...` | List services owned by a specific owner |
| GET | `/v1/catalogue?category=...` | Browse catalogue filtered by category |
| GET | `/v1/catalogue` | Browse all catalogue entries |
| GET | `/v1/catalogue/:actionId` | Get full details for a single service |
| POST | `/v1/catalogue` | Publish a new service |
| DELETE | `/v1/catalogue/:id` | Unpublish (delete) a service |

### Service Layer (`public/js/services/catalogue.js`)

- `listMyServices(owner)` - GET with owner filter, returns array from `data.actions` or `data`
- `browse(category)` - GET optionally filtered by category, returns array
- `publish(name, description, category, priceMorsels, unit, webhookUrl)` - POST new service
- `unpublish(serviceId)` - DELETE service by ID

### Service Categories

`language`, `translation`, `analysis`, `generation`, `coding`, `data`, `image`, `audio`, `video`, `search`, `utility`, `other`

---

## Table of Contents

- [Publish and Manage Services](#publish-and-manage-services)
  - [TC-SVC-001: Publish a new service](#tc-svc-001-publish-a-new-service)
  - [TC-SVC-002: List my published services](#tc-svc-002-list-my-published-services)
  - [TC-SVC-003: Expand service card to view details](#tc-svc-003-expand-service-card-to-view-details)
  - [TC-SVC-004: Unpublish a service](#tc-svc-004-unpublish-a-service)
  - [TC-SVC-005: Full publish, list, expand, unpublish cycle](#tc-svc-005-full-publish-list-expand-unpublish-cycle)
  - [TC-SVC-006: Publish multiple services](#tc-svc-006-publish-multiple-services)
- [Browse Catalogue](#browse-catalogue)
  - [TC-SVC-007: Browse all catalogue entries](#tc-svc-007-browse-all-catalogue-entries)
  - [TC-SVC-008: Filter catalogue by category](#tc-svc-008-filter-catalogue-by-category)
  - [TC-SVC-009: Expand catalogue entry to view details](#tc-svc-009-expand-catalogue-entry-to-view-details)
- [Sub-Tab Navigation](#sub-tab-navigation)
  - [TC-SVC-010: Switch between mine and catalogue sub-tabs](#tc-svc-010-switch-between-mine-and-catalogue-sub-tabs)
- [Failure Cases](#failure-cases)
  - [TC-SVC-011: Publish with missing name](#tc-svc-011-publish-with-missing-name)
  - [TC-SVC-012: Publish with negative price](#tc-svc-012-publish-with-negative-price)
  - [TC-SVC-013: Unpublish non-existent service](#tc-svc-013-unpublish-non-existent-service)
  - [TC-SVC-014: Unpublish another user's service](#tc-svc-014-unpublish-another-users-service)
  - [TC-SVC-015: Service detail fetch fails](#tc-svc-015-service-detail-fetch-fails)
- [Edge Cases](#edge-cases)
  - [TC-SVC-016: Empty my services list](#tc-svc-016-empty-my-services-list)
  - [TC-SVC-017: Empty catalogue](#tc-svc-017-empty-catalogue)
  - [TC-SVC-018: Special characters in service name](#tc-svc-018-special-characters-in-service-name)
  - [TC-SVC-019: Very long description](#tc-svc-019-very-long-description)
  - [TC-SVC-020: Service with complex input/output schema](#tc-svc-020-service-with-complex-inputoutput-schema)
  - [TC-SVC-021: Free service (zero price)](#tc-svc-021-free-service-zero-price)
  - [TC-SVC-022: Catalogue loads lazily on sub-tab switch](#tc-svc-022-catalogue-loads-lazily-on-sub-tab-switch)
  - [TC-SVC-023: Service detail fetch cancellation on rapid toggle](#tc-svc-023-service-detail-fetch-cancellation-on-rapid-toggle)

---

## Publish and Manage Services

### TC-SVC-001: Publish a new service
- **Precondition:** User is authenticated and on the Services tab, "Mine" sub-tab.
- **Steps:**
  1. Click the "Publish" button to open the publish form.
  2. Enter `Translation Helper` in the Name field.
  3. Enter `Translates text between languages` in the Description textarea.
  4. Select `translation` from the Category dropdown.
  5. Enter `5` in the Price field.
  6. Select `Per call` from the Unit dropdown.
  7. Enter `https://example.com/webhook` in the Webhook field.
  8. Click the "Publish" save button.
- **Expected:** A POST request is sent to `/v1/catalogue` with body:
  ```json
  {
    "display_name": "Translation Helper",
    "description": "Translates text between languages",
    "category": "translation",
    "price_morsels": 5,
    "unit": "call",
    "webhook_url": "https://example.com/webhook"
  }
  ```
  A success toast "Published" is displayed. The form closes. The my services list reloads and includes the new service.
- **Type:** success

### TC-SVC-002: List my published services
- **Precondition:** User is authenticated and has at least 2 published services.
- **Steps:**
  1. Navigate to the Services tab.
  2. Ensure the "Mine" sub-tab is active.
- **Expected:** A GET request is sent to `/v1/catalogue?owner=<current_owner>`. The services list displays all owned services as expandable cards. Each card shows the display name, category badge, and price badge (e.g., `5 morsels`).
- **Type:** success

### TC-SVC-003: Expand service card to view details
- **Precondition:** User is authenticated. At least one service exists in "My Services".
- **Steps:**
  1. Click on a service card to expand it.
- **Expected:** A GET request is sent to `/v1/catalogue/<actionId>` to lazy-load full details. While loading, a spinner is shown inside the card. Once loaded, the detail panel shows:
  - Description
  - Provider GAII
  - Price (morsels + unit)
  - Webhook URL (if set)
  - Estimated time (if set)
  - Tags (if any)
  - Input schema (if defined, rendered as formatted JSON)
  - Output schema (if defined, rendered as formatted JSON)
  - Created date
  The expand icon changes from right-arrow to down-arrow. An "Unpublish" button appears in the actions area.
- **Type:** success

### TC-SVC-004: Unpublish a service
- **Precondition:** User is authenticated. A service with known ID exists in "My Services".
- **Steps:**
  1. Expand a service card.
  2. Click the "Delete" (unpublish) button in the detail actions area.
  3. A browser confirm dialog appears.
  4. Click "OK" to confirm.
- **Expected:** A DELETE request is sent to `/v1/catalogue/<serviceId>`. A success toast "Unpublished" is displayed. The my services list reloads and the service is no longer present.
- **Type:** success

### TC-SVC-005: Full publish, list, expand, unpublish cycle
- **Precondition:** User is authenticated and on the Services tab.
- **Steps:**
  1. Publish a service named `Test Service` with category `utility`, price `0`, unit `call`.
  2. Verify `Test Service` appears in the My Services list.
  3. Click the card to expand it and verify the details load.
  4. Click the unpublish button and confirm.
  5. Verify `Test Service` no longer appears.
- **Expected:** Each step completes with appropriate toast messages. The full lifecycle (publish, list, detail, unpublish) works end-to-end.
- **Type:** success

### TC-SVC-006: Publish multiple services
- **Precondition:** User is authenticated.
- **Steps:**
  1. Publish 3 services with different names and categories.
  2. View the "Mine" sub-tab.
- **Expected:** All 3 services are listed. Each shows the correct name, category badge, and price. The `onStats` callback reports the correct count.
- **Type:** success

---

## Browse Catalogue

### TC-SVC-007: Browse all catalogue entries
- **Precondition:** User is authenticated. Multiple services from various owners exist in the catalogue.
- **Steps:**
  1. Switch to the "Catalogue" sub-tab.
  2. Leave the category filter set to "All categories".
- **Expected:** A GET request is sent to `/v1/catalogue` (no category filter). All published services from all owners are displayed as expandable cards. Each card shows the service name, category badge, price badge, description, and owner name.
- **Type:** success

### TC-SVC-008: Filter catalogue by category
- **Precondition:** User is authenticated. The catalogue contains services in multiple categories including `coding` and `translation`.
- **Steps:**
  1. Switch to the "Catalogue" sub-tab.
  2. Select `coding` from the category dropdown.
- **Expected:** A GET request is sent to `/v1/catalogue?category=coding`. The catalogue updates to show only services with category `coding`. Services from other categories are not displayed.
- **Type:** success

### TC-SVC-009: Expand catalogue entry to view details
- **Precondition:** User is authenticated. The catalogue sub-tab is active with entries listed.
- **Steps:**
  1. Click on a service card in the catalogue.
- **Expected:** A GET request is sent to `/v1/catalogue/<actionId>`. The detail panel loads and shows the full service information (same layout as in "My Services" but without the unpublish action button). Clicking another card collapses the first via independent expand tracking (`expandedCat` state).
- **Type:** success

---

## Sub-Tab Navigation

### TC-SVC-010: Switch between mine and catalogue sub-tabs
- **Precondition:** User is authenticated and on the Services tab.
- **Steps:**
  1. Verify "Mine" sub-tab is active by default.
  2. Click the "Catalogue" sub-tab.
  3. Verify catalogue content loads.
  4. Click the "Mine" sub-tab.
  5. Verify my services list is shown again.
- **Expected:** Sub-tab switching is immediate. The "Catalogue" data loads on first switch (lazy loading: `if (!catalogue) loadCatalogueData(catFilter)`). Subsequent switches between tabs preserve the loaded data. The active button has the `active` class.
- **Type:** success

---

## Failure Cases

### TC-SVC-011: Publish with missing name
- **Precondition:** User is authenticated. The publish form is open.
- **Steps:**
  1. Leave the Name field empty.
  2. Fill in a description and category.
  3. Click "Publish".
- **Expected:** The POST request is sent with `display_name: ""`. The server responds with a validation error (e.g., 400 Bad Request, `ok: false`). An error toast is displayed. The form remains open.
- **Type:** failure

### TC-SVC-012: Publish with negative price
- **Precondition:** User is authenticated. The publish form is open.
- **Steps:**
  1. Enter a valid service name and description.
  2. Enter `-5` in the Price field (bypassing the `min="0"` browser validation).
  3. Click "Publish".
- **Expected:** The `Number(priceMorsels)` in the service layer converts `-5` to `-5`. The POST is sent to the server. The server should reject a negative price with a validation error. An error toast is displayed. Note: the HTML input has `min="0"` which provides browser-level prevention under normal use.
- **Type:** failure

### TC-SVC-013: Unpublish non-existent service
- **Precondition:** User is authenticated. A service was previously visible but has been deleted from another session.
- **Steps:**
  1. Click unpublish on the stale service entry.
  2. Confirm the dialog.
- **Expected:** A DELETE request is sent to `/v1/catalogue/<staleId>`. The server responds with 404. The response has `ok: false` with an error message. An error toast is displayed with the server message. The services list reloads.
- **Type:** failure

### TC-SVC-014: Unpublish another user's service
- **Precondition:** User is authenticated. Somehow the UI displays a service owned by a different user (e.g., through catalogue sub-tab manipulation or API tampering).
- **Steps:**
  1. Attempt to send a DELETE request to `/v1/catalogue/<other_users_service_id>`.
- **Expected:** The server responds with 403 Forbidden. The response has `ok: false`. An error toast is displayed with the server's access denied message.
- **Type:** failure

### TC-SVC-015: Service detail fetch fails
- **Precondition:** User is authenticated. A service exists in the list but the detail endpoint is unavailable.
- **Steps:**
  1. Click on a service card to expand it.
- **Expected:** The `fetchServiceDetail()` call fails. The `catch` block sets an error message. The detail panel displays the error text (e.g., "Failed to load details") instead of a spinner. The card remains expanded with the error visible.
- **Type:** failure

---

## Edge Cases

### TC-SVC-016: Empty my services list
- **Precondition:** User is authenticated. The user has not published any services.
- **Steps:**
  1. Navigate to the Services tab, "Mine" sub-tab.
- **Expected:** The "Publish" button is visible. Below it, the empty state message is displayed. No service cards are rendered.
- **Type:** edge

### TC-SVC-017: Empty catalogue
- **Precondition:** User is authenticated. No services exist in the catalogue (or all are filtered out by category).
- **Steps:**
  1. Switch to the "Catalogue" sub-tab.
  2. Select a category that has no services (e.g., `audio`).
- **Expected:** The category dropdown is visible. The empty state message for the catalogue is displayed below the filter.
- **Type:** edge

### TC-SVC-018: Special characters in service name
- **Precondition:** User is authenticated. The publish form is open.
- **Steps:**
  1. Enter `AI <Script> & "Translation"` as the service name.
  2. Fill in other required fields and publish.
- **Expected:** The name is sent as-is in the POST body. If the server accepts it, the service appears in the list with the name properly escaped via `escHtml()` (no XSS). The `<Script>` tag is rendered as literal text, not executed.
- **Type:** edge

### TC-SVC-019: Very long description
- **Precondition:** User is authenticated. The publish form is open.
- **Steps:**
  1. Enter a valid service name.
  2. Paste a 10,000-character description.
  3. Publish.
- **Expected:** The POST request includes the full description. If the server has a character limit, a validation error is returned. If accepted, the description is truncated or scrollable in the card subtitle display.
- **Type:** edge

### TC-SVC-020: Service with complex input/output schema
- **Precondition:** User is authenticated. A service exists with detailed `input_schema` and `output_schema` JSON schema objects (e.g., with nested properties, types, required fields).
- **Steps:**
  1. Expand the service card to load details.
- **Expected:** The `SchemaPreview` component renders both schemas as pretty-printed JSON (`JSON.stringify(schema, null, 2)`) inside `<pre>` blocks. The schemas are readable and properly formatted. Labels "Input schema" and "Output schema" are shown.
- **Type:** edge

### TC-SVC-021: Free service (zero price)
- **Precondition:** User is authenticated. A service exists with `price_morsels: 0`.
- **Steps:**
  1. View the service card in the list.
- **Expected:** The price badge shows the localized "Free" text instead of `0 morsels`. The `ServiceCard` component checks `priceMorsels ? priceMorsels + ' morsels' : t('profile.services.free')`.
- **Type:** edge

### TC-SVC-022: Catalogue loads lazily on sub-tab switch
- **Precondition:** User is authenticated. The Services tab just opened (Mine sub-tab is default).
- **Steps:**
  1. Observe that no GET request is made to `/v1/catalogue` on initial load (only `?owner=` is called for My Services).
  2. Click the "Catalogue" sub-tab.
- **Expected:** Only when switching to "Catalogue" for the first time is the `loadCatalogueData()` function called. The condition `if (!catalogue) loadCatalogueData(catFilter)` ensures no redundant fetch on subsequent switches back.
- **Type:** edge

### TC-SVC-023: Service detail fetch cancellation on rapid toggle
- **Precondition:** User is authenticated. A service is listed in the catalogue.
- **Steps:**
  1. Click a service card to expand it (starts loading details).
  2. Immediately click the card again to collapse it.
  3. Click the card again to re-expand.
- **Expected:** The first `fetchServiceDetail()` call is effectively cancelled via the `cancelled` flag in the `useEffect` cleanup function. The second expansion triggers a new fetch. No stale data from the first request leaks into the second render. No errors are thrown.
- **Type:** edge
