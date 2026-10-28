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
 *   2026-10-28 — A refusal's `Held: [...]` list is not read as words the agent lacks: a refused
 *     provenance declaration asked the owner for every word the agent held.
 *   2026-10-16 — A SCOPE_DENIED result is read from its code in either shape a tool answers with:
 *     `SCOPE_DENIED: …` text and a JSON object whose `error` is SCOPE_DENIED (QA audit E5-04).
 *   v1.2.1 — 2026-10-05 — Notes every word a tool needs (requiredScopesForTool; secaudit 2026-10, C3).
 *   v1.2.0 — 2026-10-02 — A successful call notes the permission its tool needs (services/scope-use.ts).
 *   v1.1.0 — 2026-09-30 — A SCOPE_DENIED result to an agent is noted as a refusal
 *     (services/agent-refusals.ts), as auth/deny.ts notes the REST one.
 *   v1.0.0 — 2026-08-14 — Initial: MCP tool calls become a measured surface.
 */
import { recordUsageCall } from '../services/usage/usage-buffer.js';
import { noteAgentRefusal } from '../services/agent-refusals.js';
import { noteScopeUse } from '../services/scope-use.js';
import { requiredScopesForTool } from '../tool-catalog/scopes.js';
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
 * Note an MCP permission refusal of an agent for its owner (services/agent-refusals.ts), as
 * auth/deny.ts notes the REST one. Only an agent principal has a card to note it on; `words` empty
 * notes nothing. Shared with mcp/scope-denied-answer.ts, the refusal of an unregistered tool.
 */
export function noteMcpScopeRefusal(principal: string, words: string[], toolName: string): void {
  if (words.length === 0 || actorKindOf(principal) !== 'agent') return;
  noteAgentRefusal({ sub: principal, roles: ['agent'] }, words, false, `MCP ${toolName}`);
}

/** The error code a failing tool result carries: `CODE: …` text, or a JSON object's `error` or `code`. */
export function resultErrorCode(text: string): string | undefined {
  const prefixed = /^([A-Z][A-Z0-9_]+):/.exec(text)?.[1];
  if (prefixed) return prefixed;
  if (!text.trimStart().startsWith('{')) return undefined;
  try {
    const o = JSON.parse(text) as { error?: unknown; code?: unknown };
    const code = typeof o.error === 'string' ? o.error : typeof o.code === 'string' ? o.code : undefined;
    return code && /^[A-Z][A-Z0-9_]+$/.test(code) ? code : undefined;
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- text that only starts like JSON carries no code
    return undefined;
  }
}

/**
 * The permission words a SCOPE_DENIED tool result names, or none. A tool refuses in the
 * `SCOPE_DENIED: …` shape of mcp/tool-error.ts or as a JSON object whose `error` is SCOPE_DENIED
 * (aimeat_memory_write), and names the word in its sentence, quoted or not; a result that names none
 * is not noted, because a refusal the owner cannot act on helps nobody. A `Held: [...]` list is what
 * the caller has, not what it lacks, and is left out (services/ai-provenance.ts ProvenanceScopeError);
 * services/agent-refusals.ts also drops any word the agent's record holds.
 */
export function scopeDeniedWords(value: unknown): string[] {
  const content = (value as { content?: Array<{ type?: string; text?: unknown }> }).content;
  const text = Array.isArray(content) && typeof content[0]?.text === 'string' ? content[0].text : '';
  if (resultErrorCode(text) !== 'SCOPE_DENIED') return [];
  const asked = text.replace(/\bHeld:\s*\[[^\]]*\]/g, '');
  return [...new Set([...asked.matchAll(/\b([a-z]+:[a-z*][a-z0-9*-]*)\b/g)].map((m) => m[1]))];
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
          noteMcpScopeRefusal(gaii, scopeDeniedWords(result), name);
        } else if (actorKindOf(gaii) === 'agent') {
          // The word this tool needs, for the narrowing a `*` agent's owner is offered
          // (services/scope-use.ts decides at flush whether the agent holds `*`).
          const words = requiredScopesForTool(name);
          if (words.length) noteScopeUse(gaii, words);
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
