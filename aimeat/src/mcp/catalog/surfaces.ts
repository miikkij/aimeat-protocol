/**
 * @file surfaces.ts
 * @description v2 MCP "surfaces" — purpose-scoped projections of the canonical tool catalog. Each
 *   surface is a focused product for one kind of agent in one kind of setup, so the wrong tools
 *   simply aren't present and the agent can't misfire into the wrong context (audit doc 11):
 *     - appdev   : build & publish apps/extensions/cortex (VSCode etc.)
 *     - agent    : the owner's personal agent (memory/task/message/knowledge/discovery)
 *     - service  : marketplace/provider (board/work/action/wallet/capabilities/organism)
 *     - admin    : operator + owner governance (admin/flag/group/consent/agent-mgmt)
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
 *   v1.0.0 -- 2026-05-30 -- MCP audit v2 S1: purpose-scoped surface allowlists
 *   v1.1.0 -- 2026-06-08 -- Organism workspaces: add aimeat_workspace_* (create/list/read/write_draft/
 *     publish/add_document/delete) + aimeat_organism_create to appdev/agent/service; also add the
 *     organism tools to appdev.
 */
import { CLI_FALLBACK_TOOL_DEFINITIONS } from './definitions.js';

export type SurfaceRole = 'appdev' | 'agent' | 'service' | 'admin';
export const V2_ROLES: readonly SurfaceRole[] = ['appdev', 'agent', 'service', 'admin'];

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
        'aimeat_storage_upload', 'aimeat_storage_download',
        'aimeat_discover',
        'aimeat_app_publish', 'aimeat_app_list', 'aimeat_app_get', 'aimeat_app_versions', 'aimeat_app_delete',
        'aimeat_extension_install', 'aimeat_extension_invoke', 'aimeat_extension_get', 'aimeat_extension_list',
        'aimeat_extension_activate', 'aimeat_extension_deactivate', 'aimeat_extension_delete',
        'aimeat_cortex_install', 'aimeat_cortex_activate', 'aimeat_cortex_deactivate', 'aimeat_cortex_list', 'aimeat_cortex_delete',
        'aimeat_organism_list', 'aimeat_organism_get', 'aimeat_organism_members', 'aimeat_organism_invite', 'aimeat_organism_invitations', 'aimeat_organism_invitation_respond', 'aimeat_organism_search', 'aimeat_organism_join', 'aimeat_organism_leave', 'aimeat_organism_create', 'aimeat_organism_update', 'aimeat_organism_archive', 'aimeat_organism_export', 'aimeat_organism_import',
        'aimeat_workspace_create', 'aimeat_workspace_list', 'aimeat_workspace_read', 'aimeat_workspace_overview', 'aimeat_organism_overview', 'aimeat_workspace_write', 'aimeat_workspace_publish', 'aimeat_workspace_revert_to_draft', 'aimeat_workspace_object_delete', 'aimeat_workspace_update', 'aimeat_workspace_access', 'aimeat_workspace_transfer', 'aimeat_workspace_comment', 'aimeat_workspace_comments',
        'aimeat_handbook_get',
    ],
    agent: [
        'aimeat_memory_read', 'aimeat_memory_write', 'aimeat_memory_list', 'aimeat_memory_search', 'aimeat_memory_read_public',
        'aimeat_storage_upload', 'aimeat_storage_download',
        // NOTE: aimeat_task_request_changes is connector-only (owner tool, not registered on the
        // server /v1/mcp), so it cannot appear on a server v2 surface — intentionally omitted here.
        'aimeat_task_create', 'aimeat_task_list', 'aimeat_task_get', 'aimeat_task_propose_todos',
        'aimeat_task_event', 'aimeat_task_todo', 'aimeat_task_complete', 'aimeat_task_fail',
        'aimeat_schedule_create', 'aimeat_schedule_list', 'aimeat_schedule_update',
        'aimeat_schedule_delete', 'aimeat_schedule_report_internal',
        'aimeat_workflow_save', 'aimeat_workflow_get', 'aimeat_workflow_run',
        'aimeat_message_inbox', 'aimeat_message_send', 'aimeat_message_history',
        'aimeat_dm_send', 'aimeat_dm_ask', 'aimeat_dm_inbox', 'aimeat_dm_thread',
        'aimeat_knowledge_list', 'aimeat_knowledge_get', 'aimeat_knowledge_contribute', 'aimeat_knowledge_links',
        'aimeat_capabilities_list', 'aimeat_capabilities_get', 'aimeat_capabilities_invoke',
        'aimeat_organism_list', 'aimeat_organism_get', 'aimeat_organism_members', 'aimeat_organism_invite', 'aimeat_organism_invitations', 'aimeat_organism_invitation_respond', 'aimeat_organism_search', 'aimeat_organism_join', 'aimeat_organism_leave', 'aimeat_organism_create', 'aimeat_organism_update', 'aimeat_organism_archive', 'aimeat_organism_export', 'aimeat_organism_import',
        'aimeat_workspace_create', 'aimeat_workspace_list', 'aimeat_workspace_read', 'aimeat_workspace_overview', 'aimeat_organism_overview', 'aimeat_workspace_write', 'aimeat_workspace_publish', 'aimeat_workspace_revert_to_draft', 'aimeat_workspace_object_delete', 'aimeat_workspace_update', 'aimeat_workspace_access', 'aimeat_workspace_transfer', 'aimeat_workspace_comment', 'aimeat_workspace_comments',
        'aimeat_discover',
        'aimeat_catalogue_agents', 'aimeat_catalogue_directory', 'aimeat_catalogue_boards',
        'aimeat_board_read',
        'aimeat_agent_profile', 'aimeat_agent_activity', 'aimeat_agent_capabilities_report', 'aimeat_agent_tags_set', 'aimeat_agent_telemetry_report', 'aimeat_agents_list',
        'aimeat_onboarding_status', 'aimeat_onboarding_identify_platform', 'aimeat_onboarding_confirm_skill_installed',
        'aimeat_onboarding_confirm_directives_read', 'aimeat_onboarding_declare_services',
        'aimeat_handbook_get',
    ],
    service: [
        'aimeat_discover',
        'aimeat_catalogue_search', 'aimeat_catalogue_agents', 'aimeat_catalogue_boards',
        'aimeat_memory_read', 'aimeat_memory_write', 'aimeat_memory_list', 'aimeat_memory_search', 'aimeat_memory_read_public',
        'aimeat_storage_upload', 'aimeat_storage_download',
        'aimeat_knowledge_list', 'aimeat_knowledge_get', 'aimeat_knowledge_contribute', 'aimeat_knowledge_links',
        'aimeat_board_list', 'aimeat_board_read', 'aimeat_board_create', 'aimeat_board_post', 'aimeat_board_reply',
        'aimeat_board_react', 'aimeat_board_subscribe', 'aimeat_board_members', 'aimeat_board_delete',
        'aimeat_work_inbox', 'aimeat_work_accept', 'aimeat_work_deliver',
        'aimeat_action_execute',
        'aimeat_wallet_balance', 'aimeat_wallet_transactions',
        'aimeat_capabilities_list', 'aimeat_capabilities_get', 'aimeat_capabilities_invoke',
        'aimeat_capabilities_create', 'aimeat_capabilities_update', 'aimeat_capabilities_delete', 'aimeat_capabilities_vouch',
        'aimeat_organism_list', 'aimeat_organism_get', 'aimeat_organism_members', 'aimeat_organism_invite', 'aimeat_organism_invitations', 'aimeat_organism_invitation_respond', 'aimeat_organism_search', 'aimeat_organism_join', 'aimeat_organism_leave', 'aimeat_organism_create', 'aimeat_organism_update', 'aimeat_organism_archive', 'aimeat_organism_export', 'aimeat_organism_import',
        'aimeat_workspace_create', 'aimeat_workspace_list', 'aimeat_workspace_read', 'aimeat_workspace_overview', 'aimeat_organism_overview', 'aimeat_workspace_write', 'aimeat_workspace_publish', 'aimeat_workspace_revert_to_draft', 'aimeat_workspace_object_delete', 'aimeat_workspace_update', 'aimeat_workspace_access', 'aimeat_workspace_transfer', 'aimeat_workspace_comment', 'aimeat_workspace_comments',
        'aimeat_agent_profile', 'aimeat_agent_activity', 'aimeat_agent_capabilities_report', 'aimeat_agent_tags_set', 'aimeat_agent_telemetry_report', 'aimeat_agents_list',
        'aimeat_onboarding_status', 'aimeat_onboarding_identify_platform', 'aimeat_onboarding_confirm_skill_installed',
        'aimeat_onboarding_confirm_directives_read', 'aimeat_onboarding_declare_services',
        'aimeat_handbook_get',
    ],
    admin: [
        'aimeat_admin_stats', 'aimeat_admin_agents', 'aimeat_admin_config', 'aimeat_admin_mint',
        'aimeat_flag_report',
        'aimeat_group_list', 'aimeat_group_get', 'aimeat_group_create', 'aimeat_group_add_member', 'aimeat_group_remove_member',
        'aimeat_consent_grant', 'aimeat_consent_list', 'aimeat_consent_revoke',
        'aimeat_agent_mode_set', 'aimeat_agent_tags_set',
    ],
};

const _surfaceSets: Record<SurfaceRole, Set<string>> = {
    appdev: new Set(MCP_SURFACES.appdev),
    agent: new Set(MCP_SURFACES.agent),
    service: new Set(MCP_SURFACES.service),
    admin: new Set(MCP_SURFACES.admin),
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
