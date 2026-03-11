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
| Re-fetch strategy | Debounced full reload (500ms) | Reuses existing `loadAll()` / per-tab fetch patterns. Avoids complex partial state merging. Debounce prevents hammering during batch operations. |
| Auth mechanism | JWT via query parameter | `EventSource` API doesn't support custom headers. Token passed as `?token=xxx`. |
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
```

## Components

### 1. Event Bus — `src/services/event-bus.ts`

A singleton Node.js `EventEmitter` with a single event type:

```typescript
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(200); // support many SSE clients

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

```
GET /v1/events?token=<jwt>
```

- Validates JWT from query param using existing auth infrastructure
- Sets SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Subscribes to event bus, writes `data: {"domain":"agents","timestamp":1234}\n\n` on each event
- Sends `:keepalive\n\n` every 30 seconds
- Cleans up listener + keepalive interval on `close` event
- No role requirement — any authenticated user can subscribe (admin dashboard already gates on operator role client-side)

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

**Domain mapping** (routes → domain strings):

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

### 4. Client Library — `public/lib/live-updates.js`

```javascript
// Singleton SSE connection with debounced callback support

let es = null;
let listeners = new Set();
let debounceTimer = null;

export function connect(token) {
  if (es) return;
  es = new EventSource(`/v1/events?token=${encodeURIComponent(token)}`);

  es.onmessage = (event) => {
    // Debounce: collect events, fire callback once after 500ms of quiet
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      listeners.forEach(fn => fn());
    }, 500);
  };

  es.onerror = () => {
    // EventSource auto-reconnects; no action needed
  };
}

export function disconnect() {
  if (es) { es.close(); es = null; }
  clearTimeout(debounceTimer);
}

export function onUpdate(callback) {
  listeners.add(callback);
}

export function offUpdate(callback) {
  listeners.delete(callback);
}
```

### 5. Admin Dashboard Integration — `public/views/admin.js`

In the main `useEffect` that runs on mount:

```javascript
import { connect, disconnect, onUpdate, offUpdate } from '/lib/live-updates.js';

// Inside AdminDashboard component, after loadAll is defined:
useEffect(() => {
  if (!session) return;

  connect(session.token);
  onUpdate(loadAll);

  return () => {
    offUpdate(loadAll);
    disconnect();
  };
}, [session, loadAll]);
```

This reuses the existing `loadAll` function (which is already a `useCallback`) as the debounced reload target. No changes to tab components needed.

### 6. Profile Page Integration — `public/views/profile.js`

Profile tabs each manage their own data. Two integration points:

**A. Profile-level stats refresh:**

Each tab calls `onStats()` to update the stats bar. We add SSE subscription at the profile level that triggers a lightweight stats re-fetch.

**B. Per-tab data refresh:**

Each profile tab component that wants live updates adds:

```javascript
import { connect, disconnect, onUpdate, offUpdate } from '/lib/live-updates.js';

// Inside tab component:
useEffect(() => {
  const reload = () => loadData(); // tab's own data loading function
  connect(session.token);
  onUpdate(reload);
  return () => offUpdate(reload);
}, [session]);
```

The `connect()` call is idempotent (the library maintains a singleton connection), so multiple tabs calling `connect()` is safe.

### 7. Server Registration — `src/server.ts`

```typescript
import { sseRouter } from './routes/sse.js';
// ...
app.use(sseRouter(config));
```

## Domains

The `domain` field in events is a free-form string. No enum or registry — routes just emit whatever string makes sense. Clients ignore it (they debounce and reload everything). This keeps the system simple and means adding new routes with events requires zero client changes.

## Security

- SSE endpoint requires valid JWT (same validation as all other endpoints)
- Token in query params is acceptable here since SSE connections are long-lived and the token is already short-lived with refresh
- Events contain only domain names, never data payloads — no risk of data leakage through the event stream
- `setMaxListeners(200)` prevents memory leaks from too many connections while supporting reasonable concurrency

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Client loses connection | `EventSource` auto-reconnects with exponential backoff |
| Server restarts | All SSE connections drop; clients reconnect automatically |
| Rapid successive mutations | Debounced to single reload (500ms window) |
| Multiple browser tabs | Each tab opens its own SSE connection; all update independently |
| Unauthenticated user | SSE endpoint returns 401; `EventSource` retries but auth page handles redirect |
| Token expires during SSE | Connection drops on next keepalive or event; client reconnects with fresh token |

## Files to Create

| File | Purpose |
|------|---------|
| `src/services/event-bus.ts` | Singleton EventEmitter with typed change events |
| `src/routes/sse.ts` | SSE endpoint at `/v1/events` |
| `public/lib/live-updates.js` | Browser-side EventSource wrapper with debounce |

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
