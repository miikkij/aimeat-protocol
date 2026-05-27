/**
 * @file resources.ts
 * @description MCP resource providers for handbook, skill bundle, and reference docs.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatClient } from '../lib/api-client.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir, loadConfig } from '../lib/config.js';

const MODULES = ['tasks', 'messages', 'work', 'services', 'memory', 'activity', 'social', 'collaboration', 'appdev', 'mcp'];

export function registerResources(mcp: McpServer, client: AimeatClient): void {
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
      const config = loadConfig();
      if (!config) return { contents: [{ uri: uri.toString(), text: 'Not configured.' }] };
      const path = join(getConfigDir(), config.agent, 'SKILL.md');
      const text = existsSync(path) ? readFileSync(path, 'utf-8') : 'No skill bundle cached. Run: npx @aimeat/connect refresh';
      return { contents: [{ uri: uri.toString(), text, mimeType: 'text/markdown' }] };
    },
  );
}
