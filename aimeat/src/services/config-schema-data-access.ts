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
 *   v1.6.0 — 2026-11-02 — consent.app_party_signups_per_hour and consent.app_party_pending_hours
 *     (secaudit2026nov02d round 13).
 *   v1.5.0 — 2026-11-02 — consent.party_purchases_per_hour (secaudit2026nov02d round 13).
 *   v1.4.0 — 2026-11-01 — The `dataspace` rows (config-schema-dataspace.ts; plan doc-mvwxcas3dom3, D8).
 *   v1.3.0 — 2026-11-01 — consent.party_self_registration (plan doc-mvwxcas3dom3, D4.3).
 *   v1.2.0 — 2026-11-01 — consent.data_intermediation (plan doc-mvwxcas3dom3, D7.1).
 *   v1.1.0 — 2026-11-01 — consent.share_max_days and consent.party_reads_per_minute (plan
 *     doc-mvwxcas3dom3, D2.9, D3.1).
 *   v1.0.0 — 2026-10-18 — consent.enabled, account_events.window, consent.audit_retention_days and
 *     classification.mode moved here from config-schema.ts unchanged (max-file-lines);
 *     classification.agent_clearance_default added (plan doc-mvdipuyqraas, L2.1).
 */
import { CLEARANCE_ID_PATTERN, type dataAccessDefaults } from '../config-data-access.js';
import type { ConfigFieldShape } from './config-field-def.js';
import { oneOf } from './config-schema-validators.js';
import { DATASPACE_CONFIG_FIELDS } from './config-schema-dataspace.js';

type DataAccessKey = keyof ReturnType<typeof dataAccessDefaults>;

export const DATA_ACCESS_CONFIG_FIELDS: ConfigFieldShape<DataAccessKey>[] = [
  { key: 'consentEnabled', dotPath: 'consent.enabled', envVar: 'AIMEAT_CONSENT_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Consent layer enabled' },
  { key: 'accountEventWindow', dotPath: 'account_events.window', envVar: 'AIMEAT_ACCOUNT_EVENT_WINDOW', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 10, immutable: false, description: 'Events kept in an account live "what has happened" window before the oldest are archived', range: '10-10000' },
  { key: 'shareMaxDays', dotPath: 'consent.share_max_days', envVar: 'AIMEAT_SHARE_MAX_DAYS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 3650, immutable: false, description: 'The longest a named share of a data package to an outside party may last, in days. A share made without an end gets this many days; a later end is refused', range: '1-3650' },
  { key: 'partyReadsPerMinute', dotPath: 'consent.party_reads_per_minute', envVar: 'AIMEAT_PARTY_READS_PER_MINUTE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 100000, immutable: false, description: 'How many reads one outside party may make in a minute. Past it the read is refused with 429 and written to the owner\'s read log', range: '1-100000' },
  { key: 'partyPurchasesPerHour', dotPath: 'consent.party_purchases_per_hour', envVar: 'AIMEAT_PARTY_PURCHASES_PER_HOUR', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100000, immutable: false, description: 'How many purchases of a data package one address may open in an hour without an account or a party key. Past it the opening is refused with 429. A party buying again with its key is not counted. 0: no limit', range: '0-100000' },
  { key: 'dataIntermediation', dotPath: 'consent.data_intermediation', envVar: 'AIMEAT_DATA_INTERMEDIATION', type: 'string', ...oneOf('report', 'none', 'node', 'owners'), immutable: false, description: 'Whether this server runs a data intermediation service (EU Data Governance Act 2022/868) and who provides it. report: nothing is refused, and the Compliance page lists what could count as intermediation. none: the server intermediates no data, so an offering that delivers data is not listed to everyone. node: the operator is the provider and keeps the notification record. owners: an owner or organism that declared itself a provider may list data to everyone; everyone else is as none' },
  { key: 'partySelfRegistration', dotPath: 'consent.party_self_registration', envVar: 'AIMEAT_PARTY_SELF_REGISTRATION', type: 'string', ...oneOf('off', 'apps-ask', 'on'), immutable: false, description: 'Whether people may register to an app as its outside parties: an app\'s own users with no account on this server, who sign in with an e-mail link and see only what the app gives them. off: nobody registers. apps-ask: an app\'s owner asks, and the operator approves each app. on: an app\'s owner opens its signup. A server that shows its content to signed-in accounts only is always off' },
  { key: 'appPartySignupsPerHour', dotPath: 'consent.app_party_signups_per_hour', envVar: 'AIMEAT_APP_PARTY_SIGNUPS_PER_HOUR', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100000, immutable: false, description: 'How many times one network address may sign up to this server\'s apps in an hour, counted over every app. Past it the signup is refused with 429 until the hour has passed. 0: no limit', range: '0-100000' },
  { key: 'appPartyPendingHours', dotPath: 'consent.app_party_pending_hours', envVar: 'AIMEAT_APP_PARTY_PENDING_HOURS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 8760, immutable: false, description: 'How many hours a person who signed up to an app and never opened the mailed link keeps a place in the app\'s list of registered people, counted from the last link sent. After that the next signup to the app removes them, and their place counts no more toward the app\'s limit of 1000 people. They can sign up again. 0: they keep the place until the app\'s owner removes them', range: '0-8760' },
  { key: 'consentAuditRetentionDays', dotPath: 'consent.audit_retention_days', envVar: 'AIMEAT_CONSENT_AUDIT_RETENTION_DAYS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 3650, immutable: false, description: 'Consent audit log retention in days', range: '1-3650' },
  { key: 'classificationMode', dotPath: 'classification.mode', envVar: 'AIMEAT_CLASSIFICATION', type: 'string', ...oneOf('off', 'owner', 'all'), immutable: false, description: 'Classification: off (nothing changes), owner (each owner decides for their own content) or all (on for every owner)' },
  // ── The Eclipse Dataspace Protocol provider, section `dataspace` ── config-schema-dataspace.ts
  ...DATASPACE_CONFIG_FIELDS,
  { key: 'agentClearanceDefault', dotPath: 'classification.agent_clearance_default', envVar: 'AIMEAT_AGENT_CLEARANCE_DEFAULT', type: 'string', validate: v => v === '' || (typeof v === 'string' && CLEARANCE_ID_PATTERN.test(v)), refusal: 'Write the id of a classification in this server\'s policy, such as sisainen, or leave it empty for no limit.', immutable: false, description: 'The highest classification a NEW agent may read, written as the classification\'s id (for example sisainen for Internal). Content classified higher is hidden from the agent and counted. Empty: no limit. Agents that already exist keep what they have, and the owner can change it on the agent\'s page. Matters only while classification is on' },
];
