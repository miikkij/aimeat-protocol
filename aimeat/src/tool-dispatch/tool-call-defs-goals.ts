/**
 * @file tool-dispatch/tool-call-defs-goals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent goal tools on the CLI dispatch (`/local/call/<tool>`) and the connector MCP: a
 *   thin REST proxy over /v1/goals/*, so the node decides everything (services/goals/goals-ops.ts).
 *   Each action is one route; the tables below are the whole mapping.
 * @version-history
 *   v1.1.0 — 2026-10-25 — The goal's and the work's fields are forwarded from the top level too.
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalBoolean, optionalRecord, query } from './tool-call-helpers.js';
import { GOAL_INPUT_FIELDS, WORK_INPUT_FIELDS } from '../tool-catalog/definitions/goals.js';

const BASE = '/v1/goals';
const at = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export const goalCliTools: ConnectCliToolDefinition[] = [
  {
    // → GET /v1/goals, /v1/goals/waiting or /v1/goals/{id} (routes/goals.ts)
    name: 'aimeat_goal_get',
    handler: ({ client }, input) => {
      if (optionalBoolean(input, 'waiting') === true) return client.get(`${BASE}/waiting`);
      const id = optionalString(input, 'goal_id');
      if (id) return client.get(at(id));
      return client.get(`${BASE}${query({ status: optionalString(input, 'status') })}`);
    },
  },
  {
    // → the route of the action named (routes/goals.ts)
    name: 'aimeat_goal_set',
    handler: ({ client }, input) => {
      const action = requiredString(input, 'action');
      // The goal's fields at the top level, as the route takes them; `input` from an earlier client wins.
      const top = Object.fromEntries(GOAL_INPUT_FIELDS.filter(k => input[k] !== undefined).map(k => [k, input[k]]));
      const body = { ...top, ...(optionalRecord(input, 'input') ?? {}) } as Record<string, unknown>;
      const reason = optionalString(input, 'reason');
      if (reason && body.reason === undefined) body.reason = reason;
      const id = () => requiredString(input, 'goal_id');
      switch (action) {
        case 'create': return client.post(BASE, body);
        case 'update': return client.patch(at(id()), body);
        case 'preview': return client.patch(at(id()), { ...body, preview: true });
        case 'attach': return client.post(`${at(id())}/material`, body);
        case 'delete': return client.delete(at(id()));
        case 'pause': case 'resume': case 'stop': case 'done': case 'renew': case 'start_round':
          return client.post(`${at(id())}/actions/${action}`, reason ? { reason } : {});
        default: throw new Error('action is one of create, update, preview, pause, resume, stop, done, renew, start_round, attach, delete.');
      }
    },
  },
  {
    // → /v1/goals/available, /v1/goals/{id}/works and /v1/goals/{id}/works/{workId}/actions/{action}
    name: 'aimeat_goal_work',
    handler: ({ client }, input) => {
      const action = requiredString(input, 'action');
      if (action === 'available') return client.get(`${BASE}/available`);
      const goal = at(requiredString(input, 'goal_id'));
      const reason = optionalString(input, 'reason');
      switch (action) {
        case 'add': case 'leave': {
          // The work's fields at the top level, as the route takes them; `work` from an earlier client wins.
          const top = Object.fromEntries([...WORK_INPUT_FIELDS, 'agent', 'wants'].filter(k => input[k] !== undefined).map(k => [k, input[k]]));
          return client.post(`${goal}/works`, { action, work: { ...top, ...(optionalRecord(input, 'work') ?? {}) }, ...(reason ? { reason } : {}) });
        }
        case 'claim': case 'release': case 'reroute': case 'reject': {
          const agent = optionalString(input, 'agent');
          const wants = Array.isArray(input.wants) ? (input.wants as unknown[]).map(String) : undefined;
          return client.post(`${goal}/works/${encodeURIComponent(requiredString(input, 'work_id'))}/actions/${action}`, {
            ...(reason ? { reason } : {}), ...(agent ? { agent } : {}), ...(wants ? { wants } : {}),
          });
        }
        default: throw new Error('action is one of available, claim, release, add, leave, reroute, reject.');
      }
    },
  },
  {
    // → POST /v1/goals/{id}/works/{workId}/answer
    name: 'aimeat_goal_answer',
    handler: ({ client }, input) => {
      const body: Record<string, unknown> = {};
      for (const k of ['option', 'text', 'reason', 'kind', 'ref'] as const) {
        const v = optionalString(input, k);
        if (v !== undefined) body[k] = v;
      }
      const approve = optionalBoolean(input, 'approve');
      if (approve !== undefined) body.approve = approve;
      if (Array.isArray(input.options)) body.options = (input.options as unknown[]).map(String);
      return client.post(`${at(requiredString(input, 'goal_id'))}/works/${encodeURIComponent(requiredString(input, 'work_id'))}/answer`, body);
    },
  },
];
