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
    aimeat_agent_mode_set:                    'agent:write',
    aimeat_agent_description_set:             'agent:write',
    aimeat_agent_run_mode_set:                'agent:write',
    aimeat_agent_console_set:                 'agent:write',
    // aimeat_agent_tags_set and aimeat_agent_runtime_report left this list on 2026-10-02 for
    // SCOPE_EXEMPT_TOOLS: an agent's own record needs no word, a sibling's needs agent:write, and the
    // handler checks which (auth/self-or-scope.ts).
    // A crew definition is a memory record in the agent's namespace: reading it is memory:read,
    // and every step toward changing it (validate, try, draft, publish) is memory:write, the scope
    // the REST doors gate the writes on. Validate and try change nothing, but they are only ever
    // steps of a publish, and an agent that may not publish has no business driving a sibling's
    // runtime through them.
    aimeat_crew_get:                          'memory:read',
    aimeat_crew_validate:                     'memory:write',
    aimeat_crew_try:                          'memory:write',
    aimeat_crew_draft:                        'memory:write',
    aimeat_crew_publish:                      'memory:write',
    aimeat_crew_seed:                         'memory:write',
    // The menu is a read of what the runtime offers; the choice is a record in the owner's
    // namespace, so it takes the same word every other record there takes.
    aimeat_crew_menu:                         'memory:read',
    aimeat_crew_llm_set:                      'memory:write',
    aimeat_agent_basics_request:              'memory:write',
    // A proposal IS a memory write — a record under `agents.proposals.` plus a line on the owner's
    // open items — and the same word the sibling ask-route takes. Creating the agent is a different
    // door with a different gate: the owner in person.
    aimeat_agent_propose:                     'memory:write',
    // Rewriting an agent's PERMISSIONS is its own word, and no wildcard carries it. PATCH
    // /v1/agents/:name/scopes is owner-only, and the propose-then-confirm dance here binds the
    // token to the CALLER — so the same agent mints and redeems it in two consecutive calls, and
    // the "show this diff to the owner" text is instruction rather than a gate.
    aimeat_operator_agent_configure:          'agent:permissions',

    // The destructive half: delete an app. Split from write because shipping an update and
    // removing the thing are different risks.
    aimeat_app_delete:                        'app:manage',
    aimeat_package_delete:                    'app:manage',

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
    // The decision provider (TARGET-080): the same money and the same gate as a completion.
    aimeat_decide:                            'ai:use',
    aimeat_decision_list:                     'ai:use',
    aimeat_decision_review:                   'ai:use',
    aimeat_decide_run:                        'ai:use',
    aimeat_decide_settings:                   'ai:use',
    aimeat_decide_rules:                      'ai:use',
    aimeat_decide_rule_propose:               'ai:use',
    aimeat_app_fork:                          'app:write',
    aimeat_app_publish:                       'app:write',
    aimeat_package_publish:                   'app:write',
    aimeat_package_status_set:                'app:write',
    aimeat_package_compose:                   'packages:write',
    aimeat_package_compose_set:               'packages:write',
    aimeat_package_withdraw:                  'packages:write',
    aimeat_package_update:                    'packages:write',
    aimeat_package_fork:                      'packages:write',
    aimeat_package_instance_set:              'packages:write',
    aimeat_package_check_updates:             'packages:write',
    aimeat_package_repository:                'packages:write',
    aimeat_package_entitlements:              'packages:write',
    aimeat_package_config_needs:              'packages:write',
    aimeat_package_sellers:                   'packages:write',
    aimeat_package_offer:                     'packages:write',
    aimeat_package_buy:                       'commerce:buy',
    aimeat_package_pull:                      'packages:write',

    // Installing registers an app, a cortex, an extension and any @activate cron the manifest
    // declares, all under the owner's identity — a write with a long tail, and its own word on the
    // consent screen. Same scope POST /v1/packages/:groupId/install requires.
    aimeat_package_install:                   'packages:write',
    // Reading and deciding the install requests. The same word /v1/package-install-requests asks on
    // all three doors: approving an install is taking part in installing. The words the install itself
    // needs are asked of the approving agent inside the service, not here.
    aimeat_package_install_requests:          'packages:write',

    // A capability is how this account offers work to others, so writing one speaks in the
    // owner's name.
    aimeat_capabilities_create:               'capability:write',
    aimeat_capabilities_delete:               'capability:write',
    aimeat_capabilities_update:               'capability:write',

    // A sharing group IS a consent boundary: who may read what.
    // A sharing group IS the boundary of who reads the owner's memory. POST/PUT/DELETE
    // /v1/sharing-groups are owner-only; here it costs an explicit tick instead of being shut.
    aimeat_group_add_member:                  'consent:groups',
    aimeat_group_create:                      'consent:groups',
    aimeat_group_remove_member:               'consent:groups',

    // A share is the other half, and a separate decision: the group is WHO, the share is WHAT they
    // reach. Assembling an audience and handing it a key space are different acts, and only the
    // second one gives anything away — so it costs its own tick and no wildcard carries it.
    aimeat_share_create:                      'share:manage',
    aimeat_share_revoke:                      'share:manage',

    // Removes a stored record.
    // Removes a record for good, no grace window: its own word since 2026-10-02, held on the
    // task-start floor (services/agent-task-rules.ts). memory:delete stays the undoable delete.
    aimeat_workspace_object_delete:           'memory:purge',

  // Workspace ROW spaces. `organism:write` rather than `memory:write`, because these rows are NOT
    // memory records: they live in their own table, are charged to the organism rather than to the
    // member, and are governed by workspace membership. The word also matches what the REST routes
    // enforce for the same capability — a tool gated on one word while its route enforces another is
    // the drift invariant 15 exists for.
    aimeat_workspace_rows_append:             'organism:write',
    // Removes rows for good: memory:purge since 2026-10-02, held on the task-start floor. The
    // handler also asks organism:write, as the REST DELETE routes do (mcp/workspace-rows.ts).
    aimeat_workspace_rows_delete:             'memory:purge',

    // These write memory records underneath, whatever the tool is called: a workspace
    // document, a skill manifest, a schedule report, a knowledge contribution.
    aimeat_knowledge_contribute:              'memory:write',
    aimeat_schedule_delete:                   'memory:write',
    aimeat_schedule_report_internal:          'memory:write',
    aimeat_skill_link:                        'memory:write',
    aimeat_skill_publish:                     'memory:write',
    aimeat_skill_unlink:                      'memory:write',
    aimeat_skill_update:                      'memory:write',
    aimeat_workspace_publish:                 'memory:write',
    aimeat_workspace_revert_to_draft:         'memory:write',
    aimeat_workspace_write:                   'memory:write',
    // The in-place document edits write the SAME record aimeat_workspace_write writes — a workspace
    // draft — so they answer to the same word, and their REST routes enforce that word and not the
    // organism:write their neighbours on that router use.
    aimeat_workspace_doc_append:              'memory:write',
    aimeat_workspace_doc_section_replace:     'memory:write',

    // Writes keys the server itself trusts (openrouter.*, ai-usage.*, profile.*).
    aimeat_operator_ai_config:                'memory:write-reserved',

    // Changes WHO ELSE can read the owner's knowledge. A different promise than changing
    // the knowledge, which is why it is not organism:write.
    aimeat_organism_invitation_cancel:        'organism:invite',
    aimeat_organism_invitation_email_cancel:  'organism:invite',
    aimeat_organism_invitation_update:        'organism:invite',
    aimeat_organism_invite:                   'organism:invite',
    aimeat_organism_invite_email:             'organism:invite',
    aimeat_organism_member_add:               'organism:invite',
    aimeat_organism_member_remove:            'organism:invite',
    aimeat_organism_owner_add:                'organism:invite',
    aimeat_organism_owner_remove:             'organism:invite',
    aimeat_workspace_access:                  'organism:invite',
    aimeat_workspace_member_grant:            'organism:invite',
    aimeat_workspace_member_revoke:           'organism:invite',

    // Create a workspace, write and publish in one, comment, transfer.
    aimeat_organism_archive:                  'organism:write',
    aimeat_organism_create:                   'organism:write',
    aimeat_organism_import:                   'organism:write',
    aimeat_organism_leave:                    'organism:write',
    aimeat_organism_update:                   'organism:write',
    aimeat_workspace_comment:                 'organism:write',
    aimeat_workspace_comment_delete:          'organism:write',
    aimeat_workspace_create:                  'organism:write',
    aimeat_workspace_transfer:                'organism:write',
    aimeat_workspace_update:                  'organism:write',
    // A member's change to a workspace and the decision on a member's suggestion: the word their
    // REST doors ask (POST …/workspace/spaces, PUT …/workspace/sections/:space, POST …/suggestions/:sid).
    aimeat_workspace_space_add:               'organism:write',
    aimeat_workspace_sections_set:            'organism:write',
    aimeat_workspace_suggestions:             'organism:write',

    // The operator tools: organism break-glass and operator:admin (scopes-operator.ts).
    ...OPERATOR_TOOL_SCOPES,

    // Writes something other people see under the owner's name.
    aimeat_flag_report:                       'social:write',
    aimeat_organism_join:                     'social:write',

    // Arranging the node's pages. The word is one no wildcard carries, because what it changes is
    // what everyone sees on arrival. The read takes the same word: it carries the block vocabulary
    // the write needs, and it was open to every agent of the operator on the account role alone.
    aimeat_surface_layout_get:                'site:layout-write',
    aimeat_surface_layout_set:                'site:layout-write',
    // Making the node's themes: the look of every page. The same kind of word as the layout's, no
    // wildcard carries it, and the handler also asks whether the account runs this node.
    aimeat_theme_save:                        'site:theme-write',
    aimeat_theme_style_save:                  'site:theme-write',
    aimeat_theme_component_css_set:           'site:theme-write',
    aimeat_theme_policy_set:                  'site:theme-write',
    aimeat_theme_font_save:                   'site:theme-write',
    aimeat_storage_upload:                    'storage:write',
    aimeat_storage_delete:                    'storage:write',

    // Publishing a data package writes BYTES and a catalogue entry. storage:write is the one that
    // matters — the catalogue is a projection of what was stored, and a package with bytes and no
    // listing is a package; a listing with no bytes is not.
    aimeat_datapackage_publish:               'storage:write',
    aimeat_datapackage_export:                'storage:read',

    // Creates work that will run.
    aimeat_schedule_create:                   'task:write',
    // Running a schedule now creates the same work its cron would, only sooner.
    aimeat_schedule_trigger:                  'task:write',
    aimeat_task_create:                       'task:write',
    // Starts work that was waiting for the owner's OK, on the owner's word.
    aimeat_task_start:                        'task:write',
    // Changes whether an agent's work starts without asking: the agent:write word, like its mode.
    aimeat_agent_task_start_set:              'agent:write',
    // Takes an agent's * away for the words it used: changing a sibling's permissions, the word
    // POST /v1/agents/:name/scope-narrowing asks too.
    aimeat_agent_scope_narrow:                'agent:permissions',

    // Asks somebody else to do work, which can cost.
    aimeat_capabilities_invoke:               'work:request',

    // Changes something that runs on its own afterwards.
    aimeat_schedule_update:                   'workflow:write',
    aimeat_workflow_answer:                   'workflow:write',

    // Memory (GET /v1/memory/:key → memory:read; POST/PUT → memory:write)
    aimeat_memory_read: 'memory:read',
    aimeat_memory_list: 'memory:read',
    aimeat_memory_search: 'memory:read',
    aimeat_memory_read_public: 'memory:read',
    aimeat_memory_write: 'memory:write',
    // `memory:delete` finally reaches a tool. It was a scope an owner could grant that no tool
    // anywhere asked for, so granting it did nothing for an agent using tools.
    aimeat_memory_delete: 'memory:delete',
    // RESTORE IS A WRITE, not a delete. Putting a record back into the working set is making it
    // exist again, and an agent trusted to remove things is not automatically trusted to make
    // them reappear under a name someone else may now be using.
    aimeat_memory_restore: 'memory:write',

    // NOTE on `provenance:write` (TARGET-058): it deliberately has NO entry in this map, because it
    // does not gate a TOOL — it gates one optional PARAMETER (`ai_provenance`) on nine of them.
    // Listing a tool here would hide the whole tool from an agent that merely cannot assert how its
    // content was made, when the honest default (the node records what it observed) is available to
    // everyone and needs no permission at all. The check lives at the one place that mints from a
    // declaration, services/ai-provenance.ts:provenanceForWrite, and mirrors requireScope() exactly
    // — so this parameter and POST /v1/provenance cannot answer differently.

    // AppDev pitfall KB (learned entries are memory records under packages/appdev-pitfalls/).
    // Delete gates on memory:write (not memory:delete) deliberately: it only removes the owner's
    // OWN KB entries, report can already overwrite them, and no scope profile grants memory:delete
    // — a stricter gate would just dead-end the tool for every appdev-profile agent.
    aimeat_appdev_pitfall_report: 'memory:write',
    aimeat_appdev_pitfall_delete: 'memory:write',
    // Template proposals are owner-GHII memory records; same reasoning as above.
    aimeat_app_template_propose: 'memory:write',
    aimeat_app_template_delete: 'memory:write',
    aimeat_appdev_proof_attach: 'memory:write',

    // Boards / social (mutations → social:write; subscribe → social:read).
    // NOTE: aimeat_board_read / aimeat_board_list are intentionally NOT gated — the REST
    // GET /v1/boards/:id/posts route is public, so gating them on MCP would be stricter than REST.
    aimeat_board_create: 'social:write',
    aimeat_board_post: 'social:write',
    aimeat_board_reply: 'social:write',
    aimeat_board_react: 'social:write',
    aimeat_board_delete: 'social:write',
    // PATCH /v1/boards/:id/rules asks social:write, and so does the tool that is that door.
    aimeat_board_rules_set: 'social:write',
    // Who may READ a shared board, which is a different promise from posting to one. The HTTP
    // route rejects every agent session outright ("even operator agents must use their owner
    // session"); this door stays open and costs its own tick.
    aimeat_board_members: 'social:members',
    aimeat_board_subscribe: 'social:read',

    // Wallet (GET /v1/wallet, /v1/wallet/transactions → wallet:read)
    aimeat_wallet_balance: 'wallet:read',
    aimeat_wallet_transactions: 'wallet:read',
    // Usage reports (GET /v1/usage/summary → wallet:read). The same word as the route it calls,
    // because the tool IS that door: a permission enforced on one surface and not the other is a
    // permission the owner was told they had.
    aimeat_usage_report: 'wallet:read',

    // Work queue (inbox → work:read; accept/deliver → work:accept; request execution → work:request)
    aimeat_work_inbox: 'work:read',
    aimeat_work_accept: 'work:accept',
    aimeat_work_deliver: 'work:accept',
    aimeat_action_execute: 'work:request',

    // Consent (POST/GET/DELETE /v1/consent* → consent:manage)
    aimeat_consent_grant: 'consent:manage',
    aimeat_consent_list: 'consent:manage',
    aimeat_consent_revoke: 'consent:manage',
    // The Access page's read (GET /v1/access/overview → owner, or account:security). Every key to the
    // account in one answer, so the word that opens it is the one no wildcard carries.
    aimeat_access_list: 'account:security',

    // The owner's secrets vault (GET/PUT/DELETE /v1/secrets* → secrets:manage). The same word as
    // the routes, because the tools ARE those doors: a permission enforced on one surface and not
    // the other is a permission the owner was told they had (invariant 15). One word for all three:
    // the list is names and dates, and an agent that could read a name and not set it has nothing
    // it can act on. No wildcard carries it (utils/scope-coverage.ts).
    aimeat_secret_list: 'secrets:manage',
    aimeat_secret_set: 'secrets:manage',
    aimeat_secret_delete: 'secrets:manage',

    // Agent Workflows (REST: PUT/run → workflow:write; GET → workflow:read)
    aimeat_workflow_save: 'workflow:write',
    aimeat_workflow_run: 'workflow:write',
    aimeat_workflow_get: 'workflow:read',

    // Federated direct messages / inbox (REST: POST /v1/messages → messages:send). Distinct from the
    // agent-dashboard aimeat_message_* tools, which are not scope-gated (agent↔own-owner only).
    aimeat_dm_send: 'messages:send',
    aimeat_dm_broadcast: 'messages:send',
    aimeat_dm_ask: 'messages:send',
    // Delegated "reply as me": send a federated DM AS THE OWNER. Its own scope so the owner grants it
    // deliberately (it is part of the full '*' bundle; granular agents opt in separately). The sender is
    // still derived server-side from the agent's owner, so the scope never enables cross-owner sends.
    aimeat_dm_send_as_owner: 'messages:send-as-owner',
    // Removing one message from the owner's mailbox, as the owner. A word of its own rather than
    // send-as-owner: that one is already granted and is what "Reply with AI" runs on, so reusing it
    // would hand every agent holding it the power to destroy the owner's correspondence with nobody
    // asked. NOT part of the '*' bundle either (utils/scope-coverage.ts) -- it costs its own tick.
    aimeat_dm_delete_as_owner: 'messages:delete-as-owner',
    // Reading the owner's own mailbox, as the owner. `messages:read` on an agent is the agent's own
    // messages (aimeat_dm_inbox below), so this is its own word, and NOT part of the '*' bundle: a
    // read leaves nothing behind for the owner to see. Same doors as REST (GET /v1/messages/overview
    // and /conversations/:id) through services/owner-mailbox-reads.ts.
    aimeat_dm_inbox_as_owner: 'messages:read-as-owner',
    aimeat_dm_thread_as_owner: 'messages:read-as-owner',
    // Organising the owner's Messages list: archiving and restoring conversations, and the rules that
    // fold, group or archive them. Its own word, NOT part of the '*' bundle: archiving deletes nothing
    // but is how a message stops being seen. Same doors as REST (GET/PUT /v1/messages/organize and
    // POST /v1/messages/organize/archive) through services/inbox-organize/record.ts.
    aimeat_dm_archive_as_owner: 'messages:organize-as-owner',
    aimeat_dm_organize_as_owner: 'messages:organize-as-owner',
    aimeat_notify: 'notifications:send',
    aimeat_dm_inbox: 'messages:read',
    aimeat_dm_thread: 'messages:read',

    // Agent v2 messaging. Same words as the doors behind them, and the same words the DM tools take:
    // sending on this account's behalf is one permission however the turn is shaped. Registering a
    // delivery target rides agent:write, not a messaging word, because it configures a PRINCIPAL and
    // what it configures is where this node makes an outbound call carrying a secret — the same
    // class of act as setting an agent's webhook.
    aimeat_v2_message_send: 'messages:send',
    aimeat_v2_message_list: 'messages:read',
    aimeat_v2_push_set: 'agent:write',
    aimeat_v2_push_list: 'messages:read',
    aimeat_v2_push_delete: 'agent:write',

    // Agent v2 tasks ride task:write, the word the existing task routes take. Creating work,
    // reporting on it and cancelling it are one authority over work on this account; the reads are
    // ungated for the same reason the existing task reads are.
    aimeat_v2_task_create: 'task:write',
    aimeat_v2_task_status: 'task:write',
    aimeat_v2_task_cancel: 'task:write',

    // Listing the book has its own word since 2026-10-01: contacts:read, the word GET /v1/contacts
    // asks, which the tool calls. The conversation fields on each row stay empty unless the caller
    // may also read the owner's mailbox (messages:read-as-owner for an agent).
    aimeat_contact_list: 'contacts:read',
    aimeat_contact_resolve_email: 'messages:read',
    aimeat_contact_add: 'messages:send',
    aimeat_contact_remove: 'messages:send',
    aimeat_contact_invite: 'messages:send',

    // Remote MCP servers. The same three-way split as connections above, and for the same reason:
    // knowing WHICH servers are attached, calling a tool THROUGH one, and attaching another are
    // three different favours. `mcp:manage` is additionally outside every wildcard
    // (utils/scope-coverage.ts), because pointing somebody's account at a server of the agent's own
    // choosing, and storing a credential there, is a human act and not something "Full access"
    // should carry.
    aimeat_mcp_list: 'mcp:read',
    // Reading a server's tool list is `mcp:read` and not `mcp:use`: knowing that a tool called
    // create_issue exists gives nobody the ability to create an issue. The gate that matters is on
    // the CALL, which is the same reasoning the node's own capability source states for itself.
    aimeat_mcp_tools: 'mcp:read',
    aimeat_mcp_call: 'mcp:use',
    aimeat_mcp_attach: 'mcp:manage',
    aimeat_mcp_update: 'mcp:manage',
    aimeat_mcp_authorize: 'mcp:manage',
    // The LIST is mcp:read: knowing which agent was narrowed to what is knowing what you have,
    // and an app showing a person their own permissions must not need the word that CHANGES them.
    // aimeat_mcp_registry_list / _set ride operator:admin, with the rest of node administration.
    aimeat_mcp_grant_list: 'mcp:read',
    aimeat_mcp_grant_set: 'mcp:manage',
    aimeat_mcp_grant_revoke: 'mcp:manage',
    aimeat_mcp_detach: 'mcp:manage',

    // Commerce (TARGET-033/034 over MCP). NOTE: the REST commerce routes are requireAuth-only
    // today — these MCP tools are gated STRICTER than REST on purpose (selling config touches
    // PSP secrets; buying spends the owner's balance). commerce:sell = seller-side config (PSP,
    // app-tool manifests, offer pricing); commerce:buy = spending through checkout sessions.
    // Owner-attached '*' agents get both; granular agents opt in per scope.
    // The seller's payment credentials: an agent that can rewrite these can repoint the payouts.
    // PUT/DELETE /v1/commerce/payout/stripe are owner-only.
    aimeat_commerce_psp_set: 'commerce:psp',
    aimeat_commerce_psp_status: 'commerce:sell',
    aimeat_commerce_psp_delete: 'commerce:psp',
    aimeat_app_tools_publish: 'commerce:sell',
    aimeat_offer_price_set: 'commerce:sell',
    // aimeat_app_tools_get is intentionally ungated — it reads PUBLIC manifests (own always).
    // Beneficiary splitting. Declaring who shares your revenue, and paying one of them, both move
    // value out of the owner's own pocket, so they sit with the rest of the seller-side config.
    // READING what you are owed is a wallet question, not a selling one: a beneficiary is usually
    // not a seller at all, and gating their own receivables behind commerce:sell would mean an
    // account could be owed money it had no way to see.
    // The word REST asks for on the same four operations (routes/commerce-beneficiaries.ts:187,
    // :250, :314, :444). They used to ask for commerce:sell here — not stricter or looser, simply a
    // different gate, so an owner who withheld exchange:beneficiary still had an agent that could
    // give their revenue away, and an agent granted exchange:beneficiary could not see the tools.
    // services/scope-vocabulary-migration.ts hands the word to agents already holding commerce:sell,
    // so nothing loses a tool it had and nothing gains one it did not.
    aimeat_commerce_beneficiary_split_set: 'exchange:beneficiary',
    aimeat_commerce_beneficiary_splits: 'exchange:beneficiary',
    aimeat_commerce_beneficiary_release: 'exchange:beneficiary',
    // Paying moves value out of the owner's own wallet, so it sits with the seller-side config
    // rather than with the reads.
    // POST /v1/commerce/beneficiary/payout asks for exchange:beneficiary (:444); the quote GET asks
    // for wallet:read (:411). One tool covers both, so it takes the write word — a caller who may
    // only read a quote can use the earnings tool, which is already gated on wallet:read.
    aimeat_commerce_beneficiary_payout: 'exchange:beneficiary',
    aimeat_commerce_beneficiary_earnings: 'wallet:read',
    // The approval gate is operator-only at the handler; the scope keeps a narrow agent from even
    // seeing the tool, so it is not offered to somebody who could never use it.
    // This one tool covers BOTH halves: reading an approval state and recording one. REST splits
    // them (GET wants wallet:read, POST wants the operator role), so the registration gate stays on
    // the read word and the write word is checked inside the handler on the write branch only.
    // Gating the whole tool on the write word would have made an account unable to see whether it
    // may be paid, which is not the thing anyone meant to restrict.
    aimeat_commerce_beneficiary_approve: 'wallet:read',

    aimeat_checkout_open: 'commerce:buy',
    aimeat_checkout_complete: 'commerce:buy',
    aimeat_checkout_list: 'commerce:buy',

    // EXCHANGE marketplace (TARGET-045 over MCP). Like commerce, the REST /v1/exchange routes are
    // requireAuth-only today — these MCP tools are gated STRICTER on purpose: accepting/bidding mints
    // durable metered entitlements that authorise (charged) spend on the owner's balance. exchange:read
    // = browse/detail/needs/contracts/lineage; exchange:write = accept/off/post/bid/bid-accept.
    // Owner-attached '*' agents get both; granular agents opt in per scope.
    aimeat_exchange_offerings: 'exchange:read',
    aimeat_exchange_offering_get: 'exchange:read',
    aimeat_exchange_contracts: 'exchange:read',
    aimeat_exchange_needs: 'exchange:read',
    aimeat_exchange_consumers: 'exchange:read',
    aimeat_exchange_accept: 'exchange:write',
    aimeat_exchange_contract_off: 'exchange:write',
    aimeat_exchange_need_post: 'exchange:write',
    aimeat_exchange_bid: 'exchange:write',
    aimeat_exchange_bid_accept: 'exchange:write',
    // Act-on-exchange (invoke/work/proposals): read = list; write = invoke/start/deliver/decide (spends or changes a contract).
    aimeat_exchange_work_list: 'exchange:read',
    aimeat_exchange_proposals: 'exchange:read',
    aimeat_app_tool_invoke: 'exchange:write',
    aimeat_exchange_work: 'exchange:write',
    aimeat_exchange_work_deliver: 'exchange:write',
    aimeat_exchange_proposal_decide: 'exchange:write',
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
