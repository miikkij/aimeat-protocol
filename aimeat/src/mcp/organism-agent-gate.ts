/**
 * @file src/mcp/organism-agent-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refuses a node MCP tool call that names an organism (`organism_id`) which does not
 *   admit this agent (agentAccess 'listed', services/organism-agent-access.ts). Every MCP session is
 *   an agent, and the organism tools resolve the agent's owner and check the owner's membership, so
 *   without this an agent passes wherever its owner does. Applied at registration, like the usage
 *   measurement in tool-usage-wrap.ts, so a tool added later is covered without its author knowing
 *   the rule exists. The connector MCP calls the REST routes, which carry the same guard
 *   (routes/organisms.ts).
 * @structure withOrganismAgentGate(register, principal, storage) → a registrar
 * @usage patchable.tool = withOrganismAgentGate(originalTool, () => agentGaii, storage);
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import type { Storage } from '../storage/interface.js';
import { barredAgentFor, agentBarredMessage } from '../services/organism-agent-access.js';
import { toolError } from './tool-error.js';

type AnyFn = (...args: unknown[]) => unknown;

export function withOrganismAgentGate(register: AnyFn, principal: () => string, storage: Pick<Storage, 'getOrganism'>): AnyFn {
  return (...args: unknown[]) => {
    const last = args.length - 1;
    const handler = args[last];
    if (typeof handler !== 'function') return register(...args);

    const gated = async (...handlerArgs: unknown[]): Promise<unknown> => {
      const input = handlerArgs[0] as { organism_id?: unknown } | undefined;
      const organismId = input && typeof input === 'object' ? input.organism_id : undefined;
      if (typeof organismId === 'string' && organismId) {
        const gaii = principal();
        const organism = await barredAgentFor(storage, organismId, gaii);
        if (organism) {
          // The same code the REST routes answer (routes/organisms.ts).
          return toolError('AGENT_NOT_ADMITTED', agentBarredMessage(organism, gaii));
        }
      }
      return (handler as AnyFn)(...handlerArgs);
    };

    const next = [...args];
    next[last] = gated;
    return register(...next);
  };
}
