# Capability Layer Design

**Date:** 2026-05-01
**Status:** Draft
**Scope:** Unified capability abstraction over existing AIMEAT systems

---

## Problem

AIMEAT has 7+ subsystems (extensions, actions, cortex, packages, SDK libraries, MCP tools, apps) that each have their own registration, discovery, and invocation patterns. A developer or AI building an app must know which subsystem to use and how each one works. There is no single place that answers "what can this node do?"

## Solution

Add a **Capability** abstraction layer on top of existing systems. It provides:

1. **Unified discovery** -- one endpoint returns everything the node can do
2. **Unified invocation** -- callable capabilities use one `invoke()` interface regardless of whether the underlying system is an extension, action, or manual handler
3. **Self-describing metadata** -- full JSON Schema for input/output, usage examples, "when to use" guidance, cost information
4. **Visibility and ownership** -- users create and publish capabilities, operators oversee all

Existing systems are not modified. This is purely additive.

---

## 1. Data Model

### CapabilityRecord

```typescript
interface CapabilityRecord {
  id: string;                    // unique, e.g. "weather-fi" or auto: "ext:ilmatiede:get-weather"
  name: string;                  // human-readable name
  summary: string;               // short description for humans

  // Ownership and visibility
  ownerGhii: string;             // who created/owns this
  visibility: 'private' | 'owner' | 'public';
  scope: 'local';                // federation scope added later ('local' | 'federation')
  status: 'draft' | 'pending_review' | 'active' | 'deprecated' | 'rejected' | 'disabled';
  rejectionReason: string | null;    // operator's reason when status = 'rejected'
  deprecationMessage: string | null; // reason/migration guide when status = 'deprecated'
  replacedBy: string | null;         // capability ID of the successor, if deprecated

  // Source tracking (what underlying system provides this)
  source: {
    type: 'extension' | 'action' | 'cortex' | 'app' | 'manual';
    ref: string;                 // e.g. "ext:ilmatiede:get-weather", "action:gaii:translate", "manual"
    version: string;             // tracks source version for change detection
  };
  // Note: SDK libraries are NOT aggregated as capabilities. They are
  // documented in llms.txt and GET /v1/libs. Adding them here would
  // add noise without value since they are not callable or discoverable
  // in the same way as extensions and actions.

  // Auth requirement
  authRequired: 'none' | 'anonymous' | 'registered';

  // Callable = can be invoked via POST /v1/capabilities/:id/invoke
  // Only extensions (sync) and manual webhooks (sync) are callable.
  // Actions are discovery-only: they appear in the list so you know
  // they exist, but invocation goes through the work queue API which
  // is an async business process (request -> accept -> deliver -> rate).
  callable: boolean;

  // Full schemas (never abbreviated, always complete JSON Schema)
  inputSchema: JSONSchema | null;
  outputSchema: JSONSchema | null;

  // Usage guidance
  usage: string;                 // code example for callable: "await AIMEAT.capabilities.invoke('weather-fi', { city: 'Helsinki' })"
                                 // for non-callable: "Use the work queue: POST /v1/work/request with { action_id: 'translate', ... }"
  whenToUse: string;             // "Use when your app needs weather data for Finland"
  whenNotToUse: string;          // "Not for real-time tracking, data updates every 10min"
  examples: Array<{
    description: string;
    input: object;
    output: object;
  }>;

  // For loadable capabilities (cortex): what functions/classes does the library expose?
  // This tells AI exactly what code it can write after loading the library.
  exports: Array<{
    name: string;                // function or class name, e.g. "applyBevel"
    description: string;         // what it does
    inputSchema: JSONSchema;     // what it accepts (full schema, never abbreviated)
    outputSchema: JSONSchema;    // what it returns (full schema)
    example: { input: object; output: object } | null;
  }> | null;                     // null for callable/discoverable capabilities (they use top-level inputSchema/outputSchema)

  // Dependencies: what other capabilities or SDK libraries must be loaded first
  dependencies: Array<{
    type: 'sdk' | 'capability';
    id: string;                  // e.g. "aimeat-data", "cortex:aimeat-canvas", "ext:physics:collider"
    required: boolean;           // true = must have, false = optional enhancement
    minVersion: string | null;   // semver constraint, e.g. ">=1.2.0". null = any version.
  }>;
  // Schema change detection: hash of inputSchema + outputSchema.
  // When this changes, dependent capabilities are notified.
  schemaHash: string;            // SHA-256 of JSON.stringify(inputSchema) + JSON.stringify(outputSchema)
  // Load order: dependencies must be loaded before this capability.
  // The SDK library / app template should load in this order:
  // 1. aimeat-auth.js (always first)
  // 2. SDK dependencies (aimeat-data, aimeat-storage, etc.)
  // 3. Capability dependencies (other cortex modules, etc.)
  // 4. This capability's library

  // Manual source invocation target (only for source.type === 'manual' && callable === true)
  webhookUrl: string | null;     // HTTP POST target, must accept { input } and return { result }
                                 // Domain must be on operator's allowlist if node.capabilities.webhooks === 'allowlist_only'

  // Economy and trust
  cost: { morsels: number; perUnit?: string } | null;
  trustRequired: number | null;

  // Trust signals (builds over time, helps users evaluate safety)
  trust: {
    operatorReviewed: boolean;   // operator has explicitly reviewed and approved
    reviewedAt: string | null;
    vouchCount: number;          // number of users who vouched for this capability
    publisherTrustScore: number; // owner's trust score at time of last review
    codeAudited: boolean;        // operator has audited the source code
    auditNotes: string | null;   // operator's audit notes (visible to users)
  };

  // Privacy: which input fields contain sensitive data and should not be logged
  redactedFields: string[];      // JSON paths to redact in logs, e.g. ["text", "personal.email"]
                                 // When set, CapabilityLogEntry.input stores redacted copy
                                 // When empty, full input is logged (default for non-sensitive capabilities)

  // Operator override (enrichment without modifying the source system)
  operatorOverride: {
    summary?: string;
    visibility?: 'private' | 'owner' | 'public';
    disabled?: boolean;
    notes?: string;              // internal operator note, not shown to users
  } | null;

  // Runtime statistics (collected by invoke proxy)
  stats: {
    totalInvocations: number;
    successCount: number;
    errorCount: number;
    lastInvokedAt: string | null;
    avgResponseMs: number;
    lastError: string | null;
  };

  tags: string[];
  createdAt: string;
  updatedAt: string;
}
```

### Visibility model

Same two-dimensional model as memory and consent:

- **visibility**: who can see and use the capability
  - `private` -- only the owner and their agents
  - `owner` -- same as private (reserved for future agent-level scoping)
  - `public` -- all users on this node
- **scope**: where it is visible
  - `local` -- this node only (default, the only option in v1)
  - `federation` -- visible to peering nodes (future, not implemented in v1)

Operators can see ALL capabilities regardless of visibility in the admin dashboard.
Operators can override visibility (e.g. force a public capability to disabled).

### authRequired levels

| Level | Means | Token needed | Example capabilities |
|-------|-------|-------------|---------------------|
| `none` | No authentication | None | Catalogue search, public board reading, stats |
| `anonymous` | Anonymous token sufficient | `POST /v1/auth/anonymous` | Memory read/write in anonymous.* namespace, storage |
| `registered` | GHII account required | Login via aimeat-auth.js | Extensions, work queue, private memory, wallet, realtime |

The invoke proxy checks this before forwarding to the underlying system. Clear error messages guide the user to the right auth path.

---

## 2. REST API

### Discovery (Tier 0 for public capabilities)

```
GET /v1/capabilities
  Query: ?search=weather&tags=finland&callable=true&authRequired=anonymous&source_type=extension&page=1&per_page=20
  Response 200: {
    "ok": true,
    "data": {
      "capabilities": [
        {
          "id": "weather-fi",
          "name": "Weather Finland",
          "summary": "Weather and pollen data for Finnish cities",
          "source": { "type": "extension", "ref": "ext:ilmatiede:get-weather" },
          "callable": true,
          "authRequired": "registered",
          "cost": { "morsels": 0 },
          "tags": ["weather", "finland", "pollen"],
          "stats": { "totalInvocations": 1423, "successCount": 1401, "errorCount": 22 }
        }
      ],
      "total": 1
    }
  }

GET /v1/capabilities/:id
  Response 200: {
    "ok": true,
    "data": {
      "id": "weather-fi",
      "name": "Weather Finland",
      "summary": "Weather and pollen data for Finnish cities",
      "source": { "type": "extension", "ref": "ext:ilmatiede:get-weather" },
      "callable": true,
      "authRequired": "registered",
      "inputSchema": {
        "type": "object",
        "properties": {
          "city": { "type": "string", "description": "Finnish city name" },
          "include_pollen": { "type": "boolean", "default": true }
        },
        "required": ["city"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "temperature": { "type": "number", "description": "Temperature in Celsius" },
          "humidity": { "type": "number", "description": "Humidity percentage 0-100" },
          "wind_speed": { "type": "number", "description": "Wind speed in m/s" },
          "pollen": {
            "type": "object",
            "properties": {
              "birch": { "type": "string", "enum": ["none", "low", "moderate", "high", "very_high"] },
              "grass": { "type": "string", "enum": ["none", "low", "moderate", "high", "very_high"] },
              "source": { "type": "string", "description": "Data source (e.g. Turun yliopisto)" },
              "date": { "type": "string", "format": "date" }
            }
          }
        }
      },
      "usage": "const weather = await AIMEAT.capabilities.invoke('weather-fi', { city: 'Helsinki' });",
      "whenToUse": "Use when your app needs current weather or pollen data for Finnish cities.",
      "whenNotToUse": "Not suitable for real-time weather tracking. Data updates every 10 minutes.",
      "examples": [
        {
          "description": "Get weather for Helsinki with pollen",
          "input": { "city": "Helsinki", "include_pollen": true },
          "output": { "temperature": 12, "humidity": 67, "wind_speed": 3, "pollen": { "birch": "moderate", "grass": "none", "source": "Turun yliopisto", "date": "2026-04-30" } }
        }
      ],
      "cost": { "morsels": 0 },
      "tags": ["weather", "finland", "pollen"],
      "stats": { "totalInvocations": 1423, "successCount": 1401, "errorCount": 22, "lastInvokedAt": "2026-04-30T14:22:00Z", "avgResponseMs": 245, "lastError": null }
    }
  }
```

### Invocation (Tier 1, auth required for most)

```
POST /v1/capabilities/:id/invoke
  Authorization: Bearer <jwt>
  Body: { "input": { "city": "Helsinki" } }
  Query: ?mode=raw (optional, returns underlying system's raw response)

  Response 200 (normal mode, normalized):
  {
    "ok": true,
    "data": {
      "capability": "weather-fi",
      "result": { "temperature": 12, "humidity": 67, "wind_speed": 3, "pollen": { ... } },
      "duration_ms": 230,
      "source": { "type": "extension", "ref": "ext:ilmatiede:get-weather" }
    }
  }

  Response 200 (raw mode):
  {
    "ok": true,
    "data": {
      "capability": "weather-fi",
      "mode": "raw",
      "raw_response": { ... original extension/action response ... },
      "duration_ms": 230
    }
  }

  Response 401 (auth insufficient):
  {
    "ok": false,
    "error": {
      "code": "AUTH_REQUIRED",
      "message": "This capability requires a registered account. Register at /v1/portal or use the login bar in your app."
    }
  }

  Response 400 (not callable):
  {
    "ok": false,
    "error": {
      "code": "NOT_CALLABLE",
      "message": "This capability is not directly callable. Use it via the SDK: await AIMEAT.data.get('key')"
    }
  }
```

### Invoke proxy routing

The proxy determines where to forward based on `source.type`.

| source.type | callable | Invoke behavior | Who can invoke |
|-------------|----------|----------------|----------------|
| `extension` | true | `POST /v1/ext/:extName/:actionId` | Everyone (server-side WASM sandbox) |
| `manual` | true | HTTP POST to `webhookUrl` | Everyone (server-side HTTP call) |
| `cortex` | true | Client-side JS execution | Browser apps only (via SDK) |
| `action` | false | Returns 400 NOT_CALLABLE | N/A, use work queue API |
| `app` | false | Returns 400 NOT_CALLABLE | N/A, access via download URL |

### Cortex invoke: browser-only

**IMPORTANT: Cortex modules are browser-only by design.** The AIMEAT
architecture explicitly states "No server-side execution" for cortex.
Cortex code uses browser APIs (DOM, fetch, localStorage) and SDK
libraries (AIMEAT.data, AIMEAT.storage) that are browser-side.

**Browser invoke (via SDK):**

When `AIMEAT.capabilities.invoke('cortex:recipe-manager:search', { query: 'pasta' })`
is called from a browser app:

1. SDK checks: this is a cortex capability with exports
2. SDK loads the cortex library if not already loaded (via loadScript)
3. SDK calls the exported function directly in the browser
4. SDK returns the result

No server round-trip. The cortex code runs in the user's browser
with access to AIMEAT.data, AIMEAT.storage, etc. through the
already-loaded SDK libraries.

**API/MCP callers (agents):**

When `POST /v1/capabilities/:id/invoke` is called from an API client
or MCP tool for a cortex capability, the server returns:

```json
{
  "ok": false,
  "error": {
    "code": "BROWSER_ONLY",
    "message": "This capability is browser-only. Use it in an AIMEAT app, not via API."
  }
}
```

MCP tool `aimeat_capabilities_invoke` returns the same error for cortex.
The capability metadata (exports, schemas, examples) is still fully
visible via `aimeat_capabilities_get` so the agent knows what the
cortex does, even if it cannot invoke it directly.

### What agents use vs what apps use

| Feature | Browser apps (GHII) | AI agents (GAII) |
|---------|--------------------|--------------------|
| Memory, Storage, Boards | SDK libraries (AIMEAT.data, etc.) | REST API (/v1/memory, etc.) |
| Extensions | Capability invoke (via SDK) | Capability invoke (via API/MCP) |
| Manual webhooks | Capability invoke (via SDK) | Capability invoke (via API/MCP) |
| Cortex modules | Capability invoke (via SDK) or loadScript | NOT available, browser-only |
| Actions (work queue) | REST API or AIMEAT.work SDK | REST API or MCP tools |
| Realtime P2P | AimeatRealtime (browser WebSocket) | NOT available, browser-only |

Agents operate through the REST API and MCP tools. They can invoke
extensions and manual webhooks through the capability layer, and use
memory/storage/boards/work through the existing API. They do not use
browser-only features (cortex, realtime P2P, SDK libraries).

### Direct use still available

For browser apps, the invoke interface is the **recommended** way to
use capabilities. But direct use remains available for more control:

```javascript
// Option A: Smart invoke (recommended)
const result = await AIMEAT.capabilities.invoke('cortex:recipe-manager:search', { query: 'pasta' });

// Option B: Direct use (more control, browser only)
await loadScript('/v1/cortex/recipe-manager/libs/recipe-manager.js');
const result = await RecipeManager.search({ query: 'pasta' });
```

Option A is simpler. Option B gives access to the full library API
including functions that may not be exposed as capability exports.

### Capability types summary

**Callable everywhere** (invoke via API, MCP, or SDK):
- **Extensions**: Server-side WASM sandbox.
- **Manual webhooks**: Server-side HTTP POST.

**Callable in browser only** (invoke via SDK only):
- **Cortex exports**: Client-side JS in the user's browser. Not available to agents via API/MCP.

**Discoverable only** (not callable, use other APIs):
- **Actions**: Async work queue. Discovery only, invoke via work queue API.
- **Apps**: Discovery only, access via download URL.

**Not aggregated:**
- **SDK libraries**: Infrastructure, always available, documented in /v1/libs.

  Examples of cortex capabilities:
  - `aimeat-charts`: data visualization (bar, line, pie charts)
  - `aimeat-canvas`: drawing utilities and tools
  - A custom "recipe-manager" cortex that handles recipe storage, search, and sharing
  - A "game-engine" cortex that wraps realtime P2P + memory into a game state manager

  When activated on a node, cortex modules:
  - Lock schemas to memory keys (data structure enforcement)
  - Register system prompts (AI guidance for the domain)
  - Serve JavaScript libraries (the actual code apps load)
  - Write seed data (initial content)
  - Register ontologies (concept definitions for AI understanding)

**Discoverable capabilities** (use via other APIs):
- **Actions**: Agent services in the work queue. Async business process
  (request, accept, deliver, rate). The capability entry provides discovery
  and the usage field guides to the work queue API.

### Management (Owner, manages own capabilities)

```
POST /v1/capabilities
  Authorization: Bearer <jwt> (owner role)
  Body: {
    "id": "my-custom-cap",
    "name": "My Custom Capability",
    "summary": "Does something useful",
    "source": { "type": "manual", "ref": "manual" },
    "callable": true,
    "authRequired": "registered",
    "inputSchema": { ... },
    "outputSchema": { ... },
    "usage": "await AIMEAT.capabilities.invoke('my-custom-cap', { ... })",
    "whenToUse": "...",
    "whenNotToUse": "...",
    "examples": [...],
    "visibility": "public",
    "tags": ["custom"]
  }
  Response 201: { "ok": true, "data": { "id": "my-custom-cap", ... } }

PUT /v1/capabilities/:id
  Authorization: Bearer <jwt> (must be owner of capability)
  Body: { partial update fields }
  Response 200: { "ok": true, "data": { ... } }

DELETE /v1/capabilities/:id
  Authorization: Bearer <jwt> (must be owner, only manual source)
  Response 200: { "ok": true, "data": { "deleted": true } }
```

### Operator endpoints

```
GET /v1/admin/capabilities
  Authorization: Bearer <jwt> (operator role)
  Query: ?owner=alice&source_type=extension&status=active&visibility=public
  Response 200: all capabilities, all users, all visibilities

PUT /v1/admin/capabilities/:id/override
  Authorization: Bearer <jwt> (operator role)
  Body: {
    "summary": "Operator-improved description",
    "visibility": "disabled",
    "notes": "Disabled due to excessive errors"
  }
  Response 200: { "ok": true, "data": { ... } }

GET /v1/admin/capabilities/:id/logs
  Authorization: Bearer <jwt> (operator role)
  Query: ?page=1&per_page=50&status=error
  Response 200: {
    "ok": true,
    "data": {
      "logs": [
        {
          "timestamp": "2026-04-30T14:22:00Z",
          "callerGhii": "alice@node-id",
          "input": { "city": "Helsinki" },
          "status": "success",
          "durationMs": 230,
          "error": null
        }
      ],
      "stats": {
        "totalInvocations": 1423,
        "successCount": 1401,
        "errorCount": 22,
        "avgResponseMs": 245,
        "errorRate": 0.015,
        "lastError": "Extension timeout after 5000ms",
        "lastErrorAt": "2026-04-28T09:15:00Z"
      }
    }
  }
```

---

## 3. SDK Library: aimeat-capabilities.js

New browser-side library at `/v1/libs/aimeat-capabilities.js`. Depends on `aimeat-auth.js`.

### API

```javascript
// Discovery
await AIMEAT.capabilities.list()                         // all public capabilities
await AIMEAT.capabilities.list({ callable: true })       // only callable
await AIMEAT.capabilities.list({ authRequired: 'anonymous' })  // anonymous-friendly
await AIMEAT.capabilities.list({ tags: ['weather'] })    // by tag
await AIMEAT.capabilities.list({ source_type: 'extension' })   // by source
await AIMEAT.capabilities.search('weather finland')      // full-text search

await AIMEAT.capabilities.get('weather-fi')              // full detail with schemas + examples

// Invocation (callable capabilities only)
await AIMEAT.capabilities.invoke('weather-fi', { city: 'Helsinki' })
  // Returns: { temperature: 12, humidity: 67, ... }

// Raw mode for debugging
await AIMEAT.capabilities.invoke('weather-fi', { city: 'Helsinki' }, { mode: 'raw' })
  // Returns: original system response without normalization

// Management (own capabilities)
await AIMEAT.capabilities.create({ id: 'my-cap', name: '...', ... })
await AIMEAT.capabilities.update('my-cap', { summary: 'updated' })
await AIMEAT.capabilities.delete('my-cap')

// List own capabilities
await AIMEAT.capabilities.mine()
```

---

## 4. MCP Tools

Three new tools added to the MCP server:

### aimeat_capabilities_list

```
Input: { search?: string, tags?: string[], callable?: boolean, authRequired?: string, source_type?: string }
Output: Array of capability summaries (id, name, summary, callable, authRequired, cost, tags)
```

### aimeat_capabilities_get

```
Input: { id: string }
Output: Full capability detail including inputSchema, outputSchema, examples, usage, whenToUse
```

### aimeat_capabilities_invoke

```
Input: { id: string, input: object, mode?: 'normal' | 'raw' }
Output: Capability result (normalized or raw)
```

This makes Claude Code and Copilot efficient: `list` -> `get` -> `invoke`, all through MCP without manual endpoint knowledge.

---

## 5. Automatic Aggregation

A background job scans existing systems and creates/updates capability records automatically.

### Trigger conditions

- Server startup
- When an extension, action, or cortex is registered, activated, or deactivated
- Periodically (configurable, default 5 minutes)

### Scan logic

```
1. List all active extensions -> create one capability per extension action
   - id: "ext:{extName}:{actionId}"
   - source: { type: "extension", ref: "ext:{extName}:{actionId}", version: extension.version }
   - callable: true
   - authRequired: "registered"
   - inputSchema/outputSchema: from extension manifest action definition
   - summary: from extension description + action description

2. List all published actions -> create one capability per action (DISCOVERY ONLY)
   - id: "action:{providerGaii}:{actionId}"
   - source: { type: "action", ref: "action:{providerGaii}:{actionId}", version: action.updatedAt }
   - callable: false  (actions use the async work queue, not sync invoke)
   - authRequired: "registered"
   - inputSchema/outputSchema: from action record
   - cost: from action pricing
   - usage: "Use the work queue: POST /v1/work/request with { action_id: '...', provider_gaii: '...', input: {...} }"

3. List all active cortex modules -> create one capability per exported function
   - id: "cortex:{name}:{exportName}"  (e.g. "cortex:recipe-manager:search")
   - source: { type: "cortex", ref: "cortex:{name}", version: cortex.version }
   - callable: true
   - exports: populated from cortex manifest lib components + API surface annotations
   - usage: "await AIMEAT.capabilities.invoke('cortex:{name}:{export}', input)"
   - dependencies: from cortex manifest required_apis + lib dependencies
   Note: also create a parent entry "cortex:{name}" (callable: false) that
   lists all exports and serves as an overview of the whole cortex module.

4. SDK libraries are NOT aggregated. They are documented in
   GET /v1/libs and llms.txt. They are infrastructure, not capabilities.

5. Compare with existing capability records:
   - New sources -> create with auto-generated metadata
   - Changed sources (version mismatch) -> update schemas, summary
     (preserve operator overrides and stats)
   - Removed sources -> set status to 'disabled' (preserve stats history)
```

### Version tracking

Each capability stores `source.version` which reflects the version of the
underlying extension, action, or cortex module. The aggregator compares
this on each scan:

- If the source version changed, the capability is updated (schemas,
  descriptions re-read from source). Operator overrides and stats are
  preserved.
- The API response includes `source.version` so consumers can detect
  when a capability's interface has changed.
- Manual capabilities are versioned by the owner via `PUT /v1/capabilities/:id`.

### Testing capabilities before publishing

For manual capabilities with a webhook URL:

```
POST /v1/capabilities/:id/test
  Authorization: Bearer <jwt> (must be owner)
  Body: { "input": { ... test input ... } }
  Response 200: {
    "ok": true,
    "data": {
      "status": "success" | "error",
      "result": { ... },
      "duration_ms": 150,
      "validated": true,  // output matched outputSchema
      "validation_errors": []  // or list of schema violations
    }
  }
```

The test endpoint invokes the webhook but does not record stats or logs.
It also validates the response against `outputSchema` and reports mismatches.
This lets the user verify their webhook works correctly before setting
status to `active`.

Auto-generated capabilities (from extensions/actions) do not need testing
since the underlying systems handle their own validation.

Auto-generated capabilities get `ownerGhii` set to the system/operator identity. Their metadata can be enriched by the operator via override but not deleted manually (they disappear when the underlying system is removed).

---

## 6. UI: Admin Dashboard Capabilities Tab

New tab in the admin dashboard under the Data navigation group.

### List view

- All capabilities from all users, regardless of visibility
- Columns: name, owner, source type, status, visibility, invocations, errors, last invoked
- Filters: source type, status, visibility, owner, authRequired
- Search by name and tags
- Bulk actions: enable/disable selected

### Detail view

- Full metadata display (summary, schemas, examples, whenToUse, whenNotToUse)
- Operator override panel:
  - Override visibility
  - Disable/enable toggle
  - Custom summary override
  - Internal notes (not visible to users)
- Statistics section:
  - Invocations over time (chart)
  - Success rate percentage
  - Average response time
  - Error rate trend
- Error log:
  - Recent errors with timestamps, caller, input data, error message
  - Filterable by date range
- Invocation log:
  - Recent calls with caller, input, duration, result status
  - Paginated, filterable by status (success/error)

---

## 7. UI: Profile Capabilities Tab

New tab in the user profile, showing only the user's own capabilities.

### List view

- Only capabilities where ownerGhii = current user
- Columns: name, source type, status, visibility, invocations, errors
- Actions: create new, edit, delete (manual only), change visibility

### Create new capability

- Manual source: user defines name, summary, schemas, examples, tags
- From existing: select an extension or action they own, auto-populate fields, then enrich

### Edit capability

- Summary, whenToUse, whenNotToUse, examples, tags
- Visibility: private / owner / public
- Status: draft / active / disabled
- Input/output schemas (JSON editor)

### Statistics (simplified)

- Total invocations, success rate, last error
- No access to other users' data

---

## 8. Operator Configuration

Three node-level config settings control who can publish capabilities.

### Publishing policy

```
node.capabilities.publishing = 'disabled' | 'self_only' | 'moderated' | 'open'
```

| Value | Behavior |
|-------|----------|
| `disabled` | Only operator can create capabilities. Aggregator still creates from extensions/actions/cortex automatically. Users cannot create manual capabilities. **Default for new nodes.** |
| `self_only` | Users can create capabilities with `visibility: private` only. Cannot publish `public`. Good for development/sandbox. |
| `moderated` | Users can create public capabilities but they enter `status: pending_review`. Operator approves or rejects. Status becomes `active` or `rejected` (with reason). |
| `open` | Users can publish directly. Operator can still disable via override after the fact. |

### Publisher restrictions

```
node.capabilities.publishers = 'all_users' | 'trusted_only' | 'allowlist'
```

| Value | Behavior |
|-------|----------|
| `all_users` | Any registered user can publish (subject to publishing policy) |
| `trusted_only` | Only users with `trustScore >= node.capabilities.minPublisherTrust` (default: 50) |
| `allowlist` | Only GHII identities explicitly listed in `node.capabilities.publisherAllowlist` |

### Webhook domain control

```
node.capabilities.webhooks = 'disabled' | 'allowlist_only' | 'open'
```

| Value | Behavior |
|-------|----------|
| `disabled` | No manual webhook capabilities allowed. Eliminates the proxy abuse vector entirely. **Default.** |
| `allowlist_only` | Webhook URL domain must be on `node.capabilities.webhookDomainAllowlist`. Operator explicitly permits specific domains. |
| `open` | Any webhook URL accepted. Only for trusted environments. |

This prevents the node from becoming a free traffic forwarder. A public
capability with a webhook the owner controls could make the node an
outbound proxy. Domain allowlisting stops this.

### Moderation flow

When `publishing = 'moderated'`:

1. User creates capability with `visibility: public`
2. System sets `status: pending_review` (not `active`)
3. Capability appears in admin dashboard under "Pending Review" filter
4. Operator reviews: checks code, schemas, webhook URL, description
5. Operator clicks Approve (`status: active`) or Reject (`status: rejected`, adds `rejectionReason`)
6. User sees status in their profile tab:
   - `pending_review`: "Waiting for operator approval"
   - `rejected`: shows operator's reason, user can edit and resubmit
7. Resubmission resets status to `pending_review`

---

## 9. Webhook Security

Manual webhook capabilities are the primary attack surface. Additional
protections beyond the domain allowlist:

### Request limits

The node's existing rate limiting middleware (`rate-limit.ts`) already
handles per-caller rate limiting with role-based multipliers (operator
10x, owner 2x, agent 1x, anonymous 0.5x). Capability invoke endpoints
use this automatically. No new per-caller rate limiting needed.

Additional webhook-specific limits (these are about outbound egress,
which the existing rate limiter does not cover):

| Limit | Default | Why |
|-------|---------|-----|
| Request body size | 1 MB | Prevent oversized payloads to webhook |
| Response body size | 10 MB | Prevent memory exhaustion from large responses |
| Response timeout | 10 seconds | Prevent slow-loris style resource holding |
| Rate limit per webhook domain | 300/min total | Prevent single-domain flooding (egress) |

### Request signing

The invoke proxy signs outbound webhook requests so the webhook
endpoint can verify they came from this AIMEAT node:

```
POST <webhookUrl>
Content-Type: application/json
X-AIMEAT-Node: <nodeId>
X-AIMEAT-Signature: <Ed25519 signature of body>
X-AIMEAT-Timestamp: <ISO 8601>

{ "input": { ... }, "caller": "<callerGhii>", "capability": "<capabilityId>" }
```

### Egress restrictions

- Webhook URLs must use HTTPS (no HTTP)
- No loopback addresses (127.0.0.1, ::1, localhost)
- No private network ranges (10.x, 172.16-31.x, 192.168.x)
- No metadata endpoints (169.254.169.254)

---

## 10. Stats Architecture

### Write contention problem

The current design writes stats to `CapabilityRecord.stats` on every
invoke. For popular capabilities, this becomes a write contention hotspot.

### Solution: append-only log with periodic rollup

Instead of updating CapabilityRecord on every invoke:

1. **Each invoke appends to a stats buffer** (in-memory queue)
2. **Periodic rollup job** (every 60 seconds) aggregates the buffer
   and updates `CapabilityRecord.stats` in a single write
3. **CapabilityLogEntry** stores individual invocations for the
   detail log (operator dashboard)

This means `stats` on the record may be up to 60 seconds stale,
which is acceptable for dashboard display. The individual log
entries are real-time.

### Stats buffer implementation

```typescript
// In-memory during normal operation
const statsBuffer: Map<string, { success: number, error: number, totalMs: number, lastError: string | null }>;

// Flushed to storage every 60 seconds by the scheduler
function flushStatsBuffer(): void {
  for (const [capId, delta] of statsBuffer) {
    storage.incrementCapabilityStats(capId, delta);
  }
  statsBuffer.clear();
}
```

---

## 11. PII Protection in Logs

### Problem

`CapabilityLogEntry.input` stores the full input payload. For a
"translate" capability, input might contain private text. For a
"profile-lookup" capability, input might contain personal identifiers.
Default-on full input logging is a privacy risk.

### Solution: per-capability redaction policy

Each capability declares `redactedFields: string[]` listing JSON paths
that contain sensitive data:

```json
{
  "id": "translate-text",
  "redactedFields": ["text", "personal.email"],
  ...
}
```

### Logging behavior

| redactedFields | What is logged |
|----------------|---------------|
| `[]` (empty) | Full input logged (default for non-sensitive capabilities) |
| `["text"]` | Input logged with `text` field replaced by `"[REDACTED]"` |
| `["*"]` | Only input hash logged, no field values. For maximally sensitive capabilities. |

### Error logging exception

When `status: error`, the full input (unredacted) is logged regardless
of redaction policy. This is necessary for debugging. Error logs are
visible only to the capability owner and the operator, never to the
public. Error logs are auto-deleted after 7 days (configurable).

---

## 12. Storage Layer

Follows the same patterns as all existing AIMEAT storage domains:
repository interface in `interface.ts`, SQLite implementation in
`providers/sqlite/repos/`, MongoDB implementation in `providers/mongodb/repos/`.

### Repository interface: CapabilityRepository

Add to `src/storage/repositories/capability.repository.ts` and include
in the `Storage` intersection type in `interface.ts`.

```typescript
export interface CapabilityRepository {
  // CRUD
  createCapability(record: CapabilityRecord): Promise<CapabilityRecord>;
  getCapability(id: string): Promise<CapabilityRecord | null>;
  updateCapability(id: string, updates: Partial<CapabilityRecord>): Promise<CapabilityRecord | null>;
  deleteCapability(id: string): Promise<boolean>;

  // Discovery
  listCapabilities(filters: {
    ownerGhii?: string;
    visibility?: string;
    status?: string;
    sourceType?: string;
    callable?: boolean;
    authRequired?: string;
    tags?: string[];
    search?: string;
    page?: number;
    perPage?: number;
  }): Promise<{ capabilities: CapabilityRecord[]; total: number }>;

  // Owner-scoped list
  listCapabilitiesByOwner(ownerGhii: string): Promise<CapabilityRecord[]>;

  // Source-based lookup (for aggregator)
  getCapabilityBySourceRef(sourceRef: string): Promise<CapabilityRecord | null>;
  listCapabilitiesBySourceType(sourceType: string): Promise<CapabilityRecord[]>;

  // Stats (batch update from stats buffer)
  incrementCapabilityStats(id: string, delta: {
    success: number; error: number; totalMs: number; lastError?: string;
  }): Promise<void>;

  // Logs
  addCapabilityLog(entry: CapabilityLogEntry): Promise<void>;
  listCapabilityLogs(capabilityId: string, filters: {
    status?: 'success' | 'error';
    page?: number;
    perPage?: number;
  }): Promise<{ logs: CapabilityLogEntry[]; total: number }>;
  deleteCapabilityLogsBefore(before: string): Promise<number>; // cleanup job

  // Operator override
  setCapabilityOverride(id: string, override: CapabilityRecord['operatorOverride']): Promise<void>;

  // Trust signals
  setCapabilityTrust(id: string, trust: Partial<CapabilityRecord['trust']>): Promise<void>;
  incrementVouchCount(id: string): Promise<void>;
}
```

### CapabilityLogEntry

```typescript
interface CapabilityLogEntry {
  id: string;                    // UUID
  capabilityId: string;
  callerGhii: string;
  input: object;                 // redacted per capability.redactedFields
  status: 'success' | 'error';
  durationMs: number;
  error: string | null;
  timestamp: string;             // ISO 8601
}
```

### SQLite schema

Add to `providers/sqlite/schema.ts`:

```sql
CREATE TABLE IF NOT EXISTS capabilities (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  ownerGhii   TEXT NOT NULL,
  visibility  TEXT NOT NULL DEFAULT 'private',
  scope       TEXT NOT NULL DEFAULT 'local',
  status      TEXT NOT NULL DEFAULT 'draft',
  rejectionReason TEXT,
  sourceType  TEXT NOT NULL,
  sourceRef   TEXT NOT NULL,
  sourceVersion TEXT NOT NULL DEFAULT '',
  authRequired TEXT NOT NULL DEFAULT 'registered',
  callable    INTEGER NOT NULL DEFAULT 0,
  inputSchema TEXT DEFAULT '{}',
  outputSchema TEXT DEFAULT '{}',
  exports     TEXT DEFAULT '[]',
  usage       TEXT NOT NULL DEFAULT '',
  whenToUse   TEXT NOT NULL DEFAULT '',
  whenNotToUse TEXT NOT NULL DEFAULT '',
  examples    TEXT NOT NULL DEFAULT '[]',
  dependencies TEXT NOT NULL DEFAULT '[]',
  schemaHash  TEXT NOT NULL DEFAULT '',
  webhookUrl  TEXT,
  cost        TEXT,
  trustRequired REAL,
  trust       TEXT NOT NULL DEFAULT '{}',
  redactedFields TEXT NOT NULL DEFAULT '[]',
  operatorOverride TEXT,
  stats       TEXT NOT NULL DEFAULT '{"totalInvocations":0,"successCount":0,"errorCount":0,"lastInvokedAt":null,"avgResponseMs":0,"lastError":null}',
  tags        TEXT NOT NULL DEFAULT '[]',
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_capabilities_owner ON capabilities(ownerGhii);
CREATE INDEX IF NOT EXISTS idx_capabilities_source ON capabilities(sourceType, sourceRef);
CREATE INDEX IF NOT EXISTS idx_capabilities_status ON capabilities(status);
CREATE INDEX IF NOT EXISTS idx_capabilities_visibility ON capabilities(visibility);

CREATE TABLE IF NOT EXISTS capability_logs (
  id            TEXT PRIMARY KEY,
  capabilityId  TEXT NOT NULL,
  callerGhii    TEXT NOT NULL,
  input         TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL,
  durationMs    INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  timestamp     TEXT NOT NULL,
  FOREIGN KEY (capabilityId) REFERENCES capabilities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_capability_logs_cap ON capability_logs(capabilityId, timestamp);
CREATE INDEX IF NOT EXISTS idx_capability_logs_status ON capability_logs(capabilityId, status);
```

### SQLite implementation

File: `providers/sqlite/repos/capability.ts`

Follows the same pattern as `repos/action.ts` and `repos/community.ts`:
- `deserializeCapability(row)` helper: JSON.parse for complex fields (inputSchema, outputSchema, exports, examples, dependencies, cost, trust, operatorOverride, stats, tags, redactedFields)
- Plain exported functions: `createCapability(db, record)`, `getCapability(db, id)`, etc.
- `listCapabilities` fetches all matching rows, applies search filter in JS (case-insensitive on name, summary, tags), paginates with `.slice()`

### MongoDB implementation

File: `providers/mongodb/repos/capability.ts`

Same interface, using the Prisma schema. Collection: `capabilities`. Log collection: `capabilityLogs`.
- Filters map to Prisma `where` clauses
- Search uses `$regex` on name and summary fields
- Stats increment uses `$inc` operator
- Log cleanup uses `deleteMany` with timestamp filter

Both implementations must pass the same test suite.

Log retention: configurable via `node.capabilities.logRetentionDays` (default 30).
Background cleanup job runs daily, deletes logs older than retention period.

---

## 12b. Testing

### Unit tests: `test/unit/capability-storage.test.ts`

Vitest, in-memory SQLite. Follows the same pattern as `unit/extension-storage.test.ts`.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';

function makeCapability(overrides: Partial<CapabilityRecord> = {}): CapabilityRecord {
  return {
    id: 'test-cap-' + Math.random().toString(36).slice(2, 8),
    name: 'Test Capability',
    summary: 'A test capability',
    ownerGhii: 'testuser@test-node',
    visibility: 'public',
    scope: 'local',
    status: 'active',
    rejectionReason: null,
    source: { type: 'manual', ref: 'manual', version: '1.0.0' },
    authRequired: 'registered',
    callable: true,
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { result: { type: 'string' } } },
    exports: null,
    usage: 'await AIMEAT.capabilities.invoke("test-cap", { q: "hello" })',
    whenToUse: 'When testing',
    whenNotToUse: 'In production',
    examples: [{ description: 'Basic', input: { q: 'hello' }, output: { result: 'world' } }],
    dependencies: [],
    schemaHash: 'abc123',
    webhookUrl: null,
    cost: null,
    trustRequired: null,
    trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
    redactedFields: [],
    operatorOverride: null,
    stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
    tags: ['test'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CapabilityRepository', () => {
  let storage: SqliteStorage;
  beforeEach(() => { storage = new SqliteStorage(':memory:'); });

  it('create and retrieve', async () => { ... });
  it('get returns null for non-existent', async () => { ... });
  it('list with filters (visibility, status, sourceType, callable, tags, search)', async () => { ... });
  it('list by owner', async () => { ... });
  it('update and verify persisted', async () => { ... });
  it('update non-existent returns null', async () => { ... });
  it('delete', async () => { ... });
  it('delete non-existent returns false', async () => { ... });
  it('getBySourceRef', async () => { ... });
  it('incrementStats', async () => { ... });
  it('addLog and listLogs', async () => { ... });
  it('deleteLogsBefore', async () => { ... });
  it('setOverride', async () => { ... });
  it('setTrust and incrementVouch', async () => { ... });
});
```

### E2E test: `test/e2e-capabilities.ts`

Standalone script, same boilerplate as other E2E files. Tests the full
HTTP lifecycle against a live server.

```
Phase 0 -- Setup
  Register owner, authenticate, register agent, authenticate agent.

Phase 1 -- Manual Capability CRUD
  POST /v1/capabilities (create manual capability, visibility: private)
  GET /v1/capabilities/:id (verify created)
  PUT /v1/capabilities/:id (update summary)
  GET /v1/capabilities (list, verify appears)
  GET /v1/capabilities (search by name)
  GET /v1/capabilities (filter by callable, authRequired, tags)
  DELETE /v1/capabilities/:id (delete)
  GET /v1/capabilities/:id (verify 404)

Phase 2 -- Visibility and Auth
  Create public capability
  Verify anonymous can see it in list (GET /v1/capabilities without auth)
  Create private capability
  Verify anonymous cannot see it
  Verify owner can see it
  Test authRequired enforcement on invoke

Phase 3 -- Extension Capability Invoke
  Install and activate a test extension
  Wait for aggregator to create capability
  GET /v1/capabilities (verify extension appears as callable)
  POST /v1/capabilities/:id/invoke (invoke extension via capability)
  Verify result matches direct extension call
  Test ?mode=raw returns original response

Phase 4 -- Manual Webhook Invoke
  Create manual capability with webhookUrl (use a test echo endpoint)
  POST /v1/capabilities/:id/invoke
  Verify result from webhook

Phase 5 -- Cortex Capability Invoke
  Install and activate a test cortex with exports
  Wait for aggregator to create capability
  POST /v1/capabilities/:id/invoke (invoke cortex export)
  Verify result

Phase 6 -- Stats and Logging
  Invoke a capability multiple times
  GET /v1/capabilities/:id (verify stats updated)
  GET /v1/admin/capabilities/:id/logs (verify logs recorded)

Phase 7 -- Operator Override
  PUT /v1/admin/capabilities/:id/override (disable a capability)
  POST /v1/capabilities/:id/invoke (verify 403)
  PUT /v1/admin/capabilities/:id/override (re-enable)
  POST /v1/capabilities/:id/invoke (verify works again)

Phase 8 -- Moderation Flow (if publishing=moderated)
  Create capability with visibility: public
  Verify status is pending_review
  Verify not in public list
  PUT /v1/admin/capabilities/:id/override (approve -> active)
  Verify appears in public list

Phase 9 -- Capability Test Endpoint
  Create manual webhook capability (status: draft)
  POST /v1/capabilities/:id/test (dry-run invoke)
  Verify result and schema validation report

Phase 10 -- Cleanup
  Delete test owner (cascade)

Summary: print pass/fail counts, exit code.
```

### E2E test coverage for both backends

The test suite runs on both SQLite and MongoDB via the existing
`pnpm test:e2e:sqlite` and `pnpm test:e2e:mongodb` commands.
The test runner (`test/run-e2e-ci.ts`) automatically discovers
new `e2e-*.ts` files.

---

## 13. Files to Create/Modify

### New files

| File | Purpose |
|------|---------|
| `src/routes/capabilities.ts` | REST endpoints: CRUD, discovery, invoke proxy |
| `src/routes/admin-capabilities.ts` | Admin endpoints: list all, override, logs |
| `src/services/capability-aggregator.ts` | Background job: scan systems, create/update capabilities |
| `src/services/capability-invoke.ts` | Invoke proxy: route to correct underlying system |
| `src/routes/lib-capabilities.ts` | SDK library source generator |
| `src/mcp/capabilities.ts` | MCP tools: list, get, invoke |
| `public/views/profile/capabilities-tab.js` | Profile tab UI |
| `public/views/admin/capabilities-tab.js` | Admin tab UI |
| `public/css/views/capabilities.css` | Styles for both tabs |

### Modified files

| File | Change |
|------|--------|
| `src/storage/interface.ts` | Add CapabilityRecord, CapabilityLogEntry types and storage methods |
| `src/storage/sqlite.ts` | Implement capability storage methods + new tables |
| `src/storage/mongodb.ts` | Implement capability storage methods + new collections |
| `src/server.ts` | Mount capabilities router and admin-capabilities router |
| `src/routes/libs.ts` | Add aimeat-capabilities to library list and GET /v1/libs. SDK libraries are NOT aggregated as capabilities. |
| `src/mcp/index.ts` | Register capability MCP tools |
| `src/services/scheduler.ts` | Add capability aggregation job |
| `public/views/profile.js` | Add capabilities tab to profile tab list |
| `public/views/admin/index.js` | Add capabilities tab to admin navigation |
| `locales/en.json` | Add capability i18n strings |
| `locales/fi.json` | Add capability i18n strings |
| `openapi.yaml` | Add capability endpoints to API spec |
| `aimeat/public/llms-template.txt` | Add capability discovery and invoke to API reference |

### No modifications to existing systems

Extensions, actions, cortex, packages, SDK libraries, and MCP core tools remain unchanged. The capability layer reads from them but never writes to them.

---

## 14. Usage Patterns

Two distinct paths for using capabilities, depending on who is consuming them.

### Path 1: App builder (human + AI chat, GHII auth)

The user describes what they want to build. The AI uses two layers:

**Layer A: SDK libraries (always available, infrastructure)**
Memory, storage, realtime, boards. These are the same on every node.
Use them directly via `AIMEAT.data`, `AIMEAT.storage`, etc.
No capability discovery needed.

**Layer B: Node capabilities (vary per node, discoverable)**
Extensions, cortex modules, manual webhooks, actions.
These are what makes one node different from another.
Discover via `AIMEAT.capabilities.list()`, use via `invoke()` or `loadScript()`.

```javascript
async function startApp(session) {
  // Load the capabilities SDK
  await loadScript('/v1/libs/aimeat-capabilities.js');

  // Layer A: Infrastructure (always available, use directly)
  const savedData = await AIMEAT.data.get('my-app.state');

  // Layer B: Discover what THIS node offers
  const caps = await AIMEAT.capabilities.list({ callable: true });
  // -> [{ id: 'weather-fi', ... }, { id: 'translate', ... }]

  // Use a callable capability (extension or manual webhook)
  const weather = await AIMEAT.capabilities.invoke('weather-fi', {
    city: 'Helsinki',
  });

  // Use a loadable capability (cortex)
  const chartsCap = await AIMEAT.capabilities.get('cortex:aimeat-charts');
  // chartsCap.usage tells us: "loadScript('/v1/cortex/aimeat-charts/libs/charts.js')"
  await loadScript('/v1/cortex/aimeat-charts/libs/charts.js');
  // Now AIMEAT.charts is available, use it to render weather data
}
```

**Auth:** GHII via `aimeat-auth.js`. The login bar handles registration and login.
`AIMEAT.capabilities.invoke()` uses `session.fetch()` internally,
so the user's GHII identity is used for auth and billing.

**Step-by-step for AI building an app:**

1. User describes the app idea
2. AI loads capability list: `GET /v1/capabilities`
3. AI picks relevant capabilities for the idea
4. AI starts with the starter template (from llms.txt / AIMEAT-OS.md)
5. AI adds SDK libraries for infrastructure needs (memory, storage, realtime)
6. AI adds `aimeat-capabilities.js` if the app needs node-specific capabilities
7. AI loads cortex libraries for complex packaged functionality
8. AI calls `capabilities.invoke()` for callable capabilities
9. For non-callable (actions): AI shows the user how to use the work queue if needed
10. Result: single-file HTML app with login bar, SDK libs, and capabilities

### Path 2: AI agent (GAII auth, MCP or API)

The agent connects to the node and wants to use its capabilities.

**Via MCP (Claude Code, Copilot, MCP-compatible platforms):**

```
1. Agent connects MCP to the node (/v1/mcp)
2. Agent calls aimeat_capabilities_list
   -> sees all public callable and non-callable capabilities
3. Agent calls aimeat_capabilities_get('weather-fi')
   -> gets full schema, examples, whenToUse
4. Agent calls aimeat_capabilities_invoke('weather-fi', { city: 'Helsinki' })
   -> gets result directly
5. For non-callable (actions): agent uses aimeat_action_execute MCP tool
   or POST /v1/work/request via API
```

**Via REST API (custom agents, scripts, LangChain):**

```
1. Agent authenticates (device auth or connectivity key -> JWT)
2. GET /v1/capabilities -> discover what this node can do
3. GET /v1/capabilities/weather-fi -> get full details
4. POST /v1/capabilities/weather-fi/invoke { input: { city: 'Helsinki' } }
5. Use the result in the agent's workflow
```

**Auth:** GAII via device authorization or MCP OAuth. The agent's scoped
permissions determine which capabilities it can invoke. The invoke proxy
checks `authRequired` against the agent's auth level.

### Path 3: Cortex as a capability package

Cortex modules deserve special attention because they are the richest
type of capability. A cortex bundles everything an app domain needs.

The capability layer does not "invoke" a cortex. Instead, it **describes**
what the cortex provides (functions, schemas, dependencies) so that AI
tools and developers can write correct code without reading the cortex
source.

```
Example capability entry for "recipe-manager" cortex:

{
  id: "cortex:recipe-manager",
  name: "Recipe Manager",
  summary: "Full recipe management: create, search, share, import",
  source: { type: "cortex", ref: "cortex:recipe-manager", version: "1.2.0" },
  callable: false,
  usage: "await loadScript('/v1/cortex/recipe-manager/libs/recipe-manager.js')",
  
  exports: [
    {
      name: "RecipeManager.create",
      description: "Create a new recipe and store it in memory",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          ingredients: { type: "array", items: { type: "object", properties: {
            name: { type: "string" }, amount: { type: "string" }
          }}},
          steps: { type: "array", items: { type: "string" } },
          tags: { type: "array", items: { type: "string" } }
        },
        required: ["title", "ingredients", "steps"]
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          key: { type: "string", description: "Memory key where recipe is stored" },
          created_at: { type: "string", format: "date-time" }
        }
      },
      example: {
        input: { title: "Pasta Carbonara", ingredients: [{ name: "spaghetti", amount: "400g" }], steps: ["Boil pasta..."], tags: ["italian", "pasta"] },
        output: { id: "rec-abc123", key: "recipes.rec-abc123", created_at: "2026-05-01T12:00:00Z" }
      }
    },
    {
      name: "RecipeManager.search",
      description: "Search recipes by text query or tags",
      inputSchema: { type: "object", properties: { query: { type: "string" }, tags: { type: "array", items: { type: "string" } } } },
      outputSchema: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, tags: { type: "array" } } } },
      example: { input: { query: "pasta" }, output: [{ id: "rec-abc123", title: "Pasta Carbonara", tags: ["italian", "pasta"] }] }
    }
  ],

  dependencies: [
    { type: "sdk", id: "aimeat-data", required: true },
    { type: "sdk", id: "aimeat-storage", required: false }
  ],

  whenToUse: "Use when your app needs recipe management. Handles all storage, search, and sharing internally.",
  whenNotToUse: "Not needed if you just want to store raw JSON data. Use AIMEAT.data directly for simple key-value storage."
}
```

**What the AI does with this:**

1. Reads the capability: sees exports, schemas, dependencies
2. Knows to load aimeat-data first, then the cortex library
3. Writes app code using the exact function signatures from exports
4. Knows the exact shape of inputs and outputs, no guessing

```javascript
async function startApp(session) {
  // Dependencies first (from capability.dependencies)
  await loadScript('/v1/libs/aimeat-data.js');
  
  // Then the cortex library (from capability.usage)
  await loadScript('/v1/cortex/recipe-manager/libs/recipe-manager.js');

  // Use the exported functions (from capability.exports)
  const recipes = await RecipeManager.search({ query: 'pasta' });
  const newRecipe = await RecipeManager.create({
    title: 'My Recipe',
    ingredients: [{ name: 'flour', amount: '500g' }],
    steps: ['Mix ingredients', 'Bake at 200C'],
    tags: ['baking'],
  });
}
```

The app does not interact with memory or storage directly.
The cortex handles that internally. The capability metadata
tells the AI everything it needs to write correct code.

### What capabilities are NOT

Capabilities are not a replacement for:
- **SDK libraries** (memory, storage, realtime): always-available infrastructure
- **The work queue**: async business process for agent-to-agent commerce
- **Direct API calls**: if you know the endpoint, use it directly

Capabilities are for:
- **Discovery**: "What can this node do that other nodes might not?"
- **Unified invocation**: call extensions and webhooks without knowing the underlying API
- **Self-documentation**: AI and humans understand what a capability does from its metadata

---

## 15. Creating Capabilities: End-to-End Guides

These guides cover the full path from idea to working capability,
including ALL components that need to be created. They serve as
templates for AI chats and VS Code / Claude Code to follow.

Two delivery methods:
- **AI chat**: AI produces all code/manifests, user copy-pastes into AIMEAT portal
- **VS Code / Claude Code**: pushes components directly via MCP or API

### Path A: Extension-based capability

For capabilities that need to call external APIs or run server-side logic.

**Example: weather-allergy-fi (weather + pollen + forecast for Finland)**

**Step 1: Write the extension manifest (YAML)**

```yaml
metadata:
  name: weather-allergy-fi
  version: 1.0.0
  description: Weather, pollen levels, and forecast for Finnish locations
  author: myuser
  license: MIT

required_apis:
  - memory

actions:
  - id: get-current
    description: Get current weather and pollen for a location
    method: POST
    path: /get-current
    auth: authenticated
    input:
      location:
        type: string
        required: true
        description: City name or district (e.g. "Tapiola", "Helsinki")
      include_forecast:
        type: boolean
        default: true
      forecast_days:
        type: number
        default: 3
    output:
      current:
        type: object
        description: Current weather conditions
      allergy:
        type: object
        description: Pollen levels by species
      forecast:
        type: array
        description: Daily forecast entries
      location:
        type: object
        description: Resolved location with coordinates
    script: actions/get-current.js

  - id: list-locations
    description: List all available locations
    method: POST
    path: /list-locations
    auth: authenticated
    output:
      locations:
        type: array
    script: actions/list-locations.js

config:
  openweathermap_api_key:
    type: string
    description: OpenWeatherMap API key (stored securely, never exposed to clients)
  pollen_api_url:
    type: string
    default: https://pollen-api.example.com/finland
    description: Pollen data API base URL

schedules:
  - id: refresh-weather
    cron: "*/10 * * * *"
    action: refresh-all
    description: Refresh weather data for all locations every 10 minutes
    input: {}

limits:
  memory_mb: 32
  timeout_ms: 5000
  max_api_calls: 10
```

Note: API keys are stored in extension config (`ctx.config.openweathermap_api_key`),
never hardcoded in scripts. The operator sets config values during installation
or via the admin dashboard. Extension scheduling (`schedules`) uses the
node's existing background job scheduler for periodic data refresh.

**Step 2: Write the extension scripts**

`actions/get-current.js`:
```javascript
export default async function(ctx, input) {
  const { location, include_forecast = true, forecast_days = 3 } = input;

  // API key from secure extension config (set by operator, never in code)
  const apiKey = ctx.config.openweathermap_api_key;
  const pollenUrl = ctx.config.pollen_api_url;

  // Fetch weather from external API
  const weatherRes = await ctx.fetch(
    `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)},FI&units=metric&appid=${apiKey}`
  );
  const weather = await weatherRes.json();

  // Fetch pollen data
  const pollenRes = await ctx.fetch(`${pollenUrl}/current`);
  const pollen = await pollenRes.json();

  const result = {
    current: {
      temperature: weather.main.temp,
      humidity: weather.main.humidity,
      wind_speed: weather.wind.speed,
      description: weather.weather[0].description,
    },
    allergy: {
      birch: pollen.birch || 'unknown',
      grass: pollen.grass || 'unknown',
      alder: pollen.alder || 'unknown',
      source: pollen.source,
      date: pollen.date,
    },
    location: {
      name: weather.name,
      lat: weather.coord.lat,
      lon: weather.coord.lon,
    },
  };

  if (include_forecast) {
    const forecastRes = await ctx.fetch(
      `https://api.openweathermap.org/data/2.5/forecast/daily?q=${encodeURIComponent(location)},FI&cnt=${forecast_days}&units=metric&appid=${apiKey}`
    );
    const fc = await forecastRes.json();
    result.forecast = fc.list.map(day => ({
      date: new Date(day.dt * 1000).toISOString().split('T')[0],
      temp_min: day.temp.min,
      temp_max: day.temp.max,
      description: day.weather[0].description,
    }));
  }

  // Cache in memory for other capabilities to read
  await ctx.memory.set(`weather.current.${location.toLowerCase()}`, result.current);

  return result;
}
```

`actions/list-locations.js`:
```javascript
export default async function(ctx) {
  const keys = await ctx.memory.list();
  const locations = keys
    .filter(k => k.startsWith('weather.current.'))
    .map(k => k.replace('weather.current.', ''));
  return { locations };
}
```

**Step 3: Register the extension**

Via AI chat (user copy-pastes):
```
POST /v1/extensions
Body: { "manifest": "<YAML above>", "scripts": { "actions/get-current.js": "<JS above>", "actions/list-locations.js": "<JS above>" } }
```

Via Claude Code / MCP:
```
aimeat_extension_invoke is not needed - use direct API:
session.fetch('/v1/extensions', { method: 'POST', body: JSON.stringify({ manifest, scripts }) })
```

**Step 4: Activate**

```
POST /v1/extensions/weather-allergy-fi/activate
```

**Step 5: Capability auto-appears**

The aggregator creates:
- `ext:weather-allergy-fi:get-current` (callable: true)
- `ext:weather-allergy-fi:list-locations` (callable: true)

**Step 6: Enrich the capability (optional)**

```
PUT /v1/capabilities/ext:weather-allergy-fi:get-current
Body: {
  "whenToUse": "Use when your app needs weather and pollen data for Finnish locations.",
  "whenNotToUse": "Does not work outside Finland. Data is not real-time, cached for 10 minutes.",
  "examples": [
    {
      "description": "Weather and pollen for Tapiola",
      "input": { "location": "Tapiola", "include_forecast": true, "forecast_days": 3 },
      "output": {
        "current": { "temperature": 14, "humidity": 65, "wind_speed": 3.2, "description": "partly cloudy" },
        "allergy": { "birch": "moderate", "grass": "none", "alder": "low", "source": "Turun yliopisto", "date": "2026-05-01" },
        "forecast": [
          { "date": "2026-05-02", "temp_min": 8, "temp_max": 16, "description": "sunny" }
        ],
        "location": { "name": "Tapiola, Espoo", "lat": 60.18, "lon": 24.80 }
      }
    }
  ],
  "tags": ["weather", "allergy", "pollen", "forecast", "finland"]
}
```

**Result: capability is live and discoverable.**

---

### Path B: Manual webhook capability

For users who have their own server/API they want to expose as a capability.

**Example: same weather-allergy data from own server**

**Step 1: Have a webhook endpoint**

The user's server at `https://my-server.com/api/weather-allergy` accepts:
```
POST https://my-server.com/api/weather-allergy
Content-Type: application/json
Body: { "input": { "location": "Tapiola" }, "caller": "user@node", "capability": "weather-allergy-fi" }
Response: { "result": { "current": { ... }, "allergy": { ... }, "forecast": [...] } }
```

**Step 2: Create the capability with full schemas**

```
POST /v1/capabilities
Body: {
  "id": "weather-allergy-fi",
  "name": "Weather, Allergy & Forecast (Finland)",
  "summary": "Current weather, pollen levels, and forecast for Finnish locations",
  "source": { "type": "manual", "ref": "manual", "version": "1.0.0" },
  "callable": true,
  "webhookUrl": "https://my-server.com/api/weather-allergy",
  "authRequired": "registered",
  "visibility": "public",
  "inputSchema": {
    "type": "object",
    "properties": {
      "location": {
        "type": "string",
        "description": "Finnish city or district name (e.g. 'Tapiola', 'Helsinki')"
      },
      "include_forecast": { "type": "boolean", "default": true },
      "forecast_days": { "type": "integer", "default": 3, "minimum": 1, "maximum": 7 }
    },
    "required": ["location"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "current": {
        "type": "object",
        "properties": {
          "temperature": { "type": "number", "description": "Celsius" },
          "humidity": { "type": "number", "description": "0-100%" },
          "wind_speed": { "type": "number", "description": "m/s" },
          "description": { "type": "string" }
        }
      },
      "allergy": {
        "type": "object",
        "properties": {
          "birch": { "type": "string", "enum": ["none","low","moderate","high","very_high"] },
          "grass": { "type": "string", "enum": ["none","low","moderate","high","very_high"] },
          "alder": { "type": "string", "enum": ["none","low","moderate","high","very_high"] },
          "source": { "type": "string" },
          "date": { "type": "string", "format": "date" }
        }
      },
      "forecast": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "date": { "type": "string", "format": "date" },
            "temp_min": { "type": "number" },
            "temp_max": { "type": "number" },
            "description": { "type": "string" },
            "pollen_trend": { "type": "string", "enum": ["decreasing","stable","increasing"] }
          }
        }
      },
      "location": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "lat": { "type": "number" },
          "lon": { "type": "number" }
        }
      }
    }
  },
  "whenToUse": "Use when your app needs weather and pollen data for Finnish locations.",
  "whenNotToUse": "Does not work outside Finland.",
  "examples": [
    {
      "description": "Weather and pollen for Tapiola",
      "input": { "location": "Tapiola", "include_forecast": true, "forecast_days": 3 },
      "output": {
        "current": { "temperature": 14, "humidity": 65, "wind_speed": 3.2, "description": "partly cloudy" },
        "allergy": { "birch": "moderate", "grass": "none", "alder": "low", "source": "Turun yliopisto", "date": "2026-05-01" },
        "forecast": [{ "date": "2026-05-02", "temp_min": 8, "temp_max": 16, "description": "sunny", "pollen_trend": "increasing" }],
        "location": { "name": "Tapiola, Espoo", "lat": 60.18, "lon": 24.80 }
      }
    }
  ],
  "tags": ["weather", "allergy", "pollen", "forecast", "finland"]
}
```

**Step 3: Test before publishing**

```
POST /v1/capabilities/weather-allergy-fi/test
Body: { "input": { "location": "Tapiola" } }
Response: { "status": "success", "result": { ... }, "validated": true, "validation_errors": [] }
```

**Step 4: Activate**

If node is moderated: status goes to `pending_review`, operator approves.
If node is open: set `status: active` via PUT.

**Result: capability is live. No extension, no cortex, just a webhook.**

---

### Path C: Cortex + Memory (AIMEAT-native, no external APIs)

The most AIMEAT-native approach. Data lives in memory, cortex library
provides the interface. No external dependencies.

**Example: weather-allergy data stored in AIMEAT memory**

**Step 1: Design the memory key structure**

```
Memory keys:
  weather.current.<location-slug>     -> WeatherCurrent object
  weather.forecast.<location-slug>    -> WeatherForecast[] array
  pollen.latest.<city-slug>           -> PollenData object
  weather.locations                   -> string[] list of available location slugs
```

**Step 2: Write the cortex manifest (YAML)**

```yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension

metadata:
  name: weather-allergy
  namespace: weather
  description: Weather, pollen, and forecast data from AIMEAT memory
  author: myuser
  tags: [weather, allergy, pollen, forecast, finland]
  visibility: public

spec:
  version: 1.0.0
  license: MIT
  description: Provides WeatherAllergy library for reading weather and pollen data from memory

  components:
    - type: schema
      name: weather-current
      key_pattern: "weather.current.*"
      apply_to: prefix
      schema:
        type: object
        properties:
          temperature: { type: number }
          humidity: { type: number }
          wind_speed: { type: number }
          description: { type: string }
          updated_at: { type: string, format: date-time }
        required: [temperature, humidity, wind_speed]

    - type: schema
      name: weather-forecast
      key_pattern: "weather.forecast.*"
      apply_to: prefix
      schema:
        type: array
        items:
          type: object
          properties:
            date: { type: string, format: date }
            temp_min: { type: number }
            temp_max: { type: number }
            description: { type: string }
            pollen_trend: { type: string, enum: [decreasing, stable, increasing] }

    - type: schema
      name: pollen-latest
      key_pattern: "pollen.latest.*"
      apply_to: prefix
      schema:
        type: object
        properties:
          birch: { type: string, enum: [none, low, moderate, high, very_high] }
          grass: { type: string, enum: [none, low, moderate, high, very_high] }
          alder: { type: string, enum: [none, low, moderate, high, very_high] }
          source: { type: string }
          date: { type: string, format: date }

    - type: seed-data
      entries:
        - key: weather.locations
          value: ["helsinki", "espoo-tapiola", "tampere", "turku"]
        - key: weather.current.helsinki
          value: { temperature: 13, humidity: 70, wind_speed: 4.1, description: "cloudy", updated_at: "2026-05-01T12:00:00Z" }
        - key: pollen.latest.helsinki
          value: { birch: "moderate", grass: "none", alder: "low", source: "Turun yliopisto", date: "2026-05-01" }

    - type: lib
      name: weather-allergy.js
      filename: weather-allergy.js
      exports: [WeatherAllergy]
      api_surface: "WeatherAllergy.getCurrent(location), WeatherAllergy.getForecast(location, days), WeatherAllergy.listLocations(), WeatherAllergy.getAllergyLevel(location)"
```

**Step 3: Write the cortex library**

`weather-allergy.js`:
```javascript
(function(global) {
  'use strict';

  function normalize(location) {
    return location.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }

  function resolveCity(location) {
    const slug = normalize(location);
    // Map districts to cities for pollen data
    const cityMap = {
      'tapiola': 'espoo', 'leppavaara': 'espoo', 'matinkyla': 'espoo',
      'kallio': 'helsinki', 'kamppi': 'helsinki', 'sodernaes': 'helsinki',
    };
    return cityMap[slug] || slug.split('-')[0] || slug;
  }

  const WeatherAllergy = {
    async getCurrent(location) {
      const slug = normalize(location);
      const [weather, pollen] = await Promise.all([
        AIMEAT.data.get('weather.current.' + slug),
        AIMEAT.data.get('pollen.latest.' + resolveCity(location)),
      ]);
      if (!weather) return null;
      return {
        current: weather,
        allergy: pollen || { birch: 'unknown', grass: 'unknown', alder: 'unknown' },
        location: { name: location, slug },
      };
    },

    async getForecast(location, days) {
      const slug = normalize(location);
      const forecast = await AIMEAT.data.get('weather.forecast.' + slug);
      if (!forecast) return [];
      return days ? forecast.slice(0, days) : forecast;
    },

    async listLocations() {
      const locations = await AIMEAT.data.get('weather.locations');
      return locations || [];
    },

    async getAllergyLevel(location) {
      const pollen = await AIMEAT.data.get('pollen.latest.' + resolveCity(location));
      return pollen || null;
    },
  };

  global.WeatherAllergy = WeatherAllergy;
  if (global.AIMEAT) global.AIMEAT.WeatherAllergy = WeatherAllergy;
})(typeof window !== 'undefined' ? window : globalThis);
```

**Step 4: Register the cortex**

Via AI chat (user copy-pastes):
```
POST /v1/cortex
Body: { "manifest": "<YAML above>", "libs": { "weather-allergy.js": "<JS above>" } }
```

Via Claude Code / MCP:
```javascript
session.fetch('/v1/cortex', {
  method: 'POST',
  body: JSON.stringify({ manifest: yamlString, libs: { 'weather-allergy.js': jsSource } }),
});
```

**Step 5: Activate**

```
POST /v1/cortex/weather-allergy/activate
```

This:
- Locks memory schemas for `weather.current.*`, `weather.forecast.*`, `pollen.latest.*`
- Writes seed data (initial weather entries)
- Serves `weather-allergy.js` at `/v1/cortex/weather-allergy/libs/weather-allergy.js`

**Step 6: Capability auto-appears**

The aggregator creates capabilities from the cortex exports:
- `cortex:weather-allergy:getCurrent` (callable in browser)
- `cortex:weather-allergy:getForecast` (callable in browser)
- `cortex:weather-allergy:listLocations` (callable in browser)
- `cortex:weather-allergy:getAllergyLevel` (callable in browser)

Each with full inputSchema/outputSchema from the cortex manifest.

**Step 7: Keep data fresh**

The cortex provides the interface, but someone must update the data.
Options:
- **Extension cron job**: a separate extension runs every 10 minutes,
  fetches weather APIs, writes to `weather.current.*` memory keys
- **Agent**: an AI agent runs periodically and updates the data
- **Manual**: user updates via portal or API
- **External webhook**: external service POSTs to `/v1/memory` via API

The capability works regardless of how data is updated. Cortex reads
whatever is in memory.

**Result: cortex + memory capability. No external API at call time.
Data is cached in AIMEAT, library provides clean interface.**

---

### How AI tools create these

**AI chat (Claude, ChatGPT, Gemini):**

1. User says "I want a weather + allergy capability"
2. AI reads capability list to check if one already exists
3. If not, AI asks which path (external API? own server? memory-based?)
4. AI produces all artifacts:
   - Path A: extension YAML + JS scripts
   - Path B: webhook endpoint spec + capability JSON
   - Path C: cortex YAML + JS library + seed data
5. User copy-pastes into AIMEAT portal:
   - Profile > Extensions > Install (for Path A)
   - Profile > Capabilities > Create (for Path B)
   - Profile > Cortex > Install (for Path C)

**VS Code / Claude Code (via MCP):**

1. AI discovers existing capabilities: `aimeat_capabilities_list`
2. If creating new, AI writes all artifacts as files in the project
3. AI pushes directly via MCP or API:
   - `session.fetch('/v1/extensions', { method: 'POST', body: ... })` (Path A)
   - `session.fetch('/v1/capabilities', { method: 'POST', body: ... })` (Path B)
   - `session.fetch('/v1/cortex', { method: 'POST', body: ... })` (Path C)
4. AI activates:
   - `session.fetch('/v1/extensions/weather-allergy-fi/activate', { method: 'POST' })`
   - or `session.fetch('/v1/cortex/weather-allergy/activate', { method: 'POST' })`
5. Capability is live, no copy-paste needed

**Key difference:** Claude Code / MCP can do everything without the
user leaving the editor. AI chat requires the user to copy-paste
artifacts into the AIMEAT portal.

---

## 16. Client-Side Telemetry

### Problem

Browser-side cortex invoke has two paths:
- **Option A** (`AIMEAT.capabilities.invoke()`): goes through the SDK, can record stats
- **Option B** (direct `RecipeManager.search()`): bypasses everything, server never knows

If Option B is used, `stats.totalInvocations` undercounts and the
operator dashboard shows incorrect usage data.

### Solution

The SDK `AIMEAT.capabilities.invoke()` sends a telemetry ping to the
server after each client-side cortex invocation:

```
POST /v1/capabilities/:id/telemetry
Authorization: Bearer <jwt>
Body: { "duration_ms": 45, "status": "success" }
```

This is fire-and-forget (no await, no error handling). It records:
- Invocation count
- Duration
- Success/error status

It does NOT send the input payload (privacy). The server increments
stats via the same stats buffer used for server-side invocations.

Option B (direct use) does not generate telemetry. This is documented:
"Direct use does not record usage statistics. Use
`AIMEAT.capabilities.invoke()` if stats tracking matters."

The telemetry endpoint is lightweight: no response body needed,
no logging of input, just a stats counter increment.

---

## 17. Vouching Mechanism

### Endpoints

```
POST /v1/capabilities/:id/vouch
  Authorization: Bearer <jwt> (registered user)
  Body: { "comment": "Works great for my weather app" }  // optional
  Response 200: { "ok": true, "data": { "vouchCount": 42 } }

  Rules:
  - One vouch per (capability, user) pair
  - Cannot vouch for your own capability
  - Must be registered user (not anonymous)

DELETE /v1/capabilities/:id/vouch
  Authorization: Bearer <jwt>
  Response 200: { "ok": true, "data": { "vouchCount": 41 } }
```

### Storage

New table:

```sql
CREATE TABLE IF NOT EXISTS capability_vouches (
  capabilityId TEXT NOT NULL,
  userGhii     TEXT NOT NULL,
  comment      TEXT,
  createdAt    TEXT NOT NULL,
  PRIMARY KEY (capabilityId, userGhii),
  FOREIGN KEY (capabilityId) REFERENCES capabilities(id) ON DELETE CASCADE
);
```

Repository methods:

```typescript
vouchCapability(capabilityId: string, userGhii: string, comment?: string): Promise<number>; // returns new count
unvouchCapability(capabilityId: string, userGhii: string): Promise<number>; // returns new count
hasVouched(capabilityId: string, userGhii: string): Promise<boolean>;
listVouches(capabilityId: string): Promise<Array<{ userGhii: string; comment?: string; createdAt: string }>>;
```

`vouchCapability` increments `trust.vouchCount` on the CapabilityRecord.
`unvouchCapability` decrements it. Both are atomic.

### UI

**Capability detail (public view):**
- Shows vouch count with a "Vouch" button (if not own capability, not already vouched)
- Shows list of vouchers with optional comments

**Profile capabilities tab:**
- Shows vouch count per capability the user owns

**Admin dashboard:**
- Shows vouch count in the list and detail views
- Can see who vouched (with comments)

---

## 18. Additional Items (v1 scope)

### Capability lifecycle

```
draft -> pending_review -> active -> deprecated -> disabled
                       \-> rejected (can resubmit -> pending_review)
```

- `deprecated`: capability still works but shows a deprecation message
  and points to `replacedBy` if set. Discovery results include
  `deprecated: true` flag. Apps using the capability see a console
  warning. Operator or owner sets this status.
- `disabled`: capability no longer invokable. Returns 410 GONE.

### Per-user invoke quota

Configurable per-capability limit on how many times a single user
can invoke per time window. Uses the same rate-limit middleware pattern.

```
node.capabilities.defaultInvokeQuota = { max: 100, windowMs: 3600000 }  // 100/hour default
```

Capability owners can override for their own capabilities:
```
invokeQuota: { max: 10, windowMs: 60000 }  // 10/min for expensive capabilities
```

### Anonymous access to public capabilities

Public capabilities with `authRequired: 'none'` are visible in
`GET /v1/capabilities` without any authentication. This includes
listing and reading detail, but NOT invoking (invoke always
requires at least an anonymous token).

Public capabilities with `authRequired: 'anonymous'` can be both
seen and invoked with just an anonymous token.

### Cost/morsel billing in invoke proxy

When a capability has `cost.morsels > 0`, the invoke proxy:

1. Checks caller's morsel balance before forwarding
2. Debits the cost from the caller's GHII balance (same as work queue)
3. Credits to the capability owner's GHII balance
4. Network fee applies (same percentage as work queue)
5. If balance insufficient, returns 402 with clear message

This reuses the existing `storage.debitBalance()` and `creditBalance()`
methods. No new billing infrastructure needed.

For `cost.perUnit`, the proxy calculates total cost based on the
response (e.g., per 1000 tokens processed). The capability's output
must include a `_usage` field for per-unit billing:
```json
{ "result": { ... }, "_usage": { "units": 2500 } }
```

### Reference to existing AIMEAT features used

The capability layer builds on these existing systems (not reinvented):

| Feature | Where it's used in capabilities |
|---------|--------------------------------|
| Rate limiting middleware | Per-endpoint invoke rate limits |
| Extension sandbox (QuickJS WASM) | Server-side extension invoke |
| Extension config (`ctx.config`) | Secure API key storage |
| Extension schedules (`schedules[]`) | Cron-based data refresh |
| Storage debitBalance/creditBalance | Morsel billing on invoke |
| Trust scoring | trustRequired threshold checks |
| Consent framework | Future: per-capability consent rules |

---

## 19. Success Criteria

1. `GET /v1/capabilities` returns a unified list aggregated from extensions, actions, and cortex (not SDK libraries)
2. `POST /v1/capabilities/:id/invoke` successfully proxies to extensions (sync) and manual webhooks (sync)
3. Non-callable capabilities (actions, apps) return clear usage instructions instead of errors
4. Actions appear as discoverable capabilities with `callable: false` and usage pointing to work queue API
5. Cortex exports are callable through invoke() in browser only (client-side). API/MCP returns BROWSER_ONLY error with clear message.
6. Operator can see all capabilities, override visibility, and view logs in admin dashboard
7. Registered user can create, manage, test, and publish their own capabilities in profile
8. `aimeat-capabilities.js` SDK works in browser apps
9. MCP tools allow Claude Code / Copilot to list, get, and invoke capabilities
10. Auth level enforcement works: clear error messages guide users to the right auth path
11. Automatic aggregation runs on startup and on system changes, tracks source versions with schemaHash change detection
12. Statistics use append-only buffer with periodic rollup (no write contention on popular capabilities)
13. Manual capabilities can be tested before publishing via `/test` endpoint with schema validation
14. Operator publishing policy (`disabled`/`self_only`/`moderated`/`open`) controls who can publish
15. Moderated flow: pending_review -> operator approve/reject -> active/rejected with reason
16. Webhook domain allowlisting prevents open proxy abuse
17. Webhook requests signed with node's Ed25519 key, no private network egress
18. PII protection: per-capability redactedFields, full input only on errors (auto-deleted 7 days)
19. Trust signals on capabilities: operatorReviewed, vouchCount, codeAudited
20. Dependency version constraints with minVersion and schemaHash change notifications
21. Client-side cortex invoke sends telemetry ping (fire-and-forget, no input, just count + duration)
22. Vouching: POST/DELETE /v1/capabilities/:id/vouch, one per user, cannot vouch own capability
23. Deprecated status with deprecationMessage and replacedBy pointer
24. Per-user invoke quota using existing rate-limit middleware pattern
25. Anonymous users can see public capabilities but invoke requires at least anonymous token
26. Morsel billing on invoke: debit caller, credit owner, network fee applied
27. Extension config (ctx.config) used for secure API key storage, never hardcoded
28. Extension schedules used for periodic data refresh (existing scheduler integration)
