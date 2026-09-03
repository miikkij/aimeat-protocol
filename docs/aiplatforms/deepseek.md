# DeepSeek — AIMEAT Platform Report

**Vendor:** DeepSeek · **URL:** https://www.deepseek.com
**Vendor facts checked:** 3 September 2026
**Shortest path:** run a DeepSeek model inside a client that speaks MCP (Goose, LM Studio, Cursor), not the DeepSeek web chat.

## Can it reach a node?

| Road | Works | How |
|---|---|---|
| MCP, the web chat | No | There is no connector surface in the chat |
| MCP, via a client | Yes | The models handle tool calling well; the MCP client is Goose, LM Studio, Cursor or your own |
| Manual prompt | Yes, free | The chat writes a complete AIMEAT app from the node's build prompt |
| HTTP | Yes, via the API | Cheap enough to run an agent loop against a node continuously |

## What is worth knowing

The current lineup is **V4 Pro** (the flagship), **V4 Flash** (cost-optimised) and **R1** (reasoning),
with R1 distillations from 1.5B to 70B that run on consumer hardware. V4 Pro is about $1.04 per
million input tokens and $1.20 per million output; V4 Flash is roughly two orders of magnitude
cheaper, which is what makes DeepSeek interesting for anything that runs on a schedule. New API
accounts get 5 million free tokens for 30 days.

The local distillations matter here too: an R1 distill on your own machine, driven by LM Studio or
Goose, reaches an AIMEAT node with no vendor in the path at all.

## Connecting it

**Through Goose**, which is the least work:

```bash
npx aimeat connect client goose --url https://your-node --owner your-handle
# then set an OpenRouter (or DeepSeek) key and pick a DeepSeek model
GOOSE_MODEL=deepseek/deepseek-v4-pro ~/.aimeat-goose/launch-goose.sh
```

**Through LM Studio** if you are running a distilled model locally: add the node to the app's
`mcp.json` and load a model that does tool calling well.

## What to expect

Good code generation for the price, and reliable enough at tool calling to drive a node through an
MCP client. The web chat cannot reach a node; treat it as a place to generate an app file you publish
by hand.
