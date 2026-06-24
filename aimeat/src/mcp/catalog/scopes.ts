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
    aimeat_dm_inbox: 'messages:read',
    aimeat_dm_thread: 'messages:read',
};

/** The scope required to use a tool, or undefined if the tool is not scope-gated. */
export function requiredScopeForTool(toolName: string): string | undefined {
    return TOOL_SCOPES[toolName];
}

/**
 * Whether an agent holding `scopes` may use `toolName`. Wildcard semantics mirror
 * auth/middleware.ts:requireScope — global '*', domain wildcard 'memory:*', and exact match.
 * Ungated tools (no entry in TOOL_SCOPES) are always allowed.
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
    // The personal Secretary's Community scope set: read-heavy, owns its own organism/workspaces,
    // drafts freely, but never spends or reaches outside the owner's boundary on its own. Outbound
    // (messages:send), transactional (work:*), wallet, social-write, consent, and ext lifecycle are
    // the Enterprise-only `secretary-enterprise` superset (see docs/plans/2026-06-23-secretary-feature.md §9).
    secretary: ['memory:read', 'memory:write', 'memory:delete', 'storage:read', 'storage:write', 'messages:read', 'workflow:read'],
    // Specialist agents (Secretary P5 / S-A): a reusable agent type alongside the secretaries, each
    // with its own brain + operating-model policy + scope profile (NOT named "secretary"). The base
    // `specialist` profile mirrors the personal Secretary's Community set (read-heavy, drafts, never
    // spends or reaches outside the owner boundary on its own). Per-role presets stay WITHIN the
    // Community-safe set — every role here is a SUBSET of the `secretary` baseline above. Outbound
    // (messages:send), transactional (work:*), spend (wallet:*), social-write/read, workflow:write and
    // consent are the Enterprise-only `secretary-enterprise` superset (§9) and are NOT granted to a
    // Community specialist by default; the company `ee/` edition unlocks them. A role differs only by
    // narrowing the base (e.g. dropping memory:delete / storage / messages:read), never by widening it.
    // See docs/plans/2026-06-23-secretary-feature.md §9/§19 (S-A) + the 2026-06-24 P5 gap-closure.
    specialist: ['memory:read', 'memory:write', 'memory:delete', 'storage:read', 'storage:write', 'messages:read', 'workflow:read'],
    sdr: ['memory:read', 'memory:write', 'storage:read', 'storage:write', 'messages:read', 'workflow:read'],
    prep: ['memory:read', 'memory:write', 'storage:read', 'storage:write', 'workflow:read'],
    finance: ['memory:read', 'memory:write', 'storage:read', 'workflow:read'],
    recruiter: ['memory:read', 'memory:write', 'storage:read', 'workflow:read'],
    interactive: ['*'],
    autonomous: ['*'],
    workstation: ['*'],
};

/**
 * The specialist roles a `specialist` agent can be provisioned as (Secretary P5 / S-A). Each maps to a
 * scope profile in MCP_SCOPE_PROFILES above; `specialist` is the conservative generic base. New roles
 * only need a profile entry here + a bundle above — no other change.
 */
export const SPECIALIST_ROLES = ['specialist', 'sdr', 'prep', 'finance', 'recruiter'] as const;
export type SpecialistRole = typeof SPECIALIST_ROLES[number];

/** Whether `role` is a known specialist role (falls back to the generic `specialist` when not). */
export function isSpecialistRole(role: string | undefined): role is SpecialistRole {
    return !!role && (SPECIALIST_ROLES as readonly string[]).includes(role);
}

/** Scope bundle for an agent mode/profile; falls back to a conservative read+write memory set. */
export function scopesForProfile(mode: string | undefined): string[] {
    return (mode && MCP_SCOPE_PROFILES[mode]) || ['memory:read', 'memory:write'];
}

/**
 * Plain-language descriptions for the scopes a specialist may REQUEST as extras (the consent vocabulary).
 * Mirrors the app-grant model (routes/app-grants.ts APP_GRANTABLE_SCOPES): a curated, bounded set — never
 * operator/admin/destructive or wildcard scopes. The owner sees these descriptions when consenting to a
 * specialist's requested extras. Bounded by design: a role may only request a scope present in this map.
 */
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
    'social:read': 'Read boards and social posts it can access',
    'social:write': 'Post to boards on your behalf',
    'workflow:write': 'Create and run automations (workflows)',
    'wallet:read': 'See your morsel balance and transactions',
    'messages:send': 'Send direct messages on your behalf across the federation',
    'work:request': 'Request execution of capabilities/actions',
    'consent:manage': 'Propose and manage data-access consent grants',
};

/**
 * The EXTRA scopes each specialist role would like BEYOND the conservative `secretary` baseline. These are
 * NOT granted by default (MCP_SCOPE_PROFILES stays conservative — the P5/G1 least-privilege fix); they are
 * a SEPARATE declaration the owner explicitly consents to at provisioning (mirrors app grants). Every value
 * here MUST be a key of SCOPE_DESCRIPTIONS (bounded vocabulary — no wildcard/admin/dev scopes). A role with
 * no requested extras provisions exactly as before (no consent step).
 */
export const SPECIALIST_REQUESTED_SCOPES: Record<string, string[]> = {
    sdr: ['workflow:write', 'social:read'],
    finance: ['wallet:read'],
    recruiter: ['social:read'],
    // `specialist` (generic) and `prep` request no extras — conservative baseline is enough.
};

/**
 * The requestable EXTRAS for a role: its declared requested scopes MINUS anything already in the
 * conservative `secretary` baseline (only what truly exceeds the default needs consent), intersected with
 * the bounded SCOPE_DESCRIPTIONS vocabulary (defense-in-depth — a role can never request `*`/dev scopes).
 * `also` lets a template specialist declare additional requested scopes on top of its role's.
 */
export function requestedExtras(role: string | undefined, also: string[] = []): string[] {
    const baseline = new Set(scopesForProfile('secretary'));
    const declared = [...(SPECIALIST_REQUESTED_SCOPES[role ?? ''] ?? []), ...also];
    const seen = new Set<string>();
    return declared.filter(s =>
        typeof s === 'string' && s in SCOPE_DESCRIPTIONS && !baseline.has(s) && !seen.has(s) && seen.add(s));
}

/** Annotate scopes with their plain-language consent descriptions (skips unknown/undescribed scopes). */
export function describeScopes(scopes: string[]): Array<{ scope: string; description: string }> {
    return scopes
        .filter(s => s in SCOPE_DESCRIPTIONS)
        .map(s => ({ scope: s, description: SCOPE_DESCRIPTIONS[s] }));
}
