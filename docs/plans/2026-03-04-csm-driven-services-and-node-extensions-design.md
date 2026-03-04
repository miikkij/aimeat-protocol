# CSM-Driven Services & Node Extension System — Design Document

*2026-03-04 — Architecture for making marketplace, organisms, and workspaces CSM-driven with a sandboxed V8 extension system for server-side behavior plugins*

---

## 1. Problem Statement

The AIMEAT backend currently has **1,540 lines of hardcoded service-specific routes** that violate the founding architecture principle:

> *"AIMEAT = infrastruktuuri. Kaikki muu rakennetaan naiden paalle, ei sisaan."*
> (Everything else is built ON TOP, not BUILT IN.)

| File | Lines | What it does | Should be |
|------|-------|-------------|-----------|
| `src/routes/marketplace.ts` | 385 | 10 marketplace-specific endpoints | CSM template + Extension |
| `src/services/marketplace.ts` | 283 | Escrow, purchase, rating logic | Extension (V8 sandbox) |
| `src/routes/organisms.ts` | 873 | 12 organism-specific endpoints | CSM template + Extension |
| **Total** | **1,541** | Hardcoded service logic | **Removed** |

The `docs/core-vs-ecosystem-analysis.md` (2026-02-27) explicitly classifies marketplace as an **ecosystem application**, not core infrastructure. The SSR removal (2026-03-03) corrected 9,000 lines of HTML rendering violations. This design corrects the remaining backend violations.

---

## 2. Architecture: Three Manifest Systems + Extensions

AIMEAT has four layers of service definition:

```
Layer 4: Cortex        Frontend libraries for AI Chat (user-generated, no server code)
Layer 3: Extensions    Server-side JavaScript plugins (V8 isolate, operator-installed)
Layer 2: MSM           External API descriptions (AI reads -> builds integrations)
Layer 1: CSM           Internal data shape + rules (AI reads -> builds UI -> generic APIs)
Layer 0: Core          Generic APIs (memory, wallet, boards, consent, directory, flags, auth, trust)
```

### 2.1 CSM — Community Service Manifest (data shape)

**Purpose:** Defines the DATA SHAPE + RULES for a community service on this node.

**Scope:**
- Schema fields, types, validation constraints
- Consent requirements (visibility, purpose, retention)
- Moderation policy (flags, auto-hide threshold, appeals)
- UI rendering hints (list/detail views, search fields, sort options)
- Semantic annotations (schema.org JSON-LD)

**How it works:**
1. Operator writes a CSM YAML (e.g., `marketplace.csm.yaml`)
2. Registers it: `POST /v1/csm` -> auto-creates JSON Schema Lock
3. AI Chat reads it: `GET /v1/csm/{name}` -> knows all fields, types, constraints
4. AI builds forms, validates input, renders lists based on `ui_hints`
5. AI writes data to generic memory API: `POST /v1/memory`
6. Schema Locking validates against CSM -> rejects invalid data
7. No server-side business logic needed — CSM + generic APIs handle everything

**Handles ~70% of marketplace/organisms:** Data CRUD, browsing, searching, consent, moderation, flagging, directory indexing.

**Does NOT handle:** Business logic (escrow, purchase workflows, ratings, group membership, join policies).

### 2.2 MSM — Machine Service Manifest (external APIs)

**Purpose:** Describes an EXTERNAL API so AI agents can build permanent automations.

**Scope:** Auth method, action endpoints, input/output field mapping, pricing, health checks.

**Key principle:** *"AI reads the MSM once, builds the integration code, tests it, and then the automation runs on its own — without AI in the loop. AI is the builder, not the runtime caller."*

**Examples:** Stripe payments, OpenWeather, Nuki smart lock, Wolt restaurant API.

**MSM is outward-facing** — it describes how to talk to external systems, not how the node behaves internally.

### 2.3 Node Extensions — Server-Side Behavior Plugins (the missing layer)

**Purpose:** Add domain-specific BEHAVIOR to a node that CSM alone cannot express.

**Scope:** Escrow hold/release, state machines, group membership with join policies, rating + trust score adjustment, any workflow logic that requires server-side validation.

**Why server-side:** Payment operations (escrow hold/release) MUST be atomic and validated on the server. Clients cannot be trusted to correctly handle financial state transitions.

**Why extensions (not core):** These behaviors are domain-specific. Not every node needs marketplace escrow or group membership. Nodes that provide these capabilities advertise them via federation, and other nodes route requests accordingly.

### 2.4 Cortex — Frontend Libraries for AI Chat (separate system)

**Purpose:** User-generated libraries that make AI Chat more capable — prompts, templates, component libraries, example data.

**Scope:** Frontend/AI Chat only. No server-side code execution. Defined in REQ-005.

**NOT the extension system.** Cortex and Node Extensions are separate systems with different purposes, security models, and installation flows.

---

## 3. Node Extension System — Detailed Design

### 3.1 Extension Package Format

```
marketplace-behaviors/
  extension.yaml      # Manifest: name, version, actions, required APIs
  actions/
    purchase.js       # V8 isolate action: escrow hold + state change
    deliver.js        # V8 isolate action: escrow release
    rate.js           # V8 isolate action: trust score adjustment
  README.md           # Installation and configuration guide
```

### 3.2 Extension Manifest (`extension.yaml`)

```yaml
extension: "1.0"

metadata:
  name: "marketplace-behaviors"
  version: "1.0.0"
  description: "Purchase workflow with escrow, delivery confirmation, and ratings"
  author: "aimeat-core"
  license: "MIT"
  aimeat: ">=1.5"

# What AIMEAT APIs this extension needs access to (allowlist)
required_apis:
  - wallet       # hold, release, transfer, getBalance
  - memory       # get, set, search
  - consent      # check, require
  - trust        # adjust

# Actions this extension provides (become API endpoints)
actions:
  - id: purchase
    description: "Purchase a listing with morsel escrow"
    method: POST
    path: "/v1/ext/marketplace-behaviors/purchase"
    auth: required
    input:
      listingKey:
        type: string
        required: true
        description: "Memory key of the listing to purchase"
    output:
      purchaseId:
        type: string
      status:
        type: string
        enum: [purchased]
    script: "actions/purchase.js"

  - id: deliver
    description: "Confirm delivery and release escrow to seller"
    method: POST
    path: "/v1/ext/marketplace-behaviors/deliver"
    auth: required
    input:
      purchaseId:
        type: string
        required: true
    output:
      status:
        type: string
        enum: [delivered]
    script: "actions/deliver.js"

  - id: rate
    description: "Rate a completed purchase (1-5 stars)"
    method: POST
    path: "/v1/ext/marketplace-behaviors/rate"
    auth: required
    input:
      purchaseId:
        type: string
        required: true
      score:
        type: integer
        min: 1
        max: 5
      comment:
        type: string
        max: 500
    output:
      rated:
        type: boolean
    script: "actions/rate.js"

# V8 isolate resource limits
limits:
  memory_mb: 64
  timeout_ms: 5000
  max_api_calls: 50

# Configuration options (operator can set via env vars or admin dashboard)
config:
  listing_fee_morsels:
    type: integer
    default: 2
    description: "Fee charged to create a listing"
  transaction_fee_percent:
    type: integer
    default: 5
    description: "Percentage fee on each transaction"
  escrow_enabled:
    type: boolean
    default: true
    description: "Whether to hold funds in escrow during purchase"

# Federation capability advertisement
federation:
  advertise: true
  capabilities:
    - "escrow"
    - "purchase-workflow"
    - "ratings"
```

### 3.3 V8 Isolate Sandbox API

Each extension action receives a `ctx` object — the ONLY way to interact with the AIMEAT node:

```javascript
// ctx object available in every extension action
ctx = {
  // Memory operations (scoped to caller's accessible namespaces)
  memory: {
    get(key): Promise<any | null>,
    set(key, value): Promise<void>,
    search(prefix, opts?): Promise<Array<{ key: string, value: any }>>,
    delete(key): Promise<boolean>,
  },

  // Wallet operations (scoped to caller's wallet)
  wallet: {
    hold(from, amount, reason): Promise<{ holdId: string }>,
    release(holdId, to): Promise<void>,
    transfer(from, to, amount, reason): Promise<void>,
    getBalance(gaii): Promise<number>,
  },

  // Consent checks
  consent: {
    check(gaii, scope): Promise<boolean>,
    require(gaii, scope): Promise<void>,  // throws CONSENT_REQUIRED if missing
  },

  // Trust score adjustments
  trust: {
    adjust(gaii, delta, reason): Promise<void>,
  },

  // Caller info (from JWT auth)
  caller: {
    gaii: string,        // Caller's GAII
    owner: string,       // Owner name
    roles: string[],     // ['owner'] or ['agent'] etc.
  },

  // Extension configuration (from config section + operator overrides)
  config: Record<string, unknown>,

  // Structured logging (no console.log)
  log: {
    info(msg: string, data?: Record<string, unknown>): void,
    warn(msg: string, data?: Record<string, unknown>): void,
    error(msg: string, data?: Record<string, unknown>): void,
  },
};
```

**What is NOT available in the sandbox:**
- `require()` / `import` — no npm packages
- `fetch()` / `http` — no network access (use MSM for external APIs)
- `fs` — no filesystem access
- `process` — no Node.js process info
- `setTimeout` / `setInterval` — no timers
- `eval()` / `Function()` — no dynamic code execution

### 3.4 Extension Lifecycle

```
Install -> Inactive -> Active -> Deactivating -> Inactive -> Uninstall
                         |                                      |
                         +-- Extensions register /v1/ext/ routes
                         +-- Federation advertises capabilities
```

**API endpoints for managing extensions:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/extensions` | Public | List installed extensions with status |
| POST | `/v1/extensions` | Operator | Install extension from YAML + JS bundle |
| GET | `/v1/extensions/:name` | Public | Get extension detail + actions |
| DELETE | `/v1/extensions/:name` | Operator | Uninstall extension |
| POST | `/v1/extensions/:name/activate` | Operator | Activate (registers endpoints) |
| POST | `/v1/extensions/:name/deactivate` | Operator | Deactivate (removes endpoints) |

### 3.5 Extension Registration in Storage

```typescript
export interface ExtensionRecord {
  name: string;                        // Unique name (e.g., "marketplace-behaviors")
  version: string;
  description: string;
  author: string;
  status: 'inactive' | 'active';
  requiredApis: string[];              // ['wallet', 'memory', 'consent', 'trust']
  actions: Array<{
    id: string;
    method: string;
    path: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    scriptContent: string;             // Actual JS code stored in record
  }>;
  config: Record<string, unknown>;     // Operator configuration overrides
  limits: {
    memoryMb: number;
    timeoutMs: number;
    maxApiCalls: number;
  };
  federation: {
    advertise: boolean;
    capabilities: string[];
  };
  installedBy: string;
  installedAt: string;
  activatedAt?: string;
}
```

### 3.6 Federation Capability Routing

When an extension has `federation.advertise: true`:

1. The node includes its extension capabilities in federation heartbeats
2. Other nodes learn: "node-fi-001 has `escrow`, `purchase-workflow`, `ratings`"
3. When a client on a node WITHOUT the extension needs marketplace purchase:
   - Client calls `GET /v1/federation/capabilities?need=escrow`
   - Gets back list of nodes with that capability
   - Client calls the capable node's `/v1/ext/marketplace-behaviors/purchase` endpoint
4. This enables organic capability distribution across the federation

---

## 4. Example: Marketplace as CSM + Extension

### 4.1 Current State (to be removed)

| File | Lines | Responsibility |
|------|-------|---------------|
| `src/routes/marketplace.ts` | 385 | 10 hardcoded endpoints |
| `src/services/marketplace.ts` | 283 | Escrow, purchase, rating business logic |
| `ListingRecord` in interface.ts | ~30 | Dedicated storage type |
| `PurchaseRecord` in interface.ts | ~30 | Dedicated storage type |

### 4.2 New State (CSM + Extension)

**CSM template** (`marketplace.csm.yaml` — already exists):
- Defines listing data schema (title, price, category, images, etc.)
- Schema Locking validates all writes to `marketplace.listings.*`
- Consent: federation visibility, requires consent
- Moderation: flags enabled, auto-hide at 3
- UI hints: list/detail views, search fields, sort options

**Extension** (`marketplace-behaviors` — new):

**`actions/purchase.js`:**
```javascript
export default async function(ctx, input) {
  // 1. Read the listing from memory
  const listing = await ctx.memory.get(input.listingKey);
  if (!listing) throw new Error('Listing not found');
  if (listing.status && listing.status !== 'active') {
    throw new Error('Listing not available');
  }

  // 2. Verify buyer has marketplace consent
  await ctx.consent.require(ctx.caller.gaii, 'marketplace-listing');

  // 3. Calculate total with transaction fee
  const fee = ctx.config.escrow_enabled
    ? Math.ceil(listing.price_morsels * (ctx.config.transaction_fee_percent / 100))
    : 0;
  const total = listing.price_morsels + fee;

  // 4. Hold funds in escrow
  const hold = await ctx.wallet.hold(ctx.caller.gaii, total, 'marketplace_purchase');

  // 5. Create purchase record in memory
  await ctx.memory.set(`marketplace.purchases.${hold.holdId}`, {
    listingKey: input.listingKey,
    buyerGaii: ctx.caller.gaii,
    sellerGaii: listing.seller_ghii,
    price: listing.price_morsels,
    fee: fee,
    status: 'purchased',
    purchasedAt: new Date().toISOString(),
  });

  // 6. Update listing status
  await ctx.memory.set(input.listingKey, { ...listing, status: 'purchased' });

  ctx.log.info('Purchase completed', {
    purchaseId: hold.holdId,
    buyer: ctx.caller.gaii,
    price: listing.price_morsels,
  });

  return { purchaseId: hold.holdId, status: 'purchased' };
}
```

**`actions/deliver.js`:**
```javascript
export default async function(ctx, input) {
  const purchase = await ctx.memory.get(`marketplace.purchases.${input.purchaseId}`);
  if (!purchase) throw new Error('Purchase not found');
  if (purchase.sellerGaii !== ctx.caller.gaii) throw new Error('Only seller can confirm delivery');
  if (purchase.status !== 'purchased') throw new Error('Purchase not in deliverable state');

  // Release escrow to seller (minus fee which is burned)
  await ctx.wallet.release(input.purchaseId, purchase.sellerGaii);

  // Update purchase state
  await ctx.memory.set(`marketplace.purchases.${input.purchaseId}`, {
    ...purchase,
    status: 'delivered',
    deliveredAt: new Date().toISOString(),
  });

  return { status: 'delivered' };
}
```

**`actions/rate.js`:**
```javascript
export default async function(ctx, input) {
  const purchase = await ctx.memory.get(`marketplace.purchases.${input.purchaseId}`);
  if (!purchase) throw new Error('Purchase not found');
  if (purchase.buyerGaii !== ctx.caller.gaii) throw new Error('Only buyer can rate');
  if (purchase.status !== 'delivered') throw new Error('Can only rate delivered purchases');
  if (purchase.rated) throw new Error('Already rated');

  // Adjust seller trust score based on rating
  const delta = input.score >= 3 ? (input.score - 3) * 2 : (input.score - 3) * 3;
  await ctx.trust.adjust(purchase.sellerGaii, delta, 'marketplace_rating');

  // Store rating in memory
  await ctx.memory.set(`marketplace.ratings.${input.purchaseId}`, {
    purchaseId: input.purchaseId,
    buyerGaii: ctx.caller.gaii,
    sellerGaii: purchase.sellerGaii,
    score: input.score,
    comment: input.comment,
    ratedAt: new Date().toISOString(),
  });

  // Mark purchase as rated
  await ctx.memory.set(`marketplace.purchases.${input.purchaseId}`, {
    ...purchase,
    status: 'completed',
    rated: true,
  });

  return { rated: true };
}
```

### 4.3 User Flow (AI Chat builds marketplace)

1. **Operator** installs `marketplace.csm.yaml` and `marketplace-behaviors` extension
2. **AI Chat** reads CSM via `GET /v1/csm/marketplace` -> knows listing schema
3. **Seller** says "I want to sell my bike for 50 morsels"
4. AI builds form from CSM `data_schema`, validates, writes: `POST /v1/memory` with key `marketplace.listings.{uuid}`
5. **Buyer** says "Show me what's for sale"
6. AI calls `GET /v1/memory/search?prefix=marketplace.listings` -> renders based on `ui_hints`
7. **Buyer** says "I want to buy that bike"
8. AI calls `POST /v1/ext/marketplace-behaviors/purchase` -> extension handles escrow
9. **Seller** says "I delivered it"
10. AI calls `POST /v1/ext/marketplace-behaviors/deliver` -> extension releases escrow
11. **Buyer** rates -> AI calls `POST /v1/ext/marketplace-behaviors/rate` -> trust score adjusted

---

## 5. Example: Organisms as CSM + Extension

### 5.1 CSM Template (`organism.csm.yaml` — new)

```yaml
csm: "1.0"

service:
  name: "Organism"
  type: community
  description: "Groups, clubs, teams, cooperatives — organisms that bring people together"
  version: "1.0.0"
  semantic:
    "@context":
      schema: "https://schema.org/"
    "@type": "Organization"

schema_mode: open

data_schema:
  required:
    name:
      type: string
      min: 2
      max: 200
    description:
      type: string
      min: 10
      max: 5000
    type:
      type: string
      enum: ["community", "team", "club", "cooperative", "project"]
    creator_ghii:
      type: string
  optional:
    interests:
      type: array
      items: string
      max: 20
    location:
      type: object
      properties:
        city:
          type: string
        area:
          type: string
          required: false
        country:
          type: string
          required: false
        geo:
          type: array
          items: number
    join_policy:
      type: string
      enum: ["open", "approval_required", "invite_only"]
    max_members:
      type: integer
      min: 2
      max: 10000
    visibility:
      type: string
      enum: ["public", "listed", "private"]
    moderation_config:
      type: object
      properties:
        flags_enabled:
          type: boolean
        auto_hide_threshold:
          type: integer
        appeals_enabled:
          type: boolean

consent_requirements:
  visibility_default: public
  requires_consent: false
  consent_purpose: "organism-participation"
  data_retention: "until_revoked"

moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: true

ui_hints:
  list_view: ["name", "type", "interests", "location.city"]
  detail_view: ["name", "description", "type", "interests", "location", "join_policy", "max_members"]
  search_fields: ["name", "type", "interests", "location.city"]
  sort_options: ["created_at", "name", "type"]
```

### 5.2 Extension (`membership-behaviors` — new)

```yaml
extension: "1.0"

metadata:
  name: "membership-behaviors"
  version: "1.0.0"
  description: "Group membership with join policies, invitations, roles, and workspace RBAC"
  author: "aimeat-core"
  license: "MIT"

required_apis:
  - memory
  - consent
  - trust

actions:
  - id: join
    description: "Join an organism (respects join policy)"
    method: POST
    path: "/v1/ext/membership-behaviors/join"
    auth: required
    input:
      organismKey: { type: string, required: true }
      message: { type: string, max: 500 }
    script: "actions/join.js"

  - id: invite
    description: "Invite someone to join (admin only)"
    method: POST
    path: "/v1/ext/membership-behaviors/invite"
    auth: required
    input:
      organismKey: { type: string, required: true }
      inviteeGhii: { type: string, required: true }
    script: "actions/invite.js"

  - id: leave
    description: "Leave an organism"
    method: POST
    path: "/v1/ext/membership-behaviors/leave"
    auth: required
    input:
      organismKey: { type: string, required: true }
    script: "actions/leave.js"

  - id: promote
    description: "Change a member's role (admin only)"
    method: POST
    path: "/v1/ext/membership-behaviors/promote"
    auth: required
    input:
      organismKey: { type: string, required: true }
      memberGhii: { type: string, required: true }
      role: { type: string, enum: [member, admin] }
    script: "actions/promote.js"

  - id: review-request
    description: "Approve or reject a join request (admin only)"
    method: POST
    path: "/v1/ext/membership-behaviors/review-request"
    auth: required
    input:
      organismKey: { type: string, required: true }
      requestId: { type: string, required: true }
      decision: { type: string, enum: [approve, reject] }
    script: "actions/review-request.js"

limits:
  memory_mb: 64
  timeout_ms: 5000
  max_api_calls: 50

federation:
  advertise: true
  capabilities:
    - "membership"
    - "join-policies"
    - "workspace-rbac"
```

---

## 6. What Gets Removed vs What Stays

### Removed (hardcoded service logic)

| File | Lines | Replaced By |
|------|-------|-------------|
| `src/routes/marketplace.ts` | 385 | CSM template + marketplace-behaviors extension |
| `src/services/marketplace.ts` | 283 | Extension actions (purchase.js, deliver.js, rate.js) |
| `src/routes/organisms.ts` | 873 | CSM template + membership-behaviors extension |
| **Total removed** | **1,541** | |

### Stays (generic infrastructure)

| File | Lines | Reason |
|------|-------|--------|
| `src/middleware/workspace-access.ts` | 138 | Already generic middleware, may be absorbed into membership extension |
| `src/services/matching.ts` | 403 | Generic matching engine (works for any profile type) |
| `src/routes/matches.ts` | 195 | Generic matching endpoints |
| `src/services/directory.ts` | 392 | Generic directory (already indexes organisms from memory) |
| All other core routes | — | Memory, wallet, consent, boards, flags, etc. — all generic |

### New (extension system infrastructure)

| File | Purpose | Estimated Lines |
|------|---------|----------------|
| `src/services/extension-runtime.ts` | V8 isolate sandbox, action execution | ~300 |
| `src/routes/extensions.ts` | Extension management endpoints | ~200 |
| `src/services/extension-loader.ts` | Parse manifest, validate, install | ~150 |
| `src/storage/interface.ts` changes | `ExtensionRecord` type + methods | ~50 |
| `docs/extensions/marketplace-behaviors/` | Example extension package | ~200 |
| `docs/extensions/membership-behaviors/` | Example extension package | ~250 |
| **Total new** | | **~1,150** |

**Net effect:** 1,541 lines of hardcoded logic -> 1,150 lines of generic extension infrastructure + ~450 lines of example extension code. The infrastructure is REUSABLE for any future extension.

---

## 7. Storage Changes

### Remove dedicated storage types

The following types in `src/storage/interface.ts` become unnecessary because extension data is stored as generic memory entries:

| Type | Lines | Replaced By |
|------|-------|-------------|
| `ListingRecord` | ~30 | Memory entries under `marketplace.listings.*` |
| `PurchaseRecord` | ~30 | Memory entries under `marketplace.purchases.*` |
| `OrganismRecord` | ~30 | Memory entries under `organisms.*` |
| `OrganismMembershipRecord` | ~10 | Memory entries under `organisms.{id}.members.*` |
| `JoinRequestRecord` | ~10 | Memory entries under `organisms.{id}.join-requests.*` |

### Add extension storage

```typescript
// New in interface.ts
export interface ExtensionRecord {
  name: string;
  version: string;
  description: string;
  author: string;
  status: 'inactive' | 'active';
  requiredApis: string[];
  actions: Array<{
    id: string;
    method: string;
    path: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    scriptContent: string;
  }>;
  config: Record<string, unknown>;
  limits: { memoryMb: number; timeoutMs: number; maxApiCalls: number };
  federation: { advertise: boolean; capabilities: string[] };
  installedBy: string;
  installedAt: string;
  activatedAt?: string;
}

// New storage methods
createExtension(record: ExtensionRecord): Promise<ExtensionRecord>;
getExtension(name: string): Promise<ExtensionRecord | null>;
listExtensions(opts?: { status?: string }): Promise<ExtensionRecord[]>;
updateExtension(name: string, updates: Partial<ExtensionRecord>): Promise<ExtensionRecord | null>;
deleteExtension(name: string): Promise<boolean>;
```

---

## 8. Wallet Escrow — Generic Enhancement

The wallet API needs a generic escrow capability (not marketplace-specific) that any extension can use:

```typescript
// New storage methods for generic escrow
export interface EscrowHoldRecord {
  holdId: string;
  fromGaii: string;
  amount: number;
  reason: string;           // Extension-defined reason string
  status: 'held' | 'released' | 'disputed' | 'refunded';
  extensionName: string;    // Which extension created this hold
  createdAt: string;
  releasedAt?: string;
  releasedTo?: string;
}

createEscrowHold(record: EscrowHoldRecord): Promise<EscrowHoldRecord>;
getEscrowHold(holdId: string): Promise<EscrowHoldRecord | null>;
releaseEscrowHold(holdId: string, toGaii: string): Promise<void>;
refundEscrowHold(holdId: string): Promise<void>;
listEscrowHolds(gaii: string, opts?: { status?: string }): Promise<EscrowHoldRecord[]>;
```

This makes escrow a **generic wallet feature** — any extension can hold funds, not just marketplace.

---

## 9. Security Model

### 9.1 V8 Isolate Sandbox

| Threat | Mitigation |
|--------|-----------|
| Infinite loops | `timeout_ms` limit (default 5000ms) |
| Memory exhaustion | `memory_mb` limit (default 64MB) |
| API abuse | `max_api_calls` limit (default 50 per invocation) |
| File system access | V8 isolate has no `fs` module |
| Network access | V8 isolate has no `fetch`/`http` (use MSM for external APIs) |
| Code injection | No `eval()`, `Function()`, or dynamic import |
| Privilege escalation | Extensions only access APIs listed in `required_apis` |
| Cross-extension access | Each extension has its own isolate, no shared state |

### 9.2 API Surface Control

Extensions declare `required_apis` in their manifest. The runtime ONLY provides the declared APIs in the `ctx` object. An extension requesting `wallet` + `memory` cannot access `trust` unless it declares it.

### 9.3 Operator Trust

- Only operators can install/activate extensions
- Extension source code is stored in the ExtensionRecord (auditable)
- Extensions can be deactivated instantly (removes routes, keeps data)
- Federation peers can inspect extension manifests before routing to them

---

## 10. Federation Capability Routing

### 10.1 Capability Advertisement

When an extension with `federation.advertise: true` is active, the node includes its capabilities in federation heartbeats:

```json
{
  "nodeId": "aimeat-fi-001",
  "extensions": [
    {
      "name": "marketplace-behaviors",
      "capabilities": ["escrow", "purchase-workflow", "ratings"],
      "actions": [
        { "id": "purchase", "path": "/v1/ext/marketplace-behaviors/purchase" },
        { "id": "deliver", "path": "/v1/ext/marketplace-behaviors/deliver" },
        { "id": "rate", "path": "/v1/ext/marketplace-behaviors/rate" }
      ]
    }
  ]
}
```

### 10.2 Capability Discovery

```
GET /v1/federation/capabilities?need=escrow
→ Returns list of federation nodes that have escrow capability
```

### 10.3 Cross-Node Extension Calls

A client on a node WITHOUT marketplace extension can:
1. Discover capable nodes: `GET /v1/federation/capabilities?need=purchase-workflow`
2. Call the extension on a capable node directly (with proper auth)
3. Or the node can proxy the request through federation

This enables organic capability distribution — nodes bring their extensions, federation shares them.

---

## 11. Migration Strategy

### Phase 1: Build Extension Runtime
1. Implement V8 isolate sandbox (`isolated-vm` npm package)
2. Implement extension lifecycle (install, activate, deactivate, uninstall)
3. Implement `ctx` API proxy (memory, wallet, consent, trust)
4. Implement extension route registration
5. Add `ExtensionRecord` to storage

### Phase 2: Create Reference Extensions
1. Package `marketplace-behaviors` as first extension
2. Package `membership-behaviors` as second extension
3. Package `organism.csm.yaml` as new CSM template
4. Test extensions against existing marketplace/organism test suites

### Phase 3: Remove Hardcoded Routes
1. Remove `src/routes/marketplace.ts`
2. Remove `src/services/marketplace.ts`
3. Remove `src/routes/organisms.ts`
4. Remove dedicated storage types (ListingRecord, PurchaseRecord, OrganismRecord, etc.)
5. Migrate existing data from dedicated storage to memory entries (if any)

### Phase 4: Federation Integration
1. Add capability advertisement to federation heartbeats
2. Add capability discovery endpoint
3. Add cross-node extension call routing

### Phase 5: Wallet Escrow
1. Add generic EscrowHoldRecord to storage
2. Add escrow endpoints to wallet API
3. Wire escrow into extension sandbox `ctx.wallet`

---

## 12. Success Criteria

1. A developer can create a NEW service (e.g., auction, car rental, event booking) by writing ONLY:
   - A CSM YAML (data shape)
   - An extension YAML + JS (behavior)
   - NO changes to the AIMEAT server code

2. AI Chat can read a CSM and build a functional client app that lists, creates, searches, and manages entries — without knowing anything about the service type in advance.

3. An extension's purchase/escrow workflow works identically whether called from the local node or through federation routing.

4. An operator can disable an extension and all its routes disappear immediately, without affecting stored data.

5. The V8 sandbox prevents all escape attempts — no filesystem, no network, no process access, strict resource limits.

---

*Generated: 2026-03-04*
*References: `docs/core-vs-ecosystem-analysis.md`, `docs/developer-experience-and-agent-ecosystem-plan.md`, `docs/plans/2026-03-03-ssr-removal-design.md`, `docs/csm-spec.md`, `docs/manuals/csm-manual.md`, `docs/requirements/REQ-005-cortex-core-extension-system.md`*
