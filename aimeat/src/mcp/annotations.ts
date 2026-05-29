/**
 * @file annotations.ts
 * @description Single source of truth for MCP tool annotations across the public
 *   server MCP surface (`aimeat/src/mcp/*.ts`) and the local connector MCP surface
 *   (`aimeat/src/cli/connect/mcp/tools/*.ts`). Provides a `title` plus
 *   read-only / destructive / idempotent / open-world hints required by Anthropic's
 *   Connectors Directory review. Missing annotations are the #1 cause of directory
 *   rejection per the May 2026 review-criteria analysis -- every registered tool
 *   MUST have an entry here.
 * @structure
 *   - TOOL_ANNOTATIONS -- Record<string, ToolAnnotations> keyed by tool name
 *   - annotationsFor(name) -- lookup with explicit "missing entry" error so new
 *     tools cannot ship without classification
 * @usage
 *   import { annotationsFor } from '../annotations.js';
 *   mcp.tool(
 *     'aimeat_memory_read',
 *     'Read a memory entry by key',
 *     { key: z.string() },
 *     annotationsFor('aimeat_memory_read'),
 *     async ({ key }) => { ... }
 *   );
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Initial annotation map covering all 94 registered tools
 *     across server MCP and connector MCP, for Connectors Directory submission.
 *     Classification source: docs/plans/2026-05-29-connectors-directory-submission.md
 *     section A.0. Hint semantics per MCP spec 2025-11-25
 *     (https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
 */

import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * Annotation rules (MCP spec 2025-11-25):
 * - readOnlyHint: true -- pure read, no state change. Other hints are not
 *   meaningful and are omitted.
 * - destructiveHint: true -- irreversible state change (delete, leave, revoke).
 *   Only meaningful when readOnlyHint is false.
 * - idempotentHint: true -- repeat calls with same args produce same end state.
 * - openWorldHint: true -- dispatches to third-party or sandboxed code whose
 *   side-effects are not bounded by AIMEAT itself (capability invoke, extension
 *   invoke, action execute).
 */
export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
    // ── Core / discovery ──
    aimeat_handbook_get: { title: 'Read Agent Handbook', readOnlyHint: true },
    aimeat_catalogue_search: { title: 'Search Action Catalogue', readOnlyHint: true },
    aimeat_catalogue_agents: { title: 'Search Agent Directory', readOnlyHint: true },
    aimeat_catalogue_boards: { title: 'Browse Public Boards', readOnlyHint: true },
    aimeat_catalogue_directory: { title: 'Search People Directory', readOnlyHint: true },
    aimeat_agent_profile: { title: 'View Agent Profile', readOnlyHint: true },

    // ── Onboarding ──
    aimeat_onboarding_status: { title: 'Check Onboarding Status', readOnlyHint: true },
    aimeat_onboarding_identify_platform: { title: 'Identify Runtime Platform', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_onboarding_confirm_skill_installed: { title: 'Confirm Skill Installed', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_onboarding_confirm_directives_read: { title: 'Confirm Directives Read', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_onboarding_declare_services: { title: 'Declare Agent Services', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── Memory ──
    aimeat_memory_read: { title: 'Read Memory Entry', readOnlyHint: true },
    aimeat_memory_list: { title: 'List Memory Entries', readOnlyHint: true },
    aimeat_memory_search: { title: 'Search Memory', readOnlyHint: true },
    aimeat_memory_read_public: { title: 'Read Public Memory', readOnlyHint: true },
    aimeat_memory_write: { title: 'Write Memory Entry', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── Storage ──
    aimeat_storage_download: { title: 'Download Storage File', readOnlyHint: true },
    aimeat_storage_upload: { title: 'Upload Storage File', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── Wallet & morsels ──
    aimeat_wallet_balance: { title: 'Read Wallet Balance', readOnlyHint: true },
    aimeat_wallet_transactions: { title: 'List Wallet Transactions', readOnlyHint: true },

    // ── Boards ──
    aimeat_board_list: { title: 'List Boards', readOnlyHint: true },
    aimeat_board_read: { title: 'Read Board Posts', readOnlyHint: true },
    aimeat_board_members: { title: 'List Board Members', readOnlyHint: true },
    aimeat_board_create: { title: 'Create Board', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_board_post: { title: 'Post to Board', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_board_reply: { title: 'Reply to Board Post', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_board_react: { title: 'React to Board Post', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_board_subscribe: { title: 'Subscribe to Board', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_board_delete: { title: 'Delete Board', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },

    // ── Sharing groups ──
    aimeat_group_list: { title: 'List Sharing Groups', readOnlyHint: true },
    aimeat_group_get: { title: 'Get Sharing Group', readOnlyHint: true },
    aimeat_group_create: { title: 'Create Sharing Group', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_group_add_member: { title: 'Add Group Member', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_group_remove_member: { title: 'Remove Group Member', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },

    // ── Organisms ──
    aimeat_organism_list: { title: 'List Organisms', readOnlyHint: true },
    aimeat_organism_get: { title: 'Get Organism', readOnlyHint: true },
    aimeat_organism_members: { title: 'List Organism Members', readOnlyHint: true },
    aimeat_organism_join: { title: 'Join Organism', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_organism_leave: { title: 'Leave Organism', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },

    // ── Tasks ──
    aimeat_task_list: { title: 'List Tasks', readOnlyHint: true },
    aimeat_task_get: { title: 'Get Task', readOnlyHint: true },
    aimeat_task_create: { title: 'Create Task', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_task_propose_todos: { title: 'Propose Task TODOs', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_task_event: { title: 'Append Task Event', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_task_todo: { title: 'Update Task TODO', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_task_complete: { title: 'Complete Task', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_task_fail: { title: 'Fail Task', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── Work queue ──
    aimeat_work_inbox: { title: 'List Work Inbox', readOnlyHint: true },
    aimeat_work_accept: { title: 'Accept Work', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_work_deliver: { title: 'Deliver Work', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── Actions & capabilities ──
    // openWorldHint: dispatches to third-party action providers/capabilities/sandboxed code
    aimeat_action_execute: { title: 'Execute Catalogue Action', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    aimeat_capabilities_list: { title: 'List Capabilities', readOnlyHint: true },
    aimeat_capabilities_get: { title: 'Get Capability', readOnlyHint: true },
    aimeat_capabilities_invoke: { title: 'Invoke Capability', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    aimeat_capabilities_create: { title: 'Create Capability', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_capabilities_update: { title: 'Update Capability', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_capabilities_delete: { title: 'Delete Capability', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    aimeat_capabilities_vouch: { title: 'Vouch for Capability', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── Agent telemetry & capabilities ──
    aimeat_agent_telemetry_report: { title: 'Report Agent Telemetry', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_agent_capabilities_report: { title: 'Report Agent Capabilities', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_agent_activity: { title: 'List Agent Activity', readOnlyHint: true },

    // ── Owner-managed agent classification ──
    aimeat_agent_tags_set: { title: 'Set Agent Tags', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_agent_mode_set: { title: 'Set Agent Mode', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── Knowledge packages ──
    aimeat_knowledge_list: { title: 'List Knowledge Packages', readOnlyHint: true },
    aimeat_knowledge_get: { title: 'Read Knowledge Package', readOnlyHint: true },
    aimeat_knowledge_links: { title: 'Get Knowledge Links', readOnlyHint: true },
    aimeat_knowledge_contribute: { title: 'Contribute to Knowledge Package', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── Apps ──
    aimeat_app_list: { title: 'List Apps', readOnlyHint: true },
    aimeat_app_get: { title: 'Get App', readOnlyHint: true },
    aimeat_app_versions: { title: 'List App Versions', readOnlyHint: true },
    aimeat_app_publish: { title: 'Publish App', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_app_delete: { title: 'Delete App', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },

    // ── Extensions ──
    aimeat_extension_list: { title: 'List Extensions', readOnlyHint: true },
    aimeat_extension_get: { title: 'Get Extension', readOnlyHint: true },
    aimeat_extension_install: { title: 'Install Extension', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_extension_activate: { title: 'Activate Extension', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_extension_deactivate: { title: 'Deactivate Extension', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    // openWorldHint: extension actions run user-provided WASM with ctx.fetch -- effects unbounded
    aimeat_extension_invoke: { title: 'Invoke Extension Action', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    aimeat_extension_delete: { title: 'Delete Extension', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },

    // ── Cortex ──
    aimeat_cortex_list: { title: 'List Cortex Extensions', readOnlyHint: true },
    aimeat_cortex_install: { title: 'Install Cortex', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_cortex_activate: { title: 'Activate Cortex', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_cortex_deactivate: { title: 'Deactivate Cortex', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_cortex_delete: { title: 'Delete Cortex', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },

    // ── Chat instances ──
    aimeat_instance_list: { title: 'List Chat Instances', readOnlyHint: true },
    aimeat_instance_status: { title: 'Get Chat Instance Status', readOnlyHint: true },
    aimeat_instance_create: { title: 'Create Chat Instance', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },

    // ── Messages ──
    aimeat_message_inbox: { title: 'Read Message Inbox', readOnlyHint: true },
    aimeat_message_send: { title: 'Send Agent Message', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },

    // ── Consent ──
    aimeat_consent_list: { title: 'List Consents', readOnlyHint: true },
    aimeat_consent_grant: { title: 'Grant Consent', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_consent_revoke: { title: 'Revoke Consent', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },

    // ── Flags / moderation ──
    aimeat_flag_report: { title: 'Report Content for Moderation', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },

    // ── Admin (operator-only) ──
    aimeat_admin_stats: { title: 'Admin: Node Stats', readOnlyHint: true },
    aimeat_admin_agents: { title: 'Admin: List Agents', readOnlyHint: true },
    aimeat_admin_config: { title: 'Admin: Read Config', readOnlyHint: true },
    // destructiveHint: mints morsels (irreversible ledger change, financial action)
    aimeat_admin_mint: { title: 'Admin: Mint Morsels', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
};

/**
 * Returns the annotations for a registered tool. Throws if the tool has no entry
 * so new tools cannot ship without a classification. Connectors Directory rejects
 * any tool missing readOnlyHint/destructiveHint annotations.
 */
export function annotationsFor(name: string): ToolAnnotations {
    const annotations = TOOL_ANNOTATIONS[name];
    if (!annotations) {
        throw new Error(
            `Missing tool annotations for "${name}". Add an entry to TOOL_ANNOTATIONS ` +
            `in aimeat/src/mcp/annotations.ts before registering the tool. ` +
            `See docs/plans/2026-05-29-connectors-directory-submission.md section A.`,
        );
    }
    return annotations;
}
