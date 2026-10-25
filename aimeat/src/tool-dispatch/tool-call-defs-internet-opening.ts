/**
 * @file src/tool-dispatch/tool-call-defs-internet-opening.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tools of an app opened to the internet on a closed node, for the shell / local-call
 *   dispatch and the connector MCP: thin proxies over the REST routes in routes/internet-opening.ts,
 *   which decide who may do what. test/unit/cli-tool-param-forwarding.test.ts invokes every handler.
 * @structure internetOpeningCliTools[]
 * @usage import { internetOpeningCliTools } from './tool-call-defs-internet-opening.js';
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalNumber, optionalBoolean } from './tool-call-helpers.js';

const enc = encodeURIComponent;
const appPath = (owner: string, app: string) => `/v1/apps/${enc(owner)}/${enc(app)}/internet-opening`;

export const internetOpeningCliTools: ConnectCliToolDefinition[] = [
  {
    // → GET /v1/apps/:owner/:filename/internet-opening
    name: 'aimeat_app_internet_opening_get',
    handler: ({ client, config }, input) => client.get(appPath(config.owner, requiredString(input, 'app'))),
  },
  {
    // → POST /v1/apps/:owner/:filename/internet-opening
    name: 'aimeat_app_internet_open',
    handler: ({ client, config }, input) => {
      const days = optionalNumber(input, 'days');
      return client.post(appPath(config.owner, requiredString(input, 'app')), {
        reason: requiredString(input, 'reason'), ...(days !== undefined ? { days } : {}),
      });
    },
  },
  {
    // → DELETE /v1/apps/:owner/:filename/internet-opening, or an operator's
    //   POST /v1/admin/internet-openings/:owner/:filename/close for another account's app
    name: 'aimeat_app_internet_close',
    handler: ({ client, config }, input) => {
      const app = requiredString(input, 'app');
      const owner = optionalString(input, 'owner');
      const reason = optionalString(input, 'reason');
      if (owner && owner !== config.owner) {
        return client.post(`/v1/admin/internet-openings/${enc(owner)}/${enc(app)}/close`, reason ? { reason } : {});
      }
      return client.delete(`${appPath(config.owner, app)}${reason ? `?reason=${enc(reason)}` : ''}`);
    },
  },
  {
    // → GET /v1/admin/internet-openings
    name: 'aimeat_admin_internet_openings',
    handler: ({ client }, input) => {
      const state = optionalString(input, 'state');
      return client.get(`/v1/admin/internet-openings${state ? `?state=${enc(state)}` : ''}`);
    },
  },
  {
    // → POST /v1/admin/internet-openings/:owner/:filename/decision
    name: 'aimeat_admin_internet_opening_decide',
    handler: ({ client }, input) => {
      const note = optionalString(input, 'note');
      const which = optionalString(input, 'which');
      return client.post(`/v1/admin/internet-openings/${enc(requiredString(input, 'owner'))}/${enc(requiredString(input, 'app'))}/decision`, {
        decision: requiredString(input, 'decision'), ...(note ? { note } : {}), ...(which ? { which } : {}),
      });
    },
  },
  {
    // → PUT or DELETE /v1/admin/internet-openers/:owner
    name: 'aimeat_admin_internet_opener_set',
    handler: ({ client }, input) => {
      const path = `/v1/admin/internet-openers/${enc(requiredString(input, 'owner'))}`;
      if (optionalBoolean(input, 'allowed') !== true) return client.delete(path);
      const until = optionalString(input, 'until');
      return client.put(path, { reason: optionalString(input, 'reason'), ...(until ? { until } : {}) });
    },
  },
];
