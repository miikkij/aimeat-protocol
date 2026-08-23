/**
 * @file admin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operating handbook for the v2 `admin` surface (/v2/mcp/admin). Self-contained; tool
 *   list mirrors MCP_SURFACES.admin. Operator/owner governance — most tools require operator role and
 *   are runtime-gated (a non-operator caller will get "Operator role required").
 * @version-history
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

**Node administration (operator).** \`aimeat_admin_stats\` (health/metrics) · \`aimeat_admin_agents\`
(all agents) · \`aimeat_admin_config\` (node config) · \`aimeat_admin_mint\` (mint morsels —
irreversible ledger credit, daily cap enforced; a financial action, use sparingly).

**Moderation.** \`aimeat_flag_report\` — report content (board post, agent, etc.) for moderation.

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
accounts and their knowledge remain). The setup order that works: create → hand the SP values to
the IdP console → read the metadata back → test one sign-in → mint the SCIM token → watch
last-login and last-SCIM-call turn real in \`aimeat_admin_sso_get\`. Refused with SEALED_CONFIG
while the host has locked connection management (sso.connections_locked); the public doors answer
503 until sso.enabled is on.

**Account lifecycle (operator).** \`aimeat_admin_owner_disable\` — deactivate an account: every
credential acting in its name (sessions, its agents' tokens, access keys, app permissions) stops
immediately, the account and its knowledge remain, and \`aimeat_admin_owner_enable\` lets the
person back in without resurrecting the old credentials. Never works on your own account. This is
the manual offboarding door; a connected directory does the same automatically over SCIM.

## Typical uses
- Audit the node: \`aimeat_admin_stats\` / \`aimeat_admin_agents\` / \`aimeat_admin_config\`.
- Govern data sharing: create a group, add members, then grant consent for a data-pattern.
- Classify agents: set mode/tags so other surfaces (e.g. task-runner) behave correctly.
- Connect an organisation's identity provider end to end, and offboard a person by hand.

## Boundaries
This surface is governance only. It deliberately has no memory/task/board/marketplace/build tools —
do that work on \`agent\`, \`service\`, or \`appdev\`. Treat mint and consent as high-impact; confirm
intent before using.
`;
