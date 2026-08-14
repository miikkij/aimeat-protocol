# E2E Test Plan: Portfolio Tab

**Tab key:** `portfolio`
**Component:** `PortfolioTab`
**Props:** `{ session, navigate }`

## Overview

Simple launcher tab with two buttons — navigates to portfolio builder or views public portfolio. No data loading, no API calls.

## Preconditions

- User is authenticated and on the profile page
- Tab is switched to "Portfolio"

## Test Cases

### TC-01: Tab renders correctly

**Steps:**
1. Switch to Portfolio tab
2. Verify the tab content renders

**Expected:**
- Section heading visible with portfolio title text
- Section description/subtitle visible
- "Open Portfolio Builder" button (`.btn.btn-primary`) is visible
- No spinner (no data loading)

**Failure indicators:**
- Blank tab content
- Spinner that never resolves
- Missing buttons

---

### TC-02: Open Portfolio Builder navigation

**Steps:**
1. Click "Open Portfolio Builder" button (`.btn.btn-primary`)

**Expected:**
- Browser navigates to `/v1/portfolio`
- Portfolio builder page loads (page title or main container appears)

**Failure indicators:**
- No navigation occurs
- 404 page
- JavaScript error in console

---

### TC-03: View Public Portfolio link

**Steps:**
1. Verify "View Public" link/button (`.btn.btn-ghost`) is present
2. Check the link's `href` attribute

**Expected:**
- Link href equals `/v1/portfolio/{owner_name}` where `owner_name` matches the session owner
- Link has `target="_blank"` attribute (opens new tab)

**Failure indicators:**
- Link missing entirely (session may not be set)
- Wrong owner name in URL
- Missing `target="_blank"`

---

### TC-04: No session — public link hidden

**Steps:**
1. Clear session from localStorage
2. Reload profile page and switch to Portfolio tab

**Expected:**
- "Open Portfolio Builder" button still visible
- Public portfolio link is hidden (conditional on `session` prop)

**Failure indicators:**
- Public link still shows with undefined/null in URL
- JavaScript error from null session
