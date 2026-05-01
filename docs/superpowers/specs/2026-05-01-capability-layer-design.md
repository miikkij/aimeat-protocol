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
  status: 'draft' | 'active' | 'disabled';

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

  // Manual source invocation target (only for source.type === 'manual' && callable === true)
  webhookUrl: string | null;     // HTTP POST target, must accept { input } and return { result }

  // Economy and trust
  cost: { morsels: number; perUnit?: string } | null;
  trustRequired: number | null;

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
All callable capabilities are synchronous: call and get the result immediately.

| source.type | callable | Invoke behavior | Notes |
|-------------|----------|----------------|-------|
| `extension` | true | `POST /v1/ext/:extName/:actionId` | Sync, WASM sandbox, result returned immediately |
| `manual` | true | HTTP POST to `webhookUrl` | Sync, user-provided endpoint, must return `{ result }` |
| `action` | false | Returns 400 NOT_CALLABLE | Actions use the async work queue. Usage field explains: "POST /v1/work/request" |
| `cortex` | false | Returns 400 NOT_CALLABLE | Usage field explains how to load and use the cortex module |
| `app` | false | Returns 400 NOT_CALLABLE | Usage field explains how to access the app |

Actions are deliberately NOT callable through the capability invoke proxy.
The work queue is an async business process (request, accept, deliver, rate)
that does not fit a synchronous invoke() pattern. The capability entry
provides discovery (what this action does, its schemas, its cost) and the
usage field guides the developer to use the work queue API directly.

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

3. List all active cortex modules -> create one capability per cortex
   - id: "cortex:{name}"
   - source: { type: "cortex", ref: "cortex:{name}", version: cortex.version }
   - callable: false
   - usage: "Load via <script src='/v1/cortex/{name}/libs/{file}'>"

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

## 8. Storage Layer

### New storage interface methods

```typescript
// CRUD
createCapability(record: CapabilityRecord): Promise<void>
getCapability(id: string): Promise<CapabilityRecord | null>
updateCapability(id: string, updates: Partial<CapabilityRecord>): Promise<void>
deleteCapability(id: string): Promise<void>

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
}): Promise<{ capabilities: CapabilityRecord[]; total: number }>

// Stats
incrementCapabilityStats(id: string, success: boolean, durationMs: number, error?: string): Promise<void>

// Logs
addCapabilityLog(entry: CapabilityLogEntry): Promise<void>
listCapabilityLogs(id: string, filters: { status?: string; page?: number; perPage?: number }): Promise<{ logs: CapabilityLogEntry[]; total: number }>

// Operator
setCapabilityOverride(id: string, override: CapabilityRecord['operatorOverride']): Promise<void>
```

Both SQLite and MongoDB backends must implement these methods.

### CapabilityLogEntry

```typescript
interface CapabilityLogEntry {
  id: string;
  capabilityId: string;
  callerGhii: string;
  input: object;
  status: 'success' | 'error';
  durationMs: number;
  error: string | null;
  timestamp: string;
}
```

Log retention: configurable, default 30 days. Background job cleans old entries.

---

## 9. Files to Create/Modify

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

## 10. Success Criteria

1. `GET /v1/capabilities` returns a unified list aggregated from extensions, actions, and cortex (not SDK libraries)
2. `POST /v1/capabilities/:id/invoke` successfully proxies to extensions (sync) and manual webhooks (sync)
3. Non-callable capabilities (actions, cortex, apps) return clear usage instructions instead of errors
4. Actions appear as discoverable capabilities with `callable: false` and usage pointing to work queue API
5. Operator can see all capabilities, override visibility, and view logs in admin dashboard
6. Registered user can create, manage, test, and publish their own capabilities in profile
7. `aimeat-capabilities.js` SDK works in browser apps
8. MCP tools allow Claude Code / Copilot to list, get, and invoke capabilities
9. Auth level enforcement works: clear error messages guide users to the right auth path
10. Automatic aggregation runs on startup and on system changes, tracks source versions
11. Statistics and error logs are collected for every invoke call
12. Manual capabilities can be tested before publishing via `/test` endpoint with schema validation
