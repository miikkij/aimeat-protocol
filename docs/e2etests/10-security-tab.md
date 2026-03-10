# E2E Test Plan: Security Tab

## Overview

The Security tab (`public/views/profile/security-tab.js`) provides CORS origin management and session revocation for authenticated owners. It aggregates GHII-level and per-agent CORS settings and displays the CORS inheritance hierarchy.

The tab uses the security service layer (`public/js/services/security.js`) which calls the GHII CORS and agent CORS endpoints, plus session revocation.

## APIs Under Test

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/v1/ghii/cors` | Authenticated | Load GHII CORS settings |
| PUT | `/v1/ghii/cors` | Authenticated | Update GHII allowed origins |
| GET | `/v1/agents/:name/cors` | Authenticated | Load agent-specific CORS settings |
| PUT | `/v1/agents/:name/cors` | Authenticated | Update agent-specific CORS origins |
| DELETE | `/v1/auth/sessions` | Authenticated | Revoke all active sessions |
| GET | `/v1/agents` | Authenticated | List agents (used to enumerate agent CORS) |

## Key Concepts

- **CORS Inheritance Hierarchy:** Memory key -> Agent -> GHII (account) -> Node default
- **`allowed_origins: null`** means "inherit from parent level" (reset to defaults)
- **Effective origins** are the resolved origins after inheritance
- **Session revocation** invalidates all JWTs and forces re-authentication on all devices

## Table of Contents

- [Success Cases](#success-cases) (TC-S001 to TC-S007)
- [Failure Cases](#failure-cases) (TC-S008 to TC-S013)
- [Edge Cases](#edge-cases) (TC-S014 to TC-S019)

---

## Success Cases

### TC-S001: Load CORS settings on tab open
- **Precondition:** Authenticated owner with at least one agent.
- **Steps:**
  1. Navigate to the Security tab.
  2. Observe loading spinner while data fetches.
  3. Verify GHII CORS section displays `allowed_origins`, `effective` origins, and `inherited` status.
  4. Verify agent CORS table lists each agent with its origins and custom/inherited badge.
- **Expected:** All CORS settings are loaded and displayed. GHII section shows current origins or "inherited" badge. Agent table shows each agent's CORS status.
- **Type:** success

### TC-S002: Set GHII CORS origins
- **Precondition:** Authenticated owner.
- **Steps:**
  1. Click the "Edit" button in the GHII CORS section.
  2. Enter `https://example.com` in the textarea.
  3. Click "Save".
  4. Verify a success toast appears.
  5. Verify the GHII section now shows `https://example.com` as an allowed origin.
  6. Verify the status badge changes from "inherited" to "custom".
- **Expected:** GHII CORS origins are updated. PUT `/v1/ghii/cors` is called with `{ allowed_origins: ["https://example.com"] }`.
- **Type:** success

### TC-S003: Set GHII CORS with multiple origins
- **Precondition:** Authenticated owner.
- **Steps:**
  1. Click "Edit" in the GHII CORS section.
  2. Enter multiple origins separated by newlines: `https://app1.example.com\nhttps://app2.example.com`.
  3. Click "Save".
  4. Verify both origins appear in the effective origins display.
- **Expected:** Multiple origins are parsed from newline-separated or comma-separated input and saved as an array.
- **Type:** success

### TC-S004: Set agent-specific CORS origins
- **Precondition:** Authenticated owner with at least one agent.
- **Steps:**
  1. In the agent CORS table, click "Edit" for a specific agent.
  2. Enter `https://agent-app.example.com` in the textarea.
  3. Click "Save".
  4. Verify a success toast appears.
  5. Verify the agent row now shows "custom" badge and the new origin.
- **Expected:** Agent-specific CORS is updated via PUT `/v1/agents/:name/cors`.
- **Type:** success

### TC-S005: Reset CORS to defaults (GHII level)
- **Precondition:** Authenticated owner with custom GHII CORS origins set.
- **Steps:**
  1. Click "Edit" in the GHII CORS section.
  2. Click the "Reset" button (which sends empty string, resulting in `null` origins).
  3. Verify the GHII section reverts to "inherited" badge.
  4. Verify effective origins show the node-level defaults.
- **Expected:** PUT `/v1/ghii/cors` is called with `{ allowed_origins: null }`. The GHII CORS falls back to node defaults.
- **Type:** success

### TC-S006: Reset agent CORS to defaults
- **Precondition:** Authenticated owner with custom agent CORS origins set.
- **Steps:**
  1. In the agent CORS table, click "Edit" for the agent.
  2. Click the "Reset" button.
  3. Verify the agent row reverts to "inherited" badge showing the inherited source.
- **Expected:** Agent CORS is cleared. Agent inherits from GHII or node default.
- **Type:** success

### TC-S007: Revoke all sessions
- **Precondition:** Authenticated owner with an active session.
- **Steps:**
  1. Scroll to the "Session Management" section.
  2. Click "Revoke All Sessions".
  3. Confirm the browser `confirm()` dialog.
  4. Verify a success toast appears showing revoked session count (e.g., "All sessions revoked (1)").
  5. Verify after a 1.5-second delay, `localStorage` is cleared and the page reloads.
  6. Verify the user is logged out and must re-authenticate.
- **Expected:** DELETE `/v1/auth/sessions` is called. Response contains `revoked` count. User is logged out after a brief delay.
- **Type:** success

---

## Failure Cases

### TC-S008: Set invalid CORS origin format
- **Precondition:** Authenticated owner.
- **Steps:**
  1. Click "Edit" in the GHII CORS section.
  2. Enter an invalid origin like `not-a-url` or `ftp://invalid.com`.
  3. Click "Save".
  4. Verify an error toast appears with a descriptive message.
- **Expected:** The server rejects malformed CORS origins. An error toast is shown to the user.
- **Type:** failure

### TC-S009: Set CORS for non-existent agent
- **Precondition:** Authenticated owner.
- **Steps:**
  1. PUT `/v1/agents/nonexistent-agent-name/cors` with `{ allowed_origins: ["https://example.com"] }`.
  2. Verify response status is 404.
- **Expected:** CORS update fails when the agent does not exist.
- **Type:** failure

### TC-S010: Unauthenticated CORS read
- **Precondition:** No authentication token.
- **Steps:**
  1. GET `/v1/ghii/cors` without an Authorization header.
  2. Verify response status is 401.
- **Expected:** CORS settings require authentication. Unauthenticated requests are rejected.
- **Type:** failure

### TC-S011: Unauthenticated CORS update
- **Precondition:** No authentication token.
- **Steps:**
  1. PUT `/v1/ghii/cors` with `{ allowed_origins: ["https://evil.com"] }` and no Authorization header.
  2. Verify response status is 401.
- **Expected:** CORS updates require authentication.
- **Type:** failure

### TC-S012: Unauthenticated session revocation
- **Precondition:** No authentication token.
- **Steps:**
  1. DELETE `/v1/auth/sessions` without an Authorization header.
  2. Verify response status is 401.
- **Expected:** Session revocation requires authentication.
- **Type:** failure

### TC-S013: Cancel CORS edit without saving
- **Precondition:** Authenticated owner. GHII CORS edit mode is open.
- **Steps:**
  1. Click "Edit" in the GHII CORS section.
  2. Type some origins in the textarea.
  3. Click the close button (X) instead of "Save".
  4. Verify the edit mode closes.
  5. Verify the displayed CORS origins remain unchanged.
- **Expected:** Cancelling the edit discards changes. No API call is made.
- **Type:** failure

---

## Edge Cases

### TC-S014: Empty CORS origins (allow all / wildcard)
- **Precondition:** Authenticated owner.
- **Steps:**
  1. Set GHII CORS to `null` (by resetting).
  2. Verify the effective origins display shows wildcard behavior or node defaults.
  3. Verify the UI displays "All origins allowed" or similar when effective includes `*`.
- **Expected:** When `allowed_origins` is null, the node default applies. If node default is `*`, all origins are allowed.
- **Type:** edge

### TC-S015: Many CORS origins (large list)
- **Precondition:** Authenticated owner.
- **Steps:**
  1. Set GHII CORS to a list of 50 origins (each a valid HTTPS URL).
  2. Verify the save succeeds.
  3. Reload the Security tab and verify all 50 origins appear.
- **Expected:** The system handles a large number of CORS origins without truncation or errors.
- **Type:** edge

### TC-S016: Session revocation then re-authentication
- **Precondition:** Authenticated owner.
- **Steps:**
  1. Revoke all sessions via the Security tab.
  2. Wait for the page to reload and redirect to login.
  3. Re-authenticate with valid credentials.
  4. Navigate back to the Security tab.
  5. Verify all data loads correctly with the new session.
- **Expected:** After revocation and re-auth, the Security tab works normally with a fresh session.
- **Type:** edge

### TC-S017: CORS inheritance hierarchy display
- **Precondition:** Authenticated owner with at least one agent.
- **Steps:**
  1. Navigate to the Security tab.
  2. Scroll to the "Inheritance" section.
  3. Verify the hierarchy is displayed as: `Memory key -> Agent -> GHII (your account) -> Node default`.
  4. Set custom CORS on the agent level.
  5. Verify the agent row shows "custom" badge while GHII shows "inherited".
- **Expected:** The inheritance chain is clearly displayed. Custom overrides at any level are reflected in the badges.
- **Type:** edge

### TC-S018: Owner with no agents
- **Precondition:** Authenticated owner with zero agents registered.
- **Steps:**
  1. Navigate to the Security tab.
  2. Verify the GHII CORS section loads normally.
  3. Verify the agent CORS section shows an empty state message ("No agents").
- **Expected:** The tab handles the no-agents case gracefully with an empty state message.
- **Type:** edge

### TC-S019: Revoke sessions cancel dialog
- **Precondition:** Authenticated owner.
- **Steps:**
  1. Click "Revoke All Sessions".
  2. Click "Cancel" on the browser confirm dialog.
  3. Verify the session remains active.
  4. Verify no API call is made (DELETE `/v1/auth/sessions` is not called).
- **Expected:** Cancelling the confirmation dialog aborts the revocation. The session remains active.
- **Type:** edge
