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
export const TOOL_SCOPES: Record<string, string> = {
    // Memory (GET /v1/memory/:key → memory:read; POST/PUT → memory:write)
    aimeat_memory_read: 'memory:read',
    aimeat_memory_list: 'memory:read',
    aimeat_memory_search: 'memory:read',
    aimeat_memory_read_public: 'memory:read',
    aimeat_memory_write: 'memory:write',

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
    aimeat_checkout_open: 'commerce:buy',
    aimeat_checkout_complete: 'commerce:buy',
    aimeat_checkout_list: 'commerce:buy',
};

/**
 * Dynamic tool→scope entries contributed at boot by the active edition (EnterpriseProvider
 * getMcpTools → mcp/enterprise-tools.ts). Kept SEPARATE from the static core map: core entries
 * always win on a name collision, so a module can never relax a core gate.
 */
let DYNAMIC_TOOL_SCOPES: Record<string, string> = {};
export function setDynamicToolScopes(map: Record<string, string>): void {
    DYNAMIC_TOOL_SCOPES = { ...map };
}

/** The scope required to use a tool, or undefined if the tool is not scope-gated. */
export function requiredScopeForTool(toolName: string): string | undefined {
    return TOOL_SCOPES[toolName] ?? DYNAMIC_TOOL_SCOPES[toolName];
}

/**
 * Whether an agent holding `scopes` may use `toolName`. Wildcard semantics mirror
 * auth/middleware.ts:requireScope — global '*', domain wildcard 'memory:*', and exact match.
 * Ungated tools (no entry in the static or dynamic map) are always allowed.
 */
export function scopeAllowsTool(scopes: string[], toolName: string): boolean {
    const required = TOOL_SCOPES[toolName] ?? DYNAMIC_TOOL_SCOPES[toolName];
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
