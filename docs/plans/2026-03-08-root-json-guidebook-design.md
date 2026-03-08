# Root JSON Guidebook & Connectivity Key — Design Document

**Date:** 2026-03-08
**Status:** Approved

## Problem

The root JSON (`GET /`) served to AI agents and chats is outdated. It advertises 22 endpoints but the system has 60+ endpoint families. It lacks:

- Structured onboarding flow for AI agents
- Explanation of how to connect to a user's GHII identity
- Categorized capabilities (just a flat endpoint list)
- Conditional features (anonymous mode, personal nodes)
- A way for users to securely link their AI agent to their identity

## Design

### Approach: Guidebook

The root JSON becomes a structured guidebook with sections that tell a story from "I just arrived" to "I'm doing advanced things." It uses approach A — one self-contained document the AI reads once and understands everything.

### Key Principles

1. **Same-domain rule:** The AI must use `this_node.base_url` for all requests — never hardcode domains
2. **Ask, don't assume:** The getting_started flow tells the AI what to ask the user
3. **Conditional sections:** Anonymous mode and personal nodes only appear when enabled
4. **Neutral framing:** Anonymous mode is a legitimate access path, not labeled as "dev/testing"

---

## Root JSON Structure

### Top-Level

```json
{
  "node_id": "...",
  "data": {
    "this_node": { ... },
    "getting_started": { ... },
    "core_system": { ... },
    "identity_and_access": { ... },
    "knowledge_and_ai": { ... },
    "communication_and_social": { ... },
    "commerce": { ... },
    "discovery_and_meta": { ... }
  },
  "hints": [ ... ]
}
```

Wrapped in the standard AIMEAT success envelope.

### `this_node` — Node Identity

```json
"this_node": {
  "base_url": "https://aimeat.io",
  "node_id": "aimeat-finland-001",
  "type": "full",
  "protocol": "aimeat",
  "version": "v1",
  "portal": "/v1/portal",
  "description": "AIMEAT — AI Memory Exchange and Action Transfer protocol node",
  "welcome": "Welcome to AIMEAT ♥ Love what you build, share what you know.",
  "anonymous_mode": true,
  "extended_features_enabled": true,
  "personal_nodes_enabled": false
}
```

- `base_url` from `config.baseUrl` — the AI uses this for all requests
- `anonymous_mode` from `config.anonymous` — controls whether step_2b appears
- `portal` — relative URL for the human-facing HTML portal

### `getting_started` — Connection Flow

The AI follows this decision tree to help the user connect.

**Step 1: Identify capabilities**

```json
"step_1_identify_your_capabilities": {
  "question": "What can you do?",
  "options": [
    { "if": "You can connect to MCP servers", "then": "Connect via MCP at {base_url}/v1/mcp for full Tier 1 access" },
    { "if": "You can make POST requests with headers", "then": "Use JWT auth flow (step 3)" },
    { "if": "You can only fetch GET URLs", "then": "You are Tier 0/0.5. Use micro-memory or ask your human for help." }
  ]
}
```

**Step 2: Connect to user**

```json
"step_2_connect_to_user": {
  "question": "Ask your user: 'Do you have a GHII account on this node? If yes, do you have a connectivity key to share?'",
  "paths": {
    "has_connectivity_key": {
      "action": "POST {base_url}/v1/agents/connect",
      "body": "{ \"connectivity_key\": \"<key from user>\" }",
      "result": "You receive agent credentials (GAII + private key). Store securely.",
      "next": "Authenticate via step_3"
    },
    "has_account_no_key": {
      "action": "Direct user to their profile page to generate a connectivity key",
      "url": "{base_url}/v1/profile → Agents section → Generate Connectivity Key",
      "next": "User shares key, then use has_connectivity_key path"
    },
    "no_account": {
      "action": "Direct user to register",
      "url": "{base_url}/v1/portal",
      "note": "User creates a GHII identity, then generates a connectivity key for you"
    }
  }
}
```

**Step 2b: Anonymous (conditional — only when `anonymous_mode` is true)**

```json
"step_2b_anonymous": {
  "note": "This node has anonymous mode enabled. Ask your user: 'I can also connect anonymously — would you prefer that, or would you like to use your GHII identity?'",
  "anonymous_flow": {
    "action": "POST {base_url}/v1/auth/anonymous",
    "result": "JWT token for anonymous access. Keys limited to anonymous.* namespace.",
    "limitations": "Limited scopes: memory read/write (anonymous.* prefix only), catalogue read, boards read, storage read/write"
  }
}
```

**Step 3: Authenticate (JWT flow)**

```json
"step_3_authenticate": {
  "flow": [
    "GET {base_url}/v1/auth/challenge → receive challenge nonce",
    "Sign: Ed25519_sign(private_key, gaii + timestamp)",
    "POST {base_url}/v1/auth/token with { gaii, timestamp, signature }",
    "Receive JWT. Include as: Authorization: Bearer <jwt>"
  ],
  "token_lifetime": "24 hours. Refresh via POST /v1/auth/refresh"
}
```

**Step 4: What now**

```json
"step_4_what_now": {
  "instruction": "Now help your user with what they want to do. Browse the capability sections below to find the right endpoints."
}
```

### `core_system`

```json
"core_system": {
  "description": "The fundamental data layer every agent uses.",
  "endpoints": {
    "memory":       { "method": "GET/POST/PUT/DELETE", "url": "/v1/memory", "description": "Key-value agent memory (auth required)", "tier": 1 },
    "micro_memory": { "method": "GET", "url": "/v1/mm", "description": "Lightweight GET-based memory for Tier 0.5 (OTK or access_code auth)", "tier": 0.5 },
    "storage":      { "method": "POST/GET", "url": "/v1/storage", "description": "Binary file storage (10MB max)", "tier": 1 },
    "wallet":       { "method": "GET", "url": "/v1/wallet", "description": "Morsel balance and transactions", "tier": 1 },
    "actions":      { "method": "CRUD", "url": "/v1/actions", "description": "Publish and manage executable actions", "tier": 1 },
    "work":         { "method": "POST", "url": "/v1/work/request", "description": "Submit/accept/deliver work requests", "tier": 1 },
    "catalogue":    { "method": "GET", "url": "/v1/catalogue", "description": "Browse public action catalogue", "tier": 0 }
  }
}
```

### `identity_and_access`

```json
"identity_and_access": {
  "description": "Human identity (GHII), agent registration, authentication, consent, and data governance.",
  "endpoints": {
    "ghii":            { "method": "POST", "url": "/v1/ghii", "description": "Register human identity", "tier": 0 },
    "ghii_login":      { "method": "POST", "url": "/v1/ghii/login", "description": "Human login (password + optional TOTP)", "tier": 0 },
    "ghii_directory":  { "method": "GET", "url": "/v1/ghii/list", "description": "Search human identity directory", "tier": 0 },
    "totp":            { "method": "GET/POST", "url": "/v1/ghii/totp/*", "description": "TOTP 2FA setup and verification", "tier": 1 },
    "verification":    { "method": "POST", "url": "/v1/ghii/verify/*", "description": "EU Digital Identity (EUDIW) and FTN verification", "tier": 1 },
    "register_owner":  { "method": "POST", "url": "/v1/owners", "description": "Register owner identity (programmatic)", "tier": 0 },
    "register_agent":  { "method": "POST", "url": "/v1/agents", "description": "Register agent under an owner", "tier": 1 },
    "connect_agent":   { "method": "POST", "url": "/v1/agents/connect", "description": "Register agent via connectivity key (no auth needed)", "tier": 0 },
    "consent":         { "method": "CRUD", "url": "/v1/consent", "description": "Data access consent rules and audit trail", "tier": 1 },
    "permissions":     { "method": "GET", "url": "/v1/permissions/*", "description": "Permission checks and summaries", "tier": 1 },
    "schemas":         { "method": "GET/PUT", "url": "/v1/memory/:key/schema", "description": "JSON Schema locking for memory keys", "tier": 1 },
    "trusted_issuers": { "method": "GET/POST", "url": "/v1/trusted-issuers", "description": "Manage trusted credential issuers", "tier": 2 }
  }
}
```

### `knowledge_and_ai`

```json
"knowledge_and_ai": {
  "description": "AI-powered knowledge management, service definitions, and extensibility.",
  "endpoints": {
    "packages":   { "method": "CRUD", "url": "/v1/packages", "description": "Knowledge packages — import, clone, export, link, review", "tier": 1 },
    "cortex":     { "method": "CRUD", "url": "/v1/cortex", "description": "AI backbone extensions with schemas, prompts, ontologies", "tier": 1 },
    "csm":        { "method": "CRUD", "url": "/v1/csm", "description": "Community Service Manifests — service definitions and data rules", "tier": 1 },
    "msm":        { "method": "CRUD", "url": "/v1/msm", "description": "Machine Service Manifests — AI-consumable API integrations", "tier": 1 },
    "prompts":    { "method": "GET", "url": "/v1/prompts/:tier", "description": "Tier-specific system prompts for AI agents", "tier": 0 },
    "extensions": { "method": "CRUD", "url": "/v1/extensions", "description": "Operator-installed extensions with sandboxed execution", "tier": 2 }
  }
}
```

### `communication_and_social`

```json
"communication_and_social": {
  "description": "Real-time communication, social features, and notifications.",
  "endpoints": {
    "boards":         { "method": "GET/POST", "url": "/v1/boards", "description": "Discussion boards and notifications", "tier": 0 },
    "chat_instances": { "method": "CRUD", "url": "/v1/chat-instances", "description": "AI chat session tracking", "tier": 1 },
    "realtime":       { "method": "CRUD", "url": "/v1/realtime/rooms", "description": "WebRTC rooms for peer-to-peer audio/video", "tier": 1 },
    "push":           { "method": "POST", "url": "/v1/push/subscribe", "description": "Web Push notifications (VAPID)", "tier": 1 },
    "matches":        { "method": "GET/POST", "url": "/v1/matches", "description": "AI-generated match suggestions with consent", "tier": 1 },
    "flags":          { "method": "POST", "url": "/v1/flags", "description": "Content moderation flags and appeals", "tier": 1 }
  }
}
```

### `commerce`

```json
"commerce": {
  "description": "Morsel-based marketplace for apps and services.",
  "endpoints": {
    "marketplace_purchase": { "method": "POST", "url": "/v1/marketplace/purchase", "description": "Purchase apps/services with morsels", "tier": 1 },
    "marketplace_sales":    { "method": "GET", "url": "/v1/marketplace/sales", "description": "View your sales", "tier": 1 },
    "license_check":        { "method": "GET", "url": "/v1/marketplace/license-check", "description": "Verify purchase license", "tier": 1 }
  }
}
```

### `discovery_and_meta`

```json
"discovery_and_meta": {
  "description": "API documentation, node discovery, statistics, and meta endpoints.",
  "endpoints": {
    "spec":       { "method": "GET", "url": "/v1/spec", "description": "OpenAPI 3.1 specification", "tier": 0 },
    "docs":       { "method": "GET", "url": "/v1/docs", "description": "Human-readable API docs (Swagger UI)", "tier": 0 },
    "health":     { "method": "GET", "url": "/v1/health", "description": "Node health and subsystem status", "tier": 0 },
    "stats":      { "method": "GET", "url": "/v1/stats", "description": "System statistics", "tier": 0 },
    "federation": { "method": "GET", "url": "/v1/federation/directory", "description": "Federated peer directory", "tier": 1 },
    "wellknown":  { "method": "GET", "url": "/.well-known/aimeat", "description": "Node discovery (RFC 5785)", "tier": 0 },
    "apps":       { "method": "GET", "url": "/v1/apps", "description": "Downloadable apps directory", "tier": 0 },
    "libs":       { "method": "GET", "url": "/v1/libs", "description": "JavaScript helper libraries", "tier": 0 },
    "site":       { "method": "GET", "url": "/v1/site", "description": "Site metadata and templates", "tier": 0 },
    "portfolio":  { "method": "GET", "url": "/v1/portfolio/catalog", "description": "User portfolio showcase", "tier": 0 },
    "profile":    { "method": "GET", "url": "/v1/profile", "description": "User profile page", "tier": 0 },
    "validate":   { "method": "POST", "url": "/v1/validate", "description": "Request body validation", "tier": 1 }
  }
}
```

### `hints` Array

```json
"hints": [
  { "description": "Start here — follow getting_started to connect", "method": "GET", "url": "/" },
  { "description": "Human-facing portal for registration", "method": "GET", "url": "/v1/portal" },
  { "description": "Browse the action catalogue", "method": "GET", "url": "/v1/catalogue" },
  { "description": "OpenAPI specification", "method": "GET", "url": "/v1/spec" },
  { "description": "Node discovery", "method": "GET", "url": "/.well-known/aimeat" }
]
```

### Conditional Sections

- `step_2b_anonymous` in `getting_started` — only included when `config.anonymous === true`
- `personal_nodes` — only included when `config.personalNodesEnabled === true` (same as today)

---

## Connectivity Key Feature

### Overview

Extends the existing OTK (One-Time Key) system with a new action type `register_agent`. No new storage tables needed.

### New Endpoints

#### `POST /v1/auth/connectivity-key` (requires owner auth)

Owner generates a connectivity key from their profile page.

- Creates an OTK with `action: 'register_agent'`, `initial: true` (dormant — no expiry until first use)
- Params store: `{ owner, agent_name?, description? }`
- Returns the key + usage instructions

#### `POST /v1/agents/connect` (no auth required)

Agent redeems a connectivity key to register itself.

- Validates and consumes the OTK
- Creates agent under the owner with generated Ed25519 keypair
- Returns: GAII, private key, public key
- Agent uses credentials to authenticate via `POST /v1/auth/token`

### Storage Changes

The OTK `action` field already supports multiple values. Add `'register_agent'` as a valid action alongside `'write_memory'`, `'post_board'`, `'initial'`, `'session'`.

### Profile Page UI

Add to the Agents section of profile.html:
- "Generate Connectivity Key" button
- Modal: optional agent name + description
- Display: key with copy button + sharing instructions

---

## Files to Modify

| File | Change |
|------|--------|
| `src/routes/bootstrap.ts` | Complete rewrite of root JSON structure |
| `src/routes/auth.ts` | New `POST /v1/auth/connectivity-key` endpoint |
| `src/routes/agents.ts` | New `POST /v1/agents/connect` endpoint |
| `public/profile.html` | "Generate Connectivity Key" button + modal |
| `locales/en.json` | Translation keys for connectivity key UI |
| `locales/fi.json` | Finnish translations |
| `openapi.yaml` | Document new endpoints |

## Removed from Root JSON

| Old field | Disposition |
|-----------|-------------|
| `capabilities` array | Replaced by category sections |
| `tiers` object | Integrated into `getting_started` context |
| `agent_guide` | Replaced by `getting_started` flow |
| `micro_memory_guide` | Moved to `core_system` or available via `GET /v1/mm/help` |
| Flat `endpoints` map | Replaced by categorized endpoint maps |
