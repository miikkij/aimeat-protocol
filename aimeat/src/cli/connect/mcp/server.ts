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
 *   v2.1.0 -- 2026-05-30 -- v2 purpose-scoped surfaces: `--surface <appdev|agent|service|admin>`
 *     registers only that surface's tool allowlist (shared catalog/surfaces.ts); default 'all'.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadAllAgents } from '../config.js';
import { buildRegistry } from '../agent-registry.js';
import { registerAllTools } from './tools/index.js';
import { registerResources } from './resources.js';
import { startPollerForAgent } from './poller.js';
import { isRunner } from '../task-runner.js';
import { toolsForSurface, isV2Role, V2_ROLES, type SurfaceRole } from '../../../mcp/catalog/surfaces.js';

export async function runServe(flags: Record<string, string>): Promise<void> {
  const loaded = await loadAllAgents();
  if (loaded.length === 0) {
    console.error('No agents configured. Run: aimeat connect');
    process.exit(1);
  }

  const registry = buildRegistry(loaded);

  // v2 purpose-scoped surface: `aimeat connect serve --surface agent` registers ONLY that surface's
  // tools (same allowlist as the server /v2/mcp/<role>), so a local connector can offer the focused
  // appdev/agent/service surface. Default 'all' = the full connector toolset (unchanged).
  const surfaceFlag = flags.surface ?? flags.role ?? 'all';
  if (surfaceFlag !== 'all' && !isV2Role(surfaceFlag)) {
    console.error(`Unknown --surface "${surfaceFlag}". Use one of: all, ${V2_ROLES.join(', ')}.`);
    process.exit(1);
  }
  const role = surfaceFlag as SurfaceRole | 'all';

  const mcp = new McpServer({
    name: role === 'all' ? 'aimeat-connect' : `aimeat-connect-${role}`,
    version: '0.1.0',
  });

  if (role === 'all') {
    registerAllTools(mcp, registry);
  } else {
    // Filter registration to the surface allowlist by patching tool/registerTool for the duration.
    const allow = toolsForSurface(role);
    type ToolFn = (...args: unknown[]) => unknown;
    const patchable = mcp as unknown as { tool: ToolFn; registerTool: ToolFn };
    const origTool = patchable.tool.bind(mcp) as ToolFn;
    const origRegister = patchable.registerTool.bind(mcp) as ToolFn;
    const gate = (name: string) => allow.has(name);
    patchable.tool = (...a: unknown[]) => gate(a[0] as string) ? origTool(...a) : undefined;
    patchable.registerTool = (...a: unknown[]) => gate(a[0] as string) ? origRegister(...a) : undefined;
    registerAllTools(mcp, registry);
    patchable.tool = origTool;
    patchable.registerTool = origRegister;
  }
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
  const surfaceNote = role === 'all' ? 'full surface' : `surface '${role}' (${toolsForSurface(role).size} tools)`;
  console.error(`AIMEAT MCP server running [${surfaceNote}]. ${registry.size()} agent(s): ${summary}`);

  if (registry.list().some(isRunner)) {
    console.error('SECURITY: runner.command in per-agent config is exec\'d on task arrival. Trust your ~/.aimeat/ contents.');
  }
}
