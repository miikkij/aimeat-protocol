/**
 * @file scopes.ts
 * @description F1 scope enforcement metadata for the MCP tool surface. Maps each scope-gated tool
 *   to the scope its REST counterpart already requires (auth/middleware.ts requireScope), so the
 *   public /v1/mcp surface enforces the SAME least-privilege rules as REST — closing the hole where
 *   /v1/mcp registered every tool for every agent regardless of granted scopes.
 *
 *   Only tools whose REST route is genuinely scope-gated appear in TOOL_SCOPES. Tools omitted here
 *   (tasks, apps, extensions, cortex, organisms, knowledge, instances, groups, capabilities, flags,
 *   storage, catalogue, board reads, onboarding, handbook, agent self-report, messages) are NOT
 *   scope-gated in REST either, so leaving them ungated keeps MCP consistent with REST. Admin tools
 *   are omitted because they self-gate via a runtime operator check.
 * @structure
 *   - TOOL_SCOPES — tool name -> required scope (mirrors REST requireScope gates)
 *   - scopeAllowsTool() — wildcard-aware check (exact / domain:* / global *), mirroring middleware
 *   - MCP_SCOPE_PROFILES / scopesForProfile() — role-based scope bundles for agent provisioning
 * @usage
 *   import { scopeAllowsTool } from '../catalog/scopes.js';
 *   if (scopeAllowsTool(agentScopes, 'aimeat_memory_write')) mcp.tool(...)
 * @version-history
 *   v1.x — 2026-08-08 — aimeat_company_* ride company:read / company:write.
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

/**
 * Tool -> required scope, mirroring the REST requireScope() gate for the SAME operation.
 * Verified against src/routes/{memory,boards,wallet,work,actions,consent}.ts.
 */
/**
 * Tools that change state and deliberately need no scope, each with the reason. The gate in
 * scripts/audit-mcp-tools.ts fails on any mutating tool that is in neither TOOL_SCOPES nor this set,
 * so "this needs no scope" becomes a decision someone wrote down rather than the default that
 * silence produces. Before the August 2026 audit, 73 mutating tools sat in that silence, and
 * scopeAllowsTool() reads a missing entry as permission.
 *
 * Seeded 2026-08-10 with the tools that were unmapped at that moment. An entry here is a promise to
 * come back to it: the set may shrink, and every removal is either a real scope or a real refusal.
 */
export const SCOPE_EXEMPT_TOOLS = new Set<string>([
    'aimeat_admin_mint',
    'aimeat_agent_capabilities_report',
    'aimeat_agent_mode_set',
    'aimeat_agent_tags_set',
    'aimeat_agent_telemetry_report',
    'aimeat_app_delete',
    'aimeat_app_draft_discard',
    'aimeat_app_draft_publish',
    'aimeat_app_draft_save',
    'aimeat_app_fork',
    'aimeat_app_publish',
    'aimeat_capabilities_create',
    'aimeat_capabilities_delete',
    'aimeat_capabilities_invoke',
    'aimeat_capabilities_update',
    'aimeat_capabilities_vouch',
    'aimeat_extension_install',
    'aimeat_extension_invoke',
    'aimeat_feedback_send',
    'aimeat_flag_report',
    'aimeat_group_add_member',
    'aimeat_group_create',
    'aimeat_group_remove_member',
    'aimeat_instance_create',
    'aimeat_knowledge_contribute',
    'aimeat_message_send',
    'aimeat_onboarding_confirm_directives_read',
    'aimeat_onboarding_confirm_skill_installed',
    'aimeat_onboarding_declare_services',
    'aimeat_onboarding_identify_platform',
    'aimeat_operator_agent_configure',
    'aimeat_operator_ai_config',
    'aimeat_organism_archive',
    'aimeat_organism_create',
    'aimeat_organism_import',
    'aimeat_organism_invitation_cancel',
    'aimeat_organism_invitation_email_cancel',
    'aimeat_organism_invitation_respond',
    'aimeat_organism_invitation_update',
    'aimeat_organism_invite',
    'aimeat_organism_invite_email',
    'aimeat_organism_join',
    'aimeat_organism_leave',
    'aimeat_organism_member_add',
    'aimeat_organism_update',
    'aimeat_portfolio_publish',
    'aimeat_schedule_create',
    'aimeat_schedule_delete',
    'aimeat_schedule_report_internal',
    'aimeat_schedule_update',
    'aimeat_skill_link',
    'aimeat_skill_publish',
    'aimeat_skill_unlink',
    'aimeat_storage_upload',
    'aimeat_task_complete',
    'aimeat_task_create',
    'aimeat_task_event',
    'aimeat_task_fail',
    'aimeat_task_propose_todos',
    'aimeat_task_request_changes',
    'aimeat_task_todo',
    'aimeat_workflow_answer',
    'aimeat_workspace_access',
    'aimeat_workspace_comment',
    'aimeat_workspace_create',
    'aimeat_workspace_member_grant',
    'aimeat_workspace_member_revoke',
    'aimeat_workspace_object_delete',
    'aimeat_workspace_publish',
    'aimeat_workspace_revert_to_draft',
    'aimeat_workspace_transfer',
    'aimeat_workspace_update',
    'aimeat_workspace_write',
]);

export const TOOL_SCOPES: Record<string, string> = {
    // Memory (GET /v1/memory/:key → memory:read; POST/PUT → memory:write)
    aimeat_memory_read: 'memory:read',
    aimeat_memory_list: 'memory:read',
    aimeat_memory_search: 'memory:read',
    aimeat_memory_read_public: 'memory:read',
    aimeat_memory_write: 'memory:write',

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
    aimeat_board_members: 'social:write',
    aimeat_board_subscribe: 'social:read',

    // Wallet (GET /v1/wallet, /v1/wallet/transactions → wallet:read)
    aimeat_wallet_balance: 'wallet:read',
    aimeat_wallet_transactions: 'wallet:read',

    // Work queue (inbox → work:read; accept/deliver → work:accept; request execution → work:request)
    aimeat_work_inbox: 'work:read',
    aimeat_work_accept: 'work:accept',
    aimeat_work_deliver: 'work:accept',
    aimeat_action_execute: 'work:request',

    // Consent (POST/GET/DELETE /v1/consent* → consent:manage)
    aimeat_consent_grant: 'consent:manage',
    aimeat_consent_list: 'consent:manage',
    aimeat_consent_revoke: 'consent:manage',

    // Cortex management (POST/PUT/DELETE /v1/cortex* → cortex:write; PUT is the idempotent upsert)
    // List/get are NOT gated (mirrors REST: GET /v1/cortex is just requireAuth).
    aimeat_cortex_install: 'cortex:write',
    aimeat_cortex_activate: 'cortex:write',
    aimeat_cortex_deactivate: 'cortex:write',
    aimeat_cortex_delete: 'cortex:write',

    // Extension lifecycle (POST /v1/extensions/:name/activate etc. → ext:write)
    // Install is NOT gated (mirrors REST: POST /v1/extensions is just requireAuth — agents
    // can push code, but it stays inert until ext:write activates it).
    aimeat_extension_activate: 'ext:write',
    aimeat_extension_deactivate: 'ext:write',
    aimeat_extension_delete: 'ext:write',

    // Agent Workflows (REST: PUT/run → workflow:write; GET → workflow:read)
    aimeat_workflow_save: 'workflow:write',
    aimeat_workflow_run: 'workflow:write',
    aimeat_workflow_get: 'workflow:read',

    // Federated direct messages / inbox (REST: POST /v1/messages → messages:send). Distinct from the
    // agent-dashboard aimeat_message_* tools, which are not scope-gated (agent↔own-owner only).
    aimeat_dm_send: 'messages:send',
    aimeat_dm_ask: 'messages:send',
    // Delegated "reply as me": send a federated DM AS THE OWNER. Its own scope so the owner grants it
    // deliberately (it is part of the full '*' bundle; granular agents opt in separately). The sender is
    // still derived server-side from the agent's owner, so the scope never enables cross-owner sends.
    aimeat_dm_send_as_owner: 'messages:send-as-owner',
    aimeat_dm_inbox: 'messages:read',
    aimeat_dm_thread: 'messages:read',

    // Contacts (address book) — the owner's messaging graph, so the messaging scopes gate it:
    // reading the list / resolving an email rides messages:read; editing the book (save/remove)
    // rides messages:send (the same trust level as opening conversations on the owner's behalf).
    // The company registry: reading the owner's companies rides company:read; registering one,
    // filling in its legal identity, choosing its front page and publishing its page all write
    // to a PUBLIC address, so they ride company:write.
    aimeat_company_list: 'company:read',
    aimeat_company_create: 'company:write',
    aimeat_company_update: 'company:write',
    aimeat_company_front_page: 'company:write',
    aimeat_company_portfolio_publish: 'company:write',

    aimeat_contact_list: 'messages:read',
    aimeat_contact_resolve_email: 'messages:read',
    aimeat_contact_add: 'messages:send',
    aimeat_contact_remove: 'messages:send',

    // Commerce (TARGET-033/034 over MCP). NOTE: the REST commerce routes are requireAuth-only
    // today — these MCP tools are gated STRICTER than REST on purpose (selling config touches
    // PSP secrets; buying spends the owner's balance). commerce:sell = seller-side config (PSP,
    // app-tool manifests, offer pricing); commerce:buy = spending through checkout sessions.
    // Owner-attached '*' agents get both; granular agents opt in per scope.
    aimeat_commerce_psp_set: 'commerce:sell',
    aimeat_commerce_psp_status: 'commerce:sell',
    aimeat_commerce_psp_delete: 'commerce:sell',
    aimeat_app_tools_publish: 'commerce:sell',
    aimeat_offer_price_set: 'commerce:sell',
    // aimeat_app_tools_get is intentionally ungated — it reads PUBLIC manifests (own always).
    // Beneficiary splitting. Declaring who shares your revenue, and paying one of them, both move
    // value out of the owner's own pocket, so they sit with the rest of the seller-side config.
    // READING what you are owed is a wallet question, not a selling one: a beneficiary is usually
    // not a seller at all, and gating their own receivables behind commerce:sell would mean an
    // account could be owed money it had no way to see.
    aimeat_commerce_beneficiary_split_set: 'commerce:sell',
    aimeat_commerce_beneficiary_splits: 'commerce:sell',
    aimeat_commerce_beneficiary_release: 'commerce:sell',
    // Paying moves value out of the owner's own wallet, so it sits with the seller-side config
    // rather than with the reads.
    aimeat_commerce_beneficiary_payout: 'commerce:sell',
    aimeat_commerce_beneficiary_earnings: 'wallet:read',
    // The approval gate is operator-only at the handler; the scope keeps a narrow agent from even
    // seeing the tool, so it is not offered to somebody who could never use it.
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

/** The scope required to use a tool, or undefined if the tool is not scope-gated. */
export function requiredScopeForTool(toolName: string): string | undefined {
    return TOOL_SCOPES[toolName];
}

/**
 * Whether an agent holding `scopes` may use `toolName`. Wildcard semantics mirror
 * auth/middleware.ts:requireScope — global '*', domain wildcard 'memory:*', and exact match.
 * Ungated tools (no entry in the static or dynamic map) are always allowed.
 */
export function scopeAllowsTool(scopes: string[], toolName: string): boolean {
    const required = TOOL_SCOPES[toolName];
    if (!required) return true;
    if (scopes.includes('*')) return true;
    if (scopes.includes(required)) return true;
    const domain = required.split(':')[0];
    return scopes.includes(`${domain}:*`);
}

/**
 * Role-based scope bundles for provisioning agents (e.g. at device-auth approval). Maps the
 * existing AgentRecord.mode values to sensible defaults drawn from the scope vocabulary the node
 * actually enforces today (memory / social / wallet / work / consent). As new scope domains are
 * added (e.g. task:*, app:*), extend these bundles. 'interactive'/'autonomous'/'workstation' are
 * broad because they front owner-attached, human-in-the-loop use (e.g. Claude Desktop, VSCode);
 * 'task-runner' is minimal.
 */
export const MCP_SCOPE_PROFILES: Record<string, string[]> = {
    'task-runner': ['memory:read', 'memory:write', 'work:read', 'work:accept'],
    coordinator: ['memory:read', 'memory:write', 'social:read', 'social:write', 'messages:send', 'messages:read', 'work:read', 'work:request', 'workflow:read', 'workflow:write'],
    appdev: ['memory:read', 'memory:write'],
    'organism-knowledge': ['memory:read', 'memory:write', 'social:read'],
    interactive: ['*'],
    autonomous: ['*'],
    workstation: ['*'],
};

/** Scope bundle for an agent mode/profile; falls back to a conservative read+write memory set. */
export function scopesForProfile(mode: string | undefined): string[] {
    return (mode && MCP_SCOPE_PROFILES[mode]) || ['memory:read', 'memory:write'];
}
