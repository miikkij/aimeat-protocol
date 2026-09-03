# Gemini — AIMEAT Platform Report

**Vendor:** Google · **URL:** https://gemini.google.com
**Vendor facts checked:** 3 September 2026
**Shortest path:** Gemini CLI with the node as an MCP server. In the consumer chat, the manual road.

## Can it reach a node?

| Road | Works | How |
|---|---|---|
| MCP, consumer chat | **No** | Google has not shipped general custom MCP connectors in the Gemini app |
| MCP, Gemini Spark | Partly | A custom app can be connected by MCP server URL, but only inside Spark tasks and only with Spark access |
| MCP, Gemini Enterprise | Yes | Connected apps → Add MCP server, administrator-configured, with service-account authentication since June 2026 |
| MCP, Gemini CLI | Yes | The CLI is an MCP client and takes server instructions into its system prompt |
| Manual prompt | Yes, every plan | The road for anybody on the consumer app |
| HTTP | Yes | The chat browses public endpoints; the API's function calling drives anything you build |

## Plans that matter

Google's consumer AI plans are AI Plus ($4.99/mo), AI Pro ($19.99/mo) and AI Ultra ($99.99 or
$199.99/mo), plus a free tier. Pro and Ultra raise the limits in Gemini Code Assist and the Gemini
CLI, which is the part that matters here: the CLI is where Gemini can actually hold a node connection.

## Connecting it

**Gemini CLI** is the path. Add the node as an MCP server in the CLI's configuration, pointing at
`https://your-node/v1/mcp` (or `/v2/mcp/appdev` when the session is about building apps), then
approve the agent from your profile → Agents.

**Gemini Enterprise:** an administrator adds the node under Connected apps → Add MCP server. This is
the route for a company that wants everyone's Gemini to see the same node.

**The consumer app:** use the manual road. The node composes the prompt, you paste it in, and you
bring the result back. Nothing is connected, which is also why nothing leaks.

## What to expect

Gemini writes a complete single-file AIMEAT app well, including on the free tier, and Canvas is a
comfortable place to edit one. Its browsing reads public endpoints (`/v1/catalogue`, `/`,
`/.well-known/aimeat`, `/llms.txt`) and can explain a node to you without any account at all.
