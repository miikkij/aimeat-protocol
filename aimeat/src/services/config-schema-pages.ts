/**
 * @file src/services/config-schema-pages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config row of the HTML pages of workspaces (config-pages.ts). Its own file because
 *   config-schema.ts is at the line ceiling; spread into the schema beside the node rows.
 * @structure PAGES_CONFIG_FIELDS
 * @usage import { PAGES_CONFIG_FIELDS } from './config-schema-pages.js';
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial: page.host (AIMEAT_PAGE_HOST).
 */
import type { PagesConfig } from '../config-pages.js';
import type { ConfigFieldShape } from './config-field-def.js';

export const PAGES_CONFIG_FIELDS: ConfigFieldShape<keyof PagesConfig>[] = [
  { key: 'pageHost', dotPath: 'node.page_host', envVar: 'AIMEAT_PAGE_HOST', type: 'string', validate: v => typeof v === 'string' && /^[a-z0-9.-]{0,253}$/i.test(v as string), immutable: true, description: 'The one host the HTML pages of workspaces run on, isolated in a frame (for example pages.your-domain.com). It needs its own certificate and proxy block, and must not be a host anything else is served from. Empty: an HTML page is shown as its text. Set in .env and restart' },
];
