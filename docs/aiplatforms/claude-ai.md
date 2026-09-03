# Claude — AIMEAT Platform Report

**Vendor:** Anthropic · **URL:** https://claude.ai
**Vendor facts checked:** 3 September 2026
**Shortest path:** `npx aimeat connect client claude-code --url https://your-node --owner your-handle`, or add the node as a remote connector in the web app.

## Can it reach a node?

| Road | Works | How |
|---|---|---|
| MCP | Yes, Pro and up | Remote connector in claude.ai, Claude Desktop and the mobile apps; stdio in Claude Code |
| Manual prompt | Yes, every plan | Paste the node's prompt into the chat, bring the answer back |
| HTTP | Yes | Claude Code makes real calls from the terminal; the chat can read public endpoints |

## Plans that matter

| Plan | Price | For AIMEAT |
|---|---|---|
| Free | $0 | Manual road, and reading public endpoints |
| Pro | $20/mo | Remote MCP connectors, Claude Code in the terminal, file creation and code execution |
| Max | $100 or $200/mo | Same features, 5x or 20x the usage |
| Team | $25/seat/mo standard, $125/seat/mo premium (5 seats minimum) | Premium adds Claude Code, which is the tier an engineering team wants |
| Enterprise | Custom | Administrator-approved connectors |

## Connecting it

**Claude Code**, one command:

```bash
npx aimeat connect client claude-code --url https://your-node --owner your-handle
# approve the agent from your profile → Agents, and the toolset is there
```

**The web app, Desktop or mobile:** Settings → Connectors → Add connector, then the node's MCP URL
(`https://your-node/v1/mcp`), then the browser sign-in. Use `https://your-node/v2/mcp/agent` instead
when you want the smaller everyday toolset, or `/v2/mcp/appdev` when the session is about building
apps.

## What to expect

Artifacts make Claude the pleasantest place to build an AIMEAT app by hand: it writes the HTML with
a live preview beside it, and you download the file and publish it. Over MCP it is the client this
project is developed against, so it is the one most likely to behave.

**On a company-managed account** the first connection can raise a prompt-injection or untrusted-source
warning. That is the environment, not the prompt: the administrator approves the MCP endpoint and the
OAuth sign-in first, and then it passes. The three ways round it are in the repository README.
