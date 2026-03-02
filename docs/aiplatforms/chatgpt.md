# ChatGPT — AIMEAT Platform Report

**Vendor:** OpenAI  
**URL:** https://chatgpt.com  
**Updated:** March 2026

## Plans & Tiers

| Plan | Price | Key Features |
|------|-------|-------------|
| Free | $0 | GPT-4o mini, search, limited usage |
| Go | $6/mo | GPT-4o, lower cost entry |
| Plus | $20/mo | GPT-4o, Canvas, code execution, MCP (Developer Mode), custom GPTs |
| Pro | $200/mo | GPT-5, unlimited usage, Pulse, advanced voice, MCP |
| Team | $25/user/mo | Workspace, admin controls, MCP |
| Enterprise | Custom | SSO, compliance, advanced security, MCP |

## Core Features (March 2026)

- **Canvas** — Collaborative code editor window alongside chat (similar to Claude Artifacts)
- **Interactive Code Blocks** — Write, edit, and run code directly in chat (Feb 2026)
- **Code Interpreter / Advanced Data Analysis** — Python sandbox for computation, charts, file processing
- **Codex** — Cloud-based AI coding agent (Feb 2026). Multi-agent orchestration platform inside ChatGPT. Handles autonomous multi-step software engineering tasks. Runs in cloud sandboxes, can execute code, run tests, and build complete applications. Available on Pro/Team/Enterprise.
- **Codex CLI** — Open-source terminal agent (codex-cli). Runs locally in your terminal. Can make HTTP requests, browse files, execute commands.
- **GPT Actions** — Custom GPTs can make RESTful API calls to external services (including AIMEAT). Developers define API schemas; ChatGPT handles the natural language → API call bridge.
- **Custom GPTs** — Build and share custom AI assistants in the GPT marketplace
- **Search** — Real-time web search built into chat, can browse web pages
- **Voice Mode** — Real-time voice conversations
- **Memory** — Cross-conversation context retention
- **Prism** — AI-native research workspace for long-form collaboration
- **DALL-E / Image Generation** — Built-in image creation
- **File Upload & Analysis** — PDF, CSV, images, documents
- **Plugins/Apps** — Extensible via third-party connectors

## MCP Support

- **Available on:** Plus, Pro, Team, Enterprise (via Developer Mode)
- **Setup:** Settings → Apps & Connectors → Advanced Settings → Developer Mode ON → Add connector
- **Authentication:** OAuth or no-auth, remote MCP servers via SSE and Streamable HTTP
- **Notes:** Developer Mode shows warning about unverified connectors. Memory is disabled when Developer Mode is active.

## Code Generation / Apps

- Excellent at generating full HTML/CSS/JS applications
- Canvas provides a side-by-side code editing workspace
- Code Interpreter runs Python in-browser but cannot make external HTTP calls
- **Codex** (cloud agent) — autonomous coding agent that runs in sandboxed cloud environments. Can write, test, and iterate on code. Creates PRs, fixes bugs, handles multi-file projects. Powered by GPT-5.3-Codex model.
- **Codex CLI** — terminal-based agent that CAN make external HTTP requests, browse the web, and interact with APIs directly
- Can generate self-contained single-file web apps with all logic embedded
- Interactive Code Blocks allow inline editing and re-running (Feb 2026+)
- **GPT Actions** allow custom GPTs to call external REST APIs directly from chat

## API

- OpenAI API with full chat completions, function calling, embeddings, images, audio
- Compatible SDK for multiple languages (Python, Node.js, etc.)
- Supports Ed25519 operations via prompt-guided code

---

## AIMEAT Integration Recommendations

### 🖥️ Apps (Prompt Package)
**Available on: All plans (Free, Go, Plus, Pro, Team, Enterprise)**

ChatGPT can generate complete single-file HTML applications with AIMEAT integration. All plans can produce code — Canvas (Plus+) provides a better code editing experience.

**Prompt:** Copy the AIMEAT Application Builder prompt, paste it into ChatGPT, and it will interview you about what you want to build, then generate a complete .html file with AIMEAT authentication, memory, boards, and more. Save the file and open it in your browser.

### 🔌 MCP
**Available on: Plus ($20/mo), Pro ($200/mo), Team, Enterprise**

1. Go to **Settings → Apps & Connectors → Advanced Settings**
2. Toggle **Developer Mode** ON (confirm the warning)
3. Click **"+" → More → Create App**
4. Enter MCP Server URL: `{NODE_URL}/v1/mcp`
5. Set authentication to **OAuth** and follow the login flow
6. You now have 14 AIMEAT tools available in chat

### 📡 API
**Available on: All plans (via web browse + GPT Actions + Codex CLI)**

ChatGPT Plus/Pro can browse URLs and make web requests. ChatGPT's **web search** can access public AIMEAT endpoints.

**GPT Actions path:** Build a custom GPT with AIMEAT API schema — it will make REST calls directly from the chat. This is the cleanest API integration for ChatGPT users.

**Codex CLI path:** The open-source Codex CLI agent runs in your terminal and CAN make HTTP requests to AIMEAT endpoints. Full registration → authentication → API usage flow.

**Browse path:** Free plan can browse public pages (catalogue, boards, node info) via web search.
