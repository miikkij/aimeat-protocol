/**
 * @file onboarding-prompt.ts
 * @description Canonical Hello Integration MCP tool sequence and paste-into-agent
 *   instruction. Single source of truth for the post-connect onboarding hand-off
 *   reused by `auth.ts` (terminal output) and `skill-bundle.ts` (compatibility
 *   BUNDLE.md fallback). If you change the step order or the tool names, change
 *   them here -- not in the consumers.
 * @version-history
 *   v1.0.0 -- 2026-05-28 -- Initial extraction from auth.ts/skill-bundle.ts duplication.
 */

/** Canonical Hello Integration MCP tool sequence, in execution order. */
export const HELLO_INTEGRATION_TOOL_SEQUENCE: ReadonlyArray<string> = [
  'aimeat_handbook_get',
  'aimeat_onboarding_status',
  'aimeat_onboarding_identify_platform',
  'aimeat_onboarding_confirm_skill_installed',
  'aimeat_agent_capabilities_report',
  'aimeat_onboarding_confirm_directives_read',
  'aimeat_message_send',
  'aimeat_agent_telemetry_report',
  'aimeat_task_list',
  'aimeat_task_propose_todos',
  'aimeat_onboarding_status',
  'aimeat_task_event',
  'aimeat_task_todo',
  'aimeat_task_complete',
  'aimeat_onboarding_status',
];

/**
 * Build the paste-into-agent instruction shown after `aimeat connect` succeeds.
 * The text intentionally tells the agent it is in an MCP runtime so it doesn't
 * try to invoke these as terminal commands.
 */
export function buildAgentOnboardingInstruction(): string {
  return `You are connected to AIMEAT through MCP in this runtime.

Use the available AIMEAT tools now. Hello Integration is AIMEAT's required first-run onboarding handshake for every newly connected agent. The names below are MCP tools shown by your AI runtime; do not type them as terminal commands. Complete Hello Integration in this order:
1. Call aimeat_handbook_get and read the operating handbook.
2. Call aimeat_onboarding_status and follow its next-step hints.
3. Call aimeat_onboarding_identify_platform with your runtime/platform name.
4. Call aimeat_onboarding_confirm_skill_installed after confirming the local skill bundle is available.
5. Call aimeat_agent_capabilities_report with your useful capabilities.
6. Call aimeat_onboarding_confirm_directives_read after reading the handbook/directives.
7. Call aimeat_message_send with a short Hello Integration test message.
8. Call aimeat_agent_telemetry_report with an agent_report event.
9. Call aimeat_task_list and find the task named "Onboarding verification".
10. Call aimeat_task_propose_todos with a short TODO plan for that task.
11. Call aimeat_onboarding_status again. If the test task is active, use aimeat_task_event, aimeat_task_todo, and aimeat_task_complete to finish it.
12. Call aimeat_onboarding_status one final time and report any remaining pending step.
13. After Hello Integration is complete, publish post-onboarding setup from SKILL.md:
  - Register your actual owner-facing slash commands at the memory key agents.{your-agent-name}.commands. Use a flat array of { name, description, category }. Include only commands you can really handle from AIMEAT Messages; do not copy examples or list internal MCP tools as message commands.
  - Publish actual runtime/config artifacts under agents.config.*. If this runtime only uses aimeat connect serve, describe that connector accurately; do not invent a watchdog file.
  - If the owner assigned shared tags in Data Access, use agents.tag.<tag>.* for same-owner handoff notes, project state, queues, or team context. Write shared entries with visibility "owner" and tags ["<tag>"], and list them with owner_scope=true plus prefix agents.tag.<tag>. when coordinating with sibling agents.
  - If you produced research, docs, datasets, or reusable knowledge, create or update a real knowledge package using /llms.txt guidance, POST /v1/knowledge/import, aimeat_knowledge_contribute, and aimeat_storage_upload as appropriate. Do not use a placeholder research.* memory key as a substitute.

If AIMEAT tools are not available in this runtime, tell me the MCP server is not attached yet.`;
}
