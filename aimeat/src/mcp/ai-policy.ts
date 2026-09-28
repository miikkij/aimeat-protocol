/**
 * @file ai-policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP tool for the owner's model policy (System 2 plan, V2): aimeat_ai_policy_set.
 *
 *   It does no work of its own. Reading is policyView() and changing is setOwnerAiPolicy(), the same
 *   functions GET and PUT /v1/ai/policy call (services/ai/policy-store.ts), so the validation, the
 *   confirm token and the record are written once. Over MCP every change is a proposal first, whoever
 *   is connected: the AI shows the owner the change, then calls again with the token.
 * @structure registerAiPolicyTools(mcp, storage, config, getAgentGaii)
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { toolError } from './tool-error.js';
import { aiPayerOf } from '../services/agent-ai-keys.js';
import { AiCompletionError } from '../services/ai/errors.js';
import { policyView, setOwnerAiPolicy } from '../services/ai/policy-store.js';

export function registerAiPolicyTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

  mcp.tool(
    'aimeat_ai_policy_set',
    descriptionFor('aimeat_ai_policy_set'),
    {
      policy: z.record(z.string(), z.unknown()).optional().describe('The policy to propose: { mode, allow?, appliesTo?, apps?, agents? }. Omit to read.'),
      confirm_token: z.string().optional().describe('Token from the propose step; omit to propose.'),
    },
    annotationsFor('aimeat_ai_policy_set'),
    async ({ policy, confirm_token }) => {
      const principal = getAgentGaii();
      const { payer } = aiPayerOf(principal);
      try {
        if (!policy) return text({ mode: 'current', ...(await policyView(storage, config, payer)) });
        return text(await setOwnerAiPolicy(storage, payer, policy, {
          kind: 'agent', principal, ...(confirm_token ? { confirmToken: confirm_token } : {}),
        }));
      } catch (e) {
        if (e instanceof AiCompletionError) return toolError(e.code, e.message);
        throw e;
      }
    },
  );
}
