/**
 * @file annotations.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool annotations for the public server MCP surface (`aimeat/src/mcp/*.ts`)
 *   and the local connector MCP surface (`aimeat/src/cli/connect/mcp/tools/*.ts`), read from each
 *   tool's catalog entry (`annotations` on its definition, src/tool-catalog/definitions/; until
 *   2026-10-05 a hand-kept table here). Provides a `title` plus
 *   read-only / destructive / idempotent / open-world hints required by Anthropic's
 *   Connectors Directory review. Missing annotations are the #1 cause of directory
 *   rejection per the May 2026 review-criteria analysis -- every registered tool
 *   MUST have them.
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
 *   2026-10-05 — TOOL_ANNOTATIONS is the catalog's: the hand-kept table is gone, and its notes sit beside
 *     the definitions they explain (secaudit 2026-10, M3).
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
/** Tool -> its annotations: each catalog entry's `annotations` (src/tool-catalog/definitions/). */
export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = Object.fromEntries(
    CLI_FALLBACK_TOOL_DEFINITIONS.filter(d => d.annotations).map(d => [d.name, d.annotations!]),
);

/**
 * Returns the annotations for a registered tool. Throws if the tool has no entry
 * so new tools cannot ship without a classification. Connectors Directory rejects
 * any tool missing readOnlyHint/destructiveHint annotations.
 */
export function annotationsFor(name: string): ToolAnnotations {
    const annotations = TOOL_ANNOTATIONS[name];
    if (!annotations) {
        throw new Error(
            `Missing tool annotations for "${name}". Give its catalog entry \`annotations\` ` +
            `(src/tool-catalog/definitions/) before registering the tool. ` +
            `See docs/plans/2026-05-29-connectors-directory-submission.md section A.`,
        );
    }
    return annotations;
}
