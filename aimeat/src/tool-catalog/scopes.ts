/**
 * @file scopes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description F1 scope enforcement metadata for the MCP tool surface. Maps each scope-gated tool
 *   to the scope its REST counterpart already requires (auth/middleware.ts requireScope), so the
 *   public /v1/mcp surface enforces the SAME least-privilege rules as REST — closing the hole where
 *   /v1/mcp registered every tool for every agent regardless of granted scopes.
 *
 *   Only tools whose REST route is genuinely scope-gated appear in TOOL_SCOPES. Tools omitted here
 *   (tasks, apps, extensions, cortex, organisms, knowledge, instances, groups, capabilities, flags,
 *   storage, catalogue, board reads, onboarding, handbook, agent self-report, messages) are NOT
 *   scope-gated in REST either, so leaving them ungated keeps MCP consistent with REST. The operator's
 *   tools ride words no wildcard carries (operator:admin and its siblings), because every tool
 *   session is an agent and the account role alone armed every agent an operator connected.
 * @structure
 *   - TOOL_SCOPES — tool name -> required scope (mirrors REST requireScope gates)
 *   - scopeAllowsTool() — wildcard-aware check (exact / domain:* / global *), mirroring middleware
 *   - MCP_SCOPE_PROFILES / scopesForProfile() — role-based scope bundles for agent provisioning,
 *     re-exported from ./scope-profiles.ts
 * @usage
 *   import { scopeAllowsTool } from './scopes.js';
 *   if (scopeAllowsTool(agentScopes, 'aimeat_memory_write')) mcp.tool(...)
 * @version-history
 *   v1.50.0 -- 2026-10-05 -- TOOL_SCOPES is each catalog entry's `scope` plus the list here, which
 *     only shrinks as each catalog group carries its own (secaudit 2026-10, M3). ToolScope moved to
 *     definitions/types.ts and is re-exported.
 *   v1.49.0 -- 2026-10-05 -- An entry may name several words, all needed (ToolScope, toolScopeWords,
 *     requiredScopesForTool replaces requiredScopeForTool): aimeat_refinery_run names the four its
 *     route asks, so it is no longer offered to an agent that cannot run it (secaudit 2026-10, C3).
 *   v1.48.0 -- 2026-10-02 -- aimeat_agent_runtime_report moves to SCOPE_EXEMPT_TOOLS, as tags did: an
 *     agent reports its own runtime and model road without agent:write.
 *   v1.47.0 -- 2026-10-02 -- aimeat_workspace_object_delete -> memory:purge (removes for good).
 *   v1.48.0 -- 2026-10-02 -- aimeat_workspace_rows_delete -> memory:purge (removes rows for good).
 *   v1.46.0 -- 2026-10-02 -- aimeat_agent_tags_set moves to SCOPE_EXEMPT_TOOLS: the crew runtime sets
 *     an agent's own tags on every start, and an agent without agent:write finished no task.
 *   v1.45.0 -- 2026-10-02 -- aimeat_task_start -> task:write, aimeat_agent_task_start_set -> agent:write.
 *   v1.44.0 -- 2026-10-02 -- aimeat_package_withdraw -> packages:write, the word its route asks (phase 5).
 *   v1.43.0 -- 2026-10-02 -- aimeat_package_compose_set -> packages:write, as compose (phase 4).
 *   v1.42.0 -- 2026-10-02 -- aimeat_package_offer -> packages:write, aimeat_package_buy -> commerce:buy,
 *     the words their REST endpoints ask (package sale design, phase 3).
 *   v1.41.0 -- 2026-10-01 -- aimeat_contact_list -> contacts:read, the word GET /v1/contacts now asks of
 *     anything acting for the owner (the developer's ruling of 2026-10-01). It rode messages:read here
 *     while the REST endpoint refused every agent, so the connector's copy of the tool never worked.
 *   v1.40.0 -- 2026-09-29 -- aimeat_refinery_run and aimeat_refinery_status -> connections:read-through, the
 *     word both REST endpoints ask (the run checks its other three words itself, as its route does).
 *     SCOPE_EXEMPT_TOOLS moved unchanged to ./scope-exempt-tools.ts and is re-exported here (max-file-lines).
 *   v1.39.0 -- 2026-09-29 -- aimeat_package_sellers -> packages:write and aimeat_package_sale -> operator:admin,
 *     the words their REST endpoints ask. The operator rows moved to scopes-operator.ts unchanged
 *     (max-file-lines), spread where they stood.
 *   v1.38.0 -- 2026-09-28 -- aimeat_package_config_needs -> packages:write, the word its REST endpoint asks.
 *   v1.37.0 -- 2026-09-28 -- aimeat_admin_install_set -> operator:admin, the word its REST endpoints ask.
 *   v1.36.0 -- 2026-09-28 -- aimeat_package_instance_set, aimeat_package_check_updates, aimeat_package_repository
 *     and aimeat_package_entitlements -> packages:write, the word their REST endpoints ask.
 *   v1.35.0 -- 2026-09-28 -- aimeat_package_fork -> packages:write, the word POST /v1/instances/:id/fork asks.
 *     aimeat_package_instances reads like GET /v1/instances, with no word.
 *   v1.34.0 -- 2026-09-28 -- aimeat_ai_roles needs ai:use; aimeat_ai_role_set needs memory:write-reserved, as
 *     GET and PUT /v1/ai/roles do (AI roles).
 *   v1.33.0 -- 2026-09-28 -- aimeat_ai_capabilities, aimeat_ai_models, aimeat_ai_transcribe and aimeat_ai_embed need
 *     ai:use (System 2 plan, V5).
 *   v1.32.0 -- 2026-09-28 -- aimeat_ai_providers and aimeat_ai_provider_test need ai:use; aimeat_ai_routing_set needs
 *     memory:write-reserved (System 2 plan, V3).
 *   v1.31.0 -- 2026-09-28 -- aimeat_ai_policy_set needs memory:write-reserved, like aimeat_operator_ai_config.
 *   v1.30.1 -- 2026-09-26 -- MCP_SCOPE_PROFILES and scopesForProfile() move unchanged to
 *     ./scope-profiles.ts and are re-exported here: the file had passed the 800-line limit.
 *   v1.30.0 -- 2026-09-25 -- aimeat_workspace_space_add, aimeat_workspace_sections_set and
 *     aimeat_workspace_suggestions → organism:write, the word their REST doors ask.
 *   v1.29.1 -- 2026-09-25 -- The operator:admin note says the operator's full-access agents got the
 *     word once per node (services/operator-admin-migration.ts). No entry changed.
 *   v1.29.0 -- 2026-09-25 -- aimeat_admin_federation_relay_claim_set: operator:admin, like its read.
 *   v1.28.0 -- 2026-09-25 -- aimeat_package_install_requests -> packages:write, the word the three
 *     /v1/package-install-requests doors ask.
 *   v1.27.0 -- 2026-09-24 -- SECURITY (audit A5-1): aimeat_mail_search, aimeat_mail_read and
 *     aimeat_mail_aliases ride connections:read-through instead of connections:use.
 *   v1.26.0 -- 2026-09-24 -- SECURITY (audit A8-1): the node administration block leaves
 *     SCOPE_EXEMPT_TOOLS for operator:admin, outside every wildcard: the 24 aimeat_admin_* tools that
 *     had no word, the MCP registry pair and the SEO pair (from app:write). aimeat_surface_layout_get
 *     takes site:layout-write, the word of its write. Not grandfathered, like every operator word.
 *   v1.26.0 -- 2026-10-03 -- aimeat_theme_font_save → site:theme-write (the font manager).
 *   v1.25.0 -- 2026-09-24 -- aimeat_theme_policy_set → site:theme-write.
 *   v1.24.0 -- 2026-09-24 -- aimeat_theme_style_save and aimeat_theme_component_css_set → site:theme-write.
 *   v1.23.0 -- 2026-09-24 -- aimeat_theme_save → site:theme-write (Themes & Styles).
 *   v1.22.1 -- 2026-09-13 -- aimeat_board_rules_set → social:write, the word PATCH /v1/boards/:id/rules asks.
 *   v1.22.0 -- 2026-09-13 -- aimeat_dm_archive_as_owner and aimeat_dm_organize_as_owner →
 *     messages:organize-as-owner, outside the '*' bundle.
 *   v1.21.0 -- 2026-09-12 -- aimeat_dm_inbox_as_owner and aimeat_dm_thread_as_owner → messages:read-as-owner,
 *     outside the '*' bundle.
 *   v1.20.0 -- 2026-09-08 -- aimeat_admin_cors_overview and aimeat_admin_cors_set join the
 *     operator-gated list, beside the Security pair.
 *   2026-09-27 -- aimeat_app_manage replaces ten app tools; it is in SCOPE_EXEMPT_TOOLS and its
 *     handler checks each action's word (catalog/action-scopes.ts). The ten entries are gone.
 *   v1.19.0 -- 2026-09-06 -- The three secrets-vault tools → secrets:manage, the same word the three
 *     REST doors use. A new word rather than a memory one: memory:write is already held by live
 *     agents and grants, and putting a credential store behind it would have handed every one of
 *     them the power to rotate the owner's keys with nobody ever asked.
 *   v1.18.0 -- 2026-09-05 -- aimeat_admin_security_overview and aimeat_admin_incident_resolve join
 *     the operator-gated list: the handler checks the role, no scope word narrows them.
 *   2026-09-18 -- aimeat_app_visitors -> signals:read, aimeat_app_visitors_measure -> signals:write:
 *     the first two tools on the signals words, which the REST doors have carried since 2026-08-24.
 *   v1.17.0 -- 2026-08-29 -- aimeat_app_legal_set and aimeat_app_audit → app:write (the one app
 *     scope the owner's checkboxes carry; the routes behind every door are gated on it).
 *   v1.16.0 -- 2026-08-29 -- aimeat_app_marks_set → app:write.
 *   v1.15.0 -- 2026-08-28 -- The five crew-definition tools: get -> memory:read, validate/try/draft/
 *     publish -> memory:write, the scope the REST doors gate the definition writes on.
 *   v1.14.0 -- 2026-08-28 -- The four Design Book tools (TARGET-074 phase 5): search/get ->
 *     memory:read, propose/adopt -> memory:write, mirroring the REST requireScope gates on
 *     /v1/designbook. Adoption writes the caller's own app layout, which is exactly memory:write.
 *   v1.13.0 -- 2026-08-23 -- aimeat_package_install -> packages:write, the scope
 *     POST /v1/packages/:groupId/install already requires. Installing registers an app, a cortex, an
 *     extension and any @activate cron the manifest declares, all under the owner's identity.
 *   v1.12.0 -- 2026-08-22 -- scopesForProfile warns when it is handed a profile name that is not in
 *     the table. The name it silently swallowed was `agent`, from the built-in chat agent, and the
 *     fallback left the person's own chat holding memory read and write on their own node.
 *   v1.11.0 -- 2026-08-16 -- the four incremental app-draft tools (write/replace/read/seed) all take app:write, including the read.
 *     Reading your own unpublished draft is part of editing it, not a separate authority, and a
 *     narrower scope would let an owner grant edits whose result the agent could not check.
 *   v1.10.0 -- 2026-08-15 -- aimeat_storage_delete -> storage:write, the same permission as the
 *     upload. Storing a file and taking it back are one authority over one namespace; a separate
 *     scope would let an owner grant an agent uploads it could never clean up.
 *   v1.9.0 -- 2026-08-14 -- aimeat_usage_report -> wallet:read, matching GET /v1/usage/summary. A
 *     usage report is the owner's whole spend and activity history, which is the same sensitivity
 *     class as their balance rather than a new one.
 *   v1.8.0 -- 2026-08-13 -- aimeat_schedule_trigger -> task:write (it creates the same work its cron
 *     would) and aimeat_agent_console_set -> agent:write (beside mode_set and tags_set).
 *   v1.7.1 -- 2026-08-11 -- Note beside the onboarding entries in SCOPE_EXEMPT_TOOLS: the four tools
 *     mirror the step-confirm route, which is still ungated, while start/cancel now ask for
 *     agent:write (audit H-2) and have no tool. No mapping changed.
 *   v1.7.0 -- 2026-08-11 -- scopeAllowsTool delegates to utils/scope-coverage.ts scopeIsCovered
 *     instead of retelling the wildcard rule. The retelling had lost the memory:write-reserved
 *     exception, so an agent holding '*' got aimeat_operator_ai_config registered.
 *   v1.x — 2026-08-08 — aimeat_company_* ride company:read / company:write.
 *   v1.6.0 -- 2026-08-10 -- 55 mutating tools get the scope they need, and SCOPE_EXEMPT_TOOLS
 *     shrinks from 73 to 18. Seven new scope words, handed to existing agents at boot by
 *     services/scope-vocabulary-migration.ts so an entry here does not delete their tools.
 *   v1.5.0 -- 2026-08-01 -- TARGET-058 Phase 4: a note on why `provenance:write` is NOT in
 *     TOOL_SCOPES. It gates a PARAMETER, not a tool, and hiding nine tools from an agent that merely
 *     cannot assert authorship would be the wrong trade — the honest default needs no permission.
 *   2026-07-19 — AppDev pitfall KB (Phase 4): reserved-package guard + optional model tag on contribute; register pitfall tools
 *   v1.4.0 -- 2026-07-14 -- Commerce scopes (commerce:sell / commerce:buy) for the MCP commerce
 *     tools — deliberately stricter than the requireAuth-only REST commerce routes (documented
 *     divergence: PSP secrets + owner-balance spending warrant least-privilege on the agent surface).
 *   v1.3.0 -- 2026-06-25 -- Specialist scope-consent (declare→consent→grant): SPECIALIST_REQUESTED_SCOPES
 *     (the extras a role would LIKE beyond the conservative baseline), SCOPE_DESCRIPTIONS (plain-language
 *     consent vocabulary), requestedExtras()/describeScopes(). The granted-by-default MCP_SCOPE_PROFILES
 *     stay unchanged + conservative; extras are a SEPARATE declaration, granted only with owner consent.
 *   v1.2.1 -- 2026-06-24 -- Secretary P5 gap-closure (G1): trim sdr/finance/recruiter so EVERY specialist
 *     role is a strict subset of the `secretary` Community baseline (removed workflow:write + social:read
 *     from sdr, wallet:read from finance, social:read from recruiter) — least-privilege; the Enterprise
 *     superset (wallet/workflow:write/social/outbound) is no longer granted to a Community specialist.
 *   v1.2.0 -- 2026-06-24 -- Secretary P5 (S-A): add specialist scope profiles (specialist/sdr/prep/
 *     finance/recruiter) + SPECIALIST_ROLES/isSpecialistRole, all Community-safe (≤ secretary set).
 *   v1.1.0 -- 2026-06-23 -- Add the `secretary` scope profile (Secretary feature Phase 0).
 *   v1.0.0 -- 2026-05-30 -- MCP audit Phase 3 (F1): tool->scope map + wildcard check + scope profiles
 */
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { OPERATOR_TOOL_SCOPES } from './scopes-operator.js';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from './definitions.js';
import type { ToolScope } from './definitions/types.js';

/**
 * Tool -> required scope, mirroring the REST requireScope() gate for the SAME operation.
 * Verified against src/routes/{memory,boards,wallet,work,actions,consent}.ts.
 */
// The tools that change state and deliberately need no scope, each with its reason (moved unchanged).
export { SCOPE_EXEMPT_TOOLS } from './scope-exempt-tools.js';

export type { ToolScope };

/** The words a TOOL_SCOPES entry names, as a list. */
export const toolScopeWords = (entry: ToolScope | undefined): string[] =>
    entry === undefined ? [] : typeof entry === 'string' ? [entry] : [...entry];

// The tools whose catalog entry does not carry its `scope` yet (secaudit 2026-10, M3: one catalog
// group per commit moves its entries onto the definitions, and this list only shrinks).
const LISTED_TOOL_SCOPES: Record<string, ToolScope> = {
    // ── August 2026 audit, step 3a ───────────────────────────────────────────────────────────────
    // 73 mutating tools had no entry here, and scopeAllowsTool() reads a missing entry as PERMISSION,
    // so any agent holding any single scope could call all of them. These 55 now say what they need.
    //
    // Adding an entry does not start refusing a call — it REMOVES the tool from an agent whose
    // scopes do not carry the word (mcp/index.ts wraps mcp.tool). Every agent that existed on
    // 2026-08-10 was therefore granted the new words at boot, once, by
    // services/scope-vocabulary-migration.ts. Without that this is changelog 1.33.1 again, where
    // every agent tagging itself got ACCESS_DENIED and discovery broke fleet-wide.
    //
    // The words themselves are new and appear in the owner's agent editor
    // (public/views/profile/agents/scope-model.js), so any of them can be taken away.
    // Reconfigure ANOTHER of the owner's agents. An agent describing itself needs nothing;
    // reaching sideways at a sibling principal with its own identity and trust score does.

    // The destructive half: delete an app. Split from write because shipping an update and
    // removing the thing are different risks.
    aimeat_app_delete:                        'app:manage',

    // Publish or update an app under the owner's account, including drafts.
    aimeat_app_draft_discard:                 'app:write',
    aimeat_app_draft_publish:                 'app:write',
    aimeat_app_draft_save:                    'app:write',
    aimeat_app_draft_write:                   'app:write',
    aimeat_app_draft_replace:                 'app:write',
    aimeat_app_draft_read:                    'app:write',
    aimeat_app_draft_seed:                    'app:write',
    // The node's discovery status and the announcement to search engines. Both refuse everyone but
    // the operator in their handler, so the word is the operator's (security audit A8-1): on app:write,
    // which every Full-access agent holds, any agent of the operator could tell the search engines
    // about the whole node.
    aimeat_seo_status:                        'operator:admin',
    aimeat_seo_announce:                      'operator:admin',
    aimeat_image_generate:                    'ai:use',
    aimeat_voice_reply:                       'ai:use',
    aimeat_voice_speak:                       'ai:use',
    aimeat_app_fork:                          'app:write',
    aimeat_app_publish:                       'app:write',

    // The operator tools: organism break-glass and operator:admin (scopes-operator.ts).
    ...OPERATOR_TOOL_SCOPES,

    // NOTE on `provenance:write` (TARGET-058): it deliberately has NO entry in this map, because it
    // does not gate a TOOL — it gates one optional PARAMETER (`ai_provenance`) on nine of them.
    // Listing a tool here would hide the whole tool from an agent that merely cannot assert how its
    // content was made, when the honest default (the node records what it observed) is available to
    // everyone and needs no permission at all. The check lives at the one place that mints from a
    // declaration, services/ai-provenance.ts:provenanceForWrite, and mirrors requireScope() exactly
    // — so this parameter and POST /v1/provenance cannot answer differently.

};

/** Tool -> the scope words it needs: each catalog entry's `scope`, and the list above. */
export const TOOL_SCOPES: Record<string, ToolScope> = {
    ...LISTED_TOOL_SCOPES,
    ...Object.fromEntries(CLI_FALLBACK_TOOL_DEFINITIONS.filter(d => d.scope !== undefined).map(d => [d.name, d.scope!])),
};

/** The scopes required to use a tool, all of them; empty if the tool is not scope-gated. */
export function requiredScopesForTool(toolName: string): string[] {
    return toolScopeWords(TOOL_SCOPES[toolName]);
}

/**
 * Whether an agent holding `scopes` may use `toolName`. The wildcard rule is NOT written out here:
 * it is scopeIsCovered() in utils/scope-coverage.ts, the same function requireScope and the agent
 * permission dialog answer to. Ungated tools (no entry in the static or dynamic map) are allowed.
 *
 * This used to be a second copy of the rule, and the copy had lost the exception that matters:
 * memory:write-reserved is deliberately outside every wildcard, because '*' is the one-click Full
 * access template and the reserved keys are the ones the server itself trusts. The copy answered
 * yes to '*', so an agent holding Full access got aimeat_operator_ai_config registered and could
 * raise the owner's daily AI budget, while the same agent posting the same key to /v1/memory was
 * refused RESERVED_KEY. One rule, one place, so the exception cannot be lost again.
 */
export function scopeAllowsTool(scopes: string[], toolName: string): boolean {
    return requiredScopesForTool(toolName).every((word) => scopeIsCovered(scopes, word));
}

// The role-based scope bundles for provisioning agents live in ./scope-profiles.ts.
export { MCP_SCOPE_PROFILES, scopesForProfile } from './scope-profiles.js';
