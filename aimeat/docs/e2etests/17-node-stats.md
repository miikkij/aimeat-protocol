# E2E Test Plan: Node Stats Tab

**Tab key:** `node-stats`
**Component:** `NodeStatsTab`
**Props:** `{ session, showToast }`

## Overview

Read-only dashboard showing node health metrics: uptime, request counts, method/status breakdowns, tunnel stats, mailbox stats, and security counters.

## Preconditions

- User is authenticated
- Tab is switched to "Node Stats"

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Node Stats tab

**Expected:**
- Spinner with loading text
- Disappears when `getNodeStats()` completes

---

### TC-02: Error state

**Steps:**
1. Switch to tab when stats API fails

**Expected:**
- Section title visible
- Error message shown (no spinner, no stats)
- No crash

---

### TC-03: Core stats render

**Steps:**
1. Wait for data to load

**Expected:**
- 6 stat cards in grid:
  - Uptime (formatted as "Xd Yh Zm")
  - Total requests (number)
  - Active owners (number)
  - Active agents (number)
  - Memory writes (number)
  - Memory reads (number)

---

### TC-04: Request methods breakdown

**Steps:**
1. View request methods card

**Expected:**
- Left card shows HTTP methods (GET, POST, PUT, DELETE, PATCH) with counts
- All counts are non-negative numbers

---

### TC-05: Status codes breakdown

**Steps:**
1. View request status card

**Expected:**
- Right card shows status codes with counts
- Color coding:
  - 2xx codes: green (`var(--success)`)
  - 4xx codes: yellow (`var(--warn)`)
  - 5xx codes: red (`var(--danger)`)

---

### TC-06: Tunnel stats (conditional)

**Steps:**
1. Node has tunnel feature active

**Expected:**
- Tunnel section visible with 7 cards:
  - Active connections, total connections
  - Messages sent, received
  - Delivery failures (red if > 0)
  - Latency avg, P95 (yellow if P95 > 200ms)

---

### TC-07: Tunnel stats hidden

**Steps:**
1. Node has no tunnel feature

**Expected:**
- Tunnel section not rendered

---

### TC-08: Mailbox stats (conditional)

**Steps:**
1. Node has mailbox feature active

**Expected:**
- Mailbox section with 4 cards:
  - Total items, total bytes (formatted KB/MB)
  - Delivered count, expired count (yellow if > 0)

---

### TC-09: Security section

**Steps:**
1. View security section (always shown)

**Expected:**
- 3 cards:
  - Auth failures (red if > 0, green if 0)
  - Rate limit hits (red if > 0, green if 0)
  - Scope denials (red if > 0, green if 0)

---

### TC-10: Server start timestamp

**Steps:**
1. Scroll to bottom of stats

**Expected:**
- Server start time displayed in muted color
- Valid date/time format
