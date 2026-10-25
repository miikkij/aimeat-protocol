/**
 * @file src/config-runtime.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's runtime settings that were read straight from process.env where they were
 *   used, so the admin Config tab never showed them and a value saved there could not reach them:
 *   the usage meter's windows and batches, the write tally's flush interval, the log level, the proxy
 *   trust, and the node's key material. They are loaded here like every other setting, have rows in
 *   services/config-schema-runtime.ts, and their code reads the config.
 *
 *   Found 2026-10-25, when check:config-coverage was widened from src/config*.ts to all of src/.
 *   Also here: the site key-value pairs, which the loader read from every AIMEAT_SITE_KV_<NAME>
 *   variable and which now also take one JSON object, AIMEAT_SITE_KV, so the Config tab can hold them.
 * @structure RuntimeConfig · runtimeConfigFromEnv(env) · siteKvFromEnv(env)
 * @usage const runtime = runtimeConfigFromEnv(process.env);   // spread into the config in config.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial.
 */

import { isJsonObject } from './services/config-schema-validators.js';

export interface RuntimeConfig {
  /** How often the usage call stream's buffer is written to the database, in ms. Read at start. */
  usageBufferMs: number;
  /** Days raw usage rows stay in the hot tables before the archive job moves them. 0 keeps none. */
  usageHotDays: number;
  /** Days the hour-grain usage rollups are kept; the day grain carries the history. */
  usageHourRollupDays: number;
  /** Rows the usage archive job moves per sweep. */
  usageArchiveBatch: number;
  /** Raw rows the usage rollup folds per pass. */
  usageRollupBatch: number;
  /** Passes per usage rollup run, so one run is bounded after a long outage. */
  usageRollupPasses: number;
  /** How often the write tally's buffer is written to the database, in ms. Read at start. */
  tallyBufferMs: number;
  /** The log level: error, warn, info, http, verbose, debug or silly. */
  logLevel: string;
  /** Express "trust proxy": a hop count, a subnet list, `true`, or empty for loopback only. */
  trustProxy: string;
  /** Where the node key file is; empty uses the default place beside the data. */
  nodeKeyPath: string;
  /** The passphrase that opens the node key file (secret). */
  keyPassphrase: string | null;
  /** The federation signing key pair `aimeat join` writes, public half. */
  federationPublicKey: string;
  /** The federation signing key pair, private half (secret). */
  federationPrivateKey: string | null;
  /** Requests a minute to the OpenRouter proxy (the `openrouter` limiter tier). */
  rlOpenrouter: number;
  /** Invitation emails an hour from the open registration endpoint (the `registrationInvites` tier). */
  rlRegistrationInvites: number;
}

const LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];

/** A whole number from the environment, or the default when it is unset or not a number. Zero is a value. */
function count(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function runtimeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const level = (env.AIMEAT_LOG_LEVEL ?? env.LOG_LEVEL ?? 'info').trim().toLowerCase();
  return {
    // A flush interval of 0 would spin; the buffers take at least one second.
    usageBufferMs: Math.max(1000, count(env.AIMEAT_USAGE_BUFFER_MS, 15_000)),
    usageHotDays: count(env.AIMEAT_USAGE_HOT_DAYS, 90),
    usageHourRollupDays: count(env.AIMEAT_USAGE_HOUR_ROLLUP_DAYS, 30),
    usageArchiveBatch: Math.max(1, count(env.AIMEAT_USAGE_ARCHIVE_BATCH, 2_000)),
    usageRollupBatch: Math.max(1, count(env.AIMEAT_USAGE_ROLLUP_BATCH, 5_000)),
    usageRollupPasses: Math.max(1, count(env.AIMEAT_USAGE_ROLLUP_PASSES, 20)),
    tallyBufferMs: Math.max(1000, count(env.AIMEAT_TALLY_BUFFER_MS, 15_000)),
    logLevel: LOG_LEVELS.includes(level) ? level : 'info',
    trustProxy: (env.AIMEAT_TRUST_PROXY ?? '').trim(),
    nodeKeyPath: (env.AIMEAT_NODE_KEY_PATH ?? '').trim(),
    keyPassphrase: env.AIMEAT_KEY_PASSPHRASE || null,
    federationPublicKey: env.AIMEAT_PUBLIC_KEY ?? '',
    federationPrivateKey: env.AIMEAT_PRIVATE_KEY || null,
    // The same numbers config.rateLimits starts with (config.ts); syncRateLimitTiers copies a changed
    // value into the tier.
    rlOpenrouter: Math.max(1, count(env.AIMEAT_RL_OPENROUTER, 30)),
    rlRegistrationInvites: Math.max(1, count(env.AIMEAT_RL_REGISTRATION_INVITES, 5)),
  };
}

/**
 * The site key-value pairs: AIMEAT_SITE_KV, a JSON object of name to text, and every
 * AIMEAT_SITE_KV_<NAME> variable, which wins over the same name in the object.
 */
export function siteKvFromEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = env.AIMEAT_SITE_KV?.trim();
  if (raw) {
    if (isJsonObject(raw)) {
      for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) out[k.toLowerCase()] = String(v ?? '');
    } else {
      console.warn('[config] AIMEAT_SITE_KV is not a JSON object of name to text, so it adds no site value. The AIMEAT_SITE_KV_<NAME> variables still count.');
    }
  }
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith('AIMEAT_SITE_KV_')) out[k.slice('AIMEAT_SITE_KV_'.length).toLowerCase()] = v ?? '';
  }
  return out;
}
