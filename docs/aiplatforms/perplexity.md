# Perplexity — AIMEAT Platform Report

**Vendor:** Perplexity · **URL:** https://www.perplexity.ai
**Vendor facts checked:** 3 September 2026
**Shortest path:** the manual road, or the API from your own runtime. MCP here is narrower than it looks.

## Can it reach a node?

| Road | Works | How |
|---|---|---|
| MCP | Partly | Pro, Max and Enterprise support MCP connections, and local MCP servers work through the macOS app. This is not a general remote-connector surface |
| Manual prompt | Yes | Paste the node's prompt, bring the answer back |
| HTTP | Yes | The API from your own code, and Perplexity's own MCP server exposes its search to other clients |

## What is worth knowing

Perplexity's relationship with MCP runs the other way from everyone else on this list. At its Ask 2026
developer conference in March 2026 the company said it was **moving away from MCP internally** for its
own systems and enterprise-facing work, on the argument that the protocol costs too much context; the
support that remains is for cases like letting a local desktop tool reach Perplexity's real-time
search.

So the useful direction is usually reversed: rather than pointing Perplexity at your node, point your
node's agent at Perplexity's MCP server when it needs live search, and keep the AIMEAT side on the
manual road or the API.

## Connecting it

**Node → Perplexity** (the direction that works well): add Perplexity's MCP server to the client your
agent already uses, alongside the AIMEAT server, and the agent can search the live web and write what
it finds into memory.

**Perplexity → node:** on macOS with a Pro or Max plan, a local MCP server can be attached; a remote
AIMEAT node is not the shape this surface is built for. Use the manual road instead, which loses
nothing: Perplexity's strength is research, and research comes back as text you paste into the node.

## What to expect

The best of these platforms at finding and citing sources, and the least interested in being an
agent's tool host. Treat it as a research instrument that feeds the node rather than a client that
drives it.
