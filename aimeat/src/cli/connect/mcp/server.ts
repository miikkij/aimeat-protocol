/**
 * @file server.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP server entry point. Loads every credential from
 *   `~/.aimeat/tokens/`, builds an AgentRegistry, registers all MCP tools +
 *   resources against that registry, then either connects the stdio transport
 *   (default — preserved for CI/serverless) or, with `--http`/`--daemon`,
 *   starts the loopback serve daemon (mcp/local-server.ts): one persistent
 *   tunnel WS per agent, local Streamable-HTTP MCP + REST proxy + long-poll
 *   push surface on 127.0.0.1, discovery file at `<AIMEAT_HOME>/serve.json`.
 *
 *   Single-agent UX: when only one credential is loaded, MCP tools accept an
 *   optional `agent_name` parameter that defaults to the only loaded agent.
 *   Multi-agent UX: when 2+ are loaded, tools require `agent_name` and the
 *   registry returns a helpful error listing the available names.
 *
 * @structure
 *   1. Load all agents via `loadAllAgents()`
 *   2. Build AgentRegistry with one AimeatClient per agent
 *   3. `buildMcpServer()` — McpServer with tools (surface-filtered) + resources
 *   4. Daemon mode → runServeDaemon (tunnel transport, push, no upstream poll)
 *      Stdio mode → per-agent pollers + StdioServerTransport (unchanged)
 *
 * @usage Called by `aimeat connect serve`.
 *
 * @version-history
 *   v1.9.4 -- 2026-05-28 -- Update connector guidance and fail missing credentials without a stack trace
 *   v2.0.0 -- 2026-05-29 -- Multi-agent serve: registry-driven, per-agent poller, task-runner hook
 *   v2.1.0 -- 2026-05-30 -- v2 purpose-scoped surfaces: `--surface <appdev|agent|service|admin>`
 *     registers only that surface's tool allowlist (shared catalog/surfaces.ts); default 'all'.
 *   v2.2.0 -- 2026-06-10 -- Phase 4: `--http`/`--daemon` loopback daemon mode;
 *     extracted buildMcpServer() so the daemon creates one per local MCP session.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadAllAgents } from '../config.js';
import { buildRegistry, type AgentRegistry } from '../agent-registry.js';
import { registerAllTools } from './tools/index.js';
import { registerResources } from './resources.js';
import { startPollerForAgent } from './poller.js';
import { isRunner } from '../task-runner.js';
import { toolsForSurface, isV2Role, V2_ROLES, type SurfaceRole } from '../../../mcp/catalog/surfaces.js';

/**
 * Build a fully tool-registered MCP server for the given surface role. The
 * stdio path builds exactly one; the loopback daemon builds one per
 * Streamable-HTTP session (mirrors how the node's /v1/mcp works).
 */
export function buildMcpServer(role: SurfaceRole | 'all', registry: AgentRegistry): McpServer {
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
  return mcp;
}

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

  // ── Daemon mode (Phase 4): loopback HTTP surface + one tunnel WS per agent ──
  // Only the daemon binds a port and writes the discovery file, so per-crew
  // stdio spawns (the default below) never collide with it.
  if (flags.http === 'true' || flags.daemon === 'true') {
    const { runServeDaemon } = await import('./local-server.js');
    await runServeDaemon({ registry, buildMcp: () => buildMcpServer(role, registry) });
    if (registry.list().some(isRunner)) {
      console.error('SECURITY: runner.command in per-agent config is exec\'d on task arrival. Trust your ~/.aimeat/ contents.');
    }
    return;
  }

  // ── Stdio mode (default — preserved for CI/serverless) ──
  const mcp = buildMcpServer(role, registry);

  for (const entry of registry.list()) {
    startPollerForAgent(entry);
  }

  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  const summary = registry.list().map(a => {
    // Prefer the explicit per-agent mode (autonomous | interactive | task-runner |
    // coordinator | workstation); fall back to runner detection for legacy configs
    // that predate the mode field. The node record is authoritative -- this is only
    // a local display label.
    const mode = a.config.mode ?? (isRunner(a) ? 'task-runner' : 'interactive');
    return `${a.agent}@${a.owner} [${mode}]`;
  }).join(', ');
  const surfaceNote = role === 'all' ? 'full surface' : `surface '${role}' (${toolsForSurface(role).size} tools)`;
  console.error(`AIMEAT MCP server running [${surfaceNote}]. ${registry.size()} agent(s): ${summary}`);

  if (registry.list().some(isRunner)) {
    console.error('SECURITY: runner.command in per-agent config is exec\'d on task arrival. Trust your ~/.aimeat/ contents.');
  }
}
