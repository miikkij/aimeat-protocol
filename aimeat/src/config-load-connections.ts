/**
 * @file src/config-load-connections.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reads the OUTBOUND connect settings out of the environment: the applications this
 *   node is registered as at each service a person can connect their own account at, plus the two
 *   that decide whether it will run a local MCP server PROCESS.
 *
 *   A PURE EXTRACTION from config.ts, which had crossed the 800-line ceiling again. The lines moved
 *   verbatim and nothing else changed; their types already lived apart, in
 *   config-types-connections.ts and config-types-mcp-proxy.ts, for the same reason.
 *
 *   THE TWO GROUPS ARE HERE TOGETHER BECAUSE THEY ARE ONE QUESTION ASKED TWICE: what will this node
 *   reach out to on somebody's behalf, and what does it need to hold in order to. Both default to
 *   OFF with `=== 'true'`, so a node that has never heard of either does not start offering to hold
 *   people's accounts, and does not start programs because somebody attached a record.
 * @structure loadConnectionsConfig()
 * @usage const config = { ...loadConnectionsConfig(), … };
 * @version-history
 *   v1.0.0 — 2026-09-16 — Extracted from config.ts (max-file-lines), with the two stdio settings as
 *     the block that pushed it over.
 */
import type { ConnectionsConfig } from './config-types-connections.js';
import type { McpProxyConfig } from './config-types-mcp-proxy.js';

export function loadConnectionsConfig(): ConnectionsConfig & McpProxyConfig {
  return {
    // Outbound connections (TARGET-057). Opt-IN: `=== 'true'`, so a node that has never heard of
    // this feature does not start offering to hold people's accounts.
    connectionsEnabled: process.env.AIMEAT_CONNECTIONS_ENABLED === 'true',
    connectGoogleClientId: process.env.AIMEAT_CONNECT_GOOGLE_CLIENT_ID ?? '',
    connectGoogleClientSecret: process.env.AIMEAT_CONNECT_GOOGLE_CLIENT_SECRET ?? '',
    connectMicrosoftClientId: process.env.AIMEAT_CONNECT_MICROSOFT_CLIENT_ID ?? '',
    connectMicrosoftClientSecret: process.env.AIMEAT_CONNECT_MICROSOFT_CLIENT_SECRET ?? '',
    // 'common' admits work, school and personal accounts; 'organizations' only work and school. A
    // GUID pins one directory. This is the tenant the NODE's own app is registered in; a principal
    // who brings their own single-tenant app supplies its tenant with the client credentials.
    connectMicrosoftTenant: process.env.AIMEAT_CONNECT_MICROSOFT_TENANT ?? 'common',
    connectLinkedinClientId: process.env.AIMEAT_CONNECT_LINKEDIN_CLIENT_ID ?? '',
    connectLinkedinClientSecret: process.env.AIMEAT_CONNECT_LINKEDIN_CLIENT_SECRET ?? '',
    connectXClientId: process.env.AIMEAT_CONNECT_X_CLIENT_ID ?? '',
    connectXClientSecret: process.env.AIMEAT_CONNECT_X_CLIENT_SECRET ?? '',
    connectRedirectUri: process.env.AIMEAT_CONNECT_REDIRECT_URI ?? '',
    connectFakeBaseUrl: process.env.AIMEAT_CONNECT_FAKE_BASE_URL ?? '',

    // Running a LOCAL MCP server process. Opt-IN for a stronger version of the same reason: a
    // stdio record is code execution on this host, so a node that has never heard of the feature
    // must not start programs because somebody attached a record. An empty allowlist means
    // nothing runs, which is the safe reading rather than a bug.
    mcpStdioEnabled: process.env.AIMEAT_MCP_STDIO_ENABLED === 'true',
    mcpStdioAllowedCommands: (process.env.AIMEAT_MCP_STDIO_ALLOWED_COMMANDS ?? '')
      .split(',').map((c) => c.trim()).filter(Boolean),
  };
}
