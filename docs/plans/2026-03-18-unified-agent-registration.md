# Unified Agent Registration Flow

**Date:** 2026-03-18
**Status:** Draft — awaiting review
**Scope:** Agent registration UX, backend route cleanup, approval UI

---

## Background

AIMEAT currently has two parallel paths for registering an authenticated agent:

1. **Device Authorization (RFC 8628)** — agent initiates, owner approves in browser, agent polls for credentials
2. **Connectivity Key** — owner generates a one-time key, shares it with the agent, agent self-registers instantly via `POST /v1/agents/connect`

The connectivity key path was designed for simplicity, but it has a critical flaw: **the owner is not in the approval loop at registration time**. The agent self-registers silently — the owner pastes a key in chat and the agent disappears into the system without an explicit scope-grant decision at that moment.

Additionally, with the proposed change (connectivity key → device auth dialog anyway), the key loses its only value proposition (instant registration) and creates a cognitive contradiction: *"I already gave it a key, why do I still need to approve?"*

**Decision:** Remove the connectivity key path. All agent registration goes through the Device Authorization browser-approval dialog. One path, one mental model.

---

## Goals

- **Single registration path** — Device Authorization (RFC 8628) for all agents
- **Non-polling support** — approval page shows copy-pasteable credentials for agents that cannot poll
- **Persistent credential** — agent stores `private_key` after first approval; uses it for all future re-authentication (JWT refresh)
- **Owner always in the loop** — no agent enters the system without explicit browser approval
- **i18n** — all new UI text in both `en.json` and `fi.json`
- **openapi.yaml stays in sync** — removed endpoints removed from spec, no orphan docs

---

## What Changes

### Removed

| Item | Why |
|------|-----|
| `POST /v1/agents/connect` | Connectivity key instant-register path — replaced by device auth |
| `POST /v1/auth/connectivity-key` | Key generation endpoint — no longer needed |
| `buildAgentPrompt()` device-authorize instructions in agents-tab.js | Will be rewritten |
| Connectivity key UI in agents-tab.js (generate key button, copy UI) | Removed |
| openapi.yaml entries for both removed endpoints | Spec sync |
| `locales/en.json` + `fi.json` connectivity key translation keys | Cleanup |

### Changed

| Item | What changes |
|------|-------------|
| `POST /v1/agents/device-authorize` | Accepts optional `scopes` suggestion from agent (owner can override in approval dialog) |
| `/v1/agents/verify` approval page | Add "Copy credentials" section shown after approval (for non-polling agents) |
| `buildAgentPrompt()` in agents-tab.js | Rewritten to describe device auth flow only, with two sub-paths (polling / non-polling) |
| `locales/en.json` + `fi.json` | New keys for approval page copy-paste section |

### Kept unchanged

- `POST /v1/agents` (direct owner registration via owner JWT) — programmatic flow for operators, not user-facing
- `POST /v1/agents/device-authorize` core logic — no changes needed
- `POST /v1/agents/device-token` polling endpoint — no changes needed
- `GET /v1/agents/verify/info/:userCode` — no changes needed
- `POST /v1/agents/verify` approval logic — minor UI additions only

---

## Implementation Steps

### Step 1 — Remove connectivity key backend

**Files:** `src/routes/agents.ts`, `src/routes/auth.ts`

- Remove `POST /v1/agents/connect` route handler (lines ~365–477 in agents.ts)
- Remove `POST /v1/auth/connectivity-key` route handler (lines ~518–570 in auth.ts)
- Remove `generateOtk` import from auth.ts if no longer used elsewhere
- Remove `storage.consumeOtk` call from agents.ts

Check: `npx tsc --noEmit` must pass after removal.

### Step 2 — Update openapi.yaml

- Remove `POST /v1/agents/connect` entry
- Remove `POST /v1/auth/connectivity-key` entry

### Step 3 — Update i18n files

Remove connectivity key translation keys from both `locales/en.json` and `locales/fi.json`.

Add new keys for the copy-credentials section on the approval page:

```json
"agents": {
  "approval": {
    "credentials_ready_title": "Agent approved",
    "credentials_ready_desc": "Copy the credentials below and paste them to your agent.",
    "copy_credentials": "Copy credentials",
    "copied": "Copied!",
    "credentials_warning": "Store the private key securely — it cannot be retrieved again.",
    "polling_note": "If your agent is polling automatically, it will receive these credentials within a few seconds.",
    "token_expiry_note": "The token expires in 24 hours. Your agent uses the private key to obtain a new token automatically."
  }
}
```

Finnish translations added simultaneously (same keys, `[TODO:fi]` prefix if unsure).

### Step 4 — Update approval page (`/v1/agents/verify`)

The approval page lives in `public/views/` (verify component). After the owner clicks **Approve**:

1. Show a new section: **"Agent approved"**
2. Display a formatted JSON block:
   ```json
   {
     "gaii": "claude#alice@node-id",
     "private_key": "...",
     "token": "...",
     "expires_at": "..."
   }
   ```
3. **Copy credentials** button (copies JSON to clipboard)
4. Two explanatory notes:
   - *"If your agent is polling automatically, it has already received these credentials."*
   - *"Store the private key securely — it cannot be retrieved again."*
5. Token expiry note

Use existing `t()` for all text. Use CSS classes only — no inline styles. Use existing `CopyButton` component or equivalent.

### Step 5 — Rewrite `buildAgentPrompt()` in agents-tab.js

Current: describes device-authorize 3-step flow + old connectivity key references.

New prompt describes the unified flow with both sub-paths clearly:

```
Connect to my AIMEAT node as an AI agent.

My owner name: {owner}
Node URL: {url}

Step 1 — Request access:
  POST {url}/v1/agents/device-authorize
  Body: { "agent_name": "choose-a-name", "owner": "{owner}" }
  → You receive: device_code, user_code, verification_uri_complete, interval

Step 2 — Tell me:
  "Please open this URL to approve my access: {verification_uri_complete}"

Step 3 — Wait for approval. Two options:

  Option A — If you can poll:
    POST {url}/v1/agents/device-token every {interval} seconds
    Body: { "device_code": "<from step 1>", "grant_type": "urn:ietf:params:oauth:grant-type:device_code" }
    You will get "authorization_pending" until I approve.
    On HTTP 200: you receive gaii, token, private_key.

  Option B — If you cannot poll:
    Tell me: "I cannot poll. Please copy my credentials from the approval page and paste them here."
    I will paste: { "gaii": "...", "private_key": "...", "token": "..." }

Step 4 — Store permanently:
  - private_key — never changes, use to get a new token when the current one expires
  - gaii — your identity on this node
  - token — use for all API calls: Authorization: Bearer <token>

Re-authentication (token expires after 24h):
  POST {url}/v1/auth/token
  Body: { "gaii": "<your gaii>", "timestamp": "<ISO now>", "signature": "<Ed25519_sign(private_key, gaii+timestamp)>" }
  → New JWT.
```

### Step 6 — Remove connectivity key UI from agents-tab.js

- Remove "Generate Connectivity Key" button and section
- Remove any state variables related to connectivity key (`connectivityKey`, `connectivityKeyLoading`, etc.)
- Remove `generateConnectivityKey` service call

### Step 7 — Update profile agents-tab UI strings

Any hardcoded references to "connectivity key" in the UI replaced with appropriate text or removed.

### Step 8 — Run tests

```bash
cd aimeat
npx tsc --noEmit
pnpm lint
pnpm test:e2e:mongodb
pnpm test:e2e:sqlite
npx playwright test
```

Target: 0 failures. Update any E2E tests that relied on the connectivity key endpoints.

---

## Non-Goals

- Changing how device auth *works* internally (polling interval, expiry, rate limiting) — that stays as-is
- Changing `POST /v1/agents` direct owner registration — still available for programmatic/operator use
- Adding activity logging per key/session — valuable future work, out of scope here
- Scope UI changes in the approval dialog — out of scope here

---

## Files Touched

| File | Change type |
|------|------------|
| `src/routes/agents.ts` | Remove `POST /v1/agents/connect` |
| `src/routes/auth.ts` | Remove `POST /v1/auth/connectivity-key` |
| `openapi.yaml` | Remove 2 endpoints |
| `locales/en.json` | Remove connectivity key keys, add approval copy-paste keys |
| `locales/fi.json` | Same |
| `public/views/profile/agents-tab.js` | Rewrite `buildAgentPrompt()`, remove connectivity key UI |
| `public/views/` (verify page) | Add copy-credentials section after approval |
| `test/` | Update or remove tests for deleted endpoints |

---

## Resolved Questions

### 1. Verify page location — RESOLVED

`GET /v1/agents/verify` is handled in `src/routes/agents.ts` (line ~598). It serves `public/agent-consent.html` as a static file (CSP nonce-injected). The URL is already known at device-authorize time — `verification_uri_complete` is constructed from `req.protocol + req.get('host')` in the same handler (line ~86). The agent always receives the full URL in the device-authorize response, so it can tell the user exactly where to go without any hardcoding.

**Step 4 target file: `public/agent-consent.html`** (and its accompanying JS/CSS).

### 2. OTK storage — RESOLVED, keep everything

OTK (`storage.consumeOtk`, `storage.createOtk`) is used in **7 separate routes**, not just connectivity key:

| Route | OTK purpose |
|-------|-------------|
| `auth.ts` `/v1/auth/session` | Tier 0.5 session OTK (after Ed25519 challenge-response) |
| `auth.ts` pre-rotate | Buffered next_otk so agent always has a key ready |
| `auth.ts` `/v1/auth/otk` | Generate OTK for owner Tier 0.5 actions |
| `auth.ts` `/v1/auth/initial-otk` | Initial OTK embedded in AI prompts |
| `admin.ts` `/v1/admin/setup/initial-otk` | Admin-generated initial OTK for setup |
| `boards.ts` Tier 0.5 board post | Post to board without JWT, using OTK |
| `disputes.ts` Tier 0.5 | Dispute actions via OTK |
| `micro-memory.ts` | Lightweight memory reads/writes for Tier 0.5 |
| `work.ts` | Work queue actions via OTK |

OTK is the foundation of Tier 0.5 — the "can-do-some-things-without-full-JWT" layer. It is **not connectivity-key-specific** and must be kept in full.

**Only remove:** the single `action: 'register_agent'` OTK creation in `auth.ts /v1/auth/connectivity-key` and the corresponding `consumeOtk` call in `agents.ts /v1/agents/connect`. The storage interface, the OTK table, and all other usages are unaffected.

### 3. E2E test coverage — RESOLVED, tests need replacing

Three tests in `test/api-full.ts` exercise the connectivity key path (lines ~2063–2092):

- `"Owner generates connectivity key"` — calls `POST /v1/auth/connectivity-key`
- `"Agent registers via connectivity key"` — calls `POST /v1/agents/connect`
- `"Connectivity key cannot be reused"` — calls `POST /v1/agents/connect` again

These three tests must be **replaced** (not just deleted) with device-auth-flow equivalent tests:

- `"Agent starts device authorization"` — calls `POST /v1/agents/device-authorize`, asserts device_code + verification_uri returned
- `"Owner approves device authorization"` — calls `POST /v1/agents/verify` with owner JWT, asserts approved
- `"Agent polls and receives credentials"` — calls `POST /v1/agents/device-token`, asserts gaii + token + private_key returned
- `"Device code cannot be reused after credential retrieval"` — polls again, asserts expired_token
