/**
 * @file seo.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent-facing half of search visibility: what this node's discovery state is, and
 *   the switch on one app.
 *
 *   Both tools exist because the capability is not finished while it is only clickable. An owner
 *   who works through their own AI has to be able to say "make my app findable" and have it happen,
 *   and an operator has to be able to ask "is my node findable and what is left to do" without
 *   opening a dashboard.
 *
 *   Neither does the work itself. `aimeat_seo_status` calls buildSeoStatus(), the same function
 *   GET /v1/admin/seo/status renders, and `aimeat_app_seo_set` calls applyOwnerSeoUpdate(), the same
 *   function PATCH /v1/apps/:filename calls — so the operator-field stripping, the merge, the note
 *   and the IndexNow announcement happen where they were written once.
 *
 *   WHAT IS DELIBERATELY NOT HERE, and is a pre-existing gap rather than an omission of this work:
 *   there is no MCP door for an app's other settings. `parked`, `forkable`, `access_code`,
 *   `protection` and the display name are HTTP-only on PATCH /v1/apps/:filename, so an agent cannot
 *   park its owner's app or set an access code. That door should exist; adding it is a separate
 *   piece of work with its own three surfaces to keep in step, and quietly half-building it here
 *   would leave a tool whose name promised settings and delivered one field.
 *
 * @structure registerSeoTools(mcp, storage, config, getAgentGaii)
 * @usage import { registerSeoTools } from './seo.js';
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { buildSeoStatus } from '../routes/admin-seo.js';
import { ownerAppSeo } from '../services/app-seo.js';
import { resolveOperatorName } from '../services/owner-lifecycle.js';

export function registerSeoTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  mcp.tool(
    'aimeat_seo_status',
    descriptionFor('aimeat_seo_status'),
    {},
    annotationsFor('aimeat_seo_status'),
    async () => {
      // The HTTP door is behind requireRole('operator'), and this one calls buildSeoStatus()
      // directly rather than going over HTTP — so the role has to be checked HERE too, or the tool
      // is a way around the gate on the route. That is the shape the August 2026 audit named: a
      // permission word is enforced on every door or it does not exist.
      //
      // An MCP token carries roles ['agent'] and nothing else, so the check is on the ACCOUNT the
      // agent acts for, the way every other operator tool on this surface does it.
      if (!(await resolveOperatorName(storage, getAgentGaii()))) {
        return {
          content: [{ type: 'text' as const, text: 'Only whoever runs this node can read its discovery status.' }],
          isError: true,
        };
      }
      const status = await buildSeoStatus(config, storage);
      return { content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }] };
    },
  );

  mcp.tool(
    'aimeat_app_seo_set',
    descriptionFor('aimeat_app_seo_set'),
    {
      filename: z.string().describe('The app to change, with its extension (e.g. "notes.html").'),
      index: z.boolean().optional().describe('true makes the app findable in search engines; false takes it back out. Off until you ask.'),
      title: z.string().optional().describe('Title for search results and social cards. Empty derives it from the app\'s name.'),
      description: z.string().optional().describe('Description for search results. Empty derives it from the app\'s own description.'),
      keywords: z.array(z.string()).optional().describe('Keywords. Empty uses the app\'s tags.'),
      image: z.string().optional().describe('Absolute https URL for the social card. Empty uses the app\'s own screenshot.'),
      lang: z.string().optional().describe('Language tag such as "fi". Empty reads what the app declares about itself.'),
    },
    annotationsFor('aimeat_app_seo_set'),
    async (args: {
      filename: string; index?: boolean; title?: string;
      description?: string; keywords?: string[]; image?: string; lang?: string;
    }) => {
      // Only the fields the caller actually named. An absent field means "leave it alone", so a
      // call that flips the switch does not wipe a title written last month, and naming NOTHING is
      // a question rather than a write.
      const seo: Record<string, unknown> = {};
      for (const k of ['index', 'title', 'description', 'keywords', 'image', 'lang'] as const) {
        if (args[k] !== undefined) seo[k] = args[k];
      }

      // The caller's OWN app bucket, resolved inside the service along with the lookup and the
      // refusals. An agent acts for its owner, so this is that owner's catalogue — never a filename
      // plus a caller-supplied owner, which would be a door onto somebody else's app.
      const out = await ownerAppSeo(storage, config,
        { callerGaii: getAgentGaii(), filename: args.filename, seo });
      if ('error' in out) {
        return { content: [{ type: 'text' as const, text: out.error }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          filename: args.filename, state: out.state, ...(out.note ? { note: out.note } : {}), seo: out.seo,
        }, null, 2) }],
      };
    },
  );
}
