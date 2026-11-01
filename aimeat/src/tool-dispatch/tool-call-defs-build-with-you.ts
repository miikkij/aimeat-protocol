/**
 * @file tool-dispatch/tool-call-defs-build-with-you.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "build it with you" tools on the CLI dispatch (`/local/call/<tool>`) and the
 *   connector MCP: a thin REST proxy over /v1/build-with-you/*, so the node decides everything
 *   (services/build-with-you.ts, services/place-trail.ts).
 * @version-history
 *   v1.1.0 — 2026-11-01 — aimeat_build_request_submit forwards `spec`, the four fields as one object.
 *   v1.0.0 — 2026-11-01 — Initial ("Rakennamme kanssasi").
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { optionalString, query } from './tool-call-helpers.js';

const BASE = '/v1/build-with-you';

export const buildWithYouCliTools: ConnectCliToolDefinition[] = [
  {
    // → POST /v1/build-with-you/request (routes/build-with-you.ts)
    name: 'aimeat_build_request_submit',
    handler: ({ client }, input) => {
      const body: Record<string, unknown> = {};
      for (const k of ['what', 'forWhom', 'use', 'readyWhen', 'lang', 'email'] as const) {
        const v = optionalString(input, k);
        if (v !== undefined) body[k] = v;
      }
      if (input.spec && typeof input.spec === 'object' && !Array.isArray(input.spec)) body.spec = input.spec;
      return client.post(`${BASE}/request`, body);
    },
  },
  {
    // → GET /v1/build-with-you/request
    name: 'aimeat_build_request_status',
    handler: ({ client }) => client.get(`${BASE}/request`),
  },
  {
    // → GET /v1/build-with-you/trail
    name: 'aimeat_trail_list',
    handler: ({ client }, input) => {
      const limit = typeof input.limit === 'number' ? String(input.limit) : undefined;
      return client.get(`${BASE}/trail${query({ since: optionalString(input, 'since'), before: optionalString(input, 'before'), limit })}`);
    },
  },
];
