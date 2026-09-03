# Ollama — AIMEAT Platform Report

**Vendor:** Ollama · **URL:** https://ollama.com
**Vendor facts checked:** 3 September 2026
**Shortest path:** Ollama serves the model; Goose or LM Studio holds the node connection.

## Can it reach a node?

| Road | Works | How |
|---|---|---|
| MCP | Not on its own | Ollama is an inference server, not an MCP client. It runs models and exposes a chat API with tool calling |
| MCP, paired | Yes | Put an MCP-aware client in front of it: Goose, LM Studio, Cline or Continue.dev. The client calls Ollama for inference and translates the model's tool calls into MCP calls |
| Manual prompt | Yes | Any loaded model writes an app from the node's build prompt |
| HTTP | Yes | Your own code drives Ollama's API and the node's REST API together |

## What is worth knowing

Free and local. The pairing matters more than the model: you need a local runtime (Ollama), an
MCP-aware client, and the node as an MCP server. Nothing about that arrangement reaches the internet
except the node call itself, and if the node is your own personal node, not even that.

For tool calling, Qwen3 is currently the most reliable local family, with the fewest dropped tool
calls; Gemma 4, GLM-4.7 and Llama 3.3 also work. Local models still trail Claude, GPT and Gemini on
long multi-step tool sequences, so keep the toolset small and the tasks short.

## Connecting it

**With Goose**, which needs no extra configuration beyond pointing it at Ollama:

```bash
npx aimeat connect client goose --url https://your-node --owner your-handle
# then configure goose to use the ollama provider and a tool-calling model
GOOSE_MODEL=qwen3 ~/.aimeat-goose/launch-goose.sh
```

**With LM Studio** instead, if you prefer a graphical app: see [lmstudio.md](lmstudio.md).

Use `https://your-node/v2/mcp/agent` rather than `/v1/mcp` here. 303 tools will bury a local model.

## What to expect

This is the fully sovereign setup: an AIMEAT Personal Node on your machine, Ollama on the same
machine, and an agent working on your data with nothing leaving it. The AIMEAT desktop app can connect
a local Ollama or LM Studio to your account for exactly this reason.
