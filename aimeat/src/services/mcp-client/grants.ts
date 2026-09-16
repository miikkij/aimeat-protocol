/**
 * @file grants.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description WHICH of an owner's remote MCP servers a given agent or app may use, which tools on
 *   it, with which arguments already decided, and how often.
 *
 *   WHY THIS EXISTS. Phase 1 gated everything on one scope word: an agent holding `mcp:use` reached
 *   every server its owner had attached. That is the right DEFAULT — the person attached the server
 *   so the AI they talk to could use it — and the wrong CEILING, because "my coding agent may read
 *   Jira" and "my coding agent may post in the company wiki" are not the same sentence. A grant
 *   narrows the default without taking it away.
 *
 *   NO GRANT MEANS THE SCOPE DECIDES, and that is deliberate rather than an omission. Making a grant
 *   mandatory would have broken every agent the moment this shipped, and would have taught owners
 *   that the feature is paperwork. The first grant written for a (server, grantee) pair is what
 *   switches that pair from "the scope says yes" to "this list says what".
 *
 *   A SYSTEM NAMESPACE, NOT THE OWNER'S KEYSPACE, copying metered-entitlements.ts. Three reasons:
 *   grants must not eat the owner's 1000-key budget, a raw `aimeat_memory_write` must not be able to
 *   grant itself access to a server, and the read path wants one prefix rather than a scan of
 *   somebody's whole memory.
 *
 *   THE CAP IS COUNTED FROM THE USAGE STREAM, not from a counter on the grant. A counter would be a
 *   read-modify-write race on every call, and the per-call record already exists under the
 *   `mcp-remote` surface. What the grant holds is the ceiling, not the tally.
 * @structure McpGrant · putMcpGrant · listMcpGrants · removeMcpGrant · resolveMcpAccess
 * @usage const verdict = await resolveMcpAccess({ storage, owner, server, grantee, tool, scopes });
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 2 of the MCP proxy.
 */
import type { Storage } from '../../storage/interface.js';
import type { McpServerRecord } from '../../models/mcp-server-schemas.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { logger } from '../../utils/logger.js';

/**
 * System namespace — server-side only, never surfaced as a readable memory key.
 *
 * Mirrors `metered-entitlement`: a pseudo-owner whose records nothing addresses through the memory
 * API, so `aimeat_memory_write` cannot forge one.
 */
export const NS_MCP_GRANT = 'mcp-grant';

/** Everything a grant may say. Every field narrows; none widens. */
export interface McpGrant {
  type: 'aimeat:McpGrant';
  /** The owner whose server this is. */
  ownerGhii: string;
  /** The server's slug. */
  server: string;
  /**
   * Who it is for: a GAII, a GEAI, `app:{owner}/{file}`, or `*` for everything acting for this
   * owner. A more specific grant wins over `*`, so one agent can be narrowed without touching the
   * rest.
   */
  grantee: string;
  /** `'*'` means every tool the server lists. A list means those names and nothing else. */
  tools: string[] | '*';
  /**
   * Arguments the grantee may not choose, merged over whatever it sent.
   *
   * This is what turns "may call create_issue" into "may create issues in SUPPORT". Copied from the
   * app-tool path's `lockedInput`, and it is the reason a grant is more than a checkbox.
   */
  lockedInput?: Record<string, unknown>;
  /** A ceiling on calls in a rolling window. Counted from the usage stream, never from a counter. */
  callCap?: { count: number; windowHours: number };
  expires: string | null;
  grantedBy: string;
  grantedAt: string;
}

const grantKey = (ownerGhii: string, server: string, grantee: string): string =>
  `${ownerGhii}/${server}/${grantee}`;

/** Write or replace one grant. One (owner, server, grantee) triple has exactly one. */
export async function putMcpGrant(storage: Storage, grant: McpGrant): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key: grantKey(grant.ownerGhii, grant.server, grant.grantee),
    ownerGaii: NS_MCP_GRANT,
    value: grant,
    visibility: 'private',
    tags: ['mcp-grant'],
    ttlHours: null,
    version: 1,
    createdAt: grant.grantedAt,
    updatedAt: now,
  });
}

/** Every grant an owner holds, optionally for one server. */
export async function listMcpGrants(
  storage: Storage, ownerGhii: string, server?: string,
): Promise<McpGrant[]> {
  const prefix = server ? `${ownerGhii}/${server}/` : `${ownerGhii}/`;
  const rows = await storage.listMemory(NS_MCP_GRANT, { prefix });
  return rows
    .map((r) => r.value as McpGrant)
    .filter((g) => g && g.type === 'aimeat:McpGrant');
}

export async function removeMcpGrant(
  storage: Storage, ownerGhii: string, server: string, grantee: string,
): Promise<boolean> {
  const key = grantKey(ownerGhii, server, grantee);
  const existing = await storage.getMemory(NS_MCP_GRANT, key);
  if (!existing) return false;
  await storage.deleteMemory(NS_MCP_GRANT, key);
  return true;
}

export type McpAccess =
  | { allowed: true; lockedInput?: Record<string, unknown> }
  | { allowed: false; code: McpAccessRefusal; message: string };

export type McpAccessRefusal = 'NO_SCOPE' | 'TOOL_NOT_GRANTED' | 'GRANT_EXPIRED' | 'CAP_REACHED';

export interface AccessInput {
  storage: Storage;
  server: McpServerRecord;
  /** The exact principal asking: a GAII, a GEAI, or the owner's own GHII. */
  grantee: string;
  /** The tool it wants, or omitted when it is only asking to LIST. */
  tool?: string;
  /** What the session holds, so the default path can be answered without a grant. */
  scopes: string[];
}

/**
 * May this principal call this tool on this server, and with what already decided?
 *
 * THE ORDER IS THE DESIGN. The scope is asked first, because a principal without `mcp:use` is
 * refused whatever anybody granted — a grant narrows, it never widens, so no grant can hand out a
 * permission the owner did not give the agent in the first place.
 *
 * An OWNER asking about their own server needs no grant: grants exist to narrow the things acting
 * FOR them, and a person cannot be narrowed out of their own account.
 */
export async function resolveMcpAccess(input: AccessInput): Promise<McpAccess> {
  const { storage, server, grantee, tool, scopes } = input;

  // The owner themselves. `ownerGhii` is null only on a node-wide server, which phase 4 fences
  // separately; here a match means this is the person the server belongs to.
  const isOwnerThemselves = server.ownerGhii !== null && grantee === server.ownerGhii;
  if (!isOwnerThemselves && !scopeIsCovered(scopes, tool ? 'mcp:use' : 'mcp:read')) {
    return {
      allowed: false,
      code: 'NO_SCOPE',
      message: tool
        ? 'This agent was not given permission to call tools on attached servers.'
        : 'This agent was not given permission to see attached servers.',
    };
  }
  if (isOwnerThemselves) return { allowed: true };

  const grants = await listMcpGrants(storage, server.ownerGhii ?? '', server.slug);
  // No grant for this pair at all: the scope already said yes, and that is the phase-1 default the
  // first grant replaces.
  const exact = grants.find((g) => g.grantee === grantee);
  const wildcard = grants.find((g) => g.grantee === '*');
  const grant = exact ?? wildcard;
  if (!grant) return { allowed: true };

  if (grant.expires && new Date(grant.expires).getTime() < Date.now()) {
    return {
      allowed: false,
      code: 'GRANT_EXPIRED',
      message: `The permission to use "${server.slug}" ran out on ${grant.expires.slice(0, 10)}.`,
    };
  }

  if (tool && grant.tools !== '*' && !grant.tools.includes(tool)) {
    return {
      allowed: false,
      code: 'TOOL_NOT_GRANTED',
      // Naming what IS allowed turns a dead end into a next step, and it gives away nothing the
      // caller was not already permitted to know.
      message: `"${tool}" is not one of the tools this agent may use on "${server.slug}". `
        + `It may use: ${grant.tools.length ? grant.tools.join(', ') : 'none'}.`,
    };
  }

  if (grant.callCap && tool) {
    const since = new Date(Date.now() - grant.callCap.windowHours * 3_600_000).toISOString();
    const used = await countRecentCalls(storage, grantee, server.slug, since);
    if (used >= grant.callCap.count) {
      return {
        allowed: false,
        code: 'CAP_REACHED',
        message: `This agent has used "${server.slug}" ${used} times in the last `
          + `${grant.callCap.windowHours} hours, which is its limit.`,
      };
    }
  }

  return {
    allowed: true,
    ...(grant.lockedInput ? { lockedInput: grant.lockedInput } : {}),
  };
}

/**
 * How many times this grantee has called this server inside the window.
 *
 * Read from the usage stream rather than a counter on the grant, because a counter is a
 * read-modify-write race on every call and the per-call rows already exist. A failure to count is
 * NOT a refusal: the cap is a courtesy ceiling, and answering "no" because telemetry was briefly
 * unavailable would break working agents to enforce a limit nobody had reached.
 */
async function countRecentCalls(
  storage: Storage, grantee: string, slug: string, since: string,
): Promise<number> {
  try {
    const rows = await storage.listUsageCalls({
      actorGaii: grantee, from: since, surface: 'mcp-remote', outcome: 'ok',
    });
    // Filtered on the coordinate here rather than in SQL: the filter has no such dimension,
    // and one grantee's calls inside one window is a small page however busy they are.
    return rows.filter((r) => r.coordinate.startsWith(`${slug}/`)).length;
  } catch (err) {
    logger.warn('mcp-client: a call cap could not be counted, so it was not enforced this time', {
      grantee, server: slug, error: String(err),
    });
    return 0;
  }
}

/**
 * Merge the grant's fixed arguments over what the caller sent.
 *
 * The grant's values WIN, which is the whole point: "only in project SUPPORT" is not a suggestion,
 * and a caller that supplies its own `project` must not be able to steer out of the fence.
 */
export function applyLockedInput(
  args: Record<string, unknown>, locked?: Record<string, unknown>,
): Record<string, unknown> {
  return locked ? { ...args, ...locked } : args;
}
