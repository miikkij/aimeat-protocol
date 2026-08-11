/**
 * @file platform-detector.ts
 * @description Auto-detect agent platform from connection metadata.
 *   Checks User-Agent header and MCP client metadata against known patterns.
 * @structure
 *   - KNOWN_PLATFORMS -- registry of known platform patterns
 *   - detectPlatform(userAgent, mcpMetadata) -- returns detected platform or null
 *   - parsePlatformFromMessage(message) -- detect from agent message content
 *   - inferModeFromPlatform(platform) -- 'workstation' for an agent that lives in the user's own tool
 *   - getKnownPlatforms() -- list all known platforms
 * @version-history
 *   v1.1.0 -- 2026-08-11 -- inferModeFromPlatform(): the platform an agent reports already says
 *     whether it is node-resident, so the mode no longer has to be guessed by the agent itself.
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 */
import type { AgentMode } from '../models/agent-onboarding-schemas.js';

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
  /** True when the platform runs inside the user's OWN environment and visits the node over MCP as
   *  one tool among many. See WORKSTATION_STEP_IDS: such an agent has no delivery channel, no
   *  telemetry and no task queue of its own, so those onboarding steps do not apply to it. */
  workstation?: boolean;
}

const KNOWN_PLATFORMS: PlatformPattern[] = [
  { id: 'hermes', displayName: 'Hermes (OpenClaw)', userAgentPattern: /Hermes\/([\d.]+)/i, bundleName: 'aimeat-hermes' },
  { id: 'claude-code', displayName: 'Claude Code', userAgentPattern: /claude-code\/([\d.]+)/i, bundleName: 'aimeat-claude-code', workstation: true },
  { id: 'copilot', displayName: 'GitHub Copilot CLI', userAgentPattern: /copilot-cli\/([\d.]+)/i, bundleName: 'aimeat-copilot', workstation: true },
  { id: 'codex', displayName: 'OpenAI Codex CLI', userAgentPattern: /codex\/([\d.]+)/i, bundleName: 'aimeat-codex', workstation: true },
  { id: 'gemini', displayName: 'Google Gemini CLI', userAgentPattern: /gemini-cli\/([\d.]+)/i, bundleName: 'aimeat-gemini', workstation: true },
];

/**
 * Names a workstation agent calls itself when it reports its own platform.
 *
 * The registry above matches a User-Agent, which is what a CLI sends. A desktop or IDE client
 * reaches the node through a hosted MCP connector and sends no such header, so the only thing the
 * node ever learns about it is the free-text name the agent types into the identify_platform step:
 * "Claude Desktop", "claude desktop (MCP)", "VS Code". Matching that text is therefore not a
 * convenience — it is the ONLY signal available for exactly the clients that need it most.
 *
 * Substring matching is deliberate: the reported string is prose, not an id.
 */
const WORKSTATION_NAME_PATTERNS: RegExp[] = [
  /claude[\s_-]*(desktop|code)/i,
  /\b(vs[\s_-]*code|visual[\s_-]*studio[\s_-]*code)\b/i,
  /\bcursor\b/i,
  /\bwindsurf\b/i,
  /\bzed\b/i,
  /\bjetbrains\b/i,
  /\bcodex\b/i,
  /\bcopilot\b/i,
  /\bchatgpt[\s_-]*(desktop|app)\b/i,
  /\bworkstation\b/i,
  // An agent that describes its connection rather than its product: "MCP client", "via MCP".
  /\bmcp\b/i,
];

/**
 * The operational mode a reported platform implies, or undefined when it implies nothing.
 *
 * Only 'workstation' is inferable. The other four modes describe how the OWNER intends to run the
 * agent (does it act unattended, does it take queued work), which no platform string can answer.
 */
export function inferModeFromPlatform(platform: string | undefined): AgentMode | undefined {
  const reported = (platform ?? '').trim();
  if (!reported) return undefined;

  const known = KNOWN_PLATFORMS.find(p => p.id === reported.toLowerCase());
  if (known) return known.workstation ? 'workstation' : undefined;

  return WORKSTATION_NAME_PATTERNS.some(re => re.test(reported)) ? 'workstation' : undefined;
}

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
