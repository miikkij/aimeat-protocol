# Building a complete Extension + Cortex + App stack on AIMEAT

> **Audience:** App developers (human or AI) building agent-extending tools
> on AIMEAT nodes. Assumes you've read [Extension & Cortex Memory Architecture](../coding-guidelines/extension-memory-architecture.md).
>
> **What you'll build:** A four-layer stack where agents produce data into
> shared memory, an extension exposes server-side actions and external
> integrations, a cortex library wraps memory + extension into a clean API,
> and an HTML5+CSS app gives the user (and agents) a place to see and
> manipulate that data.
>
> **Why it exists:** The four layers each have different powers and trust
> boundaries. Doing the wrong work in the wrong layer is the most common
> way these stacks fail. This guide names the layers, shows the data flow,
> and lists every gotcha we've hit.
>
> **Deciding what to put where (esp. to protect it):** if your goal is to keep
> valuable logic or data out of copyable client code, start with
> [Protecting your work: move business logic into an extension](protecting-your-work-with-extensions.md),
> then come back here for the mechanics.

---

## 1. The four layers, one paragraph each

**Extension** runs in a server-side WASM sandbox. It owns the `ext:{name}`
memory namespace (no one else writes there). It can fetch external APIs,
run scheduled jobs, and read other namespaces via `ctx.memory.getPublic()`.
It can also create tasks for agents (since v1.14). It is the only layer
trusted to call out to the internet.

**Cortex lib** is a browser IIFE registered as a JavaScript module on the
node. It runs as the user's authenticated browser session. It reads
extension memory (public, unauthenticated), reads/writes owner memory
(authenticated), and calls extension actions. It exports a clean public
API as `AIMEAT.{libname}.method(...)`. The cortex is where reusable
business logic lives — multiple apps can share it.

**Cortex appdomain** is just a special-purpose cortex lib that composes
multiple data + feature cortex libs into one façade for a specific
application. The naming is a generator-pipeline convention; mechanically
it's a regular cortex lib that imports other cortex libs and re-exports
their composed API. Skip it for simple apps; use it when you have
several feature cortexes that share auth, i18n, settings.

**App** is plain HTML5 + CSS + JS loaded inline from
`/v1/apps/<gaii>/<filename>?mode=inline`. It is allowed to call cortex
public methods only — never extensions directly, never raw memory routes.
Its job is presentation, navigation, layout, responsive behavior. All
data and logic live one layer down.

---

## 2. Picture: who can call whom

```
┌──────────────────────────────────────────────────────────────────┐
│  APP  (HTML/CSS/JS, runs in browser)                              │
│  Allowed: AIMEAT.{cortex-lib}.method()                            │
│  Allowed: AIMEAT.auth, AIMEAT.data, AIMEAT.storage, AIMEAT.ai     │
│  Forbidden: callExt(), readExtMemory(), /v1/ext/, /v1/memory/ext: │
└──────────────────────┬───────────────────────────────────────────┘
                       │ method calls (JS, in-page)
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  APPDOMAIN CORTEX  (browser IIFE, optional)                       │
│  Composes feature cortex libs into one API                        │
│  Adds auth + i18n + settings initialization                       │
└──────────────────────┬───────────────────────────────────────────┘
                       │ method calls (JS, in-page)
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  FEATURE / DATA CORTEX LIBS  (browser IIFE)                       │
│  readExtMemory(name, key)  → GET /v1/memory/ext:name/key (public) │
│  readOwnerMemory(key)      → GET /v1/memory/key (auth required)   │
│  writeOwnerMemory(key, v)  → PUT /v1/memory/key (auth required)   │
│  callExt(name, action, b)  → POST /v1/ext/name/action (auth req.) │
│  AIMEAT.ai.complete(...)   → POST /v1/ai/complete (user's key)    │
└──────────────────────┬───────────────────────────────────────────┘
                       │ HTTP
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  EXTENSION  (QuickJS WASM, server-side)                           │
│  ctx.memory.get/set(key)   → owns ext:{name} namespace            │
│  ctx.memory.getPublic(ns, key) → cross-read any public namespace  │
│  ctx.fetch(url, opts)      → external HTTP                        │
│  ctx.task.create(agent, t) → enqueue work for an agent (v1.14+)   │
│  ctx.notify(channel, msg)  → SSE event to subscribed clients      │
│  ctx.consent.check(scope)  → consent-gated operations             │
└──────────────────────┬───────────────────────────────────────────┘
                       │ persists to
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  AIMEAT NODE STORAGE                                              │
│  Memory (SQLite or MongoDB) — key-value with visibility flag      │
│  Storage (file blobs)                                             │
│  Agents (registered AI identities with GAII)                      │
└──────────────────────────────────────────────────────────────────┘
                       ▲
                       │ same HTTP API
┌──────────────────────┴───────────────────────────────────────────┐
│  AGENTS  (Claude / GPT / etc. with this user's GAII)              │
│  Can call any /v1/ route their scopes allow                       │
│  Typically: read memory, write memory, call extensions,           │
│  complete tasks assigned to them                                  │
└──────────────────────────────────────────────────────────────────┘
```

The agent is **just another HTTP client** with a GAII JWT. It uses the
same routes the cortex uses, just with a different identity. Every
extension action and memory read/write you expose is callable by agents
out of the box.

---

## 3. Designing the data first

Before touching code, decide three things:

### 3.1 The memory key map

Pick a namespace prefix that's unique to your app (e.g., `mytool.`). List
every key your stack will read or write:

| Key | Owner | Visibility | Producer | Consumer |
|-----|-------|-----------|----------|----------|
| `ext:mytool/items` | extension | public | extension `addItem` action | cortex `listItems()` |
| `ext:mytool/cache.{id}` | extension | public | extension scheduled job | cortex `getDetail(id)` |
| `mytool.preferences` | owner | private | app (via cortex `savePrefs`) | cortex `getPrefs()` |
| `mytool.notes` | owner | private | agent (direct API or cortex) | app reads via cortex |

**Rules of thumb:**
- **Shared, structured, agent-generated data → extension namespace** so
  cortex can read it without auth and you don't need to send the user's
  JWT into background jobs.
- **User-personal preferences → owner namespace** so they're private and
  travel with the user across apps.
- **Anything an agent produces that the app should display → owner
  namespace** (agent has the user's GAII and writes to owner ns
  naturally) unless the data must be shared cross-user.

### 3.2 The action map

List every operation. Each is either:
- A **memory read** (cortex does it directly, no extension needed)
- A **memory write** with simple validation (cortex does it)
- An **extension action** (needed if: external API call, complex
  validation, scheduling, cross-namespace cleanup, or hidden secrets)

| Operation | Implementer | Why |
|-----------|------------|-----|
| `listItems()` | cortex | pure memory read from `ext:mytool/items` |
| `getDetail(id)` | cortex with extension fallback | memory hit if cached, extension fetches from external API on miss |
| `addItem(payload)` | extension | needs to validate against external service before storing |
| `assignToAgent(itemId, agentName)` | extension | creates a task for the agent via `ctx.task.create` |
| `setPrefs(json)` | cortex | writes owner namespace, no validation needed |

### 3.3 The agent contact surface

Decide which extension actions are **safe for agents to call directly**.
Most should be: if an agent has the user's GAII, it's the user. The
exceptions:

- Actions that **spend money** (AI calls, external API calls with cost)
  should require explicit owner approval or a scope check
- Actions that **change irreversible state** (delete, publish, share)
  should be gated by `requireRole('owner')` or `requireScope('mytool:write')`
- **Read** actions are almost always fine for agents

The agent surface is just your normal extension API; you decide which
parts are public.

---

## 4. Building the extension

### 4.1 Manifest (`manifest.yaml`)

The server validates this shape strictly (`buildExtensionRecordFromManifest` in
`src/routes/extensions.ts`): the identity fields live under a `metadata:` block,
and **every action requires `id`, `method`, `path`, AND `script`** — an action
missing `method`/`path` fails the whole install with `INVALID_MANIFEST`.

```yaml
metadata:
  name: mytool
  version: 0.1.0
  description: Whatever your tool does
  author: yourhandle
actions:
  - id: addItem
    method: POST
    path: /addItem
    script: scripts/actions/add-item.js
    description: Validate and store a new item
  - id: getDetail
    method: POST
    path: /getDetail
    script: scripts/actions/get-detail.js
    description: Fetch item detail, cache it
  - id: assignToAgent
    method: POST
    path: /assignToAgent
    script: scripts/actions/assign-to-agent.js
    description: Create a task for an agent
  - id: activate  # special name, runs on install
    method: POST
    path: /activate
    script: scripts/actions/activate.js
    description: Seed initial data, copy owner translations
schedules:
  - id: refreshAll
    cron: "0 */6 * * *"  # every 6 hours
    script: scripts/actions/refresh-all.js
```

### 4.2 Activate action

Run-once initialization. Copies owner-namespace seed data (translations,
settings) into the extension namespace where cortex can read them
unauthenticated.

```javascript
// scripts/actions/activate.js
export default async function(ctx, input) {
  // Read owner-side seed data (translations, settings authored at install)
  const fi = await ctx.memory.getPublic(ctx.caller.gaii, 'mytool.i18n.fi');
  const en = await ctx.memory.getPublic(ctx.caller.gaii, 'mytool.i18n.en');
  const settings = await ctx.memory.getPublic(ctx.caller.gaii, 'mytool.settings');

  // Copy to extension namespace (public, unauthenticated reads)
  if (fi) await ctx.memory.set('i18n.fi', fi);
  if (en) await ctx.memory.set('i18n.en', en);
  if (settings) await ctx.memory.set('settings', settings);

  // Initialize empty collections so cortex can read them safely
  if (!(await ctx.memory.get('items'))) await ctx.memory.set('items', []);

  return { success: true, seeded: !!fi };
}
```

**Critical sandbox rule:** the ONLY top-level statement allowed is
`export default async function`. No top-level `const`, `let`, `function`,
or `class`. Helpers go INSIDE the default function. The sandbox crashes
silently if you violate this.

### 4.3 Action that creates a task for an agent

This is how you let the cortex/app dispatch work to an agent (the
"hallittu agenttien laajentaminen ja yhteys" the user described):

```javascript
// scripts/actions/assign-to-agent.js
export default async function(ctx, input) {
  // input: { itemId, agentName, instructions }
  if (!input || !input.itemId || !input.agentName) {
    return { error: 'itemId and agentName required' };
  }

  // Verify the agent belongs to the caller — without this, anyone could
  // delegate tasks to anyone's agents.
  const agents = await ctx.api.get('/v1/agents');  // returns owner's agents
  const target = (agents.items || []).find(a => a.name === input.agentName);
  if (!target) return { error: 'Agent not found in your account' };

  // Read the item from our namespace
  const items = (await ctx.memory.get('items')) || [];
  const item = items.find(i => i.id === input.itemId);
  if (!item) return { error: 'Item not found' };

  // Create the task. ctx.task.create is the v1.14+ way; alternatively
  // POST /v1/agents/{name}/tasks via ctx.api.post.
  const task = await ctx.api.post(`/v1/agents/${input.agentName}/tasks`, {
    title: 'Process item: ' + (item.title || item.id),
    description: input.instructions || 'See attached data',
    context: { item, source: 'mytool' },
  });

  // Record the assignment in our namespace so the UI can show it
  const assignments = (await ctx.memory.get('assignments')) || [];
  assignments.push({
    itemId: input.itemId,
    agentName: input.agentName,
    taskId: task.id,
    assignedAt: new Date().toISOString(),
  });
  await ctx.memory.set('assignments', assignments);

  // Notify any connected client over SSE
  await ctx.notify('mytool.assignment', { itemId: input.itemId, taskId: task.id });

  return { success: true, taskId: task.id };
}
```

### 4.4 Scheduled job that refreshes data

```javascript
// scripts/actions/refresh-all.js
export default async function(ctx, input) {
  const items = (await ctx.memory.get('items')) || [];
  let refreshed = 0;
  for (const item of items) {
    try {
      const fresh = await ctx.fetch(`https://api.example.com/items/${item.id}`).then(r => r.json());
      await ctx.memory.set(`cache.${item.id}`, fresh);
      refreshed++;
    } catch (e) {
      ctx.log('Failed to refresh ' + item.id + ': ' + e.message);
    }
  }
  await ctx.memory.set('lastRefresh', { at: new Date().toISOString(), count: refreshed });
  return { refreshed };
}
```

### 4.5 Install + activate

Via MCP: `aimeat_extension_install` (inline `manifest` + `scripts` map, or omit both
to get an `upload_url` for a ZIP with `manifest.yaml` at root + `scripts/`), then
`aimeat_extension_activate`.

Via REST the body is **JSON** (`{manifest, scripts}` — manifest is the YAML *string*,
scripts maps each path referenced in the manifest to its source), not a multipart file:

```bash
# First install (POST rejects an existing name with 409):
curl -X POST https://node/v1/extensions \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"manifest": "<manifest.yaml contents>", "scripts": {"scripts/actions/add-item.js": "<source>"}}'

# Redeploy: idempotent upsert — replaces manifest + scripts in place, keeps the
# ext:{name} memory and instances, re-runs @activate jobs when active:
curl -X PUT https://node/v1/extensions/mytool \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"manifest": "...", "scripts": {...}}'

# Activate (runs the activate action; extensions install inactive):
curl -X POST https://node/v1/extensions/mytool/activate -H "Authorization: Bearer $JWT"
```

---

## 5. Building the cortex lib

### 5.1 Spec (`manifest.yaml` for cortex)

The cortex manifest is k8s-style and strictly validated (`parseCortexManifest` in
`src/services/cortex-manifest.ts`): `apiVersion` must be exactly
`cortex.aimeat.org/v1`, `kind` must be `Extension`, `metadata.name` AND
`metadata.namespace` are required, and libs are declared as `spec.components`
entries of `type: lib`. `exports` + `api_surface` feed the capability aggregator —
leave them empty and agents can't discover the lib.

```yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: mytool
  namespace: mytool
  description: Browser API for mytool
  author: yourhandle
spec:
  version: 1.0.0
  components:
    - type: lib
      name: mytool
      filename: mytool.js
      exports:
        - listItems
        - getDetail
        - addItem
      api_surface: "AIMEAT.mytool — listItems(); getDetail(id); addItem(payload)"
```

### 5.2 The lib itself (`libs/mytool.js`)

Cortex libs are IIFEs that attach to `window.AIMEAT.{name}`. They have
access to the cortex internal helpers via the cortex runtime — but only
inside the loader's scope, so they're written as functions that receive
helpers via the IIFE wrapper.

The simplest pattern: write a plain IIFE that uses `AIMEAT.data` and
`session.fetch` directly. Cortex wraps it so private helpers
(`callExt`, `readExtMemory`) are injected.

```javascript
// libs/mytool.js
(function(global) {
  'use strict';

  // ─── Internal helpers from the cortex runtime ───
  // (cortex injects these as locals when loading the lib)
  // function callExt(name, action, body) { ... }
  // function readExtMemory(name, key) { ... }
  // function readOwnerMemory(key) { ... }
  // function writeOwnerMemory(key, value) { ... }

  // ─── Public API ───
  const mytool = {
    // Pure memory read — fast, no auth needed
    async listItems() {
      return (await readExtMemory('mytool', 'items')) || [];
    },

    // Read with extension fallback for cache miss
    async getDetail(id) {
      const cached = await readExtMemory('mytool', `cache.${id}`);
      if (cached) return cached;
      return await callExt('mytool', 'getDetail', { id });
    },

    // Write goes through extension for validation
    async addItem(payload) {
      const result = await callExt('mytool', 'addItem', payload);
      if (result.error) throw new Error(result.error);
      return result;
    },

    // List the caller's agents — useful for the "assign to agent" picker
    async listMyAgents() {
      const resp = await session.fetch('/v1/agents');
      return resp.data?.items || [];
    },

    // Dispatch work to one of caller's agents
    async assignToAgent(itemId, agentName, instructions) {
      const result = await callExt('mytool', 'assignToAgent', {
        itemId, agentName, instructions,
      });
      if (result.error) throw new Error(result.error);
      return result;
    },

    // Owner-private prefs — pure memory write
    async getPrefs() {
      return (await readOwnerMemory('mytool.preferences')) || {};
    },
    async setPrefs(prefs) {
      await writeOwnerMemory('mytool.preferences', prefs);
    },

    // Translations — owner namespace, app loads them once at startup
    async getTranslations(lang) {
      return (await readOwnerMemory(`mytool.i18n.${lang}`))
          || (await readExtMemory('mytool', `i18n.${lang}`))
          || {};
    },
  };

  if (!global.AIMEAT) global.AIMEAT = {};
  global.AIMEAT.mytool = mytool;

})(typeof globalThis !== 'undefined' ? globalThis : window);
```

### 5.3 Install + activate

Via MCP: `aimeat_cortex_install` (inline `manifest` + `libs` map, or upload-mode ZIP
with `manifest.yaml` at root + `libs/`), then `aimeat_cortex_activate`. Note
`aimeat_cortex_install` is CREATE-only — updates go through `PUT /v1/cortex/{name}`.

Via REST the body is **JSON** — `{manifest, libs}` where `libs` maps filename → source
(the `libs` DICT format, not a `lib` object — see Common Mistakes §3):

```bash
# First install (409 CONFLICT if the name exists):
curl -X POST https://node/v1/cortex \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"manifest": "<manifest.yaml contents>", "libs": {"mytool.js": "<source>"}}'

# Update in place:
curl -X PUT https://node/v1/cortex/mytool \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"manifest": "...", "libs": {...}}'

# New code only loads through a deactivate → activate cycle (activate alone is
# idempotent and SKIPS reloading an already-active cortex — §5.4):
curl -X POST https://node/v1/cortex/mytool/deactivate -H "Authorization: Bearer $JWT"
curl -X POST https://node/v1/cortex/mytool/activate -H "Authorization: Bearer $JWT"
```

Apps load it with `<script src="/v1/cortex/mytool/libs/mytool.js"></script>`.

### 5.4 Re-activation pitfall

Re-activating an already-active cortex SKIPS the activation step
silently. To deploy new lib code:

```bash
aimeat_cortex_deactivate --name mytool
aimeat_cortex_activate --name mytool
```

Or delete + install:

```bash
aimeat_cortex_delete --name mytool
aimeat_cortex_install --file mytool-cortex.zip
aimeat_cortex_activate --name mytool
```

---

## 6. Building the app

### 6.1 Minimal HTML skeleton

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MyTool</title>
  <style>
    /* Single self-contained stylesheet. Avoid CDN frameworks; they often
       fail under the AIMEAT app CSP. */
    body { font-family: system-ui; margin: 0; }
    /* ... */
  </style>
</head>
<body>
<div id="app">Loading…</div>
<script>
(async function() {
  // ─── Load required libs ───
  // Helper: load a script tag and wait for it
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  // AIMEAT.auth + AIMEAT.data are always available — node serves them.
  await loadScript('/v1/libs/aimeat-auth.js');
  await loadScript('/v1/libs/aimeat-data.js');
  // Optional but recommended:
  await loadScript('/v1/libs/aimeat-storage.js').catch(() => {});
  await loadScript('/v1/libs/aimeat-ai.js').catch(() => {});
  // Your cortex lib:
  await loadScript('/v1/cortex/mytool/libs/mytool.js');

  // ─── Ensure session ───
  const session = await AIMEAT.auth.ensureSession();
  if (!session) {
    document.getElementById('app').innerHTML =
      '<button onclick="AIMEAT.auth.login()">Log in</button>';
    return;
  }

  // ─── Load translations + initial data ───
  const lang = navigator.language.startsWith('fi') ? 'fi' : 'en';
  const tr = await AIMEAT.mytool.getTranslations(lang);
  const items = await AIMEAT.mytool.listItems();
  const agents = await AIMEAT.mytool.listMyAgents();

  // ─── Render ───
  render(items, agents, tr);
})();

function render(items, agents, tr) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <h1>${tr['app.title'] || 'My Tool'}</h1>
    <ul>${items.map(i => `<li>${escapeHtml(i.title)}</li>`).join('')}</ul>
    <select id="agent-pick">
      ${agents.map(a => `<option value="${a.name}">${a.name}</option>`).join('')}
    </select>
    <button onclick="assignSelectedToAgent()">Send to agent</button>
  `;
}

window.assignSelectedToAgent = async function() {
  const agentName = document.getElementById('agent-pick').value;
  // ... assume one item selected
  const itemId = window._selectedItemId;
  const result = await AIMEAT.mytool.assignToAgent(itemId, agentName,
    'Please process this item and update notes.');
  alert('Task created: ' + result.taskId);
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[c]);
}
</script>
</body>
</html>
```

### 6.2 Publish the app

```bash
# First time
aimeat_app_publish --filename mytool.html --name MyTool \
  --version 0.1.0 --description "Tool description" \
  --icon "🔧" --category "productivity"
# Returns upload_url. PUT the HTML file to it.
curl -X PUT --data-binary "@mytool.html" \
  -H "Content-Type: text/html" "$UPLOAD_URL"
```

After first publish, **always upload to the same filename**. Mixing
filenames is the #1 source of "why isn't my update live?" confusion.

Verify after every deploy:

```bash
curl -sS "https://node/v1/apps/<gaii>/mytool.html?mode=inline" | grep version
```

---

## 7. Live updates (SSE)

When the extension writes new data (e.g., a scheduled job finishes),
the app should reflect it without manual reload.

### 7.1 Extension emits

```javascript
// inside an extension action or schedule
await ctx.notify('mytool.refreshed', { count: refreshed });
```

### 7.2 App subscribes via the platform's live-update bus

```javascript
// Browser side — works with AIMEAT's profile SSE plumbing
window.addEventListener('aimeat-live-update', (ev) => {
  if (ev.detail?.channel === 'mytool.refreshed') {
    reloadItems();
  }
});
```

If you're outside the profile (a standalone app), open SSE directly:

```javascript
const ticket = await session.fetch('/v1/events/ticket', { method: 'POST' });
const sse = new EventSource(`/v1/events?ticket=${ticket.data.ticket}`);
sse.addEventListener('mytool.refreshed', (ev) => {
  reloadItems(JSON.parse(ev.data));
});
```

---

## 8. Agents reading/writing the same data

This is the part the user asked about specifically: **the same memory keys
your app reads are reachable by agents.** No new API needed.

### 8.1 Agent reads what the app reads

```bash
# Agent's HTTP call (using its own GAII JWT)
curl -H "Authorization: Bearer $AGENT_JWT" \
  https://node/v1/memory/ext%3Amytool/items
# Returns the same data AIMEAT.mytool.listItems() returns in the browser
```

### 8.2 Agent writes to the same place

For data in the extension namespace, agents must go through extension
actions (since only the extension can write there). For owner namespace
data, agents can write directly:

```bash
# Agent updates owner-namespace notes (data the app reads + displays)
curl -X PUT -H "Authorization: Bearer $AGENT_JWT" \
  -H "Content-Type: application/json" \
  -d '{"value": {"itemId": "x", "notes": "Agent processed this."}}' \
  https://node/v1/memory/mytool.notes.x
```

The app then sees `mytool.notes.x` on next read (or via SSE if you
emit `aimeat-live-update` from the memory write).

### 8.3 Agent picks up tasks the cortex/app assigned

The agent polls or subscribes to its task queue:

```bash
curl -H "Authorization: Bearer $AGENT_JWT" \
  https://node/v1/agents/myagent/tasks?status=queued
```

Reads the `context` field for the data the cortex passed, does the work,
writes results back to memory, and marks the task complete:

```bash
curl -X POST -H "Authorization: Bearer $AGENT_JWT" \
  -d '{"result": {...}}' \
  https://node/v1/agents/myagent/tasks/<id>/complete
```

The app's SSE listener picks up the task completion event and refreshes.

---

## 9. The "agent-data dashboard" pattern, concretely

The user's described use case: **agents produce data into memory; a
cortex+app pair displays it nicely and lets the user (or other agents)
trigger actions on it.**

### 9.1 Setup

1. **Agree on key naming** with your agents. Pick a clear prefix:
   `tasks.{agent}.{date}.{id}`, `findings.{topic}.{id}`, etc.
2. **Write a tiny cortex lib** with one method per query the app needs:
   `listAgentFindings(agent, sinceDate)`, `getFinding(id)`,
   `markReviewed(id)`. Implementations are all `readOwnerMemory` calls
   that filter / sort.
3. **No extension is needed** unless you want server-side filtering
   (large datasets), scheduled aggregation, or external API enrichment.
   Pure cortex+app works for "show me what my agents wrote today".
4. **The app** renders the cortex output — a table, a board, a timeline,
   whatever fits the data. The agents never touch the UI; they just
   write structured JSON into keys the cortex knows to read.

### 9.2 Adding action

When the user wants to act on the data:

1. **App calls cortex** (`AIMEAT.mydash.markReviewed(id)`).
2. **Cortex writes back to owner memory** (`mydash.reviews.{id}`).
3. **Cortex (optionally) creates a follow-up task** for an agent:
   `AIMEAT.mydash.requestRework(id, agentName)` →
   `callExt('mydash', 'createReworkTask', {...})` →
   extension does `POST /v1/agents/{name}/tasks`.

The user sees the action, agents see the task, both sides update the
same memory keys, the dashboard re-renders on SSE.

### 9.3 Schematic

```
   ┌────────────────────────────────────────────────────────────┐
   │ Agent 1 writes              findings.topic.123 ──┐          │
   │ Agent 2 writes              findings.topic.124 ──┤          │
   └──────────────────────────────────────────────────┘          │
                                                                 ▼
   ┌────────────────────────────────────────────────────────────┐
   │ owner-namespace memory                                     │
   │ findings.topic.123, findings.topic.124, ...                │
   └────────────────────────────────────────────────────────────┘
                       ▲                              │
                       │ writeOwnerMemory             │ readOwnerMemory
                       │                              ▼
   ┌────────────────────────────────────────────────────────────┐
   │ cortex lib: AIMEAT.mydash                                  │
   │   listFindings(topic, since)                               │
   │   markReviewed(id)                                         │
   │   assignToAgent(id, agentName)                             │
   └────────────────────────────────────────────────────────────┘
                       ▲              │
                       │              │ assignToAgent
                       │              ▼
                       │   ┌──────────────────────────────┐
                       │   │ extension: ext:mydash         │
                       │   │   creates /v1/agents/.../tasks │
                       │   └──────────────────────────────┘
                       │              │
                       │              ▼
                       │   ┌──────────────────────────────┐
                       │   │ task queue for Agent 3        │
                       │   └──────────────────────────────┘
                       │
   ┌───────────────────┴────────────────────────────────────────┐
   │ app (HTML/CSS): table of findings, filter dropdown,        │
   │ "review" button, "assign" agent picker                     │
   └────────────────────────────────────────────────────────────┘
```

---

## 10. Gotchas and pitfalls (numbered for quick reference)

1. **Sandbox top-level rule.** Extension action scripts MUST have ONLY
   `export default async function` at top level. Top-level
   `const`/`let`/`function` crashes silently.

2. **`ctx.caller.gaii` is the GAII, not bare username.** Use it as-is
   when calling `ctx.memory.getPublic()`.

3. **Init copy.** Cortex reads `ext:{name}` namespace. Translations/settings
   authored in owner namespace need to be copied to `ext:{name}` by the
   activate action. Otherwise cortex sees them as missing.

4. **Re-activation is idempotent.** To deploy new cortex code:
   `cortex deactivate` → `cortex activate`. Or delete + reinstall.

5. **session.fetch returns parsed JSON.** Don't call `.json()` on the
   result — it's already an object with `.data`, `.ok`, `.error`.

6. **Wrong callExt URL.** Correct: `/v1/ext/{name}/{action}`. NOT
   `/v1/extensions/{name}/actions/{action}`.

7. **App-vs-cortex boundary violations.** If your app calls
   `session.fetch('/v1/ext/...')` directly, that's a smell. Move the
   call to cortex and expose a clean method.

8. **camelCase vs snake_case drift.** Server-side AIMEAT endpoints
   return `hasApiKey`, `dailyBudget`, etc. Always confirm the actual
   response with `curl` before writing client code against it.

9. **AI completion result shape.** `AIMEAT.ai.complete()` returns
   `{content, model, usage, budget}`. `AIMEAT.ai.completeJson()` returns
   `{...same, parsed}`. Always check the actual shape; don't assume.

10. **max_tokens caps silently truncate.** Prefer the daily-budget
    bound and omit `max_tokens` unless you need a hard ceiling. If you
    DO cap, surface the cap in the UI so users know why output stopped.

11. **AI output is malformed by default.** Models wrap JSON in
    ```` ```json ```` fences, sometimes truncate mid-output, sometimes
    add prose intros. Plan for it: strip fences, repair truncation,
    surface raw output on failure.

12. **Long async needs sticky status.** Toasts auto-fade. Don't rely
    on them as your only "is it working?" signal. Show elapsed seconds
    next to the trigger.

13. **One canonical app filename.** Decide it once, document it at the
    top of the HTML, never deploy elsewhere. Verify after every PUT
    with `curl ?mode=inline | grep version`.

14. **Agent task `context` is the contract.** Whatever you put in
    `context` when creating a task is what the agent reads. Keep it
    minimal but complete; agents can't see your cortex state.

15. **CSP for inline apps.** Apps served via `/v1/apps/.../?mode=inline`
    run under a moderate CSP. External CDN scripts may be blocked.
    Bundle / inline what you can; only load from `/v1/libs/`,
    `/v1/cortex/`, or same-origin `/v1/storage/`.

---

## 11. Build order checklist

When starting a new ext+cortex+app stack:

- [ ] Pick a unique namespace name (`mytool`)
- [ ] Write the memory key map (§3.1)
- [ ] Write the action map (§3.2)
- [ ] Identify which actions agents should be allowed to call (§3.3)
- [ ] Build the extension first (manifest + activate + actions)
  - [ ] Install, activate, smoke-test each action via `curl`
- [ ] Build the cortex lib next
  - [ ] Implement one method at a time
  - [ ] Verify each with a browser console call before moving on
- [ ] Build the app last
  - [ ] Skeleton: load libs, ensure session, render placeholder
  - [ ] Wire one feature at a time, check Network tab and console
  - [ ] Add SSE for live updates only after happy path works
- [ ] Document the agent contact surface in the app's README
- [ ] Add a smoke test: log in → click main button → see result

---

## 12. Reference reading

- `docs/coding-guidelines/extension-memory-architecture.md` — the trust
  boundaries spelled out, with code refs
- `docs/app-developer-ai-guide.md` — using `AIMEAT.ai.complete()` from
  apps and cortex libs
- `docs/app-developer-libraries-research.md` — the design rationale for
  `AIMEAT.{auth,data,storage,social,wallet,ai}` libs
- `docs/generator-guide.md` — the generator pipeline that produces
  ext+cortex+app stacks automatically (helpful for naming conventions)
- `docs/plans/2026-05-29-comicland-ai-session-audit.md` — concrete
  lessons from one full session of iterating on a stack like this
- `aimeat/src/routes/agent-tasks.ts` — every task API endpoint with
  description (line 7–17)
- `aimeat/src/routes/extensions.ts` — extension runtime, namespace
  ownership, `ctx.memory` implementation

---

## 13. When NOT to build a full stack

Two cases where one or more layers is overkill:

- **Pure-app, no shared state, no agents.** A static dashboard that
  reads only the user's own memory keys — use `AIMEAT.data` directly,
  skip cortex AND extension. The app becomes ~200 lines of HTML.

- **No UI, pure agent-side.** An agent writes data, another agent reads
  it — both via `/v1/memory/`. No browser involvement. Skip cortex AND
  app; the extension may be useful for scheduling but isn't required.

Use the four-layer pattern when the value is in the **app providing a
nice surface on top of agent-produced data, with the app able to
trigger agent work in return.** That's the sweet spot this guide
optimizes for.
