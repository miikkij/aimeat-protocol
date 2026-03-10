# E2E Test Plan: Services Tab

**Tab key:** `services`
**Component:** `ServicesTab`
**Props:** `{ session, showToast, onStats }`

## Overview

Publish AI agent services to the catalogue, browse the catalogue by category, expand service cards to see full details including schemas and webhook URLs.

## Preconditions

- User is authenticated
- Tab is switched to "Services"

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Services tab

**Expected:**
- Spinner while `listMyServices()` loads
- Spinner disappears when data arrives

---

### TC-02: Sub-tab switching

**Steps:**
1. Click "Catalogue" sub-tab
2. Click "My Services" sub-tab

**Expected:**
- Active tab changes (`.active` class)
- Catalogue sub-tab lazy-loads catalogue data on first click
- Spinner shown while catalogue loads

---

### TC-03: Publish service form

**Steps:**
1. Click "Publish" button (`.btn-primary`)

**Expected:**
- Publish form appears with:
  - Name input (text)
  - Description textarea (rows=3)
  - Category select (dropdown with SERVICE_CATEGORIES)
  - Price input (number, min=0)
  - Unit select (call/minute/token/task)
  - Webhook URL input
  - "Publish" button
  - "Cancel" button

---

### TC-04: Publish service — success

**Steps:**
1. Open publish form
2. Fill in: name "Test Service", description "A test", category from dropdown, price 5, unit "call", webhook URL
3. Click "Publish"

**Expected:**
- Toast: service published confirmation
- Form closes
- New service appears in My Services list

---

### TC-05: Cancel publish form

**Steps:**
1. Open publish form
2. Click "Cancel"

**Expected:**
- Form closes, no API call

---

### TC-06: Service card renders

**Steps:**
1. Have at least one published service
2. View My Services

**Expected:**
- Service card (`.card`) shows:
  - Service name (`.card-title`)
  - Category badge (`.badge.badge-info`)
  - Price badge (`.badge.badge-success`) — morsels amount or "free"
  - Description (`.card-subtitle`)
  - Expand icon (▶)

---

### TC-07: Expand service card

**Steps:**
1. Click on a service card

**Expected:**
- Card gets `.svc-card-expanded`
- ServiceDetail sub-component loads (shows spinner while fetching)
- On load, detail rows (`.svc-detail-row`) show:
  - Description
  - Provider GAII (monospace)
  - Price with unit
  - Webhook URL (monospace)
  - Estimated time
  - Tags (badge array)
  - Input schema (JSON, `.svc-detail-code`)
  - Output schema (JSON)
  - Created date
- "Delete" button appears (`.btn-danger`)

---

### TC-08: Unpublish service

**Steps:**
1. Expand a service card
2. Click "Delete" / "Unpublish" button
3. Accept confirmation dialog

**Expected:**
- Confirm dialog appears
- Toast: service unpublished
- Card disappears from My Services

---

### TC-09: Catalogue — browse

**Steps:**
1. Switch to Catalogue sub-tab
2. Wait for catalogue to load

**Expected:**
- Service cards from all publishers shown
- Category filter select visible (`.input-field`)

---

### TC-10: Catalogue — filter by category

**Steps:**
1. In catalogue view, select a category from the filter dropdown
2. Then select blank (all)

**Expected:**
- List filters to show only services in selected category
- Selecting blank restores full list

---

### TC-11: Catalogue — expand card

**Steps:**
1. Click a catalogue service card

**Expected:**
- Same detail view as TC-07 (ServiceDetail loads)
- No Delete button (not the user's service)

---

### TC-12: ServiceDetail loading error

**Steps:**
1. Expand a card where the detail API fails (e.g., service was deleted)

**Expected:**
- Error message shown in `.svc-detail-error` div
- No crash, card still functional
