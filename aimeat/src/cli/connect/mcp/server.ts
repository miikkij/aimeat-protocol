/**
 * @file server.ts
 * @description MCP server entry point. Loads every credential from
 *   `~/.aimeat/tokens/`, builds an AgentRegistry, registers all MCP tools +
 *   resources against that registry, starts one poll loop per agent, then
 *   connects the stdio transport.
 *
 *   Single-agent UX: when only one credential is loaded, MCP tools accept an
 *   optional `agent_name` parameter that defaults to the only loaded agent.
 *   Multi-agent UX: when 2+ are loaded, tools require `agent_name` and the
 *   registry returns a helpful error listing the available names.
 *
 * @structure
 *   1. Load all agents via `loadAllAgents()`
 *   2. Build AgentRegistry with one AimeatClient per agent
 *   3. Register MCP tools (registry-aware) and resources
 *   4. Start per-agent pollers (each with its own wake adapter + optional task-runner)
 *   5. Connect StdioServerTransport
 *
 * @usage Called by `aimeat connect serve`.
 *
 * @version-history
 *   v1.9.4 -- 2026-05-28 -- Update connector guidance and fail missing credentials without a stack trace
 *   v2.0.0 -- 2026-05-29 -- Multi-agent serve: registry-driven, per-agent poller, task-runner hook
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadAllAgents } from '../config.js';
import { buildRegistry } from '../agent-registry.js';
import { registerAllTools } from './tools/index.js';
import { registerResources } from './resources.js';
import { startPollerForAgent } from './poller.js';
import { isRunner } from '../task-runner.js';

export async function runServe(_flags: Record<string, string>): Promise<void> {
  const loaded = await loadAllAgents();
  if (loaded.length === 0) {
    console.error('No agents configured. Run: aimeat connect');
    process.exit(1);
  }

  const registry = buildRegistry(loaded);

  const mcp = new McpServer({
    name: 'aimeat-connect',
    version: '0.1.0',
  });

  registerAllTools(mcp, registry);
  registerResources(mcp, registry);

  for (const entry of registry.list()) {
    startPollerForAgent(entry);
  }

  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  const summary = registry.list().map(a => {
    const mode = isRunner(a) ? 'task-runner' : 'interactive';
    return `${a.agent}@${a.owner} [${mode}]`;
  }).join(', ');
  console.error(`AIMEAT MCP server running. ${registry.size()} agent(s): ${summary}`);

  if (registry.list().some(isRunner)) {
    console.error('SECURITY: runner.command in per-agent config is exec\'d on task arrival. Trust your ~/.aimeat/ contents.');
  }
}
