# E2E Test Plan: Data Wallet Tab

**Tab key:** `data-wallet`
**Component:** `DataWalletTab`
**Props:** `{ session, showToast }`

## Overview

GDPR-focused data management — consent grants/revocation (single and bulk), audit trail with day filtering, permission summary, and GDPR data export.

## Preconditions

- User is authenticated
- Tab is switched to "Data Wallet"

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Data Wallet tab

**Expected:**
- Spinners while `loadConsents()`, `loadAudit(30)`, `loadPermSummary()` load
- All spinners disappear when data arrives

---

### TC-02: Permission summary renders

**Steps:**
1. Wait for data to load

**Expected:**
- Summary card visible with stats:
  - Active consents count
  - Memory keys count
  - Storage files count
  - Rules breakdown by type

---

### TC-03: Grant consent — open form

**Steps:**
1. Click "Grant Permission" button

**Expected:**
- Form card appears with fields:
  - Data pattern input (required)
  - Recipient type select: gaii, ghii, organism, domain, node, wildcard
  - Recipient value input
  - Purpose input
  - Scope select: private, dmz, federation
  - Expiration date picker (optional)
  - "Grant" button
  - "Cancel" button

---

### TC-04: Grant consent — success

**Steps:**
1. Open grant form
2. Enter data pattern: "memories/*"
3. Select recipient type: "gaii"
4. Enter recipient: "agent1#owner@node"
5. Enter purpose: "Data sharing"
6. Select scope: "federation"
7. Click "Grant"

**Expected:**
- Toast: "Permission granted"
- Form closes
- New consent appears in consents table
- Permission summary updates

---

### TC-05: Grant consent — wildcard recipient

**Steps:**
1. Open grant form
2. Select recipient type: "wildcard"
3. Fill other fields
4. Submit

**Expected:**
- Recipient value formatted as `*`
- Consent created with wildcard recipient
- Wildcard badge (red) shown in table

---

### TC-06: Cancel grant form

**Steps:**
1. Open grant form
2. Click "Cancel"

**Expected:**
- Form closes, no API call

---

### TC-07: Consents table renders

**Steps:**
1. Have at least one active consent

**Expected:**
- Table (`.consent-table`) with columns:
  - Pattern
  - Recipient (with colored badge based on type)
  - Purpose
  - Scope
  - Granted date
  - Expires (or "Never")
  - Revoke button

---

### TC-08: Filter consents

**Steps:**
1. Type "agent" in the filter input

**Expected:**
- Table filters to show only consents matching "agent" in recipient or pattern
- Selected consents cleared when filter changes

---

### TC-09: Revoke single consent

**Steps:**
1. Click "Revoke" button (`.revoke-btn`) on a consent row

**Expected:**
- API call to revoke consent
- Toast: "Consent revoked"
- Row disappears from table
- Summary updates

---

### TC-10: Select consents for bulk revoke

**Steps:**
1. Click checkbox on consent row 1
2. Click checkbox on consent row 2

**Expected:**
- Both checkboxes checked
- "Revoke Selected" button appears (`.btn-danger`)
- Selected count shown

---

### TC-11: Select all consents

**Steps:**
1. Click the header checkbox (select all)

**Expected:**
- All visible (filtered) consent checkboxes get checked
- "Revoke Selected" button visible

---

### TC-12: Deselect all

**Steps:**
1. Select all (TC-11)
2. Click header checkbox again

**Expected:**
- All checkboxes unchecked
- "Revoke Selected" button hidden

---

### TC-13: Bulk revoke

**Steps:**
1. Select 2+ consents
2. Click "Revoke Selected"

**Expected:**
- API calls to revoke each selected consent
- Toast: "Consent revoked"
- Revoked rows disappear
- If some fail: error toast with details

---

### TC-14: Expiring soon highlight

**Steps:**
1. Have a consent with expiration within 7 days

**Expected:**
- Row has amber background highlight (`rgba(245,158,11,.08)`)
- Warning icon in expires column
- `expSoon` styling applied

---

### TC-15: Expired consent display

**Steps:**
1. Have a consent that has already expired

**Expected:**
- Status shows "expired" badge
- Row still visible but marked differently

---

### TC-16: Audit trail renders

**Steps:**
1. Scroll to audit section

**Expected:**
- Audit table with columns: who, what, when, purpose
- Day filter buttons: 7, 30, 90

---

### TC-17: Audit day filter

**Steps:**
1. Click "7" day button
2. Click "90" day button

**Expected:**
- Clicked button gets `.active` class
- Audit table reloads with entries from selected period
- API call with new day count

---

### TC-18: GDPR data export

**Steps:**
1. Click "Export" button

**Expected:**
- API call to `/v1/owners/{owner}/export`
- Browser downloads a JSON file
- File contains user's complete data export

---

### TC-19: Export error handling

**Steps:**
1. Trigger export with server error (e.g., mock API failure)

**Expected:**
- Error toast
- No file downloaded
