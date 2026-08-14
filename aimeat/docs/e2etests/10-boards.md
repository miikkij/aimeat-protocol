# E2E Test Plan: Boards Tab

**Tab key:** `boards`
**Component:** `BoardsTab`
**Props:** `{ session, showToast }`

## Overview

Social discussion boards — create boards, subscribe to existing ones, view posts, create posts, react with emojis, and delete own posts.

## Preconditions

- User is authenticated
- Tab is switched to "Boards"

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Boards tab

**Expected:**
- Spinner while `listSubscriptions()` loads
- Spinner disappears when data arrives

---

### TC-02: Sub-tab switching

**Steps:**
1. Click "Browse" sub-tab
2. Click "My Boards" sub-tab

**Expected:**
- Active tab changes
- Browse lazy-loads `listAllBoards()` on first click

---

### TC-03: Create board

**Steps:**
1. Click "Create" button (`.btn-primary`)
2. Fill in: name "Test Board", description "Testing", visibility "public"
3. Click "Create"

**Expected:**
- Toast: board created confirmation
- Form closes
- New board appears in My Boards

---

### TC-04: Create board — cancel

**Steps:**
1. Open create form
2. Click "Cancel"

**Expected:**
- Form closes, no API call

---

### TC-05: Board card — click to view posts

**Steps:**
1. Click on a board card in My Boards

**Expected:**
- Board detail view opens (replaces list view)
- Back button (← arrow, `.btn-outline`) visible
- Board name in section title
- Post input area with textarea and "Post" button
- Posts list (or empty message)

---

### TC-06: Navigate back from board view

**Steps:**
1. Enter board detail view
2. Click back button (←)

**Expected:**
- Returns to My Boards list view
- Board list intact

---

### TC-07: Create post

**Steps:**
1. Enter board detail view
2. Type "Hello world" in the post textarea
3. Click "Post" button (`.btn-primary`)

**Expected:**
- Toast: post created
- Textarea clears
- New post appears at top of post list
- Post shows: content, author GAII, time ago

---

### TC-08: Create post — empty validation

**Steps:**
1. Leave textarea empty
2. Click "Post"

**Expected:**
- Toast error: "Write something first"
- No API call

---

### TC-09: Post reactions

**Steps:**
1. View a post in board detail
2. Click 👍 emoji button (`.reaction-btn`)
3. Click ❤️ emoji button

**Expected:**
- Each click calls `reactToPost(boardId, postId, emoji)`
- Reaction count appears next to the emoji
- Multiple different emoji reactions possible on same post

---

### TC-10: Delete own post

**Steps:**
1. Find a post authored by the current user
2. Click "Delete" button (`.btn-sm.btn-danger`)
3. Accept confirmation dialog

**Expected:**
- Confirm dialog: "Delete this post?"
- Post disappears from list
- Toast: "Post deleted"

---

### TC-11: Cannot delete others' posts

**Steps:**
1. View posts in a board
2. Check posts by other authors

**Expected:**
- Delete button is NOT visible on posts where `author !== current user`

---

### TC-12: Subscribe to board (Browse tab)

**Steps:**
1. Switch to Browse sub-tab
2. Find a board not yet subscribed to
3. Click "Subscribe" button (`.btn-sm`)

**Expected:**
- Toast: board subscribed
- Board may appear in My Boards after reload

---

### TC-13: Empty board — no posts

**Steps:**
1. View a board with no posts

**Expected:**
- Empty message visible
- Post input area still available

---

### TC-14: Reaction counts display

**Steps:**
1. View a post that has existing reactions

**Expected:**
- Emoji buttons show count next to them (e.g., "👍 3")
- Only emojis with count > 0 show the number
