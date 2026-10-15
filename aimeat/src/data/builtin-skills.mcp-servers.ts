/**
 * @file src/data/builtin-skills.mcp-servers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-mcp-servers` built-in skill: how an AI helps a person attach another MCP
 *   server to their node (GitHub, a ticket system, a company's own server), sign in to it, narrow
 *   what each of their agents may call on it, and take it away again.
 *
 *   WHY IT EXISTS. The MCP proxy family had sixteen rows in the feature list and long tool
 *   descriptions, and no guide anywhere said when to use which tool, in what order, or what a
 *   refusal means (docs audit 2026-10-11, gap 1). The descriptions tell an AI how to call one tool;
 *   this tells it how the pieces fit: attach, sign in, grant, read-only, call caps, node and group
 *   servers, and the refusals.
 *
 *   WHAT IT MUST AGREE WITH. tool-catalog/definitions/mcp-proxy.ts (the tools and their inputs),
 *   routes/mcp-servers.ts (the REST routes, the OAuth attach and the callback),
 *   services/mcp-client/grants.ts (grant order, read-only from the server's own annotation, call cap,
 *   expiry), services/mcp-client/registry.ts (node and group servers, availability),
 *   services/mcp-client/invoke.ts (refusal codes and statuses, the money price refusal),
 *   services/mcp-client/oauth.ts (the sign-in round), mcp/remote-tools.ts (flatten),
 *   services/mcp-client/stdio-policy.ts (stdio servers). A group server is not reachable through the
 *   MCP tools today (wish-a-group-s-attached-mcp-server-is-listed-but-cannot-be-called); the skill
 *   says so, and the line goes when that is fixed.
 * @structure MCP_SERVERS_SKILL_ENTRY
 * @usage import { MCP_SERVERS_SKILL_ENTRY } from './builtin-skills.mcp-servers.js';
 * @version-history
 *   2026-10-15 — Section 3: an app with mcp:use calls tools, a grant for app:{owner}/{file} narrows it, an
 *     agent's grantee is its full name, and a grant on an operator's server answers GRANT_NOT_APPLICABLE
 *     (feature-list audit #12).
 *   2026-10-15 — A failed renewal marks the server as needing a new sign-in at once and refuses the
 *     call with UPSTREAM_UNAUTHORIZED (feature-list audit #9).
 *   2026-10-15 — aimeat-mcp-servers: an expires value that is not a date is refused when the grant is written (feature-list audit 13).
 *   v1.0.0 — 2026-10-12 — Initial (docs audit phase 5a).
 */
/** The shape of a BuiltinSkill, named here rather than imported so this file closes no import cycle
 *  with builtin-skills.ts, which imports it; the compiler checks the two agree where it is listed. */
type BuiltinSkillEntry = { name: string; skillMd: string; visibility?: 'members' | 'public' };

export const MCP_SERVERS_SKILL_ENTRY: BuiltinSkillEntry = {
  name: 'aimeat-mcp-servers',
  visibility: 'public',
  skillMd: `---
name: aimeat-mcp-servers
description: How to attach another MCP server to a person's AIMEAT node (a code host, a ticket system, a company's own server, another AIMEAT node) so that everything acting for them can use its tools through this one connection, and how to keep that safe. Covers attaching with a token or an OAuth sign-in, listing and calling the tools, narrowing what each agent or app may call (a tool list, read-only, a call cap, an expiry, fixed inputs), the two ways tools appear (one gateway tool or each tool by name), servers the operator offers to everyone, group servers, a peer node as a server, the refusals and what to tell the person, and switching a server off or removing it. Use when a person says "connect my GitHub / Jira / Linear to AIMEAT", "let my agent use that MCP server", "only let it read", or when a call to an attached server is refused.
license: MIT
metadata:
  audience: agent
---

# Attaching other MCP servers to a node

**What the person gets.** They connect a tool they already use once, to their own node, and from then
on every AI and agent acting for them reaches it through AIMEAT, under rules the person sets: which
agent may call which tool, read-only or not, how often, and until when. The token stays on their
node, encrypted, and never comes back out. Taking it away is one call, and every agent loses the
tools at the same moment.

Three permissions decide who may do what:

- \`mcp:read\`: see the attached servers and their tools.
- \`mcp:use\`: call a tool on one.
- \`mcp:manage\`: attach, sign in, change, narrow and remove. **It is not part of full access**: an
  agent holds it only when the person gave it by name, because attaching a server to somebody's
  account is the person's decision. Without it, tell the person what you would attach and let them
  do it on the MCP page of their profile (\`/v1/profile?tab=mcp\`), or approve the permission.

## 1. Attach

\`aimeat_mcp_attach\` with:

- \`name\`: a short name used instead of the address (\`jira\`, \`github\`). Lowercase letters, digits,
  dashes.
- \`url\`: the server's address. Ask the person for it; never guess an address.
- \`token\` and, when the server does not take a bearer token, \`header\` (for example \`X-API-Key\`).
  Ask the person for the token. It is encrypted on the node and is never shown again, to you or to
  anyone.
- \`transport\`: \`http\` (the current one, the default) or \`sse\` (the older one).
- \`title\` and \`description\` for the person's screen.

The node checks the address before it saves anything, so a wrong address or a wrong token is reported
now, not later as a server that never answers. A name that already exists is refused rather than
duplicated. Addresses that resolve to private or internal networks are refused.

**A server that uses OAuth sign-in** (the person signs in at the far side instead of handing over a
token) is attached through \`POST /v1/mcp-servers\` with \`auth: "oauth"\`, or from the MCP page.
\`aimeat_mcp_attach\` has no OAuth input today. Then:

1. \`aimeat_mcp_authorize\` with the server's name. It returns an address on this node.
2. Give the address to the person and say in one sentence what it is for. They open it signed in to
   their node, confirm, and sign in at the far side. Opening it yourself does nothing: the round is
   bound to the person's browser.
3. When they come back, \`aimeat_mcp_tools\` with \`refresh: true\` shows the tools.

The node refreshes the sign-in by itself before calls. When that renewal fails, the server is marked
as needing a new sign-in at once and the call is refused (\`UPSTREAM_UNAUTHORIZED\`): run
\`aimeat_mcp_authorize\` again and hand the address over.

## 2. Look and call

- \`aimeat_mcp_list\`: the servers the person can use (their own, and those the operator offers them).
- \`aimeat_mcp_tools\` with \`server\`: that server's tools, from the node's cache; \`refresh: true\`
  asks the server again.
- \`aimeat_mcp_call\` with \`server\`, \`tool\` and \`arguments\`: one call. Treat every call as a write
  that cannot be undone unless you know the tool reads only: the node cannot tell what the far side
  does with it.

**Two ways the tools appear.** By default a server is a **gateway**: its tools are reached through
\`aimeat_mcp_call\`. Set \`exposure: "flatten"\` with \`aimeat_mcp_update\` and each tool the session
may call appears as its own tool, named \`{server}__{tool}\`, with the server's own input schema. That
suits a server the person uses every day; a gateway keeps the tool list short. Only the person's own
servers that are active are flattened, and a session takes a limited number of flattened tools.

## 3. Narrow what each agent may call

With no grant, the permission alone decides: an agent with \`mcp:use\` may call every tool on the
person's servers, and so may an app the person gave \`mcp:use\` on its consent screen. A **grant
narrows that for one agent or app, never widens it.** Only the person's own servers take a grant: a
grant on a server the operator offers answers \`GRANT_NOT_APPLICABLE\`, because it would limit nobody.
\`aimeat_mcp_grant_set\` with:

- \`server\` and \`grantee\`: an agent's full name (\`agent#owner@node\`), \`app:{owner}/{file}\` for an app, or \`*\` for everyone
  without their own grant. An agent's own grant wins over \`*\`.
- \`tools\`: \`"*"\` or a list of tool names. Required: decide it with the person.
- \`read_only: true\`: only tools the server itself marks as read-only (its \`readOnlyHint\`
  annotation) may be called. A tool without that mark is refused, whatever its name says.
- \`call_cap: { count, windowHours }\`: at most that many successful calls in the window.
- \`expires\`: an ISO date; after it, every call under the grant is refused. A value that is not a
  date is refused when the grant is written.
- \`locked_input\`: values merged over what the caller sends, and they win. Use it to pin a project,
  a repository or a tenant so the agent cannot reach another one.

A new grant for the same agent on the same server replaces the old one. \`aimeat_mcp_grant_list\`
shows them. **\`aimeat_mcp_grant_revoke\` widens access back to what the permission allows; it does
not take access away.** To take a server away from one agent, set its grant with \`tools: []\` (an
empty list allows no tool) or remove \`mcp:use\` from the agent; to take it away from everyone, switch
the server off.

The person in their own session, on their own server, needs no grant.

## 4. Servers someone else attached

- **Offered by the operator.** The node's operator attaches servers for the whole node and decides who
  may use them (everyone, or a named list) with \`aimeat_mcp_registry_set\`; \`aimeat_mcp_registry_list\`
  shows them. Both need the operator's permission (\`operator:admin\`). A person can use such a server
  but never change it. A per-call price can be recorded, but this node cannot take payment for a
  proxied call yet, so a priced server answers 402 \`PRICE_UNSUPPORTED\`: tell the person the operator
  can make it free. Servers that run as a local program (stdio) exist only when the operator turned
  them on in the node's configuration and named the allowed commands.
- **A group's server.** An owner or admin of an organism attaches a server for the group with
  \`organism_id\` (and \`ws\` to bind it to one workspace, where the workspace roles decide: a
  contributor may call, a viewer only sees it). Today a group server is listed in
  \`GET /v1/mcp-servers\` and reached through a published capability, but \`aimeat_mcp_list\`,
  \`aimeat_mcp_tools\` and \`aimeat_mcp_call\` do not find it, and an OAuth sign-in for it cannot
  finish. Say so rather than retrying.
- **Another AIMEAT node.** Attach with \`peer\` (the peer node's id) instead of \`url\`. The address is
  looked up on every call, so the link ends when the peering ends, and the peering must allow routing.

## 5. When a call is refused

| What came back | What it means | What to do |
|---|---|---|
| \`NOT_GRANTED\` (403) | the permission, the tool list, read-only, the cap or the expiry stopped it | read \`aimeat_mcp_grant_list\`; ask the person before changing a grant |
| 403, server switched off | the person or the operator switched it off | ask whether to switch it on (\`aimeat_mcp_update\` \`enabled: true\`) |
| \`PRICE_UNSUPPORTED\` (402) | an operator's server with a price | tell the person; the operator decides |
| needs a new sign-in | the OAuth sign-in expired or was withdrawn | \`aimeat_mcp_authorize\`, hand the address over |
| 502 | the far server failed or did not answer in time | retry once later; then tell the person which server |
| 503 \`NO_ENCRYPTION_KEY\`, \`PEER_UNKNOWN\`, \`PEER_NOT_ROUTABLE\` | the node's configuration or the peering | send it to the operator (\`support@operators\`) |
| 508 | the call came back round through other nodes | the servers point at each other; tell the person |

A server that answers not found may also be one the caller cannot use: the node gives the same answer
for both. Every call, refused or not, is counted in the person's usage.

## 6. Switch off, remove, keep it current

- \`aimeat_mcp_update\` \`enabled: false\` stops every call at once and keeps the setup and the token.
  Use it when the person wants a pause.
- \`aimeat_mcp_detach\` removes the server and its token. Every agent loses the tools at the same
  moment. It cannot be undone; attaching again needs the token or the sign-in again.
- **How it goes stale.** A server nobody calls still holds a credential to the person's account
  somewhere else. When you list servers for a person, name the ones they have not used for a long
  time and the grants whose expiry has passed, and ask whether to remove them. A grant with
  \`expires\` is the way to give an agent temporary access that ends by itself.

## The rule underneath

The person decides what reaches their accounts elsewhere. Show the server, the tools and the grant
you are about to set, in plain words, before you set it; never copy a token into memory, a message
or a log; and prefer a narrow grant with an expiry over broad access.
`,
};
