/**
 * @file src/services/config-schema-runtime.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Config-tab rows for the node's runtime and deployment settings: the usage meter, the
 *   write tally, the log level, and the settings that describe how the node is deployed (its security
 *   profile, proxy trust, private-network reach, the app, portfolio and company origins, and its key
 *   material). Until 2026-10-25 every one of these was read from the environment with no row, so the
 *   operator could not see them on the Config tab (check:config-coverage, widened to all of src/).
 *
 *   WHICH ARE STORED IN THE DATABASE. The usage meter and the log level are. The deployment rows are
 *   immutable, for the reason each says: a value that decides who may reach what, or that the node
 *   needs before its database is open, is set by whoever runs the node, in the environment, and the
 *   Config tab shows it. The secrets show only whether they are set.
 * @structure RUNTIME_CONFIG_FIELDS
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial.
 */
// Typed by the keys alone, not AimeatConfig: config-types.ts reaches config-schema.ts, so importing
// the config type here would close an import cycle (config-schema-rate-limits.ts says the same).
// config-schema.ts spreads these rows into CONFIG_FIELDS, where each key is checked against AimeatConfig.
import type { ConfigFieldShape } from './config-field-def.js';
import { oneOf } from './config-schema-validators.js';

/** A whole number at or above `min`. */
const whole = (min: number) => (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= min;
const bool = (v: unknown): boolean => typeof v === 'boolean';
const text = (v: unknown): boolean => typeof v === 'string';
const textOrNull = (v: unknown): boolean => v === null || typeof v === 'string';

type RuntimeKey = 'usageHotDays' | 'usageHourRollupDays' | 'usageArchiveBatch' | 'usageRollupBatch' | 'usageRollupPasses'
  | 'usageBufferMs' | 'tallyBufferMs' | 'logLevel' | 'perfTrace' | 'nodeKeyPath' | 'keyPassphrase' | 'encryptionKey'
  | 'federationPublicKey' | 'federationPrivateKey' | 'securityProfile' | 'allowPrivateEgress' | 'trustProxy' | 'appHost'
  | 'appOriginEnabled' | 'portfolioHost' | 'portfolioOriginEnabled' | 'coHost' | 'coOriginEnabled' | 'connectFakeBaseUrl'
  | 'x402TestFacilitator';

export const RUNTIME_CONFIG_FIELDS: ConfigFieldShape<RuntimeKey>[] = [
  // ── Usage meter (mutable). The windows and batches are read on each run; the flush intervals at start. ──
  { key: 'usageHotDays', dotPath: 'usage.hot_days', envVar: 'AIMEAT_USAGE_HOT_DAYS', type: 'number', validate: whole(0), immutable: false, description: 'Days raw usage rows stay in the hot tables before the archive job moves them (0 keeps none hot). Nothing is deleted', range: '0-3650' },
  { key: 'usageHourRollupDays', dotPath: 'usage.hour_rollup_days', envVar: 'AIMEAT_USAGE_HOUR_ROLLUP_DAYS', type: 'number', validate: whole(0), immutable: false, description: 'Days the hour-by-hour usage figures are kept; the day-by-day figures keep the history', range: '0-3650' },
  { key: 'usageArchiveBatch', dotPath: 'usage.archive_batch', envVar: 'AIMEAT_USAGE_ARCHIVE_BATCH', type: 'number', validate: whole(1), immutable: false, description: 'Rows the archive job moves in one step', range: '1-100000' },
  { key: 'usageRollupBatch', dotPath: 'usage.rollup_batch', envVar: 'AIMEAT_USAGE_ROLLUP_BATCH', type: 'number', validate: whole(1), immutable: false, description: 'Raw rows the usage rollup adds up in one step', range: '1-100000' },
  { key: 'usageRollupPasses', dotPath: 'usage.rollup_passes', envVar: 'AIMEAT_USAGE_ROLLUP_PASSES', type: 'number', validate: whole(1), immutable: false, description: 'Steps per usage rollup run, so one run stays short after a long outage; the next run continues', range: '1-1000' },
  { key: 'usageBufferMs', dotPath: 'usage.buffer_ms', envVar: 'AIMEAT_USAGE_BUFFER_MS', type: 'number', validate: whole(100), immutable: false, applies: 'restart', description: 'How often recorded calls are written to the database, in milliseconds. A usage chart is at most this much behind', range: '100-600000' },
  { key: 'tallyBufferMs', dotPath: 'usage.tally_buffer_ms', envVar: 'AIMEAT_TALLY_BUFFER_MS', type: 'number', validate: whole(100), immutable: false, applies: 'restart', description: 'How often the count of who wrote which memory key is written to the database, in milliseconds', range: '100-600000' },

  // ── Logging (mutable, applied at once) ──
  { key: 'logLevel', dotPath: 'node.log_level', envVar: 'AIMEAT_LOG_LEVEL', type: 'string', ...oneOf('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'), immutable: false, description: 'How much the node writes to its log: error is the least, debug and silly the most' },
  // Read when storage is created, before the database layer is applied, so it cannot be stored there.
  { key: 'perfTrace', dotPath: 'node.perf_trace', envVar: 'AIMEAT_PERF_TRACE', type: 'boolean', validate: bool, immutable: true, description: 'Time every storage call and log the slow ones. For finding a slow node; costs a little on every call. Set in the environment' },

  // ── Key material (immutable: the node needs it before its database is open) ──
  { key: 'nodeKeyPath', dotPath: 'node.key_path', envVar: 'AIMEAT_NODE_KEY_PATH', type: 'string', validate: text, immutable: true, description: 'Where the node key file is. Empty uses a file named after the node id under ~/.aimeat' },
  { key: 'keyPassphrase', dotPath: 'node.key_passphrase', envVar: 'AIMEAT_KEY_PASSPHRASE', type: 'string', validate: textOrNull, immutable: true, description: 'Passphrase that encrypts the node key file (secret)', adminDisplay: 'configured' },
  { key: 'encryptionKey', dotPath: 'node.encryption_key', envVar: 'AIMEAT_ENCRYPTION_KEY', type: 'string', validate: textOrNull, immutable: true, description: 'Data key that encrypts the stored secrets, 64 hexadecimal characters (secret)', adminDisplay: 'configured' },
  { key: 'federationPublicKey', dotPath: 'federation.public_key', envVar: 'AIMEAT_PUBLIC_KEY', type: 'string', validate: text, immutable: true, description: 'Public half of the key pair `aimeat join` made for federation. Empty until the node joins one' },
  { key: 'federationPrivateKey', dotPath: 'federation.private_key', envVar: 'AIMEAT_PRIVATE_KEY', type: 'string', validate: textOrNull, immutable: true, description: 'Private half of that key pair (secret)', adminDisplay: 'configured' },

  // ── Deployment (immutable: each decides who may reach what) ──
  { key: 'securityProfile', dotPath: 'security.profile', envVar: 'AIMEAT_SECURITY_PROFILE', type: 'string', ...oneOf('local', 'public'), immutable: true, description: 'local or public. Sets the safe defaults for a node on the internet (public) or on one machine (local); every explicit setting still wins. Empty decides from the node address' },
  { key: 'allowPrivateEgress', dotPath: 'security.allow_private_egress', envVar: 'AIMEAT_ALLOW_PRIVATE_EGRESS', type: 'boolean', validate: bool, immutable: true, description: 'Let the node call addresses in private networks (localhost, 10.x, 192.168.x). On by default for a local profile, off for public' },
  { key: 'trustProxy', dotPath: 'security.trust_proxy', envVar: 'AIMEAT_TRUST_PROXY', type: 'string', validate: text, immutable: true, description: 'Which reverse proxies the node trusts to report the visitor\'s address: a hop count (1), a subnet list, or true for any. Empty trusts loopback on a public address' },
  { key: 'appHost', dotPath: 'apps.host', envVar: 'AIMEAT_APP_HOST', type: 'string', validate: text, immutable: true, description: 'Host the apps are served from, apart from the node\'s own pages. Empty derives apps.<domain> from the node address' },
  { key: 'appOriginEnabled', dotPath: 'apps.origin_enabled', envVar: 'AIMEAT_APP_ORIGIN_ENABLED', type: 'boolean', validate: bool, immutable: true, description: 'Serve apps from their own host, so an app never runs beside the signed-in pages. On by default for a public profile; needs wildcard DNS and TLS for that host' },
  { key: 'portfolioHost', dotPath: 'portfolio.host', envVar: 'AIMEAT_PORTFOLIO_HOST', type: 'string', validate: text, immutable: true, description: 'Host the portfolios are served from. Empty derives portfolio.<domain> from the node address' },
  { key: 'portfolioOriginEnabled', dotPath: 'portfolio.origin_enabled', envVar: 'AIMEAT_PORTFOLIO_ORIGIN_ENABLED', type: 'boolean', validate: bool, immutable: true, description: 'Serve portfolios from their own host. Needs DNS and TLS for that host' },
  { key: 'coHost', dotPath: 'site.company_host', envVar: 'AIMEAT_CO_HOST', type: 'string', validate: text, immutable: true, description: 'Host the company pages are served from ({company}.co.<domain>). Empty derives it from the node address' },
  { key: 'coOriginEnabled', dotPath: 'site.company_origin_enabled', envVar: 'AIMEAT_CO_ORIGIN_ENABLED', type: 'boolean', validate: bool, immutable: true, description: 'Serve each company page from its own host. Needs wildcard DNS and TLS for it' },

  // ── Test hooks (immutable, empty or off everywhere but a test node) ──
  { key: 'connectFakeBaseUrl', dotPath: 'connections.fake_base_url', envVar: 'AIMEAT_CONNECT_FAKE_BASE_URL', type: 'string', validate: text, immutable: true, description: 'Test nodes only: address of a stand-in provider for outside accounts. Empty everywhere else' },
  { key: 'x402TestFacilitator', dotPath: 'commerce.x402_test_facilitator', envVar: 'AIMEAT_X402_TEST_FACILITATOR', type: 'boolean', validate: bool, immutable: true, description: 'Test nodes only: accept x402 payments from a stand-in facilitator. Off everywhere else' },
];
