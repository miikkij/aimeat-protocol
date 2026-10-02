/**
 * @file src/mcp/tool-usage-wrap.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Measures every MCP tool call, in the one place every MCP tool is registered.
 *   Design: docs/internal/telemetria/02-design.md
 *
 *   WHY HERE. MCP is the primary way into this node and, until this file, the only trace any tool
 *   call left was a boolean marker saying an owner had once made their first one. Which tool is
 *   carrying the work, which one fails, which one nobody has ever called: none of it was
 *   answerable. Wrapping at registration means all ~250 tools are covered by one change and a new
 *   tool is measured the day it is added, with nothing for its author to remember.
 *
 *   IT WRAPS THE LAST FUNCTION ARGUMENT. `mcp.tool` has five overloads and `mcp.registerTool` one,
 *   and in every one of them the handler is the final argument. Matching on "last arg that is a
 *   function" is therefore total, where matching on arity would break the first time a new overload
 *   appeared.
 * @structure
 *   - wrapToolHandler(register, principal) -- returns a registrar that times and records each call
 * @usage
 *   patchable.tool = wrapToolHandler(gatedTool, () => agentGaii);
 * @version-history
 *   v1.2.0 — 2026-10-02 — A successful call notes the permission its tool needs (services/scope-use.ts).
 *   v1.1.0 — 2026-09-30 — A SCOPE_DENIED result to an agent is noted as a refusal
 *     (services/agent-refusals.ts), as auth/deny.ts notes the REST one.
 *   v1.0.0 — 2026-08-14 — Initial: MCP tool calls become a measured surface.
 */
import { recordUsageCall } from '../services/usage/usage-buffer.js';
import { noteAgentRefusal } from '../services/agent-refusals.js';
import { noteScopeUse } from '../services/scope-use.js';
import { requiredScopeForTool } from './catalog/scopes.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import type { UsageActorKind } from '../storage/interface.js';

type AnyFn = (...args: unknown[]) => unknown;

/** What kind of principal this is, read from the identity's own shape rather than from a session. */
function actorKindOf(principal: string): UsageActorKind {
  if (principal.startsWith('eco:')) return 'eco';
  if (principal.includes('#')) return 'agent';
  return 'owner';
}

/** An MCP result that says it failed without throwing. Both shapes count as an error. */
function isErrorResult(value: unknown): boolean {
  return !!value && typeof value === 'object' && (value as { isError?: unknown }).isError === true;
}

/**
 * The permission words a SCOPE_DENIED tool result names, or none. A tool refuses in the
 * `SCOPE_DENIED: …` shape of mcp/tool-error.ts and names the word in its sentence, quoted or not;
 * a result that names none is not noted, because a refusal the owner cannot act on helps nobody.
 */
function scopeDeniedWords(value: unknown): string[] {
  const content = (value as { content?: Array<{ type?: string; text?: unknown }> }).content;
  const text = Array.isArray(content) && typeof content[0]?.text === 'string' ? content[0].text : '';
  if (!text.startsWith('SCOPE_DENIED')) return [];
  return [...new Set([...text.matchAll(/\b([a-z]+:[a-z*][a-z0-9*-]*)\b/g)].map((m) => m[1]))];
}

/**
 * Wrap a tool registrar so every handler it registers is timed and recorded. `register` is the
 * already-scope-gated registrar, so a tool this agent may not see is never wrapped and never
 * counted — a filtered tool was not called, it was not offered.
 */
export function wrapToolHandler(register: AnyFn, principal: () => string): AnyFn {
  return (...args: unknown[]) => {
    const name = args[0] as string;
    const last = args.length - 1;
    const handler = args[last];
    if (typeof handler !== 'function') return register(...args);

    const wrapped = async (...handlerArgs: unknown[]): Promise<unknown> => {
      const startedAt = Date.now();
      const gaii = principal();
      let outcome: 'ok' | 'error' = 'ok';
      let reason = '';
      try {
        const result = await (handler as AnyFn)(...handlerArgs);
        if (isErrorResult(result)) {
          outcome = 'error'; reason = 'tool_error_result';
          // A tool that refused the agent a permission is the MCP half of auth/deny.ts: the same
          // note on the agent's card and open tasks (services/agent-refusals.ts).
          const words = actorKindOf(gaii) === 'agent' ? scopeDeniedWords(result) : [];
          if (words.length) noteAgentRefusal({ sub: gaii, roles: ['agent'] }, words, false, `MCP ${name}`);
        } else if (actorKindOf(gaii) === 'agent') {
          // The word this tool needs, for the narrowing a `*` agent's owner is offered
          // (services/scope-use.ts decides at flush whether the agent holds `*`).
          const word = requiredScopeForTool(name);
          if (word) noteScopeUse(gaii, [word]);
        }
        return result;
      } catch (err) {
        // Recorded, then rethrown untouched. Swallowing here would turn a failing tool into a
        // silently failing one, which is the opposite of what measuring it is for.
        outcome = 'error';
        reason = err instanceof Error ? err.name : 'throw';
        throw err;
      } finally {
        recordUsageCall({
          ownerGhii: ownerGhiiOf(gaii),
          actorGaii: gaii,
          actorKind: actorKindOf(gaii),
          surface: 'mcp',
          coordinate: name,
          outcome,
          reason,
          durationMs: Date.now() - startedAt,
        });
      }
    };

    const next = [...args];
    next[last] = wrapped;
    return register(...next);
  };
}
