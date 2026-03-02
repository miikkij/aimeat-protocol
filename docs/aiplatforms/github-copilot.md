# GitHub Copilot (VS Code) — AIMEAT Platform Report

**Vendor:** GitHub / Microsoft  
**URL:** https://github.com/features/copilot / VS Code  
**Updated:** March 2026

> **Note:** GitHub Copilot is a developer-focused AI coding assistant inside VS Code (and other IDEs). It is a completely separate product from Microsoft 365 Copilot (M365 Copilot), which is Microsoft's Office/productivity AI. See [m365-copilot.md](m365-copilot.md) for the M365 product.

## Plans & Tiers

| Plan | Price | Key Features |
|------|-------|-------------|
| GitHub Copilot Free | $0 | Limited completions, Copilot Chat, basic agent mode |
| GitHub Copilot Pro | $10/mo | Unlimited completions, full agent mode, MCP |
| GitHub Copilot Business | $19/user/mo | Organization management, policy controls, MCP |
| GitHub Copilot Enterprise | $39/user/mo | Knowledge bases, fine-tuning, MCP |

## Core Features (March 2026)

- **Agent Mode** — Autonomous multi-step coding: identifies files, applies changes, runs builds, fixes errors automatically
- **MCP Support** — Connect to any MCP server for real-time context (GitHub, databases, APIs, AIMEAT, etc.)
- **Multi-model** — Choose between Claude Sonnet 4, GPT-4.1, Gemini 2.5 Pro, and more
- **Tool calling** — Built-in tools + extensible via MCP servers
- **Terminal integration** — Execute commands, analyze output, self-healing on errors
- **Prompt files** — Reusable `.prompt.md` files for team-shared workflows
- **MCP Apps** — Visual UI rendering from MCP servers directly in VS Code
- **Code completions** — Inline suggestions as you type
- **Chat panel** — Conversational coding assistance in the sidebar
- **Multi-file editing** — Agent mode can create, edit, and delete files across your project

## MCP Support

- **Available on:** All tiers (Free, Pro, Business, Enterprise)
- **Spec support:** Full MCP — local and remote servers, OAuth, SSE, Streamable HTTP
- **Setup:** Add to `.vscode/mcp.json` in workspace or VS Code user settings
- **Configuration:**
```json
{
  "servers": {
    "aimeat": {
      "url": "{NODE_URL}/v1/mcp"
    }
  }
}
```
- Agent mode automatically discovers MCP tools and shows them in the tool dropdown (wrench icon)

## Code Generation / Apps

- Excellent at generating full web applications from high-level descriptions
- Agent mode creates files directly in your workspace
- Self-healing: automatically fixes build errors and retries
- Terminal access for running commands, building, testing
- Can handle complete project scaffolding (HTML, CSS, JS, TypeScript, Python, etc.)

## API

- VS Code Copilot can make HTTP calls via terminal (curl, fetch scripts, Node.js, Python)
- Agent mode can write and execute API client code directly
- Full terminal access means any CLI tool or HTTP client is available
- Can handle the entire AIMEAT registration → authentication → API usage flow through terminal

---

## AIMEAT Integration Recommendations

### 🖥️ Apps (Prompt Package)
**Available on: All tiers (Free, Pro, Business, Enterprise)**

Use VS Code agent mode to generate complete AIMEAT applications. Agent mode can create files directly in your workspace, run them, and fix errors automatically.

**Usage:** Open Copilot Chat → Switch to Agent Mode → Paste the AIMEAT Application Builder prompt → Agent creates the .html file in your project.

### 🔌 MCP
**Available on: All tiers — best integration path**

1. Create `.vscode/mcp.json` in your project:
```json
{
  "servers": {
    "aimeat": {
      "url": "{NODE_URL}/v1/mcp"
    }
  }
}
```
2. Open Copilot Chat in Agent Mode
3. AIMEAT tools appear in the tool dropdown (wrench icon)
4. Try: *"Check my AIMEAT node catalogue"* or *"Write a note to my AIMEAT memory"*

### 📡 API
**Available on: All tiers (via terminal)**

VS Code Copilot can execute terminal commands. Ask it to run curl/fetch commands against AIMEAT endpoints. Agent mode can handle the full registration → authentication → API usage flow through terminal.

**Example:** *"Register me as an owner on my AIMEAT node at https://mynode.example.com and create an agent"*
