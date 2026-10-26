/**
 * @file src/tool-dispatch/tool-call-defs-dm-reactions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_dm_react for the shell / local-call dispatch and the connector MCP: a thin proxy
 *   over POST/DELETE /v1/messages/:id/reactions (routes/message-reactions.ts), which decides who may.
 *   The description and inputs are the catalog's (tool-catalog/definitions/dm-reactions.ts);
 *   test/unit/cli-tool-param-forwarding.test.ts invokes the handler.
 * @structure dmReactionCliTools[]
 * @usage import { dmReactionCliTools } from './tool-call-defs-dm-reactions.js';
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (wish-kuittausreaktiot-yksitt-isiin-viesteihin-viestit-ketjuissa).
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { optionalBoolean, query, requiredString } from './tool-call-helpers.js';

export const dmReactionCliTools: ConnectCliToolDefinition[] = [
  {
    // → POST /v1/messages/:id/reactions, or DELETE with remove:true
    name: 'aimeat_dm_react',
    handler: ({ client }, input) => {
      const id = encodeURIComponent(requiredString(input, 'message_id'));
      const reaction = requiredString(input, 'reaction');
      const asOwner = optionalBoolean(input, 'as_owner');
      if (optionalBoolean(input, 'remove') === true) {
        return client.delete(`/v1/messages/${id}/reactions${query({ reaction, as_owner: asOwner === undefined ? undefined : String(asOwner) })}`);
      }
      const body: JsonObject = { reaction };
      if (asOwner !== undefined) body.as_owner = asOwner;
      return client.post(`/v1/messages/${id}/reactions`, body);
    },
  },
];
