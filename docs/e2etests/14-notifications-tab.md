# E2E Test Cases: Notifications Tab

**Tab file:** `public/views/profile/notifications-tab.js`
**APIs tested:**
- `GET /v1/push/vapid-key` — get VAPID public key
- `POST /v1/push/subscribe` — subscribe to push notifications
- `DELETE /v1/push/subscribe` — unsubscribe from push notifications
- `POST /v1/push/test` — send a test push notification

---

## Success Cases

### TC-1401: Get VAPID public key
- **Precondition:** Authenticated owner; server has VAPID keys configured
- **Steps:**
  1. Call `GET /v1/push/vapid-key`
- **Expected:** Returns `{ ok: true, data: { vapidPublicKey: "..." } }` with a base64url-encoded key string
- **Type:** success

### TC-1402: Subscribe to push notifications
- **Precondition:** Authenticated owner; VAPID configured on server; browser supports Push API
- **Steps:**
  1. Call `GET /v1/push/vapid-key` to get the VAPID key
  2. Create a push subscription using PushManager with the VAPID key
  3. Call `POST /v1/push/subscribe` with `{ endpoint: "https://...", keys: { p256dh: "...", auth: "..." } }`
- **Expected:** Returns `ok: true`; subscription is stored on the server
- **Type:** success

### TC-1403: Unsubscribe from push notifications
- **Precondition:** Authenticated owner with an active push subscription
- **Steps:**
  1. Call `DELETE /v1/push/subscribe`
- **Expected:** Returns `ok: true`; server removes the subscription record
- **Type:** success

### TC-1404: Test push notification
- **Precondition:** Authenticated owner with an active push subscription
- **Steps:**
  1. Call `POST /v1/push/test`
- **Expected:** Returns `ok: true`; a test notification is delivered to the subscribed browser endpoint
- **Type:** success

---

## Failure Cases

### TC-1405: Subscribe without VAPID configured
- **Precondition:** Authenticated owner; server has NO VAPID keys configured
- **Steps:**
  1. Call `GET /v1/push/vapid-key`
- **Expected:** Returns empty or null `vapidPublicKey`; UI shows "not configured" message; subscribe button is not available
- **Type:** failure

### TC-1406: Subscribe with invalid endpoint
- **Precondition:** Authenticated owner; VAPID configured
- **Steps:**
  1. Call `POST /v1/push/subscribe` with `{ endpoint: "not-a-url", keys: { p256dh: "x", auth: "y" } }`
- **Expected:** Returns error response; subscription is not stored
- **Type:** failure

### TC-1407: Unauthenticated access
- **Precondition:** No authentication token
- **Steps:**
  1. Call `GET /v1/push/vapid-key` without Authorization header
  2. Call `POST /v1/push/subscribe` without Authorization header
  3. Call `DELETE /v1/push/subscribe` without Authorization header
  4. Call `POST /v1/push/test` without Authorization header
- **Expected:** All return 401 Unauthorized
- **Type:** failure

---

## Edge Cases

### TC-1408: VAPID not configured on server
- **Precondition:** Server started without VAPID environment variables
- **Steps:**
  1. Call `GET /v1/push/vapid-key`
  2. Observe the tab UI
- **Expected:** VAPID key endpoint returns empty/null key; tab renders a "not configured" card instead of subscribe/unsubscribe controls
- **Type:** edge

### TC-1409: Re-subscribe when already subscribed
- **Precondition:** Authenticated owner with an active push subscription in the browser
- **Steps:**
  1. Load the Notifications tab (triggers `checkSubscription`)
  2. The tab detects the existing browser subscription and re-sends `POST /v1/push/subscribe` to sync with server
- **Expected:** Server accepts the re-subscribe gracefully (upsert); subscription status shows as active
- **Type:** edge

### TC-1410: Test push when not subscribed
- **Precondition:** Authenticated owner with no active push subscription
- **Steps:**
  1. Call `POST /v1/push/test`
- **Expected:** Returns error or graceful failure indicating no subscription exists; UI shows appropriate error toast
- **Type:** edge

### TC-1411: Browser without Push API support
- **Precondition:** Authenticated owner using a browser that lacks `PushManager` or `serviceWorker`
- **Steps:**
  1. Attempt to subscribe to push notifications
- **Expected:** Client-side check detects missing support; shows "browser not supported" toast; no API call is made
- **Type:** edge
