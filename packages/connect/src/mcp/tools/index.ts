/**
 * @file index.ts
 * @description Registry that wires all MCP tool modules to an McpServer instance.
 *   Each module registers its own tools; this file orchestrates the registration
 *   order and passes the shared AimeatClient and agent name.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatClient } from '../../lib/api-client.js';

import { registerCoreTools } from './core.js';
import { registerAgentTasksTools } from './agent-tasks.js';
import { registerAgentMessagesTools } from './agent-messages.js';
import { registerAgentCapsTools } from './agent-caps.js';
import { registerBoardsTools } from './boards.js';
import { registerCatalogueTools } from './catalogue.js';
import { registerCapabilitiesTools } from './capabilities.js';
import { registerExtensionsTools } from './extensions.js';
import { registerCortexTools } from './cortex.js';
import { registerAppsTools } from './apps.js';
import { registerKnowledgeTools } from './knowledge.js';
import { registerOrganismsTools } from './organisms.js';
import { registerConsentTools } from './consent.js';
import { registerGroupsTools } from './groups.js';
import { registerInstancesTools } from './instances.js';
import { registerMemoryExtTools } from './memory-ext.js';
import { registerWalletExtTools } from './wallet-ext.js';
import { registerFlagsTools } from './flags.js';
import { registerHandbookTools } from './handbook.js';

export function registerAllTools(mcp: McpServer, client: AimeatClient, agentName: string): void {
  registerCoreTools(mcp, client, agentName);
  registerAgentTasksTools(mcp, client, agentName);
  registerAgentMessagesTools(mcp, client, agentName);
  registerAgentCapsTools(mcp, client, agentName);
  registerBoardsTools(mcp, client);
  registerCatalogueTools(mcp, client);
  registerCapabilitiesTools(mcp, client);
  registerExtensionsTools(mcp, client);
  registerCortexTools(mcp, client);
  registerAppsTools(mcp, client);
  registerKnowledgeTools(mcp, client);
  registerOrganismsTools(mcp, client);
  registerConsentTools(mcp, client);
  registerGroupsTools(mcp, client);
  registerInstancesTools(mcp, client);
  registerMemoryExtTools(mcp, client);
  registerWalletExtTools(mcp, client);
  registerFlagsTools(mcp, client);
  registerHandbookTools(mcp, client);
}
