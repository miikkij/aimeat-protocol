# SSE Live Updates Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add event-driven live updates to the admin dashboard and profile pages using Server-Sent Events, so the UI automatically refreshes when data changes on the server.

**Architecture:** A singleton EventEmitter (event bus) broadcasts domain-level change events when any route successfully mutates data. An SSE endpoint streams these events to connected browser clients. Clients use a shared library that obtains a single-use ticket (to avoid putting JWTs in URLs), opens an EventSource, and debounces incoming events into a full data reload (2s window).

**Tech Stack:** Node.js EventEmitter, Express SSE route, native browser EventSource API, Preact hooks

**Spec:** `docs/superpowers/specs/2026-03-11-sse-live-updates-design.md`

---

## Chunk 1: Backend Core (Event Bus + SSE Route)

### Task 1: Create Event Bus

**Files:**
- Create: `src/services/event-bus.ts`

- [ ] **Step 1: Create the event bus module**

```typescript
// src/services/event-bus.ts
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(0); // unlimited — each SSE client adds a listener

export interface ChangeEvent {
  domain: string;
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

- [ ] **Step 2: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS — no type errors

- [ ] **Step 3: Commit**

```bash
git add src/services/event-bus.ts
git commit -m "feat: add event bus for SSE live updates"
```

---

### Task 2: Create SSE Route (Ticket + Stream)

**Files:**
- Create: `src/routes/sse.ts`
- Modify: `src/server.ts` (add import + mount)

- [ ] **Step 1: Create the SSE route module**

```typescript
// src/routes/sse.ts
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { onChangeEvent, offChangeEvent } from '../services/event-bus.js';
import type { ChangeEvent } from '../services/event-bus.js';

interface Ticket {
  sub: string;
  expires: number;
}

const tickets = new Map<string, Ticket>();

// Periodic cleanup of expired tickets (every 60s)
setInterval(() => {
  const now = Date.now();
  for (const [id, t] of tickets) {
    if (t.expires < now) tickets.delete(id);
  }
}, 60_000);

export function sseRouter(config: AimeatConfig, _storage: Storage): Router {
  const router = Router();

  // Ticket endpoint — exchange JWT for a single-use SSE connection ticket
  router.post('/v1/events/ticket', requireAuth(), (req, res) => {
    const ticket = randomBytes(32).toString('hex');
    tickets.set(ticket, {
      sub: req.auth!.sub,
      expires: Date.now() + 30_000, // 30 seconds
    });
    res.json(success(config.nodeId, { ticket, expires: 30 }));
  });

  // SSE stream — validates ticket, streams change events
  router.get('/v1/events', (req, res) => {
    const ticketId = req.query.ticket as string;
    if (!ticketId) {
      res.status(400).json(error(config.nodeId, 'MISSING_TICKET', 'ticket query parameter required'));
      return;
    }

    const t = tickets.get(ticketId);
    if (!t || t.expires < Date.now()) {
      tickets.delete(ticketId);
      res.status(401).json(error(config.nodeId, 'INVALID_TICKET', 'Ticket is invalid or expired'));
      return;
    }

    // Consume the ticket (single-use)
    tickets.delete(ticketId);

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    });
    res.flushHeaders();

    // Keepalive comment every 30s
    const keepalive = setInterval(() => {
      res.write(':keepalive\n\n');
    }, 30_000);

    // Forward change events to this client
    const handler = (evt: ChangeEvent) => {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    };
    onChangeEvent(handler);

    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(keepalive);
      offChangeEvent(handler);
    });
  });

  return router;
}
```

- [ ] **Step 2: Register the SSE router in server.ts**

In `src/server.ts`, add the import near the other route imports (around line 87):

```typescript
import { sseRouter } from './routes/sse.js';
```

Mount it after the auth router but before the maintenance guard (around line 610, after `app.use(authRouter(config, storage));`):

```typescript
app.use(sseRouter(config, storage));
```

The SSE endpoint should be available even during maintenance mode for operator dashboards, so place it before the maintenance guard if desired — or after, which means SSE drops during maintenance. Placing after `authRouter` and before the relay/mirror guards is fine since SSE is available to all authenticated users.

- [ ] **Step 3: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/routes/sse.ts src/server.ts
git commit -m "feat: add SSE route with ticket-based auth"
```

---

## Chunk 2: Client Library + Frontend Integration

### Task 3: Create Client-Side Live Updates Library

**Files:**
- Create: `public/lib/live-updates.js`

- [ ] **Step 1: Create the live-updates module**

```javascript
// public/lib/live-updates.js
// Singleton SSE connection with reference counting and debounced callbacks

let es = null;
let listeners = new Set();
let debounceTimer = null;
let refCount = 0;
let jwtGetter = null;
let reconnectTimer = null;

export async function connect(getJwt) {
  refCount++;
  if (es) return;

  jwtGetter = getJwt;
  await _open();
}

async function _open() {
  const jwt = jwtGetter?.();
  if (!jwt) return;

  try {
    const resp = await fetch('/v1/events/ticket', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwt}` },
    });
    if (!resp.ok) return;
    const body = await resp.json();
    const ticket = body.data.ticket;

    es = new EventSource(`/v1/events?ticket=${encodeURIComponent(ticket)}`);

    es.onmessage = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        listeners.forEach(fn => fn());
      }, 2000);
    };

    es.onerror = () => {
      if (es) { es.close(); es = null; }
      clearTimeout(reconnectTimer);
      if (refCount > 0 && jwtGetter) {
        reconnectTimer = setTimeout(() => {
          if (refCount > 0) _open();
        }, 5000);
      }
    };
  } catch {
    // Network error fetching ticket — retry later
    clearTimeout(reconnectTimer);
    if (refCount > 0) {
      reconnectTimer = setTimeout(() => {
        if (refCount > 0) _open();
      }, 5000);
    }
  }
}

export function disconnect() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) {
    if (es) { es.close(); es = null; }
    clearTimeout(debounceTimer);
    clearTimeout(reconnectTimer);
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

- [ ] **Step 2: Commit**

```bash
git add public/lib/live-updates.js
git commit -m "feat: add client-side SSE live-updates library"
```

---

### Task 4: Integrate Live Updates into Admin Dashboard

**Files:**
- Modify: `public/views/admin.js`

- [ ] **Step 1: Add the import**

At the top of `public/views/admin.js`, add with the other imports (after line 13 `import * as api from '/js/services/admin.js';`):

```javascript
import { connect, disconnect, onUpdate, offUpdate } from '/lib/live-updates.js';
```

- [ ] **Step 2: Add SSE subscription useEffect**

Inside the `AdminDashboard` component, after the existing `useEffect` that calls `loadAll` on session change (after line 284 `}, [session, loadAll]);`), add a new `useEffect`:

```javascript
  // SSE live updates — auto-reload on server-side data changes
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

Note: `getSession` is already imported from `/js/services/auth.js` on line 12.

- [ ] **Step 3: Verify no type/syntax errors**

Open the admin dashboard in a browser and check the console for errors. The SSE connection will fail (no events emitted yet) but should not crash.

- [ ] **Step 4: Commit**

```bash
git add public/views/admin.js
git commit -m "feat: admin dashboard subscribes to SSE live updates"
```

---

### Task 5: Integrate Live Updates into Profile Page

**Files:**
- Modify: `public/views/profile.js`

- [ ] **Step 1: Add the import**

At the top of `public/views/profile.js`, add with the other imports (after line 8 `import { getSession, getNodeUrl, onAuthChange } from '/js/services/auth.js';`):

```javascript
import { connect, disconnect, onUpdate, offUpdate } from '/lib/live-updates.js';
```

- [ ] **Step 2: Add SSE subscription for profile-level refresh**

Profile tabs manage their own data, but we can trigger a global event that tabs can listen for. Add a `useEffect` inside the `Profile` component, after the `useViewCSS` call (after line 101):

```javascript
  // SSE live updates — broadcast custom event so tabs can re-fetch
  useEffect(() => {
    if (!session) return;
    const notifyTabs = () => {
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
    };
    connect(() => getSession()?.jwt);
    onUpdate(notifyTabs);
    return () => {
      offUpdate(notifyTabs);
      disconnect();
    };
  }, [session]);
```

This dispatches a `window` custom event that individual tabs can listen for to re-fetch their data. This approach avoids importing `live-updates.js` in every single tab file — tabs just listen for the DOM event.

> **Spec deviation note:** The spec shows each tab importing `live-updates.js` directly with per-tab `connect()`/`disconnect()`. This plan simplifies to a single connection at the profile level with DOM events, avoiding ref-counting across 12+ tab files. The profile component owns the SSE lifecycle; tabs are passive listeners.

- [ ] **Step 3: Add live update listener to profile tabs**

For each profile tab that should support live updates, add a `useEffect` that listens for the `aimeat-live-update` event and calls the tab's data loading function. Here's the pattern to add inside each tab component, after its existing data-loading `useEffect`:

```javascript
  // Live update listener
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [loadData]);
```

Apply this pattern to the following tabs (adjusting the function name to match each tab's load function):

| Tab file | Load function to call |
|----------|----------------------|
| `profile/agents-tab.js` | `loadData` |
| `profile/boards-tab.js` | `loadMyData` |
| `profile/chat-sessions-tab.js` | `loadData` |
| `profile/data-wallet-tab.js` | `loadConsents` (primary) |
| `profile/federation-tab.js` | `loadData` |
| `profile/knowledge-tab.js` | `loadPackages` |
| `profile/mcp-tab.js` | `loadData` |
| `profile/memory-tab.js` | `loadMemories` |
| `profile/node-stats-tab.js` | `loadData` |
| `profile/nodes-tab.js` | `loadData` |
| `profile/organisms-tab.js` | `loadData` |
| `profile/wallet-tab.js` | `loadData` |

**Important:** Some load functions are plain `async function` declarations, not `useCallback`. For these, the DOM event approach avoids the stale closure issue — the event listener calls the load function from the component's current render scope. If any tab has a stale closure issue (the event listener calls an old version of the function), wrap the load function in `useCallback` with appropriate dependencies.

**Tabs intentionally excluded** (static/rarely-changing data — not worth live updates):
- `portfolio-tab.js` — navigational only, no data loading
- `access-tab.js` — static session data
- `apps-tab.js` — static app registry
- `services-tab.js` — static service listing
- `extensions-tab.js` — static extension registry
- `security-tab.js` — CORS config, infrequent changes
- `notifications-tab.js` — push subscription config
- `work-tab.js` — can be added later if needed

- [ ] **Step 4: Verify no errors**

Open the profile page in a browser and check the console for errors.

- [ ] **Step 5: Commit**

```bash
git add public/views/profile.js public/views/profile/*.js
git commit -m "feat: profile page and tabs subscribe to SSE live updates"
```

---

## Chunk 3: Route Integration (Emitting Events)

### Task 6: Add emitChange() to Core Route Files (Batch 1)

**Files to modify:** `src/routes/agents.ts`, `src/routes/owners.ts`, `src/routes/memory.ts`, `src/routes/boards.ts`, `src/routes/wallet.ts`, `src/routes/work.ts`, `src/routes/actions.ts`

For each file:
1. Add `import { emitChange } from '../services/event-bus.js';` at the top
2. After each `res.json(success(...))` or `res.status(...).json(success(...))` call in a POST/PUT/PATCH/DELETE handler, add `emitChange('<domain>');`

- [ ] **Step 1: agents.ts** — Add import + `emitChange('agents')` after every mutation success response

- [ ] **Step 2: owners.ts** — Add import + `emitChange('owners')` after every mutation success response

- [ ] **Step 3: memory.ts** — Add import + `emitChange('memory')` after every mutation success response

- [ ] **Step 4: boards.ts** — Add import + `emitChange('boards')` after every mutation success response

- [ ] **Step 5: wallet.ts** — Add import + `emitChange('wallet')` after every mutation success response

- [ ] **Step 6: work.ts** — Add import + `emitChange('work')` after every mutation success response

- [ ] **Step 7: actions.ts** — Add import + `emitChange('actions')` after every mutation success response

- [ ] **Step 8: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/routes/agents.ts src/routes/owners.ts src/routes/memory.ts src/routes/boards.ts src/routes/wallet.ts src/routes/work.ts src/routes/actions.ts
git commit -m "feat: emit SSE change events from core routes"
```

---

### Task 7: Add emitChange() to Extended Route Files (Batch 2)

**Files to modify:** `src/routes/admin.ts`, `src/routes/consent.ts`, `src/routes/organisms.ts`, `src/routes/chat-instances.ts`, `src/routes/push.ts`, `src/routes/csm.ts`, `src/routes/msm.ts`, `src/routes/federation.ts`, `src/routes/schemas.ts`, `src/routes/flags.ts`, `src/routes/matches.ts`

Same pattern as Task 6:
1. Add `import { emitChange } from '../services/event-bus.js';`
2. Add `emitChange('<domain>')` after each mutation success response

- [ ] **Step 1: admin.ts** — `emitChange('config')` for config changes, `emitChange('maintenance')` for maintenance toggle

- [ ] **Step 2: consent.ts** — `emitChange('consent')`

- [ ] **Step 3: organisms.ts** — `emitChange('organisms')`

- [ ] **Step 4: chat-instances.ts** — `emitChange('chat')`

- [ ] **Step 5: push.ts** — `emitChange('push')`

- [ ] **Step 6: csm.ts** — `emitChange('csm')`

- [ ] **Step 7: msm.ts** — `emitChange('msm')`

- [ ] **Step 8: federation.ts** — `emitChange('federation')`

- [ ] **Step 9: schemas.ts** — `emitChange('schemas')`

- [ ] **Step 10: flags.ts** — `emitChange('flags')`

- [ ] **Step 11: matches.ts** — `emitChange('matches')`

- [ ] **Step 12: catalogue.ts** — `emitChange('catalogue')`

- [ ] **Step 13: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add src/routes/admin.ts src/routes/consent.ts src/routes/organisms.ts src/routes/chat-instances.ts src/routes/push.ts src/routes/csm.ts src/routes/msm.ts src/routes/federation.ts src/routes/schemas.ts src/routes/flags.ts src/routes/matches.ts src/routes/catalogue.ts
git commit -m "feat: emit SSE change events from extended routes"
```

---

### Task 8: Add emitChange() to Remaining Route Files (Batch 3)

**Files to modify:** `src/routes/knowledge.ts`, `src/routes/ghii.ts`, `src/routes/site.ts`, `src/routes/prompts.ts`, `src/routes/storage-files.ts`, `src/routes/apps.ts`, `src/routes/marketplace.ts`, `src/routes/disputes.ts`, `src/routes/permissions.ts`, `src/routes/realtime.ts`, `src/routes/portfolio.ts`, `src/routes/extensions.ts`, `src/routes/appeals.ts`, `src/routes/totp.ts`, `src/routes/verification.ts`, `src/routes/mcp.ts`, `src/routes/admin-features.ts`, `src/routes/cortex.ts`, `src/routes/personal.ts`, `src/routes/admin-scheduler.ts`, `src/routes/admin-extensions.ts`

Same pattern — import + `emitChange('<domain>')` after each mutation success response. Domain strings per the spec's domain mapping table.

- [ ] **Step 1: knowledge.ts** — `emitChange('knowledge')`
- [ ] **Step 2: ghii.ts** — `emitChange('ghii')`
- [ ] **Step 3: site.ts** — `emitChange('site')`
- [ ] **Step 4: prompts.ts** — `emitChange('prompts')`
- [ ] **Step 5: storage-files.ts** — `emitChange('files')`
- [ ] **Step 6: apps.ts** — `emitChange('apps')`
- [ ] **Step 7: marketplace.ts** — `emitChange('marketplace')`
- [ ] **Step 8: disputes.ts** — `emitChange('disputes')`
- [ ] **Step 9: permissions.ts** — `emitChange('permissions')`
- [ ] **Step 10: realtime.ts** — `emitChange('realtime')`
- [ ] **Step 11: portfolio.ts** — `emitChange('portfolio')`
- [ ] **Step 12: extensions.ts** — `emitChange('extensions')`
- [ ] **Step 13: appeals.ts** — `emitChange('appeals')`
- [ ] **Step 14: totp.ts** — `emitChange('totp')`
- [ ] **Step 15: verification.ts** — `emitChange('verification')`
- [ ] **Step 16: mcp.ts** — `emitChange('mcp')`
- [ ] **Step 17: admin-features.ts** — `emitChange('features')`
- [ ] **Step 18: cortex.ts** — `emitChange('cortex')`
- [ ] **Step 19: personal.ts** — `emitChange('personal')`
- [ ] **Step 20: admin-scheduler.ts** — `emitChange('scheduler')`
- [ ] **Step 21: admin-extensions.ts** — `emitChange('admin-extensions')`

- [ ] **Step 22: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 23: Commit**

```bash
git add src/routes/knowledge.ts src/routes/ghii.ts src/routes/site.ts src/routes/prompts.ts src/routes/storage-files.ts src/routes/apps.ts src/routes/marketplace.ts src/routes/disputes.ts src/routes/permissions.ts src/routes/realtime.ts src/routes/portfolio.ts src/routes/extensions.ts src/routes/appeals.ts src/routes/totp.ts src/routes/verification.ts src/routes/mcp.ts src/routes/admin-features.ts src/routes/cortex.ts src/routes/personal.ts src/routes/admin-scheduler.ts src/routes/admin-extensions.ts
git commit -m "feat: emit SSE change events from all remaining routes"
```

---

## Chunk 4: Manual Testing & Verification

### Task 9: End-to-End Manual Verification

- [ ] **Step 1: Start the dev server**

Run: `cd aimeat && pnpm dev`

- [ ] **Step 2: Test ticket endpoint**

```bash
# Get a JWT first (use existing auth)
TOKEN=$(curl -s -X POST http://localhost:40050/v1/auth/token -H 'Content-Type: application/json' -d '{"owner":"testowner","secret":"..."}' | jq -r '.data.jwt')

# Request SSE ticket
curl -s -X POST http://localhost:40050/v1/events/ticket -H "Authorization: Bearer $TOKEN" | jq
```

Expected: `{ "ok": true, "data": { "ticket": "...", "expires": 30 } }`

- [ ] **Step 3: Test SSE stream**

```bash
TICKET=$(curl -s -X POST http://localhost:40050/v1/events/ticket -H "Authorization: Bearer $TOKEN" | jq -r '.data.ticket')
curl -N http://localhost:40050/v1/events?ticket=$TICKET
```

Expected: Connection stays open, `:keepalive` comments appear every 30s

- [ ] **Step 4: Test event flow**

With the SSE stream open, make a mutation in another terminal:

```bash
curl -s -X POST http://localhost:40050/v1/memory -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"key":"test-sse","value":"hello"}'
```

Expected: The SSE stream should show `data: {"domain":"memory","timestamp":...}`

- [ ] **Step 5: Test admin dashboard live update**

1. Open the admin dashboard in a browser
2. Open DevTools Network tab, filter by EventStream
3. Verify an SSE connection is established
4. In another tab/terminal, create/modify data via API
5. Verify the dashboard data refreshes automatically within ~2 seconds

- [ ] **Step 6: Test profile page live update**

1. Open the profile page in a browser
2. Verify SSE connection in DevTools
3. Make a change via API
4. Verify profile tab data refreshes

- [ ] **Step 7: Final type-check and build**

Run: `cd aimeat && npx tsc --noEmit && pnpm build`
Expected: Both PASS

- [ ] **Step 8: Commit any final fixes**

```bash
git add -A
git commit -m "fix: address issues found during SSE integration testing"
```
