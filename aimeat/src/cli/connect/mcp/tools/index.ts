/**
 * @file index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Registry that wires all MCP tool modules to an McpServer instance.
 *   Each module receives the AgentRegistry; tool handlers call
 *   `registry.resolve(agent_name?)` per request to pick which loaded agent's
 *   client to use. Single-agent installs are unchanged in UX (agent_name is
 *   optional and defaults to the only loaded agent).
 * @version-history
 *   2026-11-25 — knowledge.ts is gone: aimeat_knowledge_contribute has a route
 *     (POST /v1/knowledge/:id/entries) and runs its dispatch definition, so no connector tool keeps a
 *     handler of its own and the name-recording proxy went with it.
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-12 — contacts.ts, companies.ts, portfolio.ts, commerce.ts, exchange.ts, organisms.ts,
 *     dm-messages.ts and agent-telemetry.ts are gone: their 30 tools got a CLI dispatch definition
 *     and run it, so /local/call serves them too. knowledge.ts is the one module left with a handler
 *     of its own (security/connector-own-handlers.json).
 *   2026-10-06 — themes.ts, apps.ts, agent-management.ts, data-map.ts, designbook.ts, app-manage.ts,
 *     boards.ts, decide.ts, mcp-proxy.ts, ai-voice.ts, surface-layout.ts, compliance.ts, install-sets.ts, core.ts, agent-tasks.ts, schedules.ts, workflows.ts, agent-caps.ts, handbook.ts, agent-messages.ts, appdev.ts, capabilities.ts, flags.ts, operator.ts, skills.ts and workspaces.ts are gone, and organisms.ts keeps the tools that have no dispatch definition: their
 *     tools run their dispatch definition (secaudit 2026-10 follow-up, Part B).
 *   2026-10-05 — Every connector tool without a handler of its own runs its CLI dispatch definition
 *     (dispatch-tools.ts); registerAllTools records the names the modules register (secaudit 2026-10, M3).
 *   v2.6.0 -- 2026-09-29 -- Register aimeat_classification (TARGET-082 V5).
 *   v2.5.0 -- 2026-09-29 -- Register the mail refinery tools (aimeat_refinery_classes/run/status).
 *   v1.5.0 -- 2026-09-28 -- Register aimeat_admin_install_set.
 *   v1.4.0 -- 2026-09-28 -- Register aimeat_ai_capabilities, aimeat_ai_models, aimeat_ai_transcribe and aimeat_ai_embed.
 *   v1.3.0 -- 2026-09-28 -- Register aimeat_ai_providers, aimeat_ai_provider_test and aimeat_ai_routing_set.
 *   v1.2.0 -- 2026-09-28 -- Register aimeat_ai_policy_set (the owner's model policy).
 *   v1.1.0 -- 2026-05-28 -- Register Hello Integration onboarding MCP tools
 *   v1.1.1 -- 2026-05-28 -- Register connector telemetry reporting MCP tool
 *   v2.0.0 -- 2026-05-29 -- Multi-agent: tool modules now take AgentRegistry
 *   v2.1.0 -- 2026-09-06 -- Register the secrets-vault tools, so a desktop client can store the key
 *     an integration needs instead of the person pasting it into the chat.
 *   v2.2.0 -- 2026-09-23 -- Register the component catalogue tools (aimeat_ui_component_list/get).
 *   v2.3.0 -- 2026-09-24 -- Register the theme tools (aimeat_theme_list/get/save/style_save/component_css_set).
 *   v2.4.0 -- 2026-09-27 -- aimeat_app_manage (app-manage.ts) replaces the app-ui pair and, in apps.ts,
 *     the screenshot, versions, seo, marks, visitors, legal and audit tools.
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AgentRegistry } from '../../agent-registry.js';

import { registerDispatchTools } from './dispatch-tools.js';

export function registerAllTools(server: McpServer, registry: AgentRegistry): void {
  // Every connector tool runs its CLI dispatch definition (dispatch-tools.ts). No module registers a
  // handler of its own any more (security/connector-own-handlers.json is empty), so none is skipped.
  registerDispatchTools(server, registry, new Set<string>());
}
