/**
 * @file src/services/config-schema-node-limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config rows of the limits in config-node-limits.ts. Its own file because
 *   config-schema.ts is at the line ceiling; spread into the schema after the MCP rows. Every row is
 *   mutable, so the operator changes it from the Config tab or through chat (PUT /v1/admin/config),
 *   and every limit has the value that turns it off.
 * @structure NODE_LIMITS_CONFIG_FIELDS
 * @usage import { NODE_LIMITS_CONFIG_FIELDS } from './config-schema-node-limits.js';
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22): mcp.unused_client_days.
 */
import type { NodeLimitsConfig } from '../config-node-limits.js';
import type { ConfigFieldShape } from './config-field-def.js';

/** A whole number of 0 or more, where 0 turns the limit off. */
const wholeOrOff = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export const NODE_LIMITS_CONFIG_FIELDS: ConfigFieldShape<keyof NodeLimitsConfig>[] = [
  { key: 'mcpUnusedClientDays', dotPath: 'mcp.unused_client_days', envVar: 'AIMEAT_MCP_UNUSED_CLIENT_DAYS', type: 'number', validate: wholeOrOff, immutable: false,
    description: 'Days after which an MCP client registration that no sign-in finished (no refresh token, no remembered approval) is deleted by the daily cleanup. A client that is in use is never deleted. 0 keeps every registration',
    range: '0-3650 (0 = keep all)' },
];
