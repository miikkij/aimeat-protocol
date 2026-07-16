/**
 * @file index.ts
 * @description Registry that wires all MCP tool modules to an McpServer instance.
 *   Each module receives the AgentRegistry; tool handlers call
 *   `registry.resolve(agent_name?)` per request to pick which loaded agent's
 *   client to use. Single-agent installs are unchanged in UX (agent_name is
 *   optional and defaults to the only loaded agent).
 * @version-history
 *   v1.1.0 -- 2026-05-28 -- Register Hello Integration onboarding MCP tools
 *   v1.1.1 -- 2026-05-28 -- Register connector telemetry reporting MCP tool
 *   v2.0.0 -- 2026-05-29 -- Multi-agent: tool modules now take AgentRegistry
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';

import { registerCoreTools } from './core.js';
import { registerAgentTasksTools } from './agent-tasks.js';
import { registerAgentMessagesTools } from './agent-messages.js';
import { registerDmMessagesTools } from './dm-messages.js';
import { registerAgentCapsTools } from './agent-caps.js';
import { registerAgentManagementTools } from './agent-management.js';
import { registerAgentTelemetryTools } from './agent-telemetry.js';
import { registerBoardsTools } from './boards.js';
import { registerCatalogueTools } from './catalogue.js';
import { registerCapabilitiesTools } from './capabilities.js';
import { registerExtensionsTools } from './extensions.js';
import { registerCortexTools } from './cortex.js';
import { registerAppsTools } from './apps.js';
import { registerKnowledgeTools } from './knowledge.js';
import { registerSkillsTools } from './skills.js';
import { registerOrganismsTools } from './organisms.js';
import { registerWorkspaceTools } from './workspaces.js';
import { registerSchedulesTools } from './schedules.js';
import { registerWorkflowTools } from './workflows.js';
import { registerConsentTools } from './consent.js';
import { registerGroupsTools } from './groups.js';
import { registerInstancesTools } from './instances.js';
import { registerMemoryExtTools } from './memory-ext.js';
import { registerWalletExtTools } from './wallet-ext.js';
import { registerFlagsTools } from './flags.js';
import { registerFeedbackTools } from './feedback.js';
import { registerHandbookTools } from './handbook.js';
import { registerOnboardingTools } from './onboarding.js';

export function registerAllTools(mcp: McpServer, registry: AgentRegistry): void {
  registerCoreTools(mcp, registry);
  registerAgentTasksTools(mcp, registry);
  registerAgentMessagesTools(mcp, registry);
  registerDmMessagesTools(mcp, registry);
  registerAgentCapsTools(mcp, registry);
  registerAgentManagementTools(mcp, registry);
  registerAgentTelemetryTools(mcp, registry);
  registerBoardsTools(mcp, registry);
  registerCatalogueTools(mcp, registry);
  registerCapabilitiesTools(mcp, registry);
  registerExtensionsTools(mcp, registry);
  registerCortexTools(mcp, registry);
  registerAppsTools(mcp, registry);
  registerKnowledgeTools(mcp, registry);
  registerSkillsTools(mcp, registry);
  registerOrganismsTools(mcp, registry);
  registerWorkspaceTools(mcp, registry);
  registerSchedulesTools(mcp, registry);
  registerWorkflowTools(mcp, registry);
  registerConsentTools(mcp, registry);
  registerGroupsTools(mcp, registry);
  registerInstancesTools(mcp, registry);
  registerMemoryExtTools(mcp, registry);
  registerWalletExtTools(mcp, registry);
  registerFlagsTools(mcp, registry);
  registerFeedbackTools(mcp, registry);
  registerHandbookTools(mcp, registry);
  registerOnboardingTools(mcp, registry);
}
