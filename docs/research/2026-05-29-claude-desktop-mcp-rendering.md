# Research: MCP Resources, inline rendering, and one-click Claude Desktop config for AIMEAT

**Created:** 2026-05-29
**Intended audience:** A fresh Claude Code session that will run focused research and return an actionable report.
**Deliverable:** ~1500-2500 word report with copy-pasteable config snippets and concrete renderer recommendations.

---

## Context (no prior conversation knowledge required)

**AIMEAT** is an open AI agent infrastructure protocol (https://github.com/miikkij/aimeat-protocol). Just shipped **v1.10.0 on 2026-05-28** which includes:
- `aimeat connect` CLI with a stdio MCP server (`aimeat connect serve`) that exposes ~41 AIMEAT operations as MCP tools to any MCP-attached runtime (Claude Desktop, MCP-aware IDEs like Cursor, etc.)
- All MCP tools currently return JSON-stringified results inside `text` content blocks: `{ content: [{ type: 'text', text: JSON.stringify(data) }] }`

**The gap:** AIMEAT's MCP tool responses are all plain JSON text. The **MCP protocol supports much richer response types** (Resources, structured content, embedded media) and **Claude Desktop natively renders some of these inline** (tables, images, links, possibly more). AIMEAT is using none of this richness — every response is a wall of JSON the user has to read or the LLM has to parse and re-render.

**Two problems to solve:**
1. **MCP rich responses**: figure out what Claude Desktop (and other major MCP clients) can render natively when an MCP tool returns the "right" content type. Then make AIMEAT's tools use that.
2. **One-click setup**: a copy-paste-ready `claude_desktop_config.json` snippet (and equivalents for Cursor, Cline, Claude Code, others) that attaches AIMEAT MCP to the runtime.

**IMPORTANT for the responding session:** Do NOT include any time/effort/difficulty estimates ("days to implement", "easy/hard", "MVP in N days"). The owner finds these noise and never uses them. Describe WHAT to do and HOW it works — not how long it takes.

---

## What to research

### Part 1: MCP Resources and rich content rendering

**Questions to answer:**

1. **MCP spec coverage** (as of late 2026):
   - What content block types does the MCP spec support? (`text`, `image`, `resource`, anything else?)
   - What is the MCP "Resources" feature exactly — how do tools return them, how do clients subscribe to them, what's the lifecycle?
   - What is "structured content" (if it exists in 2026 spec)? Are there schemas for tables, lists, charts, forms?
   - Has the spec added new content types since the original 2024 launch?
   - **Cite the spec version and any RFCs/PRs that introduced rich content.**

2. **Claude Desktop native rendering** (this is the highest-priority client to research):
   - What MCP response content types does Claude Desktop render inline vs. just show as text?
   - Markdown tables — does Claude Desktop render them as proper tables when returned from an MCP tool?
   - Images (base64 or URL) — rendered inline?
   - Code blocks with syntax highlighting — yes/no/which languages?
   - Links — clickable?
   - HTML or rich-text — supported at all, or stripped?
   - File downloads — can a tool return a file the user can save?
   - Charts / visualisations — any native chart rendering, or just text/markdown?
   - "Cards" or "buttons" or any interactive UI — possible?
   - **Look at MCP server examples that ship rich content** (e.g., reference implementations from Anthropic, well-known third-party MCP servers like GitHub MCP, Slack MCP, Linear MCP) and document what they return.

3. **Other major MCP clients** (briefly, half a page each):
   - **Cursor** — what does it render from MCP tools?
   - **Cline** (VS Code extension) — what does it render?
   - **Claude Code** (CLI) — what does it render?
   - **Continue.dev** — supports MCP? what does it render?
   - **Zed editor MCP** — what does it support?
   - Identify any client that supports rich rendering better than Claude Desktop (the "best case" reference).

4. **MCP server-initiated notifications** (NEW priority question):
   - Does the MCP spec support **server-pushed notifications** to a client without the client calling a tool first? (`notifications/resources/list_changed`, `notifications/resources/updated`, others?)
   - **Critically: does Claude Desktop do anything visible to the user when it receives such notifications?** Toast popup? Inject message into current chat? Silent? Nothing?
   - If Claude Desktop does NOT surface notifications, what's the best practice for "AIMEAT agents finished something while user was away from Claude Desktop"? Is OS-level push + user-initiated query the only practical path?
   - Are other MCP clients (Cursor, Cline) better at surfacing server notifications?
   - This question matters for AIMEAT's "AI chief of staff" demo where the user wants to be told when agent crews finish work without polling.

5. **AIMEAT-specific opportunities**:
   - Which AIMEAT MCP tools have responses that would benefit most from rich rendering? Specifically consider:
     - `aimeat_task_list` → returns a list of tasks (good for a table)
     - `aimeat_onboarding_status` → returns step list with statuses (good for a checklist render)
     - `aimeat_memory_list` → returns memory entries (good for a list with keys/types)
     - `aimeat_wallet_balance` → returns balance + transactions (good for a number + small table)
     - `aimeat_catalogue_search` → returns search results (good for cards)
     - `aimeat_knowledge_get` → returns knowledge content (good for rendered markdown)
     - `aimeat_storage_download` → returns file content (good for direct file download or image render)
     - `aimeat_agent_activity` → returns time-series (good for chart? or just table?)
   - For each, recommend: what content type should it return? What does the receiving client need to do?

**Deliverable for Part 1:**
- A **content-type matrix** (MCP content types × major clients, rows are "supported / partial / unsupported / unknown")
- A **recommendations table** for AIMEAT tools: "tool X → currently returns Y → should return Z, because client W renders it as such"
- Concrete code examples of "before / after" for at least 3 AIMEAT tools

---

### Part 2: One-click AIMEAT MCP attachment for major runtimes

**Goal:** A user with a brand-new install of Claude Desktop (or Cursor, Cline, Claude Code, etc.) should be able to attach AIMEAT MCP in under 60 seconds, by copy-pasting one config snippet and restarting the client.

**Questions to answer:**

1. **Claude Desktop** (`claude_desktop_config.json`):
   - Where is the config file located on macOS / Windows / Linux?
   - What's the exact JSON shape for adding an MCP server?
   - Does it support `command + args` invocation? Environment variables? Working directory?
   - Can it handle a Node binary launched via `npx`? Or must it be a globally-installed CLI?
   - **Produce the exact snippet** for adding `aimeat connect serve` to Claude Desktop. Include both `npx aimeat connect serve` (no-install) and `aimeat connect serve` (when globally installed via `npm i -g aimeat`).
   - Are there gotchas (Windows path escaping, line endings, permissions, anti-virus blocking, Node not in PATH)?

2. **Cursor**:
   - How does Cursor expect MCP servers configured (in 2026)?
   - File location, JSON shape, command syntax.
   - **Produce the exact snippet.**

3. **Cline** (VS Code extension):
   - Where in VS Code settings / Cline UI does the user add an MCP server?
   - **Produce the configuration steps + JSON snippet if applicable.**

4. **Claude Code** (the CLI, not the SDK):
   - Can Claude Code attach external MCP servers? Where's the config?
   - **Produce the snippet** if supported.

5. **Continue.dev, Zed, Aider, Sourcegraph Cody, OpenAI Operator** — quick coverage. Which support MCP, which don't, what's the snippet (or "not supported in 2026") for each.

6. **Setup UX**:
   - Should AIMEAT ship a `aimeat connect mcp-config <client>` subcommand that prints the right snippet for the user's client? (This is a small CLI addition that would save documentation pages.)
   - What's the standard "first time MCP server failure" pattern (Node missing, permissions, firewall) and what diagnostics should the snippet/docs include?

7. **Discoverability**:
   - How are users currently finding new MCP servers to install? (Anthropic's official directory, awesome-mcp-servers, etc.) Should AIMEAT be listed in those directories?
   - What metadata do these directories expect?

**Deliverable for Part 2:**
- A **copy-pasteable config snippet** for each major MCP client (at least Claude Desktop, Cursor, Cline)
- A **client capability matrix** (rows: clients, columns: MCP features supported)
- A recommendation on whether AIMEAT should add a `aimeat connect mcp-config <client>` helper subcommand
- A list of MCP server directories to submit AIMEAT to

---

## Output format

```
# AIMEAT MCP Rich Rendering + One-Click Setup — Research Report

## TL;DR
Top 3 recommendations: what to ship first in AIMEAT for biggest UX win.

## Part 1: MCP Content Types & Rich Rendering
### 1.1 MCP spec status (late 2026)
### 1.2 Claude Desktop rendering capabilities
### 1.3 Other clients (Cursor, Cline, Claude Code, Continue, Zed)
### 1.4 Content-type × client matrix
### 1.5 AIMEAT tool recommendations (before/after examples for 3+ tools)

## Part 2: One-Click Setup Configs
### 2.1 Claude Desktop snippet
### 2.2 Cursor snippet
### 2.3 Cline snippet
### 2.4 Claude Code snippet
### 2.5 Others (table)
### 2.6 Suggested `aimeat connect mcp-config <client>` helper
### 2.7 MCP server directories to submit to

## Cross-cutting recommendations
## Open questions
## Source quality notes
```

## Quality bar

- **Test live where possible**: if you can fire up Claude Desktop and actually attach an MCP server (e.g., the reference filesystem server) to verify rendering behaviour, do it. Note what you tested.
- **Cite the MCP spec version** (link to the exact spec doc).
- **Cite the client docs** for each renderer claim.
- **Honest limitations**: if a client doesn't render something or the answer is "no one knows publicly because it's undocumented", say so.
- **Snippets must be copy-pasteable** — include the exact JSON, exact paths, exact commands. Test them mentally for typos.
- **Length:** ~1500-2500 words. Tight and actionable.

## How to run

Use WebSearch + WebFetch on:
- The official MCP spec (https://spec.modelcontextprotocol.io/ or wherever it lives in 2026)
- Anthropic's MCP server reference implementations (github.com/modelcontextprotocol/servers)
- Client docs: Claude Desktop config docs, Cursor MCP docs, Cline docs
- Awesome-MCP-servers lists for examples of advanced server response types

If the deep-research workflow is available, this is a good fit for it (multiple parallel search angles).
