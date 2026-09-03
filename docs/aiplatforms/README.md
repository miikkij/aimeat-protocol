# AI Platform Reports — AIMEAT Integration

One report per AI platform: can it reach an AIMEAT node, by which road, and what is the shortest way
in. Vendor facts were checked on **3 September 2026**; every report carries its own check date,
because plans, prices and whether a chat has an MCP connector all move every few weeks.

## The three roads in

**MCP** is the road we prefer. Point the client at `POST /v1/mcp` for the whole toolset, or at a
scoped `/v2/mcp/{agent|appdev|service|admin}` surface for one job, sign in once in the browser, and
303 tools appear with no token pasting and no per-tool wiring.

**The manual road** works on every platform, including the ones that can reach nothing: the node
composes a prompt, you read it, you paste it into the chat, and you bring the answer back. Nothing is
connected and nothing leaves the chat until you send it. This is a permanent path, and for
confidential material it is often the right one.

**The API road** is for anything that can make an HTTP request: point it at `llms.txt` and let it
read its way in, or give it a token and let it call the endpoints directly.

## The shortest path, where one exists

Five clients need one command. It authorizes an agent of its own, writes that client's MCP config in
the shape it expects, and leaves a launcher that supplies the token at run time:

```bash
npx aimeat connect client <goose|claude-code|cursor|vscode|claude-desktop> \
  --url https://your-node --owner your-handle [--surface appdev]
```

It merges into whatever MCP servers you already had, backs the file up first, refuses to write if it
cannot parse what is there, and never writes the token into a config file.

## Platforms

| Platform | MCP in the product | Shortest path | Report |
|---|---|---|---|
| **Claude** | Yes, Pro and up (Settings → Connectors, also Desktop and mobile) | `aimeat connect client claude-code` or a remote connector | [claude-ai.md](claude-ai.md) |
| **ChatGPT** | Yes, via Developer mode in Apps settings | Add the connector URL | [chatgpt.md](chatgpt.md) |
| **Grok** | Yes, since May 2026: Bring Your Own MCP at grok.com/connectors | Paste the node's MCP URL | [grok.md](grok.md) |
| **Gemini** | Not in the consumer chat. Yes in Gemini Enterprise, Gemini Spark and the CLI | Gemini CLI, or the manual road | [gemini.md](gemini.md) |
| **GitHub Copilot (VS Code)** | Yes, agent mode, all tiers | `aimeat connect client vscode` | [github-copilot.md](github-copilot.md) |
| **Cursor** | Yes, all paid plans | `aimeat connect client cursor` | [cursor.md](cursor.md) |
| **Goose** | Yes. Open source, any model through OpenRouter | `aimeat connect client goose` | [goose.md](goose.md) |
| **M365 Copilot** | Only through Copilot Studio, admin-configured | Copilot Studio, or the manual road | [m365-copilot.md](m365-copilot.md) |
| **Mistral Le Chat** | Yes, custom MCP connectors | Add the node as a custom connector | [mistral.md](mistral.md) |
| **Perplexity** | Local MCP on macOS; the company moved off MCP internally | Manual road, or the API | [perplexity.md](perplexity.md) |
| **DeepSeek** | Not in the web chat. Via any MCP client with a DeepSeek model | Goose or LM Studio with a DeepSeek model | [deepseek.md](deepseek.md) |
| **LM Studio** | Yes, since 0.3.17, local and remote servers with OAuth | Add the node in `mcp.json` | [lmstudio.md](lmstudio.md) |
| **Ollama** | Not itself an MCP client. Pair it with one | Goose or LM Studio pointed at Ollama | [ollama.md](ollama.md) |
| **OpenClaw** | Yes, MCP client | Full HTTP access, self-hosted | [openclaw.md](openclaw.md) |

## What has changed since the March 2026 edition

- **Grok gained an MCP client** (Bring Your Own MCP, May 2026). The old reports called it read-only.
- **The toolset grew from 14 tools to 303**, which is why the scoped `/v2/mcp/<role>` surfaces exist
  and why `--surface appdev` is worth using for a build session.
- **`aimeat connect client` landed**, so five of these platforms are one command rather than a page of
  manual steps.
- **Five reports were added**: Cursor, Goose, Ollama, Mistral Le Chat and Perplexity.
- **The Claude report is `claude-ai.md`**, not `claude.md`. On a case-insensitive filesystem the old
  name collided with `CLAUDE.md`, the file Claude Code reads as project instructions, so an agent
  working in this directory quietly ingested a platform report as its own briefing.
- Everything the reports say about AIMEAT itself was re-verified against the live node: `POST
  /v1/mcp`, `/v2/mcp/{role}`, `/v1/catalogue`, `/`, `/.well-known/aimeat`, `/.well-known/mcp.json`
  and `/llms.txt` all answer.

---

*AIMEAT-side facts and vendor facts both checked 3 September 2026. Prices are what the vendor
published that day; check the vendor's own page before quoting one.*
