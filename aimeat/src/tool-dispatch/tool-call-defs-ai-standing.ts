/**
 * @file src/tool-dispatch/tool-call-defs-ai-standing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_ai_standing_get for the shell / local-call dispatch and the connector MCP: a thin
 *   proxy over GET /v1/ai-standing (routes/agents/ai-standing.ts), which decides who may read.
 *   test/unit/cli-tool-param-forwarding.test.ts invokes this handler.
 * @structure aiStandingCliTools[]
 * @usage import { aiStandingCliTools } from './tool-call-defs-ai-standing.js';
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-toimii-itsen-isesti-omistajan-asetuksella-salli-aina-ja-k).
 */
import { optionalString, type ConnectCliToolDefinition } from './tool-call-helpers.js';

export const aiStandingCliTools: ConnectCliToolDefinition[] = [
  {
    // → GET /v1/ai-standing
    name: 'aimeat_ai_standing_get',
    description: 'What your owner lets every one of their AIs do without asking each time ("Allow always"), and where they change it.',
    input: {
      lang: { type: 'string', description: 'The language of the plain words: en, fi or es. Default en.' },
    },
    handler: ({ client }, input) => {
      const lang = optionalString(input, 'lang');
      return client.get(`/v1/ai-standing${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`);
    },
  },
];
