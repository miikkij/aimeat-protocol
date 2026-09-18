/**
 * @file prompts-hello-integration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/prompts/hello-integration: the instruction an owner pastes into a newly
 *   connected agent so it completes Hello Integration, served from the node.
 *
 *   The same text the CLI prints after `aimeat connect` and writes into the skill bundle, from the
 *   same function (services/hello-integration-prompt.ts). The profile's Agents tab showed a hand
 *   copy of it, and by 2026-09-18 that copy had fallen two versions behind: it lacked the rule
 *   that only five aimeat_onboarding_* tools exist, and the stop condition. Serving it here is
 *   what lets the page show the CLI's text, and lets a correction reach a page already open
 *   somewhere on the next load.
 *
 *   Public, like the other copy-me prompts: it names no account and no secret, and an agent that
 *   has only the node's address may need it before it has a credential.
 *
 *   Its own file because routes/prompts.ts was at 781 of 800 lines.
 * @structure registerHelloIntegrationPrompt(router, config)
 * @usage registerHelloIntegrationPrompt(router, config);   // before /v1/prompts/:tier
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { success } from '../middleware/envelope.js';
import { sendPlainText } from '../middleware/plain-text.js';
import { buildAgentOnboardingInstruction, HELLO_INTEGRATION_TOOL_SEQUENCE } from '../services/hello-integration-prompt.js';

export function registerHelloIntegrationPrompt(router: Router, config: AimeatConfig): void {
  // MUST be registered before /v1/prompts/:tier.
  router.get('/v1/prompts/hello-integration', (req, res) => {
    const prompt = buildAgentOnboardingInstruction();
    if (req.query.format === 'txt') {
      sendPlainText(res, prompt);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'hello-integration',
      name: 'Hello Integration',
      description: 'Paste into an agent you have just connected over MCP. It walks the first-run handshake: '
        + 'the handbook, the onboarding steps, a test message and the test task.',
      prompt,
      system_prompt: prompt,
      tool_sequence: HELLO_INTEGRATION_TOOL_SEQUENCE,
    }, [
      { description: 'Where onboarding stands for the connected agent', method: 'GET', url: '/v1/agents/me/onboarding' },
    ]));
  });
}
