// GAII format: agent#owner@node
// agent: ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$
// owner: ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$
// node:  ^aimeat-[a-z]{2,10}-[0-9]{3}-[a-z0-9-]{1,32}$

const AGENT_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const OWNER_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const NODE_RE = /^aimeat-[a-z]{2,10}-[0-9]{3}-[a-z0-9-]{1,32}$/;
const GAII_RE = /^([a-z0-9][a-z0-9-]{1,62}[a-z0-9])#([a-z0-9][a-z0-9-]{1,62}[a-z0-9])@(aimeat-[a-z]{2,10}-[0-9]{3}-[a-z0-9-]{1,32})$/;

export const RESERVED_NAMES = new Set([
  'admin', 'system', 'root', 'operator', 'meat', 'aimeat', 'node', 'network',
  'registry', 'anonymous', 'null', 'undefined', 'test', 'debug', 'internal',
  'public', 'private', 'shared', 'all', 'none', 'any', 'self', 'global',
]);

export interface ParsedGAII {
  agent: string;
  owner: string;
  node: string;
  full: string;
}

export function parseGAII(gaii: string): ParsedGAII | null {
  const match = GAII_RE.exec(gaii);
  if (!match) return null;
  return { agent: match[1], owner: match[2], node: match[3], full: gaii };
}

export function buildGAII(agent: string, owner: string, node: string): string {
  return `${agent}#${owner}@${node}`;
}

export function validateAgentName(name: string): string | null {
  if (!AGENT_RE.test(name)) return 'Agent name must be 3-64 lowercase alphanumeric characters with hyphens';
  if (RESERVED_NAMES.has(name)) return `Name "${name}" is reserved`;
  return null;
}

export function validateOwnerName(name: string): string | null {
  if (!OWNER_RE.test(name)) return 'Owner name must be 3-64 lowercase alphanumeric characters with hyphens';
  if (RESERVED_NAMES.has(name)) return `Name "${name}" is reserved`;
  return null;
}

export function validateNodeId(nodeId: string): string | null {
  if (!NODE_RE.test(nodeId)) return 'Node ID must match format: aimeat-{region}-{number}-{name}';
  return null;
}

export function isValidGAII(gaii: string): boolean {
  return GAII_RE.test(gaii);
}

/**
 * Lenient GAII parser — extracts owner and node without strict validation.
 * Handles both `agent#owner@node` and `owner@node` formats.
 * Returns empty strings for missing parts instead of null.
 */
export function parseGaiiLoose(gaii: string): { agent: string; owner: string; node: string } {
  const hashIdx = gaii.indexOf('#');
  const atIdx = gaii.lastIndexOf('@');
  if (atIdx < 0) return { agent: '', owner: '', node: '' };
  return {
    agent: hashIdx >= 0 ? gaii.slice(0, hashIdx) : '',
    owner: hashIdx >= 0 ? gaii.slice(hashIdx + 1, atIdx) : gaii.slice(0, atIdx),
    node: gaii.slice(atIdx + 1),
  };
}

// Chat Instance ID format: platform-appname#owner@node
// Same syntax as GAII but semantically different — represents a human-operated AI session
// Examples:
//   Logged in:  claude-myapp#jouni@aimeat-finland-001-genesis
//   Anonymous:  chatgpt-anon-1709337600#anonymous@aimeat-finland-001-genesis

export interface ParsedChatInstanceId {
  platform: string;
  appName: string;
  ownerName: string;
  nodeId: string;
  full: string;
  isAnonymous: boolean;
}

export function buildChatInstanceId(platform: string, appName: string, owner: string, node: string): string {
  return `${platform}-${appName}#${owner}@${node}`;
}

export function parseChatInstanceId(id: string): ParsedChatInstanceId | null {
  // Format: platform-appname#owner@node
  const hashIdx = id.indexOf('#');
  if (hashIdx < 0) return null;

  const beforeHash = id.substring(0, hashIdx);
  const afterHash = id.substring(hashIdx + 1);

  const atIdx = afterHash.indexOf('@');
  if (atIdx < 0) return null;

  const ownerName = afterHash.substring(0, atIdx);
  const nodeId = afterHash.substring(atIdx + 1);

  if (!NODE_RE.test(nodeId)) return null;
  if (!OWNER_RE.test(ownerName)) return null;

  // Split beforeHash into platform and appName
  // The appName is the last hyphen-separated segment
  // EXCEPT for anonymous: "chatgpt-anon-1709337600" → platform=chatgpt, appName=anon-1709337600
  const firstHyphen = beforeHash.indexOf('-');
  if (firstHyphen < 0) return null;

  const lastHyphen = beforeHash.lastIndexOf('-');
  const afterLastHyphen = beforeHash.substring(lastHyphen + 1);
  const beforeLastHyphen = beforeHash.substring(0, lastHyphen);

  let platform: string;
  let appName: string;

  if (/^\d+$/.test(afterLastHyphen) && beforeLastHyphen.endsWith('-anon')) {
    // Anonymous: "chatgpt-anon-1709337600" → platform=chatgpt, appName=anon-1709337600
    const anonIdx = beforeLastHyphen.lastIndexOf('-anon');
    platform = beforeLastHyphen.substring(0, anonIdx);
    appName = beforeLastHyphen.substring(anonIdx + 1) + '-' + afterLastHyphen;
  } else {
    // Normal: last hyphen separates platform from appName
    platform = beforeLastHyphen;
    appName = afterLastHyphen;
  }

  if (!platform || !appName) return null;

  return {
    platform,
    appName,
    ownerName,
    nodeId,
    full: id,
    isAnonymous: ownerName === 'anonymous',
  };
}
