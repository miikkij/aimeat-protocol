/**
 * @file src/mcp/deferred-scope-notice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP half of the REST scope gates of 4.0.0 (auth/rest-scope-gate.ts). A tool whose
 *   catalog entry names a word with `scopeEnforcedFrom` is still offered to a session without the word
 *   before that release (tool-catalog/scopes.ts enforcedScopesForTool). Each call it then makes without
 *   the word is counted under the same kind its REST twin counts (`rest_scope_missing:<word>`, GET
 *   /v1/stats deprecated_use_by_type) and logged once a day, so an operator sees one number per word
 *   whichever surface the agent used. From the release on, the tool is not offered without the word,
 *   and this wrapper finds nothing to count.
 * @structure withDeferredScopeNotice(register, scopes)
 * @usage const tool = withDeferredScopeNotice(originalTool, () => scopes);
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
 */
import { deferredScopesForTool } from '../tool-catalog/scopes.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { REST_SCOPE_GATES_ENFORCED_IN, restScopeKind } from '../utils/rest-scope-release.js';
import { noteDeprecatedUse } from '../services/deprecation.js';

type AnyFn = (...args: unknown[]) => unknown;

/** Wrap a tool registrar so a call made without a not-yet-enforced word is counted before it runs. */
export function withDeferredScopeNotice(register: AnyFn, scopes: () => readonly string[]): AnyFn {
  return (...args: unknown[]) => {
    const name = args[0] as string;
    const last = args.length - 1;
    const handler = args[last];
    if (typeof handler !== 'function' || deferredScopesForTool(name).length === 0) return register(...args);
    const wrapped = (...handlerArgs: unknown[]): unknown => {
      for (const word of deferredScopesForTool(name)) {
        if (scopeIsCovered(scopes(), word)) continue;
        noteDeprecatedUse({
          kind: restScopeKind(word),
          removedIn: REST_SCOPE_GATES_ENFORCED_IN,
          notice: `The MCP tool ${name} was called without the scope "${word}". The call was allowed.`,
        }, { tool: name });
      }
      return (handler as AnyFn)(...handlerArgs);
    };
    const next = [...args];
    next[last] = wrapped;
    return register(...next);
  };
}
