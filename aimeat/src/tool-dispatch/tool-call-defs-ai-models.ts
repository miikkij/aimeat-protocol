/**
 * @file tool-call-defs-ai-models.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The System 2 AI tools for the shell / local-call dispatch, the surface a fleet daemon
 *   calls: aimeat_ai_policy_set over GET and PUT /v1/ai/policy. Every declared field is forwarded;
 *   test/unit/cli-tool-param-forwarding.test.ts proves each one leaves the process.
 * @structure aiModelCliTools[] — registered by tool-dispatch/index.ts
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (System 2 plan, V2).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { optionalRecord, optionalString } from './tool-call-helpers.js';
import { aiModelTools as catalog } from '../mcp/catalog/definitions/ai-models.js';

const def = (name: string) => catalog.find((t) => t.name === name)!;

export const aiModelCliTools: ConnectCliToolDefinition[] = [
  {
    ...def('aimeat_ai_policy_set'),
    handler: ({ client }, input) => {
      const policy = optionalRecord(input, 'policy');
      const token = optionalString(input, 'confirm_token');
      // Nothing given reads; anything given goes to the node as given, which answers a token
      // without a policy with the reason rather than this door dropping it.
      if (!policy && token === undefined) return client.get('/v1/ai/policy');
      return client.put('/v1/ai/policy', { ...(policy ? { policy } : {}), ...(token !== undefined ? { confirm_token: token } : {}) });
    },
  },
];
