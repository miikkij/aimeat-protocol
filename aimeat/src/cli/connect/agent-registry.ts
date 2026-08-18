/**
 * @file agent-registry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description In-memory registry of loaded agents for the connector. One MCP
 *   server process can hold N agents; tool handlers receive the registry and
 *   call `resolve(agent_name?)` to pick the right credential per request.
 *
 *   When only one agent is loaded, `agent_name` is optional and defaults to it
 *   (preserves the single-agent UX from the original CLI). When two or more are
 *   loaded, `agent_name` is required and a clear error lists the available
 *   names if it is missing or unknown.
 *
 * @structure
 *   - `RegisteredAgent` -- one entry per loaded agent (name, owner, client, per-agent config)
 *   - `AgentRegistry` -- holds the entries, exposes resolve/get/list/size
 *
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Initial multi-agent registry
 */
import { AimeatClient } from './api-client.js';
import type { AimeatPerAgentConfig, LoadedAgent } from './config.js';

export interface RegisteredAgent {
  agent: string;
  owner: string;
  client: AimeatClient;
  config: AimeatPerAgentConfig;
}

export class AgentRegistry {
  private agents = new Map<string, RegisteredAgent>();

  add(entry: RegisteredAgent): void {
    this.agents.set(entry.agent, entry);
  }

  get(name: string): RegisteredAgent | undefined {
    return this.agents.get(name);
  }

  list(): RegisteredAgent[] {
    return Array.from(this.agents.values());
  }

  size(): number {
    return this.agents.size;
  }

  /**
   * Resolve which agent a tool call should target.
   *
   * - 0 agents loaded   -> throw
   * - 1 agent loaded    -> return it (agent_name parameter ignored if absent)
   * - 2+ agents loaded, agent_name given -> look it up; throw helpful error if not found
   * - 2+ agents loaded, no agent_name -> return the one marked `primary: true` in
   *   per-agent config. If none is marked primary, return the first one and emit
   *   a one-line warning to stderr so the operator knows to set primary.
   *
   * The thrown errors carry useful context for the LLM to recover (lists what
   * names are available) so tool calls can be retried with the right argument.
   */
  resolve(agentName?: string): RegisteredAgent {
    if (this.agents.size === 0) {
      throw new Error('No agents loaded. Run `aimeat connect` to register one.');
    }
    if (this.agents.size === 1) {
      return this.agents.values().next().value!;
    }
    if (agentName) {
      const found = this.agents.get(agentName);
      if (!found) {
        const available = Array.from(this.agents.keys()).sort().join(', ');
        throw new Error(`Agent '${agentName}' is not loaded. Available: ${available}`);
      }
      return found;
    }
    const primary = this.list().find(a => a.config.primary);
    if (primary) return primary;
    const fallback = this.agents.values().next().value!;
    if (!this.warnedNoPrimary) {
      this.warnedNoPrimary = true;
      const available = Array.from(this.agents.keys()).sort().join(', ');
      console.error(`[registry] Multiple agents loaded but none is marked primary. Defaulting to '${fallback.agent}'. Set 'primary: true' in one of: ${available} to silence this warning.`);
    }
    return fallback;
  }

  private warnedNoPrimary = false;
}

/** Build a fresh registry from `loadAllAgents()` output. */
export function buildRegistry(loaded: LoadedAgent[]): AgentRegistry {
  const reg = new AgentRegistry();
  for (const a of loaded) {
    const client = new AimeatClient(a.config.node_url, a.token);
    reg.add({ agent: a.agent, owner: a.owner, client, config: a.config });
  }
  return reg;
}
