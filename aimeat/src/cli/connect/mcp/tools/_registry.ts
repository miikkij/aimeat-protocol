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
    "Target agent name. Optional when only one agent is connected; when multiple are connected, defaults to the agent marked 'primary: true' in its per-agent config (or the first one if none is marked).",
  );

export function pickAgent(registry: AgentRegistry, agentName?: string): RegisteredAgent {
  return registry.resolve(agentName);
}
