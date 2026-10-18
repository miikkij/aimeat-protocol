/**
 * @file src/tool-dispatch/tool-call-defs-account-rights.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_adult_status, aimeat_subscription_list, aimeat_subscription_cancel and
 *   aimeat_provenance_embed for the shell / local-call dispatch and the connector MCP: thin proxies over
 *   GET /v1/ghii/me/adult, GET /v1/commerce/subscriptions, POST /v1/commerce/subscriptions/:ext/:plan/cancel
 *   and POST /v1/provenance/embed, which decide who may do what. test/unit/cli-tool-param-forwarding.test.ts
 *   invokes these handlers.
 * @structure accountRightsCliTools[]
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-3, A-5, A-8).
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalBoolean } from './tool-call-helpers.js';

export const accountRightsCliTools: ConnectCliToolDefinition[] = [
  {
    // → GET /v1/ghii/me/adult
    name: 'aimeat_adult_status',
    handler: ({ client }) => client.get('/v1/ghii/me/adult'),
  },
  {
    // → GET /v1/commerce/subscriptions
    name: 'aimeat_subscription_list',
    handler: ({ client }) => client.get('/v1/commerce/subscriptions'),
  },
  {
    // → POST /v1/commerce/subscriptions/:ext/:plan/cancel
    name: 'aimeat_subscription_cancel',
    handler: ({ client }, input) => client.post(
      `/v1/commerce/subscriptions/${encodeURIComponent(requiredString(input, 'ext'))}/${encodeURIComponent(requiredString(input, 'plan'))}/cancel`, {}),
  },
  {
    // → POST /v1/provenance/embed
    name: 'aimeat_provenance_embed',
    handler: ({ client }, input) => {
      const body: JsonObject = { storage_key: requiredString(input, 'storage_key'), provenance_ids: Array.isArray(input.provenance_ids) ? input.provenance_ids : [] };
      const out = optionalString(input, 'output_key'); if (out) body.output_key = out;
      const composite = optionalBoolean(input, 'composite'); if (composite !== undefined) body.composite = composite;
      return client.post('/v1/provenance/embed', body);
    },
  },
];
