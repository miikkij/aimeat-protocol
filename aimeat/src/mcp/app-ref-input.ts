/**
 * @file src/mcp/app-ref-input.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registrar wrapper that turns an app named without `.html` into its stored
 *   filename in every node MCP tool's input, before the tool's own handler reads it. Which fields
 *   name an app, per tool, is the table in services/app/app-ref-inputs.ts; this wrapper only runs it.
 *
 *   WHERE IN THE CHAIN. Nearest the handler (mcp/tool-registrar.ts applies it last), so the gates
 *   in front of it see the call as sent and the handler sees the resolved name.
 * @structure withAppRefInput(register, principal, deps)
 * @usage const r = withAppRefInput(register, () => agentGaii, { storage, config });
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-sovelluksen-nimi-ilman-html-p-tett-kaikkialla).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { APP_REF_INPUTS, normalizeAppRefInput } from '../services/app/app-ref-inputs.js';

type AnyFn = (...args: unknown[]) => unknown;

export function withAppRefInput(
  register: AnyFn, principal: () => string, deps: { storage: Storage; config: AimeatConfig },
): AnyFn {
  return (...args: unknown[]) => {
    const last = args.length - 1;
    const handler = args[last];
    const tool = typeof args[0] === 'string' ? args[0] : '';
    if (typeof handler !== 'function' || !APP_REF_INPUTS[tool]) return register(...args);

    const resolved = async (...handlerArgs: unknown[]): Promise<unknown> => {
      await normalizeAppRefInput(tool, handlerArgs[0], {
        storage: deps.storage, callerOwner: localAccountName(principal()), nodeId: deps.config.nodeId,
      });
      return (handler as AnyFn)(...handlerArgs);
    };

    const next = [...args];
    next[last] = resolved;
    return register(...next);
  };
}
