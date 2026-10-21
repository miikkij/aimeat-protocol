/**
 * @file src/tool-dispatch/tool-call-defs-dm-groups.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The aimeat_dm_group_* tools for the shell / local-call dispatch and the connector MCP:
 *   thin proxies over /v1/messages/groups/* (routes/message-groups.ts), which decide who may do what.
 *   Descriptions and inputs are the catalog's (tool-catalog/definitions/dm-groups.ts);
 *   test/unit/cli-tool-param-forwarding.test.ts invokes these handlers.
 * @structure dmGroupCliTools[]
 * @usage import { dmGroupCliTools } from './tool-call-defs-dm-groups.js';
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial (wish-ryhm-keskustelu-viestit-puolelle).
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { optionalArray, optionalBoolean, requiredString, withProvenanceFields } from './tool-call-helpers.js';

const groupPath = (input: Record<string, unknown>, tail = '') =>
  `/v1/messages/groups/${encodeURIComponent(requiredString(input, 'conversation_id'))}${tail}`;

/** `as_owner` travels only when it was given, so the route's default applies otherwise. */
const withAsOwner = (body: JsonObject, input: Record<string, unknown>): JsonObject => {
  const asOwner = optionalBoolean(input, 'as_owner');
  return asOwner === undefined ? body : { ...body, as_owner: asOwner };
};

export const dmGroupCliTools: ConnectCliToolDefinition[] = [
  {
    // → POST /v1/messages/groups
    name: 'aimeat_dm_group_create',
    handler: ({ client }, input) => {
      const members = optionalArray(input, 'members');
      if (!members) throw new Error('Missing required array field: members');
      const body: JsonObject = { members, subject: requiredString(input, 'subject'), body: requiredString(input, 'body') };
      return client.post('/v1/messages/groups', withProvenanceFields(withAsOwner(body, input), input));
    },
  },
  {
    // → GET /v1/messages/groups/:conversationId
    name: 'aimeat_dm_group_get',
    handler: ({ client }, input) => client.get(groupPath(input)),
  },
  {
    // → POST /v1/messages/groups/:conversationId/members
    name: 'aimeat_dm_group_members',
    handler: ({ client }, input) => {
      const body: JsonObject = {};
      const add = optionalArray(input, 'add'); if (add) body.add = add;
      const remove = optionalArray(input, 'remove'); if (remove) body.remove = remove;
      return client.post(groupPath(input, '/members'), withAsOwner(body, input));
    },
  },
  {
    // → POST /v1/messages/groups/:conversationId/leave
    name: 'aimeat_dm_group_leave',
    handler: ({ client }, input) => client.post(groupPath(input, '/leave'), withAsOwner({}, input)),
  },
  {
    // → GET /v1/messages/groups/invitations
    name: 'aimeat_dm_group_invitations',
    handler: ({ client }) => client.get('/v1/messages/groups/invitations'),
  },
  {
    // → POST /v1/messages/groups/:conversationId/invitation
    name: 'aimeat_dm_group_answer',
    handler: ({ client }, input) => {
      const accept = optionalBoolean(input, 'accept');
      if (accept === undefined) throw new Error('Missing required boolean field: accept');
      return client.post(groupPath(input, '/invitation'), withAsOwner({ accept }, input));
    },
  },
];
