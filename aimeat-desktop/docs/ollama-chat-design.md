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

1. **Safety:** writes (create/update/delete/publish/add) require **per-action approval** by default; a toggle
   switches to **auto-approve** once trusted (global), plus **"always allow this tool"** per-tool memory.
2. **Target:** user-selectable **aimeat.io** *or* **localhost:40050**.
3. **Tool surface:** scoped **`/v2/mcp/<role>`** (not the full 50+ tool `/v1/mcp`) — better tool selection for a
   small model + natural safety boundary.

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
[Node "agent bridge" — long-lived child of node.exe]
   ├─ BRAIN:  POST http://localhost:11434/v1/chat/completions   (model + tools)   ← Ollama
   └─ HANDS:  MCP StreamableHTTP client → <base>/v2/mcp/appdev   (Bearer owner-JWT) ← AIMEAT
                         │
                         ▼
            AIMEAT node:  https://aimeat.io   OR   http://localhost:40050
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
- **Generalize `node_login`** to accept a base URL (currently hardcodes `http://localhost:{port}`) so it can log
  in to `https://aimeat.io` too. Pass the JWT + base + surface to the bridge.

## Phasing

- **Phase 1 (MVP):** Chat tab; target + sign-in (localhost **and** aimeat.io); `appdev` surface; bridge agent
  loop; **read freely, write-with-approval**; basic streaming transcript.
- **Phase 2:** auto-approve toggle + per-tool "always allow"; surface picker (`appdev`/`agent`); model picker;
  conversation persistence; better tool-result rendering and error/retry UX.
- **Phase 3:** richer cards (workspace/organism result views); optional **dedicated scoped agent identity** for the
  chat (register a named agent with limited scopes instead of using the owner JWT — better auditing/safety);
  multi-surface tool merge.

## Risks / open questions

- **Small-model tool reliability:** `qwen2.5:7b` handles tool-calling reasonably; `llama3.2:3b` is weaker. Default
  to / recommend `qwen2.5:7b`+. Scoped surface keeps the tool count low (helps a lot).
- **aimeat.io account** required for that mode; OAuth 2.1 is the "proper" MCP auth, but a **direct Bearer JWT**
  (reusing `node_login`) is simpler and sufficient for the MVP.
- **Acting as the owner:** owner JWT = full power within the surface. Per-write approval mitigates this in MVP;
  Phase 3's scoped agent identity is the durable answer.
- **Confirm** the exact `appdev` tool list against `MCP_SURFACES.appdev` so the model gets a coherent set; decide
  whether to also expose `agent` tools for activity queries (probably yes).

## Reuse (already in place)
- `detect_ai_services` (Ollama detection) · `node_login` (JWT, needs base-URL param) · bundled `node.exe` +
  `@modelcontextprotocol/sdk` · the Ollama install helper UI · the sticky-header / tab framework.

## Out of scope (for now)
- Non-Ollama brains (the OpenRouter path already exists in the web Calibrator for cloud models).
- macOS/Linux desktop builds.
- Running multiple concurrent chat sessions.
