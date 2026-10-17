/**
 * @file src/tool-dispatch/tool-call-defs-publish.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_publish_requests for the shell / local-call dispatch and the connector MCP: a
 *   thin proxy over /v1/publish-requests (routes/publish-requests.ts), which decides who may read and
 *   who may decide. test/unit/cli-tool-param-forwarding.test.ts invokes this handler.
 * @structure publishCliTools[]
 * @usage import { publishCliTools } from './tool-call-defs-publish.js';
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4.3).
 */
import { optionalString, requiredString, type ConnectCliToolDefinition } from './tool-call-helpers.js';

export const publishCliTools: ConnectCliToolDefinition[] = [
  {
    // → GET /v1/publish-requests, GET /v1/publish-requests/:id, POST /v1/publish-requests/:id/decision
    name: 'aimeat_publish_requests',
    description: 'List the requests to make something public that wait for your owner, read one, or approve or decline one you did not file yourself.',
    input: {
      request_id: { type: 'string', description: 'One request. Omit to list them all.' },
      decision: { type: 'string', enum: ['approve', 'decline'], description: 'Decide the request named by request_id.' },
    },
    handler: ({ client }, input) => {
      const decision = optionalString(input, 'decision');
      const requestId = optionalString(input, 'request_id');
      if (decision !== undefined) {
        return client.post(`/v1/publish-requests/${encodeURIComponent(requiredString(input, 'request_id'))}/decision`, { decision });
      }
      if (requestId !== undefined) return client.get(`/v1/publish-requests/${encodeURIComponent(requestId)}`);
      return client.get('/v1/publish-requests');
    },
  },
];
