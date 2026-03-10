# E2E Test Plan: Notifications Tab

**Tab key:** `notifications`
**Component:** `NotificationsTab`
**Props:** `{ session, showToast }`

## Overview

Push notification management — subscribe/unsubscribe to browser push notifications, send test notifications. Depends on browser ServiceWorker and Push API support.

## Preconditions

- User is authenticated
- Tab is switched to "Notifications"
- Browser supports ServiceWorker and PushManager (Chromium/Firefox)

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Notifications tab

**Expected:**
- Spinner while VAPID key loads from `/v1/push/vapid-key`
- Disappears when data arrives

---

### TC-02: Push not configured (no VAPID key)

**Steps:**
1. Server has no VAPID key configured

**Expected:**
- Card showing "Push notifications not configured" message
- No subscribe/unsubscribe buttons
- No crash

---

### TC-03: Browser not supported

**Steps:**
1. Open in a browser without ServiceWorker support (e.g., some WebViews)

**Expected:**
- Toast error: "Browser does not support push notifications"
- Tab still renders without crashing

---

### TC-04: Initial state — not subscribed

**Steps:**
1. Open Notifications tab (push available, not subscribed)

**Expected:**
- Status shows "Inactive"
- "Subscribe" button visible (`.btn.btn-primary`)
- No Test or Unsubscribe buttons

---

### TC-05: Subscribe to push

**Steps:**
1. Click "Subscribe" button

**Expected:**
- Button shows "Subscribing..." (disabled)
- Browser prompts for notification permission (if not already granted)
- On success:
  - ServiceWorker registered (`/sw.js`)
  - Push subscription created via Push API
  - Subscription sent to server (`POST /v1/push/subscribe`)
  - Toast: "Subscribed to push notifications"
  - Status changes to "Active"
  - Subscribe button replaced by Test + Unsubscribe buttons

---

### TC-06: Subscribe — permission denied

**Steps:**
1. Click "Subscribe"
2. Deny the browser notification permission prompt

**Expected:**
- Toast error: "Subscribe failed"
- Status remains "Inactive"
- Subscribe button re-enables

---

### TC-07: Send test notification

**Steps:**
1. While subscribed, click "Test" button

**Expected:**
- API call to `POST /v1/push/test`
- Toast: "Test notification sent"
- Browser notification appears (may need brief wait)

---

### TC-08: Test notification — error

**Steps:**
1. Trigger test when push API fails

**Expected:**
- Toast error: "Test failed"
- No browser notification

---

### TC-09: Unsubscribe

**Steps:**
1. While subscribed, click "Unsubscribe" button

**Expected:**
- Button shows "Unsubscribing..." (disabled)
- API call to `DELETE /v1/push/subscribe`
- Toast: "Unsubscribed"
- Status changes back to "Inactive"
- Unsubscribe/Test buttons replaced by Subscribe button

---

### TC-10: Unsubscribe — error

**Steps:**
1. Trigger unsubscribe when API fails

**Expected:**
- Toast error: "Unsubscribe failed"
- Status remains "Active"
- Buttons re-enable

---

### TC-11: Playwright limitation note

**Note:** Push notification permission and ServiceWorker registration require special Playwright configuration:

```typescript
// Grant notification permission before test
const context = await browser.newContext({
  permissions: ['notifications'],
});
```

ServiceWorker tests may need to verify registration separately rather than testing the full browser push flow.
