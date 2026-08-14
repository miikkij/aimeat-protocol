# E2E Test Plan: Wallet Tab

**Tab key:** `wallet`
**Component:** `WalletTab`
**Props:** `{ session, showToast, onStats }`

## Overview

Shows morsel balance overview, transaction history with expandable details, lifetime stats, and a "request morsels" form.

## Preconditions

- User is authenticated
- Tab is switched to "Wallet"

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Wallet tab

**Expected:**
- Spinner visible while `getWallet()` and `getTransactions(20)` load
- Spinner disappears when both calls complete

---

### TC-02: Balance overview renders

**Steps:**
1. Wait for wallet data to load

**Expected:**
- 4 wallet cards visible (`.wallet-overview`):
  - Balance (number, neutral color)
  - In Escrow (number)
  - Available (number, positive color if > 0)
  - Daily Allowance (number)
- All values are non-negative numbers

---

### TC-03: Copy balance

**Steps:**
1. Click the copy balance button (the shared `<CopyButton>` labelled by `profile.wallet.copyBalance`; find it by its accessible name, not by a class)

**Expected:**
- Clipboard contains text like "Balance: X | Available: Y | Escrow: Z"
- Button text changes to "Copied" for ~2 seconds
- Then reverts to original text

---

### TC-04: Request morsels — success

**Steps:**
1. Enter amount "10" in the amount input (number input, min 1, max 500)
2. Enter "testing" in the reason input
3. Click "Request Morsels" submit button (`.wr-submit`)

**Expected:**
- Button shows "Requesting..." while API call in flight
- On success:
  - Toast shows amount granted (e.g., "Granted 10 morsels")
  - Form clears (amount and reason empty)
  - Balance overview reloads with updated values

---

### TC-05: Request morsels — validation

**Steps:**
1. Leave amount empty or set to 0
2. Try to submit

**Expected:**
- HTML5 validation prevents submission (input has `min="1"`, `required`)
- No API call made

---

### TC-06: Request morsels — error

**Steps:**
1. Enter amount exceeding the daily cap (e.g., 9999)
2. Submit

**Expected:**
- Error toast with server error message
- Form is not cleared
- Button reverts to "Request Morsels"

---

### TC-07: Lifetime stats render (conditional)

**Steps:**
1. Check if lifetime stats section (`.wallet-lifetime`) is visible

**Expected:**
- If user has earned or spent morsels:
  - 4 stats visible: Lifetime earned (green), Lifetime spent (red), Lifetime allowance, Lifetime welcome bonus
- If new user with no history:
  - Section may be hidden

---

### TC-08: Transaction list renders

**Steps:**
1. Scroll to transaction history section

**Expected:**
- Section title "Transaction History" visible
- Transaction items (`.tx-item`) listed, newest first
- Each item shows: type label, description/memo, amount (green/red), time ago, chevron

---

### TC-09: Empty transaction list

**Steps:**
1. Use a brand new account with no transactions

**Expected:**
- "No transactions" empty state message visible

---

### TC-10: Expand transaction

**Steps:**
1. Click on a transaction item (`.tx-item`)

**Expected:**
- Detail section (`.tx-detail`) expands below the item
- Shows grid with: ID, Type, Counterparty GAII (if exists), Tracking code (if exists), Timestamp
- Chevron changes from ▼ to ▲
- "Copy Transaction" button visible

---

### TC-11: Copy transaction details

**Steps:**
1. Expand a transaction
2. Click the transaction's copy button (the shared `<CopyButton>` labelled `common.copy`; find it by its accessible name)

**Expected:**
- Button text changes to "Copied" briefly
- Clipboard contains formatted transaction details:
  - ID, Type, Amount, Counterparty, Tracking, Time

---

### TC-12: Collapse transaction

**Steps:**
1. Expand a transaction
2. Click the same transaction item again

**Expected:**
- Detail section collapses
- Chevron reverts

---

### TC-13: Credit vs debit styling

**Steps:**
1. Look at transaction amounts in the list

**Expected:**
- Credits (incoming morsels) show green color (`.credit` class)
- Debits (outgoing morsels) show red color (`.debit` class)
- Amount includes sign (+ or -)
