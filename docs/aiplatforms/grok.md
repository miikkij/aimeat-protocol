# Grok — AIMEAT Platform Report

**Vendor:** xAI · **URL:** https://grok.com and https://x.com/i/grok
**Vendor facts checked:** 3 September 2026
**Shortest path:** grok.com/connectors → New connector → Custom → paste `https://your-node/v1/mcp`.

## Can it reach a node?

| Road | Works | How |
|---|---|---|
| MCP | **Yes, since May 2026** | Bring Your Own MCP: a custom connector taking any publicly reachable MCP server URL. Paid tiers |
| Manual prompt | Yes, every plan | Paste the node's prompt, bring the answer back |
| HTTP | Yes, from your own runtime | The xAI API and Grok Build (the CLI) speak MCP natively; the chat itself only browses |

**This is the report that changed most.** Until May 2026 Grok could only read public endpoints, and
the earlier edition of this page said so. It now has a real MCP client surface, which makes it the
fourth major assistant with one after Claude, ChatGPT and Gemini's enterprise surfaces.

## Plans that matter

Free, SuperGrok (~$30/mo), SuperGrok Plus (~$100/mo) and SuperGrok Heavy (~$300/mo, multi-agent).
Connectors and the custom MCP option are on the paid tiers. On the API, Grok 4.6 is $2.00 per million
input tokens and $6.00 per million output, and the built-in tools (web search, X search, code
execution) bill separately per thousand calls.

## Connecting it

1. Open **grok.com/connectors**.
2. **New connector → Custom**, and paste `https://your-node/v1/mcp`. A scoped
   `https://your-node/v2/mcp/agent` works too and keeps the toolset small.
3. Sign in when prompted, then approve the agent from your profile → Agents.

The node must be reachable from the public internet for this: a personal node behind a tunnel needs
its public address, not `localhost`.

## What to expect

Grok's code sandbox has no internet, so it cannot reach a node from inside a Python block. It is
still useful there for things that need no network: morsel pacing simulations, validating a JSON
document against a schema you paste in, generating an Ed25519 keypair for testing, or sketching an
action's input and output schemas before you write the manifest.
