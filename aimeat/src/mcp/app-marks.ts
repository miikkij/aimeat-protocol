/**
 * @file app-marks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent-facing half of an app's served chrome: the "publish your own app" badge
 *   and the browser install chip, each on or off per app.
 *
 *   Exists because the capability is not finished while it is only clickable. An owner working
 *   through their own AI has to be able to say "take the badge off my shop app" and have it happen.
 *
 *   Does not do the work itself: it calls ownerAppMarks(), which resolves the caller's own app
 *   bucket and hands the write to applyOwnerMarksUpdate(), the same function PATCH
 *   /v1/apps/:filename calls — so the parsing, the note and the catalogue announcement happen
 *   where they were written once.
 *
 *   WHAT IS DELIBERATELY NOT HERE. The named reviewer (the declaration that lifts the visible
 *   AI-generated label) is not a parameter on this tool, on any surface. It is a legal act by a
 *   natural person and is reserved to the account holder signed in as themselves; an agent is never
 *   that principal, so a parameter here would be one that always refuses. The catalog's Details page
 *   is where it is declared, and the tool's description says so.
 *
 * @structure registerAppMarksTools(mcp, storage, config, getAgentGaii)
 * @usage import { registerAppMarksTools } from './app-marks.js';
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { ownerAppMarks } from '../services/app-marks.js';

export function registerAppMarksTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  mcp.tool(
    'aimeat_app_marks_set',
    descriptionFor('aimeat_app_marks_set'),
    {
      filename: z.string().describe('The app to change, with its extension (e.g. "notes.html").'),
      badge: z.boolean().optional().describe('false takes the "publish your own app" badge off this app; true puts it back. On until you ask.'),
      install: z.boolean().optional().describe('false stops offering visitors to install this app in their browser; true offers it again. On until you ask.'),
    },
    annotationsFor('aimeat_app_marks_set'),
    async (args: { filename: string; badge?: boolean; install?: boolean }) => {
      // Only the fields the caller named. An absent field means "leave it alone", and naming
      // nothing is a question rather than a write.
      const marks: Record<string, unknown> = {};
      for (const k of ['badge', 'install'] as const) {
        if (args[k] !== undefined) marks[k] = args[k];
      }
      // The caller's OWN app bucket, resolved inside the service. An agent acts for its owner, so
      // this is that owner's catalogue — never a filename plus a caller-supplied owner.
      const out = await ownerAppMarks(storage, config, { callerGaii: getAgentGaii(), filename: args.filename, marks });
      if ('error' in out) {
        return { content: [{ type: 'text' as const, text: out.error }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          filename: args.filename, ...(out.note ? { note: out.note } : {}), marks: out.state.marks,
          reviewer: out.state.authorship?.name ?? null,
        }, null, 2) }],
      };
    },
  );
}
