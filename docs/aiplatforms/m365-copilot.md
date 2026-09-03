# Microsoft 365 Copilot — AIMEAT Platform Report

**Vendor:** Microsoft · **URL:** https://copilot.microsoft.com
**Vendor facts checked:** 3 September 2026
**Shortest path:** an administrator builds an agent in Copilot Studio and points it at the node's MCP endpoint. Without that, the manual road.

> The Office and productivity assistant, not the coding one. For GitHub Copilot in VS Code see
> [github-copilot.md](github-copilot.md).

## Can it reach a node?

| Road | Works | How |
|---|---|---|
| MCP, the Copilot chat itself | No | There is no place for an end user to add a connector |
| MCP, through Copilot Studio | Yes | Copilot Studio has had general-availability MCP support since 2025: an agent there can call any MCP server the organisation configures |
| Manual prompt | Yes | The road for anybody without Copilot Studio |
| HTTP | Indirectly | Copilot's browsing can read a public node; IndexNow submission helps it find one |

## Plans that matter

Microsoft 365 Copilot is $30 per user per month. **Copilot Studio** is billed in Copilot Credits
rather than per seat, from $0.01 a credit up to a $200 pack of 25,000. **Microsoft Agent 365**, a
control plane for governing custom agents across a tenant, went generally available on 1 May 2026 as
a $15 per user per month add-on, and is where an IT department would watch what an AIMEAT-connected
agent is doing.

## Connecting it

1. In **Copilot Studio**, create an agent.
2. Add the node as an MCP server: `https://your-node/v1/mcp`, or `https://your-node/v2/mcp/agent` for
   the smaller surface.
3. Publish the agent into whichever channel the team uses, Teams included.
4. Approve the agent from your profile → Agents on the node.

Everything here is administrator territory. An individual with a Copilot licence and no Copilot
Studio access cannot connect a node, and should use the manual road instead.

## What to expect

Copilot Studio's value is that an AIMEAT node becomes one more knowledge and action source beside
SharePoint, Dataverse, Graph and 1,400-odd connectors, governed the way the tenant governs everything
else. The cost of that is that nothing happens without an administrator, which is the opposite of how
the rest of this list works.
