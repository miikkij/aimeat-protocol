/**
 * @file src/data/openapi-body-modes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two modes of middleware/openapi-body-guard.ts and the routes it leaves observed in
 *   enforce mode.
 *
 *   THE MODES. The node setting security.request_body_check (AIMEAT_REQUEST_BODY_CHECK, config/
 *   security.ts) picks one, and the guard reads it on every request, so an operator's change on the
 *   Config tab or through aimeat_admin_config_set applies at once, without a restart:
 *   - enforce (the default): every contract operation with an `application/json` body schema is
 *     enforced. A body that does not match is answered 400 VALIDATION_ERROR with the field named,
 *     just before the route's handler runs and after the route's own middleware, for a caller with a
 *     session; a caller the route's middleware refuses, or one without a session, gets the route's
 *     own answer, as before. The routes in EXEMPT_BODY_ROUTES are observed instead.
 *   - observe: every route is observed: a mismatch is logged and counted, and the request is
 *     answered as before. It is the way back when a working client turns out to send a body the
 *     contract does not describe.
 *
 *   AN EXEMPT ENTRY is the method and the contract's own path template, as openapi.yaml writes it
 *   (`PATCH /v1/agents/{name}/scopes`), with the reason. `pnpm check:write-validation` refuses an entry
 *   the contract has no JSON body schema for, or that no route in src/routes/ declares, because it
 *   would exempt nothing.
 * @structure BODY_CHECK_MODES · BodyCheckMode · DEFAULT_BODY_CHECK_MODE · bodyCheckModeFrom(raw) ·
 *   ExemptBodyRoute · EXEMPT_BODY_ROUTES
 * @usage import { EXEMPT_BODY_ROUTES, bodyCheckModeFrom } from '../data/openapi-body-modes.js';
 * @version-history
 *   v2.2.0 — 2026-11-15 — Every exempt route validates its body itself and stays observed for good.
 *     The three whose test expected only a middleware refusal leave the list, because the guard now
 *     refuses after the route's middleware; twelve routes with their own refusal and the welcome mat,
 *     whose handler counts a failed paste, join it (structure programme 2026-11, unit 1).
 *   v2.1.0 — 2026-11-14 — The exempt routes: every route an existing E2E test expects to answer a
 *     wrong body with its own refusal, until the developer decides (structure programme 2026-11, unit 1).
 *   v2.0.0 — 2026-11-14 — The per-route list of enforced routes is replaced by the node setting
 *     security.request_body_check (enforce by default) and the list of exempt routes (structure
 *     programme 2026-11, unit 1).
 *   v1.0.0 — 2026-11-04 — Initial, empty (codebase analysis 2026-11-03, item B5).
 */

/** The values of security.request_body_check. */
export const BODY_CHECK_MODES = ['observe', 'enforce'] as const;
export type BodyCheckMode = typeof BODY_CHECK_MODES[number];
export const DEFAULT_BODY_CHECK_MODE: BodyCheckMode = 'enforce';

/** The mode a raw value names; anything else is the default. */
export function bodyCheckModeFrom(raw: string | undefined): BodyCheckMode {
    const v = (raw ?? '').trim().toLowerCase();
    return (BODY_CHECK_MODES as readonly string[]).includes(v) ? v as BodyCheckMode : DEFAULT_BODY_CHECK_MODE;
}

export interface ExemptBodyRoute {
    /** `METHOD /path/{template}`, as openapi.yaml writes it. */
    readonly route: string;
    /** Why the route is observed in enforce mode. */
    readonly reason: string;
}

/** The reason of a route that answers a body it does not take with its own refusal. */
const VALIDATES_ITSELF = 'the route validates its body itself; the guard observes it';

/**
 * The routes that validate their body in the handler (or in a service it calls) and answer a wrong
 * body with their own refusal: their own error code, message or status, which an existing E2E test
 * asserts. They stay observed for good, so the route's answer is the one a client gets. Each comment
 * names the suite that asserts it.
 *
 * A route whose test expected only its sign-in, role, scope or rate-limit refusal is not here: the
 * guard refuses after the route's own middleware (middleware/openapi-body-guard.ts), so that refusal
 * comes first. Authorization done inside a handler cannot come first that way; every route that does
 * it and whose test sends a wrong body is here because it validates its body too, so no entry is here
 * for that alone.
 */
const ROUTE_OWN_REFUSAL: readonly string[] = [
    // Agents (e2e-account-doors, e2e-agent-tasks, e2e-agent-v2, e2e-agent-v2-messaging,
    // e2e-ai-provenance-rest-declare, e2e-agent-offers)
    'POST /v1/agents/import',
    'POST /v1/agents/{gaii}/port',
    'PATCH /v1/agents/{name}/scopes',
    'PATCH /v1/agents/{name}/federate',
    'PUT /v1/agents/{name}/cors',
    'POST /v1/agents/{name}/messages',
    'PUT /v1/agents/{name}/onboarding/override',
    'POST /v1/agents/{name}/telemetry',
    'POST /v1/agents/{name}/tasks/{id}/rate',
    'PATCH /v1/agents/{name}/tasks/{id}/triage',
    'PUT /v1/agents/{name}/offers',
    'PATCH /v1/agents/{name}/max-concurrent-tasks', // e2e-agent-tasks: 400 INVALID_INPUT for 0 and 99
    'PATCH /v1/agents/{name}/run-mode', // e2e-agent-runtime-source, e2e-agent-v2: 400 INVALID_INPUT
    'PATCH /v1/agents/{name}/runtime-source', // e2e-agent-runtime-source, e2e-own-key-roads: 400 INVALID_INPUT
    'POST /v1/agents/v2/agent-proposals',
    'POST /v1/agents/v2/messages',
    // AI and provenance (ai, e2e-ai-image, e2e-llm-proxy, openrouter, e2e-notebook-plan,
    // e2e-ai-provenance-agent-plane, e2e-ai-provenance-surfaces)
    'POST /v1/ai/complete',
    'POST /v1/ai/settings',
    'POST /v1/ai/image',
    'POST /v1/llm/chat/completions',
    'POST /v1/openrouter/complete',
    'POST /v1/librarian/plan',
    'POST /v1/provenance',
    // Home, workflows (e2e-remake-home, e2e-federated-visitor-names)
    'POST /v1/home/room',
    // e2e-remake-home: 400 WELCOME_MAT_UNREADABLE, and the handler counts the failed paste
    'POST /v1/home/welcome-mat',
    'PUT /v1/workflows/{id}',
    // Admin (e2e-admin-features, e2e-admin-doors, e2e-admin-doors-2, e2e-subdomains, e2e-usage-telemetry)
    'PUT /v1/admin/config',
    'PUT /v1/admin/ghii/{ghii}',
    'PUT /v1/admin/ghii/{ghii}/cors',
    'POST /v1/admin/email/send-group',
    'PUT /v1/admin/push/templates/{id}/{locale}',
    'POST /v1/admin/federation/trust-advisory',
    'POST /v1/admin/federation/join',
    'POST /v1/admin/setup/register',
    'POST /v1/admin/subdomains',
    'PATCH /v1/admin/subdomains/{subdomain}', // e2e-app-origin: 400 INVALID_ORIGIN
    'POST /v1/admin/usage/archive/prune',
    'PUT /v1/admin/extensions/available/{name}/scripts/{actionId}', // e2e-admin-doors: its own 400 for {}
    // Account, sign-in, secrets, settings (e2e-access-tokens, e2e-account-events, e2e-admin-stats-page,
    // e2e-account-doors: the registration rate limit counts the call, e2e-security, e2e-secrets,
    // e2e-ai-visibility, e2e-setup-and-verification, e2e-classification-audience-cap,
    // e2e-compliance-agreements)
    'POST /v1/access/tokens',
    'POST /v1/account/events',
    'POST /v1/ghii',
    'PUT /v1/ghii', // e2e-display-prefs: 400 INVALID_INPUT for a timezone
    'PUT /v1/ghii/cors',
    'POST /v1/personal/anchor', // e2e-personal-tunnel: 400 AGENT_GAII_NOT_YOURS
    'POST /v1/push/subscribe',
    'PUT /v1/secrets/{name}',
    'PUT /v1/visibility/settings',
    'POST /v1/trusted-issuers',
    'POST /v1/classification/exceptions',
    'POST /v1/compliance/agreements/breach-notice',
    // Site, portfolio (api-full, e2e-portal, e2e-surface-layout, e2e-remake-home)
    'POST /v1/site/template',
    'POST /v1/site/layout/{surface}/restore',
    'PUT /v1/site/layout/{surface}', // e2e-surface-layout: 422 for a contentsMenu that is not true or false
    'PUT /v1/portfolio/upload',
    // Apps (e2e-app-community, e2e-app-screenshot-access, e2e-app-agent-deploy, e2e-app-draft,
    // e2e-federated-visitor-names, e2e-app-design-spec)
    'POST /v1/apps',
    'PATCH /v1/apps/{filename}',
    'PUT /v1/apps/{owner}/{filename}/draft',
    'POST /v1/apps/{owner}/{filename}/publish-draft',
    'POST /v1/apps/{owner}/{filename}/screenshot',
    'PUT /v1/apps/{owner}/{filename}/design-spec',
    // Capabilities, commerce, exchange, packages (e2e-capabilities, e2e-agent-field-adds,
    // e2e-capability-visibility-word, e2e-capability-update-fields, e2e-commerce, e2e-exchange,
    // e2e-package-sets, e2e-package-managed, e2e-package-account-sale, e2e-package-withdraw)
    'POST /v1/capabilities',
    'PUT /v1/capabilities/{id}',
    'POST /v1/commerce/checkout-sessions',
    'PUT /v1/commerce/payout/stripe',
    'POST /v1/exchange/offerings',
    'POST /v1/exchange/needs',
    'POST /v1/exchange/work/{id}/deliver',
    'POST /v1/packages/compose-set',
    'POST /v1/packages/{groupId}/install',
    'PUT /v1/packages/{groupId}/price',
    'POST /v1/packages/{groupId}/versions/{version}/withdraw',
    // Organisms and workspaces (e2e-organism-shapes, e2e-app-access-request, e2e-organism-membership-doors,
    // e2e-workspace-rows, e2e-workspace-fenced-space)
    'POST /v1/organisms',
    'PUT /v1/organisms/{id}',
    'POST /v1/organisms/{id}/join-requests/{requestId}/review',
    'POST /v1/organisms/{id}/admins',
    'POST /v1/organisms/{id}/transfer',
    'POST /v1/organisms/{id}/owners',
    'POST /v1/organisms/{id}/invitations',
    'POST /v1/organisms/{id}/members',
    'POST /v1/organisms/{id}/agents',
    'POST /v1/organisms/{id}/workspace/rows/{space}',
    'POST /v1/organisms/{id}/workspace/spaces/{space}/extensions',
    // Memory (e2e-memory-full, e2e-memory-doors, e2e-app-grants, e2e-federated-session,
    // e2e-memory-federation-remote)
    'POST /v1/memory', // e2e-memory-full: key and visibility; its own INVALID_INPUT for provenance and storage_ref
    'PATCH /v1/memory/{key}',
    'POST /v1/memory/import',
    'POST /v1/memory/copy',
    'PUT /v1/memory/cors/{key}',
    'POST /v1/memory/bundle',
    'POST /v1/memory/pull',
    'POST /v1/memory/pull-remote',
    // Realtime, chat instances, ecosystem, MCP servers, federation (e2e-realtime-rooms,
    // e2e-mcp-chat-instances, e2e-ecosystem-events, e2e-mcp-proxy, e2e-federation, federation-mesh)
    'POST /v1/realtime/rooms',
    'POST /v1/realtime/relay', // e2e-realtime-rooms: 400 INVALID_INPUT
    'DELETE /v1/realtime/relay', // e2e-realtime-rooms: 400 INVALID_INPUT
    'POST /v1/ws/ticket',
    'POST /v1/chat-instances',
    'POST /v1/ecosystem/subscriptions',
    'POST /v1/mcp-servers',
    'POST /v1/mcp-servers/node',
    'POST /v1/mcp-servers/{id}/call', // e2e-mcp-proxy: 400 BAD_REQUEST for {}
    'POST /v1/federation/peers',
    'POST /v1/federation/peer/request',
    'POST /v1/federation/trust-advisory',
    'PUT /v1/federation/peers/{nodeId}/settlement-ceiling', // e2e-federation-peer-bounds: 400 INVALID_INPUT for 0
    'PUT /v1/federation/peers/{nodeId}/relay-claim', // e2e-federation-relay-claim: 400 INVALID_INPUT
    'POST /v1/memory/push-home', // e2e-federated-session: 400 INVALID_INPUT without key
    'POST /v1/memory/list-remote', // e2e-memory-federation-remote: 400 INVALID_INPUT without peer_node_id
    // Second pass: suites that run a node of their own (e2e-app-internet-opening, e2e-email-delivery,
    // e2e-ai-jobs, e2e-ai-decide, e2e-refinery, e2e-agent-schedules, e2e-federated-visitor-names,
    // e2e-package-repository, e2e-ai-gen-rules)
    'POST /v1/apps/{owner}/{filename}/internet-opening', // 400 INVALID_INPUT without a reason
    'POST /v1/organisms/{id}/invitations/email', // 400 INVALID_INPUT for a locale with no template
    'POST /v1/ai/jobs', // 400 INVALID_BODY for an unknown op
    'PUT /v1/ai/decide/settings', // 400 INVALID_BODY for a policy that is not an object
    'POST /v1/refinery/runs', // 400 INVALID_INPUT for a prefix that is not a definition name
    'POST /v1/schedules', // 400 INVALID_AI_JOB for an output_visibility that is no visibility
    'PATCH /v1/schedules/{id}', // e2e-agent-schedules: 400 INVALID_CRON, INVALID_INPUT, NO_PROMPT
    'PUT /v1/packages/{groupId}/entitlements/{nodeId}', // 400 INVALID_INPUT for an unknown channel
    'PUT /v1/ai/gen-rules', // 400 GEN_RULES_INVALID with every problem named
];

/** Routes observed in enforce mode, each with its reason. */
export const EXEMPT_BODY_ROUTES: readonly ExemptBodyRoute[] = ROUTE_OWN_REFUSAL.map(route => ({ route, reason: VALIDATES_ITSELF }));
