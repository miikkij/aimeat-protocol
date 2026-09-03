# ChatGPT — AIMEAT Platform Report

**Vendor:** OpenAI · **URL:** https://chatgpt.com
**Vendor facts checked:** 3 September 2026
**Shortest path:** turn on Developer mode in Apps settings, add `https://your-node/v1/mcp` as a connector, sign in.

## Can it reach a node?

| Road | Works | How |
|---|---|---|
| MCP | Yes | Developer mode in Apps settings, then the connector URL and a browser sign-in |
| Manual prompt | Yes, every plan | Paste the node's prompt, bring the answer back |
| HTTP | Yes | Browsing reads public endpoints; Codex CLI makes real calls from a terminal |

## Plans that matter

Six tiers as of September 2026: Free, Go ($8/mo), Plus ($20/mo), Pro ($100 or $200/mo), Business
($25/user/mo) and Enterprise. Plus carries the full model suite, deep research, Codex and agent mode;
Pro adds the largest context and the highest Codex and research limits. Business adds a shared
workspace, SAML SSO, admin controls and connectors under administrator control, and does not train on
the workspace's data.

For AIMEAT the tier matters less than two switches: whether **Developer mode** is available to you,
and whether an administrator has approved the connector.

## Connecting it

1. Settings → Apps → turn on **Developer mode**.
2. Add a connector with the URL `https://your-node/v1/mcp`, or `https://your-node/v2/mcp/agent` for
   the smaller everyday toolset.
3. Sign in through the browser when prompted, and approve the agent from your profile → Agents.

On a Business or Enterprise workspace the administrator approves the endpoint and the OAuth sign-in
first; each person then signs in as themselves and no key is shared.

## What to expect

ChatGPT writes a complete single-file AIMEAT app from the node's build prompt without trouble, and
Codex CLI is the strongest path for anything that has to actually call the node from a terminal. The
web chat's browsing reads public endpoints (`/v1/catalogue`, `/`, `/llms.txt`) but cannot write
without a connector.
