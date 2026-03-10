# Work Tab - E2E Test Cases

## Overview

The Work Tab manages the work lifecycle between requesters and providers. Users can view incoming work requests (inbox), track sent work items, accept or reject offers, deliver completed work, and rate delivered work. It has two sub-tabs: **Inbox** (work assigned to me) and **Sent** (work I requested from others).

### Components

- **WorkTab** (`public/views/profile/work-tab.js`) - Main tab component
- **RateModal** - Modal with 5-star rating and comment textarea
- **DeliverModal** - Modal with result/notes textarea for work delivery

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/work/inbox` | List incoming work items |
| GET | `/v1/work/sent` | List sent work items |
| POST | `/v1/work/:id/accept` | Accept a pending work offer |
| POST | `/v1/work/:id/reject` | Reject a pending work offer |
| POST | `/v1/work/:id/deliver` | Deliver completed work with result |
| POST | `/v1/work/:id/rate` | Rate delivered work (rating + comment) |
| POST | `/v1/work/:id/progress` | Update work progress (note: not exposed in UI) |

### Service Layer (`public/js/services/work.js`)

- `listInbox()` - Returns array from `data.items` or `data`
- `listSent()` - Returns array from `data.items` or `data`
- `acceptWork(tc)` - POST to accept
- `rejectWork(tc)` - POST to reject
- `deliverWork(tc, result)` - POST with result text
- `submitRating(workId, rating, comment)` - POST with rating (1-5) and comment
- `updateProgress(tc, progress, note)` - POST progress update (backend only, not in UI)

### Status Lifecycle

```
pending/offered -> accepted -> in_progress -> delivered -> completed
                -> rejected
                -> cancelled
```

### Status Badge Classes

| Status | Badge Class |
|--------|-------------|
| `completed` | `badge-success` (green) |
| `accepted`, `in_progress` | `badge-info` (blue) |
| `delivered` | `badge-warn` (yellow) |
| `pending`, `offered` | `badge-muted` (gray) |
| `rejected`, `cancelled` | `badge-danger` (red) |

---

## Table of Contents

- [Inbox](#inbox)
  - [TC-WRK-001: View inbox with pending work items](#tc-wrk-001-view-inbox-with-pending-work-items)
  - [TC-WRK-002: Accept a pending work offer](#tc-wrk-002-accept-a-pending-work-offer)
  - [TC-WRK-003: Reject a pending work offer](#tc-wrk-003-reject-a-pending-work-offer)
  - [TC-WRK-004: Deliver accepted work](#tc-wrk-004-deliver-accepted-work)
  - [TC-WRK-005: Full accept then deliver cycle](#tc-wrk-005-full-accept-then-deliver-cycle)
- [Sent](#sent)
  - [TC-WRK-006: View sent work items](#tc-wrk-006-view-sent-work-items)
  - [TC-WRK-007: Rate delivered work](#tc-wrk-007-rate-delivered-work)
- [Sub-Tab Navigation](#sub-tab-navigation)
  - [TC-WRK-008: Switch between inbox and sent sub-tabs](#tc-wrk-008-switch-between-inbox-and-sent-sub-tabs)
- [Status Badges](#status-badges)
  - [TC-WRK-009: Status badges display with correct styles](#tc-wrk-009-status-badges-display-with-correct-styles)
- [Failure Cases](#failure-cases)
  - [TC-WRK-010: Accept already-accepted work](#tc-wrk-010-accept-already-accepted-work)
  - [TC-WRK-011: Deliver work without result text](#tc-wrk-011-deliver-work-without-result-text)
  - [TC-WRK-012: Rate work not in delivered state](#tc-wrk-012-rate-work-not-in-delivered-state)
  - [TC-WRK-013: Accept non-existent work](#tc-wrk-013-accept-non-existent-work)
  - [TC-WRK-014: Reject non-existent work](#tc-wrk-014-reject-non-existent-work)
  - [TC-WRK-015: Rate with no stars selected](#tc-wrk-015-rate-with-no-stars-selected)
  - [TC-WRK-016: Accept work fails with server error](#tc-wrk-016-accept-work-fails-with-server-error)
- [Edge Cases](#edge-cases)
  - [TC-WRK-017: Empty inbox](#tc-wrk-017-empty-inbox)
  - [TC-WRK-018: Empty sent list](#tc-wrk-018-empty-sent-list)
  - [TC-WRK-019: Rapid accept and reject toggle](#tc-wrk-019-rapid-accept-and-reject-toggle)
  - [TC-WRK-020: Very long delivery result text](#tc-wrk-020-very-long-delivery-result-text)
  - [TC-WRK-021: Work card displays all metadata](#tc-wrk-021-work-card-displays-all-metadata)
  - [TC-WRK-022: Deliver modal dismissed by clicking overlay](#tc-wrk-022-deliver-modal-dismissed-by-clicking-overlay)
  - [TC-WRK-023: Rate modal dismissed by clicking overlay](#tc-wrk-023-rate-modal-dismissed-by-clicking-overlay)
  - [TC-WRK-024: Deliver with empty result text (optional)](#tc-wrk-024-deliver-with-empty-result-text-optional)
  - [TC-WRK-025: Action buttons disabled during loading](#tc-wrk-025-action-buttons-disabled-during-loading)

---

## Inbox

### TC-WRK-001: View inbox with pending work items
- **Precondition:** User is authenticated. The user has received work offers (items with status `pending` or `offered`).
- **Steps:**
  1. Navigate to the Work tab.
  2. Ensure the "Inbox" sub-tab is active.
- **Expected:** A GET request is sent to `/v1/work/inbox`. The inbox displays work cards. Each pending/offered card shows:
  - Description or action name as the title.
  - A `pending` or `offered` status badge (gray/muted).
  - "From: `<requester_gaii>`" in the subtitle.
  - Cost in morsels (if `price_morsels` is set).
  - Relative timestamp via `timeAgo()`.
  - "Accept" and "Decline" action buttons.
  The `onStats` callback reports the inbox count.
- **Type:** success

### TC-WRK-002: Accept a pending work offer
- **Precondition:** User is authenticated. A work item with status `pending` is visible in the inbox.
- **Steps:**
  1. Click the "Accept" button on a pending work card.
- **Expected:** A POST request is sent to `/v1/work/<tc>/accept`. The button shows "..." while loading. On success, a toast "Work accepted" is displayed. The data reloads. The work item now shows `accepted` status with a blue badge. The "Accept"/"Decline" buttons are replaced by a "Deliver" button.
- **Type:** success

### TC-WRK-003: Reject a pending work offer
- **Precondition:** User is authenticated. A work item with status `pending` is visible in the inbox.
- **Steps:**
  1. Click the "Decline" button on a pending work card.
- **Expected:** A POST request is sent to `/v1/work/<tc>/reject`. The button shows "..." while loading. On success, a toast "Work declined" is displayed. The data reloads. The work item now shows `rejected` status with a red badge. The action buttons are removed.
- **Type:** success

### TC-WRK-004: Deliver accepted work
- **Precondition:** User is authenticated. A work item with status `accepted` or `in_progress` is visible in the inbox.
- **Steps:**
  1. Click the "Deliver" button on an accepted/in-progress work card.
  2. The DeliverModal opens showing the work description.
  3. Enter `Translation completed. 500 words processed.` in the result textarea.
  4. Click the "Deliver" button in the modal.
- **Expected:** A POST request is sent to `/v1/work/<tc>/deliver` with body `{ result: "Translation completed. 500 words processed." }`. The button shows "Delivering..." while loading. On success, a toast "Work delivered" is displayed. The modal closes. The data reloads. The work item now shows `delivered` status with a yellow badge.
- **Type:** success

### TC-WRK-005: Full accept then deliver cycle
- **Precondition:** User is authenticated. A pending work offer exists in the inbox.
- **Steps:**
  1. View the inbox and identify a pending work item.
  2. Click "Accept". Wait for the data reload.
  3. Verify the item now shows `accepted` status with a "Deliver" button.
  4. Click "Deliver". Enter result text. Click "Deliver" in the modal.
  5. Verify the item now shows `delivered` status.
- **Expected:** The work progresses through `pending -> accepted -> delivered` with appropriate status badges, toast messages, and button changes at each stage.
- **Type:** success

---

## Sent

### TC-WRK-006: View sent work items
- **Precondition:** User is authenticated. The user has sent work requests to other providers.
- **Steps:**
  1. Navigate to the Work tab.
  2. Click the "Sent" sub-tab.
- **Expected:** A GET request was sent to `/v1/work/sent` on initial load. Sent work cards are displayed. Each card shows:
  - Description or action name as the title.
  - Status badge with appropriate color.
  - "Provider: `<provider_gaii>`" in the subtitle (instead of "From:").
  - Cost in morsels (if set).
  - Relative timestamp.
  - A "Rate" button is shown only for items with `delivered` status.
- **Type:** success

### TC-WRK-007: Rate delivered work
- **Precondition:** User is authenticated. A sent work item with status `delivered` is visible in the "Sent" sub-tab.
- **Steps:**
  1. Click the "Rate" button on a delivered work card.
  2. The RateModal opens showing the work description.
  3. Click the 4th star to set a rating of 4.
  4. Enter `Good work, fast delivery` in the comment textarea.
  5. Click the "Submit Rating" button.
- **Expected:** A POST request is sent to `/v1/work/<workId>/rate` with body `{ rating: 4, comment: "Good work, fast delivery" }`. A success toast "Rating submitted" is displayed. The modal closes. The data reloads. The work item status may change to `completed`.
- **Type:** success

---

## Sub-Tab Navigation

### TC-WRK-008: Switch between inbox and sent sub-tabs
- **Precondition:** User is authenticated and on the Work tab.
- **Steps:**
  1. Verify the "Inbox" sub-tab is active by default.
  2. Click the "Sent" sub-tab.
  3. Verify sent items are displayed.
  4. Click the "Inbox" sub-tab.
  5. Verify inbox items are displayed again.
- **Expected:** Sub-tab switching is immediate. Both inbox and sent data were loaded on initial `loadData()` call (parallel fetch). The active button has the `active` class. Content area toggles without additional API calls.
- **Type:** success

---

## Status Badges

### TC-WRK-009: Status badges display with correct styles
- **Precondition:** User is authenticated. Work items exist across all status values.
- **Steps:**
  1. View inbox and sent items with various statuses.
- **Expected:** Status badges have the correct CSS classes:
  - `completed` -> green badge (`badge-success`)
  - `accepted`, `in_progress` -> blue badge (`badge-info`)
  - `delivered` -> yellow badge (`badge-warn`)
  - `pending`, `offered` -> gray badge (`badge-muted`)
  - `rejected`, `cancelled` -> red badge (`badge-danger`)
  - Unknown status -> gray badge (`badge-muted` fallback)
- **Type:** success

---

## Failure Cases

### TC-WRK-010: Accept already-accepted work
- **Precondition:** User is authenticated. A work item was `pending` but was accepted from another session or by another mechanism.
- **Steps:**
  1. Click "Accept" on the now-stale pending item.
- **Expected:** A POST request is sent to `/v1/work/<tc>/accept`. The server responds with an error (e.g., 409 Conflict or 400 Bad Request, `ok: false`). An error toast is displayed with the server's message (e.g., "Work already accepted"). The loading state clears. The data reloads to show the current status.
- **Type:** failure

### TC-WRK-011: Deliver work without result text
- **Precondition:** User is authenticated. The DeliverModal is open for an accepted work item.
- **Steps:**
  1. Leave the result textarea empty.
  2. Click the "Deliver" button.
- **Expected:** The `deliverWork(tc, result || undefined)` call sends `{ result: undefined }` (omitted from JSON). The server should accept this since the result field is described as "optional" in the modal UI ("Result / notes (optional)"). The delivery succeeds and a toast "Work delivered" is shown.
- **Type:** failure

### TC-WRK-012: Rate work not in delivered state
- **Precondition:** User is authenticated. A work item with status `accepted` (not `delivered`) exists in the "Sent" sub-tab.
- **Steps:**
  1. Note that the "Rate" button is NOT displayed for non-delivered items (the UI only renders it when `w.status === 'delivered'`).
  2. Attempt to directly call the rate API via manual means for a non-delivered work item.
- **Expected:** The "Rate" button is conditionally rendered only for `delivered` status, so under normal UI usage this action is not possible. If the API is called directly, the server responds with an error (e.g., 400 Bad Request, "Work must be in delivered state to rate").
- **Type:** failure

### TC-WRK-013: Accept non-existent work
- **Precondition:** User is authenticated. The work item ID does not exist on the server.
- **Steps:**
  1. Trigger an accept for a work ID that no longer exists (e.g., stale list data).
- **Expected:** A POST request is sent to `/v1/work/<invalidId>/accept`. The server responds with 404 Not Found. The `catch` block displays an error toast with the error message. The `actionLoading` state is cleared via the `finally` block.
- **Type:** failure

### TC-WRK-014: Reject non-existent work
- **Precondition:** User is authenticated. The work item ID does not exist on the server.
- **Steps:**
  1. Trigger a reject for a work ID that no longer exists.
- **Expected:** A POST request is sent to `/v1/work/<invalidId>/reject`. The server responds with 404 Not Found. An error toast "Failed to decline work" is displayed. The `actionLoading` state is cleared.
- **Type:** failure

### TC-WRK-015: Rate with no stars selected
- **Precondition:** User is authenticated. The RateModal is open.
- **Steps:**
  1. Do not click any star (rating remains `0`).
  2. Click "Submit Rating".
- **Expected:** The `handleRate` function checks `if (!rating)` which is truthy for `0`. An error toast "Select a rating" is displayed. No API call is made. The modal remains open.
- **Type:** failure

### TC-WRK-016: Accept work fails with server error
- **Precondition:** User is authenticated. The server returns a 500 error on the accept endpoint.
- **Steps:**
  1. Click "Accept" on a pending work item.
- **Expected:** The POST request fails. The `catch` block in `handleAccept` displays a toast with the error message. The `actionLoading` state is cleared via `finally`. The buttons re-enable.
- **Type:** failure

---

## Edge Cases

### TC-WRK-017: Empty inbox
- **Precondition:** User is authenticated. No work items have been assigned to the user.
- **Steps:**
  1. Navigate to the Work tab, "Inbox" sub-tab.
- **Expected:** The inbox empty state message is displayed. No work cards are rendered. The `onStats` callback reports `work: 0`.
- **Type:** edge

### TC-WRK-018: Empty sent list
- **Precondition:** User is authenticated. The user has not sent any work requests.
- **Steps:**
  1. Navigate to the Work tab, "Sent" sub-tab.
- **Expected:** The sent empty state message is displayed (distinct from inbox empty message, using `profile.work.sentEmpty` key). No work cards are rendered.
- **Type:** edge

### TC-WRK-019: Rapid accept and reject toggle
- **Precondition:** User is authenticated. A pending work item is visible in the inbox.
- **Steps:**
  1. Click "Accept" on the work item.
  2. Immediately click "Decline" before the accept request completes.
- **Expected:** When "Accept" is clicked, `actionLoading` is set to the work's tracking code, which disables both the "Accept" and "Decline" buttons (`disabled=${isLoading}`). The second click on "Decline" is blocked. Only the accept action is processed. After it completes, the data reloads with the new status.
- **Type:** edge

### TC-WRK-020: Very long delivery result text
- **Precondition:** User is authenticated. The DeliverModal is open.
- **Steps:**
  1. Paste a 50,000-character text into the result textarea.
  2. Click "Deliver".
- **Expected:** The POST request includes the full result text. If the server has a payload limit, an error is returned and displayed as a toast. If accepted, the delivery succeeds normally. The textarea should be scrollable for the large content.
- **Type:** edge

### TC-WRK-021: Work card displays all metadata
- **Precondition:** User is authenticated. A work item exists with all metadata fields: description, requester_gaii, price_morsels, created_at, and status.
- **Steps:**
  1. View the work card in the inbox.
- **Expected:** The card displays:
  - Title: the description or action_name (escaped via `escHtml`).
  - Status badge with correct class and text.
  - Subtitle showing "From: `<requester_gaii>`", cost as "`<price> morsels`", and relative time from `timeAgo(created_at)`.
  All fields are separated by pipe characters.
- **Type:** edge

### TC-WRK-022: Deliver modal dismissed by clicking overlay
- **Precondition:** User is authenticated. The DeliverModal is open.
- **Steps:**
  1. Click on the dark overlay area outside the modal dialog.
- **Expected:** The `modal-overlay` click handler calls `onCancel()`. The modal closes. No delivery is submitted. The work item remains in its current status.
- **Type:** edge

### TC-WRK-023: Rate modal dismissed by clicking overlay
- **Precondition:** User is authenticated. The RateModal is open.
- **Steps:**
  1. Click on the dark overlay area outside the modal dialog.
- **Expected:** The `modal-overlay` click handler calls `onCancel()`. The modal closes. No rating is submitted. The work item remains in `delivered` status.
- **Type:** edge

### TC-WRK-024: Deliver with empty result text (optional)
- **Precondition:** User is authenticated. The DeliverModal is open for an accepted work item.
- **Steps:**
  1. Leave the result textarea empty.
  2. Click "Deliver".
- **Expected:** The `onSubmit(result || undefined)` call passes `undefined` since the empty string is falsy. The POST body becomes `{ result: undefined }` which serializes to `{}`. The server accepts the delivery without a result. A success toast is shown and the modal closes.
- **Type:** edge

### TC-WRK-025: Action buttons disabled during loading
- **Precondition:** User is authenticated. A pending work item is visible.
- **Steps:**
  1. Click "Accept" on the work item.
  2. Observe the buttons while the request is in flight.
- **Expected:** Both "Accept" and "Decline" buttons show "..." text and are disabled (`disabled=${isLoading}` where `isLoading = actionLoading === tc`). After the request completes (success or failure), the `finally` block sets `actionLoading` to `null` and the buttons re-enable (or disappear if the status changed).
- **Type:** edge
