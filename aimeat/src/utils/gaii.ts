// GAII format: agent#owner@node
// agent: ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$
// owner: ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$
// node:  ^meat-[a-z]{2,10}-[0-9]{3}-[a-z0-9-]{1,32}$

const AGENT_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const OWNER_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const NODE_RE = /^meat-[a-z]{2,10}-[0-9]{3}-[a-z0-9-]{1,32}$/;
const GAII_RE = /^([a-z0-9][a-z0-9-]{1,62}[a-z0-9])#([a-z0-9][a-z0-9-]{1,62}[a-z0-9])@(meat-[a-z]{2,10}-[0-9]{3}-[a-z0-9-]{1,32})$/;

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
  if (!NODE_RE.test(nodeId)) return 'Node ID must match format: meat-{region}-{number}-{name}';
  return null;
}

export function isValidGAII(gaii: string): boolean {
  return GAII_RE.test(gaii);
}
