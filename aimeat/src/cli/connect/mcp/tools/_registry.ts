/**
 * @file _registry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared helpers for MCP tool registrations in multi-agent mode.
 *   Every tool's input schema gets `agent_name: agentNameSchema` and every
 *   handler calls `pickAgent(registry, agent_name)` to get the right client +
 *   agent name. Single-agent installs are unaffected -- the parameter is
 *   optional and defaults to the only loaded agent.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Initial multi-agent tool helpers
 */
import { z } from 'zod';
import type { AgentRegistry, RegisteredAgent } from '../../agent-registry.js';

export const agentNameSchema = z
  .string()
  .optional()
  .describe(
    "Which agent to act as. Optional when only one is connected; with several, defaults to the one marked 'primary: true' in its per-agent config (or the first if none is). A bare name works when only one connected agent has it; when two owners on this connector share a name, that is refused and both full identities are named, and you pass one of those instead.",
  );

export function pickAgent(registry: AgentRegistry, agentName?: string): RegisteredAgent {
  return registry.resolve(agentName);
}
