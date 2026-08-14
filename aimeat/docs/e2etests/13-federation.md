# E2E Test Plan: Federation Tab

**Tab key:** `federation`
**Component:** `FederationTab`
**Props:** `{ session, showToast }`

## Overview

Read-only display of federated peer nodes and their connectivity status. No interactive elements.

## Preconditions

- User is authenticated
- Tab is switched to "Federation"

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Federation tab

**Expected:**
- Section title and description visible
- Spinner while `listPeers()` loads
- Spinner disappears when data arrives

---

### TC-02: Empty state — no peers

**Steps:**
1. Node has no configured federation peers

**Expected:**
- Empty state message visible
- No peer cards shown

---

### TC-03: Peer cards render

**Steps:**
1. Node has at least one federation peer

**Expected:**
- One card per peer showing:
  - Peer node ID or URL (`.card-title`)
  - URL (`.card-subtitle`)
  - Status indicator:
    - Green dot (`.peer-dot.alive`) + "Online" text for active peers
    - Red dot (`.peer-dot.dead`) + "Offline" text for inactive peers

---

### TC-04: Multiple peers display

**Steps:**
1. Node has 3+ federation peers with mixed statuses

**Expected:**
- All peers listed
- Online peers show green status
- Offline peers show red status
- No interactive elements (no buttons, no expand)
