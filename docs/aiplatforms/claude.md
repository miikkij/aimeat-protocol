# Claude — AIMEAT Platform Report

**Vendor:** Anthropic  
**URL:** https://claude.ai  
**Updated:** March 2026

## Plans & Tiers

| Plan | Price | Key Features |
|------|-------|-------------|
| Free | $0 | Sonnet 4.5, Projects, Artifacts, file creation, app connectors, web search |
| Pro | $20/mo | Opus model, Claude Code (CLI), extended thinking, 200K context, MCP connectors |
| Max | $100/mo | 5–20x more usage than Pro, higher Claude Code limits |
| Team | $25/user/mo | Team workspace, admin, MCP |
| Enterprise | Custom | SSO, compliance, advanced security, MCP |

## Core Features (March 2026)

- **Artifacts** — Interactive code and content viewer with live preview (HTML, React, SVG, Mermaid)
- **Projects** — Organized workspaces with custom instructions and knowledge files
- **Claude Code (CLI)** — Terminal-based AI coding agent with file system access, Git integration, MCP support (Pro+)
- **Web Search** — Built-in real-time web search
- **Computer Use** — Autonomous desktop task execution (61.4% OSWorld)
- **Extended Thinking** — Deep reasoning mode for complex problems
- **File Upload & Analysis** — PDF, CSV, images, documents, code files
- **App Connectors** — Pre-built integrations (Google Drive, Notion, GitHub, Slack, etc.)
- **200K Context** — Large context window (1M beta available)
- **Vision** — Image understanding and analysis

## MCP Support

- **Available on:** Pro, Max, Team, Enterprise (remote MCP servers via claude.ai and Claude Desktop)
- **Mobile:** iOS and Android also support remote MCP servers (since July 2025)
- **Setup:** Settings → Connectors → Add connector → Enter MCP Server URL
- **Protocols:** SSE and Streamable HTTP (SSE may be deprecated soon)
- **Authentication:** Authless and OAuth-based remote servers supported

## Code Generation / Apps

- Artifacts provide excellent live HTML/JS preview directly in chat
- Leading coding performance (77.2% SWE-bench with Sonnet 4.5)
- Claude Code provides full IDE-like coding in terminal (Pro+)
- Can generate complete single-file web apps with embedded auth, key management
- Strong at generating complex interactive applications

## API

- Anthropic API with Messages API, tool use, vision, batch processing
- Extensive function calling / tool use support
- API models: Opus, Sonnet, Haiku at various price points
- Ed25519 signing can be done via prompt-guided code generation

---

## AIMEAT Integration Recommendations

### 🖥️ Apps (Prompt Package)
**Available on: All plans (Free, Pro, Max, Team, Enterprise)**

Claude excels at generating complete HTML applications. Artifacts provide live preview directly in chat — you can see your AIMEAT app running while Claude builds it.

**Prompt:** Copy the AIMEAT Application Builder prompt, paste it into Claude, and it will interview you. Claude generates the HTML in an Artifact with live preview. Click "Download" to save the file, or copy the code.

### 🔌 MCP
**Available on: Pro ($20/mo), Max ($100/mo), Team, Enterprise**

1. Go to **claude.ai → Settings → Connectors**
2. Click **"Add Connector"**
3. Enter MCP Server URL: `{NODE_URL}/v1/mcp`
4. Complete OAuth authentication
5. Claude now has access to 14 AIMEAT tools
6. Also works on **Claude Desktop** (Settings → Connectors) and **mobile apps**

**Claude Code users:** Add to `~/.config/claude/mcp_servers.json`:
```json
{
  "aimeat": {
    "url": "{NODE_URL}/v1/mcp"
  }
}
```

### 📡 API
**Available on: All plans (via prompt-guided HTTP calls)**

Claude Pro/Max can browse URLs and analyze content. Copy the API prompt to get started. Claude Code (Pro+) provides the best API integration experience — it can make real HTTP calls from the terminal. Free plan can browse public AIMEAT endpoints.
