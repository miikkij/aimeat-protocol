/**
 * @file tool-dispatch/tool-call-defs-owner-export.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data export tool on the CLI dispatch (`/local/call/<tool>`) and the connector MCP: a
 *   thin REST proxy over /v1/owners/:name/exports*, for the signed-in account, so the node decides
 *   everything (services/owner-export/ops.ts).
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-owner-data-export-as-a-chosen-parts-background-job).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { optionalString } from './tool-call-helpers.js';

export const ownerExportCliTools: ConnectCliToolDefinition[] = [
  {
    // action plan → GET /v1/owners/:name/exports/plan · start → POST /v1/owners/:name/exports ·
    // status → GET /v1/owners/:name/exports/current · cancel → DELETE /v1/owners/:name/exports/current
    name: 'aimeat_account_export',
    handler: async ({ client, config }, input) => {
      const owner = encodeURIComponent(config.owner);
      const action = optionalString(input, 'action');
      if (action === 'plan') return client.get(`/v1/owners/${owner}/exports/plan`);
      if (action === 'start') return client.post(`/v1/owners/${owner}/exports`, input.parts !== undefined ? { parts: input.parts } : {});
      if (action === 'status') return client.get(`/v1/owners/${owner}/exports/current`);
      if (action === 'cancel') return client.delete(`/v1/owners/${owner}/exports/current`);
      throw new Error('action is plan, start, status or cancel.');
    },
  },
];
