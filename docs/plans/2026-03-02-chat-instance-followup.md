# Chat Instance Follow-Up Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add E2E tests, update admin dashboard + profile page, add i18n translations, and create RFC v1.4 for the new Chat Instance identity layer.

**Architecture:** Extends existing E2E test suite with Phase 8 for chat instance CRUD endpoints. Updates admin dashboard (admin.ts) with chat instance nav + panel + API data. Adds Chat Sessions tab to profile page (profile.ts). Adds i18n keys to en.json/fi.json. Creates RFC v1.4 from v1.3 with new section on Chat Instance Identity.

**Tech Stack:** TypeScript, Express 5, Ed25519 auth, AIMEAT envelope pattern, i18n (en/fi)

---

### Task 1: E2E Tests for Chat Instance CRUD

**Files:**
- Modify: `aimeat/test/e2e-full.ts:1004` (insert Phase 8 before GDPR section)

**Step 1: Add Phase 8 — Chat Instances before the GDPR section**

Insert the following block at line 1004, right before `// ─── GDPR ───`:

```typescript
// ─── Phase 8: Chat Instances ───
console.log('Phase 8 — Chat Instances');

let chatInstanceId = '';

await test('POST /v1/chat-instances — create chat instance', async () => {
    const { status, body } = await json('/v1/chat-instances', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ platform: 'claude', app_name: 'testapp' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.chat_instance?.platform === 'claude', 'platform');
    assert(body.data?.chat_instance?.app_name === 'testapp', 'app_name');
    assert(body.data?.chat_instance?.id?.includes('claude'), 'id contains platform');
    chatInstanceId = body.data.chat_instance.id;
});

await test('GET /v1/chat-instances — list instances', async () => {
    const { body } = await json('/v1/chat-instances', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.chat_instances), 'has array');
    assert(body.data.chat_instances.length >= 1, 'at least 1');
    assert(body.data.chat_instances.some((c: any) => c.id === chatInstanceId), 'contains created');
});

await test('GET /v1/chat-instances/:id — get detail with economy', async () => {
    const { body } = await json(`/v1/chat-instances/${encodeURIComponent(chatInstanceId)}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(body.data?.chat_instance?.id === chatInstanceId, 'id matches');
    assert(body.data?.economy !== undefined, 'has economy');
    assert(typeof body.data?.economy?.trust_score === 'number', 'has trust_score');
});

await test('GET /v1/chat-instances?platform=claude — filter by platform', async () => {
    const { body } = await json('/v1/chat-instances?platform=claude', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, 'ok');
    assert(body.data.chat_instances.every((c: any) => c.platform === 'claude'), 'all claude');
});

await test('PUT /v1/chat-instances/:id — heartbeat', async () => {
    const { body } = await json(`/v1/chat-instances/${encodeURIComponent(chatInstanceId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(body.data?.chat_instance?.last_seen !== undefined, 'has last_seen');
});

await test('DELETE /v1/chat-instances/:id — end session', async () => {
    const { body } = await json(`/v1/chat-instances/${encodeURIComponent(chatInstanceId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(body.data?.deleted === true, 'confirmed deleted');

    // Verify it's gone
    const { status } = await json(`/v1/chat-instances/${encodeURIComponent(chatInstanceId)}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 404, 'gone after delete');
});
```

**Step 2: Verify by running tsc**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 3: Start the E2E test server and run tests**

Run: `cd aimeat && AIMEAT_PORT=40251 AIMEAT_DEV_MODE=true AIMEAT_ADMIN_PASSWORD=test123 pnpm exec tsx src/main.ts &`
Then: `cd aimeat && pnpm exec tsx test/e2e-full.ts`
Expected: All tests pass including the new Phase 8 tests

**Step 4: Commit**

```bash
git add aimeat/test/e2e-full.ts
git commit -m "test: add E2E tests for chat instance CRUD endpoints"
```

---

### Task 2: i18n Translations for Chat Instances

**Files:**
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

**Step 1: Add English translations**

In `en.json`, add to the `profile.stats` section (after `"nodes": "Nodes"`):
```json
"chatSessions": "Chat Sessions"
```

In `en.json`, add to `profile.tabs` section (after `"agents": "Agents"`):
```json
"chatSessions": "Chat Sessions",
```

In `en.json`, add a new `profile.chatSessions` section after `profile.agents`:
```json
"chatSessions": {
  "title": "Chat Sessions",
  "desc": "Chat sessions represent AI tools you use directly — like Claude, ChatGPT, Grok, or Copilot. Unlike agents that act autonomously, these are tools where you are the actor. Each session inherits your trust score and morsel balance.",
  "empty": "No active chat sessions.",
  "loading": "Loading chat sessions...",
  "error": "Could not load chat sessions.",
  "platform": "Platform",
  "appName": "App Name",
  "lastSeen": "Last Seen",
  "delete": "End Session",
  "anonymous": "Anonymous",
  "economy": "Economy"
}
```

In `en.json`, add to `dashboard` section (after `"activeBoards": "Active Boards"`):
```json
"chatInstances": "Chat Instances",
"activeChatSessions": "Active Chat Sessions",
"noChatInstances": "No chat instances",
```

**Step 2: Add Finnish translations**

In `fi.json`, add to the `profile.stats` section (after `"nodes": "Solmut"`):
```json
"chatSessions": "Keskustelusessiot"
```

In `fi.json`, add to `profile.tabs` section (after `"agents": "Agentit"`):
```json
"chatSessions": "Keskustelusessiot",
```

In `fi.json`, add a new `profile.chatSessions` section after `profile.agents`:
```json
"chatSessions": {
  "title": "Keskustelusessiot",
  "desc": "Keskustelusessiot edustavat AI-työkaluja joita käytät suoraan — kuten Claude, ChatGPT, Grok tai Copilot. Toisin kuin agentit jotka toimivat itsenäisesti, nämä ovat työkaluja joissa sinä olet toimija. Jokaisella sessiolla on luottamuspisteesi ja murusaldosi.",
  "empty": "Ei aktiivisia keskustelusessioita.",
  "loading": "Ladataan keskustelusessioita...",
  "error": "Keskustelusessioiden lataus epäonnistui.",
  "platform": "Alusta",
  "appName": "Sovellus",
  "lastSeen": "Nähty viimeksi",
  "delete": "Lopeta sessio",
  "anonymous": "Anonyymi",
  "economy": "Talous"
}
```

In `fi.json`, add to `dashboard` section (after `"activeBoards": "Aktiiviset taulut"`):
```json
"chatInstances": "Chat-instanssit",
"activeChatSessions": "Aktiiviset chat-sessiot",
"noChatInstances": "Ei chat-instansseja",
```

**Step 3: Verify build**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "i18n: add chat instance translations for profile and dashboard"
```

---

### Task 3: Admin Dashboard — Chat Instances

**Files:**
- Modify: `aimeat/src/routes/admin.ts`

This task modifies 4 areas of admin.ts:

**Step 1: Add chat instances to dashboard API response**

In `admin.ts`, in the `GET /v1/admin/dashboard` handler (around line 215), add after `const boards = await storage.listBoards();`:
```typescript
const chatInstances = await storage.listChatInstances({});
```

In the `counts` object of the response (around line 351), add after `boards: boards.length,`:
```typescript
chat_instances: chatInstances.length,
```

**Step 2: Add chat instances nav item in sidebar HTML**

In the `buildDashboardHtml` function, in the sidebar nav (around line 914), add after the boards nav-item:
```html
<button class="nav-item" onclick="nav('chatInstances')"><span class="icon">&#x1F4AC;</span><span class="label">${t('dashboard.chatInstances')}</span><span class="count" id="cntChatInstances">0</span></button>
```

**Step 3: Add to the `__t` translations object**

In the `__t` JS object (around line 964), add:
```javascript
chatInstances: t('dashboard.chatInstances'), activeChatSessions: t('dashboard.activeChatSessions'), noChatInstances: t('dashboard.noChatInstances'),
```

**Step 4: Update sidebar count in `loadAll()`**

In the `loadAll` function (around line 1087), after `document.getElementById('cntBoards').textContent=D.dash.counts.boards;`, add:
```javascript
document.getElementById('cntChatInstances').textContent=D.dash.counts.chat_instances||0;
```

**Step 5: Add chat instance data to `loadAll()` parallel fetches**

In `loadAll`, add to the `extras` Promise.allSettled array:
```javascript
api('/v1/chat-instances')
```

And after the extras results processing, add:
```javascript
D.chatInstances=extras[4].status==='fulfilled'?(extras[4].value.data.chat_instances||[]):[];
```

**Step 6: Update the `nav` pages array and titles**

In the `nav` function (around line 1066), update the pages array to include `'chatInstances'` after `'boards'`:
```javascript
var pages=['overview','owners','agents','actions','boards','chatInstances','work','','economy','federation','hooks','maintenance','config'];
```

Add to titles:
```javascript
chatInstances:'\u{1F4AC} '+__t.chatInstances,
```

**Step 7: Add `renderChatInstances` to render switch**

In the `render` function (around line 1126), add a case:
```javascript
case 'chatInstances':app.innerHTML=renderChatInstances();break;
```

**Step 8: Add `renderChatInstances` function**

Add this function after the existing render functions:
```javascript
function renderChatInstances(){
  var list=D.chatInstances||[];
  if(!list.length)return '<div class="empty">'+__t.noChatInstances+'</div>';
  var o='<div class="grid grid-4" style="margin-bottom:20px">';
  o+=sc(__t.activeChatSessions,list.length,'','var(--cyan)');
  var platforms={};list.forEach(function(c){platforms[c.platform]=(platforms[c.platform]||0)+1});
  var topPlatform=Object.keys(platforms).sort(function(a,b){return platforms[b]-platforms[a]})[0]||'-';
  o+=sc('Top Platform',topPlatform,'','var(--purple)');
  o+='</div>';
  o+='<div class="card"><table><thead><tr><th>ID</th><th>'+__t.name+'</th><th>Platform</th><th>Owner</th><th>'+__t.lastSeen+'</th></tr></thead><tbody>';
  list.forEach(function(c){
    o+='<tr><td class="mono" title="'+esc(c.id)+'">'+esc(c.id.length>40?c.id.substring(0,40)+'…':c.id)+'</td>';
    o+='<td>'+esc(c.app_name)+'</td>';
    o+='<td>'+esc(c.platform)+'</td>';
    o+='<td>'+esc(c.ghii||c.owner_name||'')+'</td>';
    o+='<td>'+dt(c.last_seen)+'</td></tr>';
  });
  o+='</tbody></table></div>';
  return o;
}
```

**Step 9: Update overview to show chat instances count**

In `renderOverview` (around line 1162), after the boards stat card, add:
```javascript
o+=sc(__t.activeChatSessions,c.chat_instances||0,'','var(--cyan)');
```

**Step 10: Verify build**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 11: Commit**

```bash
git add aimeat/src/routes/admin.ts
git commit -m "feat(dashboard): add chat instances to admin dashboard"
```

---

### Task 4: Profile Page — Chat Sessions Tab

**Files:**
- Modify: `aimeat/src/routes/profile.ts`

**Step 1: Add Chat Sessions stat card**

In the stats bar section (around line 367), after the agents stat card:
```html
<div class="stat-card"><div class="num" id="stat-chatsessions">-</div><div class="label">${sanitize(translations['profile.stats.chatSessions'] || 'Chat Sessions')}</div></div>
```

**Step 2: Add Chat Sessions tab button**

In the tabs section (around line 375), after the Agents tab button:
```html
<button class="tab" data-tab="chatsessions">${sanitize(translations['profile.tabs.chatSessions'] || 'Chat Sessions')}</button>
```

**Step 3: Add Chat Sessions tab panel**

After the agents panel closing `</div>` (around line 419), add:
```html
<!-- ═══ CHAT SESSIONS ═══ -->
<div class="tab-panel" id="panel-chatsessions">
  <div class="section-title">${sanitize(translations['profile.chatSessions.title'] || 'Chat Sessions')}</div>
  <div class="section-desc">${sanitize(translations['profile.chatSessions.desc'] || '')}</div>
  <div id="chatsessions-list"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.chatSessions.loading'] || 'Loading chat sessions...')}</span></div>
</div>
```

**Step 4: Add JavaScript to fetch and render chat sessions**

In the profile page's JavaScript section, find where agents are loaded (look for the fetch to `/v1/agents`). Add a parallel fetch to `/v1/chat-instances` and a render function.

After the agent loading/rendering code, add:
```javascript
// Load chat sessions
try {
  var csRes = await fetch(BASE + '/v1/chat-instances', { headers: { 'Authorization': 'Bearer ' + token } });
  var csData = await csRes.json();
  var csList = csData.data?.chat_instances || [];
  document.getElementById('stat-chatsessions').textContent = csList.length;
  var csHtml = '';
  if (csList.length === 0) {
    csHtml = '<div class="empty">' + T['profile.chatSessions.empty'] + '</div>';
  } else {
    csList.forEach(function(c) {
      csHtml += '<div class="card">';
      csHtml += '<div class="card-header"><div><span class="card-title">' + esc(c.platform) + '</span>';
      csHtml += '<div class="card-subtitle">' + esc(c.app_name) + '</div></div>';
      csHtml += '<span class="badge badge-info">' + (c.is_anonymous ? T['profile.chatSessions.anonymous'] || 'Anonymous' : c.platform) + '</span></div>';
      csHtml += '<div style="font-size:.8rem;color:var(--muted);margin-top:.4rem">' + (T['profile.chatSessions.lastSeen'] || 'Last seen') + ': ' + new Date(c.last_seen).toLocaleString() + '</div>';
      csHtml += '</div>';
    });
  }
  document.getElementById('chatsessions-list').innerHTML = csHtml;
} catch(e) {
  document.getElementById('chatsessions-list').innerHTML = '<div class="empty">' + (T['profile.chatSessions.error'] || 'Error') + '</div>';
}
```

**Step 5: Verify build**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add aimeat/src/routes/profile.ts
git commit -m "feat(profile): add Chat Sessions tab to profile page"
```

---

### Task 5: RFC v1.4

**Files:**
- Create: `docs/AIMEAT-RFC-v1.4-full.md` (copy from `docs/AIMEAT-RFC-v1.3-full.md`)

**Step 1: Copy RFC v1.3 to v1.4**

```bash
cp docs/AIMEAT-RFC-v1.3-full.md docs/AIMEAT-RFC-v1.4-full.md
```

**Step 2: Update header**

Change the first lines from:
```markdown
# ♥ AIME AT Protocol Specification v1.3
```
to:
```markdown
# ♥ AIME AT Protocol Specification v1.4
```

Change:
```
**Status:** v1.3 (Initial OTK, Dev Mode)
**Date:** 2026-02-25
```
to:
```
**Status:** v1.4 (Chat Instance Identity Layer)
**Date:** 2026-03-02
```

**Step 3: Add "Chat Instance Identity" to the Table of Contents**

After the existing TOC entry for Section 21, add:
```markdown
22. [Chat Instance Identity Layer](#22-chat-instance-identity-layer)
```

**Step 4: Add Section 22 — Chat Instance Identity Layer**

Add before the Appendices:

```markdown
## 22. Chat Instance Identity Layer

### 22.1 Motivation

AIMEAT distinguishes between two types of AI interaction:

- **Agents** (GAII): Autonomous AI identities that act independently — e.g., OpenClaw, research bots, automation agents. They have their own GAII, memory, wallet, and capabilities.
- **Chat Instances**: Human-operated AI sessions — e.g., Claude, ChatGPT, Grok, Copilot. The human is the actor; the AI is the tool. Chat instances do NOT get a GAII.

This separation ensures that autonomous agents and human-operated AI tools are tracked differently in the protocol.

### 22.2 Chat Instance ID Format

```
{platform}-{appname}#{owner}@{node-id}
```

**Examples:**
```
claude-myapp#jouni@aimeat-finland-001-genesis
chatgpt-research#tanaka@aimeat-ap-001-tokyo
anon-claude-1709337600#anonymous@aimeat-finland-001-genesis
```

The format reuses GAII syntax but is semantically different — it identifies a human-operated AI session, not an autonomous agent.

### 22.3 Anonymous Sessions

When anonymous access is enabled, the node creates a system-level GHII (Global Human Intelligence Identifier) at startup:

```
anonymous@{node-id}
```

All anonymous chat instances are linked to this system GHII. The anonymous GHII has:
- `trustScore`: 50 (default)
- `morselBalance`: 0

Anonymous chat instance IDs use the format:
```
anon-{platform}-{timestamp}#anonymous@{node-id}
```

### 22.4 GHII Economy Fields

Each GHII (owner identity) has economy fields that chat instances inherit:

| Field | Type | Description |
|-------|------|-------------|
| `trustScore` | number | Trust score (0-100), default 50 |
| `morselBalance` | number | Morsel balance, default 0 |

When retrieving a chat instance detail, the response includes economy data resolved from the linked GHII.

### 22.5 ChatInstanceRecord

```json
{
  "id": "claude-myapp#jouni@aimeat-finland-001-genesis",
  "platform": "claude",
  "app_name": "myapp",
  "ghii": "jouni@aimeat-finland-001-genesis",
  "is_anonymous": false,
  "created_at": "2026-03-02T10:00:00Z",
  "last_seen": "2026-03-02T10:05:00Z"
}
```

### 22.6 Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat-instances` | Register a new chat session |
| GET | `/v1/chat-instances` | List chat instances (filterable by platform) |
| GET | `/v1/chat-instances/:id` | Get instance detail + economy data |
| PUT | `/v1/chat-instances/:id` | Heartbeat (update lastSeen) |
| DELETE | `/v1/chat-instances/:id` | End chat session |

All endpoints require authentication. Chat instances inherit access to the same API endpoints as agents (memory, boards, etc.) but are tracked separately.

### 22.7 Relationship to GAII

| | Agent (GAII) | Chat Instance |
|---|---|---|
| Identity format | `agent#owner@node` | `platform-app#owner@node` |
| Actor | AI (autonomous) | Human (via AI tool) |
| Registration | POST `/v1/agents` | POST `/v1/chat-instances` |
| Economy | Own morsel wallet | Inherits from GHII |
| Trust | Own trust score | Inherits from GHII |
| Capabilities | Declared at registration | None (uses owner's access) |
| Lifecycle | Persistent | Session-based |
```

**Step 5: Add changelog at end of document**

At the very end of the RFC, add:

```markdown
---

## Changelog

### v1.4 (2026-03-02)

- **Added:** Section 22 — Chat Instance Identity Layer
  - New `ChatInstanceRecord` entity type for human-operated AI sessions
  - Chat Instance ID format: `{platform}-{appname}#{owner}@{node-id}`
  - Anonymous GHII system account (`anonymous@node`) created at startup
  - GHII economy fields: `trustScore`, `morselBalance`
  - 5 CRUD endpoints under `/v1/chat-instances`
  - Clear separation between autonomous agents (GAII) and human-operated AI tools (Chat Instances)

### v1.3 (2026-02-25)

- Added Initial OTK (One-Time Key) for bootstrapping AI agents
- Added Dev Mode for simplified development workflows
```

**Step 6: Commit**

```bash
git add docs/AIMEAT-RFC-v1.4-full.md
git commit -m "docs: add RFC v1.4 with Chat Instance Identity Layer"
```

---

### Task 6: Final Verification

**Step 1: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 2: Run unit tests**

Run: `cd aimeat && npx vitest run`
Expected: All tests pass

**Step 3: Build**

Run: `cd aimeat && pnpm build`
Expected: Build succeeds

**Step 4: Run E2E tests**

Start server: `cd aimeat && AIMEAT_PORT=40251 AIMEAT_DEV_MODE=true AIMEAT_ADMIN_PASSWORD=test123 pnpm exec tsx src/main.ts &`
Run: `cd aimeat && pnpm exec tsx test/e2e-full.ts`
Expected: All tests pass including Phase 8

**Step 5: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address verification issues"
```
