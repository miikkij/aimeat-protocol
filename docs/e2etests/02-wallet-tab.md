# Wallet Tab - E2E Test Cases

## Overview

The Wallet Tab displays the user's morsel economy balance, transaction history, lifetime statistics, and provides a form to request additional morsels. It supports expanding transaction details, copying balance and transaction info to clipboard, and color-coded credit/debit amounts.

### Components

- **WalletTab** (`public/views/profile/wallet-tab.js`) - Main tab component
- **Balance overview cards** - Balance, escrow, available, daily allowance
- **Lifetime stats section** - Earned, spent, allowance received, welcome bonus
- **Request morsels form** - Amount + reason input with submit
- **Transaction list** - Expandable items with copy-to-clipboard

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/wallet` | Get wallet balance and info |
| GET | `/v1/wallet/transactions?limit=N` | Get recent transactions |
| POST | `/v1/wallet/request` | Request morsels (amount + reason) |

### Service Layer (`public/js/services/wallet.js`)

- `getWallet()` - Returns wallet object with balance, escrow, daily_allowance, lifetime stats
- `getTransactions(limit)` - Returns array of transactions (default limit 20)
- `requestMorsels(amount, reason)` - POST request, throws on `ok: false`

### Transaction Types

| Type | Display Label |
|------|---------------|
| `allowance` / `daily_allowance` | Allowance |
| `welcome_bonus` | Welcome Bonus |
| `earned` | Earned |
| `spent` | Spent |
| Positive amount (fallback) | Earned |
| Negative amount (fallback) | Shared |

---

## Table of Contents

- [Balance Display](#balance-display)
  - [TC-WAL-001: View balance overview](#tc-wal-001-view-balance-overview)
  - [TC-WAL-002: Copy balance summary to clipboard](#tc-wal-002-copy-balance-summary-to-clipboard)
- [Lifetime Stats](#lifetime-stats)
  - [TC-WAL-003: View lifetime statistics](#tc-wal-003-view-lifetime-statistics)
- [Transaction History](#transaction-history)
  - [TC-WAL-004: Transaction list loads with items](#tc-wal-004-transaction-list-loads-with-items)
  - [TC-WAL-005: Expand transaction to view details](#tc-wal-005-expand-transaction-to-view-details)
  - [TC-WAL-006: Copy transaction details to clipboard](#tc-wal-006-copy-transaction-details-to-clipboard)
  - [TC-WAL-007: Color-coded credit and debit amounts](#tc-wal-007-color-coded-credit-and-debit-amounts)
  - [TC-WAL-008: Transaction type labels display correctly](#tc-wal-008-transaction-type-labels-display-correctly)
- [Request Morsels](#request-morsels)
  - [TC-WAL-009: Request morsels with valid amount and reason](#tc-wal-009-request-morsels-with-valid-amount-and-reason)
  - [TC-WAL-010: Request morsels with amount only (no reason)](#tc-wal-010-request-morsels-with-amount-only-no-reason)
- [Failure Cases](#failure-cases)
  - [TC-WAL-011: Request morsels with zero amount](#tc-wal-011-request-morsels-with-zero-amount)
  - [TC-WAL-012: Request morsels with negative amount](#tc-wal-012-request-morsels-with-negative-amount)
  - [TC-WAL-013: Request morsels exceeding server limit](#tc-wal-013-request-morsels-exceeding-server-limit)
  - [TC-WAL-014: Unauthenticated access](#tc-wal-014-unauthenticated-access)
  - [TC-WAL-015: Wallet API failure](#tc-wal-015-wallet-api-failure)
- [Edge Cases](#edge-cases)
  - [TC-WAL-016: Empty transaction history](#tc-wal-016-empty-transaction-history)
  - [TC-WAL-017: Transaction with no extra details](#tc-wal-017-transaction-with-no-extra-details)
  - [TC-WAL-018: Very large transaction list](#tc-wal-018-very-large-transaction-list)
  - [TC-WAL-019: Multiple rapid morsel requests](#tc-wal-019-multiple-rapid-morsel-requests)
  - [TC-WAL-020: Balance with zero escrow](#tc-wal-020-balance-with-zero-escrow)
  - [TC-WAL-021: Collapse expanded transaction](#tc-wal-021-collapse-expanded-transaction)
  - [TC-WAL-022: Lifetime stats section hidden when no data](#tc-wal-022-lifetime-stats-section-hidden-when-no-data)

---

## Balance Display

### TC-WAL-001: View balance overview
- **Precondition:** User is authenticated and navigates to the Wallet tab.
- **Steps:**
  1. Open the Wallet tab.
  2. Wait for data to load.
- **Expected:** Four balance cards are displayed:
  - **Balance** shows the total balance (e.g., `150`).
  - **In Escrow** shows the escrowed amount (from `in_escrow` or `escrow` field).
  - **Available** shows `balance - escrow` (e.g., `130` if escrow is `20`).
  - **Daily Allowance** shows the daily allowance amount (defaults to `50` if not set).
  All values are numeric. A loading spinner is shown during the fetch.
- **Type:** success

### TC-WAL-002: Copy balance summary to clipboard
- **Precondition:** User is authenticated. Wallet data has loaded showing balance=150, escrow=20.
- **Steps:**
  1. Click the "Copy balance" button below the balance cards.
- **Expected:** The text `Balance: 150 | Available: 130 | Escrow: 20` is written to the clipboard via `navigator.clipboard.writeText()`. The button text changes to "Copied" for 2 seconds, then reverts to the original label.
- **Type:** success

---

## Lifetime Stats

### TC-WAL-003: View lifetime statistics
- **Precondition:** User is authenticated. The wallet response includes a `lifetime` object with `earned`, `spent`, `received_allowance`, and `welcome_bonus` fields.
- **Steps:**
  1. Open the Wallet tab and wait for data to load.
  2. Scroll to the "Lifetime" section.
- **Expected:** Four lifetime stat values are displayed:
  - **Earned** in green color (var(--success)).
  - **Spent** in red color (var(--danger)).
  - **Allowance received** in default color.
  - **Welcome bonus** in default color.
  Each value corresponds to the data from `wallet.lifetime`.
- **Type:** success

---

## Transaction History

### TC-WAL-004: Transaction list loads with items
- **Precondition:** User is authenticated. At least 3 transactions exist.
- **Steps:**
  1. Open the Wallet tab and wait for data to load.
  2. Scroll to "Recent transactions" section.
- **Expected:** A GET request is sent to `/v1/wallet/transactions?limit=20`. Transactions are displayed as a list. Each item shows the type label, description/memo text, amount (color-coded), and relative timestamp (via `timeAgo()`). An expand/collapse arrow icon is visible.
- **Type:** success

### TC-WAL-005: Expand transaction to view details
- **Precondition:** User is authenticated. Transactions are loaded.
- **Steps:**
  1. Click on a transaction item in the list.
- **Expected:** The transaction expands to show a detail grid containing:
  - ID (if present)
  - Type (if present)
  - Counterparty GAII (if present)
  - Tracking code (if present)
  - Full timestamp in locale format (if present)
  - A "Copy" button for the transaction details.
  The expand arrow changes from down to up.
- **Type:** success

### TC-WAL-006: Copy transaction details to clipboard
- **Precondition:** User is authenticated. A transaction is expanded.
- **Steps:**
  1. Expand a transaction with ID `tx-123`, type `earned`, amount `10`, counterparty `agent@node`, tracking code `TC-456`, and a timestamp.
  2. Click the "Copy" button in the detail section.
- **Expected:** The clipboard receives multi-line text formatted as:
  ```
  ID: tx-123
  Type: earned
  Amount: 10
  Counterparty: agent@node
  Tracking: TC-456
  Time: <timestamp>
  ```
  The copy button text changes to "Copied" for 2 seconds. The click event does not propagate (does not collapse the transaction).
- **Type:** success

### TC-WAL-007: Color-coded credit and debit amounts
- **Precondition:** User is authenticated. Transactions include both positive and negative amounts.
- **Steps:**
  1. View the transaction list.
- **Expected:** Transactions with positive amounts display with a `+` prefix and the `credit` CSS class (green). Transactions with negative amounts display without prefix and with the `debit` CSS class (red).
- **Type:** success

### TC-WAL-008: Transaction type labels display correctly
- **Precondition:** User is authenticated. Transactions of various types exist.
- **Steps:**
  1. View the transaction list containing `allowance`, `welcome_bonus`, `earned`, and `spent` type transactions.
- **Expected:** Each transaction shows the localized label from `txTypeLabel()`:
  - `allowance` or `daily_allowance` -> "Allowance"
  - `welcome_bonus` -> "Welcome Bonus"
  - `earned` -> "Earned"
  - `spent` -> "Spent"
  - Unknown type with positive amount -> "Earned" (fallback)
  - Unknown type with negative amount -> "Shared" (fallback)
- **Type:** success

---

## Request Morsels

### TC-WAL-009: Request morsels with valid amount and reason
- **Precondition:** User is authenticated. Wallet tab is open.
- **Steps:**
  1. In the "Request Morsels" form, enter `50` in the amount field.
  2. Enter `Testing services` in the reason field.
  3. Click the "Request" button.
- **Expected:** A POST request is sent to `/v1/wallet/request` with body `{ amount: 50, reason: "Testing services" }`. The button shows "Requesting..." while loading. On success, a toast displays the granted amount and new balance (e.g., "Granted 50 morsels. Balance: 200"). The form fields are cleared. The wallet data reloads to reflect the new balance in the overview cards.
- **Type:** success

### TC-WAL-010: Request morsels with amount only (no reason)
- **Precondition:** User is authenticated. Wallet tab is open.
- **Steps:**
  1. Enter `25` in the amount field.
  2. Leave the reason field empty.
  3. Click the "Request" button.
- **Expected:** A POST is sent with `{ amount: 25, reason: undefined }`. The request completes successfully. The reason field is omitted from the payload (since `reqReason || undefined` evaluates to `undefined`).
- **Type:** success

---

## Failure Cases

### TC-WAL-011: Request morsels with zero amount
- **Precondition:** User is authenticated. Wallet tab is open.
- **Steps:**
  1. Enter `0` in the amount field.
  2. Click the "Request" button.
- **Expected:** The client-side guard `if (!amount || amount <= 0) return` prevents the API call. No request is sent. The form remains as-is. The button does not enter a loading state.
- **Type:** failure

### TC-WAL-012: Request morsels with negative amount
- **Precondition:** User is authenticated. Wallet tab is open.
- **Steps:**
  1. Enter `-10` in the amount field.
  2. Click the "Request" button.
- **Expected:** The client-side guard `if (!amount || amount <= 0) return` prevents the API call. No request is sent. Note: the HTML input has `min="1"` which provides browser-level validation as well.
- **Type:** failure

### TC-WAL-013: Request morsels exceeding server limit
- **Precondition:** User is authenticated. The server has a maximum morsel request limit (e.g., 500 per request, as suggested by the `max="500"` attribute on the input).
- **Steps:**
  1. Enter `9999` in the amount field (bypassing browser validation).
  2. Submit the form.
- **Expected:** A POST request is sent to `/v1/wallet/request` with `amount: 9999`. The server responds with `ok: false` and an error message (e.g., "Exceeds maximum request amount"). The `requestMorsels()` function throws an error. An error toast is displayed with the server's error message. The loading state is cleared.
- **Type:** failure

### TC-WAL-014: Unauthenticated access
- **Precondition:** User is not logged in or the session token has expired.
- **Steps:**
  1. Navigate to the Wallet tab.
- **Expected:** The GET request to `/v1/wallet` returns 401. The `catch` block in `loadData()` sets `walletData` to null. The tab shows a loading spinner indefinitely (since `walletData` remains null and the spinner is shown when `!walletData`). Alternatively, if the auth wrapper redirects, the user is sent to the login page.
- **Type:** failure

### TC-WAL-015: Wallet API failure
- **Precondition:** User is authenticated. The server is experiencing an error on the wallet endpoint.
- **Steps:**
  1. Navigate to the Wallet tab.
- **Expected:** The GET to `/v1/wallet` returns 500. The catch block sets `walletData` to null. The spinner remains visible. Transaction loading also fails gracefully, setting `walletTx` to an empty array.
- **Type:** failure

---

## Edge Cases

### TC-WAL-016: Empty transaction history
- **Precondition:** User is authenticated. The wallet has a balance but zero transactions (e.g., newly created account).
- **Steps:**
  1. Open the Wallet tab and wait for data to load.
  2. Look at the "Recent transactions" section.
- **Expected:** The balance overview cards display correctly. The transaction section shows the empty state message. No transaction list is rendered.
- **Type:** edge

### TC-WAL-017: Transaction with no extra details
- **Precondition:** User is authenticated. A transaction exists with only `id`, `amount`, and `type` fields -- no `counterparty_gaii`, `tracking_code`, or `timestamp`.
- **Steps:**
  1. Expand this transaction.
- **Expected:** The detail section shows the ID and Type rows. Instead of counterparty/tracking/timestamp rows, a fallback message "No additional details" is displayed (spanning the full grid). The copy button is still available and copies only the available fields.
- **Type:** edge

### TC-WAL-018: Very large transaction list
- **Precondition:** User is authenticated. The account has hundreds of transactions.
- **Steps:**
  1. Open the Wallet tab.
- **Expected:** Only 20 transactions are loaded (the `limit=20` parameter in `getTransactions(20)`). The 20 most recent transactions are displayed. The list is scrollable. Performance is acceptable.
- **Type:** edge

### TC-WAL-019: Multiple rapid morsel requests
- **Precondition:** User is authenticated. Wallet tab is open.
- **Steps:**
  1. Enter `10` in the amount field and click "Request".
  2. Immediately change the amount to `20` and click "Request" again before the first request completes.
- **Expected:** The first request sets `reqLoading` to true, which disables the submit button. The second click is effectively blocked because the button is disabled while loading. Only one request is processed. After it completes, the button re-enables.
- **Type:** edge

### TC-WAL-020: Balance with zero escrow
- **Precondition:** User is authenticated. The wallet has `balance: 100` and no `in_escrow` or `escrow` field (or it is `0`).
- **Steps:**
  1. Open the Wallet tab.
- **Expected:** The escrow card shows `0`. The available card shows `100` (same as balance since `100 - 0 = 100`). The fallback `w.in_escrow ?? w.escrow ?? 0` correctly handles the missing field.
- **Type:** edge

### TC-WAL-021: Collapse expanded transaction
- **Precondition:** User is authenticated. A transaction is currently expanded.
- **Steps:**
  1. Click on the same expanded transaction item.
- **Expected:** The `toggleTx` callback sets `expandedTx` back to `null` (since `prev === id`). The detail section collapses. The arrow icon changes from up to down.
- **Type:** edge

### TC-WAL-022: Lifetime stats section hidden when no data
- **Precondition:** User is authenticated. The wallet response has no `lifetime` object, or `lifetime.earned` and `lifetime.spent` are both `null`/`undefined`.
- **Steps:**
  1. Open the Wallet tab.
- **Expected:** The "Lifetime" section heading and stats grid are not rendered. The conditional `(lifetime.earned != null || lifetime.spent != null)` evaluates to false, so the block is skipped.
- **Type:** edge
