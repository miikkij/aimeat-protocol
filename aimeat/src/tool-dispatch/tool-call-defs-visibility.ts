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
 *   v1.2.0 -- 2026-10-08 -- aimeat_visibility_behaviour, _behaviour_set and _behaviour_fix (layer D).
 *   v1.1.0 -- 2026-10-08 -- aimeat_visibility_settings_set forwards clarity_project_id and ga4_measurement_id.
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
    description: 'Change the person\'s visibility settings: counting on or off, and their own Clarity or GA4 id on every page of the place. Only the fields given change.',
    input: {
      enabled: { type: 'boolean', description: 'true counts, false stops counting.' },
      clarity_project_id: { type: 'string', description: 'The Microsoft Clarity project id. null removes it.' },
      ga4_measurement_id: { type: 'string', description: 'The GA4 measurement id (G-...). null removes it.' },
    },
    handler: ({ client }, input) => {
      const body: Record<string, unknown> = {};
      if ('enabled' in input) {
        const enabled = optionalBoolean(input, 'enabled');
        if (enabled === undefined) throw new Error('enabled must be true or false');
        body.enabled = enabled;
      }
      for (const key of ['clarity_project_id', 'ga4_measurement_id']) {
        if (key in input) body[key] = input[key] === null ? null : String(requiredValue(input, key));
      }
      return client.put('/v1/visibility/settings', body);
    },
  },
  {
    // → GET /v1/visibility/feed; PUT /v1/visibility/feed with changes; POST /v1/visibility/feed/stripe-sync
    name: 'aimeat_visibility_feed',
    description: 'The person\'s product feeds for AI shopping agents: read, change, or push the catalog into their own Stripe.',
    input: {
      enabled: { type: 'boolean', description: 'true publishes both feeds.' },
      brand: { type: 'string', description: 'Brand and seller name. null resets.' },
      return_policy_label: { type: 'string', description: 'The Merchant Center return policy label. null removes it.' },
      store_url: { type: 'string', description: 'Where a product with no page of its own links. null resets.' },
      product_links: { type: 'object', description: 'A product page per sku; a null value removes one.' },
      stripe_profile_id: { type: 'string', description: 'The Stripe network profile id (profile_...) for agent payments. null removes it.' },
      stripe_sync: { type: 'string', description: '"send" pushes the catalog into the person\'s own Stripe; "check" reads the last import.' },
    },
    handler: async ({ client }, input) => {
      const body: Record<string, unknown> = {};
      if ('enabled' in input) {
        const enabled = optionalBoolean(input, 'enabled');
        if (enabled === undefined) throw new Error('enabled must be true or false');
        body.enabled = enabled;
      }
      for (const key of ['brand', 'return_policy_label', 'store_url', 'stripe_profile_id']) {
        if (key in input) body[key] = input[key] === null ? null : String(requiredValue(input, key));
      }
      if ('product_links' in input) body.product_links = requiredValue(input, 'product_links');
      const sync = 'stripe_sync' in input ? String(requiredValue(input, 'stripe_sync')) : null;
      if (sync !== null && sync !== 'send' && sync !== 'check') throw new Error('stripe_sync must be "send" or "check"');
      if (Object.keys(body).length) {
        const put = await client.put('/v1/visibility/feed', body);
        if (!sync) return put;
      }
      if (sync) return client.post('/v1/visibility/feed/stripe-sync', { check_only: sync === 'check' });
      return client.get('/v1/visibility/feed');
    },
  },
  {
    // → GET /v1/visibility/behaviour?app=&days=
    name: 'aimeat_visibility_behaviour',
    description: 'What people do on the person\'s apps: views by screen size, scroll depth, dead and rage clicks by element, and one line per finding.',
    input: {
      app: { type: 'string', description: 'One app\'s filename. Without it, every app.' },
      days: { type: 'number', description: 'The window in days. Default 7, at most 56.' },
    },
    handler: ({ client }, input) => {
      const q = new URLSearchParams();
      if ('app' in input) q.set('app', String(requiredValue(input, 'app')));
      const days = optionalNumber(input, 'days');
      if (days !== undefined) q.set('days', String(days));
      const qs = q.toString();
      return client.get(`/v1/visibility/behaviour${qs ? `?${qs}` : ''}`);
    },
  },
  {
    // → PUT /v1/visibility/behaviour/settings
    name: 'aimeat_visibility_behaviour_set',
    description: 'Switch the behaviour script off or on for one app, or the weekly fixing agent off or on. Only the fields given change.',
    input: {
      app: { type: 'string', description: 'The app\'s filename, with app_enabled.' },
      app_enabled: { type: 'boolean', description: 'true counts the app, false removes the script from it.' },
      fixer: { type: 'boolean', description: 'true switches the weekly fixing agent on.' },
    },
    handler: ({ client }, input) => {
      const body: Record<string, unknown> = {};
      if ('app' in input) body.app = String(requiredValue(input, 'app'));
      for (const key of ['app_enabled', 'fixer']) {
        if (!(key in input)) continue;
        const v = optionalBoolean(input, key);
        if (v === undefined) throw new Error(`${key} must be true or false`);
        body[key] = v;
      }
      return client.put('/v1/visibility/behaviour/settings', body);
    },
  },
  {
    // → POST /v1/visibility/behaviour/fix
    name: 'aimeat_visibility_behaviour_fix',
    description: 'Run the fixing agent on one app now: findings and a corrected draft, never a publish.',
    input: {
      app: { type: 'string', description: 'The app\'s filename.', required: true },
    },
    handler: ({ client }, input) => client.post('/v1/visibility/behaviour/fix', { app: String(requiredValue(input, 'app')) }),
  },
];
