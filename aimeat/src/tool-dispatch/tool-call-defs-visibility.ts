/**
 * @file src/tool-dispatch/tool-call-defs-visibility.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI visibility tools for the shell / local-call dispatch and the connector MCP,
 *   over /v1/visibility/* (routes/visibility.ts). Every field the node MCP declares is forwarded
 *   here; test/unit/cli-tool-param-forwarding.test.ts proves each one leaves the process.
 * @structure visibilityCliTools[]
 * @usage import { visibilityCliTools } from './tool-call-defs-visibility.js';
 * @version-history
 *   v1.0.0 -- 2026-10-08 -- Initial, for AI visibility (layer A).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { optionalNumber, optionalBoolean, requiredValue } from './tool-call-helpers.js';

export const visibilityCliTools: ConnectCliToolDefinition[] = [
  {
    // → GET /v1/visibility/report?days=
    name: 'aimeat_visibility_report',
    description: 'How people and AIs find the person\'s place over the last `days` days: channels, AI referrals, AI fetches by page, discovery-file fetches and purchases by channel.',
    input: {
      days: { type: 'number', description: 'The window in days. 0 is today only. Default 30, at most 400.' },
    },
    handler: ({ client }, input) => {
      const days = optionalNumber(input, 'days');
      return client.get(`/v1/visibility/report${days === undefined ? '' : `?days=${encodeURIComponent(String(days))}`}`);
    },
  },
  {
    // → PUT /v1/visibility/settings
    name: 'aimeat_visibility_settings_set',
    description: 'Switch AI visibility counting off or on for the person\'s whole place. On by default.',
    input: {
      enabled: { type: 'boolean', required: true, description: 'true counts, false stops counting.' },
    },
    handler: ({ client }, input) => {
      requiredValue(input, 'enabled');
      const enabled = optionalBoolean(input, 'enabled');
      if (enabled === undefined) throw new Error('enabled must be true or false');
      return client.put('/v1/visibility/settings', { enabled });
    },
  },
];
