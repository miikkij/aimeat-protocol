# LM Studio + AIMEAT Integration Guide

Connect a local LLM running in LM Studio to an AIMEAT node via MCP for persistent memory and agent capabilities — fully local, no cloud dependencies.

---

## Overview

| Component | Where It Runs | Purpose |
|-----------|--------------|---------|
| LM Studio | localhost | Local LLM inference |
| AIMEAT node | localhost:40050 | Memory, work coordination, agent services |
| MCP | localhost | Tool protocol connecting LM Studio → AIMEAT |

Everything stays on your machine. No data leaves your network.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| LM Studio | With MCP plugin/tool-calling support |
| AIMEAT node | Running locally (`pnpm dev`) |
| A model with tool-calling | e.g., Qwen 2.5, Mistral, Llama 3, any model with function calling |

---

## Setup

### 1. Start your AIMEAT node

```bash
cd aimeat
AIMEAT_ANONYMOUS=true pnpm dev
```

Anonymous mode is recommended for local-only setups — no registration or auth needed.

### 2. Configure LM Studio MCP

Add AIMEAT as an MCP server in LM Studio's MCP configuration:

```json
{
  "mcpServers": {
    "aimeat": {
      "transport": "streamable-http",
      "url": "http://localhost:40050/v1/mcp"
    }
  }
}
```

### 3. Set the system prompt

Use the system prompt from [docs/init-prompts/openclaw-aimeat-agent.md](../init-prompts/openclaw-aimeat-agent.md) — it works with any MCP client, not just OpenClaw.

Or fetch it via API:
```bash
curl http://localhost:40050/v1/prompts/openclaw | jq '.data.system_prompt'
```

### 4. Verify tools are available

In LM Studio, check that the 18 AIMEAT tools appear in the tool list. Try a simple test:

> "What tools do you have for memory?"

The model should identify `aimeat_memory_read`, `aimeat_memory_write`, and `aimeat_memory_list`.

---

## Local-Only Security

Since both LM Studio and AIMEAT run on localhost:

- No network exposure — MCP traffic stays local
- No API keys needed (anonymous mode)
- No cloud dependency — works fully offline
- Memory persists across LM Studio sessions by default (in-memory storage resets on AIMEAT restart; use SQLite adapter for disk persistence)

To prevent external access to your AIMEAT node, keep the default binding:
```env
AIMEAT_HOST=127.0.0.1
```

---

## Tips for Local Models

- **Tool-calling quality varies**: Larger models (7B+) handle AIMEAT tools better. Smaller models may struggle with structured JSON parameters.
- **System prompt length**: The full system prompt is ~2K tokens. If your model has a small context window, use the condensed version (just the BOOT SEQUENCE and KEY CONVENTIONS sections).
- **Memory as context extension**: Use AIMEAT memory to extend your model's effective context — store long documents as memory entries and retrieve relevant pieces via `aimeat_memory_read`.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Tools not appearing in LM Studio | Ensure LM Studio's MCP plugin is enabled and supports StreamableHTTP |
| Model doesn't call tools | Use a model with function-calling support; check LM Studio's tool-calling settings |
| "Connection refused" | Verify AIMEAT is running on port 40050: `curl http://localhost:40050/v1/health` |
| Memory lost on restart | AIMEAT uses in-memory storage by default. For persistence, configure SQLite (REQ-003) |

---

## Related

- [OpenClaw Integration Guide](openclaw-setup.md) — Same AIMEAT tools, different client
- [System Prompt](../init-prompts/openclaw-aimeat-agent.md) — Works with any MCP client
- [Compatibility Notes](openclaw-compatibility.md) — Transport and auth details

---

*Created: 2026-03-04 — REQ-001*
