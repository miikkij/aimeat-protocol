/**
 * @file scope-exempt-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tools that change state and deliberately need no scope, each with its reason.
 *   Moved unchanged out of scopes.ts (max-file-lines), which re-exports it, so every importer keeps
 *   reading it from there.
 * @structure SCOPE_EXEMPT_TOOLS
 * @version-history
 *   v1.3.0 — 2026-10-04 — aimeat_task_decline: its own task only (isOwnTask), like aimeat_task_fail.
 *   v1.2.0 — 2026-10-02 — aimeat_agent_runtime_report: its own report without a word, a sibling's with agent:write.
 *   v1.1.0 — 2026-10-02 — aimeat_agent_tags_set: own tags without a word, a sibling's with agent:write.
 *   v1.0.0 — 2026-09-29 — Moved from scopes.ts, unchanged.
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
    // The dispatcher. It carries the CALLER'S OWN bearer back through the node's real route, so the
    // scope that matters is the target capability's and it is checked there, on the same code path a
    // direct call would take. A word here would be a second, weaker opinion in front of the real
    // one, and it would have to guess which scope the target wants. `aimeat_invoke` can do exactly
    // what its caller can already do and nothing more; see services/node-invoke.ts.
    'aimeat_invoke',
    // One tool, many actions, each with its own word (catalog/action-scopes.ts): the handler checks
    // the action's word on every call. Its reads need none, so one word for the tool would take
    // versions and lineage away from agents that hold only a read word.
    'aimeat_app_manage',
    // The node administration block (mint, SSO, account lifecycle, the second-factor reset, the
    // Security, CORS, Hooks, Statistics, Usage, Knowledge and Federation pages, the MCP registry, and
    // the layout read) stood here until 2026-09-24 with the reason "gated in the handler on the
    // operator role; no scope word narrows an operator". The role was the ACCOUNT's, so every agent
    // an operator connected was handed all of it (security audit A8-1). They are in TOOL_SCOPES now.
    'aimeat_agent_capabilities_report',              // Identity is resolved once from the session at agent-capabilities
    // An agent's OWN tags need no word, a sibling's need agent:write, and the handler checks which
    // (mcp/agent-management.ts, the rule in auth/self-or-scope.ts). In TOOL_SCOPES it hid the tool
    // from every agent without agent:write, which is how a crew runtime's tags call on every start
    // failed every task of the basic agents (2026-10-02).
    'aimeat_agent_tags_set',
    // The same rule for the runtime report: an agent says what runs it and where its model calls go
    // (`llm`) about ITSELF without a word, a sibling's report needs agent:write, the handler checks.
    'aimeat_agent_runtime_report',
    'aimeat_agent_telemetry_report',                // Every write is keyed to `agentGaii` from the session closure (agent-telemetry
    'aimeat_capabilities_vouch',                     // gated in the handler on the operator role, not by a scope
    'aimeat_instance_create',                        // owner comes from ownerName() derived from the session GAII (chat-instances
    'aimeat_message_send',                           // agentGaii and senderGaii are both the session identity (agent-messages
    // The four onboarding tools confirm a STEP, which is the agent reporting its own progress: they
    // mirror POST /v1/agents/:name/onboarding/step/:id, which asks for no scope either. Starting and
    // cancelling onboarding are a different act and were gated on `agent:write` on 2026-08-11 (audit
    // H-2), and neither has a tool, so nothing here mirrors them. Adding one means adding the word.
    'aimeat_onboarding_confirm_directives_read',     // agentGaii from the session closure (agent-onboarding
    'aimeat_onboarding_confirm_skill_installed',     // Same identity path as the rest of the onboarding set — agentGaii from the session closure (agent-onboarding
    'aimeat_onboarding_declare_services',            // agentGaii from the session closure (agent-onboarding
    'aimeat_onboarding_identify_platform',           // Every onboarding tool passes the session closure `agentGaii` (agent-onboarding
    'aimeat_organism_invitation_respond',            // It acts only on the caller's own pending invitation — membership is looked up by getOwnerName() at organisms-n
    'aimeat_task_complete',                          // isOwnTask() at agent-tasks
    'aimeat_task_event',                             // isOwnTask() at agent-tasks
    'aimeat_task_fail',                              // isOwnTask() at agent-tasks
    'aimeat_task_decline',                           // isOwnTask() at agent-tasks
    'aimeat_task_propose_todos',                     // Authorization is isOwnTask(), defined at agent-tasks
    'aimeat_task_request_changes',                   // It is never registered on the server /v1/mcp: it sits in V2_EXCLUDED (src/mcp/catalog/surfaces
    'aimeat_task_todo',                              // isOwnTask() at agent-tasks
]);
