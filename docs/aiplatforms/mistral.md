# Mistral Le Chat — AIMEAT Platform Report

**Vendor:** Mistral AI · **URL:** https://chat.mistral.ai
**Vendor facts checked:** 3 September 2026
**Shortest path:** add the node as a custom MCP connector in Le Chat.

## Can it reach a node?

| Road | Works | How |
|---|---|---|
| MCP | Yes | Le Chat ships 20-odd MCP-powered connectors and takes your own custom ones as well |
| MCP, from your own code | Yes | The built-in connectors and custom MCP servers are available through the API and SDK for model and agent calls |
| Manual prompt | Yes | Paste the node's build prompt |
| HTTP | Yes | Via the API from your own runtime |

## What is worth knowing

Le Chat's connector directory covers the usual work tools (Slack, GitHub, Notion, Box, Drive,
Confluence and more), and the same mechanism accepts a custom MCP server, which is where an AIMEAT
node goes. Because those connectors are also reachable from the API and SDK, an agent you build on
Mistral models can hold the node connection the same way the chat does.

This is the European option on this list, which matters to some operators for the same reason AIMEAT
runs in Finland under European rules.

## Connecting it

1. In Le Chat, open the MCP connectors directory and add a **custom connector**.
2. Point it at `https://your-node/v1/mcp`, or `https://your-node/v2/mcp/agent` for the smaller
   everyday toolset.
3. Sign in when prompted, then approve the agent from your profile → Agents.

The node has to be reachable from the public internet, so a personal node needs its tunnelled address
rather than `localhost`.

## What to expect

Solid tool calling and a connector model that was designed around MCP rather than retrofitted, so the
node appears as one more tool source beside the rest of the workspace. Verify what a fresh connector
may do before trusting it with anything: on the AIMEAT side, give the agent the narrowest scopes that
let it work.
