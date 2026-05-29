# Implementation: MCP rich rendering refactor + one-click client setup

**Created:** 2026-05-29
**Intended audience:** A fresh Claude Code session that will implement this in the AIMEAT codebase.
**Repository:** This is the AIMEAT repo. You are already in it.
**No time/effort estimates:** Do not include "this is a 1-week project", "easy/hard", "MVP in N days" etc. anywhere. The user finds those noise.

---

## Context — what AIMEAT is (no prior conversation knowledge required)

**AIMEAT** is an open protocol + reference implementation for AI agent infrastructure. v1.10.0 shipped 2026-05-28 with `aimeat connect` CLI which includes a stdio MCP server (`aimeat connect serve`) exposing ~41 AIMEAT operations as MCP tools to MCP-attached runtimes (Claude Desktop primarily, also Cursor, Cline, Claude Code, others).

Public docs:
- Repo overview: [README.md](../../README.md)
- Project conventions: [CLAUDE.md](../../CLAUDE.md) — MANDATORY READ before coding
- Public site: https://aimeat.io
- llms.txt: https://aimeat.io/llms.txt

**Key research already done** (read this first):
- [docs/research/2026-05-29-mcp-rich-rendering-and-one-click-setup-REPORT.md](../research/2026-05-29-mcp-rich-rendering-and-one-click-setup-REPORT.md) — the full source-cited research report. Has the schemas, client matrix, code examples, and rationale for everything below.

**Code paths you will touch:**
- `aimeat/src/cli/connect/mcp/server.ts` — MCP server entry
- `aimeat/src/cli/connect/mcp/tools/*.ts` — every tool registration (memory, knowledge, tasks, wallet, etc.)
- `aimeat/src/cli/connect/mcp/resources.ts` — current resource definitions (may not exist yet — create)
- `aimeat/src/cli/connect/tool-call.ts` — CLI shell fallback (mirrors MCP tools)
- `aimeat/src/cli/connect/auth.ts` — connect command (need to add helper subcommand)

---

## What you are building (the picture)

A solo developer attaches Claude Desktop to AIMEAT. Today every MCP tool response is a wall of JSON inside a text block — readable to the LLM but ugly to the human. Claude Desktop has native rendering for markdown tables, images, embedded resources with MIME types, and MCP Apps HTML — AIMEAT is not using any of that.

After this work:
1. **Every AIMEAT MCP tool returns a compact text summary + structured content.** Tables, images, files, and rich text render natively in Claude Desktop and other MCP Apps clients.
2. **Memory, knowledge packages, and storage files are exposed as MCP Resources.** Claude Code users can write `@aimeat:memory://my-key` directly and the client auto-fetches.
3. **A new `aimeat connect mcp-config <client>` helper** prints the exact config snippet for the user's MCP client (Claude Desktop, Cursor, VS Code, Claude Code, Cline). One-click setup links for Cursor.

---

## Specific implementation tasks

### Task 1: `content` + `structuredContent` refactor for all tools

The MCP spec 2025-11-25 and SEP-1624 convention: `content` is model-oriented (compact text summary), `structuredContent` is machine/UI-oriented (full JSON object). Every AIMEAT MCP tool needs both.

**Current pattern (in `aimeat/src/cli/connect/mcp/tools/*.ts`):**
```typescript
return { 
  content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] 
};
```

**New pattern (drop-in for ~41 tools):**
```typescript
return {
  content: [{ type: 'text' as const, text: summarize(resp.data) }],
  structuredContent: resp.data,
};
```

Where `summarize(data)` produces a 1-3 line human-readable description. Tool-by-tool guidelines below.

**Per-tool recommendations** (the research report has concrete before/after examples):

| Tool | Compact summary text | Structured content shape |
|---|---|---|
| `aimeat_task_list` | "3 tasks: 2 open, 1 done. IDs: t1, t2, t3." | `{ tasks: [...] }` |
| `aimeat_task_get` | "Task #abc123: 'Title' (status: active, 5 todos)" | full task object |
| `aimeat_onboarding_status` | "Onboarding: 12/13 passed, level full (74). Next: declare_services" | `{ status, steps, hints, post_onboarding_checklist }` |
| `aimeat_wallet_balance` | "Balance: 1,240 morsels. 5 transactions in last 24h." | `{ balance, currency, recentTransactions }` |
| `aimeat_catalogue_search` | "12 results for 'comicland'. Top: ..." | `{ results: [...] }` |
| `aimeat_memory_list` | "8 entries under prefix 'agents.falcon.'. Most recent: ..." | `{ entries: [...] }` |
| `aimeat_message_inbox` | "3 messages: 1 from owner, 2 from agents. Most recent: ..." | `{ messages: [...] }` |
| `aimeat_agent_activity` | "47 calls last 30d, peak Tuesday 14:00. Tokens used: 12.4K." | `{ activityStats, history }` |

For tools that return a single object (not a list), the summary is just a one-liner identifying what was fetched ("Read memory `profile.bio` (text/markdown, 42 bytes)") and `structuredContent` is the object.

For tools that produce binary or file output (`aimeat_storage_download`, `aimeat_knowledge_get`):
- Use `image` content type with base64 + correct MIME for images (`image/png`, `image/jpeg`)
- Use embedded `resource` content type with correct MIME (`text/markdown`, `application/json`, `text/x-python`, etc.) for documents
- Still include a summary text "Downloaded `chart.png` (image/png, 12.4 KB)"

**Backward compatibility:** older clients that don't read `structuredContent` still see the text summary. Don't break them.

**Mirror in `tool-call.ts`:** the CLI fallback should print the structuredContent JSON pretty-formatted by default (so users who run `aimeat connect call aimeat_task_list --json '{}'` see the full data, not just the summary). Add `--summary-only` flag for cases where they want just the text.

### Task 2: MCP Resources for memory, knowledge, storage

The MCP spec supports `resources/list`, `resources/read`, and `resources/subscribe`. Claude Code's `@server:protocol://resource/path` mentions auto-fetch resources. AIMEAT should expose:

**Resource URI scheme: `aimeat://`**
- `aimeat://memory/{key}` — a single memory entry
- `aimeat://knowledge/{package-id}` — a knowledge package (latest version)
- `aimeat://knowledge/{package-id}/v{version}` — specific version
- `aimeat://storage/{path}` — a file in storage

**Implementation in `aimeat/src/cli/connect/mcp/resources.ts`:**

- `resources/list` handler:
  - Calls `aimeat_memory_list` to fetch top N memory entries the agent can see (with filter for "owner" visibility)
  - Calls `aimeat_knowledge_list` to fetch knowledge packages
  - Calls `aimeat_storage_list` to fetch files
  - Returns each as a `{ uri, name, mimeType, description }` entry
  - mimeType inferred from key suffix (`.md` → `text/markdown`, no suffix → `application/json` for memory entries)
- `resources/read` handler:
  - Parses URI, dispatches to the right backend tool
  - Returns `{ contents: [{ uri, mimeType, text | blob }] }`
  - text for human-readable content (markdown, json, plain text)
  - blob (base64) for binary

**Performance note:** `resources/list` may be expensive. Cache results for 30s, or paginate via `cursor` parameter (MCP spec supports it).

**Multi-agent compatibility:** if the server is loaded with multiple agents (see sibling `crewai-task-runner` implementation doc), `resources/list` should return resources from ALL agents that the requesting MCP session can access. Or expose a per-agent filter via custom URI prefix `aimeat://{agent_name}/memory/{key}`.

### Task 3: `aimeat connect mcp-config <client>` helper subcommand

New CLI command that prints the exact config snippet for a given MCP client. Usage:

```
aimeat connect mcp-config claude-desktop
aimeat connect mcp-config cursor
aimeat connect mcp-config vscode
aimeat connect mcp-config claude-code
aimeat connect mcp-config cline
```

**Implementation:** add `aimeat/src/cli/connect/mcp-config.ts`. Switch on client name, print snippet from a template. Use the canonical snippets from the research report (already source-verified). Examples below.

**Claude Desktop output:**
```
==============================================
Claude Desktop MCP config for AIMEAT
==============================================

Config file location:
  macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
  Windows: %APPDATA%\Claude\claude_desktop_config.json
  Linux:   not officially supported by Claude Desktop as of May 2026

Or open via GUI: Claude menu → Settings... → Developer tab → Edit Config.

Drop in this snippet (merge with existing mcpServers if any):
==============================================
{
  "mcpServers": {
    "aimeat": {
      "command": "npx",
      "args": ["-y", "aimeat", "connect", "serve"],
      "env": {
        "AIMEAT_NODE_URL": "https://aimeat.io"
      }
    }
  }
}
==============================================

After saving: COMPLETELY QUIT Claude Desktop and restart. Config is read only at startup.

Verify: chat "What AIMEAT tools do you have?" — Claude should list ~41 aimeat_* tools.
```

**Cursor output:** include the `cursor://...` deeplink AND the manual config option.

**Optional flag `--install`:**
- For `claude-desktop`: writes directly to the config file (with confirmation prompt to avoid clobbering existing servers)
- For `cursor`: opens the deeplink via `open` (macOS) / `start` (Windows) / `xdg-open` (Linux)
- For `claude-code`: runs `claude mcp add --scope user --transport stdio aimeat -- npx -y aimeat connect serve`
- For `vscode`: runs `code --add-mcp '{"name":"aimeat","command":"npx","args":["-y","aimeat","connect","serve"]}'`

**Optional flag `--check`:**
- Verifies Node is on PATH
- Verifies `npx aimeat --version` returns
- Verifies the client's config file exists (if applicable)
- Prints diagnostics

### Task 4: `llms-install.md` for Cline marketplace

Cline's marketplace performs autonomous setup by reading README. Create top-level `llms-install.md` (in repo root):

```markdown
# AIMEAT MCP server — autonomous install

Run:

```bash
npx -y aimeat connect serve
```

If asked for environment, set:

```
AIMEAT_NODE_URL=https://aimeat.io
```

No additional configuration required. The server exposes ~41 MCP tools and a growing list of MCP Resources for AIMEAT memory, knowledge packages, and storage.

First-time users will need to run `aimeat connect` interactively to authenticate. See https://aimeat.io for a full walkthrough.
```

Then we can submit to https://github.com/cline/mcp-marketplace via issue: repo URL, 400×400 PNG logo, brief value description. (Logo asset: use AIMEAT's existing branding; if 400×400 isn't available, create one.)

### Task 5: Submit to MCP server directories

Not a code task but worth tracking:
- Cline MCP Marketplace (see Task 4)
- https://github.com/punkpeye/awesome-mcp-servers — open a PR adding AIMEAT under appropriate category ("AI Agent Infrastructure" or "Memory")
- Smithery / MCPMarket / MCPHub — community directories; submission usually via JSON manifest

---

## Acceptance test

1. After Task 1: in Claude Desktop, call `aimeat_task_list` via MCP — instead of a JSON wall, you should see a one-line summary in the chat AND (if Claude Desktop renders structuredContent visibly, which is an open question per the research report's Open Questions section) a structured render. At minimum the text summary should be readable.
2. After Task 2: in Claude Code, write `@aimeat:memory://<some-key>` — the resource auto-attaches with the right MIME type rendering.
3. After Task 3: `aimeat connect mcp-config claude-desktop` prints a complete, valid config snippet. `aimeat connect mcp-config cursor --install` opens Cursor with the install confirmation dialog.
4. After Task 4: `cat llms-install.md` shows the right content.
5. After Task 5: AIMEAT appears in at least one MCP server directory (Cline marketplace).

---

## Things you should NOT do

- Do NOT remove the existing JSON text content from any tool. Add structured content alongside; keep text for backward compatibility.
- Do NOT change the AIMEAT API. This is a client-side (MCP server in CLI) refactor only.
- Do NOT include time/effort estimates anywhere.
- Do NOT skip the `--check` mode for `mcp-config` — the diagnostic story is critical for new users debugging "why doesn't Claude see my tools".
- Do NOT change the MCP tool names. ~41 tools are documented; renaming breaks every existing user.

---

## When you're done

1. Run typecheck + lint:
   ```
   pnpm typecheck
   pnpm lint
   ```
2. Test the CLI manually with at least Claude Desktop:
   - Run `aimeat connect mcp-config claude-desktop` → copy the snippet → install → restart → verify tools appear → verify a tool call shows the new summary + structured content
3. Update `aimeat/README.md` (the connect CLI section) to mention the new `mcp-config` subcommand and the resource URI scheme.
4. Brief PR description (no time estimates) listing what was added.
