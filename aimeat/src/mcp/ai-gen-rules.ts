/**
 * @file ai-gen-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP tools for the generation rules (services/ai/gen-rules.ts): aimeat_ai_gen_rules
 *   reads them, aimeat_ai_gen_rules_set changes the owner's choices.
 *
 *   They do no work of their own. Reading is genRulesView() and changing is setOwnerGenRules(), the
 *   same functions GET and PUT /v1/ai/gen-rules call (services/ai/gen-rules-store.ts), so the
 *   validation, the confirm token and the record are written once. Over MCP the caller is always an
 *   agent, so every change is a proposal first: the AI shows the owner the change, then calls again
 *   with the token. The read is a separate tool with ai:use alone, because every agent that makes or
 *   brings in a picture needs the directive and few of them hold memory:write-reserved.
 * @structure registerAiGenRulesTools(mcp, storage, config, getAgentGaii)
 * @version-history
 *   v1.0.1 — 2026-11-04 — The payer is the session principal's caller facts (`principalCaller(gaii).payer`),
 *     the answer aiPayerOf gave (codebase analysis 2026-11-03, item B1).
 *   v1.0.0 — 2026-10-31 — Initial (wish-image-and-video-generation-people-only-in-an-artistic-non-ph).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { toolError } from './tool-error.js';
import { principalCaller } from '../services/caller-context.js';
import { AiCompletionError } from '../services/ai/errors.js';
import { genRulesView, setOwnerGenRules } from '../services/ai/gen-rules-store.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

export function registerAiGenRulesTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

  mcp.registerTool(
    'aimeat_ai_gen_rules',
    {
        description: descriptionFor('aimeat_ai_gen_rules'),
        inputSchema: zodShapeFor('aimeat_ai_gen_rules'),
        annotations: annotationsFor('aimeat_ai_gen_rules'),
    },
    async () => {
      const { payer, agent } = principalCaller(getAgentGaii()).payer;
      return text(await genRulesView(storage, config, payer, { ownerInPerson: false, ...(agent ? { agent } : {}) }));
    },
  );

  mcp.registerTool(
    'aimeat_ai_gen_rules_set',
    {
        description: descriptionFor('aimeat_ai_gen_rules_set'),
        inputSchema: zodShapeFor('aimeat_ai_gen_rules_set'),
        annotations: annotationsFor('aimeat_ai_gen_rules_set'),
    },
    async ({ gen_rules, confirm_token }) => {
      const principal = getAgentGaii();
      const { payer } = principalCaller(principal).payer;
      try {
        return text(await setOwnerGenRules(storage, config, payer, gen_rules, {
          kind: 'agent', principal, ...(confirm_token ? { confirmToken: confirm_token } : {}),
        }));
      } catch (e) {
        if (e instanceof AiCompletionError) return toolError(e.code, e.message);
        throw e;
      }
    },
  );
}
