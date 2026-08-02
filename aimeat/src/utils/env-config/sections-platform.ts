/**
 * @file src/utils/env-config/sections-platform.ts
 * @description Realtime, load-balancer, extensions, generator, app-origin, cortex, portfolio, agent-scope, moderation, setup, consul, metrics config sections. Extracted from src/utils/env-config.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from env-config.ts (max-file-lines)
 */

import type { AimeatConfig } from '../../config.js';
import type { ConfigSection } from './shared.js';
import { mask } from './shared.js';

export function platformSections(config: AimeatConfig): ConfigSection[] {
  return [
    {
      title: 'Realtime P2P',
      entries: [
        {
          envVar: 'AIMEAT_REALTIME_ENABLED',
          description: 'Enable realtime P2P signaling (WebRTC)',
          value: config.realtimeEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_REALTIME_MAX_ROOMS',
          description: 'Maximum concurrent rooms',
          value: String(config.realtimeMaxRooms),
          defaultVal: '100',
        },
        {
          envVar: 'AIMEAT_REALTIME_MAX_PEERS_PER_ROOM',
          description: 'Maximum peers per room',
          value: String(config.realtimeMaxPeersPerRoom),
          defaultVal: '20',
        },
        {
          envVar: 'AIMEAT_REALTIME_ROOM_IDLE_TIMEOUT_MS',
          description: 'Room idle timeout (ms)',
          value: String(config.realtimeRoomIdleTimeoutMs),
          defaultVal: '3600000',
        },
        {
          envVar: 'AIMEAT_REALTIME_MAX_MESSAGE_SIZE',
          description: 'Maximum signaling message size (bytes)',
          value: String(config.realtimeMaxMessageSizeBytes),
          defaultVal: '16384',
        },
        {
          envVar: 'AIMEAT_REALTIME_RATE_LIMIT',
          description: 'Signaling messages per second per peer',
          value: String(config.realtimeRateLimitPerSecond),
          defaultVal: '50',
        },
        {
          envVar: 'AIMEAT_STUN_SERVERS',
          description: 'STUN server URLs (comma-separated)',
          value: config.stunServers.join(', '),
          defaultVal: 'stun:stun.l.google.com:19302',
        },
        {
          envVar: 'AIMEAT_TURN_SERVER',
          description: 'TURN relay server URL',
          value: config.turnServer ?? '(not set)',
          defaultVal: '(none)',
        },
        {
          envVar: 'AIMEAT_TURN_USERNAME',
          description: 'TURN server username',
          value: config.turnUsername ?? '(not set)',
          defaultVal: '(none)',
        },
        {
          envVar: 'AIMEAT_TURN_CREDENTIAL',
          description: 'TURN server credential',
          value: config.turnCredential ? '****' : '(not set)',
          defaultVal: '(none)',
          secret: true,
        },
      ],
    },
    {
      title: 'Site Load Balancer',
      entries: [
        {
          envVar: 'AIMEAT_SITE_LB_ENABLED',
          description: 'Enable site template load balancing from origin',
          value: config.siteLbEnabled ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_SITE_LB_ORIGIN_URL',
          description: 'Origin node URL to sync templates from',
          value: config.siteLbOriginUrl ?? '(not set)',
          defaultVal: '(none)',
        },
        {
          envVar: 'AIMEAT_SITE_LB_SYNC_INTERVAL_MIN',
          description: 'Sync interval (minutes)',
          value: String(config.siteLbSyncIntervalMin),
          defaultVal: '30',
        },
        {
          envVar: 'AIMEAT_SITE_LB_SYNC_ON_STARTUP',
          description: 'Sync template on node startup',
          value: config.siteLbSyncOnStartup ? 'true' : 'false',
          defaultVal: 'true',
        },
      ],
    },
    {
      title: 'Node Extensions (Sandboxed)',
      entries: [
        {
          envVar: 'AIMEAT_EXTENSIONS_ENABLED',
          description: 'Enable sandboxed extension system',
          value: config.extensionsEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_EXT_MAX_MEMORY_MB',
          description: 'Max memory per extension isolate (MB)',
          value: String(config.extensionMaxMemoryMb),
          defaultVal: '64',
        },
        {
          envVar: 'AIMEAT_EXT_TIMEOUT_MS',
          description: 'Extension execution timeout (ms)',
          value: String(config.extensionTimeoutMs),
          defaultVal: '5000',
        },
        {
          envVar: 'AIMEAT_EXT_MAX_API_CALLS',
          description: 'Max API calls per extension invocation',
          value: String(config.extensionMaxApiCalls),
          defaultVal: '500',
        },
        {
          envVar: 'AIMEAT_EXT_MAX_CODE_SIZE_KB',
          description: 'Max extension code size (KB)',
          value: String(config.extensionMaxCodeSizeKb),
          defaultVal: '256',
        },
        {
          envVar: 'AIMEAT_EXT_MAX_INSTALLED',
          description: 'Max installed extensions per node',
          value: String(config.extensionMaxInstalled),
          defaultVal: '20',
        },
        {
          envVar: 'AIMEAT_EXT_INSTALL_ROLE',
          description: 'Role required to install extensions (operator | owner)',
          value: config.extInstallRole,
          defaultVal: 'operator',
        },
        {
          envVar: 'AIMEAT_MAX_EXTENSIONS_PER_OWNER',
          description: 'Max extensions per owner when owner-role installs enabled',
          value: String(config.maxExtensionsPerOwner),
          defaultVal: '10',
        },
      ],
    },
    {
      title: 'App Origin Isolation (H-2)',
      entries: [
        {
          envVar: 'AIMEAT_APP_ORIGIN_ENABLED',
          description: 'Serve user apps from a separate *.apps.<domain> origin to isolate them from the operator session. Requires DNS + wildcard TLS.',
          value: config.appOriginEnabled ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_APP_HOST',
          description: 'App origin host (e.g. apps.example.com) used when app origin isolation is enabled.',
          value: config.appHost,
          defaultVal: '',
        },
        {
          envVar: 'AIMEAT_PORTFOLIO_ORIGIN_ENABLED',
          description: 'Serve published portfolios standalone at <username>.portfolio.<domain>. Requires DNS + wildcard TLS.',
          value: config.portfolioOriginEnabled ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_PORTFOLIO_HOST',
          description: 'Portfolio origin host (e.g. portfolio.example.com) used when the portfolio origin is enabled.',
          value: config.portfolioHost,
          defaultVal: '',
        },
      ],
    },
    {
      title: 'Cortex Extensions (Manifest-based)',
      entries: [
        {
          envVar: 'AIMEAT_CORTEX_ENABLED',
          description: 'Enable Cortex extension system',
          value: config.cortexEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_CORTEX_MAX_INSTALLED',
          description: 'Max installed Cortex extensions',
          value: String(config.cortexMaxInstalled),
          defaultVal: '50',
        },
        {
          envVar: 'AIMEAT_CORTEX_MAX_LIB_SIZE_KB',
          description: 'Max Cortex library size (KB)',
          value: String(config.cortexMaxLibSizeKb),
          defaultVal: '512',
        },
      ],
    },
    {
      title: 'Portfolio',
      entries: [
        {
          envVar: 'AIMEAT_PORTFOLIO',
          description: 'Enable portfolio feature',
          value: config.portfolioEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_PORTFOLIO_MAX_SIZE_KB',
          description: 'Max portfolio size (KB)',
          value: String(config.portfolioMaxSizeKb),
          defaultVal: '512',
        },
        {
          envVar: 'AIMEAT_PORTFOLIO_MAX_IMAGES',
          description: 'Max portfolio images',
          value: String(config.portfolioMaxImages),
          defaultVal: '20',
        },
      ],
    },
    {
      title: 'Scoped Agent Capabilities',
      entries: [
        {
          envVar: 'AIMEAT_DEFAULT_AGENT_SCOPES',
          description: 'Default scopes granted to new agents',
          value: config.defaultAgentScopes.join(', '),
          defaultVal: 'memory:read, memory:write, memory:delete, catalogue:read',
        },
        {
          envVar: 'AIMEAT_MAX_AGENT_SCOPES',
          description: 'Maximum allowed scopes (* = unlimited)',
          value: config.maxAgentScopes.join(', '),
          defaultVal: '*',
        },
      ],
    },
    {
      title: 'Content Moderation',
      entries: [
        {
          envVar: 'AIMEAT_AUTO_HIDE_THRESHOLD',
          description: 'Flag count threshold to auto-hide content',
          value: String(config.autoHideThreshold),
          defaultVal: '5',
        },
      ],
    },
    {
      title: 'Setup Wizard',
      entries: [
        {
          envVar: 'AIMEAT_SETUP_ALLOWED_IPS',
          description: 'IPs allowed to access the setup wizard (comma-separated)',
          value: config.setupAllowedIps.length ? config.setupAllowedIps.join(', ') : '(all)',
          defaultVal: '(all)',
        },
      ],
    },
    {
      title: 'Consul (Fleet Management)',
      entries: [
        {
          envVar: 'AIMEAT_CONSUL_ENABLED',
          description: 'Enable Consul config provider',
          value: config.consulEnabled ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_CONSUL_URL',
          description: 'Consul agent URL',
          value: config.consulUrl,
          defaultVal: 'http://localhost:8500',
        },
        {
          envVar: 'AIMEAT_CONSUL_PREFIX',
          description: 'Consul KV prefix for config',
          value: config.consulPrefix,
          defaultVal: 'aimeat/config',
        },
        {
          envVar: 'AIMEAT_CONSUL_TOKEN',
          description: 'Consul ACL token',
          value: config.consulToken ? mask(config.consulToken) : '(not set)',
          defaultVal: '(none)',
          secret: true,
        },
        {
          envVar: 'AIMEAT_CONSUL_WATCH_INTERVAL',
          description: 'Config watch polling interval (seconds)',
          value: String(config.consulWatchIntervalSeconds),
          defaultVal: '30',
        },
        {
          envVar: 'AIMEAT_CONSUL_DATACENTER',
          description: 'Consul datacenter',
          value: config.consulDatacenter || '(default)',
          defaultVal: '(default)',
        },
      ],
    },
    {
      title: 'Metrics & Observability',
      entries: [
        {
          envVar: 'AIMEAT_STATS_ENABLED',
          description: 'Enable stats endpoint (GET /v1/stats)',
          value: config.statsEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_STATS_ACCESS',
          description: 'Stats access level (public | authenticated | operator)',
          value: config.statsAccess,
          defaultVal: 'public',
        },
        {
          envVar: 'AIMEAT_METRICS_ENABLED',
          description: 'Enable Prometheus metrics endpoint (GET /v1/metrics)',
          value: config.metricsEnabled ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_METRICS_ACCESS',
          description: 'Metrics access level (public | authenticated | operator)',
          value: config.metricsAccess,
          defaultVal: 'operator',
        },
      ],
    },
  ];
}
