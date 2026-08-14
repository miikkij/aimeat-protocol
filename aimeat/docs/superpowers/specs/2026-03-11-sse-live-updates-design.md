# SSE Live Updates — Design Spec

**Date:** 2026-03-11
**Status:** Draft

## Problem

The admin dashboard and profile page only update when the user manually refreshes or performs an action that triggers `reload()`. When data changes (via API calls, other users, federation sync, etc.), the UI shows stale information until the next manual refresh.

## Solution

Server-Sent Events (SSE) with a "broadcast-on-save" pattern. When any API route successfully mutates data, it emits a lightweight domain event. Connected clients receive these events and debounce a full data reload.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Transport | SSE (not WebSocket) | Unidirectional server→client is all we need. Simpler than extending the existing WebSocket realtime room system. Native browser reconnection via `EventSource`. |
| Event granularity | Domain-level ("agents changed") | Not field-level or full-payload. Client decides whether to re-fetch. Minimal coupling between backend emitter and frontend consumer. |
| Re-fetch strategy | Debounced full reload (2s) | Reuses existing `loadAll()` / per-tab fetch patterns. Avoids complex partial state merging. 2s debounce prevents hammering during batch operations (admin dashboard makes ~30 API calls per reload). |
| Auth mechanism | Ticket-based (short-lived nonce) | `EventSource` API doesn't support custom headers. A single-use ticket is obtained via `POST /v1/events/ticket` (authenticated with normal Bearer JWT), then passed as `?ticket=xxx` to the SSE endpoint. The ticket is consumed on connect and cannot be replayed. This avoids putting JWTs in URLs (which the codebase explicitly prohibits). |
| Event source | Route handlers (not storage layer) | No changes to `Storage` interface. Routes call `eventBus.emit()` after successful mutations. Easy to add incrementally. |

## Architecture

```
┌─────────────┐     emit('change',{domain})     ┌──────────────┐
│  Route       │ ──────────────────────────────► │  EventBus    │
│  Handler     │                                 │  (singleton) │
└─────────────┘                                  └──────┬───────┘
                                                        │
                                                        │ forEach(client)
                                                        ▼
                                                 ┌──────────────┐
                                                 │  SSE Route   │
                                                 │  /v1/events  │
                                                 │              │
                                                 │  client1 ──► EventSource
                                                 │  client2 ──► EventSource
                                                 └──────────────┘

┌─────────────┐  POST /v1/events/ticket   ┌──────────────┐
│  Browser     │ ────────────────────────► │  Ticket      │
│  (with JWT)  │ ◄──── { ticket: "abc" }  │  Endpoint    │
└──────┬──────┘                           └──────────────┘
       │
       │  GET /v1/events?ticket=abc
       ▼
┌──────────────┐
│  SSE Stream  │
└──────────────┘
```

## Components

### 1. Event Bus — `src/services/event-bus.ts`

A singleton Node.js `EventEmitter` with a single event type:

```typescript
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(0); // unlimited — each SSE client adds a listener

export interface ChangeEvent {
  domain: string;   // e.g. 'agents', 'memory', 'boards', 'config', 'wallet'
  timestamp: number;
}

export function emitChange(domain: string): void {
  bus.emit('change', { domain, timestamp: Date.now() } satisfies ChangeEvent);
}

export function onChangeEvent(handler: (evt: ChangeEvent) => void): void {
  bus.on('change', handler);
}

export function offChangeEvent(handler: (evt: ChangeEvent) => void): void {
  bus.off('change', handler);
}
```

### 2. SSE Route — `src/routes/sse.ts`

**Ticket endpoint (authenticated):**
```
POST /v1/events/ticket
Authorization: Bearer <jwt>
→ success(nodeId, { ticket: "<random-nonce>", expires: 30 })
```

- Requires `requireAuth()` — standard Bearer JWT authentication
- Generates a cryptographically random ticket (32-byte hex)
- Stores it in a `Map<string, { sub: string, expires: number }>` with 30-second TTL
- Returns the ticket to the client

**SSE endpoint (ticket-authenticated):**
```
GET /v1/events?ticket=<nonce>
```

- Looks up ticket in the map, validates it exists and hasn't expired
- Consumes the ticket (deletes from map — single use)
- Sets SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Subscribes to event bus, writes `data: {"domain":"agents","timestamp":1234}\n\n` on each event
- Sends `:keepalive\n\n` every 30 seconds
- Cleans up listener + keepalive interval on `close` event
- No role requirement — any authenticated user can subscribe (admin dashboard already gates on operator role client-side)
- Periodic cleanup of expired tickets (every 60s)

Response format (standard SSE):
```
data: {"domain":"agents","timestamp":1741689600000}

data: {"domain":"memory","timestamp":1741689601000}

:keepalive

```

### 3. Route Integration — Emitting Events

Each route that mutates data adds a single line after the success response:

```typescript
import { emitChange } from '../services/event-bus.js';

// After successful mutation:
res.json(success(config.nodeId, result));
emitChange('agents');
```

**Domain mapping** (routes → domain strings). This is the initial set — additional routes can be wired up incrementally as needed:

| Route file | Domain(s) |
|------------|-----------|
| `agents.ts` | `agents` |
| `owners.ts` | `owners` |
| `memory.ts` | `memory` |
| `boards.ts` | `boards` |
| `wallet.ts` | `wallet` |
| `work.ts` | `work` |
| `actions.ts` | `actions` |
| `admin.ts` | `config`, `maintenance` |
| `consent.ts` | `consent` |
| `catalogue.ts` | `catalogue` |
| `organisms.ts` | `organisms` |
| `chat-instances.ts` | `chat` |
| `push.ts` | `push` |
| `csm.ts` | `csm` |
| `msm.ts` | `msm` |
| `federation.ts` | `federation` |
| `schemas.ts` | `schemas` |
| `flags.ts` | `flags` |
| `matches.ts` | `matches` |
| `knowledge.ts` | `knowledge` |
| `ghii.ts` | `ghii` |
| `site.ts` | `site` |
| `prompts.ts` | `prompts` |
| `storage-files.ts` | `files` |
| `apps.ts` | `apps` |
| `marketplace.ts` | `marketplace` |
| `disputes.ts` | `disputes` |
| `permissions.ts` | `permissions` |
| `realtime.ts` | `realtime` |
| `portfolio.ts` | `portfolio` |
| `extensions.ts` | `extensions` |
| `appeals.ts` | `appeals` |
| `totp.ts` | `totp` |
| `verification.ts` | `verification` |
| `mcp.ts` | `mcp` |
| `admin-features.ts` | `features` |
| `cortex.ts` | `cortex` |
| `personal.ts` | `personal` |
| `admin-scheduler.ts` | `scheduler` |
| `admin-extensions.ts` | `admin-extensions` |

### 4. Client Library — `public/lib/live-updates.js`

```javascript
// Singleton SSE connection with reference counting and debounced callbacks

let es = null;
let listeners = new Set();
let debounceTimer = null;
let refCount = 0;
let jwtGetter = null;

export async function connect(getJwt) {
  // getJwt: () => string|null — a getter function so reconnection always uses the freshest token
  refCount++;
  if (es) return; // already connected

  jwtGetter = getJwt;
  await _open();
}

async function _open() {
  const jwt = jwtGetter?.();
  if (!jwt) return;

  // Obtain a single-use ticket
  const resp = await fetch('/v1/events/ticket', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${jwt}` },
  });
  if (!resp.ok) return; // auth failed, don't open SSE
  const body = await resp.json();
  const ticket = body.data.ticket;

  es = new EventSource(`/v1/events?ticket=${encodeURIComponent(ticket)}`);

  es.onmessage = (event) => {
    // Debounce: collect events, fire callback once after 2s of quiet
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      listeners.forEach(fn => fn());
    }, 2000);
  };

  es.onerror = () => {
    // On error, close and reconnect after delay using fresh JWT
    if (es) { es.close(); es = null; }
    if (refCount > 0 && jwtGetter) {
      setTimeout(() => {
        if (refCount > 0) _open(); // _open(), not connect() — avoids refCount inflation
      }, 5000);
    }
  };
}

export function disconnect() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) {
    if (es) { es.close(); es = null; }
    clearTimeout(debounceTimer);
    jwtGetter = null;
  }
}

export function onUpdate(callback) {
  listeners.add(callback);
}

export function offUpdate(callback) {
  listeners.delete(callback);
}
```

Key design points:
- **Reference counting**: Multiple components can call `connect()` / `disconnect()` safely. The EventSource only closes when the last consumer disconnects.
- **Ticket-based auth**: Fetches a single-use ticket via authenticated POST, then opens EventSource with that ticket. No JWT in URLs. Ticket response uses the standard AIMEAT envelope (`success(nodeId, { ticket, expires })`).
- **JWT getter pattern**: Accepts `() => string|null` instead of a static JWT string, ensuring reconnection always uses the freshest token even after a token refresh.
- **Manual reconnection**: Since we use ticket auth, `EventSource` native reconnection won't work (ticket is consumed). The `onerror` handler reconnects manually with a new ticket (via the JWT getter) after 5s delay.
- **2s debounce**: Protects against rapid-fire reloads during batch operations.

### 5. Admin Dashboard Integration — `public/views/admin.js`

In the main `useEffect` that runs on mount:

```javascript
import { connect, disconnect, onUpdate, offUpdate } from '/lib/live-updates.js';

// Inside AdminDashboard component, after loadAll is defined:
useEffect(() => {
  if (!session) return;

  connect(() => getSession()?.jwt);
  onUpdate(loadAll);

  return () => {
    offUpdate(loadAll);
    disconnect();
  };
}, [session, loadAll]);
```

This reuses the existing `loadAll` function (which is already a `useCallback`) as the debounced reload target. The JWT getter ensures reconnection always uses the freshest token. No changes to tab components needed.

### 6. Profile Page Integration — `public/views/profile.js`

Profile tabs each manage their own data. Two integration points:

**A. Profile-level stats refresh:**

Each tab calls `onStats()` to update the stats bar. We add SSE subscription at the profile level that triggers a lightweight stats re-fetch.

**B. Per-tab data refresh:**

Each profile tab component that wants live updates adds:

```javascript
import { connect, disconnect, onUpdate, offUpdate } from '/lib/live-updates.js';
import { getSession } from '/js/services/auth.js';

// Inside tab component:
useEffect(() => {
  const reload = () => loadData(); // tab's own data loading function
  connect(() => getSession()?.jwt);
  onUpdate(reload);
  return () => {
    offUpdate(reload);
    disconnect();
  };
}, [session, loadData]);
```

The `connect()` call is ref-counted (the library maintains a singleton connection), so multiple tabs calling `connect()` is safe. Each `disconnect()` decrements the ref count; the EventSource only closes when the last consumer disconnects.

### 7. Server Registration — `src/server.ts`

```typescript
import { sseRouter } from './routes/sse.js';
// ...
app.use(sseRouter(config, storage));
```

Follows the standard `router(config, storage)` signature convention used by all other routers.

## Domains

The `domain` field in events is a free-form string. No enum or registry — routes just emit whatever string makes sense. Clients ignore the domain value (they debounce and reload everything). This keeps the system simple and means adding new routes with events requires zero client changes.

SSE messages use only the `data:` field (no `event:` field), so all events arrive via `onmessage`. If domain-scoped re-fetching is added in the future, adding `event: <domain>` to SSE messages would enable clients to use `es.addEventListener(domain, handler)` for selective listening.

## Security

- SSE ticket endpoint requires valid JWT via standard Bearer auth (same as all other endpoints)
- Tickets are single-use, cryptographically random, and expire after 30 seconds — no replay possible
- JWTs never appear in URLs (compliant with the codebase security policy in `auth/middleware.ts`)
- Events contain only domain names, never data payloads — no risk of data leakage through the event stream
- `setMaxListeners(0)` on the event bus — unlimited listeners; each SSE client adds one

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Client loses connection | `onerror` handler obtains a new ticket and reconnects after 5s |
| Server restarts | All SSE connections drop; clients reconnect with new tickets |
| Rapid successive mutations | Debounced to single reload (2s window) |
| Multiple browser tabs | Each tab opens its own SSE connection; all update independently |
| Unauthenticated user | `connect()` calls ticket endpoint which returns 401; SSE never opens |
| Token expires during SSE | SSE connection stays open (ticket was already consumed). On disconnect/error, reconnect fetches a new ticket using the current JWT — if JWT has expired, ticket fetch fails and SSE stays disconnected until next page load with a fresh session |
| Ticket expires before SSE opens | SSE endpoint returns 401; client reconnects with a new ticket |

## Files to Create

| File | Purpose |
|------|---------|
| `src/services/event-bus.ts` | Singleton EventEmitter with typed change events |
| `src/routes/sse.ts` | Ticket endpoint + SSE stream at `/v1/events` |
| `public/lib/live-updates.js` | Browser-side ticket+EventSource wrapper with ref counting and debounce |

## Files to Modify

| File | Change |
|------|--------|
| `src/server.ts` | Register `sseRouter` |
| `src/routes/*.ts` (mutation routes) | Add `emitChange(domain)` after successful mutations |
| `public/views/admin.js` | Subscribe to live updates, debounced `loadAll()` |
| `public/views/profile.js` | Subscribe to live updates for stats refresh |
| `public/views/profile/*-tab.js` | Individual tabs subscribe for their own data refresh |

## Out of Scope

- Domain-scoped re-fetching (partial reload) — future optimization
- SSE for unauthenticated pages (portal, landing) — not needed
- Event persistence or replay — events are ephemeral notifications
- Multi-node SSE fan-out (federation) — each node serves its own clients
