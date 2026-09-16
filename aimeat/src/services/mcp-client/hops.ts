/**
 * @file hops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Stops a proxied MCP call from coming back to where it started.
 *
 *   WHY IT EXISTS. Nothing stopped an AIMEAT from attaching its OWN /v1/mcp as a remote server, and
 *   it was done on purpose twice while this feature was built (313 tools in phase 1, 316 in a sandbox
 *   on 2026-09-16). Its tools then include aimeat_mcp_call, which can name that same server, and every
 *   turn of that circle is a new HTTP request holding a pooled connection for up to a minute. Two
 *   nodes that attach each other make the same circle through a second address, which no comparison
 *   of addresses can see.
 *
 *   HOW. Every request this node sends to a remote MCP server carries `X-AIMEAT-MCP-Via`: the node ids
 *   the call has already passed through, with this node's own id added last. Every request this node
 *   RECEIVES on its MCP endpoint is refused with 508 Loop Detected when that list already names this
 *   node, or when it is long enough that the call has passed through too many servers. The list a
 *   request arrived with is kept for the rest of that request in an AsyncLocalStorage, so a call this
 *   node makes onward while serving it carries the list forward, which is what catches A to B to A.
 *
 *   WHAT IT CANNOT DO, said plainly. A node that strips the header when it forwards breaks the chain.
 *   A loop through such a node is still bounded, by the call timeout at each hop, but it is no longer
 *   refused at once. A caller can also send the header themselves; the only effect is that their own
 *   request is refused, so there is nothing in it to exploit. And the ids in the header are node ids,
 *   which are public: every account on a node is addressed by one.
 * @structure MCP_VIA_HEADER · MAX_MCP_HOPS · parseVia · viaRefusal · runWithVia · outgoingVia ·
 *   selfAddressRefusal
 * @usage
 *   const via = parseVia(req.headers[MCP_VIA_HEADER]);
 *   const refused = viaRefusal(via, config.nodeId); if (refused) return res.status(508)...
 *   await runWithVia(via, () => handle(req, res));
 *   headers[MCP_VIA_HEADER] = outgoingVia(config.nodeId);
 * @version-history
 *   v1.0.0 — 2026-09-17 — Initial.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** Lower case, because Node lowercases incoming header names and a lookup must match. */
export const MCP_VIA_HEADER = 'x-aimeat-mcp-via';

/**
 * How many AIMEAT nodes a single call may have passed through before this one refuses it.
 *
 * A person's AI calling their own node which proxies to a colleague's node which proxies to a shared
 * wiki is three. Four leaves one to spare; a chain longer than that is a configuration nobody means.
 */
export const MAX_MCP_HOPS = 4;

/** The shape of a node id, as the config accepts one. Anything else in the header is ignored. */
const NODE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

const store = new AsyncLocalStorage<string[]>();

/**
 * Read the header as it arrived.
 *
 * Tolerant on purpose: a malformed entry is dropped rather than failing the request, because the
 * header is a loop brake and not a credential, and a request refused for a stray comma is a worse
 * outcome than one entry not being counted. Capped, so a huge header cannot become a huge list.
 */
export function parseVia(raw: string | string[] | undefined): string[] {
  const joined = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
  return joined.split(',')
    .map((s) => s.trim())
    .filter((s) => NODE_ID_RE.test(s))
    .slice(0, 32);
}

/** Why a request with this list must be refused here, or null when it may go on. */
export function viaRefusal(
  via: string[], nodeId: string,
): { code: 'LOOP_DETECTED' | 'TOO_MANY_HOPS'; message: string } | null {
  if (via.some((id) => id.toLowerCase() === nodeId.toLowerCase())) {
    return {
      code: 'LOOP_DETECTED',
      message: 'This call has already passed through this AIMEAT, so answering it would send it round in a circle. It was stopped here.',
    };
  }
  if (via.length >= MAX_MCP_HOPS) {
    return {
      code: 'TOO_MANY_HOPS',
      message: `This call has already passed through ${via.length} servers on its way here, which is more than one call should need. It was stopped here.`,
    };
  }
  return null;
}

/** Serve a request with the list it arrived with in scope, so a call made onward carries it. */
export function runWithVia<T>(via: string[], fn: () => T): T {
  return store.run(via, fn);
}

/** The header value for a request this node sends: the list it is serving under, then this node. */
export function outgoingVia(nodeId: string): string {
  return [...(store.getStore() ?? []), nodeId].join(', ');
}

/** The parts of a stored transport this check reads. */
type TransportLike =
  | { kind: 'http' | 'sse'; url: string }
  | { kind: 'aimeat'; peerNodeId: string }
  | { kind: 'stdio' };

/**
 * Refuse attaching this AIMEAT to itself, when the address says so plainly.
 *
 * WHY AS WELL AS THE HEADER. The header is the real brake: it stops every spelling of the address
 * and every longer circle. But on its own, a person attaching their own node would meet it as a failed
 * first look after the form was sent. This catches the plain case while the form is still open and
 * says what is wrong. It compares the origin with this node's own base address and the path with the
 * MCP endpoints this node serves. A host written another way (127.0.0.1 for localhost, a second
 * domain) is left to the header, which answers LOOP_DETECTED.
 */
export function selfAddressRefusal(
  config: { nodeId: string; baseUrl: string }, transport: TransportLike,
): { ok: false; code: 'SELF_ADDRESS'; message: string } | null {
  const refusal = {
    ok: false as const,
    code: 'SELF_ADDRESS' as const,
    message: 'That address is this AIMEAT itself. Its tools are already here, and attaching it would only send each call back to where it started.',
  };
  if (transport.kind === 'aimeat') {
    return transport.peerNodeId.toLowerCase() === config.nodeId.toLowerCase() ? refusal : null;
  }
  if (transport.kind !== 'http' && transport.kind !== 'sse') return null;
  // An address that does not parse is refused elsewhere, and a node without a usable base address has
  // nothing to compare against; neither is this check's to answer.
  if (!URL.canParse(transport.url) || !URL.canParse(config.baseUrl)) return null;

  const target = new URL(transport.url);
  const own = new URL(config.baseUrl);
  const sameOrigin = target.protocol === own.protocol
    && target.hostname.toLowerCase() === own.hostname.toLowerCase()
    && target.port === own.port;
  const path = target.pathname.replace(/\/+$/, '');
  const ownMcpPath = path === '/v1/mcp' || path === '/mcp' || path.startsWith('/v2/mcp/');
  return sameOrigin && ownMcpPath ? refusal : null;
}
