# Agent-data dashboard — cookbook

> Concrete recipe for the pattern: **agents produce data into memory, an
> app displays it nicely, and the user (or other agents) can trigger
> actions that change the data and dispatch follow-up work to agents.**
>
> Read [Building a complete Extension + Cortex + App stack](./building-extension-cortex-app-stack.md)
> first for the architecture. This doc shows one end-to-end working
> recipe you can clone.
>
> **Example scenario:** A research agent crawls topics and writes
> "findings" into memory. A dashboard app lets the user browse findings,
> mark them reviewed, and dispatch follow-up tasks like "go deeper on
> this finding" back to the same or a different agent.

---

## 1. What you'll build

```
┌────────────────────────────────────────────────────────────┐
│ Research Agent (Claude or any AI with this user's GAII)    │
│  ↓ writes to memory: findings.<topic>.<id>                  │
├────────────────────────────────────────────────────────────┤
│ owner-namespace memory                                      │
│  findings.tech.001 = { title, body, sources[], status }     │
│  findings.tech.002 = { ... }                                │
│  findings.health.001 = { ... }                              │
│  reviews.findings.001 = { reviewedAt, rating, comment }     │
├────────────────────────────────────────────────────────────┤
│ Cortex lib: AIMEAT.findings                                 │
│  list(topic, since)                                         │
│  get(id)                                                    │
│  markReviewed(id, rating, comment)                          │
│  requestDeepDive(id, agentName, instructions)               │
│  listAgents()                                               │
├────────────────────────────────────────────────────────────┤
│ Extension: ext:findings (thin — only for task dispatch)     │
│  Action: createDeepDiveTask                                 │
├────────────────────────────────────────────────────────────┤
│ App (HTML/CSS/JS) — the dashboard the user opens            │
│  Topic filter, findings list, detail view, review form,     │
│  "send back to agent" button with agent picker              │
└────────────────────────────────────────────────────────────┘
```

Three components produced + one assumption (the agent already exists
and has been told to use these key names).

---

## 2. Agreed contract

This is what you tell the research agent (via system prompt or
instructions) before it runs:

> When you finish researching a topic, write findings as JSON to memory
> with this key pattern: `findings.<topic-slug>.<uuid>`. Each finding
> object must have these fields:
>
> ```json
> {
>   "title": "Short heading",
>   "body": "Markdown body",
>   "sources": ["url", "url"],
>   "topic": "tech",
>   "writtenAt": "ISO-8601 timestamp",
>   "status": "new"
> }
> ```
>
> Do not modify `findings.*` entries after writing; use `reviews.findings.<id>`
> for any follow-up.

The contract IS the API. Both sides — the agent producing data and the
app consuming it — are anchored to this shape. Document it in your
project's README, in the agent's instructions, and inline in the cortex.

---

## 3. The extension (`ext:findings`)

We only need an extension because the app dispatches tasks to agents,
and creating a task requires calling `POST /v1/agents/{name}/tasks`
which the cortex can do directly — but if we want server-side validation
(does the agent exist? does the finding exist? is the requester allowed
to assign work?), the extension is the right place.

### 3.1 `manifest.yaml`

```yaml
name: findings
version: 0.1.0
description: Agent-produced findings dashboard helper
author: yourhandle
actions:
  - id: activate
    script: scripts/actions/activate.js
  - id: createDeepDiveTask
    script: scripts/actions/create-deep-dive-task.js
```

### 3.2 `scripts/actions/activate.js`

```javascript
export default async function(ctx, input) {
  // Nothing to seed for this minimal extension; just ack the install.
  return { success: true };
}
```

### 3.3 `scripts/actions/create-deep-dive-task.js`

```javascript
export default async function(ctx, input) {
  // input: { findingId, agentName, instructions }
  if (!input || !input.findingId || !input.agentName) {
    return { error: 'findingId and agentName required' };
  }

  // Fetch the finding from owner namespace
  const finding = await ctx.memory.getPublic(ctx.caller.gaii, 'findings.' + input.findingId);
  if (!finding) return { error: 'Finding not found' };

  // Verify the agent exists for this owner
  const agents = await ctx.api.get('/v1/agents');
  const target = (agents.items || []).find(a => a.name === input.agentName);
  if (!target) return { error: 'Agent not in your account' };

  // Create the task
  const task = await ctx.api.post('/v1/agents/' + input.agentName + '/tasks', {
    title: 'Deep dive: ' + (finding.title || input.findingId),
    description: input.instructions
      || 'Go deeper on this finding. Add new findings under the same topic when done.',
    context: {
      sourceFindingId: input.findingId,
      finding: finding,
      followUpKey: 'findings.' + finding.topic + '.' + Date.now(),
    },
  });

  // Notify any open clients
  await ctx.notify('findings.task-created', {
    findingId: input.findingId, taskId: task.id,
  });

  return { success: true, taskId: task.id };
}
```

### 3.4 Install + activate

```bash
# Bundle scripts/ + manifest.yaml into findings.zip
aimeat_extension_install --file findings.zip
curl -X POST -H "Authorization: Bearer $JWT" \
  https://node/v1/extensions/findings/activate
```

---

## 4. The cortex lib (`AIMEAT.findings`)

### 4.1 `manifest.yaml`

```yaml
spec_version: "1.0.0"
name: findings
version: 1.0.0
libs:
  - findings.js
```

### 4.2 `libs/findings.js`

```javascript
(function(global) {
  'use strict';

  // Helper: scan owner memory for keys matching a prefix
  async function listOwnerKeys(prefix) {
    const resp = await session.fetch('/v1/memory?prefix=' + encodeURIComponent(prefix));
    return resp.data?.items || [];
  }

  const findings = {
    /**
     * List findings, optionally filtered by topic. Returns newest first.
     * Use `since` (ISO timestamp) to only get recent ones.
     */
    async list(topic, since) {
      const prefix = topic ? `findings.${topic}.` : 'findings.';
      const items = await listOwnerKeys(prefix);
      let out = items
        .filter(i => i.key.startsWith(prefix))
        .map(i => ({ id: i.key.replace(/^findings\./, ''), ...i.value }));
      if (since) out = out.filter(f => f.writtenAt >= since);
      out.sort((a, b) => (b.writtenAt || '').localeCompare(a.writtenAt || ''));
      return out;
    },

    /** Fetch one finding by full id (topic.uuid). */
    async get(id) {
      return await readOwnerMemory('findings.' + id);
    },

    /** Record the user's review of a finding. Owner namespace, no extension. */
    async markReviewed(id, rating, comment) {
      const review = {
        findingId: id,
        rating: rating,        // 1-5 or thumbs-up/down — your call
        comment: comment || '',
        reviewedAt: new Date().toISOString(),
      };
      await writeOwnerMemory('reviews.findings.' + id, review);
      return review;
    },

    async getReview(id) {
      return await readOwnerMemory('reviews.findings.' + id);
    },

    /** Dispatch a deep-dive task to an agent. Goes through extension. */
    async requestDeepDive(findingId, agentName, instructions) {
      const result = await callExt('findings', 'createDeepDiveTask', {
        findingId, agentName, instructions,
      });
      if (result.error) throw new Error(result.error);
      return result;
    },

    /** List the user's agents — used for the agent picker dropdown. */
    async listAgents() {
      const resp = await session.fetch('/v1/agents');
      return resp.data?.items || [];
    },

    /** List unique topics the agent(s) have written so far. */
    async listTopics() {
      const items = await listOwnerKeys('findings.');
      const topics = new Set();
      for (const it of items) {
        const m = it.key.match(/^findings\.([^.]+)\./);
        if (m) topics.add(m[1]);
      }
      return Array.from(topics).sort();
    },
  };

  if (!global.AIMEAT) global.AIMEAT = {};
  global.AIMEAT.findings = findings;

})(typeof globalThis !== 'undefined' ? globalThis : window);
```

### 4.3 Install + activate

```bash
aimeat_cortex_install --file findings-cortex.zip
aimeat_cortex_activate --name findings
```

---

## 5. The app (`findings-dashboard.html`)

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Findings dashboard</title>
  <style>
    body { font-family: system-ui; margin: 0; background: #f7f7f8; color: #111; }
    .topbar { background: #111; color: #fff; padding: 10px 16px; display: flex; gap: 12px; align-items: center; }
    .topbar h1 { font-size: 18px; margin: 0; }
    .topbar select, .topbar button { background: #222; color: #fff; border: 1px solid #444; padding: 6px 10px; }
    .layout { display: grid; grid-template-columns: 320px 1fr; min-height: calc(100vh - 50px); }
    .list { background: #fff; border-right: 1px solid #ddd; overflow-y: auto; }
    .list-item { padding: 10px 12px; border-bottom: 1px solid #eee; cursor: pointer; }
    .list-item:hover { background: #f0f0f5; }
    .list-item.selected { background: #e8f0ff; border-left: 3px solid #2a6fd6; }
    .list-item .title { font-weight: 600; }
    .list-item .meta { font-size: 11px; color: #888; }
    .list-item .reviewed { float: right; font-size: 10px; color: #2a8; }
    .detail { padding: 20px; overflow-y: auto; }
    .detail h2 { margin-top: 0; }
    .body { line-height: 1.5; }
    .sources { margin-top: 12px; font-size: 12px; }
    .sources a { color: #2a6fd6; }
    .actions { margin-top: 20px; padding: 12px; background: #fff; border: 1px solid #ddd; }
    .actions h3 { margin: 0 0 8px; font-size: 14px; }
    .actions textarea { width: 100%; min-height: 60px; font-family: inherit; padding: 6px; }
    .actions select { padding: 6px; }
    .actions button { background: #2a6fd6; color: #fff; border: 0; padding: 8px 14px; cursor: pointer; }
    .status { padding: 6px 10px; font-size: 12px; }
    .status.idle { color: #888; }
    .status.success { color: #2a8; }
    .status.error { color: #d42; }
  </style>
</head>
<body>

<div class="topbar">
  <h1>🔍 Findings</h1>
  <select id="topic-filter"><option value="">All topics</option></select>
  <button onclick="loadAll()">↻ Refresh</button>
  <span id="status" class="status idle"></span>
</div>

<div class="layout">
  <div class="list" id="list">Loading…</div>
  <div class="detail" id="detail">
    <p style="color: #999;">Pick a finding from the list to view it.</p>
  </div>
</div>

<script>
let state = { findings: [], topics: [], agents: [], selected: null };

function $(s) { return document.querySelector(s); }
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
function setStatus(msg, level) {
  const el = $('#status');
  el.textContent = msg || '';
  el.className = 'status ' + (level || 'idle');
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function boot() {
  setStatus('Loading libraries…');
  await loadScript('/v1/libs/aimeat-auth.js');
  await loadScript('/v1/libs/aimeat-data.js');
  await loadScript('/v1/cortex/findings/libs/findings.js');

  setStatus('Authenticating…');
  const session = await AIMEAT.auth.ensureSession();
  if (!session) {
    document.body.innerHTML = '<div style="padding:40px;">' +
      '<h1>Log in to view findings</h1>' +
      '<button onclick="AIMEAT.auth.login()">Log in</button></div>';
    return;
  }

  state.agents = await AIMEAT.findings.listAgents();
  await loadAll();

  // Live updates — new findings, completed tasks
  window.addEventListener('aimeat-live-update', (ev) => {
    const ch = ev.detail?.channel || '';
    if (ch.startsWith('findings.') || ev.detail?.key?.startsWith('findings.')) {
      loadAll();
    }
  });
}

async function loadAll() {
  setStatus('Loading findings…');
  state.topics = await AIMEAT.findings.listTopics();
  state.findings = await AIMEAT.findings.list($('#topic-filter').value);
  renderTopics();
  renderList();
  if (state.selected) renderDetail(state.selected);
  setStatus(state.findings.length + ' findings', 'success');
}

function renderTopics() {
  const sel = $('#topic-filter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All topics</option>' +
    state.topics.map(t =>
      `<option value="${escapeHtml(t)}" ${t === cur ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
  sel.onchange = () => loadAll();
}

function renderList() {
  const html = state.findings.map(f => {
    const id = f.id;
    const sel = id === state.selected ? 'selected' : '';
    return `<div class="list-item ${sel}" onclick="selectFinding('${escapeHtml(id)}')">
      <div class="title">${escapeHtml(f.title || '(untitled)')}</div>
      <div class="meta">${escapeHtml(f.topic || '')} · ${escapeHtml((f.writtenAt || '').slice(0, 10))}</div>
    </div>`;
  }).join('');
  $('#list').innerHTML = html || '<div style="padding:20px;color:#999;">No findings yet.</div>';
}

async function selectFinding(id) {
  state.selected = id;
  renderList();
  renderDetail(id);
}

async function renderDetail(id) {
  const f = state.findings.find(x => x.id === id);
  if (!f) { $('#detail').innerHTML = ''; return; }
  const review = await AIMEAT.findings.getReview(id);
  const sources = (f.sources || []).map(s =>
    `<li><a href="${escapeHtml(s)}" target="_blank" rel="noopener">${escapeHtml(s)}</a></li>`).join('');
  const agentOpts = state.agents.map(a =>
    `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`).join('');
  $('#detail').innerHTML = `
    <h2>${escapeHtml(f.title)}</h2>
    <div style="color:#888;font-size:12px;">
      ${escapeHtml(f.topic)} · ${escapeHtml(f.writtenAt || '')}
    </div>
    <div class="body" style="margin-top:14px;">${escapeHtml(f.body || '')}</div>
    <div class="sources">${sources ? '<strong>Sources:</strong><ul>' + sources + '</ul>' : ''}</div>

    <div class="actions">
      <h3>Review</h3>
      <textarea id="review-comment" placeholder="Your notes…">${escapeHtml(review?.comment || '')}</textarea>
      <div style="margin-top:6px;">
        Rating:
        <select id="review-rating">
          ${[1,2,3,4,5].map(n =>
            `<option value="${n}" ${review?.rating === n ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('')}
        </select>
        <button onclick="saveReview('${escapeHtml(id)}')">Save review</button>
      </div>
    </div>

    <div class="actions">
      <h3>Ask an agent to go deeper</h3>
      <select id="dispatch-agent">${agentOpts}</select>
      <textarea id="dispatch-instructions"
        placeholder="What should the agent focus on?">Go deeper on this finding.</textarea>
      <button onclick="dispatch('${escapeHtml(id)}')">Send to agent</button>
    </div>
  `;
}

async function saveReview(id) {
  try {
    const rating = Number($('#review-rating').value);
    const comment = $('#review-comment').value;
    await AIMEAT.findings.markReviewed(id, rating, comment);
    setStatus('Review saved', 'success');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function dispatch(id) {
  try {
    const agent = $('#dispatch-agent').value;
    const inst = $('#dispatch-instructions').value;
    const r = await AIMEAT.findings.requestDeepDive(id, agent, inst);
    setStatus('Task dispatched: ' + r.taskId, 'success');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

window.selectFinding = selectFinding;
window.saveReview = saveReview;
window.dispatch = dispatch;
window.loadAll = loadAll;

boot();
</script>

</body>
</html>
```

### 5.1 Publish

```bash
aimeat_app_publish --filename findings-dashboard.html \
  --name "Findings Dashboard" --version 0.1.0 \
  --description "Browse agent-produced findings" \
  --icon "🔍" --category "research"
# PUT the HTML file to the returned upload_url.
```

---

## 6. Try it end-to-end

### Step 1: Have an agent write some findings

In your AI chat (Claude or whatever), tell the agent:

> Write three findings about Finnish electric grid resilience into AIMEAT
> memory. Use the key pattern `findings.energy.<uuid>`. Each finding
> object must have: `title`, `body`, `sources[]`, `topic: "energy"`,
> `writtenAt: <ISO timestamp>`, `status: "new"`. Use distinct UUIDs.

The agent uses `aimeat_memory_write` (MCP) or `PUT /v1/memory/<key>`
(direct HTTP) for each finding.

### Step 2: Open the dashboard

Go to `https://node/v1/apps/<your-gaii>/findings-dashboard.html?mode=inline`.

You should see:
- The topic filter populated with `energy`
- Three findings in the list
- Click one → detail view, review form, agent dispatch form

### Step 3: Trigger a deep dive

Pick an agent, enter "Focus on transmission losses", click "Send to
agent". A task lands in the agent's queue at
`GET /v1/agents/<agent>/tasks?status=queued`.

### Step 4: Agent completes the task, writes new findings

The agent reads its task, does the work, writes new findings to memory
under the same topic. The dashboard's SSE listener (or a manual
refresh) picks them up.

---

## 7. Why this pattern is the sweet spot

- **The agent doesn't need to know about the cortex or app.** It only
  knows the key shape (the contract from §2). You can swap the dashboard
  for a different one — agent doesn't care.

- **The app doesn't need to know which agents exist.** It calls
  `listAgents()` and renders the dropdown. New agent → shows up next
  refresh.

- **The cortex is the only piece that knows both sides.** It owns the
  key shape, the action shape, the agent-dispatch flow. If you need to
  change the data model, change it here and update both ends.

- **The extension does only what the cortex can't.** Reading memory and
  calling other AIMEAT routes is cortex's job. The extension exists
  specifically because creating tasks for agents benefits from
  server-side validation (does agent exist? does finding exist? is the
  caller authorized?).

- **Live updates fall out for free** once you wire SSE into the loader
  loop. Every state-changing operation already emits an event.

- **The user's mental model stays simple.** "My agents write findings
  here, I review them in this dashboard, I tell agents to follow up."
  No talk of memory keys, namespaces, extensions, or APIs.

---

## 8. Variations of this pattern

### 8.1 No extension at all

If you don't need server-side validation of the task dispatch (you
trust whoever uses the cortex), the cortex can call
`POST /v1/agents/{name}/tasks` directly via `session.fetch`. Skip the
extension entirely. Three components (agent + cortex + app) becomes the
floor.

### 8.2 Multi-user (community dashboard)

If you want one user's findings visible to other users, write them to a
**public memory key** (`visibility: 'public'`) and have the cortex on
the consumer side read them via `AIMEAT.data.getPublic(ownerGaii, key)`.
The producer agent stays the same. The consumer cortex changes its
read URL.

### 8.3 Cross-app reuse

If you want multiple dashboards (energy, health, tech) sharing the same
findings cortex, you don't need separate cortexes. One cortex with a
`list(topic)` filter serves all. The apps differ only in styling and
which topics they hardcode in the filter.

### 8.4 Agent-to-agent chains

A finding by agent A can include a `nextAgent` field. The cortex's
`requestDeepDive` (or a dedicated action) reads it and dispatches
directly. The user becomes a spectator; the agents talk to each other
via memory. The dashboard becomes a window into the conversation.

---

## 9. Things to be careful about

1. **Memory keys are flat strings, but you can use dots as namespace
   separators.** AIMEAT's memory route supports listing by prefix.
   Pick a prefix structure that lets the cortex `list(topic)` cheaply.

2. **The agent's instructions are the contract.** If the agent writes
   keys in a different shape than the cortex expects, nothing visible
   breaks but the dashboard renders garbage. Pin the contract in the
   agent's system prompt AND inline in the cortex docstring.

3. **Don't put large blobs in memory.** Findings should be JSON
   metadata. Long bodies, PDFs, images — store in `AIMEAT.storage`
   and reference them by storage key in the finding JSON.

4. **Task context size has a limit.** When the cortex dispatches a
   task, the `context` it passes goes into the task record. Keep it
   under ~50 KB; if the finding is huge, pass a key reference instead
   of the full body.

5. **Agents need to know they CAN write to memory.** Some agent
   harnesses default to read-only. The user's first instruction to the
   agent should be: "you have write permission to this user's memory
   via `aimeat_memory_write`; use it for outputs."

6. **Sorting by `writtenAt` requires the agent to set it.** If the
   agent forgets, sort falls back to key order. Validate the field on
   read; surface "missing timestamp" warnings in the UI rather than
   silently sorting wrong.

---

## 10. What you can extend from here

- Add `AIMEAT.ai` calls to summarize long findings on demand
  (`summarize(id)` cortex method, button in the detail view)
- Add a Gantt-style view of agent task history (read
  `/v1/agents/<name>/tasks` and render a timeline)
- Add multi-select + batch dispatch ("send these 5 findings to 3
  agents in parallel")
- Promote the cortex to a generic "agent activity dashboard" by
  parameterizing the key prefix (works for any agent-produced data
  set, not just findings)
- Add an inline editor for findings so the user can correct an agent's
  output before re-dispatching

Once the four-layer plumbing works, every feature is just one more
cortex method + one more bit of UI.
