/**
 * @file transport.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Builds the client transport for one remote MCP server, and the guarded `fetch` every
 *   byte of it travels through.
 *
 *   THE WHOLE SECURITY ARGUMENT IS ONE LINE: the SDK transports accept a `fetch`, and we give them
 *   ours. `guardedFetch` is safeFetch, so the DNS-level SSRF check, the manual redirect loop that
 *   re-validates every hop, and the dropping of Authorization when a redirect leaves its origin all
 *   apply — to the initialize POST, the SSE GET, every tools/list and every tools/call.
 *
 *   Measured 2026-09-16 before any of this was written, because the whole design depended on it: a
 *   real MCP session made five requests and the injected fetch saw all five; a server that answered
 *   302 to 169.254.169.254 was refused AT THE HOP with "Link-local / cloud-metadata address"; and a
 *   fetch that refuses surfaces in 0 ms rather than hanging. If the SDK had not allowed this the
 *   design would have changed there and not here.
 *
 *   WHAT IS DELIBERATELY NOT HERE. No caller ever supplies a URL. The endpoint comes from the
 *   stored record, which only `mcp:manage` can write. A caller names a slug.
 *
 *   A PEER AIMEAT NODE IS NOT A SPECIAL TRANSPORT, it is an address this node looks up instead of
 *   being told. `resolveWireAddress` turns `{ kind: 'aimeat', peerNodeId }` into the peer's own
 *   /v1/mcp over ordinary Streamable HTTP, so every line above still applies to it: the same
 *   guarded fetch, the same credential, the same timeout. What it adds is the federation
 *   relationship as the gate, which is the point of naming a node rather than typing its address.
 * @structure guardedFetch · resolveWireAddress · buildTransport · MCP_CONNECT_TIMEOUT_MS
 * @usage const wire = await resolveWireAddress(storage, server);
 *   if (wire.ok) await client.connect(buildTransport(wire.server, credential));
 * @version-history
 *   v1.1.0 — 2026-09-16 — Phase 6: the `aimeat` transport kind resolves through the federation
 *     peer list, gated on allowRouting, which is member and genesis only.
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport, FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { safeFetch } from '../../utils/url-validator.js';
import type { Storage } from '../../storage/interface.js';
import type { McpServerRecord, McpServerCredential } from '../../models/mcp-server-schemas.js';

/**
 * How long we wait for a far side that has accepted the connection but says nothing.
 *
 * A remote server is somebody else's uptime. Without a deadline, one slow server holds a request
 * of ours open for as long as it likes, and if that request is a tool list assembled at session
 * start, it holds up an AI client's whole session.
 */
export const MCP_CONNECT_TIMEOUT_MS = 20_000;

/**
 * safeFetch wearing the SDK's `FetchLike` shape.
 *
 * `sensitiveHeaders` names Authorization, and that is not decoration: safeFetch re-validates a
 * redirect and then follows it with the SAME headers, so an address the owner allowed could answer
 * 302 and collect the bearer token. curl and every browser drop the credential on a cross-host
 * redirect for exactly this reason, and only the caller knows which of its headers carry a secret.
 */
export const guardedFetch: FetchLike = (url, init) =>
  safeFetch(typeof url === 'string' ? url : url.toString(), {
    ...init,
    sensitiveHeaders: ['authorization'],
  });

/**
 * The headers a credential turns into.
 *
 * A `static` credential may name its own header, because not every server takes a bearer: some want
 * `X-API-Key`, and a design that assumed Authorization would meet its first refusal at the second
 * server anyone attached.
 */
function authHeaders(credential: McpServerCredential | null): Record<string, string> {
  if (!credential) return {};
  if (credential.shape === 'static' && credential.headerName) {
    return { [credential.headerName]: credential.accessToken };
  }
  return { Authorization: `Bearer ${credential.accessToken}` };
}

/**
 * Turn a stored transport into one that names an address, resolving a peer node when it names one.
 *
 * WHY THE LOOKUP IS HERE AND NOT AT ATTACH TIME. A peer's address can change, and a peering can be
 * demoted or ended. Storing the URL when the server was attached would keep a link working after
 * the relationship that justified it was over, which is the opposite of what the tiers are for.
 *
 * `allowRouting` IS THE GATE, and it is the flag whose own comment says "this node may forward
 * traffic TO this peer". Calling a tool on somebody else's node is exactly that. It is on at
 * `member` and `genesis` and cannot be raised at `visiting` or `contact`, so a peer the operator
 * has not deliberately promoted is not a place this node makes calls into.
 */
export async function resolveWireAddress(
  storage: Pick<Storage, 'listFederationPeers'>,
  server: McpServerRecord,
): Promise<
  | { ok: true; server: McpServerRecord }
  | { ok: false; code: 'PEER_UNKNOWN' | 'PEER_NOT_ROUTABLE'; message: string }
> {
  const t = server.transport;
  if (t.kind !== 'aimeat') return { ok: true, server };

  const peers = await storage.listFederationPeers();
  const peer = peers.find((p) => p.nodeId === t.peerNodeId);
  // Absent and not-peered answer alike, as everywhere else here: whether a node id is one this node
  // knows is not a fact for whoever is calling.
  if (!peer || peer.status !== 'active') {
    return {
      ok: false,
      code: 'PEER_UNKNOWN',
      message: `This node has no active peering with "${t.peerNodeId}".`,
    };
  }
  if (!peer.allowRouting) {
    return {
      ok: false,
      code: 'PEER_NOT_ROUTABLE',
      message: `The peering with "${t.peerNodeId}" does not carry routing, so this node does not `
        + 'make calls into it. An operator can promote the peer to member.',
    };
  }
  return {
    ok: true,
    server: {
      ...server,
      // Streamable HTTP, because that is what this node serves at that path and a peer is a node.
      transport: { kind: 'http', url: `${peer.url.replace(/\/+$/, '')}/v1/mcp` },
    },
  };
}

/**
 * Build the transport for one server.
 *
 * Throws for `stdio`, which is a later phase: a stub that silently did nothing would be found by a
 * person wondering why their server never answers. It runs somebody else's code on this host and is
 * operator-only, allowlisted and off by default when it does arrive.
 *
 * Throws for `aimeat` too, and that one is a programming error rather than a missing feature:
 * resolveWireAddress turns a peer into an http address before anything reaches here, so a record
 * still naming a peer at this point means a caller skipped it.
 */
export function buildTransport(
  server: McpServerRecord,
  credential: McpServerCredential | null,
): Transport {
  const t = server.transport;

  if (t.kind === 'stdio') {
    throw new Error(
      'This node cannot run a local MCP server process yet. Attach the server over https instead.',
    );
  }
  if (t.kind === 'aimeat') {
    throw new Error(
      'A peer node must be resolved to an address before it is connected to (resolveWireAddress).',
    );
  }

  // The record's own headers first, so a credential can never be shadowed by one somebody typed
  // into the transport when they attached the server.
  const headers = { ...(t.headers ?? {}), ...authHeaders(credential) };
  const url = new URL(t.url);

  return t.kind === 'sse'
    ? new SSEClientTransport(url, { fetch: guardedFetch, requestInit: { headers } })
    : new StreamableHTTPClientTransport(url, { fetch: guardedFetch, requestInit: { headers } });
}
