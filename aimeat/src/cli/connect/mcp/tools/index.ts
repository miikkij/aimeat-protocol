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
 *   2026-10-06 — themes.ts, apps.ts, agent-management.ts, data-map.ts, designbook.ts, app-manage.ts,
 *     boards.ts, decide.ts, mcp-proxy.ts, ai-voice.ts, surface-layout.ts and compliance.ts are gone: their
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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';

import { registerCoreTools } from './core.js';
import { registerAgentTasksTools } from './agent-tasks.js';
import { registerAgentMessagesTools } from './agent-messages.js';
import { registerDmMessagesTools } from './dm-messages.js';
import { registerAgentCapsTools } from './agent-caps.js';
import { registerAgentTelemetryTools } from './agent-telemetry.js';
import { registerCapabilitiesTools } from './capabilities.js';
import { registerKnowledgeTools } from './knowledge.js';
import { registerSkillsTools } from './skills.js';
import { registerOrganismsTools } from './organisms.js';
import { registerWorkspaceTools } from './workspaces.js';
import { registerSchedulesTools } from './schedules.js';
import { registerWorkflowTools } from './workflows.js';
import { registerFlagsTools } from './flags.js';
import { registerHandbookTools } from './handbook.js';
import { registerAppdevTools } from './appdev.js';
import { registerCommerceTools } from './commerce.js';
import { registerExchangeTools } from './exchange.js';
import { registerContactTools } from './contacts.js';
import { registerCompanyTools } from './companies.js';
import { registerPortfolioTools } from './portfolio.js';
import { registerOperatorTools } from './operator.js';
import { registerInstallSetTools } from './install-sets.js';
import { registerDispatchTools } from './dispatch-tools.js';

export function registerAllTools(server: McpServer, registry: AgentRegistry): void {
  // The modules register the tools that have a handler of their own; every other connector tool runs
  // its CLI dispatch definition (dispatch-tools.ts). The names the modules took are recorded on the way.
  const registered = new Set<string>();
  const mcp = new Proxy(server, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if ((prop === 'tool' || prop === 'registerTool') && typeof value === 'function') {
        return (...args: unknown[]) => { registered.add(args[0] as string); return value.apply(target, args); };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  registerCoreTools(mcp, registry);
  registerAgentTasksTools(mcp, registry);
  registerAgentMessagesTools(mcp, registry);
  registerDmMessagesTools(mcp, registry);
  registerAgentCapsTools(mcp, registry);
  registerAgentTelemetryTools(mcp, registry);
  registerCapabilitiesTools(mcp, registry);
  registerKnowledgeTools(mcp, registry);
  registerSkillsTools(mcp, registry);
  registerOrganismsTools(mcp, registry);
  registerWorkspaceTools(mcp, registry);
  registerSchedulesTools(mcp, registry);
  registerWorkflowTools(mcp, registry);
  registerFlagsTools(mcp, registry);
  registerHandbookTools(mcp, registry);
  registerAppdevTools(mcp, registry);
  registerCommerceTools(mcp, registry);
  registerExchangeTools(mcp, registry);
  registerContactTools(mcp, registry);
  registerCompanyTools(mcp, registry);
  registerPortfolioTools(mcp, registry);
  registerOperatorTools(mcp, registry);
  registerInstallSetTools(mcp, registry);
  registerDispatchTools(server, registry, registered);
}
