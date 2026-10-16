/**
 * @file src/mcp/tool-registrar.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The wrapper chain every node MCP tool is registered through, as one function, so
 *   mcp/index.ts and the tests build the same chain.
 *
 *   ORDER, from the SDK inward to the tool's own handler:
 *     1. deferred-scope notice (mcp/deferred-scope-notice.ts) counts a call made without a word the
 *        tool names for a later release; outermost, so it sees the call itself.
 *     2. next step (mcp/error-next-step.ts) appends what to do next to every failing result.
 *     3. fault (mcp/tool-fault.ts) logs, reports and answers a throw or a caught internal error.
 *        Inside the next step, so the fault answer also says what to do next.
 *     4. usage (mcp/tool-usage-wrap.ts) records the call; it sees a throw before the fault wrapper
 *        answers it, so the usage row keeps the error class.
 *     5. organism agent gate (mcp/organism-agent-gate.ts) refuses an agent an organism does not admit;
 *        innermost, so the refusal is measured and carries a next step.
 *   A registrar wrapper applied first is the one nearest the handler, so the calls below read inside out.
 * @structure toolRegistrar(register, deps)
 * @usage const measuredTool = toolRegistrar(originalTool, { scopes: () => scopes, principal: () => agentGaii, storage, config });
 * @version-history
 *   2026-10-16 — Moved out of mcp/index.ts, with the fault wrapper added (QA audit E1-01, D2-01, F5-02, E2-02, E5-01).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { wrapToolHandler } from './tool-usage-wrap.js';
import { withOrganismAgentGate } from './organism-agent-gate.js';
import { withErrorNextStep } from './error-next-step.js';
import { withDeferredScopeNotice } from './deferred-scope-notice.js';
import { withToolFault } from './tool-fault.js';

type AnyFn = (...args: unknown[]) => unknown;

export interface ToolRegistrarDeps {
  scopes: () => readonly string[];
  principal: () => string;
  storage: Storage;
  config: AimeatConfig;
}

export function toolRegistrar(register: AnyFn, deps: ToolRegistrarDeps): AnyFn {
  const noticed = withDeferredScopeNotice(register, deps.scopes);
  const stepped = withErrorNextStep(noticed);
  const faulted = withToolFault(stepped, { storage: deps.storage, config: deps.config, principal: deps.principal });
  return withOrganismAgentGate(wrapToolHandler(faulted, deps.principal), deps.principal, deps.storage);
}
