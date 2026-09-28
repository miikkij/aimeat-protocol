/**
 * @file tool-call-defs-ai-models.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The System 2 AI tools for the shell / local-call dispatch, the surface a fleet daemon
 *   calls: aimeat_ai_policy_set over GET and PUT /v1/ai/policy. Every declared field is forwarded;
 *   test/unit/cli-tool-param-forwarding.test.ts proves each one leaves the process.
 * @structure aiModelCliTools[] — registered by tool-dispatch/index.ts
 * @version-history
 *   v1.2.0 — 2026-09-28 — aimeat_ai_capabilities, aimeat_ai_models, aimeat_ai_transcribe and
 *     aimeat_ai_embed (System 2 plan, V5).
 *   v1.1.0 — 2026-09-28 — aimeat_ai_providers, aimeat_ai_provider_test and aimeat_ai_routing_set
 *     (System 2 plan, V3).
 *   v1.0.0 — 2026-09-28 — Initial (System 2 plan, V2).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { optionalBoolean, optionalRecord, optionalString, requiredArray, requiredString } from './tool-call-helpers.js';
import { aiModelTools as catalog } from '../mcp/catalog/definitions/ai-models.js';

const def = (name: string) => catalog.find((t) => t.name === name)!;

export const aiModelCliTools: ConnectCliToolDefinition[] = [
  {
    ...def('aimeat_ai_policy_set'),
    handler: ({ client }, input) => {
      const policy = optionalRecord(input, 'policy');
      const token = optionalString(input, 'confirm_token');
      // Nothing given reads; anything given goes to the node as given, which answers a token
      // without a policy with the reason rather than this door dropping it.
      if (!policy && token === undefined) return client.get('/v1/ai/policy');
      return client.put('/v1/ai/policy', { ...(policy ? { policy } : {}), ...(token !== undefined ? { confirm_token: token } : {}) });
    },
  },
  {
    ...def('aimeat_ai_providers'),
    handler: ({ client }) => client.get('/v1/ai/providers'),
  },
  {
    ...def('aimeat_ai_provider_test'),
    handler: ({ client }, input) => {
      const capability = optionalString(input, 'capability');
      const accept = optionalBoolean(input, 'accept_cost');
      return client.post(`/v1/ai/providers/${encodeURIComponent(requiredString(input, 'provider'))}/test`, {
        ...(capability !== undefined ? { capability } : {}), ...(accept !== undefined ? { accept_cost: accept } : {}),
      });
    },
  },
  {
    ...def('aimeat_ai_routing_set'),
    handler: ({ client }, input) => {
      const routing = optionalRecord(input, 'routing');
      const token = optionalString(input, 'confirm_token');
      if (!routing && token === undefined) return client.get('/v1/ai/routing');
      return client.put('/v1/ai/routing', { ...(routing ? { routing } : {}), ...(token !== undefined ? { confirm_token: token } : {}) });
    },
  },
  {
    ...def('aimeat_ai_capabilities'),
    handler: ({ client }, input) => {
      const app = optionalString(input, 'app_id');
      return client.get(`/v1/ai/capabilities${app !== undefined ? `?app_id=${encodeURIComponent(app)}` : ''}`);
    },
  },
  {
    ...def('aimeat_ai_models'),
    handler: ({ client }, input) => {
      const q = new URLSearchParams();
      for (const k of ['capability', 'type', 'status'] as const) {
        const v = optionalString(input, k);
        if (v !== undefined) q.set(k, v);
      }
      const allowed = optionalBoolean(input, 'allowed');
      if (allowed !== undefined) q.set('allowed', String(allowed));
      return client.get(`/v1/ai/models${q.size ? `?${q}` : ''}`);
    },
  },
  {
    ...def('aimeat_ai_transcribe'),
    handler: ({ client }, input) => {
      const body: Record<string, unknown> = { storage_key: requiredString(input, 'storage_key') };
      for (const k of ['filename', 'language', 'model', 'provider', 'app_id'] as const) {
        const v = optionalString(input, k);
        if (v !== undefined) body[k] = v;
      }
      return client.post('/v1/ai/transcribe', body);
    },
  },
  {
    ...def('aimeat_ai_embed'),
    handler: ({ client }, input) => {
      const body: Record<string, unknown> = { input: requiredArray(input, 'input') };
      for (const k of ['model', 'provider', 'app_id'] as const) {
        const v = optionalString(input, k);
        if (v !== undefined) body[k] = v;
      }
      return client.post('/v1/ai/embed', body);
    },
  },
];
