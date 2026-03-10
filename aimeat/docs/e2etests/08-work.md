# E2E Test Plan: Work Tab

**Tab key:** `work`
**Component:** `WorkTab`
**Props:** `{ session, showToast, onStats }`

## Overview

Work request lifecycle management with Inbox (received) and Sent (outgoing) sub-tabs. Supports accepting, declining, delivering work, and rating completed deliveries.

## Preconditions

- User is authenticated
- Tab is switched to "Work"
- For full flow testing: need a second agent to create work requests

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Work tab

**Expected:**
- Spinner visible while `listInbox()` and `listSent()` load
- Spinner disappears when data arrives

---

### TC-02: Sub-tab switching

**Steps:**
1. Click "Sent" sub-tab
2. Click "Inbox" sub-tab

**Expected:**
- Active tab gets `.active` class
- Content switches between inbox and sent views

---

### TC-03: Empty inbox

**Steps:**
1. Use account with no incoming work

**Expected:**
- Empty state message visible in inbox

---

### TC-04: Empty sent

**Steps:**
1. Switch to Sent sub-tab with no outgoing work

**Expected:**
- Empty state message for sent items

---

### TC-05: Work card renders (inbox)

**Steps:**
1. Have at least one incoming work request
2. View inbox

**Expected:**
- Work card (`.card`) shows:
  - Title (`.card-title`)
  - Status badge with appropriate color:
    - `badge-muted` for pending/offered
    - `badge-info` for accepted/in_progress
    - `badge-warn` for delivered
    - `badge-success` for completed
    - `badge-danger` for rejected/cancelled
  - Subtitle: "From: {requester_gaii}", price in morsels (❤️), time ago

---

### TC-06: Accept work

**Steps:**
1. Find a work item with status "pending" or "offered" in inbox
2. Click "Accept" button (`.btn-sm.btn-primary`)

**Expected:**
- Button shows "..." while API call in flight
- Toast: "Work accepted"
- Work card status updates to "accepted" / `badge-info`
- Accept/Decline buttons replaced by "Deliver" button

**Failure indicators:**
- Error toast: "Failed to accept work"
- Status doesn't change

---

### TC-07: Decline work

**Steps:**
1. Find a pending/offered work item
2. Click "Decline" button (`.btn-sm.btn-outline`)

**Expected:**
- Toast: "Work declined"
- Work card status changes to "rejected" / `badge-danger`
- Action buttons disappear

---

### TC-08: Open deliver modal

**Steps:**
1. Find an accepted/in_progress work item
2. Click "Deliver" button (`.btn-sm.btn-primary`)

**Expected:**
- Deliver modal opens (`.modal-overlay` + `.modal`)
- Textarea for delivery result/notes (rows=4, optional)
- "Deliver" button (`.btn-primary`)
- "Cancel" button (`.btn-outline`)

---

### TC-09: Submit delivery

**Steps:**
1. Open deliver modal
2. Enter notes: "Work completed successfully"
3. Click "Deliver"

**Expected:**
- Button shows "Delivering..." (disabled)
- On success:
  - Toast: "Work delivered"
  - Modal closes
  - Work status updates to "delivered" / `badge-warn`
  - Inbox reloads

---

### TC-10: Cancel delivery

**Steps:**
1. Open deliver modal
2. Click "Cancel"

**Expected:**
- Modal closes
- No API call
- Work status unchanged

---

### TC-11: Rate delivered work (sent tab)

**Steps:**
1. Switch to Sent sub-tab
2. Find a work item with status "delivered"
3. Click "Rate" button (`.btn-sm`)

**Expected:**
- Rate modal opens with:
  - Star rating (5 clickable stars, `.star`)
  - Comment textarea
  - "Submit Rating" button
  - "Cancel" button

---

### TC-12: Submit rating

**Steps:**
1. Open rate modal
2. Click 4th star (4/5 rating)
3. Enter comment: "Good work"
4. Click "Submit Rating"

**Expected:**
- Stars 1-4 get `.active` class (visual highlight)
- On submit:
  - Toast: "Rating submitted"
  - Modal closes
  - Work status may update to "rated" or "completed"

---

### TC-13: Rating validation — no stars selected

**Steps:**
1. Open rate modal
2. Don't click any star
3. Click "Submit Rating"

**Expected:**
- Toast error: "Please select a rating"
- Modal stays open
- No API call

---

### TC-14: Star rating interaction

**Steps:**
1. Open rate modal
2. Click star 3 → click star 5 → click star 2

**Expected:**
- Stars highlight cumulatively up to clicked star
- Final state: stars 1-2 highlighted (`.active`)
- Rating value is 2
