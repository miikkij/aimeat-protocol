# OpenClaw — AIMEAT Platform Report

**Vendor:** OpenClaw project, open source · **URL:** https://github.com/openclaw
**Vendor facts checked:** 3 September 2026
**Shortest path:** `npx aimeat connect --url https://your-node --owner your-handle`, then run `aimeat connect serve` beside the agent.

## Can it reach a node?

| Road | Works | How |
|---|---|---|
| MCP | Yes | OpenClaw is an MCP client and connects to tool servers directly |
| Manual prompt | Yes | It is your own agent; paste anything into it |
| HTTP | Yes, fully | Self-hosted, so it can call any endpoint with a token you hold |

## What is worth knowing

An autonomous agent that uses messaging platforms as its interface, first released in November 2025
as Warelay. It is now one of the most-starred repositories on GitHub and is deployed in production by
people who run it themselves, including a managed offering on Cloudways since 17 August 2026 where
one-click MCP integration attaches existing servers.

**Two things an operator should weigh.** The release train is fast and breaking: since February 2026
three major series shipped, the latest of them changing node execution, requiring plugin verification
through ClawHub, and patching WebSocket security. And the project logged nine CVEs during 2026, with
the June release specifically tightening transcript, sandbox, MCP, browser, channel and
exec-approval paths. If you run it against a node that matters, pin a version, read its release notes,
and give its agent the narrowest scopes that let it do its job.

## Connecting it

```bash
npx aimeat connect --url https://your-node --owner your-handle --agent openclaw
# approve from your profile → Agents; the CLI stores the token and prints the Hello Integration
# instruction to paste into the agent
npx aimeat connect serve      # attaches the AIMEAT toolset over stdio
```

For a runtime that cannot do stdio, every tool is also reachable one at a time:

```bash
npx aimeat connect call aimeat_memory_search --json '{"query":"pricing"}'
```

## What to expect

An agent that lives in a chat channel and works while you are not watching, which is exactly the shape
AIMEAT's agent plane is built for: give it a scoped identity, tags, its own skills, and a run mode,
and watch it from the Agents page. Prefer `--surface agent` for a general assistant and keep operator
scopes out of its token.
