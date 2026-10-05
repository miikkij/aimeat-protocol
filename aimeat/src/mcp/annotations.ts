/**
 * @file annotations.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   2026-10-05 — TOOL_ANNOTATIONS is each catalog entry's `annotations` plus the list here, which only
 *     shrinks as each catalog group carries its own (secaudit 2026-10, M3).
 *   2026-10-04 — aimeat_task_decline (a write, not destructive, idempotent like aimeat_task_fail).
 *   2026-10-02 — aimeat_tools_find (read-only: it changes which of the session's tools are listed).
 *   2026-10-02 — aimeat_task_start and aimeat_agent_task_start_set.
 *   2026-10-01 — aimeat_admin_federation_peer_remove (destructive: a link ends, its work is cancelled).
 *   2026-09-30 — aimeat_admin_node_update: read only, open world (it reads npm).
 *   2026-09-29 — aimeat_refinery_classes and _status (read only), aimeat_refinery_run (writes rows,
 *     reads an outside mailbox, spends the model allowance).
 *   2026-10-02 — aimeat_package_withdraw (destructive: switches extensions off; other nodes act on it).
 *   2026-10-02 — aimeat_package_compose_set (writes packages; the dry run writes nothing).
 *   2026-10-02 — aimeat_package_offer, aimeat_package_buy and aimeat_package_claim (a purchase and a claim reach other nodes).
 *   2026-09-29 — aimeat_package_sellers and aimeat_package_sale (a revoke is destructive; the sale reaches the repository).
 *   2026-09-28 — aimeat_package_config_needs (read only).
 *   2026-09-28 — aimeat_admin_install_set (idempotent, reaches the package repository).
 *   2026-09-28 — aimeat_ai_roles (read only) and aimeat_ai_role_set (propose-then-confirm), AI roles.
 *   2026-09-28 — aimeat_ai_routing_set (propose-then-confirm), aimeat_ai_providers (read only) and
 *     aimeat_ai_provider_test (a real, billed call to an outside provider).
 *   2026-09-28 — aimeat_ai_capabilities and aimeat_ai_models (read only); aimeat_ai_transcribe and
 *     aimeat_ai_embed (billed calls to an outside provider). System 2 plan, V5.
 *   2026-09-28 — aimeat_package_instance_set, aimeat_package_check_updates (reaches other nodes),
 *     aimeat_package_repository (read-only, reaches another node), aimeat_package_entitlements (a revoke
 *     stops a node's pulls).
 *   2026-09-28 — aimeat_package_instances (read-only) and aimeat_package_fork (destructive: the
 *     updates it gives up do not come back).
 *   2026-09-28 — aimeat_ai_policy_set: propose-then-confirm, idempotent, not destructive.
 *   2026-09-26 — aimeat_admin_incident_resolve is destructive: deciding that a held name's rows were a
 *     previous holder's deletes its actions. Still idempotent: the same decision twice does it once.
 *   2026-09-25 — aimeat_workspace_space_add and aimeat_workspace_sections_set (writes, idempotent,
 *     nothing destroyed) and aimeat_workspace_suggestions (a decision writes).
 *   2026-09-25 — aimeat_admin_federation_relay_claim_set (idempotent, nothing destroyed).
 *   2026-09-25 — aimeat_package_install_requests (a write that installs on approval; idempotent).
 *   2026-10-03 — aimeat_theme_font_save (a write; remove: true destroys a face and its files).
 *   2026-09-24 — aimeat_theme_policy_set (idempotent, nothing destroyed).
 *   2026-09-24 — aimeat_theme_style_save and aimeat_theme_component_css_set (writes, nothing destroyed).
 *   2026-09-24 — aimeat_theme_list and aimeat_theme_get (read-only), aimeat_theme_save (a write).
 *   2026-09-23 — aimeat_ui_component_list and aimeat_ui_component_get (read-only).
 *   2026-09-13 — aimeat_board_rules_set (idempotent, nothing destroyed).
 *   2026-09-13 — aimeat_dm_archive_as_owner (idempotent, nothing destroyed) and aimeat_dm_organize_as_owner.
 *   2026-09-12 — aimeat_dm_inbox_as_owner and aimeat_dm_thread_as_owner (both read-only).
 *   2026-09-08 — aimeat_admin_cors_overview (read-only) and aimeat_admin_cors_set.
 *   2026-09-06 — The owner's secrets vault: aimeat_secret_list (read-only), _set (idempotent, not
 *     destructive — what it replaces is a value nobody could read) and _delete (destructive:
 *     whatever named that secret stops working).
 *   2026-09-05 — aimeat_admin_security_overview (read-only) and aimeat_admin_incident_resolve.
 *   2026-09-27 — aimeat_app_manage (destructive, not idempotent) replaces ten app tools' entries.
 *   2026-09-18 — aimeat_app_visitors (read-only) and aimeat_app_visitors_measure.
 *   2026-08-29 — aimeat_app_marks_set, aimeat_app_legal_set, aimeat_app_audit.
 *   2026-08-28 — The five crew-definition tools.
 *   2026-08-25 — The three data-map tools.
 *   v1.x — 2026-08-23 — Annotation for aimeat_package_install: a write, not destructive, and NOT
 *     idempotent — each install mints a fresh instance with its own component names, so a host that
 *     retries on a timeout leaves two copies.
 *   v1.x — 2026-08-16 — Annotations for the four incremental app-draft tools (write/replace/read/seed). draft_read is the only read-only one,
 *     which is what a host's smart-approve mode reads to decide what runs without asking; the two
 *     writing tools are NOT idempotent, because appending twice is the point.
 *   v1.x — 2026-08-15 — Annotation for aimeat_storage_delete: destructive, and idempotent only
 *     in the sense that the second call changes nothing (it answers 404).
 *   v1.x — 2026-08-13 — Annotations for aimeat_schedule_trigger and aimeat_agent_console_set.
 *   v1.x — 2026-08-08 — Annotations for the five aimeat_company_* tools.
 *   2026-07-19 — AppDev pitfall KB (Phase 4): reserved-package guard + optional model tag on contribute; register pitfall tools
 *   v1.0.0 -- 2026-05-29 -- Initial annotation map covering all 94 registered tools
 *     across server MCP and connector MCP, for Connectors Directory submission.
 *     Classification source: docs/plans/2026-05-29-connectors-directory-submission.md
 *     section A.0. Hint semantics per MCP spec 2025-11-25
 *     (https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
 */

import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../tool-catalog/definitions.js';

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
// The tools whose catalog entry does not carry its `annotations` yet (secaudit 2026-10, M3: one
// catalog group per commit moves its entries onto the definitions, and this list only shrinks).
const LISTED_ANNOTATIONS: Record<string, ToolAnnotations> = {
    // ── Core / discovery ──
    aimeat_handbook_get: { title: 'Read Agent Handbook', readOnlyHint: true },
    aimeat_catalogue_search: { title: 'Search Action Catalogue', readOnlyHint: true },
    aimeat_catalogue_agents: { title: 'Search Agent Directory', readOnlyHint: true },
    aimeat_catalogue_boards: { title: 'Browse Public Boards', readOnlyHint: true },
    aimeat_catalogue_directory: { title: 'Search People Directory', readOnlyHint: true },
    aimeat_discover: { title: 'Discover (Master Directory)', readOnlyHint: true, openWorldHint: true },
    // NOT read-only and NOT idempotent: it runs whatever it was pointed at, and what that does is
    // the target capability's business. openWorld, because the set of what it can reach is data.
    aimeat_invoke: { title: 'Run a Node Capability', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    // Read-only for the person's data: what it changes is which of this session's tools are listed.
    aimeat_tools_find: { title: 'Find and Add Tools', readOnlyHint: true, idempotentHint: true },
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
    // destructiveHint TRUE even though a delete is takeable back for the grace window: the client
    // showing this hint is asking whether to warn a person, and "it can be undone for a few days"
    // is not the same promise as "nothing is lost". Restore is the opposite — it only ever puts
    // something back — and repeating it changes nothing, so it is idempotent.
    aimeat_memory_delete: { title: 'Delete Memory Entry', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    aimeat_memory_restore: { title: 'Restore Deleted Memory Entry', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── Skills registry ──
    aimeat_skill_list: { title: 'Browse Skills Registry', readOnlyHint: true },
    aimeat_skill_get: { title: 'Resolve Skill', readOnlyHint: true },
    aimeat_skill_publish: { title: 'Publish Skill', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_skill_link: { title: 'Link Skill to Agent', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_skill_unlink: { title: 'Unlink Skill from Agent', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    aimeat_skill_update: { title: 'Change Skill Visibility', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── Operator config enactment ──
    aimeat_operator_agent_configure: { title: 'Configure Agent (Propose-then-Confirm)', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_operator_ai_config: { title: 'Configure AI Routing & Budget (Propose-then-Confirm)', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── Storage ──
    aimeat_storage_download: { title: 'Download Storage File', readOnlyHint: true },
    aimeat_storage_upload: { title: 'Upload Storage File', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    // idempotent because the version IS the content hash: publishing the same rows twice lands on
    // the same address and creates no second version.
    aimeat_datapackage_publish: { title: 'Publish Data Package', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_datapackage_export: { title: 'Export Data Package', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_storage_delete: { title: 'Delete Storage File', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },

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
    // Replaces the rule set, and the same set sent twice leaves the same board. Nothing is removed:
    // posts already on the board keep the lifetime they were given.
    aimeat_board_rules_set: { title: 'Set Board Rules', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── Sharing groups ──
    aimeat_group_list: { title: 'List Sharing Groups', readOnlyHint: true },
    aimeat_group_get: { title: 'Get Sharing Group', readOnlyHint: true },
    aimeat_group_create: { title: 'Create Sharing Group', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    // Idempotent: the same pattern to the same group returns the share that already exists rather
    // than adding a second row that revoking the first would not undo.
    aimeat_share_create: { title: 'Share a Key Space', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_share_list: { title: 'List Shares', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    // Destructive in the sense that matters: someone who could read loses that access.
    aimeat_share_revoke: { title: 'Stop Sharing', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    aimeat_group_add_member: { title: 'Add Group Member', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_group_remove_member: { title: 'Remove Group Member', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },

    // ── Organisms ──
    aimeat_organism_list: { title: 'List Organisms', readOnlyHint: true },
    aimeat_organism_get: { title: 'Get Organism', readOnlyHint: true },
    aimeat_organism_members: { title: 'List Organism Members', readOnlyHint: true },
    aimeat_organism_join: { title: 'Join Organism', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_organism_leave: { title: 'Leave Organism', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    aimeat_organism_create: { title: 'Create Organism', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_organism_update: { title: 'Update Organism', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_organism_archive: { title: 'Archive / Unarchive Organism Content', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_organism_invite: { title: 'Invite to Organism', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_organism_member_add: { title: 'Add Organism Member', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_organism_member_remove: { title: 'Remove Organism Member', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    aimeat_organism_invitation_update: { title: 'Edit Pending Invitation', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_organism_invitation_cancel: { title: 'Withdraw Invitation', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    aimeat_organism_invitations: { title: 'List My Invitations', readOnlyHint: true },
    aimeat_organism_invitation_respond: { title: 'Respond to Invitation', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_organism_invite_email: { title: 'Invite to Organism by Email', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_organism_invitations_email: { title: 'List Email Invitations', readOnlyHint: true },
    aimeat_organism_invitation_email_cancel: { title: 'Cancel Email Invitation', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    aimeat_organism_search: { title: 'Search Organism Content', readOnlyHint: true },
    aimeat_workspace_comment: { title: 'Comment on Workspace Object', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_workspace_comments: { title: 'List Workspace Comments', readOnlyHint: true },
    aimeat_workspace_comment_delete: { title: 'Delete Workspace Comment', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    aimeat_workspace_create: { title: 'Create Workspace', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_workspace_access: { title: 'Manage Workspace Access', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_workspace_member_grant: { title: 'Grant Workspace Role', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_workspace_member_revoke: { title: 'Revoke Workspace Role', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    aimeat_workspace_members: { title: 'List Workspace Members', readOnlyHint: true },
    aimeat_workspace_transfer: { title: 'Export / Import Workspace', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_organism_export: { title: 'Export Organism', readOnlyHint: true },
    aimeat_organism_import: { title: 'Import Organism', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_workspace_list: { title: 'List Workspaces', readOnlyHint: true },
    aimeat_workspace_read: { title: 'Read Workspace', readOnlyHint: true },
    aimeat_workspace_write: { title: 'Write Workspace Draft', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_workspace_publish: { title: 'Publish Workspace Draft', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_workspace_revert_to_draft: { title: 'Reopen Published Record', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_workspace_object_delete: { title: 'Delete Workspace Object', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    // In-place document edits. The append is NOT idempotent — running it twice adds the text twice,
    // which is the honest answer for an operation that exists to accumulate. The section replace is:
    // the same block replacing the same heading leaves the same document.
    aimeat_workspace_doc_append: { title: 'Append To Workspace Document', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_workspace_doc_section_replace: { title: 'Replace Workspace Document Section', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    // Row spaces. The append is idempotent BY THE CALLER'S CHOICE: supplying row_id makes a repeat
    // replace that row, omitting it makes every call a new row. Marked non-idempotent because the
    // hint has to describe the call a client might retry blindly, and that one has no row_id.
    aimeat_workspace_rows_append: { title: 'Append Workspace Rows', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_workspace_rows_read: { title: 'Read Workspace Rows', readOnlyHint: true },
    aimeat_workspace_rows_stats: { title: 'Workspace Row Space Stats', readOnlyHint: true },
    aimeat_workspace_rows_delete: { title: 'Delete Workspace Rows', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },

    // ── Outbound connections and mail ──
    // openWorldHint is TRUE on every one of these that leaves the node: they reach a provider whose
    // answer this node does not control, and a caller planning a retry needs to know the difference
    // between "our store said no" and "Google said no".
    // Remote MCP servers. `openWorldHint` is true on all but the list, because everything else here
    // reaches a server this node does not run.
    aimeat_workspace_update: { title: 'Update Workspace', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_workspace_space_add: { title: 'Add Workspace Space', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_workspace_sections_set: { title: 'Set Workspace Sections', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_workspace_suggestions: { title: 'Workspace Suggestions', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_organism_overview: { title: 'Organism Structure Overview', readOnlyHint: true },
    aimeat_workspace_overview: { title: 'Workspace Structure Overview', readOnlyHint: true },

    // ── Agents (owner's view) ──
    aimeat_agents_list: { title: 'List My Agents', readOnlyHint: true },

    // ── Tasks ──
    aimeat_task_list: { title: 'List Tasks', readOnlyHint: true },
    aimeat_task_get: { title: 'Get Task', readOnlyHint: true },
    aimeat_task_create: { title: 'Create Task', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_task_propose_todos: { title: 'Propose Task TODOs', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_task_request_changes: { title: 'Request TODO Plan Changes', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_task_start: { title: 'Start a Waiting Task', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_agent_scope_narrow: { title: 'Narrow an Agent to What It Used', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_agent_task_start_set: { title: 'Set How an Agent\'s Tasks Start', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_task_event: { title: 'Append Task Event', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_task_todo: { title: 'Update Task TODO', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_task_complete: { title: 'Complete Task', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_task_fail: { title: 'Fail Task', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_task_decline: { title: 'Decline Task', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── Schedules (agent-created recurring jobs) ──
    aimeat_schedule_create: { title: 'Create Schedule', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_schedule_list: { title: 'List Schedules', readOnlyHint: true },
    aimeat_schedule_update: { title: 'Update Schedule', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_schedule_delete: { title: 'Delete Schedule', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    // Not idempotent: each call is another real run of the job, with whatever that job does to the
    // world. openWorld because the job it runs may itself reach outside the node (ai, extension).
    aimeat_schedule_trigger: { title: 'Run Schedule Now', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    aimeat_schedule_report_internal: { title: 'Report Internal Schedules', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_workflow_save: { title: 'Save Workflow', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_workflow_get: { title: 'Get Workflow', readOnlyHint: true },
    aimeat_workflow_run: { title: 'Run Workflow', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_workflow_pending_inputs: { title: 'List Pending Workflow Inputs', readOnlyHint: true },
    aimeat_workflow_answer: { title: 'Answer Workflow Input', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },

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
    aimeat_usage_report: { title: 'Usage Report', readOnlyHint: true },
    aimeat_agent_statistics: { title: 'Get Agent Statistics', readOnlyHint: true },

    // ── Owner-managed agent classification ──
    aimeat_agent_tags_set: { title: 'Set Agent Tags', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_agent_mode_set: { title: 'Set Agent Mode', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_agent_description_set: { title: 'Set Agent Description', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_agent_run_mode_set: { title: 'Set Agent Run Mode', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_agent_runtime_report: { title: 'Report What Code Runs This Agent', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_agent_console_set: { title: 'Set Agent Console Address', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_agent_basics_get: { title: 'Basic Agents: What and Whether', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_agent_basics_request: { title: 'Ask the Owner for the Basic Agents', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    // Idempotent because proposing a name that is already waiting returns the standing proposal
    // rather than writing a second one.
    aimeat_agent_propose: { title: 'Propose a New Agent', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── Crew definition (the chat path to building a JSON agent) ──

    // ── Knowledge packages ──
    aimeat_knowledge_list: { title: 'List Knowledge Packages', readOnlyHint: true },
    aimeat_knowledge_get: { title: 'Read Knowledge Package', readOnlyHint: true },
    aimeat_knowledge_links: { title: 'Get Knowledge Links', readOnlyHint: true },
    aimeat_knowledge_contribute: { title: 'Contribute to Knowledge Package', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_appdev_overview: { title: 'AppDev Research Overview', readOnlyHint: true },
    aimeat_app_template_propose: { title: 'Propose App Template', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_app_template_list: { title: 'List App Template Proposals', readOnlyHint: true },
    aimeat_app_template_get: { title: 'Read App Template Proposal', readOnlyHint: true },
    aimeat_app_template_delete: { title: 'Delete App Template Proposal', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    aimeat_appdev_proof_attach: { title: 'Attach Acceleration Proof', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_appdev_pitfall_report: { title: 'Report AppDev Pitfall', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_appdev_pitfall_list: { title: 'List AppDev Pitfalls', readOnlyHint: true },
    aimeat_appdev_pitfall_delete: { title: 'Delete AppDev Pitfall', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },

    // ── Apps ──
    // Component packages (/v1/packages). A different thing from an app, and named so since
    // 2026-08-16 — these five were called aimeat_app_* on the connector doors while the node's MCP
    // used the same names for the web apps at /v1/apps.
    aimeat_app_list: { title: 'List Apps', readOnlyHint: true },
    aimeat_app_get: { title: 'Get App', readOnlyHint: true },
    // Destructive because some actions are: ui_set replaces a layout, subdomain_delete and
    // screenshot_clear remove, an empty access_code clears one. Not idempotent: agent_deploy starts
    // a new task on every call. A client that confirms each call is the safe reading of a mixed tool.
    aimeat_app_manage: { title: 'Manage an App', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    aimeat_app_publish: { title: 'Publish App', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_app_draft_save: { title: 'Save App Draft', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    // append is not idempotent: calling it twice writes the chunk twice, which is the whole point of
    // building a file across many calls. A client that retries on timeout must use expected_size_bytes.
    aimeat_app_draft_write: { title: 'Write App Draft', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_app_draft_replace: { title: 'Replace In App Draft', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_app_draft_read: { title: 'Read App Draft', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_app_draft_seed: { title: 'Seed App Draft', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_seo_status: { title: 'Search Visibility Status', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    // Open world: it posts to api.indexnow.org. Idempotent: the same notice twice is the same notice.
    aimeat_seo_announce: { title: 'Instant Update to Search Engines', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    aimeat_image_generate: { title: 'Generate Image', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    aimeat_voice_reply: { title: 'Generate Voice Reply', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    aimeat_voice_speak: { title: 'Generate Speech', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    aimeat_app_draft_publish: { title: 'Publish App Draft', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_app_draft_discard: { title: 'Discard App Draft', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    aimeat_app_fork: { title: 'Fork App', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_app_delete: { title: 'Delete App', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },

    // ── Extensions ──

    // ── Cortex ──

    // ── Chat instances ──
    aimeat_instance_list: { title: 'List Chat Instances', readOnlyHint: true },
    aimeat_instance_status: { title: 'Get Chat Instance Status', readOnlyHint: true },
    aimeat_instance_create: { title: 'Create Chat Instance', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },

    // ── Messages ──
    aimeat_message_inbox: { title: 'Read Message Inbox', readOnlyHint: true },
    aimeat_message_history: { title: 'Read Message Thread History', readOnlyHint: true },
    aimeat_message_send: { title: 'Send Agent Message', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_dm_send: { title: 'Send Federated Direct Message', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    aimeat_dm_broadcast: { title: 'Send One Message to Many', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    aimeat_dm_send_as_owner: { title: 'Send Federated Direct Message As Owner', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    aimeat_dm_delete_as_owner: { title: "Delete a Message From the Owner's Mailbox", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    aimeat_dm_inbox_as_owner: { title: "Read the Owner's Mailbox", readOnlyHint: true },
    aimeat_dm_thread_as_owner: { title: "Read a Thread From the Owner's Mailbox", readOnlyHint: true },
    aimeat_dm_archive_as_owner: { title: "Archive or Restore the Owner's Conversations", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_dm_organize_as_owner: { title: "Organise the Owner's Messages List", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_notify: { title: 'Notify Your Owner', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_dm_ask: { title: 'Ask a Structured Question (Federated)', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    aimeat_dm_inbox: { title: 'Read Federated DM Inbox', readOnlyHint: true },
    aimeat_dm_thread: { title: 'Read Federated DM Thread', readOnlyHint: true },

    // ── Agent v2 messaging (a turn between two principals of one account) ──
    // Not openWorld: every one of these stays inside the account. The delivery target is the one
    // thing that reaches outward, and it is a configuration, not a call — the outbound POST happens
    // later, from the node, and goes through safeFetch.
    aimeat_v2_message_send: { title: 'Send a Turn', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_v2_message_list: { title: 'Read Turns', readOnlyHint: true },
    aimeat_v2_push_set: { title: 'Register a Delivery Target', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_v2_push_list: { title: 'List Delivery Targets', readOnlyHint: true },
    aimeat_v2_push_delete: { title: 'Remove a Delivery Target', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },

    // -- Agent v2 tasks (the polling handle, not the dashboard work item) --
    // Cancelling is destructive in the sense that matters here: it ends the work, and it cannot be
    // undone because a terminal task never moves again.
    aimeat_v2_task_create: { title: 'Ask For Work', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_v2_task_list: { title: 'List Tasks', readOnlyHint: true },
    aimeat_v2_task_get: { title: 'Read One Task', readOnlyHint: true },
    aimeat_v2_task_status: { title: 'Report Task Status', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    aimeat_v2_task_cancel: { title: 'Cancel Work', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },

    // ── Companies (the registry + the co address family) ──
    aimeat_surface_layout_get: { title: 'Read a Page Layout', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_surface_layout_set: { title: 'Arrange a Page', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── Contacts (address book) ──
    aimeat_contact_list: { title: 'List Contacts', readOnlyHint: true },
    aimeat_contact_add: { title: 'Add Contact', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_contact_remove: { title: 'Remove Contact', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    aimeat_contact_resolve_email: { title: 'Resolve Email to Owner', readOnlyHint: true },
    aimeat_contact_invite: { title: 'Invite a Person by Email', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },

    // ── Consent ──
    aimeat_consent_list: { title: 'List Consents', readOnlyHint: true },
    aimeat_consent_grant: { title: 'Grant Consent', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_consent_revoke: { title: 'Revoke Consent', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    aimeat_access_list: { title: 'Access: Who Holds a Key', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    // ── The owner's secrets vault ──
    // set is idempotent (the same name and value twice leaves the same row) and NOT destructive,
    // even though it replaces: what it replaces is a value nobody could read, and the caller
    // supplied the new one. delete IS destructive — whatever named that secret stops working.
    aimeat_secret_list: { title: 'Secrets: What Is Stored', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_secret_set: { title: 'Store a Secret', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_secret_delete: { title: 'Remove a Secret', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },

    // ── Flags / moderation ──
    aimeat_flag_report: { title: 'Report Content for Moderation', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },

    // ── Admin (operator-only) ──
    aimeat_admin_stats: { title: 'Admin: Node Stats', readOnlyHint: true },
    aimeat_admin_agents: { title: 'Admin: List Agents', readOnlyHint: true },
    aimeat_organism_owner_add: { title: 'Add Organism Owner', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    aimeat_organism_owner_remove: { title: 'Remove Organism Owner', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    aimeat_admin_organism_ownership: { title: 'Admin: Organism Ownership', readOnlyHint: true },
    aimeat_admin_organism_owner_add: { title: 'Admin: Add Organism Owner', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    aimeat_admin_config: { title: 'Admin: Read Config', readOnlyHint: true },
    aimeat_admin_sso_list: { title: 'Admin: List SSO Connections', readOnlyHint: true },
    aimeat_admin_sso_get: { title: 'Admin: Read SSO Connection', readOnlyHint: true },
    aimeat_admin_sso_create: { title: 'Admin: Create SSO Connection', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    aimeat_admin_sso_update: { title: 'Admin: Update SSO Connection', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    aimeat_admin_sso_delete: { title: 'Admin: Delete SSO Connection', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    aimeat_admin_sso_idp_metadata: { title: 'Admin: Set SSO IdP Metadata', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    aimeat_admin_sso_scim_token: { title: 'Admin: Mint SCIM Token', readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    aimeat_admin_owner_disable: { title: 'Admin: Deactivate Account', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    aimeat_admin_owner_enable: { title: 'Admin: Reactivate Account', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    aimeat_admin_totp_reset: { title: 'Admin: Remove Two-Step Sign-In', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    aimeat_admin_security_overview: { title: 'Admin: Security Overview', readOnlyHint: true },
    aimeat_admin_incident_resolve: { title: 'Admin: Resolve Security Incident', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    aimeat_admin_cors_overview: { title: 'Admin: CORS Overview', readOnlyHint: true },
    aimeat_admin_hooks: { title: 'Admin: Hooks', readOnlyHint: true },
    aimeat_admin_statistics: { title: 'Admin: Statistics', readOnlyHint: true },
    aimeat_admin_knowledge: { title: 'Admin: Knowledge', readOnlyHint: true },
    aimeat_admin_federation: { title: 'Admin: Federation', readOnlyHint: true },
    // Reads npm, an outside service, but changes nothing anywhere.
    aimeat_admin_node_update: { title: 'Admin: Newer AIMEAT Version', readOnlyHint: true, openWorldHint: true },
    // Setting the same word twice leaves the same peer; the previous word was a setting, not data.
    aimeat_admin_federation_relay_claim_set: { title: 'Admin: Keep a Peer on Its Own Relay-Claim Setting', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    // Ends a link and, with emergency, cancels the work in flight with that peer; a second call finds nothing.
    aimeat_admin_federation_peer_remove: { title: 'Admin: Remove a Federation Peer', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    // Read-only about this node, but `ask_provider` reaches a third party, so it is not closed-world.
    aimeat_admin_usage: { title: 'Admin: Usage', readOnlyHint: true, openWorldHint: true },
    // Not destructive: binding replaces a list the operator can read first and set back.
    aimeat_admin_hook_set: { title: 'Admin: Bind a Hook', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    // Replacing a list is not destructive (the previous one was a setting, not data), and setting
    // the same list twice leaves the same list.
    aimeat_admin_cors_set: { title: 'Admin: Set Allowed Origins', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    // destructiveHint: mints morsels (irreversible ledger change, financial action)
    aimeat_admin_mint: { title: 'Admin: Mint Morsels', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },

    // ── Commerce (TARGET-033/034 over MCP) ──

    // ── Exchange marketplace (TARGET-045 over MCP) ──
};

/** Tool -> its annotations: each catalog entry's `annotations`, and the list above. */
export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
    ...LISTED_ANNOTATIONS,
    ...Object.fromEntries(CLI_FALLBACK_TOOL_DEFINITIONS.filter(d => d.annotations).map(d => [d.name, d.annotations!])),
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
