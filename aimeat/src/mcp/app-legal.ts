/**
 * @file app-legal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent-facing half of an app's own legal pages: `aimeat_app_legal_set` writes
 *   or removes one page (terms, privacy, imprint, refunds, accessibility, cookies, support) as
 *   markdown, HTML or a link, and reports what the app still ought to have; `aimeat_app_audit`
 *   reads the app's audit log.
 *
 *   Exists because the capability is not finished while it is only clickable: an owner working
 *   through their own AI says "write the privacy notice for my shop app from this text" and it
 *   lands, and asks "what changed on this app last month" and gets the log.
 *
 *   Neither does the work itself. The first calls ownerAppLegal() → applyOwnerLegalUpdate(), the
 *   same function PATCH /v1/apps/:filename calls, so the validation, the audit entry and the
 *   note happen once; the second calls readAppAudit(), which GET /v1/apps/:owner/:filename/audit
 *   renders, after the same owner resolution the write uses.
 *
 * @structure registerAppLegalTools(mcp, storage, config, getAgentGaii)
 * @usage import { registerAppLegalTools } from './app-legal.js';
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { ownerAppLegal } from '../services/app-legal.js';
import { ownerAppAudit } from '../services/app-audit.js';
import { APP_LEGAL_KINDS } from '../storage/types/apps.js';

export function registerAppLegalTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  mcp.tool(
    'aimeat_app_legal_set',
    descriptionFor('aimeat_app_legal_set'),
    {
      filename: z.string().describe('The app, with its extension (e.g. "shop.html").'),
      kind: z.enum(APP_LEGAL_KINDS as [string, ...string[]]).optional()
        .describe('Which page: terms, privacy, imprint, refunds, accessibility, cookies or support. Omit to only read where the app stands.'),
      format: z.enum(['markdown', 'html', 'url']).optional()
        .describe('markdown (rendered by the node, every character escaped), html (served as written, on the app\'s own origin), or url (a link to where the page already lives).'),
      content: z.string().optional().describe('The page text, the HTML document, or the absolute https URL.'),
      remove: z.boolean().optional().describe('true removes the named page.'),
    },
    annotationsFor('aimeat_app_legal_set'),
    async (args: { filename: string; kind?: string; format?: string; content?: string; remove?: boolean }) => {
      // One page per call, as the door is shaped; the service takes a map, so the PATCH twin can
      // set several at once. Naming no kind is a question.
      let legal: Record<string, unknown> | undefined;
      if (args.kind) {
        if (args.remove) legal = { [args.kind]: null };
        else if (args.format && args.content !== undefined) legal = { [args.kind]: { format: args.format, content: args.content } };
        else {
          return { content: [{ type: 'text' as const, text: 'To set a page give format and content; to remove it give remove: true.' }], isError: true };
        }
      }
      const out = await ownerAppLegal(storage, config, { callerGaii: getAgentGaii(), filename: args.filename, legal });
      if ('error' in out) return { content: [{ type: 'text' as const, text: out.error }], isError: true };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          filename: args.filename, ...(out.note ? { note: out.note } : {}), pages: out.state, readiness: out.readiness,
        }, null, 2) }],
      };
    },
  );

  mcp.tool(
    'aimeat_app_audit',
    descriptionFor('aimeat_app_audit'),
    {
      filename: z.string().describe('The app, with its extension.'),
      limit: z.number().int().min(1).max(500).optional().describe('How many of the newest entries to return. Default 50.'),
    },
    annotationsFor('aimeat_app_audit'),
    async (args: { filename: string; limit?: number }) => {
      // The lookup, the refusals and the slice live in the service; this door renders the answer.
      const out = await ownerAppAudit(storage, config, { callerGaii: getAgentGaii(), filename: args.filename, limit: args.limit });
      if ('error' in out) return { content: [{ type: 'text' as const, text: out.error }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify({ filename: args.filename, total: out.total, entries: out.entries }, null, 2) }] };
    },
  );
}
