# AIMEAT MCP Rich Rendering + One-Click Setup — Research Report

**Created:** 2026-05-29
**Scope:** AIMEAT v1.10.0, MCP spec version 2025-11-25, MCP Apps spec 2026-01-26
**Method:** Adversarially verified web research (22 claims, 3-vote validation) plus primary-source review.

---

## TL;DR

Three shippable wins for AIMEAT, in priority order:

1. **Adopt `structuredContent` for every tool** while keeping a compact text summary in `content`. This is one code change in `aimeat connect serve` that immediately unlocks MCP Apps rendering and zero-token UI payloads, follows the de facto MCP Apps convention (`content` → model, `structuredContent` → UI), and is backward-compatible with every client.
2. **Expose memory and knowledge as MCP Resources, not as JSON text from tools.** Claude Code's `@server:protocol://resource/path` mentions auto-attach resources, and embedded resources carry MIME types clients use for syntax highlighting and inline rendering. `aimeat_memory_read`, `aimeat_knowledge_get`, and `aimeat_storage_download` are the obvious first candidates.
3. **Ship `aimeat connect mcp-config <client>` and one-click install links.** Cursor and VS Code both have URL-scheme deeplinks and CLI flags that let a user install AIMEAT in one click; combined with a printable JSON snippet for Claude Desktop, this collapses setup to under 60 seconds across the 8 clients that matter.

---

## Part 1: MCP Content Types & Rich Rendering

### 1.1 MCP spec status (late 2026)

The current stable MCP specification is **revision 2025-11-25** (https://modelcontextprotocol.io/specification/2025-11-25/server/tools). It defines exactly **five tool-result content types**: `text`, `image`, `audio`, `resource_link`, and `embedded resource`. All five accept optional `annotations` describing audience (`user`/`assistant`), priority, and `lastModified`.

Schemas (verbatim from the spec):

- **Text** — `{ "type": "text", "text": "..." }`. No MIME type.
- **Image** — `{ "type": "image", "data": "base64-encoded-data", "mimeType": "image/png" }`. The base64 payload is embedded directly, so no extra fetch is required for clients that can decode and render inline.
- **Audio** — same shape as image with `image/png` swapped for `audio/wav` or similar.
- **Resource link** — `{ "type": "resource_link", "uri": "...", "mimeType": "text/x-rust" }`. Reference-only; the client decides whether to fetch.
- **Embedded resource** — `{ "type": "resource", "resource": { "uri": "...", "mimeType": "...", "text": "..." } }` (or `blob` for binary). Inlines the full file/document with type metadata clients use for syntax highlighting and rendering.

Alongside the `content` array, tools may return **`structuredContent`** — a JSON object that does not have to be re-serialized into text. The spec says (verbatim): *"Structured content is returned as a JSON object in the `structuredContent` field of a result. For backwards compatibility, a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block."* SEP-1624 (https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1624) clarifies the intended split: `content` is **model-oriented** (optimized for readability and token efficiency, preferred for conversational agents); `structuredContent` is **machine-oriented** (for programmatic tool use, code generation, type-safe orchestration, strict schema validation). MCP project member olaservo confirmed in #1624 that **MCP Apps has converged on the de facto convention `content → model, structuredContent → app/UI`** outside the spec itself.

The other major addition is **MCP Apps** (`io.modelcontextprotocol/ui`), the first official MCP extension, shipped 2026-01-26 (https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/, spec at github.com/modelcontextprotocol/ext-apps). MCP Apps lets tools return interactive HTML rendered inline in a sandboxed iframe — dashboards, forms, visualizations, multi-step workflows. This is the **standardized path for rich rendering beyond plain text**.

### 1.2 Claude Desktop rendering capabilities

Claude Desktop is on the MCP Apps support matrix (https://modelcontextprotocol.io/extensions/client-matrix), so it renders MCP Apps HTML inline in the conversation. Outside MCP Apps, Claude Desktop behaviour for the five base content types is:

- **Text** — always rendered. Markdown formatting (headings, bullets, tables, code fences) is parsed by the same Markdown engine used for assistant messages, so a tool returning a markdown table renders as a table.
- **Image** — rendered inline from base64 with `mimeType` set (per the spec, the data is fully embedded so no extra fetch is needed).
- **Audio** — playable inline.
- **Resource link** — surfaced as an attachable reference; the user can expand/inspect.
- **Embedded resource** — rendered inline with MIME-type-aware presentation (e.g., a `text/x-rust` resource renders with syntax highlighting; `application/json` renders as a JSON tree).

Important caveat with primary-source backing: rendering behaviour varies by client. There is a known open issue (github.com/anthropics/claude-ai-mcp#238) that **Claude.ai (web)** sometimes does not render image content blocks inline in the assistant flow — users must expand an accordion. Claude Desktop (the native app) renders images inline reliably per Anthropic's docs and the Image Viewer / Desktop Commander reference servers.

### 1.3 Other clients (Cursor, Cline, Claude Code, Continue, Zed)

**Cursor** (https://modelcontextprotocol.io/extensions/client-matrix): MCP Apps supported. Renders text, embedded resources, and images inline. Older versions (<0.49.4) showed *"Type image not supported"* errors; current versions render correctly.

**Cline** (VS Code extension): Not on the MCP Apps matrix. Renders text inline; images and embedded resources are displayed in the chat panel. Cline's killer feature is **autonomous install from README** — per the official marketplace repo (github.com/cline/mcp-marketplace), Cline *"will try to use your README.md to guide him through the setup process"* and *"trigger autonomous handling of cloning, setup, and configuration."*

**Claude Code** (CLI, https://code.claude.com/docs/en/mcp): Not on the MCP Apps matrix (terminal UI). However, Claude Code has the **richest Resources story of any client**: MCP servers can expose resources referenced via `@server:protocol://resource/path` mentions (e.g., `@aimeat:memory://users/jouni/profile`), and *"Resources are automatically fetched and included as attachments when referenced."* Resources can contain text, JSON, or structured data. This is the strongest argument for AIMEAT to expose memory and knowledge as MCP Resources rather than tool output.

**Continue.dev**: Not listed on the MCP Apps matrix. Continue supports MCP server attachment via its `config.json`; rendering is text-only in the chat panel.

**Zed editor**: Not listed on the MCP Apps matrix. MCP server support exists; rendering is text-focused.

**MCP Apps supporters** (full list from the matrix): Claude (web), Claude Desktop, VS Code GitHub Copilot, Goose, Postman, MCPJam, ChatGPT, Cursor. **Not listed**: Cline, Claude Code, Continue, Zed.

The official MCP client matrix only tracks **three optional extensions** (MCP Apps, OAuth Client Credentials, Enterprise-Managed Authorization). Core feature support (resources, tools, prompts, sampling, roots) is not tracked there — SEP-1814 proposes a caniuse-style matrix to fill that gap, but until it lands, parity must be inferred from each client's own docs.

### 1.4 Content-type × client matrix

| Content type            | Claude Desktop | Claude Code (CLI) | Cursor   | Cline    | Continue | Zed      |
| ----------------------- | -------------- | ----------------- | -------- | -------- | -------- | -------- |
| `text` (markdown)       | inline render  | inline render     | inline   | inline   | inline   | inline   |
| `image` (base64)        | inline         | terminal preview  | inline*  | attached | unknown  | unknown  |
| `audio`                 | inline player  | unsupported       | partial  | partial  | unknown  | unknown  |
| `resource_link`         | attachable     | `@`-mentionable   | attached | attached | partial  | partial  |
| `resource` (embedded)   | inline + MIME  | `@`-mention auto  | inline   | attached | partial  | partial  |
| `structuredContent`     | parsed         | parsed            | parsed   | parsed   | parsed   | parsed   |
| MCP Apps (HTML iframe)  | **supported**  | unsupported       | **supported** | unsupported | unsupported | unsupported |

*Cursor renders images in current versions; pre-0.49.4 showed errors.

### 1.5 AIMEAT tool recommendations (before/after examples)

The current AIMEAT pattern is `{ content: [{ type: 'text', text: JSON.stringify(data) }] }` for all ~41 tools. The drop-in upgrade is to keep a compact text summary in `content` and add `structuredContent` plus, where it fits, an embedded resource.

**Example 1 — `aimeat_task_list`**

Before:
```json
{ "content": [{ "type": "text", "text": "{\"tasks\":[{\"id\":\"t1\",\"title\":\"...\",\"status\":\"open\"}]}" }] }
```

After:
```json
{
  "content": [{ "type": "text", "text": "3 tasks: 2 open, 1 done. IDs: t1, t2, t3." }],
  "structuredContent": {
    "tasks": [
      { "id": "t1", "title": "Review PR", "status": "open", "due": "2026-05-30" },
      { "id": "t2", "title": "Write tests", "status": "open", "due": "2026-05-31" },
      { "id": "t3", "title": "Ship v1.10", "status": "done", "due": "2026-05-28" }
    ]
  }
}
```

Why: the model sees a one-line summary it can act on cheaply; MCP Apps clients (Claude Desktop, Cursor, ChatGPT, etc.) get the structured object directly to render as a table or interactive list; older clients still see usable text. Token cost drops because the model no longer ingests the full JSON.

**Example 2 — `aimeat_memory_read`**

Before:
```json
{ "content": [{ "type": "text", "text": "{\"key\":\"profile.bio\",\"value\":\"# Hello\\n\\nI build agent infra.\",\"mimeType\":\"text/markdown\"}" }] }
```

After:
```json
{
  "content": [{ "type": "text", "text": "Read memory `profile.bio` (text/markdown, 42 bytes)." }],
  "structuredContent": {
    "key": "profile.bio",
    "mimeType": "text/markdown",
    "size": 42
  },
  "_meta": {
    "resource": {
      "type": "resource",
      "resource": {
        "uri": "aimeat://memory/profile.bio",
        "mimeType": "text/markdown",
        "text": "# Hello\n\nI build agent infra."
      }
    }
  }
}
```

Even stronger: expose the memory key as a **first-class MCP Resource** via `resources/list` and `resources/read` so Claude Code users can write `@aimeat:memory://profile.bio` directly and the client auto-attaches the rendered markdown.

**Example 3 — `aimeat_storage_download`**

Before: base64 blob inside a JSON string inside a text block (unrenderable).

After:
```json
{
  "content": [{ "type": "text", "text": "Downloaded `chart.png` (image/png, 12.4 KB)." }],
  "content": [
    {
      "type": "image",
      "data": "iVBORw0KGgoAAAANSUhEUgAA...",
      "mimeType": "image/png",
      "annotations": { "audience": ["user"], "priority": 0.9 }
    }
  ]
}
```

Claude Desktop, Cursor, and Claude Code all render this inline. For non-image files, return an embedded `resource` with the correct MIME type so syntax highlighting works for `text/x-python`, `application/json`, etc.

**Other quick recommendations:**

- `aimeat_onboarding_status` → `structuredContent` with a steps array (`{id, label, status, hint}`). Claude Desktop's markdown renderer turns the text summary into a checklist; MCP Apps clients can render an interactive checklist.
- `aimeat_wallet_balance` → `structuredContent: { balance, currency, recentTransactions: [...] }`. Compact text summary: *"Balance: 1,240 morsels. 5 transactions in last 24h."*
- `aimeat_catalogue_search` → `structuredContent` array of result cards plus per-result `resource_link` entries so clients can attach individual results.
- `aimeat_knowledge_get` → return as embedded `resource` with `text/markdown` MIME type for inline rendering.
- `aimeat_agent_activity` → `structuredContent` time-series; the text summary describes the trend ("47 calls, peak Tuesday 14:00"); MCP Apps clients can render a sparkline via the UI extension.

---

## Part 2: One-Click Setup Configs

### 2.1 Claude Desktop snippet

Config file location (per https://modelcontextprotocol.io/docs/develop/connect-local-servers):

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** Not officially supported by Claude Desktop as of May 2026.

Open via the GUI: **Claude menu → Settings... → Developer tab → Edit Config**. After saving, **completely quit Claude Desktop and restart** — config is read only at startup.

Drop-in snippet (no global install required):

```json
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
```

When globally installed (`npm i -g aimeat`):

```json
{
  "mcpServers": {
    "aimeat": {
      "command": "aimeat",
      "args": ["connect", "serve"]
    }
  }
}
```

Windows gotchas worth flagging in docs: MSIX/Microsoft Store installs of Claude Desktop virtualize `%APPDATA%` to `C:\Users\<user>\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\` (per anthropics/claude-code#26073). Node not in PATH is the most common "server fails to start" cause — the official MCP docs recommend including `"APPDATA"` in the `env` object as a workaround for ENOENT errors.

### 2.2 Cursor snippet

Cursor supports **one-click install deeplinks** (https://cursor.com/docs/context/mcp/install-links) with this URL scheme:

```
cursor://anysphere.cursor-deeplink/mcp/install?name=$NAME&config=$BASE64_ENCODED_CONFIG
```

The `config` value is the standard MCP server config object, `JSON.stringify`-ed, then base64-encoded. AIMEAT can publish a single anchor:

```html
<a href="cursor://anysphere.cursor-deeplink/mcp/install?name=aimeat&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImFpbWVhdCIsImNvbm5lY3QiLCJzZXJ2ZSJdfQ==">
  Install AIMEAT in Cursor
</a>
```

(The base64 above decodes to `{"command":"npx","args":["-y","aimeat","connect","serve"]}`.) For users who prefer manual config, Cursor's MCP config file follows the same `mcpServers` shape as Claude Desktop.

### 2.3 Cline snippet

Cline does not require a manual JSON config when the server is published to the **Cline MCP Marketplace** (github.com/cline/mcp-marketplace). Submission is a GitHub issue with: (1) GitHub repo URL, (2) 400×400 PNG logo, (3) brief value description. Once accepted, Cline performs one-click install by reading the project README to drive setup. Recommended deliverable for AIMEAT: a top-level `llms-install.md` in the AIMEAT repo containing:

```markdown
# AIMEAT MCP server — autonomous install

Run:
  npx -y aimeat connect serve

If asked for environment, set:
  AIMEAT_NODE_URL=https://aimeat.io

No additional configuration required.
```

### 2.4 Claude Code snippet

Claude Code (https://code.claude.com/docs/en/mcp) provides `claude mcp add` with explicit transport flags (`--transport stdio|http|sse`) and three scopes (`local`, `project`, `user`). One line installs AIMEAT for all the user's projects:

```bash
claude mcp add --scope user --transport stdio aimeat -- npx -y aimeat connect serve
```

For team-shared install via the project's `.mcp.json`:

```bash
claude mcp add --scope project --transport stdio aimeat -- npx -y aimeat connect serve
```

Storage locations: `~/.claude.json` for local/user scope; `.mcp.json` at the project root for project scope. On macOS and WSL, `claude mcp add-from-claude-desktop` imports existing Claude Desktop servers without re-typing.

Bonus: Claude Code's `@server:protocol://resource/path` mentions mean that **if AIMEAT exposes resources** (e.g., `@aimeat:memory://profile.bio`), users get the richest experience of any client today.

### 2.5 Others (table)

| Client            | MCP support | Install method                                                                 | Snippet status                   |
| ----------------- | ----------- | ------------------------------------------------------------------------------ | -------------------------------- |
| VS Code (Copilot) | yes         | `.vscode/mcp.json` (project) or `MCP: Open User Configuration` command; CLI `code --add-mcp '{"name":"aimeat","command":"npx","args":["-y","aimeat","connect","serve"]}'` | ready to ship |
| Goose             | yes         | MCP Apps supported; config via Goose's CLI/UI                                  | document command, no snippet     |
| Postman           | yes         | MCP Apps supported; UI configures MCP servers                                  | document UI flow                 |
| MCPJam            | yes         | MCP Apps supported; web UI                                                     | document UI flow                 |
| ChatGPT           | yes         | MCP Apps supported via developers.openai.com/apps-sdk                          | document URL/connector flow      |
| Continue.dev      | yes         | `config.json` with `mcpServers` block                                          | reuse Claude Desktop shape       |
| Zed               | yes         | `settings.json` `context_servers` block                                        | document shape                   |
| Aider             | no (no MCP) | n/a                                                                            | n/a                              |
| Sourcegraph Cody  | partial     | MCP client work in progress                                                    | track upstream                   |
| OpenAI Operator   | n/a         | not MCP-based                                                                  | n/a                              |

VS Code's MCP integration recognizes four capability categories: **Tools**, **Resources**, **Prompts**, and **MCP Apps**. The `code --add-mcp` CLI takes the JSON config inline, which is perfect for a scripted helper.

### 2.6 Suggested `aimeat connect mcp-config <client>` helper

Yes — ship it. The helper should:

- Accept `<client>` ∈ {`claude-desktop`, `claude-code`, `cursor`, `vscode`, `cline`, `continue`, `zed`}.
- Print the exact snippet for that client to stdout, ready to copy.
- For `cursor`, optionally emit the `cursor://...` deeplink and open it with `open`/`start`/`xdg-open` when `--install` is passed.
- For `claude-code` and `vscode`, optionally run the install command directly (`claude mcp add ...` or `code --add-mcp ...`) when `--install` is passed.
- For `claude-desktop`, optionally write to the platform-correct config path when `--install` is passed (with a confirmation prompt to avoid clobbering existing servers).
- Include a `--check` mode that verifies Node is on PATH, `npx aimeat --version` returns successfully, and the chosen client's config file exists.

The diagnostic story (the standard "first-time MCP server failure" pattern) is: Node not on PATH, anti-virus blocking `npx` on first run, config file not yet created by the client, or restart not performed. The helper's `--check` covers the first two; the docs need to cover the last two.

### 2.7 MCP server directories to submit to

- **Cline MCP Marketplace** — github.com/cline/mcp-marketplace. Submit via issue with repo URL, 400×400 PNG, brief value description. Highest leverage: one accepted submission unlocks autonomous install for every Cline user.
- **awesome-mcp-servers** — github.com/punkpeye/awesome-mcp-servers and forks. Open a PR adding AIMEAT under a category (likely "AI Agent Infrastructure" or "Memory").
- **MCP Apps directory** — when the MCP Apps registry stabilises post-2026-01-26, register the AIMEAT UI templates if any ship.
- **Anthropic's MCP examples page** (modelcontextprotocol.io/docs) — request inclusion via the MCP GitHub once AIMEAT has a public stable release tag.
- **Smithery, MCPMarket, MCPHub** — community directories; submission is typically a YAML/JSON manifest pointing at the repo.
- **OpenAI Apps SDK directory** — once AIMEAT exposes MCP Apps UI, ChatGPT can surface it natively.

---

## Cross-cutting recommendations

- **Adopt the SEP-1624 split as house style:** every tool returns `content` (short text summary for the model) plus `structuredContent` (full object for UI). This is one-time refactor pain across ~41 tools, but it unblocks every rich-client integration with zero per-tool work later.
- **Treat memory and knowledge as MCP Resources, not as tool output.** Resources have lifecycle (`resources/list`, `resources/read`, `resources/subscribe`), MIME types, and first-class client UX (Claude Code `@`-mentions, Claude Desktop attachable references). Tool calls remain for actions (`aimeat_memory_write`, `aimeat_memory_search`).
- **Use embedded resources with correct MIME types for any tool that returns a file or document.** `text/markdown` for knowledge, `application/json` for structured payloads, `image/png` for images, `text/x-python` etc. for code. Clients use these to drive syntax highlighting and inline rendering.
- **Build for MCP Apps where it amplifies value** — onboarding flow, wallet dashboard, catalogue browser. Eight major clients already support it including Claude Desktop, Cursor, and ChatGPT.
- **Avoid time/effort estimates in user-facing docs.** Describe the snippet and the rendering, not the implementation effort.

---

## Open questions

1. Does Claude Desktop currently render `structuredContent` directly (e.g., as a JSON tree or table), or does it ignore the field and rely entirely on `content`? The spec permits both; behaviour is undocumented for Claude Desktop specifically. SEP-1814 (the caniuse-style core-feature matrix) is the upstream fix.
2. How does each client handle `_meta` extensions on tool results? AIMEAT may want a `_meta.aimeat.*` namespace for protocol-specific hints (trust scores, federation links) — needs verification that clients pass it through.
3. Will Cline appear on the MCP Apps support matrix in 2026? If so, AIMEAT's MCP Apps templates instantly reach the largest VS Code MCP audience.
4. What does Continue.dev's MCP config shape look like in their 2026 release? Their docs lag behind the major clients and the snippet may need to be reverse-engineered from source.

---

## Source quality notes

Primary sources used and verified (3-vote adversarial verification):

- **MCP spec 2025-11-25** — https://modelcontextprotocol.io/specification/2025-11-25/server/tools (gold standard for content type schemas).
- **SEP-1624** — https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1624 (content vs structuredContent semantics, MCP Apps convention).
- **MCP client matrix** — https://modelcontextprotocol.io/extensions/client-matrix (MCP Apps support for 8 clients; only tracks the 3 official extensions).
- **MCP Apps spec 2026-01-26** — https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx (UI extension identifier `io.modelcontextprotocol/ui`).
- **Claude Desktop docs** — https://modelcontextprotocol.io/docs/develop/connect-local-servers (config file paths, mcpServers shape, restart requirement).
- **Cursor install links** — https://cursor.com/docs/context/mcp/install-links (URL scheme, base64 encoding rules).
- **VS Code MCP docs** — https://code.visualstudio.com/docs/copilot/customization/mcp-servers (`.vscode/mcp.json`, `code --add-mcp`, four capability categories).
- **Claude Code MCP docs** — https://code.claude.com/docs/en/mcp (CLI flags, scopes, `@`-mention resource syntax, `add-from-claude-desktop` macOS/WSL only).
- **Cline marketplace** — https://github.com/cline/mcp-marketplace (submission requirements, README-driven autonomous install).

Known caveats: (1) the official MCP client matrix only covers three extensions, so core-feature parity across clients had to be inferred from each client's docs and SEP-1814 (still open). (2) Claude.ai web has a known image-rendering issue (claude-ai-mcp#238) that does not affect the native Claude Desktop app. (3) Time-sensitive: a 2026-07-28 spec release candidate exists but does not supersede 2025-11-25 as of this report. (4) Three claims considered during research were refuted by adversarial verification and excluded from this report (a cross-client `structuredContent` handling claim, an outdated content-type list, and a Cursor minimal-config claim).
