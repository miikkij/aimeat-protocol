/**
 * @file src/tool-catalog/definitions/site-template.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_site_template: the operator's own front page and its language versions, read,
 *   stored and deleted from the chat. On all three surfaces: the node's MCP endpoint
 *   (src/mcp/site-template.ts), the connector MCP and the CLI dispatch
 *   (src/tool-dispatch/tool-call-defs-site-template.ts), the last two over GET, POST and DELETE
 *   /v1/site/template. One implementation: services/site/template-ops.ts, on the node's one
 *   SiteService, so the page GET / serves changes at once whichever surface stored it.
 * @structure siteTemplateTools · SITE_TEMPLATE_ACTIONS
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial: the front page per language had no chat path, only the Portal
 *     page and REST (feature audit 2026-11-19, 4.4 item 5).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

// 'set' last: the parameter-forwarding probe holds `action` at the last value, and set carries every field.
export const SITE_TEMPLATE_ACTIONS = ['get', 'delete', 'set'] as const;

export const siteTemplateTools = [
    {
        name: 'aimeat_site_template',
        description: 'Operator-only. The node\'s own front page: a whole HTML page the operator wrote, served at / instead of the built-in one, and its language versions, one whole page per language beside it. '
            + 'Action "get" { lang? } answers the stored page as written (its {{tags}} unresolved), its size, when it was stored, the tags it uses, and `languages`, the language versions the front page has; without lang it is the default page, and `template: null` means the node shows its built-in front page. '
            + '"set" { template, lang? } stores the default page, or with lang the version for that language. The page starts with <!DOCTYPE or <html, keeps within the node\'s size limit, and a version\'s own <html lang> names its language. A version needs the default page first. The answer names the tags the node cannot fill. A reader whose language has a version gets it; everyone else gets the default page. '
            + '"delete" { lang? } removes that language version, or without lang the default page and every version, which brings back the built-in front page. Read first with "get" and tell the person what changes. '
            + 'lang is a two-letter code such as "fi" or "en". Refusals: TEMPLATE_INVALID, TEMPLATE_TOO_LARGE, TEMPLATE_LANG_INVALID, TEMPLATE_LANG_MISMATCH, TEMPLATE_DEFAULT_MISSING, NOT_FOUND (no such version), LB_MODE (this copy only mirrors the main site), FORBIDDEN (not the operator). '
            + 'Same as GET, POST and DELETE /v1/site/template. The page layout of the built-in front page is a different thing: aimeat_surface_layout_set.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Admin: The Front Page per Language', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        // The word /v1/site/template asks (requireOperator).
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            action: { type: 'string', required: true, enum: [...SITE_TEMPLATE_ACTIONS], description: '"get", "delete" or "set".' },
            lang: { type: 'string', description: 'A two-letter language code for a language version, such as "en". Leave it out for the default page.', zod: z.string().max(8) },
            template: { type: 'string', description: 'For set: the whole HTML page, starting with <!DOCTYPE or <html.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
