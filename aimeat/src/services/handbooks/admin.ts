/**
 * @file admin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operating handbook for the v2 `admin` surface (/v2/mcp/admin). Self-contained; tool
 *   list mirrors MCP_SURFACES.admin. Operator/owner governance — most tools require operator role and
 *   are runtime-gated (a non-operator caller will get "Operator role required").
 * @version-history
 *   v1.6.0 -- 2026-09-12 -- aimeat_admin_federation, with the thing that trips every operator:
 *     approving a peering request connects nothing until somebody presses Activate.
 *   v1.5.0 -- 2026-09-12 -- aimeat_admin_knowledge, with the thing an AI reading it has to say out
 *     loud: the total, not the page length. The catalogue tool answers a smaller question and
 *     nothing said so.
 *   v1.4.0 -- 2026-09-12 -- The organisation sign-in order is six steps, and the sixth is a node
 *     setting no tool here can reach. An AI that stops at five reports a finished setup behind a
 *     shut door.
 *   v1.3.0 -- 2026-09-12 -- aimeat_admin_usage, with the two things an AI reporting a bill has to
 *     say out loud: which of the three totals is the operator's, and that none of them contains the
 *     chat agent's key.
 *   v1.2.0 -- 2026-09-12 -- aimeat_admin_statistics, and the correction that goes with it:
 *     aimeat_admin_stats was described here as "health/metrics" and carries neither.
 *   v1.1.0 -- 2026-08-24 -- Organisation sign-in (BR-04): the SSO-connection tools, the setup
 *     order that works, and the manual account disable/enable pair.
 *   v1.0.0 -- 2026-05-30 -- Initial admin-surface handbook
 */

export const ADMIN_HANDBOOK = `# AIMEAT — Admin / Governance Surface Handbook

You are connected to the **admin** surface: operator and owner governance for the node. This is
sensitive — node administration, content moderation, data-sharing governance, and owner-side agent
management. Several tools require the **operator** role and are runtime-gated; if you are not an
operator they return "Operator role required". Use deliberately.

## Your tools

**Node administration (operator).** \`aimeat_admin_usage\` (what AI COSTS here, and whose money it
is: \`whose_money.house\` is the operator's own bill, \`whose_money.own\` is other people's provider
accounts and costs them nothing, \`whose_money.ledger\` is a third count off a different table — never
add the three together. \`ceiling_usd\` is the grant × the accounts: the most the house key can cost
before somebody is refused. \`keys.chat.metered_here\` is false because every chat turn is spent from
a key handed to a child process, so say that whenever you report a total, and pass ask_provider true
to get the provider's own figure for it) · \`aimeat_admin_statistics\` (what the node COUNTED: requests,
memory, refusals, the day-by-day tallies, and the live gauges — give both \`from\` and \`to\` for a
period, neither for the node's whole life, and read it both ways to tell a quiet period from a
counter nothing writes) · \`aimeat_admin_stats\` (a different question: how many agents, actions,
boards and work items the node HOLDS, and the morsels in circulation) · \`aimeat_admin_agents\`
(all agents) · \`aimeat_admin_config\` (node config) · \`aimeat_admin_mint\` (mint morsels —
irreversible ledger credit, daily cap enforced; a financial action, use sparingly).

**Federation (operator).** \`aimeat_admin_federation\` — where this node stands with the other nodes
it talks to. Lead with \`needs\`, not with the peer count: approving a peering request does NOT
connect anything, it leaves the peer at \`approved\` until somebody presses Activate, and that
half-finished state is the commonest thing waiting here. Two more to say out loud when they are
true: \`signin.reaches_nobody\` means the sign-in policy is on and admits nobody, and
\`offer.gives_nothing\` means this node reads the federation and puts nothing into it, which is
usually nobody's decision. \`book.age_days\` says whether the directory is worth mirroring again.

**Moderation.** \`aimeat_admin_knowledge\` (EVERY knowledge package on the node, not just the
catalogued ones — \`aimeat_knowledge_list\` is the catalogue and is a subset. Lead with
\`paging.total\`, never with how many rows you got: a page of twenty out of two hundred reported as
the whole store is the one mistake this surface cannot make. \`facets\` counts the whole match, so
you can say what the collection IS — one person's bulk import, or six things somebody wrote. Filter
an author with \`author_key\`, which collapses \`alice\` and \`alice@node-id\` into one person, and
call a \`maturity\` with \`declared: false\` an undeclared word rather than printing it as ours.
\`reviews\` and \`last_review\` are how you answer "has anybody looked at this") ·
\`aimeat_flag_report\` — report content (board post, agent, etc.) for moderation.

**Sharing groups (owner governance).** \`aimeat_group_list\` · \`aimeat_group_get\` ·
\`aimeat_group_create\` · \`aimeat_group_add_member\` · \`aimeat_group_remove_member\`. Groups back
\`visibility:"group"\` for memory/storage — they decide who can read group-shared data.

**Consent (GDPR access control + audit).** \`aimeat_consent_grant\` (who may read which data-pattern,
for what purpose, with TTL) · \`aimeat_consent_list\` · \`aimeat_consent_revoke\`. Consent records are
what the server enforces on cross-agent reads — this is the access-control layer, not just metadata.

**Owner-managed agent classification.** \`aimeat_agent_mode_set\` (autonomous/interactive/task-runner/
coordinator/workstation) · \`aimeat_agent_tags_set\` (crew:/role:/project: tags, max 20).

**Organisation sign-in and provisioning (operator).** An organisation connects its own identity
provider as an SSO CONNECTION: its people sign in with their work account (SAML) and its directory
adds and removes them automatically (SCIM). \`aimeat_admin_sso_list\` / \`aimeat_admin_sso_get\`
(state + the SP values an IdP console asks for: entity id, ACS URL, SCIM base URL) ·
\`aimeat_admin_sso_create\` (permanent slug id, name, email domains — the domains decide whose
existing accounts the organisation may adopt; optional organism its people join on arrival) ·
\`aimeat_admin_sso_idp_metadata\` (the SAML half, from a metadata URL or pasted XML) ·
\`aimeat_admin_sso_scim_token\` (the provisioning bearer — returned ONCE, tell the operator to
paste it into the IdP now) · \`aimeat_admin_sso_update\` (domains, visibility in the sign-in modal,
IdP-initiated acceptance, organism binding) · \`aimeat_admin_sso_delete\` (removes the door only;
accounts and their knowledge remain). The setup order that works, in SIX steps and not five: create
→ hand the SP values to the IdP console → read the metadata back → decide listed or hidden → mint
the SCIM token → **have the operator turn on sso.enabled**, which is a node setting and none of
your tools. Only then can a sign-in happen, so only then do last-login and last-SCIM-call turn real
in \`aimeat_admin_sso_get\`. Read \`node.enabled\` and each connection's \`state\` from
\`aimeat_admin_sso_list\` and report them: \`blocked_by_switch\` means the work is finished and the
door is shut, and telling an operator the setup is complete in that state sends them to find out
from a colleague who could not sign in. \`node.locked\` (sso.connections_locked) means every write
above is refused with SEALED_CONFIG.

**Account lifecycle (operator).** \`aimeat_admin_owner_disable\` — deactivate an account: every
credential acting in its name (sessions, its agents' tokens, access keys, app permissions) stops
immediately, the account and its knowledge remain, and \`aimeat_admin_owner_enable\` lets the
person back in without resurrecting the old credentials. Never works on your own account. This is
the manual offboarding door; a connected directory does the same automatically over SCIM.

## Typical uses
- Audit the node: \`aimeat_admin_statistics\` / \`aimeat_admin_stats\` / \`aimeat_admin_agents\` / \`aimeat_admin_config\`.
- Answer "what is this costing me": \`aimeat_admin_usage\` for the period and the one before it, and
  lead with whose money each figure is rather than with the largest number in the payload.
- Answer "is anything happening to us": \`aimeat_admin_statistics\` for the period and the week before
  it, then \`aimeat_admin_security_overview\` if the refusals are flat across a weekend.
- Answer "what knowledge is on this node, and what has nobody looked at": \`aimeat_admin_knowledge\`,
  leading with the total and the shape rather than with the first page of names.
- Answer "is our federation healthy, does anything need me": \`aimeat_admin_federation\`, reading
  \`needs\` first and only then the counts.
- Govern data sharing: create a group, add members, then grant consent for a data-pattern.
- Classify agents: set mode/tags so other surfaces (e.g. task-runner) behave correctly.
- Connect an organisation's identity provider end to end, and offboard a person by hand.

## Boundaries
This surface is governance only. It deliberately has no memory/task/board/marketplace/build tools —
do that work on \`agent\`, \`service\`, or \`appdev\`. Treat mint and consent as high-impact; confirm
intent before using.
`;
