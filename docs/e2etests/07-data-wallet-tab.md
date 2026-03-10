# E2E Test Plan: Data Wallet Tab

## Overview

The Data Wallet Tab (`public/views/profile/data-wallet-tab.js`) manages consent grants, audit trails, permissions summaries, and GDPR data export. It provides a comprehensive view of who has access to the user's data, allows granting and revoking consents, and displays audit logs of data access events.

## APIs Under Test

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/v1/consent` | Grant a new consent |
| GET | `/v1/consent` | List all active consents |
| DELETE | `/v1/consent/:id` | Revoke a single consent |
| GET | `/v1/consent/audit?days=N` | View audit entries for last N days |
| GET | `/v1/permissions/summary` | View permissions summary counts |
| GET | `/v1/owners/:name/export` | GDPR full data export |

## Key Implementation Details

- Consent grant form supports 6 recipient types: GAII, GHII (prefixed `ghii:`), Organism (prefixed `organism.`), Domain (prefixed `domain:`), Node (prefixed `node:`), and Wildcard (`*`).
- Bulk revoke iterates over selected consent IDs and issues individual `DELETE /v1/consent/:id` calls (not a single batch endpoint).
- Consent filtering is client-side, searching recipient and data pattern fields.
- `isExpiringSoon()` checks if expiration is within 7 days, highlighting the row with a warning background and icon.
- `recipientBadge()` renders a colored badge based on the recipient string pattern (wildcard, ghii:, organism., domain:, node:, or GAII).
- GDPR export downloads a JSON file named `aimeat-export-YYYY-MM-DD.json` via a generated Blob URL and programmatic anchor click.
- Audit time range buttons offer 7, 30, or 90 days; defaults to 30 days on load.
- Permissions summary shows 3 cards: active consents count, total memory keys, total storage files, plus a breakdown by recipient type.
- Select-all checkbox in the consent table toggles all filtered (not all) consents.

## Table of Contents

- [TC-DW001: Grant, List, Revoke Cycle](#tc-dw001-grant-list-revoke-cycle)
- [TC-DW002: GDPR Export Downloads JSON](#tc-dw002-gdpr-export-downloads-json)
- [TC-DW003: Audit Entries Load with Time Range](#tc-dw003-audit-entries-load-with-time-range)
- [TC-DW004: Permissions Summary Shows Counts](#tc-dw004-permissions-summary-shows-counts)
- [TC-DW005: Bulk Revoke Multiple Consents](#tc-dw005-bulk-revoke-multiple-consents)
- [TC-DW006: Grant Consent with Expiration](#tc-dw006-grant-consent-with-expiration)
- [TC-DW007: Grant with Empty Pattern](#tc-dw007-grant-with-empty-pattern)
- [TC-DW008: Grant with Empty Recipient](#tc-dw008-grant-with-empty-recipient)
- [TC-DW009: Revoke Non-Existent Consent](#tc-dw009-revoke-non-existent-consent)
- [TC-DW010: Unauthenticated Access](#tc-dw010-unauthenticated-access)
- [TC-DW011: Empty Consents List](#tc-dw011-empty-consents-list)
- [TC-DW012: Consent About to Expire](#tc-dw012-consent-about-to-expire)
- [TC-DW013: Very Many Consents](#tc-dw013-very-many-consents)
- [TC-DW014: Grant Consent with Wildcard Recipient](#tc-dw014-grant-consent-with-wildcard-recipient)
- [TC-DW015: Various Recipient Types Badge Display](#tc-dw015-various-recipient-types-badge-display)

---

## Success Cases

### TC-DW001: Grant, List, Revoke Cycle
- **Precondition:** User is authenticated. Consent list may be empty.
- **Steps:**
  1. Navigate to the Data Wallet tab.
  2. Click the "Grant" button to show the consent form.
  3. Fill in the form:
     - Data Pattern: `profile/*`
     - Recipient Type: GAII
     - Recipient Value: `helper#alice@node1`
     - Purpose: `data sharing`
     - Scope: `private`
     - Leave expiration empty.
  4. Submit the form.
  5. Verify the consent appears in the table.
  6. Click the "Revoke" button on the newly created consent row.
- **Expected:**
  - Step 4: POST `/v1/consent` with `{ data_pattern: "profile/*", recipient: "helper#alice@node1", purpose: "data sharing", scope: "private" }` returns success. Toast shows grant confirmation. Form hides. Consent list reloads.
  - Step 5: New consent is visible in the table with pattern, recipient, purpose, scope (active badge), and granted date.
  - Step 6: DELETE `/v1/consent/:id` returns success. Toast shows revoke confirmation. Consent list reloads without the revoked consent.
- **Type:** success

### TC-DW002: GDPR Export Downloads JSON
- **Precondition:** User is authenticated with owner name available in session.
- **Steps:**
  1. Navigate to the Data Wallet tab.
  2. Scroll to the "Export" section.
  3. Click the export button.
- **Expected:** GET `/v1/owners/:name/export` is called. The response is stringified as JSON, wrapped in a Blob with `application/json` type, and downloaded as `aimeat-export-YYYY-MM-DD.json` via a programmatic anchor element click. The URL object is revoked after download.
- **Type:** success

### TC-DW003: Audit Entries Load with Time Range
- **Precondition:** User is authenticated. Some data access events exist in the audit log.
- **Steps:**
  1. Navigate to the Data Wallet tab.
  2. Observe the audit section loads with 30-day default (button highlighted).
  3. Click "7 days" button.
  4. Wait for reload.
  5. Click "90 days" button.
  6. Wait for reload.
- **Expected:**
  - Step 2: GET `/v1/consent/audit?days=30` returns entries. Table displays with columns: Who (accessor GAII), What (data key in monospace), When (relative time), Purpose.
  - Step 3: GET `/v1/consent/audit?days=7` called. Table updates. "7" button is highlighted as active.
  - Step 5: GET `/v1/consent/audit?days=90` called. Table updates with potentially more entries. "90" button is active.
- **Type:** success

### TC-DW004: Permissions Summary Shows Counts
- **Precondition:** User is authenticated and has at least one consent and some memory keys.
- **Steps:**
  1. Navigate to the Data Wallet tab.
  2. Observe the permissions summary card at the top.
- **Expected:** GET `/v1/permissions/summary` returns data. The summary card displays three metrics: active consents count (in accent color), total memory keys count (in purple), and total storage files count (in accent). If `rules_by_recipient_type` data exists, a row of type badges is shown (e.g., "gaii: 2", "wildcard: 1").
- **Type:** success

### TC-DW005: Bulk Revoke Multiple Consents
- **Precondition:** User has 3 or more active consents.
- **Steps:**
  1. Navigate to the Data Wallet tab.
  2. Check the select-all checkbox in the consent table header.
  3. Verify all visible consent rows are selected.
  4. Click the "Revoke Selected (N)" button that appears.
  5. Wait for completion.
- **Expected:** The `bulkRevoke` function iterates over all selected IDs, issuing `DELETE /v1/consent/:id` for each. If all succeed, toast shows revoke confirmation. Selection is cleared. Consent and permission summary lists reload. If any individual revoke fails, the first error message is shown as a toast.
- **Type:** success

### TC-DW006: Grant Consent with Expiration
- **Precondition:** User is authenticated.
- **Steps:**
  1. Open the consent grant form.
  2. Fill in data pattern: `temp/*`, recipient type: GAII, recipient value: `bot#alice@node1`, purpose: `temporary access`.
  3. Set expiration date to 7 days from today.
  4. Submit.
  5. Verify the consent row shows the expiration date.
- **Expected:** POST `/v1/consent` includes `expires_at` field with the selected date. The consent table row shows the expiration date in the Expires column. If the expiration is within 7 days, the row has a warning background and a caution icon.
- **Type:** success

---

## Failure Cases

### TC-DW007: Grant with Empty Pattern
- **Precondition:** User is authenticated.
- **Steps:**
  1. Open the consent grant form.
  2. Leave the "Data Pattern" field empty.
  3. Fill in other fields with valid values.
  4. Click the grant button.
- **Expected:** The HTML `required` attribute on the data pattern input prevents form submission. The browser shows a native validation error. No API call is made.
- **Type:** failure

### TC-DW008: Grant with Empty Recipient
- **Precondition:** User is authenticated.
- **Steps:**
  1. Open the consent grant form.
  2. Fill in data pattern: `test/*`.
  3. Select recipient type: GAII.
  4. Leave the recipient value field empty.
  5. Submit the form.
- **Expected:** The form submits with an empty recipient value. The backend validates and returns an error (e.g., 400 with missing/invalid recipient). Toast shows the error message. Consent is not created.
- **Type:** failure

### TC-DW009: Revoke Non-Existent Consent
- **Precondition:** User is authenticated.
- **Steps:**
  1. Programmatically call `consentService.revokeConsent('nonexistent-id')`.
- **Expected:** DELETE `/v1/consent/nonexistent-id` returns 404. The `handleRevoke` function detects `resp.ok === false` and shows an error toast with the server's error message.
- **Type:** failure

### TC-DW010: Unauthenticated Access
- **Precondition:** No valid session/token.
- **Steps:**
  1. Call `GET /v1/consent` without an Authorization header.
  2. Call `POST /v1/consent` without an Authorization header.
  3. Call `GET /v1/consent/audit?days=7` without an Authorization header.
- **Expected:** All endpoints return 401 Unauthorized. The Data Wallet tab requires an authenticated session to render.
- **Type:** failure

---

## Edge Cases

### TC-DW011: Empty Consents List
- **Precondition:** User is authenticated but has never granted any consents.
- **Steps:**
  1. Navigate to the Data Wallet tab.
  2. Observe the consents section.
- **Expected:** GET `/v1/consent` returns an empty array. The empty state message from `t('wallet.consents.empty')` is displayed instead of the consent table. No filter input or bulk revoke button is shown (these only appear when `consents.length > 0`).
- **Type:** edge

### TC-DW012: Consent About to Expire
- **Precondition:** User has a consent with `expires_at` set to 3 days from now (within the 7-day threshold).
- **Steps:**
  1. Navigate to the Data Wallet tab.
  2. Observe the consent table.
- **Expected:** The row for the expiring consent has a warning background style (`background:rgba(245,158,11,.08)`). A caution icon appears before the expiration date with the `expiringWarning` tooltip. The consent is still shown as "active" (not expired) since the date has not passed yet.
- **Type:** edge

### TC-DW013: Very Many Consents
- **Precondition:** User has 50+ active consents.
- **Steps:**
  1. Navigate to the Data Wallet tab.
  2. Wait for all consents to load.
  3. Type a filter term in the search input.
  4. Select multiple filtered consents using checkboxes.
  5. Clear the filter.
- **Expected:** All consents render in a scrollable table (the card has `overflow-x:auto`). Filtering works client-side and updates the visible rows in real-time. When the filter is cleared, selections are reset (`setSelectedConsents(new Set())`). The select-all checkbox only affects the currently filtered rows, not all consents. Performance remains acceptable with no visible lag.
- **Type:** edge

### TC-DW014: Grant Consent with Wildcard Recipient
- **Precondition:** User is authenticated.
- **Steps:**
  1. Open the consent grant form.
  2. Fill in data pattern: `public/*`.
  3. Select recipient type: "Wildcard".
  4. Note that the recipient value field is present but its value is overridden.
  5. Submit.
- **Expected:** The form handler detects `recipientType === 'wildcard'` and sets `recipVal = '*'` regardless of the recipient value input. POST `/v1/consent` is called with `recipient: "*"`. The consent appears in the table with the wildcard recipient badge.
- **Type:** edge

### TC-DW015: Various Recipient Types Badge Display
- **Precondition:** User has consents with different recipient types: a wildcard (`*`), a GHII (`ghii:alice@node`), an organism (`organism.team1`), a domain (`domain:example.com`), a node (`node:node-001`), and a GAII (`bot#alice@node`).
- **Steps:**
  1. Navigate to the Data Wallet tab.
  2. Observe the recipient column in the consent table.
- **Expected:** Each recipient displays the correct badge via `recipientBadge()`:
  - `*` shows a wildcard badge style.
  - `ghii:alice@node` shows a GHII badge.
  - `organism.team1` shows an organism badge.
  - `domain:example.com` shows a domain badge.
  - `node:node-001` shows a node badge.
  - `bot#alice@node` shows a GAII badge.

  The full recipient string is displayed next to the badge in small text.
- **Type:** edge
