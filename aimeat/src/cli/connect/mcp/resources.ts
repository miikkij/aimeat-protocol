/**
 * @file resources.ts
 * @description MCP resource providers for handbook, skill bundle, and reference
 *   docs. In multi-agent mode, resources use the registry's primary agent
 *   (single-agent installs are unaffected). Per-agent resource URIs
 *   (`aimeat://{agent}/handbook`) are a future enhancement -- see the MCP rich
 *   rendering implementation spec.
 * @structure Registers connector-local handbook and skill bundle resources for MCP clients.
 * @usage Called by the `aimeat connect serve` MCP server.
 * @version-history
 *   v1.9.4 -- 2026-05-28 -- Update connector guidance to the integrated AIMEAT CLI command
 *   v2.0.0 -- 2026-05-29 -- Registry-driven (primary agent's handbook/bundle)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../agent-registry.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../config.js';

const MODULES = ['tasks', 'messages', 'work', 'services', 'memory', 'activity', 'social', 'collaboration', 'appdev', 'mcp'];

export function registerResources(mcp: McpServer, registry: AgentRegistry): void {
  const { client, agent } = registry.resolve();

  mcp.resource(
    'handbook',
    'aimeat://handbook',
    { mimeType: 'application/json', description: 'Agent operating handbook' },
    async (uri) => {
      const resp = await client.get('/v1/agents/me/handbook');
      return { contents: [{ uri: uri.toString(), text: JSON.stringify(resp.data, null, 2), mimeType: 'application/json' }] };
    },
  );

  for (const mod of MODULES) {
    mcp.resource(
      `handbook-${mod}`,
      `aimeat://handbook/${mod}`,
      { mimeType: 'application/json', description: `Handbook module: ${mod}` },
      async (uri) => {
        const resp = await client.get(`/v1/agents/me/handbook/${mod}`);
        return { contents: [{ uri: uri.toString(), text: JSON.stringify(resp.data, null, 2), mimeType: 'application/json' }] };
      },
    );
  }

  mcp.resource(
    'skill-bundle',
    'aimeat://skill-bundle',
    { mimeType: 'text/markdown', description: 'Cached SKILL.md from last download' },
    async (uri) => {
      const path = join(getConfigDir(), agent, 'SKILL.md');
      const text = existsSync(path) ? readFileSync(path, 'utf-8') : 'No skill bundle cached. Run: aimeat connect refresh';
      return { contents: [{ uri: uri.toString(), text, mimeType: 'text/markdown' }] };
    },
  );
}
