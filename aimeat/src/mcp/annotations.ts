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

    // ── Onboarding ──

    // ── Memory ──

    // ── Skills registry ──

    // ── Operator config enactment ──

    // ── Storage ──

    // ── Wallet & morsels ──

    // ── Boards ──

    // ── Sharing groups ──

    // ── Organisms ──
    // In-place document edits. The append is NOT idempotent — running it twice adds the text twice,
    // which is the honest answer for an operation that exists to accumulate. The section replace is:
    // the same block replacing the same heading leaves the same document.

    // ── Outbound connections and mail ──
    // openWorldHint is TRUE on every one of these that leaves the node: they reach a provider whose
    // answer this node does not control, and a caller planning a retry needs to know the difference
    // between "our store said no" and "Google said no".
    // Remote MCP servers. `openWorldHint` is true on all but the list, because everything else here
    // reaches a server this node does not run.

    // ── Agents (owner's view) ──

    // ── Tasks ──

    // ── Schedules (agent-created recurring jobs) ──

    // ── Work queue ──

    // ── Actions & capabilities ──
    // openWorldHint: dispatches to third-party action providers/capabilities/sandboxed code

    // ── Agent telemetry & capabilities ──

    // ── Owner-managed agent classification ──

    // ── Crew definition (the chat path to building a JSON agent) ──

    // ── Knowledge packages ──

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

    // ── Messages ──

    // ── Agent v2 messaging (a turn between two principals of one account) ──
    // Not openWorld: every one of these stays inside the account. The delivery target is the one
    // thing that reaches outward, and it is a configuration, not a call — the outbound POST happens
    // later, from the node, and goes through safeFetch.

    // ── Companies (the registry + the co address family) ──

    // ── Contacts (address book) ──

    // ── Consent ──

    // ── The owner's secrets vault ──
    // set is idempotent (the same name and value twice leaves the same row) and NOT destructive,
    // even though it replaces: what it replaces is a value nobody could read, and the caller
    // supplied the new one. delete IS destructive — whatever named that secret stops working.

    // ── Flags / moderation ──

    // ── Admin (operator-only) ──
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
