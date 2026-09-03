# GitHub Copilot (VS Code) — AIMEAT Platform Report

**Vendor:** GitHub / Microsoft · **URL:** https://github.com/features/copilot
**Vendor facts checked:** 3 September 2026
**Shortest path:** `npx aimeat connect client vscode --url https://your-node --owner your-handle`

> This is the developer assistant inside VS Code and other IDEs. It is a different product from
> Microsoft 365 Copilot, the Office assistant. See [m365-copilot.md](m365-copilot.md) for that one.

## Can it reach a node?

| Road | Works | How |
|---|---|---|
| MCP | Yes, agent mode, all tiers | An MCP server in the user `mcp.json`, which `aimeat connect client vscode` writes for you |
| Manual prompt | Yes | Paste the node's prompt into chat |
| HTTP | Yes | It has a terminal, so it can `curl` anything |

Copilot's agent mode registers MCP servers as **tools**. It does not consume the resources primitive,
which matters only if you were expecting to browse a server's resource list; AIMEAT's surface is
tools, so nothing is lost.

## Plans that matter

Free (a monthly request allowance), Pro $10/mo, Pro+ $39/mo, Max $100/user/mo, Business $19/user/mo,
Enterprise $39/seat. Billing moved to usage-based on 1 June 2026: a plan converts into a pool of AI
credits and tokens are charged against it at listed model rates. Agent mode and MCP support are
available on every tier, including Free.

## Connecting it

```bash
npx aimeat connect client vscode --url https://your-node --owner your-handle
# writes the user mcp.json → servers entry, leaves your other MCP servers alone
```

Then approve the agent from your profile → Agents. Add `--surface appdev` when the window is for
building apps: it cuts the toolset to about a third, which keeps a small model's context usable.

## What to expect

The strongest combination on this list for actually building: agent mode can read the repository, call
the node, publish an app and verify it, all in one loop. If the model starts losing track of which
tool to use, the toolset is too large for it: switch the server URL to `/v2/mcp/appdev` and it will
settle.
