# LM Studio — AIMEAT Platform Report

**Vendor:** LM Studio · **URL:** https://lmstudio.ai
**Vendor facts checked:** 3 September 2026
**Shortest path:** add the node to LM Studio's `mcp.json`, load a model that does tool calling, and go. Free.

## Can it reach a node?

| Road | Works | How |
|---|---|---|
| MCP | Yes, since 0.3.17 | Local and remote MCP servers, added through `mcp.json` or an "Add to LM Studio" button. OAuth for remote servers since 0.4.10 |
| Manual prompt | Yes | Any loaded model can write an app from the node's build prompt |
| HTTP | Yes | LM Studio serves an OpenAI-compatible local API you can drive from your own code |

## What is worth knowing

Free, and it runs entirely on your machine. The current stable build is 0.4.16 (8 June 2026); the
line has moved quickly through the year: OAuth for MCP servers in 0.4.10, stable MTP speculative
decoding in 0.4.14, tensor parallelism across several GPUs in 0.4.15, and an 8k default context plus
a companion iPhone and iPad app in 0.4.16.

This is the combination that makes a **personal node** genuinely private: an AIMEAT node on your own
machine, a model on the same machine, and nothing leaving the house.

## Connecting it

Add the node as a remote MCP server in the app's `mcp.json`:

```json
{
  "mcpServers": {
    "aimeat": { "url": "https://your-node/v1/mcp" }
  }
}
```

Use `https://your-node/v2/mcp/agent` instead if the model starts drowning in tools, then approve the
agent from your profile → Agents.

## What to expect

Model choice decides everything here. The best local tool-callers in mid-2026 are Qwen2.5-72B-Instruct
and Llama-3.1-70B-Instruct, with Mistral-Nemo-Instruct a lighter option on a smaller GPU. A model that
is weak at tool calling will hallucinate tool names rather than call them, and the fix is the model,
not the node. Local models still trail the frontier ones on long multi-step tool sequences, so keep
the surface small (`/v2/mcp/agent` or `/v2/mcp/appdev`) and the tasks short.
