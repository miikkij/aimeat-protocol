# Grok — AIMEAT Platform Report

**Vendor:** xAI  
**URL:** https://x.com/i/grok / https://grok.com  
**Updated:** March 2026

## Plans & Tiers

| Plan | Price | Key Features |
|------|-------|-------------|
| Free (Basic) | $0 | Limited Grok 3 access, basic chat, Aurora image generation |
| X Premium | $8/mo | Higher Grok usage limits, priority access |
| X Premium+ | $40/mo | Highest X limits, priority Grok, ad-free |
| SuperGrok | $30/mo | Standalone, Grok 4, extended 128K memory, Imagine images |
| SuperGrok Heavy | $300/mo | Grok-4 Heavy, multi-agent reasoning, continuous sessions |

## Core Features (March 2026)

### Grok Chat (x.com / grok.com)
- **Grok 3 / Grok 4** — Frontier reasoning models with real-time X/Twitter data
- **Code execution** — Python sandbox for running code (Grok 4), **can make HTTP requests** to external APIs
- **Aurora** — Image generation built into chat
- **Imagine** — Advanced image model (SuperGrok)
- **Real-time X data** — Access to live posts, trends, and discussions
- **Voice mode** — Voice conversations (SuperGrok)
- **Web search** — Built-in search capabilities
- **File upload** — Document and image analysis
- **No MCP support** — Grok chat has no external connector/MCP system
- **HTTP via sandbox** — Grok's Python code execution sandbox CAN make external HTTP requests (e.g., `requests` library). AIMEAT memory read/write has been verified working from Grok chat.

### Grok API
- **OpenAI-compatible API** — Standard chat completions format
- **Models:** Grok-4-fast (2M context!), Grok-4, Grok-3 series, Grok-Code-Fast
- **Function calling** — Full tool calling support via API
- **2M context window** (Grok 4-fast) — Largest in the industry
- **Competitive pricing** — Positioned between OpenAI and open-source

## MCP Support

- **Grok Chat:** No MCP support. No connector/extension system in the chat interface.
- **Grok API:** Full function calling support — can be used as backend for MCP clients
- **Third-party:** Community `grok-api-mcp` server provides xAI API docs as MCP tools. Grok models can be used in MCP-compatible hosts (VS Code, Cursor, LM Studio).

## Code Generation / Apps

- Grok 4 has a Python sandbox for code execution
- Good at generating full HTML/CSS/JS applications
- No inline preview (like Canvas/Artifacts) — code output is text in chat
- Code execution sandbox is Python-only, cannot serve web apps
- Strong reasoning capabilities for complex application logic

## API

- xAI API at `https://api.x.ai/v1/`
- OpenAI-compatible format: chat completions, function calling, streaming
- API key from console.x.ai (requires X Premium/Premium+)
- Supports 44 endpoints across 12 categories (chat, images, videos, voice, models, etc.)

---

## AIMEAT Integration Recommendations

### 🖥️ Apps (Prompt Package)
**Available on: All plans (Free, Premium, SuperGrok)**

Grok can generate complete AIMEAT HTML applications. The Python sandbox (code_execution) cannot host web apps but can be used to test API calls.

**Prompt:** Copy the AIMEAT Application Builder prompt into Grok chat. Grok will interview you and generate the HTML application code. Copy it, save as a file, and open in your browser.

### 🔌 MCP
**Not available on Grok chat interface**

Grok's chat does not support MCP connectors directly. Use Grok models via:
- **VS Code** — Use Grok API as model provider with MCP servers enabled
- **Cursor** — Add xAI API as custom model, then use MCP servers
- **Custom setup** — Use Grok API with function calling to build custom MCP client integration

### 📡 API
**Available on: Grok chat (via code execution sandbox) — confirmed working**

Grok's Python code execution sandbox can make HTTP requests using the `requests` library. AIMEAT memory micro-operations have been tested and work correctly from Grok chat.

**Usage:** Copy the API integration prompt into Grok chat. Grok will write and execute Python code that calls AIMEAT endpoints. Registration, authentication (Ed25519 signing), memory read/write — all confirmed functional.

**Developer path:** Use Grok API's function calling to build AIMEAT client applications. The 2M context window is excellent for complex multi-step API workflows.
