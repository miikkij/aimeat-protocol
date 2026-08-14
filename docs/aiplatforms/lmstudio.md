# LM Studio — AIMEAT Platform Report

**Vendor:** LM Studio  
**URL:** https://lmstudio.ai  
**Updated:** March 2026

## Plans & Tiers

| Plan | Price | Key Features |
|------|-------|-------------|
| LM Studio | Free | Local model inference, OpenAI-compatible API, MCP client & server, GUI |

## Core Features (March 2026)

- **100% Free** — Open-source, no subscription required
- **Local models** — Run any Hugging Face model (Llama, Qwen, Mistral, DeepSeek, etc.)
- **OpenAI-compatible API** — Local server on localhost:1234 with standard API format
- **MCP Client** (v0.3.6+) — Connect to external MCP servers for tool use
- **MCP Server** (via bridge) — Expose local models as MCP server for other clients
- **GUI chat interface** — Visual conversation management
- **GPU acceleration** — NVIDIA, AMD, Apple Silicon support
- **Model quantization** — Q4, Q5, Q8 quantization for memory efficiency
- **Function calling** — Supported with tool-capable models (Qwen, Llama, Mistral, Hermes)
- **Tool call confirmations** — Review and approve tool calls before execution
- **Privacy** — All data stays local, no internet required

## MCP Support

- **As MCP Client (v0.3.6+):**
  - Settings → MCP section → Add Server → Enter MCP server URL/command
  - Supports local (stdio) and remote (HTTP) MCP servers
  - Tool call confirmation dialogs for safety
  - Uses `mcp.json` configuration (Cursor-compatible format)

- **As MCP Server (via bridge):**
  - Install `lmstudio-mcp-server` bridge
  - Expose local models to other MCP clients (Claude Desktop, etc.)

## Recommended Models for MCP/Tool Calling

| Model | Size | Tool Calling | Notes |
|-------|------|-------------|-------|
| Qwen 2.5 7B Instruct | 7B | Excellent | Best tool calling support |
| Llama 3.3 8B Instruct | 8B | Strong | Good general-purpose |
| Mistral 7B Instruct v0.3 | 7B | Good | Balanced speed/quality |
| Hermes 3 8B | 8B | Excellent | Specifically tuned for function calling |

## Code Generation / Apps

- Code generation quality depends on the loaded model
- Larger models (13B+) produce better code output
- DeepSeek Coder models are excellent for code generation locally
- No inline preview — chat output only
- Can generate complete HTML applications

## API

- Local API at `http://localhost:1234/v1/`
- Fully OpenAI-compatible: chat completions, function calling, streaming
- Works with any OpenAI SDK by changing base_url
- No external API calls required — everything runs on your machine

---

## AIMEAT Integration Recommendations

### 🖥️ Apps (Prompt Package)
**Available on: LM Studio (Free — all features)**

Load a code-capable model (DeepSeek Coder, Qwen 2.5) and paste the AIMEAT Application Builder prompt. LM Studio will generate a complete .html file. Quality depends on the model loaded.

**Best models for app generation:** DeepSeek Coder V2 16B, Qwen 2.5 32B Instruct, Llama 3.3 70B

### 🔌 MCP
**Available on: LM Studio (Free — v0.3.6+)**

1. Open **Settings → MCP section**
2. Click **"Edit mcp.json"**
3. Add AIMEAT MCP server:
```json
{
  "mcpServers": {
    "aimeat": {
      "url": "{NODE_URL}/v1/mcp"
    }
  }
}
```
4. Save and restart. AIMEAT tools appear in chat.
5. Use a tool-capable model (Qwen 2.5, Hermes 3) and set temperature to ≤0.1

**Tip:** Tool call confirmation dialogs let you review each AIMEAT action before execution.

### 📡 API
**Available on: LM Studio (via tool-capable models)**

Load a model with function calling support. LM Studio can execute API calls via tools if connected to an MCP server, or generate code that you run manually. The local API server can also be used as a backend for custom AIMEAT client applications.

**Developer path:** Use LM Studio's OpenAI-compatible API as the LLM backend for your own AIMEAT agent. Complete privacy — no data leaves your machine.
