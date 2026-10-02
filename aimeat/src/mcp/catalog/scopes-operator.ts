/**
 * @file src/mcp/catalog/scopes-operator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator tools' rows of TOOL_SCOPES: the organism break-glass words and
 *   operator:admin. A pure move out of scopes.ts (max-file-lines): TOOL_SCOPES spreads these rows
 *   where they stood, so the table reads the same.
 * @structure OPERATOR_TOOL_SCOPES
 * @version-history
 *   v1.3.0 — 2026-10-02 — aimeat_package_claim: operator:admin (package sale design, phase 3).
 *   v1.2.0 — 2026-10-01 — aimeat_admin_federation_peer_remove: operator:admin.
 *   v1.1.0 — 2026-09-30 — aimeat_admin_node_update: operator:admin.
 *   v1.0.0 — 2026-09-29 — Moved from scopes.ts, unchanged.
 */

export const OPERATOR_TOOL_SCOPES: Record<string, string> = {
    // The node operator's break-glass over an organism this account does not own. The handler also
    // resolves the caller's OWNER and refuses a non-operator, so the word alone gets nobody in; it is
    // here as well because a tool is REGISTERED according to this table, and no wildcard carries this
    // one (SCOPES_OUTSIDE_WILDCARD), so an operator's agent holds it only by an explicit tick.
    aimeat_admin_organism_ownership:          'operator:organism-repair',
    aimeat_admin_organism_owner_add:          'operator:organism-repair',

    // Node administration through an agent (security audit A8-1). Each handler asks the account role
    // first and this word second, through services/owner-lifecycle.ts resolveOperatorAgentName(). No
    // wildcard carries it. The operator's agents that held `*` got it once per node, from
    // services/operator-admin-migration.ts; any other agent holds it only by an explicit tick.
    aimeat_admin_stats:                       'operator:admin',
    aimeat_admin_agents:                      'operator:admin',
    aimeat_admin_config:                      'operator:admin',
    aimeat_admin_mint:                        'operator:admin',
    aimeat_admin_sso_list:                    'operator:admin',
    aimeat_admin_sso_get:                     'operator:admin',
    aimeat_admin_sso_create:                  'operator:admin',
    aimeat_admin_sso_update:                  'operator:admin',
    aimeat_admin_sso_delete:                  'operator:admin',
    aimeat_admin_sso_idp_metadata:            'operator:admin',
    aimeat_admin_sso_scim_token:              'operator:admin',
    aimeat_admin_owner_disable:               'operator:admin',
    aimeat_admin_owner_enable:                'operator:admin',
    aimeat_admin_totp_reset:                  'operator:admin',
    aimeat_admin_security_overview:           'operator:admin',
    aimeat_admin_incident_resolve:            'operator:admin',
    aimeat_admin_cors_overview:               'operator:admin',
    aimeat_admin_cors_set:                    'operator:admin',
    aimeat_admin_hooks:                       'operator:admin',
    aimeat_admin_hook_set:                    'operator:admin',
    aimeat_admin_statistics:                  'operator:admin',
    aimeat_admin_usage:                       'operator:admin',
    aimeat_admin_knowledge:                   'operator:admin',
    aimeat_admin_federation:                  'operator:admin',
    aimeat_admin_node_update:                 'operator:admin',
    aimeat_admin_federation_relay_claim_set:  'operator:admin',
    aimeat_admin_federation_peer_remove:      'operator:admin',
    aimeat_admin_install_set:                 'operator:admin',
    aimeat_package_sale:                      'operator:admin',
    aimeat_package_claim:                     'operator:admin',
    // What this node's own MCP registry offers every owner, to whom, and at what price.
    aimeat_mcp_registry_list:                 'operator:admin',
    aimeat_mcp_registry_set:                  'operator:admin',
};
