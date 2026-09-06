/**
 * @file agent-registry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description In-memory registry of loaded agents for the connector. One MCP
 *   server process can hold N agents; tool handlers receive the registry and
 *   call `resolve(agent_name?)` to pick the right credential per request.
 *
 *   KEYED BY GAII, NOT BY NAME. `concierge#alice@node` and `concierge#bob@node` are two identities,
 *   and this map holds several at once — so keying it by the bare name meant the second `concierge`
 *   silently replaced the first, with no error and load order deciding which one a task reached.
 *   The basic-agents button gives every owner the same three names, so that happened the first time
 *   two people shared a daemon. `add()` now REFUSES a true duplicate: an identity arriving twice is
 *   a bug in the caller, and the old behaviour was to lose one of them quietly.
 *
 *   A BARE NAME IS STILL WHAT CALLERS SEND, and that is fine. `X-Aimeat-Agent: concierge` resolves
 *   to a GAII when exactly one loaded agent has that name, which is every single-owner daemon and
 *   therefore unchanged. When two owners on this daemon both have it, the call is REFUSED and both
 *   GAIIs are named — picking one would be the silent-replace defect moved one layer up. A caller
 *   that knows exactly what it means may send the full GAII instead.
 *
 * @structure
 *   - `RegisteredAgent` -- one entry per loaded agent (gaii, name, owner, client, per-agent config)
 *   - `AgentRegistry` -- holds the entries by GAII, exposes resolve/get/list/size
 *
 * @version-history
 *   v1.2.0 -- 2026-09-06 -- Each client is wired to re-mint after a scope refusal: forget the cached
 *     token, resolve a fresh one. This layer is the one that knows the agent and owner.
 *   v1.2.0 -- 2026-09-02 -- remove(gaii). The counterpart to add()'s refusal: an entry may not be
 *     replaced silently, but it may be removed deliberately and added again, which is what a
 *     deleted-and-recreated agent needs -- same identity, a different credential.
 *   v1.1.0 -- 2026-09-01 -- Keyed by GAII. The bare name resolves when unambiguous and refuses when
 *     it is not; a duplicate identity is refused instead of overwriting the one already there.
 *   v1.0.0 -- 2026-05-29 -- Initial multi-agent registry
 */
import { AimeatClient } from './api-client.js';
import { forgetCachedToken, resolveToken } from './agent-key.js';
import { isGaii } from './agent-gaii.js';
import type { AimeatPerAgentConfig, LoadedAgent } from './config.js';
import { logger } from '../../utils/logger.js';

export interface RegisteredAgent {
  /** `agent#owner@node`. The identity, and the key of every map that can hold more than one. */
  gaii: string;
  /** The bare name. For display and for the header callers already send — never a map key. */
  agent: string;
  owner: string;
  client: AimeatClient;
  config: AimeatPerAgentConfig;
}

/** How an agent is named to a person: `concierge@alice` reads better than the full GAII. */
export function displayName(entry: { agent: string; owner: string }): string {
  return `${entry.agent}@${entry.owner}`;
}

export class AgentRegistry {
  private agents = new Map<string, RegisteredAgent>();

  /**
   * Add one identity. Refuses a second entry for the same GAII rather than replacing it — the
   * silent replace is the defect this class was re-keyed to remove, and doing it by GAII instead of
   * by name would only make it rarer, not gone.
   */
  add(entry: RegisteredAgent): void {
    const existing = this.agents.get(entry.gaii);
    if (existing) {
      throw new Error(`Agent ${entry.gaii} is already loaded. Two credentials claim one identity; remove one from the keychain.`);
    }
    this.agents.set(entry.gaii, entry);
  }

  /**
   * Forget one identity, by GAII. The counterpart to `add()`'s refusal: an entry may not be
   * replaced silently, but it may be removed deliberately and then added again — which is what a
   * deleted-and-recreated agent needs, since its new credential is a different one for the same
   * identity. Returns whether anything was there.
   */
  remove(gaii: string): boolean {
    return this.agents.delete(gaii);
  }

  /** By GAII, or by bare name when exactly one loaded agent has it. Undefined when ambiguous. */
  get(identifier: string): RegisteredAgent | undefined {
    const direct = this.agents.get(identifier);
    if (direct) return direct;
    const byName = this.list().filter(a => a.agent === identifier);
    return byName.length === 1 ? byName[0] : undefined;
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
   * - 1 agent loaded    -> return it (identifier ignored if absent)
   * - identifier given  -> a GAII matches directly; a bare name matches when exactly one agent
   *                       carries it, and is REFUSED naming both GAIIs when two owners do
   * - 2+ loaded, none given -> the one marked `primary: true`, else the first with a warning
   *
   * The thrown errors carry useful context for the LLM to recover (they list what is available) so
   * tool calls can be retried with the right argument.
   */
  resolve(identifier?: string): RegisteredAgent {
    if (this.agents.size === 0) {
      throw new Error('No agents loaded. Run `aimeat connect` to register one.');
    }
    if (identifier) {
      const direct = this.agents.get(identifier);
      if (direct) return direct;
      const byName = this.list().filter(a => a.agent === identifier);
      if (byName.length === 1) return byName[0];
      if (byName.length > 1) {
        // Two owners, one name. Choosing between them is what used to happen by accident.
        const both = byName.map(a => a.gaii).sort().join(', ');
        throw new Error(`'${identifier}' is the name of more than one agent on this connector: ${both}. Say which one by sending its full identity instead of the name.`);
      }
      if (isGaii(identifier)) {
        throw new Error(`Agent ${identifier} is not loaded. Loaded: ${this.identities()}`);
      }
      throw new Error(`Agent '${identifier}' is not loaded. Available: ${this.names()}`);
    }
    if (this.agents.size === 1) {
      return this.agents.values().next().value!;
    }
    // PRIMARY IS PER OWNER. "Which is the default" only means something inside one account, so two
    // owners each marking one is not a conflict to resolve — it is two correct answers to two
    // different questions, and a caller who named neither an owner nor an agent has not asked
    // either of them. Refusing is the same rule the bare name already follows.
    const primaries = this.list().filter(a => a.config.primary);
    const owners = new Set(primaries.map(a => a.owner));
    if (owners.size > 1) {
      const both = primaries.map(a => a.gaii).sort().join(', ');
      throw new Error(`More than one account is connected here and each has its own default agent: ${both}. Say which one you mean.`);
    }
    if (primaries.length >= 1) return primaries[0];

    // Nobody marked one. With two OWNERS present, picking the first is the same wrong guess.
    const allOwners = new Set(this.list().map(a => a.owner));
    if (allOwners.size > 1) {
      throw new Error(`More than one account is connected here and none has a default agent: ${this.identities()}. Say which one you mean.`);
    }
    const fallback = this.agents.values().next().value!;
    if (!this.warnedNoPrimary) {
      this.warnedNoPrimary = true;
      console.error(`[registry] Multiple agents loaded but none is marked primary. Defaulting to '${displayName(fallback)}'. Set 'primary: true' in one of: ${this.names()} to silence this warning.`);
    }
    return fallback;
  }

  /** The bare names, for a message to a person. Duplicated names appear once each, owner-qualified. */
  private names(): string {
    const counts = new Map<string, number>();
    for (const a of this.list()) counts.set(a.agent, (counts.get(a.agent) ?? 0) + 1);
    return this.list()
      .map(a => ((counts.get(a.agent) ?? 0) > 1 ? displayName(a) : a.agent))
      .sort().join(', ');
  }

  /** The full identities, for a message about one. */
  private identities(): string {
    return this.list().map(a => a.gaii).sort().join(', ');
  }

  private warnedNoPrimary = false;
}

/**
 * Build a fresh registry from `loadAllAgents()` output.
 *
 * A duplicate identity is logged and skipped rather than thrown, because one bad pair in the
 * keychain must not stop the other agents from being served. `add()` throws so a programming
 * caller hears about it; this loop is the one place with a reason to carry on.
 */
export function buildRegistry(loaded: LoadedAgent[]): AgentRegistry {
  const reg = new AgentRegistry();
  for (const a of loaded) {
    const client = new AimeatClient(a.config.node_url, a.token);
    // The cache is dropped FIRST, or resolveToken hands back the very token the node just refused.
    // This is the whole remedy for a granted permission not reaching a running agent: one refusal,
    // one fresh mint, one retry — instead of an hour of silence ended by restarting the daemon.
    client.setReauth(async () => {
      forgetCachedToken(a.agent, a.owner);
      return resolveToken(a.agent, a.owner, a.config.node_url).catch(err => {
        logger.warn('registry: could not re-mint after a scope refusal', { agent: a.agent, error: String(err) });
        return null;
      });
    });
    try {
      reg.add({ gaii: a.gaii, agent: a.agent, owner: a.owner, client, config: a.config });
    } catch (err) {
      logger.warn('registry: a duplicate identity was not loaded', { gaii: a.gaii, error: String(err) });
    }
  }
  return reg;
}
