/**
 * @file src/utils/env-config/sections-federation.ts
 * @description Federation, work-queue, and rate-limit config sections. Extracted from src/utils/env-config.ts to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-07-14 — AIMEAT_WEB_BOT_AUTH_SIGN in the Federation section (Web Bot Auth)
 *   v1.0.0 — 2026-07-13 — Extracted from env-config.ts (max-file-lines)
 */

import type { AimeatConfig } from '../../config.js';
import type { ConfigSection } from './shared.js';

export function federationSections(config: AimeatConfig): ConfigSection[] {
  return [
    {
      title: 'Federation',
      entries: [
        {
          envVar: 'AIMEAT_FEDERATION_ROLE',
          description: 'Network role: operator (genesis directory), contributor (join genesis), standalone',
          value: config.federationRole,
          defaultVal: 'standalone',
        },
        {
          envVar: 'AIMEAT_GENESIS_URL',
          description: 'Genesis node URL to register with (for contributor role)',
          value: config.genesisUrl ?? '(not set)',
          defaultVal: '(none)',
        },
        {
          envVar: 'AIMEAT_MAX_RELAY_HOPS',
          description: 'Maximum number of hops when relaying between nodes',
          value: String(config.maxRelayHops),
          defaultVal: '3',
        },
        {
          envVar: 'AIMEAT_DEPEERING_GRACE_HOURS',
          description: 'Hours to wait before removing a disconnected peer',
          value: String(config.depeeringGracePeriodHours),
          defaultVal: '72',
        },
        {
          envVar: 'AIMEAT_KEY_CACHE_REFRESH_MINUTES',
          description: 'How often to refresh peer key cache (minutes)',
          value: String(config.keyCacheRefreshMinutes),
          defaultVal: '5',
        },
        {
          envVar: 'AIMEAT_WEB_BOT_AUTH_SIGN',
          description: 'Sign outbound HTTP with the node Ed25519 key (RFC 9421 Web Bot Auth; key directory at /.well-known/http-message-signatures-directory is always served)',
          value: config.webBotAuthSign ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_CROSS_FEDERATION_ENABLED',
          description: 'Enable cross-federation genesis peering (connects independent nodes/clusters)',
          value: String(config.crossFederationEnabled),
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_MAX_GENESIS_PEERS',
          description: 'Maximum number of genesis peer connections',
          value: String(config.maxGenesisPeers),
          defaultVal: '10',
        },
        {
          envVar: 'AIMEAT_GENESIS_SYNC_INTERVAL_HOURS',
          description: 'Hours between catalogue sync with genesis peers',
          value: String(config.genesisSyncIntervalHours),
          defaultVal: '6',
        },
        {
          envVar: 'AIMEAT_SYNC_MODE',
          description: 'Sync mode: bulk (scheduled), instant (event-driven), or hybrid',
          value: config.syncMode,
          defaultVal: 'hybrid',
        },
        {
          envVar: 'AIMEAT_SYNC_INTERVAL_HOURS',
          description: 'Hours between scheduled federation sync rounds',
          value: String(config.syncIntervalHours),
          defaultVal: '6',
        },
        {
          envVar: 'AIMEAT_SYNC_BATCH_DELAY_MS',
          description: 'Event batching window in ms (instant/hybrid mode)',
          value: String(config.syncBatchDelayMs),
          defaultVal: '5000',
        },
        {
          envVar: 'AIMEAT_REPLICATION_QUEUE_MAX',
          description: 'Maximum replication queue entries',
          value: String(config.replicationQueueMax),
          defaultVal: '10000',
        },
        {
          envVar: 'AIMEAT_REPLICATION_QUEUE_TTL_HOURS',
          description: 'Max age of replication queue entries (hours)',
          value: String(config.replicationQueueTtlHours),
          defaultVal: '72',
        },
        {
          envVar: 'AIMEAT_MAX_CONCURRENT_SYNCS',
          description: 'Max parallel outbound sync operations',
          value: String(config.maxConcurrentSyncs),
          defaultVal: '5',
        },
        {
          envVar: 'AIMEAT_FEDERATION_TIMEOUT_MS',
          description: 'Timeout for outbound federation requests (ms)',
          value: String(config.federationTimeoutMs),
          defaultVal: '10000',
        },
        {
          envVar: 'AIMEAT_MESSAGE_RETRY_INTERVAL_MS',
          description: 'Retry interval for queued cross-node direct messages (ms)',
          value: String(config.messageRetryIntervalMs),
          defaultVal: '60000',
        },
        {
          envVar: 'AIMEAT_MESSAGE_RETRY_TTL_HOURS',
          description: 'Give up on undelivered direct messages after this many hours',
          value: String(config.messageRetryTtlHours),
          defaultVal: '168',
        },
        {
          envVar: 'AIMEAT_GENESIS_MEMORY_CACHE',
          description: 'Cache routed genesis memory results locally',
          value: String(config.genesisMemoryCache),
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_GENESIS_MEMORY_CACHE_TTL_HOURS',
          description: 'Genesis memory cache TTL (hours)',
          value: String(config.genesisMemoryCacheTtlHours),
          defaultVal: '4',
        },
      ],
    },
    {
      title: 'Work Queue',
      entries: [
        {
          envVar: 'AIMEAT_WEBHOOK_MAX_RETRIES',
          description: 'Maximum retry attempts for webhook deliveries',
          value: String(config.webhookMaxRetries),
          defaultVal: '5',
        },
        {
          envVar: 'AIMEAT_WORK_QUEUE_MAX_PENDING',
          description: 'Maximum pending work items per agent',
          value: String(config.workQueueMaxPending),
          defaultVal: '10',
        },
      ],
    },
    {
      title: 'Rate Limits (requests per second)',
      entries: [
        {
          envVar: 'AIMEAT_RL_GLOBAL',
          description: 'Global rate limit for all requests',
          value: String(config.rateLimits.global.max),
          defaultVal: '300',
        },
        {
          envVar: 'AIMEAT_RL_AUTH',
          description: 'Rate limit for authentication requests',
          value: String(config.rateLimits.auth.max),
          defaultVal: '20',
        },
        {
          envVar: 'AIMEAT_RL_WORK',
          description: 'Rate limit for work queue requests',
          value: String(config.rateLimits.work.max),
          defaultVal: '60',
        },
        {
          envVar: 'AIMEAT_RL_MEMORY',
          description: 'Rate limit for memory read/write requests',
          value: String(config.rateLimits.memory.max),
          defaultVal: '120',
        },
        {
          envVar: 'AIMEAT_RL_BOARDS',
          description: 'Rate limit for board requests',
          value: String(config.rateLimits.boards.max),
          defaultVal: '60',
        },
        {
          envVar: 'AIMEAT_RL_OWNERS',
          description: 'Owner endpoint rate limit (default: global)',
          value: String(config.rateLimits.owners.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_GHII',
          description: 'Identity (GHII) rate limit (default: global)',
          value: String(config.rateLimits.ghii.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_FLAGS',
          description: 'Content flagging rate limit (default: global)',
          value: String(config.rateLimits.flags.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_APPEALS',
          description: 'Flag appeals rate limit (default: global)',
          value: String(config.rateLimits.appeals.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_ADMIN_SETUP',
          description: 'Admin setup rate limit (default: global)',
          value: String(config.rateLimits.adminSetup.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_FEDERATION',
          description: 'Federation peering rate limit (default: global)',
          value: String(config.rateLimits.federation.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_CATALOGUE',
          description: 'Catalogue search rate limit (default: global)',
          value: String(config.rateLimits.catalogue.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_AUTH_CHALLENGE',
          description: 'Auth challenge rate limit (default: global)',
          value: String(config.rateLimits.authChallenge.max),
          defaultVal: String(config.rateLimits.global.max),
        },
      ],
    },
  ];
}
