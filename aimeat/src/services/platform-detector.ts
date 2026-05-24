/**
 * @file platform-detector.ts
 * @description Auto-detect agent platform from connection metadata.
 *   Checks User-Agent header and MCP client metadata against known patterns.
 * @structure
 *   - KNOWN_PLATFORMS -- registry of known platform patterns
 *   - detectPlatform(userAgent, mcpMetadata) -- returns detected platform or null
 *   - parsePlatformFromMessage(message) -- detect from agent message content
 *   - getKnownPlatforms() -- list all known platforms
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 */

export interface PlatformInfo {
  id: string;
  displayName: string;
  version?: string;
  detectedBy: 'auto' | 'self_report' | 'message_reply';
}

interface PlatformPattern {
  id: string;
  displayName: string;
  userAgentPattern: RegExp;
  bundleName: string;
}

const KNOWN_PLATFORMS: PlatformPattern[] = [
  { id: 'hermes', displayName: 'Hermes (OpenClaw)', userAgentPattern: /Hermes\/([\d.]+)/i, bundleName: 'aimeat-hermes' },
  { id: 'claude-code', displayName: 'Claude Code', userAgentPattern: /claude-code\/([\d.]+)/i, bundleName: 'aimeat-claude-code' },
  { id: 'copilot', displayName: 'GitHub Copilot CLI', userAgentPattern: /copilot-cli\/([\d.]+)/i, bundleName: 'aimeat-copilot' },
  { id: 'codex', displayName: 'OpenAI Codex CLI', userAgentPattern: /codex\/([\d.]+)/i, bundleName: 'aimeat-codex' },
  { id: 'gemini', displayName: 'Google Gemini CLI', userAgentPattern: /gemini-cli\/([\d.]+)/i, bundleName: 'aimeat-gemini' },
];

export function detectPlatform(userAgent?: string, mcpMetadata?: Record<string, unknown>): PlatformInfo | null {
  if (userAgent) {
    for (const platform of KNOWN_PLATFORMS) {
      const match = platform.userAgentPattern.exec(userAgent);
      if (match) {
        return {
          id: platform.id,
          displayName: platform.displayName,
          version: match[1],
          detectedBy: 'auto',
        };
      }
    }
  }

  if (mcpMetadata) {
    const clientName = (mcpMetadata.clientName ?? mcpMetadata.client_name ?? '') as string;
    for (const platform of KNOWN_PLATFORMS) {
      const match = platform.userAgentPattern.exec(clientName);
      if (match) {
        return {
          id: platform.id,
          displayName: platform.displayName,
          version: match[1],
          detectedBy: 'auto',
        };
      }
    }
  }

  return null;
}

export function parsePlatformFromMessage(message: string): PlatformInfo | null {
  const lower = message.toLowerCase().trim();

  for (const platform of KNOWN_PLATFORMS) {
    if (lower === platform.id || lower.startsWith(platform.id + ' ')) {
      return {
        id: platform.id,
        displayName: platform.displayName,
        detectedBy: 'message_reply',
      };
    }
  }

  if (lower === 'other' || lower.startsWith('other ')) {
    return {
      id: 'other',
      displayName: 'Other / Unknown',
      detectedBy: 'message_reply',
    };
  }

  return null;
}

export function getKnownPlatforms(): Array<{ id: string; displayName: string; bundleName: string; detectPattern: string }> {
  return KNOWN_PLATFORMS.map(p => ({ id: p.id, displayName: p.displayName, bundleName: p.bundleName, detectPattern: p.userAgentPattern.source }));
}
