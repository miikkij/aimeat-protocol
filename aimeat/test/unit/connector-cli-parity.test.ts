/**
 * @file connector-cli-parity.test.ts
 * @description Guards the connector's SHELL-CALLABLE surface (`aimeat connect call <tool>`). Every
 *   tool the catalog advertises as cli-callable (`visibility.cliFallback`) MUST have a handler in
 *   CONNECT_CLI_TOOLS — otherwise `aimeat connect tools` lists a tool that `aimeat connect call` then
 *   rejects with "Unknown CLI-callable tool" (a listed-but-not-callable lie). This caught the missing
 *   workspace_* / organism create/backup handlers that blocked deterministic CrewAI crews from
 *   reading/writing organism workspaces through the no-LLM shell path.
 * @version-history
 *   v1.0.0 -- 2026-06-09 -- Initial: cliFallback ↔ CONNECT_CLI_TOOLS parity, both directions.
 */
import { describe, it, expect } from 'vitest';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../../src/mcp/catalog/definitions.js';
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';

/**
 * cliFallback defs that KNOWINGLY have no shell handler yet. Each needs an agent-facing REST route the
 * connector can wrap before it leaves this list. Adding a NEW cliFallback tool without a handler (or
 * deleting a handler) fails the test below — intentional: the shell surface must not advertise a tool
 * it cannot run. To close one: add a handler to CONNECT_CLI_TOOLS and delete it from here.
 */
const KNOWN_MISSING_CLI_HANDLERS = [
  // No agent-facing REST route — the server MCP reads storage directly (storage.listMessages).
  'aimeat_message_history',
].sort();

const WORKSPACE_AND_ORGANISM_SHELL_TOOLS = [
  'aimeat_workspace_list', 'aimeat_workspace_read', 'aimeat_workspace_write', 'aimeat_workspace_publish',
  'aimeat_workspace_update', 'aimeat_workspace_create', 'aimeat_workspace_object_delete',
  'aimeat_workspace_access', 'aimeat_workspace_transfer',
  'aimeat_organism_create', 'aimeat_organism_export', 'aimeat_organism_import',
];

describe('connector shell-callable parity', () => {
  const handlers = new Set(CONNECT_CLI_TOOLS.map(t => t.name));
  const cliDefNames = CLI_FALLBACK_TOOL_DEFINITIONS.filter(d => d.visibility.cliFallback).map(d => d.name);

  it('every cliFallback tool has a shell handler (except the documented gaps)', () => {
    const missing = cliDefNames.filter(n => !handlers.has(n)).sort();
    expect(missing).toEqual(KNOWN_MISSING_CLI_HANDLERS);
  });

  it('no shell handler exists for a tool that is not cliFallback (no orphans)', () => {
    const defNames = new Set(cliDefNames);
    const orphans = [...handlers].filter(n => !defNames.has(n)).sort();
    expect(orphans).toEqual([]);
  });

  it('the workspace + organism tools are shell-callable (the gap this closed)', () => {
    for (const tool of WORKSPACE_AND_ORGANISM_SHELL_TOOLS) {
      expect(handlers.has(tool), `${tool} must have a CONNECT_CLI_TOOLS handler`).toBe(true);
    }
  });
});
