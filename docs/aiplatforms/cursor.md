# Cursor — AIMEAT Platform Report

**Vendor:** Anysphere · **URL:** https://cursor.com
**Vendor facts checked:** 3 September 2026
**Shortest path:** `npx aimeat connect client cursor --url https://your-node --owner your-handle`

## Can it reach a node?

| Road | Works | How |
|---|---|---|
| MCP | Yes, on the paid plans | An entry in `~/.cursor/mcp.json`, which the connect command writes for you |
| Manual prompt | Yes | Paste the node's build prompt into the chat |
| HTTP | Yes | It has a terminal |

MCP tools are available in every chat mode in Cursor, not only in an agent mode, which makes it
pleasant for the "ask a question about my node while writing code" pattern.

## Plans that matter

Hobby (free), Pro $20/mo (or $16 annual), Pro+ $60/mo with triple the credits, Ultra $200/mo, plus
Teams and Enterprise. MCP servers, cloud agents and frontier models are on the paid plans, and a
regional Start plan launched in India on 28 July 2026 at ₹649/month that also includes MCP servers.

A January 2026 update added dynamic context management across MCP servers, cutting token use by about
47 % when several servers are attached at once. With AIMEAT's 303-tool surface that is the difference
between usable and not, though a scoped surface is still the better lever.

## Connecting it

```bash
npx aimeat connect client cursor --url https://your-node --owner your-handle --surface appdev
# writes ~/.cursor/mcp.json, merging with whatever servers you already had
```

Approve the agent from your profile → Agents. `--workdir` is worth setting: an agent writes files
where it is launched, and this keeps it out of your source repositories.

## What to expect

The most direct "build an app and publish it without leaving the editor" loop after VS Code with
Copilot. Cursor is also where a node's own repository is comfortable to work in, since the same
window holds the code and the live node.
