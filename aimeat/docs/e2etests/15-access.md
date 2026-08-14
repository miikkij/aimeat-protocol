# E2E Test Plan: Access Tab

**Tab key:** `access`
**Component:** `AccessTab`
**Props:** `{ session, showToast }`

## Overview

Displays session identity information, public key, owner private key (blurred by default), and MCP endpoint. Mostly read-only with key reveal and copy functionality.

## Preconditions

- User is authenticated
- Tab is switched to "Access"

## Test Cases

### TC-01: Session info renders

**Steps:**
1. Switch to Access tab

**Expected:**
- Session info section shows:
  - Owner name
  - GHII (Global Human Identity Identifier)
  - Agent GAII
  - Node URL
  - JWT validity badge:
    - Green (`.badge-success`) if valid
    - Red (`.badge-danger`) if expired

---

### TC-02: Public key display

**Steps:**
1. View public key section

**Expected:**
- Public key shown in monospace font
- Full key visible (not truncated)

---

### TC-03: Owner key — blurred by default

**Steps:**
1. View owner key section (only visible if key exists in localStorage)

**Expected:**
- Key text has `filter: blur(4px)` applied
- "Hover to reveal" badge visible
- Warning text: "Keep Safe"

---

### TC-04: Owner key — reveal on hover

**Steps:**
1. Hover mouse over the owner key card

**Expected:**
- Blur filter removes (`filter: none`)
- Key text becomes readable

---

### TC-05: Owner key — re-blur on mouse leave

**Steps:**
1. Hover over key card (blur clears)
2. Move mouse away from the card

**Expected:**
- Blur filter reapplies
- Key text becomes unreadable again

---

### TC-06: Copy owner key on click

**Steps:**
1. Click on the owner key card

**Expected:**
- Clipboard contains the full owner private key
- Toast: "Key copied"

---

### TC-07: No owner key in localStorage

**Steps:**
1. Clear `aimeat_owner_key` from localStorage
2. Reload and switch to Access tab

**Expected:**
- Owner key section is hidden
- No JavaScript errors
- Other sections (session info, public key, MCP) still render

---

### TC-08: MCP endpoint display

**Steps:**
1. View MCP endpoint section

**Expected:**
- MCP URL shown in monospace
- Description text visible
