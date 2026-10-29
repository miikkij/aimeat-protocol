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
 *   v1.1.1 — 2026-10-29 — `account` also serves the one who asked, reading its own request there (secaudit2026oct26 round 8c).
 *   v1.1.0 — 2026-10-25 — `account` is forwarded on the read and the decision (secaudit2026oct22, the approval standard).
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
      account: { type: 'string', description: 'The account where the request lives: an operator reads or answers a request waiting for the operators there, and the one who asked reads its own request there.' },
    },
    handler: ({ client }, input) => {
      const decision = optionalString(input, 'decision');
      const requestId = optionalString(input, 'request_id');
      const account = optionalString(input, 'account');
      if (decision !== undefined) {
        return client.post(`/v1/publish-requests/${encodeURIComponent(requiredString(input, 'request_id'))}/decision`, { decision, ...(account ? { account } : {}) });
      }
      if (requestId !== undefined) {
        return client.get(`/v1/publish-requests/${encodeURIComponent(requestId)}${account ? `?account=${encodeURIComponent(account)}` : ''}`);
      }
      return client.get('/v1/publish-requests');
    },
  },
];
