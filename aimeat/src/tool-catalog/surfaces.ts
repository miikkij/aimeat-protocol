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
 *     - primitives: a handful, everything else through aimeat_discover + aimeat_invoke
 *     - chat     : the node's own chat: a small core on, the rest switched on by purpose
 *     - full     : everything v2 may carry, computed as catalog minus V2_EXCLUDED
 *   v1/mcp stays full and frozen; these are opt-in. Surfaces are ALLOWLISTS over the same catalog —
 *   no forked handlers. instance_* is intentionally absent from v2 (auto-created session meta).
 * @structure
 *   - SurfaceRole, V2_ROLES, V2_EXCLUDED
 *   - MCP_SURFACES — role -> tool-name allowlist
 *   - toolsForSurface(role) -> Set<string>
 *   - validateSurfaces() -> coverage report (used by the unit test / audit)
 * @usage
 *   import { toolsForSurface } from './surfaces.js';
 *   const allowed = toolsForSurface('agent'); // register only these on /v2/mcp/agent
 * @version-history
 *   2026-10-05 — MCP_SURFACES is each catalog entry's `surfaces` plus the lists here, which only
 *     shrink as each catalog group carries its own (secaudit 2026-10, M3). SurfaceRole moved to
 *     definitions/types.ts and is re-exported.
 *   2026-10-04 — aimeat_task_decline on the agent surface, beside aimeat_task_fail.
 *   2026-10-02 — An eighth surface, `chat`, for the node's own chat: 19 tools on at the start, every
 *     other tool registered and switched off until aimeat_tools_find (CHAT_ONLY) or a call by name
 *     switches it on. toolsRegisteredOn(role) says what a session registers.
 *   2026-10-02 — aimeat_task_start and aimeat_agent_task_start_set on `agent`, beside the task tools.
 *   2026-10-02 — aimeat_agent_propose, aimeat_agent_basics_get and _request on `agent`: an owner's
 *     own agent is who a person asks for a new agent, and these were on `admin` only.
 *   2026-10-01 — aimeat_admin_federation_peer_remove beside aimeat_admin_federation.
 *   2026-09-30 — aimeat_workspace_comment_delete beside the other comment tools.
 *   2026-09-30 — aimeat_admin_node_update on the admin surface.
 *   2026-09-29 — aimeat_refinery_classes, _run and _status on `agent`, beside the mail tools.
 *   2026-10-02 — aimeat_package_withdraw on `appdev` and `agent` (phase 5).
 *   2026-10-02 — aimeat_package_compose_set on `appdev` and `agent`, beside compose (phase 4).
 *   2026-10-02 — aimeat_package_offer on `appdev` and `agent`, aimeat_package_buy on `agent`,
 *     aimeat_package_claim on the operator surface (package sale design, phase 3).
 *   2026-09-29 — aimeat_package_sellers on `appdev` and `agent`; aimeat_package_sale on the operator surface.
 *   2026-09-28 — aimeat_package_config_needs on `appdev` and `agent`, beside the entitlements.
 *   2026-09-28 — aimeat_admin_install_set on the operator surface.
 *   2026-09-28 — aimeat_package_instance_set, aimeat_package_check_updates, aimeat_package_repository and
 *     aimeat_package_entitlements on `appdev` and `agent`, beside update.
 *   2026-09-28 — aimeat_package_instances and aimeat_package_fork on `appdev` and `agent`, beside update.
 *   2026-09-28 — aimeat_ai_roles beside aimeat_ai_providers (appdev, agent); aimeat_ai_role_set beside
 *     aimeat_ai_routing_set (agent, admin). AI roles.
 *   2026-09-28 — aimeat_ai_capabilities, aimeat_ai_models, aimeat_ai_transcribe and aimeat_ai_embed on
 *     appdev and agent, beside aimeat_ai_providers (System 2 plan, V5).
 *   2026-09-28 — aimeat_ai_providers and aimeat_ai_provider_test beside aimeat_image_generate;
 *     aimeat_ai_routing_set beside aimeat_ai_policy_set (System 2 plan, V3).
 *   2026-09-28 — aimeat_ai_policy_set joins the agent and admin surfaces beside aimeat_operator_ai_config.
 *   2026-09-25 — aimeat_workspace_space_add, aimeat_workspace_sections_set and
 *     aimeat_workspace_suggestions beside the document tools on appdev, agent and service.
 *   2026-09-25 — aimeat_admin_federation_relay_claim_set beside aimeat_admin_federation.
 *   2026-09-25 — aimeat_package_install_requests on `appdev` and `agent`, beside the install it answers.
 *   2026-10-03 — aimeat_theme_font_save beside the other theme tools (the font manager).
 *   2026-09-24 — aimeat_theme_policy_set beside the other theme tools.
 *   2026-09-24 — aimeat_theme_style_save and aimeat_theme_component_css_set beside the other theme tools.
 *   2026-09-24 — aimeat_theme_list, aimeat_theme_get and aimeat_theme_save on the agent and admin surfaces.
 *   2026-09-23 — aimeat_ui_component_list and aimeat_ui_component_get on the agent and admin surfaces.
 *   2026-09-13 — aimeat_board_rules_set on the service surface, beside the other board tools.
 *   2026-09-13 — aimeat_dm_archive_as_owner and aimeat_dm_organize_as_owner on the agent surface.
 *   2026-09-12 — aimeat_dm_inbox_as_owner and aimeat_dm_thread_as_owner on the agent surface.
 *   2026-09-08 — aimeat_admin_cors_overview and aimeat_admin_cors_set on the operator surface,
 *     beside the Security pair.
 *   2026-09-06 — The three secrets-vault tools on the agent and admin surfaces: setting up an
 *     integration is the work an owner's own agent does, and a key it stores is one the owner never
 *     has to paste anywhere. Nothing anywhere reads a value back.
 *   2026-09-05 — aimeat_admin_security_overview and aimeat_admin_incident_resolve on the operator
 *     surface, beside the account-lifecycle tools.
 *   2026-09-03 — A seventh surface, `full`, computed rather than listed: the catalog minus
 *     V2_EXCLUDED, so it cannot fall behind a new tool and the only way to keep one off it is to
 *     say so where the reasons already live. The other six are unchanged.
 *   2026-09-01 — A sixth surface, `primitives` (Agent v2 V2): twelve tools, and everything else
 *     reached through aimeat_discover + aimeat_invoke. The other five are unchanged, and so is
 *     /v1/mcp — this is one more door, not a replacement for any of them.
 *   2026-09-27 — aimeat_app_manage on appdev and agent, in place of the ten app tools it replaces.
 *   2026-09-18 — aimeat_app_visitors and aimeat_app_visitors_measure beside the other app settings.
 *   2026-08-29 — aimeat_app_marks_set, aimeat_app_legal_set and aimeat_app_audit beside aimeat_app_seo_set.
 *   2026-08-28 — The five aimeat_crew_* tools on `appdev`, `agent` and `admin`: the chat path to
 *     building a JSON agent, beside the other owner-managed agent tools.
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

import type { SurfaceRole } from './definitions/types.js';
export type { SurfaceRole };
export const V2_ROLES: readonly SurfaceRole[] = ['appdev', 'agent', 'service', 'admin', 'commerce', 'primitives', 'chat', 'full'];

/**
 * Tools that exist only on the `chat` surface. aimeat_tools_find switches on tools the session
 * registered and kept off, so on every other surface, where everything registered is on, it has
 * nothing to do. Kept off `full` (and so off nothing else, since no other list names it).
 */
export const CHAT_ONLY: readonly string[] = ['aimeat_tools_find'];

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
    // Authoring a package by hand and pruning its history stay on the connector doors: publish
    // carries every component's source inline, which is a payload a chat should not be asked to
    // produce, and versions/delete are maintenance a person does at a keyboard. list, get,
    // status_set and install are on the node surfaces, because they are the four steps a
    // conversation actually takes: find a package, read it, publish it, take it into use.
    'aimeat_package_versions', 'aimeat_package_publish', 'aimeat_package_delete',
];

/**
 * role -> allowlist of tool names. Each catalog entry names the roles that carry it (`surfaces`
 * on its definition, with the reason beside it); `full` is computed. Derived from
 * docs/mcp_audit/11-v2-mcp-design.md §2/§3. Until 2026-10-05 these were hand-kept lists here, one
 * per role, beside the catalog (secaudit 2026-10, M3).
 *
 * `primitives`:
 * The PRIMITIVES surface (/v2/mcp/primitives) — Agent v2, V2.
 *
 * Twelve tools instead of several hundred. Not a smaller version of `agent`: a different
 * proposition. The other surfaces answer "here is everything of this kind"; this one answers
 * "here is how to hold this node in your head". Everything else on the node is reachable
 * through `aimeat_discover` (find a capability) and `aimeat_invoke` (run it as yourself), so
 * the catalogue is data the agent reads when it needs it rather than context it carries always.
 *
 * The other five surfaces and /v1/mcp are untouched and still register their full sets. Nothing
 * here removes a tool from anywhere; this is one more door.
 *
 * WHY THESE TWELVE. They are the ones an agent cannot discover its way to, because they are what
 * it uses to work at all: read and write what it knows, read and write what a group knows, take
 * work and hand it back, speak to its person, put a file somewhere and fetch it. Everything past
 * that is a capability, and capabilities are found rather than carried.
 *
 * `chat`:
 * The CHAT surface (/v2/mcp/chat): what the node's own chat starts every turn with.
 *
 * WHY. The node chat used /v1/mcp and so read every tool the agent may use on every model round:
 * 324 tools, about 515 000 characters, about 129 000 tokens (measured 2026-10-02). A one-line
 * question cost 0.033 USD on a hosted place, and every round waited 15 to 30 s for its first
 * token. Tool descriptions were most of what each message paid for.
 *
 * HOW. This list is what is ON when the session opens: the tools the handbook's common jobs need.
 * Every other tool the agent's permissions allow is still REGISTERED on the session, switched
 * off (mcp/tool-loader.ts). aimeat_tools_find searches them by purpose and switches the matches
 * on for the rest of the session, and a call to a switched-off tool by name switches it on and
 * runs it. Nothing is unreachable; it is only not in every round's prompt.
 *
 * `commerce`:
 * The selling surface (/v2/mcp/commerce): everything an agent needs to price something, take
 * payment for it and read what came in — credentials for the seller's own rails, priced tool
 * manifests, checkout, wallet, and the memory/storage the listing itself lives in.
 *
 * `full`:
 * The FULL surface (/v2/mcp/full) — everything v2 may carry, and NOT a hand-kept list.
 *
 * It is the catalog minus V2_EXCLUDED, computed at load. That is the whole point: a `full`
 * written out by hand would be the first list to go stale, and it would go stale silently,
 * because nothing downstream can tell an omission from a decision. Computed, a new tool is on
 * it the moment it exists, and the only way to keep one off is to say so in V2_EXCLUDED, where
 * every entry already carries its reason.
 *
 * WHO IT IS FOR. A client that wants what /v1/mcp gives but addressed the v2 way, and the
 * honest answer for an agent whose work does not fit one of the focused surfaces. It is not
 * the default: a focused surface is smaller context and fewer ways to misfire, and that is the
 * reason the other surfaces exist at all.
 */
const FULL = CLI_FALLBACK_TOOL_DEFINITIONS
    .map(d => d.name)
    .filter(name => !V2_EXCLUDED.includes(name) && !CHAT_ONLY.includes(name));

export const MCP_SURFACES: Record<SurfaceRole, string[]> = Object.fromEntries(V2_ROLES.map(role => [role,
    role === 'full' ? FULL : CLI_FALLBACK_TOOL_DEFINITIONS.filter(d => d.surfaces?.includes(role)).map(d => d.name),
])) as Record<SurfaceRole, string[]>;

const _surfaceSets: Record<SurfaceRole, Set<string>> = {
    primitives: new Set(MCP_SURFACES.primitives),
    chat: new Set(MCP_SURFACES.chat),
    appdev: new Set(MCP_SURFACES.appdev),
    agent: new Set(MCP_SURFACES.agent),
    service: new Set(MCP_SURFACES.service),
    admin: new Set(MCP_SURFACES.admin),
    commerce: new Set(MCP_SURFACES.commerce),
    full: new Set(MCP_SURFACES.full),
};

/** The set of tool names exposed on a given v2 surface. On `chat`, the ones that are on at the start. */
export function toolsForSurface(role: SurfaceRole): Set<string> {
    return _surfaceSets[role];
}

/**
 * The tools a session of this surface REGISTERS. The same as toolsForSurface, except on `chat`,
 * which registers everything `full` carries and switches off what its own list does not name.
 */
export function toolsRegisteredOn(role: SurfaceRole): Set<string> {
    return role === 'chat' ? new Set([..._surfaceSets.full, ..._surfaceSets.chat]) : _surfaceSets[role];
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
