# DeepSeek — AIMEAT Platform Report

**Vendor:** DeepSeek  
**URL:** https://www.deepseek.com  
**Updated:** March 2026

## Plans & Tiers

| Product | Price | Key Features |
|---------|-------|-------------|
| DeepSeek Chat (Web) | Free | DeepSeek-V3.2, 128K context, web-based chat |
| DeepSeek API | Pay-as-you-go | OpenAI-compatible API, function calling, batch processing |

## Core Features (March 2026)

### DeepSeek Chat (Web App)
- **Free access** to DeepSeek-V3.2 — competitive with GPT-4 class models
- **Deep thinking mode** (R1) — Step-by-step reasoning, similar to o1
- **Code generation** — DeepSeek Coder excels at programming tasks
- **Web search** — Real-time search integration in chat
- **File upload** — Document analysis and processing
- **No MCP support** — Web chat cannot connect to external MCP servers
- **No HTTP requests** — Cannot make external API calls from the web interface
- **No artifacts/canvas** — Code output is inline in chat only

### DeepSeek API
- **OpenAI-compatible API** — Use existing OpenAI SDKs with changed base_url
- **Models:** deepseek-chat (V3.2 non-thinking), deepseek-reasoner (V3.2 thinking)
- **Function calling** — Full tool use support via API
- **128K context window**
- **Extremely cost-effective** — Significantly cheaper than OpenAI/Anthropic
- **Streaming support** — Real-time response streaming

## MCP Support

- **Web App:** No MCP support. DeepSeek Chat has no connector/plugin system.
- **API:** DeepSeek API supports function calling, so it can be used as a backend for MCP clients (Claude Desktop, VS Code, LM Studio, Cursor, etc.) via community bridges.
- **Third-party:** DeepSeek models can be added to MCP-compatible hosts like LM Studio, Cursor, or other tools that allow custom model providers.

## Code Generation / Apps

- Excellent code generation quality (DeepSeek Coder)
- Generates full HTML/CSS/JS applications
- Cannot preview or run code — output is text only in web chat
- R1 (reasoning mode) provides step-by-step coding with explanations
- For privacy: run DeepSeek locally via Ollama or LM Studio

## API

- Fully OpenAI-compatible: `base_url: https://api.deepseek.com`
- Supports chat completions, function calling, streaming
- Very competitive pricing (~10x cheaper than GPT-4)
- Can be used from any application that supports OpenAI API format

---

## AIMEAT Integration Recommendations

### 🖥️ Apps (Prompt Package)
**Available on: DeepSeek Chat (Free) and DeepSeek API**

DeepSeek Chat can generate complete AIMEAT HTML applications. Since it can't preview code inline, copy the generated HTML and save it as a file.

**Prompt:** Copy the AIMEAT Application Builder prompt into DeepSeek Chat. DeepSeek will interview you and generate a complete .html file. Copy the code, save as a file, and open in your browser.

### 🔌 MCP
**Not available on DeepSeek Chat web interface**

DeepSeek's web chat does not support MCP connectors. However, you can use DeepSeek models via:
- **LM Studio** — Download DeepSeek models locally, use LM Studio's MCP client
- **VS Code** — Use DeepSeek as model provider in Copilot/Cursor with MCP enabled
- **Cursor** — Add DeepSeek API as custom model, then use MCP servers

### 📡 API
**Available on: DeepSeek Chat (limited, via code generation)**

DeepSeek Chat cannot make direct HTTP calls. Copy the API integration prompt into chat — DeepSeek will explain the steps and generate code you can run yourself. For programmatic access, use the DeepSeek API with function calling to build AIMEAT integration.

**Developer path:** Use DeepSeek API as backend for your own AIMEAT client application. The OpenAI-compatible API makes it easy to swap in as an LLM provider.
