# E2E Test Plan: Organisms Tab

**Tab key:** `organisms`
**Component:** `OrganismsTab`
**Props:** `{ session, showToast, onStats }`

## Overview

Group management — create organisms (communities/teams/clubs), join/leave existing ones, discover public organisms, delete owned organisms. Expandable cards with member details.

## Preconditions

- User is authenticated
- Tab is switched to "Organisms"

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Organisms tab

**Expected:**
- Spinner visible with "Loading organisms..." text
- Spinner disappears when data loads

---

### TC-02: Tab renders with sections

**Steps:**
1. Wait for data to load

**Expected:**
- Section title "Organisms" visible
- Section description visible
- "Create Organism" button (`.btn-sm.btn-copy`) visible
- "My Organisms" subsection title visible
- "Discover" subsection (conditional, only if public organisms exist)

---

### TC-03: Empty state — no organisms

**Steps:**
1. Use account that is not part of any organisms

**Expected:**
- "My Organisms" section shows empty message: "You are not part of any organisms yet."
- Discover section may show public organisms to join

---

### TC-04: Show create form

**Steps:**
1. Click "Create Organism" button

**Expected:**
- Create form card appears with:
  - Name input (required, placeholder text)
  - Description textarea
  - Interests input (comma-separated, placeholder)
  - Type select: community, team, club, cooperative, project
  - Join policy select: open, approval_required, invite_only
  - Visibility select: public, listed, private
  - "Create" button (`.btn-sm.btn-copy`)
  - "Cancel" button (opacity .7)

---

### TC-05: Create organism — success

**Steps:**
1. Open create form
2. Enter name: "Test Community"
3. Enter description: "A test organism"
4. Enter interests: "coding, AI, testing"
5. Leave type as "community", policy as "open", visibility as "public"
6. Click "Create"

**Expected:**
- Button shows "..." while creating (disabled)
- On success:
  - Toast: "Organism created!"
  - Form hides
  - Form fields reset
  - New organism appears in "My Organisms" section
  - `onStats` callback fires with updated count

---

### TC-06: Create organism — validation (empty name)

**Steps:**
1. Open create form
2. Leave name empty
3. Click "Create"

**Expected:**
- Toast: "Name is required"
- No API call
- Form stays open

---

### TC-07: Cancel create form

**Steps:**
1. Open create form
2. Click "Cancel"

**Expected:**
- Form hides
- "Create Organism" button reappears

---

### TC-08: Expand organism card

**Steps:**
1. Click on an organism card header (`.card-clickable`)

**Expected:**
- Card gets `.card-expanded` class
- Expand icon changes ▶ → ▼
- Detail section appears with:
  - Creator GAII
  - Admins list (comma-separated or "-")
  - Member count / max (e.g., "3 / 500")
  - Board ID (if exists, monospace)
  - Created date (localized)
- Action buttons appear based on role

---

### TC-09: Collapse organism card

**Steps:**
1. Expand a card
2. Click the same header again

**Expected:**
- Card collapses (class removed, detail hidden)
- Expand icon reverts to ▶

---

### TC-10: Only one card expanded at a time

**Steps:**
1. Expand organism card A
2. Click organism card B header

**Expected:**
- Card A collapses
- Card B expands
- Only one card has `.card-expanded` at any time

---

### TC-11: Interest tags display

**Steps:**
1. View an organism with interests

**Expected:**
- Interest tags shown as small badges with pink background
- Tags wrap correctly on narrow screens

---

### TC-12: Join organism (open policy)

**Steps:**
1. Find an organism in Discover section with "Open" join policy
2. Expand the card
3. Click "Join" button (`.btn-sm.btn-copy`)

**Expected:**
- Toast: "Joined!"
- Data reloads
- Organism moves from Discover to My Organisms

---

### TC-13: Join organism (approval required)

**Steps:**
1. Find an organism with "Approval" join policy
2. Click "Join"

**Expected:**
- Toast: "Join request sent — waiting for approval"
- Organism stays in Discover (pending approval)

---

### TC-14: Leave organism

**Steps:**
1. Find an organism in My Organisms where user is member but NOT creator
2. Expand the card
3. Click "Leave" button (`.btn-sm.btn-danger`)
4. Accept confirmation dialog

**Expected:**
- Confirm dialog: 'Leave "{name}"?'
- Toast: "Left organism"
- Organism disappears from My Organisms
- Organism may reappear in Discover (if public)

---

### TC-15: Leave organism — cancel

**Steps:**
1. Click "Leave" button
2. Cancel the confirmation

**Expected:**
- No API call
- Organism remains in My Organisms

---

### TC-16: Delete organism (creator only)

**Steps:**
1. Find an organism in My Organisms where user IS the creator
2. Expand the card
3. Click "Delete" button (`.btn-sm.btn-danger`)
4. Accept confirmation dialog

**Expected:**
- Confirm dialog: 'Delete "{name}"? This cannot be undone.'
- Toast: "Organism deleted"
- Card collapses and disappears
- Data reloads

---

### TC-17: Button visibility by role

**Steps:**
1. Check action buttons in expanded organism cards

**Expected:**
- **Creator:** sees Delete button, NO Leave button
- **Member (not creator):** sees Leave button, NO Delete button
- **Non-member:** sees Join button, NO Leave/Delete buttons
