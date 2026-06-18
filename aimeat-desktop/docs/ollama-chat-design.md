# Design: Ollama Chat tab for AIMEAT Desktop (MCP-driven agent)

Status: **design / not built** · Author discussion: 2026-06-07

## Goal

Add an **Ollama Chat** tab to the desktop app. If Ollama is installed and running, the chat activates.
A local model (e.g. `qwen2.5:7b`) acts as the *brain*; an **AIMEAT MCP connection** is the *hands*. Through it the
user chats in plain language and asks the model to operate on their AIMEAT account: read and edit **organism
workspaces**, fetch **knowledge packages**, inspect **workspace usage / members**, see **which agents use an
organism and what they do**, and create/modify content.

Key property: **no local AIMEAT node is required** — if the target is `aimeat.io`, the chat talks straight to
aimeat.io's MCP. The bundled `node.exe` only runs the bridge, not the server.

## Decisions (agreed)

1. **Identity — the chat is its own registered AIMEAT agent.** It does NOT act as the owner. The owner signs in
   only to **authorize** registration; the chat then has its **own GAII identity + token** and makes MCP calls as
   itself (proper auditing, own scopes, shows up in the owner's Agents tab). This mirrors the `aimeat-crewai`
   **liaison** pattern — the desktop is the *liaison* for the Ollama *brain*.
2. **Safety:** writes (create/update/delete/publish/add) require **per-action approval** by default; a toggle
   switches to **auto-approve** once trusted (global), plus **"always allow this tool"** per-tool memory. This sits
   ON TOP of the agent's own scope limits (defense in depth).
3. **Target:** user-selectable **aimeat.io** *or* **localhost:41050**.
4. **Tool surface:** scoped **`/v2/mcp/<role>`** (`appdev` + `agent`), not the full 50+ tool `/v1/mcp` — better
   tool selection for a small model + natural safety boundary.

## Verified end-to-end (2026-06-07)

Proof-of-concept tested against a real node + **real qwen2.5:7b** (not a mock):
1. Device-auth registration → agent `ollama-desktop#owner@node` with its **own identity + token**.
2. Bridge connects MCP **as that agent** → `/v2/mcp/agent` exposes **66 tools** (organism_*, workspace_*,
   knowledge_*, agents_list, catalogue_agents, handbook_get, …).
3. qwen2.5 picked `aimeat_organism_list` itself → MCP returned **real data** → qwen2.5 answered naturally
   ("You have an organism named 'Test Team'… Member Count: 1…").

**Verified facts that corrected the plan:**
- **Surface = `agent`** (NOT `appdev`). The `agent` surface carries organism/workspace/knowledge + agent-activity
  — exactly this use case. (`appdev` is app/extension/cortex tooling.) Default to `agent`; optionally merge `appdev`.
- **`device-token` returns OAuth shape** `{ access_token, token_type, … }` (NOT the AIMEAT envelope) — read
  `access_token`. Respect the **5s poll interval** between polls.
- **Server gate bug found + fixed:** the first-run wizard gate only allowlisted `/v1/`, so `/v2/mcp/*` (and any
  `/vN/`) wrongly returned the wizard HTML on first-run nodes. Fixed in
  [middleware-guards.ts](../../aimeat/src/server-bootstrap/middleware-guards.ts) to allowlist `^/v\d+/` (needs commit
  + the next full server bundle).
- The owner is already signed in (owner JWT), so the desktop **auto-approves** the device request itself
  (`/v1/agents/verify` with `owner_token`) — one-click registration, no browser round-trip.

## Identity & registration (the liaison model)

Studied from `python/aimeat-crewai/` (`liaison.py`, `mcp_client.py`): the liaison is the single component that
holds the **agent's own token** and speaks to AIMEAT MCP; the LLM just decides. The agent identity is created by
the standard **device-auth (RFC 8628)** flow (`aimeat connect`), already bundled in the desktop server resources
(`dist/bin/aimeat.js`, `dist/src/cli/connect/`).

Desktop registration flow (done once per node):
1. Owner signs in (AI Setup style) and picks an agent name (e.g. `ollama-desktop`).
2. Desktop calls **`POST /v1/agents/device-authorize`** → `{ user_code, verification_uri, device_code, interval }`.
3. Desktop shows the `user_code` and opens the verification URL; **owner approves** in the profile → Agents tab.
4. Desktop polls **`POST /v1/agents/device-token`** until approved → receives the **agent token** (GAII JWT).
5. Token stored in the desktop data dir (per node). Reused on subsequent launches; re-register if revoked.

From then on the chat connects to MCP **as that agent**: `Authorization: Bearer <agent-token>` →
`<base>/v2/mcp/appdev` (and `agent`). Same as the liaison's `http_params(node_url, agent_token)`.

## How AIMEAT MCP works (verified)

- Transport: **MCP Streamable HTTP** (`@modelcontextprotocol/sdk`). `POST /v1/mcp` (full) and `POST /v2/mcp/:role`
  (scoped). See [aimeat/src/mcp/index.ts](../../aimeat/src/mcp/index.ts).
- Auth: **`Authorization: Bearer <JWT>`** — the owner JWT from `POST /v1/ghii/login` (same for localhost and aimeat.io).
- Scoped roles (`V2_ROLES`): **`appdev` · `agent` · `service` · `admin`** ([aimeat/src/mcp/catalog/surfaces.ts](../../aimeat/src/mcp/catalog/surfaces.ts)).
  - **`appdev`** is the right default here: it carries `organism_*`, `workspace_*`, `storage_*`, `handbook_get`
    (knowledge), `extension_*`, `app_*`, `cortex_*` — exactly the "manage my organisms/workspaces/knowledge" surface.
  - Add **`agent`** when the user wants "which agents use this organism and what they do" (agent activity/telemetry).
- The **MCP SDK client (StreamableHTTP) is already bundled** in `resources/server/node_modules/@modelcontextprotocol/sdk`
  — no new MCP client to write.

## Architecture

```
[Ollama Chat tab — webview UI]
      │  user messages / approvals      ▲ streamed tokens, tool proposals, results
      ▼ (Tauri command → stdin)         │ (stdout JSON lines → Tauri events)
[Node "agent bridge" (the liaison) — long-lived child of node.exe]
   ├─ BRAIN:  POST http://localhost:11434/v1/chat/completions   (model + tools)     ← Ollama
   └─ HANDS:  MCP StreamableHTTP client → <base>/v2/mcp/appdev   (Bearer AGENT-token) ← AIMEAT (as the registered agent)
                         │
                         ▼
            AIMEAT node:  https://aimeat.io   OR   http://localhost:41050
```

**Agent loop (in the bridge):**
1. On start: MCP `initialize` → `tools/list` for the chosen surface → convert each tool to an OpenAI
   `tools[]` schema for Ollama.
2. Per user turn: send conversation + tools to Ollama `/v1/chat/completions`.
3. Model returns `tool_calls`. For each: classify **read vs write**.
   - **read** → execute MCP `tools/call` immediately.
   - **write** → emit an `approval_request` (tool + args) to the UI and **pause** until approved (unless
     auto-approve / per-tool allow is set), then `tools/call`.
4. Append tool results to the conversation; loop until the model returns a final text answer.
5. Stream assistant tokens + tool activity to the UI throughout.

**Read/write classification:** prefer MCP tool `annotations.readOnlyHint` when present; otherwise a name
heuristic — write = `create|update|delete|write|publish|add|approve|import|set|leave|join`; everything else read.

## Components to build

### 1. Webview UI — `aimeat-desktop/src/index.html` (new "Chat" tab)
- Activate only when Ollama is detected (reuse `detect_ai_services`); otherwise show the existing **Ollama setup
  helper** (install + `ollama pull`).
- Controls: **target** (aimeat.io / localhost), **sign in** (owner username/password → JWT; reuse `node_login`),
  **model** picker (from the Ollama scan), **surface** picker (default `appdev`).
- Transcript: user/assistant bubbles, **tool-call cards** (tool name + args + result), **Approve / Deny** buttons
  on writes, a global **Auto-approve writes** toggle, and **"always allow this tool"** checkboxes.
- Streaming via `window.__TAURI__.event.listen` for bridge events.

### 2. Node agent bridge — `aimeat-desktop/bridge/agent-bridge.mjs` (new, bundled as a resource)
- Reuses the bundled `node.exe` + bundled `@modelcontextprotocol/sdk` client (StreamableHTTP).
- Reads JSON commands on **stdin** (`user_message`, `approval`, `cancel`), writes JSON events on **stdout**
  (`token`, `tool_proposal`, `tool_result`, `assistant_done`, `error`).
- Holds the MCP session + conversation state for the chat session (long-lived).

### 3. Rust wiring — `aimeat-desktop/src-tauri/src/`
- New module (e.g. `chat_bridge.rs`): spawn/stop the bridge child, pipe its stdout (JSON lines) → `app.emit(...)`
  Tauri events; a `chat_send(msg)` / `chat_approve(id, allow)` command writes to the bridge stdin.
- Resolve the bridge entry from resources (bundled) with a dev fallback, same pattern as `resolve_runtime`.
- **Device-auth registration commands** (reqwest): `agent_device_authorize(base, owner, agent_name)` →
  `{user_code, verification_uri, device_code}`; `agent_device_poll(base, device_code)` → agent token (or pending).
  Store the token per node in the data dir. The owner sign-in (reuse `node_login`, generalized to accept a base
  URL) authorizes the *approval* step.
- Pass the **agent token** + base + surface to the bridge (Bearer for MCP).

## Phasing

- **Phase 1 (first working version):** Chat tab; target + owner sign-in; **agent registration via device-auth**
  (own identity); `appdev` + `agent` surface; bridge agent loop as that agent; **read freely, write-with-approval**;
  basic streaming transcript. (Build + verify the bridge core standalone first.)
- **Phase 2:** auto-approve toggle + per-tool "always allow"; surface picker; model picker; conversation
  persistence; richer tool-result rendering and error/retry UX; agent re-registration / token refresh.

## Risks / open questions

- **Small-model tool reliability:** `qwen2.5:7b` handles tool-calling reasonably; `llama3.2:3b` is weaker. Default
  to / recommend `qwen2.5:7b`+. Scoped surface keeps the tool count low (helps a lot).
- **aimeat.io account** required for that mode; OAuth 2.1 is the "proper" MCP auth, but a **direct Bearer JWT**
  (reusing `node_login`) is simpler and sufficient for the MVP.
- **Agent scopes at registration:** request a scope set matching `appdev` + `agent` so the agent token can't
  exceed the intended surface. Per-write approval is the second layer.
- **Confirm** the exact `appdev` tool list against `MCP_SURFACES.appdev` so the model gets a coherent set; decide
  whether to also expose `agent` tools for activity queries (probably yes).

## Reuse (already in place)
- `detect_ai_services` (Ollama detection) · `node_login` (JWT, needs base-URL param) · bundled `node.exe` +
  `@modelcontextprotocol/sdk` · the Ollama install helper UI · the sticky-header / tab framework.

## Out of scope (for now)
- Non-Ollama brains (the OpenRouter path already exists in the web Calibrator for cloud models).
- macOS/Linux desktop builds.
- Running multiple concurrent chat sessions.
