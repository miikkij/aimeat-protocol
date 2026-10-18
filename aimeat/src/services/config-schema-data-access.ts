/**
 * @file src/services/config-schema-data-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config rows for who may reach an owner's data (config-data-access.ts): the
 *   consent layer, the account-events window, the classification switch and the clearance a new
 *   agent gets. Their own file because config-schema.ts is at the line ceiling; spread into the
 *   schema where these rows stood. The Config tab groups each row by its dot path, so the two
 *   `classification.` rows stand together in its Classification section.
 * @structure DATA_ACCESS_CONFIG_FIELDS
 * @usage import { DATA_ACCESS_CONFIG_FIELDS } from './config-schema-data-access.js';
 * @version-history
 *   v1.0.0 — 2026-10-18 — consent.enabled, account_events.window, consent.audit_retention_days and
 *     classification.mode moved here from config-schema.ts unchanged (max-file-lines);
 *     classification.agent_clearance_default added (plan doc-mvdipuyqraas, L2.1).
 */
import { CLEARANCE_ID_PATTERN, type dataAccessDefaults } from '../config-data-access.js';
import type { ConfigFieldShape } from './config-field-def.js';
import { oneOf } from './config-schema-validators.js';

type DataAccessKey = keyof ReturnType<typeof dataAccessDefaults>;

export const DATA_ACCESS_CONFIG_FIELDS: ConfigFieldShape<DataAccessKey>[] = [
  { key: 'consentEnabled', dotPath: 'consent.enabled', envVar: 'AIMEAT_CONSENT_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Consent layer enabled' },
  { key: 'accountEventWindow', dotPath: 'account_events.window', envVar: 'AIMEAT_ACCOUNT_EVENT_WINDOW', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 10, immutable: false, description: 'Events kept in an account live "what has happened" window before the oldest are archived', range: '10-10000' },
  { key: 'consentAuditRetentionDays', dotPath: 'consent.audit_retention_days', envVar: 'AIMEAT_CONSENT_AUDIT_RETENTION_DAYS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 3650, immutable: false, description: 'Consent audit log retention in days', range: '1-3650' },
  { key: 'classificationMode', dotPath: 'classification.mode', envVar: 'AIMEAT_CLASSIFICATION', type: 'string', ...oneOf('off', 'owner', 'all'), immutable: false, description: 'Classification: off (nothing changes), owner (each owner decides for their own content) or all (on for every owner)' },
  { key: 'agentClearanceDefault', dotPath: 'classification.agent_clearance_default', envVar: 'AIMEAT_AGENT_CLEARANCE_DEFAULT', type: 'string', validate: v => v === '' || (typeof v === 'string' && CLEARANCE_ID_PATTERN.test(v)), refusal: 'Write the id of a classification in this server\'s policy, such as sisainen, or leave it empty for no limit.', immutable: false, description: 'The highest classification a NEW agent may read, written as the classification\'s id (for example sisainen for Internal). Content classified higher is hidden from the agent and counted. Empty: no limit. Agents that already exist keep what they have, and the owner can change it on the agent\'s page. Matters only while classification is on' },
];
