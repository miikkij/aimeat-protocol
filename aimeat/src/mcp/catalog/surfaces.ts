/**
 * @file surfaces.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description v2 MCP "surfaces" — purpose-scoped projections of the canonical tool catalog. Each
 *   surface is a focused product for one kind of agent in one kind of setup, so the wrong tools
 *   simply aren't present and the agent can't misfire into the wrong context (audit doc 11):
 *     - appdev   : build & publish apps/extensions/cortex (VSCode etc.)
 *     - agent    : the owner's personal agent (memory/task/message/knowledge/discovery)
 *     - service  : marketplace/provider (board/work/action/wallet/capabilities/organism)
 *     - admin    : operator + owner governance (admin/flag/group/consent/agent-mgmt)
 *     - commerce : selling and getting paid (credentials, priced manifests, checkout, receipts)
 *   v1/mcp stays full and frozen; these are opt-in. Surfaces are ALLOWLISTS over the same catalog —
 *   no forked handlers. instance_* is intentionally absent from v2 (auto-created session meta).
 * @structure
 *   - SurfaceRole, V2_ROLES, V2_EXCLUDED
 *   - MCP_SURFACES — role -> tool-name allowlist
 *   - toolsForSurface(role) -> Set<string>
 *   - validateSurfaces() -> coverage report (used by the unit test / audit)
 * @usage
 *   import { toolsForSurface } from '../catalog/surfaces.js';
 *   const allowed = toolsForSurface('agent'); // register only these on /v2/mcp/agent
 * @version-history
 *   2026-08-23 — aimeat_package_install on `appdev` beside the other package tools, and on `agent`
 *     beside the company ones: installing is the person's agent taking a shipped package into use,
 *     which is a different act from authoring one.
 *   2026-08-16 — Place the four incremental app-draft tools (write/replace/read/seed) on `appdev`,
 *     beside aimeat_app_draft_save. They are how an agent authors an app larger than one model
 *     response, so they belong wherever publishing does.
 *   2026-08-15 — Place aimeat_storage_delete beside upload and download on all four surfaces that
 *     already serve storage. An agent that may store a file may take it back; splitting those across
 *     surfaces would leave uploads a client cannot clean up.
 *   2026-08-13 — Place aimeat_schedule_trigger and aimeat_agent_console_set on `agent`, beside the
 *     tools they belong with (the other schedule tools, and mode_set/tags_set).
 *   2026-08-10 — Place aimeat_portfolio_publish on `agent`. It shipped into the catalog with no
 *     surface, so no v2 client could call the one tool that writes the person's own welcome page.
 *     It sits beside aimeat_company_portfolio_publish, which is the same act for a company.
 *   2026-07-28 — The `enterprise` surface becomes `commerce` (/v2/mcp/commerce): the edition seam is
 *     gone, so the surface is named after what it does — sell and get paid — and its allowlist is
 *     fixed rather than extendable at boot.
 *   2026-07-19 — Connector reachability: place the last uncovered catalog tools — app_fork (appdev),
 *     contact_* (agent), organism_*_email invites (appdev+agent+service), workflow_answer/pending_inputs
 *     (agent) — so validateSurfaces().uncovered is empty and the connector can register them.
 *   2026-07-19 — AppDev pitfall KB (Phase 4): reserved-package guard + optional model tag on contribute; register pitfall tools
 *   v1.0.0 -- 2026-05-30 -- MCP audit v2 S1: purpose-scoped surface allowlists
 *   v1.1.0 -- 2026-06-08 -- Organism workspaces: add aimeat_workspace_* (create/list/read/write_draft/
 *     publish/add_document/delete) + aimeat_organism_create to appdev/agent/service; also add the
 *     organism tools to appdev.
 */
import { CLI_FALLBACK_TOOL_DEFINITIONS } from './definitions.js';

export type SurfaceRole = 'appdev' | 'agent' | 'service' | 'admin' | 'commerce';
export const V2_ROLES: readonly SurfaceRole[] = ['appdev', 'agent', 'service', 'admin', 'commerce'];

/**
 * Catalog tools intentionally NOT exposed on any v2 server surface:
 *  - instance_* : auto-created session meta, not an agent capability
 *  - task_request_changes : connector-only owner tool (never registered on the server /v1/mcp)
 */
export const V2_EXCLUDED: readonly string[] = [
    'aimeat_instance_list', 'aimeat_instance_create', 'aimeat_instance_status',
    'aimeat_task_request_changes',
    // Connector-CLI-only convenience (no v2 MCP surface) — see definitions.ts.
    'aimeat_agent_statistics',
];

/** role -> allowlist of tool names. Derived from docs/mcp_audit/11-v2-mcp-design.md §2/§3. */
export const MCP_SURFACES: Record<SurfaceRole, string[]> = {
    appdev: [
        'aimeat_storage_upload', 'aimeat_storage_download', 'aimeat_storage_delete',
        'aimeat_datapackage_publish', 'aimeat_datapackage_export',
        'aimeat_discover',
        'aimeat_app_publish', 'aimeat_app_draft_save', 'aimeat_app_draft_publish', 'aimeat_app_draft_discard', 'aimeat_app_list', 'aimeat_app_get', 'aimeat_app_versions', 'aimeat_app_delete',
        // Component packages — a different backend from the apps above, named so since 2026-08-16.
        'aimeat_package_list', 'aimeat_package_get', 'aimeat_package_versions', 'aimeat_package_publish', 'aimeat_package_delete', 'aimeat_package_install',
        'aimeat_app_draft_write', 'aimeat_app_draft_replace', 'aimeat_app_draft_read', 'aimeat_app_draft_seed',
        'aimeat_app_screenshot',
        'aimeat_image_generate',
        'aimeat_extension_install', 'aimeat_extension_invoke', 'aimeat_extension_get', 'aimeat_extension_list',
        'aimeat_extension_activate', 'aimeat_extension_deactivate', 'aimeat_extension_delete', 'aimeat_iam_define',
        'aimeat_cortex_install', 'aimeat_cortex_activate', 'aimeat_cortex_deactivate', 'aimeat_cortex_list', 'aimeat_cortex_delete',
        'aimeat_organism_list', 'aimeat_organism_get', 'aimeat_organism_members', 'aimeat_organism_invite', 'aimeat_organism_invite_email', 'aimeat_organism_invitations_email', 'aimeat_organism_invitation_email_cancel', 'aimeat_organism_member_add', 'aimeat_organism_owner_add', 'aimeat_organism_owner_remove', 'aimeat_organism_invitation_update', 'aimeat_organism_invitation_cancel', 'aimeat_organism_invitations', 'aimeat_organism_invitation_respond', 'aimeat_organism_search', 'aimeat_organism_join', 'aimeat_organism_leave', 'aimeat_organism_create', 'aimeat_organism_update', 'aimeat_organism_archive', 'aimeat_organism_export', 'aimeat_organism_import',
        'aimeat_workspace_create', 'aimeat_workspace_list', 'aimeat_workspace_read', 'aimeat_workspace_overview', 'aimeat_organism_overview', 'aimeat_workspace_write', 'aimeat_workspace_publish', 'aimeat_workspace_revert_to_draft', 'aimeat_workspace_object_delete', 'aimeat_workspace_update', 'aimeat_workspace_access', 'aimeat_workspace_member_grant', 'aimeat_workspace_member_revoke', 'aimeat_workspace_members', 'aimeat_workspace_transfer', 'aimeat_workspace_comment', 'aimeat_workspace_comments',
        'aimeat_skill_publish', 'aimeat_skill_list', 'aimeat_skill_get', 'aimeat_skill_link', 'aimeat_skill_unlink',
        'aimeat_appdev_overview', 'aimeat_appdev_pitfall_report', 'aimeat_appdev_pitfall_list', 'aimeat_appdev_pitfall_delete',
        'aimeat_app_fork', 'aimeat_app_template_propose', 'aimeat_app_template_list', 'aimeat_app_template_get', 'aimeat_app_template_delete',
        'aimeat_appdev_proof_attach',
        'aimeat_handbook_get',
    ],
    agent: [
        'aimeat_image_generate',
        'aimeat_memory_read', 'aimeat_memory_write', 'aimeat_memory_list', 'aimeat_memory_search', 'aimeat_memory_read_public',
        'aimeat_storage_upload', 'aimeat_storage_download', 'aimeat_storage_delete',
        'aimeat_datapackage_publish', 'aimeat_datapackage_export',
        // NOTE: aimeat_task_request_changes is connector-only (owner tool, not registered on the
        // server /v1/mcp), so it cannot appear on a server v2 surface — intentionally omitted here.
        'aimeat_task_create', 'aimeat_task_list', 'aimeat_task_get', 'aimeat_task_propose_todos',
        'aimeat_task_event', 'aimeat_task_todo', 'aimeat_task_complete', 'aimeat_task_fail',
        'aimeat_schedule_create', 'aimeat_schedule_list', 'aimeat_schedule_update',
        'aimeat_schedule_delete', 'aimeat_schedule_trigger', 'aimeat_schedule_report_internal',
        'aimeat_workflow_save', 'aimeat_workflow_get', 'aimeat_workflow_run', 'aimeat_workflow_answer', 'aimeat_workflow_pending_inputs',
        'aimeat_message_inbox', 'aimeat_message_send', 'aimeat_message_history',
        'aimeat_dm_send', 'aimeat_dm_send_as_owner', 'aimeat_dm_ask', 'aimeat_dm_inbox', 'aimeat_dm_thread',
        'aimeat_company_list', 'aimeat_company_create', 'aimeat_company_update',
        'aimeat_company_front_page', 'aimeat_company_portfolio_publish',
        // Taking a shipped package into use, beside the company tools rather than with the four
        // authoring ones on appdev. Installing is not building: it is the person's own agent
        // turning something this node ships into a copy they own, which is this surface's business.
        'aimeat_package_list', 'aimeat_package_get', 'aimeat_package_install',
        // The person's own welcome page, beside the company one: same act, different owner.
        'aimeat_portfolio_publish',
        'aimeat_contact_list', 'aimeat_contact_add', 'aimeat_contact_remove', 'aimeat_contact_resolve_email',
        'aimeat_knowledge_list', 'aimeat_knowledge_get', 'aimeat_knowledge_contribute', 'aimeat_knowledge_links',
        'aimeat_appdev_overview', 'aimeat_appdev_pitfall_report', 'aimeat_appdev_pitfall_list', 'aimeat_appdev_pitfall_delete',
        'aimeat_app_template_propose', 'aimeat_app_template_list', 'aimeat_app_template_get', 'aimeat_app_template_delete',
        'aimeat_appdev_proof_attach',
        'aimeat_skill_publish', 'aimeat_skill_list', 'aimeat_skill_get', 'aimeat_skill_link', 'aimeat_skill_unlink',
        'aimeat_operator_agent_configure', 'aimeat_operator_ai_config',
        'aimeat_capabilities_list', 'aimeat_capabilities_get', 'aimeat_capabilities_invoke',
        'aimeat_organism_list', 'aimeat_organism_get', 'aimeat_organism_members', 'aimeat_organism_invite', 'aimeat_organism_invite_email', 'aimeat_organism_invitations_email', 'aimeat_organism_invitation_email_cancel', 'aimeat_organism_member_add', 'aimeat_organism_owner_add', 'aimeat_organism_owner_remove', 'aimeat_organism_invitation_update', 'aimeat_organism_invitation_cancel', 'aimeat_organism_invitations', 'aimeat_organism_invitation_respond', 'aimeat_organism_search', 'aimeat_organism_join', 'aimeat_organism_leave', 'aimeat_organism_create', 'aimeat_organism_update', 'aimeat_organism_archive', 'aimeat_organism_export', 'aimeat_organism_import',
        'aimeat_workspace_create', 'aimeat_workspace_list', 'aimeat_workspace_read', 'aimeat_workspace_overview', 'aimeat_organism_overview', 'aimeat_workspace_write', 'aimeat_workspace_publish', 'aimeat_workspace_revert_to_draft', 'aimeat_workspace_object_delete', 'aimeat_workspace_update', 'aimeat_workspace_access', 'aimeat_workspace_member_grant', 'aimeat_workspace_member_revoke', 'aimeat_workspace_members', 'aimeat_workspace_transfer', 'aimeat_workspace_comment', 'aimeat_workspace_comments',
        'aimeat_discover',
        'aimeat_catalogue_agents', 'aimeat_catalogue_directory', 'aimeat_catalogue_boards',
        'aimeat_board_read',
        'aimeat_agent_profile', 'aimeat_agent_activity', 'aimeat_agent_capabilities_report', 'aimeat_agent_tags_set', 'aimeat_agent_telemetry_report', 'aimeat_agents_list',
        'aimeat_usage_report',
        'aimeat_onboarding_status', 'aimeat_onboarding_identify_platform', 'aimeat_onboarding_confirm_skill_installed',
        'aimeat_onboarding_confirm_directives_read', 'aimeat_onboarding_declare_services',
        'aimeat_handbook_get',
        // Commerce, buyer side: the owner's personal agent buys priced offers/app-tools.
        'aimeat_app_tools_get', 'aimeat_checkout_open', 'aimeat_checkout_complete', 'aimeat_checkout_list',
        // EXCHANGE marketplace: browse/accept/post/bid the two-sided data-service market.
        'aimeat_exchange_offerings', 'aimeat_exchange_offering_get', 'aimeat_exchange_accept',
        'aimeat_exchange_contracts', 'aimeat_exchange_contract_off', 'aimeat_exchange_needs',
        'aimeat_exchange_need_post', 'aimeat_exchange_bid', 'aimeat_exchange_bid_accept', 'aimeat_exchange_consumers',
        // Act on EXCHANGE (generic, any MCP client): call an app-tool, run agent-work, renegotiate.
        'aimeat_app_tool_invoke', 'aimeat_exchange_work', 'aimeat_exchange_work_deliver', 'aimeat_exchange_work_list',
        'aimeat_exchange_proposals', 'aimeat_exchange_proposal_decide',
    ],
    service: [
        'aimeat_discover',
        'aimeat_catalogue_search', 'aimeat_catalogue_agents', 'aimeat_catalogue_boards',
        'aimeat_memory_read', 'aimeat_memory_write', 'aimeat_memory_list', 'aimeat_memory_search', 'aimeat_memory_read_public',
        'aimeat_storage_upload', 'aimeat_storage_download', 'aimeat_storage_delete',
        'aimeat_datapackage_publish', 'aimeat_datapackage_export',
        'aimeat_knowledge_list', 'aimeat_knowledge_get', 'aimeat_knowledge_contribute', 'aimeat_knowledge_links',
        'aimeat_skill_publish', 'aimeat_skill_list', 'aimeat_skill_get', 'aimeat_skill_link', 'aimeat_skill_unlink',
        'aimeat_board_list', 'aimeat_board_read', 'aimeat_board_create', 'aimeat_board_post', 'aimeat_board_reply',
        'aimeat_board_react', 'aimeat_board_subscribe', 'aimeat_board_members', 'aimeat_board_delete',
        'aimeat_work_inbox', 'aimeat_work_accept', 'aimeat_work_deliver',
        'aimeat_action_execute',
        'aimeat_wallet_balance', 'aimeat_wallet_transactions',
        'aimeat_capabilities_list', 'aimeat_capabilities_get', 'aimeat_capabilities_invoke',
        'aimeat_capabilities_create', 'aimeat_capabilities_update', 'aimeat_capabilities_delete', 'aimeat_capabilities_vouch',
        'aimeat_organism_list', 'aimeat_organism_get', 'aimeat_organism_members', 'aimeat_organism_invite', 'aimeat_organism_invite_email', 'aimeat_organism_invitations_email', 'aimeat_organism_invitation_email_cancel', 'aimeat_organism_member_add', 'aimeat_organism_owner_add', 'aimeat_organism_owner_remove', 'aimeat_organism_invitation_update', 'aimeat_organism_invitation_cancel', 'aimeat_organism_invitations', 'aimeat_organism_invitation_respond', 'aimeat_organism_search', 'aimeat_organism_join', 'aimeat_organism_leave', 'aimeat_organism_create', 'aimeat_organism_update', 'aimeat_organism_archive', 'aimeat_organism_export', 'aimeat_organism_import',
        'aimeat_workspace_create', 'aimeat_workspace_list', 'aimeat_workspace_read', 'aimeat_workspace_overview', 'aimeat_organism_overview', 'aimeat_workspace_write', 'aimeat_workspace_publish', 'aimeat_workspace_revert_to_draft', 'aimeat_workspace_object_delete', 'aimeat_workspace_update', 'aimeat_workspace_access', 'aimeat_workspace_member_grant', 'aimeat_workspace_member_revoke', 'aimeat_workspace_members', 'aimeat_workspace_transfer', 'aimeat_workspace_comment', 'aimeat_workspace_comments',
        'aimeat_agent_profile', 'aimeat_agent_activity', 'aimeat_agent_capabilities_report', 'aimeat_agent_tags_set', 'aimeat_agent_telemetry_report', 'aimeat_agents_list',
        'aimeat_usage_report',
        'aimeat_onboarding_status', 'aimeat_onboarding_identify_platform', 'aimeat_onboarding_confirm_skill_installed',
        'aimeat_onboarding_confirm_directives_read', 'aimeat_onboarding_declare_services',
        'aimeat_handbook_get',
        // Commerce, both sides: a marketplace/provider agent sells (PSP credentials, app-tool
        // manifests, offer pricing) and buys (checkout) on the same commerce core.
        'aimeat_commerce_psp_set', 'aimeat_commerce_psp_status', 'aimeat_commerce_psp_delete',
        'aimeat_app_tools_publish', 'aimeat_app_tools_get', 'aimeat_offer_price_set',
        'aimeat_checkout_open', 'aimeat_checkout_complete', 'aimeat_checkout_list',
        // Beneficiary splits: a seller declares who else earns from a sale, releases what accrued
        // and pays it out; the beneficiary reads its own earnings. Selling-side, same as the rest.
        'aimeat_commerce_beneficiary_split_set', 'aimeat_commerce_beneficiary_splits',
        'aimeat_commerce_beneficiary_release', 'aimeat_commerce_beneficiary_payout',
        'aimeat_commerce_beneficiary_earnings', 'aimeat_commerce_beneficiary_approve',
        // EXCHANGE marketplace, both sides: a provider lists/bids/sees lineage; a consumer accepts contracts.
        'aimeat_exchange_offerings', 'aimeat_exchange_offering_get', 'aimeat_exchange_accept',
        'aimeat_exchange_contracts', 'aimeat_exchange_contract_off', 'aimeat_exchange_needs',
        'aimeat_exchange_need_post', 'aimeat_exchange_bid', 'aimeat_exchange_bid_accept', 'aimeat_exchange_consumers',
        // Act on EXCHANGE (generic, any MCP client): call an app-tool, run agent-work, renegotiate.
        'aimeat_app_tool_invoke', 'aimeat_exchange_work', 'aimeat_exchange_work_deliver', 'aimeat_exchange_work_list',
        'aimeat_exchange_proposals', 'aimeat_exchange_proposal_decide',
    ],
    admin: [
        'aimeat_admin_stats', 'aimeat_admin_agents', 'aimeat_admin_config', 'aimeat_admin_mint',
        // The operator's break-glass over an organism whose creator account is unreachable, plus the
        // read that shows the roster before it is re-pointed.
        'aimeat_admin_organism_ownership', 'aimeat_admin_organism_owner_add',
        // The node-wide compliance report and the two documents behind it. On this surface rather
        // than 'service' because it is the node's own governance rather than anything the node
        // sells, and because the only caller it will ever have is the operator's own agent.
        'aimeat_compliance_report', 'aimeat_compliance_register_read', 'aimeat_compliance_register_write',
        'aimeat_flag_report',
        'aimeat_group_list', 'aimeat_group_get', 'aimeat_group_create', 'aimeat_group_add_member', 'aimeat_group_remove_member',
        'aimeat_share_create', 'aimeat_share_list', 'aimeat_share_revoke',
        'aimeat_consent_grant', 'aimeat_consent_list', 'aimeat_consent_revoke',
        'aimeat_agent_mode_set', 'aimeat_agent_tags_set', 'aimeat_agent_console_set',
        'aimeat_operator_agent_configure', 'aimeat_operator_ai_config',
    ],
    // The selling surface (/v2/mcp/commerce): everything an agent needs to price something, take
    // payment for it and read what came in — credentials for the seller's own rails, priced tool
    // manifests, checkout, wallet, and the memory/storage the listing itself lives in.
    commerce: [
        'aimeat_commerce_psp_set', 'aimeat_commerce_psp_status', 'aimeat_commerce_psp_delete',
        'aimeat_app_tools_publish', 'aimeat_app_tools_get', 'aimeat_offer_price_set',
        'aimeat_checkout_open', 'aimeat_checkout_complete', 'aimeat_checkout_list',
        // Beneficiary splits: a seller declares who else earns from a sale, releases what accrued
        // and pays it out; the beneficiary reads its own earnings. Selling-side, same as the rest.
        'aimeat_commerce_beneficiary_split_set', 'aimeat_commerce_beneficiary_splits',
        'aimeat_commerce_beneficiary_release', 'aimeat_commerce_beneficiary_payout',
        'aimeat_commerce_beneficiary_earnings', 'aimeat_commerce_beneficiary_approve',
        'aimeat_memory_read', 'aimeat_memory_write', 'aimeat_memory_list', 'aimeat_memory_search', 'aimeat_memory_read_public',
        'aimeat_storage_upload', 'aimeat_storage_download', 'aimeat_storage_delete',
        'aimeat_datapackage_publish', 'aimeat_datapackage_export',
        'aimeat_wallet_balance', 'aimeat_wallet_transactions',
        'aimeat_discover',
        'aimeat_handbook_get',
    ],
};

const _surfaceSets: Record<SurfaceRole, Set<string>> = {
    appdev: new Set(MCP_SURFACES.appdev),
    agent: new Set(MCP_SURFACES.agent),
    service: new Set(MCP_SURFACES.service),
    admin: new Set(MCP_SURFACES.admin),
    commerce: new Set(MCP_SURFACES.commerce),
};

/** The set of tool names exposed on a given v2 surface. */
export function toolsForSurface(role: SurfaceRole): Set<string> {
    return _surfaceSets[role];
}

export function isV2Role(role: string): role is SurfaceRole {
    return (V2_ROLES as readonly string[]).includes(role);
}

/**
 * Coverage check used by the unit test / audit:
 *  - unknownTools: surface lists a tool not in the catalog (typo / removed tool)
 *  - uncovered: catalog tool that is in NO surface and NOT in V2_EXCLUDED (forgotten placement)
 */
export function validateSurfaces(): { unknownTools: string[]; uncovered: string[] } {
    const catalog = new Set(CLI_FALLBACK_TOOL_DEFINITIONS.map(d => d.name));
    const placed = new Set<string>([...V2_EXCLUDED]);
    const unknownTools: string[] = [];
    for (const role of V2_ROLES) {
        for (const name of MCP_SURFACES[role]) {
            if (!catalog.has(name)) unknownTools.push(`${role}:${name}`);
            placed.add(name);
        }
    }
    const uncovered = [...catalog].filter(n => !placed.has(n)).sort();
    return { unknownTools: [...new Set(unknownTools)].sort(), uncovered };
}

// Typo guard at load: a surface listing a non-existent tool is a developer error — fail fast.
{
    const { unknownTools } = validateSurfaces();
    if (unknownTools.length > 0) {
        throw new Error(`MCP_SURFACES references unknown tools (not in catalog): ${unknownTools.join(', ')}`);
    }
}
