/**
 * @file src/mcp/app-manage-shape.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The zod input shape of aimeat_app_manage, shared by the node MCP server and the
 *   connector so the two list the same fields (check:mcp-schemas compares them). Every field is
 *   optional here except `action`: which fields an action needs is checkAppManageInput()'s answer
 *   (catalog/definitions/app-manage.ts), because it names every missing and foreign field at once,
 *   where zod would stop at the first. The two provenance fields are spread at each registration.
 * @structure appManageShape
 * @usage mcp.tool('aimeat_app_manage', description, { ...appManageShape, ...aiProvenanceInputs }, …)
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial.
 */
import { z } from 'zod';
import { APP_MANAGE_ACTION_NAMES, APP_MANAGE_FIELDS } from './catalog/definitions/app-manage.js';
import { APP_LEGAL_KINDS } from '../storage/types/apps.js';
import { SIGNAL_GEO_LEVELS } from '../models/signal-schemas.js';

const d = (field: string): string => APP_MANAGE_FIELDS[field]!.description;

export const appManageShape = {
    action: z.enum(APP_MANAGE_ACTION_NAMES as [string, ...string[]]).describe('What to do. The description lists each action with its fields.'),
    filename: z.string().optional().describe(d('filename')),
    owner: z.string().optional().describe(d('owner')),
    index: z.boolean().optional().describe(d('index')),
    title: z.string().optional().describe(d('title')),
    description: z.string().optional().describe(d('description')),
    keywords: z.array(z.string()).optional().describe(d('keywords')),
    image: z.string().optional().describe(d('image')),
    lang: z.string().optional().describe(d('lang')),
    badge: z.boolean().optional().describe(d('badge')),
    install: z.boolean().optional().describe(d('install')),
    kind: z.enum(APP_LEGAL_KINDS as [string, ...string[]]).optional().describe(d('kind')),
    format: z.enum(['markdown', 'html', 'url']).optional().describe(d('format')),
    content: z.string().optional().describe(d('content')),
    remove: z.boolean().optional().describe(d('remove')),
    limit: z.number().int().min(1).max(500).optional().describe(d('limit')),
    playtest: z.boolean().optional().describe(d('playtest')),
    days: z.number().int().min(0).max(360).optional().describe(d('days')),
    on: z.boolean().optional().describe(d('on')),
    geo: z.enum(SIGNAL_GEO_LEVELS).optional().describe(d('geo')),
    detail: z.array(z.string()).optional().describe(d('detail')),
    layout: z.record(z.string(), z.unknown()).optional().describe(d('layout')),
    note: z.string().optional().describe(d('note')),
    version: z.number().int().min(1).optional().describe(d('version')),
    name: z.string().optional().describe(d('name')),
    descriptions: z.record(z.string(), z.string()).optional().describe(d('descriptions')),
    parked: z.boolean().optional().describe(d('parked')),
    forkable: z.boolean().optional().describe(d('forkable')),
    access_code: z.string().optional().describe(d('access_code')),
    protection: z.record(z.string(), z.boolean()).optional().describe(d('protection')),
    screenshot: z.string().optional().describe(d('screenshot')),
    screenshot_mime_type: z.string().optional().describe(d('screenshot_mime_type')),
    subdomain: z.string().optional().describe(d('subdomain')),
    target: z.string().optional().describe(d('target')),
    subdomain_kind: z.enum(['app', 'redirect']).optional().describe(d('subdomain_kind')),
    enabled: z.boolean().optional().describe(d('enabled')),
    bundled_agent: z.string().optional().describe(d('bundled_agent')),
    runner_agent: z.string().optional().describe(d('runner_agent')),
    organism_id: z.string().optional().describe(d('organism_id')),
};
