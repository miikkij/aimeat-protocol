/**
 * @file src/tool-dispatch/tool-call-defs-organism-apps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_organism_apps for the shell / local-call dispatch and the connector MCP: a thin
 *   proxy over GET /v1/organisms/:id/apps (routes/organisms/apps-wall.ts), which decides who may read.
 *   test/unit/cli-tool-param-forwarding.test.ts invokes this handler.
 * @structure organismAppsCliTools[]
 * @usage import { organismAppsCliTools } from './tool-call-defs-organism-apps.js';
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-organisaation-oma-appisein-kollegoiden-apit-n-kyviin-eri-kul).
 */
import { optionalString, requiredString, type ConnectCliToolDefinition } from './tool-call-helpers.js';

export const organismAppsCliTools: ConnectCliToolDefinition[] = [
  {
    // → GET /v1/organisms/:id/apps
    name: 'aimeat_organism_apps',
    description: 'The apps members opened to one organism (a company, a team or a training), with what each is made of and how much it is used.',
    input: {
      organism_id: { type: 'string', required: true, description: 'The organism whose app wall to read.' },
      lang: { type: 'string', description: 'The language of the capability titles and team names: en, fi or es. Default en.' },
    },
    handler: ({ client }, input) => {
      const lang = optionalString(input, 'lang');
      return client.get(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/apps${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`);
    },
  },
];
